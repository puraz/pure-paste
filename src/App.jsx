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
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { clear, readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

// 控制历史记录上限，避免长期运行导致内存压力过大
const MAX_HISTORY = 80;

function App() {
  // 剪贴板历史列表，包含内容、时间、固定状态与命中次数等元信息
  const [items, setItems] = useState([]);
  // 当前选中条目的 id，用于右侧详情面板展示
  const [selectedId, setSelectedId] = useState("");
  // 搜索输入，用于过滤历史列表
  const [query, setQuery] = useState("");
  // 是否开启剪贴板监听（轮询读取）
  const [isMonitoring, setIsMonitoring] = useState(true);
  // 手动写入剪贴板的输入内容
  const [draft, setDraft] = useState("");
  // 最近一次错误信息，便于排查权限或系统剪贴板异常
  const [errorMessage, setErrorMessage] = useState("");
  // 记录用户准备执行的清空动作类型，用于控制确认弹窗内容
  const [confirmAction, setConfirmAction] = useState("");
  // 控制确认弹窗是否显示，避免关闭动画期间文案闪动
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // 记录最近一次读到的剪贴板内容，避免重复插入历史
  const lastClipboardRef = useRef("");
  // 标记由本应用写入剪贴板的内容，下一次轮询时跳过
  const skipNextRef = useRef("");

  // 过滤剪贴板为空或非文本内容导致的系统错误提示，避免打扰用户
  const isIgnorableClipboardError = (message) => {
    const normalized = String(message).toLowerCase();
    return (
      normalized.includes("clipboard contents were not available") ||
      normalized.includes("clipboard is empty") ||
      normalized.includes("requested format") ||
      normalized.includes("not available")
    );
  };

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

  // 将文本写入历史记录：存在则更新计数并提升到顶部
  const upsertItem = (text) => {
    setItems((prev) => {
      const existingIndex = prev.findIndex((item) => item.text === text);
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
      return [buildItem(text), ...prev].slice(0, MAX_HISTORY);
    });
  };

  // 单次读取剪贴板，如果内容有效且非重复则写入历史
  const captureClipboard = async () => {
    try {
      const content = await readText();
      setErrorMessage("");
      if (!content || !content.trim()) {
        return;
      }
      if (skipNextRef.current && content === skipNextRef.current) {
        skipNextRef.current = "";
        lastClipboardRef.current = content;
        return;
      }
      if (content === lastClipboardRef.current) {
        return;
      }
      lastClipboardRef.current = content;
      upsertItem(content);
    } catch (error) {
      const message = error?.message ?? String(error);
      if (isIgnorableClipboardError(message)) {
        setErrorMessage("");
        return;
      }
      setErrorMessage(message);
    }
  };

  // 将选中条目复制回系统剪贴板，同时刷新本地排序与计数
  const handleCopy = async (item) => {
    if (!item) {
      return;
    }
    try {
      await writeText(item.text, { label: "pure-paster" });
      skipNextRef.current = item.text;
      lastClipboardRef.current = item.text;
      upsertItem(item.text);
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
      skipNextRef.current = draft.trim();
      lastClipboardRef.current = draft.trim();
      upsertItem(draft.trim());
      setDraft("");
    } catch (error) {
      setErrorMessage(error?.message ?? String(error));
    }
  };

  // 清空本地历史列表，不影响系统剪贴板内容
  const handleClearHistory = () => {
    setItems([]);
    setSelectedId("");
  };

  // 清空系统剪贴板，并重置本地缓存，避免旧值再次进入历史
  const handleClearClipboard = async () => {
    try {
      await clear();
      skipNextRef.current = "";
      lastClipboardRef.current = "";
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
      handleClearHistory();
      return;
    }
    if (action === "clipboard") {
      await handleClearClipboard();
    }
  };

  // 弹窗完全关闭后再清空动作类型，避免出现文本闪烁
  const handleConfirmExited = () => {
    setConfirmAction("");
  };

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
  };

  // 切换条目固定状态，用于置顶常用内容
  const togglePin = (item) => {
    if (!item) {
      return;
    }
    setItems((prev) =>
      prev.map((entry) =>
        entry.id === item.id ? { ...entry, pinned: !entry.pinned } : entry,
      ),
    );
  };

  // 删除单条记录，并修正选中项避免悬空
  const removeItem = (item) => {
    if (!item) {
      return;
    }
    setItems((prev) => prev.filter((entry) => entry.id !== item.id));
  };

  // 通过轮询实现剪贴板监听，支持随时暂停/恢复
  useEffect(() => {
    if (!isMonitoring) {
      return undefined;
    }
    captureClipboard();
    const timer = setInterval(() => {
      captureClipboard();
    }, 1200);
    return () => clearInterval(timer);
  }, [isMonitoring]);

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
  const pinnedCount = items.filter((item) => item.pinned).length;

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
              alignItems={{ xs: "flex-start", md: "center" }}
              justifyContent="space-between"
            >
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  剪贴板
                </Typography>
                <Chip label={`条目 ${items.length}`} size="small" />
                <Chip label={`固定 ${pinnedCount}`} size="small" color="secondary" />
              </Stack>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <TextField
                  size="small"
                  placeholder="搜索"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <Stack direction="row" spacing={1} alignItems="center">
                  <Switch
                    size="small"
                    checked={isMonitoring}
                    onChange={(event) => setIsMonitoring(event.target.checked)}
                    color="secondary"
                  />
                  <Typography variant="caption">监听</Typography>
                </Stack>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => requestClear("history")}
                >
                  清空历史
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => requestClear("clipboard")}
                >
                  清空剪贴板
                </Button>
              </Stack>
            </Stack>

            {errorMessage ? (
              <Alert severity="error">剪贴板访问失败：{errorMessage}</Alert>
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
                            />
                            {item.pinned ? (
                              <Chip
                                label="固定"
                                size="small"
                                color="secondary"
                                sx={{ ml: 1 }}
                              />
                            ) : null}
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
            </Stack>
          </Stack>
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
            {confirmAction === "history"
              ? "确定要清空全部历史记录吗？此操作不可撤销。"
              : "确定要清空系统剪贴板吗？清空后无法恢复。"}
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
    </Box>
  );
}

export default App;
