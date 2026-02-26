// 这里集中定义前后端共用的数据结构（JSDoc 形式），让纯 JS 项目也能获得接近类型系统的可读性与约束。
// 注意：字段命名与 Rust 端 serde(rename_all = "camelCase") 的结构保持一致，避免前后端字段错位。

/**
 * 剪贴板历史条目（前端渲染用结构）。
 * @typedef {Object} ClipboardItem
 * @property {string} id 条目唯一 id（UUID）。
 * @property {string} text 剪贴板文本内容。
 * @property {string} createdAt 创建时间（ISO-8601 字符串）。
 * @property {string} updatedAt 最近更新时间（ISO-8601 字符串）。
 * @property {boolean} pinned 是否固定（固定条目不会被上限清理）。
 * @property {number} count 命中/复制次数（用于快速识别常用内容）。
 */

/**
 * 新增/更新条目时发送到后端的 payload（后端会做去重与计数更新）。
 * @typedef {Object} ClipboardUpsertPayload
 * @property {string} id 条目 id（由前端生成，便于前端先行乐观更新）。
 * @property {string} text 文本内容。
 * @property {string} createdAt 创建时间（ISO-8601 字符串）。
 * @property {string} updatedAt 更新时间（ISO-8601 字符串）。
 */

/**
 * 编辑条目文本后的返回结果：可能发生“合并”（文本与其他条目重复）。
 * @typedef {Object} ClipboardUpdateResult
 * @property {ClipboardItem} item 合并/更新后的最终条目。
 * @property {string | null | undefined} mergedId 若发生合并，被删除的旧条目 id；否则为 null/undefined。
 */

/**
 * 后端监听剪贴板后广播给前端的事件 payload。
 * @typedef {Object} ClipboardBroadcastPayload
 * @property {ClipboardItem} item 新写入/更新后的条目。
 * @property {string | null | undefined} mergedId 若发生合并，被删除的旧条目 id；否则为 null/undefined。
 */

export {};

