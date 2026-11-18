// 微软翻译免费接口。
// 主通道：Edge 内置的 translatetext 端点（免授权、免密钥）。
// 关键点：服务端会校验浏览器 UA，缺 UA 直接返回 400 "Client Browser Version not supported"，
// 所以请求必须显式带一个桌面 Chrome / Edge 的 User-Agent；国内网络需走系统代理。
// 兜底通道：旧的 auth + api-edge（auth 端点多数环境已 404，仅在仍可用时生效）。
import { fromBing, toBing } from "../languages.js";
import { assertOk, readJson, responseExcerpt, translateError, withNetworkGuard } from "./errors.js";

const TEXT_URL = "https://edge.microsoft.com/translate/translatetext";
const AUTH_URL = "https://edge.microsoft.com/translate/auth";
const API_URL = "https://api-edge.cognitive.microsofttranslator.com/translate";
const TOKEN_SAFETY_MS = 60_000;
const TOKEN_DEFAULT_TTL_MS = 8 * 60_000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let cachedToken = { token: "", expiresAt: 0 };

function decodeExpiry(token) {
  try {
    const payload = String(token).split(".")[1];
    if (!payload) return 0;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const data = JSON.parse(atob(padded));
    const exp = Number(data.exp);
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

// 响应外层都是数组，但两个通道的元素结构不同：Edge 主通道按字符串返回，
// 认知服务通道返回 { translations: [{ text }] }。主通道两种都接受，
// 避免端点结构变化后整条引擎直接不可用。
function pickText(item) {
  if (typeof item === "string") return item;
  const translation = item?.translations?.[0];
  return translation && typeof translation.text === "string" ? translation.text : "";
}

// 结构诊断：只描述形状、不带响应正文，便于在「测试连接」里区分「端点结构变了」与「译文为空」。
function describeShape(items) {
  if (!items.length) return "empty array";
  const kinds = new Set(items.map((item) => (item === null ? "null" : typeof item)));
  return `array<${[...kinds].join("|")}>`;
}

function isBlankText(value) {
  return typeof value !== "string" || !value.trim();
}

// 主通道：兼容字符串数组与认知服务结构，多元素按顺序拼接。
function readEdgeTranslation(data) {
  const items = Array.isArray(data) ? data : [data];
  const text = items.map(pickText).join("");
  if (isBlankText(text)) {
    throw translateError("UNKNOWN", { engine: "bing", message: "响应缺少译文", detail: describeShape(items) });
  }
  const head = items[0];
  const language = head && typeof head === "object" ? head.detectedLanguage?.language : "";
  return { text, detected: fromBing(language) };
}

// 兜底通道：按认知服务契约严格解析，不做字符串兼容，以免掩盖该通道自身的结构问题。
function readCognitiveTranslation(data) {
  const items = Array.isArray(data) ? data : [data];
  const item = items[0];
  const translation = item?.translations?.[0];
  if (!translation || typeof translation.text !== "string") {
    throw translateError("UNKNOWN", { engine: "bing", message: "响应缺少译文", detail: describeShape(items) });
  }
  return { text: translation.text, detected: fromBing(item?.detectedLanguage?.language) };
}

// 主通道：Edge 内置翻译接口。from 为空表示自动检测。
async function translateViaEdge({ text, from, to, fetchImpl }) {
  const source = from && from !== "auto" ? toBing(from) : "";
  const query = `from=${encodeURIComponent(source)}&to=${encodeURIComponent(toBing(to))}`;
  const response = await fetchImpl(`${TEXT_URL}?${query}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
    body: JSON.stringify([text]),
  });
  if (!response.ok) {
    // 服务端会因客户端 UA 不被认可返回 400：转成可读原因，便于定位 UA / 代理问题。
    let detail = "";
    try {
      detail = String(await response.text()).trim();
    } catch {
      detail = "";
    }
    const status = Number(response.status) || 0;
    // 429 复用统一分类：界面才能给出限流文案与「稍后再试」建议。
    if (status === 429) {
      throw translateError("RATE", { engine: "bing", status, message: `HTTP ${status}`, detail: responseExcerpt(detail) });
    }
    // UA 被拒单独标注原因：提示代理改写或接口收紧，而不是笼统的「接口返回错误」。
    if (/client browser version/i.test(detail)) {
      throw translateError("HTTP", {
        engine: "bing",
        status,
        reason: "ua",
        message: "Client Browser Version not supported",
        detail: responseExcerpt(detail),
      });
    }
    throw translateError("HTTP", { engine: "bing", status, message: `HTTP ${status}`, detail: responseExcerpt(detail) });
  }
  return readEdgeTranslation(await readJson(response, "bing"));
}

async function fetchToken(fetchImpl, force) {
  const now = Date.now();
  if (!force && cachedToken.token && cachedToken.expiresAt - TOKEN_SAFETY_MS > now) return cachedToken.token;
  const response = await fetchImpl(AUTH_URL, {
    method: "GET",
    headers: { "User-Agent": BROWSER_UA },
  });
  assertOk(response, "bing");
  const token = String(await response.text()).trim();
  if (!token) throw translateError("AUTH", { engine: "bing", message: "empty token" });
  const expiresAt = decodeExpiry(token) || now + TOKEN_DEFAULT_TTL_MS;
  cachedToken = { token, expiresAt };
  return token;
}

// 兜底通道：旧授权流程（auth 已废弃时这里会失败，交给上层处理）。
async function translateViaApiEdge({ text, from, to, fetchImpl }) {
  const buildRequest = (bearer) => {
    const params = ["api-version=3.0", `to=${encodeURIComponent(toBing(to))}`];
    if (from && from !== "auto") params.push(`from=${encodeURIComponent(toBing(from))}`);
    return fetchImpl(`${API_URL}?${params.join("&")}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
        "User-Agent": BROWSER_UA,
      },
      body: JSON.stringify([{ Text: text }]),
    });
  };

  let token = await fetchToken(fetchImpl, false);
  let response = await buildRequest(token);
  if (response?.status === 401 || response?.status === 403) {
    token = await fetchToken(fetchImpl, true);
    response = await buildRequest(token);
  }
  assertOk(response, "bing");
  return readCognitiveTranslation(await readJson(response, "bing"));
}

export function translateBing(options) {
  return withNetworkGuard("bing", async () => {
    let firstError = null;
    try {
      return await translateViaEdge(options);
    } catch (error) {
      firstError = error;
    }
    try {
      return await translateViaApiEdge(options);
    } catch {
      // 两条通道都失败时抛出主通道的错误：它更能说明当前环境的问题（UA / 代理）。
      throw firstError || translateError("UNKNOWN", { engine: "bing" });
    }
  });
}
