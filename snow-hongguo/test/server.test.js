import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { startServer } from "../src/background/server.js";
import { LIMITS } from "../src/shared/contract.js";

const CHANNEL = { "x-snow-hongguo-channel": "panel-rpc-v1" };

const makeCache = () => {
  const store = new Map();
  return {
    store,
    async readCover(url) {
      return store.get(url) ?? null;
    },
    async writeCover(url, bytes, contentType) {
      store.set(url, { bytes, contentType });
      return { path: "memory", contentType };
    },
    async prune() {
      return { videos: { removed: 0 }, covers: { removed: 0 } };
    },
    async clear() {
      store.clear();
    },
    stats() {
      return { covers: store.size };
    },
  };
};

const makeSdk = (overrides = {}) => ({
  discover: async () => ({ items: [], has_more: false }),
  search: async () => ({ items: [], has_more: false }),
  getSeries: async (id) => ({ id, title: `剧-${id}`, episode_count: 1 }),
  listEpisodes: async () => ({ items: [], has_more: false }),
  resolvePlayback: async () => ({ playback: { protected: false, streams: [] } }),
  runtimeInfo: async () => ({ loaded: true, hasGlobal: true, bytes: 1 }),
  stats: () => ({ ready: false, resets: 0, lastError: null }),
  ...overrides,
});

let nextPort = 38200;
const startTestServer = async (sdk, cache) => {
  const portFirst = nextPort;
  nextPort += 8;
  return startServer({
    sdk,
    cache,
    version: "9.9.9-test",
    log: () => {},
    portFirst,
    portLast: portFirst + 5,
  });
};

const call = async (server, path, { method = "GET", headers = {}, body } = {}) => {
  const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
    method,
    headers: { ...CHANNEL, ...headers },
    body,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, text, json };
};

const rawRequest = (port, path, headers, method = "GET") =>
  new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });

test("/health 返回端口、版本与插件身份", async (t) => {
  const server = await startTestServer(makeSdk(), makeCache());
  t.after(() => server.close());

  const res = await call(server, "/health");

  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.pluginId, "com.snow.hongguo");
  assert.equal(res.json.port, server.port);
  assert.equal(res.json.version, "9.9.9-test");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("通道鉴权：缺请求头、带 Origin、方法不符都被拒绝", async (t) => {
  const server = await startTestServer(makeSdk(), makeCache());
  t.after(() => server.close());

  const missing = await rawRequest(server.port, "/health", {});
  assert.equal(missing.status, 403);
  assert.equal(JSON.parse(missing.body).error.code, "CHANNEL_HEADER_MISSING");

  const origin = await rawRequest(server.port, "/health", { ...CHANNEL, origin: "https://evil.example" });
  assert.equal(origin.status, 403);
  assert.equal(JSON.parse(origin.body).error.code, "ORIGIN_FORBIDDEN");

  const wrongMethod = await rawRequest(server.port, "/health", CHANNEL, "POST");
  assert.equal(wrongMethod.status, 405);
  assert.equal(JSON.parse(wrongMethod.body).error.code, "METHOD_NOT_ALLOWED");

  const notFound = await call(server, "/nope");
  assert.equal(notFound.status, 404);
  assert.equal(notFound.json.error.code, "NOT_FOUND");
});

test("端口被占用时顺延到下一个", async (t) => {
  const base = 38400;
  const blocker = createNetServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(base, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => blocker.close(resolve)));

  const server = await startServer({
    sdk: makeSdk(),
    cache: makeCache(),
    version: "test",
    log: () => {},
    portFirst: base,
    portLast: base + 3,
  });
  t.after(() => server.close());

  assert.equal(server.port, base + 1);
  assert.equal(server.url, `http://127.0.0.1:${base + 1}`);
});

test("/discover 裁剪字段、截断简介并透传游标", async (t) => {
  let seen = null;
  const sdk = makeSdk({
    discover: async (options) => {
      seen = options;
      return {
        items: [
          {
            id: 123,
            title: "装穷提亲",
            description: "简".repeat(400),
            cover_url: "https://p3-reading-sign.fqnovelpic.com/novel-pic/a.jpg",
            episode_count: 80,
            extra: "drop-me",
          },
        ],
        cursor: "c1",
        has_more: true,
      };
    },
  });
  const server = await startTestServer(sdk, makeCache());
  t.after(() => server.close());

  const res = await call(server, "/discover?cursor=abc");

  assert.equal(res.status, 200);
  assert.deepEqual(seen, { cursor: "abc" });
  const item = res.json.items[0];
  assert.deepEqual(Object.keys(item).sort(), ["count", "cover", "description", "id", "title"]);
  assert.equal(item.id, "123");
  assert.equal(item.count, 80);
  assert.equal(Array.from(item.description).length, LIMITS.descriptionChars);
  assert.ok(item.cover.startsWith("/cover?url="));
  assert.equal(res.json.cursor, "c1");
  assert.equal(res.json.hasMore, true);
  assert.equal(res.text.includes("drop-me"), false);
});

test("/search 对缺封面的条目并发补全，单项失败忽略", async (t) => {
  let inFlight = 0;
  let maxInFlight = 0;
  const searchItems = Array.from({ length: 10 }, (_, index) => ({ id: String(100 + index), title: `剧${index}` }));

  const sdk = makeSdk({
    search: async () => ({ items: searchItems, has_more: false }),
    getSeries: async (id) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      if (id === "105") throw Object.assign(new Error("gone"), { code: "CONTENT_UNAVAILABLE" });
      return {
        id,
        title: `剧${id}`,
        description: `简介${id}`,
        cover_url: `https://p3-reading-sign.fqnovelpic.com/${id}.jpg`,
        episode_count: 12,
      };
    },
  });
  const server = await startTestServer(sdk, makeCache());
  t.after(() => server.close());

  const res = await call(server, "/search?q=末世");

  assert.equal(res.status, 200);
  assert.equal(res.json.items.length, 10);
  assert.ok(maxInFlight <= LIMITS.searchEnrichConcurrency);
  assert.ok(maxInFlight > 1);

  const filled = res.json.items.find((item) => item.id === "100");
  assert.ok(filled.cover.startsWith("/cover?url="));
  assert.equal(filled.count, 12);
  assert.equal(filled.description, "简介100");

  const failed = res.json.items.find((item) => item.id === "105");
  assert.equal(failed.cover, null);
  assert.equal(failed.count, null);
});

test("参数校验：缺参数、超长、非法 id 都返回 400", async (t) => {
  const server = await startTestServer(makeSdk(), makeCache());
  t.after(() => server.close());

  const cases = [
    "/search",
    "/series",
    "/episodes",
    "/playback",
    `/search?q=${"x".repeat(81)}`,
    "/series?id=../etc/passwd",
    "/episodes?seriesId=abc%20def",
    "/playback?episodeId=",
  ];
  for (const path of cases) {
    const res = await call(server, path);
    assert.equal(res.status, 400, path);
    assert.equal(res.json.error.code, "INVALID_PARAM", path);
  }
});

test("上游错误映射 429 / 502，END_OF_LIST 视为空列表", async (t) => {
  const rateLimitServer = await startTestServer(
    makeSdk({
      discover: async () => {
        throw Object.assign(new Error("429"), { code: "RATE_LIMITED", retryable: true, retryAfterMs: 800 });
      },
    }),
    makeCache()
  );
  t.after(() => rateLimitServer.close());

  const limited = await call(rateLimitServer, "/discover");
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.json.error, {
    code: "RATE_LIMITED",
    message: "请求太频繁",
    retryable: true,
    retryAfterMs: 800,
  });

  const upstreamServer = await startTestServer(
    makeSdk({
      search: async () => {
        throw Object.assign(new Error("gone"), { code: "CONTENT_UNAVAILABLE" });
      },
    }),
    makeCache()
  );
  t.after(() => upstreamServer.close());

  const upstream = await call(upstreamServer, "/search?q=x");
  assert.equal(upstream.status, 502);
  assert.equal(upstream.json.error.code, "CONTENT_UNAVAILABLE");
  assert.equal(upstream.json.error.message, "内容不可用");

  const emptyServer = await startTestServer(
    makeSdk({
      discover: async () => {
        throw Object.assign(new Error("end"), { code: "END_OF_LIST" });
      },
    }),
    makeCache()
  );
  t.after(() => emptyServer.close());

  const empty = await call(emptyServer, "/discover");
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json, { items: [], cursor: null, hasMore: false });
});

test("/series 返回详情与标签", async (t) => {
  const sdk = makeSdk({
    getSeries: async (id) => ({
      id,
      title: "天灾末世",
      description: "简介".repeat(700),
      cover_url: "https://p3-reading-sign.fqnovelpic.com/novel-pic/a.jpg",
      episode_count: 536,
      category: "末世",
      author: "作者甲",
      rows: [
        { kind: 3, text: "科幻" },
        { kind: 9, text: "求生,囤货" },
        { kind: 33, text: "演员·甲" },
      ],
      status: 0,
      right_text: "更新至536集",
      is_multi_season: false,
      season_index: 1,
      heat: 12345,
      play_count: 67890,
      subtitles: ["更新至536集"],
    }),
  });
  const server = await startTestServer(sdk, makeCache());
  t.after(() => server.close());

  const res = await call(server, "/series?id=123");

  assert.equal(res.status, 200);
  assert.equal(res.json.id, "123");
  assert.equal(Array.from(res.json.description).length, LIMITS.seriesDescriptionChars);
  assert.deepEqual(res.json.tags, ["末世", "科幻", "求生", "囤货"]);
  assert.equal(res.json.count, 536);
  assert.equal(res.json.rightText, "更新至536集");
  assert.equal(res.json.seasonIndex, 1);
  assert.ok(res.json.cover.startsWith("/cover?url="));
});

test("/episodes 使用紧凑数组并守住 64KB", async (t) => {
  const episodes = Array.from({ length: 1500 }, (_, index) => ({
    id: `episode-${index}`,
    number: index + 1,
    playable: index % 2 === 0,
    title: `分集标题 ${index} ${"长".repeat(50)}`,
  }));
  const sdk = makeSdk({ listEpisodes: async () => ({ items: episodes, has_more: false }) });
  const server = await startTestServer(sdk, makeCache());
  t.after(() => server.close());

  const res = await call(server, "/episodes?seriesId=123");

  assert.equal(res.status, 200);
  assert.ok(Buffer.byteLength(res.text, "utf8") <= LIMITS.episodesMaxBytes);
  assert.equal(res.json.count, 1500);
  assert.equal(res.json.omittedTitles, true);
  assert.equal(res.json.truncated, undefined);
  assert.ok(res.json.items.length > 0);
  assert.ok(res.json.items.every((row) => row.length === 3));
  assert.equal(res.json.items[0][0], "episode-0");
  assert.equal(res.json.items[0][2], 1);
});

test("/episodes 超长列表按字节预算截断", async (t) => {
  const episodes = Array.from({ length: 2500 }, (_, index) => ({
    id: `episode-${index}-${"x".repeat(24)}`,
    number: index + 1,
    playable: index % 2 === 0,
    title: `标题 ${index}`,
  }));
  const sdk = makeSdk({ listEpisodes: async () => ({ items: episodes, has_more: false }) });
  const server = await startTestServer(sdk, makeCache());
  t.after(() => server.close());

  const res = await call(server, "/episodes?seriesId=123");

  assert.equal(res.status, 200);
  assert.ok(Buffer.byteLength(res.text, "utf8") <= LIMITS.episodesMaxBytes);
  assert.equal(res.json.truncated, true);
  assert.equal(res.json.total, LIMITS.episodesMaxItems);
  assert.equal(res.json.hasMore, true);
  assert.ok(res.json.items.length > 0);
  assert.ok(res.json.items.length < LIMITS.episodesMaxItems);
  assert.ok(res.json.items.every((row) => row.length === 3));
});

test("/episodes 自动翻页并省略默认标题", async (t) => {
  let calls = 0;
  const sdk = makeSdk({
    listEpisodes: async (_seriesId, options) => {
      calls += 1;
      if (!options?.cursor) {
        return {
          items: [{ id: "e1", number: 1, playable: true, title: "第1集" }],
          has_more: true,
          cursor: "next",
        };
      }
      return { items: [{ id: "e2", number: 2, playable: false, title: "第2集" }], has_more: false, cursor: null };
    },
  });
  const server = await startTestServer(sdk, makeCache());
  t.after(() => server.close());

  const res = await call(server, "/episodes?seriesId=123");

  assert.equal(res.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(res.json.items, [
    ["e1", 1, 1],
    ["e2", 2, 0],
  ]);
  assert.equal(res.json.omittedTitles, undefined);
});

test("/playback 不返回直链、密钥或备用地址", async (t) => {
  const sdk = makeSdk({
    resolvePlayback: async (id) => ({
      playback: {
        episode_id: id,
        protected: true,
        duration_seconds: 95,
        streams: [
          {
            definition: "720p",
            bitrate: 1000,
            codec: "bytevc1",
            url: "https://secret.example/a.mp4",
            backup_url: "https://secret.example/b.mp4",
          },
          { definition: "720p", bitrate: 2000, codec: "bytevc1", url: "https://secret.example/c.mp4" },
          { definition: "1080p", bitrate: 3000, codec: "bytevc1", url: "https://secret.example/d.mp4" },
          { definition: "360p", bitrate: 500, codec: "bytevc1", url: "https://secret.example/e.mp4" },
        ],
      },
      contentKey: { key: "00112233445566778899aabbccddeeff", version: "1" },
    }),
  });
  const server = await startTestServer(sdk, makeCache());
  t.after(() => server.close());

  const res = await call(server, "/playback?episodeId=42");

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.json.qualities.map((item) => item.definition),
    ["1080p", "720p", "360p"]
  );
  assert.equal(res.json.qualities[1].bitrate, 2000);
  assert.equal(res.json.protected, true);
  assert.equal(res.json.durationSeconds, 95);
  assert.equal(res.text.includes("secret.example"), false);
  assert.equal(res.text.includes("00112233445566778899aabbccddeeff"), false);
  assert.equal(res.text.includes("contentKey"), false);
  assert.equal(res.text.includes("backup"), false);
});

test("/cover 命中缓存时直接返回图片字节", async (t) => {
  const cache = makeCache();
  const url = "https://p3-reading-sign.fqnovelpic.com/novel-pic/a.jpg";
  cache.store.set(url, { bytes: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg" });
  const server = await startTestServer(makeSdk(), cache);
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.port}/cover?url=${encodeURIComponent(url)}`, {
    headers: CHANNEL,
  });
  const bytes = Buffer.from(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("x-hongguo-cache"), "hit");
  assert.deepEqual([...bytes], [0xff, 0xd8, 0xff]);
});

test("/cover 拒绝 http、内网地址与非白名单域名", async (t) => {
  const server = await startTestServer(makeSdk(), makeCache());
  t.after(() => server.close());

  const cases = [
    ["http://p3-reading-sign.fqnovelpic.com/a.jpg", 400, "INVALID_URL"],
    ["https://127.0.0.1/a.jpg", 403, "URL_FORBIDDEN"],
    ["https://example.com/a.jpg", 403, "URL_FORBIDDEN"],
  ];
  for (const [url, status, code] of cases) {
    const res = await call(server, `/cover?url=${encodeURIComponent(url)}`);
    assert.equal(res.status, status, url);
    assert.equal(res.json.error.code, code, url);
  }
});

test("/probe/wasm 成功与失败都返回结构化结果，/rpc 兼容旧面板", async (t) => {
  const server = await startTestServer(
    makeSdk({ runtimeInfo: async () => ({ loaded: true, hasGlobal: true, bytes: 6920507 }) }),
    makeCache()
  );
  t.after(() => server.close());

  const wasm = await call(server, "/probe/wasm");
  assert.equal(wasm.status, 200);
  assert.equal(wasm.json.ok, true);
  assert.equal(wasm.json.wasm.bytes, 6920507);

  const rpc = await call(server, "/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "p1", method: "ping" }),
  });
  assert.equal(rpc.status, 200);
  assert.equal(rpc.json.ok, true);
  assert.equal(rpc.json.result.pong, true);
  assert.equal(rpc.json.result.port, server.port);

  const failingServer = await startTestServer(
    makeSdk({
      runtimeInfo: async () => {
        throw new Error("wasm missing");
      },
    }),
    makeCache()
  );
  t.after(() => failingServer.close());

  const failed = await call(failingServer, "/probe/wasm");
  assert.equal(failed.status, 200);
  assert.equal(failed.json.ok, false);
  assert.equal(failed.json.wasm.loaded, false);
});
