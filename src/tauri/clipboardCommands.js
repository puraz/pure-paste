import { invokeCommand } from "./invoke";

/**
 * @typedef {import("../lib/types.js").ClipboardItem} ClipboardItem
 * @typedef {import("../lib/types.js").ClipboardUpsertPayload} ClipboardUpsertPayload
 * @typedef {import("../lib/types.js").ClipboardUpdateResult} ClipboardUpdateResult
 */

// 这里集中管理剪贴板相关的 Tauri commands，避免 command 字符串散落在业务代码中难以维护。

/**
 * 从 SQLite 读取历史记录并恢复到前端，避免重启后只剩一条记录。
 * @param {number} limit
 * @returns {Promise<ClipboardItem[]>}
 */
export const loadClipboardHistory = async (limit) =>
  invokeCommand("load_clipboard_history", { limit });

/**
 * 新增或更新历史记录：重复文本会提升排序并增加计数。
 * @param {ClipboardUpsertPayload} item
 * @param {number} maxItems
 * @returns {Promise<ClipboardItem>}
 */
export const upsertClipboardItem = async (item, maxItems) =>
  invokeCommand("upsert_clipboard_item", { item, maxItems });

/**
 * 更新条目文本，若与其他条目重复则触发合并。
 * @param {string} id
 * @param {string} text
 * @param {string} updatedAt
 * @returns {Promise<ClipboardUpdateResult>}
 */
export const updateClipboardItemText = async (id, text, updatedAt) =>
  invokeCommand("update_clipboard_item_text", { id, text, updatedAt });

/**
 * 切换固定状态，固定条目不会被上限清理。
 * @param {string} id
 * @param {boolean} pinned
 * @returns {Promise<ClipboardItem>}
 */
export const setClipboardItemPinned = async (id, pinned) =>
  invokeCommand("set_clipboard_item_pinned", { id, pinned });

/**
 * 删除单条记录。
 * @param {string} id
 * @returns {Promise<void>}
 */
export const deleteClipboardItem = async (id) =>
  invokeCommand("delete_clipboard_item", { id });

/**
 * 清空全部历史记录。
 * @returns {Promise<void>}
 */
export const clearClipboardHistory = async () => invokeCommand("clear_clipboard_history");

/**
 * 获取当前监听状态。
 * @returns {Promise<boolean>}
 */
export const getClipboardMonitoring = async () => invokeCommand("get_clipboard_monitoring");

/**
 * 切换后台剪贴板监听开关。
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export const setClipboardMonitoring = async (enabled) =>
  invokeCommand("set_clipboard_monitoring", { enabled });

/**
 * 标记下一次要跳过的剪贴板文本，避免应用自身写入被 watcher 重复计数。
 * @param {string} text
 * @returns {Promise<void>}
 */
export const markClipboardSkip = async (text) => invokeCommand("mark_clipboard_skip", { text });

