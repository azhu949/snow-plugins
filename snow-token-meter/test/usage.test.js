import test from "node:test";
import assert from "node:assert/strict";
import {
  createUsageSource,
  emptySummary,
  normalizeSummary,
  normalizeUsage,
  UsageError,
} from "../src/usage.js";

const summaryFields = (summary) => ({ ...summary });

test("cache read 超过 input 时按 input 截断", () => {
  const summary = normalizeSummary({
    totalInputTokens: 100,
    totalOutputTokens: 50,
    totalCacheReadInputTokens: 400,
    totalCacheCreationInputTokens: 0,
    totalRequests: 3,
    errorRequests: 1,
  });
  assert.equal(summary.totalTokens, 150);
  assert.equal(summary.effectiveCacheReadTokens, 100);
  assert.equal(summary.nonCachedInputTokens, 0);
  assert.equal(summary.totalCacheReadInputTokens, 400);
  assert.equal(summary.errorRequests, 1);
});

test("errorRequests 不会超过 totalRequests", () => {
  const summary = normalizeSummary({ totalRequests: 2, errorRequests: 9 });
  assert.equal(summary.errorRequests, 2);
});

test("空 summary 回退为零值且字段完整", () => {
  assert.deepEqual(summaryFields(normalizeSummary(null)), emptySummary());
});

test("normalizeUsage 归一化模型字段并重算 totalTokens", () => {
  const { summary, models } = normalizeUsage({
    domains: {
      usage: {
        summary: {
          totalInputTokens: 100,
          totalOutputTokens: 20,
          totalCacheReadInputTokens: 30,
          totalCacheCreationInputTokens: 10,
          totalRequests: 3,
          errorRequests: 1,
          totalTokens: 999,
        },
        models: [
          {
            model: " deepseek-v4.1-flash ",
            totalRequests: 3,
            errorRequests: 1,
            totalInputTokens: 100,
            totalOutputTokens: 20,
            totalCacheReadInputTokens: 30,
            totalCacheCreationInputTokens: 10,
            totalTokens: 999,
          },
          { model: "   " },
          null,
        ],
      },
    },
  });
  assert.equal(summary.totalTokens, 120);
  assert.equal(summary.totalCacheCreationInputTokens, 10);
  assert.equal(models.length, 1);
  assert.deepEqual(models[0], {
    model: "deepseek-v4.1-flash",
    totalRequests: 3,
    errorRequests: 1,
    totalInputTokens: 100,
    totalOutputTokens: 20,
    totalCacheCreationInputTokens: 10,
    totalCacheReadInputTokens: 30,
    totalTokens: 120,
  });
});

test("未声明的 usage 域转为 privacy-declaration-missing", () => {
  assert.throws(
    () =>
      normalizeUsage({
        domains: {},
        denied: { usage: { reason: "privacy-declaration-missing", scope: "usage" } },
        withheld: {},
        unknown: [],
      }),
    (error) =>
      error instanceof UsageError &&
      error.code === "privacy-declaration-missing" &&
      error.details.scope === "usage",
  );
});

test("withheld 字段转为 usage-withheld", () => {
  assert.throws(
    () => normalizeUsage({ domains: { usage: {} }, withheld: { usage: ["summary"] } }),
    (error) => error instanceof UsageError && error.code === "usage-withheld",
  );
});

test("缺少 usage 域时给出 usage-unavailable", () => {
  assert.throws(
    () => normalizeUsage({ domains: {}, denied: {}, withheld: {} }),
    (error) => error instanceof UsageError && error.code === "usage-unavailable",
  );
});

test("createUsageSource 透传本地时间参数并按需省略 profileName", async () => {
  const calls = [];
  const api = {
    metadata: {
      async get(domains, options) {
        calls.push({ domains, options });
        return { domains: { usage: { summary: { totalInputTokens: 10 }, models: [] } } };
      },
    },
  };
  const source = createUsageSource(api);
  const result = await source.fetchUsage({
    since: "2026-10-30 00:00:00",
    until: "2026-10-30 23:59:59",
    profileName: "",
  });
  assert.deepEqual(calls[0].domains, ["usage"]);
  // 第 1 页（免费）显式声明 100/0：页宽不随宿主默认值漂移。
  assert.deepEqual(calls[0].options, {
    params: { since: "2026-10-30 00:00:00", until: "2026-10-30 23:59:59", limit: 100, offset: 0 },
  });
  assert.equal(result.summary.totalTokens, 10);

  await source.fetchUsage({ profileName: "main" });
  assert.deepEqual(calls[1].options, { params: { profileName: "main", limit: 100, offset: 0 } });
});

test("createUsageSource 在 denied 时抛出 UsageError", async () => {
  const api = {
    metadata: {
      async get() {
        return { domains: {}, denied: { usage: { reason: "privacy-declaration-missing" } } };
      },
    },
  };
  await assert.rejects(
    () => createUsageSource(api).fetchUsage({ since: "2026-10-30 00:00:00" }),
    (error) => error instanceof UsageError && error.code === "privacy-declaration-missing",
  );
});

test("缺少 metadata 能力时报 usage-host-missing", async () => {
  await assert.rejects(
    () => createUsageSource({}).fetchUsage({}),
    (error) => error instanceof UsageError && error.code === "usage-host-missing",
  );
});
