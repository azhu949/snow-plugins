// 榜单和分类的协议适配：只返回作品及筛选元数据，沿用 SDK 的限流调度。
import { HttpError } from "./errors.js";
import { createTtlCache, truncateChars, withSingleFlight } from "./util.js";
import { createPageCursors } from "./cursors.js";

// SDK 的短剧内容频道。演员榜需要独立的人物页，本阶段只提供作品榜。
const SERIES_CONTENTS = new Set(["all", "human", "comic_series_rank", "ai_playlet", "series_album"]);
const ID = /^[0-9A-Za-z_.-]{1,64}$/;
const FILTER_KEY = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
const validFilterKey = (key) => typeof key === "string" && FILTER_KEY.test(key) && !forbiddenKeys.has(key);
const fail = (message) => { throw new HttpError(400, "INVALID_PARAM", message); };

const param = (query, key, max = 64, pattern = null) => {
  const value = query.get(key) || "";
  if (value.length > max || (value && pattern && !pattern.test(value))) fail(`参数 ${key} 格式不正确`);
  return value;
};

const selectionsOf = (query) => {
  const raw = param(query, "selections", 4096);
  if (!raw) return {};
  let input;
  try { input = JSON.parse(raw); } catch { fail("筛选条件不是有效的 JSON"); }
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("筛选条件必须是对象");
  const entries = Object.entries(input);
  if (entries.length > 16) fail("筛选条件过多");
  const result = {};
  for (const [key, values] of entries) {
    if (!validFilterKey(key) || !Array.isArray(values) || values.length > 8) fail("筛选条件格式不正确");
    if (values.some((value) => typeof value !== "string" || value.length > 128 || /[\u0000-\u001f]/.test(value))) {
      fail("筛选值格式不正确");
    }
    // 空值代表该维度不限制；不能把 0 或其它非空的上游默认值丢掉。
    const chosen = [...new Set(values.filter(Boolean))];
    if (chosen.length) result[key] = chosen;
  }
  return result;
};

const namedOptions = (raw) => {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).filter((item) => {
    if (!item || typeof item.id !== "string" || !ID.test(item.id) || typeof item.name !== "string" || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, 32).map((item) => ({ id: item.id, name: truncateChars(item.name, 48), selected: item.selected === true }));
};

const filterRows = (raw) => {
  if (!Array.isArray(raw)) throw new HttpError(502, "PROTOCOL", "筛选面板格式不正确");
  const seen = new Set();
  return raw.filter((row) => {
    if (!row || !validFilterKey(row.key) || seen.has(row.key) || !Array.isArray(row.options)) return false;
    seen.add(row.key);
    return true;
  }).slice(0, 16).map((row) => {
    const values = new Set();
    return {
      key: row.key, name: truncateChars(row.name, 48) || row.key,
      options: row.options.filter((option) => {
        if (!option || typeof option.name !== "string" || typeof option.value !== "string" ||
            option.value.length > 128 || /[\u0000-\u001f]/.test(option.value) || values.has(option.value)) return false;
        values.add(option.value);
        return true;
      }).slice(0, 256).map((option) => ({ name: truncateChars(option.name, 48), value: option.value })),
    };
  }).filter((row) => row.options.length > 0);
};

export function createCatalogHandlers({ sdk, toListItem, fetchPage }) {
  const panels = createTtlCache({ ttlMs: 10 * 60 * 1000, max: 20 });
  const cursors = createPageCursors();
  const inflight = new Map();
  const requireMethod = (name) => {
    if (typeof sdk[name] !== "function") throw new HttpError(503, "CATALOG_UNAVAILABLE", "当前后台不支持榜单或分类，请更新插件");
  };
  const readCursor = (query, kind) => {
    return cursors.read(param(query, "cursor", 4096), kind);
  };
  const pageInfo = cursors.pageInfo;
  const seriesItem = (raw) => {
    const item = toListItem(raw);
    item.title = truncateChars(item.title, 160);
    return item;
  };

  return {
    rank: async ({ query }) => {
      requireMethod("shortRank");
      const content = param(query, "content") || "all";
      if (!SERIES_CONTENTS.has(content)) fail("暂不支持该榜单内容");
      const board = param(query, "board", 64, ID);
      const cursor = readCursor(query, "rank");
      const page = await fetchPage(() => sdk.shortRank({ content, ...(board ? { board } : {}), ...(cursor ? { cursor } : {}) }));
      const rawContents = Array.isArray(page?.contents) ? page.contents : [];
      const contents = namedOptions(rawContents).filter((item) => SERIES_CONTENTS.has(item.id)).map((item) => ({
        ...item, boards: namedOptions(rawContents.find((raw) => raw?.id === item.id)?.boards),
      }));
      const items = (Array.isArray(page?.items) ? page.items : [])
        .filter((item) => item?.series_id != null && ID.test(String(item.series_id)))
        .map((item) => ({
          ...seriesItem({ ...item, id: item.series_id }),
          position: Number.isInteger(item.position) && item.position > 0 ? item.position
            : Number.isInteger(item.rank) && item.rank > 0 ? item.rank : null,
          score: truncateChars(item.score, 80),
          promoted: item.promoted === true,
        }));
      return { status: 200, payload: {
        items, contents, content: SERIES_CONTENTS.has(page?.content) ? page.content : content,
        board: typeof page?.board === "string" && ID.test(page.board) ? page.board : board,
        ...pageInfo(page, "rank"),
      } };
    },

    filterPanel: async ({ query }) => {
      requireMethod("shortFilterPanel");
      const genre = param(query, "genre", 128);
      if (/[\u0000-\u001f]/.test(genre)) fail("剧种格式不正确");
      let rows = panels.get(genre);
      if (!rows) rows = await withSingleFlight(inflight, genre, async () => {
        const result = filterRows(await sdk.shortFilterPanel(genre));
        panels.set(genre, result);
        return result;
      });
      return { status: 200, payload: { rows } };
    },

    filter: async ({ query }) => {
      requireMethod("shortFilter");
      const selections = selectionsOf(query);
      const cursor = readCursor(query, "filter");
      let page;
      try {
        page = await fetchPage(() => sdk.shortFilter({ selections, ...(cursor ? { cursor } : {}) }));
      } catch (error) {
        // openhongguo 0.2.0 将成功但无匹配项的筛选首页表示为 CONTENT_UNAVAILABLE。
        if (cursor || error?.code !== "CONTENT_UNAVAILABLE") throw error;
        page = { items: [], has_more: false };
      }
      const items = (Array.isArray(page?.items) ? page.items : []).map(seriesItem).filter((item) => ID.test(item.id));
      return { status: 200, payload: { items, ...pageInfo(page, "filter") } };
    },
  };
}
