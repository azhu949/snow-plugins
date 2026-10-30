import test from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../src/engine.js";
import { IGNORE_MAPPING, STORAGE_KEYS } from "../src/constants.js";

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
