// 成本估算：token 拆分沿用用量页口径，单价取价格目录（USD/token）。
// 单条请求 / 单个聚合桶的成本：
//   cost = 非缓存 input × prompt + cache read × cacheRead
//        + cache creation × cacheWrite（或 1h 价）+ output × completion
//        + 计费请求数 × request
// 档位（长上下文档位）是「整次请求选一档」：先由 promptForTier 选出最高档，再用该档的四个分项单价
// 对整次请求的所有 token 计价，**不是**分段累进。
// 聚合桶不知道每个请求落在哪一档，所以给出数学上合法的区间：
//   对「基础价 + 各档位向量」逐个代入总量求值，取 min/max（真实值是这组数的凸组合）。
// 1h 缓存写价同理：宿主只有 cache_creation_input_tokens 总量，5m / 1h 混用时真实成本落在两端之间。
// 金额单位与取整：单价统一 USD/token；roundUsd(x) = Math.round(x * 1e8) / 1e8，
// 逐分量取整 → 行取整 → 区间取整，全仓只用这一种。
// 取价统一走 prices.js 的 resolvePrice：忽略 → 自定义价（status="custom"）→ 匹配结果。
// 自定义价只替换单价向量，倍率作用在单价层（任何 round8 之前），因此 Σparts 与行金额严格一致。
import { hasUsablePrice, isPricedStatus } from "./match.js";
import { resolvePrice } from "./prices.js";

const DEFAULT_TIER_INCLUSIVE = true;
const PART_KEYS = Object.freeze(["input", "cacheRead", "cacheWrite", "output", "request"]);
// 宿主没有、也不伪造的四个维度：只声明，不估算。
const UNESTIMATED = Object.freeze(["serviceTier", "imageTokens", "reasoningSplit"]);

function toCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

// 唯一取整函数：1e-8 USD 精度（= 0.00001 分）。
function round8(value) {
  return Math.round(value * 1e8) / 1e8;
}

// RecordRow（逐请求）与 models 行（聚合）共用：字段名不同，语义相同。
export function splitTokens(row) {
  const input = toCount(row?.inputTokens ?? row?.totalInputTokens);
  const output = toCount(row?.outputTokens ?? row?.totalOutputTokens);
  const cacheRead = Math.min(
    toCount(row?.cacheReadInputTokens ?? row?.totalCacheReadInputTokens),
    input,
  );
  // 宿主口径：Anthropic 已把 cache read / cache creation 加进 input_tokens；
  // chat / responses 中继则可能只加 read。用数据自证：
  // creation <= input - read 时视为 input 子集，否则视为在 input 之外。
  const cacheCreation = toCount(
    row?.cacheCreationInputTokens ?? row?.totalCacheCreationInputTokens,
  );
  const cacheCreationOutside = cacheCreation > input - cacheRead;
  const nonCachedInput = input - cacheRead - (cacheCreationOutside ? 0 : cacheCreation);
  const promptForTier = input + (cacheCreationOutside ? cacheCreation : 0);
  return {
    input,
    output,
    cacheRead,
    cacheCreation,
    cacheCreationOutside,
    nonCachedInput,
    promptForTier,
    // 与 summary 口径一致：totalTokens 只算 input + output。
    totalTokens: input + output,
  };
}

// 聚合行（models 行）额外带请求数：错误请求不计按次费。
export function splitModelTokens(model) {
  const tokens = splitTokens(model);
  const requests = toCount(model?.totalRequests);
  const errorRequests = Math.min(toCount(model?.errorRequests), requests);
  return {
    ...tokens,
    requests,
    errorRequests,
    billableRequests: requests - errorRequests,
  };
}

function firstPrice(...values) {
  for (const value of values) {
    // null / undefined 表示「继承下一项」，0 是显式免费，必须保留。
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return 0;
}

// 单价向量：档位分项缺失（null / undefined）时继承基础价；0 是显式免费，必须保留。
export function priceOf(entry, tier) {
  const base = entry || {};
  const prompt = firstPrice(tier?.prompt, base.prompt, 0);
  return {
    prompt,
    completion: firstPrice(tier?.completion, base.completion, 0),
    cacheRead: firstPrice(tier?.cacheRead, base.cacheRead, prompt),
    cacheWrite: firstPrice(tier?.cacheWrite, base.cacheWrite, prompt),
    // 1h 只有三态：number（含 0）/ null（缺失）。
    cacheWrite1h: tier?.cacheWrite1h ?? base.cacheWrite1h ?? null,
  };
}

// 条目级档位比较语义：自定义价可自带 tierInclusive，缺省沿用目录记录级的设置。
function tierInclusiveOf(entry, fallback) {
  return typeof entry?.tierInclusive === "boolean" ? entry.tierInclusive : fallback;
}

// 整次请求选档：命中的最高档；没有命中返回 null（基础价）。
// inclusive = true 对应 OpenRouter 的 min_prompt_tokens（达到即进入），
// false 对应 models.dev / LiteLLM 的 above_*（严格大于）。
export function selectTier(entry, promptForTier, inclusive = DEFAULT_TIER_INCLUSIVE) {
  const tiers = Array.isArray(entry?.tiers) ? entry.tiers : [];
  const probe = Number(promptForTier);
  const size = Number.isFinite(probe) && probe > 0 ? probe : 0;
  let best = null;
  for (const tier of tiers) {
    if (!tier) continue;
    const above = Number(tier.above);
    if (!Number.isFinite(above) || above < 0) continue;
    const hit = inclusive ? size >= above : size > above;
    if (hit && (!best || above >= Number(best.above))) best = tier;
  }
  return best;
}

// 聚合桶能否跨档：promptForTier 低于最小阈值时，任何单个请求都不可能越档 → 精确。
function minTierAbove(tiers) {
  let min = Number.POSITIVE_INFINITY;
  for (const tier of tiers) {
    const above = Number(tier?.above);
    if (Number.isFinite(above) && above < min) min = above;
  }
  return min;
}

function canCrossTier(promptForTier, tiers, inclusive) {
  if (!Array.isArray(tiers) || tiers.length === 0) return false;
  const above = minTierAbove(tiers);
  if (!Number.isFinite(above)) return false;
  return inclusive ? promptForTier >= above : promptForTier > above;
}

function zeroParts() {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, request: 0 };
}

function partsFor(tokens, price, writePrice, requestUsd) {
  return {
    input: round8(tokens.nonCachedInput * price.prompt),
    cacheRead: round8(tokens.cacheRead * price.cacheRead),
    cacheWrite: round8(tokens.cacheCreation * writePrice),
    output: round8(tokens.output * price.completion),
    request: round8(requestUsd),
  };
}

function partsTotal(parts) {
  return round8(
    parts.input + parts.cacheRead + parts.cacheWrite + parts.output + parts.request,
  );
}

// 一个单价向量在给定 TTL 假设下可能的成本。
// ttl = "5m"：5m 是下限；目录给了 1h 时再给一个 1h 端点（区间）。
// ttl = "1h"：明确假设用 1h 价；目录没有 1h 价时回退 5m 并标记 missing1h。
function vectorCosts(tokens, price, requestUsd, ttl) {
  const has1h = price.cacheWrite1h !== null && price.cacheWrite1h !== undefined;
  if (ttl === "1h" && has1h) {
    const parts = partsFor(tokens, price, price.cacheWrite1h, requestUsd);
    return [{ parts, cost: partsTotal(parts), ttl: "1h", assumed: true, missing1h: false }];
  }
  const parts5m = partsFor(tokens, price, price.cacheWrite, requestUsd);
  const list = [
    {
      parts: parts5m,
      cost: partsTotal(parts5m),
      ttl: "5m",
      assumed: false,
      missing1h: ttl === "1h",
    },
  ];
  if (ttl !== "1h" && has1h && tokens.cacheCreation > 0) {
    const parts1h = partsFor(tokens, price, price.cacheWrite1h, requestUsd);
    list.push({ parts: parts1h, cost: partsTotal(parts1h), ttl: "1h", assumed: false, missing1h: false });
  }
  return list;
}

function trackAssumptions(tracker, tokens, has1h, ttl) {
  if (tokens.cacheCreation > 0) tracker.creation = true;
  if (ttl === "1h") {
    if (has1h) tracker.assumed1h = true;
    else tracker.missing1h = true;
  } else if (!has1h && tokens.cacheCreation > 0) {
    tracker.missing1h = true;
  }
}

// 聚合行：基础价 + 各档位向量逐个对总量求值，取 min/max；
// 单请求 / 不越档 / 无档位时区间塌缩成精确值。
function aggregateModelCost(tokens, entry, options) {
  const tierInclusive = tierInclusiveOf(entry, options.tierInclusive !== false);
  const ttl = options.cacheWriteTtl === "1h" ? "1h" : "5m";
  const tiers = Array.isArray(entry.tiers) ? entry.tiers : [];
  const selected = selectTier(entry, tokens.promptForTier, tierInclusive);
  const exact =
    tiers.length === 0 ||
    tokens.requests === 1 ||
    !canCrossTier(tokens.promptForTier, tiers, tierInclusive);
  const vectors = exact ? [selected] : [null, ...tiers];
  const requestUsd = round8(tokens.billableRequests * firstPrice(entry.request));

  let lower = Number.POSITIVE_INFINITY;
  let upper = 0;
  let parts = null;
  // 记下「下限向量」的单价与写价假设：模型行的计算过程要能还原 parts 是怎么算出来的。
  let partsPrice = null;
  let partsTtl = ttl;
  const seen = new Set();
  for (const tier of vectors) {
    const price = priceOf(entry, tier);
    const signature = `${price.prompt}|${price.completion}|${price.cacheRead}|${price.cacheWrite}|${price.cacheWrite1h}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    for (const option of vectorCosts(tokens, price, requestUsd, ttl)) {
      if (option.cost < lower) {
        lower = option.cost;
        parts = option.parts;
        partsPrice = price;
        partsTtl = option.ttl;
      }
      if (option.cost > upper) upper = option.cost;
    }
  }
  // 1h 假设按「参与计价的向量里是否有 1h 价」判定：只要有一档提供 1h 价，
  // 上限就已覆盖 1h 轴，不能因为另一档缺该字段而误报「该模型目录无 1 小时价」。
  const hasAny1h = vectors.some((tier) => {
    const price = priceOf(entry, tier);
    return price.cacheWrite1h !== null && price.cacheWrite1h !== undefined;
  });
  trackAssumptions(options.tracker, tokens, hasAny1h, ttl);
  if (!parts) {
    const price = priceOf(entry, selected);
    parts = partsFor(tokens, price, price.cacheWrite, requestUsd);
    partsPrice = price;
  }
  return {
    lowerUsd: round8(lower),
    upperUsd: round8(upper),
    costUsd: round8(lower),
    parts,
    price: partsPrice,
    writeTtl: partsTtl,
    tierAbove: exact && selected ? selected.above : null,
    exact,
  };
}

// 单条请求：整次选档 + 5m/1h 两端的可能成本；按 status 跳过错误请求的按次费。
export function costOfRecord(row, entry, options = {}) {
  const tokens = splitTokens(row);
  const tierInclusive = tierInclusiveOf(entry, options.tierInclusive !== false);
  const ttl = options.cacheWriteTtl === "1h" ? "1h" : "5m";
  const tier = selectTier(entry, tokens.promptForTier, tierInclusive);
  const price = priceOf(entry, tier);
  const status = String(row?.status ?? "")
    .trim()
    .toLowerCase();
  const billable = status !== "error";
  const requestUsd = billable ? round8(firstPrice(entry?.request)) : 0;

  let lower = Number.POSITIVE_INFINITY;
  let upper = 0;
  let parts = null;
  let writeTtl = "5m";
  let missing1h = false;
  for (const option of vectorCosts(tokens, price, requestUsd, ttl)) {
    if (option.cost < lower) {
      lower = option.cost;
      parts = option.parts;
      writeTtl = option.ttl;
    }
    if (option.cost > upper) upper = option.cost;
    if (option.missing1h) missing1h = true;
  }
  if (!parts) parts = partsFor(tokens, price, price.cacheWrite, requestUsd);
  return {
    tokens,
    tier,
    tierAbove: tier ? tier.above : null,
    price,
    parts,
    costUsd: round8(lower),
    upperUsd: round8(upper),
    writeTtl,
    missing1h,
    billable,
  };
}

function catalogOf(catalog) {
  if (Array.isArray(catalog)) {
    return {
      entries: catalog,
      tierInclusive:
        typeof catalog.tierInclusive === "boolean" ? catalog.tierInclusive : DEFAULT_TIER_INCLUSIVE,
      fetchedAt: Number(catalog.fetchedAt) || 0,
    };
  }
  return {
    entries: Array.isArray(catalog?.models) ? catalog.models : [],
    tierInclusive:
      typeof catalog?.tierInclusive === "boolean"
        ? catalog.tierInclusive
        : DEFAULT_TIER_INCLUSIVE,
    fetchedAt: Number(catalog?.fetchedAt) || 0,
  };
}

function assumptionsOf(tracker, ttl) {
  const assumptions = [];
  if (ttl === "1h") {
    if (tracker.assumed1h) assumptions.push("cacheWrite1hAssumed");
    if (tracker.missing1h) assumptions.push("cacheWrite5mOnly");
  } else {
    if (tracker.creation) assumptions.push("cacheWrite5m");
    if (tracker.missing1h) assumptions.push("cacheWrite5mOnly");
  }
  return assumptions;
}

function buildCost(options) {
  const {
    mode,
    byModel,
    summary,
    lowerUsd,
    upperUsd,
    assumptions,
    recordsStatus,
    recordsMeta,
    pricedAt,
    recordsExtraModels = 0,
    uncoveredTokens = 0,
    uncoveredRequests = 0,
  } = options;
  let pricedTokens = 0;
  let unpricedTokens = 0;
  let guessedTokens = 0;
  let ignoredTokens = 0;
  let customModels = 0;
  let modelsTokens = 0;
  let requests = 0;
  let errorRequests = 0;
  for (const row of byModel) {
    modelsTokens += row.tokens;
    requests += row.requests || 0;
    errorRequests += row.errorRequests || 0;
    if (row.status === "custom") customModels += 1;
    if (row.status === "ignored") ignoredTokens += row.tokens;
    else if (row.status === "guess") guessedTokens += row.tokens;
    else if (isPricedStatus(row.status)) pricedTokens += row.tokens;
    else unpricedTokens += row.tokens;
  }

  const totalTokens = summary
    ? toCount(summary.totalTokens) ||
      toCount(summary.totalInputTokens) + toCount(summary.totalOutputTokens)
    : 0;
  // 用户显式忽略的模型既不计价，也不该压低覆盖率：分母同样扣除 ignoredTokens。
  // 全部 token 都被忽略时没有需要覆盖的部分，按 100% 处理；完全没有用量时仍为 0。
  const coverageTokens = Math.max(0, totalTokens - ignoredTokens);
  const rowTokens = Math.max(0, modelsTokens - ignoredTokens);
  const lower = round8(lowerUsd);
  // 精算下 records 未覆盖的 token 同样没有进入金额，页脚按「未计价」展示；
  // uncoveredTokens 单独返回，便于区分「数据缺口」与「缺单价」。
  unpricedTokens += uncoveredTokens;
  // 宿主只给 summary、不给 models 时没有任何行级状态可以判定单价：这些 token 一并计入未计价，
  // 否则会出现「覆盖率 0% 却未计价 0」的自相矛盾。仅在 byModel 完全为空时兜底，
  // 不把 summary 与 models 的快照差异误算成未计价。
  const summaryOnly = byModel.length === 0 && totalTokens > pricedTokens;
  if (summaryOnly) unpricedTokens = Math.max(unpricedTokens, totalTokens - pricedTokens);
  const uncovered = uncoveredTokens > 0 || uncoveredRequests > 0;
  // 缺口部分没有任何逐条信息，给不出上界；金额按下限语义展示。
  const upper = upperUsd === null || uncovered || summaryOnly ? null : round8(upperUsd);
  const isLowerBound =
    unpricedTokens > 0 || uncoveredRequests > 0 || (upper !== null && upper > lower);
  // 精算的 modelsTokens 只来自 records：把未覆盖的聚合 token 补进分母，覆盖率才能反映缺口。
  const coverageBaseTokens = rowTokens + uncoveredTokens;

  return {
    mode,
    recordsStatus:
      recordsStatus || (mode === "precise" ? "complete" : "no-records"),
    recordsRows: recordsMeta?.rows || 0,
    recordsPages: recordsMeta?.pages || 0,
    recordsExtraCalls: recordsMeta?.extraCalls || 0,
    recordsSnapshotAt: recordsMeta?.snapshotAt || "",
    recordsBadRows: recordsMeta?.badRows || 0,
    recordsExtraModels,
    totalUsd: lower,
    lowerUsd: lower,
    upperUsd: upper,
    isLowerBound,
    assumptions,
    unestimated: [...UNESTIMATED],
    pricedAt: Number(pricedAt) || 0,
    byModel,
    // 自定义价覆盖的模型行数（UI 展示口径）。
    customModels,
    pricedTokens,
    // 金额口径：缺单价 + 精算时 models 中整组没有 records 的 token，两者都没有进入金额。
    unpricedTokens,
    // 数据缺口来源：只统计精算时 models 有、records 整组缺失的 token / 可计费请求数。
    uncoveredTokens,
    uncoveredRequests,
    guessedTokens,
    ignoredTokens,
    // summary 口径（宿主数字）：只用于展示。
    coverage: coverageTokens > 0 ? pricedTokens / coverageTokens : totalTokens > 0 ? 1 : 0,
    // models 同源口径：用于告警判据，避免 summary 与 models 非同快照造成假告警。
    rowCoverage:
      coverageBaseTokens > 0
        ? pricedTokens / coverageBaseTokens
        : modelsTokens > 0
          ? 1
          : 0,
    totalTokens,
    modelsTokens,
    requests,
    errorRequests,
  };
}

// 聚合行按模型合并：宿主正常已经按模型聚合，这里再兜一层，
// 避免上游出现同名多行时把「一个桶」拆成多个单请求桶（那会把档位区间误判成精确值）。
function mergeModelRows(list) {
  const rows = [];
  const indexByName = new Map();
  for (const item of list) {
    const name = String(item?.model ?? "").trim();
    if (!name) {
      rows.push({ ...item });
      continue;
    }
    const at = indexByName.get(name);
    if (at === undefined) {
      indexByName.set(name, rows.length);
      rows.push({ ...item });
      continue;
    }
    const target = rows[at];
    target.totalInputTokens = toCount(target.totalInputTokens) + toCount(item.totalInputTokens);
    target.totalOutputTokens = toCount(target.totalOutputTokens) + toCount(item.totalOutputTokens);
    target.totalCacheReadInputTokens =
      toCount(target.totalCacheReadInputTokens) + toCount(item.totalCacheReadInputTokens);
    target.totalCacheCreationInputTokens =
      toCount(target.totalCacheCreationInputTokens) + toCount(item.totalCacheCreationInputTokens);
    target.totalRequests = toCount(target.totalRequests) + toCount(item.totalRequests);
    target.errorRequests = toCount(target.errorRequests) + toCount(item.errorRequests);
    target.totalTokens = target.totalInputTokens + target.totalOutputTokens;
  }
  return rows;
}

// 聚合计价：只用 models 行（周期汇总），档位不确定性用区间表达。
function estimateAggregate(input) {
  const {
    summary,
    models,
    catalog,
    mappings,
    prices,
    settings,
    recordsStatus,
    recordsMeta,
    pricedAt,
    catalogFetchedAt,
  } = input;
  const { entries, tierInclusive, fetchedAt } = catalogOf(catalog);
  const list = Array.isArray(models) ? mergeModelRows(models) : [];
  const ttl = settings?.cacheWriteTtl === "1h" ? "1h" : "5m";
  const tracker = { creation: false, assumed1h: false, missing1h: false };

  const byModel = list.map((item) => {
    const tokens = splitModelTokens(item);
    const name = String(item?.model ?? "").trim();
    // 取价：忽略 → 自定义价 → 匹配结果（目录价不做缩放）。
    const resolved = resolvePrice(name, entries, mappings, prices);
    const entry = resolved.entry;
    let parts = zeroParts();
    let costUsd = 0;
    let upperUsd = 0;
    let tierAbove = null;
    let price = null;
    let writeTtl = "5m";
    let exact = false;
    if (entry) {
      const cost = aggregateModelCost(tokens, entry, { tierInclusive, cacheWriteTtl: ttl, tracker });
      parts = cost.parts;
      costUsd = cost.costUsd;
      upperUsd = cost.upperUsd;
      tierAbove = cost.tierAbove;
      price = cost.price || null;
      writeTtl = cost.writeTtl || "5m";
      exact = cost.exact;
    }
    return {
      model: name,
      entryId: resolved.entryId,
      entryProvider: entry?.provider ?? "",
      entryName: entry?.name ?? "",
      tokens: tokens.totalTokens,
      // 计算过程用：token 总量的四项拆分 + 下限向量的单价与写价假设。
      // 未匹配 / 已忽略时 price 为 null，UI 只展示 token 拆分与「未计价」。
      tokenParts: {
        input: tokens.nonCachedInput,
        cacheRead: tokens.cacheRead,
        cacheWrite: tokens.cacheCreation,
        output: tokens.output,
      },
      costUsd,
      upperUsd,
      status: resolved.status,
      confidence: resolved.confidence,
      parts,
      price,
      writeTtl,
      exact,
      requests: tokens.requests,
      errorRequests: tokens.errorRequests,
      candidates: resolved.candidates,
      reason: resolved.reason,
      matchedBy: resolved.matchedBy,
      mode: "aggregate",
      tierAbove,
      guessed: resolved.status === "guess",
    };
  });

  let lowerUsd = 0;
  let upperUsd = 0;
  for (const row of byModel) {
    lowerUsd += row.costUsd;
    upperUsd += row.upperUsd;
  }
  const unpriced = byModel.some(
    (row) => row.status !== "ignored" && !hasUsablePrice(row.status) && row.tokens > 0,
  );
  // 聚合模式没有日期维度（summary / models 是整段窗口的聚合，daily 又没有模型维度），
  // 因此永远按当前目录计价。
  return buildCost({
    mode: "aggregate",
    byModel,
    summary,
    lowerUsd,
    upperUsd: unpriced ? null : upperUsd,
    assumptions: assumptionsOf(tracker, ttl),
    recordsStatus,
    recordsMeta,
    pricedAt: pricedAt || catalogFetchedAt || fetchedAt,
  });
}

// 逐请求精算：每条 record 是一个请求，能正确处理「整次请求选档」。
// 只应在一致性校验通过（recordsStatus === "complete"）时调用；否则调用方回退聚合。
function estimatePrecise(input) {
  const {
    models,
    catalog,
    mappings,
    prices,
    settings,
    recordsStatus,
    recordsMeta,
    pricedAt,
    catalogFetchedAt,
  } = input;
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const { entries, tierInclusive, fetchedAt } = catalogOf(catalog);
  const ttl = settings?.cacheWriteTtl === "1h" ? "1h" : "5m";
  const tracker = { creation: false, assumed1h: false, missing1h: false };

  const groups = new Map();
  for (const row of rows) {
    const name = String(row?.model ?? "").trim();
    if (!name) continue;
    let list = groups.get(name);
    if (!list) {
      list = [];
      groups.set(name, list);
    }
    list.push(row);
  }

  const modelNames = Array.isArray(models)
    ? models.map((item) => String(item?.model ?? "").trim()).filter(Boolean)
    : [];
  const known = new Set(modelNames);
  let extraModels = 0;
  for (const name of groups.keys()) if (!known.has(name)) extraModels += 1;

  const ordered = [...modelNames];
  for (const name of groups.keys()) if (!known.has(name)) ordered.push(name);

  // models 中存在、records 中整组缺失的模型：它们不会生成计价行，金额会偏低。
  // 按模型名合并后累计 token / 可计费请求数；显式忽略的模型不参与金额，不算缺口。
  let uncoveredTokens = 0;
  let uncoveredRequests = 0;
  for (const item of mergeModelRows(Array.isArray(models) ? models : [])) {
    const name = String(item?.model ?? "").trim();
    if (!name || groups.has(name)) continue;
    if (resolvePrice(name, entries, mappings, prices).status === "ignored") continue;
    const tokens = splitModelTokens(item);
    uncoveredTokens += tokens.totalTokens;
    uncoveredRequests += tokens.billableRequests;
  }

  const byModel = [];
  const seen = new Set();
  for (const name of ordered) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const list = groups.get(name) || [];
    // 该模型没有逐条记录：本轮无法按精算计价，其 token 已计入 uncoveredTokens 并触发下限。
    if (list.length === 0) continue;
    const match = resolvePrice(name, entries, mappings, prices);
    const entry = match.entry;
    const parts = zeroParts();
    let costUsd = 0;
    let upperUsd = 0;
    let tokens = 0;
    let errorRequests = 0;
    const tierAboves = new Set();
    // 计算过程用：分项 token 是各条请求拆分之和；单价只有全部请求同价时才给单一值。
    const tokenParts = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    const priceSignatures = new Set();
    let price = null;
    let writeTtl = ttl;
    for (const row of list) {
      const recordTokens = splitTokens(row);
      tokens += recordTokens.totalTokens;
      tokenParts.input += recordTokens.nonCachedInput;
      tokenParts.cacheRead += recordTokens.cacheRead;
      tokenParts.cacheWrite += recordTokens.cacheCreation;
      tokenParts.output += recordTokens.output;
      if (
        String(row?.status ?? "")
          .trim()
          .toLowerCase() === "error"
      ) {
        errorRequests += 1;
      }
      // 身份（能不能计价）只看匹配结果：未匹配 / 已忽略的模型不产生金额。
      if (!entry) continue;
      const cost = costOfRecord(row, entry, { tierInclusive, cacheWriteTtl: ttl });
      price = cost.price;
      writeTtl = cost.writeTtl;
      priceSignatures.add(
        `${cost.price.prompt}|${cost.price.completion}|${cost.price.cacheRead}|${cost.price.cacheWrite}|${cost.price.cacheWrite1h}`,
      );
      for (const key of PART_KEYS) parts[key] = round8(parts[key] + cost.parts[key]);
      upperUsd = round8(upperUsd + cost.upperUsd);
      tierAboves.add(cost.tierAbove === null ? "" : String(cost.tierAbove));
      trackAssumptions(
        tracker,
        cost.tokens,
        cost.price.cacheWrite1h !== null && cost.price.cacheWrite1h !== undefined,
        ttl,
      );
    }
    // 行金额按「分项求和再取整」：保证 parts 五键可逐项对账（与聚合路径同一口径）。
    costUsd = partsTotal(parts);
    byModel.push({
      model: name,
      entryId: match.entryId,
      entryProvider: entry?.provider ?? "",
      entryName: entry?.name ?? "",
      tokens,
      tokenParts,
      costUsd,
      upperUsd,
      status: match.status,
      confidence: match.confidence,
      parts,
      price: priceSignatures.size === 1 ? price : null,
      priceMixed: priceSignatures.size > 1,
      writeTtl,
      requests: list.length,
      errorRequests,
      candidates: match.candidates,
      reason: match.reason,
      matchedBy: match.matchedBy,
      mode: "precise",
      tierAbove: tierAboves.size === 1 ? (tierAboves.has("") ? null : Number([...tierAboves][0])) : null,
      guessed: match.status === "guess",
    });
  }

  let lowerUsd = 0;
  let upperUsd = 0;
  for (const row of byModel) {
    lowerUsd += row.costUsd;
    upperUsd += row.upperUsd;
  }
  const unpriced = byModel.some(
    (row) => row.status !== "ignored" && !hasUsablePrice(row.status) && row.tokens > 0,
  );
  return buildCost({
    mode: "precise",
    byModel,
    summary: input.summary,
    lowerUsd,
    upperUsd: unpriced ? null : upperUsd,
    assumptions: assumptionsOf(tracker, ttl),
    recordsStatus: recordsStatus || "complete",
    recordsMeta,
    pricedAt: pricedAt || catalogFetchedAt || fetchedAt,
    recordsExtraModels: extraModels,
    uncoveredTokens,
    uncoveredRequests,
  });
}

// 统一入口：有可信的逐请求数据就精算，否则聚合。
// input = { summary, models, catalog, mappings, prices, rows, recordsStatus, recordsMeta, settings,
//           catalogFetchedAt }
export function estimateRange(input = {}) {
  const settings = input.settings || {};
  const preciseWanted = settings.preciseRequests !== "off";
  const rows = Array.isArray(input.rows) ? input.rows : null;
  const status = input.recordsStatus;
  const trustworthy = status === undefined || status === "complete";
  if (preciseWanted && rows && rows.length > 0 && trustworthy) {
    return estimatePrecise({ ...input, rows });
  }
  return estimateAggregate(input);
}

// 兼容包装：旧签名（summary / models / catalog / mappings）等价于聚合计价。
export function estimatePeriod(summary, models, catalog, mappings) {
  return estimateAggregate({ summary, models, catalog, mappings, rows: null });
}
