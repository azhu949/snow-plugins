// 常量：存储键、统计周期、默认设置、价格来源与节流限额。

export const STORAGE_KEYS = Object.freeze({
  settings: "tokenmeter:settings",
  // 两个价格源各存一份目录，切换来源时不必重新下载。
  catalog: "tokenmeter:catalog",
  catalogModelsDev: "tokenmeter:catalog:modelsdev",
  mappings: "tokenmeter:mappings",
  fx: "tokenmeter:fx",
  ui: "tokenmeter:ui",
});

// 统计周期：今日 / 近 7 天 / 近 30 天 / 全部历史。
export const PERIODS = Object.freeze(["today", "7d", "30d", "all"]);

// usage_records.created_at 是本地时间文本（SQLite datetime('now','localtime')），
// 全量区间用足够早的固定起点；不依赖空字符串「跳过过滤」的宿主行为。
export const ALL_TIME_SINCE = "2000-01-01 00:00:00";

// 手工映射的特殊值：命中该值的模型不计成本，单独统计为 ignoredTokens。
export const IGNORE_MAPPING = "__ignore__";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models?output_modalities=all";

// models.dev 目录：按 provider 收录各厂商与中转站的挂牌价（USD / 百万 token）。
export const MODELS_DEV_URL = "https://models.dev/api.json";
export const PRICING_SOURCES = Object.freeze(["openrouter", "modelsdev"]);

export function defaultPricingUrl(source) {
  return source === "modelsdev" ? MODELS_DEV_URL : OPENROUTER_MODELS_URL;
}

// USD → CNY 汇率接口：只返回 rates.CNY，免密钥；兼容任何同结构的接口。
export const FX_URL = "https://api.frankfurter.app/latest?from=USD&to=CNY";
// 汇率缓存 6 小时：免费源每天更新一次，没必要更频繁。
export const FX_TTL_MS = 6 * 60 * 60 * 1000;

// 价格目录默认缓存 12 小时；范围由设置项 catalogTtlHours 约束。
export const CATALOG_TTL_MS = 12 * 60 * 60 * 1000;
export const CATALOG_TTL_HOURS = Object.freeze({ min: 1, max: 168 });
// 手动刷新之外的自动请求最短间隔。
export const REFRESH_THROTTLE_MS = 10 * 1000;
// 目录 / 汇率同步失败后的重试冷却：离线或对端不可达时，避免每个自动刷新周期都重打接口。
// 手动刷新与切换数据源走 force，不受此限制。
export const CATALOG_RETRY_MS = 5 * 60 * 1000;
export const FX_RETRY_MS = 5 * 60 * 1000;
// 全量历史区间较重，5 分钟内复用上一次结果。
export const ALL_TIME_CACHE_MS = 5 * 60 * 1000;
export const REFRESH_SECONDS = Object.freeze({ min: 30, max: 600 });
export const FX_RATE = Object.freeze({ min: 0.1, max: 20 });

// 模糊匹配至少要连续命中 2 个 token，避免 flash 这类通用词误配。
export const FUZZY_MIN_TOKENS = 2;
export const CANDIDATE_LIMIT = 3;

export const DEFAULT_SETTINGS = Object.freeze({
  displayCurrency: "CNY",
  fxMode: "auto",
  fxRate: 7.2,
  fxUrl: FX_URL,
  period: "today",
  refreshSeconds: 30,
  pricingSource: "openrouter",
  pricingUrl: OPENROUTER_MODELS_URL,
  catalogTtlHours: 12,
  badgeStyle: "today",
  panelPinned: false,
  displayMode: "float",
  floatPosition: null,
  profileName: "",
  autoRefresh: true,
});
