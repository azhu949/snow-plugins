// 设置：默认值、归一化（非法值回退）与映射表清理。
import {
  CATALOG_TTL_HOURS,
  DEFAULT_SETTINGS,
  defaultPricingUrl,
  FX_RATE,
  IGNORE_MAPPING,
  OPENROUTER_MODELS_URL,
  PERIODS,
  PRICING_SOURCES,
  REFRESH_SECONDS,
} from "./constants.js";
import { clamp } from "./util.js";

const CURRENCIES = Object.freeze(["USD", "CNY"]);
const FX_MODES = Object.freeze(["auto", "manual"]);
const BADGE_STYLES = Object.freeze(["today", "total"]);
const DISPLAY_MODES = Object.freeze(["topbar", "float"]);
const MAX_MODEL_NAME = 200;
const MAX_POSITION = 100000;

function numberInRange(value, range, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return clamp(number, range.min, range.max);
}

function booleanOr(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1) return true;
  if (value === "false" || value === 0) return false;
  return fallback;
}

// snow.fetch 会沿用应用会话 Cookie：只接受 https 公网地址，避免把凭据请求发往本机或内网。
const BLOCKED_HOST_SUFFIXES = Object.freeze([
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".localdomain",
  ".home.arpa",
]);

function isPrivateIpv4(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return first >= 224;
}

function isBlockedHost(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }
  // IPv6 字面量在 URL 里带方括号：官方目录源不使用 IP 字面量，这里直接拒绝，避免逐一判定私网前缀。
  if (host.includes(":")) return true;
  // 单标签主机（如 intranet）按内网搜索域处理。
  if (!host.includes(".")) return true;
  return isPrivateIpv4(host);
}

function normalizeUrl(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return fallback;
  }
  if (parsed.protocol !== "https:") return fallback;
  if (parsed.username || parsed.password) return fallback;
  if (isBlockedHost(parsed.hostname)) return fallback;
  // 返回 trim 后的原串：目录缓存按该字符串比对 URL，不能改写成 URL.href。
  return trimmed;
}

// 浮层位置只接受有限坐标；负值与超大值按视口安全范围夹取。
export function normalizeFloatPosition(value) {
  if (!value || typeof value !== "object") return null;
  const left = Number(value.left);
  const top = Number(value.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return {
    left: Math.round(clamp(left, 0, MAX_POSITION)),
    top: Math.round(clamp(top, 0, MAX_POSITION)),
  };
}

export function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  // 回退 URL 必须与归一化后的价格来源匹配，否则会用错误结构解析并稳定报目录为空。
  const pricingSource = PRICING_SOURCES.includes(source.pricingSource)
    ? source.pricingSource
    : DEFAULT_SETTINGS.pricingSource;
  const currency = String(source.displayCurrency ?? "")
    .trim()
    .toUpperCase();
  return {
    displayCurrency: CURRENCIES.includes(currency) ? currency : DEFAULT_SETTINGS.displayCurrency,
    fxMode: FX_MODES.includes(source.fxMode) ? source.fxMode : DEFAULT_SETTINGS.fxMode,
    fxRate:
      Math.round(numberInRange(source.fxRate, FX_RATE, DEFAULT_SETTINGS.fxRate) * 10000) / 10000,
    fxUrl: normalizeUrl(source.fxUrl, DEFAULT_SETTINGS.fxUrl),
    period: PERIODS.includes(source.period) ? source.period : DEFAULT_SETTINGS.period,
    refreshSeconds: Math.round(
      numberInRange(source.refreshSeconds, REFRESH_SECONDS, DEFAULT_SETTINGS.refreshSeconds),
    ),
    pricingSource,
    pricingUrl: normalizeUrl(source.pricingUrl, defaultPricingUrl(pricingSource)),
    catalogTtlHours: Math.round(
      numberInRange(source.catalogTtlHours, CATALOG_TTL_HOURS, DEFAULT_SETTINGS.catalogTtlHours),
    ),
    badgeStyle: BADGE_STYLES.includes(source.badgeStyle)
      ? source.badgeStyle
      : DEFAULT_SETTINGS.badgeStyle,
    panelPinned: booleanOr(source.panelPinned, DEFAULT_SETTINGS.panelPinned),
    displayMode: DISPLAY_MODES.includes(source.displayMode)
      ? source.displayMode
      : DEFAULT_SETTINGS.displayMode,
    floatPosition: normalizeFloatPosition(source.floatPosition),
    profileName:
      typeof source.profileName === "string"
        ? source.profileName.trim().slice(0, MAX_MODEL_NAME)
        : DEFAULT_SETTINGS.profileName,
    autoRefresh: booleanOr(source.autoRefresh, DEFAULT_SETTINGS.autoRefresh),
  };
}

// 手工映射：键统一小写（模型名大小写不敏感），值为目录条目 id、provider/id 或 __ignore__。
export function normalizeMappings(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    const name = String(key ?? "")
      .trim()
      .toLowerCase()
      .slice(0, MAX_MODEL_NAME);
    if (!name || typeof value !== "string") continue;
    const target = value.trim();
    if (!target) continue;
    if (target !== IGNORE_MAPPING && target.length > MAX_MODEL_NAME) continue;
    result[name] = target;
  }
  return result;
}

export function resolveCatalogTtlMs(settings) {
  const hours = numberInRange(
    settings?.catalogTtlHours,
    CATALOG_TTL_HOURS,
    DEFAULT_SETTINGS.catalogTtlHours,
  );
  return Math.round(hours * 60 * 60 * 1000);
}

export { DEFAULT_SETTINGS, OPENROUTER_MODELS_URL };
