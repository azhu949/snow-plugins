import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, IGNORE_MAPPING, OPENROUTER_MODELS_URL } from "../src/constants.js";
import { normalizeMappings, normalizeSettings, resolveCatalogTtlMs } from "../src/settings.js";

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
