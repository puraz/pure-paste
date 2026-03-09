// 统一管理关键常量，避免散落在多个文件中难以对齐与修改。

// 剪贴板历史保留天数：前端用来过滤过期条目，避免超出时间范围的数据继续显示
export const HISTORY_RETENTION_DAYS = 7;
// 详情编辑保存节流间隔，避免每次键入都触发数据库写入
export const DETAIL_SAVE_DELAY = 600;
