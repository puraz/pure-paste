import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DETAIL_SAVE_DELAY, MAX_HISTORY } from "../lib/constants";
import { normalizeHttpUrl } from "../lib/url";
import { useErrorMessage } from "./useErrorMessage";
import {
  clearClipboardHistory,
  deleteClipboardItem,
  loadClipboardHistory,
  markClipboardSkip,
  setClipboardItemPinned,
  updateClipboardItemText,
  upsertClipboardItem,
} from "../tauri/clipboardCommands";
import { openSettingsWindow as openSettingsWindowCommand } from "../tauri/settingsCommands";

/**
 * @typedef {import("../lib/types.js").ClipboardItem} ClipboardItem
 */

// 主窗口 controller：把“状态 + 副作用 + 与后端交互”集中到一个 hook 中，避免视图层过度堆积业务逻辑。
// 注意：这里不做复杂架构封装，只做“拆职责 + 去重复”，保持简单可维护。

export const useClipboardController = (options = {}) => {
  const maxHistory = options.maxHistory ?? MAX_HISTORY;
  const detailSaveDelay = options.detailSaveDelay ?? DETAIL_SAVE_DELAY;

  const { errorMessage, runAction } = useErrorMessage();

  // 剪贴板历史列表，包含内容、时间、固定状态与命中次数等元信息
  const [items, setItems] = useState(/** @type {ClipboardItem[]} */ ([]));
  // 当前选中条目的 id，用于右侧详情面板展示
  const [selectedId, setSelectedId] = useState("");
  // 搜索输入，用于过滤历史列表
  const [query, setQuery] = useState("");
  // 手动写入剪贴板的输入内容
  const [draft, setDraft] = useState("");
  // 记录用户准备执行的清空动作类型，用于控制确认弹窗内容
  const [confirmAction, setConfirmAction] = useState("");
  // 控制确认弹窗是否显示，避免关闭动画期间文案闪动
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  // 控制复制成功提示的显示状态，避免频繁复制时提示残留
  const [isCopyToastOpen, setIsCopyToastOpen] = useState(false);

  // 缓存详情编辑的保存计划，避免频繁写入数据库
  const detailSaveTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  // 保存最新待提交的详情编辑内容，确保定时器触发时可获取最新值
  const pendingDetailRef = useRef({ id: "", text: "" });

  // 创建一条标准化的历史记录结构（用于前端乐观更新）
  const buildItem = useCallback((text) => {
    const now = new Date();
    return {
      id: globalThis.crypto?.randomUUID?.() ?? `clip-${now.getTime()}`,
      text,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      pinned: false,
      count: 1,
    };
  }, []);

  // 将数据库返回的数据合并回前端状态，保证去重并维持上限
  const applyPersistedItem = useCallback(
    (nextItem, removedId) => {
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
        return [nextItem, ...filtered].slice(0, maxHistory);
      });
    },
    [maxHistory],
  );

  // 将文本写入历史记录：存在则更新计数并提升到顶部，同时同步到数据库
  const upsertItem = useCallback(
    async (text) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      const draftItem = buildItem(trimmed);

      // 先做一次前端乐观更新：即时反馈、减少 UI 卡顿感
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
          return [updated, ...rest].slice(0, maxHistory);
        }
        return [draftItem, ...prev].slice(0, maxHistory);
      });

      // 后端只需要 upsert payload 的必要字段，避免未来启用 deny_unknown_fields 时被额外字段影响
      const payload = {
        id: draftItem.id,
        text: draftItem.text,
        createdAt: draftItem.createdAt,
        updatedAt: draftItem.updatedAt,
      };
      const persisted = await runAction(() => upsertClipboardItem(payload, maxHistory));
      if (persisted) {
        applyPersistedItem(persisted, null);
      }
    },
    [applyPersistedItem, buildItem, maxHistory, runAction],
  );

  // 启动时先加载数据库中的历史记录，避免初始化时覆盖新数据
  const loadHistory = useCallback(async () => {
    const history = await runAction(() => loadClipboardHistory(maxHistory), []);
    if (Array.isArray(history)) {
      setItems(history);
    }
  }, [maxHistory, runAction]);

  // 真正执行详情编辑写入，避免每次键入都触发 SQL
  const persistDetailChange = useCallback(
    async (payload) => {
      if (!payload?.id) {
        return;
      }
      const result = await runAction(() =>
        updateClipboardItemText(payload.id, payload.text, new Date().toISOString()),
      );
      if (!result?.item) {
        return;
      }
      applyPersistedItem(result.item, result.mergedId ?? null);
      // 如果发生合并，需要把 pendingDetailRef 更新到新 id，避免后续 flush 写回旧条目
      pendingDetailRef.current = { id: result.item.id, text: result.item.text };
    },
    [applyPersistedItem, runAction],
  );

  // 详情文本变更时做节流保存，减少数据库频繁写入
  const scheduleDetailPersist = useCallback(
    (id, text) => {
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
      }, detailSaveDelay);
    },
    [detailSaveDelay, persistDetailChange],
  );

  // 在失焦或切换条目前强制保存最后一次编辑，避免数据丢失
  const flushDetailPersist = useCallback(() => {
    if (detailSaveTimerRef.current) {
      clearTimeout(detailSaveTimerRef.current);
      detailSaveTimerRef.current = null;
    }
    const payload = pendingDetailRef.current;
    if (payload?.id) {
      persistDetailChange(payload);
    }
  }, [persistDetailChange]);

  // 更新详情文本内容，直接同步到历史列表中
  const handleDetailChange = useCallback(
    (event) => {
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
    },
    [scheduleDetailPersist, selectedId],
  );

  // 将选中条目复制回系统剪贴板，同时刷新本地排序与计数
  const handleCopy = useCallback(
    async (item) => {
      if (!item) {
        return;
      }
      await runAction(
        async () => {
          await writeText(item.text, { label: "pure-paster" });
          await markClipboardSkip(item.text);
          await upsertItem(item.text);
          setIsCopyToastOpen(true);
        },
        undefined,
        // 注意：upsertItem 内部会自行处理“持久化成功/失败”的 errorMessage。
        // 这里不额外清空，避免“复制成功但落库失败”的错误提示被覆盖。
        { clearOnSuccess: false },
      );
    },
    [runAction, upsertItem],
  );

  // 手动将输入框内容写入系统剪贴板，并同步到历史记录
  const handleWrite = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    await runAction(
      async () => {
        await writeText(trimmed, { label: "pure-paster" });
        await markClipboardSkip(trimmed);
        await upsertItem(trimmed);
        setDraft("");
      },
      undefined,
      // 同上：这里不主动清空错误，交给 upsertItem 决定是否存在落库错误。
      { clearOnSuccess: false },
    );
  }, [draft, runAction, upsertItem]);

  // 清空本地历史列表，不影响系统剪贴板内容
  const clearHistory = useCallback(async () => {
    setItems([]);
    setSelectedId("");
    pendingDetailRef.current = { id: "", text: "" };
    if (detailSaveTimerRef.current) {
      clearTimeout(detailSaveTimerRef.current);
      detailSaveTimerRef.current = null;
    }
    await runAction(() => clearClipboardHistory());
  }, [runAction]);

  // 请求清空动作时先弹出确认提示，避免误触直接清空
  const requestClear = useCallback((type) => {
    setConfirmAction(type);
    setIsConfirmOpen(true);
  }, []);

  // 关闭确认弹窗，不执行清空
  const cancelClear = useCallback(() => {
    setIsConfirmOpen(false);
  }, []);

  // 用户确认后执行对应的清空动作
  const confirmClear = useCallback(async () => {
    const action = confirmAction;
    setIsConfirmOpen(false);
    if (action === "history") {
      await clearHistory();
    }
  }, [clearHistory, confirmAction]);

  // 弹窗完全关闭后再清空动作类型，避免出现文本闪烁
  const handleConfirmExited = useCallback(() => {
    setConfirmAction("");
  }, []);

  // 打开设置窗口，供主窗口入口复用
  const openSettingsWindow = useCallback(async () => {
    await runAction(() => openSettingsWindowCommand());
  }, [runAction]);

  // 使用系统默认浏览器打开链接
  const handleOpenLink = useCallback(
    async (url) => {
      if (!url) {
        return;
      }
      await runAction(() => openUrl(url));
    },
    [runAction],
  );

  // 切换条目固定状态，用于置顶常用内容
  const togglePin = useCallback(
    async (item) => {
      if (!item) {
        return;
      }
      const nextPinned = !item.pinned;
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id ? { ...entry, pinned: nextPinned } : entry,
        ),
      );
      const persisted = await runAction(() =>
        setClipboardItemPinned(item.id, nextPinned),
      );
      if (persisted) {
        applyPersistedItem(persisted, null);
      }
    },
    [applyPersistedItem, runAction],
  );

  // 删除单条记录，并修正选中项避免悬空
  const removeItem = useCallback(
    async (item) => {
      if (!item) {
        return;
      }
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      if (pendingDetailRef.current.id === item.id) {
        pendingDetailRef.current = { id: "", text: "" };
      }
      await runAction(() => deleteClipboardItem(item.id));
    },
    [runAction],
  );

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

  // 初始化：加载历史记录 + 注册后台广播监听
  useEffect(() => {
    loadHistory();
    return () => {
      if (detailSaveTimerRef.current) {
        clearTimeout(detailSaveTimerRef.current);
      }
    };
  }, [loadHistory]);

  useEffect(() => {
    let unlisten = null;
    const registerListener = async () => {
      const stop = await runAction(() =>
        listen("clipboard-updated", (event) => {
          const payload = event.payload;
          if (!payload?.item) {
            return;
          }
          applyPersistedItem(payload.item, payload.mergedId ?? null);
        }),
      );
      if (typeof stop === "function") {
        unlisten = stop;
      }
    };
    registerListener();
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [applyPersistedItem, runAction]);

  return {
    errorMessage,
    items,
    visibleItems,
    selectedId,
    setSelectedId,
    selectedItem,
    selectedItemUrl,
    canOpenLink,
    query,
    setQuery,
    draft,
    setDraft,
    isConfirmOpen,
    isCopyToastOpen,
    setIsCopyToastOpen,
    requestClear,
    cancelClear,
    confirmClear,
    handleConfirmExited,
    handleDetailChange,
    flushDetailPersist,
    handleCopy,
    handleWrite,
    openSettingsWindow,
    handleOpenLink,
    togglePin,
    removeItem,
  };
};
