// 在离线 DOM 中验证分页、查询竞态与分类联动；不启动项目或访问上游。
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as React from "preact/compat";
import { act } from "preact/test-utils";
import { bindReact, h } from "../src/panel/ui/runtime.js";
import { DiscoveryPage } from "../src/panel/pages/catalog.js";

let dom;
let root;
let scrollHeights;
let viewportHeight;
const t = (key, values) => `${key}${values ? ` ${Object.values(values).join(" ")}` : ""}`;
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
};
const fire = async (node, event = "click", value) => {
  assert.ok(node, `找不到 ${event} 目标`);
  await act(() => {
    if (value !== undefined) node.value = value;
    node.dispatchEvent(new dom.window.Event(event, { bubbles: true }));
  });
  await settle();
};
const chooseOption = async (trigger, value) => {
  await fire(trigger);
  const option = [...document.querySelectorAll(".hg-select-menu [role='option']")].find((node) => node.dataset.value === value);
  assert.ok(option, `找不到下拉选项 ${value}`);
  await fire(option);
};
const scrollNearEnd = async (selector = ".hg-ranking .hg-scroll") => {
  const scroll = root.querySelector(selector);
  assert.ok(scroll, "找不到滚动容器");
  scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight - 100;
  await fire(scroll, "scroll");
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
};
const item = (id, extra = {}) => ({ id, title: `短剧-${id}`, cover: null, count: 30, ...extra });
const contents = [
  { id: "all", name: "全部", selected: true, boards: [{ id: "hot", name: "热播榜", selected: true }, { id: "new", name: "新剧榜" }] },
  { id: "human", name: "真人剧", boards: [{ id: "human-hot", name: "真人热播", selected: true }] },
  { id: "comic_series_rank", name: "漫剧", boards: [{ id: "comic-hot", name: "漫剧热播", selected: true }] },
];
const rank = (query = {}, items = [item("one", { position: 1 })], extra = {}) => ({
  content: query.content || "all", board: query.board || "hot", contents, items, hasMore: false, ...extra,
});
const rows = (genre = "") => [
  { key: "genre", name: "剧种", options: [{ name: "不限", value: "" }, { name: "真人", value: "human" }, { name: "漫剧", value: "comic_series" }] },
  { key: genre === "comic_series" ? "role" : "theme", name: genre === "comic_series" ? "角色" : "题材", options: [{ name: "全部", value: "" }, { name: "测试条件", value: "choice" }] },
  { key: "creation_status", name: "状态", options: [{ name: "连载", value: "0" }, { name: "完结", value: "1" }] },
];
const makeContext = (overrides = {}) => ({
  t, api: {}, openSeries: () => {},
  rpc: {
    discover: async () => ({ items: [], hasMore: false }),
    getRank: async (query) => rank(query),
    getFilterPanel: async (genre) => ({ rows: rows(genre) }),
    filterSeries: async () => ({ items: [item("filtered")], hasMore: false }),
    ...overrides,
  },
});
const mount = async (ctx, mode) => {
  await act(() => React.render(h(DiscoveryPage, { ctx, active: true }), root));
  await settle();
  if (mode != null) await fire(root.querySelectorAll(".hg-discovery-mode")[mode]);
};

beforeEach(() => {
  dom = new JSDOM("<!doctype html><body><div id='root'></div></body>", { url: "http://localhost/", pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  // JSDOM 不布局，显式模拟滚动尺寸；默认列表较长，只有滚动后才触底。
  scrollHeights = new WeakMap();
  viewportHeight = 600;
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    clientHeight: { configurable: true, get() { return this.classList.contains("hg-scroll") ? viewportHeight : 0; } },
    scrollHeight: { configurable: true, get() { return this.classList.contains("hg-scroll") ? (scrollHeights.get(this) ?? 2400) : 0; } },
  });
  bindReact(React);
  root = document.querySelector("#root");
});
afterEach(async () => {
  await act(() => React.render(null, root));
  await settle();
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
});

test("发现页按需加载榜单，显示排名与推广，返回时保留结果", async () => {
  let calls = 0;
  let opened;
  const ctx = makeContext({ getRank: async (query) => {
    calls += 1;
    return rank(query, [item("one", { position: 1, score: "100万热度" }), item("ad", { promoted: true, position: 2 })]);
  } });
  ctx.openSeries = (entry) => { opened = entry.id; };
  await mount(ctx);
  assert.equal(calls, 0);
  await fire(root.querySelectorAll(".hg-discovery-mode")[1]);
  assert.equal(calls, 1);
  assert.deepEqual([...root.querySelectorAll(".hg-rank-number")].map((node) => node.textContent), ["1", "—"]);
  assert.match(root.textContent, /catalog.promoted/);
  await fire(root.querySelector(".hg-rank-item"));
  assert.equal(opened, "one");
  await fire(root.querySelectorAll(".hg-discovery-mode")[0]);
  await fire(root.querySelectorAll(".hg-discovery-mode")[1]);
  assert.equal(calls, 1);
  assert.equal(root.querySelectorAll(".hg-rank-item").length, 2);
});

test("榜单翻页固定到首次返回的默认子榜，重复作品去重，循环游标停止", async () => {
  const calls = [];
  const ctx = makeContext({ getRank: async (query) => {
    calls.push(query);
    if (!query.cursor) return rank(query, [item("one", { position: 1 })], { content: "human", board: "human-hot", cursor: "next", hasMore: true });
    return rank(query, [item("one"), item("two", { position: 2 })], { cursor: "next", hasMore: true });
  } });
  await mount(ctx, 1);
  assert.equal(calls.length, 1);
  assert.equal(root.querySelector(".hg-ranking .hg-list-foot button"), null);
  await scrollNearEnd();
  assert.equal(calls[1].content, "human");
  assert.equal(calls[1].board, "human-hot");
  assert.equal(calls[1].cursor, "next");
  assert.equal(root.querySelectorAll(".hg-rank-item").length, 2);
  assert.match(root.querySelector(".hg-ranking .hg-list-foot").textContent, /discover.end/);
  await scrollNearEnd();
  assert.equal(calls.length, 2);
});

test("切换榜单内容时清除旧子榜和游标，迟到的上一页不混入新结果", async () => {
  const pending = deferred();
  const calls = [];
  const ctx = makeContext({ getRank: async (query) => {
    calls.push(query);
    if (query.cursor) return pending.promise;
    return rank(query, [item(query.content || "all")], { board: query.content === "human" ? "human-hot" : "hot", cursor: "next", hasMore: true });
  } });
  await mount(ctx, 1);
  await scrollNearEnd();
  await chooseOption(root.querySelector('[aria-label="catalog.content"]'), "human");
  assert.deepEqual(calls.at(-1), { content: "human", cursor: null });
  pending.resolve(rank({}, [item("stale")], { hasMore: false }));
  await settle();
  assert.match(root.querySelector(".hg-rank-list").textContent, /短剧-human/);
  assert.doesNotMatch(root.querySelector(".hg-rank-list").textContent, /短剧-all|stale/);
});

test("后续页失败保留已有榜单，重试沿用原游标", async () => {
  let attempts = 0;
  const calls = [];
  const ctx = makeContext({ getRank: async (query) => {
    calls.push(query);
    if (!query.cursor) return rank(query, [item("one")], { cursor: "next", hasMore: true });
    if (++attempts === 1) throw Object.assign(new Error("network"), { code: "TRANSPORT" });
    return rank(query, [item("two")]);
  } });
  await mount(ctx, 1);
  await scrollNearEnd();
  assert.equal(root.querySelectorAll(".hg-rank-item").length, 1);
  assert.equal(attempts, 1);
  await scrollNearEnd();
  await fire(window, "resize");
  assert.equal(attempts, 1, "失败后不能被滚动或尺寸变化反复重试");
  await fire(root.querySelector(".hg-state-error button"));
  assert.equal(calls.at(-1).cursor, "next");
  assert.equal(root.querySelectorAll(".hg-rank-item").length, 2);
});

test("分页标识过期后重试从第一页恢复", async () => {
  const cursors = [];
  const ctx = makeContext({ getRank: async (query) => {
    cursors.push(query.cursor);
    if (query.cursor) throw Object.assign(new Error("cursor expired"), { code: "CURSOR_EXPIRED" });
    return rank(query, [item(cursors.length === 1 ? "before" : "refreshed")], {
      cursor: cursors.length === 1 ? "next" : null, hasMore: cursors.length === 1,
    });
  } });
  await mount(ctx, 1);
  await scrollNearEnd();
  assert.match(root.querySelector(".hg-rank-list").textContent, /短剧-before/);
  await fire(root.querySelector(".hg-state-error button"));
  assert.deepEqual(cursors, [null, "next", null]);
  assert.match(root.querySelector(".hg-rank-list").textContent, /短剧-refreshed/);
  assert.equal(root.querySelector(".hg-state-error"), null);
});

test("切换子榜保留当前内容，从第一页重新加载并沿用新子榜翻页", async () => {
  const calls = [];
  const ctx = makeContext({ getRank: async (query) => {
    calls.push(query);
    return rank(query, [item(`${query.board || "hot"}-${query.cursor || "first"}`)], { cursor: "next", hasMore: !query.cursor });
  } });
  await mount(ctx, 1);
  await scrollNearEnd();
  await chooseOption(root.querySelector('[aria-label="catalog.board"]'), "new");
  assert.deepEqual(calls.at(-1), { content: "all", board: "new", cursor: null });
  assert.equal(root.querySelector('[aria-label="catalog.board"]').value, "new");
  assert.equal(root.querySelectorAll(".hg-rank-item").length, 1);
  assert.doesNotMatch(root.querySelector(".hg-rank-list").textContent, /短剧-hot/);
  await scrollNearEnd();
  assert.deepEqual(calls.at(-1), { content: "all", board: "new", cursor: "next" });
});

test("分类支持组合条件和翻页，切换剧种更新筛选面板并清除旧条件", async () => {
  const calls = [];
  const genres = [];
  const ctx = makeContext({
    getFilterPanel: async (genre) => { genres.push(genre); return { rows: rows(genre) }; },
    filterSeries: async (selections, cursor) => {
      calls.push({ selections: structuredClone(selections), cursor });
      return { items: [item(cursor ? "second" : "first")], cursor: cursor ? null : "next", hasMore: !cursor };
    },
  });
  await mount(ctx, 2);
  await chooseOption(root.querySelector('[data-filter="theme"]'), "choice");
  await chooseOption(root.querySelector('[data-filter="creation_status"]'), "1");
  assert.equal(root.querySelector(".hg-filter-page .hg-list-foot button"), null);
  await scrollNearEnd(".hg-filter-page .hg-scroll");
  assert.deepEqual(calls.at(-1), { selections: { theme: ["choice"], creation_status: ["1"] }, cursor: "next" });
  await chooseOption(root.querySelector('[data-filter="genre"]'), "comic_series");
  assert.equal(genres.at(-1), "comic_series");
  assert.deepEqual(calls.at(-1), { selections: { genre: ["comic_series"] }, cursor: null });
  assert.equal(root.querySelector('[data-filter="theme"]'), null);
  assert.ok(root.querySelector('[data-filter="role"]'));
  assert.equal(root.querySelectorAll(".hg-filter-page .hg-card").length, 1);
  await fire(root.querySelector(".hg-filter-page .hg-page-head .hg-linkbtn"));
  assert.deepEqual(calls.at(-1), { selections: {}, cursor: null });
  assert.ok(root.querySelector('[data-filter="theme"]'));
});

for (const mode of ["rank", "filter"]) {
  test(`${mode === "rank" ? "排行" : "分类"}首屏不足时连续补页，面板扩容继续加载且不重复并发`, async () => {
    const first = deferred();
    const last = deferred();
    const calls = [];
    let scroll;
    const request = async (cursor) => {
      calls.push(cursor);
      if (!cursor) return first.promise;
      if (cursor === "next-1") return { items: [], hasMore: true, cursor: "next-2" };
      if (cursor === "next-2") {
        scrollHeights.set(scroll, 1800);
        return { items: [item("second")], hasMore: true, cursor: "next-3" };
      }
      return last.promise;
    };
    const ctx = makeContext(mode === "rank"
      ? { getRank: async (query) => ({ ...rank(query), ...await request(query.cursor) }) }
      : { filterSeries: async (_, cursor) => request(cursor) });
    const page = mode === "rank" ? ".hg-ranking" : ".hg-filter-page";
    await mount(ctx, mode === "rank" ? 1 : 2);
    scroll = root.querySelector(`${page} .hg-scroll`);
    scrollHeights.set(scroll, 400);
    first.resolve({ items: [item("first")], hasMore: true, cursor: "next-1" });
    await settle();
    assert.deepEqual(calls, [null, "next-1", "next-2"]);
    assert.equal(root.querySelectorAll(`${page} .hg-card-title`).length, 2);
    assert.equal(root.querySelector(`${page} .hg-list-foot button`), null);
    viewportHeight = 1700;
    await fire(window, "resize");
    assert.equal(calls.length, 4);
    assert.ok(root.querySelector(`${page} .hg-list-foot .hg-spinner`));
    await fire(scroll, "scroll");
    await fire(window, "resize");
    assert.equal(calls.length, 4, "加载中不能重复请求同一页");
    last.resolve({ items: [item("last")], hasMore: false });
    await settle();
    assert.match(root.querySelector(`${page} .hg-list-foot`).textContent, /discover.end/);
    await fire(scroll, "scroll");
    assert.equal(calls.length, 4);
  });
}

test("隐藏的榜单完成当前请求后暂停补页，返回时继续触底加载", async () => {
  const pending = deferred();
  const calls = [];
  const ctx = makeContext({ getRank: async (query) => {
    calls.push(query.cursor);
    if (query.cursor === "next") return pending.promise;
    return rank(query, [item(query.cursor || "first")], { hasMore: !query.cursor, cursor: query.cursor ? null : "next" });
  } });
  await mount(ctx, 1);
  await scrollNearEnd();
  await fire(root.querySelectorAll(".hg-discovery-mode")[2]);
  pending.resolve(rank({}, [item("second")], { cursor: "last", hasMore: true }));
  await settle();
  await fire(window, "resize");
  assert.deepEqual(calls, [null, "next"]);
  await fire(root.querySelectorAll(".hg-discovery-mode")[1]);
  assert.deepEqual(calls, [null, "next", "last"]);
  assert.equal(root.querySelectorAll(".hg-rank-item").length, 3);
});

test("分类从详情和其它模式返回时保留筛选、结果节点及滚动位置", async () => {
  let panelCalls = 0;
  let listCalls = 0;
  const ctx = makeContext({
    getFilterPanel: async (genre) => { panelCalls += 1; return { rows: rows(genre) }; },
    filterSeries: async () => { listCalls += 1; return { items: [item("saved")], hasMore: false }; },
  });
  await mount(ctx, 2);
  await chooseOption(root.querySelector('[data-filter="theme"]'), "choice");
  const card = root.querySelector(".hg-filter-page .hg-card");
  const scroll = root.querySelector(".hg-filter-page .hg-scroll");
  scroll.scrollTop = 240;
  await act(() => React.render(h(DiscoveryPage, { ctx, active: false }), root));
  await settle();
  await act(() => React.render(h(DiscoveryPage, { ctx, active: true }), root));
  await settle();
  await fire(root.querySelectorAll(".hg-discovery-mode")[1]);
  await fire(root.querySelectorAll(".hg-discovery-mode")[2]);
  assert.equal(panelCalls, 1);
  assert.equal(listCalls, 2);
  assert.equal(root.querySelector('[data-filter="theme"]').value, "choice");
  assert.equal(root.querySelector(".hg-filter-page .hg-card"), card);
  assert.equal(scroll.scrollTop, 240);
});

test("快速修改筛选时只展示最后一次查询结果", async () => {
  const old = deferred();
  const ctx = makeContext({ filterSeries: async (selections) => {
    if (selections.theme && !selections.creation_status) return old.promise;
    return { items: [item(selections.creation_status ? "new" : "initial")], hasMore: false };
  } });
  await mount(ctx, 2);
  await chooseOption(root.querySelector('[data-filter="theme"]'), "choice");
  await chooseOption(root.querySelector('[data-filter="creation_status"]'), "0");
  old.resolve({ items: [item("stale")], hasMore: false });
  await settle();
  assert.match(root.querySelector(".hg-filter-page .hg-grid").textContent, /短剧-new/);
  assert.doesNotMatch(root.querySelector(".hg-filter-page .hg-grid").textContent, /stale/);
});

test("分类面板失败可重试，结果为空显示空态", async () => {
  let attempts = 0;
  const ctx = makeContext({
    getFilterPanel: async () => {
      if (++attempts === 1) throw new Error("filter panel unavailable");
      return { rows: rows() };
    },
    filterSeries: async () => ({ items: [], hasMore: false }),
  });
  await mount(ctx, 2);
  assert.match(root.querySelector(".hg-filter-page").textContent, /filter panel unavailable/);
  await fire(root.querySelector(".hg-filter-page .hg-state-error button"));
  assert.ok(root.querySelector('[data-filter="theme"]'));
  assert.match(root.querySelector(".hg-filter-page").textContent, /catalog.empty/);
});
