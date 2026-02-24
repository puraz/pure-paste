import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import App from "./App";

// 定义统一的主题风格，包含配色、字号与圆角，确保整体界面保持一致性
const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1d3b6a" },
    secondary: { main: "#d07a2b" },
    background: { default: "#f5efe3" },
  },
  typography: {
    fontFamily: "\"Space Grotesk\", \"Noto Sans SC\", sans-serif",
    h1: { fontFamily: "\"Source Serif 4\", \"Noto Serif SC\", serif", fontWeight: 700 },
    h2: { fontFamily: "\"Source Serif 4\", \"Noto Serif SC\", serif", fontWeight: 700 },
    h3: { fontFamily: "\"Source Serif 4\", \"Noto Serif SC\", serif", fontWeight: 700 },
  },
  shape: { borderRadius: 8 },
});

// 使用 ThemeProvider 与 CssBaseline 全局注入主题与基础样式重置
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
