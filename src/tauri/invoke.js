import { invoke } from "@tauri-apps/api/core";

// 把后端可能返回的各种错误形态（string/object/Error）统一成可展示的 message。
// 这样上层 UI 只需要关心 `errorMessage` 字符串即可，不必到处写 `error?.message ?? String(error)`。
const formatInvokeErrorMessage = (error) => {
  if (!error) {
    return "未知错误";
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }
  try {
    const asJson = JSON.stringify(error);
    if (asJson && asJson !== "{}") {
      return asJson;
    }
  } catch {
    // JSON.stringify 失败时兜底
  }
  return String(error);
};

// 统一封装 Tauri invoke：成功直接返回结果；失败抛出 Error，便于上层统一读取 error.message。
export const invokeCommand = async (commandName, args) => {
  try {
    return await invoke(commandName, args);
  } catch (error) {
    throw new Error(formatInvokeErrorMessage(error));
  }
};

