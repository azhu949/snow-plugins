// 价格目录：三个来源的抓取、精简、持久化与 TTL 缓存。
// OpenRouter 的 pricing 字段是 USD/token 的十进制字符串；
// models.dev 的 cost 是 USD / 百万 token，读取时统一换算成 USD/token；
// LiteLLM 的 *_cost_per_token 原生是 USD/token，长上下文档位字段是「千 token」。
// 缺失价按约定回退：input_cache_read / input_cache_write → prompt，request 缺省 0。
// 不使用 internal_reasoning（无法区分推理 token），也不读 priority / flex 价（宿主没有 tier 维度）。
// 长上下文档位（tiers）与 1h 缓存写价由 cost.js 消费：档位按整次请求选一档，不是分段累进。
import {
  CATALOG_MIN_ENTRIES,
  CATALOG_RETRY_MS,
  CATALOG_SCHEMA,
  CATALOG_TTL_MS,
  LITELLM_MIRROR_URL,
  LITELLM_URL,
  MODELS_DEV_URL,
  OPENROUTER_MODELS_URL,
  STORAGE_KEYS,
  isTierInclusiveSource,
} from "./constants.js";

export { CATALOG_SCHEMA };

const INFLIGHT = new WeakMap();
// 目录内存副本：同一 storage + 来源 + 存储键 + 地址在 TTL 内复用同一份 models 数组，
// 既省掉每轮 JSON 解析与条目展开，也让 match.js 以数组为键的索引缓存保持有效。
const CATALOG_BASE = new WeakMap();

function memoOf(storage) {
  if (!storage || typeof storage !== "object") return null;
  let map = CATALOG_BASE.get(storage);
  if (!map) {
    map = new Map();
    CATALOG_BASE.set(storage, map);
  }
  return map;
}

// 只存基础记录：stale / error 属于单次调用结果，不能跨轮复用。
function baseOf(record) {
  return {
    fetchedAt: record.fetchedAt,
    source: record.source,
    provider: record.provider,
    url: record.url,
    count: record.count,
    models: record.models,
    schema: record.schema,
    tierInclusive: record.tierInclusive,
    mirror: record.mirror,
    resolvedUrl: record.resolvedUrl,
  };
}

// 内存副本只在存储记录仍是同一份（同一写入时间与地址）时复用。
function wasWrittenBy(record, base) {
  if (!record) return false;
  return Number(record.fetchedAt) === base.fetchedAt && String(record.url ?? "") === base.url;
}

export class PricingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PricingError";
    this.code = code;
    this.details = details;
  }
}

function readNow(now) {
  const value = typeof now === "function" ? now() : now;
  if (value instanceof Date) return value.getTime();
  const number = Number(value);
  return Number.isFinite(number) ? number : Date.now();
}

function parsePrice(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

// 可选价：缺字段返回 null（表示「继承」），显式 0 原样保留（表示免费）。
// 只有这两个语义必须区分时才用它；基础价继续用 parsePrice 的「缺失回退」语义。
function optionalPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function priceString(value) {
  return value === null || value === undefined ? "" : String(value);
}

// 档位按 above 升序；同一阈值重复上报时只留输入价更高的一条，
// 保证 selectTier 的「最后一次命中」唯一且可复现。
function sortTiers(tiers) {
  const list = tiers.filter(Boolean).sort((left, right) => left.above - right.above);
  const out = [];
  for (const tier of list) {
    const last = out[out.length - 1];
    if (last && last.above === tier.above) {
      if ((tier.prompt ?? 0) >= (last.prompt ?? 0)) out[out.length - 1] = tier;
      continue;
    }
    out.push(tier);
  }
  return out;
}

// 单条 OpenRouter 模型 → 精简条目；价格同时保留原始字符串便于排查。
export function normalizeCatalogEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id ?? "").trim();
  if (!id) return null;
  const pricing = raw.pricing && typeof raw.pricing === "object" ? raw.pricing : {};
  const prompt = parsePrice(pricing.prompt, 0);
  const canonical = String(raw.canonical_slug ?? "").trim() || id;
  return {
    id,
    // OpenRouter 是单渠道目录，provider 留空；跨渠道匹配只对 models.dev 生效。
    provider: "",
    slug: canonical,
    name: String(raw.name ?? "").trim() || id,
    prompt,
    completion: parsePrice(pricing.completion, 0),
    cacheRead: parsePrice(pricing.input_cache_read, prompt),
    cacheWrite: parsePrice(pricing.input_cache_write, prompt),
    // 1h 缓存写：缺失必须是 null（只能出区间上界），不能回退成 5m 价。
    cacheWrite1h: optionalPrice(pricing.input_cache_write_1h),
    request: parsePrice(pricing.request, 0),
    tiers: normalizeOpenRouterTiers(pricing.overrides),
    canonical,
    context: Math.max(0, Math.floor(Number(raw.context_length) || 0)),
    raw: {
      prompt: priceString(pricing.prompt),
      completion: priceString(pricing.completion),
      cacheRead: priceString(pricing.input_cache_read),
      cacheWrite: priceString(pricing.input_cache_write),
      cacheWrite1h: priceString(pricing.input_cache_write_1h),
      request: priceString(pricing.request),
    },
  };
}

// OpenRouter 的长上下文档位写在 pricing.overrides[]：min_prompt_tokens 是 token（不是千 token）。
function normalizeOpenRouterTiers(overrides) {
  if (!Array.isArray(overrides)) return [];
  const tiers = [];
  for (const raw of overrides) {
    if (!raw || typeof raw !== "object") continue;
    const above = Number(raw.min_prompt_tokens);
    if (!Number.isFinite(above) || above < 0) continue;
    const tier = {
      above: Math.floor(above),
      prompt: optionalPrice(raw.prompt),
      completion: optionalPrice(raw.completion),
      cacheRead: optionalPrice(raw.input_cache_read),
      cacheWrite: optionalPrice(raw.input_cache_write),
      cacheWrite1h: optionalPrice(raw.input_cache_write_1h),
    };
    // 一个价都没有的 override 无法参与计价，直接丢弃。
    if (
      tier.prompt === null &&
      tier.completion === null &&
      tier.cacheRead === null &&
      tier.cacheWrite === null &&
      tier.cacheWrite1h === null
    ) {
      continue;
    }
    tiers.push(tier);
  }
  return sortTiers(tiers);
}

// models.dev 的价格以百万 token 计价，统一除以 1e6 后与 OpenRouter 口径一致。
const MODELS_DEV_UNIT = 1e6;

// cost.cache_write 明确写 0（如智谱）表示不收费；只有字段缺失才回退到输入价。
function perToken(value, fallbackUsd) {
  if (value === undefined || value === null || value === "") return fallbackUsd;
  return parsePrice(value, 0) / MODELS_DEV_UNIT;
}

// 档位分项：缺失返回 null（继承基础价），显式 0 保留。
function perTokenOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed / MODELS_DEV_UNIT;
}

// 单条 models.dev 模型 → 精简条目；没有 cost 的条目无法计价，直接丢弃。
export function normalizeModelsDevEntry(providerId, raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id ?? "").trim();
  if (!id) return null;
  const cost = raw.cost && typeof raw.cost === "object" ? raw.cost : null;
  if (!cost) return null;
  const provider = String(providerId ?? "").trim();
  const prompt = perToken(cost.input, 0);
  const canonical = String(raw.canonical_model_id ?? "").trim();
  return {
    id,
    provider,
    slug: provider ? `${provider}/${id}` : id,
    name: String(raw.name ?? "").trim() || id,
    prompt,
    completion: perToken(cost.output, 0),
    cacheRead: perToken(cost.cache_read, prompt),
    cacheWrite: perToken(cost.cache_write, prompt),
    // models.dev 全表没有 cache_write_1h 字段，恒为 null。
    cacheWrite1h: null,
    request: 0,
    tiers: normalizeModelsDevTiers(cost),
    canonical,
    context: Math.max(0, Math.floor(Number(raw.limit?.context) || 0)),
    raw: {
      input: priceString(cost.input),
      output: priceString(cost.output),
      cacheRead: priceString(cost.cache_read),
      cacheWrite: priceString(cost.cache_write),
    },
  };
}

// 只保留 type === "context" 的档；非 context（例如 batch）与「一次请求只按一个档计价」冲突。
// context_over_200k 与 tiers 是同一份数据的两种拼写（实测 634/634 重叠且首档同价），
// 所以有 tiers 就完全忽略它，避免同档两价。没有 tiers 时才把它当作 above=200000 兜底。
function normalizeModelsDevTiers(cost) {
  const list = Array.isArray(cost.tiers) ? cost.tiers : [];
  const tiers = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const kind = String(raw.tier?.type ?? "context")
      .trim()
      .toLowerCase();
    if (kind !== "context") continue;
    const above = Number(raw.tier?.size);
    if (!Number.isFinite(above) || above < 0) continue;
    const tier = {
      above: Math.floor(above),
      prompt: perTokenOrNull(raw.input),
      completion: perTokenOrNull(raw.output),
      cacheRead: perTokenOrNull(raw.cache_read),
      cacheWrite: perTokenOrNull(raw.cache_write),
      cacheWrite1h: null,
    };
    if (tier.prompt === null && tier.completion === null && tier.cacheRead === null && tier.cacheWrite === null) {
      continue;
    }
    tiers.push(tier);
  }
  if (tiers.length > 0) return sortTiers(tiers);

  const over = cost.context_over_200k;
  if (over && typeof over === "object") {
    const tier = {
      above: 200000,
      prompt: perTokenOrNull(over.input),
      completion: perTokenOrNull(over.output),
      cacheRead: perTokenOrNull(over.cache_read),
      cacheWrite: perTokenOrNull(over.cache_write),
      cacheWrite1h: null,
    };
    if (!(tier.prompt === null && tier.completion === null && tier.cacheRead === null && tier.cacheWrite === null)) {
      tiers.push(tier);
    }
  }
  return sortTiers(tiers);
}

// LiteLLM 的 mode 取值里只有纯文本模型能套用「input/output token 价」；
// 其余（embedding / image_generation / audio / rerank / video）价格口径不同，全部丢弃。
const LITELLM_TEXT_MODES = new Set(["chat", "responses", ""]);
// 例：input_cost_per_token_above_200k_tokens —— 阈值单位是「千 token」。
const LITELLM_TIER_FIELD_RE = /^(?:input|output|cache_read|cache_creation)_(?:cost_per_token|input_token_cost)_above_(\d+)k_tokens$/;
// 兼容 cache_read_input_token_cost_above_200k_tokens 这种「价在前、量在后」的写法。
const LITELLM_TIER_FIELD_ALT_RE = /^(?:input|output)_cost_per_token_above_(\d+)k_tokens$/;

function liteLLMTierFieldNames(thresholdK) {
  const k = `${thresholdK}k_tokens`;
  return {
    prompt: `input_cost_per_token_above_${k}`,
    completion: `output_cost_per_token_above_${k}`,
    cacheRead: [`cache_read_input_token_cost_above_${k}`, `cache_read_cost_per_token_above_${k}`],
    cacheWrite: [
      `cache_creation_input_token_cost_above_${k}`,
      `cache_creation_cost_per_token_above_${k}`,
    ],
  };
}

function readFirst(raw, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    const value = optionalPrice(raw[name]);
    if (value !== null) return value;
  }
  return null;
}

// 单条 LiteLLM 模型 → 精简条目。id 保留原始 key（形态很杂），交给 match.js 归一化。
export function normalizeLiteLLMEntry(key, raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(key ?? "").trim();
  if (!id) return null;
  const mode = String(raw.mode ?? "")
    .trim()
    .toLowerCase();
  if (!LITELLM_TEXT_MODES.has(mode)) return null;
  const input = optionalPrice(raw.input_cost_per_token);
  const output = optionalPrice(raw.output_cost_per_token);
  // 两个 token 价都没有的条目无法计价（4,538 条里约 820 条属于这类）。
  if (input === null && output === null) return null;
  const base = input ?? 0;
  const provider = String(raw.litellm_provider ?? "").trim();
  return {
    id,
    provider,
    slug: id,
    name: id,
    prompt: base,
    completion: output ?? 0,
    cacheRead: optionalPrice(raw.cache_read_input_token_cost) ?? base,
    cacheWrite: optionalPrice(raw.cache_creation_input_token_cost) ?? base,
    // cache_creation_input_token_cost_above_1hr 是「1 小时缓存写」的唯一可靠来源。
    cacheWrite1h: optionalPrice(raw.cache_creation_input_token_cost_above_1hr),
    request: 0,
    tiers: normalizeLiteLLMTiers(raw),
    canonical: id,
    context: Math.max(
      0,
      Math.floor(Number(raw.max_input_tokens ?? raw.max_tokens ?? raw.context_window) || 0),
    ),
    raw: {
      input: priceString(raw.input_cost_per_token),
      output: priceString(raw.output_cost_per_token),
      cacheRead: priceString(raw.cache_read_input_token_cost),
      cacheWrite: priceString(raw.cache_creation_input_token_cost),
      cacheWrite1h: priceString(raw.cache_creation_input_token_cost_above_1hr),
      provider,
    },
  };
}

function normalizeLiteLLMTiers(raw) {
  const thresholds = new Set();
  for (const field of Object.keys(raw)) {
    const match = LITELLM_TIER_FIELD_RE.exec(field) || LITELLM_TIER_FIELD_ALT_RE.exec(field);
    if (match) thresholds.add(Number(match[1]));
  }
  const tiers = [];
  for (const k of [...thresholds].sort((left, right) => left - right)) {
    const names = liteLLMTierFieldNames(k);
    const tier = {
      // 上游字段以千 token 为单位，这里 ×1000 归一成 token。
      above: k * 1000,
      prompt: readFirst(raw, names.prompt),
      completion: readFirst(raw, names.completion),
      cacheRead: readFirst(raw, names.cacheRead),
      cacheWrite: readFirst(raw, names.cacheWrite),
      cacheWrite1h: null,
    };
    if (
      tier.prompt === null &&
      tier.completion === null &&
      tier.cacheRead === null &&
      tier.cacheWrite === null
    ) {
      continue;
    }
    tiers.push(tier);
  }
  return sortTiers(tiers);
}

// 状态里展示的失败原因带上底层错误（网络 / 超时），否则只剩一句泛化提示。
function describeError(error, fallback) {
  const message = error?.message || fallback;
  const cause = error?.details?.cause;
  const causeMessage =
    typeof cause === "string" ? cause : cause && typeof cause === "object" ? cause.message : "";
  if (causeMessage && !message.includes(causeMessage)) return `${message}（${causeMessage}）`;
  return message;
}

async function readPayload(response) {
  if (!response) throw new PricingError("catalog-parse-failed", "价格目录接口返回为空");
  if (typeof response.json === "function") return response.json();
  if (response.body !== undefined) return response.body;
  return response;
}

async function readCatalogPayload(fetchFn, url, label) {
  if (typeof fetchFn !== "function") {
    throw new PricingError("fetch-unavailable", "当前宿主没有可用的 fetch");
  }
  let response;
  try {
    response = await fetchFn(url, { method: "GET", headers: { Accept: "application/json" } });
  } catch (error) {
    throw new PricingError("catalog-request-failed", `请求${label}失败`, {
      cause: error,
    });
  }
  if (response && response.ok === false) {
    throw new PricingError(
      "catalog-http-error",
      `价格目录请求失败（HTTP ${response.status ?? "?"}）`,
      { status: response.status },
    );
  }
  try {
    return await readPayload(response);
  } catch (error) {
    throw new PricingError("catalog-parse-failed", "价格目录响应不是合法 JSON", { cause: error });
  }
}

export async function fetchOpenRouterCatalog(fetchFn, url = OPENROUTER_MODELS_URL) {
  const payload = await readCatalogPayload(fetchFn, url, " OpenRouter 价格目录");
  const data = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : null;
  if (!data) {
    throw new PricingError("catalog-parse-failed", "价格目录响应缺少 data 数组");
  }
  const models = data.map(normalizeCatalogEntry).filter(Boolean);
  if (models.length === 0) {
    throw new PricingError("catalog-empty", "价格目录没有任何可用模型");
  }
  return models;
}

// models.dev 的 api.json 是 { providerId: { models: { modelId: {...} } } }。
export async function fetchModelsDevCatalog(fetchFn, url = MODELS_DEV_URL) {
  const payload = await readCatalogPayload(fetchFn, url, " models.dev 价格目录");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PricingError("catalog-parse-failed", "价格目录响应不是 provider 对象");
  }
  const models = [];
  for (const [providerId, provider] of Object.entries(payload)) {
    const rows = provider && typeof provider === "object" ? provider.models : null;
    if (!rows || typeof rows !== "object") continue;
    for (const raw of Object.values(rows)) {
      const entry = normalizeModelsDevEntry(providerId, raw);
      if (entry) models.push(entry);
    }
  }
  if (models.length === 0) {
    throw new PricingError("catalog-empty", "价格目录没有任何可用模型");
  }
  return models;
}

// 抓取结果附带的实际地址（镜像重试后才与请求地址不同）。
// 用不可枚举属性承载：数组照常参与后续 map/filter/JSON.stringify。
function markSourceUrl(models, sourceUrl) {
  if (!Array.isArray(models) || !sourceUrl) return models;
  Object.defineProperty(models, "sourceUrl", {
    value: sourceUrl,
    enumerable: false,
    configurable: true,
  });
  return models;
}

async function fetchLiteLLMOnce(fetchFn, url) {
  const payload = await readCatalogPayload(fetchFn, url, " LiteLLM 价格目录");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PricingError("catalog-parse-failed", "价格目录响应不是模型对象");
  }
  const models = [];
  for (const [key, raw] of Object.entries(payload)) {
    const entry = normalizeLiteLLMEntry(key, raw);
    if (entry) models.push(entry);
  }
  if (models.length === 0) {
    throw new PricingError("catalog-empty", "价格目录没有任何可用模型");
  }
  return models;
}

// LiteLLM 抓取：默认地址失败时（且用户没有改成自定义地址）用 raw.githubusercontent 再试一次。
// 只兜可达性，不兜新鲜度；仍然受 ensureCatalog 的失败冷却约束。
export async function fetchLiteLLMCatalog(
  fetchFn,
  url = LITELLM_URL,
  { mirrorUrl = LITELLM_MIRROR_URL } = {},
) {
  const target = url || LITELLM_URL;
  try {
    return markSourceUrl(await fetchLiteLLMOnce(fetchFn, target), target);
  } catch (error) {
    if (!mirrorUrl || target !== LITELLM_URL || mirrorUrl === target) throw error;
    try {
      return markSourceUrl(await fetchLiteLLMOnce(fetchFn, mirrorUrl), mirrorUrl);
    } catch {
      // 镜像也失败时保留首次失败的分类与文案，避免把用户引到备用地址上排查。
      throw error;
    }
  }
}

// 来源由设置决定：同一套 URL 也可以指向自建代理，只要响应结构一致。
export async function fetchCatalog(fetchFn, url, source = "openrouter", options = {}) {
  if (source === "modelsdev") return fetchModelsDevCatalog(fetchFn, url ?? MODELS_DEV_URL);
  if (source === "litellm") {
    return fetchLiteLLMCatalog(fetchFn, url ?? LITELLM_URL, {
      mirrorUrl: options.mirrorUrl,
    });
  }
  return fetchOpenRouterCatalog(fetchFn, url);
}

function coerceStoredEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id ?? "").trim();
  if (!id) return null;
  const price = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  };
  const prompt = price(raw.prompt);
  const canonical = String(raw.canonical ?? raw.slug ?? "").trim() || id;
  return {
    id,
    provider: String(raw.provider ?? "").trim(),
    slug: String(raw.slug ?? "").trim() || canonical,
    name: String(raw.name ?? "").trim() || id,
    prompt,
    completion: price(raw.completion),
    cacheRead: price(raw.cacheRead ?? prompt),
    cacheWrite: price(raw.cacheWrite ?? prompt),
    cacheWrite1h: optionalPrice(raw.cacheWrite1h),
    request: price(raw.request),
    tiers: expandTiers(raw.tiers),
    canonical,
    context: Math.max(0, Math.floor(Number(raw.context) || 0)),
    raw: raw.raw && typeof raw.raw === "object" ? raw.raw : {},
  };
}

// 存储形态用定长数组，8.9k 条 models.dev 条目约 1.1 MB；
// 完整字段名的对象形态会膨胀到 3 MB，超出脚本存储的合理体积。
// 顺序（v2 只在尾部追加，旧版本读新缓存时忽略第 10/11 位）：
// id, provider, name(与 id 相同则为空), prompt, completion, cacheRead, cacheWrite, request, canonical,
// cacheWrite1h | null, tiers | null
function compactTier(tier) {
  return [
    tier.above,
    tier.prompt,
    tier.completion,
    tier.cacheRead,
    tier.cacheWrite,
    tier.cacheWrite1h,
  ];
}

// 公开的紧凑条目（v2，11 列）。null 必须原样保留：JSON 里 null 与 0 语义不同。
export function compactEntry(entry) {
  return [
    entry.id,
    entry.provider || "",
    entry.name && entry.name !== entry.id ? entry.name : "",
    entry.prompt,
    entry.completion,
    entry.cacheRead,
    entry.cacheWrite,
    entry.request,
    entry.canonical || "",
    entry.cacheWrite1h ?? null,
    Array.isArray(entry.tiers) && entry.tiers.length > 0 ? entry.tiers.map(compactTier) : null,
  ];
}

function expandTier(raw) {
  if (Array.isArray(raw)) {
    const [above, prompt, completion, cacheRead, cacheWrite, cacheWrite1h] = raw;
    const size = Number(above);
    if (!Number.isFinite(size) || size < 0) return null;
    return {
      above: Math.floor(size),
      prompt: optionalPrice(prompt),
      completion: optionalPrice(completion),
      cacheRead: optionalPrice(cacheRead),
      cacheWrite: optionalPrice(cacheWrite),
      cacheWrite1h: optionalPrice(cacheWrite1h),
    };
  }
  if (raw && typeof raw === "object") {
    const size = Number(raw.above);
    if (!Number.isFinite(size) || size < 0) return null;
    return {
      above: Math.floor(size),
      prompt: optionalPrice(raw.prompt),
      completion: optionalPrice(raw.completion),
      cacheRead: optionalPrice(raw.cacheRead),
      cacheWrite: optionalPrice(raw.cacheWrite),
      cacheWrite1h: optionalPrice(raw.cacheWrite1h),
    };
  }
  return null;
}

function expandTiers(raw) {
  if (!Array.isArray(raw)) return [];
  return sortTiers(raw.map(expandTier).filter(Boolean));
}

// 9 列（v1）、10 列、11 列（v2）与对象形态都接受；旧缓存原样可用。
export function expandStoredEntry(raw) {
  if (Array.isArray(raw)) {
    const [id, provider, name, prompt, completion, cacheRead, cacheWrite, request, canonical] = raw;
    const text = String(id ?? "").trim();
    if (!text) return null;
    const price = (value) => {
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? number : 0;
    };
    const base = price(prompt);
    const identity = String(canonical ?? "").trim() || text;
    return {
      id: text,
      provider: String(provider ?? "").trim(),
      slug: identity,
      name: String(name ?? "").trim() || text,
      prompt: base,
      completion: price(completion),
      cacheRead: cacheRead === undefined || cacheRead === null ? base : price(cacheRead),
      cacheWrite: cacheWrite === undefined || cacheWrite === null ? base : price(cacheWrite),
      // 第 10 位：旧 9 列缓存没有这一列，缺失即 null（不是 0）。
      cacheWrite1h: raw.length >= 10 ? optionalPrice(raw[9]) : null,
      request: price(request),
      // 第 11 位：缺失即空档位，价格与旧版本完全一致。
      tiers: raw.length >= 11 ? expandTiers(raw[10]) : [],
      canonical: identity,
      context: 0,
      raw: {},
    };
  }
  return coerceStoredEntry(raw);
}

// 存储记录保留紧凑形态：读元信息与展开条目分开，避免为了判断新鲜度而展开整份目录。
async function readCatalogRecord(storage, key) {
  if (!storage || typeof storage.getJson !== "function") return null;
  let record;
  try {
    record = await storage.getJson(key);
  } catch {
    return null;
  }
  if (!record || typeof record !== "object") return null;
  return record;
}

// 失败只补三个字段，不经过 saveCatalog：fetchedAt 与 models 必须保持上次成功的内容，
// 否则「目录更新于」会被改写成失败时刻，TTL 语义也会被污染。
async function rememberCatalogFailure(storage, key, stored, meta) {
  if (!storage || typeof storage.setJson !== "function") return;
  const base =
    stored && typeof stored === "object"
      ? stored
      : {
          fetchedAt: 0,
          source: "none",
          provider: meta.provider || "",
          url: meta.url || "",
          count: 0,
          models: [],
        };
  try {
    await storage.setJson(key, {
      ...base,
      failedAt: meta.failedAt,
      failedError: meta.failedError,
      // 失败记录绑定本次尝试的地址：base.url 是这份目录自己的来源，两者不能混用。
      failedUrl: meta.url || "",
    });
  } catch {
    // 失败状态写不进去时最多多试一次，不影响本次返回值。
  }
}

// 记录级元信息（schema / tierInclusive / 来源）同时挂到 models 数组上：
// engine 现在只把 catalog.models 传给计价函数，挂属性后不需要改动调用点也能读到档位语义。
function attachCatalogMeta(models, meta) {
  if (!Array.isArray(models)) return models;
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    Object.defineProperty(models, key, {
      value,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return models;
}

function resolveTierInclusive(record) {
  const schema = Number(record?.schema) || 0;
  if (schema >= CATALOG_SCHEMA && typeof record?.tierInclusive === "boolean") {
    return record.tierInclusive;
  }
  // 旧记录没有 schema：OpenRouter 地址按 >= 解释，其余按 > 解释。
  return isTierInclusiveSource(record?.provider || record?.source, record?.url);
}

function expandCatalog(record) {
  if (!record) return null;
  const models = Array.isArray(record.models)
    ? record.models.map(expandStoredEntry).filter(Boolean)
    : [];
  if (models.length === 0) return null;
  const tierInclusive = resolveTierInclusive(record);
  const meta = {
    fetchedAt: Number(record.fetchedAt) || 0,
    source: String(record.source ?? "cache"),
    provider: String(record.provider ?? ""),
    url: String(record.url ?? ""),
    schema: Number(record.schema) || 0,
    tierInclusive,
    mirror: Boolean(record.mirror),
    resolvedUrl: String(record.resolvedUrl ?? ""),
  };
  attachCatalogMeta(models, meta);
  return {
    ...meta,
    count: models.length,
    models,
  };
}

export async function loadCatalog(storage, key = STORAGE_KEYS.catalog) {
  return expandCatalog(await readCatalogRecord(storage, key));
}

export async function saveCatalog(storage, catalog, meta = {}) {
  const models = (Array.isArray(catalog) ? catalog : []).filter((entry) => entry && entry.id);
  const provider = meta.provider || "";
  const url = meta.url || "";
  const tierInclusive =
    typeof meta.tierInclusive === "boolean"
      ? meta.tierInclusive
      : isTierInclusiveSource(provider || meta.source, url);
  const record = {
    fetchedAt: readNow(meta.fetchedAt),
    source: meta.source || "network",
    provider,
    url,
    count: models.length,
    models,
    // 记录格式版本与档位比较语义：v2 起写进记录，旧版本读到会忽略。
    schema: CATALOG_SCHEMA,
    tierInclusive,
    mirror: Boolean(meta.mirror),
    resolvedUrl: meta.resolvedUrl || "",
    // 成功即清掉失败状态：冷却只看失败时间，不能残留上一轮的失败原因。
    failedAt: 0,
    failedError: "",
    failedUrl: "",
  };
  const key = meta.key || STORAGE_KEYS.catalog;
  if (storage && typeof storage.setJson === "function") {
    await storage.setJson(key, { ...record, models: models.map(compactEntry) });
  }
  return record;
}

// 带 TTL 的目录保障：并发去重；失败时保留旧目录并标记 stale / error。
export async function ensureCatalog(options = {}) {
  const {
    force = false,
    now,
    fetchFn,
    storage,
    url = OPENROUTER_MODELS_URL,
    source = "openrouter",
    key: catalogKey = STORAGE_KEYS.catalog,
    ttlMs = CATALOG_TTL_MS,
    retryMs = CATALOG_RETRY_MS,
    mirrorUrl = LITELLM_MIRROR_URL,
    minEntries = CATALOG_MIN_ENTRIES,
  } = options;
  const stamp = readNow(now);
  const stored = await readCatalogRecord(storage, catalogKey);
  // 失败记录只补 failedAt / failedError / failedUrl、不改 fetchedAt：命中缓存时也要把最近一次失败带出去，
  // 否则下一轮自动刷新会把「本次刷新失败」显示成「已同步」。
  const failedAt = Number(stored?.failedAt) || 0;
  const failedError = String(stored?.failedError || "") || null;
  const failedUrl = String(stored?.failedUrl || "");
  const storedUrl = String(stored?.url || "");
  const storedUrlMatches = !storedUrl || storedUrl === url;
  // 旧记录没有 failedUrl：仅在缓存来源与当前地址一致时才把失败算到当前地址上。
  const failureTargetsUrl = failedUrl ? failedUrl === url : storedUrlMatches;
  const lastAttemptFailed =
    failureTargetsUrl && failedAt > 0 && failedAt > (Number(stored?.fetchedAt) || 0);
  const comboKey = `${source}|${catalogKey}|${url}`;
  const memo = memoOf(storage);
  const memoBase = memo ? memo.get(comboKey) : null;
  // 内存副本只在存储记录仍是同一份（同一写入时间与地址）时才复用：
  // 既避免为判断新鲜度展开整份目录，也不会在清缓存或其它窗口更新后读到旧值。
  if (memoBase && !force && wasWrittenBy(stored, memoBase)) {
    const memoAge = stamp - memoBase.fetchedAt;
    // fetchedAt 为 0 的记录来自「无缓存且请求失败」，不能当作新鲜目录复用。
    if (memoBase.fetchedAt > 0 && memoAge >= 0 && memoAge < ttlMs) {
      return lastAttemptFailed
        ? { ...memoBase, stale: true, error: failedError }
        : { ...memoBase, stale: false, error: null };
    }
  }

  const cached = expandCatalog(stored);
  const age = cached ? stamp - cached.fetchedAt : Number.POSITIVE_INFINITY;
  // 同一份缓存换了地址（例如自建代理）就不能复用，否则会一直用旧源的价格。
  const sameUrl = !cached || !cached.url || cached.url === url;
  // 缓存来自另一个地址：换源失败时不能拿它计价，宁可显示无价格。
  const foreignCache = Boolean(cached && !sameUrl);
  if (cached && sameUrl && !force && age >= 0 && age < ttlMs) {
    if (memo) memo.set(comboKey, baseOf(cached));
    return lastAttemptFailed
      ? { ...cached, stale: true, error: failedError }
      : { ...cached, stale: false, error: null };
  }

  // 失败冷却：上次同步失败后，重试窗口内直接复用当前目录，避免每个自动刷新周期都重打接口。
  // force 表示用户主动刷新，必须绕过冷却；冷却绑定本次失败的目标地址，换地址后第一次失败也能生效。
  const failedAge = stamp - failedAt;
  if (!force && failureTargetsUrl && failedAt > 0 && failedAge >= 0 && failedAge < retryMs) {
    const message = String(stored.failedError || "") || null;
    if (cached && !foreignCache) return { ...cached, stale: true, error: message };
    return {
      fetchedAt: 0,
      source: "none",
      provider: source,
      url,
      count: 0,
      models: attachCatalogMeta([], {
        fetchedAt: 0,
        source: "none",
        provider: source,
        url,
        schema: 0,
        tierInclusive: isTierInclusiveSource(source, url),
      }),
      stale: true,
      error: message,
      urlMismatch: foreignCache,
      tierInclusive: isTierInclusiveSource(source, url),
    };
  }

  // 在途请求只按数据身份去重：强制刷新复用同一在途请求，避免同一 URL 并发下载两份目录。
  const inflightKey = `${source}|${catalogKey}|${url}`;
  const existing = storage && typeof storage === "object" ? INFLIGHT.get(storage) : null;
  if (existing && existing.key === inflightKey) return existing.promise;

  const promise = (async () => {
    try {
      const models = await fetchCatalog(fetchFn, url, source, {
        mirrorUrl: source === "litellm" ? mirrorUrl : "",
      });
      const usedUrl = typeof models.sourceUrl === "string" && models.sourceUrl ? models.sourceUrl : url;
      // 残缺目录保护：只在「会覆盖一份健康缓存」时判定，避免把自定义小目录直接判死。
      // 上游错误页 / 半截 JSON 通常既解析不出 JSON，也会显著少于上一次成功的条数。
      const previousCount = Array.isArray(stored?.models) ? stored.models.length : 0;
      const threshold = Number.isFinite(minEntries) ? Number(minEntries) : CATALOG_MIN_ENTRIES;
      if (threshold > 0 && models.length < threshold && previousCount >= threshold) {
        throw new PricingError(
          "catalog-empty",
          `价格目录只有 ${models.length} 条（少于 ${threshold}），保留上一份目录`,
        );
      }
      const record = await saveCatalog(storage, models, {
        fetchedAt: stamp,
        source: "network",
        provider: source,
        url,
        key: catalogKey,
        mirror: usedUrl !== url,
        resolvedUrl: usedUrl,
      });
      attachCatalogMeta(record.models, {
        fetchedAt: record.fetchedAt,
        source: record.source,
        provider: record.provider,
        url: record.url,
        schema: record.schema,
        tierInclusive: record.tierInclusive,
        mirror: record.mirror,
        resolvedUrl: record.resolvedUrl,
      });
      // 网络结果就是这份存储记录的内容，可直接作为下一轮的内存副本。
      if (memo) memo.set(comboKey, baseOf(record));
      return {
        fetchedAt: record.fetchedAt,
        source: record.source,
        provider: record.provider,
        url,
        count: record.count,
        models: record.models,
        schema: record.schema,
        tierInclusive: record.tierInclusive,
        mirror: record.mirror,
        resolvedUrl: record.resolvedUrl,
        stale: false,
        error: null,
      };
    } catch (error) {
      const message = describeError(error, "价格目录同步失败");
      await rememberCatalogFailure(storage, catalogKey, stored, {
        failedAt: stamp,
        failedError: message,
        provider: source,
        url,
      });
      if (cached && !foreignCache) {
        // 保留旧目录：内存副本换成解析后的引用，后续重算成本仍共用同一数组。
        if (memo) memo.set(comboKey, baseOf(cached));
        return { ...cached, stale: true, error: message };
      }
      // 换地址失败：旧目录属于另一个来源，不能计价，也不写进新地址的内存副本。
      return {
        fetchedAt: 0,
        source: "none",
        provider: source,
        url,
        count: 0,
        models: attachCatalogMeta([], {
          fetchedAt: 0,
          source: "none",
          provider: source,
          url,
          schema: 0,
          tierInclusive: isTierInclusiveSource(source, url),
        }),
        schema: 0,
        tierInclusive: isTierInclusiveSource(source, url),
        stale: true,
        error: message,
        urlMismatch: foreignCache,
      };
    }
  })();

  if (storage && typeof storage === "object") {
    INFLIGHT.set(storage, { key: inflightKey, promise });
    promise
      .finally(() => {
        const current = INFLIGHT.get(storage);
        if (current && current.promise === promise) INFLIGHT.delete(storage);
      })
      .catch(() => {
        // 失败已在返回值里体现，这里只避免 finally 链产生未处理的拒绝。
      });
  }
  return promise;
}
