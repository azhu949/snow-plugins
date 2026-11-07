import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as React from "preact/compat";
import { act } from "preact/test-utils";
import { bindReact, h } from "../src/panel/ui/runtime.js";
import { SearchPage } from "../src/panel/pages/search.js";

let dom, root, height;
const t = (key, values) => `${key}${values ? ` ${Object.values(values).join(" ")}` : ""}`;
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(setImmediate); }); };
const delay = async (ms = 330) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await settle(); };
const fire = async (node, type = "click", value, init = {}) => {
  assert.ok(node, type);
  await act(() => {
    if (value !== undefined) node.value = value;
    const Ctor = type === "keydown" ? dom.window.KeyboardEvent : dom.window.Event;
    node.dispatchEvent(new Ctor(type, { bubbles: true, ...init }));
  });
  await settle();
};
const input = () => root.querySelector("input");
const type = (value) => fire(input(), "input", value);
const key = (value, init) => fire(input(), "keydown", undefined, { key: value, ...init });
const item = (id) => ({ id, title: `短剧-${id}` });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const context = (rpc = {}) => {
  const store = new Map();
  return { t, openSeries() {}, api: { storage: { async getJson(key, fallback) { return store.get(key) ?? fallback; }, async setJson(key, value) { store.set(key, value); } } },
    rpc: { search: async () => ({ items: [], hasMore: false }), suggest: async () => ({ items: [] }), hotSearch: async () => ({ guesses: [], boards: [] }), ...rpc } };
};
const mount = async (ctx, active = true) => { await act(() => React.render(h(SearchPage, { ctx, active }), root)); await settle(); };
const nearEnd = async () => { const node = root.querySelector(".hg-scroll"); node.scrollTop = 2000; await fire(node, "scroll"); };
beforeEach(() => {
  dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true, url: "http://localhost/" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  height = 2400;
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    clientHeight: { configurable: true, get() { return this.classList.contains("hg-scroll") ? 600 : 0; } },
    scrollHeight: { configurable: true, get() { return this.classList.contains("hg-scroll") ? height : 0; } },
  });
  bindReact(React); root = document.querySelector("#root");
});
afterEach(async () => {
  await act(() => React.render(null, root)); await settle(); dom.window.close();
  delete globalThis.window; delete globalThis.document;
});

test("热搜按需加载，返回保留榜单，剧目打开详情、话题执行文字搜索", async () => {
  let calls = 0, opened = "";
  const searches = [];
  const ctx = context({ hotSearch: async () => { calls++; return { guesses: [item("guess")], boards: [{ name: "热搜榜", items: [item("hot")], topics: [{ title: "话题", query: "关键词" }] }] }; },
    search: async (q) => { searches.push(q); return { items: [item(q)] }; } });
  ctx.openSeries = (series) => { opened = series.id; };
  await mount(ctx, false); assert.equal(calls, 0);
  await mount(ctx); assert.equal(calls, 1);
  await fire(root.querySelector(".hg-hot-row")); assert.equal(opened, "hot");
  await fire(root.querySelector(".hg-hot-topic")); assert.deepEqual(searches, ["关键词"]);
  await fire(root.querySelector(".hg-searchbar button")); assert.equal(calls, 1);
  await mount(ctx, false); await mount(ctx); assert.equal(calls, 1);
});

test("中文输入中不搜索、不联想，确认输入后防抖且回车不重复请求", async () => {
  const queries = [], suggestions = [];
  const ctx = context({ search: async (q) => { queries.push(q); return { items: [] }; }, suggest: async (q) => { suggestions.push(q); return { items: [] }; } });
  await mount(ctx); await act(() => input().focus());
  await fire(input(), "compositionstart"); await type("zhong"); await key("Enter", { isComposing: true });
  await delay(); assert.deepEqual(queries, []); assert.deepEqual(suggestions, []);
  await fire(input(), "compositionend", "中文"); await delay();
  assert.deepEqual(queries, ["中文"]); assert.deepEqual(suggestions, ["中文"]);
  await type("新词"); await key("Enter"); await delay();
  assert.deepEqual(queries, ["中文", "新词"]);
});

test("快速换词立即作废旧搜索和联想，清空后迟到数据不覆盖首页", async () => {
  const old = deferred(), suggestion = deferred();
  const ctx = context({ search: async () => old.promise, suggest: async () => suggestion.promise });
  await mount(ctx); await act(() => input().focus()); await type("旧词"); await delay();
  await type("新词"); old.resolve({ items: [item("old")] }); suggestion.resolve({ items: [{ text: "旧联想", query: "旧联想" }] });
  await settle(); assert.equal(root.querySelector(".hg-result"), null); assert.equal(root.querySelector(".hg-suggestion"), null);
  await type(""); await delay(); assert.ok(root.querySelector(".hg-recent")); assert.equal(root.querySelector(".hg-result"), null);
});

test("联想支持键盘选择和 Esc，接口失败不影响普通搜索", async () => {
  const queries = [];
  const ctx = context({ search: async (q) => { queries.push(q); return { items: [] }; }, suggest: async (q) => {
    if (q === "失败") throw Error("offline"); return { items: [{ text: "推荐甲", query: "推荐甲" }, { text: "推荐乙", query: "推荐乙" }] };
  } });
  await mount(ctx); await act(() => input().focus()); await type("推荐"); await delay(220);
  assert.equal(input().getAttribute("aria-expanded"), "true");
  await key("ArrowUp"); assert.equal(root.querySelector('[aria-selected="true"]').textContent, "推荐乙");
  await key("Enter"); assert.deepEqual(queries, ["推荐乙"]); assert.equal(root.querySelector(".hg-suggestions"), null);
  await type("下一词"); await delay(220); await key("Escape"); assert.equal(input().value, "下一词"); await key("Escape"); assert.equal(input().value, "");
  await type("失败"); await delay(); assert.equal(queries.at(-1), "失败"); assert.equal(root.querySelector(".hg-suggestions"), null);
});

test("搜索触底翻页保持关键词，重试保留列表与游标，循环游标停止", async () => {
  const calls = []; let failed = false;
  const ctx = context({ search: async (q, cursor) => {
    calls.push([q, cursor]);
    if (cursor && !failed) { failed = true; throw Error("network"); }
    return { items: cursor ? [item("one"), item("two")] : [item("one")], cursor: "next", hasMore: true };
  } });
  await mount(ctx); await type("关键词"); await key("Enter"); await nearEnd();
  assert.equal(root.querySelectorAll(".hg-result").length, 1);
  await nearEnd(); assert.equal(calls.length, 2);
  await fire([...root.querySelectorAll("button")].find((node) => node.textContent.includes("action.retry")));
  assert.deepEqual(calls, [["关键词", null], ["关键词", "next"], ["关键词", "next"]]);
  assert.equal(root.querySelectorAll(".hg-result").length, 2); await nearEnd(); assert.equal(calls.length, 3);
  assert.equal(root.querySelector(".hg-loadmore"), null);
});

test("首屏不足自动补页，隐藏时不请求；过期游标重试第一页", async () => {
  const calls = [];
  const pending = deferred();
  const ctx = context({ search: async (q, cursor) => {
    calls.push(cursor);
    if (cursor) throw Object.assign(Error("expired"), { code: "CURSOR_EXPIRED" });
    if (calls.length === 1) return pending.promise;
    return { items: [item("fresh")], hasMore: false };
  } });
  await mount(ctx); await type("词"); await key("Enter"); await mount(ctx, false);
  height = 300; pending.resolve({ items: [item("old")], cursor: "next", hasMore: true }); await settle(); assert.equal(calls.length, 1);
  await mount(ctx); assert.deepEqual(calls, [null, "next"]);
  await fire([...root.querySelectorAll("button")].find((node) => node.textContent.includes("action.retry")));
  assert.deepEqual(calls, [null, "next", null]); assert.match(root.querySelector(".hg-result").textContent, /fresh/);
});
