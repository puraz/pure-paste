import { invokeCommand } from "./invoke";

// 这里集中管理设置相关的 Tauri commands，保证设置页的逻辑更聚焦、可读。

/**
 * 读取系统开机自启动状态。
 * @returns {Promise<boolean>}
 */
export const getAutostartStatus = async () => invokeCommand("get_autostart_status");

/**
 * 切换系统开机自启动状态，并返回实际结果避免前端与系统状态不一致。
 * @param {boolean} enabled
 * @returns {Promise<boolean>}
 */
export const setAutostartEnabled = async (enabled) =>
  invokeCommand("set_autostart_enabled", { enabled });

/**
 * 读取打开主窗口的快捷键配置。
 * @returns {Promise<string | null>}
 */
export const getOpenWindowShortcut = async () => invokeCommand("get_open_window_shortcut");

/**
 * 更新打开主窗口的快捷键配置（传 null 表示清空）。
 * @param {string | null} shortcut
 * @returns {Promise<string | null>}
 */
export const setOpenWindowShortcut = async (shortcut) =>
  invokeCommand("set_open_window_shortcut", { shortcut });

/**
 * 打开或聚焦设置窗口（由后端统一创建，避免前端多窗口逻辑分散）。
 * @returns {Promise<void>}
 */
export const openSettingsWindow = async () => invokeCommand("open_settings_window_command");

