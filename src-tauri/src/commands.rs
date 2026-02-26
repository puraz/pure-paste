use crate::db::{
    get_app_setting, map_row, set_app_setting, update_clipboard_item_text_internal,
    upsert_clipboard_item_internal,
};
use crate::models::{
    AppState, ClipboardItem, ClipboardUpdateResult, ClipboardUpsertPayload,
    OPEN_WINDOW_SHORTCUT_KEY,
};
use rusqlite::params;
use std::sync::atomic::Ordering;
use tauri::State;
use tauri_plugin_autostart::ManagerExt;

// 命令层（commands.rs）：这里只做“参数校验 + 状态读写 + 调用 db/desktop 模块”。
// 这样可以避免所有逻辑都挤在 lib.rs 里，同时也让未来新增命令更直观。

// 启动时读取历史记录，供前端渲染并恢复状态
#[tauri::command]
pub fn load_clipboard_history(
    state: State<AppState>,
    limit: i64,
) -> Result<Vec<ClipboardItem>, String> {
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

// 前端或后台调用的命令入口，实际逻辑由内部函数统一处理
#[tauri::command]
pub fn upsert_clipboard_item(
    state: State<AppState>,
    item: ClipboardUpsertPayload,
    max_items: i64,
) -> Result<ClipboardItem, String> {
    upsert_clipboard_item_internal(&state, item, max_items)
}

// 更新条目文本，若文本重复则合并计数并删除旧条目
#[tauri::command]
pub fn update_clipboard_item_text(
    state: State<AppState>,
    id: String,
    text: String,
    updated_at: String,
) -> Result<ClipboardUpdateResult, String> {
    update_clipboard_item_text_internal(&state, id, text, updated_at)
}

// 切换条目固定状态：固定条目会在列表中置顶，并且不会被“历史上限清理”规则删除
#[tauri::command]
pub fn set_clipboard_item_pinned(
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

// 删除单条记录：后端删除后不返回数据，前端只需同步移除即可
#[tauri::command]
pub fn delete_clipboard_item(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|_| "数据库连接被占用，无法删除条目".to_string())?;
    conn.execute("DELETE FROM clipboard_items WHERE id = ?1", params![id])
        .map_err(|err| err.to_string())?;
    Ok(())
}

// 清空全部历史记录：用于“清空历史”按钮对应操作
#[tauri::command]
pub fn clear_clipboard_history(state: State<AppState>) -> Result<(), String> {
    let conn = state
        .db
        .lock()
        .map_err(|_| "数据库连接被占用，无法清空历史记录".to_string())?;
    conn.execute("DELETE FROM clipboard_items", [])
        .map_err(|err| err.to_string())?;
    Ok(())
}

// 切换后台剪贴板监听开关：该开关只影响 watcher 是否持续轮询剪贴板，不影响已保存的历史记录
#[tauri::command]
pub fn set_clipboard_monitoring(state: State<AppState>, enabled: bool) -> Result<(), String> {
    state.monitoring_enabled.store(enabled, Ordering::Relaxed);
    Ok(())
}

// 获取当前监听状态：供设置页初始化时对齐开关状态
#[tauri::command]
pub fn get_clipboard_monitoring(state: State<AppState>) -> Result<bool, String> {
    Ok(state.monitoring_enabled.load(Ordering::Relaxed))
}

// 标记下一次要跳过的剪贴板文本：防止应用自身写入导致后台 watcher 重复计数
#[tauri::command]
pub fn mark_clipboard_skip(state: State<AppState>, text: String) -> Result<(), String> {
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

// 获取当前系统开机自启动状态：供设置页初始化使用
#[tauri::command]
pub fn get_autostart_status(app: tauri::AppHandle) -> Result<bool, String> {
    let manager = app.autolaunch();
    manager.is_enabled().map_err(|err| err.to_string())
}

// 切换系统开机自启动状态：返回实际结果，避免前端显示与系统真实状态不一致
#[tauri::command]
pub fn set_autostart_enabled(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|err| err.to_string())?;
    } else {
        manager.disable().map_err(|err| err.to_string())?;
    }
    manager.is_enabled().map_err(|err| err.to_string())
}

// 读取打开主窗口的快捷键设置：供设置页初始化展示
#[tauri::command]
pub fn get_open_window_shortcut(state: State<AppState>) -> Result<Option<String>, String> {
    let conn = state
        .db
        .lock()
        .map_err(|_| "数据库连接被占用，无法读取快捷键设置".to_string())?;
    get_app_setting(&conn, OPEN_WINDOW_SHORTCUT_KEY).map_err(|err| err.to_string())
}

// 更新打开主窗口的快捷键设置：同步更新数据库并注册/取消全局快捷键（desktop 下生效）
#[tauri::command]
pub fn set_open_window_shortcut(
    app: tauri::AppHandle,
    state: State<AppState>,
    shortcut: Option<String>,
) -> Result<Option<String>, String> {
    let normalized = shortcut
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let previous = {
        let conn = state
            .db
            .lock()
            .map_err(|_| "数据库连接被占用，无法读取快捷键设置".to_string())?;
        get_app_setting(&conn, OPEN_WINDOW_SHORTCUT_KEY).map_err(|err| err.to_string())?
    };
    if previous == normalized {
        return Ok(normalized);
    }
    #[cfg(desktop)]
    {
        crate::desktop::update_open_window_shortcut(
            &app,
            previous.as_deref(),
            normalized.as_deref(),
        )?;
    }
    {
        let conn = state
            .db
            .lock()
            .map_err(|_| "数据库连接被占用，无法写入快捷键设置".to_string())?;
        set_app_setting(&conn, OPEN_WINDOW_SHORTCUT_KEY, normalized.clone())
            .map_err(|err| err.to_string())?;
    }
    Ok(normalized)
}

// 打开设置窗口：由后端统一创建/复用窗口，避免前端重复实现多窗口逻辑
#[tauri::command]
pub fn open_settings_window_command(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        crate::desktop::open_settings_window(&app);
    }
    Ok(())
}
