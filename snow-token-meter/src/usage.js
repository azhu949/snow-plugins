// 用量采集：snow.metadata 的 usage 域 → { summary, models, records }。
// 口径与用量页一致：totalTokens = input + output；
// cache read / cache creation 都是 input 的子集，不重复计入总量。
// records 是逐条请求（每次调用默认顺带返回最新 100 条），逐请求精算与分页采集都在这里归一化。
import { RECORDS_PAGE_LIMIT, RECORDS_TOLERANCE } from "./constants.js";

// usage_records.created_at 由 SQLite datetime('now','localtime') 写入，格式固定。
const RECORD_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

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

// RecordRow（逐请求，冻结形状）：只保留计价与展示需要的字段，token 一律整数化。
export function normalizeRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const createdAt = String(raw.createdAt ?? "").trim();
  const model = String(raw.model ?? "").trim();
  const id = String(raw.id ?? "").trim();
  if (!createdAt && !model && !id) return null;
  return {
    id,
    conversationId: String(raw.conversationId ?? ""),
    responseId: String(raw.responseId ?? ""),
    model,
    apiProfileName: String(raw.apiProfileName ?? ""),
    apiConfigId: String(raw.apiConfigId ?? ""),
    requestMethod: String(raw.requestMethod ?? ""),
    inputTokens: toCount(raw.inputTokens),
    outputTokens: toCount(raw.outputTokens),
    cacheCreationInputTokens: toCount(raw.cacheCreationInputTokens),
    cacheReadInputTokens: toCount(raw.cacheReadInputTokens),
    status: String(raw.status ?? "").trim(),
    isSubAgent: Boolean(raw.isSubAgent),
    directoryId: String(raw.directoryId ?? ""),
    createdAt,
  };
}

// 宿主 records 缺失 / items 非数组一律视为「没有 records」：调用方回退聚合，不抛错。
export function normalizeRecords(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.items)) return null;
  return {
    items: raw.items.map(normalizeRecord).filter(Boolean),
    total: toCount(raw.total),
  };
}

export function isValidRecordTime(value) {
  return RECORD_TIME.test(String(value ?? ""));
}

// records 采集结果的缓存键（数据身份）：区间 + 档案 + 快照。目录 / 映射变化不参与，
// 因为这两者只影响成本重算，不该触发重新翻页（见 engine 的 recordsCache 注释）。
export function recordsDataKey({ rangeKey, since, until, profileName, summary } = {}) {
  const s = summary || {};
  return [
    String(rangeKey ?? ""),
    String(since ?? ""),
    String(until ?? ""),
    String(profileName ?? ""),
    toCount(s.totalRequests),
    toCount(s.totalInputTokens),
    toCount(s.totalOutputTokens),
  ].join("|");
}

// records 的缓存键全集（需求口径）：再加目录版本与映射版本，用于成本结果的复用。
export function recordsCacheKey(input = {}) {
  return [
    recordsDataKey(input),
    Number(input.catalogFetchedAt) || 0,
    Number(input.mappingVersion) || 0,
  ].join("|");
}

// models 行指纹：聚合模式的金额完全来自 models；summary 三项不变而模型分布 / 缓存字段变化时，
// 成本缓存键必须跟着变，否则会命中旧结果（金额、覆盖率与模型明细一起停在旧值）。
// 用 FNV-1a 逐字段混入，不做大对象拼串；模型名带长度前缀避免分隔符歧义，顺序敏感，
// 因为 byModel 的输出顺序跟随 models 行的顺序。
export function modelsFingerprint(models) {
  const list = Array.isArray(models) ? models : [];
  let hash = 2166136261;
  const mixText = (text) => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  };
  const mixNumber = (value) => mixText(`n${toCount(value)};`);
  for (const item of list) {
    const name = String(item?.model ?? "");
    mixText(`s${name.length}:${name};`);
    mixNumber(item?.totalInputTokens);
    mixNumber(item?.totalOutputTokens);
    mixNumber(item?.totalCacheReadInputTokens);
    mixNumber(item?.totalCacheCreationInputTokens);
    mixNumber(item?.totalRequests);
    mixNumber(item?.errorRequests);
    mixText("|");
  }
  // 长度本身作为显式段：空数组与「只有一条零值行」不会得到同一个指纹。
  return `${list.length.toString(36)}_${(hash >>> 0).toString(36)}`;
}

// 覆盖判定：行数 + input/output 总量都要落在容差内，任一不满足都不能做精算。
export function recordsCoverage(rows, summary) {
  const list = Array.isArray(rows) ? rows : [];
  const total = toCount(summary?.totalRequests);
  const requestTolerance = Math.max(1, Math.ceil(total * RECORDS_TOLERANCE.requestRatio));
  let input = 0;
  let output = 0;
  for (const row of list) {
    input += toCount(row?.inputTokens);
    output += toCount(row?.outputTokens);
  }
  const totalInput = toCount(summary?.totalInputTokens);
  const totalOutput = toCount(summary?.totalOutputTokens);
  const inputTolerance = Math.max(
    RECORDS_TOLERANCE.tokenMin,
    Math.ceil(totalInput * RECORDS_TOLERANCE.tokenRatio),
  );
  const outputTolerance = Math.max(
    RECORDS_TOLERANCE.tokenMin,
    Math.ceil(totalOutput * RECORDS_TOLERANCE.tokenRatio),
  );
  const rowsOk = list.length >= Math.max(0, total - requestTolerance);
  const inputOk = Math.abs(input - totalInput) <= inputTolerance;
  const outputOk = Math.abs(output - totalOutput) <= outputTolerance;
  return { covered: rowsOk && inputOk && outputOk, rowsOk, inputOk, outputOk, rows: list.length, total };
}

// 分页采集：第 1 页（page0）随 usage 免费返回，只有覆盖不足时才按 offset 追加页。
// 终止条件全部基于数据本身（本页不足 limit / 已越过 since / 到页数或记录数上限 / 预算用尽），
// 绝不用 records.total 算页数（它是全库过滤后的行数，与时间窗无关）。
export async function collectRecords({
  page0 = null,
  source = null,
  since = "",
  until = "",
  profileName = "",
  summary = null,
  maxPages = 1,
  maxRows = RECORDS_PAGE_LIMIT,
  budget = { remaining: 0 },
  limit = RECORDS_PAGE_LIMIT,
} = {}) {
  const safeLimit = Number(limit) > 0 ? Math.floor(Number(limit)) : RECORDS_PAGE_LIMIT;
  const pageCap = Math.max(1, Math.floor(Number(maxPages) || 1));
  const rowCap = Math.max(safeLimit, Math.floor(Number(maxRows) || safeLimit));
  const empty = { rows: [], status: "no-records", pages: 0, extraCalls: 0, snapshotAt: "", badRows: 0 };
  if (!page0 || !Array.isArray(page0.items)) return empty;

  const rows = [];
  const seen = new Set();
  let badRows = 0;
  let snapshotAt = "";
  let oldest = "";
  let truncated = false;
  let failed = false;
  let pages = 1;
  let extraCalls = 0;

  // 快照上界取第 1 页里最大的 createdAt：并发插入只会让 offset 整体后移，不会产生更新的行。
  for (const item of page0.items) {
    const createdAt = String(item?.createdAt ?? "").trim();
    if (isValidRecordTime(createdAt) && createdAt > snapshotAt) snapshotAt = createdAt;
  }

  function push(items) {
    for (const item of items) {
      const row = normalizeRecord(item);
      if (!row || !isValidRecordTime(row.createdAt)) {
        badRows += 1;
        continue;
      }
      if (!oldest || row.createdAt < oldest) oldest = row.createdAt;
      if (snapshotAt && row.createdAt > snapshotAt) continue;
      if (row.createdAt < since || row.createdAt > until) continue;
      if (row.id) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
      }
      rows.push(row);
    }
  }

  push(page0.items);
  let lastCount = page0.items.length;

  while (!recordsCoverage(rows, summary).covered) {
    // 上一页不足 limit 说明已经到底；越过 since 说明后面只会更早。
    if (lastCount < safeLimit) break;
    if (oldest && oldest < since) break;
    if (pages >= pageCap) {
      truncated = true;
      break;
    }
    if (rows.length >= rowCap) {
      truncated = true;
      break;
    }
    if (!budget || Number(budget.remaining) <= 0) {
      truncated = true;
      break;
    }
    if (!source || typeof source.fetchRecordsPage !== "function") break;
    let page;
    try {
      page = await source.fetchRecordsPage({
        since,
        until,
        profileName,
        limit: safeLimit,
        offset: pages * safeLimit,
      });
    } catch {
      // 翻页中途失败：保留已取到的行，但整轮回退聚合（不拿半份数据算钱）。
      failed = true;
      truncated = true;
      break;
    }
    if (budget) budget.remaining = Math.max(0, Number(budget.remaining) - 1);
    extraCalls += 1;
    const items = Array.isArray(page?.items) ? page.items : [];
    if (!items.length) break;
    push(items);
    pages += 1;
    lastCount = items.length;
  }

  const coverage = recordsCoverage(rows, summary);
  let status;
  if (coverage.covered) status = "complete";
  else if (failed || truncated) status = "truncated";
  else if (coverage.rowsOk) status = "mismatch";
  else status = "truncated";

  return { rows, status, pages, extraCalls, snapshotAt, badRows };
}

// 接受完整 metadata 响应或直接的 usage 域对象。
export function normalizeUsage(response) {
  const domain = looksLikeMetadataResponse(response) ? readDomain(response) : response;
  const source = domain && typeof domain === "object" ? domain : {};
  const models = Array.isArray(source.models)
    ? source.models.map(normalizeModel).filter(Boolean)
    : [];
  return {
    summary: normalizeSummary(source.summary),
    models,
    records: normalizeRecords(source.records),
  };
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
      // 显式声明分页参数：宿主默认就是 100/0，写明后第 1 页的页宽不会随宿主默认值漂移。
      params.limit = RECORDS_PAGE_LIMIT;
      params.offset = 0;
      let response;
      try {
        response = await metadata.get(["usage"], { params });
      } catch (error) {
        throw new UsageError("usage-request-failed", "读取用量数据失败", { cause: error });
      }
      return normalizeUsage(response);
    },
    // 追加页：records 不吃时间窗，只能从最新往回翻，窗口过滤在本地做。
    async fetchRecordsPage({ since, until, profileName, limit, offset } = {}) {
      if (!metadata || typeof metadata.get !== "function") {
        throw new UsageError("usage-host-missing", "当前宿主不支持 snow.metadata.get");
      }
      const params = {};
      if (since) params.since = String(since);
      if (until) params.until = String(until);
      if (profileName) params.profileName = String(profileName);
      params.limit = Number(limit) > 0 ? Math.floor(Number(limit)) : RECORDS_PAGE_LIMIT;
      params.offset = Number(offset) > 0 ? Math.floor(Number(offset)) : 0;
      let response;
      try {
        response = await metadata.get(["usage"], { params });
      } catch (error) {
        throw new UsageError("usage-request-failed", "读取逐条用量失败", { cause: error });
      }
      const domain = looksLikeMetadataResponse(response) ? readDomain(response) : response;
      return normalizeRecords(domain?.records) || { items: [], total: 0 };
    },
  };
}
