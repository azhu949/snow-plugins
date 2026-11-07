// 离线 DOM 交互测试：宿主 React 由 Preact compat 代替，媒体仅模拟事件，不启动服务或取流。
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as React from "preact/compat";
import { act } from "preact/test-utils";
import { bindReact, h } from "../src/panel/ui/runtime.js";
import { DetailPage } from "../src/panel/pages/detail.js";
import { WatchlistPage } from "../src/panel/pages/watchlist.js";
import { SettingsPage } from "../src/panel/pages/settings.js";
import { createPlayer } from "../src/panel/player/controller.js";
import { normalizePrefs, readHistory, readWatchlist, readPrefs, upsertHistory, writePrefs } from "../src/panel/storage.js";

let dom;
let root;
let cleanup;
const text = (key, values) => `${key}${values ? ` ${Object.values(values).join(" ")}` : ""}`;
const settle = async () => {
  for (let turn = 0; turn < 6; turn += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
};
const fire = async (node, event = "click", value) => {
  assert.ok(node, `找不到 ${event} 的目标`);
  await act(() => {
    if (value !== undefined) node.value = value;
    node.dispatchEvent(new dom.window.Event(event, { bubbles: true }));
  });
  await settle();
};
const chooseOption = async (trigger, value) => {
  await fire(trigger);
  const option = [...document.querySelectorAll(".hg-select-menu [role='option']")].find((node) => node.dataset.value === value);
  assert.ok(option, `找不到下拉选项 ${value}`);
  await fire(option);
};

beforeEach(() => {
  dom = new JSDOM("<!doctype html><body><div id='root'></div></body>", { url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  // jsdom 不实现媒体播放；只模拟宿主媒体节点的接口，不请求任何音视频。
  dom.window.HTMLMediaElement.prototype.pause = function () {};
  dom.window.HTMLMediaElement.prototype.load = function () { this.currentTime = 0; };
  dom.window.HTMLMediaElement.prototype.play = async function () {};
  bindReact(React);
  root = document.querySelector("#root");
  cleanup = null;
});

afterEach(async () => {
  cleanup?.();
  await act(() => React.render(null, root));
  await settle();
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
});

const context = (initial = {}) => {
  const data = structuredClone(initial);
  const notifications = [];
  const ctx = {
    api: { storage: {
      async getJson(key, fallback) { return structuredClone(data[key] ?? fallback); },
      async setJson(key, value) { data[key] = structuredClone(value); },
    } },
    t: text, locale: "zh-CN", prefs: normalizePrefs(initial.prefs), watchlistVersion: 0,
    rpc: {
      async getSeries() { return { id: "series", title: "测试短剧", count: 3, tags: [] }; },
      async getEpisodes() { return { items: [["e1", 1, 1], ["e2", 2, 1], ["e3", 3, 1]] }; },
      async getStreamInfo() { return { codec: "hvc1", segmentCount: 1, durationMs: 60000 }; },
      async health() { return { port: 37191 }; },
    },
    notify: (...args) => notifications.push(args), log: () => {},
    bumpHistory: () => {}, bumpWatchlist: () => { ctx.watchlistVersion += 1; },
    openSeries: () => {}, openTab: () => {},
  };
  ctx.updatePrefs = (patch) => {
    ctx.prefs = { ...ctx.prefs, ...patch };
    void writePrefs(ctx.api, patch);
  };
  return { ctx, data, notifications };
};

const mountDetail = async (ctx, visibleEpisodes = 3) => {
  await act(() => React.render(h(DetailPage, { ctx, seed: { id: "series" }, onBack: () => {} }), root));
  await settle();
  assert.equal(root.querySelectorAll(".hg-ep").length, visibleEpisodes);
  const video = root.querySelector("video");
  assert.ok(video, root.textContent);
  Object.defineProperty(video, "duration", { configurable: true, value: 60 });
  Object.defineProperty(video, "readyState", { configurable: true, value: 4 });
  return video;
};

const mockEpisodeCount = (ctx, count) => {
  const items = Array.from({ length: count }, (_, index) => [`e${index + 1}`, index + 1, 1]);
  ctx.rpc.getSeries = async () => ({ id: "series", title: "测试短剧", count, tags: [] });
  ctx.rpc.getEpisodes = async () => ({ items });
  return items;
};

test("长剧打开定位续播分组，浏览和回到当前集不打断播放，进度刷新不抢回分组", async () => {
  const { ctx } = context({
    history: [{ seriesId: "series", episodeId: "e126", episodeIndex: 125, positionMs: 12000 }],
  });
  mockEpisodeCount(ctx, 307);
  const video = await mountDetail(ctx, 30);
  const groups = root.querySelectorAll(".hg-episode-group");
  assert.equal(groups.length, 11);
  assert.equal(root.querySelector('.hg-episode-group[aria-pressed="true"]').textContent, "121–150");
  assert.equal(root.querySelector(".hg-ep.is-current .hg-ep-num").textContent, "126");
  assert.ok(root.querySelector(".hg-ep.is-current").classList.contains("is-partial"));
  assert.equal(root.querySelectorAll(".hg-ep-num")[0].textContent, "121");
  assert.equal(root.querySelectorAll(".hg-ep-num")[29].textContent, "150");

  // jsdom 没有布局；给区间栏尺寸，核对定位只移动横向区间而不滚动详情。
  const strip = root.querySelector(".hg-episode-groups");
  Object.defineProperty(strip, "clientWidth", { configurable: true, value: 160 });
  groups.forEach((node, index) => {
    Object.defineProperty(node, "offsetLeft", { configurable: true, value: index * 60 + 2 });
    Object.defineProperty(node, "offsetWidth", { configurable: true, value: 58 });
  });
  const pageScroll = root.querySelector(".hg-scroll");
  pageScroll.scrollTop = 300;
  await fire(groups[10]);
  assert.equal(root.querySelectorAll(".hg-ep").length, 7);
  assert.equal(root.querySelector(".hg-ep-num").textContent, "301");
  assert.equal(root.querySelector("#hg-player-slot").dataset.episodeId, "e126");
  assert.equal(strip.scrollLeft, 500);
  assert.equal(pageScroll.scrollTop, 300);

  video.currentTime = 24;
  await fire(video, "seeked");
  assert.equal(root.querySelector('.hg-episode-group[aria-pressed="true"]').textContent, "301–307");
  assert.equal((await readHistory(ctx.api))[0].positionMs, 24000);
  await fire(root.querySelector(".hg-episode-locate"));
  assert.equal(root.querySelector('.hg-episode-group[aria-pressed="true"]').textContent, "121–150");
  assert.equal(root.querySelector(".hg-ep.is-current .hg-ep-num").textContent, "126");
  assert.equal(video.currentTime, 24);
  assert.equal(strip.scrollLeft, 242);
  assert.equal(pageScroll.scrollTop, 300);
  assert.equal((await readHistory(ctx.api))[0].episodeId, "e126");
});

test("末尾分组保留已看、部分观看和禁用状态，切集使用全局下标并恢复各自进度", async () => {
  const { ctx } = context();
  const items = mockEpisodeCount(ctx, 307);
  items[306][2] = 0;
  await upsertHistory(ctx.api, {
    seriesId: "series", episodeId: "e305", episodeIndex: 304,
    positionMs: 60000, durationMs: 60000, completed: true,
  });
  await upsertHistory(ctx.api, {
    seriesId: "series", episodeId: "e306", episodeIndex: 305,
    positionMs: 23000, durationMs: 60000,
  });
  await mountDetail(ctx, 7);
  const episodes = root.querySelectorAll(".hg-ep");
  assert.ok(episodes[4].classList.contains("is-watched"));
  assert.ok(episodes[5].classList.contains("is-partial"));
  assert.ok(episodes[5].classList.contains("is-current"));
  assert.equal(episodes[6].disabled, true);
  await fire(root.querySelectorAll(".hg-episode-group")[0]);
  await fire(root.querySelectorAll(".hg-ep")[29]);
  assert.equal(root.querySelector("#hg-player-slot").dataset.episodeId, "e30");
  await fire(root.querySelectorAll(".hg-episode-group")[10]);
  await fire(root.querySelectorAll(".hg-ep")[5]);
  assert.equal(root.querySelector("#hg-player-slot").dataset.episodeId, "e306");
  const [entry] = await readHistory(ctx.api);
  assert.equal(entry.episodeId, "e306");
  assert.equal(entry.episodeIndex, 305);
  assert.equal(entry.positionMs, 23000);
});

test("自动连播跨过第 30 集时跟随新分组，末尾只有一集时仍能选择", async () => {
  const { ctx } = context({
    history: [{ seriesId: "series", episodeId: "e30", episodeIndex: 29, positionMs: 45000 }],
  });
  mockEpisodeCount(ctx, 31);
  const video = await mountDetail(ctx, 30);
  assert.equal(root.querySelector('.hg-episode-group[aria-pressed="true"]').textContent, "1–30");
  video.currentTime = 60;
  await fire(video, "ended");
  assert.equal(root.querySelector('.hg-episode-group[aria-pressed="true"]').textContent, "31");
  assert.equal(root.querySelectorAll(".hg-ep").length, 1);
  assert.equal(root.querySelector(".hg-ep.is-current .hg-ep-num").textContent, "31");
  const [entry] = await readHistory(ctx.api);
  assert.equal(entry.episodeId, "e31");
  assert.equal(entry.episodes.find((item) => item.episodeId === "e30").completed, true);
});

test("不超过 30 集时直接展示全部，少集数剧不显示区间栏", async () => {
  const { ctx } = context();
  mockEpisodeCount(ctx, 30);
  await mountDetail(ctx, 30);
  assert.equal(root.querySelector(".hg-episode-nav"), null);
  await fire(root.querySelectorAll(".hg-ep")[29]);
  assert.equal(root.querySelector("#hg-player-slot").dataset.episodeId, "e30");
});

test("详情迁移旧进度只标记实际一集，收藏、分集完成和关闭连播可用", async () => {
  const { ctx } = context({
    prefs: { autoNext: false },
    history: [{ seriesId: "series", episodeIndex: 1, positionMs: 12000 }],
  });
  const video = await mountDetail(ctx);
  const episodes = root.querySelectorAll(".hg-ep");
  assert.equal(episodes[0].classList.contains("is-watched"), false);
  assert.equal(episodes[0].classList.contains("is-partial"), false);
  assert.equal(episodes[1].classList.contains("is-partial"), true);
  await fire(root.querySelector(".hg-watch-actions button"));
  assert.equal((await readWatchlist(ctx.api))[0].status, "watching");
  assert.equal(root.querySelector(".hg-watch-actions .hg-watch-status-badge[aria-pressed='true']").dataset.status, "watching");
  await fire(root.querySelector(".hg-watch-actions .hg-watch-status-badge[data-status='completed']"));
  assert.equal((await readWatchlist(ctx.api))[0].status, "completed");
  assert.equal(root.querySelector(".hg-watch-actions .hg-watch-status-badge[aria-pressed='true']").dataset.status, "completed");
  video.currentTime = 60;
  await fire(video, "ended");
  assert.equal(root.querySelector(".hg-ep.is-current .hg-ep-num").textContent, "2");
  assert.equal(root.querySelectorAll(".hg-ep.is-watched").length, 1);
  const [entry] = await readHistory(ctx.api);
  assert.equal(entry.episodeId, "e2");
  assert.equal(entry.completed, true);
  // 继续观看已播完的一集是一次显式重播，即使目标位置为 0 也必须执行。
  await fire(root.querySelector(".hg-continue"));
  assert.equal(video.currentTime, 0);
});

test("切集保存最后几秒，重选分集恢复各自位置，关闭面板补写进度", async () => {
  const { ctx } = context({ prefs: { autoNext: false } });
  const video = await mountDetail(ctx);
  video.currentTime = 7;
  await fire(video, "timeupdate");
  video.currentTime = 11;
  // seeked 强制上报；在详情页节流窗口内也立即保存。
  await fire(video, "seeked");
  await fire(root.querySelectorAll(".hg-ep")[2]);
  assert.equal((await readHistory(ctx.api))[0].episodes.find((item) => item.episodeId === "e1").positionMs, 11000);
  video.currentTime = 23;
  await fire(video, "seeked");
  await fire(root.querySelectorAll(".hg-ep")[0]);
  // 测试运行时没有解码器；详情已把续播目标交给播放器，随后模拟在该处播放。
  assert.equal((await readHistory(ctx.api))[0].positionMs, 11000);
  video.currentTime = 17;
  await act(() => React.render(null, root));
  await settle();
  const [entry] = await readHistory(ctx.api);
  assert.equal(entry.episodeId, "e1");
  assert.equal(entry.positionMs, 17000);
  assert.equal(entry.episodes.find((item) => item.episodeId === "e3").positionMs, 23000);
});

test("自动连播先记录本集完成，再切下一集；不可播放的下一集不会跳转", async () => {
  const { ctx } = context();
  ctx.rpc.getEpisodes = async () => ({ items: [["e1", 1, 1], ["e2", 2, 1], ["e3", 3, 0]] });
  const video = await mountDetail(ctx);
  video.currentTime = 60;
  await fire(video, "ended");
  assert.equal(root.querySelector(".hg-ep.is-current .hg-ep-num").textContent, "2");
  const [entry] = await readHistory(ctx.api);
  assert.equal(entry.episodeId, "e2");
  assert.equal(entry.episodes.find((item) => item.episodeId === "e1").completed, true);
  assert.equal(entry.episodes.find((item) => item.episodeId === "e2").completed, false);
  video.currentTime = 60;
  await fire(video, "ended");
  assert.equal(root.querySelector(".hg-ep.is-current .hg-ep-num").textContent, "2");
  assert.equal(root.querySelectorAll(".hg-ep.is-watched").length, 2);
});

test("追剧页仅展示收藏，支持打开详情、筛选、修改状态和移除收藏", async () => {
  const { ctx } = context({ watchlist: [
    { seriesId: "series", title: "在看剧", status: "watching" },
    { seriesId: "later", title: "待看剧", status: "planned" },
  ] });
  await upsertHistory(ctx.api, { seriesId: "series", title: "在看剧", episodeId: "e2", episodeIndex: 1, positionMs: 12300 });
  await upsertHistory(ctx.api, { seriesId: "history-only", title: "未收藏的历史剧", episodeId: "h1", episodeIndex: 0, positionMs: 8000 });
  let opened = null;
  ctx.openSeries = (seed) => { opened = seed; };
  await act(() => React.render(h(WatchlistPage, { ctx, active: true, historyVersion: 0, watchlistVersion: 0 }), root));
  await settle();
  assert.equal(root.querySelectorAll(".hg-watch-card").length, 2);
  assert.doesNotMatch(root.textContent, /未收藏的历史剧/);
  await fire(root.querySelector(".hg-watch-card .hg-history-main"));
  assert.equal(opened.id, "series");
  await fire(root.querySelectorAll(".hg-watch-filter")[1]);
  assert.equal(root.querySelectorAll(".hg-watch-card").length, 1);
  assert.match(root.querySelector(".hg-watch-card").textContent, /待看剧/);
  assert.equal(root.querySelectorAll(".hg-watch-status-badge").length, 3);
  assert.equal(root.querySelector(".hg-watch-status-badge[aria-pressed='true']").dataset.status, "planned");
  assert.equal(root.querySelector(".hg-watch-card [role='combobox']"), null);
  await fire(root.querySelector(".hg-watch-status-badge[data-status='completed']"));
  assert.equal(root.querySelectorAll(".hg-watch-card").length, 0);
  await fire(root.querySelectorAll(".hg-watch-filter")[3]);
  assert.equal(root.querySelectorAll(".hg-watch-card").length, 1);
  await fire(root.querySelector(".hg-watch-card-actions .hg-linkbtn"));
  assert.equal((await readWatchlist(ctx.api)).length, 1);
  assert.equal((await readHistory(ctx.api)).length, 2);
});

test("小窗进度刷新与收藏修改交错时，保存后仍通知详情页刷新状态", async () => {
  const { ctx } = context({ watchlist: [{ seriesId: "series", title: "测试剧", status: "watching" }] });
  const write = ctx.api.storage.setJson;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  ctx.api.storage.setJson = async (key, value) => {
    if (key === "watchlist") await gate;
    return write(key, value);
  };
  const show = (historyVersion) => React.render(h(WatchlistPage, { ctx, active: true, historyVersion, watchlistVersion: 0 }), root);
  await act(() => show(0));
  await settle();
  await fire(root.querySelector(".hg-watch-status-badge[data-status='watching']"));
  assert.equal(ctx.watchlistVersion, 0, "点击当前徽标不重复保存");
  await fire(root.querySelector(".hg-watch-status-badge[data-status='completed']"));
  assert.ok([...root.querySelectorAll(".hg-watch-status-badge")].every((button) => button.disabled));
  await act(() => show(1));
  release();
  await settle();
  assert.equal(ctx.watchlistVersion, 1);
  assert.equal(root.querySelector(".hg-watch-status-badge[aria-pressed='true']").dataset.status, "completed");
  assert.ok([...root.querySelectorAll(".hg-watch-status-badge")].every((button) => !button.disabled));
});

test("暂停立即保存进度，加载失败或未就绪时的零位置不覆盖续播档案", async () => {
  const { ctx } = context();
  const video = await mountDetail(ctx);
  video.currentTime = 17;
  await fire(video, "pause");
  assert.equal((await readHistory(ctx.api))[0].positionMs, 17000);
  video.currentTime = 0;
  Object.defineProperty(video, "readyState", { configurable: true, value: 0 });
  await fire(video, "pause");
  await act(() => React.render(null, root));
  await settle();
  assert.equal((await readHistory(ctx.api))[0].positionMs, 17000);
});

test("播放器恢复静音和倍速，控件与快捷键保存偏好，重新挂载后沿用", async () => {
  const { ctx } = context({ prefs: { playbackRate: 1.5, volume: 0.35, muted: true } });
  let player;
  const mount = (prefs) => {
    player = createPlayer(root, {
      ...prefs, t: text, episode: null,
      onPlaybackPrefsChange: (patch) => { void writePrefs(ctx.api, patch); },
    });
    cleanup = () => player.destroy();
  };
  mount(ctx.prefs);
  let video = root.querySelector("video");
  assert.equal(video.playbackRate, 1.5);
  assert.equal(video.volume, 0.35);
  assert.equal(video.muted, true);
  await chooseOption(root.querySelector(".hg-player-speed"), "2");
  await fire(root.querySelector(".hg-player-volume"), "input", "0.6");
  root.querySelector(".hg-player").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "m", bubbles: true }));
  await settle();
  const prefs = await readPrefs(ctx.api);
  assert.equal(prefs.playbackRate, 2);
  assert.equal(prefs.volume, 0.6);
  assert.equal(prefs.muted, true);
  player.destroy();
  mount(prefs);
  video = root.querySelector("video");
  assert.equal(video.playbackRate, 2);
  assert.equal(video.volume, 0.6);
  assert.equal(video.muted, true);
  player.update({ playbackRate: 1.25, volume: 0.2, muted: false });
  assert.equal(video.playbackRate, 1.25);
  assert.equal(video.volume, 0.2);
  assert.equal(video.muted, false);
});

test("播放器下拉展开时保持控件可用，Esc 只关闭菜单，小窗移出鼠标不隐藏", async () => {
  const player = createPlayer(root, { t: text, episode: null, miniWindow: { autoHide: true } });
  cleanup = () => player.destroy();
  const view = root.querySelector(".hg-player");
  await fire(view.querySelector('[aria-label="player.fill"]'));
  assert.equal(view.classList.contains("is-fill"), true);
  const speed = view.querySelector(".hg-player-speed");
  await fire(speed);
  assert.ok(document.querySelector(".hg-select-menu"));
  speed.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await settle();
  assert.equal(document.querySelector(".hg-select-menu"), null);
  assert.equal(view.classList.contains("is-fill"), true);
  await fire(view.querySelector('[aria-label="player.exitFill"]'));
  await fire(view.querySelector(".hg-player-mini-toggle"));
  assert.equal(view.classList.contains("is-mini"), true);
  await fire(view.querySelector(".hg-player-quality"));
  await fire(view, "mouseleave");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.ok(document.querySelector(".hg-select-menu"));
  assert.equal(view.classList.contains("is-mini-hidden"), false);
  assert.equal(view.classList.contains("is-idle"), false);
  player.destroy();
  assert.equal(document.querySelector(".hg-select-menu"), null);
});

test("设置页提供连播开关并保存倍速、音量与静音", async () => {
  const { ctx } = context();
  await act(() => React.render(h(SettingsPage, { ctx, active: true }), root));
  await settle();
  await chooseOption(root.querySelector("#hg-playback-rate"), "1.75");
  await fire(root.querySelector("#hg-volume"), "input", "25");
  // compat 将 checkbox 的 onChange 映射到 change。
  const muted = root.querySelector("#hg-muted");
  muted.checked = true;
  await fire(muted, "change");
  const autoNext = root.querySelector("#hg-auto-next");
  autoNext.checked = false;
  await fire(autoNext, "change");
  const prefs = await readPrefs(ctx.api);
  assert.equal(prefs.playbackRate, 1.75);
  assert.equal(prefs.volume, 0.25);
  assert.equal(prefs.muted, true);
  assert.equal(prefs.autoNext, false);
});
