// 错误文案：引擎抛出的 code 映射到本地化文案，未知 code 统一走 UNKNOWN。
// NETWORK 再按 reason 细分（代理 / TLS / DNS / 超时 / 断网 / 连接被拒），
// 并在主文案之外给一条可操作建议，避免只甩一句「请检查网络或代理」。
import { responseExcerpt } from "./engine/errors.js";

const KNOWN_CODES = new Set(["NETWORK", "HTTP", "AUTH", "RATE", "EMPTY", "UNKNOWN"]);
// body = 响应体不是 JSON（代理拦截页 / 网关错误页）：归到 HTTP，但排错方向与网络故障完全不同。
// balance / api = 接口业务码：余额不足与接口级失败，文案由 code + reason 组合，不占用 HTTP 状态。
// ua = 微软翻译拒绝当前客户端 UA：提示代理改写或接口收紧，而不是笼统的接口错误。
const KNOWN_REASONS = new Set(["proxy", "tls", "dns", "timeout", "offline", "refused", "body", "balance", "api", "ua"]);

export function toErrorPayload(error) {
  const failures = Array.isArray(error?.failures) ? error.failures : [];
  return {
    code: KNOWN_CODES.has(error?.code) ? error.code : "UNKNOWN",
    reason: KNOWN_REASONS.has(error?.reason) ? error.reason : "",
    status: Number(error?.status) || 0,
    message: String(error?.message || ""),
    engine: String(error?.engine || ""),
    detail: String(error?.detail || ""),
    apiCode: String(error?.apiCode || ""),
    // 全失败时各兜底引擎的失败原因：界面在主文案之外单独呈现，避免只看到最后一个引擎的错误。
    failures: failures.map((item) => ({
      engine: String(item?.engine || ""),
      code: KNOWN_CODES.has(item?.code) ? item.code : "UNKNOWN",
      status: Number(item?.status) || 0,
      reason: KNOWN_REASONS.has(item?.reason) ? item.reason : "",
      apiCode: String(item?.apiCode || ""),
    })),
  };
}

export function errorText(error, t) {
  const payload = toErrorPayload(error);
  // 414 是「请求地址过长」：直接点明与单次文本长度有关，否则用户只看到状态码无从判断。
  if (payload.code === "HTTP" && payload.status === 414) {
    return t("st.error.HTTP.tooLong", { status: payload.status });
  }
  const key = payload.reason ? `st.error.${payload.code}.${payload.reason}` : `st.error.${payload.code}`;
  return t(key, {
    status: payload.status,
    message: payload.message,
    code: payload.apiCode,
  });
}

// 建议文案：说明下一步该怎么做；没有明确建议时返回空串。
export function errorHint(error, t) {
  const payload = toErrorPayload(error);
  if (payload.code === "NETWORK") {
    // 微软翻译走 edge.microsoft.com，部分代理会在这个域名的 TLS 握手上中断。
    if (payload.engine === "bing" && (payload.reason === "tls" || payload.reason === "proxy" || !payload.reason)) {
      return t("st.error.hint.bing");
    }
    return t(`st.error.hint.${payload.reason || "network"}`);
  }
  if (payload.code === "AUTH") {
    return payload.reason === "balance" ? t("st.error.hint.balance") : t("st.error.hint.auth");
  }
  if (payload.code === "RATE") return t("st.error.hint.rate");
  if (payload.code === "HTTP" && payload.reason === "body") return t("st.error.hint.body");
  if (payload.code === "HTTP" && payload.reason === "ua") return t("st.error.hint.ua");
  if (payload.code === "HTTP" && payload.status === 414) return t("st.error.hint.tooLong");
  return "";
}

// 简短标签：回退提示只有一行，用一句话说清「哪个引擎因为什么失败」，不暴露内部 code。
export function shortErrorText(error, t) {
  const payload = toErrorPayload(error);
  if (payload.code === "HTTP" && payload.status === 414) return t("st.errorShort.HTTP.tooLong", { status: payload.status });
  if (payload.code === "HTTP" && payload.reason === "body")
    return t("st.errorShort.HTTP.body", { status: payload.status });
  if (payload.code === "HTTP" && payload.reason === "api")
    return t("st.errorShort.HTTP.api", { code: payload.apiCode });
  if (payload.code === "HTTP" && payload.status) return t("st.errorShort.HTTP", { status: payload.status });
  if (payload.code === "AUTH" && payload.reason === "balance") return t("st.errorShort.AUTH.balance");
  return t(`st.errorShort.${payload.code}`);
}

// 兜底链说明：主引擎原因已由 errorText / errorHint 呈现，这里补各兜底引擎的失败原因。
export function errorChainText(error, t) {
  const payload = toErrorPayload(error);
  if (!payload.failures.length) return "";
  const parts = payload.failures.map((item) =>
    t("st.errorChainItem", {
      engine: t(`st.engine.${item.engine}`),
      reason: shortErrorText(item, t),
    }),
  );
  return t("st.errorChain", { chain: parts.join(" · ") });
}

// 原始错误：给「测试连接」用的诊断行，形如 "TypeError · net::ERR_SSL_PROTOCOL_ERROR"。
export function errorDetail(error) {
  const payload = toErrorPayload(error);
  if (!payload.message) return payload.detail;
  return payload.detail ? `${payload.detail} · ${payload.message}` : payload.message;
}

// 结果区的原始响应摘要：折叠空白并截断，与「测试连接」的诊断行同一口径。
export function errorDetailLine(error) {
  return responseExcerpt(toErrorPayload(error).detail);
}
