import test from "node:test";
import assert from "node:assert/strict";
import { estimatePeriod, splitModelTokens } from "../src/cost.js";
import { normalizeCatalogEntry } from "../src/pricing.js";
import { IGNORE_MAPPING } from "../src/constants.js";

function entry(overrides = {}) {
  return {
    id: "deepseek/deepseek-v4.1-flash",
    slug: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    prompt: 2e-6,
    completion: 8e-6,
    cacheRead: 0.5e-6,
    cacheWrite: 2.5e-6,
    request: 0.001,
    context: 1000000,
    raw: {},
    ...overrides,
  };
}

function model(overrides = {}) {
  return {
    model: "deepseek/deepseek-v4.1-flash",
    totalRequests: 4,
    errorRequests: 1,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    totalCacheCreationInputTokens: 100,
    totalCacheReadInputTokens: 400,
    totalTokens: 1500,
    ...overrides,
  };
}

function summary(totalTokens = 1500) {
  return {
    totalInputTokens: 1000,
    totalOutputTokens: totalTokens - 1000,
    totalRequests: 4,
    errorRequests: 1,
    totalTokens,
  };
}

test("splitModelTokens 按 input 子集截断 cache read 与 cache creation", () => {
  const tokens = splitModelTokens(model());
  assert.equal(tokens.cacheRead, 400);
  assert.equal(tokens.cacheCreation, 100);
  assert.equal(tokens.nonCachedInput, 500);
  assert.equal(tokens.billableRequests, 3);
  assert.equal(tokens.totalTokens, 1500);
});

test("cache read 超过 input、creation 与 read 重叠时不出现负数", () => {
  const tokens = splitModelTokens({
    totalInputTokens: 1000,
    totalOutputTokens: 0,
    totalCacheReadInputTokens: 600,
    totalCacheCreationInputTokens: 600,
    totalRequests: 1,
    errorRequests: 0,
  });
  assert.equal(tokens.cacheRead, 600);
  assert.equal(tokens.cacheCreation, 400);
  assert.equal(tokens.nonCachedInput, 0);

  const overflow = splitModelTokens({
    totalInputTokens: 100,
    totalOutputTokens: 0,
    totalCacheReadInputTokens: 900,
    totalCacheCreationInputTokens: 900,
  });
  assert.equal(overflow.cacheRead, 100);
  assert.equal(overflow.cacheCreation, 0);
  assert.equal(overflow.nonCachedInput, 0);
});

test("成本公式覆盖缓存读写、输出与请求费", () => {
  const result = estimatePeriod(summary(), [model()], [entry()], {});
  const line = result.byModel[0];
  assert.equal(line.status, "exact");
  assert.equal(line.tokens, 1500);
  assert.equal(line.parts.input, 0.001);
  assert.equal(line.parts.cacheRead, 0.0002);
  assert.equal(line.parts.cacheWrite, 0.00025);
  assert.equal(line.parts.output, 0.004);
  assert.equal(line.parts.request, 0.003);
  assert.equal(line.costUsd, 0.00845);
  assert.equal(result.totalUsd, 0.00845);
  assert.equal(result.pricedTokens, 1500);
  assert.equal(result.unpricedTokens, 0);
  assert.equal(result.ignoredTokens, 0);
  assert.equal(result.coverage, 1);
});

test("缺失 cache 单价回退 prompt", () => {
  const fallback = normalizeCatalogEntry({
    id: "deepseek/deepseek-v4.1-flash",
    pricing: { prompt: "0.000002", completion: "0.000008" },
  });
  const result = estimatePeriod(
    summary(1000),
    [
      model({
        totalInputTokens: 1000,
        totalOutputTokens: 0,
        totalCacheReadInputTokens: 100,
        totalCacheCreationInputTokens: 0,
        totalTokens: 1000,
      }),
    ],
    [fallback],
    {},
  );
  const line = result.byModel[0];
  assert.ok(Math.abs(line.parts.input - 0.0018) < 1e-12);
  assert.ok(Math.abs(line.parts.cacheRead - 0.0002) < 1e-12);
  assert.equal(line.parts.request, 0);
  assert.ok(Math.abs(line.costUsd - 0.002) < 1e-12);
});

test("错误请求不计请求费", () => {
  const result = estimatePeriod(
    summary(1000),
    [
      model({
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadInputTokens: 0,
        totalCacheCreationInputTokens: 0,
        totalTokens: 0,
        totalRequests: 4,
        errorRequests: 4,
      }),
    ],
    [entry({ request: 0.01 })],
    {},
  );
  assert.equal(result.byModel[0].parts.request, 0);

  const mixed = estimatePeriod(
    summary(1000),
    [
      model({
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadInputTokens: 0,
        totalCacheCreationInputTokens: 0,
        totalTokens: 0,
        totalRequests: 3,
        errorRequests: 1,
      }),
    ],
    [entry({ request: 0.01 })],
    {},
  );
  assert.equal(mixed.byModel[0].parts.request, 0.02);
});

test("忽略与未匹配模型单独统计，coverage 以 summary 总量扣除忽略为准", () => {
  const models = [
    model({ totalTokens: 100, totalInputTokens: 80, totalOutputTokens: 20 }),
    model({
      model: "umans-deepseek-v4.1-flash-1017-lab",
      totalTokens: 50,
      totalInputTokens: 40,
      totalOutputTokens: 10,
    }),
    model({
      model: "DeepSeek-Flash",
      totalTokens: 30,
      totalInputTokens: 20,
      totalOutputTokens: 10,
    }),
  ];
  const result = estimatePeriod(summary(200), models, [entry()], {
    "umans-deepseek-v4.1-flash-1017-lab": IGNORE_MAPPING,
  });
  assert.equal(result.byModel[0].status, "exact");
  assert.equal(result.byModel[1].status, "ignored");
  assert.equal(result.byModel[1].costUsd, 0);
  assert.equal(result.byModel[2].status, "unmatched");
  assert.equal(result.byModel[2].costUsd, 0);
  assert.equal(result.pricedTokens, 100);
  assert.equal(result.ignoredTokens, 50);
  assert.equal(result.unpricedTokens, 30);
  assert.equal(result.modelsTokens, 180);
  assert.equal(result.coverage, 2 / 3);
  assert.equal(result.totalTokens, 200);
});

test("summary 缺失时 token 总量为 0 且不报错", () => {
  const result = estimatePeriod(null, [], [], {});
  assert.equal(result.totalUsd, 0);
  assert.equal(result.totalTokens, 0);
  assert.equal(result.coverage, 0);
  assert.deepEqual(result.byModel, []);
});
