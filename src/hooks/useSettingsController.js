import { useCallback, useEffect, useMemo, useState } from "react";
import { buildShortcutFromEvent } from "../lib/shortcut";
import { useErrorMessage } from "./useErrorMessage";
import { getClipboardMonitoring, setClipboardMonitoring } from "../tauri/clipboardCommands";
import {
  getAutostartStatus,
  getOpenWindowShortcut,
  setAutostartEnabled,
  setOpenWindowShortcut,
} from "../tauri/settingsCommands";

// 设置窗口 controller：只聚焦“设置项状态 + 与系统/后端同步”，让视图组件保持纯 UI 拼装。

export const useSettingsController = () => {
  const { errorMessage, runAction } = useErrorMessage();

  // 是否开启剪贴板监听（后台守护任务）
  const [isMonitoring, setIsMonitoring] = useState(true);
  // 记录监听状态是否已读取完成，避免首次进入时覆盖后台状态
  const [isMonitoringReady, setIsMonitoringReady] = useState(false);
  // 记录系统开机自启动状态，供设置页开关展示
  const [autostartEnabled, setAutostartEnabledState] = useState(false);
  // 记录开机自启动读取/切换过程，避免频繁点击导致状态错乱
  const [isAutostartLoading, setIsAutostartLoading] = useState(false);
  // 打开剪贴板窗口的快捷键配置，供设置页展示和编辑
  const [openWindowShortcut, setOpenWindowShortcutState] = useState("");
  // 设置页正在编辑的快捷键草稿，避免输入中覆盖已保存值
  const [shortcutDraft, setShortcutDraft] = useState("");
  // 快捷键配置加载状态，避免重复点击导致状态错乱
  const [isShortcutLoading, setIsShortcutLoading] = useState(false);
  // 快捷键保存过程状态，用于按钮禁用与文案反馈
  const [isShortcutSaving, setIsShortcutSaving] = useState(false);
  // 是否处于快捷键录制模式，录制时拦截下一次按键组合
  const [isShortcutRecording, setIsShortcutRecording] = useState(false);

  const shortcutDisplay = useMemo(
    () => openWindowShortcut || "未设置",
    [openWindowShortcut],
  );
  const shortcutDirty = useMemo(
    () => shortcutDraft.trim() !== openWindowShortcut,
    [openWindowShortcut, shortcutDraft],
  );

  // 仅加载监听状态，供设置窗口初始化使用
  const loadMonitoringStatus = useCallback(async () => {
    const monitoring = await runAction(() => getClipboardMonitoring());
    if (typeof monitoring === "boolean") {
      setIsMonitoring(monitoring);
    }
    setIsMonitoringReady(true);
  }, [runAction]);

  // 读取系统开机自启动状态，保证设置页开关与真实状态一致
  const loadAutostartStatus = useCallback(async () => {
    setIsAutostartLoading(true);
    const enabled = await runAction(() => getAutostartStatus());
    if (typeof enabled === "boolean") {
      setAutostartEnabledState(Boolean(enabled));
    }
    setIsAutostartLoading(false);
  }, [runAction]);

  // 读取打开剪贴板窗口的快捷键设置，供设置页初始化展示
  const loadOpenWindowShortcut = useCallback(async () => {
    setIsShortcutLoading(true);
    const shortcut = await runAction(() => getOpenWindowShortcut());
    if (shortcut !== undefined) {
      const value = shortcut ? String(shortcut) : "";
      setOpenWindowShortcutState(value);
      setShortcutDraft(value);
    }
    setIsShortcutLoading(false);
  }, [runAction]);

  // 保存快捷键设置，并同步刷新已生效的快捷键文案
  const handleShortcutSave = useCallback(async () => {
    const normalized = shortcutDraft.trim();
    setIsShortcutSaving(true);
    const saved = await runAction(() =>
      setOpenWindowShortcut(normalized ? normalized : null),
    );
    if (saved !== undefined) {
      const value = saved ? String(saved) : "";
      setOpenWindowShortcutState(value);
      setShortcutDraft(value);
    }
    setIsShortcutSaving(false);
  }, [runAction, shortcutDraft]);

  // 清空快捷键设置，取消全局快捷键占用
  const handleShortcutClear = useCallback(async () => {
    setIsShortcutSaving(true);
    const saved = await runAction(() => setOpenWindowShortcut(null));
    if (saved !== undefined) {
      const value = saved ? String(saved) : "";
      setOpenWindowShortcutState(value);
      setShortcutDraft(value);
    }
    setIsShortcutSaving(false);
  }, [runAction]);

  // 切换开机自启动开关，失败时回滚到之前状态
  const handleAutostartToggle = useCallback(
    async (event) => {
      const targetEnabled = event.target.checked;
      setAutostartEnabledState(targetEnabled);
      setIsAutostartLoading(true);
      const actual = await runAction(() => setAutostartEnabled(targetEnabled));
      if (typeof actual === "boolean") {
        setAutostartEnabledState(Boolean(actual));
      } else {
        // 调用失败时回滚 UI，保证与系统状态保持一致
        setAutostartEnabledState(!targetEnabled);
      }
      setIsAutostartLoading(false);
    },
    [runAction],
  );

  // 快捷键录制：监听下一次按键组合，并写入草稿
  useEffect(() => {
    if (!isShortcutRecording) {
      return;
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsShortcutRecording(false);
        return;
      }
      const shortcut = buildShortcutFromEvent(event);
      if (!shortcut) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setShortcutDraft(shortcut);
      setIsShortcutRecording(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isShortcutRecording]);

  // 将监听开关同步到后台，确保关闭窗口后仍遵循用户设置
  useEffect(() => {
    if (!isMonitoringReady) {
      return;
    }
    runAction(() => setClipboardMonitoring(isMonitoring));
  }, [isMonitoring, isMonitoringReady, runAction]);

  // 初始化读取：进入设置窗口后一次性读取各项配置
  useEffect(() => {
    loadMonitoringStatus();
    loadAutostartStatus();
    loadOpenWindowShortcut();
  }, [loadAutostartStatus, loadMonitoringStatus, loadOpenWindowShortcut]);

  return {
    errorMessage,
    isMonitoring,
    setIsMonitoring,
    isMonitoringReady,
    autostartEnabled,
    isAutostartLoading,
    handleAutostartToggle,
    openWindowShortcut,
    shortcutDraft,
    setShortcutDraft,
    isShortcutLoading,
    isShortcutSaving,
    isShortcutRecording,
    setIsShortcutRecording,
    shortcutDisplay,
    shortcutDirty,
    handleShortcutSave,
    handleShortcutClear,
  };
};

