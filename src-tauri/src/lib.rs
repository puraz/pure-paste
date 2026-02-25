use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{Emitter, Manager, RunEvent, State, WindowEvent};
use uuid::Uuid;
use chrono::Utc;
#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItem};
#[cfg(desktop)]
use tauri::tray::TrayIconBuilder;
#[cfg(desktop)]
use arboard::Clipboard;

// 优先使用固定尺寸托盘图标，避免默认图标过大导致菜单栏不可见
#[cfg(desktop)]
fn load_tray_icon_image() -> Option<tauri::image::Image<'static>> {
    let bytes = include_bytes!("../icons/32x32.png");
    tauri::image::Image::from_bytes(bytes)
        .ok()
        .map(|image| image.to_owned())
}

// 统一持有数据库连接与运行时状态，避免每次调用命令都反复打开文件导致性能抖动
struct AppState {
    // SQLite 连接在多个命令间共享，避免频繁打开文件
    db: Mutex<Connection>,
    // 是否启用后台剪贴板监听，可由前端随时切换
    monitoring_enabled: AtomicBool,
    // 记录后台上一次处理过的剪贴板文本，用于去重
    last_clipboard_text: Mutex<Option<String>>,
    // 标记下一次需要跳过的剪贴板文本，避免应用自身写入导致重复计数
    skip_next_text: Mutex<Option<String>>,
    // 仅允许通过托盘菜单退出应用，其他退出请求需要被拦截
    allow_exit: AtomicBool,
}

// 与前端保持一致的历史记录上限，避免后台监听撑爆数据库
const MAX_HISTORY: i64 = 80;
// 后台轮询间隔，兼顾响应速度与 CPU 占用
const CLIPBOARD_POLL_INTERVAL_MS: u64 = 900;

// 剪贴板历史记录的数据结构，字段与前端状态保持一致
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardItem {
    id: String,
    text: String,
    created_at: String,
    updated_at: String,
    pinned: bool,
    count: i64,
}

// 前端传入的新增/更新数据，用于执行去重写入与计数更新
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardUpsertPayload {
    id: String,
    text: String,
    created_at: String,
    updated_at: String,
}

// 文本编辑可能触发合并，返回合并后的条目以及被移除的条目 id
#[derive(Debug, Serialize)]
struct ClipboardUpdateResult {
    item: ClipboardItem,
    #[serde(rename = "mergedId")]
    merged_id: Option<String>,
}

// 后台监听写入后广播给前端的结构，保持字段命名一致便于直接复用
#[derive(Debug, Clone, Serialize)]
struct ClipboardBroadcastPayload {
    item: ClipboardItem,
    #[serde(rename = "mergedId")]
    merged_id: Option<String>,
}

// 生成当前时间的 ISO-8601 字符串，前后端统一使用字符串存储时间
fn now_iso_string() -> String {
    Utc::now().to_rfc3339()
}

// 构造用于写入数据库的剪贴板条目，确保字段完整且格式一致
fn build_clipboard_payload(text: String) -> ClipboardUpsertPayload {
    let now = now_iso_string();
    ClipboardUpsertPayload {
        id: Uuid::new_v4().to_string(),
        text,
        created_at: now.clone(),
        updated_at: now,
    }
}

// 统一执行表结构初始化，保证首次启动即可持久化
fn init_db(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS clipboard_items (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            pinned INTEGER NOT NULL DEFAULT 0,
            count INTEGER NOT NULL DEFAULT 1
        );
        ",
    )?;
    Ok(())
}

// 将 SQLite 行数据映射成前端可用的结构
fn map_row(row: &rusqlite::Row) -> Result<ClipboardItem, rusqlite::Error> {
    let pinned_value: i64 = row.get(4)?;
    Ok(ClipboardItem {
        id: row.get(0)?,
        text: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        pinned: pinned_value != 0,
        count: row.get(5)?,
    })
}

// 剪贴板数据量超出上限时，删除最旧的未固定条目以控制体积
fn prune_history(tx: &rusqlite::Transaction, max_items: i64) -> Result<(), rusqlite::Error> {
    if max_items <= 0 {
        return Ok(());
    }
    let total: i64 = tx.query_row("SELECT COUNT(*) FROM clipboard_items", [], |row| row.get(0))?;
    if total <= max_items {
        return Ok(());
    }
    let overflow = total - max_items;
    tx.execute(
        "
        DELETE FROM clipboard_items
        WHERE id IN (
            SELECT id FROM clipboard_items
            WHERE pinned = 0
            ORDER BY updated_at ASC
            LIMIT ?1
        )
        ",
        params![overflow],
    )?;
    Ok(())
}

// 启动时读取历史记录，供前端渲染并恢复状态
#[tauri::command]
fn load_clipboard_history(state: State<AppState>, limit: i64) -> Result<Vec<ClipboardItem>, String> {
    let limit = limit.clamp(0, 500);
    let conn = state
        .db
        .lock()
        .map_err(|_| "数据库连接被占用，无法读取历史记录".to_string())?;
    let mut stmt = conn
        .prepare(
            "
            SELECT id, text, created_at, updated_at, pinned, count
            FROM clipboard_items
            ORDER BY pinned DESC, updated_at DESC
            LIMIT ?1
            ",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![limit], map_row)
        .map_err(|err| err.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|err| err.to_string())?);
    }
    Ok(items)
}

// 新增或更新历史记录，遇到重复文本时只更新计数与更新时间
fn upsert_clipboard_item_internal(
    state: &AppState,
    item: ClipboardUpsertPayload,
    max_items: i64,
) -> Result<ClipboardItem, String> {
    if item.text.trim().is_empty() {
        return Err("剪贴板内容为空，已忽略写入".to_string());
    }
    let mut conn = state
        .db
        .lock()
        .map_err(|_| "数据库连接被占用，无法写入历史记录".to_string())?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    let existing: Option<(String, String, bool, i64)> = tx
        .query_row(
            "
            SELECT id, created_at, pinned, count
            FROM clipboard_items
            WHERE text = ?1
            ",
            params![item.text],
            |row| {
                let pinned_value: i64 = row.get(2)?;
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    pinned_value != 0,
                    row.get(3)?,
                ))
            },
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let target_id = if let Some((id, _created_at, pinned, count)) = existing {
        tx.execute(
            "
            UPDATE clipboard_items
            SET updated_at = ?1, count = ?2, pinned = ?3
            WHERE id = ?4
            ",
            params![item.updated_at, count + 1, if pinned { 1 } else { 0 }, id],
        )
        .map_err(|err| err.to_string())?;
        id
    } else {
        tx.execute(
            "
            INSERT INTO clipboard_items (id, text, created_at, updated_at, pinned, count)
            VALUES (?1, ?2, ?3, ?4, 0, 1)
            ",
            params![item.id, item.text, item.created_at, item.updated_at],
        )
        .map_err(|err| err.to_string())?;
        item.id
    };
    prune_history(&tx, max_items).map_err(|err| err.to_string())?;
    let persisted = tx
        .query_row(
            "
            SELECT id, text, created_at, updated_at, pinned, count
            FROM clipboard_items
            WHERE id = ?1
            ",
            params![target_id],
            map_row,
        )
        .map_err(|err| err.to_string())?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(persisted)
}

// 前端或后台调用的命令入口，实际逻辑由内部函数统一处理
#[tauri::command]
fn upsert_clipboard_item(
    state: State<AppState>,
    item: ClipboardUpsertPayload,
    max_items: i64,
) -> Result<ClipboardItem, String> {
    upsert_clipboard_item_internal(&state, item, max_items)
}

// 更新条目文本，若文本重复则合并计数并删除旧条目
#[tauri::command]
fn update_clipboard_item_text(
    state: State<AppState>,
    id: String,
    text: String,
    updated_at: String,
) -> Result<ClipboardUpdateResult, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("剪贴板内容为空，已忽略保存".to_string());
    }
    let mut conn = state
        .db
        .lock()
        .map_err(|_| "数据库连接被占用，无法更新内容".to_string())?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    let source: Option<(String, String, bool, i64)> = tx
        .query_row(
            "
            SELECT id, created_at, pinned, count
            FROM clipboard_items
            WHERE id = ?1
            ",
            params![id],
            |row| {
                let pinned_value: i64 = row.get(2)?;
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    pinned_value != 0,
                    row.get(3)?,
                ))
            },
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let Some((source_id, source_created_at, source_pinned, source_count)) = source else {
        return Err("未找到需要更新的条目".to_string());
    };
    let target: Option<(String, String, bool, i64)> = tx
        .query_row(
            "
            SELECT id, created_at, pinned, count
            FROM clipboard_items
            WHERE text = ?1 AND id <> ?2
            ",
            params![trimmed, source_id],
            |row| {
                let pinned_value: i64 = row.get(2)?;
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    pinned_value != 0,
                    row.get(3)?,
                ))
            },
        )
        .optional()
        .map_err(|err| err.to_string())?;
    if let Some((target_id, target_created_at, target_pinned, target_count)) = target {
        let merged_count = source_count + target_count;
        let merged_pinned = source_pinned || target_pinned;
        let merged_created_at = if source_created_at <= target_created_at {
            source_created_at
        } else {
            target_created_at
        };
        tx.execute(
            "
            UPDATE clipboard_items
            SET count = ?1, pinned = ?2, created_at = ?3, updated_at = ?4
            WHERE id = ?5
            ",
            params![
                merged_count,
                if merged_pinned { 1 } else { 0 },
                merged_created_at,
                updated_at,
                target_id
            ],
        )
        .map_err(|err| err.to_string())?;
        tx.execute(
            "DELETE FROM clipboard_items WHERE id = ?1",
            params![source_id],
        )
        .map_err(|err| err.to_string())?;
        let persisted = tx
            .query_row(
                "
                SELECT id, text, created_at, updated_at, pinned, count
                FROM clipboard_items
                WHERE id = ?1
                ",
                params![target_id],
                map_row,
            )
            .map_err(|err| err.to_string())?;
        tx.commit().map_err(|err| err.to_string())?;
        return Ok(ClipboardUpdateResult {
            item: persisted,
            merged_id: Some(source_id),
        });
    }
    tx.execute(
        "
        UPDATE clipboard_items
        SET text = ?1, updated_at = ?2
        WHERE id = ?3
        ",
        params![trimmed, updated_at, source_id],
    )
    .map_err(|err| err.to_string())?;
    let persisted = tx
        .query_row(
            "
            SELECT id, text, created_at, updated_at, pinned, count
            FROM clipboard_items
            WHERE id = ?1
            ",
            params![source_id],
            map_row,
        )
        .map_err(|err| err.to_string())?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(ClipboardUpdateResult {
        item: persisted,
        merged_id: None,
    })
}

// 切换条目固定状态，固定条目不会被历史上限清理
#[tauri::command]
fn set_clipboard_item_pinned(
    state: State<AppState>,
    id: String,
    pinned: bool,
) -> Result<ClipboardItem, String> {
    let conn = state
        .db
        .lock()
        .map_err(|_| "数据库连接被占用，无法更新固定状态".to_string())?;
    conn.execute(
        "UPDATE clipboard_items SET pinned = ?1 WHERE id = ?2",
        params![if pinned { 1 } else { 0 }, id],
    )
    .map_err(|err| err.to_string())?;
    let persisted = conn
        .query_row(
            "
            SELECT id, text, created_at, updated_at, pinned, count
            FROM clipboard_items
            WHERE id = ?1
            ",
            params![id],
            map_row,
        )
        .map_err(|err| err.to_string())?;
    Ok(persisted)
}

// 删除单条记录，前端同步移除即可
#[tauri::command]
fn delete_clipboard_item(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|_| "数据库连接被占用，无法删除条目".to_string())?;
    conn.execute("DELETE FROM clipboard_items WHERE id = ?1", params![id])
        .map_err(|err| err.to_string())?;
    Ok(())
}

// 清空全部历史记录，用于清空按钮对应的操作
#[tauri::command]
fn clear_clipboard_history(state: State<AppState>) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|_| "数据库连接被占用，无法清空历史记录".to_string())?;
    conn.execute("DELETE FROM clipboard_items", [])
        .map_err(|err| err.to_string())?;
    Ok(())
}

// 打开并聚焦主窗口，统一在托盘与菜单中复用
#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // 先显示再聚焦，确保窗口从隐藏状态恢复
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// 后台剪贴板轮询任务，负责捕获系统剪贴板并写入数据库
#[cfg(desktop)]
fn start_clipboard_watcher(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        // 只在后台线程中持有剪贴板实例，避免跨线程竞争导致死锁
        let mut clipboard = loop {
            match Clipboard::new() {
                Ok(instance) => break instance,
                Err(_) => {
                    // 初始化失败时稍后重试，避免启动瞬间阻塞
                    std::thread::sleep(Duration::from_millis(1200));
                }
            }
        };

        // 启动后先读取一次当前剪贴板，避免重复计数已有内容
        if let Ok(initial_text) = clipboard.get_text() {
            let trimmed = initial_text.trim();
            if !trimmed.is_empty() {
                {
                    let state = app_handle.state::<AppState>();
                    if let Ok(mut last_lock) = state.last_clipboard_text.lock() {
                        *last_lock = Some(trimmed.to_string());
                    };
                }
            }
        }

        loop {
            std::thread::sleep(Duration::from_millis(CLIPBOARD_POLL_INTERVAL_MS));
            let state = app_handle.state::<AppState>();
            if !state.monitoring_enabled.load(Ordering::Relaxed) {
                continue;
            }
            let content = match clipboard.get_text() {
                Ok(text) => text,
                Err(_) => continue,
            };
            let trimmed = content.trim();
            if trimmed.is_empty() {
                continue;
            }

            // 如果是应用自身写入的内容则跳过一次，避免重复计数
            let should_skip = {
                let mut skip_lock = match state.skip_next_text.lock() {
                    Ok(lock) => lock,
                    Err(_) => continue,
                };
                if skip_lock.as_deref() == Some(trimmed) {
                    *skip_lock = None;
                    true
                } else {
                    false
                }
            };
            if should_skip {
                if let Ok(mut last_lock) = state.last_clipboard_text.lock() {
                    *last_lock = Some(trimmed.to_string());
                }
                continue;
            }

            // 与最近一次记录对比，避免剪贴板未变化时重复写入
            let is_duplicate = match state.last_clipboard_text.lock() {
                Ok(lock) => lock.as_deref() == Some(trimmed),
                Err(_) => true,
            };
            if is_duplicate {
                continue;
            }

            let payload = build_clipboard_payload(trimmed.to_string());
            match upsert_clipboard_item_internal(&state, payload, MAX_HISTORY) {
                Ok(persisted) => {
                    if let Ok(mut last_lock) = state.last_clipboard_text.lock() {
                        *last_lock = Some(trimmed.to_string());
                    }
                    let _ = app_handle.emit(
                        "clipboard-updated",
                        ClipboardBroadcastPayload {
                            item: persisted,
                            merged_id: None,
                        },
                    );
                }
                Err(_) => {
                    // 写入失败时保持 last_clipboard_text 不更新，便于下次重试
                }
            }
        }
    });
}

// 切换后台剪贴板监听开关，前端开关与后台行为保持一致
#[tauri::command]
fn set_clipboard_monitoring(state: State<AppState>, enabled: bool) -> Result<(), String> {
    state.monitoring_enabled.store(enabled, Ordering::Relaxed);
    Ok(())
}

// 获取当前监听状态，便于前端初始化时对齐
#[tauri::command]
fn get_clipboard_monitoring(state: State<AppState>) -> Result<bool, String> {
    Ok(state.monitoring_enabled.load(Ordering::Relaxed))
}

// 标记下一次要跳过的剪贴板文本，防止应用自身写入被后台重复计数
#[tauri::command]
fn mark_clipboard_skip(state: State<AppState>, text: String) -> Result<(), String> {
    let mut skip_lock = state
        .skip_next_text
        .lock()
        .map_err(|_| "监听状态被占用，无法更新跳过内容".to_string())?;
    let mut last_lock = state
        .last_clipboard_text
        .lock()
        .map_err(|_| "监听状态被占用，无法更新最近内容".to_string())?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    *skip_lock = Some(trimmed.to_string());
    *last_lock = Some(trimmed.to_string());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 注册剪贴板插件，并在启动时初始化 SQLite，确保历史记录持久化
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                // 将应用切换为辅助应用模式，隐藏 Dock 与 Cmd+Tab，仅通过托盘入口访问
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|err| err.to_string())?;
            std::fs::create_dir_all(&app_data_dir).map_err(|err| err.to_string())?;
            let db_path = app_data_dir.join("clipboard.db");
            let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
            init_db(&conn).map_err(|err| err.to_string())?;
            app.manage(AppState {
                db: Mutex::new(conn),
                monitoring_enabled: AtomicBool::new(true),
                last_clipboard_text: Mutex::new(None),
                skip_next_text: Mutex::new(None),
                allow_exit: AtomicBool::new(false),
            });
            #[cfg(desktop)]
            {
                // 创建托盘菜单，确保应用关闭窗口后仍可快速唤起
                let show_item =
                    MenuItem::with_id(app, "show", "打开", true, None::<&str>)?;
                let quit_item =
                    MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let tray_menu = MenuBuilder::new(app)
                    .item(&show_item)
                    .separator()
                    .item(&quit_item)
                    .build()?;
                let mut tray_builder = TrayIconBuilder::new()
                    .menu(&tray_menu)
                    .tooltip("我的剪贴板")
                    // 左键点击直接触发点击事件，退出改为右键/菜单操作
                    .show_menu_on_left_click(false);
                if let Some(icon) = load_tray_icon_image()
                    .or_else(|| app.default_window_icon().cloned())
                {
                    tray_builder = tray_builder.icon(icon);
                }
                #[cfg(target_os = "macos")]
                {
                    // 使用模板图标适配深浅色菜单栏，避免图标不可见
                    tray_builder = tray_builder.icon_as_template(true);
                }
                let tray = tray_builder.build(app)?;
                // 保持托盘实例存活，避免离开作用域后图标被自动移除
                app.manage(tray);
                // 启动后台剪贴板监听任务，确保隐藏窗口后仍可记录
                start_clipboard_watcher(app.handle().clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_clipboard_history,
            upsert_clipboard_item,
            update_clipboard_item_text,
            set_clipboard_item_pinned,
            delete_clipboard_item,
            clear_clipboard_history,
            set_clipboard_monitoring,
            get_clipboard_monitoring,
            mark_clipboard_skip
        ]);
    #[cfg(desktop)]
    let builder = builder
        // 托盘菜单与主菜单共享同一事件回调，统一处理“打开/退出”
        .on_menu_event(|app, event| {
            if event.id() == "show" {
                show_main_window(app);
            }
            if event.id() == "quit" {
                // 标记为允许退出，确保只通过托盘菜单触发真正退出
                app.state::<AppState>()
                    .allow_exit
                    .store(true, Ordering::Relaxed);
                app.exit(0);
            }
        })
        // 仅左键点击托盘图标时显示主窗口，右键只负责弹出菜单避免误触打开
        .on_tray_icon_event(|app, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                ..
            } = event
            {
                show_main_window(app);
            }
        })
        // 关闭窗口时隐藏到托盘，保持后台监听不中断
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        });
    #[cfg(desktop)]
    {
        let app = builder
            .build(tauri::generate_context!())
            .expect("error while building tauri application");
        // 拦截系统级退出请求，确保只能通过托盘菜单真正退出
        app.run(|app_handle, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                let state = app_handle.state::<AppState>();
                if !state.allow_exit.load(Ordering::Relaxed) {
                    api.prevent_exit();
                }
            }
        });
    }
    #[cfg(not(desktop))]
    {
        builder
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
