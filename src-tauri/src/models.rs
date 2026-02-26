use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::{atomic::AtomicBool, Mutex};
use uuid::Uuid;

// 与前端保持一致的历史记录上限，避免后台监听撑爆数据库
pub(crate) const MAX_HISTORY: i64 = 80;
// 后台轮询间隔，兼顾响应速度与 CPU 占用
pub(crate) const CLIPBOARD_POLL_INTERVAL_MS: u64 = 900;
// 快捷键配置在数据库中对应的键名，统一集中管理
pub(crate) const OPEN_WINDOW_SHORTCUT_KEY: &str = "open_window_shortcut";

// 剪贴板历史记录的数据结构，字段与前端状态保持一致
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardItem {
    pub(crate) id: String,
    pub(crate) text: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) pinned: bool,
    pub(crate) count: i64,
}

// 前端传入的新增/更新数据，用于执行去重写入与计数更新
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardUpsertPayload {
    pub(crate) id: String,
    pub(crate) text: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

// 文本编辑可能触发合并，返回合并后的条目以及被移除的条目 id
#[derive(Debug, Serialize)]
pub(crate) struct ClipboardUpdateResult {
    pub(crate) item: ClipboardItem,
    #[serde(rename = "mergedId")]
    pub(crate) merged_id: Option<String>,
}

// 后台监听写入后广播给前端的结构，保持字段命名一致便于直接复用
#[derive(Debug, Clone, Serialize)]
pub(crate) struct ClipboardBroadcastPayload {
    pub(crate) item: ClipboardItem,
    #[serde(rename = "mergedId")]
    pub(crate) merged_id: Option<String>,
}

// 统一持有数据库连接与运行时状态，避免每次调用命令都反复打开文件导致性能抖动
pub(crate) struct AppState {
    // SQLite 连接在多个命令间共享，避免频繁打开文件
    pub(crate) db: Mutex<Connection>,
    // 是否启用后台剪贴板监听，可由前端随时切换
    pub(crate) monitoring_enabled: AtomicBool,
    // 记录后台上一次处理过的剪贴板文本，用于去重
    pub(crate) last_clipboard_text: Mutex<Option<String>>,
    // 标记下一次需要跳过的剪贴板文本，避免应用自身写入导致重复计数
    pub(crate) skip_next_text: Mutex<Option<String>>,
    // 仅允许通过托盘菜单退出应用，其他退出请求需要被拦截
    pub(crate) allow_exit: AtomicBool,
}

// 生成当前时间的 ISO-8601 字符串，前后端统一使用字符串存储时间
pub(crate) fn now_iso_string() -> String {
    Utc::now().to_rfc3339()
}

// 构造用于写入数据库的剪贴板条目，确保字段完整且格式一致
pub(crate) fn build_clipboard_payload(text: String) -> ClipboardUpsertPayload {
    let now = now_iso_string();
    ClipboardUpsertPayload {
        id: Uuid::new_v4().to_string(),
        text,
        created_at: now.clone(),
        updated_at: now,
    }
}
