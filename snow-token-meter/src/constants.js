// 常量：存储键、统计周期、默认设置、价格来源与节流限额。

export const STORAGE_KEYS = Object.freeze({
  settings: "tokenmeter:settings",
  // 三个价格源各存一份目录，切换来源时不必重新下载。
  catalog: "tokenmeter:catalog",
  catalogModelsDev: "tokenmeter:catalog:modelsdev",
  catalogLiteLLM: "tokenmeter:catalog:litellm",
  mappings: "tokenmeter:mappings",
  // 自定义价：值是对象，必须与 mappings 分开存（重置映射不得清价）。
  prices: "tokenmeter:prices",
  // 价表结构坏掉时备份原始值与时间：坏数据只备份一次，不留在主键里每轮失败。
  priceBackup: "tokenmeter:prices:backup",
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

// LiteLLM 目录：单文件 3 MB 左右，含 1h 缓存写价与长上下文档位（USD/token）。
// 默认走 jsDelivr 边缘节点；raw.githubusercontent 作设置备选，并且只在默认地址失败时重试一次。
export const LITELLM_URL =
  "https://cdn.jsdelivr.net/gh/BerriAI/litellm@main/model_prices_and_context_window.json";
export const LITELLM_MIRROR_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export const PRICING_SOURCES = Object.freeze(["openrouter", "modelsdev", "litellm"]);

export function defaultPricingUrl(source) {
  if (source === "modelsdev") return MODELS_DEV_URL;
  if (source === "litellm") return LITELLM_URL;
  return OPENROUTER_MODELS_URL;
}

// 目录记录格式版本：2 = 紧凑数组尾部追加 cacheWrite1h 与 tiers 两列。
export const CATALOG_SCHEMA = 2;
// 解析结果少于该条数视为残缺目录：不覆盖已有健康缓存（防上游错误页 / 半截 JSON）。
export const CATALOG_MIN_ENTRIES = 100;

// 档位阈值的比较方式随价格源不同：OpenRouter 的字段名是 min_prompt_tokens（达到即进入），
// models.dev 用 +1 编码（200001）表达「超过 size」，LiteLLM 的字段名是 above_*。
// 记录级只存一个布尔，旧记录按 URL 推断。
export function isTierInclusiveSource(source, url = "") {
  const kind = String(source ?? "")
    .trim()
    .toLowerCase();
  if (kind === "openrouter") return true;
  if (kind === "modelsdev" || kind === "litellm") return false;
  return /openrouter\.ai/i.test(String(url ?? ""));
}

// 逐请求精算：单页 100 条（宿主默认值，被钳制时也幂等），页数上限按区间分级。
export const RECORDS_PAGE_LIMIT = 100;
export const RECORDS_MAX_PAGES = Object.freeze({ today: 5, period: 5, allTime: 3 });
// 记录数上限：与页数上限同值（页 × 100），翻页时两者取先到者，防止宿主未来放宽单页条数。
export const RECORDS_MAX_ROWS = Object.freeze({ today: 500, period: 500, allTime: 300 });
// 每轮刷新允许额外发起的 usage 调用数（records 追加页）。
export const RECORDS_MAX_EXTRA_CALLS = 10;
// 一致性校验容差：请求数 0.5%，token 1% 且至少 2000。
export const RECORDS_TOLERANCE = Object.freeze({
  requestRatio: 0.005,
  tokenRatio: 0.01,
  tokenMin: 2000,
});

// 缓存写假设与精算触发方式的取值域（设置归一化与 UI 共用）。
export const CACHE_WRITE_TTLS = Object.freeze(["5m", "1h"]);
export const PRECISE_MODES = Object.freeze(["auto", "always", "off"]);

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

// 自定义价单模型倍率的取值域（无量纲）：只缩放该记录自己写出的四项 token 单价。
export const PRICE_MULTIPLIER = Object.freeze({ min: 0.01, max: 10 });

// 模糊匹配至少要连续命中 2 个 token，避免 flash 这类通用词误配。
export const FUZZY_MIN_TOKENS = 2;
export const CANDIDATE_LIMIT = 3;
// 身份层「价格共识」：组内输入价落在中位数 ±5% 的条目占比达到该阈值才算可信。
// 低于阈值时仍取中位价计价，但状态降级为 guess（不计入覆盖率分子）。
export const MATCH_CONSENSUS_SHARE = 0.34;

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
  // 逐请求精算：auto = 只在目录有长上下文档位且页数在预算内时翻页；
  // always = 忽略档位条件（排查用）；off = 完全不读 records。
  preciseRequests: "auto",
  // 缓存写假设：宿主只有 cache_creation_input_tokens 总量，5m 是下限，1h 是显式假设。
  cacheWriteTtl: "5m",
  // 跨源缺价补全（本次只预留键与归一化，空串 = 关闭）。
  fillSource: "",
});
