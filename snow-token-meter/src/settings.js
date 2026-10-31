// 设置：默认值、归一化（非法值回退）与映射表清理。
import {
  CACHE_WRITE_TTLS,
  CATALOG_TTL_HOURS,
  DEFAULT_SETTINGS,
  defaultPricingUrl,
  FX_RATE,
  IGNORE_MAPPING,
  OPENROUTER_MODELS_URL,
  PERIODS,
  PRECISE_MODES,
  PRICING_SOURCES,
  REFRESH_SECONDS,
} from "./constants.js";
import { normalizePrices } from "./prices.js";
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

// snow.fetch 会沿用应用会话 Cookie：只接受 https 域名地址，IP 字面量与内网主机名一律拒绝，
// 避免把凭据请求发往本机、内网或任意裸地址。域名解析到内网不在静态校验范围内。
const BLOCKED_HOST_SUFFIXES = Object.freeze([
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".localdomain",
  ".home.arpa",
]);

// IPv4 字面量：WHATWG URL 已把十六进制 / 十进制整数 / 缺段简写 / 尾点等等价写法归一成点分四段，
// 因此一条正则即可完备覆盖，不需要逐一枚举私网段。
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isBlockedHost(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }
  // IPv6 字面量在 URL 里带方括号；与 IPv4 一样直接拒绝，官方三个目录源都只用域名。
  if (host.includes(":")) return true;
  // 单标签主机（如 intranet）按内网搜索域处理。
  if (!host.includes(".")) return true;
  return IPV4_LITERAL.test(host);
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
    // 旧设置没有这三个键时一律落到默认值：auto 不放大小目录的翻页成本，5m 与现状金额一致。
    preciseRequests: PRECISE_MODES.includes(source.preciseRequests)
      ? source.preciseRequests
      : DEFAULT_SETTINGS.preciseRequests,
    cacheWriteTtl: CACHE_WRITE_TTLS.includes(source.cacheWriteTtl)
      ? source.cacheWriteTtl
      : DEFAULT_SETTINGS.cacheWriteTtl,
    // 补全源只接受已知价格源或空串：非法值按关闭处理，绝不悄悄启用混价。
    fillSource: PRICING_SOURCES.includes(source.fillSource) ? source.fillSource : "",
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

// 自定义价归一化：唯一实现在 prices.js（键小写、去非法项、限长），
// 这里只提供设置侧的入口，避免两处校验规则漂移。
export function normalizeCustomPrices(raw) {
  return normalizePrices(raw);
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
