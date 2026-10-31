// 挂载冒烟测试：在 JSDOM 里加载构建产物，验证真实挂载链路
//（宿主插槽 → 徽标 → 浮层 → 设置视图 → cleanup 还原）。
// node --test 每个测试文件独立进程；其它测试不要引入 jsdom。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { formatLocalDateTime } from "../src/util.js";

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

function usageDomain({ input, output, cacheRead, requests, models, records = null }) {
  const usage = {
    summary: {
      totalInputTokens: input,
      totalOutputTokens: output,
      totalCacheCreationInputTokens: 0,
      totalCacheReadInputTokens: cacheRead,
      totalRequests: requests,
      errorRequests: 0,
    },
    models,
  };
  if (records) usage.records = { items: records, total: records.length };
  return {
    generatedAt: Date.now(),
    domains: { usage },
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

// 精算夹具：目录带长上下文档位，records 覆盖完整（两条请求都越档）。
const PRECISE_CATALOG = [
  {
    id: "deepseek/deepseek-v4.1-flash",
    canonical_slug: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek: DeepSeek V4.1 Flash",
    context_length: 1000000,
    pricing: {
      prompt: "0.000001",
      completion: "0.000002",
      input_cache_read: "0.0000001",
      input_cache_write: "0.000001",
      overrides: [{ min_prompt_tokens: 100, prompt: "0.000002", completion: "0.000004" }],
    },
  },
];

function preciseRecord(id, input, output) {
  return {
    id,
    conversationId: "c1",
    responseId: `r-${id}`,
    model: "deepseek/deepseek-v4.1-flash",
    apiProfileName: "",
    apiConfigId: "",
    requestMethod: "chat",
    inputTokens: input,
    outputTokens: output,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    status: "success",
    isSubAgent: false,
    directoryId: "",
    // 用运行时本地时间：todayRange 取真实本地日期，硬编码日期跨天后会被窗口过滤。
    createdAt: formatLocalDateTime(new Date()),
  };
}

const PRECISE_TODAY = usageDomain({
  input: 270,
  output: 100,
  cacheRead: 0,
  requests: 2,
  models: [
    {
      model: "deepseek/deepseek-v4.1-flash",
      totalInputTokens: 270,
      totalOutputTokens: 100,
      totalCacheReadInputTokens: 0,
      totalRequests: 2,
      errorRequests: 0,
    },
  ],
  records: [preciseRecord("r1", 150, 50), preciseRecord("r2", 120, 50)],
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

// Preact 的 setState 在微任务里刷新：输入后立刻点按钮会读到上一帧的本地草稿，测试需要先让出一帧。
function tick(window, ms = 20) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createHarness({ catalog = CATALOG, todayUsage = TODAY_USAGE, allTimeUsage = ALL_TIME_USAGE } = {}) {
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
          return { data: catalog };
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
        return since === ALL_TIME_SINCE ? allTimeUsage : todayUsage;
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

      // 没有 records 的夹具必须仍能渲染：聚合模式徽标 + 明确的回退说明。
      const modePill = panel.querySelector("[data-tm-mode]");
      assert.ok(modePill, "计价模式徽标必须存在");
      assert.equal(modePill.getAttribute("data-tm-mode"), "aggregate", "无 records 时按聚合估算");
      assert.ok(panel.textContent.includes("宿主未返回逐条用量"), "应说明为什么回退聚合");
      // 存在未计价 token：金额要标成下限。
      assert.ok(panel.textContent.includes("≥"), "未计价 token 存在时应显示金额下限");

      const settingsButton = panel.querySelector('[data-tm-action="settings"]');
      settingsButton.click();
      assert.equal(panel.getAttribute("data-tm-view"), "settings", "设置按钮应切到设置视图");
      assert.equal(panel.querySelector('[data-tm-setting="currency"]')?.value, "CNY");
      assert.ok(panel.textContent.includes("显示货币"));
      assert.equal(panel.querySelector('[data-tm-setting="precise"]')?.value, "auto");
      assert.equal(panel.querySelector('[data-tm-setting="cache-ttl"]')?.value, "5m");
      assert.ok(panel.textContent.includes("逐请求精算"), "设置视图应有精算模式控件");
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

test(
  "精算模式：records 完整时显示逐请求精算与档位价，金额不再标下限",
  { timeout: 15000 },
  async () => {
    const harness = createHarness({ catalog: PRECISE_CATALOG, todayUsage: PRECISE_TODAY });
    const { window, document, cleanups } = harness;

    try {
      window.eval(BUILT);
      await waitFor(() => document.getElementById("snow-token-meter-badge"));
      const costText = await waitFor(() => {
        const text = document.querySelector("#snow-token-meter-badge .tm-badge-cost")?.textContent;
        return text && text !== "—" ? text : "";
      });
      // 今日全部请求都可计价且区间塌缩成精确值：徽标不再加下限前缀。
      assert.ok(!costText.includes("≥"), `精算金额不应标下限，实际为 ${costText}`);

      document.querySelector('[data-tm-action="toggle"]').click();
      const panel = document.getElementById("snow-token-meter-panel");
      const modePill = await waitFor(() => panel.querySelector('[data-tm-mode="precise"]'));
      assert.ok(modePill.textContent.includes("逐请求精算"), "应显示逐请求精算模式");
      assert.ok(panel.textContent.includes("档位价"), "越档明细应标注档位价");
      assert.ok(panel.textContent.includes("精算 2 条"), "脚注应显示精算条数");
      assert.ok(!panel.textContent.includes("宿主未返回逐条用量"), "覆盖完整时不应出现回退说明");
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

test(
  "自定义价：映射视图保存后金额立即变化、custom 徽标生效、移除后恢复目录价",
  { timeout: 20000 },
  async () => {
    const harness = createHarness();
    const { window, document, cleanups, values } = harness;

    try {
      window.eval(BUILT);
      await waitFor(() => document.getElementById("snow-token-meter-badge"));
      const beforeCost = await waitFor(() => {
        const text = document.querySelector("#snow-token-meter-badge .tm-badge-cost")?.textContent;
        return text && text !== "—" ? text : "";
      });

      document.querySelector('[data-tm-action="toggle"]').click();
      const panel = document.getElementById("snow-token-meter-panel");
      await waitFor(() => panel.querySelector('[data-tm-action="map"]'));
      panel.querySelector('[data-tm-action="map"]').click();
      assert.equal(panel.getAttribute("data-tm-view"), "mapping");

      // 切换视图后先让出一帧：MappingView 的挂载 effect 会按存储值重置草稿，
      // 在它跑完之前输入的内容会被覆盖（真实用户不会这么快输入，测试必须显式等待）。
      await tick(window, 60);
      const input = panel.querySelector('[data-tm-price="input"]');
      assert.ok(input, "映射视图必须有自定义价输入 data-tm-price=input");
      assert.ok(panel.querySelector('[data-tm-action="save-price"]'), "必须有保存按钮 save-price");
      assert.ok(panel.querySelector('[data-tm-action="fill-price"]'), "必须能填入当前目录价");
      // placeholder 是留空会继承到的目录价；输入框为空即「继承」，填 0 才是显式免费。
      assert.equal(input.value, "", "空值表示继承，不能被预填成 0");
      assert.ok(input.getAttribute("placeholder") && input.getAttribute("placeholder") !== "—");
      assert.notEqual(
        panel.querySelector(".tm-map-current .tm-pill").textContent,
        "自定义价",
        "保存前不应出现 custom 徽标",
      );

      input.value = "10";
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      await tick(window);
      panel.querySelector('[data-tm-action="save-price"]').click();
      const stored = await waitFor(() => {
        const raw = values.get("tokenmeter:prices");
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed.models["deepseek-v4.1-flash"] ? parsed : null;
      });
      assert.equal(stored.models["deepseek-v4.1-flash"].input, 10);
      assert.equal(stored.models["deepseek-v4.1-flash"].multiplier, 1);

      // 状态徽标与当前取价都变成 custom（不加 ≈）。
      await waitFor(() => panel.querySelector(".tm-map-current .tm-pill")?.textContent === "自定义价");
      const pricePill = panel.querySelector(".tm-price-head .tm-pill");
      assert.equal(pricePill.textContent, "自定义价");
      assert.ok(!pricePill.textContent.includes("≈"), "自定义价不共用猜测符号");
      assert.ok(panel.textContent.includes("当前取价：自定义价"));

      panel.querySelector('[data-tm-action="back"]').click();
      const afterCost = await waitFor(() => {
        const text = document.querySelector("#snow-token-meter-badge .tm-badge-cost")?.textContent;
        return text && text !== beforeCost ? text : "";
      });
      assert.ok(afterCost.includes("¥"), `自定义价后徽标金额应重新格式化，实际为 ${afterCost}`);
      assert.ok(panel.textContent.includes("自定义价 1 个模型"), "脚注应统计自定义价模型数");

      // 移除自定义价：金额回到目录价口径，脚注不再统计。
      panel.querySelector('[data-tm-action="map"]').click();
      await waitFor(() => panel.querySelector('[data-tm-action="clear-price"]'));
      // 移除是两击确认：第一次点击只进入待确认态，不能写存储。
      panel.querySelector('[data-tm-action="clear-price"]').click();
      await tick(window);
      assert.equal(
        panel.querySelector('[data-tm-action="clear-price"]').getAttribute("aria-pressed"),
        "true",
        "第一次点击只进入待确认态",
      );
      assert.equal(
        Object.keys(JSON.parse(values.get("tokenmeter:prices")).models).length,
        1,
        "待确认态不得删除记录",
      );
      panel.querySelector('[data-tm-action="clear-price"]').click();
      await waitFor(() => {
        const raw = values.get("tokenmeter:prices");
        return raw && Object.keys(JSON.parse(raw).models).length === 0;
      });
      panel.querySelector('[data-tm-action="back"]').click();
      await waitFor(() => !panel.textContent.includes("自定义价 1 个模型"));
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

test(
  "设置视图：不再提供目录价倍率与粘贴导入，清空自定义价仍需两步确认",
  { timeout: 20000 },
  async () => {
    const harness = createHarness();
    const { window, document, cleanups } = harness;

    try {
      window.eval(BUILT);
      await waitFor(() => document.getElementById("snow-token-meter-badge"));
      document.querySelector('[data-tm-action="toggle"]').click();
      const panel = document.getElementById("snow-token-meter-panel");
      panel.querySelector('[data-tm-action="settings"]').click();
      assert.equal(panel.getAttribute("data-tm-view"), "settings");
      assert.equal(panel.querySelector('[data-tm-setting="price-multiplier"]'), null, "目录价倍率已移除");
      assert.equal(panel.querySelector('[data-tm-setting="price-import"]'), null, "粘贴导入已移除");
      assert.equal(panel.querySelector('[data-tm-setting="price-history"]'), null, "历史价开关已移除");

      // 清空全部自定义价仍是独立的两步确认（与重置映射分开）：第一次点击只进入待确认态。
      const clearButton = panel.querySelector('[data-tm-action="clear-prices"]');
      clearButton.click();
      await waitFor(() => panel.querySelector(".tm-danger-confirm"));
      assert.equal(clearButton.getAttribute("aria-pressed"), "true", "第一次点击应进入待确认态");
      assert.ok(
        panel.querySelector(".tm-danger-confirm").textContent.includes("清空全部自定义价"),
        "确认文案要指向具体动作",
      );
      // 取消必须真的退出待确认态，且不能触发清空（执行分支会写成功提示）。
      const cancelButton = panel.querySelector('[data-tm-action="cancel-confirm"]');
      assert.ok(cancelButton, "确认区必须有取消按钮");
      cancelButton.click();
      await waitFor(() => !panel.querySelector(".tm-danger-confirm"));
      assert.equal(clearButton.getAttribute("aria-pressed"), "false", "取消后应回到非待确认态");
      await tick(window);
      const notice = panel.querySelector(".tm-notice");
      assert.ok(!notice || !notice.classList.contains("is-visible"), "取消不得执行清空");
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

