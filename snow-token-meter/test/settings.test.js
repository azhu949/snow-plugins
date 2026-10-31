import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  IGNORE_MAPPING,
  LITELLM_URL,
  MODELS_DEV_URL,
  OPENROUTER_MODELS_URL,
} from "../src/constants.js";
import { normalizeCustomPrices, normalizeMappings, normalizeSettings, resolveCatalogTtlMs } from "../src/settings.js";

test("空设置回退默认值", () => {
  assert.deepEqual(normalizeSettings(null), { ...DEFAULT_SETTINGS });
  assert.deepEqual(normalizeSettings(undefined), { ...DEFAULT_SETTINGS });
});

test("非法枚举值回退默认", () => {
  const settings = normalizeSettings({
    displayCurrency: "eur",
    period: "year",
    badgeStyle: "week",
    displayMode: "sidebar",
  });
  assert.equal(settings.displayCurrency, "CNY");
  assert.equal(settings.period, "today");
  assert.equal(settings.badgeStyle, "today");
  assert.equal(settings.displayMode, "float");
});

test("数值范围夹取", () => {
  assert.equal(normalizeSettings({ fxRate: 99 }).fxRate, 20);
  assert.equal(normalizeSettings({ fxRate: 0.01 }).fxRate, 0.1);
  assert.equal(normalizeSettings({ fxRate: "bad" }).fxRate, DEFAULT_SETTINGS.fxRate);
  assert.equal(normalizeSettings({ refreshSeconds: 5 }).refreshSeconds, 30);
  assert.equal(normalizeSettings({ refreshSeconds: 9999 }).refreshSeconds, 600);
  assert.equal(normalizeSettings({ refreshSeconds: 45.6 }).refreshSeconds, 46);
  assert.equal(normalizeSettings({ catalogTtlHours: 0 }).catalogTtlHours, 1);
  assert.equal(normalizeSettings({ catalogTtlHours: 999 }).catalogTtlHours, 168);
});

test("布尔值接受字符串形式", () => {
  assert.equal(normalizeSettings({ panelPinned: "true" }).panelPinned, true);
  assert.equal(normalizeSettings({ autoRefresh: "false" }).autoRefresh, false);
  assert.equal(normalizeSettings({ autoRefresh: 0 }).autoRefresh, false);
  assert.equal(normalizeSettings({ panelPinned: "x" }).panelPinned, false);
});

test("货币大小写归一", () => {
  assert.equal(normalizeSettings({ displayCurrency: "cny" }).displayCurrency, "CNY");
  assert.equal(normalizeSettings({ displayCurrency: " USD " }).displayCurrency, "USD");
});

test("pricingUrl 只接受 http(s)", () => {
  assert.equal(normalizeSettings({ pricingUrl: "ftp://example.com" }).pricingUrl, OPENROUTER_MODELS_URL);
  assert.equal(
    normalizeSettings({ pricingUrl: " https://proxy.example.com/models " }).pricingUrl,
    "https://proxy.example.com/models",
  );
});

test("自定义地址拒绝 IP 字面量与内网主机", () => {
  // 公网 IP 同样拒绝：README 承诺「任何 IP 字面量都会被拒绝」，且请求会沿用会话 Cookie。
  for (const url of [
    "https://8.8.8.8/models",
    "https://1.1.1.1/models",
    "https://127.0.0.1/models",
    "https://10.1.2.3/models",
    "https://192.168.1.2/models",
    "https://[::1]/models",
    "https://localhost/models",
    "https://intranet/models",
  ]) {
    assert.equal(normalizeSettings({ pricingUrl: url }).pricingUrl, OPENROUTER_MODELS_URL, url);
  }
  assert.equal(
    normalizeSettings({ fxUrl: "https://8.8.8.8/fx" }).fxUrl,
    DEFAULT_SETTINGS.fxUrl,
    "汇率地址使用同一条主机校验",
  );
  assert.equal(
    normalizeSettings({ pricingUrl: "https://proxy.example.com/models" }).pricingUrl,
    "https://proxy.example.com/models",
  );
});

test("floatPosition 归一化并夹取", () => {
  assert.deepEqual(normalizeSettings({ floatPosition: { left: 12.4, top: 30.6 } }).floatPosition, {
    left: 12,
    top: 31,
  });
  assert.deepEqual(normalizeSettings({ floatPosition: { left: -20, top: 999999 } }).floatPosition, {
    left: 0,
    top: 100000,
  });
  assert.equal(normalizeSettings({ floatPosition: { left: "x", top: 1 } }).floatPosition, null);
  assert.equal(normalizeSettings({ floatPosition: "10,20" }).floatPosition, null);
});

test("profileName 去空白并限长", () => {
  const long = "x".repeat(400);
  assert.equal(normalizeSettings({ profileName: `  main  ` }).profileName, "main");
  assert.equal(normalizeSettings({ profileName: long }).profileName.length, 200);
  assert.equal(normalizeSettings({ profileName: 42 }).profileName, "");
});

test("normalizeMappings 小写键、丢弃非法值", () => {
  const mappings = normalizeMappings({
    "DeepSeek-V4.1-Flash": "deepseek/deepseek-v4.1-flash",
    "UMANS-LAB": IGNORE_MAPPING,
    "  ": "x",
    empty: "",
    number: 42,
    nullValue: null,
  });
  assert.deepEqual(mappings, {
    "deepseek-v4.1-flash": "deepseek/deepseek-v4.1-flash",
    "umans-lab": IGNORE_MAPPING,
  });
  assert.deepEqual(normalizeMappings(null), {});
  assert.deepEqual(normalizeMappings([]), {});
});

test("resolveCatalogTtlMs 按小时换算并夹取", () => {
  assert.equal(resolveCatalogTtlMs({ catalogTtlHours: 12 }), 12 * 60 * 60 * 1000);
  assert.equal(resolveCatalogTtlMs({ catalogTtlHours: 0 }), 60 * 60 * 1000);
  assert.equal(resolveCatalogTtlMs({}), 12 * 60 * 60 * 1000);
});

test("新增设置默认值：精算 auto / 缓存写 5m / 补全源关闭", () => {
  const settings = normalizeSettings({});
  assert.equal(settings.preciseRequests, "auto");
  assert.equal(settings.cacheWriteTtl, "5m");
  assert.equal(settings.fillSource, "");
  assert.equal(DEFAULT_SETTINGS.preciseRequests, "auto");
  assert.equal(DEFAULT_SETTINGS.cacheWriteTtl, "5m");
});

test("旧设置缺新键时零迁移成本：直接落默认值", () => {
  // 旧版本写下的设置只有这些键；新增键必须自动补齐，且不改变原有用量口径。
  const legacy = {
    displayCurrency: "USD",
    period: "30d",
    pricingSource: "modelsdev",
    pricingUrl: MODELS_DEV_URL,
    catalogTtlHours: 24,
  };
  const settings = normalizeSettings(legacy);
  assert.equal(settings.displayCurrency, "USD");
  assert.equal(settings.period, "30d");
  assert.equal(settings.pricingSource, "modelsdev");
  assert.equal(settings.pricingUrl, MODELS_DEV_URL);
  assert.equal(settings.preciseRequests, "auto");
  assert.equal(settings.cacheWriteTtl, "5m");
  assert.equal(settings.fillSource, "");
});

test("精算模式与缓存写假设只接受已知取值", () => {
  assert.equal(normalizeSettings({ preciseRequests: "weird" }).preciseRequests, "auto");
  assert.equal(normalizeSettings({ preciseRequests: "always" }).preciseRequests, "always");
  assert.equal(normalizeSettings({ preciseRequests: "off" }).preciseRequests, "off");
  assert.equal(normalizeSettings({ cacheWriteTtl: "2h" }).cacheWriteTtl, "5m");
  assert.equal(normalizeSettings({ cacheWriteTtl: "1h" }).cacheWriteTtl, "1h");
});

test("补全源只接受已知价格源或空串", () => {
  assert.equal(normalizeSettings({ fillSource: "litellm" }).fillSource, "litellm");
  assert.equal(normalizeSettings({ fillSource: "openrouter" }).fillSource, "openrouter");
  assert.equal(normalizeSettings({ fillSource: "nope" }).fillSource, "");
  assert.equal(normalizeSettings({ fillSource: null }).fillSource, "");
});

test("pricingSource 接受 litellm 并回退到该源的默认地址", () => {
  const settings = normalizeSettings({ pricingSource: "litellm" });
  assert.equal(settings.pricingSource, "litellm");
  assert.equal(settings.pricingUrl, LITELLM_URL);
  // 自定义地址仍然优先：只有非法 / 缺失时才回退默认。
  assert.equal(
    normalizeSettings({ pricingSource: "litellm", pricingUrl: "https://proxy.example.com/prices.json" })
      .pricingUrl,
    "https://proxy.example.com/prices.json",
  );
});

test("normalizeCustomPrices：键小写、0 保留、非法项丢弃", () => {
  const prices = normalizeCustomPrices({
    models: {
      "DeepSeek-V4.1-Flash": { input: 0, cacheRead: null, output: 4.5 },
      "relay/bad": { input: -1 },
      "relay/empty": {},
    },
  });
  assert.deepEqual(Object.keys(prices), ["deepseek-v4.1-flash"]);
  assert.equal(prices["deepseek-v4.1-flash"].input, 0);
  assert.equal(prices["deepseek-v4.1-flash"].cacheRead, null);
  assert.equal(prices["deepseek-v4.1-flash"].output, 4.5);
  assert.deepEqual(normalizeCustomPrices(null), {});
});

test("旧设置与旧映射：新增键取默认值，映射值仍只接受字符串", () => {
  const legacy = {
    displayCurrency: "USD",
    period: "7d",
    pricingSource: "openrouter",
    pricingUrl: OPENROUTER_MODELS_URL,
    catalogTtlHours: 6,
  };
  const settings = normalizeSettings(legacy);
  assert.equal(settings.displayCurrency, "USD");
  assert.equal(settings.period, "7d");
  // 对象值仍被 normalizeMappings 丢弃：自定义价必须存在独立的 GM 键里。
  assert.deepEqual(normalizeMappings({ "A/B": "x/y", obj: { input: 1 } }), { "a/b": "x/y" });
});

test("normalizeCustomPrices：损坏结构回退空表，合法结构逐条归一", () => {
  // 旧版本没有价格键 → null → 空表（零迁移成本）。
  assert.deepEqual(normalizeCustomPrices(null), {});
  assert.deepEqual(normalizeCustomPrices(undefined), {});
  // 形状坏掉（不是对象 / models 不是对象）一律回退空表，不让坏数据渗进计价。
  assert.deepEqual(normalizeCustomPrices("oops"), {});
  assert.deepEqual(normalizeCustomPrices(42), {});
  assert.deepEqual(normalizeCustomPrices([]), {});
  assert.deepEqual(normalizeCustomPrices({ models: "oops" }), {});
  assert.deepEqual(normalizeCustomPrices({ models: [] }), {});
  // 合法结构：键小写、0 / null 保留、非法条目丢弃。
  const prices = normalizeCustomPrices({
    schema: 1,
    models: {
      "Relay/Model": { input: 0, cacheWrite: null, multiplier: 0.3 },
      "relay/bad": { input: -1 },
    },
  });
  assert.deepEqual(Object.keys(prices), ["relay/model"]);
  assert.equal(prices["relay/model"].input, 0);
  assert.equal(prices["relay/model"].cacheWrite, null);
  assert.equal(prices["relay/model"].multiplier, 0.3);
});
