import test from "node:test";
import assert from "node:assert/strict";
import {
  costOfRecord,
  estimatePeriod,
  estimateRange,
  priceOf,
  selectTier,
  splitModelTokens,
  splitTokens,
} from "../src/cost.js";
import { expandStoredEntry, normalizeCatalogEntry } from "../src/pricing.js";
import { IGNORE_MAPPING } from "../src/constants.js";
import { normalizePrices } from "../src/prices.js";

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

// 真实 OpenRouter 条目 anthropic/claude-sonnet-4.5 的快照（USD / token）。
function sonnet(overrides = {}) {
  return {
    id: "anthropic/claude-sonnet-4.5",
    provider: "",
    slug: "anthropic/claude-sonnet-4.5",
    name: "Anthropic: Claude Sonnet 4.5",
    prompt: 3e-6,
    completion: 15e-6,
    cacheRead: 0.3e-6,
    cacheWrite: 3.75e-6,
    cacheWrite1h: 6e-6,
    request: 0,
    tiers: [
      {
        above: 200000,
        prompt: 6e-6,
        completion: 22.5e-6,
        cacheRead: 0.6e-6,
        cacheWrite: 7.5e-6,
        cacheWrite1h: 12e-6,
      },
    ],
    canonical: "anthropic/claude-sonnet-4.5",
    context: 200000,
    ...overrides,
  };
}

function sonnetRow({ input, output = 0, read = 0, creation = 0, requests = 1, errors = 0, name = "anthropic/claude-sonnet-4.5" }) {
  return {
    model: name,
    totalRequests: requests,
    errorRequests: errors,
    totalInputTokens: input,
    totalOutputTokens: output,
    totalCacheReadInputTokens: read,
    totalCacheCreationInputTokens: creation,
    totalTokens: input + output,
  };
}

function summaryOf(rows) {
  const acc = { totalInputTokens: 0, totalOutputTokens: 0, totalRequests: 0, errorRequests: 0 };
  for (const row of rows) {
    acc.totalInputTokens += row.totalInputTokens;
    acc.totalOutputTokens += row.totalOutputTokens;
    acc.totalRequests += row.totalRequests;
    acc.errorRequests += row.errorRequests;
  }
  acc.totalTokens = acc.totalInputTokens + acc.totalOutputTokens;
  return acc;
}

function close(actual, expected) {
  return Math.abs(Number(actual) - Number(expected)) <= Math.max(1e-12, Math.abs(expected) * 1e-9);
}

function assertClose(actual, expected, label = "") {
  assert.ok(close(actual, expected), `${label} 期望 ${expected}，实际 ${actual}`);
}

// parts 五项之和必须等于行金额（倍率作用在单价层，不得破坏对账口径）。
function assertParts(line) {
  const total =
    line.parts.input + line.parts.cacheRead + line.parts.cacheWrite + line.parts.output + line.parts.request;
  assertClose(total, line.costUsd, `${line.model} parts 合计`);
}

function record({
  input,
  output = 0,
  read = 0,
  creation = 0,
  status = "success",
  name = "anthropic/claude-sonnet-4.5",
  createdAt = "2026-10-30 12:00:00",
}) {
  return {
    id: `${name}-${input}-${output}-${read}-${creation}-${status}-${createdAt}`,
    model: name,
    status,
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: read,
    cacheCreationInputTokens: creation,
    createdAt,
  };
}

test("splitModelTokens 按 input 子集截断 cache read 与 cache creation", () => {
  const tokens = splitModelTokens(model());
  assert.equal(tokens.cacheRead, 400);
  assert.equal(tokens.cacheCreation, 100);
  assert.equal(tokens.nonCachedInput, 500);
  assert.equal(tokens.billableRequests, 3);
  assert.equal(tokens.totalTokens, 1500);
  assert.equal(tokens.cacheCreationOutside, false);
  assert.equal(tokens.promptForTier, 1000);
});

test("cache read 超过 input、creation 超出 input-read 时视为在 input 之外", () => {
  const tokens = splitModelTokens({
    totalInputTokens: 1000,
    totalOutputTokens: 0,
    totalCacheReadInputTokens: 600,
    totalCacheCreationInputTokens: 600,
    totalRequests: 1,
    errorRequests: 0,
  });
  assert.equal(tokens.cacheRead, 600);
  assert.equal(tokens.cacheCreation, 600, "creation 不再被截断");
  assert.equal(tokens.cacheCreationOutside, true);
  assert.equal(tokens.nonCachedInput, 400);
  assert.equal(tokens.promptForTier, 1600);

  const overflow = splitModelTokens({
    totalInputTokens: 100,
    totalOutputTokens: 0,
    totalCacheReadInputTokens: 900,
    totalCacheCreationInputTokens: 900,
  });
  assert.equal(overflow.cacheRead, 100);
  assert.equal(overflow.cacheCreation, 900);
  assert.equal(overflow.cacheCreationOutside, true);
  assert.equal(overflow.nonCachedInput, 0);
  assert.equal(overflow.promptForTier, 1000);
  assert.ok(overflow.nonCachedInput >= 0);
  assert.ok(overflow.cacheRead <= overflow.input);
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
  assert.equal(result.mode, "aggregate");
  assert.equal(result.totalUsd, result.lowerUsd);
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
  assert.equal(result.rowCoverage, 100 / 130);
  assert.equal(result.upperUsd, null, "存在未计价 token 时没有上界");
  assert.equal(result.isLowerBound, true);
});

test("summary 缺失时 token 总量为 0 且不报错", () => {
  const result = estimatePeriod(null, [], [], {});
  assert.equal(result.totalUsd, 0);
  assert.equal(result.totalTokens, 0);
  assert.equal(result.coverage, 0);
  assert.deepEqual(result.byModel, []);
});

test("S1 单条长请求：整次进档，5m 为下限、1h 为上界", () => {
  const row = sonnetRow({ input: 250000, read: 180000, creation: 50000, output: 5000 });
  const result = estimatePeriod(summaryOf([row]), [row], [sonnet()], {});
  const line = result.byModel[0];
  assert.equal(line.status, "exact");
  assert.equal(line.parts.input, 0.12);
  assert.equal(line.parts.cacheRead, 0.108);
  assert.equal(line.parts.cacheWrite, 0.375);
  assert.equal(line.parts.output, 0.1125);
  assert.equal(line.costUsd, 0.7155);
  assert.equal(line.tierAbove, 200000);
  assert.equal(result.totalUsd, 0.7155);
  assertClose(result.upperUsd, 0.9405, "1h 上界");
  assert.equal(result.isLowerBound, true);
  assert.deepEqual(result.assumptions, ["cacheWrite5m"]);
});

test("S2 缓存写按 1h 假设：0.9405 且区间塌缩", () => {
  const row = sonnetRow({ input: 250000, read: 180000, creation: 50000, output: 5000 });
  const result = estimateRange({
    summary: summaryOf([row]),
    models: [row],
    catalog: { models: [sonnet()], tierInclusive: true },
    mappings: {},
    settings: { cacheWriteTtl: "1h" },
  });
  assert.equal(result.totalUsd, 0.9405);
  assert.equal(result.upperUsd, 0.9405);
  assert.equal(result.isLowerBound, false);
  assert.deepEqual(result.assumptions, ["cacheWrite1hAssumed"]);
});

test("S3 单条短请求不越档：0.2565", () => {
  const row = sonnetRow({ input: 100000, read: 30000, creation: 10000, output: 2000 });
  const result = estimatePeriod(summaryOf([row]), [row], [sonnet()], {});
  assert.equal(result.byModel[0].costUsd, 0.2565);
  assert.equal(result.byModel[0].tierAbove, null);
  assertClose(result.upperUsd, 0.279, "1h 上界");
});

test("S4 聚合桶：下限 0.6330，档位上限 1.2135（无 1h 价时）", () => {
  const row = sonnetRow({ input: 350000, read: 210000, creation: 60000, output: 7000, requests: 2 });
  const without1h = sonnet({ cacheWrite1h: null, tiers: [{ ...sonnet().tiers[0], cacheWrite1h: null }] });
  const base = estimatePeriod(summaryOf([row]), [row], [without1h], {});
  assert.equal(base.totalUsd, 0.633);
  assert.equal(base.upperUsd, 1.2135);
  assert.equal(base.isLowerBound, true);
  assert.equal(base.byModel[0].tierAbove, null, "跨档时不给单一档位");
  assert.equal(base.mode, "aggregate");

  const with1h = estimatePeriod(summaryOf([row]), [row], [sonnet()], {});
  assert.equal(with1h.totalUsd, 0.633);
  assertClose(with1h.upperUsd, 1.4835, "叠加 1h 后的真实上界");
});

test("S4 逐请求精算：0.9720，上界 1.2195", () => {
  const long = record({ input: 250000, read: 180000, creation: 50000, output: 5000 });
  const short = record({ input: 100000, read: 30000, creation: 10000, output: 2000 });
  const row = sonnetRow({ input: 350000, read: 210000, creation: 60000, output: 7000, requests: 2 });
  const cost = estimateRange({
    summary: summaryOf([row]),
    models: [row],
    catalog: { models: [sonnet()], tierInclusive: true },
    mappings: {},
    rows: [long, short],
    recordsStatus: "complete",
    settings: {},
  });
  assert.equal(cost.mode, "precise");
  assert.equal(cost.totalUsd, 0.972);
  assertClose(cost.upperUsd, 1.2195, "1h 上界");
  assert.equal(cost.requests, 2);
  assert.equal(cost.byModel[0].tokens, 357000);
  assert.equal(cost.byModel[0].requests, 2);
  assert.equal(cost.byModel[0].tierAbove, null);
  assert.equal(cost.pricedTokens, 357000);
  assert.equal(cost.isLowerBound, true);
  // 行金额与分项自洽
  const parts = cost.byModel[0].parts;
  const sum = parts.input + parts.cacheRead + parts.cacheWrite + parts.output + parts.request;
  assertClose(sum, cost.byModel[0].costUsd, "parts 合计");
});

test("档位阈值：inclusive 用 >=，exclusive 用 >", () => {
  const tierOnly = sonnet({
    cacheWrite1h: null,
    tiers: [
      {
        above: 200000,
        prompt: 6e-6,
        completion: 22.5e-6,
        cacheRead: 0.6e-6,
        cacheWrite: 7.5e-6,
        cacheWrite1h: null,
      },
    ],
  });
  const costAt = (input, inclusive) => {
    const row = sonnetRow({ input });
    return estimatePeriod(
      summaryOf([row]),
      [row],
      { models: [tierOnly], tierInclusive: inclusive },
      {},
    ).byModel[0].costUsd;
  };
  assertClose(costAt(199999, true), 0.599997, "inclusive 未达阈值");
  assert.equal(costAt(200000, true), 1.2, "inclusive 恰好等于阈值即进档");
  assertClose(costAt(200001, true), 1.200006, "inclusive 超过阈值");
  assertClose(costAt(199999, false), 0.599997, "exclusive 未达阈值");
  assert.equal(costAt(200000, false), 0.6, "exclusive 等于阈值仍在基础档");
  assertClose(costAt(200001, false), 1.200006, "exclusive 超过阈值进档");
});

test("S5 creation 在 input 之外：0.0330", () => {
  const row = sonnetRow({ input: 1000, read: 0, creation: 8000, output: 0 });
  const tokens = splitTokens(row);
  assert.equal(tokens.cacheCreation, 8000);
  assert.equal(tokens.cacheCreationOutside, true);
  assert.equal(tokens.nonCachedInput, 1000);
  assert.equal(tokens.promptForTier, 9000);

  const result = estimatePeriod(summaryOf([row]), [row], [sonnet()], {});
  const line = result.byModel[0];
  assert.equal(line.parts.input, 0.003);
  assert.equal(line.parts.cacheWrite, 0.03);
  assert.equal(line.costUsd, 0.033);
});

test("档位分项缺失继承基础价（0 是显式免费）", () => {
  const inherited = sonnet({
    tiers: [{ above: 1000, prompt: 6e-6, completion: null, cacheRead: null, cacheWrite: null, cacheWrite1h: null }],
  });
  const price = priceOf(inherited, selectTier(inherited, 2000, true));
  assert.equal(price.prompt, 6e-6);
  assert.equal(price.completion, 15e-6);
  assert.equal(price.cacheRead, 0.3e-6);
  assert.equal(price.cacheWrite, 3.75e-6);
  assert.equal(price.cacheWrite1h, 6e-6);

  const free = priceOf(inherited, { above: 1000, cacheWrite1h: 0 });
  assert.equal(free.cacheWrite1h, 0);
  assert.equal(priceOf(inherited, null).cacheWrite1h, 6e-6);

  const row = sonnetRow({ input: 2000, read: 1000, creation: 0, output: 1000 });
  const result = estimatePeriod(summaryOf([row]), [row], [inherited], {});
  assert.equal(result.byModel[0].costUsd, 0.0213);
});

test("逐请求：按 status 跳过错误记录的按次费，token 仍计价", () => {
  const custom = sonnet({
    id: "m",
    slug: "m",
    name: "m",
    canonical: "m",
    tiers: [],
    cacheWrite1h: null,
    prompt: 1e-6,
    completion: 1e-6,
    cacheRead: 1e-6,
    cacheWrite: 1e-6,
    request: 0.01,
  });
  const rows = [
    record({ name: "m", input: 1000 }),
    record({ name: "m", input: 1000, status: "error" }),
    record({ name: "m", input: 1000 }),
  ];
  const modelRow = { model: "m", totalRequests: 3, errorRequests: 1, totalInputTokens: 3000, totalOutputTokens: 0, totalTokens: 3000 };
  const cost = estimateRange({
    summary: { totalInputTokens: 3000, totalOutputTokens: 0, totalTokens: 3000, totalRequests: 3, errorRequests: 1 },
    models: [modelRow],
    catalog: { models: [custom], tierInclusive: true },
    mappings: {},
    rows,
    recordsStatus: "complete",
    settings: {},
  });
  assert.equal(cost.byModel[0].parts.request, 0.02);
  assert.equal(cost.byModel[0].requests, 3);
  assert.equal(cost.byModel[0].errorRequests, 1);
  assertClose(cost.byModel[0].costUsd, 0.023, "三个请求的 token 费 + 两次按次费");
});

test("单条请求精确化：无 1h 价时区间塌缩且不显示下限", () => {
  const row = sonnetRow({ input: 250000, read: 180000, creation: 50000, output: 5000 });
  const no1h = sonnet({ cacheWrite1h: null, tiers: [{ ...sonnet().tiers[0], cacheWrite1h: null }] });
  const result = estimatePeriod(summaryOf([row]), [row], [no1h], {});
  assert.equal(result.totalUsd, 0.7155);
  assert.equal(result.upperUsd, 0.7155);
  assert.equal(result.isLowerBound, false, "精确值不应被标成下限");
  assert.deepEqual(result.assumptions, ["cacheWrite5m", "cacheWrite5mOnly"]);
});

test("1h 假设但目录缺 1h 价：回退 5m 并声明假设", () => {
  const row = sonnetRow({ input: 250000, read: 180000, creation: 50000, output: 5000 });
  const no1h = sonnet({ cacheWrite1h: null, tiers: [{ ...sonnet().tiers[0], cacheWrite1h: null }] });
  const result = estimateRange({
    summary: summaryOf([row]),
    models: [row],
    catalog: { models: [no1h], tierInclusive: true },
    mappings: {},
    settings: { cacheWriteTtl: "1h" },
  });
  assert.equal(result.totalUsd, 0.7155);
  assert.deepEqual(result.assumptions, ["cacheWrite5mOnly"]);
});

test("覆盖率口径：coverage 用 summary，rowCoverage 用 models 同源", () => {
  const pricedRow = {
    model: "deepseek/deepseek-v4.1-flash",
    totalRequests: 1,
    errorRequests: 0,
    totalInputTokens: 600,
    totalOutputTokens: 0,
    totalTokens: 600,
  };
  const result = estimatePeriod(
    { totalInputTokens: 1000, totalOutputTokens: 0, totalTokens: 1000, totalRequests: 1, errorRequests: 0 },
    [pricedRow],
    [entry()],
    {},
  );
  assert.equal(result.coverage, 0.6);
  assert.equal(result.rowCoverage, 1);
  assert.equal(result.modelsTokens, 600);
  assert.equal(result.pricedTokens, 600);
});

test("未计价 token 让上界为空并标记下限", () => {
  const rows = [
    {
      model: "deepseek/deepseek-v4.1-flash",
      totalRequests: 1,
      errorRequests: 0,
      totalInputTokens: 600,
      totalOutputTokens: 0,
      totalTokens: 600,
    },
    {
      model: "unknown-model",
      totalRequests: 1,
      errorRequests: 0,
      totalInputTokens: 400,
      totalOutputTokens: 0,
      totalTokens: 400,
    },
  ];
  const result = estimatePeriod(
    { totalInputTokens: 1000, totalOutputTokens: 0, totalTokens: 1000, totalRequests: 2, errorRequests: 0 },
    rows,
    [entry()],
    {},
  );
  assert.equal(result.unpricedTokens, 400);
  assert.equal(result.upperUsd, null);
  assert.equal(result.isLowerBound, true);
});

test("recordsStatus 非 complete 时整体回退聚合（不混算）", () => {
  const long = record({ input: 250000, read: 180000, creation: 50000, output: 5000 });
  const short = record({ input: 100000, read: 30000, creation: 10000, output: 2000 });
  const row = sonnetRow({ input: 350000, read: 210000, creation: 60000, output: 7000, requests: 2 });
  const cost = estimateRange({
    summary: summaryOf([row]),
    models: [row],
    catalog: { models: [sonnet()], tierInclusive: true },
    mappings: {},
    rows: [long, short],
    recordsStatus: "truncated",
    settings: {},
  });
  assert.equal(cost.mode, "aggregate");
  assert.equal(cost.recordsStatus, "truncated");
  assert.equal(cost.totalUsd, 0.633);
});

test("preciseRequests=off 时不使用逐请求数据", () => {
  const long = record({ input: 250000, read: 180000, creation: 50000, output: 5000 });
  const short = record({ input: 100000, read: 30000, creation: 10000, output: 2000 });
  const row = sonnetRow({ input: 350000, read: 210000, creation: 60000, output: 7000, requests: 2 });
  const cost = estimateRange({
    summary: summaryOf([row]),
    models: [row],
    catalog: { models: [sonnet()], tierInclusive: true },
    mappings: {},
    rows: [long, short],
    recordsStatus: "complete",
    settings: { preciseRequests: "off" },
  });
  assert.equal(cost.mode, "aggregate");
  assert.equal(cost.totalUsd, 0.633);
});

test("旧 9 列缓存的条目金额与升级前一致", () => {
  const legacy = expandStoredEntry([
    "anthropic/claude-sonnet-4.5",
    "",
    "Anthropic: Claude Sonnet 4.5",
    0.000003,
    0.000015,
    0.0000003,
    0.00000375,
    0,
    "anthropic/claude-sonnet-4.5",
  ]);
  assert.deepEqual(legacy.tiers, []);
  assert.equal(legacy.cacheWrite1h, null);

  const row = sonnetRow({ input: 100000, read: 30000, creation: 10000, output: 2000 });
  const result = estimatePeriod(summaryOf([row]), [row], [legacy], {});
  assert.equal(result.byModel[0].status, "exact");
  assert.equal(result.byModel[0].costUsd, 0.2565);
  assert.equal(result.upperUsd, 0.2565);
});

test("costOfRecord 与聚合选档一致（单请求）", () => {
  const row = record({ input: 250000, read: 180000, creation: 50000, output: 5000 });
  const cost = costOfRecord(row, sonnet(), { tierInclusive: true, cacheWriteTtl: "5m" });
  assert.equal(cost.tierAbove, 200000);
  assert.equal(cost.costUsd, 0.7155);
  assertClose(cost.upperUsd, 0.9405, "1h 上界");
  assert.equal(cost.writeTtl, "5m");
  assert.equal(cost.billable, true);

  const errorRow = costOfRecord({ ...row, status: "error" }, sonnet({ request: 1 }), {
    tierInclusive: true,
  });
  assert.equal(errorRow.billable, false);
  assert.equal(errorRow.parts.request, 0);
});

// ---------- 自定义价与倍率 ----------

const PRICE_KEY = "anthropic/claude-sonnet-4.5";

function glm() {
  return entry({ id: "z-ai/glm-5.3", slug: "z-ai/glm-5.3", name: "GLM 5.3", request: 0 });
}

test("A7 自定义价优先于手工映射：status=custom、entryId=custom:<key>、guessed=false", () => {
  const row = sonnetRow({ input: 100000, read: 30000, creation: 10000, output: 2000 });
  const prices = normalizePrices({
    [PRICE_KEY]: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, note: "中转站 0.3x" },
  });
  const result = estimateRange({
    summary: summaryOf([row]),
    models: [row],
    catalog: { models: [sonnet(), glm()], tierInclusive: true },
    mappings: { [PRICE_KEY]: "z-ai/glm-5.3" },
    prices,
    settings: {},
  });
  const line = result.byModel[0];
  assert.equal(line.status, "custom");
  assert.equal(line.entryId, `custom:${PRICE_KEY}`);
  assert.equal(line.entryName, "中转站 0.3x");
  assert.equal(line.entryProvider, "");
  assert.equal(line.matchedBy, "custom");
  assert.equal(line.confidence, 1);
  assert.equal(line.guessed, false);
  assert.equal(result.customModels, 1);
  // 自定义价与目录 base 档同价：金额与目录价一致（0.2565），说明取价替换没有改变口径。
  assert.equal(line.costUsd, 0.2565);
  assertParts(line);
});

test("A8 忽略优先于自定义价：status=ignored、不计成本也不计入 customModels", () => {
  const row = sonnetRow({ input: 250000, read: 180000, creation: 50000, output: 5000 });
  const prices = normalizePrices({ [PRICE_KEY]: { input: 1 } });
  const result = estimateRange({
    summary: summaryOf([row]),
    models: [row],
    catalog: { models: [sonnet()], tierInclusive: true },
    mappings: { [PRICE_KEY]: IGNORE_MAPPING },
    prices,
    settings: {},
  });
  const line = result.byModel[0];
  assert.equal(line.status, "ignored");
  assert.equal(line.costUsd, 0);
  assert.equal(line.parts.input, 0);
  assert.equal(result.customModels, 0);
  assert.equal(result.ignoredTokens, row.totalTokens);
});

test("A10 自定义价扁平 + 自定义倍率 0.3：0.11295 / 0.07695，合计 0.1899", () => {
  const prices = normalizePrices({
    [PRICE_KEY]: {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
      multiplier: 0.3,
    },
  });
  // 目录带档位与 1h 价也必须被忽略：自定义价是扁平价，不继承目录档位。
  const catalog = {
    models: [
      sonnet({ cacheWrite1h: null, tiers: [{ ...sonnet().tiers[0], cacheWrite1h: null }] }),
    ],
    tierInclusive: true,
  };
  const rows = [
    record({ input: 250000, read: 180000, creation: 50000, output: 5000 }),
    record({ input: 100000, read: 30000, creation: 10000, output: 2000 }),
  ];
  const bucket = sonnetRow({ input: 350000, read: 210000, creation: 60000, output: 7000, requests: 2 });
  const precise = estimateRange({
    summary: summaryOf([bucket]),
    models: [bucket],
    catalog,
    mappings: {},
    prices,
    rows,
    recordsStatus: "complete",
    settings: {},
  });
  assert.equal(precise.mode, "precise");
  assert.equal(precise.byModel[0].status, "custom");
  assert.equal(precise.totalUsd, 0.1899);
  assert.equal(precise.upperUsd, 0.1899, "无 1h 价时区间塌缩");
  assert.equal(precise.byModel[0].tierAbove, null, "扁平自定义价不进档");
  assertParts(precise.byModel[0]);

  // 单条：R1 0.11295（比带档位的 0.21465 少 0.1017）
  const long = sonnetRow({ input: 250000, read: 180000, creation: 50000, output: 5000 });
  const s1 = estimateRange({
    summary: summaryOf([long]),
    models: [long],
    catalog,
    mappings: {},
    prices,
    settings: {},
  });
  assert.equal(s1.byModel[0].costUsd, 0.11295);
  assertParts(s1.byModel[0]);

  const short = sonnetRow({ input: 100000, read: 30000, creation: 10000, output: 2000 });
  const s3 = estimateRange({
    summary: summaryOf([short]),
    models: [short],
    catalog,
    mappings: {},
    prices,
    settings: {},
  });
  assert.equal(s3.byModel[0].costUsd, 0.07695);
});

test("A11 按次费来自目录且不乘倍率：0.01 × 3 次 = 0.03", () => {
  const prices = normalizePrices({ "relay/req": { input: 1, multiplier: 2 } });
  const row = {
    model: "relay/req",
    totalRequests: 3,
    errorRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
  };
  const result = estimateRange({
    summary: { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, totalRequests: 3, errorRequests: 0 },
    models: [row],
    catalog: {
      models: [{ id: "relay/req", slug: "relay/req", name: "Relay", prompt: 1e-6, completion: 0, request: 0.01 }],
    },
    mappings: {},
    prices,
    settings: {},
  });
  const line = result.byModel[0];
  assert.equal(line.status, "custom");
  assert.equal(line.parts.request, 0.03);
  assert.equal(line.costUsd, 0.03);
  assertParts(line);
});

test("A13 自定义价计入覆盖率；未匹配仍是未计价，customModels 只数 custom 行", () => {
  const priced = {
    model: "relay/only-custom",
    totalRequests: 1,
    errorRequests: 0,
    totalInputTokens: 600,
    totalOutputTokens: 0,
    totalTokens: 600,
  };
  const unpriced = {
    model: "unknown/model-x",
    totalRequests: 1,
    errorRequests: 0,
    totalInputTokens: 400,
    totalOutputTokens: 0,
    totalTokens: 400,
  };
  const prices = normalizePrices({ "relay/only-custom": { input: 1 } });
  const result = estimateRange({
    summary: {
      totalInputTokens: 1000,
      totalOutputTokens: 0,
      totalTokens: 1000,
      totalRequests: 2,
      errorRequests: 0,
    },
    models: [priced, unpriced],
    catalog: { models: [] },
    mappings: {},
    prices,
    settings: {},
  });
  assert.equal(result.byModel[0].status, "custom");
  assert.equal(result.byModel[0].guessed, false);
  assert.equal(result.byModel[1].status, "unmatched");
  assert.equal(result.pricedTokens, 600);
  assert.equal(result.unpricedTokens, 400);
  assert.equal(result.guessedTokens, 0);
  assert.equal(result.customModels, 1);
  assert.equal(result.coverage, 0.6);
  assert.equal(result.rowCoverage, 0.6);
  assert.equal(result.upperUsd, null, "仍有未计价 token 时没有上界");
});

test("自定义价压过 guess：状态为 custom，不再计入 guessedTokens", () => {
  // 目录里只有 claude-sonnet-4-5；带日期后缀的名字原本会降级成 guess。
  const name = "claude-sonnet-4-5-20250929";
  const row = {
    model: name,
    totalRequests: 1,
    errorRequests: 0,
    totalInputTokens: 100000,
    totalOutputTokens: 0,
    totalTokens: 100000,
  };
  const prices = normalizePrices({ [name]: { input: 2, output: 8 } });
  const base = estimateRange({
    summary: summaryOf([row]),
    models: [row],
    catalog: { models: [sonnet()], tierInclusive: true },
    mappings: {},
    settings: {},
  });
  assert.equal(base.byModel[0].status, "guess");
  assert.equal(base.byModel[0].guessed, true);

  const custom = estimateRange({
    summary: summaryOf([row]),
    models: [row],
    catalog: { models: [sonnet()], tierInclusive: true },
    mappings: {},
    prices,
    settings: {},
  });
  assert.equal(custom.byModel[0].status, "custom");
  assert.equal(custom.byModel[0].guessed, false);
  assert.equal(custom.guessedTokens, 0);
  assert.equal(custom.pricedTokens, 100000);
});

test("A17 默认无自定义价：旧签名 estimatePeriod 金额与形态不变", () => {
  const row = sonnetRow({ input: 250000, read: 180000, creation: 50000, output: 5000 });
  const result = estimatePeriod(summaryOf([row]), [row], [sonnet()], {});
  assert.equal(result.totalUsd, 0.7155);
  assert.equal(result.byModel[0].status, "exact");
  assert.equal(result.customModels, 0);
  assert.equal(result.byModel[0].guessed, false);
});

/* --------------------------- 精算缺口 / 多档位 --------------------------- */

// 扁平条目：无档位、无 1 小时价，便于断言区间塌缩。
function flatEntry(id, { prompt, completion, cacheRead, cacheWrite, request = 0, name = id }) {
  return {
    id,
    provider: "",
    slug: id,
    name,
    prompt,
    completion,
    cacheRead,
    cacheWrite,
    cacheWrite1h: null,
    request,
    tiers: [],
    canonical: id,
    context: 1000000,
  };
}

function gapFixture() {
  const entryA = flatEntry("deepseek/deepseek-v4.1-flash", {
    prompt: 2e-6,
    completion: 8e-6,
    cacheRead: 0.5e-6,
    cacheWrite: 2.5e-6,
    request: 0.001,
    name: "deepseek-v4.1-flash",
  });
  const entryB = flatEntry("vendor/model-b", {
    prompt: 1e-6,
    completion: 1e-6,
    cacheRead: 1e-6,
    cacheWrite: 1e-6,
    name: "model-b",
  });
  const rowA = {
    model: "deepseek/deepseek-v4.1-flash",
    totalRequests: 1,
    errorRequests: 0,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    totalCacheReadInputTokens: 400,
    totalCacheCreationInputTokens: 100,
    totalTokens: 1500,
  };
  const rowB = {
    model: "vendor/model-b",
    totalRequests: 1,
    errorRequests: 0,
    totalInputTokens: 1000,
    totalOutputTokens: 0,
    totalCacheReadInputTokens: 0,
    totalCacheCreationInputTokens: 0,
    totalTokens: 1000,
  };
  return {
    entryA,
    entryB,
    rowA,
    rowB,
    rows: [record({ input: 1000, output: 500, read: 400, creation: 100, name: rowA.model })],
    summary: {
      totalInputTokens: 2000,
      totalOutputTokens: 500,
      totalTokens: 2500,
      totalRequests: 2,
      errorRequests: 0,
    },
  };
}

test("精算缺口：models 有、records 整组缺失时计入 uncovered 并按下限展示", () => {
  const fixture = gapFixture();
  const result = estimateRange({
    summary: fixture.summary,
    models: [fixture.rowA, fixture.rowB],
    catalog: { models: [fixture.entryA, fixture.entryB], tierInclusive: true },
    mappings: {},
    rows: fixture.rows,
    recordsStatus: "complete",
    settings: {},
  });

  assert.equal(result.mode, "precise");
  assert.equal(result.byModel.length, 1, "没有 records 的模型不生成计价行");
  assert.equal(result.byModel[0].model, "deepseek/deepseek-v4.1-flash");
  assert.equal(result.totalUsd, 0.00645);
  assert.equal(result.uncoveredTokens, 1000);
  assert.equal(result.uncoveredRequests, 1);
  assert.equal(result.unpricedTokens, 1000, "缺口 token 同时计入未计价");
  assert.equal(result.upperUsd, null, "有缺口时没有上界");
  assert.equal(result.isLowerBound, true);
  assert.equal(result.pricedTokens, 1500);
  assert.equal(result.modelsTokens, 1500);
  assert.equal(result.rowCoverage, 0.6, "缺口 token 必须计入覆盖率分母");
  assert.equal(result.coverage, 0.6);
});

test("精算缺口：缺失 records 的模型被忽略时不产生缺口且可给上界", () => {
  const fixture = gapFixture();
  const result = estimateRange({
    summary: fixture.summary,
    models: [fixture.rowA, fixture.rowB],
    catalog: { models: [fixture.entryA, fixture.entryB], tierInclusive: true },
    mappings: { "vendor/model-b": IGNORE_MAPPING },
    rows: fixture.rows,
    recordsStatus: "complete",
    settings: {},
  });

  assert.equal(result.byModel.length, 1);
  assert.equal(result.totalUsd, 0.00645);
  assert.equal(result.uncoveredTokens, 0, "显式忽略的模型不计缺口");
  assert.equal(result.uncoveredRequests, 0);
  assert.equal(result.unpricedTokens, 0);
  assert.equal(result.upperUsd, 0.00645, "无缺口且无 1h / 档位时区间塌缩");
  assert.equal(result.isLowerBound, false);
  assert.equal(result.rowCoverage, 1);
  assert.equal(result.coverage, 0.6);
  assert.equal(result.ignoredTokens, 0, "没有 records 的忽略模型不进入 byModel 统计");
});

test("多档位：中间档与最高档分别取对应向量，倒序输入也取最高命中档", () => {
  // 故意把 1M 档放在 200k 档前面：若 selectTier 写成「首个命中即返回」，本用例必挂。
  const tiered = sonnet({
    cacheWrite1h: null,
    tiers: [
      {
        above: 1000000,
        prompt: 12e-6,
        completion: 45e-6,
        cacheRead: 1.2e-6,
        cacheWrite: 15e-6,
        cacheWrite1h: null,
      },
      {
        above: 200000,
        prompt: 6e-6,
        completion: 22.5e-6,
        cacheRead: 0.6e-6,
        cacheWrite: 7.5e-6,
        cacheWrite1h: null,
      },
    ],
  });

  assert.equal(selectTier(tiered, 250000, true).above, 200000);
  assert.equal(selectTier(tiered, 1000000, true).above, 1000000);
  assert.equal(selectTier(tiered, 999999, true).above, 200000);
  assert.equal(selectTier(tiered, 199999, true), null);
  assert.equal(selectTier(tiered, 1000000, false).above, 200000);
  assert.equal(selectTier(tiered, 1000001, false).above, 1000000);

  const middleRow = sonnetRow({ input: 250000, read: 180000, creation: 50000, output: 5000 });
  const middle = estimatePeriod(summaryOf([middleRow]), [middleRow], [tiered], {}).byModel[0];
  assert.equal(middle.tierAbove, 200000);
  assert.equal(middle.parts.input, 0.12);
  assert.equal(middle.parts.cacheRead, 0.108);
  assert.equal(middle.parts.cacheWrite, 0.375);
  assert.equal(middle.parts.output, 0.1125);
  assert.equal(middle.costUsd, 0.7155);
  assertParts(middle);

  const topRow = sonnetRow({ input: 1000000, output: 10000 });
  const top = estimatePeriod(summaryOf([topRow]), [topRow], [tiered], {}).byModel[0];
  assert.equal(top.tierAbove, 1000000);
  assert.equal(top.parts.input, 12);
  assert.equal(top.parts.cacheRead, 0);
  assert.equal(top.parts.cacheWrite, 0);
  assert.equal(top.parts.output, 0.45);
  assert.equal(top.costUsd, 12.45);
  assert.equal(top.upperUsd, 12.45);
  assertParts(top);

  const recordCost = costOfRecord(
    record({ input: 1000000, output: 10000, name: "anthropic/claude-sonnet-4.5" }),
    tiered,
    { tierInclusive: true },
  );
  assert.equal(recordCost.tierAbove, 1000000);
  assert.equal(recordCost.price.prompt, 12e-6);
  assert.equal(recordCost.price.completion, 45e-6);
  assert.equal(recordCost.costUsd, 12.45);
  assert.equal(recordCost.upperUsd, 12.45);
});
