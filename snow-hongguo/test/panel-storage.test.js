import test from "node:test";
import assert from "node:assert/strict";
import {
  readHistory, upsertHistory, getEpisodeProgress, resumeEpisodeIndex, resumePosition, removeHistory, clearHistory,
  readWatchlist, saveWatchlistEntry, removeWatchlistEntry, markWatching, readPrefs, writePrefs,
} from "../src/panel/storage.js";

const memory = (initial = {}) => {
  const data = structuredClone(initial);
  return {
    data,
    api: { storage: {
      async getJson(key, fallback) { return structuredClone(data[key] ?? fallback); },
      async setJson(key, value) {
        await new Promise((resolve) => setImmediate(resolve));
        data[key] = structuredClone(value);
      },
    } },
  };
};
const progress = (episodeId, episodeIndex, positionMs, extra = {}) => ({
  seriesId: "series", title: "测试剧", episodeId, episodeIndex, positionMs, durationMs: 60000, ...extra,
});

test("旧版第 20 集历史只迁移已知的一集，补上 ID 后仍保留原位置", async () => {
  const { api, data } = memory({ history: [{ seriesId: "series", episodeIndex: 19, positionMs: 12000 }] });
  const [entry] = await readHistory(api);
  assert.equal(entry.episodes.length, 1);
  assert.equal(getEpisodeProgress(entry, { id: "first" }, 0), null);
  assert.equal(getEpisodeProgress(entry, { id: "twenty" }, 19).completed, false);
  assert.equal(data.history[0].episodes, undefined, "读取不改写旧档案");
  await upsertHistory(api, progress("twenty", 19, 15000));
  const [saved] = await readHistory(api);
  assert.equal(saved.episodes.length, 1);
  assert.equal(saved.episodes[0].episodeId, "twenty");
  assert.equal(resumePosition(saved.episodes[0]), 15000);
});

test("快速并发切集不丢记录，不把跳过的分集标记为已看", async () => {
  const { api } = memory();
  await Promise.all([
    upsertHistory(api, progress("first", 0, 12500)),
    upsertHistory(api, progress("twenty", 19, 60000, { completed: true })),
    upsertHistory(api, progress("second", 1, 5000)),
  ]);
  const [entry] = await readHistory(api);
  assert.equal(entry.episodes.length, 3);
  assert.equal(entry.episodeId, "second");
  assert.equal(getEpisodeProgress(entry, { id: "first" }, 0).positionMs, 12500);
  assert.equal(getEpisodeProgress(entry, { id: "twenty" }, 19).completed, true);
  assert.equal(getEpisodeProgress(entry, { id: "third" }, 2), null);
});

test("稳定集 ID 支持续播与目录重排，不把已删除集的记录套到新集", async () => {
  const { api } = memory();
  await upsertHistory(api, progress("first", 0, 12000));
  const [entry] = await readHistory(api);
  const reordered = [{ id: "new" }, { id: "first" }];
  assert.equal(resumeEpisodeIndex(entry, reordered), 1);
  assert.equal(getEpisodeProgress(entry, reordered[1], 1).positionMs, 12000);
  assert.equal(getEpisodeProgress(entry, reordered[0], 0), null);
});

test("播完保留完成标记，重看一部分仍可从新的位置续播", async () => {
  const { api } = memory();
  await upsertHistory(api, progress("first", 0, 60000, { completed: true }));
  assert.equal(resumePosition((await readHistory(api))[0]), 0);
  await upsertHistory(api, progress("first", 0, 8000));
  const [entry] = await readHistory(api);
  assert.equal(entry.completed, true);
  assert.equal(resumePosition(entry), 8000);
});

test("删除和读取等待在途的保存，打开新页面不会读到关闭前的旧记录", async () => {
  const { api } = memory();
  const writing = upsertHistory(api, progress("first", 0, 31000));
  assert.equal((await readHistory(api))[0].positionMs, 31000);
  await writing;
  await Promise.all([upsertHistory(api, progress("second", 1, 2000)), removeHistory(api, "series")]);
  assert.deepEqual(await readHistory(api), []);
});

test("追剧状态独立于历史，开始观看只自动迁移已收藏的想看", async () => {
  const { api } = memory();
  assert.equal(await markWatching(api, "unknown"), false);
  await saveWatchlistEntry(api, { seriesId: "series", title: "测试剧", status: "planned" });
  await upsertHistory(api, progress("first", 0, 1000));
  assert.equal(await markWatching(api, "series"), true);
  assert.equal((await readWatchlist(api))[0].status, "watching");
  await saveWatchlistEntry(api, { seriesId: "series", status: "completed" });
  assert.equal(await markWatching(api, "series"), false);
  await clearHistory(api);
  assert.equal((await readWatchlist(api))[0].title, "测试剧");
  await upsertHistory(api, progress("first", 0, 2000));
  await removeWatchlistEntry(api, "series");
  assert.deepEqual(await readWatchlist(api), []);
  assert.equal((await readHistory(api))[0].positionMs, 2000);
});

test("收藏并发保存不丢条目，同一剧只保留一个状态", async () => {
  const { api } = memory();
  await Promise.all([
    saveWatchlistEntry(api, { seriesId: "a", title: "甲", status: "planned" }),
    saveWatchlistEntry(api, { seriesId: "b", title: "乙", status: "watching" }),
    saveWatchlistEntry(api, { seriesId: "a", status: "completed" }),
  ]);
  const list = await readWatchlist(api);
  assert.equal(list.length, 2);
  assert.equal(list.find((item) => item.seriesId === "a").status, "completed");
  assert.equal(list.find((item) => item.seriesId === "a").title, "甲");
});

test("旧偏好兼容默认值，分次调整倍速音量不会覆盖清晰度或小窗设置", async () => {
  const { api } = memory({ prefs: { quality: "480p", miniWindow: { opacity: 0.4, x: 123 } } });
  assert.equal((await readPrefs(api)).autoNext, true);
  await Promise.all([
    writePrefs(api, { playbackRate: 1.75 }),
    writePrefs(api, { volume: 0.3, muted: true }),
    writePrefs(api, { autoNext: false }),
    writePrefs(api, { miniWindow: { width: 400 } }),
  ]);
  const prefs = await readPrefs(api);
  assert.equal(prefs.playbackRate, 1.75);
  assert.equal(prefs.volume, 0.3);
  assert.equal(prefs.muted, true);
  assert.equal(prefs.autoNext, false);
  assert.equal(prefs.quality, "480p");
  assert.equal(prefs.miniWindow.opacity, 0.4);
  assert.equal(prefs.miniWindow.x, 123);
  assert.equal(prefs.miniWindow.width, 400);
});

test("损坏的偏好收敛到合法值，一次写入失败不阻塞后续写入", async () => {
  const { api } = memory({ prefs: { playbackRate: 100, volume: "bad", muted: "true", autoNext: null } });
  const prefs = await readPrefs(api);
  assert.equal(prefs.playbackRate, 1);
  assert.equal(prefs.volume, 1);
  assert.equal(prefs.muted, false);
  const write = api.storage.setJson;
  api.storage.setJson = async () => { throw new Error("disk full"); };
  await assert.rejects(writePrefs(api, { volume: 0.2 }), /disk full/);
  api.storage.setJson = write;
  await writePrefs(api, { volume: 0, muted: true });
  assert.equal((await readPrefs(api)).volume, 0);
});
