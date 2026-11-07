// 真实 fMP4 分段 + 模拟解码器验证起播编排；不启动宿主或请求上游。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { Remuxer } from "../src/background/media/remux.js";
import { createWebCodecsPlayer } from "../src/panel/player/webcodecs-play.js";
import { createPlayer } from "../src/panel/player/controller.js";

const head = await readFile(new URL("./fixtures/head.bin", import.meta.url));
const meta = JSON.parse(await readFile(new URL("./fixtures/meta.json", import.meta.url), "utf8"));
const source = Buffer.alloc(meta.totalBytes); head.copy(source);
const mux = new Remuxer(head, "00".repeat(16));
const segments = mux.drain(source, source.length);
const initPayload = { base64: mux.init.toString("base64") };
const info = { ...mux.info(), definition: "360p" };
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
const setup = (t) => {
  const previous = new Map();
  const cleanups = [];
  const globals = (values) => { for (const [key, value] of Object.entries(values)) { previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); } };
  const frames = new Map(); let next = 0, drawn = 0;
  const context = { fillRect() {}, drawImage() { drawn++; } };
  class Video {
    constructor(callbacks) { this.callbacks = callbacks; this.state = "unconfigured"; this.decodeQueueSize = 0; }
    configure() { this.state = "configured"; }
    decode(chunk) { this.callbacks.output({ timestamp: chunk.timestamp, duration: chunk.duration, close() {} }); }
    async flush() {}
    close() { this.state = "closed"; }
  }
  class Audio { configure() {} decode() {} async flush() {} close() {} }
  class Chunk { constructor(options) { Object.assign(this, options); } }
  globals({ VideoDecoder: Video, AudioDecoder: Audio, EncodedVideoChunk: Chunk, EncodedAudioChunk: Chunk,
    requestAnimationFrame: (callback) => { const id = ++next; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id) });
  t.after(() => {
    for (const cleanup of cleanups.reverse()) cleanup();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  const rpc = { getStreamInfo: async () => info, getStreamInit: async () => initPayload,
    getStreamSegment: async (_id, _quality, seq) => ({ base64: segments[seq - 1].bytes.toString("base64") }) };
  return { context, rpc, globals, cleanup: (fn) => cleanups.push(fn), drawn: () => drawn,
    tick: async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()); await settle(); } };
};

test("整集并发读取仍能正确解析时长、续播与首帧，复用已准备的 init", async (t) => {
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
