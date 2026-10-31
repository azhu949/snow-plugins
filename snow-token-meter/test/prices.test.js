import test from "node:test";
import assert from "node:assert/strict";
import { IGNORE_MAPPING } from "../src/constants.js";
import {
  PRICE_UNIT,
  normalizePrices,
  priceKeyOf,
  priceMultiplierOf,
  priceRecordOf,
  resolvePrice,
} from "../src/prices.js";

const KEY = "deepseek/deepseek-v4.1-flash";

function close(actual, expected) {
  return Math.abs(Number(actual) - Number(expected)) <= Math.max(1e-15, Math.abs(expected) * 1e-9);
}

function assertClose(actual, expected, label = "") {
  assert.ok(close(actual, expected), `${label} 期望 ${expected}，实际 ${actual}`);
}

function catalogEntry(overrides = {}) {
  return {
    id: KEY,
    slug: KEY,
    name: "DeepSeek V4.1 Flash",
    prompt: 2e-6,
    completion: 8e-6,
    cacheRead: 0.5e-6,
    cacheWrite: 2.5e-6,
    cacheWrite1h: null,
    request: 0.001,
    tiers: [],
    canonical: KEY,
    context: 1000000,
    ...overrides,
  };
}

test("normalizePrices：键小写、0 保留、null 保留、缺字段补 null", () => {
  const prices = normalizePrices({
    models: {
      "X/Y": { input: 0, output: 4.5, cacheRead: null, cacheWrite: 1.125 },
    },
  });
  assert.deepEqual(Object.keys(prices), ["x/y"]);
  const record = prices["x/y"];
  assert.equal(record.input, 0, "0 是显式免费，不能被当成缺失");
  assert.equal(record.output, 4.5);
  assert.equal(record.cacheRead, null);
  assert.equal(record.cacheWrite, 1.125);
  assert.equal(record.multiplier, 1);
  assert.equal(record.note, "");
});

test("normalizePrices：四价全空 / 负价整条丢弃，倍率夹取", () => {
  const prices = normalizePrices({
    empty: { input: null, output: null },
    negative: { input: -1, output: 2 },
    clamped: { input: 1, multiplier: 12 },
    keep: { input: 1 },
  });
  assert.deepEqual(Object.keys(prices).sort(), ["clamped", "keep"]);
  assert.equal(prices.clamped.multiplier, 10, "越界倍率夹取而不是丢弃");
  assert.equal(prices.keep.multiplier, 1);

  const bare = normalizePrices({ "a/b": { input: 2 } });
  assert.equal(bare["a/b"].input, 2, "也接受裸映射（没有 schema / models 包装）");
  assert.deepEqual(normalizePrices(null), {});
  assert.deepEqual(normalizePrices([]), {});
});

test("priceKeyOf / priceRecordOf 与映射表同口径（trim + 小写）", () => {
  const prices = normalizePrices({ "X/Y": { input: 1 } });
  assert.equal(priceKeyOf("  X/Y "), "x/y");
  assert.equal(priceRecordOf(prices, "x/y")?.input, 1);
  assert.equal(priceRecordOf(prices, "X/Y")?.input, 1);
  assert.equal(priceRecordOf(prices, "z/z"), null);
  assert.equal(priceRecordOf(null, "x/y"), null);
});

test("无目录匹配时自定义价可用：缺省 0、cacheRead/cacheWrite 回退 input、request 缺省 0", () => {
  const prices = normalizePrices({ "relay/model": { input: 1 } });
  const resolved = resolvePrice("relay/model", [], {}, prices);
  assert.equal(resolved.status, "custom");
  assert.equal(resolved.entryId, "custom:relay/model");
  assert.equal(resolved.custom, true);
  assert.equal(resolved.confidence, 1);
  assert.equal(resolved.matchedBy, "custom");
  assert.equal(resolved.entry.prompt, 1 / PRICE_UNIT);
  assert.equal(resolved.entry.completion, 0, "用户只写 input 就代表输出免费");
  assert.equal(resolved.entry.cacheRead, 1 / PRICE_UNIT);
  assert.equal(resolved.entry.cacheWrite, 1 / PRICE_UNIT);
  assert.equal(resolved.entry.cacheWrite1h, null, "1h 价绝不凭空生成");
  assert.equal(resolved.entry.request, 0);
  assert.deepEqual(resolved.entry.tiers, [], "自定义价是扁平价，不带档位");
});

test("缺失字段继承匹配到的目录条目；0 与 null 严格区分", () => {
  const entry = catalogEntry({ cacheWrite1h: 6e-6 });
  const inherit = resolvePrice(KEY, [entry], {}, normalizePrices({ [KEY]: { output: 9 } }));
  assert.equal(inherit.status, "custom");
  assert.equal(inherit.entry.prompt, entry.prompt);
  assert.equal(inherit.entry.completion, 9 / PRICE_UNIT);
  assert.equal(inherit.entry.cacheRead, entry.cacheRead);
  assert.equal(inherit.entry.cacheWrite, entry.cacheWrite);
  assert.equal(inherit.entry.cacheWrite1h, entry.cacheWrite1h, "1h 价按目录原价继承");
  assert.equal(inherit.entry.request, entry.request);

  const free = resolvePrice(
    KEY,
    [entry],
    {},
    normalizePrices({ [KEY]: { input: 0, cacheRead: null } }),
  );
  assert.equal(free.entry.prompt, 0, "0 是显式免费，不回退目录价");
  assert.equal(free.entry.cacheRead, entry.cacheRead, "null 才继承");
  assert.equal(free.entry.cacheWrite, entry.cacheWrite);
});

test("自定义倍率只乘记录里写出的 token 价；按次费与 1h 价继承目录", () => {
  const entry = catalogEntry({ request: 0.01, cacheWrite1h: 6e-6 });
  const prices = normalizePrices({
    [KEY]: { input: 2, output: 4, multiplier: 3 },
  });
  const resolved = resolvePrice(KEY, [entry], {}, prices);
  assertClose(resolved.entry.prompt, 6e-6, "input");
  assertClose(resolved.entry.completion, 12e-6, "output");
  assert.equal(resolved.entry.request, 0.01, "按次费继承目录、不乘倍率");
  assert.equal(resolved.entry.cacheWrite1h, 6e-6, "1h 价继承目录、不乘倍率");
  assert.deepEqual(resolved.entry.tiers, [], "自定义价是扁平价");
});

test("忽略优先于自定义价：status=ignored、无条目", () => {
  const prices = normalizePrices({ [KEY]: { input: 1 } });
  const resolved = resolvePrice(KEY, [catalogEntry()], { [KEY]: IGNORE_MAPPING }, prices);
  assert.equal(resolved.status, "ignored");
  assert.equal(resolved.entry, null);
  assert.equal(resolved.custom, false);
  assert.equal(resolved.entryId, "");
});

test("无自定义价且未匹配时返回原匹配语义（status / reason / entry 均为空）", () => {
  const resolved = resolvePrice("unknown/model", [catalogEntry()], {}, {});
  assert.equal(resolved.status, "unmatched");
  assert.equal(resolved.entry, null);
  assert.equal(resolved.custom, false);
});

test("priceMultiplierOf：缺省 1、越界夹取、保留 4 位小数", () => {
  assert.equal(priceMultiplierOf(undefined), 1);
  assert.equal(priceMultiplierOf("bad"), 1);
  assert.equal(priceMultiplierOf(0), 0.01);
  assert.equal(priceMultiplierOf(99), 10);
  assert.equal(priceMultiplierOf(0.3), 0.3);
  assert.equal(priceMultiplierOf(1.234567), 1.2346);
});
