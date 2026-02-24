import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import App from "./App";

// 定义全局 MUI 主题，统一颜色与排版基调，避免在组件中重复配置
const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1f4b99" },
    secondary: { main: "#d97b00" },
    background: { default: "#f4efe2" },
  },
  typography: {
    fontFamily: "\"Noto Sans\", \"Noto Sans SC\", \"Segoe UI\", sans-serif",
    h3: { fontWeight: 700 },
  },
  shape: { borderRadius: 12 },
});

// 使用 ThemeProvider 包裹应用，使所有组件共享主题并启用基础样式归一化
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
