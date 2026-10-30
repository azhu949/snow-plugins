import test from "node:test";
import assert from "node:assert/strict";
import { matchModel, stripVendor, tokenize, variantOf } from "../src/match.js";
import { IGNORE_MAPPING } from "../src/constants.js";

function entry(id, name = id, slug = id) {
  return {
    id,
    slug,
    name,
    prompt: 1e-6,
    completion: 2e-6,
    cacheRead: 1e-6,
    cacheWrite: 1e-6,
    request: 0,
    context: 0,
  };
}

const catalog = [
  entry("deepseek/deepseek-v4.1-flash", "DeepSeek V4.1 Flash"),
  entry("deepseek/deepseek-v4.1-flash-1017", "DeepSeek V4.1 Flash 1017"),
  entry("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash"),
  entry("z-ai/glm-5.3", "GLM 5.3"),
  entry("z-ai/glm-5.3-flash", "GLM 5.3 Flash"),
  entry("moonshotai/kimi-k3", "Kimi K3"),
  entry("openai/gpt-6.1-sol", "GPT-6.1 Sol"),
  entry("openai/gpt-6-astra", "GPT-6 Astra"),
  entry("stepfun/step-5-preview", "Step 5 Preview"),
  entry("z-ai/glm-5.3:free", "GLM 5.3 (free)"),
  entry("deepseek/deepseek-v4.1-flash:batch", "DeepSeek V4.1 Flash Batch"),
  entry("~deepseek/deepseek-v4.1-flash", "DeepSeek V4.1 Flash Alias"),
];

test("tokenize 保留版本号点号，忽略大小写与符号", () => {
  assert.deepEqual(tokenize("Z-ai/GLM-5.3-Flash"), ["z", "ai", "glm", "5.3", "flash"]);
  assert.deepEqual(tokenize("gpt-6.1-sol"), ["gpt", "6.1", "sol"]);
  assert.deepEqual(tokenize(""), []);
});

test("stripVendor 与 variantOf 解析目录标识", () => {
  assert.equal(stripVendor("z-ai/glm-5.3"), "glm-5.3");
  assert.equal(stripVendor("glm-5.3"), "glm-5.3");
  assert.equal(variantOf("z-ai/glm-5.3:free"), "free");
  assert.equal(variantOf("z-ai/glm-5.3"), "");
});

test("精确匹配 id", () => {
  const result = matchModel("deepseek/deepseek-v4.1-flash", catalog, {});
  assert.equal(result.status, "exact");
  assert.equal(result.entryId, "deepseek/deepseek-v4.1-flash");
  assert.equal(result.confidence, 1);
});

test("精确匹配 canonical_slug", () => {
  const custom = [{ ...entry("vendor/model-x"), slug: "canonical/model-x" }];
  const result = matchModel("canonical/model-x", custom, {});
  assert.equal(result.status, "exact");
  assert.equal(result.entryId, "vendor/model-x");
});

test("厂商前缀 + 大小写差异走 fuzzy", () => {
  const cases = [
    ["workbuddy-ai/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash"],
    ["zcode/GLM-5.3", "z-ai/glm-5.3"],
    ["loomy/DeepSeek-V4.1-Flash", "deepseek/deepseek-v4.1-flash"],
  ];
  for (const [usage, expected] of cases) {
    const result = matchModel(usage, catalog, {});
    assert.equal(result.status, "fuzzy", usage);
    assert.equal(result.entryId, expected, usage);
    assert.ok(result.confidence > 0.5 && result.confidence <= 0.85, usage);
  }
});

test("区域 / 日期 / 噪声后缀取最长连续命中", () => {
  const longer = matchModel("umans-deepseek-v4.1-flash-1017-lab", catalog, {});
  assert.equal(longer.status, "fuzzy");
  assert.equal(longer.entryId, "deepseek/deepseek-v4.1-flash-1017");

  const region = matchModel("workbuddy-ai/deepseek-v4.1-flash-sg", catalog, {});
  assert.equal(region.status, "fuzzy");
  assert.equal(region.entryId, "deepseek/deepseek-v4.1-flash");
});

test("归一化 token 全等优先于模糊匹配", () => {
  const result = matchModel("DeepSeek-V4.1-Flash", catalog, {});
  assert.equal(result.status, "normalized");
  assert.equal(result.entryId, "deepseek/deepseek-v4.1-flash");
  assert.equal(result.confidence, 0.92);
});

test(":batch 变体不参与普通模型匹配", () => {
  const result = matchModel("deepseek-v4.1-flash", catalog, {});
  assert.equal(result.status, "normalized");
  assert.equal(result.entryId, "deepseek/deepseek-v4.1-flash");
  assert.notEqual(result.entryId, "deepseek/deepseek-v4.1-flash:batch");
});

test("usage 名含相同变体时才匹配变体条目", () => {
  const result = matchModel("z-ai/glm-5.3:free", catalog, {});
  assert.equal(result.status, "exact");
  assert.equal(result.entryId, "z-ai/glm-5.3:free");

  const plain = matchModel("z-ai/glm-5.3", catalog, {});
  assert.equal(plain.status, "exact");
  assert.equal(plain.entryId, "z-ai/glm-5.3");
});

test("~ 开头的别名条目永不参与匹配", () => {
  const result = matchModel("~deepseek/deepseek-v4.1-flash", catalog, {});
  assert.equal(result.entryId, "deepseek/deepseek-v4.1-flash");
  for (const candidate of result.candidates) {
    assert.ok(!candidate.entryId.startsWith("~"), candidate.entryId);
  }
});

test("DeepSeek-Flash 歧义必须 unmatched", () => {
  const result = matchModel("DeepSeek-Flash", catalog, {});
  assert.equal(result.status, "unmatched");
  assert.equal(result.entryId, "");
  assert.equal(result.reason, "no-candidate");
});

test("两个候选命中长度相同时 unmatched 并给出候选", () => {
  const ambiguous = [entry("vendor-a/acme-alpha"), entry("vendor-b/acme-alpha")];
  const result = matchModel("proxy/acme-alpha-sg", ambiguous, {});
  assert.equal(result.status, "unmatched");
  assert.equal(result.reason, "ambiguous");
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map((item) => item.entryId).sort(), [
    "vendor-a/acme-alpha",
    "vendor-b/acme-alpha",
  ]);
});

test("手动映射优先于自动匹配", () => {
  const mappings = { "workbuddy-ai/deepseek-v4.1-flash": "z-ai/glm-5.3" };
  const result = matchModel("Workbuddy-AI/DeepSeek-V4.1-Flash", catalog, mappings);
  assert.equal(result.status, "manual");
  assert.equal(result.entryId, "z-ai/glm-5.3");
  assert.equal(result.confidence, 1);
});

test("手动忽略返回 ignored", () => {
  const result = matchModel("DeepSeek-V4.1-Flash", catalog, {
    "deepseek-v4.1-flash": IGNORE_MAPPING,
  });
  assert.equal(result.status, "ignored");
  assert.equal(result.entryId, "");
  assert.equal(result.entry, null);
});

test("映射指向不存在的条目时明确 unmatched", () => {
  const result = matchModel("DeepSeek-V4.1-Flash", catalog, {
    "deepseek-v4.1-flash": "missing/model",
  });
  assert.equal(result.status, "unmatched");
  assert.equal(result.reason, "mapping-missing-entry");
});

test("空目录与空模型名不抛错", () => {
  assert.equal(matchModel("DeepSeek-V4.1-Flash", [], {}).reason, "empty-catalog");
  assert.equal(matchModel("", catalog, {}).reason, "empty-model");
});
