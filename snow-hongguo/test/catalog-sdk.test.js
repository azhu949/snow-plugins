// 使用安装的 SDK/WASM 和内存 transport 验证真实游标及空结果语义，不联网、不启动服务。
import test from "node:test";
import assert from "node:assert/strict";
import { createClient, memoryProfileStore } from "openhongguo";
import { createRequestHandler } from "../src/background/server.js";
import { createRpc } from "../src/panel/rpc.js";

const offlineClient = (content) => createClient({
  profile: memoryProfileStore(), retryAttempts: 1, deviceResets: 0,
  transport: async (request) => {
    const path = new URL(request.url).pathname;
    let response;
    if (path.includes("device_register")) {
      response = { new_user: 1, device_id_str: "7100000000000001", install_id_str: "7100000000000002" };
    } else if (path.includes("distribution")) {
      response = { code: 0, data: content(JSON.parse(Buffer.from(request.body).toString("utf8"))) };
    } else assert.fail(`非预期的离线请求：${path}`);
    return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(response)) };
  },
});

test("真实 SDK 连续筛选 40 页：增长超过 HTTP 头上限的游标仍能经 RPC 续接", async () => {
  const selections = { genre: ["short_play"], category_dim_theme: ["cate_165"] };
  const seen = [];
  const client = await offlineClient((body) => {
    assert.equal(body.filter_ids, seen.join(","));
    assert.deepEqual(body.select_items.genre, selections.genre);
    assert.deepEqual(body.select_items.category_dim_theme, selections.category_dim_theme);
    const items = Array.from({ length: 18 }, (_, index) => ({
      series_id: String(7100000000000000000n + BigInt(body.offset + index)), title: "离线短剧", episode_cnt: 30,
    }));
    seen.push(...items.map((item) => item.series_id));
    return { has_more: true, next_offset: body.offset + 18, session_id: "offline-session", video_data: items };
  });
  let longestSdkCursor = 0;
  const handle = createRequestHandler({ sdk: {
    shortFilter: async (query) => {
      const page = await client.shortFilter(query);
      longestSdkCursor = Math.max(longestSdkCursor, page.cursor.length);
      return page;
    },
  }, cache: {} });
  const rpc = createRpc({ net: { fetch: async (rawUrl, options) => {
    assert.ok(rawUrl.length < 1024, "长游标不能进入 HTTP 请求地址");
    const url = new URL(rawUrl);
    const result = await handle({ pathname: url.pathname, query: url.searchParams, method: options.method });
    return { ok: true, status: result.status, body: JSON.stringify(result.payload) };
  } } });
  let cursor;
  for (let page = 0; page < 40; page += 1) {
    const result = await rpc.filterSeries(selections, cursor);
    assert.equal(result.items.length, 18);
    assert.equal(result.hasMore, true);
    cursor = result.cursor;
  }
  assert.equal(new Set(seen).size, 720);
  assert.ok(longestSdkCursor > 16 * 1024);
});

test("真实 SDK 的成功空响应被分类接口转成空列表", async () => {
  const sdk = await offlineClient(() => ({ has_more: false, video_data: [] }));
  await assert.rejects(sdk.shortFilter(), { code: "CONTENT_UNAVAILABLE" });
  const handle = createRequestHandler({ sdk, cache: {} });
  assert.deepEqual(await handle({ pathname: "/filter", query: new URLSearchParams(), method: "GET" }), {
    status: 200, payload: { items: [], cursor: null, hasMore: false },
  });
});
