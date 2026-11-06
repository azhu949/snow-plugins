// 面板私有持久化：观看历史、播放偏好、最近搜索词。
// 只通过 api.storage.getJson / setJson 读写，不做跨面板同步。
export const HISTORY_KEY = "history";
export const PREFS_KEY = "prefs";
export const RECENT_SEARCH_KEY = "search.recent";

export const HISTORY_LIMIT = 100;
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

const normalizeHistoryEntry = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const seriesId = String(raw.seriesId ?? "").trim();
  if (!seriesId) return null;
  const episodeIndex = Number.isFinite(Number(raw.episodeIndex)) && Number(raw.episodeIndex) >= 0
    ? Math.floor(Number(raw.episodeIndex))
    : 0;
  const positionMs = Number.isFinite(Number(raw.positionMs)) && Number(raw.positionMs) > 0
    ? Math.floor(Number(raw.positionMs))
    : 0;
  const updatedAt = Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0;
  return {
    seriesId,
    title: typeof raw.title === "string" ? raw.title : "",
    cover: typeof raw.cover === "string" && raw.cover ? raw.cover : null,
    episodeIndex,
    positionMs,
    updatedAt,
  };
};

/** 读历史：过滤坏数据、按 seriesId 去重（保留最新一条）、按 updatedAt 倒序。 */
export const readHistory = async (api) => {
  const raw = await api.storage.getJson(HISTORY_KEY, []);
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
  return list;
};

/**
 * 写入一条观看记录：同一剧集只保留一条，更新时间并置顶。
 * episodeIndex 是 /episodes 数组下标（0 基）；第 N 集 = episodeIndex + 1。
 */
export const upsertHistory = async (api, input) => {
  const entry = normalizeHistoryEntry({ ...input, updatedAt: Date.now() });
  if (!entry) throw new Error("无效的观看记录");
  const list = await readHistory(api);
  const next = [entry, ...list.filter((item) => item.seriesId !== entry.seriesId)].slice(0, HISTORY_LIMIT);
  await api.storage.setJson(HISTORY_KEY, next);
  return next;
};

export const removeHistory = async (api, seriesId) => {
  const list = await readHistory(api);
  const next = list.filter((item) => item.seriesId !== seriesId);
  await api.storage.setJson(HISTORY_KEY, next);
  return next;
};

export const clearHistory = async (api) => {
  await api.storage.setJson(HISTORY_KEY, []);
};

export const readPrefs = async (api) => {
  const raw = await api.storage.getJson(PREFS_KEY, null);
  const quality = raw && QUALITY_OPTIONS.includes(raw.quality) ? raw.quality : DEFAULT_QUALITY;
  const miniWindow = normalizeMiniWindow(raw?.miniWindow);
  return { quality, miniWindow };
};

export const writePrefs = async (api, prefs) => {
  const quality = prefs && QUALITY_OPTIONS.includes(prefs.quality) ? prefs.quality : DEFAULT_QUALITY;
  const miniWindow = normalizeMiniWindow(prefs?.miniWindow);
  await api.storage.setJson(PREFS_KEY, { quality, miniWindow });
  return { quality, miniWindow };
};

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
