// 用量采集：snow.metadata 的 usage 域 → { summary, models }。
// 口径与用量页一致：totalTokens = input + output；
// cache read / cache creation 都是 input 的子集，不重复计入总量。

export class UsageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "UsageError";
    this.code = code;
    this.details = details;
  }
}

function toCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

export function emptySummary() {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationInputTokens: 0,
    totalCacheReadInputTokens: 0,
    totalRequests: 0,
    errorRequests: 0,
    totalTokens: 0,
    effectiveCacheReadTokens: 0,
    nonCachedInputTokens: 0,
  };
}

export function normalizeSummary(raw) {
  if (!raw || typeof raw !== "object") return emptySummary();
  const input = toCount(raw.totalInputTokens);
  const output = toCount(raw.totalOutputTokens);
  const cacheRead = toCount(raw.totalCacheReadInputTokens);
  const totalRequests = toCount(raw.totalRequests);
  // 有效 cache read 不超过 input：上游异常数值不制造负数或重复计数。
  const effectiveCacheRead = Math.min(cacheRead, input);
  return {
    totalInputTokens: input,
    totalOutputTokens: output,
    totalCacheCreationInputTokens: toCount(raw.totalCacheCreationInputTokens),
    totalCacheReadInputTokens: cacheRead,
    totalRequests,
    errorRequests: Math.min(toCount(raw.errorRequests), totalRequests),
    totalTokens: input + output,
    effectiveCacheReadTokens: effectiveCacheRead,
    nonCachedInputTokens: input - effectiveCacheRead,
  };
}

export function normalizeModel(raw) {
  if (!raw || typeof raw !== "object") return null;
  const model = String(raw.model ?? "").trim();
  if (!model) return null;
  const input = toCount(raw.totalInputTokens);
  const output = toCount(raw.totalOutputTokens);
  const totalRequests = toCount(raw.totalRequests);
  return {
    model,
    totalRequests,
    errorRequests: Math.min(toCount(raw.errorRequests), totalRequests),
    totalInputTokens: input,
    totalOutputTokens: output,
    totalCacheCreationInputTokens: toCount(raw.totalCacheCreationInputTokens),
    totalCacheReadInputTokens: toCount(raw.totalCacheReadInputTokens),
    totalTokens: input + output,
  };
}

function looksLikeMetadataResponse(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value.domains !== undefined || value.denied !== undefined || value.withheld !== undefined),
  );
}

function readDomain(response) {
  const denied = response?.denied?.usage;
  if (denied) {
    throw new UsageError(
      "privacy-declaration-missing",
      "usage 域未在 @snow-privacy 中声明，无法读取用量数据",
      { reason: denied.reason || "privacy-declaration-missing", scope: denied.scope || "usage" },
    );
  }
  const withheld = response?.withheld?.usage;
  if (Array.isArray(withheld) && withheld.length > 0) {
    throw new UsageError("usage-withheld", "用量数据被隐私过滤剥离，无法计算成本", {
      fields: withheld,
    });
  }
  const domain = response?.domains?.usage;
  if (!domain || typeof domain !== "object") {
    throw new UsageError("usage-unavailable", "宿主未返回 usage 元数据域");
  }
  return domain;
}

// 接受完整 metadata 响应或直接的 usage 域对象。
export function normalizeUsage(response) {
  const domain = looksLikeMetadataResponse(response) ? readDomain(response) : response;
  const source = domain && typeof domain === "object" ? domain : {};
  const models = Array.isArray(source.models)
    ? source.models.map(normalizeModel).filter(Boolean)
    : [];
  return { summary: normalizeSummary(source.summary), models };
}

export function createUsageSource(api) {
  const metadata = api?.metadata;
  return {
    async fetchUsage({ since, until, profileName } = {}) {
      if (!metadata || typeof metadata.get !== "function") {
        throw new UsageError("usage-host-missing", "当前宿主不支持 snow.metadata.get");
      }
      const params = {};
      if (since) params.since = String(since);
      if (until) params.until = String(until);
      if (profileName) params.profileName = String(profileName);
      let response;
      try {
        response = await metadata.get(["usage"], { params });
      } catch (error) {
        throw new UsageError("usage-request-failed", "读取用量数据失败", { cause: error });
      }
      return normalizeUsage(response);
    },
  };
}
