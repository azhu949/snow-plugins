import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSdk } from "../src/background/sdk.js";

const page = { items: [{ id: "1", title: "测试剧" }], has_more: false };

test("热搜与输入联想经过 SDK 调度并正确传递参数", async (t) => {
  const calls = [];
  const { sdk } = await makeSdk(t, { clientFactory: async () => fakeClient({
    hotSearch: async () => { calls.push("hot"); return { guesses: [] }; },
    suggest: async (q) => { calls.push(q); return [{ text: q }]; },
  }) });
  assert.deepEqual(await sdk.hotSearch(), { guesses: [] });
  assert.deepEqual(await sdk.suggest("中文 & +"), [{ text: "中文 & +" }]);
  assert.deepEqual(calls, ["hot", "中文 & +"]);
});

const makeError = (code, extra = {}) => Object.assign(new Error(`${code} from upstream`), { code, ...extra });

const fakeClient = (overrides = {}) => ({
  discover: async () => page,
  search: async () => page,
  getSeries: async (id) => ({ id, title: `剧-${id}`, episode_count: 1 }),
  listEpisodes: async () => ({ items: [], has_more: false }),
  resolvePlayback: async (id) => ({ playback: { episode_id: id, protected: false, streams: [] } }),
  resetDevice: async () => {},
  ...overrides,
});

const makeSdk = async (t, options = {}) => {
  const dataDir = await mkdtemp(join(tmpdir(), "hongguo-sdk-"));
  const sdk = createSdk({
    dataDir,
    minIntervalMs: 0,
    sleep: async () => {},
    clientFactory: async () => fakeClient(),
    ...options,
  });
  t.after(async () => {
    sdk.dispose();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { sdk, dataDir };
};

test("客户端懒加载，档案写到 anonymous.json", async (t) => {
  let factoryCalls = 0;
  const { sdk, dataDir } = await makeSdk(t, {
    clientFactory: async ({ profile }) => {
      factoryCalls += 1;
      await profile.save(JSON.stringify({ device: "d1" }));
      return fakeClient();
    },
  });

  assert.equal(factoryCalls, 0);
  assert.equal(sdk.stats().ready, false);

  await sdk.discover({});

  assert.equal(factoryCalls, 1);
  assert.equal(sdk.stats().ready, true);
  assert.equal(sdk.stats().profilePath, join(dataDir, "anonymous.json"));
  const saved = JSON.parse(await readFile(join(dataDir, "anonymous.json"), "utf8"));
  assert.deepEqual(saved, { device: "d1" });
});

test("首次创建失败不缓存失败结果，下次重建客户端", async (t) => {
  let calls = 0;
  const { sdk } = await makeSdk(t, {
    clientFactory: async () => {
      calls += 1;
      if (calls === 1) throw new Error("wasm 加载失败");
      return fakeClient();
    },
  });

  await assert.rejects(() => sdk.discover({}), /wasm 加载失败/);
  const result = await sdk.discover({});

  assert.equal(calls, 2);
  assert.equal(result.items.length, 1);
});

test("DEVICE_REJECTED 时重置设备并重试，最多两次", async (t) => {
  let calls = 0;
  let resets = 0;
  const client = fakeClient({
    discover: async () => {
      calls += 1;
      if (calls <= 2) throw makeError("DEVICE_REJECTED");
      return page;
    },
    resetDevice: async () => {
      resets += 1;
    },
  });
  const { sdk } = await makeSdk(t, { clientFactory: async () => client });

  const result = await sdk.discover({});

  assert.equal(result.items.length, 1);
  assert.equal(calls, 3);
  assert.equal(resets, 2);
  assert.equal(sdk.stats().resets, 2);
});

test("设备恢复达到上限后放弃并抛原始错误", async (t) => {
  let calls = 0;
  let resets = 0;
  const client = fakeClient({
    discover: async () => {
      calls += 1;
      throw makeError("DEVICE_REJECTED");
    },
    resetDevice: async () => {
      resets += 1;
    },
  });
  const { sdk } = await makeSdk(t, { clientFactory: async () => client });

  await assert.rejects(
    () => sdk.discover({}),
    (error) => error.code === "DEVICE_REJECTED"
  );
  assert.equal(calls, 3);
  assert.equal(resets, 2);
});

test("ANONYMOUS_LIMITED 同样触发一次设备重置", async (t) => {
  let calls = 0;
  let resets = 0;
  const client = fakeClient({
    search: async () => {
      calls += 1;
      if (calls === 1) throw makeError("ANONYMOUS_LIMITED");
      return page;
    },
    resetDevice: async () => {
      resets += 1;
    },
  });
  const { sdk } = await makeSdk(t, { clientFactory: async () => client });

  await sdk.search("末世");
  assert.equal(calls, 2);
  assert.equal(resets, 1);
});

test("RATE_LIMITED 按 retryAfterMs 退避一次", async (t) => {
  const waits = [];
  let calls = 0;
  const client = fakeClient({
    discover: async () => {
      calls += 1;
      if (calls === 1) throw makeError("RATE_LIMITED", { retryable: true, retryAfterMs: 1200 });
      return page;
    },
  });
  const { sdk } = await makeSdk(t, {
    clientFactory: async () => client,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });

  await sdk.discover({});
  assert.deepEqual(waits, [1200]);
  assert.equal(calls, 2);
});

test("退避等待封顶在 maxBackoffMs", async (t) => {
  const waits = [];
  let calls = 0;
  const client = fakeClient({
    discover: async () => {
      calls += 1;
      if (calls === 1) throw makeError("RATE_LIMITED", { retryable: true, retryAfterMs: 5000 });
      return page;
    },
  });
  const { sdk } = await makeSdk(t, {
    clientFactory: async () => client,
    maxBackoffMs: 2000,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });

  await sdk.discover({});
  assert.deepEqual(waits, [2000]);
});

test("同一 episodeId 的 resolvePlayback 并发只跑一次", async (t) => {
  let calls = 0;
  const releases = [];
  const client = fakeClient({
    resolvePlayback: () => {
      calls += 1;
      return new Promise((resolve) => {
        releases.push(resolve);
      });
    },
  });
  const { sdk } = await makeSdk(t, { clientFactory: async () => client });

  const first = sdk.resolvePlayback("42");
  const second = sdk.resolvePlayback("42");
  assert.equal(first, second);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);

  releases.shift()({ playback: { episode_id: "42", protected: false, streams: [] } });
  await first;
  await new Promise((resolve) => setImmediate(resolve));

  const third = sdk.resolvePlayback("42");
  assert.notEqual(third, first);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);

  releases.shift()({ playback: { episode_id: "42", protected: false, streams: [] } });
  await third;
});

test("榜单与分类通过统一 SDK 调度并保留筛选参数", async (t) => {
  const calls = [];
  let rankingAttempts = 0;
  const waits = [];
  const { sdk } = await makeSdk(t, {
    sleep: async (ms) => waits.push(ms),
    clientFactory: async () => fakeClient({
      shortRank: async (query) => {
        calls.push(["rank", query]);
        if (++rankingAttempts === 1) throw makeError("RATE_LIMITED", { retryable: true, retryAfterMs: 500 });
        return page;
      },
      shortFilterPanel: async (genre) => { calls.push(["panel", genre]); return []; },
      shortFilter: async (query) => { calls.push(["filter", query]); return page; },
    }),
  });
  await sdk.shortRank({ content: "human", board: "hot", cursor: undefined });
  await sdk.shortFilterPanel("comic_series");
  await sdk.shortFilter({ selections: { genre: ["comic_series"], creation_status: ["1"] }, cursor: "next" });
  assert.deepEqual(waits, [500]);
  assert.deepEqual(calls, [
    ["rank", { content: "human", board: "hot" }], ["rank", { content: "human", board: "hot" }],
    ["panel", "comic_series"], ["filter", { selections: { genre: ["comic_series"], creation_status: ["1"] }, cursor: "next" }],
  ]);
});
