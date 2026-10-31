import test from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_SCHEMA,
  compactEntry,
  ensureCatalog,
  fetchLiteLLMCatalog,
  fetchOpenRouterCatalog,
  loadCatalog,
  normalizeCatalogEntry,
  normalizeLiteLLMEntry,
  normalizeModelsDevEntry,
  PricingError,
  saveCatalog,
} from "../src/pricing.js";
import {
  CATALOG_MIN_ENTRIES,
  LITELLM_MIRROR_URL,
  LITELLM_URL,
  MODELS_DEV_URL,
  PRICING_SOURCES,
  STORAGE_KEYS,
  defaultPricingUrl,
} from "../src/constants.js";

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

// ---------------------------------------------------------------------------
// 档位 / 1h / LiteLLM / 紧凑格式升级
// ---------------------------------------------------------------------------

function close(actual, expected) {
  return Math.abs(Number(actual) - Number(expected)) <= Math.abs(Number(expected)) * 1e-9;
}

const SONNET_RAW = {
  id: "anthropic/claude-sonnet-4.5",
  canonical_slug: "anthropic/claude-sonnet-4.5",
  name: "Anthropic: Claude Sonnet 4.5",
  context_length: 200000,
  pricing: {
    prompt: "0.000003",
    completion: "0.000015",
    input_cache_read: "0.0000003",
    input_cache_write: "0.00000375",
    input_cache_write_1h: "0.000006",
    overrides: [
      {
        min_prompt_tokens: 200000,
        prompt: "0.000006",
        completion: "0.0000225",
        input_cache_read: "0.0000006",
        input_cache_write: "0.0000075",
        input_cache_write_1h: "0.000012",
      },
    ],
  },
};

test("OpenRouter overrides 映射成 tiers（含 1h 档位价）", () => {
  const entry = normalizeCatalogEntry(SONNET_RAW);
  assert.equal(entry.tiers.length, 1);
  assert.equal(entry.tiers[0].above, 200000);
  assert.equal(entry.tiers[0].prompt, 0.000006);
  assert.equal(entry.tiers[0].completion, 0.0000225);
  assert.equal(entry.tiers[0].cacheRead, 0.0000006);
  assert.equal(entry.tiers[0].cacheWrite, 0.0000075);
  assert.equal(entry.tiers[0].cacheWrite1h, 0.000012);
  assert.equal(entry.cacheWrite1h, 0.000006);
  assert.equal(entry.provider, "");
});

test("OpenRouter 同阈值档位去重：保留输入价更高的一条并保持升序", () => {
  const base = { prompt: "0.000003", completion: "0.000015" };
  const makeEntry = (overrides) =>
    normalizeCatalogEntry({ id: "vendor/dup-tiers", pricing: { ...base, overrides } });

  const lowerFirst = makeEntry([
    { min_prompt_tokens: 200000, prompt: "0.000006", completion: "0.0000225" },
    { min_prompt_tokens: 200000, prompt: "0.000009", completion: "0.00003" },
  ]);
  const higherFirst = makeEntry([
    { min_prompt_tokens: 200000, prompt: "0.000009", completion: "0.00003" },
    { min_prompt_tokens: 200000, prompt: "0.000006", completion: "0.0000225" },
  ]);

  // 两种输入顺序都必须留下输入价更高的一条，排除 keep-first 与 keep-last。
  for (const entry of [lowerFirst, higherFirst]) {
    assert.equal(entry.tiers.length, 1);
    assert.equal(entry.tiers[0].above, 200000);
    assert.equal(entry.tiers[0].prompt, 0.000009);
    assert.equal(entry.tiers[0].completion, 0.00003);
  }

  const sorted = makeEntry([
    { min_prompt_tokens: 1000000, prompt: "0.000012" },
    { min_prompt_tokens: 200000, prompt: "0.000006" },
    { min_prompt_tokens: 200000, prompt: "0.000009" },
  ]);
  assert.deepEqual(
    sorted.tiers.map((tier) => tier.above),
    [200000, 1000000],
  );
  assert.equal(sorted.tiers[0].prompt, 0.000009);
  assert.equal(sorted.tiers[1].prompt, 0.000012);
});

test("1h 缺失是 null（不是 0），显式 0 保留", () => {
  const missing = normalizeCatalogEntry(PAYLOAD.data[0]);
  assert.equal(missing.cacheWrite1h, null);
  assert.deepEqual(missing.tiers, []);

  const explicitZero = normalizeCatalogEntry({
    id: "vendor/free-1h",
    pricing: { prompt: "0.000001", input_cache_write_1h: "0" },
  });
  assert.equal(explicitZero.cacheWrite1h, 0);
});

test("models.dev tiers 与 context_over_200k：有 tiers 时忽略后者", () => {
  const entry = normalizeModelsDevEntry("snowflake-cortex", {
    id: "openai-gpt-5.6-luna",
    canonical_model_id: "openai/gpt-5.6-luna",
    cost: {
      input: 0.2,
      output: 1.2,
      cache_read: 0.02,
      cache_write: 0.25,
      tiers: [
        {
          input: 0.4,
          output: 1.8,
          cache_read: 0.04,
          cache_write: 0.5,
          tier: { type: "context", size: 272000 },
        },
      ],
      context_over_200k: { input: 0.4, output: 1.8, cache_read: 0.04, cache_write: 0.5 },
    },
    limit: { context: 1050000 },
  });
  assert.equal(entry.provider, "snowflake-cortex");
  assert.equal(entry.canonical, "openai/gpt-5.6-luna");
  assert.equal(entry.tiers.length, 1);
  assert.equal(entry.tiers[0].above, 272000);
  assert.ok(close(entry.tiers[0].prompt, 0.4e-6));
  assert.ok(close(entry.tiers[0].cacheWrite, 0.5e-6));
  assert.equal(entry.cacheWrite1h, null);
  assert.ok(close(entry.prompt, 0.2e-6));
});

test("models.dev 无 tiers 时用 context_over_200k 兜底，非 context 档丢弃", () => {
  const fallback = normalizeModelsDevEntry("p", {
    id: "m",
    cost: { input: 1, output: 2, context_over_200k: { input: 2, output: 4 } },
  });
  assert.equal(fallback.tiers.length, 1);
  assert.equal(fallback.tiers[0].above, 200000);
  assert.ok(close(fallback.tiers[0].prompt, 2e-6));

  const batchOnly = normalizeModelsDevEntry("p", {
    id: "m2",
    cost: {
      input: 1,
      output: 2,
      tiers: [{ input: 2, output: 4, tier: { type: "batch", size: 100000 } }],
    },
  });
  assert.deepEqual(batchOnly.tiers, []);
});

test("LiteLLM 归一化：字段映射、provider、1h、无档位", () => {
  const entry = normalizeLiteLLMEntry("claude-sonnet-4-5", {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_read_input_token_cost: 3e-7,
    cache_creation_input_token_cost: 0.00000375,
    cache_creation_input_token_cost_above_1hr: 0.000006,
    litellm_provider: "anthropic",
    max_input_tokens: 200000,
    mode: "chat",
  });
  assert.equal(entry.id, "claude-sonnet-4-5");
  assert.equal(entry.prompt, 0.000003);
  assert.equal(entry.completion, 0.000015);
  assert.equal(entry.cacheRead, 3e-7);
  assert.equal(entry.cacheWrite, 0.00000375);
  assert.equal(entry.cacheWrite1h, 0.000006);
  assert.equal(entry.provider, "anthropic");
  assert.equal(entry.request, 0);
  assert.equal(entry.canonical, "claude-sonnet-4-5");
  assert.deepEqual(entry.tiers, []);
});

test("LiteLLM 档位字段的千 token 阈值换算成 token", () => {
  const entry = normalizeLiteLLMEntry("anthropic.claude-sonnet-4-20250514-v1:0", {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    input_cost_per_token_above_200k_tokens: 0.000006,
    output_cost_per_token_above_200k_tokens: 0.0000225,
    cache_read_input_token_cost_above_200k_tokens: 6e-7,
    cache_creation_input_token_cost_above_200k_tokens: 0.0000075,
    litellm_provider: "bedrock_converse",
    mode: "chat",
  });
  assert.equal(entry.tiers.length, 1);
  assert.equal(entry.tiers[0].above, 200000);
  assert.equal(entry.tiers[0].prompt, 0.000006);
  assert.equal(entry.tiers[0].completion, 0.0000225);
  assert.equal(entry.tiers[0].cacheRead, 6e-7);
  assert.equal(entry.tiers[0].cacheWrite, 0.0000075);
  assert.equal(entry.tiers[0].cacheWrite1h, null);
});

test("LiteLLM 只保留文本模式与有 token 价的条目，显式 0 保留", async () => {
  const payload = {
    a: { mode: "chat", input_cost_per_token: 0.000001 },
    b: { mode: "image_generation", input_cost_per_token: 0.000001 },
    c: { mode: "embedding", input_cost_per_token: 0.000001 },
    d: { mode: "", input_cost_per_token: 0.000002, output_cost_per_token: 0.000003 },
    e: { mode: "chat", litellm_provider: "x" },
    f: {},
    g: { mode: "chat", input_cost_per_token: 0, output_cost_per_token: 0 },
  };
  const models = await fetchLiteLLMCatalog(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  }));
  assert.deepEqual(models.map((entry) => entry.id).sort(), ["a", "d", "g"]);
  assert.equal(models.find((entry) => entry.id === "g").prompt, 0);

  const zeroCache = normalizeLiteLLMEntry("z", {
    mode: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000002,
    cache_read_input_token_cost: 0,
    cache_creation_input_token_cost: 0,
  });
  assert.equal(zeroCache.cacheRead, 0);
  assert.equal(zeroCache.cacheWrite, 0);
});

test("LiteLLM 默认地址失败时切镜像，并保留实际地址", async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (calls.length === 1) throw new Error("cdn down");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        m: { mode: "chat", input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
      }),
    };
  };
  const models = await fetchLiteLLMCatalog(fetchFn, LITELLM_URL);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], LITELLM_MIRROR_URL);
  assert.equal(models.length, 1);
  assert.equal(models.sourceUrl, LITELLM_MIRROR_URL);
});

test("LiteLLM 自定义地址失败不触发镜像重试", async () => {
  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw new Error("offline");
  };
  await assert.rejects(
    () =>
      fetchLiteLLMCatalog(failing, "https://example.com/prices.json", {
        mirrorUrl: LITELLM_MIRROR_URL,
      }),
    (error) => error instanceof PricingError && error.code === "catalog-request-failed",
  );
  assert.equal(calls, 1);
});

test("ensureCatalog 记录镜像标记，但缓存键仍按请求地址复用", async () => {
  const storage = createStorage();
  let calls = 0;
  const fetchFn = async (url) => {
    calls += 1;
    if (url === LITELLM_URL) throw new Error("cdn down");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        m: { mode: "chat", input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
      }),
    };
  };
  const first = await ensureCatalog({
    source: "litellm",
    url: LITELLM_URL,
    key: STORAGE_KEYS.catalogLiteLLM,
    fetchFn,
    storage,
    now: 1000,
    minEntries: 0,
  });
  assert.equal(first.url, LITELLM_URL);
  assert.equal(first.resolvedUrl, LITELLM_MIRROR_URL);
  assert.equal(first.mirror, true);
  assert.equal(first.tierInclusive, false);
  assert.equal(first.count, 1);

  const second = await ensureCatalog({
    source: "litellm",
    url: LITELLM_URL,
    key: STORAGE_KEYS.catalogLiteLLM,
    fetchFn,
    storage,
    now: 2000,
    minEntries: 0,
  });
  assert.equal(calls, 2, "TTL 内应复用镜像结果，不再请求");
  assert.equal(second.fetchedAt, 1000);
});

test("紧凑格式 v2：11 列往返保留 tiers 与 1h，9 列旧缓存原样可读", async () => {
  const entry = normalizeCatalogEntry(SONNET_RAW);
  const compact = compactEntry(entry);
  assert.equal(compact.length, 11);
  assert.equal(compact[9], 0.000006);
  assert.equal(Array.isArray(compact[10]), true);

  const storage = createStorage();
  await saveCatalog(storage, [entry], {
    fetchedAt: 1234,
    source: "network",
    provider: "openrouter",
    url: "https://openrouter.ai/api/v1/models?output_modalities=all",
  });
  const record = await loadCatalog(storage);
  assert.equal(record.schema, CATALOG_SCHEMA);
  assert.equal(record.schema, 2);
  assert.equal(record.tierInclusive, true);
  const loaded = record.models[0];
  assert.equal(loaded.cacheWrite1h, 0.000006);
  assert.equal(loaded.tiers.length, 1);
  assert.equal(loaded.tiers[0].above, 200000);
  assert.equal(loaded.tiers[0].cacheWrite1h, 0.000012);

  // 旧 9 列缓存：价格完全一致，新增字段回退成 null / 空数组。
  const legacyStorage = createStorage({
    [STORAGE_KEYS.catalog]: {
      fetchedAt: 42,
      source: "network",
      provider: "openrouter",
      url: "https://openrouter.ai/api/v1/models?output_modalities=all",
      count: 1,
      models: [
        [
          "anthropic/claude-sonnet-4.5",
          "",
          "",
          0.000003,
          0.000015,
          0.0000003,
          0.00000375,
          0,
          "anthropic/claude-sonnet-4.5",
        ],
      ],
    },
  });
  const legacy = await loadCatalog(legacyStorage);
  assert.equal(legacy.schema, 0);
  assert.equal(legacy.tierInclusive, true, "旧 OpenRouter 记录按 URL 推断为 >= 语义");
  const oldEntry = legacy.models[0];
  assert.equal(oldEntry.prompt, 0.000003);
  assert.equal(oldEntry.cacheRead, 0.0000003);
  assert.equal(oldEntry.cacheWrite, 0.00000375);
  assert.equal(oldEntry.cacheWrite1h, null);
  assert.deepEqual(oldEntry.tiers, []);
});

test("10 列旧缓存（只有 1h）也能读，缺 tiers 时回退空数组", async () => {
  const storage = createStorage({
    [STORAGE_KEYS.catalog]: {
      fetchedAt: 7,
      provider: "openrouter",
      url: "https://openrouter.ai/api/v1/models",
      models: [["vendor/x", "", "", 0.000001, 0.000002, null, null, 0, "vendor/x", 0.000003]],
    },
  });
  const record = await loadCatalog(storage);
  assert.equal(record.models[0].cacheWrite1h, 0.000003);
  assert.deepEqual(record.models[0].tiers, []);
});

test("旧记录按来源推断档位比较语义，新记录用写入值", async () => {
  const modelsDevStorage = createStorage({
    [STORAGE_KEYS.catalogModelsDev]: {
      fetchedAt: 1,
      provider: "modelsdev",
      url: MODELS_DEV_URL,
      models: [["m", "p", "", 0.000001, 0.000002, null, null, 0, ""]],
    },
  });
  assert.equal((await loadCatalog(modelsDevStorage, STORAGE_KEYS.catalogModelsDev)).tierInclusive, false);

  const storage = createStorage();
  await saveCatalog(storage, [normalizeCatalogEntry(PAYLOAD.data[0])], {
    fetchedAt: 2,
    provider: "modelsdev",
    url: MODELS_DEV_URL,
  });
  assert.equal((await loadCatalog(storage)).tierInclusive, false);

  await saveCatalog(storage, [normalizeCatalogEntry(PAYLOAD.data[0])], {
    fetchedAt: 3,
    provider: "openrouter",
    url: "https://custom.example/prices.json",
    tierInclusive: true,
  });
  assert.equal((await loadCatalog(storage)).tierInclusive, true);
});

test("ensureCatalog 不用残缺目录覆盖健康缓存", async () => {
  const storage = createStorage();
  await ensureCatalog({
    fetchFn: okFetch().fetchFn,
    storage,
    now: 1000,
    minEntries: 3,
  });
  const tiny = { data: [PAYLOAD.data[0]] };
  const result = await ensureCatalog({
    force: true,
    fetchFn: okFetch(tiny).fetchFn,
    storage,
    now: 2000,
    minEntries: 3,
  });
  assert.equal(result.stale, true);
  assert.equal(result.count, 3);
  assert.match(result.error, /少于 3/);
  const after = await loadCatalog(storage);
  assert.equal(after.count, 3, "旧目录不能被残缺响应覆盖");
  assert.equal(after.fetchedAt, 1000);
});

test("LiteLLM 价格源常量与默认地址", () => {
  assert.equal(CATALOG_MIN_ENTRIES, 100);
  assert.ok(PRICING_SOURCES.includes("litellm"));
  assert.equal(defaultPricingUrl("litellm"), LITELLM_URL);
  assert.equal(defaultPricingUrl("modelsdev"), MODELS_DEV_URL);
  assert.match(LITELLM_MIRROR_URL, /^https:\/\//);
});
