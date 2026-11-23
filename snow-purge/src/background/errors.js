// 统一的错误类型：code 用于面板分支与 HTTP 状态映射，message 直接展示。
export class PurgeError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "PurgeError";
    this.code = String(code || "INTERNAL");
  }
}

export const asPurgeError = (error, fallbackCode = "INTERNAL") => {
  if (error instanceof PurgeError) return error;
  const wrapped = new PurgeError(fallbackCode, String(error?.message || error));
  return wrapped;
};
