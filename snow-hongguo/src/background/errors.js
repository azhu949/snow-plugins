// 错误码到中文提示、HTTP 状态码的唯一映射表。
// 面板只认 code 做分支，message 只用于展示；原始英文 message 只进日志，不进响应。
export const ERROR_MESSAGES = Object.freeze({
  INVALID_OPTIONS: "参数不合法",
  PROFILE_NOT_FOUND: "本地匿名设备档案缺失",
  SIGNER_UNAVAILABLE: "签名组件不可用",
  AUTHENTICATION_REQUIRED: "需要登录",
  NOT_PROTECTED: "该内容未加密",
  DRM_PROTECTED: "内容受 DRM 保护",
  ANONYMOUS_LIMITED: "匿名设备被限制",
  RATE_LIMITED: "请求太频繁",
  TRANSPORT: "网络请求失败，请检查网络",
  SIGNATURE_REJECTED: "请求签名被服务端拒绝",
  CONTENT_UNAVAILABLE: "内容不可用",
  PARAM_INVALID: "参数不合法",
  CHALLENGE_REQUIRED: "服务端要求验证",
  DEVICE_REJECTED: "设备被拒",
  END_OF_LIST: "列表已到末尾",
  ALBUM_UNAVAILABLE: "剧集不可用",
  CANCELLED: "请求已取消",
  UNKNOWN: "未知错误",
});

/** 只有客户端自身故障才映射 500；其余上游问题统一 502，限流 429。 */
export const ERROR_STATUS = Object.freeze({
  INVALID_OPTIONS: 400,
  PARAM_INVALID: 400,
  END_OF_LIST: 404,
  RATE_LIMITED: 429,
  ANONYMOUS_LIMITED: 429,
  PROFILE_NOT_FOUND: 500,
  SIGNER_UNAVAILABLE: 500,
  UNKNOWN: 500,
});

const SDK_CODES = new Set(Object.keys(ERROR_MESSAGES));

/** 需要重置匿名设备后重试的错误码。 */
const DEVICE_RECOVERY_CODES = new Set(["DEVICE_REJECTED", "ANONYMOUS_LIMITED"]);

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const errorCodeOf = (error) => (typeof error?.code === "string" && error.code ? error.code : "UNKNOWN");

export const isDeviceRecoveryCode = (code) => DEVICE_RECOVERY_CODES.has(code);

export const isSdkError = (error) => {
  const code = errorCodeOf(error);
  return code !== "UNKNOWN" && SDK_CODES.has(code);
};

export const statusForCode = (code) => ERROR_STATUS[code] ?? (SDK_CODES.has(code) ? 502 : 500);

/** 日志用的错误快照：保留英文原文与重试提示，便于排查。 */
export const describeError = (error) => ({
  code: errorCodeOf(error),
  message: String(error?.message ?? error ?? ""),
  retryable: error?.retryable === true,
  retryAfterMs: Number(error?.retryAfterMs) || 0,
});

export const mapSdkError = (error) => {
  const code = errorCodeOf(error);
  const mapped = {
    code,
    message: ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UNKNOWN,
    status: statusForCode(code),
    rawMessage: String(error?.message ?? error ?? ""),
  };
  if (typeof error?.retryable === "boolean") mapped.retryable = error.retryable;
  const retryAfterMs = Number(error?.retryAfterMs);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) mapped.retryAfterMs = Math.ceil(retryAfterMs);
  return mapped;
};

/** 把任意异常转成统一响应：{ error: { code, message } }。 */
export const toErrorResponse = (error) => {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      payload: { error: { code: error.code, message: error.message, ...(error.extra ?? {}) } },
    };
  }
  if (isSdkError(error)) {
    const mapped = mapSdkError(error);
    const payload = { code: mapped.code, message: mapped.message };
    if (mapped.retryable !== undefined) payload.retryable = mapped.retryable;
    if (mapped.retryAfterMs) payload.retryAfterMs = mapped.retryAfterMs;
    return { status: mapped.status, payload: { error: payload } };
  }
  return { status: 500, payload: { error: { code: "INTERNAL", message: "后台内部错误" } } };
};
