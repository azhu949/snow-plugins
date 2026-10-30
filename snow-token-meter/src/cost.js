// 成本估算：token 拆分沿用用量页口径，单价取 OpenRouter 目录。
// cost = 非缓存 input × prompt + cache read × cacheRead
//      + cache creation × cacheWrite + output × completion
//      + 计费请求数 × request；计费请求数 = max(0, totalRequests - errorRequests)。
import { isPricedStatus, matchModel } from "./match.js";

function toCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function round8(value) {
  return Math.round(value * 1e8) / 1e8;
}

export function splitModelTokens(model) {
  const input = toCount(model?.totalInputTokens);
  const output = toCount(model?.totalOutputTokens);
  const cacheRead = Math.min(toCount(model?.totalCacheReadInputTokens), input);
  // cache creation 也是 input 的子集，且不与 cache read 重叠。
  const cacheCreation = Math.min(toCount(model?.totalCacheCreationInputTokens), input - cacheRead);
  const requests = toCount(model?.totalRequests);
  const errorRequests = Math.min(toCount(model?.errorRequests), requests);
  return {
    input,
    output,
    cacheRead,
    cacheCreation,
    nonCachedInput: input - cacheRead - cacheCreation,
    requests,
    errorRequests,
    billableRequests: requests - errorRequests,
    totalTokens: input + output,
  };
}

function zeroParts() {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, request: 0 };
}

// token 总量以 summary 为准；逐模型成本基于 models 求和。
export function estimatePeriod(summary, models, catalog, mappings) {
  const list = Array.isArray(models) ? models : [];
  const entries = Array.isArray(catalog) ? catalog : [];
  const byModel = list.map((item) => {
    const tokens = splitModelTokens(item);
    const name = String(item?.model ?? "").trim();
    const match = matchModel(name, entries, mappings);
    const entry = isPricedStatus(match.status) && match.entry ? match.entry : null;
    const parts = zeroParts();
    if (entry) {
      parts.input = round8(tokens.nonCachedInput * entry.prompt);
      parts.cacheRead = round8(tokens.cacheRead * entry.cacheRead);
      parts.cacheWrite = round8(tokens.cacheCreation * entry.cacheWrite);
      parts.output = round8(tokens.output * entry.completion);
      parts.request = round8(tokens.billableRequests * entry.request);
    }
    const costUsd = round8(
      parts.input + parts.cacheRead + parts.cacheWrite + parts.output + parts.request,
    );
    return {
      model: name,
      entryId: match.entryId,
      entryProvider: entry?.provider ?? "",
      entryName: entry?.name ?? "",
      tokens: tokens.totalTokens,
      costUsd,
      status: match.status,
      confidence: match.confidence,
      parts,
      requests: tokens.requests,
      errorRequests: tokens.errorRequests,
      candidates: match.candidates,
      reason: match.reason,
    };
  });

  let totalUsd = 0;
  let pricedTokens = 0;
  let unpricedTokens = 0;
  let ignoredTokens = 0;
  let modelsTokens = 0;
  let requests = 0;
  for (const item of byModel) {
    totalUsd += item.costUsd;
    modelsTokens += item.tokens;
    requests += item.requests;
    if (item.status === "ignored") ignoredTokens += item.tokens;
    else if (isPricedStatus(item.status)) pricedTokens += item.tokens;
    else unpricedTokens += item.tokens;
  }

  const totalTokens = summary
    ? toCount(summary.totalTokens) ||
      toCount(summary.totalInputTokens) + toCount(summary.totalOutputTokens)
    : 0;
  // 用户显式忽略的模型既不计价，也不该压低覆盖率：分母同样扣除 ignoredTokens。
  // 全部 token 都被忽略时没有需要覆盖的部分，按 100% 处理；完全没有用量时仍为 0。
  const coverageTokens = Math.max(0, totalTokens - ignoredTokens);

  return {
    totalUsd: round8(totalUsd),
    byModel,
    pricedTokens,
    unpricedTokens,
    ignoredTokens,
    coverage:
      coverageTokens > 0 ? pricedTokens / coverageTokens : totalTokens > 0 ? 1 : 0,
    totalTokens,
    modelsTokens,
    requests,
  };
}
