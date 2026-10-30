// 价格目录：两种来源的抓取、精简、持久化与 TTL 缓存。
// OpenRouter 的 pricing 字段是 USD/token 的十进制字符串；
// models.dev 的 cost 是 USD / 百万 token，读取时统一换算成 USD/token。
// 缺失价按约定回退：input_cache_read / input_cache_write → prompt，request 缺省 0。
// 不使用 internal_reasoning（无法区分推理 token），也不应用 pricing.overrides（条件价）。
// models.dev 的上下文分层价（tiers）不参与计算：用量域只有周期聚合，无法按请求选档。
import {
  CATALOG_RETRY_MS,
  CATALOG_TTL_MS,
  MODELS_DEV_URL,
  OPENROUTER_MODELS_URL,
  STORAGE_KEYS,
} from "./constants.js";

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

function priceString(value) {
  return value === null || value === undefined ? "" : String(value);
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
    request: parsePrice(pricing.request, 0),
    canonical,
    context: Math.max(0, Math.floor(Number(raw.context_length) || 0)),
    raw: {
      prompt: priceString(pricing.prompt),
      completion: priceString(pricing.completion),
      cacheRead: priceString(pricing.input_cache_read),
      cacheWrite: priceString(pricing.input_cache_write),
      request: priceString(pricing.request),
    },
  };
}

// models.dev 的价格以百万 token 计价，统一除以 1e6 后与 OpenRouter 口径一致。
const MODELS_DEV_UNIT = 1e6;

// cost.cache_write 明确写 0（如智谱）表示不收费；只有字段缺失才回退到输入价。
function perToken(value, fallbackUsd) {
  if (value === undefined || value === null || value === "") return fallbackUsd;
  return parsePrice(value, 0) / MODELS_DEV_UNIT;
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
    request: 0,
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

// 来源由设置决定：同一套 URL 也可以指向自建代理，只要响应结构一致。
export async function fetchCatalog(fetchFn, url, source = "openrouter") {
  return source === "modelsdev"
    ? fetchModelsDevCatalog(fetchFn, url ?? MODELS_DEV_URL)
    : fetchOpenRouterCatalog(fetchFn, url);
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
    request: price(raw.request),
    canonical,
    context: Math.max(0, Math.floor(Number(raw.context) || 0)),
    raw: raw.raw && typeof raw.raw === "object" ? raw.raw : {},
  };
}

// 存储形态用定长数组，8922 条 models.dev 条目约 900 KB；
// 完整字段名的对象形态会膨胀到 3 MB，超出脚本存储的合理体积。
// 顺序：id, provider, name(与 id 相同则为空), prompt, completion, cacheRead, cacheWrite, request, canonical
function compactEntry(entry) {
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
  ];
}

function expandStoredEntry(raw) {
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
      request: price(request),
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

// 失败只补两个字段，不经过 saveCatalog：fetchedAt 与 models 必须保持上次成功的内容，
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

function expandCatalog(record) {
  if (!record) return null;
  const models = Array.isArray(record.models)
    ? record.models.map(expandStoredEntry).filter(Boolean)
    : [];
  if (models.length === 0) return null;
  return {
    fetchedAt: Number(record.fetchedAt) || 0,
    source: String(record.source ?? "cache"),
    provider: String(record.provider ?? ""),
    url: String(record.url ?? ""),
    count: models.length,
    models,
  };
}

export async function loadCatalog(storage, key = STORAGE_KEYS.catalog) {
  return expandCatalog(await readCatalogRecord(storage, key));
}

export async function saveCatalog(storage, catalog, meta = {}) {
  const models = (Array.isArray(catalog) ? catalog : []).filter((entry) => entry && entry.id);
  const record = {
    fetchedAt: readNow(meta.fetchedAt),
    source: meta.source || "network",
    provider: meta.provider || "",
    url: meta.url || "",
    count: models.length,
    models,
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
      models: [],
      stale: true,
      error: message,
      urlMismatch: foreignCache,
    };
  }

  // 在途请求只按数据身份去重：强制刷新复用同一在途请求，避免同一 URL 并发下载两份目录。
  const inflightKey = `${source}|${catalogKey}|${url}`;
  const existing = storage && typeof storage === "object" ? INFLIGHT.get(storage) : null;
  if (existing && existing.key === inflightKey) return existing.promise;

  const promise = (async () => {
    try {
      const models = await fetchCatalog(fetchFn, url, source);
      const record = await saveCatalog(storage, models, {
        fetchedAt: stamp,
        source: "network",
        provider: source,
        url,
        key: catalogKey,
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
        models: [],
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
