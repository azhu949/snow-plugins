import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureCatalog,
  fetchOpenRouterCatalog,
  loadCatalog,
  normalizeCatalogEntry,
  PricingError,
  saveCatalog,
} from "../src/pricing.js";
import { STORAGE_KEYS } from "../src/constants.js";

const PAYLOAD = {
  data: [
    {
      id: "deepseek/deepseek-v4.1-flash",
      canonical_slug: "deepseek/deepseek-v4.1-flash",
      name: "DeepSeek V4.1 Flash",
      context_length: 1000000,
      pricing: { prompt: "0.00000027", completion: "0.0000011", internal_reasoning: "0.000001" },
    },
    {
      id: "vendor/model-with-cache-prices",
      canonical_slug: "vendor/model-canonical",
      name: "Model With Cache Prices",
      context_length: 128000,
      pricing: {
        prompt: "0.000001",
        completion: "0.000002",
        input_cache_read: "0.0000001",
        input_cache_write: "0.0000015",
        request: "0.0004",
        overrides: { foo: "bar" },
      },
    },
    { id: "no-pricing/model", pricing: {} },
    { id: "   " },
  ],
};

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

function okFetch(payload = PAYLOAD) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    fetchFn: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => payload };
    },
  };
}

test("价格字符串解析为每 token 数字并保留原始值", () => {
  const entry = normalizeCatalogEntry(PAYLOAD.data[0]);
  assert.equal(entry.id, "deepseek/deepseek-v4.1-flash");
  assert.equal(entry.slug, "deepseek/deepseek-v4.1-flash");
  assert.equal(entry.prompt, 0.00000027);
  assert.equal(entry.completion, 0.0000011);
  assert.equal(entry.context, 1000000);
  assert.equal(entry.raw.prompt, "0.00000027");
  assert.equal(entry.raw.cacheRead, "");
});

test("缺失 cache 单价回退 prompt，request 缺省 0", () => {
  const entry = normalizeCatalogEntry(PAYLOAD.data[0]);
  assert.equal(entry.cacheRead, entry.prompt);
  assert.equal(entry.cacheWrite, entry.prompt);
  assert.equal(entry.request, 0);
});

test("显式 cache 单价与 request 优先于回退值", () => {
  const entry = normalizeCatalogEntry(PAYLOAD.data[1]);
  assert.equal(entry.cacheRead, 0.0000001);
  assert.equal(entry.cacheWrite, 0.0000015);
  assert.equal(entry.request, 0.0004);
  assert.equal(entry.slug, "vendor/model-canonical");
});

test("fetchOpenRouterCatalog 过滤无效条目并保持顺序", async () => {
  const fake = okFetch();
  const models = await fetchOpenRouterCatalog(fake.fetchFn);
  assert.equal(fake.calls, 1);
  assert.deepEqual(
    models.map((entry) => entry.id),
    ["deepseek/deepseek-v4.1-flash", "vendor/model-with-cache-prices", "no-pricing/model"],
  );
});

test("HTTP 失败与空目录给出明确错误码", async () => {
  await assert.rejects(
    () => fetchOpenRouterCatalog(async () => ({ ok: false, status: 502 })),
    (error) => error instanceof PricingError && error.code === "catalog-http-error",
  );
  await assert.rejects(
    () => fetchOpenRouterCatalog(async () => ({ ok: true, json: async () => ({ data: [] }) })),
    (error) => error instanceof PricingError && error.code === "catalog-empty",
  );
  await assert.rejects(
    () => fetchOpenRouterCatalog(async () => ({ ok: true, json: async () => ({}) })),
    (error) => error instanceof PricingError && error.code === "catalog-parse-failed",
  );
  await assert.rejects(
    () =>
      fetchOpenRouterCatalog(async () => {
        throw new Error("network");
      }),
    (error) => error instanceof PricingError && error.code === "catalog-request-failed",
  );
});

test("saveCatalog / loadCatalog 往返保留价格与元信息", async () => {
  const storage = createStorage();
  const models = await fetchOpenRouterCatalog(okFetch().fetchFn);
  await saveCatalog(storage, models, { fetchedAt: 1234, source: "network", url: "https://x" });
  const record = await loadCatalog(storage);
  assert.equal(record.fetchedAt, 1234);
  assert.equal(record.source, "network");
  assert.equal(record.count, 3);
  assert.equal(record.models[0].prompt, 0.00000027);
  assert.equal(record.models[0].cacheRead, 0.00000027);
  assert.equal(record.models[2].prompt, 0);
  assert.ok(storage.map.has(STORAGE_KEYS.catalog));
});

test("ensureCatalog 命中 TTL 不重复请求，force 强制刷新", async () => {
  const storage = createStorage();
  const fake = okFetch();
  const first = await ensureCatalog({
    fetchFn: fake.fetchFn,
    storage,
    now: 1000,
    ttlMs: 5000,
  });
  assert.equal(fake.calls, 1);
  assert.equal(first.stale, false);
  assert.equal(first.error, null);
  assert.equal(first.count, 3);

  const cached = await ensureCatalog({ fetchFn: fake.fetchFn, storage, now: 3000, ttlMs: 5000 });
  assert.equal(fake.calls, 1);
  assert.equal(cached.fetchedAt, 1000);

  const forced = await ensureCatalog({
    force: true,
    fetchFn: fake.fetchFn,
    storage,
    now: 4000,
    ttlMs: 5000,
  });
  assert.equal(fake.calls, 2);
  assert.equal(forced.fetchedAt, 4000);
});

test("ensureCatalog 失败时保留旧目录并标记 stale / error", async () => {
  const storage = createStorage();
  await ensureCatalog({ fetchFn: okFetch().fetchFn, storage, now: 1000, ttlMs: 5000 });
  const failing = async () => {
    throw new Error("network down");
  };
  const result = await ensureCatalog({ force: true, fetchFn: failing, storage, now: 2000 });
  assert.equal(result.stale, true);
  assert.equal(result.count, 3);
  assert.match(result.error, /network down/);
});

test("无缓存且失败时返回空目录与 stale 标记", async () => {
  const failing = async () => {
    throw new Error("offline");
  };
  const result = await ensureCatalog({
    force: true,
    fetchFn: failing,
    storage: createStorage(),
    now: 1,
  });
  assert.equal(result.count, 0);
  assert.deepEqual(result.models, []);
  assert.equal(result.source, "none");
  assert.equal(result.stale, true);
  assert.match(result.error, /offline/);
});

test("并发 ensureCatalog 去重为一次请求", async () => {
  const storage = createStorage();
  let started = 0;
  let release;
  const slowFetch = async () => {
    started += 1;
    return new Promise((resolve) => {
      release = () => resolve({ ok: true, json: async () => PAYLOAD });
    });
  };
  const first = ensureCatalog({ fetchFn: slowFetch, storage, now: 1, ttlMs: 5000 });
  const second = ensureCatalog({ fetchFn: slowFetch, storage, now: 1, ttlMs: 5000 });
  assert.equal(started, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(started, 1);
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.count, 3);
  assert.equal(right.count, 3);
  assert.equal(started, 1);
});
