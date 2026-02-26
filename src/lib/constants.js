// 统一管理关键常量，避免散落在多个文件中难以对齐与修改。

// 控制历史记录上限，避免长期运行导致内存压力过大
export const MAX_HISTORY = 80;
// 详情编辑保存节流间隔，避免每次键入都触发数据库写入
export const DETAIL_SAVE_DELAY = 600;

