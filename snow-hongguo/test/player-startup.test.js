// 真实 fMP4 分段 + 模拟解码器验证起播编排；不启动宿主或请求上游。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { Remuxer } from "../src/background/media/remux.js";
import { createWebCodecsPlayer } from "../src/panel/player/webcodecs-play.js";
import { createPlayer } from "../src/panel/player/controller.js";
import { installAudio } from "./helpers/audio-env.js";

const head = await readFile(new URL("./fixtures/head.bin", import.meta.url));
const meta = JSON.parse(await readFile(new URL("./fixtures/meta.json", import.meta.url), "utf8"));
const source = Buffer.alloc(meta.totalBytes); head.copy(source);
const mux = new Remuxer(head, "00".repeat(16));
const segments = mux.drain(source, source.length);
const initPayload = { base64: mux.init.toString("base64") };
const info = { ...mux.info(), definition: "360p" };
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
const setup = (t, { deferredVideo = false } = {}) => {
  const previous = new Map();
  const cleanups = [];
  const globals = (values) => { for (const [key, value] of Object.entries(values)) { if (!previous.has(key)) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); } };
  const frames = new Map(); let next = 0, drawn = 0, now = 0, flushes = 0;
  const videos = [];
  const context = { fillRect() {}, drawImage() { drawn++; } };
  class Video {
    constructor(callbacks) { this.callbacks = callbacks; this.state = "unconfigured"; this.decodeQueueSize = 0; this.pending = []; videos.push(this); }
    configure() { this.state = "configured"; this.needsKey = true; }
    decode(chunk) {
      assert.ok(!this.needsKey || chunk.type === "key", "flush 后不能继续提交 delta 帧");
      this.needsKey = false;
      if (deferredVideo) { this.pending.push(chunk); this.decodeQueueSize++; }
      else this.output(chunk);
    }
    output(chunk) { this.callbacks.output({ timestamp: chunk.timestamp, duration: chunk.duration, close() {} }); }
    drain(count = Infinity) { while (this.pending.length && count-- > 0) { this.output(this.pending.shift()); this.decodeQueueSize--; } }
    async flush() { flushes++; this.needsKey = true; }
    close() { this.state = "closed"; }
  }
  class Audio { configure() {} decode() {} async flush() {} close() {} }
  class Chunk { constructor(options) { Object.assign(this, options); } }
  globals({ performance: { now: () => now }, VideoDecoder: Video, AudioDecoder: Audio, EncodedVideoChunk: Chunk, EncodedAudioChunk: Chunk,
    requestAnimationFrame: (callback) => { const id = ++next; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id) });
  t.after(() => {
    for (const cleanup of cleanups.reverse()) cleanup();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  const rpc = { getStreamInfo: async () => info, getStreamInit: async () => initPayload,
    getStreamSegment: async (_id, _quality, seq) => ({ base64: segments[seq - 1].bytes.toString("base64") }) };
  return { context, rpc, globals, videos, cleanup: (fn) => cleanups.push(fn), drawn: () => drawn, flushes: () => flushes,
    advance: (ms) => { now += ms; }, enableAudio: (options) => installAudio(t, globals, () => now, options),
    tick: async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()); await settle(); } };
};

test("切集起播先积累连续音画缓冲，短暂解码预热不会先播放几帧再停", async (t) => {
  const env = setup(t, { deferredVideo: true });
  const audio = env.enableAudio({ deferred: true });
  const player = createWebCodecsPlayer({ canvas: { getContext: () => env.context }, getRpc: () => env.rpc });
  env.cleanup(() => player.destroy());
  await player.load({ episodeId: "warmup", quality: "360p", segmentCount: segments.length, initPayload });
  await settle(); player.play();
  env.videos[0].drain(4);
  audio.decoders[0].drain(20);
  await env.tick();
  assert.equal(player.getState().buffering, true, "几帧画面和约 0.3 秒音频不足以稳定起播");
  assert.equal(audio.sources.length, 0);
  env.advance(500); await env.tick();
  assert.equal(player.getState().timeMs, 0);
  env.videos[0].drain();
  audio.decoders[0].drain();
  await settle(); await env.tick();
  assert.equal(player.getState().buffering, false);
  assert.ok(audio.sources.length > 0);
  for (let i = 0; i < 10; i++) { env.advance(20); await env.tick(); }
  assert.equal(player.getState().buffering, false, "开始后能抵御短暂解码波动");
});

test("动画帧暂停十秒后音频仍连续播放，恢复画面时沿用当前播放位置", async (t) => {
  const env = setup(t), audio = env.enableAudio();
  const player = createWebCodecsPlayer({ canvas: { getContext: () => env.context }, getRpc: () => env.rpc });
  env.cleanup(() => player.destroy());
  await player.load({ episodeId: "background", quality: "360p", segmentCount: segments.length, initPayload });
  await settle(); player.play();
  for (let i = 0; i < 12; i++) await env.tick();
  assert.equal(player.getState().downloadComplete, true);
  assert.equal(player.getState().buffering, false);
  const drawn = env.drawn();
  for (let i = 0; i < 100; i++) {
    env.advance(100); audio.dispatchEnded(); await settle();
    const last = audio.sources.at(-1);
    assert.ok(last.when + last.buffer.duration > audio.contexts[0].currentTime, "无动画帧时声音也不能耗尽");
  }
  assert.equal(env.drawn(), drawn, "后台续排不依赖画面刷新");
  const position = player.getState().timeMs;
  assert.ok(position > 9000 && position < 10000, "进度必须跟随声卡时钟，而不是停在三秒");
  assert.equal(player.getState().phase, "playing");
  for (let i = 0; i < 60; i++) await env.tick();
  assert.equal(player.getState().buffering, false);
  assert.ok(env.drawn() > drawn);
  assert.ok(player.getState().timeMs >= position, "恢复画面不能重播旧位置");
  env.advance(200); await env.tick();
  assert.ok(player.getState().timeMs > position);
  player.destroy();
  const count = audio.sources.length;
  env.advance(5000); audio.dispatchEnded(); await settle();
  assert.equal(audio.sources.length, count, "销毁后的 ended 不能重新续排");
});

test("高倍速切集不会用只能播放一两秒的首段立即起播", async (t) => {
  const env = setup(t), releases = new Map();
  const getSegment = env.rpc.getStreamSegment;
  env.rpc.getStreamSegment = (id, q, seq) => seq === 1 ? getSegment(id, q, seq)
    : new Promise((resolve) => releases.set(seq, () => resolve(getSegment(id, q, seq))));
  const player = createWebCodecsPlayer({ canvas: { getContext: () => env.context }, getRpc: () => env.rpc });
  env.cleanup(() => player.destroy());
  player.setPlaybackRate(3);
  await player.load({ episodeId: "fast", quality: "360p", segmentCount: segments.length, initPayload });
  player.play();
  for (let i = 0; i < 12; i++) await env.tick();
  assert.equal(player.getState().buffering, true);
  assert.equal(player.getState().timeMs, 0);
  for (let seq = 2; seq <= segments.length && player.getState().buffering; seq++) {
    releases.get(seq)(); await settle();
    for (let i = 0; i < 12; i++) await env.tick();
  }
  assert.equal(player.getState().buffering, false);
  assert.ok(player.getState().bufferedEndMs >= 9000);
  assert.equal(player.getState().downloadComplete, false, "无需退回等待整集下载");
});

test("后续分段被阻塞时，首段已经能出画出声；耗尽后冻结音画并在数据到达后恢复", async (t) => {
  const env = setup(t);
  const audio = env.enableAudio();
  const release = new Map();
  const getSegment = env.rpc.getStreamSegment;
  env.rpc.getStreamSegment = (id, q, seq) => seq === 1 ? getSegment(id, q, seq)
    : new Promise((resolve) => release.set(seq, () => resolve(getSegment(id, q, seq))));
  const player = createWebCodecsPlayer({ canvas: { getContext: () => env.context }, getRpc: () => env.rpc });
  env.cleanup(() => player.destroy());
  let loaded = false;
  const loading = player.load({ episodeId: "slow", quality: "360p", segmentCount: segments.length, initPayload, durationMs: info.durationMs }).then(() => { loaded = true; });
  await settle();
  assert.equal(loaded, true, "首段就绪不能等待后续网络请求");
  await loading;
  assert.equal(player.getState().downloadComplete, false);
  assert.equal(player.getState().durationMs, info.durationMs);
  assert.ok(player.getState().bufferedEndMs < info.durationMs);
  const initialEnd = player.getState().bufferedEndMs;
  player.play();
  for (let i = 0; i < 12; i++) await env.tick();
  assert.ok(env.drawn() > 0);
  assert.ok(audio.sources.length > 0, "未下载完整集也必须有声音");
  assert.equal(player.getState().buffering, false);
  assert.equal(env.flushes(), 0, "视频不得在网络分段边界 flush");
  assert.equal(audio.decoders[0].flushes, 0, "音轨也不能提前 flush");
  for (let i = 0; i < 600 && !player.getState().buffering; i++) { env.advance(20); await env.tick(); }
  assert.equal(player.getState().buffering, true);
  const stoppedAt = player.getState().timeMs;
  assert.ok(stoppedAt > 1000 && stoppedAt <= initialEnd + 150);
  env.advance(1000); await env.tick();
  assert.equal(player.getState().timeMs, stoppedAt, "网络缺口期间进度不能前进");
  for (let seq = 2; seq <= segments.length && player.getState().buffering; seq++) {
    release.get(seq)(); await settle();
    for (let i = 0; i < 20; i++) await env.tick();
  }
  assert.equal(player.getState().buffering, false);
  env.advance(100); await env.tick();
  assert.ok(player.getState().timeMs > stoppedAt);
  player.pause();
  assert.ok(audio.sources.every((source) => source.stopped));
});

test("跳到尚未下载的位置会等待，晚到的分段不会覆盖暂停状态或提前判定片尾", async (t) => {
  const env = setup(t);
  const pending = new Map();
  const getSegment = env.rpc.getStreamSegment;
  env.rpc.getStreamSegment = (id, q, seq) => seq === 1 ? getSegment(id, q, seq)
    : new Promise((resolve) => pending.set(seq, () => resolve(getSegment(id, q, seq))));
  const player = createWebCodecsPlayer({ canvas: { getContext: () => env.context }, getRpc: () => env.rpc });
  env.cleanup(() => player.destroy());
  await player.load({ episodeId: "seek", quality: "360p", segmentCount: segments.length, initPayload });
  player.play(); player.seek(90000);
  for (let i = 0; i < 6; i++) { env.advance(50); await env.tick(); }
  assert.equal(player.getState().timeMs, 90000);
  assert.equal(player.getState().buffering, true);
  player.pause();
  for (let seq = 2; seq <= segments.length; seq++) { pending.get(seq)(); await settle(); }
  for (let i = 0; i < 12; i++) await env.tick();
  assert.equal(player.getState().phase, "paused");
  assert.equal(player.getState().timeMs, 90000);
  assert.ok(env.drawn() > 0);
  player.play();
  for (let i = 0; i < 1000 && player.getState().phase !== "ended"; i++) { env.advance(20); await env.tick(); }
  assert.equal(player.getState().phase, "ended");
  assert.ok(env.flushes() > 0, "真正片尾必须排出重排序帧");
});

test("首播后网络失败进入错误态，销毁后晚到响应不再调度或渲染", async (t) => {
  const env = setup(t);
  let rejectTail;
  env.rpc.getStreamSegment = (_id, _q, seq) => seq === 1 ? Promise.resolve({ base64: segments[0].bytes.toString("base64") })
    : seq === 2 ? new Promise((_resolve, reject) => { rejectTail = reject; }) : Promise.reject(Error("late failure"));
  const player = createWebCodecsPlayer({ canvas: { getContext: () => env.context }, getRpc: () => env.rpc });
  env.cleanup(() => player.destroy());
  await player.load({ episodeId: "fail", quality: "360p", segmentCount: segments.length, initPayload });
  player.play(); await env.tick();
  rejectTail(Error("connection lost")); await settle();
  assert.equal(player.getState().phase, "error");
  assert.match(player.getState().error, /connection lost/);
  player.destroy();
  const count = env.drawn(); await env.tick();
  assert.equal(env.drawn(), count);
});

test("首段未返回时销毁会结束载入等待，迟到的首段不会创建声音或追加请求", async (t) => {
  const env = setup(t), audio = env.enableAudio(), pending = [], calls = [];
  env.rpc.getStreamSegment = (_id, _q, seq) => {
    calls.push(seq);
    return new Promise((resolve) => pending.push(() => resolve({ base64: segments[seq - 1].bytes.toString("base64") })));
  };
  const player = createWebCodecsPlayer({ canvas: { getContext: () => env.context }, getRpc: () => env.rpc });
  env.cleanup(() => player.destroy());
  const load = player.load({ episodeId: "cancel", quality: "360p", segmentCount: segments.length, initPayload });
  await settle();
  player.destroy(); await load;
  pending.forEach((resolve) => resolve()); await settle(); await env.tick();
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(player.getState().phase, "disposed");
  assert.equal(audio.sources.length, 0);
  assert.equal(audio.contexts[0].state, "closed");
  assert.equal(env.drawn(), 0);
});

test("增量读取仍能正确解析总时长、续播与首帧，复用已准备的 init", async (t) => {
  const env = setup(t);
  let initCalls = 0;
  env.rpc.getStreamInit = async () => { initCalls++; return initPayload; };
  const player = createWebCodecsPlayer({ canvas: { getContext: () => env.context }, getRpc: () => env.rpc });
  env.cleanup(() => player.destroy());
  player.setPlaybackRate(1.5);
  await player.load({ episodeId: "one", quality: "360p", segmentCount: segments.length, initPayload, resumeMs: 90000 });
  assert.equal(initCalls, 0);
  assert.equal(player.getState().phase, "ready");
  assert.equal(player.getState().timeMs, 90000);
  assert.equal(player.getState().playbackRate, 1.5);
  assert.ok(player.getState().durationMs > 100000);
  for (let i = 0; i < 12; i++) await env.tick();
  assert.ok(env.drawn() > 0);
  player.play(); await env.tick(); player.pause();
  assert.equal(player.getState().phase, "paused");
  player.seek(15000); for (let i = 0; i < 12; i++) await env.tick();
  assert.equal(player.getState().timeMs, 15000);
});

test("播放器取流信息和 init 同时发起，快速换集和关闭后旧请求不创建解码器", async (t) => {
  const env = setup(t);
  const dom = new JSDOM("<div id='slot'></div>", { pretendToBeVisual: true });
  env.globals({ window: dom.window, document: dom.window.document });
  dom.window.HTMLMediaElement.prototype.pause = function () {};
  dom.window.HTMLMediaElement.prototype.load = function () {};
  const pending = [], calls = [];
  const rpc = { ...env.rpc,
    getStreamInfo: (id) => { calls.push(`info:${id}`); return new Promise((resolve) => pending.push(() => resolve(info))); },
    getStreamInit: (id) => { calls.push(`init:${id}`); return new Promise((resolve) => pending.push(() => resolve(initPayload))); },
    getStreamSegment: () => assert.fail("已关闭的播放器不能继续读分段"),
  };
  const player = createPlayer(document.querySelector("#slot"), { rpc, episode: { id: "one" }, quality: "360p" });
  assert.deepEqual(calls, ["info:one", "init:one"]);
  player.update({ episode: { id: "two" } });
  assert.deepEqual(calls, ["info:one", "init:one", "info:two", "init:two"]);
  player.destroy(); pending.forEach((resolve) => resolve()); await settle();
  assert.equal(document.querySelector(".hg-player"), null); dom.window.close();
});

test("真实播放器在片尾发起下一集预取，暂停立即取消且不重写当前集历史", async (t) => {
  const env = setup(t);
  const dom = new JSDOM("<div id='slot'></div>", { pretendToBeVisual: true });
  env.globals({ window: dom.window, document: dom.window.document });
  dom.window.HTMLMediaElement.prototype.pause = function () {};
  dom.window.HTMLMediaElement.prototype.load = function () {};
  dom.window.HTMLCanvasElement.prototype.getContext = () => env.context;
  const prefetched = [], cancelled = [], progress = [];
  const player = createPlayer(document.querySelector("#slot"), { rpc: { ...env.rpc,
    prefetchStream: async (...args) => { prefetched.push(args); return { accepted: true }; },
    cancelPrefetch: async (token) => { cancelled.push(token); },
  }, t: (key) => key, episode: { id: "one" }, episodes: [{ id: "one" }, { id: "two" }], episodeIndex: 0,
    quality: "360p", autoNext: true, positionMs: 90000, onProgress: (value) => progress.push(value) });
  env.cleanup(() => { player.destroy(); dom.window.close(); });
  await settle(); for (let i = 0; i < 12; i++) await env.tick();
  document.dispatchEvent(new dom.window.Event("visibilitychange")); await settle();
  assert.equal(prefetched.length, 1);
  assert.deepEqual(prefetched[0].slice(0, 2), ["two", "360p"]);
  const pause = document.querySelector('[aria-label="player.pause"]'); assert.ok(pause);
  pause.click(); await settle(); assert.deepEqual(cancelled, [prefetched[0][2]]);
  assert.ok(progress.every((entry) => entry.episodeIndex === 0));
});
