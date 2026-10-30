// 挂载冒烟测试：在 JSDOM 里加载构建产物，验证真实挂载链路
//（宿主插槽 → 徽标 → 浮层 → 设置视图 → cleanup 还原）。
// node --test 每个测试文件独立进程；其它测试不要引入 jsdom。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const BUILT_URL = new URL("../dist/snow-token-meter.user.js", import.meta.url);
const BUILT = readFileSync(BUILT_URL, "utf8");
const ALL_TIME_SINCE = "2000-01-01 00:00:00";

const CATALOG = [
  {
    id: "deepseek/deepseek-v4.1-flash",
    canonical_slug: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek: DeepSeek V4.1 Flash",
    context_length: 1000000,
    pricing: {
      prompt: "0.000000045",
      completion: "0.0000005",
      input_cache_read: "0.000000006",
    },
  },
  {
    id: "openai/gpt-6.1-sol",
    canonical_slug: "openai/gpt-6.1-sol",
    name: "OpenAI: GPT-6.1 Sol",
    context_length: 400000,
    pricing: { prompt: "0.000002", completion: "0.000008" },
  },
];

function usageDomain({ input, output, cacheRead, requests, models }) {
  return {
    generatedAt: Date.now(),
    domains: {
      usage: {
        summary: {
          totalInputTokens: input,
          totalOutputTokens: output,
          totalCacheCreationInputTokens: 0,
          totalCacheReadInputTokens: cacheRead,
          totalRequests: requests,
          errorRequests: 0,
        },
        models,
      },
    },
    denied: {},
    withheld: {},
    unknown: [],
  };
}

const TODAY_USAGE = usageDomain({
  input: 10000,
  output: 2000,
  cacheRead: 4000,
  requests: 8,
  models: [
    {
      model: "deepseek-v4.1-flash",
      totalInputTokens: 8000,
      totalOutputTokens: 2000,
      totalCacheReadInputTokens: 4000,
      totalRequests: 6,
      errorRequests: 0,
    },
    {
      model: "DeepSeek-Flash",
      totalInputTokens: 2000,
      totalOutputTokens: 0,
      totalCacheReadInputTokens: 0,
      totalRequests: 2,
      errorRequests: 0,
    },
  ],
});

const ALL_TIME_USAGE = usageDomain({
  input: 400000,
  output: 100000,
  cacheRead: 0,
  requests: 120,
  models: [
    {
      model: "deepseek-v4.1-flash",
      totalInputTokens: 400000,
      totalOutputTokens: 100000,
      totalCacheReadInputTokens: 0,
      totalRequests: 120,
      errorRequests: 0,
    },
  ],
});

function waitFor(predicate, timeoutMs = 2000, intervalMs = 20) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let value;
      try {
        value = predicate();
      } catch (error) {
        reject(error);
        return;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`等待超时（${timeoutMs}ms）`));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function createHarness() {
  const dom = new JSDOM(
    `<!doctype html><html><head><title>snow</title></head><body>
      <div data-snow-anchor="topbar"><div data-snow-slot="topbar.actions"></div></div>
      <div data-snow-anchor="chat.input"></div>
    </body></html>`,
    { url: "snow://client/chat", runScripts: "outside-only", pretendToBeVisual: true },
  );
  const { window } = dom;
  const document = window.document;

  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });

  // 给每个元素一个非零矩形：定位逻辑依赖锚点与浮层的尺寸。
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 220,
      bottom: 32,
      width: 220,
      height: 32,
      toJSON() {
        return this;
      },
    };
  };

  const values = new Map();
  const injectedStyles = [];
  window.GM_getValue = (key, fallback) => (values.has(key) ? values.get(key) : fallback);
  window.GM_setValue = (key, value) => {
    values.set(key, value);
  };
  window.GM_deleteValue = (key) => {
    values.delete(key);
  };
  window.GM_addStyle = (css) => {
    injectedStyles.push(css);
    return null;
  };
  window.GM_log = () => {};

  const cleanups = [];
  const listeners = new Map();
  const context = { locale: "zh-CN", view: "chat", appReady: true, theme: "light" };
  let fetchCalls = 0;

  window.snow = {
    context,
    isSandbox: true,
    slot(name) {
      return document.querySelector(`[data-snow-slot="${name}"]`);
    },
    anchor(name) {
      return document.querySelector(`[data-snow-anchor="${name}"]`);
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return () => listeners.get(event)?.delete(listener);
    },
    onCleanup(listener) {
      cleanups.push(listener);
    },
    async fetch(url) {
      fetchCalls += 1;
      if (String(url).includes("frankfurter")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { rates: { CNY: 7.2 } };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: CATALOG };
        },
      };
    },
    metadata: {
      async get(domains, options) {
        // 跨 realm 的数组不能直接用 deepEqual 比较原型，这里只校验内容。
        if (!Array.isArray(domains) || domains[0] !== "usage") {
          throw new Error("只应请求 usage 元数据域");
        }
        const since = options?.params?.since;
        return since === ALL_TIME_SINCE ? ALL_TIME_USAGE : TODAY_USAGE;
      },
    },
  };

  return {
    dom,
    window,
    document,
    values,
    injectedStyles,
    cleanups,
    listeners,
    context,
    get fetchCalls() {
      return fetchCalls;
    },
  };
}

test("构建产物满足客户端脚本元数据契约", () => {
  assert.ok(BUILT.startsWith("// ==UserScript==\n"), "产物必须以 // ==UserScript== 开头");
  assert.match(BUILT, /@snow-target\s+client/);
  assert.match(BUILT, /@snow-privacy\s+usage/);
  assert.match(BUILT, /@namespace\s+com\.snow\.token-meter/);
  assert.match(BUILT, /@match\s+snow:\/\/client\/\*/);
  assert.ok(!BUILT.includes("@snow-sandbox"), "不允许声明 @snow-sandbox");
  assert.ok(!BUILT.includes("unsafeWindow"), "不允许使用 unsafeWindow");
  assert.ok(!BUILT.includes("window.snow"), "不允许访问 window.snow");
});

test(
  "JSDOM 中挂载徽标、展开浮层、切换设置视图并在 cleanup 后还原",
  { timeout: 15000 },
  async () => {
    const harness = createHarness();
    const { window, document, cleanups, values } = harness;

    try {
      window.eval(BUILT);

      const slot = document.querySelector('[data-snow-slot="topbar.actions"]');
      const badgeHost = await waitFor(() => document.getElementById("snow-token-meter-badge"));
      // 默认是悬浮形态：徽标必须挂在 body，避免顶栏卡片的 backdrop-filter 成为 fixed 包含块。
      assert.equal(badgeHost.parentElement, document.body, "悬浮形态的徽标必须挂在 body 上");

      const tokens = await waitFor(() => {
        const text = document.querySelector("#snow-token-meter-badge .tm-badge-tokens")?.textContent;
        return text && text !== "—" ? text : "";
      });
      const cost = document.querySelector("#snow-token-meter-badge .tm-badge-cost")?.textContent || "";
      assert.equal(tokens, "12K", "徽标应展示今日紧凑 token 数");
      assert.ok(cost.includes("¥"), `徽标金额应带币种符号，实际为 ${cost}`);
      assert.ok(cost.includes("0.01"), `今日成本应约为 ¥0.01，实际为 ${cost}`);

      const toggle = document.querySelector('[data-tm-action="toggle"]');
      assert.ok(toggle, "徽标按钮必须带 data-tm-action=toggle");
      assert.equal(toggle.getAttribute("aria-haspopup"), "dialog");
      assert.equal(toggle.getAttribute("aria-expanded"), "false");
      assert.ok(toggle.getAttribute("aria-label")?.includes("Token 用量仪表"));

      toggle.click();
      const panel = document.getElementById("snow-token-meter-panel");
      assert.ok(panel, "浮层 root 必须挂在 body 下");
      assert.equal(panel.classList.contains("is-hidden"), false, "点击徽标应展开浮层");
      assert.equal(toggle.getAttribute("aria-expanded"), "true");
      assert.equal(panel.getAttribute("data-tm-view"), "main");
      assert.ok(panel.textContent.includes("今日"), "浮层应包含今日概览");
      assert.ok(panel.textContent.includes("累计"), "浮层应包含累计概览");
      assert.ok(panel.textContent.includes("deepseek-v4.1-flash"), "浮层应列出按模型的明细");
      assert.ok(panel.textContent.includes("未匹配"), "未匹配模型应标注状态");
      assert.equal(harness.fetchCalls > 0, true, "展开浮层应触发一次价格目录请求");

      const settingsButton = panel.querySelector('[data-tm-action="settings"]');
      settingsButton.click();
      assert.equal(panel.getAttribute("data-tm-view"), "settings", "设置按钮应切到设置视图");
      assert.equal(panel.querySelector('[data-tm-setting="currency"]')?.value, "CNY");
      assert.ok(panel.textContent.includes("显示货币"));
      assert.ok(panel.querySelector('[data-tm-action="save-settings"]'), "设置视图应有保存按钮");

      panel.querySelector('[data-tm-action="back"]').click();
      assert.equal(panel.getAttribute("data-tm-view"), "main", "返回按钮应回到主视图");

      // 映射视图：点击模型状态徽标进入，再返回。
      panel.querySelector('[data-tm-action="map"]').click();
      assert.equal(panel.getAttribute("data-tm-view"), "mapping", "状态徽标应进入映射视图");
      const search = panel.querySelector("[data-tm-search]");
      assert.ok(search, "映射视图应有搜索框 data-tm-search");
      search.value = "gpt";
      search.dispatchEvent(new window.Event("input", { bubbles: true }));
      assert.ok(panel.textContent.includes("openai/gpt-6.1-sol"), "搜索应过滤价格目录");

      for (const cleanup of cleanups) cleanup();

      assert.equal(slot.children.length, 0, "cleanup 后顶栏插槽必须清空");
      assert.equal(document.getElementById("snow-token-meter-panel"), null, "cleanup 后浮层 root 必须移除");
      assert.equal(document.getElementById("snow-token-meter-badge"), null, "cleanup 后徽标必须移除");
      assert.equal(values.has("tokenmeter:mappings"), false, "只读路径不应写入映射表");
    } finally {
      try {
        for (const cleanup of cleanups) cleanup();
      } catch {
        // cleanup 可重复执行，这里只兜底避免残留定时器。
      }
      harness.dom.window.close();
    }
  },
);
