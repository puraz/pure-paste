use crate::models::{AppState, ClipboardItem, ClipboardUpdateResult, ClipboardUpsertPayload};
use rusqlite::{params, Connection, OptionalExtension};

// 统一执行表结构初始化，保证首次启动即可持久化
pub(crate) fn init_db(conn: &Connection) -> Result<(), rusqlite::Error> {
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
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )?;
    Ok(())
}

// 读取通用配置项，找不到时返回 None
pub(crate) fn get_app_setting(
    conn: &Connection,
    key: &str,
) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
}

// 写入通用配置项，value 为空时删除对应配置
pub(crate) fn set_app_setting(
    conn: &Connection,
    key: &str,
    value: Option<String>,
) -> Result<(), rusqlite::Error> {
    if let Some(value) = value {
        conn.execute(
            "
            INSERT INTO app_settings (key, value)
            VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![key, value],
        )?;
    } else {
        conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])?;
    }
    Ok(())
}

// 将 SQLite 行数据映射成前端可用的结构
pub(crate) fn map_row(row: &rusqlite::Row) -> Result<ClipboardItem, rusqlite::Error> {
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
pub(crate) fn prune_history(
    tx: &rusqlite::Transaction,
    max_items: i64,
) -> Result<(), rusqlite::Error> {
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

// 新增或更新历史记录，遇到重复文本时只更新计数与更新时间
pub(crate) fn upsert_clipboard_item_internal(
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
                Ok((row.get(0)?, row.get(1)?, pinned_value != 0, row.get(3)?))
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
pub(crate) fn update_clipboard_item_text_internal(
    state: &AppState,
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
                Ok((row.get(0)?, row.get(1)?, pinned_value != 0, row.get(3)?))
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
                Ok((row.get(0)?, row.get(1)?, pinned_value != 0, row.get(3)?))
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
