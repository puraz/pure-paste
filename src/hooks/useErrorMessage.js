import { useCallback, useState } from "react";

// 统一管理错误提示：让业务逻辑只关心“做什么”，而不是每次都写一套 try/catch + message 格式化。
// 注意：这里选择“捕获错误并返回 fallbackValue”，避免事件处理器产生未处理的 Promise rejection。

export const useErrorMessage = () => {
  const [errorMessage, setErrorMessage] = useState("");

  const clearError = useCallback(() => {
    setErrorMessage("");
  }, []);

  /**
   * 执行一个异步动作，并自动处理 errorMessage：
   * - 成功：清空 errorMessage，返回结果
   * - 失败：写入 errorMessage，返回 fallbackValue（默认 undefined）
   * @template T
   * @param {() => Promise<T>} action
   * @param {T | undefined} [fallbackValue]
   * @param {{ clearOnSuccess?: boolean } | undefined} [options]
   * @returns {Promise<T | undefined>}
   */
  const runAction = useCallback(
    async (action, fallbackValue, options) => {
      const clearOnSuccess = options?.clearOnSuccess ?? true;
      try {
        const result = await action();
        if (clearOnSuccess) {
          clearError();
        }
        return result;
      } catch (error) {
        setErrorMessage(error?.message ?? String(error));
        return fallbackValue;
      }
    },
    [clearError],
  );

  return { errorMessage, setErrorMessage, clearError, runAction };
};
