import test from "node:test";
import assert from "node:assert/strict";
import { createRequestHandler } from "../src/background/server.js";
import { createRpc } from "../src/panel/rpc.js";

const handlerFor = (sdk) => createRequestHandler({ sdk, cache: {} });
const call = (handler, path) => {
  const url = new URL(path, "http://127.0.0.1");
  return handler({ pathname: url.pathname, query: url.searchParams, method: "GET" });
};

test("热搜仅返回剧目与话题字段，去重并缓存合并并发调用", async () => {
  let count = 0;
  const handler = handlerFor({ hotSearch: async () => {
    count++;
    return {
      guesses: [{ series_id: "one", title: "  短剧  ", episode_count: 20, secret: "drop-me" }, { series_id: "one", title: "重复" }, null],
      boards: [{ name: "热搜榜", items: [{ series_id: "two", title: "作品", position: 1, search_score: "2万", tag: "新", contentKey: "secret" }],
        topics: [{ title: " 热门话题 ", query: "话题", heat: "1万" }, { title: "重复", query: "话题" }, { title: "回退标题" }, null] },
      { name: "空榜", items: [] }],
    };
  } });
  const results = await Promise.all([call(handler, "/search/hot"), call(handler, "/search/hot")]);
  assert.deepEqual(results[0], results[1]);
  const data = results[0].payload;
  assert.equal(data.guesses.length, 1);
  assert.equal(data.guesses[0].title, "短剧");
  assert.equal(data.guesses[0].count, 20);
  assert.equal(data.boards.length, 1);
  assert.equal(data.boards[0].items[0].score, "2万");
  assert.deepEqual(data.boards[0].topics, [{ title: "热门话题", query: "话题", heat: "1万" }, { title: "回退标题", query: "回退标题", heat: "" }]);
  assert.doesNotMatch(JSON.stringify(data), /secret|contentKey|drop-me/);
  await call(handler, "/search/hot");
  assert.equal(count, 1);
});

test("联想使用显示文本搜索，不能把 SDK 直达内容 ID 当关键词", async () => {
  let count = 0;
  const handler = handlerFor({ suggest: async (q) => {
    assert.equal(q, "剧 & +"); count++;
    return [{ text: "  剧名  ", keyword: "719000000000001" }, { text: "剧名" }, { text: "a\nb" }, null, ...Array.from({ length: 20 }, (_, i) => ({ text: `结果${i}` }))];
  } });
  const path = `/search/suggest?${new URLSearchParams({ q: " 剧 & + " })}`;
  const [{ payload }] = await Promise.all([call(handler, path), call(handler, path)]);
  assert.equal(payload.items.length, 6);
  assert.deepEqual(payload.items[0], { text: "剧名", query: "剧名" });
  assert.deepEqual(payload.items[1], { text: "a b", query: "a b" });
  await call(handler, path);
  assert.equal(count, 1);
  assert.deepEqual((await call(handler, "/search/suggest")).payload, { items: [] });
  for (const q of ["x".repeat(81), "a\u0000b"]) {
    await assert.rejects(call(handler, `/search/suggest?${new URLSearchParams({ q })}`), { code: "INVALID_PARAM" });
  }
  assert.equal(count, 1);
});

test("热搜和联想的失败不缓存，格式错误仍可重试", async () => {
  let hot = 0, suggest = 0;
  const handler = handlerFor({
    hotSearch: async () => ++hot === 1 ? [] : { guesses: [] },
    suggest: async () => ++suggest === 1 ? {} : [],
  });
  await assert.rejects(call(handler, "/search/hot"), { code: "PROTOCOL" });
  await assert.rejects(call(handler, "/search/suggest?q=test"), { code: "PROTOCOL" });
  assert.deepEqual((await call(handler, "/search/hot")).payload, { guesses: [], boards: [] });
  assert.deepEqual((await call(handler, "/search/suggest?q=test")).payload, { items: [] });
});

test("搜索翻页压缩长游标，重试稳定且不能跨关键词或后台实例使用", async () => {
  const raw = "search:" + "x".repeat(20_000);
  let attempts = 0;
  const handler = handlerFor({ search: async (q, options) => {
    assert.equal(q, "中文 & +");
    if (options.cursor) {
      assert.equal(options.cursor, raw);
      if (++attempts === 1) throw Object.assign(new Error("timeout"), { code: "TRANSPORT" });
    }
    return { items: [], cursor: raw, has_more: true };
  } });
  const q = "中文 & +";
  const { payload } = await call(handler, `/search?${new URLSearchParams({ q })}`);
  assert.ok(payload.cursor.length < 128);
  const path = `/search?${new URLSearchParams({ q, cursor: payload.cursor })}`;
  await assert.rejects(call(handler, path), { code: "TRANSPORT" });
  assert.equal((await call(handler, path)).payload.cursor, payload.cursor);
  await assert.rejects(call(handler, `/search?${new URLSearchParams({ q: "新词", cursor: payload.cursor })}`), { code: "CURSOR_EXPIRED" });
  await assert.rejects(call(handlerFor({}), path), { code: "CURSOR_EXPIRED" });
});

test("搜索发现 RPC 使用本插件通道并正确编码中文、空格与符号", async () => {
  const seen = [];
  const handler = handlerFor({ suggest: async (q) => { seen.push(q); return [{ text: q }]; }, hotSearch: async () => ({ boards: [] }) });
  const rpc = createRpc({ net: { fetch: async (url, options) => {
    assert.equal(options.headers["x-snow-hongguo-channel"], "panel-rpc-v1");
    const path = new URL(url);
    const result = await handler({ pathname: path.pathname, query: path.searchParams, method: options.method });
    return { ok: true, status: result.status, body: JSON.stringify(result.payload) };
  } } });
  assert.deepEqual((await rpc.suggest("中文 & +")).items, [{ text: "中文 & +", query: "中文 & +" }]);
  assert.deepEqual(await rpc.hotSearch(), { guesses: [], boards: [] });
  assert.deepEqual(seen, ["中文 & +"]);
});
