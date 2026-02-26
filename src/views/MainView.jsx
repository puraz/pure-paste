import { useEffect, useRef } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useClipboardController } from "../hooks/useClipboardController";
import { CopyIcon } from "../components/icons/CopyIcon";
import { ConfirmClearDialog } from "../components/ConfirmClearDialog";
import { CopyToast } from "../components/CopyToast";

// 主窗口视图：只负责 UI 结构与交互绑定，业务状态与后端交互交给 controller hook。
// 这样未来改 UI 布局不会影响数据逻辑，改逻辑也不必在 1000+ 行的 JSX 中穿梭。

export const MainView = () => {
  const {
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
  } = useClipboardController();

  // 搜索输入框引用，便于应用内快捷键聚焦
  const searchInputRef = useRef(null);
  // 基于主题断点判断当前窗口是否接近移动端形态，用于隐藏详情与写入区
  const theme = useTheme();
  const isCompactLayout = useMediaQuery(theme.breakpoints.down("sm"));

  // 监听应用内快捷键，Mac 使用 Command+F，其它平台使用 Ctrl+F
  useEffect(() => {
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
  }, []);

  return (
    <>
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
              <Button variant="outlined" size="small" onClick={() => requestClear("history")}>
                清空历史
              </Button>
              <Button variant="text" size="small" onClick={openSettingsWindow}>
                设置
              </Button>
            </Stack>
          )}
        </Stack>

        {errorMessage ? <Alert severity="error">操作失败：{errorMessage}</Alert> : null}

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
              <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600 }}>
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
                <Typography variant="body2" sx={{ color: "text.secondary", px: 2, py: 3 }}>
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
                {selectedItem?.pinned ? <Chip label="已固定" size="small" color="secondary" /> : null}
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

      <ConfirmClearDialog
        open={isConfirmOpen}
        onCancel={cancelClear}
        onConfirm={confirmClear}
        onExited={handleConfirmExited}
      />

      <CopyToast open={isCopyToastOpen} onClose={() => setIsCopyToastOpen(false)} />
    </>
  );
};

