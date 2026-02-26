// 将用户按键组合转为 Tauri 2.x 可识别的快捷键格式。
// 约定：忽略纯修饰键（Shift/Ctrl/Alt/Meta），只在捕获到“修饰键 + 非修饰键”时返回字符串。

export const buildShortcutFromEvent = (event) => {
  const rawKey = event.key;
  if (rawKey === "Shift" || rawKey === "Control" || rawKey === "Alt" || rawKey === "Meta") {
    return "";
  }
  let keyLabel = "";
  if (rawKey === " ") {
    keyLabel = "Space";
  } else if (rawKey.length === 1) {
    keyLabel = rawKey.toUpperCase();
  } else {
    keyLabel = rawKey;
  }
  const parts = [];
  if (event.metaKey) {
    parts.push("Command");
  }
  if (event.ctrlKey) {
    parts.push("Ctrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  parts.push(keyLabel);
  return parts.join("+");
};

