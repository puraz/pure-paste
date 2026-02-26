import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Switch,
  SvgIcon,
  TextField,
  Snackbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

// 控制历史记录上限，避免长期运行导致内存压力过大
const MAX_HISTORY = 80;
// 详情编辑保存节流间隔，避免每次键入都触发数据库写入
const DETAIL_SAVE_DELAY = 600;
// 轻量复制图标，避免额外引入图标依赖包导致构建体积变大
const CopyIcon = (props) => (
  <SvgIcon {...props} viewBox="0 0 24 24">
    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
  </SvgIcon>
);
// 标准化链接地址，只接受完整 http/https，返回 null 表示无效
const normalizeHttpUrl = (value) => {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
};

// 将用户按键组合转为 Tauri 2.x 可识别的快捷键格式
const buildShortcutFromEvent = (event) => {
  const rawKey = event.key;
  if (rawKey === "Shift" || rawKey === "Control" || rawKey === "Alt" || rawKey === "Meta") {
    return "";
  }
  let keyLabel = "";
  if (rawKey === " ") {
    keyLabel = "Space";
  } else if (rawKey.length === 1) {
    keyLabel = rawKey.toUpperCase();
  } else {
    keyLabel = rawKey;
  }
  const parts = [];
  if (event.metaKey) {
    parts.push("Command");
  }
  if (event.ctrlKey) {
    parts.push("Ctrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  parts.push(keyLabel);
  return parts.join("+");
};

function App() {
  // 剪贴板历史列表，包含内容、时间、固定状态与命中次数等元信息
  const [items, setItems] = useState([]);
  // 当前选中条目的 id，用于右侧详情面板展示
  const [selectedId, setSelectedId] = useState("");
  // 搜索输入，用于过滤历史列表
  const [query, setQuery] = useState("");
  // 是否开启剪贴板监听（后台守护任务）
  const [isMonitoring, setIsMonitoring] = useState(true);
  // 手动写入剪贴板的输入内容
  const [draft, setDraft] = useState("");
  // 最近一次错误信息，便于排查权限或系统剪贴板异常
  const [errorMessage, setErrorMessage] = useState("");
  // 记录用户准备执行的清空动作类型，用于控制确认弹窗内容
  const [confirmAction, setConfirmAction] = useState("");
  // 控制确认弹窗是否显示，避免关闭动画期间文案闪动
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  // 控制复制成功提示的显示状态，避免频繁复制时提示残留
  const [isCopyToastOpen, setIsCopyToastOpen] = useState(false);
  // 记录系统开机自启动状态，供设置页开关展示
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  // 记录开机自启动读取/切换过程，避免频繁点击导致状态错乱
  const [isAutostartLoading, setIsAutostartLoading] = useState(false);
  // 记录监听状态是否已读取完成，避免首次进入时覆盖后台状态
  const [isMonitoringReady, setIsMonitoringReady] = useState(false);
  // 打开剪贴板窗口的快捷键配置，供设置页展示和编辑
  const [openWindowShortcut, setOpenWindowShortcut] = useState("");
  // 设置页正在编辑的快捷键草稿，避免输入中覆盖已保存值
  const [shortcutDraft, setShortcutDraft] = useState("");
  // 快捷键配置加载状态，避免重复点击导致状态错乱
  const [isShortcutLoading, setIsShortcutLoading] = useState(false);
  // 快捷键保存过程状态，用于按钮禁用与文案反馈
  const [isShortcutSaving, setIsShortcutSaving] = useState(false);
  // 是否处于快捷键录制模式，录制时拦截下一次按键组合
  const [isShortcutRecording, setIsShortcutRecording] = useState(false);
  // 搜索输入框引用，便于应用内快捷键聚焦
  const searchInputRef = useRef(null);
  // 基于主题断点判断当前窗口是否接近移动端形态，用于隐藏详情与写入区
  const theme = useTheme();
  const isCompactLayout = useMediaQuery(theme.breakpoints.down("sm"));

  // 识别当前窗口类型，用于区分主窗口与设置窗口渲染
  const isSettingsWindow = useMemo(() => {
    try {
      return getCurrentWindow().label === "settings";
    } catch {
      return false;
    }
  }, []);

  // 缓存详情编辑的保存计划，避免频繁写入数据库
  const detailSaveTimerRef = useRef(null);
  // 保存最新待提交的详情编辑内容，确保定时器触发时可获取最新值
  const pendingDetailRef = useRef({ id: "", text: "" });

  // 创建一条标准化的历史记录结构
  const buildItem = (text) => {
    const now = new Date();
    return {
      id: globalThis.crypto?.randomUUID?.() ?? `clip-${now.getTime()}`,
      text,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      pinned: false,
      count: 1,
    };
  };

  // 将数据库返回的数据合并回前端状态，保证去重并维持上限
  const applyPersistedItem = (nextItem, removedId) => {
    setItems((prev) => {
      const filtered = prev.filter((item) => {
        if (removedId && item.id === removedId) {
          return false;
        }
        if (item.id === nextItem.id) {
          return false;
        }
        if (item.text === nextItem.text && item.id !== nextItem.id) {
          return false;
        }
        return true;
      });
      return [nextItem, ...filtered].slice(0, MAX_HISTORY);
    });
  };

  // 将文本写入历史记录：存在则更新计数并提升到顶部，同时同步到数据库
  const upsertItem = async (text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const draftItem = buildItem(trimmed);
    setItems((prev) => {
      const existingIndex = prev.findIndex((item) => item.text === trimmed);
      if (existingIndex >= 0) {
        const now = new Date().toISOString();
        const existing = prev[existingIndex];
        const updated = {
          ...existing,
          updatedAt: now,
          count: existing.count + 1,
        };
        const rest = prev.filter((_, index) => index !== existingIndex);
        return [updated, ...rest].slice(0, MAX_HISTORY);
      }
      return [draftItem, ...prev].slice(0, MAX_HISTORY);
    });
    try {
      const persisted = await invoke("upsert_clipboard_item", {
        item: draftItem,
        maxItems: MAX_HISTORY,
      });
      applyPersistedItem(persisted, null);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    }
  };

  // 从 SQLite 读取历史记录并恢复到前端，避免重启后只剩一条记录
  const loadHistory = async () => {
    try {
      const [history, monitoring] = await Promise.all([
        invoke("load_clipboard_history", {
          limit: MAX_HISTORY,
        }),
        invoke("get_clipboard_monitoring"),
      ]);
      setItems(history);
      if (typeof monitoring === "boolean") {
        setIsMonitoring(monitoring);
      }
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    } finally {
      setIsMonitoringReady(true);
    }
  };

  // 仅加载监听状态，供设置窗口初始化使用
  const loadMonitoringStatus = async () => {
    try {
      const monitoring = await invoke("get_clipboard_monitoring");
      if (typeof monitoring === "boolean") {
        setIsMonitoring(monitoring);
      }
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    } finally {
      setIsMonitoringReady(true);
    }
  };

  // 读取系统开机自启动状态，保证设置页开关与真实状态一致
  const loadAutostartStatus = async () => {
    setIsAutostartLoading(true);
    try {
      const enabled = await invoke("get_autostart_status");
      setAutostartEnabled(Boolean(enabled));
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    } finally {
      setIsAutostartLoading(false);
    }
  };

  // 读取打开剪贴板窗口的快捷键设置，供设置页初始化展示
  const loadOpenWindowShortcut = async () => {
    setIsShortcutLoading(true);
    try {
      const shortcut = await invoke("get_open_window_shortcut");
      const value = shortcut ? String(shortcut) : "";
      setOpenWindowShortcut(value);
      setShortcutDraft(value);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    } finally {
      setIsShortcutLoading(false);
    }
  };

  // 保存快捷键设置，并同步刷新已生效的快捷键文案
  const handleShortcutSave = async () => {
    const normalized = shortcutDraft.trim();
    setIsShortcutSaving(true);
    try {
      const saved = await invoke("set_open_window_shortcut", {
        shortcut: normalized ? normalized : null,
      });
      const value = saved ? String(saved) : "";
      setOpenWindowShortcut(value);
      setShortcutDraft(value);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    } finally {
      setIsShortcutSaving(false);
    }
  };

  // 清空快捷键设置，取消全局快捷键占用
  const handleShortcutClear = async () => {
    setIsShortcutSaving(true);
    try {
      const saved = await invoke("set_open_window_shortcut", { shortcut: null });
      const value = saved ? String(saved) : "";
      setOpenWindowShortcut(value);
      setShortcutDraft(value);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    } finally {
      setIsShortcutSaving(false);
    }
  };

  // 切换开机自启动开关，失败时回滚到之前状态
  const handleAutostartToggle = async (event) => {
    const targetEnabled = event.target.checked;
    setAutostartEnabled(targetEnabled);
    setIsAutostartLoading(true);
    try {
      const actual = await invoke("set_autostart_enabled", {
        enabled: targetEnabled,
      });
      setAutostartEnabled(Boolean(actual));
      setErrorMessage("");
    } catch (error) {
      setAutostartEnabled(!targetEnabled);
      setErrorMessage(error?.message ?? String(error));
    } finally {
      setIsAutostartLoading(false);
    }
  };

  // 打开设置窗口，供主窗口或托盘入口复用
  const openSettingsWindow = async () => {
    try {
      await invoke("open_settings_window_command");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    }
  };

  // 使用系统默认浏览器打开链接
  const handleOpenLink = async (url) => {
    if (!url) {
      return;
    }
    try {
      await openUrl(url);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    }
  };

  // 真正执行详情编辑写入，避免每次键入都触发 SQL
  const persistDetailChange = async (payload) => {
    if (!payload?.id) {
      return;
    }
    try {
      const result = await invoke("update_clipboard_item_text", {
        id: payload.id,
        text: payload.text,
        updatedAt: new Date().toISOString(),
      });
      applyPersistedItem(result.item, result.mergedId);
      pendingDetailRef.current = { id: result.item.id, text: result.item.text };
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    }
  };

  // 详情文本变更时做节流保存，减少数据库频繁写入
  const scheduleDetailPersist = (id, text) => {
    if (!id) {
      return;
    }
    pendingDetailRef.current = { id, text };
    if (detailSaveTimerRef.current) {
      clearTimeout(detailSaveTimerRef.current);
    }
    detailSaveTimerRef.current = setTimeout(() => {
      const payload = pendingDetailRef.current;
      persistDetailChange(payload);
    }, DETAIL_SAVE_DELAY);
  };

  // 在失焦或切换条目前强制保存最后一次编辑，避免数据丢失
  const flushDetailPersist = () => {
    if (detailSaveTimerRef.current) {
      clearTimeout(detailSaveTimerRef.current);
      detailSaveTimerRef.current = null;
    }
    const payload = pendingDetailRef.current;
    if (payload?.id) {
      persistDetailChange(payload);
    }
  };

  // 将选中条目复制回系统剪贴板，同时刷新本地排序与计数
  const handleCopy = async (item) => {
    if (!item) {
      return;
    }
    try {
      await writeText(item.text, { label: "pure-paster" });
      await invoke("mark_clipboard_skip", { text: item.text });
      await upsertItem(item.text);
      setIsCopyToastOpen(true);
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    }
  };

  // 手动将输入框内容写入系统剪贴板，并同步到历史记录
  const handleWrite = async () => {
    if (!draft.trim()) {
      return;
    }
    try {
      await writeText(draft.trim(), { label: "pure-paster" });
      await invoke("mark_clipboard_skip", { text: draft.trim() });
      await upsertItem(draft.trim());
      setDraft("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    }
  };

  // 清空本地历史列表，不影响系统剪贴板内容
  const handleClearHistory = async () => {
    setItems([]);
    setSelectedId("");
    pendingDetailRef.current = { id: "", text: "" };
    if (detailSaveTimerRef.current) {
      clearTimeout(detailSaveTimerRef.current);
      detailSaveTimerRef.current = null;
    }
    try {
      await invoke("clear_clipboard_history");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    }
  };

  // 请求清空动作时先弹出确认提示，避免误触直接清空
  const requestClear = (type) => {
    setConfirmAction(type);
    setIsConfirmOpen(true);
  };

  // 关闭确认弹窗，不执行清空
  const cancelClear = () => {
    setIsConfirmOpen(false);
  };

  // 用户确认后执行对应的清空动作
  const confirmClear = async () => {
    const action = confirmAction;
    setIsConfirmOpen(false);
    if (action === "history") {
      await handleClearHistory();
      return;
    }
  };

  // 弹窗完全关闭后再清空动作类型，避免出现文本闪烁
  const handleConfirmExited = () => {
    setConfirmAction("");
  };

  // 应用启动时先加载数据库中的历史记录，避免初始化时覆盖新数据
  useEffect(() => {
    if (isSettingsWindow) {
      loadMonitoringStatus();
      loadAutostartStatus();
      loadOpenWindowShortcut();
      return;
    }
    loadHistory();
    return () => {
      if (detailSaveTimerRef.current) {
        clearTimeout(detailSaveTimerRef.current);
      }
    };
  }, [isSettingsWindow]);

  // 监听应用内快捷键，Mac 使用 Command+F，其它平台使用 Ctrl+F
  useEffect(() => {
    if (isSettingsWindow) {
      return;
    }
    const isMac = navigator.platform?.toLowerCase().includes("mac");
    const handleKeyDown = (event) => {
      const target = event.target;
      // 当前聚焦在可编辑控件时不触发快捷键，避免打断输入
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.getAttribute("role") === "textbox")
      ) {
        return;
      }
      const key = event.key?.toLowerCase();
      if (key !== "f") {
        return;
      }
      const isTrigger = isMac ? event.metaKey : event.ctrlKey;
      if (!isTrigger) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (searchInputRef.current) {
        searchInputRef.current.focus();
        searchInputRef.current.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSettingsWindow]);

  // 设置页快捷键录制时监听全局按键，捕获组合键并写入草稿
  useEffect(() => {
    if (!isSettingsWindow || !isShortcutRecording) {
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
  }, [isSettingsWindow, isShortcutRecording]);

  // 监听后台推送的剪贴板更新事件，保证窗口打开时实时刷新列表
  useEffect(() => {
    if (isSettingsWindow) {
      return;
    }
    let unlisten = null;
    const registerListener = async () => {
      try {
        unlisten = await listen("clipboard-updated", (event) => {
          const payload = event.payload;
          if (!payload?.item) {
            return;
          }
          applyPersistedItem(payload.item, payload.mergedId ?? null);
        });
      } catch (error) {
        setErrorMessage(error?.message ?? String(error));
      }
    };
    registerListener();
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [isSettingsWindow]);

  // 将监听开关同步到后台，确保关闭窗口后仍遵循用户设置
  useEffect(() => {
    if (!isMonitoringReady) {
      return;
    }
    invoke("set_clipboard_monitoring", { enabled: isMonitoring }).catch((error) => {
      setErrorMessage(error?.message ?? String(error));
    });
  }, [isMonitoring, isMonitoringReady]);

  // 更新详情文本内容，直接同步到历史列表中
  const handleDetailChange = (event) => {
    if (!selectedId) {
      return;
    }
    const nextText = event.target.value;
    setItems((prev) =>
      prev.map((entry) =>
        entry.id === selectedId ? { ...entry, text: nextText } : entry,
      ),
    );
    scheduleDetailPersist(selectedId, nextText);
  };

  // 切换条目固定状态，用于置顶常用内容
  const togglePin = async (item) => {
    if (!item) {
      return;
    }
    const nextPinned = !item.pinned;
    setItems((prev) =>
      prev.map((entry) =>
        entry.id === item.id ? { ...entry, pinned: nextPinned } : entry,
      ),
    );
    try {
      const persisted = await invoke("set_clipboard_item_pinned", {
        id: item.id,
        pinned: nextPinned,
      });
      applyPersistedItem(persisted, null);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    }
  };

  // 删除单条记录，并修正选中项避免悬空
  const removeItem = async (item) => {
    if (!item) {
      return;
    }
    setItems((prev) => prev.filter((entry) => entry.id !== item.id));
    if (pendingDetailRef.current.id === item.id) {
      pendingDetailRef.current = { id: "", text: "" };
    }
    try {
      await invoke("delete_clipboard_item", { id: item.id });
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    }
  };

  // 根据搜索词过滤并排序：固定条目优先，其次按更新时间倒序
  const visibleItems = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = keyword
      ? items.filter((item) => item.text.toLowerCase().includes(keyword))
      : items;
    return [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [items, query]);

  // 当列表变化时自动校准当前选中项
  useEffect(() => {
    if (!visibleItems.length) {
      setSelectedId("");
      return;
    }
    if (!selectedId || !visibleItems.some((item) => item.id === selectedId)) {
      setSelectedId(visibleItems[0].id);
    }
  }, [visibleItems, selectedId]);

  const selectedItem = visibleItems.find((item) => item.id === selectedId) ?? null;
  // 仅当选中条目是完整链接时返回标准化地址，便于控制按钮状态
  const selectedItemUrl = selectedItem ? normalizeHttpUrl(selectedItem.text) : null;
  const canOpenLink = Boolean(selectedItemUrl);
  const pinnedCount = items.filter((item) => item.pinned).length;
  const shortcutDisplay = openWindowShortcut || "未设置";
  const shortcutDirty = shortcutDraft.trim() !== openWindowShortcut;

  return (
    <Box
      sx={{
        // 固定为视口高度，避免内容撑大导致页面滚动
        height: "100vh",
        bgcolor: "background.default",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "stretch",
        // 上下左右边距保持一致，确保卡片与窗口四边等距
        p: 2,
        boxSizing: "border-box",
        // 禁止页面滚动，把滚动限制在卡片内部
        overflow: "hidden",
      }}
    >
      <Container
        maxWidth={false}
        disableGutters
        sx={{
          // 继承外层尺寸，确保卡片只占用窗口内可视区域
          width: "100%",
          height: "100%",
        }}
      >
        <Paper
          elevation={0}
          sx={{
            // 继承容器宽高，让卡片与窗口四边保持等距
            width: "100%",
            height: "100%",
            p: { xs: 1.5, md: 2 },
            borderRadius: 2,
            border: "1px solid rgba(15, 23, 42, 0.08)",
            boxShadow: "0 16px 40px rgba(15, 23, 42, 0.08)",
            backgroundColor: "rgba(255, 255, 255, 0.96)",
            // 使用纵向布局，方便把可滚动区域限制在卡片内部
            display: "flex",
            flexDirection: "column",
            // 避免内容溢出把卡片撑高
            overflow: "hidden",
          }}
        >
          {isSettingsWindow ? (
            <Stack
              spacing={1.5}
              sx={{
                // 设置页同样占满卡片可用高度，避免布局跳动
                flex: 1,
                minHeight: 0,
                // 设置内容可滚动，避免窗口高度不足时遮挡底部配置
                overflowY: "auto",
              }}
            >
              {errorMessage ? (
                <Alert severity="error">操作失败：{errorMessage}</Alert>
              ) : null}

              {/* 开机自启动开关区域，便于用户理解系统级行为 */}
              <Paper
                variant="outlined"
                sx={{
                  p: 1.5,
                  borderRadius: 1.5,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      开机自启动
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      应用随系统启动自动运行
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Switch
                      size="small"
                      checked={autostartEnabled}
                      onChange={handleAutostartToggle}
                      color="secondary"
                      disabled={isAutostartLoading}
                    />
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      {isAutostartLoading
                        ? "读取中..."
                        : autostartEnabled
                          ? "已开启"
                          : "已关闭"}
                    </Typography>
                  </Stack>
                </Stack>
              </Paper>

              {/* 打开剪贴板窗口快捷键设置，方便用户快速唤起主窗口 */}
              <Paper
                variant="outlined"
                sx={{
                  p: 1.5,
                  borderRadius: 1.5,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}
              >
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  spacing={1}
                  alignItems={{ xs: "flex-start", md: "center" }}
                  justifyContent="space-between"
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      打开剪贴板快捷键
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      设置后可在任意界面快速唤起剪贴板窗口
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() =>
                        setIsShortcutRecording((prev) => !prev)
                      }
                      disabled={isShortcutLoading || isShortcutSaving}
                    >
                      {isShortcutRecording ? "等待按键..." : "录制"}
                    </Button>
                    <Button
                      variant="contained"
                      size="small"
                      onClick={handleShortcutSave}
                      disabled={
                        isShortcutLoading || isShortcutSaving || !shortcutDirty
                      }
                    >
                      保存
                    </Button>
                    <Button
                      variant="text"
                      size="small"
                      color="secondary"
                      onClick={handleShortcutClear}
                      disabled={
                        isShortcutLoading ||
                        isShortcutSaving ||
                        (!shortcutDraft && !openWindowShortcut)
                      }
                    >
                      清空
                    </Button>
                  </Stack>
                </Stack>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="例如：Ctrl+Shift+V 或 Command+Shift+V"
                  value={shortcutDraft}
                  onChange={(event) => setShortcutDraft(event.target.value)}
                  disabled={isShortcutLoading || isShortcutSaving}
                  helperText={
                    isShortcutRecording
                      ? "请直接按下组合键，按 Esc 取消录制"
                      : `当前生效：${shortcutDisplay}`
                  }
                />
              </Paper>

              {/* 剪贴板监听开关，控制后台是否持续记录 */}
              <Paper
                variant="outlined"
                sx={{
                  p: 1.5,
                  borderRadius: 1.5,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      剪贴板监听
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      关闭后将不再自动记录剪贴板
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Switch
                      size="small"
                      checked={isMonitoring}
                      onChange={(event) => setIsMonitoring(event.target.checked)}
                      color="secondary"
                      disabled={!isMonitoringReady}
                    />
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      {isMonitoringReady ? (isMonitoring ? "已开启" : "已关闭") : "读取中..."}
                    </Typography>
                  </Stack>
                </Stack>
              </Paper>
            </Stack>
          ) : (
            <Stack
              spacing={1.5}
              sx={{
                // 允许子区域在固定高度内收缩，并把滚动限制在内部
                flex: 1,
                minHeight: 0,
              }}
            >
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={1.5}
                alignItems={{ xs: "stretch", md: "center" }}
                justifyContent="space-between"
              >
                {/* 移动端形态下压缩纵向空间：搜索一行，操作一行 */}
                {isCompactLayout ? (
                  <Stack direction="column" spacing={0.75} sx={{ width: "100%" }}>
                    <TextField
                      size="small"
                      placeholder="搜索"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      inputRef={searchInputRef}
                      fullWidth
                    />
                    <Stack
                      direction="row"
                      spacing={0.75}
                      alignItems="center"
                      flexWrap="wrap"
                      sx={{ width: "100%" }}
                    >
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => requestClear("history")}
                        sx={{ px: 1.25, minWidth: 0 }}
                      >
                        清空历史
                      </Button>
                      <Button
                        variant="text"
                        size="small"
                        onClick={openSettingsWindow}
                        sx={{ px: 1.25, minWidth: 0 }}
                      >
                        设置
                      </Button>
                    </Stack>
                  </Stack>
                ) : (
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <TextField
                      size="small"
                      placeholder="搜索"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      inputRef={searchInputRef}
                    />
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => requestClear("history")}
                    >
                      清空历史
                    </Button>
                    <Button variant="text" size="small" onClick={openSettingsWindow}>
                      设置
                    </Button>
                  </Stack>
                )}
              </Stack>

              {errorMessage ? (
                <Alert severity="error">操作失败：{errorMessage}</Alert>
              ) : null}

              <Divider />

              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={1.5}
                sx={{
                  // 主内容区占满剩余高度，左右面板保持同高
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <Paper
                  variant="outlined"
                  sx={{
                    width: { xs: "100%", md: 320 },
                    borderRadius: 1.5,
                    display: "flex",
                    flexDirection: "column",
                    // 让左侧面板在固定卡片内填满高度
                    minHeight: 0,
                  }}
                >
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    sx={{ px: 2, py: 1.5 }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      历史
                    </Typography>
                    {/* 用极简数字展示条目总数，减少横向占用 */}
                    <Typography
                      variant="caption"
                      sx={{ color: "text.secondary", fontWeight: 600 }}
                    >
                      {items.length}
                    </Typography>
                  </Stack>
                  <Divider />
                  <Box
                    sx={{
                      // 历史列表高度固定为面板剩余空间，内容过多时内部滚动
                      flex: 1,
                      minHeight: 0,
                      overflowY: "auto",
                    }}
                  >
                    {visibleItems.length ? (
                      <List dense disablePadding>
                        {visibleItems.map((item) => {
                          const isSelected = item.id === selectedId;
                          return (
                            <ListItemButton
                              key={item.id}
                              selected={isSelected}
                              onClick={() => setSelectedId(item.id)}
                              sx={{
                                alignItems: "flex-start",
                                borderBottom: "1px solid rgba(15, 23, 42, 0.06)",
                              }}
                            >
                              <ListItemText
                                primary={item.text}
                                secondary={`${new Intl.DateTimeFormat("zh-CN", {
                                  month: "2-digit",
                                  day: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }).format(new Date(item.updatedAt))}${
                                  item.count > 1 ? ` · ${item.count} 次` : ""
                                }`}
                                primaryTypographyProps={{
                                  noWrap: true,
                                  sx: { fontWeight: 500 },
                                }}
                                secondaryTypographyProps={{
                                  variant: "caption",
                                  sx: { color: "text.secondary" },
                                }}
                                sx={{ mr: 1 }}
                              />
                              <Stack direction="row" spacing={0.5} alignItems="center">
                                {item.pinned ? (
                                  <Chip label="固定" size="small" color="secondary" />
                                ) : null}
                                {/* 列表条目提供快捷复制入口，避免进入详情区操作 */}
                                <IconButton
                                  size="small"
                                  aria-label="复制"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleCopy(item);
                                  }}
                                >
                                  <CopyIcon fontSize="small" />
                                </IconButton>
                              </Stack>
                            </ListItemButton>
                          );
                        })}
                      </List>
                    ) : (
                      <Typography
                        variant="body2"
                        sx={{ color: "text.secondary", px: 2, py: 3 }}
                      >
                        暂无内容
                      </Typography>
                    )}
                  </Box>
                </Paper>

                {/* 移动端形态下隐藏详情与写入区，避免空间拥挤 */}
                {isCompactLayout ? null : (
                  <Paper
                    variant="outlined"
                    sx={{
                      flex: 1,
                      p: 1.5,
                      borderRadius: 1.5,
                      display: "flex",
                      flexDirection: "column",
                      gap: 1.5,
                      // 右侧详情区同样限制在固定高度内，必要时内部滚动
                      minHeight: 0,
                      overflowY: "auto",
                    }}
                  >
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        详情
                      </Typography>
                      {selectedItem?.pinned ? (
                        <Chip label="已固定" size="small" color="secondary" />
                      ) : null}
                    </Stack>
                    <TextField
                      size="small"
                      multiline
                      minRows={6}
                      placeholder="请选择条目"
                      value={selectedItem?.text ?? ""}
                      onChange={handleDetailChange}
                      onBlur={flushDetailPersist}
                      disabled={!selectedItem}
                    />
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() => handleCopy(selectedItem)}
                        disabled={!selectedItem}
                      >
                        复制
                      </Button>
                      {/* 仅当当前内容是可识别链接时才显示打开入口，避免无效操作 */}
                      {canOpenLink ? (
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => handleOpenLink(selectedItemUrl)}
                        >
                          打开链接
                        </Button>
                      ) : null}
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => togglePin(selectedItem)}
                        disabled={!selectedItem}
                      >
                        {selectedItem?.pinned ? "取消固定" : "固定"}
                      </Button>
                      <Button
                        variant="text"
                        color="secondary"
                        size="small"
                        onClick={() => removeItem(selectedItem)}
                        disabled={!selectedItem}
                      >
                        删除
                      </Button>
                    </Stack>

                    <Divider />

                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      写入
                    </Typography>
                    <TextField
                      size="small"
                      multiline
                      minRows={3}
                      placeholder="输入文本"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <Stack direction="row" spacing={1}>
                      <Button variant="contained" size="small" onClick={handleWrite}>
                        写入剪贴板
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => setDraft("")}
                        disabled={!draft}
                      >
                        清空
                      </Button>
                    </Stack>
                  </Paper>
                )}
              </Stack>
          </Stack>
          )}
        </Paper>
      </Container>
      {/* 清空操作的确认弹窗，避免误触造成数据丢失 */}
      <Dialog
        open={isConfirmOpen}
        onClose={cancelClear}
        TransitionProps={{ onExited: handleConfirmExited }}
      >
        <DialogTitle>确认清空</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要清空全部历史记录吗？此操作不可撤销。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={cancelClear}>
            取消
          </Button>
          <Button variant="contained" color="secondary" onClick={confirmClear}>
            确认清空
          </Button>
        </DialogActions>
      </Dialog>
      {/* 复制成功提示，短暂展示以提升反馈感知 */}
      <Snackbar
        open={isCopyToastOpen}
        autoHideDuration={1400}
        onClose={() => setIsCopyToastOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setIsCopyToastOpen(false)}
          sx={{ width: "100%" }}
        >
          复制成功
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default App;
