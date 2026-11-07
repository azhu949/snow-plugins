// 协议层：仅监听 127.0.0.1 的 JSON 服务，外加 /cover 与 /stream/* 二进制接口。
// 路由只做参数校验与字段裁剪；上游调用、错误映射、磁盘缓存分别由 sdk.js / errors.js / cache.js 负责。
import { createServer } from "node:http";
import {
  CHANNEL_HEADER,
  CHANNEL_HEADER_VALUE,
  LIMITS,
  PLUGIN_ID,
  PORT_FIRST,
  PORT_LAST,
  ROUTES,
} from "../shared/contract.js";
import { HttpError, mapSdkError, toErrorResponse } from "./errors.js";
import { byteLength, createTtlCache, mapWithConcurrency, truncateChars, withSingleFlight } from "./util.js";
import { createCoverResolver } from "./media/cover.js";
import { MEDIA_LIMITS, MEDIA_ROUTES, QUALITIES, base64Length } from "./media/limits.js";
import { createCatalogHandlers } from "./catalog.js";

const HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 64 * 1024;
const ID_PATTERN = /^[0-9A-Za-z_.-]{1,64}$/;
const DEFAULT_TITLE_PATTERN = /^第\s*\d+\s*[集话]$/;

const readParam = (query, name, { required = false, maxLength = 512, pattern = null } = {}) => {
  const raw = query.get(name);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    if (required) throw new HttpError(400, "INVALID_PARAM", `缺少参数 ${name}`);
    return null;
  }
  if (value.length > maxLength) throw new HttpError(400, "INVALID_PARAM", `参数 ${name} 过长`);
  if (pattern && !pattern.test(value)) throw new HttpError(400, "INVALID_PARAM", `参数 ${name} 格式不正确`);
  return value;
};

const readId = (query, name) => readParam(query, name, { required: true, maxLength: 64, pattern: ID_PATTERN });

const coverPath = (rawUrl) =>
  typeof rawUrl === "string" && rawUrl ? `${ROUTES.cover}?url=${encodeURIComponent(rawUrl)}` : null;

const toCount = (value) => (Number.isFinite(value) ? value : null);

/** 列表项只保留面板需要的五个字段。 */
export const toListItem = (series) => ({
  id: String(series?.id ?? ""),
  title: String(series?.title ?? ""),
  description: truncateChars(series?.description ?? "", LIMITS.descriptionChars),
  cover: coverPath(series?.cover_url),
  count: toCount(series?.episode_count),
});

/** 详情：在列表字段之外补标签、状态与计数。 */
export const toSeriesDetail = (series) => {
  const rows = Array.isArray(series?.rows) ? series.rows : [];
  const tags = [];
  const pushTag = (value) => {
    const text = String(value ?? "").trim();
    if (text && !tags.includes(text) && tags.length < 12) tags.push(text.slice(0, 24));
  };
  if (series?.category) pushTag(series.category);
  for (const row of rows) {
    if (![3, 9, 40].includes(row?.kind)) continue;
    for (const part of String(row?.text ?? "").split(/[,，、/|]+/)) pushTag(part);
  }
  return {
    id: String(series?.id ?? ""),
    title: String(series?.title ?? ""),
    description: truncateChars(series?.description ?? "", LIMITS.seriesDescriptionChars),
    cover: coverPath(series?.cover_url),
    count: toCount(series?.episode_count),
    tags,
    author: series?.author ?? null,
    category: series?.category ?? null,
    status: Number.isFinite(series?.status) ? series.status : null,
    rightText: series?.right_text ?? null,
    isMultiSeason: series?.is_multi_season === true,
    seasonIndex: Number.isFinite(series?.season_index) ? series.season_index : null,
    heat: toCount(series?.heat),
    playCount: toCount(series?.play_count),
    subtitles: Array.isArray(series?.subtitles) ? series.subtitles.slice(0, 6).map(String) : [],
  };
};

/**
 * 紧凑分集数组：[id, number, playable(0/1), title?]。
 * 超过 64 KB 时先丢标题，再按字节预算截断，保证响应绝不超过上限。
 */
export const compactEpisodes = (seriesId, episodes, { cursor = null, hasMore = false } = {}) => {
  const rows = [];
  (episodes ?? []).forEach((episode, index) => {
    const id = String(episode?.id ?? "");
    if (!id) return;
    const number = Number.isFinite(episode?.number) ? episode.number : index + 1;
    const playable = episode?.playable === true ? 1 : 0;
    const rawTitle = typeof episode?.title === "string" ? episode.title.trim() : "";
    const title = rawTitle && !DEFAULT_TITLE_PATTERN.test(rawTitle) ? truncateChars(rawTitle, 40) : "";
    rows.push(title ? [id, number, playable, title] : [id, number, playable]);
  });

  let items = rows;
  let omittedTitles = false;
  let payload = { seriesId, count: rows.length, hasMore, cursor: cursor ?? null, items };
  if (byteLength(payload) > LIMITS.episodesMaxBytes) {
    omittedTitles = true;
    items = rows.map((row) => row.slice(0, 3));
    payload = { seriesId, count: rows.length, hasMore, cursor: cursor ?? null, items, omittedTitles: true };
  }

  if (byteLength(payload) > LIMITS.episodesMaxBytes) {
    const header = {
      seriesId,
      count: rows.length,
      hasMore: true,
      cursor: cursor ?? null,
      items: [],
      omittedTitles: true,
      truncated: true,
    };
    let budget = LIMITS.episodesMaxBytes - byteLength(header) - 2;
    const kept = [];
    for (const row of items) {
      const cost = byteLength(row) + 1;
      if (cost > budget) break;
      kept.push(row);
      budget -= cost;
    }
    return {
      seriesId,
      count: kept.length,
      total: rows.length,
      hasMore: true,
      cursor: cursor ?? null,
      items: kept,
      omittedTitles: true,
      truncated: true,
    };
  }

  return payload;
};

/** /playback 只暴露画质元数据，绝不返回 url / backup_url / contentKey。 */
export const toPlaybackSummary = (result) => {
  const playback = result?.playback;
  if (!playback || !Array.isArray(playback.streams)) {
    throw new HttpError(502, "CONTENT_UNAVAILABLE", "内容不可用");
  }
  const byDefinition = new Map();
  for (const stream of playback.streams) {
    const definition = typeof stream?.definition === "string" && stream.definition ? stream.definition : "unknown";
    const bitrate = Number.isFinite(stream?.bitrate) ? stream.bitrate : null;
    const previous = byDefinition.get(definition);
    if (!previous || (bitrate ?? -1) > (previous.bitrate ?? -1)) {
      byDefinition.set(definition, {
        definition,
        bitrate,
        codec: typeof stream?.codec === "string" ? stream.codec : null,
      });
    }
  }
  const heightOf = (definition) => {
    const match = /^(\d+)p$/i.exec(definition);
    return match ? Number(match[1]) : 0;
  };
  return {
    qualities: [...byDefinition.values()].sort((a, b) => heightOf(b.definition) - heightOf(a.definition)),
    protected: playback.protected === true,
    durationSeconds: Number.isFinite(playback.duration_seconds) ? playback.duration_seconds : null,
  };
};

/** 路由处理器：返回 { status, payload } 或 { status, body, headers }。 */
export function createRequestHandler({
  sdk,
  cache,
  media = null,
  transcoder = null,
  version = "0.0.0",
  log = () => {},
  getPort = () => 0,
  startedAt = Date.now(),
}) {
  if (!sdk) throw new TypeError("createRequestHandler 需要 sdk");
  if (!cache) throw new TypeError("createRequestHandler 需要 cache");

  const seriesCache = createTtlCache({ ttlMs: LIMITS.seriesCacheTtlMs, max: LIMITS.seriesCacheMax });
  const seriesInflight = new Map();
  const covers = createCoverResolver({ cache, log });

  /** 面板侧 api.net.fetch 的响应上限是 5MB：base64 超了就是实现错误，直接报错而不是截断。 */
  const encodeBinary = (bytes, label) => {
    if (base64Length(bytes.length) > MEDIA_LIMITS.maxBase64Bytes) {
      throw new HttpError(500, "BINARY_TOO_LARGE", `${label}超过 5MB 面板接收上限`);
    }
    return bytes.toString("base64");
  };

  const requireMedia = () => {
    if (!media) throw new HttpError(503, "MEDIA_UNAVAILABLE", "媒体管道未启用");
    return media;
  };

  const requireTranscoder = () => {
    if (!transcoder) throw new HttpError(503, "TRANSCODE_UNAVAILABLE", "转码能力未启用");
    return transcoder;
  };

  /** 清晰度参数：省略时按 720p，非法值直接 400。 */
  const readQuality = (query) => {
    const raw = readParam(query, "quality", { maxLength: 8 });
    if (!raw) return "720p";
    if (!QUALITIES.includes(raw)) {
      throw new HttpError(400, "INVALID_PARAM", `quality 只能是 ${QUALITIES.join(" / ")}`);
    }
    return raw;
  };

  const loadSeries = (id) => {
    const cached = seriesCache.get(id);
    if (cached) return Promise.resolve(cached);
    return withSingleFlight(seriesInflight, id, async () => {
      const series = await sdk.getSeries(id);
      seriesCache.set(id, series);
      return series;
    });
  };

  /** END_OF_LIST 是正常结束，不是错误。 */
  const fetchPage = async (task) => {
    try {
      return await task();
    } catch (error) {
      if (error?.code === "END_OF_LIST") return { items: [], has_more: false };
      throw error;
    }
  };

  const enrichSearchCovers = async (items, rawItems) => {
    const targets = [];
    items.forEach((item, index) => {
      if (!rawItems[index]) return;
      if (!item.cover || item.count == null) targets.push(index);
    });
    await mapWithConcurrency(targets, LIMITS.searchEnrichConcurrency, async (index) => {
      try {
        const series = await loadSeries(items[index].id);
        const item = items[index];
        if (!item.cover) item.cover = coverPath(series?.cover_url);
        if (item.count == null) item.count = toCount(series?.episode_count);
        if (!item.description) item.description = truncateChars(series?.description ?? "", LIMITS.descriptionChars);
        if (!item.title) item.title = String(series?.title ?? "");
      } catch (error) {
        log(`[search] 补全 ${items[index].id} 失败：${mapSdkError(error).code}`);
      }
    });
    return items;
  };

  const handles = {
    ...createCatalogHandlers({ sdk, toListItem, fetchPage }),
    health: async () => {
      const stats = typeof sdk.stats === "function" ? sdk.stats() : {};
      return {
        status: 200,
        payload: {
          ok: true,
          version,
          port: getPort(),
          pluginId: PLUGIN_ID,
          pid: process.pid,
          startedAt,
          uptimeMs: Date.now() - startedAt,
          sdk: {
            ready: stats.ready === true,
            resets: stats.resets ?? 0,
            lastError: stats.lastError?.code ?? null,
          },
        },
      };
    },

    discover: async ({ query }) => {
      const cursor = readParam(query, "cursor", { maxLength: 4096 });
      const page = await fetchPage(() => sdk.discover(cursor ? { cursor } : {}));
      const items = (Array.isArray(page?.items) ? page.items : []).map(toListItem);
      return {
        status: 200,
        payload: { items, cursor: page?.cursor ?? null, hasMore: page?.has_more === true },
      };
    },

    search: async ({ query }) => {
      const q = readParam(query, "q", { required: true, maxLength: 80 });
      const cursor = readParam(query, "cursor", { maxLength: 4096 });
      const page = await fetchPage(() => sdk.search(q, cursor ? { cursor } : {}));
      const rawItems = Array.isArray(page?.items) ? page.items : [];
      const items = rawItems.map(toListItem);
      // 综合搜索不返回封面：对缺封面或缺集数的条目并发 getSeries 补全，失败忽略。
      await enrichSearchCovers(items, rawItems);
      return {
        status: 200,
        payload: { items, cursor: page?.cursor ?? null, hasMore: page?.has_more === true },
      };
    },

    series: async ({ query }) => {
      const id = readId(query, "id");
      const series = await loadSeries(id);
      return { status: 200, payload: toSeriesDetail(series) };
    },

    episodes: async ({ query }) => {
      const seriesId = readId(query, "seriesId");
      const collected = [];
      let cursor = null;
      let hasMore = false;
      let pages = 0;
      for (;;) {
        const page = await fetchPage(() => sdk.listEpisodes(seriesId, cursor ? { cursor } : {}));
        const items = Array.isArray(page?.items) ? page.items : [];
        collected.push(...items);
        pages += 1;
        hasMore = page?.has_more === true;
        cursor = page?.cursor ?? null;
        if (!hasMore || !cursor || pages >= LIMITS.episodesMaxPages || collected.length >= LIMITS.episodesMaxItems || items.length === 0) {
          break;
        }
      }
      if (collected.length > LIMITS.episodesMaxItems) hasMore = true;
      return {
        status: 200,
        payload: compactEpisodes(seriesId, collected.slice(0, LIMITS.episodesMaxItems), { cursor, hasMore }),
      };
    },

    playback: async ({ query }) => {
      const episodeId = readId(query, "episodeId");
      const result = await sdk.resolvePlayback(episodeId);
      return { status: 200, payload: toPlaybackSummary(result) };
    },

    cover: async ({ query }) => {
      const rawUrl = readParam(query, "url", { required: true, maxLength: 2048 });
      // 命中缓存会直接返回；HEIC 会转成 JPEG 并覆盖缓存；没有转换器时回退原图（面板显示占位）。
      const resolved = await covers.resolve(rawUrl);
      return {
        status: 200,
        body: resolved.bytes,
        headers: {
          "content-type": resolved.contentType,
          "cache-control": "public, max-age=86400",
          "x-hongguo-cache": resolved.cache,
          "x-hongguo-cover": resolved.converted ? "jpeg" : "original",
        },
      };
    },

    /** 播放元数据：只给面板拼 MSE 需要的字段，不含直链与密钥。 */
    streamInfo: async ({ query }) => {
      const engine = requireMedia();
      const episodeId = readId(query, "episodeId");
      const quality = readQuality(query);
      return { status: 200, payload: await engine.info(episodeId, quality) };
    },

    /** 解密后的 init segment（ftyp + moov），始终是同一任务同一次解析的产物。 */
    streamInit: async ({ query }) => {
      const engine = requireMedia();
      const episodeId = readId(query, "episodeId");
      const quality = readQuality(query);
      const bytes = await engine.init(episodeId, quality);
      return { status: 200, payload: { base64: encodeBinary(bytes, "init segment ") } };
    },

    /** 分段：seq 从 1 开始，编号与 stream/info 的 segmentCount 对应。 */
    streamSegment: async ({ query }) => {
      const engine = requireMedia();
      const episodeId = readId(query, "episodeId");
      const quality = readQuality(query);
      const seqText = readParam(query, "seq", { required: true, maxLength: 7, pattern: /^\d{1,7}$/ });
      const seq = Number(seqText);
      if (!Number.isInteger(seq) || seq < 1) {
        throw new HttpError(400, "INVALID_PARAM", "参数 seq 必须是正整数");
      }
      const segment = await engine.segment(episodeId, quality, seq);
      return {
        status: 200,
        payload: { base64: encodeBinary(segment.bytes, `segment ${seq} `), seq: segment.seq },
      };
    },

    /** 清空 video/ 与 covers/；先停转码任务，再停媒体任务并删除，保证真的清干净。 */
    cacheClear: async () => {
      try {
        await transcoder?.clear?.();
      } catch {
        // 转码任务清理失败不影响主流程。
      }
      const engine = requireMedia();
      const result = await engine.clearCache();
      return { status: 200, payload: result };
    },

    /** H.264 转码兜底：查状态（含进度）。 */
    h264Info: async ({ query }) => {
      const engine = requireTranscoder();
      const episodeId = readId(query, "episodeId");
      const quality = readQuality(query);
      return { status: 200, payload: await engine.info(episodeId, quality) };
    },

    /** H.264 转码兜底：幂等启动，重复调用返回当前进度。 */
    h264Start: async ({ query }) => {
      const engine = requireTranscoder();
      const episodeId = readId(query, "episodeId");
      const quality = readQuality(query);
      return { status: 200, payload: await engine.start(episodeId, quality) };
    },

    /** H.264 转码兜底：分块读取成品 MP4（base64，≤3MB 原始字节）。 */
    h264Chunk: async ({ query }) => {
      const engine = requireTranscoder();
      const episodeId = readId(query, "episodeId");
      const quality = readQuality(query);
      const offsetText = readParam(query, "offset", { maxLength: 12 });
      const lengthText = readParam(query, "length", { maxLength: 12 });
      const payload = await engine.chunk(
        episodeId,
        quality,
        offsetText ? Number(offsetText) : 0,
        lengthText ? Number(lengthText) : MEDIA_LIMITS.blockBytes
      );
      return { status: 200, payload };
    },

    wasm: async () => {
      try {
        const wasm = await sdk.runtimeInfo();
        return { status: 200, payload: { ok: wasm.loaded === true, wasm } };
      } catch (error) {
        const mapped = mapSdkError(error);
        log(`wasm 加载失败：${mapped.code} ${mapped.rawMessage}`);
        return {
          status: 200,
          payload: { ok: false, wasm: { loaded: false, error: mapped.code, message: mapped.message } },
        };
      }
    },

    /** 兼容旧面板的自检入口。 */
    rpc: async ({ bodyText }) => {
      let request;
      try {
        request = JSON.parse(bodyText || "{}");
      } catch {
        return { status: 400, payload: { ok: false, id: null, error: { code: "BAD_JSON", message: "请求体必须是 JSON" } } };
      }
      const id = request?.id ?? null;
      const method = typeof request?.method === "string" ? request.method : "";
      if (method === "ping") {
        return { status: 200, payload: { ok: true, id, result: { pong: true, now: Date.now(), port: getPort() } } };
      }
      if (method === "echo") {
        return { status: 200, payload: { ok: true, id, result: request?.params ?? null } };
      }
      return {
        status: 200,
        payload: { ok: false, id, error: { code: "UNKNOWN_METHOD", message: `未知方法：${method || "(空)"}` } },
      };
    },
  };

  const routes = new Map([
    [ROUTES.health, { method: "GET", handler: handles.health }],
    [ROUTES.discover, { method: "GET", handler: handles.discover }],
    [ROUTES.rank, { method: "GET", handler: handles.rank }],
    [ROUTES.filterPanel, { method: "GET", handler: handles.filterPanel }],
    [ROUTES.filter, { method: "GET", handler: handles.filter }],
    [ROUTES.search, { method: "GET", handler: handles.search }],
    [ROUTES.series, { method: "GET", handler: handles.series }],
    [ROUTES.episodes, { method: "GET", handler: handles.episodes }],
    [ROUTES.playback, { method: "GET", handler: handles.playback }],
    [ROUTES.cover, { method: "GET", handler: handles.cover }],
    [MEDIA_ROUTES.streamInfo, { method: "GET", handler: handles.streamInfo }],
    [MEDIA_ROUTES.streamInit, { method: "GET", handler: handles.streamInit }],
    [MEDIA_ROUTES.streamSegment, { method: "GET", handler: handles.streamSegment }],
    [MEDIA_ROUTES.cacheClear, { method: "POST", handler: handles.cacheClear }],
    [MEDIA_ROUTES.h264Info, { method: "GET", handler: handles.h264Info }],
    [MEDIA_ROUTES.h264Start, { method: "POST", handler: handles.h264Start }],
    [MEDIA_ROUTES.h264Chunk, { method: "GET", handler: handles.h264Chunk }],
    [ROUTES.wasm, { method: "GET", handler: handles.wasm }],
    [ROUTES.rpc, { method: "POST", handler: handles.rpc }],
  ]);

  return async (request) => {
    const route = routes.get(request.pathname);
    if (!route) throw new HttpError(404, "NOT_FOUND", `没有这个接口：${request.pathname}`);
    if (route.method !== request.method) {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", `请使用 ${route.method} 请求 ${request.pathname}`);
    }
    return route.handler(request);
  };
}

const listenOnce = (server, port, host) =>
  new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new HttpError(413, "PAYLOAD_TOO_LARGE", "请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

/**
 * 启动回环服务：端口从 portFirst 逐个试到 portLast。
 * @returns {Promise<{port: number, host: string, url: string, close: () => Promise<void>}>}
 */
export async function startHttpServer({
  handle,
  log = () => {},
  host = HOST,
  portFirst = PORT_FIRST,
  portLast = PORT_LAST,
} = {}) {
  const server = createServer((req, res) => {
    void (async () => {
      const respondJson = (status, payload) => {
        const text = JSON.stringify(payload);
        res.writeHead(status, {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(text),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(text);
      };
      const respondBuffer = (status, body, headers = {}) => {
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
        res.writeHead(status, {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          ...headers,
          "content-length": buffer.length,
        });
        res.end(buffer);
      };

      try {
        // 网页发起的请求一定带 Origin；面板走主进程网络栈，不会带。
        if (req.headers.origin) {
          respondJson(403, { error: { code: "ORIGIN_FORBIDDEN", message: "不允许带 Origin 请求头" } });
          return;
        }
        if (req.headers[CHANNEL_HEADER] !== CHANNEL_HEADER_VALUE) {
          respondJson(403, { error: { code: "CHANNEL_HEADER_MISSING", message: "缺少通道请求头" } });
          return;
        }
        const method = (req.method || "GET").toUpperCase();
        if (method !== "GET" && method !== "POST") {
          respondJson(405, { error: { code: "METHOD_NOT_ALLOWED", message: `不支持 ${method}` } });
          return;
        }
        const url = new URL(req.url || "/", `http://${host}`);
        const bodyText = method === "POST" ? await readBody(req) : "";
        const result = await handle({
          method,
          pathname: url.pathname,
          query: url.searchParams,
          bodyText,
          headers: req.headers,
        });
        if (result && result.body !== undefined) {
          respondBuffer(result.status ?? 200, result.body, result.headers);
        } else {
          respondJson(result?.status ?? 200, result?.payload ?? null);
        }
      } catch (error) {
        const mapped = toErrorResponse(error);
        log(`${req.method} ${String(req.url || "/").split("?")[0]} -> ${mapped.status} ${mapped.payload?.error?.code ?? ""}`);
        if (!res.headersSent) respondJson(mapped.status, mapped.payload);
        else res.destroy();
      }
    })();
  });

  let port = 0;
  let lastError = null;
  for (let candidate = portFirst; candidate <= portLast; candidate += 1) {
    try {
      await listenOnce(server, candidate, host);
      port = candidate;
      break;
    } catch (error) {
      lastError = error;
      if (error?.code !== "EADDRINUSE") break;
    }
  }
  if (!port) {
    try {
      server.close();
    } catch {
      // 未监听成功时关闭会报错，忽略。
    }
    throw new Error(
      `无法在 ${portFirst}-${portLast} 区间绑定 ${host} 端口：${lastError?.code ?? ""} ${lastError?.message ?? ""}`.trim()
    );
  }

  log(`listening on http://${host}:${port}`);

  let closing = null;
  const close = () =>
    (closing ??= new Promise((resolve) => {
      server.close(() => resolve());
      // keep-alive 连接会拖着 close 不返回，直接断开。
      server.closeAllConnections?.();
    }));

  return { port, host, url: `http://${host}:${port}`, close };
}

/** 组装路由 + 启动端口，返回的 port 会写进 /health。 */
export async function startServer({
  sdk,
  cache,
  media = null,
  transcoder = null,
  version = "0.0.0",
  log = () => {},
  portFirst = PORT_FIRST,
  portLast = PORT_LAST,
  startedAt = Date.now(),
}) {
  const state = { port: 0 };
  const handle = createRequestHandler({
    sdk,
    cache,
    media,
    transcoder,
    version,
    log,
    getPort: () => state.port,
    startedAt,
  });
  const server = await startHttpServer({ handle, log, portFirst, portLast });
  state.port = server.port;
  return server;
}
