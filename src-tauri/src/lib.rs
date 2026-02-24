use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, State};

// 统一持有数据库连接，避免每次调用命令都反复打开文件导致性能抖动
struct AppState {
    db: Mutex<Connection>,
}

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
#[tauri::command]
fn upsert_clipboard_item(
    state: State<AppState>,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 注册剪贴板插件，并在启动时初始化 SQLite，确保历史记录持久化
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
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
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_clipboard_history,
            upsert_clipboard_item,
            update_clipboard_item_text,
            set_clipboard_item_pinned,
            delete_clipboard_item,
            clear_clipboard_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
