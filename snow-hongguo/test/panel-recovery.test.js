// 离线验证详情页与播放器的失败恢复；仅替换 WebCodecs 媒体边界，不启动服务或取流。
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import * as React from "preact/compat";
import { act } from "preact/test-utils";

// 使用实际的 DetailPage、PlayerMount 和 controller，避免只验证独立回调而漏掉 props 传递。
const bundle = await build({
  stdin: {
    contents: `
      export { DetailPage } from "./src/panel/pages/detail.js";
      export { bindReact, h } from "./src/panel/ui/runtime.js";
      export { normalizePrefs, readHistory } from "./src/panel/storage.js";
    `,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    sourcefile: "panel-recovery-entry.js",
  },
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2020",
  plugins: [{
    name: "mock-webcodecs",
    setup(builder) {
      builder.onLoad({ filter: /[\\/]player[\\/]webcodecs-play\.js$/ }, (args) => ({
        contents: `
          export { PLAYBACK_RATES } from "../playback-prefs.js";
          export const createWebCodecsPlayer = (options) => globalThis.hongguoTestPlayerFactory(options);
        `,
        resolveDir: dirname(args.path),
        loader: "js",
      }));
    },
  }],
});
const { DetailPage, bindReact, h, normalizePrefs, readHistory } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

let dom;
let root;
let players;
const settle = async () => {
  for (let turn = 0; turn < 6; turn += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
};
const click = async (node) => {
  assert.ok(node, "找不到点击目标");
  await act(() => node.dispatchEvent(new dom.window.Event("click", { bubbles: true })));
  await settle();
};
const directButton = () => [...root.querySelectorAll(".hg-player-action")].find((node) => node.textContent === "player.playDirect");

beforeEach(() => {
  dom = new JSDOM("<!doctype html><body><div id='root'></div></body>", { url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.VideoDecoder = function () {};
  globalThis.AudioDecoder = function () {};
  dom.window.HTMLMediaElement.prototype.pause = function () {};
  dom.window.HTMLMediaElement.prototype.load = function () { this.currentTime = 0; };
  dom.window.HTMLMediaElement.prototype.play = async function () {};
  players = [];
  globalThis.hongguoTestPlayerFactory = ({ onState }) => {
    const state = { phase: "idle", timeMs: 0, durationMs: 0, playbackRate: 1, output: 1 };
    const emit = () => onState({ ...state });
    const unavailable = () => ["idle", "loading", "error", "disposed"].includes(state.phase);
    const player = {
      state, seeks: [],
      getState: () => ({ ...state }),
      setVolume: () => {},
      setPlaybackRate(value) { state.playbackRate = value; return value; },
      async load(options) {
        this.options = options;
        Object.assign(state, { timeMs: options.resumeMs, durationMs: 60000, phase: "ready" });
        emit();
      },
      play() { if (!unavailable()) { state.phase = "playing"; emit(); } },
      pause() { if (!unavailable()) { state.phase = "paused"; emit(); } },
      seek(ms) {
        if (unavailable()) return;
        this.seeks.push(ms);
        state.timeMs = ms;
        if (state.phase !== "playing") state.phase = "paused";
        emit();
      },
      fail() { Object.assign(state, { phase: "error", error: "decoder failed" }); emit(); },
      end() { Object.assign(state, { phase: "ended", timeMs: state.durationMs }); emit(); },
      destroy() { state.phase = "disposed"; },
    };
    players.push(player);
    return player;
  };
  bindReact(React);
  root = document.querySelector("#root");
});

afterEach(async () => {
  await act(() => React.render(null, root));
  await settle();
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.VideoDecoder;
  delete globalThis.AudioDecoder;
  delete globalThis.hongguoTestPlayerFactory;
});

const mount = async () => {
  const data = { history: [{ seriesId: "series", episodeId: "e1", episodeIndex: 0, positionMs: 12000 }] };
  const ctx = {
    api: { storage: {
      async getJson(key, fallback) { return structuredClone(data[key] ?? fallback); },
      async setJson(key, value) { data[key] = structuredClone(value); },
    } },
    prefs: normalizePrefs({ autoNext: false }), t: (key) => key, locale: "zh-CN", watchlistVersion: 0,
    rpc: {
      async getSeries() { return { id: "series", title: "测试剧", count: 2, tags: [] }; },
      async getEpisodes() { return { items: [["e1", 1, 1], ["e2", 2, 1]] }; },
      async getStreamInfo() { return { codec: "hvc1", definition: "720p", durationMs: 60000, segmentCount: 1 }; },
      async getStreamInit() { return { base64: "AA==" }; },
    },
    notify: () => {}, log: () => {}, bumpHistory: () => {}, bumpWatchlist: () => {}, updatePrefs: () => {},
  };
  await act(() => React.render(h(DetailPage, { ctx, seed: { id: "series" }, onBack: () => {} }), root));
  await settle();
  assert.equal(players.length, 1);
  assert.equal(players[0].options.resumeMs, 12000);
  return ctx;
};

const playAt = async (ms) => {
  players.at(-1).state.timeMs = ms;
  players.at(-1).play();
  // WebCodecs progress is sampled by the controller's 500 ms timer.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await settle();
};
const failPlayback = async () => {
  await act(() => players.at(-1).fail());
  await settle();
  assert.equal(root.querySelector(".hg-player-overlay").hidden, false);
  assert.ok(directButton(), "降级界面应提供本机播放重试入口");
};

test("解码失败后直接重试沿用最新进度，进度回写不触发跳播", async () => {
  const ctx = await mount();
  await playAt(30000);
  assert.equal((await readHistory(ctx.api))[0].positionMs, 30000);
  assert.deepEqual(players[0].seeks, [], "正常进度回写不能被误当成主动 seek");
  await failPlayback();
  await click(directButton());
  assert.equal(players.length, 2);
  assert.equal(players[1].options.resumeMs, 30000, "重试不能退回打开页面时的 12 秒");
  assert.equal(players[1].state.phase, "playing");
});

test("失败后继续观看和重选当前集保留恢复入口，仍可重试成功", async () => {
  const ctx = await mount();
  await playAt(30000);
  await failPlayback();
  for (const selector of [".hg-continue", ".hg-ep.is-current"]) {
    await click(root.querySelector(selector));
    assert.equal(root.querySelector(".hg-player-overlay").hidden, false, `${selector} 不应掩盖失败状态`);
    assert.ok(directButton());
    assert.equal((await readHistory(ctx.api))[0].positionMs, 30000);
  }
  await click(directButton());
  assert.equal(players[1].options.resumeMs, 30000);
  assert.equal(players[1].state.phase, "playing");
});

test("正常播完后继续观看仍可从零重播并收起片尾覆盖层", async () => {
  const ctx = await mount();
  await act(() => players[0].end());
  await settle();
  assert.equal((await readHistory(ctx.api))[0].completed, true);
  await click(root.querySelector(".hg-continue"));
  assert.equal(players.length, 1);
  assert.deepEqual(players[0].seeks, [0]);
  assert.equal(players[0].state.phase, "playing");
  assert.equal(root.querySelector(".hg-player-overlay").hidden, true);
});

test("单集解码失败不会禁用下一集的本机解码，旧实例迟到错误不干扰新集", async () => {
  await mount();
  await failPlayback();
  const failed = players[0];
  await click(root.querySelectorAll(".hg-ep")[1]);
  assert.equal(players.length, 2, "下一集必须重新尝试自己的音视频配置");
  assert.equal(players[1].options.episodeId, "e2");
  assert.equal(players[1].state.phase, "playing");
  await act(() => failed.fail());
  await settle();
  assert.equal(players[1].state.phase, "playing");
  assert.equal(root.querySelector(".hg-player-overlay").hidden, true);
});

test("失败集的兼容探测迟到返回时，不覆盖已切换的下一集", async () => {
  const ctx = await mount();
  const readInfo = ctx.rpc.getStreamInfo;
  let release;
  ctx.rpc.getStreamInfo = (id) => id === "e1" ? new Promise((resolve) => { release = () => resolve(readInfo()); }) : readInfo();
  await act(() => players[0].fail());
  await settle();
  assert.ok(release, "旧集的兼容探测仍在等待接口返回");
  await click(root.querySelectorAll(".hg-ep")[1]);
  assert.equal(players.length, 2);
  await act(() => release());
  await settle();
  assert.equal(players[1].state.phase, "playing");
  assert.equal(root.querySelector(".hg-player-overlay").hidden, true);
});
