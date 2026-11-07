import { HttpError } from "./errors.js";
import { createTtlCache, truncateChars, withSingleFlight } from "./util.js";

const ID = /^[0-9A-Za-z_.-]{1,64}$/;
const clean = (value, max) => truncateChars(value, max).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
const unique = (items, key, max) => {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item[key])) return false;
    seen.add(item[key]);
    return true;
  }).slice(0, max);
};

export function createSearchDiscoveryHandlers({ sdk, toListItem }) {
  const hotCache = createTtlCache({ ttlMs: 5 * 60 * 1000, max: 1 });
  const suggestionCache = createTtlCache({ ttlMs: 60 * 1000, max: 100 });
  const inflight = new Map();
  const cached = (cache, key, task) => cache.get(key) || withSingleFlight(inflight, key, async () => {
    const value = await task();
    cache.set(key, value);
    return value;
  });
  const series = (raw) => unique((Array.isArray(raw) ? raw : []).map((item) => {
    if (!ID.test(String(item?.series_id || "")) || !clean(item?.title, 160)) return null;
    return {
      ...toListItem({ id: item.series_id, title: clean(item.title, 160), cover_url: item.cover_url, episode_count: item.episode_count }),
      position: Number.isInteger(item.position) && item.position > 0 ? item.position : null,
      score: clean(item.search_score || item.heat, 80), tag: clean(item.tag, 24),
    };
  }), "id", 20);
  return {
    hotSearch: async () => ({ status: 200, payload: await cached(hotCache, "hot", async () => {
      const page = await sdk.hotSearch();
      if (!page || typeof page !== "object" || Array.isArray(page)) throw new HttpError(502, "PROTOCOL", "热搜数据格式不正确");
      return {
        guesses: series(page.guesses).slice(0, 8),
        boards: (Array.isArray(page.boards) ? page.boards : []).map((board) => ({
          name: clean(board?.name, 48), items: series(board?.items),
          topics: unique((Array.isArray(board?.topics) ? board.topics : []).map((topic) => {
            const title = clean(topic?.title, 160);
            const query = clean(topic?.query || topic?.title, 80).slice(0, 80);
            return title && query ? { title, query, heat: clean(topic.heat, 80) } : null;
          }), "query", 20),
        })).filter((board) => board.name && (board.items.length || board.topics.length)).slice(0, 6),
      };
    }) }),
    suggest: async ({ query }) => {
      const q = (query.get("q") || "").trim();
      if (q.length > 80 || /[\u0000-\u001f\u007f]/.test(q)) throw new HttpError(400, "INVALID_PARAM", "搜索词格式不正确");
      if (!q) return { status: 200, payload: { items: [] } };
      const payload = await cached(suggestionCache, `suggest:${q}`, async () => {
        const rows = await sdk.suggest(q);
        if (!Array.isArray(rows)) throw new HttpError(502, "PROTOCOL", "联想词格式不正确");
        // SDK 的 keyword 在直达行中是内容 ID；这里只提供文字搜索，不能把 ID 当关键词。
        return { items: unique(rows.map((row) => {
          const text = clean(row?.text, 80).slice(0, 80);
          return text ? { text, query: text } : null;
        }), "query", 6) };
      });
      return { status: 200, payload };
    },
  };
}
