// 翻译错误：统一带 code / status / engine / reason / apiCode，UI 按 code 与 reason 取本地化文案。
// status 只表示 HTTP 状态；接口自身的业务错误码放在 apiCode，避免两套语义混用。
export function translateError(code, options = {}) {
  const error = new Error(options.message || code);
  error.name = "TranslateError";
  error.code = code;
  error.status = options.status || 0;
  error.engine = options.engine || "";
  error.detail = options.detail || "";
  error.reason = options.reason || "";
  error.apiCode = options.apiCode ? String(options.apiCode) : "";
  return error;
}

function isOk(response) {
  if (!response) return false;
  if (typeof response.ok === "boolean") return response.ok;
  return response.status >= 200 && response.status < 300;
}

// 接口返回非 2xx：401 / 403 归为认证失败，429 归为限流，其余按 HTTP 状态码上报。
export function assertOk(response, engine) {
  if (isOk(response)) return;
  const status = response?.status || 0;
  if (status === 401 || status === 403) {
    throw translateError("AUTH", { engine, status, message: `HTTP ${status}` });
  }
  if (status === 429) {
    throw translateError("RATE", { engine, status, message: `HTTP ${status}` });
  }
  throw translateError("HTTP", { engine, status, message: `HTTP ${status}` });
}

// 响应体摘要：折叠空白后截断，避免整页 HTML 撑爆「测试连接」的诊断行。
const DETAIL_LIMIT = 160;

export function responseExcerpt(text) {
  const flat = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > DETAIL_LIMIT ? `${flat.slice(0, DETAIL_LIMIT)}...` : flat;
}

// 解析 JSON 响应体：代理拦截页、网关错误页、人机校验页会让 response.json() 抛 SyntaxError，
// 而这类异常没有 code，交给 withNetworkGuard 会被归成 NETWORK，把排错方向指到网络与代理上。
// body 只能读一次，所以先 text() 再 JSON.parse；解析失败按 HTTP 上报状态码与响应首段文本。
export async function readJson(response, engine) {
  const status = Number(response?.status) || 0;
  let raw = "";
  try {
    raw = String(await response.text());
  } catch {
    raw = "";
  }
  try {
    return JSON.parse(raw);
  } catch {
    const type = String(response?.headers?.get?.("content-type") || "")
      .split(";")[0]
      .trim();
    throw translateError("HTTP", {
      engine,
      status,
      reason: "body",
      message: `HTTP ${status}`,
      detail: [type, responseExcerpt(raw)].filter(Boolean).join(" "),
    });
  }
}

// 从宿主抛出的网络异常里识别原因：代理、TLS、DNS、超时、断网、连接被拒。
// Electron 的 net 报错形如 "net::ERR_PROXY_CONNECTION_FAILED"，据此归类比笼统的「网络失败」可诊断。
export function networkReason(message) {
  const text = String(message || "");
  if (!text) return "";
  if (/ERR_PROXY|PROXY_CONNECTION|ERR_TUNNEL_CONNECTION|ERR_MANDATORY_PROXY/i.test(text)) return "proxy";
  if (/ERR_SSL|ERR_TLS|SSL_PROTOCOL|CERT_|certificate|handshake/i.test(text)) return "tls";
  if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION|ENOTFOUND|EAI_AGAIN/i.test(text)) return "dns";
  if (/ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT|ETIMEDOUT|timed out|timeout/i.test(text)) return "timeout";
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ENETUNREACH|ERR_ADDRESS_UNREACHABLE|offline/i.test(text))
    return "offline";
  if (
    /ERR_CONNECTION_REFUSED|ECONNREFUSED|ERR_CONNECTION_RESET|ECONNRESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/i.test(
      text,
    )
  )
    return "refused";
  return "";
}

// 网络层异常（DNS / 代理 / 超时 / TLS）统一转成 NETWORK，
// 同时保留原始错误与归类后的原因，界面才能说明到底是哪一环断了。
export async function withNetworkGuard(engine, run) {
  try {
    return await run();
  } catch (error) {
    if (error && (error.code === "AUTH" || error.code === "HTTP" || error.code === "RATE" || error.code === "EMPTY")) {
      throw error;
    }
    if (error && error.code === "UNKNOWN") throw error;
    const message = error?.message ? String(error.message) : "network error";
    throw translateError("NETWORK", {
      engine,
      message,
      detail: String(error?.name || ""),
      reason: networkReason(message),
    });
  }
}
