# Pure Paster Material

一个基于 Tauri + Vite + React + MUI 的桌面剪贴板应用前端项目。

## 开发

- 安装依赖：`pnpm install`
- 启动 Web UI：`pnpm dev`
- 启动桌面应用：`pnpm tauri dev`
- 构建 Web UI：`pnpm build`
- 构建桌面应用：`pnpm tauri build`

## 结构

- `src/`：前端渲染层（入口 `src/main.jsx`，主视图 `src/App.jsx`）
- `src/assets/`、`public/`：静态资源
- `src-tauri/`：Rust 后端与桌面打包

## 约定

- 前端使用 MUI 组件与主题体系。
- Rust 代码遵循 `rustfmt`。
