// 存储键、容量与请求上限：跨模块共享的常量。

export const STORE_STATE_KEY = "reader-state";
// 在线书目录按书拆分存储：reader-state 只保留书架元数据与进度，
// 避免每次滚动落盘都序列化整本书架的章节表。
export const STORE_CHAPTERS_PREFIX = "book-chapters:";
export const IDB_NAME = "snow-novel-reader";
export const IDB_STORE = "books";
export const IDB_FALLBACK_PREFIX = "book-text-";
export const WIN_ID = "snow-novel-reader-window";
export const DOT_ID = "snow-novel-reader-dot";
export const SEGMENT_CHARS = 40000;
// 面板 id 必须与 plugin.json 的 panels[0].id 保持一致（pluginsSelf.openPanel 的必填参数）
export const PANEL_ID = "reader";

// 书源列表存储键（插件私有存储）
export const SOURCES_KEY = "book-sources";
// 章节正文缓存的 LRU 上限（按本数 * 章数计，避免无限增长）
export const CHAPTER_CACHE_MAX = 60;
// 单次书源请求的超时与页数上限
export const SOURCE_FETCH_TIMEOUT_MS = 20000;
export const SOURCE_SEARCH_PAGES = 1;
// 多源搜索并发上限，避免一次性打满请求触发站点风控
export const SEARCH_CONCURRENCY = 6;
// 分页目录最多顺延抓取的页数，防止书源 nextTocUrl 规则异常时无限翻页
export const TOC_PAGE_MAX = 30;
