import test from "node:test";
import assert from "node:assert/strict";
import { createEngine, recordsMaxPages, recordsPlanFor } from "../src/engine.js";
import {
  IGNORE_MAPPING,
  LITELLM_URL,
  MODELS_DEV_URL,
  OPENROUTER_MODELS_URL,
  STORAGE_KEYS,
} from "../src/constants.js";

const NOW = new Date(2026, 9, 30, 12, 0, 0);

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    async getJson(key) {
      return map.has(key) ? JSON.parse(JSON.stringify(map.get(key))) : null;
    },
    async setJson(key, value) {
      map.set(key, JSON.parse(JSON.stringify(value)));
    },
  };
}

function usagePayload(totalTokens, modelName = "deepseek/deepseek-v4.1-flash") {
  const input = Math.round(totalTokens * 0.8);
  const output = totalTokens - input;
  return {
    generatedAt: NOW.getTime(),
    domains: {
      usage: {
        summary: {
          totalInputTokens: input,
          totalOutputTokens: output,
          totalCacheCreationInputTokens: 0,
          totalCacheReadInputTokens: 0,
          totalRequests: 2,
          errorRequests: 0,
          totalTokens,
        },
        models: [
          {
            model: modelName,
            totalRequests: 2,
            errorRequests: 0,
            totalInputTokens: input,
            totalOutputTokens: output,
            totalCacheCreationInputTokens: 0,
            totalCacheReadInputTokens: 0,
            totalTokens,
          },
        ],
      },
    },
    denied: {},
    withheld: {},
    unknown: [],
  };
}

function createApi() {
  const calls = [];
  return {
    calls,
    metadata: {
      async get(domains, options) {
        calls.push({ domains, params: { ...options.params } });
        const since = options.params.since;
        if (since === "2000-01-01 00:00:00") return usagePayload(5000);
        if (since === "2026-10-24 00:00:00") return usagePayload(700);
        return usagePayload(100);
      },
    },
  };
}

function createCatalogFetch() {
  let calls = 0;
  let fxCalls = 0;
  return {
    get calls() {
      return calls;
    },
    get fxCalls() {
      return fxCalls;
    },
    async fetchFn(url) {
      if (String(url).includes("frankfurter")) {
        fxCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ rates: { CNY: 7.2 } }),
        };
      }
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "deepseek/deepseek-v4.1-flash",
              canonical_slug: "deepseek/deepseek-v4.1-flash",
              name: "DeepSeek V4.1 Flash",
              context_length: 1000000,
              pricing: { prompt: "0.000001", completion: "0.000002" },
            },
          ],
        }),
      };
    },
  };
}

function createFakeEngine() {
  const storage = createStorage();
  const api = createApi();
  const catalog = createCatalogFetch();
  const engine = createEngine({
    api,
    storage,
    now: () => NOW,
    fetchFn: catalog.fetchFn,
    timer: false,
  });
  return { engine, storage, api, catalog };
}

test("init 并行拉取今日与全量、合并价格目录并计算成本", async () => {
  const { engine, api, catalog } = createFakeEngine();
  await engine.init();
  const state = engine.getState();

  assert.equal(state.initialized, true);
  assert.equal(state.loading, false);
  assert.equal(state.error, null);
  assert.equal(state.denied, null);
  assert.equal(state.lastRefreshAt, NOW.getTime());
  assert.equal(state.today.summary.totalTokens, 100);
  assert.equal(state.period.key, "today");
  assert.equal(state.period.summary.totalTokens, 100);
  assert.equal(state.allTime.summary.totalTokens, 5000);
  assert.equal(state.catalog.count, 1);
  assert.equal(state.catalog.stale, false);
  assert.equal(state.catalog.error, null);
  assert.ok(state.today.cost.totalUsd > 0);
  assert.equal(state.today.cost.byModel[0].status, "exact");
  assert.equal(api.calls.length, 2);
  assert.equal(api.calls[0].domains[0], "usage");
  assert.equal(catalog.calls, 1);
  engine.dispose();
});

test("10 秒节流：短时间内的自动刷新被跳过", async () => {
  const { engine, api } = createFakeEngine();
  await engine.init();
  const callsAfterInit = api.calls.length;
  const result = await engine.refresh();
  assert.equal(result.skipped, true);
  assert.equal(api.calls.length, callsAfterInit);
  engine.dispose();
});

test("setPeriod 切换周期并重新拉取选中区间", async () => {
  const { engine, api } = createFakeEngine();
  await engine.init();
  const before = api.calls.length;
  await engine.setPeriod("7d");
  const state = engine.getState();
  assert.equal(state.settings.period, "7d");
  assert.equal(state.periodKey, "7d");
  assert.equal(state.period.key, "7d");
  assert.equal(state.period.summary.totalTokens, 700);
  assert.equal(api.calls.length, before + 2);
  assert.ok(api.calls.some((call) => call.params.since === "2026-10-24 00:00:00"));
  engine.dispose();
});

test("全量区间在 5 分钟内复用，不重复请求", async () => {
  const { engine, api } = createFakeEngine();
  await engine.init();
  const allCalls = () =>
    api.calls.filter((call) => call.params.since === "2000-01-01 00:00:00").length;
  assert.equal(allCalls(), 1);
  await engine.setPeriod("30d");
  assert.equal(allCalls(), 1);
  engine.dispose();
});

test("denied 转为 state.denied 与明确错误，不抛出", async () => {
  const storage = createStorage();
  const catalog = createCatalogFetch();
  const engine = createEngine({
    api: {
      metadata: {
        async get() {
          return {
            domains: {},
            denied: { usage: { reason: "privacy-declaration-missing", scope: "usage" } },
            withheld: {},
            unknown: [],
          };
        },
      },
    },
    storage,
    now: () => NOW,
    fetchFn: catalog.fetchFn,
    timer: false,
  });
  await engine.init();
  const state = engine.getState();
  assert.equal(state.denied.code, "privacy-declaration-missing");
  assert.equal(state.denied.scope, "usage");
  assert.match(state.error, /@snow-privacy/);
  assert.equal(state.today.summary, null);
  assert.equal(state.loading, false);
  engine.dispose();
});

test("切换周期失败时 period 置空而不是沿用其它周期数据", async () => {
  const storage = createStorage();
  const catalog = createCatalogFetch();
  const api = {
    metadata: {
      async get(domains, options) {
        if (options.params.since === "2026-10-24 00:00:00") {
          return { domains: {}, denied: {}, withheld: {}, unknown: [] };
        }
        return usagePayload(100);
      },
    },
  };
  const engine = createEngine({
    api,
    storage,
    now: () => NOW,
    fetchFn: catalog.fetchFn,
    timer: false,
  });
  await engine.init();
  await engine.setPeriod("7d");
  const state = engine.getState();
  assert.equal(state.settings.period, "7d");
  assert.equal(state.period.key, "7d");
  assert.equal(state.period.summary, null);
  assert.match(state.error, /usage/);
  assert.equal(state.today.summary.totalTokens, 100);
  engine.dispose();
});

test("setMapping 持久化映射并立即重算成本", async () => {
  const { engine, storage } = createFakeEngine();
  await engine.init();
  await engine.setMapping("DeepSeek/deepseek-v4.1-flash", IGNORE_MAPPING);
  const state = engine.getState();
  assert.deepEqual(state.mappings, { "deepseek/deepseek-v4.1-flash": IGNORE_MAPPING });
  assert.equal(state.today.cost.ignoredTokens, 100);
  assert.equal(state.today.cost.pricedTokens, 0);
  assert.equal(state.today.cost.totalUsd, 0);
  assert.deepEqual(storage.map.get(STORAGE_KEYS.mappings), {
    "deepseek/deepseek-v4.1-flash": IGNORE_MAPPING,
  });
  engine.dispose();
});

test("init 从存储恢复设置与映射", async () => {
  const storage = createStorage({
    [STORAGE_KEYS.settings]: { period: "7d", displayCurrency: "CNY", refreshSeconds: 1 },
    [STORAGE_KEYS.mappings]: { "deepseek/deepseek-v4.1-flash": IGNORE_MAPPING },
  });
  const api = createApi();
  const catalog = createCatalogFetch();
  const engine = createEngine({
    api,
    storage,
    now: () => NOW,
    fetchFn: catalog.fetchFn,
    timer: false,
  });
  await engine.init();
  const state = engine.getState();
  assert.equal(state.settings.period, "7d");
  assert.equal(state.settings.displayCurrency, "CNY");
  assert.equal(state.settings.refreshSeconds, 30);
  assert.equal(state.period.key, "7d");
  assert.equal(state.period.cost.ignoredTokens, 700);
  assert.equal(state.allTime.cost.ignoredTokens, 5000);
  assert.ok(api.calls.some((call) => call.params.since === "2026-10-24 00:00:00"));
  engine.dispose();
});

test("setSettings 归一化非法值并持久化", async () => {
  const { engine, storage } = createFakeEngine();
  await engine.init();
  await engine.setSettings({ fxRate: 99, refreshSeconds: 1, displayCurrency: "cny" });
  const state = engine.getState();
  assert.equal(state.settings.fxRate, 20);
  assert.equal(state.settings.refreshSeconds, 30);
  assert.equal(state.settings.displayCurrency, "CNY");
  assert.equal(storage.map.get(STORAGE_KEYS.settings).displayCurrency, "CNY");
  engine.dispose();
});

test("refreshPricing 强制刷新目录并重算成本", async () => {
  const { engine, catalog } = createFakeEngine();
  await engine.init();
  assert.equal(catalog.calls, 1);
  await engine.refreshPricing({ force: true });
  assert.equal(catalog.calls, 2);
  assert.equal(engine.getState().catalog.count, 1);
  engine.dispose();
});

test("目录请求失败时保留用量展示并标记 catalog.error", async () => {
  const storage = createStorage();
  const api = createApi();
  const engine = createEngine({
    api,
    storage,
    now: () => NOW,
    fetchFn: async () => {
      throw new Error("offline");
    },
    timer: false,
  });
  await engine.init();
  const state = engine.getState();
  assert.equal(state.today.summary.totalTokens, 100);
  assert.equal(state.catalog.count, 0);
  assert.equal(state.catalog.stale, true);
  assert.match(state.catalog.error, /offline/);
  assert.equal(state.today.cost.totalUsd, 0);
  assert.equal(state.today.cost.unpricedTokens, 100);
  engine.dispose();
});

/* --------------------------- 逐请求精算 --------------------------- */

const MODEL = "deepseek/deepseek-v4.1-flash";

// 目录带档位（OpenRouter pricing.overrides，>= 语义）：base 1/2 USD per 1M，档位 2/4。
function createTieredCatalogFetch() {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async fetchFn(url) {
      if (String(url).includes("frankfurter")) {
        return { ok: true, status: 200, json: async () => ({ rates: { CNY: 7.2 } }) };
      }
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: MODEL,
              canonical_slug: MODEL,
              name: "DeepSeek V4.1 Flash",
              context_length: 1000000,
              pricing: {
                prompt: "0.000001",
                completion: "0.000002",
                input_cache_read: "0.0000001",
                input_cache_write: "0.000001",
                overrides: [
                  { min_prompt_tokens: 100, prompt: "0.000002", completion: "0.000004" },
                ],
              },
            },
          ],
        }),
      };
    },
  };
}

function record(id, input, output, createdAt = "2026-10-30 10:00:00") {
  return {
    id,
    conversationId: "c1",
    responseId: `r-${id}`,
    model: MODEL,
    apiProfileName: "",
    apiConfigId: "",
    requestMethod: "chat",
    inputTokens: input,
    outputTokens: output,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    status: "success",
    isSubAgent: false,
    directoryId: "",
    createdAt,
  };
}

// 一段「短请求 + 长请求」的逐条数据：汇总 200 / 100 / 2 次。
function recordsUsage({ input = 200, output = 100, requests = 2, rows = [record("a", 150, 50), record("b", 50, 50)] } = {}) {
  return {
    generatedAt: NOW.getTime(),
    domains: {
      usage: {
        summary: {
          totalInputTokens: input,
          totalOutputTokens: output,
          totalCacheCreationInputTokens: 0,
          totalCacheReadInputTokens: 0,
          totalRequests: requests,
          errorRequests: 0,
        },
        models: [
          {
            model: MODEL,
            totalRequests: requests,
            errorRequests: 0,
            totalInputTokens: input,
            totalOutputTokens: output,
            totalCacheCreationInputTokens: 0,
            totalCacheReadInputTokens: 0,
          },
        ],
        records: { items: rows, total: rows.length },
      },
    },
    denied: {},
    withheld: {},
    unknown: [],
  };
}

function createRecordsEngine({
  payload = null,
  catalog = createTieredCatalogFetch(),
  settings = null,
  prices = null,
} = {}) {
  const initial = { ...(settings ? { [STORAGE_KEYS.settings]: settings } : {}) };
  if (prices) initial[STORAGE_KEYS.prices] = { schema: 1, models: prices };
  const storage = createStorage(initial);
  const calls = [];
  const api = {
    calls,
    metadata: {
      async get(domains, options) {
        calls.push({ domains, params: { ...options.params } });
        const base = payload || recordsUsage();
        // 与宿主一致：按 limit / offset 切片返回同一批逐条数据（第 1 页也是切片后的前 100 条）。
        const offset = Number(options?.params?.offset) || 0;
        const limit = Number(options?.params?.limit) || 100;
        const usage = base.domains.usage;
        const items = usage.records?.items;
        if (!Array.isArray(items)) return base;
        return {
          ...base,
          domains: {
            ...base.domains,
            usage: {
              ...usage,
              records: { items: items.slice(offset, offset + limit), total: items.length },
            },
          },
        };
      },
    },
  };
  const engine = createEngine({
    api,
    storage,
    now: () => NOW,
    fetchFn: catalog.fetchFn,
    timer: false,
  });
  return { engine, storage, catalog, calls };
}

test("records 覆盖完整且目录有档位时按逐请求精算，不追加任何调用", async () => {
  const { engine, calls, catalog } = createRecordsEngine();
  await engine.init();
  const state = engine.getState();
  const cost = state.today.cost;

  // 两个请求（150/50 越档、50/50 不越档）分别计价：0.0005 + 0.00015。
  assert.equal(cost.mode, "precise");
  assert.equal(cost.recordsStatus, "complete");
  assert.equal(cost.recordsRows, 2);
  assert.equal(cost.recordsPages, 1);
  assert.equal(cost.recordsExtraCalls, 0);
  assert.ok(Math.abs(cost.totalUsd - 0.00065) < 1e-12);
  assert.equal(cost.isLowerBound, false);
  assert.equal(cost.byModel[0].mode, "precise");
  // 第 1 页随 usage 免费返回：整轮只有今日 + 全量两次用量调用。
  assert.equal(calls.length, 2);
  assert.equal(calls.filter((call) => call.params.offset > 0).length, 0);
  assert.equal(catalog.calls, 1);
  engine.dispose();
});

test("聚合与精算在同一 fixture 下差额可解释：下限 < 精算 < 上限", async () => {
  const preciseEngine = createRecordsEngine();
  await preciseEngine.engine.init();
  const precise = preciseEngine.engine.getState().today.cost;
  preciseEngine.engine.dispose();

  const aggregateEngine = createRecordsEngine({ settings: { preciseRequests: "off" } });
  await aggregateEngine.engine.init();
  const aggregate = aggregateEngine.engine.getState().today.cost;
  aggregateEngine.engine.dispose();

  assert.equal(aggregate.mode, "aggregate");
  assert.equal(aggregate.recordsStatus, "off");
  assert.equal(aggregate.recordsRows, 0);
  // 聚合桶 200/100 不知道哪条越档：基础价 0.0004、全档位价 0.0008。
  assert.ok(Math.abs(aggregate.lowerUsd - 0.0004) < 1e-12);
  assert.ok(Math.abs(aggregate.upperUsd - 0.0008) < 1e-12);
  assert.equal(aggregate.isLowerBound, true);
  assert.ok(aggregate.lowerUsd < precise.totalUsd);
  assert.ok(precise.totalUsd < aggregate.upperUsd);
});

test("请求数超过页数上限时整体回退聚合且不翻页", async () => {
  const { engine, calls } = createRecordsEngine({
    payload: recordsUsage({ input: 70000, output: 35000, requests: 700 }),
  });
  await engine.init();
  const cost = engine.getState().today.cost;
  assert.equal(cost.mode, "aggregate");
  assert.equal(cost.recordsStatus, "truncated");
  assert.equal(cost.recordsRows, 0);
  assert.equal(cost.recordsExtraCalls, 0);
  // 诊断位写的是「被超过的页数上限」，界面文案才能说清是几页。
  assert.equal(cost.recordsPages, 5);
  assert.equal(calls.length, 2);
  engine.dispose();
});

test("逐条与汇总 token 不一致时回退聚合并标记 mismatch", async () => {
  const { engine } = createRecordsEngine({
    payload: recordsUsage({ input: 100000, output: 100, requests: 2 }),
  });
  await engine.init();
  const cost = engine.getState().today.cost;
  assert.equal(cost.mode, "aggregate");
  assert.equal(cost.recordsStatus, "mismatch");
  // recordsRows 是「采集到的行数」：行已取到但因汇总口径不符而未参与计价。
  assert.equal(cost.recordsRows, 2);
  engine.dispose();
});

test("目录无档位且请求数超一页时 auto 只接受首屏，回退聚合并标记 partial-no-tier", async () => {
  const { engine, calls } = createRecordsEngine({
    payload: recordsUsage({ input: 150000, output: 75000, requests: 150 }),
    catalog: createCatalogFetch(),
  });
  await engine.init();
  const cost = engine.getState().today.cost;
  assert.equal(cost.mode, "aggregate");
  assert.equal(cost.recordsStatus, "partial-no-tier");
  assert.equal(calls.length, 2);
  engine.dispose();
});

test("映射变化只重算成本：records 快照与用量调用都不变", async () => {
  const { engine, calls } = createRecordsEngine();
  await engine.init();
  assert.equal(engine.getState().today.cost.mode, "precise");
  const callsAfterInit = calls.length;
  await engine.setMapping(MODEL, IGNORE_MAPPING);
  const state = engine.getState();
  assert.equal(calls.length, callsAfterInit);
  assert.equal(state.today.records.rows.length, 2);
  assert.equal(state.today.records.status, "complete");
  assert.equal(state.today.cost.recordsRows, 2);
  assert.equal(state.today.cost.totalUsd, 0);
  assert.equal(state.today.cost.ignoredTokens, 300);
  engine.dispose();
});

test("缓存写假设变化只重算成本，不重拉用量", async () => {
  const { engine, calls } = createRecordsEngine();
  await engine.init();
  const callsAfterInit = calls.length;
  await engine.setSettings({ cacheWriteTtl: "1h" });
  const state = engine.getState();
  assert.equal(calls.length, callsAfterInit);
  assert.equal(state.today.cost.mode, "precise");
  // 目录没有 1 小时价：金额不变，但必须声明「该模型目录无 1 小时价」。
  assert.ok(state.today.cost.assumptions.includes("cacheWrite5mOnly"));
  engine.dispose();
});

test("同一快照重复刷新复用 records 缓存，不再追加翻页调用", async () => {
  // 150 条请求、每条 1000 / 100：首页 100 条不够，必须翻到第 2 页。
  const rows = Array.from({ length: 150 }, (_, index) => record(`r${index}`, 1000, 100));
  const { engine, calls } = createRecordsEngine({
    payload: recordsUsage({ input: 150000, output: 15000, requests: 150, rows }),
  });
  await engine.init();
  const offsetCalls = () => calls.filter((call) => call.params.offset > 0).length;
  assert.equal(engine.getState().today.cost.recordsStatus, "complete");
  assert.equal(engine.getState().today.cost.recordsRows, 150);
  // 今日与全量各追加 1 页。
  assert.equal(offsetCalls(), 2);

  const usageCallsBefore = calls.length;
  await engine.refresh({ forceUsage: true });
  // summary 未变 → 数据身份相同 → 命中缓存，不追加页；全量区间仍在 5 分钟缓存内，只重取今日。
  assert.equal(offsetCalls(), 2);
  assert.equal(calls.length, usageCallsBefore + 1);
  engine.dispose();
});

test("目录价格变化只重算成本，pricedAt 跟随目录版本", async () => {
  let clock = NOW.getTime();
  let price = "0.000001";
  const storage = createStorage();
  const api = createApi();
  const engine = createEngine({
    api,
    storage,
    now: () => new Date(clock),
    fetchFn: async (url) => {
      if (String(url).includes("frankfurter")) {
        return { ok: true, status: 200, json: async () => ({ rates: { CNY: 7.2 } }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: MODEL,
              canonical_slug: MODEL,
              name: "DeepSeek V4.1 Flash",
              pricing: { prompt: price, completion: price },
            },
          ],
        }),
      };
    },
    timer: false,
  });
  await engine.init();
  const before = engine.getState().today.cost;
  const beforePricedAt = before.pricedAt;
  assert.ok(before.totalUsd > 0);

  clock += 60 * 1000;
  price = "0.000002";
  await engine.refreshPricing({ force: true });
  const state = engine.getState();
  const after = state.today.cost;
  // 用量没变、只换目录：金额翻倍，且目录版本与 pricedAt 一起前移。
  assert.ok(Math.abs(after.totalUsd - before.totalUsd * 2) < 1e-12);
  assert.ok(after.pricedAt > beforePricedAt);
  assert.equal(after.pricedAt, state.catalog.fetchedAt);
  engine.dispose();
});

test("recordsPlanFor 判定精算触发方式", () => {
  const summary = { totalRequests: 150 };
  assert.deepEqual(recordsPlanFor({ preciseRequests: "off" }), { status: "off" });
  assert.deepEqual(recordsPlanFor({ preciseRequests: "auto" }), { status: "no-records" });
  assert.deepEqual(
    recordsPlanFor({ summary: { totalRequests: 0 }, hasRecords: true, preciseRequests: "auto" }),
    { status: "empty" },
  );
  assert.deepEqual(
    recordsPlanFor({ summary, hasRecords: true, hasTiers: true, preciseRequests: "auto" }),
    { collect: true },
  );
  assert.deepEqual(
    recordsPlanFor({ summary, hasRecords: true, hasTiers: false, preciseRequests: "auto" }),
    { status: "partial-no-tier" },
  );
  assert.deepEqual(
    recordsPlanFor({ summary, hasRecords: true, hasTiers: false, preciseRequests: "always" }),
    { collect: true },
  );
  // 全量区间上限 3 页（300 条）：301 条就超限。
  assert.deepEqual(
    recordsPlanFor({
      rangeKey: "allTime",
      summary: { totalRequests: 301 },
      hasRecords: true,
      hasTiers: true,
    }),
    { status: "truncated" },
  );
  assert.equal(recordsMaxPages("today"), 5);
  assert.equal(recordsMaxPages("allTime"), 3);
});

/* --------------------------- 自定义价 --------------------------- */

test("自定义价：写独立存储键、金额立即变化、不重拉用量", async () => {
  const { engine, storage, api } = createFakeEngine();
  await engine.init();
  const callsAfterInit = api.calls.length;
  const before = engine.getState().today.cost.totalUsd;

  const result = await engine.setCustomPrice(MODEL, { input: 100 });
  const state = engine.getState();
  assert.equal(result.saved, true);
  assert.equal(result.invalid, false);
  assert.equal(api.calls.length, callsAfterInit, "改价只能重算成本，不能重新请求用量");
  assert.equal(state.prices[MODEL].input, 100);
  assert.ok(state.priceVersion > 0);
  assert.equal(state.today.cost.byModel[0].status, "custom");
  assert.equal(state.today.cost.byModel[0].entryId, `custom:${MODEL}`);
  assert.equal(state.today.cost.customModels, 1);
  assert.ok(state.today.cost.totalUsd > before, "自定义价更高时金额必须变大");
  // 值以 USD/1M 存储（界面同单位），不进 mapping 键。
  assert.equal(storage.map.get(STORAGE_KEYS.prices).models[MODEL].input, 100);
  assert.equal(storage.map.has(STORAGE_KEYS.mappings), false);
  engine.dispose();
});

test("自定义价：清映射不清价、清价不清映射", async () => {
  const { engine, storage } = createFakeEngine();
  await engine.init();
  await engine.setMapping(MODEL, IGNORE_MAPPING);
  await engine.setCustomPrice(MODEL, { input: 2 });

  await engine.clearMappings();
  let state = engine.getState();
  assert.deepEqual(state.mappings, {});
  assert.equal(Object.keys(state.prices).length, 1, "重置映射不得清自定义价");
  assert.ok(storage.map.get(STORAGE_KEYS.prices));

  await engine.setMapping(MODEL, MODEL);
  const cleared = await engine.clearCustomPrices();
  state = engine.getState();
  assert.equal(cleared.saved, true);
  assert.deepEqual(state.prices, {});
  assert.deepEqual(storage.map.get(STORAGE_KEYS.prices).models, {});
  assert.deepEqual(state.mappings, { [MODEL]: MODEL }, "清价不得清映射");
  engine.dispose();
});

test("重置设置只回到默认值：自定义价与映射保留", async () => {
  const { engine } = createFakeEngine();
  await engine.init();
  await engine.setCustomPrice(MODEL, { input: 2 });
  await engine.setMapping(MODEL, MODEL);

  await engine.resetSettings();
  const state = engine.getState();
  assert.equal(Object.keys(state.prices).length, 1, "重置设置不得清自定义价");
  assert.equal(state.prices[MODEL].input, 2);
  assert.deepEqual(state.mappings, { [MODEL]: MODEL }, "重置设置不得清映射");
  engine.dispose();
});

test("自定义价：单条删除、全空 patch 视为删除、非法数字不写存储", async () => {
  const { engine, storage } = createFakeEngine();
  await engine.init();
  await engine.setCustomPrice(MODEL, { input: 3, note: "relay" });
  assert.equal(engine.getState().prices[MODEL].note, "relay");

  const removed = await engine.clearCustomPrice(MODEL);
  assert.equal(removed.cleared, true);
  assert.deepEqual(engine.getState().prices, {});

  await engine.setCustomPrice(MODEL, { input: 3 });
  const invalid = await engine.setCustomPrice(MODEL, { output: "abc" });
  assert.equal(invalid.invalid, true);
  assert.equal(engine.getState().prices[MODEL].input, 3, "非法输入不得删掉已有价格");

  // 四个 token 价与按次费全空、且没有档位：等价于删除该条。
  const empty = await engine.setCustomPrice(MODEL, {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
  });
  assert.equal(empty.cleared, true);
  assert.deepEqual(engine.getState().prices, {});
  engine.dispose();
});

test("自定义价写入失败时返回 saved=false，但当前会话仍然生效", async () => {
  const storage = createStorage();
  const api = createApi();
  const catalog = createCatalogFetch();
  const failingStorage = {
    ...storage,
    async setJson(key, value) {
      if (key === STORAGE_KEYS.prices) return false;
      return storage.setJson(key, value);
    },
  };
  const engine = createEngine({
    api,
    storage: failingStorage,
    now: () => NOW,
    fetchFn: catalog.fetchFn,
    timer: false,
  });
  await engine.init();
  const result = await engine.setCustomPrice(MODEL, { input: 3 });
  assert.equal(result.saved, false);
  assert.equal(engine.getState().today.cost.byModel[0].status, "custom");
  engine.dispose();
});

test("价表损坏时备份原始值并回退空表", async () => {
  const storage = createStorage({ [STORAGE_KEYS.prices]: { schema: 1, models: "oops" } });
  const api = createApi();
  const catalog = createCatalogFetch();
  const engine = createEngine({
    api,
    storage,
    now: () => NOW,
    fetchFn: catalog.fetchFn,
    timer: false,
  });
  await engine.init();
  const state = engine.getState();
  assert.deepEqual(state.prices, {});
  assert.ok(storage.map.get(STORAGE_KEYS.priceBackup), "坏数据必须备份到独立键");
  assert.deepEqual(storage.map.get(STORAGE_KEYS.prices), { schema: 1, models: {} });
  assert.equal(state.today.cost.byModel[0].status, "exact", "回退后仍按目录价计价");
  engine.dispose();
});

/* --------------------------- 成本缓存键 / 价格源路由 --------------------------- */

// 目录缓存记录与 pricing.js 的落盘形态一致：models 用 11 列紧凑数组。
function compactCatalogEntry(id, prompt = 1e-6, completion = 2e-6) {
  return [id, "", "", prompt, completion, prompt, prompt, 0, id, null, null];
}

function makeCatalogRecord({ provider, url, fetchedAt, models }) {
  return {
    fetchedAt,
    source: "network",
    provider,
    url,
    count: models.length,
    models,
    schema: 2,
    tierInclusive: provider === "openrouter",
    mirror: false,
    resolvedUrl: "",
    failedAt: 0,
    failedError: "",
    failedUrl: "",
  };
}

test("成本缓存键覆盖 models 行：summary 不变、models 变化时金额与明细都更新", async () => {
  const payload = recordsUsage();
  const { engine, calls } = createRecordsEngine({
    payload,
    settings: { preciseRequests: "off" },
  });
  await engine.init();
  const before = engine.getState().today.cost;
  const beforeSummary = engine.getState().today.summary;
  assert.equal(before.mode, "aggregate");
  assert.ok(Math.abs(before.totalUsd - 0.0004) < 1e-12);
  assert.equal(before.byModel[0].tokenParts.cacheRead, 0);

  // summary 三项完全不变，只让缓存读从 0 变 100（同一批请求命中缓存）。
  payload.domains.usage.models[0].totalCacheReadInputTokens = 100;
  const callsBefore = calls.length;
  await engine.refresh({ forceUsage: true });
  const state = engine.getState();
  const after = state.today.cost;

  assert.deepEqual(state.today.summary, beforeSummary);
  assert.notEqual(after, before, "models 变化后不得命中旧成本结果");
  assert.equal(after.byModel[0].tokenParts.cacheRead, 100);
  assert.equal(after.byModel[0].tokenParts.input, 100);
  assert.ok(Math.abs(after.totalUsd - 0.00031) < 1e-12);
  assert.equal(after.isLowerBound, true);
  assert.ok(Math.abs(after.upperUsd - 0.00061) < 1e-12);
  assert.equal(calls.length, callsBefore + 1, "只重取今日，不追加翻页");
  engine.dispose();
});

test("价格源路由：init 按 pricingSource 读取对应目录键", async () => {
  const now = NOW.getTime();
  const storage = createStorage({
    [STORAGE_KEYS.settings]: { pricingSource: "litellm", fxMode: "manual" },
    [STORAGE_KEYS.catalogLiteLLM]: makeCatalogRecord({
      provider: "litellm",
      url: LITELLM_URL,
      fetchedAt: now - 60 * 1000,
      models: [compactCatalogEntry("litellm-only")],
    }),
    [STORAGE_KEYS.catalogModelsDev]: makeCatalogRecord({
      provider: "modelsdev",
      url: MODELS_DEV_URL,
      fetchedAt: now - 120 * 1000,
      models: [compactCatalogEntry("modelsdev-one"), compactCatalogEntry("modelsdev-two")],
    }),
    [STORAGE_KEYS.catalog]: makeCatalogRecord({
      provider: "openrouter",
      url: OPENROUTER_MODELS_URL,
      fetchedAt: now - 180 * 1000,
      models: [
        compactCatalogEntry("or-one"),
        compactCatalogEntry("or-two"),
        compactCatalogEntry("or-three"),
      ],
    }),
  });
  let fetches = 0;
  const engine = createEngine({
    api: createApi(),
    storage,
    now: () => NOW,
    fetchFn: async () => {
      fetches += 1;
      throw new Error("should not fetch");
    },
    timer: false,
  });

  await engine.init();
  let state = engine.getState();
  assert.equal(state.catalog.provider, "litellm");
  assert.equal(state.catalog.url, LITELLM_URL);
  assert.equal(state.catalog.count, 1);
  assert.equal(state.catalog.fetchedAt, now - 60 * 1000);
  assert.equal(state.catalog.stale, false);
  assert.equal(fetches, 0, "目录缓存新鲜时不应联网");

  // 换源必须同时换默认地址：只改 pricingSource 会保留旧地址，从而触发联网并按错误结构解析。
  await engine.setSettings({ pricingSource: "modelsdev", pricingUrl: MODELS_DEV_URL });
  state = engine.getState();
  assert.equal(state.catalog.provider, "modelsdev");
  assert.equal(state.catalog.url, MODELS_DEV_URL);
  assert.equal(state.catalog.count, 2);
  assert.equal(state.catalog.fetchedAt, now - 120 * 1000);
  assert.equal(fetches, 0, "另一个来源的新鲜缓存同样不应联网");
  engine.dispose();
});

test("价格源路由：换源只写目标目录键，不覆盖另外两个键", async () => {
  const now = NOW.getTime();
  const litellmRecord = makeCatalogRecord({
    provider: "litellm",
    url: LITELLM_URL,
    fetchedAt: now - 60 * 1000,
    models: [compactCatalogEntry("litellm-only")],
  });
  const openRouterRecord = makeCatalogRecord({
    provider: "openrouter",
    url: OPENROUTER_MODELS_URL,
    fetchedAt: now - 3 * 60 * 60 * 1000,
    models: [compactCatalogEntry("or-one"), compactCatalogEntry("or-two")],
  });
  const storage = createStorage({
    [STORAGE_KEYS.settings]: {
      pricingSource: "litellm",
      pricingUrl: LITELLM_URL,
      fxMode: "manual",
      catalogTtlHours: 1,
    },
    [STORAGE_KEYS.catalogLiteLLM]: litellmRecord,
    [STORAGE_KEYS.catalog]: openRouterRecord,
  });
  const urls = [];
  const api = createApi();
  const engine = createEngine({
    api,
    storage,
    now: () => NOW,
    fetchFn: async (url) => {
      const text = String(url);
      urls.push(text);
      if (text === MODELS_DEV_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            acme: {
              models: {
                "acme-modelsdev": {
                  id: "acme-modelsdev",
                  name: "Acme Models",
                  cost: { input: 1, output: 2 },
                  limit: { context: 128000 },
                },
              },
            },
          }),
        };
      }
      throw new Error(`unexpected url ${text}`);
    },
    timer: false,
  });

  await engine.init();
  const beforeLiteLLM = JSON.parse(JSON.stringify(storage.map.get(STORAGE_KEYS.catalogLiteLLM)));
  const beforeOpenRouter = JSON.parse(JSON.stringify(storage.map.get(STORAGE_KEYS.catalog)));
  const usageCalls = api.calls.length;

  await engine.setSettings({ pricingSource: "modelsdev", pricingUrl: MODELS_DEV_URL });

  const saved = storage.map.get(STORAGE_KEYS.catalogModelsDev);
  assert.ok(saved, "换源必须写入目标来源的键");
  assert.equal(saved.provider, "modelsdev");
  assert.equal(saved.url, MODELS_DEV_URL);
  assert.equal(saved.schema, 2);
  assert.equal(saved.tierInclusive, false);
  assert.equal(saved.count, 1);
  assert.equal(saved.models[0][0], "acme-modelsdev");
  assert.deepEqual(urls, [MODELS_DEV_URL], "只请求目标来源的地址");
  assert.deepEqual(
    storage.map.get(STORAGE_KEYS.catalogLiteLLM),
    beforeLiteLLM,
    "不得覆盖 LiteLLM 的目录键",
  );
  assert.deepEqual(
    storage.map.get(STORAGE_KEYS.catalog),
    beforeOpenRouter,
    "不得覆盖 OpenRouter 的目录键",
  );
  assert.equal(api.calls.length, usageCalls, "换源不得重拉用量");

  const state = engine.getState();
  assert.equal(state.catalog.provider, "modelsdev");
  assert.equal(state.catalog.count, 1);
  engine.dispose();
});
