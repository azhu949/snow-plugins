import test from "node:test";
import assert from "node:assert/strict";
import {
  bareModelId,
  hasUsablePrice,
  isPricedStatus,
  matchModel,
  stripVendor,
  tokenize,
  variantOf,
} from "../src/match.js";
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

function priced(id, prompt, extra = {}) {
  return {
    id,
    slug: id,
    name: id,
    prompt,
    completion: prompt * 4,
    cacheRead: prompt,
    cacheWrite: prompt,
    request: 0,
    context: 0,
    ...extra,
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

// OpenRouter 真实条目的切片（2026-10-30 快照）。
const claudeCatalog = [
  {
    id: "anthropic/claude-sonnet-4.5",
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
  },
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

test("bareModelId 把点号、标签与路径统一成同一个身份", () => {
  assert.equal(bareModelId("anthropic/claude-sonnet-4.5"), "claude-sonnet-4-5");
  assert.equal(bareModelId("claude-sonnet-4-5[1M]"), "claude-sonnet-4-5");
  assert.equal(bareModelId("us.anthropic.claude-sonnet-4-5-v1:0"), "us-anthropic-claude-sonnet-4-5-v1");
});

test("精确匹配 id", () => {
  const result = matchModel("deepseek/deepseek-v4.1-flash", catalog, {});
  assert.equal(result.status, "exact");
  assert.equal(result.entryId, "deepseek/deepseek-v4.1-flash");
  assert.equal(result.confidence, 1);
  assert.equal(result.matchedBy, "exact");
});

test("精确匹配 canonical_slug", () => {
  const custom = [{ ...entry("vendor/model-x"), slug: "canonical/model-x" }];
  const result = matchModel("canonical/model-x", custom, {});
  assert.equal(result.status, "exact");
  assert.equal(result.entryId, "vendor/model-x");
});

test("厂商前缀 + 大小写差异走身份层（点/横线等价在 bareModelId 内完成）", () => {
  const cases = [
    ["workbuddy-ai/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash"],
    ["zcode/GLM-5.3", "z-ai/glm-5.3"],
    ["loomy/DeepSeek-V4.1-Flash", "deepseek/deepseek-v4.1-flash"],
  ];
  for (const [usage, expected] of cases) {
    const result = matchModel(usage, catalog, {});
    assert.equal(result.status, "canonical", usage);
    assert.equal(result.entryId, expected, usage);
    assert.equal(result.confidence, 0.9, usage);
    assert.equal(hasUsablePrice(result.status), true, usage);
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

  // 不带渠道的变体名仍按名称匹配（但不会落到原价条目上）。
  const bareVariant = matchModel("glm-5.3:free", catalog, {});
  assert.equal(bareVariant.entryId, "z-ai/glm-5.3:free");
  assert.equal(bareVariant.status, "normalized");
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
  assert.equal(hasUsablePrice(result.status), false);
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

test("A8：Claude 五种命名都命中同一条目，-latest 与日期后缀为 guess", () => {
  const cases = [
    ["claude-sonnet-4-5", null],
    ["claude-sonnet-4-5-20250929", "guess"],
    ["claude-sonnet-4-5[1M]", null],
    ["claude-sonnet-4-5-latest", "guess"],
    ["us.anthropic.claude-sonnet-4-5-20250929-v1:0", "guess"],
  ];
  for (const [usage, expected] of cases) {
    const result = matchModel(usage, claudeCatalog, {});
    assert.equal(result.entryId, "anthropic/claude-sonnet-4.5", usage);
    assert.equal(hasUsablePrice(result.status), true, usage);
    if (expected) assert.equal(result.status, expected, usage);
  }

  // 无任何可猜成分的写法仍是可信状态，不进 guess 集合。
  assert.equal(matchModel("claude-sonnet-4-5", claudeCatalog, {}).status, "canonical");
  assert.equal(matchModel("claude-sonnet-4-5[1M]", claudeCatalog, {}).status, "canonical");
  assert.equal(matchModel("claude-sonnet-4-5-20250929", claudeCatalog, {}).reason, "date");
  assert.equal(matchModel("claude-sonnet-4-5-latest", claudeCatalog, {}).reason, "latest");
  assert.equal(
    matchModel("us.anthropic.claude-sonnet-4-5-20250929-v1:0", claudeCatalog, {}).matchedBy,
    "provider-prefix",
  );
});

test("点/横线等价：glm-5.3 ↔ glm-5-3 双向命中", () => {
  const dotted = [entry("z-ai/glm-5.3", "GLM 5.3")];
  const dashed = [entry("z-ai/glm-5-3", "GLM 5-3")];
  assert.equal(matchModel("glm-5-3", dotted, {}).entryId, "z-ai/glm-5.3");
  assert.equal(matchModel("glm-5.3", dashed, {}).entryId, "z-ai/glm-5-3");
  assert.equal(matchModel("z-ai/glm-5-3", dotted, {}).status, "canonical");
});

test("canonical 身份：裸 id 不命中时按 canonical 归并", () => {
  const md = [
    {
      id: "model-z",
      provider: "vendor-x",
      slug: "vendor-x/model-z",
      name: "Model Z",
      prompt: 3e-6,
      completion: 15e-6,
      cacheRead: 0.3e-6,
      cacheWrite: 3.75e-6,
      request: 0,
      canonical: "claude-sonnet-4-5",
      context: 0,
    },
  ];
  const result = matchModel("claude-sonnet-4-5", md, {});
  assert.equal(result.status, "canonical");
  assert.equal(result.entryId, "model-z");
  assert.equal(result.matchedBy, "identity-canonical");
});

test("身份层共识：同价多条目可信，离散组降级为 guess", () => {
  const consistent = [];
  for (let index = 0; index < 9; index += 1) {
    consistent.push(
      priced(`p${index}/claude-sonnet-4-6`, index === 0 ? 3.1e-6 : 3e-6, { provider: `p${index}` }),
    );
  }
  const trusted = matchModel("claude-sonnet-4-6", consistent, {});
  assert.equal(trusted.status, "canonical");
  assert.equal(trusted.confidence, 0.85);
  assert.equal(isPricedStatus(trusted.status), true);

  const scattered = [];
  for (let index = 1; index <= 9; index += 1) {
    scattered.push(priced(`q${index}/qwen3-14b`, index * 1e-7, { provider: `q${index}` }));
  }
  const guessed = matchModel("qwen3-14b", scattered, {});
  assert.equal(guessed.status, "guess");
  assert.equal(guessed.reason, "no-consensus");
  assert.equal(guessed.confidence, 0.5);
  assert.equal(isPricedStatus(guessed.status), false);
  assert.equal(hasUsablePrice(guessed.status), true);
});

test("子集降级：qwen3 → qwen3-235b-a22b 记为 guess，deepseek-flash 不算子集", () => {
  const family = [entry("qwen/qwen3-235b-a22b", "Qwen3 235B"), entry("deepseek/deepseek-flash", "Flash")];
  const subset = matchModel("qwen3", family, {});
  assert.equal(subset.status, "guess");
  assert.equal(subset.reason, "subset-tokens");
  assert.equal(subset.entryId, "qwen/qwen3-235b-a22b");

  const exact = matchModel("deepseek-flash", family, {});
  assert.equal(exact.entryId, "deepseek/deepseek-flash");
  assert.notEqual(exact.status, "guess");
  assert.equal(hasUsablePrice(exact.status), true);
});

test("渠道前缀护栏：剩余部分不是已知模型时不合并", () => {
  const only = [entry("openai/gpt-5.1", "GPT-5.1")];
  const result = matchModel("acme-gpt-5", only, {});
  assert.equal(result.status, "unmatched");
  assert.equal(result.entryId, "");
  assert.equal(result.reason, "no-candidate");
});

test("Bedrock 版本后缀命中记 normalized，区域前缀本身不算 guess", () => {
  const version = matchModel("claude-sonnet-4-5-v1", claudeCatalog, {});
  assert.equal(version.entryId, "anthropic/claude-sonnet-4.5");
  assert.equal(version.status, "normalized");
  assert.equal(version.confidence, 0.9);
  assert.equal(version.matchedBy, "version");
});

test("matchModel 对同一模型名复用缓存结果", () => {
  const mappings = {};
  const first = matchModel("claude-sonnet-4-5", claudeCatalog, mappings);
  const second = matchModel("claude-sonnet-4-5", claudeCatalog, mappings);
  assert.equal(first, second);
});

test("custom 是可计价状态：计入覆盖率，但不改变 guess 语义", () => {
  assert.equal(isPricedStatus("custom"), true);
  assert.equal(hasUsablePrice("custom"), true);
  // guess 依然只计入金额、不计入覆盖率分子。
  assert.equal(isPricedStatus("guess"), false);
  assert.equal(hasUsablePrice("guess"), true);
  // matchModel 只负责「名字 → 条目」，永不返回 custom（它由 prices.js 合成）。
  const result = matchModel("custom:relay", [], {});
  assert.notEqual(result.status, "custom");
  assert.equal(result.status, "unmatched");
});
