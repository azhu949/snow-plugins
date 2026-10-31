// 模型匹配：用量里的模型名（常是代理别名）→ 价格目录条目。
// 统一流水线（所有目录共用，不再有 multiProvider 门）：
//   M0 手工映射 → M1 精确 → M2 渠道 → M3 身份（裸 id）→ M4 身份（canonical）
//   → M5 归一化 token → M6 连续子序列 → M7 Bedrock 区域 → M8 版本后缀
//   → M9 -latest → M10 日期后缀 → M11 渠道前缀 → M12 未匹配。
// M9/M10/M11 以及「无共识价」「usage 是条目 token 的真子集」记为 guess：
// 计入金额但不算覆盖率分子（见 cost.js），避免把猜测当成可信价格。
// 歧义仍然返回 unmatched 并要求手动映射，绝不猜。
import {
  CANDIDATE_LIMIT,
  FUZZY_MIN_TOKENS,
  IGNORE_MAPPING,
  MATCH_CONSENSUS_SHARE,
} from "./constants.js";

const NON_TOKEN_RE = /[^a-z0-9.]+/g;
const EDGE_DOTS_RE = /^\.+|\.+$/g;
const VARIANT_RE = /:([a-z0-9._-]+)/i;
const PAREN_RE = /\([^)]*\)/g;
const BRACKET_RE = /\[[^\]]*\]/g;
const TAG_RE = /:.*$/;
// Bedrock 区域前缀：us. / eu. / apac. / jp. / au. / ca. / in. / global. / us-gov.
const REGION_PREFIX_RE = /^(?:us-gov|us|eu|apac|jp|au|ca|in|global|sa|me|af|il)\./i;
// 版本后缀：-v1 / -v1:0 / -v1.0 / -v1-0。Bedrock 的 inference profile 都带这一段。
const VERSION_SUFFIX_RE = /-v\d+(?:[.:-]\d+)*$/i;
const LATEST_SUFFIX_RE = /-latest$/i;
// 日期后缀：-20250929 或 -2025-09-29。
const COMPACT_DATE_SUFFIX_RE = /-(?:19|20)\d{6}$/;
const ISO_DATE_SUFFIX_RE = /-\d{4}-\d{2}-\d{2}$/;
// 渠道 / 代理前缀：2-24 个字符的纯字母数字段 + 分隔符。必须命中已知模型才采用。
const PROVIDER_PREFIX_RE = /^[a-z][a-z0-9]{1,23}[-.]/i;

const PRICED_STATUSES = Object.freeze([
  "exact",
  "normalized",
  "fuzzy",
  "manual",
  "provider",
  "canonical",
  // 用户声明的绝对价（prices.js 合成，matchModel 永不返回）：可信价格，计入覆盖率分子。
  "custom",
]);
// guess 计入金额，但不计入覆盖率分子。
const PRICE_USABLE_STATUSES = Object.freeze([...PRICED_STATUSES, "guess"]);

// 小写后按非字母数字切分，保留点号用于版本号（v4.1 / 5.3）。
export function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(NON_TOKEN_RE, " ")
    .split(" ")
    .map((token) => token.replace(EDGE_DOTS_RE, ""))
    .filter((token) => token.length > 0);
}

// 去掉厂商前缀（第一个 / 之前的部分）。
export function stripVendor(value) {
  const text = String(value ?? "");
  const index = text.indexOf("/");
  return index >= 0 ? text.slice(index + 1) : text;
}

// 变体后缀：:free / :batch / :thinking 等。
// 纯数字标签（Bedrock inference profile 的 ...-v1:0）是版本号，不是条目变体，不能当成变体筛掉。
export function variantOf(value) {
  const match = VARIANT_RE.exec(String(value ?? ""));
  if (!match) return "";
  const tag = match[1].toLowerCase();
  if (/^\d+$/.test(tag)) return "";
  return tag;
}

function sameTokens(left, right) {
  return (
    left.length > 0 &&
    left.length === right.length &&
    left.every((token, index) => token === right[index])
  );
}

// usage token 是否是条目 token 的前缀（缺少版本 / 规格 token 的情形）。
function isTokenPrefix(shortList, longList) {
  if (shortList.length === 0 || shortList.length >= longList.length) return false;
  for (let index = 0; index < shortList.length; index += 1) {
    if (shortList[index] !== longList[index]) return false;
  }
  return true;
}

function findContiguous(haystack, needle) {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return start;
  }
  return -1;
}

export function mappingKey(model) {
  return String(model ?? "")
    .trim()
    .toLowerCase();
}

export function resolveMapping(mappings, model) {
  if (!mappings || typeof mappings !== "object") return null;
  const key = mappingKey(model);
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(mappings, key)) return mappings[key];
  for (const rawKey of Object.keys(mappings)) {
    if (mappingKey(rawKey) === key) return mappings[rawKey];
  }
  return null;
}

// 手工映射值：models.dev 用 provider/id 固定渠道；OpenRouter（provider 为空）仍是裸 id。
export function mappingValueOf(id, provider) {
  const entryId = String(id ?? "").trim();
  if (!entryId) return "";
  const owner = String(provider ?? "").trim();
  return owner ? `${owner}/${entryId}` : entryId;
}

// 手工映射解析：完整 id（精确 → 忽略大小写）→ provider/id → canonical。
// 完整 id 先匹配，保证 OpenRouter 那种自带斜杠的 id 不被误判成「渠道 + 模型」；
// 旧映射值（裸 id）继续按原先「取目录里第一条」的语义生效。
function findMappingEntry(entries, target) {
  const exact = entries.find((item) => item.id === target);
  if (exact) return exact;

  const slash = target.indexOf("/");
  if (slash > 0 && slash < target.length - 1) {
    const provider = target.slice(0, slash).trim().toLowerCase();
    const entryId = target.slice(slash + 1).trim().toLowerCase();
    if (provider && entryId) {
      const scoped = entries.find(
        (item) =>
          String(item.provider ?? "").toLowerCase() === provider &&
          String(item.id ?? "").toLowerCase() === entryId,
      );
      if (scoped) return scoped;
    }
  }

  const lowerTarget = target.toLowerCase();
  const folded = entries.find((item) => item.id.toLowerCase() === lowerTarget);
  if (folded) return folded;
  return entries.find((item) => String(item.canonical ?? "").toLowerCase() === lowerTarget) || null;
}

// 别名条目（id 以 ~ 开头）永不参与；变体必须与 usage 完全一致：
// 无变体 usage 只匹配无变体条目，:free / :batch 绝不能落到普通（付费）条目上。
function isEligible(entry, usageVariant) {
  const id = String(entry?.id ?? "");
  if (!id || id.startsWith("~")) return false;
  return variantOf(id) === usageVariant;
}

function candidateOf(entry, score, matchedBy) {
  return {
    entryId: entry.id,
    provider: entry.provider || "",
    name: entry.name,
    score,
    matchedBy,
  };
}

function sortCandidates(list) {
  return list.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.entryId.localeCompare(right.entryId);
  });
}

function buildResult(status, options = {}) {
  return {
    status,
    entryId: options.entry?.id ?? "",
    entry: options.entry ?? null,
    confidence: options.confidence ?? 0,
    candidates: (options.candidates ?? []).slice(0, CANDIDATE_LIMIT),
    reason: options.reason ?? "",
    matchedBy: options.matchedBy ?? "",
  };
}

export function isPricedStatus(status) {
  return PRICED_STATUSES.includes(status);
}

// 取价用：可信状态 + guess。覆盖率分子仍用 isPricedStatus（语义不变）。
export function hasUsablePrice(status) {
  return PRICE_USABLE_STATUSES.includes(status);
}

// 模型身份：去掉最后一段路径、括号 / 方括号 / 冒号变体，点号与分隔符统一成横线。
// 让 deepseek-v4.1-flash、z-ai/glm-5.3:free、workbuddy-ai/x 落到同一个模型上。
export function bareModelId(value) {
  let text = String(value ?? "").trim().toLowerCase();
  const slash = text.lastIndexOf("/");
  if (slash >= 0) text = text.slice(slash + 1);
  text = text.replace(PAREN_RE, "").replace(BRACKET_RE, "").replace(TAG_RE, "");
  text = text.replace(/\./g, "-");
  return text
    .replace(NON_TOKEN_RE, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = bareModelId(entry.canonical || entry.id);
    if (!key) continue;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(entry);
  }
  return groups;
}

// 同一个 id 出现在多个渠道下（deepseek-v4.1-flash 在 kilo / vercel / deepinfra 都有）：
// 这类分组比 canonical 更可靠，因为 id 相同就是同一模型，不会混进 -fast / :thinking 变体。
function idGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = bareModelId(entry.id);
    if (!key) continue;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(entry);
  }
  return groups;
}

function promptPrice(entry) {
  const value = Number(entry?.prompt);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// 同一模型跨渠道的代表价：取有价条目输入单价的中位数，
// 避免促销价或订阅套餐（cost 全 0）把结果拉到极值。
function representativeOf(list) {
  const priced = list.filter((entry) => Number(entry.prompt) > 0 || Number(entry.completion) > 0);
  const pool = priced.length > 0 ? priced : list;
  const sorted = [...pool].sort((left, right) => {
    const lp = Number(left.prompt) || 0;
    const rp = Number(right.prompt) || 0;
    if (lp !== rp) return lp - rp;
    const lc = Number(left.completion) || 0;
    const rc = Number(right.completion) || 0;
    if (lc !== rc) return lc - rc;
    return String(left.id).localeCompare(String(right.id));
  });
  return sorted[Math.floor(sorted.length / 2)];
}

// 身份层的价格共识：组内输入价落在中位数 ±5% 的条目占比。
// 价差倍数会误伤「同价但条目多」的大模型（claude-opus-4-8 价差 13x 但 89% 同价），
// 而 qwen3-14b 这类真离散的组共识只有 11% —— 共识比例才是正确判据。
function consensusOf(list) {
  if (!Array.isArray(list) || list.length === 0) return { ok: false, share: 0, median: 0 };
  const priced = list.filter((entry) => promptPrice(entry) > 0 || Number(entry?.completion) > 0);
  const pool = priced.length > 0 ? priced : list;
  const prices = pool.map(promptPrice).sort((left, right) => left - right);
  const median = prices[Math.floor(prices.length / 2)];
  const tolerance = Math.abs(median) * 0.05;
  const agree = pool.filter((entry) => Math.abs(promptPrice(entry) - median) <= tolerance).length;
  const share = agree / list.length;
  return { ok: share >= MATCH_CONSENSUS_SHARE, share, median };
}

// 目录索引按目录数组缓存：一次刷新内多个模型共用同一份分组、token 索引与结果缓存。
const INDEX_CACHE = new WeakMap();
// 没有手工映射时用同一个哨兵对象，保证结果缓存可命中。
const NO_MAPPINGS = Object.freeze({});

// 每条目录条目的 token 只取决于自身且创建后不再改写：按条目对象缓存，
// 避免每条用量模型都重新 token 化整份目录（8.5k 条目录下这是主要开销）。
const ENTRY_TOKENS = new WeakMap();

function tokensOf(entry) {
  let cached = ENTRY_TOKENS.get(entry);
  if (!cached) {
    cached = { id: tokenize(stripVendor(entry.id)), name: tokenize(entry.name) };
    ENTRY_TOKENS.set(entry, cached);
  }
  return cached;
}

function pushTo(map, key, entry) {
  if (!key) return;
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  list.push(entry);
}

function tokenKeyOf(tokens) {
  return tokens.length > 0 ? tokens.join("\u0000") : "";
}

function catalogIndex(catalog) {
  const source = Array.isArray(catalog)
    ? catalog
    : Array.isArray(catalog?.models)
      ? catalog.models
      : [];
  if (!catalog || typeof catalog !== "object") {
    return emptyIndex();
  }
  const cached = INDEX_CACHE.get(catalog);
  if (cached) return cached;
  const entries = source.filter((entry) => entry && entry.id);
  // 身份分组与折叠只用无变体、非别名条目：:free / :batch 与 ~ 别名不得充当正文模型。
  const plain = entries.filter((entry) => isEligible(entry, ""));
  const index = {
    entries,
    plain,
    exact: new Map(),
    byId: idGroups(plain),
    byCanonical: canonicalGroups(plain),
    byProvider: new Map(),
    byIdTokens: new Map(),
    byNameTokens: new Map(),
    maps: new WeakMap(),
  };
  for (const entry of plain) {
    const lowerId = String(entry.id).toLowerCase();
    if (!index.exact.has(lowerId)) index.exact.set(lowerId, entry);
    const lowerSlug = String(entry.slug ?? "").toLowerCase();
    if (lowerSlug && !index.exact.has(lowerSlug)) index.exact.set(lowerSlug, entry);
    const provider = String(entry.provider ?? "")
      .trim()
      .toLowerCase();
    if (provider) pushTo(index.byProvider, provider, entry);
    const tokens = tokensOf(entry);
    pushTo(index.byIdTokens, tokenKeyOf(tokens.id), entry);
    pushTo(index.byNameTokens, tokenKeyOf(tokens.name), entry);
  }
  INDEX_CACHE.set(catalog, index);
  return index;
}

function emptyIndex() {
  return {
    entries: [],
    plain: [],
    exact: new Map(),
    byId: new Map(),
    byCanonical: new Map(),
    byProvider: new Map(),
    byIdTokens: new Map(),
    byNameTokens: new Map(),
    maps: new WeakMap(),
  };
}

function resultCacheOf(index, mappings) {
  const key = mappings && typeof mappings === "object" ? mappings : NO_MAPPINGS;
  let map = index.maps.get(key);
  if (!map) {
    map = new Map();
    index.maps.set(key, map);
  }
  return map;
}

// 精确 → 归一化 → 连续子序列；在给定条目集合内完成，供渠道子集复用。
function matchWithin(usage, entries, usageTokens) {
  if (entries.length === 0) return buildResult("unmatched", { reason: "empty-catalog" });
  const lower = usage.toLowerCase();

  // 精确：usage 名与 id 或 slug 忽略大小写相等。
  const exact = entries.find(
    (entry) =>
      entry.id.toLowerCase() === lower || String(entry.slug ?? "").toLowerCase() === lower,
  );
  if (exact) {
    return buildResult("exact", {
      entry: exact,
      confidence: 1,
      candidates: [candidateOf(exact, usageTokens.length, "exact")],
      matchedBy: "exact",
    });
  }

  // 归一化：忽略厂商前缀后 id token 序列，或 name token 序列完全一致。
  const normalized = entries.filter((entry) => {
    const tokens = tokensOf(entry);
    return sameTokens(usageTokens, tokens.id) || sameTokens(usageTokens, tokens.name);
  });
  if (normalized.length === 1) {
    return buildResult("normalized", {
      entry: normalized[0],
      confidence: 0.92,
      candidates: [candidateOf(normalized[0], usageTokens.length, "normalized")],
      matchedBy: "tokens",
    });
  }
  if (normalized.length > 1) {
    return buildResult("unmatched", {
      reason: "ambiguous",
      candidates: sortCandidates(
        normalized.map((entry) => candidateOf(entry, usageTokens.length, "normalized")),
      ),
    });
  }

  // 连续子序列：代理前缀 / 区域 / 日期 / 噪声 token 允许出现在两端。
  const scored = [];
  for (const entry of entries) {
    const { id: idTokens, name: nameTokens } = tokensOf(entry);
    const idScore = findContiguous(usageTokens, idTokens) >= 0 ? idTokens.length : 0;
    const nameScore = findContiguous(usageTokens, nameTokens) >= 0 ? nameTokens.length : 0;
    const score = Math.max(idScore, nameScore);
    if (score >= FUZZY_MIN_TOKENS) {
      scored.push(candidateOf(entry, score, idScore >= nameScore ? "id" : "name"));
    }
  }
  if (scored.length === 0) return buildResult("unmatched", { reason: "no-candidate" });

  sortCandidates(scored);
  const best = scored[0].score;
  const top = scored.filter((candidate) => candidate.score === best);
  if (top.length > 1) {
    return buildResult("unmatched", { reason: "ambiguous", candidates: top });
  }
  const winner = entries.find(
    (entry) =>
      entry.id === top[0].entryId && String(entry.provider ?? "") === String(top[0].provider ?? ""),
  );
  if (!winner) return buildResult("unmatched", { reason: "no-candidate", candidates: scored });
  const confidence =
    Math.min(0.85, Math.round((0.55 + 0.3 * (best / Math.max(1, usageTokens.length))) * 100) / 100);
  return buildResult("fuzzy", {
    entry: winner,
    confidence,
    candidates: scored,
    matchedBy: "contiguous",
  });
}

// usage 形如 vendor/model 时，先在该渠道自己的条目里找，命中就用该渠道挂牌价。
function matchByProvider(usage, index, usageTokens) {
  const slash = usage.indexOf("/");
  if (slash <= 0) return null;
  const provider = usage.slice(0, slash).trim().toLowerCase();
  if (!provider) return null;
  const scoped = index.byProvider.get(provider);
  if (!scoped || scoped.length === 0) return null;
  const result = matchWithin(usage, scoped, usageTokens);
  if (!isPricedStatus(result.status)) return null;
  return { ...result, status: "provider", confidence: Math.min(result.confidence, 0.95) };
}

// 身份层：先裸 id 分组（同 id 多渠道），再 canonical 分组。
function identityOf(index, text) {
  const key = bareModelId(text);
  if (!key) return null;
  const byId = index.byId.get(key);
  if (byId && byId.length > 0) return { group: byId, kind: "id" };
  const byCanonical = index.byCanonical.get(key);
  if (byCanonical && byCanonical.length > 0) return { group: byCanonical, kind: "canonical" };
  return null;
}

// 身份命中的状态判定：M9/M10/M11 与「无共识价」「token 真子集」一律降级为 guess。
function identityResult(found, usageTokens, options = {}) {
  const { guess = false, step = "", confidence = 0 } = options;
  const list = found.group;
  const entry = representativeOf(list);
  const tokens = tokensOf(entry);
  const consensus = consensusOf(list);
  const sameAsTokens =
    list.length === 1 && (sameTokens(usageTokens, tokens.id) || sameTokens(usageTokens, tokens.name));
  const subset = isTokenPrefix(usageTokens, tokens.id);

  let status = "canonical";
  let level = list.length > 1 ? (found.kind === "id" ? 0.85 : 0.8) : found.kind === "id" ? 0.9 : 0.8;
  let reason = "";

  if (guess) {
    status = "guess";
    level = confidence || 0.6;
    reason = step || "guess";
  } else if (!consensus.ok) {
    status = "guess";
    level = 0.5;
    reason = "no-consensus";
  } else if (sameAsTokens) {
    status = "normalized";
    level = 0.92;
  } else if (step === "version") {
    status = "normalized";
    level = 0.9;
  } else if (subset) {
    status = "guess";
    level = 0.55;
    reason = "subset-tokens";
  }

  return buildResult(status, {
    entry,
    confidence: level,
    candidates: list
      .slice(0, CANDIDATE_LIMIT)
      .map((item) => candidateOf(item, 1, found.kind === "id" ? "id" : "canonical")),
    reason,
    matchedBy: step || (found.kind === "id" ? "identity-id" : "identity-canonical"),
  });
}

function stripRegionPrefix(text) {
  return text.replace(REGION_PREFIX_RE, "");
}

function stripVersionSuffix(text) {
  return text.replace(VERSION_SUFFIX_RE, "");
}

function stripLatestSuffix(text) {
  return text.replace(LATEST_SUFFIX_RE, "");
}

function stripDateSuffix(text) {
  return text.replace(ISO_DATE_SUFFIX_RE, "").replace(COMPACT_DATE_SUFFIX_RE, "");
}

function stripProviderPrefix(text) {
  return text.replace(PROVIDER_PREFIX_RE, "");
}

// M7-M11：破坏性剥离只在前面的「原样命中」都失败后才做，且每步都重新查一次身份索引。
// 一次生成有限个候选键（≤5），不会对整份目录反复 O(n) 扫描。
function steppedIdentity(usage, index, usageTokens) {
  let text = usage;
  const seen = new Set([bareModelId(text)]);
  const attempt = (step, guess, confidence) => {
    const key = bareModelId(text);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    const found = identityOf(index, text);
    if (!found) return null;
    return identityResult(found, usageTokens, { guess, step, confidence });
  };

  const region = stripRegionPrefix(text);
  if (region !== text) {
    text = region;
    const hit = attempt("region", false, 0);
    if (hit) return hit;
  }
  const version = stripVersionSuffix(text);
  if (version !== text) {
    text = version;
    const hit = attempt("version", false, 0.9);
    if (hit) return hit;
  }
  const latest = stripLatestSuffix(text);
  if (latest !== text) {
    text = latest;
    const hit = attempt("latest", true, 0.6);
    if (hit) return hit;
  }
  const date = stripDateSuffix(text);
  if (date !== text) {
    text = date;
    const hit = attempt("date", true, 0.6);
    if (hit) return hit;
  }
  const prefixed = stripProviderPrefix(text);
  if (prefixed !== text) {
    text = prefixed;
    const hit = attempt("provider-prefix", true, 0.55);
    if (hit) return hit;
  }
  return null;
}

// 家族兜底（G3）：usage token 是某个条目 id token 的真前缀时，按该条目计价但降级为 guess。
// 例：qwen3 → qwen3-235b-a22b。多解时保持 unmatched（歧义不猜）。
function familyMatch(index, usageTokens) {
  if (usageTokens.length === 0) return null;
  const hits = [];
  for (const entry of index.plain) {
    const tokens = tokensOf(entry).id;
    if (!isTokenPrefix(usageTokens, tokens)) continue;
    if (hits.some((item) => item.id === entry.id && item.provider === entry.provider)) continue;
    hits.push(entry);
  }
  if (hits.length === 0) return null;
  if (hits.length > 1) {
    return buildResult("unmatched", {
      reason: "ambiguous",
      candidates: hits
        .slice(0, CANDIDATE_LIMIT)
        .map((entry) => candidateOf(entry, usageTokens.length, "family")),
    });
  }
  return buildResult("guess", {
    entry: hits[0],
    confidence: 0.55,
    candidates: [candidateOf(hits[0], usageTokens.length, "family")],
    reason: "subset-tokens",
    matchedBy: "family",
  });
}

function resolveModel(usage, index, mappings) {
  const entries = index.entries;
  if (entries.length === 0) return buildResult("unmatched", { reason: "empty-catalog" });

  // M0 手工映射优先：__ignore__ 或固定到某个目录条目。
  const mapped = resolveMapping(mappings, usage);
  if (mapped === IGNORE_MAPPING) return buildResult("ignored", { confidence: 1 });
  if (typeof mapped === "string" && mapped.trim()) {
    const target = mapped.trim();
    const entry = findMappingEntry(entries, target);
    if (entry) {
      return buildResult("manual", {
        entry,
        confidence: 1,
        candidates: [candidateOf(entry, tokenize(stripVendor(entry.id)).length, "manual")],
        matchedBy: "manual",
      });
    }
    return buildResult("unmatched", { reason: "mapping-missing-entry" });
  }

  const usageVariant = variantOf(usage);
  // 带 :free / :batch 等变体时只在同变体条目里找，避免把变体当成原价模型。
  const eligible = usageVariant
    ? entries.filter((entry) => isEligible(entry, usageVariant))
    : index.plain;
  if (eligible.length === 0) return buildResult("unmatched", { reason: "empty-catalog" });
  const usageTokens = tokenize(usage);

  // M1 精确：usage 名与 id / slug 忽略大小写相等。
  const exact = usageVariant
    ? eligible.find(
        (entry) =>
          entry.id.toLowerCase() === usage.toLowerCase() ||
          String(entry.slug ?? "").toLowerCase() === usage.toLowerCase(),
      )
    : index.exact.get(usage.toLowerCase());
  if (exact) {
    return buildResult("exact", {
      entry: exact,
      confidence: 1,
      candidates: [candidateOf(exact, usageTokens.length, "exact")],
      matchedBy: "exact",
    });
  }

  // M2 渠道：usage 带 provider/ 前缀时优先用该渠道的挂牌价。
  // 带变体时不走渠道池：byProvider 只含无变体条目，会把 :free / :batch 当成付费模型。
  if (!usageVariant) {
    const byProvider = matchByProvider(usage, index, usageTokens);
    if (byProvider) return byProvider;
  }

  // 带变体的名字只在同变体条目里做名称匹配（不做身份层归一，避免把变体当原价模型）。
  if (usageVariant) return matchWithin(usage, eligible, usageTokens);

  // M3/M4 身份层：裸 id 分组 → canonical 分组（点/横线等价、标签剥离都在 bareModelId 里）。
  const identity = identityOf(index, usage);
  if (identity) return identityResult(identity, usageTokens);

  // M5 归一化 token：token 序列全等（vendor 前缀忽略）。
  const tokenKey = tokenKeyOf(usageTokens);
  if (tokenKey) {
    const matches = new Map();
    for (const entry of index.byIdTokens.get(tokenKey) || []) {
      matches.set(`${entry.provider}\u0000${entry.id}`, entry);
    }
    for (const entry of index.byNameTokens.get(tokenKey) || []) {
      matches.set(`${entry.provider}\u0000${entry.id}`, entry);
    }
    const list = [...matches.values()];
    if (list.length === 1) {
      return buildResult("normalized", {
        entry: list[0],
        confidence: 0.92,
        candidates: [candidateOf(list[0], usageTokens.length, "normalized")],
        matchedBy: "tokens",
      });
    }
    if (list.length > 1) {
      return buildResult("unmatched", {
        reason: "ambiguous",
        candidates: sortCandidates(
          list.map((entry) => candidateOf(entry, usageTokens.length, "normalized")),
        ),
      });
    }
  }

  // M6 连续子序列：两端允许多余 token（区域 / 日期 / 噪声）。
  const fuzzy = matchWithin(usage, index.plain, usageTokens);
  if (fuzzy.status !== "unmatched") return fuzzy;
  // 歧义时先看「去掉可识别后缀」能否唯一落位（models.dev 同一 id 多渠道时，
  // 名称里的 -latest / 日期是唯一变量）；没有可识别后缀就保持歧义，绝不猜。
  const stepped = steppedIdentity(usage, index, usageTokens);
  if (stepped) return stepped;
  if (fuzzy.reason === "ambiguous") return fuzzy;

  // 家族兜底：usage 是条目 id 的真前缀（guess）。
  const family = familyMatch(index, usageTokens);
  if (family) return family;

  return buildResult("unmatched", { reason: "no-candidate" });
}

export function matchModel(model, catalog, mappings) {
  const usage = String(model ?? "").trim();
  if (!usage) return buildResult("unmatched", { reason: "empty-model" });

  const index = catalogIndex(catalog);
  const cache = resultCacheOf(index, mappings);
  const cached = cache.get(usage);
  if (cached) return cached;
  const result = resolveModel(usage, index, mappings);
  cache.set(usage, result);
  return result;
}
