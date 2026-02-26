import { useMemo } from "react";
import { Box, Container, Paper } from "@mui/material";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MainView } from "./views/MainView";
import { SettingsView } from "./views/SettingsView";

// App 只负责做“窗口类型分流 + 通用外壳样式”：
// - 主窗口渲染 MainView（历史列表、详情、写入等）
// - 设置窗口渲染 SettingsView（监听/自启动/快捷键等）
// 这样可以把巨型 App.jsx 拆解为更易维护的页面与 hook，避免后续功能增长导致复杂度失控。

function App() {
  // 识别当前窗口类型，用于区分主窗口与设置窗口渲染
  const isSettingsWindow = useMemo(() => {
    try {
      return getCurrentWindow().label === "settings";
    } catch {
      return false;
    }
  }, []);

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
          {isSettingsWindow ? <SettingsView /> : <MainView />}
        </Paper>
      </Container>
    </Box>
  );
}

export default App;

