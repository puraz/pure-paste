import { SvgIcon } from "@mui/material";

// 轻量复制图标：避免额外引入图标依赖包导致构建体积变大。
// 使用 SvgIcon 可以继承 MUI 的尺寸与颜色体系，和现有 UI 风格保持一致。

export const CopyIcon = (props) => (
  <SvgIcon {...props} viewBox="0 0 24 24">
    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
  </SvgIcon>
);

