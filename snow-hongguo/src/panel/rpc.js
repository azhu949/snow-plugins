// 面板到本机后台的 RPC 通道。
// 约定：
// - 端口不落盘、不读 storage，每次冷启动并行扫描 37191-37200 并用 /health 的 pluginId 校验身份；
// - 所有请求都带 x-snow-hongguo-channel 头，经 api.net.fetch（主进程网络栈）发出；
// - 错误统一归一成 PanelError：code 供界面分支，message 直接展示；
// - 后台重启换了端口时，遇到连接类错误清空缓存并重新发现一次。
import {
  CHANNEL_HEADER,
  CHANNEL_HEADER_VALUE,
  PLUGIN_ID,
  PORT_FIRST,
  PORT_LAST,
} from "../shared/contract.js";

export const PANEL_ROUTES = {
  health: "/health",
  discover: "/discover",
  rank: "/rank",
  filterPanel: "/filter-panel",
  filter: "/filter",
  search: "/search",
  suggest: "/search/suggest",
  hotSearch: "/search/hot",
  series: "/series",
  episodes: "/episodes",
  playback: "/playback",
  cover: "/cover",
  clearCache: "/cache/clear",
  streamInfo: "/stream/info",
  streamInit: "/stream/init",
  streamSegment: "/stream/segment",
  streamPrefetch: "/stream/prefetch",
  streamPrefetchCancel: "/stream/prefetch/cancel",
  h264Info: "/h264/info",
  h264Start: "/h264/start",
  h264Chunk: "/h264/chunk",
};

const TIMEOUTS = {
  health: 3000,
  probe: 2000,
  list: 25000,
  search: 35000,
  detail: 25000,
  episodes: 35000,
  cover: 20000,
  action: 20000,
  media: 120000,
};

export class PanelError extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = "PanelError";
    this.code = String(code || "UNKNOWN");
    this.status = Number.isFinite(options.status) ? options.status : 0;
    this.retryable = options.retryable === true;
    this.retryAfterMs = Number.isFinite(options.retryAfterMs) ? options.retryAfterMs : null;
    this.cause = options.cause;
  }
}

const isConnectionError = (text) =>
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EPIPE|connection refused|connection reset|failed to fetch|net::ERR|socket hang up|fetch failed|不可用/i.test(
    text
  );

const isTimeoutError = (text) => /timeout|timed out|ETIMEDOUT|请求超时/i.test(text);

const toPanelError = (payload, status, fallbackMessage) => {
  const detail = payload && typeof payload === "object" ? payload.error : null;
  let code = typeof detail?.code === "string" && detail.code ? detail.code : "";
  if (!code) {
    if (status === 404) code = "NOT_FOUND";
    else if (status === 429) code = "RATE_LIMITED";
    else code = "HTTP_ERROR";
  }
  const message =
    (typeof detail?.message === "string" && detail.message) ||
    fallbackMessage ||
    `HTTP ${status || 0}`;
  return new PanelError(code, message, {
    status,
    retryable: detail?.retryable === true,
    // 兼容 SDK 原始字段与后台信封里的 camelCase 写法。
    retryAfterMs: Number.isFinite(detail?.retryAfterMs)
      ? detail.retryAfterMs
      : Number.isFinite(detail?.retry_after_ms)
        ? detail.retry_after_ms
        : null,
  });
};

const headerValue = (headers, name) => {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const target = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return String(headers[key] ?? "");
  }
  return "";
};

const base64ToBytes = (value) => {
  const binary = atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const buildQuery = (query) => {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
};

/**
 * 创建面板侧 RPC 客户端。
 * @param {object} api 宿主注入的面板 API
 * @param {{ log?: (...args: unknown[]) => void }} [options]
 */
export function createRpc(api, { log = () => {} } = {}) {
  let port = 0;
  let health = null;
  let discovering = null;
  let lastScanError = null;

  const requestJson = async (targetPort, pathname, options = {}) => {
    if (!api?.net || typeof api.net.fetch !== "function") {
      throw new PanelError("NET_UNAVAILABLE", "api.net.fetch 不可用（请在 plugin.json 声明 network 隐私域）");
    }
    const method = options.method || "GET";
    const queryText = buildQuery(options.query);
    const url = `http://127.0.0.1:${targetPort}${pathname}${queryText}`;
    let response;
    try {
      response = await api.net.fetch(url, {
        method,
        headers: {
          [CHANNEL_HEADER]: CHANNEL_HEADER_VALUE,
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        responseType: "text",
        timeoutMs: options.timeoutMs ?? TIMEOUTS.list,
      });
    } catch (error) {
      const text = String(error?.message || error);
      throw new PanelError(isConnectionError(text) ? "BACKGROUND_UNAVAILABLE" : "TRANSPORT", text, {
        cause: error,
      });
    }

    const failure = String(response?.error || "");
    if (!response || response.error) {
      if (isConnectionError(failure)) {
        throw new PanelError("BACKGROUND_UNAVAILABLE", failure, { status: response?.status ?? 0 });
      }
      if (isTimeoutError(failure)) {
        throw new PanelError("TIMEOUT", failure, { status: response?.status ?? 0, retryable: true });
      }
      throw new PanelError("TRANSPORT", failure || "网络请求失败", { status: response?.status ?? 0 });
    }

    let payload = null;
    const text = typeof response.body === "string" ? response.body : "";
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new PanelError("PROTOCOL", `后台响应不是 JSON：${error?.message ?? error}`, {
          status: response.status ?? 0,
        });
      }
    }

    const status = Number.isFinite(response.status) ? response.status : 0;
    if (response.ok !== true || (payload && payload.error)) {
      throw toPanelError(payload, status, response.statusText);
    }
    return payload;
  };

  const probePort = async (candidate) => {
    try {
      const data = await requestJson(candidate, PANEL_ROUTES.health, {
        timeoutMs: TIMEOUTS.probe,
      });
      if (data?.ok === true && data?.pluginId === PLUGIN_ID) return { port: candidate, health: data };
      return null;
    } catch (error) {
      if (error?.code !== "BACKGROUND_UNAVAILABLE" && error?.code !== "TRANSPORT") {
        lastScanError = error?.message || lastScanError;
      }
      return null;
    }
  };

  const scanPorts = async () => {
    const candidates = [];
    for (let candidate = PORT_FIRST; candidate <= PORT_LAST; candidate += 1) candidates.push(candidate);
    const results = await Promise.all(candidates.map((candidate) => probePort(candidate)));
    return results.find(Boolean) || null;
  };

  const reset = () => {
    port = 0;
    health = null;
  };

  const ensureReady = async () => {
    if (port && health) return health;
    if (!discovering) {
      discovering = (async () => {
        lastScanError = null;
        const found = await scanPorts();
        if (!found) {
          throw new PanelError(
            "BACKGROUND_UNAVAILABLE",
            lastScanError || `已在 127.0.0.1:${PORT_FIRST}-${PORT_LAST} 扫描，未发现本插件后台服务`
          );
        }
        port = found.port;
        health = found.health;
        log(`[rpc] background ready on 127.0.0.1:${port}`);
        return health;
      })().finally(() => {
        discovering = null;
      });
    }
    return discovering;
  };

  const call = async (pathname, options = {}, retried = false) => {
    // ensureReady() 成功时返回的是 health 快照，端口在闭包变量 port 上。
    await ensureReady();
    const targetPort = port;
    try {
      return await requestJson(targetPort, pathname, options);
    } catch (error) {
      // 后台重启后端口可能变化：清掉缓存，重新发现一次再试。
      if (error?.code === "BACKGROUND_UNAVAILABLE" && !retried) {
        reset();
        return call(pathname, options, true);
      }
      if (error?.code === "BACKGROUND_UNAVAILABLE") reset();
      throw error;
    }
  };

  const fetchCover = async (coverPath) => {
    if (typeof coverPath !== "string" || !coverPath.startsWith("/cover?")) {
      throw new PanelError("INVALID_PARAM", "封面路径不合法");
    }
    if (!api?.net || typeof api.net.fetch !== "function") {
      throw new PanelError("NET_UNAVAILABLE", "api.net.fetch 不可用");
    }
    await ensureReady();
    const targetPort = port;
    const url = `http://127.0.0.1:${targetPort}${coverPath}`;
    let response;
    try {
      response = await api.net.fetch(url, {
        method: "GET",
        headers: { [CHANNEL_HEADER]: CHANNEL_HEADER_VALUE },
        responseType: "arraybuffer",
        timeoutMs: TIMEOUTS.cover,
      });
    } catch (error) {
      throw new PanelError("TRANSPORT", String(error?.message || error), { cause: error });
    }
    if (!response || response.error) {
      throw new PanelError("TRANSPORT", String(response?.error || "封面请求失败"), {
        status: response?.status ?? 0,
      });
    }
    if (response.ok !== true) {
      throw new PanelError("TRANSPORT", `封面请求失败（HTTP ${response.status ?? 0}）`, {
        status: response.status ?? 0,
      });
    }
    const base64 =
      typeof response.bodyBase64 === "string" && response.bodyBase64
        ? response.bodyBase64
        : typeof response.body === "string"
          ? response.body
          : "";
    if (!base64) throw new PanelError("PROTOCOL", "封面响应缺少二进制内容");
    let bytes;
    try {
      bytes = base64ToBytes(base64);
    } catch (error) {
      throw new PanelError("PROTOCOL", `封面数据解码失败：${error?.message ?? error}`);
    }
    const contentType = headerValue(response.headers, "content-type").split(";")[0].trim();
    const type = contentType.startsWith("image/") ? contentType : "application/octet-stream";
    return { blob: new Blob([bytes], { type }), contentType: type, bytes: bytes.length };
  };

  const clearCache = async () => {
    try {
      return await call(PANEL_ROUTES.clearCache, {
        method: "POST",
        // 后台会先等在途下载/转码收敛再删目录，按媒体级超时给足时间。
        timeoutMs: TIMEOUTS.media,
      });
    } catch (error) {
      // 后台若把该路由实现为 GET，按 405 兜底重试一次；404 说明尚未实现，保持原错误。
      if (error?.code === "METHOD_NOT_ALLOWED") {
        return call(PANEL_ROUTES.clearCache, { timeoutMs: TIMEOUTS.media });
      }
      throw error;
    }
  };

  return {
    ensureReady,
    reset,
    getState: () => ({ port, health }),
    health: async () => {
      try {
        const data = await call(PANEL_ROUTES.health, { timeoutMs: TIMEOUTS.health });
        if (data?.pluginId !== PLUGIN_ID) {
          reset();
          throw new PanelError("PROTOCOL", "端口上的服务不是本插件后台");
        }
        health = data;
        return data;
      } catch (error) {
        if (error?.code === "BACKGROUND_UNAVAILABLE" || error?.code === "PROTOCOL") reset();
        throw error;
      }
    },
    discover: (cursor) =>
      call(PANEL_ROUTES.discover, {
        query: { cursor },
        timeoutMs: TIMEOUTS.list,
      }),
    getRank: (query = {}) => call(PANEL_ROUTES.rank, { query, timeoutMs: TIMEOUTS.list }),
    getFilterPanel: (genre) => call(PANEL_ROUTES.filterPanel, { query: { genre }, timeoutMs: TIMEOUTS.list }),
    filterSeries: (selections = {}, cursor) => call(PANEL_ROUTES.filter, {
      query: { selections: JSON.stringify(selections), cursor }, timeoutMs: TIMEOUTS.list,
    }),
    search: (q, cursor) =>
      call(PANEL_ROUTES.search, {
        query: { q, cursor },
        timeoutMs: TIMEOUTS.search,
      }),
    suggest: (q) => call(PANEL_ROUTES.suggest, { query: { q }, timeoutMs: TIMEOUTS.list }),
    hotSearch: () => call(PANEL_ROUTES.hotSearch, { timeoutMs: TIMEOUTS.list }),
    getSeries: (id) =>
      call(PANEL_ROUTES.series, {
        query: { id },
        timeoutMs: TIMEOUTS.detail,
      }),
    getEpisodes: (seriesId) =>
      call(PANEL_ROUTES.episodes, {
        query: { seriesId },
        timeoutMs: TIMEOUTS.episodes,
      }),
    getPlayback: (episodeId) =>
      call(PANEL_ROUTES.playback, {
        query: { episodeId },
        timeoutMs: TIMEOUTS.detail,
      }),
    /** 媒体管道：仅供播放器使用，返回的 base64 由播放器自行转成字节。 */
    getStreamInfo: (episodeId, quality) =>
      call(PANEL_ROUTES.streamInfo, {
        query: { episodeId, quality },
        timeoutMs: TIMEOUTS.media,
      }),
    getStreamInit: (episodeId, quality) =>
      call(PANEL_ROUTES.streamInit, {
        query: { episodeId, quality },
        timeoutMs: TIMEOUTS.media,
      }),
    getStreamSegment: (episodeId, quality, seq) =>
      call(PANEL_ROUTES.streamSegment, {
        query: { episodeId, quality, seq },
        timeoutMs: TIMEOUTS.media,
      }),
    prefetchStream: (episodeId, quality, token) => call(PANEL_ROUTES.streamPrefetch, {
      method: "POST", query: { episodeId, quality, token }, timeoutMs: TIMEOUTS.media,
    }),
    cancelPrefetch: (token) => call(PANEL_ROUTES.streamPrefetchCancel, {
      method: "POST", query: { token }, timeoutMs: TIMEOUTS.action,
    }),
    /** 转码兜底：查询进度 / 启动 / 分块读取成品（宿主没有 HEVC 解码器时使用）。 */
    h264Info: (episodeId, quality) =>
      call(PANEL_ROUTES.h264Info, {
        query: { episodeId, quality },
        timeoutMs: TIMEOUTS.detail,
      }),
    h264Start: (episodeId, quality) =>
      call(PANEL_ROUTES.h264Start, {
        method: "POST",
        query: { episodeId, quality },
        timeoutMs: TIMEOUTS.action,
      }),
    h264Chunk: (episodeId, quality, offset, length) =>
      call(PANEL_ROUTES.h264Chunk, {
        query: { episodeId, quality, offset, length },
        timeoutMs: TIMEOUTS.media,
      }),
    clearCache,
    fetchCover,
  };
}
