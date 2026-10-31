// 三语言文案：键集合必须一致，占位符必须一致，新增的金额语义键不能漏。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const LOCALES = ["zh-CN", "zh-TW", "en"].map((name) => [
  name,
  JSON.parse(readFileSync(new URL(`../locales/${name}.json`, import.meta.url), "utf8")),
]);

const BASE = LOCALES[0][1];

// 本次新增的键：任何一个缺失都会让 UI 回退到 key 本身或丢掉金额语义。
const REQUIRED = [
  "tm.warn.lowerBound",
  "tm.cost.boundPrefix",
  "tm.cost.guessMark",
  "tm.cost.range",
  "tm.cost.modeTitle",
  "tm.cost.mode.precise",
  "tm.cost.mode.aggregate",
  "tm.cost.preciseRows",
  "tm.cost.truncated",
  "tm.cost.mismatch",
  "tm.cost.partialNoTier",
  "tm.cost.noRecords",
  "tm.cost.recordsOff",
  "tm.cost.lowerBoundHint",
  "tm.cost.pricedAt",
  "tm.cost.tier",
  "tm.cost.tierTitle",
  "tm.cost.assume5m",
  "tm.cost.assume1h",
  "tm.cost.assume5mOnly",
  "tm.cost.unestimatedTier",
  "tm.cost.unestimatedImage",
  "tm.cost.unestimatedReasoning",
  "tm.cost.noteLiteLLM",
  "tm.status.guess",
  "tm.footer.precise",
  "tm.footer.guessed",
  "tm.settings.precise",
  "tm.settings.preciseAuto",
  "tm.settings.preciseAlways",
  "tm.settings.preciseOff",
  "tm.settings.preciseHint",
  "tm.settings.cacheTtl",
  "tm.settings.cacheTtl5m",
  "tm.settings.cacheTtl1h",
  "tm.settings.cacheTtlHint",
  "tm.settings.pricingLiteLLM",
  // 自定义价：任何一个缺失都会让映射视图显示 key 本身。
  "tm.status.custom",
  "tm.price.title",
  "tm.price.input",
  "tm.price.output",
  "tm.price.cacheRead",
  "tm.price.cacheWrite",
  "tm.price.multiplier",
  "tm.price.multiplierHint",
  "tm.price.multiplierRange",
  "tm.price.note",
  "tm.price.hint",
  "tm.price.tiersHint",
  "tm.price.save",
  "tm.price.saved",
  "tm.price.clear",
  "tm.price.cleared",
  "tm.price.ignoredHint",
  "tm.price.source",
  "tm.price.inheritFrom",
  "tm.price.inheritNone",
  "tm.price.invalid",
  "tm.price.fillCatalog",
  "tm.price.fillNone",
  "tm.settings.clearPrices",
  "tm.settings.clearPricesDone",
  "tm.footer.custom",
  // 徽标悬停浮层：标签与值分开排版，缺键会在浮层里露出 key。
  "tm.badge.tip.input",
  "tm.badge.tip.output",
  "tm.badge.tip.cacheRead",
  "tm.badge.tip.requests",
  "tm.badge.tip.mode",
  "tm.badge.tip.pricing",
  "tm.badge.tip.fx",
  "tm.badge.tip.fxValue",
  "tm.badge.tip.unit",
  "tm.badge.tip.hint",
  "tm.badge.tip.warn",
  "tm.badge.tip.failed",
  // 模型行计算过程：token 拆分 × 单价 → 分项 → 合计，任一键缺失都会在 title 里露出 key。
  "tm.models.calcHead",
  "tm.models.calcEntry",
  "tm.models.calcNonCached",
  "tm.models.calcFormula",
  "tm.models.calcRequestLabel",
  "tm.models.calcRequestFormula",
  "tm.models.calcTotalLabel",
  "tm.models.calcDisplay",
  "tm.models.calcRange",
  "tm.models.calc1h",
  "tm.models.calcMixedNote",
  "tm.models.calcIgnored",
  "tm.models.calcUnpriced",
  "tm.models.calcTokens",
];

function placeholders(template) {
  return [...String(template).matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
}

test("三语言键集合一致", () => {
  const base = Object.keys(BASE).sort();
  for (const [name, dictionary] of LOCALES) {
    assert.deepEqual(Object.keys(dictionary).sort(), base, `${name} 的键集合与 zh-CN 不一致`);
  }
});

test("精算 / 下限相关文案键在三语言里都存在且非空", () => {
  for (const [name, dictionary] of LOCALES) {
    for (const key of REQUIRED) {
      const value = dictionary[key];
      assert.equal(typeof value, "string", `${name} 缺少 ${key}`);
      assert.ok(value.trim().length > 0, `${name} 的 ${key} 不能为空`);
    }
  }
});

test("同一键的占位符在三语言里一致", () => {
  for (const key of Object.keys(BASE)) {
    const expected = placeholders(BASE[key]);
    for (const [name, dictionary] of LOCALES) {
      assert.deepEqual(placeholders(dictionary[key]), expected, `${name} 的 ${key} 占位符不一致`);
    }
  }
});

// UI 规范：新增文案不得含 Emoji（符号 ≥ / ≈ / × 不是 Emoji）。
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}]/u;

test("自定义价相关文案不含 Emoji", () => {
  const keys = REQUIRED.filter(
    (key) =>
      key.startsWith("tm.price.") ||
      key.startsWith("tm.settings.price") ||
      key.startsWith("tm.models.calc") ||
      key === "tm.status.custom",
  );
  for (const [name, dictionary] of LOCALES) {
    for (const key of keys) {
      assert.ok(!EMOJI_RE.test(dictionary[key]), `${name} 的 ${key} 不得包含 Emoji`);
    }
  }
});
