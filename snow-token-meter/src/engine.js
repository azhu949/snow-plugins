// 引擎：并行拉取今日 / 选中周期 / 全量用量，合并价格目录并重算成本。
// 对外只暴露状态快照与动作，UI 通过 store 订阅渲染。
// 逐请求精算：第 1 页 records 随 usage 免费返回，覆盖不足时才串行追加页（受页数 / 记录数与每轮预算约束），
// 任一环节不满足就整体回退聚合 —— 一个区间只有一个金额语义，绝不混算。
import {
  ALL_TIME_CACHE_MS,
  DEFAULT_SETTINGS,
  PERIODS,
  RECORDS_MAX_EXTRA_CALLS,
  RECORDS_MAX_PAGES,
  RECORDS_MAX_ROWS,
  RECORDS_PAGE_LIMIT,
  REFRESH_SECONDS,
  REFRESH_THROTTLE_MS,
  STORAGE_KEYS,
} from "./constants.js";
import { estimateRange } from "./cost.js";
import { ensureFx, loadFx } from "./fx.js";
import { mappingKey } from "./match.js";
import { PRICE_SCHEMA, normalizePrices, priceKeyOf } from "./prices.js";
import { ensureCatalog, loadCatalog } from "./pricing.js";
import {
  normalizeCustomPrices,
  normalizeMappings,
  normalizeSettings,
  resolveCatalogTtlMs,
} from "./settings.js";
import { createStore } from "./store.js";
import {
  collectRecords,
  createUsageSource,
  modelsFingerprint,
  recordsCacheKey,
  recordsDataKey,
  UsageError,
} from "./usage.js";
import { allTimeRange, formatLocalDate, periodRange, todayRange } from "./util.js";


function createMemoryStorage() {
  const map = new Map();
  return {
    async getJson(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async setJson(key, value) {
      map.set(key, value);
    },
    async removeJson(key) {
      map.delete(key);
    },
  };
}

function readNowMs(now) {
  const value = typeof now === "function" ? now() : now;
  if (value instanceof Date) return value.getTime();
  const number = Number(value);
  return Number.isFinite(number) ? number : Date.now();
}

function messageOf(error, fallback = "未知错误") {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  return error.message || fallback;
}

// profileName 是区间数据的用量口径：档案变化后旧区间不能继续复用。
function emptyRange(key, box, profileName = "") {
  return {
    key,
    since: box.since,
    until: box.until,
    summary: null,
    models: [],
    // records：逐请求精算的行与诊断位（status / pages / extraCalls / snapshotAt / badRows）。
    records: null,
    cost: null,
    fetchedAt: 0,
    profileName,
  };
}

function catalogStateOf(record) {
  const models = Array.isArray(record?.models) ? record.models : [];
  return {
    fetchedAt: Number(record?.fetchedAt) || 0,
    source: record?.source || "none",
    provider: record?.provider || "",
    // 目录对应的地址：换源或改地址后要与当前设置比对，不能只按 fetchedAt 判断新旧。
    url: String(record?.url || ""),
    count: models.length || Number(record?.count) || 0,
    stale: Boolean(record?.stale),
    error: record?.error || null,
    // 换源失败返回的空目录要能越过下面的 fetchedAt 单调保护，否则会被旧来源的目录盖回去。
    urlMismatch: Boolean(record?.urlMismatch),
    models,
  };
}

// 目录记录里的 provider / url 是写入时的来源与地址；旧缓存缺这两个字段时无法判断，按匹配处理。
function catalogMatchesSettings(catalog, settings) {
  const provider = String(catalog?.provider || "");
  const url = String(catalog?.url || "");
  if (!provider && !url) return true;
  if (provider && provider !== String(settings?.pricingSource || "")) return false;
  if (url && url !== String(settings?.pricingUrl || "")) return false;
  return true;
}

// 只有同源、同地址的两份目录才按 fetchedAt 取较新的一份；换源 / 换地址时采用与本轮设置对应的
// 那一份，避免旧来源目录写进新来源状态，也避免换源期间在途的旧请求落地后盖回新来源。
function mergeCatalog(liveCatalog, fetchedCatalog, settings) {
  // 换地址失败返回的空目录必须采用，否则旧地址的目录会被当成本次地址的价格。
  if (fetchedCatalog.urlMismatch) return fetchedCatalog;
  const fetchedCurrent = catalogMatchesSettings(fetchedCatalog, settings);
  const liveCurrent = catalogMatchesSettings(liveCatalog, settings);
  if (fetchedCurrent !== liveCurrent) return fetchedCurrent ? fetchedCatalog : liveCatalog;
  return (liveCatalog?.fetchedAt || 0) > fetchedCatalog.fetchedAt ? liveCatalog : fetchedCatalog;
}

// 三个价格源各占一个存储键，切换来源不会互相覆盖缓存。
// 必须是映射表：三元表达式会把 litellm 写进 OpenRouter 的键（读回时按 models 结构解析失败）。
const CATALOG_STORAGE_KEYS = Object.freeze({
  openrouter: STORAGE_KEYS.catalog,
  modelsdev: STORAGE_KEYS.catalogModelsDev,
  litellm: STORAGE_KEYS.catalogLiteLLM,
});

function catalogKeyOf(settings) {
  return CATALOG_STORAGE_KEYS[settings?.pricingSource] || STORAGE_KEYS.catalog;
}

// 是否存在任何长上下文档位：auto 模式据此判断「翻页能不能换来精度」。
// 自定义价是扁平价（不继承目录档位），所以只看目录。
function catalogHasTiers(models) {
  const list = Array.isArray(models) ? models : [];
  for (const entry of list) {
    if (Array.isArray(entry?.tiers) && entry.tiers.length > 0) return true;
  }
  return false;
}

// 自定义价的数值字段：patch 里出现这些键时只接受 null / 空串 / 有限非负数。
// 校验放在 engine 侧，避免 UI 传进 "abc" 时被归一化当成「整条非法」而静默删掉已有价格。
const PRICE_PATCH_FIELDS = Object.freeze([
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "cacheWrite1h",
  "request",
  "multiplier",
]);

function invalidPricePatch(patch) {
  for (const field of PRICE_PATCH_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const value = patch[field];
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return true;
  }
  return false;
}

// 页数与记录数上限取先到者（默认 100 条/页，两者同值；宿主未来放宽单页条数时仍受记录数封顶）。
export function recordsMaxPages(rangeKey) {
  const pages = Number(RECORDS_MAX_PAGES[rangeKey] ?? RECORDS_MAX_PAGES.today) || 1;
  const rows = Number(RECORDS_MAX_ROWS[rangeKey] ?? RECORDS_MAX_ROWS.today) || RECORDS_PAGE_LIMIT;
  return Math.max(1, Math.min(pages, Math.ceil(rows / RECORDS_PAGE_LIMIT)));
}

export function recordsMaxRows(rangeKey) {
  return Number(RECORDS_MAX_ROWS[rangeKey] ?? RECORDS_MAX_ROWS.today) || RECORDS_PAGE_LIMIT;
}

// 精算触发判定（设计 §5.2）：status 表示「不翻页」的结论，collect 表示需要采集。
// auto 在没有档位且不止一页时不翻页、整段回退聚合（此时逐请求与聚合等价）。
export function recordsPlanFor({
  rangeKey = "today",
  summary = null,
  hasRecords = false,
  hasTiers = false,
  preciseRequests = "auto",
} = {}) {
  if (preciseRequests === "off") return { status: "off" };
  if (!hasRecords) return { status: "no-records" };
  const total = Math.max(0, Number(summary?.totalRequests) || 0);
  if (total === 0) return { status: "empty" };
  const maxPages = recordsMaxPages(rangeKey);
  const pagesNeeded = Math.max(1, Math.ceil(total / RECORDS_PAGE_LIMIT));
  // 估算页数超过上限：整体回退聚合，不做「部分精算 + 聚合补齐」。
  if (pagesNeeded > maxPages) return { status: "truncated" };
  if (preciseRequests === "auto" && !hasTiers && pagesNeeded > 1) {
    return { status: "partial-no-tier" };
  }
  return { collect: true };
}

function fxStateOf(record) {
  return {
    rate: Number(record?.rate) || 0,
    fetchedAt: Number(record?.fetchedAt) || 0,
    url: String(record?.url || ""),
    source: record?.source || "none",
    date: String(record?.date || ""),
    stale: Boolean(record?.stale),
    error: record?.error || null,
  };
}

// 只装配用量区间；成本统一由 recostRanges 基于本轮目录计算，避免同一轮重复计算。
function decorateRange(key, box, usage, fetchedAt, profileName, records = null) {
  return {
    key,
    since: box.since,
    until: box.until,
    summary: usage?.summary || null,
    models: Array.isArray(usage?.models) ? usage.models : [],
    records,
    fetchedAt,
    profileName,
  };
}

export function createEngine(options = {}) {
  // 沙箱档的全局 fetch 已被宿主替换为跨域实现（snow.fetch 同款），省略 fetchFn 时可直接用。
  const defaultFetch =
    typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;
  const {
    api,
    storage,
    now,
    fetchFn = defaultFetch,
    throttleMs = REFRESH_THROTTLE_MS,
    allTimeCacheMs = ALL_TIME_CACHE_MS,
    timer = true,
  } = options;

  const safeStorage =
    storage && typeof storage.getJson === "function" && typeof storage.setJson === "function"
      ? storage
      : createMemoryStorage();
  const usageSource = createUsageSource(api ?? {});

  function initialState() {
    const settings = normalizeSettings(DEFAULT_SETTINGS);
    const date = new Date(readNowMs(now));
    return {
      settings,
      periodKey: settings.period,
      today: emptyRange("today", todayRange(date), settings.profileName),
      period: emptyRange(settings.period, periodRange(settings.period, date), settings.profileName),
      allTime: emptyRange("all", allTimeRange(date), settings.profileName),
      catalog: { fetchedAt: 0, source: "none", count: 0, stale: true, error: null, models: [] },
      fx: { rate: 0, fetchedAt: 0, url: "", source: "none", date: "", stale: true, error: null },
      mappings: {},
      prices: {},
      // 价格版本：随自定义价每次变更递增，参与成本缓存键与界面草稿重置。
      priceVersion: 0,
      loading: false,
      error: null,
      denied: null,
      lastRefreshAt: 0,
      initialized: false,
    };
  }

  const store = createStore(initialState());
  let refreshing = null;
  let intervalId = null;
  let disposed = false;
  // 映射版本：mappings 只在本引擎内变更，用递增版本号参与成本缓存键，省掉大对象拼串。
  let mappingVersion = 0;
  // 价格版本：自定义价只在 setCustomPrice / clearCustomPrices 里变更。
  let priceVersion = 0;
  // records 采集结果（内存，不落盘）：键是数据身份（区间 + 档案 + 快照）。
  // 目录 / 映射变化不使这里的键失效 —— 它们只影响成本重算，重新翻页纯属浪费调用。
  const recordsCache = new Map();
  // 成本结果缓存：键是「区间 + 档案 + 目录版本 + 映射版本 + 设置 + records 快照」，命中即跳过重算。
  const costMemo = new Map();
  // 设置键的写入串行队列：设置面板每个控件都单独调 setSettings，两次变更若落在同一写窗口内
  // 会以同一份过期基底互相覆盖（后完成的一次把前一次字段整份抹掉）。队列只包住
  // 「读 state → 归一化 → 落盘 → 提交」这段临界区，后续刷新仍在队列外执行。
  let settingsWriteChain = Promise.resolve();

  function queueSettingsWrite(task) {
    const run = settingsWriteChain.then(
      () => task(),
      () => task(),
    );
    // 队列自身吞掉失败：某次写入抛错不能卡住后续设置变更（调用方仍拿到原始 promise）。
    settingsWriteChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // 设置的唯一写入收口：patch 基于排队后的最新设置合并；reset 表示整份回到出厂默认；
  // decorate 返回的字段与 settings 在同一次 store.set 里提交（切周期要同时换空区间）。
  function commitSettings({ patch = null, reset = false, decorate = null } = {}) {
    return queueSettingsWrite(async () => {
      const current = store.get();
      const source = reset
        ? DEFAULT_SETTINGS
        : { ...current.settings, ...(patch && typeof patch === "object" ? patch : {}) };
      const settings = normalizeSettings(source);
      const saved = await writeJson(STORAGE_KEYS.settings, settings);
      const extra = typeof decorate === "function" ? decorate(settings) : null;
      store.set({ settings, periodKey: settings.period, ...(extra || {}) });
      return { saved, previous: current.settings, settings };
    });
  }

  // 目录 / 映射 / 自定义价 / 设置变化时只重算成本，不重新请求用量。
  // prices 统一从 state 取：调用点只需要保证 state 是最新的，避免位置参数漏传让金额回退成目录价。
  function recostRanges(state, catalog, mappings, settings) {
    const prices = state.prices && typeof state.prices === "object" ? state.prices : {};
    const next = {};
    for (const key of ["today", "period", "allTime"]) {
      const item = state[key];
      if (!item) {
        next[key] = item;
        continue;
      }
      if (!item.summary) {
        next[key] = { ...item, cost: null };
        continue;
      }
      const records = item.records || null;
      // 成本缓存键 = 区间 + 档案 + 目录版本 + 映射版本 + 价格版本 + 设置 + records 快照 + models 指纹。
      // rows 身份用「数量 + 首尾 id」参与，避免两次不同快照恰好同长度时命中旧结果；
      // models 参与聚合模式的全部金额与精算模式的缺口 / 覆盖率，必须用稳定指纹入键。
      const firstRow = records?.rows?.[0];
      const lastRow = records?.rows?.[records.rows.length - 1];
      const memoKey = `${recordsCacheKey({
        rangeKey: item.key,
        since: item.since,
        until: item.until,
        profileName: item.profileName || "",
        summary: item.summary,
        catalogFetchedAt: catalog.fetchedAt,
        mappingVersion,
      })}|${settings.preciseRequests}|${settings.cacheWriteTtl}|${priceVersion}|${
        records?.status || "none"
      }|${records?.rows?.length || 0}|${firstRow?.id || ""}|${lastRow?.id || ""}|${
        records?.snapshotAt || ""
      }|${modelsFingerprint(item.models)}`;
      let cost = costMemo.get(memoKey);
      if (!cost) {
        cost = estimateRange({
          summary: item.summary,
          models: item.models,
          // 传数组：目录记录级的 tierInclusive 挂在 models 数组上（pricing.attachCatalogMeta）。
          catalog: catalog.models,
          mappings,
          prices,
          rows: records?.rows || null,
          // 关闭时强制 "off"：状态与设置一致，UI 不会把「关了精算」显示成「没有逐条数据」。
          recordsStatus: settings.preciseRequests === "off" ? "off" : records?.status,
          // cost 侧只需要诊断位（行数是计数，不是数组）：rows 本体单独传。
          recordsMeta: records
            ? {
                rows: Array.isArray(records.rows) ? records.rows.length : Number(records.rows) || 0,
                pages: records.pages || 0,
                extraCalls: records.extraCalls || 0,
                snapshotAt: records.snapshotAt || "",
                badRows: records.badRows || 0,
              }
            : undefined,
          settings,
          catalogFetchedAt: catalog.fetchedAt,
        });
        if (costMemo.size >= 32) costMemo.clear();
        costMemo.set(memoKey, cost);
      }
      next[key] = { ...item, cost };
    }
    return next;
  }

  // 自定义价变更的唯一收口：递增版本 → 只重算成本（绝不重新拉用量）。
  // 返回提交后的 state，调用方只需要再带上是否写入成功的 saved。
  function commitPrices(prices) {
    priceVersion += 1;
    store.set({ prices, priceVersion });
    store.set((latest) => recostRanges(latest, latest.catalog, latest.mappings, latest.settings));
    return store.get();
  }

  // 单个区间的 records 采集：先判定要不要翻页，再查缓存，最后受预算串行翻页。
  async function collectRangeRecords({ rangeKey, box, usage, hasTiers, settings, profileName, budget }) {
    const summary = usage?.summary || null;
    const page0 = usage?.records || null;
    const base = { rows: [], pages: 0, extraCalls: 0, snapshotAt: "", badRows: 0 };
    const plan = recordsPlanFor({
      rangeKey,
      summary,
      hasRecords: Boolean(page0),
      hasTiers,
      preciseRequests: settings.preciseRequests,
    });
    if (plan.status) {
      // 超页数上限时把「上限」写进诊断位：界面要能说清是几页的超限，而不是 0 页。
      const pages = plan.status === "truncated" ? recordsMaxPages(rangeKey) : 0;
      return { ...base, status: plan.status, pages };
    }
    const dataKey = recordsDataKey({ rangeKey, since: box.since, until: box.until, profileName, summary });
    const cached = recordsCache.get(dataKey);
    if (cached) return cached;
    const collected = await collectRecords({
      page0,
      source: usageSource,
      since: box.since,
      until: box.until,
      profileName,
      summary,
      maxPages: recordsMaxPages(rangeKey),
      maxRows: recordsMaxRows(rangeKey),
      budget,
      limit: RECORDS_PAGE_LIMIT,
    });
    // 缓存「完整」与「口径不一致」两类结果：前者用于复用，后者用于避免每轮重复翻页（数据问题不会因重试消失）。
    // 「truncated」不缓存：它来自页数 / 预算上限，下一轮预算刷新后可能还能取全。
    if (collected.status === "complete" || collected.status === "mismatch") {
      if (recordsCache.size >= 24) recordsCache.clear();
      recordsCache.set(dataKey, collected);
    }
    return collected;
  }

  async function readJson(key, fallback) {
    try {
      const value = await safeStorage.getJson(key);
      return value === null || value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  }

  async function writeJson(key, value) {
    try {
      const written = await safeStorage.setJson(key, value);
      // 存储实现用 false 表示写入失败（不抛错）；undefined 视为成功，兼容内存存储。
      return written !== false;
    } catch {
      return false;
    }
  }

  // 价表结构坏掉（不是对象 / models 不是对象）时把原始值备份到独立键，再用空表覆盖：
  // 宁可丢价，也不要让一段坏 JSON 每轮都悄悄失效却看不出原因。
  async function readPrices(raw) {
    if (raw === null || raw === undefined) return {};
    const isObject = typeof raw === "object" && !Array.isArray(raw);
    const models = isObject ? raw.models : undefined;
    const broken =
      !isObject ||
      (models !== undefined && (models === null || typeof models !== "object" || Array.isArray(models)));
    if (!broken) return normalizeCustomPrices(raw);
    await writeJson(STORAGE_KEYS.priceBackup, { at: readNowMs(now), raw });
    await writeJson(STORAGE_KEYS.prices, { schema: PRICE_SCHEMA, models: {} });
    return {};
  }

  async function hydrate() {
    const [rawSettings, rawMappings, rawPrices, fxRecord] = await Promise.all([
      readJson(STORAGE_KEYS.settings, null),
      readJson(STORAGE_KEYS.mappings, null),
      readJson(STORAGE_KEYS.prices, null),
      loadFx(safeStorage).catch(() => null),
    ]);
    const settings = normalizeSettings(rawSettings || DEFAULT_SETTINGS);
    const catalogRecord = await loadCatalog(safeStorage, catalogKeyOf(settings)).catch(() => null);
    return {
      settings,
      mappings: normalizeMappings(rawMappings),
      prices: await readPrices(rawPrices),
      catalog: catalogStateOf(catalogRecord || { source: "none", stale: true }),
      fx: fxStateOf(fxRecord),
    };
  }

  function stopTimer() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function startTimer() {
    stopTimer();
    if (!timer || disposed) return;
    const { settings } = store.get();
    if (!settings.autoRefresh) return;
    const seconds = Math.min(
      Math.max(settings.refreshSeconds, REFRESH_SECONDS.min),
      REFRESH_SECONDS.max,
    );
    intervalId = setInterval(() => {
      refresh().catch(() => {
        // refresh 内部已把错误写入 state；这里只防止未处理的拒绝。
      });
    }, seconds * 1000);
    if (intervalId && typeof intervalId.unref === "function") intervalId.unref();
  }

  async function init() {
    const hydrated = await hydrate();
    const date = new Date(readNowMs(now));
    store.set({
      settings: hydrated.settings,
      periodKey: hydrated.settings.period,
      mappings: hydrated.mappings,
      prices: hydrated.prices,
      priceVersion,
      catalog: hydrated.catalog,
      fx: hydrated.fx,
      today: emptyRange("today", todayRange(date), hydrated.settings.profileName),
      period: emptyRange(
        hydrated.settings.period,
        periodRange(hydrated.settings.period, date),
        hydrated.settings.profileName,
      ),
      allTime: emptyRange("all", allTimeRange(date), hydrated.settings.profileName),
      error: null,
      denied: null,
    });
    startTimer();
    await refresh({ forceUsage: true });
    store.set({ initialized: true });
    return store.get();
  }

  async function refresh({ forceUsage = false, forceAll = false } = {}) {
    if (refreshing) return refreshing;
    const startMs = readNowMs(now);
    const state = store.get();
    if (
      !forceUsage &&
      state.lastRefreshAt > 0 &&
      startMs - state.lastRefreshAt < throttleMs
    ) {
      return { skipped: true, state };
    }

    const date = new Date(startMs);
    const periodKey = state.settings.period;
    const profileName = state.settings.profileName;
    const ranges = new Map();
    ranges.set("today", todayRange(date));
    if (periodKey !== "today" && periodKey !== "all") {
      ranges.set("period", periodRange(periodKey, date));
    }
    const allAge = startMs - (state.allTime.fetchedAt || 0);
    // 全量区间带用量口径：档案变化后即使还在缓存窗口内也必须重拉，否则同屏会混用两份档案。
    const needAll =
      forceAll ||
      state.allTime.profileName !== profileName ||
      !state.allTime.fetchedAt ||
      allAge < 0 ||
      allAge >= allTimeCacheMs;
    if (needAll) ranges.set("all", allTimeRange(date));

    store.set({ loading: true });

    refreshing = (async () => {
      try {
        const usageJobs = [...ranges.entries()].map(([rangeKey, box]) =>
          usageSource.fetchUsage({ since: box.since, until: box.until, profileName }).then(
            (usage) => ({ rangeKey, ok: true, usage }),
            (error) => ({ rangeKey, ok: false, error }),
          ),
        );
        const fxJob =
          state.settings.fxMode === "auto"
            ? ensureFx({
                force: false,
                now: startMs,
                fetchFn,
                storage: safeStorage,
                url: state.settings.fxUrl,
              })
            : Promise.resolve(null);
        const [usageResults, catalogRecord, fxRecord] = await Promise.all([
          Promise.all(usageJobs),
          ensureCatalog({
            force: false,
            now: startMs,
            fetchFn,
            storage: safeStorage,
            url: state.settings.pricingUrl,
            source: state.settings.pricingSource,
            key: catalogKeyOf(state.settings),
            ttlMs: resolveCatalogTtlMs(state.settings),
          }),
          fxJob,
        ]);

        const fetchedCatalog = catalogStateOf(catalogRecord);
        const liveAfterFetch = store.get();
        // 目录在 usage 返回后已确定：records 是否需要翻页取决于目录有没有长上下文档位。
        const catalog = mergeCatalog(liveAfterFetch.catalog, fetchedCatalog, liveAfterFetch.settings);
        // 自定义价可以自带档位：判定「翻页能不能换来精度」时必须一并考虑。
        const hasTiers = catalogHasTiers(catalog.models, liveAfterFetch.prices);
        // 每轮刷新共享一份 records 追加页预算；采集必须串行（并发会让 offset 抖动更严重）。
        const budget = { remaining: RECORDS_MAX_EXTRA_CALLS };

        const patch = {};
        let error = null;
        let denied = null;
        for (const result of usageResults) {
          if (!result.ok) {
            const failure = result.error;
            if (failure instanceof UsageError) {
              if (failure.code === "privacy-declaration-missing") {
                denied = {
                  domain: "usage",
                  code: failure.code,
                  reason: failure.details?.reason || "privacy-declaration-missing",
                  scope: failure.details?.scope || "usage",
                  message: failure.message,
                };
              }
              error = error || failure.message;
            } else {
              error = error || messageOf(failure, "读取用量失败");
            }
            continue;
          }
          const box = ranges.get(result.rangeKey);
          // 选中周期的 state 键名用真实周期（7d / 30d / all），而不是内部任务名 period。
          const rangeKey = result.rangeKey === "period" ? periodKey : result.rangeKey;
          // 页数上限按「今日 / 周期 / 全量」分级，与 state 键名无关。
          const bucket = result.rangeKey === "all" ? "allTime" : result.rangeKey;
          let records = null;
          try {
            records = await collectRangeRecords({
              rangeKey: bucket,
              box,
              usage: result.usage,
              hasTiers,
              settings: state.settings,
              profileName,
              budget,
            });
          } catch {
            // 采集异常按「截断」处理：本轮该区间回退聚合，不影响其它区间与用量展示。
            records = { rows: [], status: "truncated", pages: 0, extraCalls: 0, snapshotAt: "", badRows: 0 };
          }
          const decorated = decorateRange(
            rangeKey,
            box,
            result.usage,
            startMs,
            profileName,
            records,
          );
          if (result.rangeKey === "today") patch.today = decorated;
          if (result.rangeKey === "period") patch.period = decorated;
          if (result.rangeKey === "all") patch.allTime = decorated;
        }

        if (fxRecord) patch.fx = fxStateOf(fxRecord);
        // 请求期间可能已切换来源 / 地址，也可能写入了更新的目录：
        // 只有同源同地址的目录才按 fetchedAt 取新，否则采用与本轮设置对应的那一份。
        const live = store.get();
        const mergedCatalog = mergeCatalog(live.catalog, fetchedCatalog, live.settings);
        const merged = { ...live, ...patch, catalog: mergedCatalog };
        // 成本按「当前」设置重算：用户在请求在途期间切换精算模式 / 缓存写假设也要立刻生效。
        const costs = recostRanges(merged, mergedCatalog, merged.mappings, live.settings);
        let period = costs.period;
        if (periodKey === "today") period = { ...costs.today, key: "today" };
        else if (periodKey === "all") period = { ...costs.allTime, key: "all" };
        // 切换周期后新区间请求失败：不要沿用其它周期的数据，避免标签与数字错配。
        else if (period?.key !== periodKey) {
          period = {
            ...emptyRange(periodKey, periodRange(periodKey, date), profileName),
            fetchedAt: 0,
          };
        }

        const commit = {
          ...patch,
          today: costs.today,
          allTime: costs.allTime,
          catalog: mergedCatalog,
          loading: false,
          error,
          denied,
          lastRefreshAt: startMs,
        };
        // 请求在途期间用户切了周期：本轮数据属于旧周期，不能覆盖当前周期的占位或新数据。
        if (live.settings.period === periodKey) commit.period = period;
        else delete commit.period;
        store.set(commit);
        return { skipped: false, state: store.get() };
      } catch (error) {
        store.set({ loading: false, error: messageOf(error, "刷新失败") });
        return { skipped: false, state: store.get(), error };
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function setPeriod(period) {
    if (!PERIODS.includes(period)) return store.get();
    const current = store.get();
    // 同一周期已经成功加载过才直接复用；上次失败（summary 为空）时允许重试。
    if (
      current.settings.period === period &&
      current.period?.key === period &&
      current.period?.summary
    ) {
      return current;
    }
    // 切周期只是改设置里的一个字段：仍走同一写入队列，其它键不会丢；
    // 带新 key 的空区间与设置同一次提交，避免出现「新周期 key + 上周期数字」。
    await commitSettings({
      patch: { period },
      decorate: (settings) => {
        const date = new Date(readNowMs(now));
        return {
          periodKey: period,
          period: emptyRange(period, periodRange(period, date), settings.profileName),
        };
      },
    });
    // 在途刷新按切换前的周期快照装配数据；先等它结束，避免本次刷新被单飞直接吞掉。
    if (refreshing) await refreshing.catch(() => {});
    await refresh({ forceUsage: true });
    // 等待期间若有另一轮刷新抢先占位，本次请求仍可能被吞掉：按目标周期校正一次。
    const settled = store.get();
    if (settled.settings.period === period && settled.period?.key !== period) {
      await refresh({ forceUsage: true });
    }
    return store.get();
  }

  async function setSettings(patch) {
    // 每次变更在队列内基于「上一写入提交后」的最新设置合并 patch，避免并发覆盖。
    const { saved, previous, settings } = await commitSettings({ patch });
    startTimer();
    // 目录按来源分键存储、TTL 在下次读取时按新值求值：换源 / 改地址只换用对应缓存，
    // 真正过期才联网；只有显式的「刷新价格」才强制下载。
    const pricingChanged =
      settings.pricingUrl !== previous.pricingUrl ||
      settings.pricingSource !== previous.pricingSource;
    if (pricingChanged) await refreshPricing({ force: false });
    const fxChanged =
      settings.fxMode !== previous.fxMode || settings.fxUrl !== previous.fxUrl;
    if (fxChanged) await refreshFx({ force: true });
    // 缓存写假设只改变计价口径：用已缓存的目录 / 映射 / records 重算即可。
    const ttlChanged = settings.cacheWriteTtl !== previous.cacheWriteTtl;
    if (!pricingChanged && ttlChanged) {
      recostNow();
    }
    // 精算模式改变会改变「要不要翻页」：需要重新取用量（第 1 页本身免费）。
    if (
      settings.profileName !== previous.profileName ||
      settings.period !== previous.period ||
      settings.preciseRequests !== previous.preciseRequests
    ) {
      // 在途刷新用的是切换前的设置快照；先等它结束，避免本次刷新被单飞直接吞掉。
      if (refreshing) await refreshing.catch(() => {});
      await refresh({ forceUsage: true });
    }
    // saved 为 false 表示本地存储写入失败：当前会话照常生效，由界面提示重启后可能回退。
    return { saved, state: store.get() };
  }

  // 重置为出厂默认：设置键写回 DEFAULT_SETTINGS，价格目录、手工映射与自定义价全部保留
  //（自定义价与映射同属「用户声明」，清空走 clearCustomPrices 的独立确认）。
  async function resetSettings() {
    // 重置与其它设置变更共用同一队列：写序按用户动作线性化，不会被过期基底覆盖。
    const { saved, previous, settings } = await commitSettings({ reset: true });
    startTimer();
    // 重置后同样只换用对应来源的缓存，只有真正过期才联网。
    const pricingChanged =
      settings.pricingUrl !== previous.pricingUrl ||
      settings.pricingSource !== previous.pricingSource;
    if (pricingChanged) await refreshPricing({ force: false });
    await refreshFx({ force: true });
    // 重置会改变用量口径（档案过滤回到空）：先等在途刷新结束，避免旧设置写回。
    if (refreshing) await refreshing.catch(() => {});
    await refresh({ forceUsage: true });
    return { saved, state: store.get() };
  }

  // target 传空值表示删除该条映射。
  async function setMapping(usageModel, target) {
    const key = mappingKey(usageModel);
    if (!key) return { saved: true, state: store.get() };
    const current = store.get();
    const mappings = { ...current.mappings };
    const value = target === null || target === undefined ? "" : String(target).trim();
    if (value) mappings[key] = value;
    else delete mappings[key];
    const saved = await writeJson(STORAGE_KEYS.mappings, mappings);
    mappingVersion += 1;
    store.set({ mappings });
    store.set((latest) => recostRanges(latest, latest.catalog, latest.mappings, latest.settings));
    return { saved, state: store.get() };
  }

  // 批量清空映射：一次持久化 + 一次重算，避免逐条写存储与重复 recost。
  async function clearMappings() {
    const current = store.get();
    if (Object.keys(current.mappings || {}).length === 0) return { saved: true, state: current };
    const mappings = {};
    const saved = await writeJson(STORAGE_KEYS.mappings, mappings);
    mappingVersion += 1;
    store.set({ mappings });
    store.set((latest) => recostRanges(latest, latest.catalog, latest.mappings, latest.settings));
    return { saved, state: store.get() };
  }

  // 单个模型的自定义价：patch 是部分记录，未给的字段保持原值；null = 继承，0 = 显式免费。
  // patch 传 null / undefined 等价于删除该条；非法数字不写存储、也不动现有价表。
  async function setCustomPrice(usageModel, patch) {
    const key = priceKeyOf(usageModel);
    if (!key) return { saved: true, cleared: false, invalid: false, state: store.get() };
    const current = store.get();
    const input = patch === null || patch === undefined ? null : patch;
    if (input && (typeof input !== "object" || Array.isArray(input) || invalidPricePatch(input))) {
      return { saved: true, cleared: false, invalid: true, state: current };
    }
    const prices = { ...current.prices };
    let cleared = false;
    if (!input) {
      cleared = true;
      delete prices[key];
    } else {
      const merged = { ...(prices[key] || {}), ...input, updatedAt: readNowMs(now) };
      const normalized = normalizePrices({ [key]: merged })[key];
      if (normalized) prices[key] = normalized;
      else {
        // 六个价字段全空（且没有档位）：等同于删除该条，避免留下一条不可计价的记录。
        delete prices[key];
        cleared = true;
      }
    }
    const saved = await writeJson(STORAGE_KEYS.prices, { schema: PRICE_SCHEMA, models: prices });
    return { saved, cleared, invalid: false, state: commitPrices(prices) };
  }

  // target 传 null 表示删除该模型的自定义价。
  async function clearCustomPrice(usageModel) {
    return setCustomPrice(usageModel, null);
  }

  // 清空全部自定义价：与「重置全部映射」完全分开（映射与价格各存一个键）。
  async function clearCustomPrices() {
    const current = store.get();
    if (Object.keys(current.prices || {}).length === 0) return { saved: true, state: current };
    const saved = await writeJson(STORAGE_KEYS.prices, { schema: PRICE_SCHEMA, models: {} });
    return { saved, state: commitPrices({}) };
  }

  // 只用当前内存里的目录 / 映射 / records 重算成本（设置变更走这里，不触发任何请求）。
  function recostNow() {
    store.set((latest) => recostRanges(latest, latest.catalog, latest.mappings, latest.settings));
    return store.get();
  }
  async function refreshPricing({ force = true } = {}) {
    const current = store.get();
    const record = await ensureCatalog({
      force,
      now: readNowMs(now),
      fetchFn,
      storage: safeStorage,
      url: current.settings.pricingUrl,
      source: current.settings.pricingSource,
      key: catalogKeyOf(current.settings),
      ttlMs: resolveCatalogTtlMs(current.settings),
    });
    const catalog = catalogStateOf(record);
    // 目录请求期间用量或设置可能已经变化：基于写入那一刻的最新 state 判定来源并重算 cost，
    // 绝不回写旧用量实体，也不用旧来源目录覆盖新来源。
    const latest = store.get();
    const merged = mergeCatalog(latest.catalog, catalog, latest.settings);
    // 另一轮刷新已写入同一来源、同一地址的较新目录时，没有变化就不再重算。
    if (merged === latest.catalog) return latest;
    store.set({ catalog: merged });
    store.set((now) => recostRanges(now, now.catalog, now.mappings, now.settings));
    return store.get();
  }

  // 手动刷新汇率：只在自动模式下拉取；失败时保留旧汇率并标记 error。
  async function refreshFx({ force = true } = {}) {
    const current = store.get();
    if (current.settings.fxMode !== "auto") return current;
    const record = await ensureFx({
      force,
      now: readNowMs(now),
      fetchFn,
      storage: safeStorage,
      url: current.settings.fxUrl,
    });
    store.set({ fx: fxStateOf(record) });
    return store.get();
  }

  function dispose() {
    disposed = true;
    stopTimer();
    refreshing = null;
    recordsCache.clear();
    costMemo.clear();
  }

  return {
    store,
    getState: () => store.get(),
    subscribe: (listener) => store.subscribe(listener),
    init,
    refresh,
    setPeriod,
    setSettings,
    resetSettings,
    setMapping,
    clearMappings,
    // 自定义价：单条设置 / 单条删除 / 清空全部（都只重算成本，不重拉用量）。
    setCustomPrice,
    clearCustomPrice,
    clearCustomPrices,
    refreshPricing,
    refreshFx,
    dispose,
  };
}
