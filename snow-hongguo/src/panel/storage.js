// 面板私有持久化：逐集历史、追剧收藏、播放偏好、最近搜索词。
// 只通过 api.storage.getJson / setJson 读写，不做跨面板同步。
import { normalizePlaybackPrefs } from "./playback-prefs.js";

export const HISTORY_KEY = "history";
export const WATCHLIST_KEY = "watchlist";
export const PREFS_KEY = "prefs";
export const RECENT_SEARCH_KEY = "search.recent";

export const HISTORY_LIMIT = 100;
export const EPISODE_HISTORY_LIMIT = 2000;
export const WATCHLIST_LIMIT = 500;
export const WATCH_STATUSES = ["planned", "watching", "completed"];
export const RECENT_SEARCH_LIMIT = 10;
export const QUALITY_OPTIONS = ["1080p", "720p", "540p", "480p", "360p"];
export const DEFAULT_QUALITY = "720p";
export const DEFAULT_MINI_WINDOW = Object.freeze({
  x: null,
  y: null,
  width: 320,
  height: 540,
  opacity: 0.92,
  autoHide: false,
});

const normalizeNumber = (value, fallback, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

/** 小窗几何在应用时还会按当前视口收敛；这里只过滤存档中的非法值。 */
export const normalizeMiniWindow = (raw) => ({
  x: raw?.x == null || !Number.isFinite(Number(raw.x)) ? null : Math.round(Number(raw.x)),
  y: raw?.y == null || !Number.isFinite(Number(raw.y)) ? null : Math.round(Number(raw.y)),
  width: Math.round(normalizeNumber(raw?.width, DEFAULT_MINI_WINDOW.width, 240, 900)),
  height: Math.round(normalizeNumber(raw?.height, DEFAULT_MINI_WINDOW.height, 360, 1200)),
  opacity: normalizeNumber(raw?.opacity, DEFAULT_MINI_WINDOW.opacity, 0.05, 1),
  autoHide: raw?.autoHide === true,
});

// 同一存储实例的读改写串行执行，避免切集、暂停、删除或滑动设置时后写覆盖先写。
const writes = new WeakMap();
const mutate = (api, task) => {
  const previous = writes.get(api.storage) || Promise.resolve();
  const result = previous.then(task);
  const settled = result.catch(() => {});
  writes.set(api.storage, settled);
  settled.then(() => {
    if (writes.get(api.storage) === settled) writes.delete(api.storage);
  });
  return result;
};
const readStored = async (api, key, fallback) => {
  await writes.get(api.storage);
  return api.storage.getJson(key, fallback);
};
const nonnegative = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;

const normalizeEpisode = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const episodeIndex = nonnegative(raw.episodeIndex);
  const durationMs = nonnegative(raw.durationMs);
  const positionMs = nonnegative(raw.positionMs);
  return {
    episodeId: typeof raw.episodeId === "string" ? raw.episodeId : "",
    episodeIndex,
    episodeNumber: nonnegative(raw.episodeNumber) || episodeIndex + 1,
    positionMs: durationMs ? Math.min(positionMs, durationMs) : positionMs,
    durationMs,
    completed: raw.completed === true,
    updatedAt: nonnegative(raw.updatedAt),
  };
};

const normalizeHistoryEntry = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const seriesId = String(raw.seriesId ?? "").trim();
  if (!seriesId) return null;
  const latest = normalizeEpisode(raw);
  // 旧版仅存最后一集；只迁移该条记录，不能据此把之前所有集标成已看。
  const records = Array.isArray(raw.episodes) ? raw.episodes : [raw];
  const seen = new Set();
  const episodes = records.map(normalizeEpisode).filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((entry) => {
      const key = entry.episodeId ? `id:${entry.episodeId}` : `index:${entry.episodeIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, EPISODE_HISTORY_LIMIT);
  return {
    seriesId,
    title: typeof raw.title === "string" ? raw.title : "",
    cover: typeof raw.cover === "string" && raw.cover ? raw.cover : null,
    ...latest,
    episodes,
  };
};

/** 读历史：过滤坏数据、按 seriesId 去重（保留最新一条）、按 updatedAt 倒序。 */
const normalizeHistory = (raw) => {
  if (!Array.isArray(raw)) return [];
  const normalized = raw
    .map(normalizeHistoryEntry)
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const seen = new Set();
  const list = [];
  for (const entry of normalized) {
    if (seen.has(entry.seriesId)) continue;
    seen.add(entry.seriesId);
    list.push(entry);
  }
  return list.slice(0, HISTORY_LIMIT);
};

export const readHistory = async (api) => normalizeHistory(await readStored(api, HISTORY_KEY, []));

/** 有稳定 ID 时按 ID 找；只有旧版无 ID 的记录才按下标兼容。 */
export const getEpisodeProgress = (entry, episode, index) =>
  entry?.episodes?.find((item) => item.episodeId && item.episodeId === episode?.id) ||
  entry?.episodes?.find((item) => !item.episodeId && item.episodeIndex === index) || null;

export const resumePosition = (record) => {
  if (!record) return 0;
  if (record.completed && record.durationMs > 0 && record.positionMs >= record.durationMs - 1000) return 0;
  return record.positionMs || 0;
};

export const resumeEpisodeIndex = (entry, episodes) => {
  if (!entry) return 0;
  if (entry.episodeId) {
    const index = episodes.findIndex((episode) => episode.id === entry.episodeId);
    return index >= 0 ? index : 0;
  }
  return entry.episodeIndex < episodes.length ? entry.episodeIndex : 0;
};

/**
 * 每剧保留最近观看位置，并按集 ID 合并各集记录。completed 只由播完事件置为 true。
 * episodeIndex 是 /episodes 数组下标（0 基）；第 N 集 = episodeIndex + 1。
 */
export const upsertHistory = (api, input) => mutate(api, async () => {
  const entry = normalizeHistoryEntry({ ...input, updatedAt: Date.now() });
  if (!entry) throw new Error("无效的观看记录");
  const list = normalizeHistory(await api.storage.getJson(HISTORY_KEY, []));
  const previous = list.find((item) => item.seriesId === entry.seriesId);
  const oldRecord = getEpisodeProgress(previous, { id: entry.episodeId }, entry.episodeIndex);
  const record = {
    ...normalizeEpisode(entry),
    durationMs: entry.durationMs || oldRecord?.durationMs || 0,
    completed: entry.completed || oldRecord?.completed || false,
  };
  entry.episodes = [record, ...(previous?.episodes || []).filter((item) => item !== oldRecord)]
    .slice(0, EPISODE_HISTORY_LIMIT);
  Object.assign(entry, record);
  const next = [entry, ...list.filter((item) => item.seriesId !== entry.seriesId)].slice(0, HISTORY_LIMIT);
  await api.storage.setJson(HISTORY_KEY, next);
  return next;
});

export const removeHistory = (api, seriesId) => mutate(api, async () => {
  const list = normalizeHistory(await api.storage.getJson(HISTORY_KEY, []));
  const next = list.filter((item) => item.seriesId !== seriesId);
  await api.storage.setJson(HISTORY_KEY, next);
  return next;
});

export const clearHistory = (api) => mutate(api, async () => {
  await api.storage.setJson(HISTORY_KEY, []);
});

const normalizeWatchlist = (raw) => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw.filter((entry) => entry && typeof entry.seriesId === "string" && entry.seriesId.trim())
    .map((entry) => ({
      seriesId: entry.seriesId.trim(),
      title: typeof entry.title === "string" ? entry.title : "",
      cover: typeof entry.cover === "string" ? entry.cover : null,
      count: nonnegative(entry.count),
      status: WATCH_STATUSES.includes(entry.status) ? entry.status : "planned",
      updatedAt: nonnegative(entry.updatedAt),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((entry) => {
      if (seen.has(entry.seriesId)) return false;
      seen.add(entry.seriesId);
      return true;
    }).slice(0, WATCHLIST_LIMIT);
};

export const readWatchlist = async (api) => normalizeWatchlist(await readStored(api, WATCHLIST_KEY, []));

export const saveWatchlistEntry = (api, input) => mutate(api, async () => {
  const list = normalizeWatchlist(await api.storage.getJson(WATCHLIST_KEY, []));
  const previous = list.find((item) => item.seriesId === input.seriesId);
  if (!previous && list.length >= WATCHLIST_LIMIT) throw new Error(`最多收藏 ${WATCHLIST_LIMIT} 部剧`);
  const entry = normalizeWatchlist([{ ...previous, ...input, updatedAt: Date.now() }])[0];
  if (!entry) throw new Error("无效的收藏记录");
  const next = [entry, ...list.filter((item) => item.seriesId !== entry.seriesId)];
  await api.storage.setJson(WATCHLIST_KEY, next);
  return next;
});

export const removeWatchlistEntry = (api, seriesId) => mutate(api, async () => {
  const list = normalizeWatchlist(await api.storage.getJson(WATCHLIST_KEY, []));
  const next = list.filter((item) => item.seriesId !== seriesId);
  await api.storage.setJson(WATCHLIST_KEY, next);
  return next;
});

/** 只把已收藏的“想看”移入“在看”，不自动收藏或覆盖用户的“已看完”。 */
export const markWatching = (api, seriesId) => mutate(api, async () => {
  const list = normalizeWatchlist(await api.storage.getJson(WATCHLIST_KEY, []));
  const entry = list.find((item) => item.seriesId === seriesId);
  if (!entry || entry.status !== "planned") return false;
  entry.status = "watching";
  entry.updatedAt = Date.now();
  await api.storage.setJson(WATCHLIST_KEY, list);
  return true;
});

export const normalizePrefs = (raw) => ({
  quality: QUALITY_OPTIONS.includes(raw?.quality) ? raw.quality : DEFAULT_QUALITY,
  miniWindow: normalizeMiniWindow(raw?.miniWindow),
  ...normalizePlaybackPrefs(raw),
});

export const readPrefs = async (api) => {
  return normalizePrefs(await readStored(api, PREFS_KEY, null));
};

export const writePrefs = (api, prefs) => mutate(api, async () => {
  const raw = await api.storage.getJson(PREFS_KEY, null);
  const next = normalizePrefs({ ...raw, ...prefs, miniWindow: { ...raw?.miniWindow, ...prefs?.miniWindow } });
  await api.storage.setJson(PREFS_KEY, next);
  return next;
});

export const readRecentSearches = async (api) => {
  const raw = await api.storage.getJson(RECENT_SEARCH_KEY, []);
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const list = [];
  for (const item of raw) {
    const text = typeof item === "string" ? item.trim() : "";
    if (!text || seen.has(text)) continue;
    seen.add(text);
    list.push(text);
    if (list.length >= RECENT_SEARCH_LIMIT) break;
  }
  return list;
};

export const pushRecentSearch = async (api, query) => {
  const text = String(query || "").trim().slice(0, 80);
  if (!text) return readRecentSearches(api);
  const list = await readRecentSearches(api);
  const next = [text, ...list.filter((item) => item !== text)].slice(0, RECENT_SEARCH_LIMIT);
  await api.storage.setJson(RECENT_SEARCH_KEY, next);
  return next;
};

export const clearRecentSearches = async (api) => {
  await api.storage.setJson(RECENT_SEARCH_KEY, []);
};
