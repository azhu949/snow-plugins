// 模型匹配：用量里的模型名（常是代理别名）→ 价格目录条目。
// OpenRouter 顺序：手工映射 → 精确 id/slug → 归一化 token 全等 → 连续子序列模糊匹配。
// models.dev 另有渠道层：先按 vendor/model 前缀取该渠道价，再按 canonical 取跨渠道中位价。
// 歧义时返回 unmatched 并要求手动映射，避免把成本记到错误模型上。
import { CANDIDATE_LIMIT, FUZZY_MIN_TOKENS, IGNORE_MAPPING } from "./constants.js";

const NON_TOKEN_RE = /[^a-z0-9.]+/g;
const EDGE_DOTS_RE = /^\.+|\.+$/g;
const VARIANT_RE = /:([a-z0-9._-]+)/i;
const PAREN_RE = /\([^)]*\)/g;
const BRACKET_RE = /\[[^\]]*\]/g;
const TAG_RE = /:.*$/;
const PRICED_STATUSES = Object.freeze([
  "exact",
  "normalized",
  "fuzzy",
  "manual",
  "provider",
  "canonical",
]);

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
export function variantOf(value) {
  const match = VARIANT_RE.exec(String(value ?? ""));
  return match ? match[1].toLowerCase() : "";
}

function sameTokens(left, right) {
  return (
    left.length > 0 &&
    left.length === right.length &&
    left.every((token, index) => token === right[index])
  );
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

// 别名条目（id 以 ~ 开头）永不参与；:variant 条目只有在 usage 名含同一变体时参与。
function isEligible(entry, usageVariant) {
  const id = String(entry?.id ?? "");
  if (!id || id.startsWith("~")) return false;
  const variant = variantOf(id);
  if (variant && variant !== usageVariant) return false;
  return true;
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
  };
}

export function isPricedStatus(status) {
  return PRICED_STATUSES.includes(status);
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

function collapseByCanonical(entries) {
  const groups = canonicalGroups(entries);
  const out = [];
  for (const list of groups.values()) out.push(representativeOf(list));
  return out;
}

// 目录索引按目录数组缓存：一次刷新内多个模型共用同一份分组与折叠结果。
const INDEX_CACHE = new WeakMap();

// 每条目录条目的 token 只取决于自身且创建后不再改写：按条目对象缓存，
// 避免每条用量模型都重新 token 化整份目录（9000 条目录下这是主要开销）。
const ENTRY_TOKENS = new WeakMap();

function tokensOf(entry) {
  let cached = ENTRY_TOKENS.get(entry);
  if (!cached) {
    cached = { id: tokenize(stripVendor(entry.id)), name: tokenize(entry.name) };
    ENTRY_TOKENS.set(entry, cached);
  }
  return cached;
}

function catalogIndex(catalog) {
  if (!catalog || typeof catalog !== "object") {
    return { entries: [], multiProvider: false, groups: new Map(), collapsed: [], plain: [] };
  }
  const cached = INDEX_CACHE.get(catalog);
  if (cached) return cached;
  const entries = Array.isArray(catalog) ? catalog.filter((entry) => entry && entry.id) : [];
  // provider 字段由 models.dev 目录写入；OpenRouter 目录为空，不启用渠道层。
  const multiProvider = entries.some((entry) => entry.provider);
  // 身份分组与折叠只用无变体、非别名条目：:free / :batch 与 ~ 别名不得充当正文模型。
  const plain = entries.filter((entry) => isEligible(entry, ""));
  const byCanonical = canonicalGroups(plain);
  const index = {
    entries,
    multiProvider,
    byId: idGroups(plain),
    byCanonical,
    collapsed: multiProvider ? [...byCanonical.values()].map(representativeOf) : entries,
    plain,
  };
  INDEX_CACHE.set(catalog, index);
  return index;
}

// 精确 → 归一化 → 连续子序列；在给定条目集合内完成，供全局与渠道子集复用。
function matchWithin(usage, entries, usageTokens) {
  if (entries.length === 0) return buildResult("unmatched", { reason: "empty-catalog" });
  const lower = usage.toLowerCase();

  // 精确：usage 名与 id 或 slug 忽略大小写相等。
  const exact = entries.find(
    (entry) => entry.id.toLowerCase() === lower || String(entry.slug ?? "").toLowerCase() === lower,
  );
  if (exact) {
    return buildResult("exact", {
      entry: exact,
      confidence: 1,
      candidates: [candidateOf(exact, usageTokens.length, "exact")],
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
  return buildResult("fuzzy", { entry: winner, confidence, candidates: scored });
}

// usage 形如 vendor/model 时，先在该渠道自己的条目里找，命中就用该渠道挂牌价。
function matchByProvider(usage, entries, usageTokens) {
  const index = usage.indexOf("/");
  if (index <= 0) return null;
  const provider = usage.slice(0, index).trim().toLowerCase();
  if (!provider) return null;
  const scoped = entries.filter((entry) => String(entry.provider ?? "").toLowerCase() === provider);
  if (scoped.length === 0) return null;
  const result = matchWithin(usage, scoped, usageTokens);
  if (!isPricedStatus(result.status)) return null;
  return { ...result, status: "provider", confidence: Math.min(result.confidence, 0.95) };
}

// usage 的裸 id 先按「同 id 多渠道」取中位价，再退到 canonical 模型身份。
// 前者更可靠：id 相同即同一模型，不会混进 -fast / :thinking 变体。
function matchByIdentity(usage, index) {
  const key = bareModelId(usage);
  if (!key) return null;
  const byId = index.byId.get(key);
  if (byId && byId.length > 0) {
    return buildResult("canonical", {
      entry: representativeOf(byId),
      confidence: byId.length > 1 ? 0.85 : 0.9,
      candidates: byId.slice(0, CANDIDATE_LIMIT).map((item) => candidateOf(item, 1, "id")),
    });
  }
  const group = index.byCanonical.get(key);
  if (!group || group.length === 0) return null;
  return buildResult("canonical", {
    entry: representativeOf(group),
    confidence: group.length > 1 ? 0.8 : 0.9,
    candidates: group.slice(0, CANDIDATE_LIMIT).map((item) => candidateOf(item, 1, "canonical")),
  });
}

export function matchModel(model, catalog, mappings) {
  const usage = String(model ?? "").trim();
  if (!usage) return buildResult("unmatched", { reason: "empty-model" });

  const index = catalogIndex(catalog);
  const entries = index.entries;

  // 1) 手工映射优先：__ignore__ 或固定到某个目录条目。
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
      });
    }
    return buildResult("unmatched", { reason: "mapping-missing-entry" });
  }

  const usageTokens = tokenize(usage);
  const usageVariant = variantOf(usage);
  const eligible = usageVariant
    ? entries.filter((entry) => isEligible(entry, usageVariant))
    : index.plain;
  if (eligible.length === 0) return buildResult("unmatched", { reason: "empty-catalog" });

  if (index.multiProvider) {
    const byProvider = matchByProvider(usage, eligible, usageTokens);
    if (byProvider) return byProvider;
    // 带 :free / :batch 等变体时不做身份归一，避免把变体当成原价模型。
    if (!usageVariant) {
      const byIdentity = matchByIdentity(usage, index);
      if (byIdentity) return byIdentity;
    }
    // 跨渠道目录同一模型会有几十条：折叠成代表再匹配，避免整片歧义。
    const pool = usageVariant ? collapseByCanonical(eligible) : index.collapsed;
    return matchWithin(usage, pool, usageTokens);
  }

  return matchWithin(usage, eligible, usageTokens);
}
