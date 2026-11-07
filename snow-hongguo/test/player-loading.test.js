import test from "node:test";
import assert from "node:assert/strict";
import { readSegments } from "../src/panel/player/segments.js";
import { createNextPrefetch } from "../src/panel/player/prefetch.js";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(setImmediate);

test("起播同时读取三段，乱序响应仍按序解析，内存只保留有界窗口", async () => {
  const pending = new Map(), calls = [];
  const rpc = { getStreamSegment: (_id, _quality, seq) => {
    calls.push(seq); const request = deferred(); pending.set(seq, request); return request.promise;
  } };
  const reader = readSegments({ rpc, episodeId: "episode", quality: "720p", count: 5, cancelled: () => false });
  const first = reader.next(); await settle(); assert.deepEqual(calls, [1, 2, 3]);
  pending.get(3).resolve({ base64: "Aw==" }); pending.get(2).resolve({ base64: "Ag==" });
  await settle(); assert.deepEqual(calls, [1, 2, 3]);
  pending.get(1).resolve({ base64: "AQ==" }); assert.equal((await first).value.seq, 1);
  assert.deepEqual([...((await reader.next()).value.bytes)], [2]); await settle(); assert.deepEqual(calls, [1, 2, 3, 4]);
  assert.equal((await reader.next()).value.seq, 3); await settle(); assert.deepEqual(calls, [1, 2, 3, 4, 5]);
  pending.get(5).resolve({ base64: "BQ==" }); pending.get(4).resolve({ base64: "BA==" });
  assert.equal((await reader.next()).value.seq, 4); assert.equal((await reader.next()).value.seq, 5);
  assert.equal((await reader.next()).done, true);
});

test("切集或关闭后停止调度分段，在途失败不产生未处理拒绝", async () => {
  const requests = [], calls = []; let cancelled = false;
  const rpc = { getStreamSegment: (_id, _quality, seq) => { calls.push(seq); const d = deferred(); requests.push(d); return d.promise; } };
  const reader = readSegments({ rpc, episodeId: "one", quality: "720p", count: 8, cancelled: () => cancelled });
  const first = reader.next(); await settle(); cancelled = true;
  requests.forEach((entry) => entry.reject(Error("closed")));
  assert.equal((await first).done, true); await settle(); assert.deepEqual(calls, [1, 2, 3]);
});

test("分段失败不跨过缺口，既有顺序保持且停止排入更多请求", async () => {
  const calls = [];
  const reader = readSegments({ rpc: { getStreamSegment: async (_id, _q, seq) => {
    calls.push(seq); if (seq === 2) throw Error("offline"); return { base64: "AQ==" };
  } }, episodeId: "one", quality: "720p", count: 10, cancelled: () => false });
  assert.equal((await reader.next()).value.seq, 1);
  await assert.rejects(reader.next(), /offline/);
  assert.ok(calls.length <= 4);
});

const playing = (extra = {}) => ({ episodeId: "one", next: { id: "two", playable: true }, quality: "720p", playing: true,
  buffering: false, timeMs: 45000, durationMs: 60000, ...extra });
const coordinator = (overrides = {}) => {
  const calls = [], cancelled = []; let token = 0, clock = 0;
  const rpc = { prefetchStream: async (...args) => { calls.push(args); return { accepted: true }; }, cancelPrefetch: async (id) => { cancelled.push(id); }, ...overrides };
  return { calls, cancelled, advance: (ms) => { clock += ms; }, player: createNextPrefetch({ getRpc: () => rpc, now: () => clock, makeToken: () => `token-${++token}` }) };
};

test("下一集只在片尾稳定播放时加载一次，暂停/缓冲/关闭连播/末集不预取", async () => {
  const { calls, cancelled, player } = coordinator();
  for (const extra of [{ timeMs: 1000 }, { timeMs: 20000 }, { buffering: true }, { playing: false }, { enabled: false }, { next: null }, { next: { id: "two", playable: false } }]) {
    player.update(playing(extra)); await settle();
  }
  assert.equal(calls.length, 0);
  player.update(playing()); player.update(playing()); await settle(); assert.deepEqual(calls, [["two", "720p", "token-1"]]);
  player.update(playing({ playing: false })); await settle(); assert.deepEqual(cancelled, ["token-1"]);
  player.destroy();
});

test("切入已预取的下一集，正式请求接管后才取消租约；换档与销毁停止旧预取", async () => {
  const { calls, cancelled, player } = coordinator();
  player.activate("one", "720p")(); player.update(playing()); await settle();
  const release = player.activate("two", "720p"); await settle(); assert.deepEqual(cancelled, []);
  release(); await settle(); assert.deepEqual(cancelled, ["token-1"]);
  player.update(playing({ episodeId: "two", next: { id: "three" } })); await settle();
  player.activate("two", "480p")(); await settle(); assert.equal(cancelled.length, 2);
  player.update(playing({ episodeId: "two", next: { id: "three" }, quality: "480p" })); await settle();
  player.destroy(); await settle(); assert.equal(cancelled.length, 3); assert.equal(calls.length, 3);
});

test("预取失败静默退回普通播放，并限制自动重试次数", async () => {
  let count = 0;
  const { player, advance } = coordinator({ prefetchStream: async () => { count++; throw Error("offline"); } });
  player.update(playing()); await settle();
  player.update(playing()); await settle(); assert.equal(count, 1);
  advance(5000); player.update(playing()); await settle(); assert.equal(count, 2);
  advance(10000); player.update(playing()); await settle(); assert.equal(count, 2);
  player.destroy();
});
