import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useSettingsController } from "../hooks/useSettingsController";

// 设置窗口视图：聚焦渲染设置项 UI，所有状态与系统交互交给 controller hook 处理。

export const SettingsView = () => {
  const {
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
  } = useSettingsController();

  return (
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
      {errorMessage ? <Alert severity="error">操作失败：{errorMessage}</Alert> : null}

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
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
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
              {isAutostartLoading ? "读取中..." : autostartEnabled ? "已开启" : "已关闭"}
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
              onClick={() => setIsShortcutRecording((prev) => !prev)}
              disabled={isShortcutLoading || isShortcutSaving}
            >
              {isShortcutRecording ? "等待按键..." : "录制"}
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={handleShortcutSave}
              disabled={isShortcutLoading || isShortcutSaving || !shortcutDirty}
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
            isShortcutRecording ? "请直接按下组合键，按 Esc 取消录制" : `当前生效：${shortcutDisplay}`
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
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
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
  );
};

