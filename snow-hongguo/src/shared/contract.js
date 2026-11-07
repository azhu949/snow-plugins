// 面板与后台模块共用的通道契约：端口区间、请求头、路由与各类上限都在这里。
export const PLUGIN_ID = "com.snow.hongguo";

/** 后台 HTTP 服务从 PORT_FIRST 开始逐个试到 PORT_LAST，取第一个能绑定的端口。 */
export const PORT_FIRST = 37191;
export const PORT_LAST = 37200;

/**
 * 自定义请求头：网页跨站请求带不上它，而本服务不应答 CORS 预检，可挡掉网页发起的调用。
 * 只做本机隔离，不是身份认证；同机进程仍可伪造。
 */
export const CHANNEL_HEADER = "x-snow-hongguo-channel";
export const CHANNEL_HEADER_VALUE = "panel-rpc-v1";

export const ROUTES = {
  health: "/health",
  discover: "/discover",
  rank: "/rank",
  filterPanel: "/filter-panel",
  filter: "/filter",
  search: "/search",
  series: "/series",
  episodes: "/episodes",
  playback: "/playback",
  cover: "/cover",
  wasm: "/probe/wasm",
  // 兼容旧面板自检用；新面板不必依赖。
  rpc: "/rpc",
  sdk: "/probe/sdk",
};

export const LIMITS = {
  /** 列表项简介最多保留多少个字符（按 Unicode 码点计）。 */
  descriptionChars: 300,
  seriesDescriptionChars: 1000,
  /** /episodes 响应体的硬上限。 */
  episodesMaxBytes: 64 * 1024,
  /** 分集翻页保护：异常 has_more 不会把请求拖死。 */
  episodesMaxPages: 8,
  episodesMaxItems: 2000,
  /** 封面单张 3 MB（面板 5 MB 上限内，留出 base64 膨胀空间），磁盘保留 300 张。 */
  coverMaxBytes: 3 * 1024 * 1024,
  coverKeep: 300,
  videoKeep: 6,
  /** 综合搜索缺封面时并发补全 getSeries 的上限。 */
  searchEnrichConcurrency: 4,
  /** 同一上游接口两次调用之间的最小间隔。 */
  upstreamMinIntervalMs: 300,
  /** 按 retryAfterMs 退避时的单次等待上限。 */
  upstreamMaxBackoffMs: 2000,
  seriesCacheTtlMs: 5 * 60 * 1000,
  seriesCacheMax: 200,
};
