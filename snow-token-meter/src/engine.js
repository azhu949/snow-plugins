// 引擎：并行拉取今日 / 选中周期 / 全量用量，合并价格目录并重算成本。
// 对外只暴露状态快照与动作，UI 通过 store 订阅渲染。
import {
  ALL_TIME_CACHE_MS,
  DEFAULT_SETTINGS,
  PERIODS,
  REFRESH_SECONDS,
  REFRESH_THROTTLE_MS,
  STORAGE_KEYS,
} from "./constants.js";
import { estimatePeriod } from "./cost.js";
import { ensureFx, loadFx } from "./fx.js";
import { mappingKey } from "./match.js";
import { ensureCatalog, loadCatalog } from "./pricing.js";
import { normalizeMappings, normalizeSettings, resolveCatalogTtlMs } from "./settings.js";
import { createStore } from "./store.js";
import { createUsageSource, UsageError } from "./usage.js";
import { allTimeRange, periodRange, todayRange } from "./util.js";

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

// 两个价格源各占一个存储键，切换来源不会互相覆盖缓存。
function catalogKeyOf(settings) {
  return settings?.pricingSource === "modelsdev"
    ? STORAGE_KEYS.catalogModelsDev
    : STORAGE_KEYS.catalog;
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
function decorateRange(key, box, usage, fetchedAt, profileName) {
  return {
    key,
    since: box.since,
    until: box.until,
    summary: usage?.summary || null,
    models: Array.isArray(usage?.models) ? usage.models : [],
    fetchedAt,
    profileName,
  };
}

// 目录或映射变化时只重算成本，不重新请求用量。
function recostRanges(state, catalog, mappings) {
  const next = {};
  for (const key of ["today", "period", "allTime"]) {
    const item = state[key];
    next[key] = item
      ? {
          ...item,
          cost: item.summary ? estimatePeriod(item.summary, item.models, catalog, mappings) : null,
        }
      : item;
  }
  return next;
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

  async function hydrate() {
    const [rawSettings, rawMappings, fxRecord] = await Promise.all([
      readJson(STORAGE_KEYS.settings, null),
      readJson(STORAGE_KEYS.mappings, null),
      loadFx(safeStorage).catch(() => null),
    ]);
    const settings = normalizeSettings(rawSettings || DEFAULT_SETTINGS);
    const catalogRecord = await loadCatalog(safeStorage, catalogKeyOf(settings)).catch(() => null);
    return {
      settings,
      mappings: normalizeMappings(rawMappings),
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
          const decorated = decorateRange(rangeKey, box, result.usage, startMs, profileName);
          if (result.rangeKey === "today") patch.today = decorated;
          if (result.rangeKey === "period") patch.period = decorated;
          if (result.rangeKey === "all") patch.allTime = decorated;
        }

        const fetchedCatalog = catalogStateOf(catalogRecord);
        if (fxRecord) patch.fx = fxStateOf(fxRecord);
        // 请求期间可能已切换来源 / 地址，也可能写入了更新的目录：
        // 只有同源同地址的目录才按 fetchedAt 取新，否则采用与本轮设置对应的那一份。
        const live = store.get();
        const catalog = mergeCatalog(live.catalog, fetchedCatalog, live.settings);
        const merged = { ...live, ...patch, catalog };
        const costs = recostRanges(merged, catalog.models, merged.mappings);
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
          catalog,
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
    const settings = normalizeSettings({ ...current.settings, period });
    await writeJson(STORAGE_KEYS.settings, settings);
    // 立刻换成带新 key 的空区间：刷新返回前只能渲染占位，不能把上一周期的数字当成新周期。
    const date = new Date(readNowMs(now));
    store.set({
      settings,
      periodKey: period,
      period: emptyRange(period, periodRange(period, date), settings.profileName),
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
    const current = store.get();
    const settings = normalizeSettings({
      ...current.settings,
      ...(patch && typeof patch === "object" ? patch : {}),
    });
    const saved = await writeJson(STORAGE_KEYS.settings, settings);
    store.set({ settings, periodKey: settings.period });
    startTimer();
    // 目录按来源分键存储、TTL 在下次读取时按新值求值：换源 / 改地址只换用对应缓存，
    // 真正过期才联网；只有显式的「刷新价格」才强制下载。
    const pricingChanged =
      settings.pricingUrl !== current.settings.pricingUrl ||
      settings.pricingSource !== current.settings.pricingSource;
    if (pricingChanged) await refreshPricing({ force: false });
    const fxChanged =
      settings.fxMode !== current.settings.fxMode || settings.fxUrl !== current.settings.fxUrl;
    if (fxChanged) await refreshFx({ force: true });
    if (
      settings.profileName !== current.settings.profileName ||
      settings.period !== current.settings.period
    ) {
      // 在途刷新用的是切换前的设置快照；先等它结束，避免本次刷新被单飞直接吞掉。
      if (refreshing) await refreshing.catch(() => {});
      await refresh({ forceUsage: true });
    }
    // saved 为 false 表示本地存储写入失败：当前会话照常生效，由界面提示重启后可能回退。
    return { saved, state: store.get() };
  }

  // 重置为出厂默认：设置键写回 DEFAULT_SETTINGS，价格目录与手工映射保留。
  async function resetSettings() {
    const current = store.get();
    const settings = normalizeSettings(DEFAULT_SETTINGS);
    const saved = await writeJson(STORAGE_KEYS.settings, settings);
    store.set({ settings, periodKey: settings.period });
    startTimer();
    // 重置后同样只换用对应来源的缓存，只有真正过期才联网。
    const pricingChanged =
      settings.pricingUrl !== current.settings.pricingUrl ||
      settings.pricingSource !== current.settings.pricingSource;
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
    const costs = recostRanges({ ...current, mappings }, current.catalog.models, mappings);
    store.set({ mappings, ...costs });
    return { saved, state: store.get() };
  }

  // 批量清空映射：一次持久化 + 一次重算，避免逐条写存储与重复 recost。
  async function clearMappings() {
    const current = store.get();
    if (Object.keys(current.mappings || {}).length === 0) return { saved: true, state: current };
    const mappings = {};
    const saved = await writeJson(STORAGE_KEYS.mappings, mappings);
    const costs = recostRanges({ ...current, mappings }, current.catalog.models, mappings);
    store.set({ mappings, ...costs });
    return { saved, state: store.get() };
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
    store.set((latest) => {
      const merged = mergeCatalog(latest.catalog, catalog, latest.settings);
      // 另一轮刷新已写入同一来源、同一地址的较新目录时，没有变化就不再重算。
      if (merged === latest.catalog) return {};
      const costs = recostRanges({ ...latest, catalog: merged }, merged.models, latest.mappings);
      return { catalog: merged, ...costs };
    });
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
    refreshPricing,
    refreshFx,
    dispose,
  };
}
