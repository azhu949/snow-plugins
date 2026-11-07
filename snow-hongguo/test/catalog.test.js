import test from "node:test";
import assert from "node:assert/strict";
import { createRequestHandler } from "../src/background/server.js";
import { HttpError } from "../src/background/errors.js";
import { createRpc } from "../src/panel/rpc.js";

const handlerFor = (sdk) => createRequestHandler({ sdk, cache: {} });
const call = (handler, path) => {
  const url = new URL(path, "http://127.0.0.1");
  return handler({ pathname: url.pathname, query: url.searchParams, method: "GET" });
};
const queryUrl = (values) => `/filter?${new URLSearchParams(values)}`;

test("排行榜透传内容、榜单与游标，只返回短剧字段并保留推广标识", async () => {
  let seen;
  const handler = handlerFor({ shortRank: async (query) => {
    seen = query;
    return {
      content: "human", board: "hot", cursor: "next-page", has_more: true,
      contents: [
        null,
        { id: "human", name: "真人剧", selected: true, boards: [{ id: "hot", name: "热播榜", selected: true, secret: 1 }] },
        { id: "actor", name: "演员榜", boards: [] },
        { name: "缺少标识", boards: [] },
      ],
      items: [
        { series_id: "42", title: "甲", position: 1, rank: 9, score: "100万热度", episode_count: 80,
          cover_url: "https://p3-reading-sign.fqnovelpic.com/a.jpg", secret: "drop-me", contentKey: "hidden" },
        { series_id: "43", title: "乙", position: 2, promoted: true, score: "平台推荐" },
        { actor_id: "actor", user_id: "user", actor: "演员", position: 1 },
      ],
    };
  } });
  const response = await call(handler, "/rank?content=human&board=hot&cursor=before");
  const data = response.payload;
  assert.equal(response.status, 200);
  assert.deepEqual(seen, { content: "human", board: "hot", cursor: "before" });
  assert.equal(data.items.length, 2);
  assert.equal(data.items[0].position, 1);
  assert.equal(data.items[0].count, 80);
  assert.ok(data.items[0].cover.startsWith("/cover?url="));
  assert.equal(data.items[1].promoted, true);
  assert.deepEqual(data.contents, [{ id: "human", name: "真人剧", selected: true, boards: [{ id: "hot", name: "热播榜", selected: true }] }]);
  assert.equal(data.hasMore, true);
  assert.doesNotMatch(JSON.stringify(data), /drop-me|contentKey|user_id|secret/);
});

test("分类面板按剧种缓存并合并同时请求，保留空值和数字字符串", async () => {
  let calls = 0;
  const handler = handlerFor({ shortFilterPanel: async (genre) => {
    calls += 1;
    return [
      { key: "genre", name: "剧种", options: [{ name: "不限", value: "" }, { name: "真人", value: "human" }] },
      { key: "creation_status", name: genre || "状态", options: [{ name: "连载", value: "0" }, { name: "完结", value: "1" }, { name: "重复", value: "1" }] },
      { key: "__proto__", name: "bad", options: [{ name: "bad", value: "bad" }] },
      { name: "无效", options: [{ name: "无效", value: "bad" }] },
    ];
  } });
  const [first, second] = await Promise.all([call(handler, "/filter-panel"), call(handler, "/filter-panel")]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.equal(first.payload.rows.length, 2);
  assert.equal(first.payload.rows[0].options[0].value, "");
  assert.deepEqual(first.payload.rows[1].options.map((option) => option.value), ["0", "1"]);
  await call(handler, "/filter-panel");
  assert.equal(calls, 1);
  await call(handler, "/filter-panel?genre=comic_series");
  assert.equal(calls, 2);
});

test("分类失败不缓存，重试可以恢复", async () => {
  let calls = 0;
  const handler = handlerFor({ shortFilterPanel: async () => {
    if (++calls === 1) throw Object.assign(new Error("timeout"), { code: "TRANSPORT" });
    return [];
  } });
  await assert.rejects(call(handler, "/filter-panel"), { code: "TRANSPORT" });
  assert.deepEqual((await call(handler, "/filter-panel")).payload.rows, []);
  assert.equal(calls, 2);
});

test("组合筛选与翻页传递相同条件，移除空值且响应不泄露额外字段", async () => {
  const seen = [];
  const handler = handlerFor({ shortFilter: async (query) => {
    seen.push(query);
    return { items: [{ id: "42", title: "测试剧", description: "简介", token: "secret" }], cursor: "next", has_more: true };
  } });
  const selections = JSON.stringify({ genre: ["human"], category_dim_theme: ["sweet", "sweet"], creation_status: ["0"], sort: [""] });
  const first = await call(handler, queryUrl({ selections }));
  await call(handler, queryUrl({ selections, cursor: "next" }));
  const expected = { genre: ["human"], category_dim_theme: ["sweet"], creation_status: ["0"] };
  assert.deepEqual(seen, [{ selections: expected }, { selections: expected, cursor: "next" }]);
  assert.equal(first.payload.items[0].id, "42");
  assert.equal(first.payload.hasMore, true);
  assert.doesNotMatch(JSON.stringify(first), /secret|token/);
});

test("拒绝无效分类参数和非作品榜，不向上游发起调用", async () => {
  const handler = handlerFor({ shortFilter: () => { throw new Error("不应访问上游"); }, shortRank: () => { throw new Error("不应访问上游"); } });
  const invalid = ["null", "[]", "{", '{"__proto__":["x"]}', '{"constructor":["x"]}', '{"genre":"human"}', '{"genre":[123]}', '{"bad key":["x"]}', JSON.stringify({ genre: ["x".repeat(129)] })];
  for (const selections of invalid) {
    await assert.rejects(call(handler, queryUrl({ selections })), (error) => error instanceof HttpError && error.status === 400);
  }
  await assert.rejects(call(handler, "/rank?content=actor"), { status: 400 });
  await assert.rejects(call(handler, "/rank?board=bad%20board"), { status: 400 });
  await assert.rejects(call(handler, "/rank?cursor=" + "x".repeat(4097)), { status: 400 });
});

test("榜单和分类的 END_OF_LIST 返回正常空页，无游标时停止分页", async () => {
  const end = () => { throw Object.assign(new Error("end"), { code: "END_OF_LIST" }); };
  const handler = handlerFor({ shortRank: end, shortFilter: end });
  for (const path of ["/rank", "/filter"]) {
    const { payload } = await call(handler, path);
    assert.deepEqual(payload.items, []);
    assert.equal(payload.hasMore, false);
  }
  const missingCursor = handlerFor({ shortFilter: async () => ({ items: [], has_more: true }) });
  assert.equal((await call(missingCursor, "/filter")).payload.hasMore, false);
});

for (const [path, method] of [["/rank", "shortRank"], ["/filter", "shortFilter"]]) {
  test(`${path} 使用短标识续接长游标，失败可重试且循环游标保持相同标识`, async () => {
    const longCursor = "s1." + "x".repeat(20_000);
    let attempts = 0;
    const handler = handlerFor({ [method]: async ({ cursor }) => {
      if (cursor) {
        assert.equal(cursor, longCursor);
        if (++attempts === 1) throw Object.assign(new Error("network"), { code: "TRANSPORT" });
      }
      return { items: [], cursor: longCursor, has_more: true };
    } });
    const { payload } = await call(handler, path);
    assert.ok(payload.hasMore);
    assert.ok(payload.cursor.length < 128);
    const next = `${path}?${new URLSearchParams({ cursor: payload.cursor })}`;
    await assert.rejects(call(handler, next), { code: "TRANSPORT" });
    assert.equal((await call(handler, next)).payload.cursor, payload.cursor);
    assert.equal(attempts, 2);

    const restarted = handlerFor({ [method]: () => assert.fail("失效游标不能发给 SDK") });
    await assert.rejects(call(restarted, next), { status: 410, code: "CURSOR_EXPIRED" });
  });
}

test("短游标不能跨排行与分类复用", async () => {
  const handler = handlerFor({
    shortRank: async () => ({ items: [], cursor: "rank-next", has_more: true }),
    shortFilter: () => assert.fail("排行游标不能传给分类 SDK"),
  });
  const { payload } = await call(handler, "/rank");
  await assert.rejects(call(handler, queryUrl({ cursor: payload.cursor })), { code: "CURSOR_EXPIRED" });
});

test("分类仅将首页的 CONTENT_UNAVAILABLE 归一为空页，其它故障仍可见", async () => {
  const unavailable = () => { throw Object.assign(new Error("empty filter"), { code: "CONTENT_UNAVAILABLE" }); };
  const handler = handlerFor({ shortFilter: unavailable, shortRank: unavailable, shortFilterPanel: unavailable });
  assert.deepEqual(await call(handler, "/filter"), {
    status: 200, payload: { items: [], cursor: null, hasMore: false },
  });
  for (const path of ["/filter?cursor=next", "/rank", "/filter-panel"]) {
    await assert.rejects(call(handler, path), { code: "CONTENT_UNAVAILABLE" });
  }
  for (const code of ["TRANSPORT", "RATE_LIMITED", "DEVICE_REJECTED", "PARAM_INVALID"]) {
    const failed = handlerFor({ shortFilter: () => { throw Object.assign(new Error(code), { code }); } });
    await assert.rejects(call(failed, "/filter"), { code });
  }
});

test("面板 RPC 经现有通道传递榜单、分类和中文筛选参数", async () => {
  const calls = [];
  const rpc = createRpc({ net: { async fetch(rawUrl, options) {
    const url = new URL(rawUrl);
    calls.push({ url, options });
    return { ok: true, status: 200, body: JSON.stringify(url.pathname === "/health"
      ? { ok: true, pluginId: "com.snow.hongguo" } : { items: [], hasMore: false }) };
  } } });
  await rpc.getRank({ content: "human", board: "hot", cursor: "a+b/c==" });
  await rpc.getFilterPanel("comic_series");
  await rpc.filterSeries({ category_dim_theme: ["都市"] }, "cursor+/=");
  const catalogCalls = calls.filter(({ url }) => url.pathname !== "/health");
  assert.deepEqual(catalogCalls.map(({ url }) => url.pathname), ["/rank", "/filter-panel", "/filter"]);
  assert.equal(catalogCalls[0].url.searchParams.get("cursor"), "a+b/c==");
  assert.equal(catalogCalls[1].url.searchParams.get("genre"), "comic_series");
  assert.deepEqual(JSON.parse(catalogCalls[2].url.searchParams.get("selections")), { category_dim_theme: ["都市"] });
  for (const { options } of catalogCalls) assert.equal(options.headers["x-snow-hongguo-channel"], "panel-rpc-v1");
});
