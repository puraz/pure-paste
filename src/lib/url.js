// 标准化链接地址：只接受完整的 http/https 链接，返回 null 表示无效。
// 这样可以在 UI 层用一个布尔值控制“打开链接”按钮是否可用，避免无效操作。

export const normalizeHttpUrl = (value) => {
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

