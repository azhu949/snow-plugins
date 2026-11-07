// 构建产物：由 build.mjs 从 src/background 打包生成，请勿直接编辑。

// node_modules/openhongguo/index.js
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
var here = dirname(fileURLToPath(import.meta.url));
var MAX_BODY = 8 << 20;
var SearchFilter = Object.freeze({
  ShortPlay: "content_type_short_play",
  // 真人剧
  Comic: "content_type_dynamic_comic",
  // 漫剧
  AIComic: "content_type_ai_dynamic_comic",
  // AI剧
  Film: "content_type_long_video",
  // 影视剧
  Unwatched: "search_range_unread"
  // 未看过
});
var OpenhongguoError = class extends Error {
  constructor({ code = "UNKNOWN", message = "", retryable = false, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = "OpenhongguoError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
};
var runtime;
function loadRuntime() {
  runtime ??= (async () => {
    globalThis.crypto ??= webcrypto;
    const require2 = createRequire(import.meta.url);
    require2(join(here, "dist", "wasm_exec.js"));
    const go = new globalThis.Go();
    const bytes = await readFile(join(here, "dist", "openhongguo.wasm"));
    const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
    go.run(instance);
    if (!globalThis.__openhongguo) {
      throw new OpenhongguoError({ code: "UNKNOWN", message: "openhongguo: wasm did not start" });
    }
    return globalThis.__openhongguo;
  })();
  return runtime;
}
function defaultProfilePath() {
  if (process.env.OHG_CONFIG_DIR) return join(process.env.OHG_CONFIG_DIR, "anonymous.json");
  let base;
  if (process.platform === "darwin") base = join(homedir(), "Library", "Application Support");
  else if (process.platform === "win32") base = process.env.AppData ?? join(homedir(), "AppData", "Roaming");
  else base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "openhongguo", "anonymous.json");
}
function fileProfileStore(path = defaultProfilePath()) {
  return {
    async load() {
      try {
        return await readFile(path, "utf8");
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    async save(json) {
      await mkdir(dirname(path), { recursive: true, mode: 448 });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, json, { mode: 384 });
      await rename(tmp, path);
    },
    async reset() {
      await rm(path, { force: true });
    }
  };
}
function nodeTransport({ timeoutMs = 3e4 } = {}) {
  return (req) => new Promise((resolve, reject) => {
    const url = new URL(req.url);
    const mod = url.protocol === "http:" ? http : https;
    const r = mod.request(url, { method: req.method || "GET", headers: req.headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) r.destroy(new Error("response body too large"));
        else chunks.push(c);
      });
      res.on("error", reject);
      res.on("end", () => {
        const headers = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (k === "set-cookie" || k === "cookie" || v === void 0) continue;
          headers[k] = Array.isArray(v) ? v[0] : String(v);
        }
        const cookies = {};
        for (const line of res.headers["set-cookie"] ?? []) {
          const pair = line.split(";", 1)[0];
          const i = pair.indexOf("=");
          if (i > 0) cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
        }
        resolve({ status: res.statusCode, headers, cookies, body: new Uint8Array(Buffer.concat(chunks)) });
      });
    });
    r.on("timeout", () => r.destroy(new Error("request timed out")));
    r.on("error", reject);
    if (req.body && req.body.length > 0) r.write(Buffer.from(req.body));
    r.end();
  });
}
function toError(e) {
  if (e instanceof Error) return e;
  return new OpenhongguoError(e);
}
async function createClient(options = {}) {
  const rt = await loadRuntime();
  const {
    profile = fileProfileStore(),
    transport = nodeTransport({ timeoutMs: options.timeoutMs }),
    log,
    apiOrigin,
    registerOrigin,
    distributionOrigin,
    retryAttempts = 3,
    deviceResets = 2,
    device
  } = options;
  const store = typeof profile === "string" ? fileProfileStore(profile) : profile;
  const res = rt.newClient({
    transport,
    profile: store,
    log,
    options: JSON.stringify({ apiOrigin, registerOrigin, distributionOrigin, retryAttempts, deviceResets, device })
  });
  if (res.error) throw new OpenhongguoError(res.error);
  return new Client(res.call);
}
var Client = class {
  #call;
  constructor(call) {
    this.#call = call;
  }
  async #invoke(name, ...args) {
    let out;
    try {
      out = await this.#call(name, JSON.stringify(args));
    } catch (e) {
      throw toError(e);
    }
    return out === void 0 || out === "null" ? void 0 : JSON.parse(out);
  }
  discover(options = {}) {
    return this.#invoke("discover", options);
  }
  search(query, options = {}) {
    return this.#invoke("search", query, options);
  }
  suggest(prefix) {
    return this.#invoke("suggest", prefix);
  }
  hotSearch() {
    return this.#invoke("hotSearch");
  }
  searchCues() {
    return this.#invoke("searchCues");
  }
  newReleases(query = {}) {
    return this.#invoke("newReleases", query);
  }
  getSeries(seriesId) {
    return this.#invoke("getSeries", seriesId);
  }
  getSeriesBatch(seriesIds) {
    return this.#invoke("getSeriesBatch", seriesIds);
  }
  listEpisodes(seriesId, options = {}) {
    return this.#invoke("listEpisodes", seriesId, options);
  }
  seasons(seriesId) {
    return this.#invoke("seasons", seriesId);
  }
  seriesRecommend(seriesId) {
    return this.#invoke("seriesRecommend", seriesId);
  }
  getAlbum(albumId) {
    return this.#invoke("getAlbum", albumId);
  }
  shortRank(query = {}) {
    return this.#invoke("shortRank", query);
  }
  shortFilterPanel(genre = "") {
    return this.#invoke("shortFilterPanel", genre);
  }
  shortFilter(query = {}) {
    return this.#invoke("shortFilter", query);
  }
  ranking(activityId, rankListId) {
    return this.#invoke("ranking", activityId, rankListId);
  }
  rankRows(cellId, offset = 0) {
    return this.#invoke("rankRows", cellId, offset);
  }
  rankGroups() {
    return this.#invoke("rankGroups");
  }
  person(userId) {
    return this.#invoke("person", userId);
  }
  personWorks(userId, cursor = "") {
    return this.#invoke("personWorks", userId, cursor);
  }
  categories(categoryId) {
    return this.#invoke("categories", categoryId);
  }
  categoryLanding(categoryId, options = {}) {
    return this.#invoke("categoryLanding", categoryId, options);
  }
  resolvePlayback(episodeId) {
    return this.#invoke("resolvePlayback", episodeId);
  }
  resetDevice() {
    return this.#invoke("resetDevice");
  }
  /** discoverAll 沿着游标逐部返回一个书城频道的剧，并去掉跨页重复的剧。 */
  discoverAll(options = {}, { maxPages = Infinity } = {}) {
    return this.#walk((cursor) => this.discover({ ...options, cursor }), options.cursor, maxPages);
  }
  /** searchAll 沿着游标逐部返回搜索结果，并去掉跨页重复的剧。 */
  searchAll(query, options = {}, { maxPages = Infinity } = {}) {
    return this.#walk((cursor) => this.search(query, { ...options, cursor }), options.cursor, maxPages);
  }
  async *#walk(fetch, cursor, maxPages) {
    const seen = /* @__PURE__ */ new Set();
    for (let pages = 0; pages < maxPages; pages++) {
      const page = await fetch(cursor ?? "");
      for (const item of page.items ?? []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        yield item;
      }
      if (!page.has_more || !page.cursor) return;
      cursor = page.cursor;
    }
  }
};

// src/shared/contract.js
var PLUGIN_ID = "com.snow.hongguo";
var PORT_FIRST = 37191;
var PORT_LAST = 37200;
var CHANNEL_HEADER = "x-snow-hongguo-channel";
var CHANNEL_HEADER_VALUE = "panel-rpc-v1";
var ROUTES = {
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
  wasm: "/probe/wasm",
  // 兼容旧面板自检用；新面板不必依赖。
  rpc: "/rpc",
  sdk: "/probe/sdk"
};
var LIMITS = {
  /** 列表项简介最多保留多少个字符（按 Unicode 码点计）。 */
  descriptionChars: 300,
  seriesDescriptionChars: 1e3,
  /** /episodes 响应体的硬上限。 */
  episodesMaxBytes: 64 * 1024,
  /** 分集翻页保护：异常 has_more 不会把请求拖死。 */
  episodesMaxPages: 8,
  episodesMaxItems: 2e3,
  /** 封面单张 3 MB（面板 5 MB 上限内，留出 base64 膨胀空间），磁盘保留 300 张。 */
  coverMaxBytes: 3 * 1024 * 1024,
  coverKeep: 300,
  videoKeep: 6,
  /** 综合搜索缺封面时并发补全 getSeries 的上限。 */
  searchEnrichConcurrency: 4,
  /** 同一上游接口两次调用之间的最小间隔。 */
  upstreamMinIntervalMs: 300,
  /** 按 retryAfterMs 退避时的单次等待上限。 */
  upstreamMaxBackoffMs: 2e3,
  seriesCacheTtlMs: 5 * 60 * 1e3,
  seriesCacheMax: 200
};

// src/background/cache.js
import { createHash } from "node:crypto";
import { mkdir as mkdir2, readdir, readFile as readFile2, rm as rm2, stat, unlink, writeFile as writeFile2 } from "node:fs/promises";
import { join as join2, sep } from "node:path";
var COVER_EXT_BY_MIME = /* @__PURE__ */ new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
  // 红果封面实测返回 image/heic（URL 带 ~tplv-...heic），照原样缓存，由面板决定能否解码。
  ["image/heic", "heic"],
  ["image/heif", "heif"]
]);
var COVER_MIME_BY_EXT = /* @__PURE__ */ new Map([
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["avif", "image/avif"],
  ["heic", "image/heic"],
  ["heif", "image/heif"]
]);
var COVER_NAME_RE = /^([0-9a-f]{40})\.(jpg|png|webp|gif|avif|heic|heif)$/;
var COVER_FORMAT_PRIORITY = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"];
var coverHash = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    return createHash("sha1").update(`${url.host}${url.pathname}`).digest("hex");
  } catch {
    return null;
  }
};
var listEntries = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    const path = join2(dir, entry.name);
    const info = await stat(path).catch(() => null);
    if (!info) continue;
    out.push({ name: entry.name, path, mtimeMs: info.mtimeMs, size: info.size, isDirectory: entry.isDirectory() });
  }
  return out;
};
function createCache({
  rootDir,
  log = () => {
  },
  videoKeep = LIMITS.videoKeep,
  coverKeep = LIMITS.coverKeep,
  maxCoverBytes = LIMITS.coverMaxBytes
} = {}) {
  if (typeof rootDir !== "string" || !rootDir) throw new TypeError("createCache 需要 rootDir");
  const videoDir = join2(rootDir, "video");
  const coversDir = join2(rootDir, "covers");
  const inUse = /* @__PURE__ */ new Set();
  const coverIndex = /* @__PURE__ */ new Map();
  const isProtected = (absPath) => [...inUse].some(
    (held) => absPath === held || absPath.startsWith(held + sep) || held.startsWith(absPath + sep)
  );
  const loadCoverIndex = async () => {
    coverIndex.clear();
    for (const entry of await listEntries(coversDir)) {
      if (entry.isDirectory) continue;
      const match = COVER_NAME_RE.exec(entry.name);
      if (!match) continue;
      const contentType = COVER_MIME_BY_EXT.get(match[2]);
      if (!contentType) continue;
      const existing = coverIndex.get(match[1]);
      if (existing && COVER_FORMAT_PRIORITY.indexOf(existing.contentType) <= COVER_FORMAT_PRIORITY.indexOf(contentType)) {
        continue;
      }
      coverIndex.set(match[1], { name: entry.name, contentType });
    }
    return coverIndex.size;
  };
  const cleanupPartials = async (dir = rootDir, depth = 4) => {
    let removed = 0;
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join2(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) removed += await cleanupPartials(path, depth - 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".part")) continue;
      try {
        await unlink(path);
        removed += 1;
      } catch {
      }
    }
    return removed;
  };
  const pruneCovers = async () => {
    const entries = (await listEntries(coversDir)).sort((a, b) => b.mtimeMs - a.mtimeMs);
    let removed = 0;
    for (let index = coverKeep; index < entries.length; index += 1) {
      const entry = entries[index];
      if (isProtected(entry.path)) continue;
      await rm2(entry.path, { recursive: true, force: true }).catch(() => {
      });
      const match = COVER_NAME_RE.exec(entry.name);
      if (match) coverIndex.delete(match[1]);
      removed += 1;
    }
    return { removed, kept: entries.length - removed };
  };
  const pruneVideos = async () => {
    const entries = (await listEntries(videoDir)).sort((a, b) => b.mtimeMs - a.mtimeMs);
    let kept = 0;
    let removed = 0;
    for (const entry of entries) {
      if (isProtected(entry.path)) continue;
      if (kept < videoKeep) {
        kept += 1;
        continue;
      }
      await rm2(entry.path, { recursive: true, force: true }).catch(() => {
      });
      removed += 1;
    }
    return { removed, kept };
  };
  const prune = async () => {
    const [videos, covers] = await Promise.all([pruneVideos(), pruneCovers()]);
    if (videos.removed || covers.removed) {
      log(`清理：视频删除 ${videos.removed} 项、封面删除 ${covers.removed} 项`);
    }
    return { videos, covers, at: Date.now() };
  };
  const clearDir = async (dir) => {
    let removed = 0;
    for (const entry of await listEntries(dir)) {
      if (isProtected(entry.path)) continue;
      await rm2(entry.path, { recursive: true, force: true }).catch(() => {
      });
      removed += 1;
    }
    return removed;
  };
  return {
    rootDir,
    videoDir,
    coversDir,
    async init() {
      await mkdir2(videoDir, { recursive: true, mode: 448 });
      await mkdir2(coversDir, { recursive: true, mode: 448 });
      const partials = await cleanupPartials();
      const covers = await loadCoverIndex();
      log(`就绪：封面索引 ${covers} 张，清理 .part ${partials} 个，目录 ${rootDir}`);
      return { rootDir, videoDir, coversDir, covers, partials };
    },
    prune,
    /** 清空缓存，但跳过 markInUse() 标记过的路径（正在播放的分片/目录）。 */
    async clear() {
      const videos = await clearDir(videoDir);
      const covers = await clearDir(coversDir);
      await loadCoverIndex();
      log(`清空：视频 ${videos} 项、封面 ${covers} 项（保留使用中 ${inUse.size} 项）`);
      return { videos, covers, kept: inUse.size };
    },
    markInUse(path) {
      if (path) inUse.add(path);
    },
    release(path) {
      inUse.delete(path);
    },
    isInUse(path) {
      return inUse.has(path);
    },
    /** 命中返回 { bytes, contentType, path }；未命中返回 null。 */
    async readCover(rawUrl) {
      const hash = coverHash(rawUrl);
      if (!hash) return null;
      const entry = coverIndex.get(hash);
      if (!entry) return null;
      const path = join2(coversDir, entry.name);
      try {
        const bytes = await readFile2(path);
        return { bytes, contentType: entry.contentType, path };
      } catch {
        coverIndex.delete(hash);
        return null;
      }
    },
    /** 只接受 image/* 且不超过上限的字节；返回落盘信息，拒绝时返回 null。 */
    async writeCover(rawUrl, bytes, contentType) {
      const hash = coverHash(rawUrl);
      const type = String(contentType ?? "").split(";")[0].trim().toLowerCase();
      const ext = COVER_EXT_BY_MIME.get(type);
      if (!hash || !ext || !bytes || bytes.length === 0 || bytes.length > maxCoverBytes) return null;
      const name = `${hash}.${ext}`;
      const previous = coverIndex.get(hash);
      await writeFile2(join2(coversDir, name), bytes, { mode: 384 });
      if (previous && previous.name !== name) {
        await rm2(join2(coversDir, previous.name), { force: true }).catch(() => {
        });
      }
      coverIndex.set(hash, { name, contentType: type });
      if (coverIndex.size > coverKeep) await pruneCovers();
      return { path: join2(coversDir, name), contentType: type };
    },
    stats() {
      return {
        rootDir,
        videoDir,
        coversDir,
        covers: coverIndex.size,
        inUse: inUse.size,
        videoKeep,
        coverKeep
      };
    }
  };
}

// src/background/media/download.js
import { open, mkdir as mkdir3, readdir as readdir2, readFile as readFile3, rm as rm3, stat as stat2, utimes, writeFile as writeFile3 } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { join as join3 } from "node:path";

// src/background/errors.js
var ERROR_MESSAGES = Object.freeze({
  INVALID_OPTIONS: "参数不合法",
  PROFILE_NOT_FOUND: "本地匿名设备档案缺失",
  SIGNER_UNAVAILABLE: "签名组件不可用",
  AUTHENTICATION_REQUIRED: "需要登录",
  NOT_PROTECTED: "该内容未加密",
  DRM_PROTECTED: "内容受 DRM 保护",
  ANONYMOUS_LIMITED: "匿名设备被限制",
  RATE_LIMITED: "请求太频繁",
  TRANSPORT: "网络请求失败，请检查网络",
  SIGNATURE_REJECTED: "请求签名被服务端拒绝",
  CONTENT_UNAVAILABLE: "内容不可用",
  PARAM_INVALID: "参数不合法",
  CHALLENGE_REQUIRED: "服务端要求验证",
  DEVICE_REJECTED: "设备被拒",
  END_OF_LIST: "列表已到末尾",
  ALBUM_UNAVAILABLE: "剧集不可用",
  CANCELLED: "请求已取消",
  UNKNOWN: "未知错误"
});
var ERROR_STATUS = Object.freeze({
  INVALID_OPTIONS: 400,
  PARAM_INVALID: 400,
  END_OF_LIST: 404,
  RATE_LIMITED: 429,
  ANONYMOUS_LIMITED: 429,
  PROFILE_NOT_FOUND: 500,
  SIGNER_UNAVAILABLE: 500,
  UNKNOWN: 500
});
var SDK_CODES = new Set(Object.keys(ERROR_MESSAGES));
var DEVICE_RECOVERY_CODES = /* @__PURE__ */ new Set(["DEVICE_REJECTED", "ANONYMOUS_LIMITED"]);
var HttpError = class extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
};
var errorCodeOf = (error) => typeof error?.code === "string" && error.code ? error.code : "UNKNOWN";
var isDeviceRecoveryCode = (code) => DEVICE_RECOVERY_CODES.has(code);
var isSdkError = (error) => {
  const code = errorCodeOf(error);
  return code !== "UNKNOWN" && SDK_CODES.has(code);
};
var statusForCode = (code) => ERROR_STATUS[code] ?? (SDK_CODES.has(code) ? 502 : 500);
var describeError = (error) => ({
  code: errorCodeOf(error),
  message: String(error?.message ?? error ?? ""),
  retryable: error?.retryable === true,
  retryAfterMs: Number(error?.retryAfterMs) || 0
});
var mapSdkError = (error) => {
  const code = errorCodeOf(error);
  const mapped = {
    code,
    message: ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UNKNOWN,
    status: statusForCode(code),
    rawMessage: String(error?.message ?? error ?? "")
  };
  if (typeof error?.retryable === "boolean") mapped.retryable = error.retryable;
  const retryAfterMs = Number(error?.retryAfterMs);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) mapped.retryAfterMs = Math.ceil(retryAfterMs);
  return mapped;
};
var toErrorResponse = (error) => {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      payload: { error: { code: error.code, message: error.message, ...error.extra ?? {} } }
    };
  }
  if (isSdkError(error)) {
    const mapped = mapSdkError(error);
    const payload = { code: mapped.code, message: mapped.message };
    if (mapped.retryable !== void 0) payload.retryable = mapped.retryable;
    if (mapped.retryAfterMs) payload.retryAfterMs = mapped.retryAfterMs;
    return { status: mapped.status, payload: { error: payload } };
  }
  return { status: 500, payload: { error: { code: "INTERNAL", message: "后台内部错误" } } };
};

// src/background/media/limits.js
var MEDIA_ROUTES = {
  streamInfo: "/stream/info",
  streamInit: "/stream/init",
  streamSegment: "/stream/segment",
  streamPrefetch: "/stream/prefetch",
  streamPrefetchCancel: "/stream/prefetch/cancel",
  cacheClear: "/cache/clear",
  /** H.264 转码兜底：宿主没有 HEVC 解码器时使用，产物是普通 MP4。 */
  h264Info: "/h264/info",
  h264Start: "/h264/start",
  h264Chunk: "/h264/chunk"
};
var QUALITIES = ["360p", "480p", "540p", "720p", "1080p"];
var MEDIA_LIMITS = {
  /** 首个 Range 请求的大小；moov 超出时按 scanHead() 给出的 need 再追加。 */
  headBytes: 512 * 1024,
  maxHeadBytes: 64 * 1024 * 1024,
  /** 单次 Range 的原始字节上限 3MB（base64 后 4MB，仍在 5MB 面板上限内）。 */
  blockBytes: 3 * 1024 * 1024,
  /** 分段聚合目标 1.5MB、硬上限 2MB（base64 后 2.67MB）。 */
  segmentTargetBytes: 1536 * 1024,
  segmentMaxBytes: 2 * 1024 * 1024,
  /** api.net.fetch 单次响应上限 5MB：base64 长度不得超过。 */
  maxBase64Bytes: 5 * 1024 * 1024,
  /** 源文件保护：超过 512MB 的地址直接拒绝，避免误分配大缓冲区。 */
  maxTotalBytes: 512 * 1024 * 1024,
  rangeTimeoutMs: 3e4,
  /** 同一个源的下载失败重试次数（配合 .part 续传）。 */
  rangeRetries: 2,
  rangeRetryDelayMs: 400,
  /** 等分段时允许连续没有新分段落盘的最长时间。 */
  segmentWaitMs: 3e4,
  /** 同时保留的播放任务数（按 LRU 淘汰）。 */
  maxJobs: 6,
  /** 下一集只预取开头，最多 4MB / 两个面板，租约到期自动停止。 */
  prefetchMaxBytes: 4 * 1024 * 1024,
  prefetchMaxJobs: 2,
  prefetchTtlMs: 60 * 1e3,
  /** 转码任务保留数：只保留少量已完成任务，其余按 LRU 淘汰；实际执行始终串行。 */
  transcodeMaxJobs: 4,
  coverTimeoutMs: 8e3
};
var base64Length = (rawBytes) => Math.ceil(rawBytes / 3) * 4;

// src/background/media/remux.js
import { createDecipheriv } from "node:crypto";
var MAX_RANDOM_READ_BYTES = 8 * 1024 * 1024;
function parseBoxes(buf, start2 = 0, end = buf.length) {
  const out = [];
  let offset = start2;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(buf.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    out.push({
      type: buf.toString("latin1", offset + 4, offset + 8),
      start: offset,
      body: offset + header,
      end: offset + size
    });
    offset += size;
  }
  return out;
}
var u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
};
var box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, "latin1"), body]);
};
var fullBox = (type, version, flags, ...parts) => box(type, u32((version << 24 | flags) >>> 0), ...parts);
function scanHead(buf) {
  const boxes = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    let size = buf.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > buf.length) return { boxes, ftyp: null, moov: null, need: offset + 16 };
      size = Number(buf.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      return { boxes, ftyp: null, moov: null, need: offset + 8 };
    }
    if (size < header) throw new Error("MP4 结构损坏：box 尺寸小于头部");
    const end = offset + size;
    if (end > buf.length) return { boxes, ftyp: null, moov: null, need: end };
    const entry = {
      type: buf.toString("latin1", offset + 4, offset + 8),
      start: offset,
      body: offset + header,
      end
    };
    boxes.push(entry);
    if (entry.type === "moov") {
      return { boxes, ftyp: boxes.find((item) => item.type === "ftyp") ?? null, moov: entry, need: null };
    }
    offset = end;
  }
  return { boxes, ftyp: null, moov: null, need: offset + 8 };
}
var reverseBits32 = (value) => {
  let bits = value >>> 0;
  bits = (bits & 1431655765) << 1 | bits >>> 1 & 1431655765;
  bits = (bits & 858993459) << 2 | bits >>> 2 & 858993459;
  bits = (bits & 252645135) << 4 | bits >>> 4 & 252645135;
  bits = (bits & 16711935) << 8 | bits >>> 8 & 16711935;
  return (bits << 16 | bits >>> 16) >>> 0;
};
function hevcCodecString(sampleEntryType, hvcC) {
  if (!hvcC || hvcC.length < 13) return sampleEntryType;
  const byte = hvcC[1];
  const profileSpace = byte >> 6 & 3;
  const tierFlag = byte >> 5 & 1;
  const profileIdc = byte & 31;
  const compatibility = reverseBits32(hvcC.readUInt32BE(2));
  const level = hvcC[12];
  const space = profileSpace === 0 ? "" : "ABC"[profileSpace - 1] ?? "";
  let text = `${sampleEntryType}.${space}${profileIdc}.${compatibility.toString(16).toUpperCase()}.${tierFlag ? "H" : "L"}${level}`;
  let last = 6;
  while (last > 0 && hvcC[6 + last - 1] === 0) last -= 1;
  for (let index = 0; index < last; index += 1) {
    text += `.${hvcC[6 + index].toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return text;
}
function avcCodecString(sampleEntryType, avcC) {
  if (!avcC || avcC.length < 4) return sampleEntryType;
  const hex = (value) => value.toString(16).toUpperCase().padStart(2, "0");
  return `${sampleEntryType}.${hex(avcC[1])}${hex(avcC[2])}${hex(avcC[3])}`;
}
var readDescriptor = (buf, offset) => {
  const tag = buf[offset];
  let cursor = offset + 1;
  let size = 0;
  for (let index = 0; index < 4; index += 1) {
    const byte = buf[cursor];
    cursor += 1;
    size = size << 7 | byte & 127;
    if (!(byte & 128)) break;
  }
  return { tag, start: cursor, end: cursor + size };
};
function aacCodecString(sampleEntryType, esds) {
  try {
    let cursor = 4;
    let descriptor = readDescriptor(esds, cursor);
    if (descriptor.tag === 3) {
      const flags = esds[descriptor.start + 2];
      cursor = descriptor.start + 3;
      if (flags & 128) cursor += 2;
      if (flags & 64) cursor += 1 + esds[cursor];
      if (flags & 32) cursor += 2;
      descriptor = readDescriptor(esds, cursor);
    }
    if (descriptor.tag !== 4) return sampleEntryType;
    const objectType = esds[descriptor.start];
    cursor = descriptor.start + 13;
    descriptor = readDescriptor(esds, cursor);
    if (descriptor.tag !== 5 || descriptor.start >= descriptor.end) {
      return objectType === 64 ? `${sampleEntryType}.40.2` : `${sampleEntryType}.${objectType}`;
    }
    let bits = 0;
    let value = 0;
    for (let index = 0; index < 5; index += 1) {
      value = value << 1 | esds[descriptor.start + (index >> 3)] >> 7 - (index & 7) & 1;
      bits += 1;
    }
    if (bits === 5 && value === 31) {
      for (let index = 0; index < 6; index += 1) {
        value = value << 1 | esds[descriptor.start + (5 + index >> 3)] >> 7 - (5 + index & 7) & 1;
      }
    }
    return objectType === 64 ? `${sampleEntryType}.40.${value}` : `${sampleEntryType}.${objectType}`;
  } catch {
    return `${sampleEntryType}.40.2`;
  }
}
var parseTenc = (moov, tenc) => {
  const body = tenc.body;
  const protectedFlag = moov[body + 6];
  if (protectedFlag !== 1) return null;
  const ivSize = moov[body + 7];
  const kid = moov.subarray(body + 8, body + 24);
  let constantIv = null;
  if (ivSize === 0) {
    const constantSize = moov[body + 24];
    if (constantSize > 0) constantIv = moov.subarray(body + 25, body + 25 + constantSize);
  }
  return { ivSize, kid, constantIv };
};
var readSampleIv = (moov, offset, ivSize, constantIv) => {
  const iv = Buffer.alloc(16);
  if (ivSize === 0) {
    if (constantIv) constantIv.copy(iv);
    return iv;
  }
  moov.copy(iv, 0, offset, offset + Math.min(ivSize, 16));
  return iv;
};
function parseTrack(moov, trak, key) {
  const kids = (item) => parseBoxes(moov, item.body, item.end);
  const get = (item, ...path) => {
    let current = item;
    for (const type of path) {
      current = kids(current).find((entry2) => entry2.type === type);
      if (!current) return null;
    }
    return current;
  };
  const tkhd = get(trak, "tkhd");
  const mdia = get(trak, "mdia");
  if (!tkhd || !mdia) return null;
  const minf = get(mdia, "minf");
  const stbl = minf ? get(minf, "stbl") : null;
  if (!stbl) return null;
  const trackId = moov.readUInt32BE(tkhd.body + (moov[tkhd.body] === 1 ? 20 : 12));
  const mdhd = get(mdia, "mdhd");
  const timescale = moov.readUInt32BE(mdhd.body + (moov[mdhd.body] === 1 ? 20 : 12));
  const hdlr = get(mdia, "hdlr");
  const handler = moov.toString("latin1", hdlr.body + 8, hdlr.body + 12);
  if (handler !== "vide" && handler !== "soun") return null;
  const table = (type) => {
    const entry2 = get(stbl, type);
    if (!entry2) return null;
    const count2 = moov.readUInt32BE(entry2.body + 4);
    return { entry: entry2, count: count2, at: (index, width) => entry2.body + 8 + index * width };
  };
  const stsz = get(stbl, "stsz");
  if (!stsz) return null;
  const fixedSize = moov.readUInt32BE(stsz.body + 4);
  const count = moov.readUInt32BE(stsz.body + 8);
  const sizes = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    sizes[index] = fixedSize || moov.readUInt32BE(stsz.body + 12 + index * 4);
  }
  const durations = new Uint32Array(count);
  const stts = table("stts");
  if (stts) {
    for (let index = 0, sample = 0; index < stts.count; index += 1) {
      const runs = moov.readUInt32BE(stts.at(index, 8));
      const delta = moov.readUInt32BE(stts.at(index, 8) + 4);
      for (let run2 = 0; run2 < runs && sample < count; run2 += 1) durations[sample++] = delta;
    }
  }
  let lastDelta = 0;
  for (let index = 0; index < count; index += 1) if (durations[index]) lastDelta = durations[index];
  for (let index = 0; index < count; index += 1) if (!durations[index]) durations[index] = lastDelta || 1;
  const ctts = table("ctts");
  const compositionOffsets = ctts ? new Int32Array(count) : null;
  if (ctts) {
    for (let index = 0, sample = 0; index < ctts.count; index += 1) {
      const runs = moov.readUInt32BE(ctts.at(index, 8));
      const delta = moov.readInt32BE(ctts.at(index, 8) + 4);
      for (let run2 = 0; run2 < runs && sample < count; run2 += 1) compositionOffsets[sample++] = delta;
    }
  }
  const stss = table("stss");
  const sync = stss ? new Uint8Array(count) : null;
  if (stss) {
    for (let index = 0; index < stss.count; index += 1) {
      const sample = moov.readUInt32BE(stss.at(index, 4)) - 1;
      if (sample >= 0 && sample < count) sync[sample] = 1;
    }
  }
  const chunkOffset = table("stco") ?? table("co64");
  if (!chunkOffset) return null;
  const wide = chunkOffset.entry.type === "co64";
  const chunkAt = (index) => wide ? Number(moov.readBigUInt64BE(chunkOffset.at(index, 8))) : moov.readUInt32BE(chunkOffset.at(index, 4));
  const stsc = table("stsc");
  const offsets = new Float64Array(count);
  if (stsc) {
    for (let entry2 = 0, sample = 0; entry2 < stsc.count; entry2 += 1) {
      const firstChunk = moov.readUInt32BE(stsc.at(entry2, 12)) - 1;
      const perChunk = moov.readUInt32BE(stsc.at(entry2, 12) + 4);
      const nextFirst = entry2 + 1 < stsc.count ? moov.readUInt32BE(stsc.at(entry2 + 1, 12)) - 1 : chunkOffset.count;
      for (let chunk = firstChunk; chunk < nextFirst; chunk += 1) {
        let offset = chunkAt(chunk);
        for (let index = 0; index < perChunk && sample < count; index += 1) {
          offsets[sample] = offset;
          offset += sizes[sample];
          sample += 1;
        }
      }
    }
  }
  const stsd = get(stbl, "stsd");
  if (!stsd) return null;
  const entry = parseBoxes(moov, stsd.body + 8, stsd.end)[0];
  if (!entry) return null;
  const fixedLength = handler === "vide" ? 78 : 28;
  const inner = parseBoxes(moov, entry.body + fixedLength, entry.end);
  const sinf = inner.find((item) => item.type === "sinf");
  let format = entry.type;
  let encrypted = false;
  let ivs = null;
  let tencInfo = null;
  if (sinf) {
    encrypted = true;
    const sinfKids = parseBoxes(moov, sinf.body, sinf.end);
    const frma = sinfKids.find((item) => item.type === "frma");
    if (!frma) throw new Error("加密样本缺少 frma");
    format = moov.toString("latin1", frma.body, frma.body + 4);
    const schm = sinfKids.find((item) => item.type === "schm");
    const scheme = schm ? moov.toString("latin1", schm.body + 4, schm.body + 8) : "cenc";
    if (scheme !== "cenc") throw new Error(`不支持的加密方式 ${scheme}`);
    const schi = sinfKids.find((item) => item.type === "schi");
    const tenc = schi ? parseBoxes(moov, schi.body, schi.end).find((item) => item.type === "tenc") : null;
    if (!tenc) throw new Error("加密样本缺少 tenc");
    tencInfo = parseTenc(moov, tenc, count);
    if (!tencInfo) throw new Error("内容未按 cenc 加密");
    if (!key) throw new Error("缺少内容密钥");
    const senc = get(stbl, "senc");
    if (!senc) throw new Error("加密样本缺少 senc");
    const subsampleFlag = (moov.readUInt32BE(senc.body) & 2) !== 0;
    const ivCount = moov.readUInt32BE(senc.body + 4);
    ivs = new Array(ivCount);
    let cursor = senc.body + 8;
    for (let index = 0; index < ivCount; index += 1) {
      const iv = readSampleIv(moov, cursor, tencInfo.ivSize, tencInfo.constantIv);
      cursor += tencInfo.ivSize;
      let parts = null;
      if (subsampleFlag) {
        const subsampleCount = moov.readUInt16BE(cursor);
        cursor += 2;
        parts = [];
        for (let part = 0; part < subsampleCount; part += 1) {
          parts.push([moov.readUInt16BE(cursor), moov.readUInt32BE(cursor + 2)]);
          cursor += 6;
        }
      }
      ivs[index] = { iv, parts };
    }
  }
  const sampleEntry = box(
    format,
    moov.subarray(entry.body, entry.body + fixedLength),
    ...inner.filter((item) => item.type !== "sinf").map((item) => moov.subarray(item.start, item.end))
  );
  const stsdBox = fullBox("stsd", 0, 0, u32(1), sampleEntry);
  const emptyTables = [
    fullBox("stts", 0, 0, u32(0)),
    fullBox("stsc", 0, 0, u32(0)),
    fullBox("stsz", 0, 0, u32(0), u32(0)),
    fullBox("stco", 0, 0, u32(0))
  ];
  const raw = (item) => moov.subarray(item.start, item.end);
  const trakBox = box(
    "trak",
    ...kids(trak).filter((item) => item.type !== "mdia").map(raw),
    box(
      "mdia",
      ...kids(mdia).map(
        (item) => item.type !== "minf" ? raw(item) : box(
          "minf",
          ...kids(minf).map((child) => child.type === "stbl" ? box("stbl", stsdBox, ...emptyTables) : raw(child))
        )
      )
    )
  );
  return {
    id: trackId,
    timescale,
    handler,
    format,
    encrypted,
    count,
    sizes,
    durations,
    compositionOffsets,
    sync,
    offsets,
    ivs,
    trakBox,
    sampleEntryChildren: inner
  };
}
var codecOf = (track) => {
  const type = track.format;
  const find = (name) => track.sampleEntryChildren.find((item) => item.type === name);
  const bodyOf = (entry) => track.moov.subarray(entry.body, entry.end);
  if (track.handler === "vide") {
    const hvcC = find("hvcC");
    if (hvcC) return hevcCodecString(type, bodyOf(hvcC));
    const avcC = find("avcC");
    if (avcC) return avcCodecString(type, bodyOf(avcC));
    return type;
  }
  const esds = find("esds");
  return esds ? aacCodecString(type, bodyOf(esds)) : type;
};
function decryptSample(key, iv, subsamples, data) {
  const decipher = createDecipheriv("aes-128-ctr", key, iv);
  if (!subsamples || subsamples.length === 0) return decipher.update(data);
  let cursor = 0;
  for (const [clearBytes, protectedBytes] of subsamples) {
    cursor += clearBytes;
    if (protectedBytes > 0 && cursor < data.length) {
      const end = Math.min(cursor + protectedBytes, data.length);
      decipher.update(data.subarray(cursor, end)).copy(data, cursor);
      cursor = end;
    }
  }
  return data;
}
var Remuxer = class {
  /**
   * @param {Buffer} head 文件头部（至少包含完整 moov）
   * @param {string|null} keyHex 内容密钥 hex（32 位）；无加密内容可传 null
   * @param {{ segmentTargetBytes?: number, segmentMaxBytes?: number }} [options]
   */
  constructor(head, keyHex, { segmentTargetBytes = 1536 * 1024, segmentMaxBytes = 2 * 1024 * 1024 } = {}) {
    const top = scanHead(head);
    if (!top.moov) throw new Error("moov 不完整，需要继续读取文件头");
    const ftyp = top.ftyp;
    const moov = Buffer.from(head.subarray(top.moov.start, top.moov.end));
    const key = keyHex ? Buffer.from(keyHex, "hex") : null;
    if (key && key.length !== 16) throw new Error("内容密钥长度不是 16 字节");
    const inner = parseBoxes(moov, 8, moov.length);
    const mvhd = inner.find((item) => item.type === "mvhd");
    if (!mvhd) throw new Error("moov 缺少 mvhd");
    const movieTimescale = moov.readUInt32BE(mvhd.body + (moov[mvhd.body] === 1 ? 20 : 12));
    const movieDuration = moov[mvhd.body] === 1 ? Number(moov.readBigUInt64BE(mvhd.body + 24)) : moov.readUInt32BE(mvhd.body + 16);
    this.key = key;
    this.segmentTargetBytes = segmentTargetBytes;
    this.segmentMaxBytes = segmentMaxBytes;
    this.tracks = inner.filter((item) => item.type === "trak").map((trak) => parseTrack(moov, trak, key)).filter(Boolean);
    for (const track of this.tracks) track.moov = moov;
    this.video = this.tracks.find((track) => track.handler === "vide");
    this.audio = this.tracks.find((track) => track.handler === "soun");
    if (!this.video) throw new Error("没有视频轨");
    this.movieTimescale = movieTimescale;
    this.durationMs = movieDuration > 0 && movieTimescale > 0 ? Math.round(movieDuration / movieTimescale * 1e3) : 0;
    this.timescale = this.video.timescale;
    this.codec = [this.video, this.audio].filter(Boolean).map(codecOf).join(",");
    this.videoCodec = codecOf(this.video);
    this.audioCodec = this.audio ? codecOf(this.audio) : null;
    this.mime = "video/mp4";
    const trex = this.tracks.map(
      (track) => fullBox("trex", 0, 0, u32(track.id), u32(1), u32(0), u32(0), u32(0))
    );
    this.init = Buffer.concat([
      ftyp ? head.subarray(ftyp.start, ftyp.end) : box("ftyp", Buffer.from("isom\0\0\0isomiso6mp41", "latin1")),
      box("moov", moov.subarray(mvhd.start, mvhd.end), ...this.tracks.map((track) => track.trakBox), box("mvex", ...trex))
    ]);
    this.fragments = this._planFragments();
    this.segments = this._planSegments();
    this.segmentCount = this.segments.length;
    this.nextSegment = 0;
  }
  /** 按 GOP 切片段；单片段超过上限时按样本字节再切一刀，保证分段可控。 */
  _planFragments() {
    const video = this.video;
    const audio = this.audio;
    const videoTime = new Float64Array(video.count + 1);
    for (let index = 0; index < video.count; index += 1) videoTime[index + 1] = videoTime[index] + video.durations[index];
    const audioTime = audio ? new Float64Array(audio.count + 1) : null;
    if (audio) for (let index = 0; index < audio.count; index += 1) audioTime[index + 1] = audioTime[index] + audio.durations[index];
    const starts = [];
    if (video.sync) {
      for (let index = 0; index < video.count; index += 1) if (video.sync[index]) starts.push(index);
    }
    if (starts.length === 0 || starts[0] !== 0) starts.unshift(0);
    const fragments = [];
    let audioCursor = 0;
    let sequence = 1;
    for (let gopIndex = 0; gopIndex < starts.length; gopIndex += 1) {
      const gopStart = starts[gopIndex];
      const gopEnd = gopIndex + 1 < starts.length ? starts[gopIndex + 1] : video.count;
      let from = gopStart;
      while (from < gopEnd) {
        let to = from;
        let bytes = 0;
        while (to < gopEnd) {
          const size = video.sizes[to];
          if (to > from && bytes + size > this.segmentMaxBytes) break;
          bytes += size;
          to += 1;
        }
        const isLastFragment = gopIndex === starts.length - 1 && to >= gopEnd;
        const untilSeconds = isLastFragment ? Infinity : videoTime[to] / video.timescale;
        const audioFrom = audioCursor;
        if (audio) {
          const untilTicks = untilSeconds === Infinity ? Infinity : untilSeconds * audio.timescale;
          while (audioCursor < audio.count && audioTime[audioCursor] < untilTicks) audioCursor += 1;
        }
        const parts = [{ track: video, from, to, base: videoTime[from] }];
        if (audio && audioCursor > audioFrom) {
          parts.push({ track: audio, from: audioFrom, to: audioCursor, base: audioTime[audioFrom] });
        }
        fragments.push(this._measureFragment(parts, sequence));
        sequence += 1;
        from = to;
      }
    }
    return fragments;
  }
  _measureFragment(parts, sequence) {
    let payloadBytes = 0;
    let need = 0;
    for (const part of parts) {
      for (let index = part.from; index < part.to; index += 1) {
        payloadBytes += part.track.sizes[index];
        need = Math.max(need, part.track.offsets[index] + part.track.sizes[index]);
      }
    }
    const moof = this._buildMoof(parts, parts.map(() => 0), sequence);
    return { parts, sequence, need, payloadBytes, size: moof.length + 8 + payloadBytes, moofLength: moof.length };
  }
  /** 片段按字节聚合：达到 1.5MB 就收口，且绝不越过 2MB（最后一段可能更小）。 */
  _planSegments() {
    const segments = [];
    let current = null;
    const close = () => {
      if (!current) return;
      current.need = Math.max(...current.fragments.map((fragment) => fragment.need));
      segments.push(current);
      current = null;
    };
    for (const fragment of this.fragments) {
      if (current && (current.bytes >= this.segmentTargetBytes || current.bytes + fragment.size > this.segmentMaxBytes)) {
        close();
      }
      current ??= { fragments: [], bytes: 0, need: 0 };
      current.fragments.push(fragment);
      current.bytes += fragment.size;
    }
    close();
    return segments;
  }
  /** 一个 moof：mfhd + 每条轨道一个 traf（tfhd/tfdt/trun）。 */
  _buildMoof(parts, offsets, sequence) {
    const trafOf = (part, dataOffset) => {
      const { track } = part;
      const sampleCount = part.to - part.from;
      const flags = 1 | 256 | 512 | 1024 | (track.compositionOffsets ? 2048 : 0);
      const rows = [];
      for (let index = part.from; index < part.to; index += 1) {
        const keyframe = !track.sync || track.sync[index] === 1;
        rows.push(u32(track.durations[index]), u32(track.sizes[index]), u32(keyframe ? 33554432 : 16842752));
        if (track.compositionOffsets) rows.push(u32(track.compositionOffsets[index]));
      }
      const base = Buffer.alloc(8);
      base.writeBigUInt64BE(BigInt(part.base));
      return box(
        "traf",
        fullBox("tfhd", 0, 131072, u32(track.id)),
        fullBox("tfdt", 1, 0, base),
        fullBox("trun", track.compositionOffsets ? 1 : 0, flags, u32(sampleCount), u32(dataOffset), ...rows)
      );
    };
    return box("moof", fullBox("mfhd", 0, 0, u32(sequence)), ...parts.map((part, index) => trafOf(part, offsets[index])));
  }
  /** 取一个样本并解密（返回新缓冲区，避免污染源文件视图）。 */
  readSample(file, track, index) {
    const offset = track.offsets[index];
    const size = track.sizes[index];
    if (!Number.isFinite(offset) || offset + size > file.length) throw new Error("样本越界，源文件不完整");
    const data = Buffer.from(file.subarray(offset, offset + size));
    if (!track.encrypted) return data;
    const encrypted = track.ivs?.[index];
    if (!encrypted) throw new Error("加密样本缺少 IV");
    return decryptSample(this.key, encrypted.iv, encrypted.parts, data);
  }
  /** 把一段已读入的密文解密成样本；chunk 从该样本起点开始。 */
  decodeSample(chunk, track, index) {
    const data = Buffer.from(chunk);
    if (!track.encrypted) return data;
    const encrypted = track.ivs?.[index];
    if (!encrypted) throw new Error("加密样本缺少 IV");
    return decryptSample(this.key, encrypted.iv, encrypted.parts, data);
  }
  /**
   * 从随机读源读取一个样本。
   * @param {{ read: (from: number, to: number) => Promise<Buffer> }} source
   */
  async readSampleFrom(source, track, index) {
    const offset = track.offsets[index];
    const size = track.sizes[index];
    if (!Number.isFinite(offset) || !Number.isFinite(size)) throw new Error("样本越界，源文件不完整");
    const chunk = await source.read(offset, offset + size);
    if (chunk.length < size) throw new Error("样本越界，源文件不完整");
    return this.decodeSample(chunk, track, index);
  }
  /**
   * 组装一个片段（moof + mdat），样本从随机读源按需读取。
   * 样本偏移在合法 MP4 里递增，一次读覆盖整个 part；区间过大时退回逐样本读，避免单次分配失控。
   */
  async buildFragmentFrom(source, fragment) {
    const payloads = [];
    for (const part of fragment.parts) {
      let start2 = Number.POSITIVE_INFINITY;
      let end = 0;
      for (let index = part.from; index < part.to; index += 1) {
        const offset = part.track.offsets[index];
        const size = part.track.sizes[index];
        if (!Number.isFinite(offset) || !Number.isFinite(size)) throw new Error("样本越界，源文件不完整");
        start2 = Math.min(start2, offset);
        end = Math.max(end, offset + size);
      }
      if (!(end > start2)) throw new Error("样本越界，源文件不完整");
      const list = [];
      if (end - start2 <= MAX_RANDOM_READ_BYTES) {
        const chunk = await source.read(start2, end);
        for (let index = part.from; index < part.to; index += 1) {
          const offset = part.track.offsets[index] - start2;
          const size = part.track.sizes[index];
          if (offset < 0 || offset + size > chunk.length) throw new Error("样本越界，源文件不完整");
          list.push(this.decodeSample(chunk.subarray(offset, offset + size), part.track, index));
        }
      } else {
        for (let index = part.from; index < part.to; index += 1) {
          list.push(await this.readSampleFrom(source, part.track, index));
        }
      }
      payloads.push(list);
    }
    const lengths = payloads.map((list) => list.reduce((sum, buffer) => sum + buffer.length, 0));
    const offsets = [];
    for (let index = 0, cursor = fragment.moofLength + 8; index < fragment.parts.length; cursor += lengths[index], index += 1) {
      offsets.push(cursor);
    }
    const moof = this._buildMoof(fragment.parts, offsets, fragment.sequence);
    const mdat = Buffer.concat(payloads.flat());
    return Buffer.concat([moof, u32(mdat.length + 8), Buffer.from("mdat", "latin1"), mdat]);
  }
  /**
   * 流式版 drain：与 drain() 语义一致，但只按样本偏移读取，不要求整份文件常驻内存。
   * @param {{ read: (from: number, to: number) => Promise<Buffer> }} source
   * @param {number} have 已写入源文件的字节数
   */
  async drainFrom(source, have) {
    const out = [];
    while (this.nextSegment < this.segments.length && this.segments[this.nextSegment].need <= have) {
      const segment = this.segments[this.nextSegment];
      const fragments = [];
      for (const fragment of segment.fragments) fragments.push(await this.buildFragmentFrom(source, fragment));
      out.push({ seq: this.nextSegment + 1, bytes: Buffer.concat(fragments) });
      this.nextSegment += 1;
    }
    return out;
  }
  /** 组装一个片段（moof + mdat）。 */
  buildFragment(file, fragment) {
    const payloads = fragment.parts.map((part) => {
      const list = [];
      for (let index = part.from; index < part.to; index += 1) list.push(this.readSample(file, part.track, index));
      return list;
    });
    const lengths = payloads.map((list) => list.reduce((sum, buffer) => sum + buffer.length, 0));
    const offsets = [];
    for (let index = 0, cursor = fragment.moofLength + 8; index < fragment.parts.length; cursor += lengths[index], index += 1) {
      offsets.push(cursor);
    }
    const moof = this._buildMoof(fragment.parts, offsets, fragment.sequence);
    const mdat = Buffer.concat(payloads.flat());
    return Buffer.concat([moof, u32(mdat.length + 8), Buffer.from("mdat", "latin1"), mdat]);
  }
  /**
   * 产出所有「样本字节已全部就绪」的分段。
   * @param {Buffer} file 源文件字节（前缀有效即可）
   * @param {number} have 已就绪的字节数
   * @returns {Array<{ seq: number, bytes: Buffer }>} seq 从 1 开始
   */
  drain(file, have) {
    const out = [];
    while (this.nextSegment < this.segments.length && this.segments[this.nextSegment].need <= have) {
      const segment = this.segments[this.nextSegment];
      out.push({
        seq: this.nextSegment + 1,
        bytes: Buffer.concat(segment.fragments.map((fragment) => this.buildFragment(file, fragment)))
      });
      this.nextSegment += 1;
    }
    return out;
  }
  get done() {
    return this.nextSegment >= this.segments.length;
  }
  info() {
    return {
      codec: this.codec,
      durationMs: this.durationMs,
      segmentCount: this.segmentCount,
      timescale: this.timescale,
      mime: this.mime,
      videoCodec: this.videoCodec,
      audioCodec: this.audioCodec,
      encrypted: this.video.encrypted === true,
      segmentBytes: this.segments.map((segment) => segment.bytes),
      segmentNeeds: this.segments.map((segment) => segment.need)
    };
  }
};

// src/background/media/download.js
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
var SEGMENT_NAME = (seq) => `seg-${String(seq).padStart(5, "0")}.m4s`;
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var safeId = (value) => String(value ?? "").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 64);
var qualityRank = (definition) => {
  const index = QUALITIES.indexOf(definition);
  return index === -1 ? -1 : index;
};
function pickStream(streams, quality) {
  const sorted = (Array.isArray(streams) ? streams : []).filter((stream) => typeof stream?.url === "string" && stream.url).sort((left, right) => qualityRank(left.definition) - qualityRank(right.definition) || (left.bitrate ?? 0) - (right.bitrate ?? 0));
  const wanted = qualityRank(quality);
  if (wanted < 0) return sorted[0] ?? null;
  return sorted.filter((stream) => qualityRank(stream.definition) <= wanted).pop() ?? sorted[0] ?? null;
}
var segmentBase64Ok = (bytes) => base64Length(bytes.length) <= MEDIA_LIMITS.maxBase64Bytes;
function requestRange(rawUrl, from, to, { timeoutMs = MEDIA_LIMITS.rangeTimeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      try {
        request?.destroy();
      } catch {
      }
      if (error) reject(error);
      else resolve(value);
    };
    if (signal?.aborted) {
      reject(new HttpError(499, "MEDIA_ABORTED", "下载已取消"));
      return;
    }
    let target;
    try {
      target = new URL(rawUrl);
    } catch {
      reject(new HttpError(502, "MEDIA_URL_INVALID", "播放地址不合法"));
      return;
    }
    const transport = target.protocol === "http:" ? httpRequest : target.protocol === "https:" ? httpsRequest : null;
    if (!transport) {
      reject(new HttpError(502, "MEDIA_URL_INVALID", "播放地址协议不支持"));
      return;
    }
    const expected = to - from + 1;
    request = transport(
      target,
      {
        method: "GET",
        headers: {
          range: `bytes=${from}-${to}`,
          "user-agent": USER_AGENT,
          accept: "*/*"
        },
        timeout: timeoutMs
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status !== 206 && !(status === 200 && from === 0)) {
          response.resume();
          finish(new HttpError(502, "MEDIA_HTTP", `视频地址返回 HTTP ${status}`));
          return;
        }
        let total = NaN;
        const contentRange = String(response.headers["content-range"] ?? "");
        if (status === 206 && contentRange.includes("/")) {
          total = Number(contentRange.split("/")[1]);
        }
        if (!Number.isFinite(total) || total <= 0) {
          total = Number(response.headers["content-length"]);
        }
        if (!Number.isFinite(total) || total <= 0) {
          response.resume();
          finish(new HttpError(502, "MEDIA_HTTP", "视频地址没有返回文件大小"));
          return;
        }
        if (total > MEDIA_LIMITS.maxTotalBytes) {
          response.resume();
          finish(new HttpError(502, "MEDIA_TOO_LARGE", "视频文件超过本地缓存上限"));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          if (settled) return;
          if (size + chunk.length >= expected) {
            chunks.push(chunk.subarray(0, expected - size));
            size = expected;
            finish(null, { bytes: Buffer.concat(chunks), total, status });
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        response.on("end", () => {
          if (!settled) finish(null, { bytes: Buffer.concat(chunks), total, status });
        });
        response.on("error", () => finish(new HttpError(502, "MEDIA_TRANSPORT", "视频下载失败，请检查网络")));
        response.on("aborted", () => finish(new HttpError(502, "MEDIA_TRANSPORT", "视频连接被中断，请稍后重试")));
      }
    );
    request.on("timeout", () => finish(new HttpError(504, "MEDIA_TIMEOUT", "视频下载超时")));
    request.on("error", () => finish(new HttpError(502, "MEDIA_TRANSPORT", "视频下载失败，请检查网络")));
    if (signal) {
      const onAbort = () => finish(new HttpError(499, "MEDIA_ABORTED", "下载已取消"));
      signal.addEventListener("abort", onAbort, { once: true });
      request.once("close", () => signal.removeEventListener("abort", onAbort));
    }
    request.end();
  });
}
var isAborted = (error) => error?.code === "MEDIA_ABORTED";
var readRange = async (handle, from, to) => {
  const size = Math.max(0, to - from);
  if (size === 0) return Buffer.alloc(0);
  const buffer = Buffer.allocUnsafe(size);
  let read = 0;
  while (read < size) {
    const { bytesRead } = await handle.read(buffer, read, size - read, from + read);
    if (!bytesRead) throw new HttpError(502, "MEDIA_TRUNCATED", "视频数据不完整");
    read += bytesRead;
  }
  return buffer;
};
async function fetchHead(url, { signal, maxBytes = MEDIA_LIMITS.maxHeadBytes } = {}) {
  let want = MEDIA_LIMITS.headBytes;
  let total = 0;
  for (let round = 0; round < 4; round += 1) {
    const block = await requestRange(url, 0, want - 1, { signal });
    total = block.total;
    const head = block.bytes.length > total ? block.bytes.subarray(0, total) : block.bytes;
    const scanned = scanHead(head);
    if (scanned.moov) return { head, total };
    if (!scanned.need) throw new HttpError(502, "MEDIA_FORMAT", "视频容器格式不支持（找不到 moov）");
    if (scanned.need > total) throw new HttpError(502, "MEDIA_FORMAT", "视频文件不完整（moov 超出文件长度）");
    if (scanned.need > maxBytes) throw new HttpError(502, "MEDIA_FORMAT", "moov 过大，暂不支持");
    want = Math.min(scanned.need, total);
  }
  throw new HttpError(502, "MEDIA_FORMAT", "无法读取完整的 moov");
}
var exists = async (path) => {
  try {
    await stat2(path);
    return true;
  } catch {
    return false;
  }
};
var asHttpError = (error) => {
  if (error instanceof HttpError) return error;
  if (typeof error?.code === "string" && error.code && !error.code.startsWith("MEDIA_")) {
    const mapped = mapSdkError(error);
    return new HttpError(mapped.status, mapped.code, mapped.message);
  }
  return new HttpError(502, "MEDIA_FAILED", "视频准备失败，请稍后重试");
};
function createMedia({ sdk, cache, log = () => {
} }) {
  if (!sdk) throw new TypeError("createMedia 需要 sdk");
  if (!cache?.videoDir) throw new TypeError("createMedia 需要 cache");
  const jobs = /* @__PURE__ */ new Map();
  const pending = /* @__PURE__ */ new Map();
  const definitionStarts = /* @__PURE__ */ new Map();
  const demands = /* @__PURE__ */ new Map();
  const warmups = /* @__PURE__ */ new Map();
  const cancelledTokens = /* @__PURE__ */ new Map();
  let disposed = false;
  let clearing = false;
  const aborted = () => new HttpError(499, "MEDIA_ABORTED", "下载已取消");
  const demandFor = (key) => {
    if (!demands.has(key)) demands.set(key, { key, foreground: false, tokens: /* @__PURE__ */ new Set(), job: null });
    return demands.get(key);
  };
  const wanted = (demand) => {
    if (disposed || clearing || !demand.foreground && !demand.tokens.size) throw aborted();
  };
  const attachDemand = (job, demand) => {
    job.demands.add(demand);
    demand.job = job;
    if (demand.foreground) {
      job.foreground = true;
      job.wake?.();
    }
    return job;
  };
  const forgetJob = (job) => {
    if (jobs.get(job.key) === job) jobs.delete(job.key);
    for (const demand of job.demands) {
      if (demand.job !== job) continue;
      demand.job = null;
      if (demands.get(demand.key) === demand) demands.delete(demand.key);
    }
    if (![...jobs.values()].some((entry) => entry.dir === job.dir)) cache.release(job.dir);
  };
  const cancelPrefetch = (token) => {
    const now = Date.now();
    for (const [id, until] of cancelledTokens) if (until <= now) cancelledTokens.delete(id);
    cancelledTokens.set(token, now + 2 * MEDIA_LIMITS.prefetchTtlMs);
    while (cancelledTokens.size > 256) cancelledTokens.delete(cancelledTokens.keys().next().value);
    const lease = warmups.get(token);
    if (!lease) return;
    clearTimeout(lease.timer);
    warmups.delete(token);
    lease.demand.tokens.delete(token);
    const job = lease.demand.job;
    if (job && !job.foreground && ![...job.demands].some((entry) => entry.tokens.size)) {
      job.abort.abort();
      void Promise.resolve(job.task).finally(() => forgetJob(job));
    } else if (!job && !lease.demand.foreground && !lease.demand.tokens.size && !pending.has(lease.demand.key)) {
      demands.delete(lease.demand.key);
    }
  };
  const episodeDirOf = (episodeId) => join3(cache.videoDir, safeId(episodeId));
  const qualityDirOf = (episodeId, definition) => join3(episodeDirOf(episodeId), definition);
  const infoPathOf = (dir) => join3(dir, "info.json");
  const initPathOf = (dir) => join3(dir, "init.mp4");
  const segmentPathOf = (dir, seq) => join3(dir, SEGMENT_NAME(seq));
  const touch = async (job) => {
    const now = /* @__PURE__ */ new Date();
    await utimes(job.episodeDir, now, now).catch(() => {
    });
  };
  const newWaiterSet = () => /* @__PURE__ */ new Set();
  const rejectWaiters = (job, error) => {
    for (const set of job.waiters.values()) {
      for (const waiter of set) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
    job.waiters.clear();
  };
  const resetWaiterTimeout = (job, seq, waiter) => {
    clearTimeout(waiter.timer);
    waiter.timer = setTimeout(() => {
      const set = job.waiters.get(seq);
      set?.delete(waiter);
      if (set?.size === 0) job.waiters.delete(seq);
      waiter.reject(new HttpError(504, "SEGMENT_TIMEOUT", "该分段还在下载，请稍后重试"));
    }, MEDIA_LIMITS.segmentWaitMs);
    waiter.timer.unref?.();
  };
  const resolveWaiters = (job, writtenSeq) => {
    for (const [seq, set] of job.waiters) {
      if (seq > writtenSeq) {
        for (const waiter of set) resetWaiterTimeout(job, seq, waiter);
        continue;
      }
      for (const waiter of set) {
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
      job.waiters.delete(seq);
    }
  };
  const waitForSegment = (job, seq) => {
    if (job.segments.has(seq)) return Promise.resolve();
    if (job.state === "error") return Promise.reject(job.error ?? new HttpError(502, "MEDIA_FAILED", "视频准备失败"));
    if (job.state === "ready") return Promise.reject(new HttpError(404, "SEGMENT_NOT_FOUND", "分段不存在"));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      resetWaiterTimeout(job, seq, waiter);
      if (!job.waiters.has(seq)) job.waiters.set(seq, newWaiterSet());
      job.waiters.get(seq).add(waiter);
    });
  };
  const createJob = ({ episodeId, quality, definition, dir, info, cached, demand }) => {
    const job = {
      key: `${episodeId}:${quality}`,
      episodeId,
      quality,
      definition,
      dir,
      episodeDir: episodeDirOf(episodeId),
      info,
      state: cached ? "ready" : "preparing",
      error: null,
      complete: cached === true,
      segments: /* @__PURE__ */ new Set(),
      waiters: /* @__PURE__ */ new Map(),
      abort: new AbortController(),
      served: 0,
      have: 0,
      total: 0,
      bytes: 0,
      lastUsed: Date.now(),
      nextLogPercent: 25,
      task: null,
      infoReady: null,
      resolveInfo: null,
      rejectInfo: null,
      foreground: false,
      demands: /* @__PURE__ */ new Set(),
      wake: null
    };
    job.infoReady = new Promise((resolve, reject) => {
      job.resolveInfo = resolve;
      job.rejectInfo = reject;
    });
    job.infoReady.catch(() => {
    });
    if (cached) {
      for (let seq = 1; seq <= info.segmentCount; seq += 1) job.segments.add(seq);
      job.resolveInfo(job.info);
    }
    jobs.set(job.key, job);
    attachDemand(job, demand);
    cache.markInUse(dir);
    return job;
  };
  const evict = () => {
    while (jobs.size > MEDIA_LIMITS.maxJobs) {
      const victim = [...jobs.values()].filter((job) => job.state !== "preparing").sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (!victim) return;
      victim.abort.abort();
      void Promise.resolve(victim.task).finally(() => forgetJob(victim));
      jobs.delete(victim.key);
      log(`[media] 淘汰任务 ${victim.episodeId} ${victim.definition}`);
    }
  };
  const findDefinitionJob = (episodeId, definition) => {
    for (const job of jobs.values()) {
      if (job.episodeId === episodeId && job.definition === definition) return job;
    }
    return null;
  };
  const findJob = (episodeId, quality) => {
    const key = `${episodeId}:${quality}`;
    const direct = jobs.get(key);
    if (direct) return direct;
    const alias = demands.get(key)?.job;
    if (alias && jobs.get(alias.key) === alias) return alias;
    return findDefinitionJob(episodeId, quality);
  };
  const readCachedDefinition = async (episodeId, definition) => {
    if (!QUALITIES.includes(definition)) return null;
    const dir = qualityDirOf(episodeId, definition);
    let info;
    try {
      info = JSON.parse(await readFile3(infoPathOf(dir), "utf8"));
    } catch {
      return null;
    }
    if (info?.complete !== true || !Number.isFinite(info.segmentCount) || info.segmentCount <= 0) {
      return null;
    }
    if (!await exists(initPathOf(dir))) return null;
    for (let seq = 1; seq <= info.segmentCount; seq += 1) {
      if (!await exists(segmentPathOf(dir, seq))) return null;
    }
    return { info: { ...info, definition }, dir, definition };
  };
  const findCached = async (episodeId, quality) => readCachedDefinition(episodeId, quality);
  const resetQualityDir = async (dir) => {
    const entries = await readdir2(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      await rm3(join3(dir, entry.name), { recursive: true, force: true }).catch(() => {
      });
    }
  };
  const writeSegments = async (job, remuxer, source, have) => {
    const emitted = await remuxer.drainFrom(source, have);
    for (const segment of emitted) {
      if (!segmentBase64Ok(segment.bytes)) {
        throw new HttpError(500, "SEGMENT_TOO_LARGE", "分段超过面板 5MB 接收上限");
      }
      await writeFile3(segmentPathOf(job.dir, segment.seq), segment.bytes, { mode: 384 });
      job.segments.add(segment.seq);
      job.bytes += segment.bytes.length;
      resolveWaiters(job, segment.seq);
    }
    return emitted.length;
  };
  const markReady = async (job) => {
    job.state = "ready";
    job.complete = true;
    await writeFile3(infoPathOf(job.dir), JSON.stringify({ ...job.info, complete: true }), { mode: 384 });
    await rm3(join3(job.dir, "source.part"), { force: true }).catch(() => {
    });
    await touch(job);
    job.resolveInfo(job.info);
  };
  const downloadFrom = async (job, url, keyHex) => {
    const signal = job.abort.signal;
    const partPath = join3(job.dir, "source.part");
    const fetched = await fetchHead(url, { signal, maxBytes: job.foreground ? MEDIA_LIMITS.maxHeadBytes : MEDIA_LIMITS.prefetchMaxBytes });
    const head = fetched.head;
    const total = fetched.total;
    await resetQualityDir(job.dir);
    await writeFile3(partPath, head, { mode: 384 });
    job.have = head.length;
    job.total = total;
    const remuxer = new Remuxer(head, keyHex, {
      segmentTargetBytes: MEDIA_LIMITS.segmentTargetBytes,
      segmentMaxBytes: MEDIA_LIMITS.segmentMaxBytes
    });
    if (job.info?.segmentCount > 0 && job.info.segmentCount !== remuxer.segmentCount) {
      throw new HttpError(502, "MEDIA_SOURCE_MISMATCH", "备用源的分段结构与主源不一致");
    }
    const { segmentBytes: _segmentBytes, segmentNeeds: _segmentNeeds, ...infoBase } = remuxer.info();
    const info = {
      ...infoBase,
      episodeId: job.episodeId,
      definition: job.definition,
      bytes: total,
      complete: false
    };
    job.remuxer = remuxer;
    job.info = info;
    job.state = "streaming";
    await writeFile3(initPathOf(job.dir), remuxer.init, { mode: 384 });
    await writeFile3(infoPathOf(job.dir), JSON.stringify(info), { mode: 384 });
    job.resolveInfo(info);
    log(
      `[media] 解析 ${job.episodeId} ${job.definition} codec=${info.codec} 时长=${info.durationMs}ms 分段=${info.segmentCount} 总字节=${total}`
    );
    const writeHandle = await open(partPath, "a");
    const readHandle = await open(partPath, "r");
    const source = {
      size: total,
      read: (from, to) => readRange(readHandle, from, to)
    };
    try {
      let existingSegments = 0;
      while (await exists(segmentPathOf(job.dir, existingSegments + 1))) existingSegments += 1;
      if (existingSegments > 0) {
        remuxer.nextSegment = Math.min(existingSegments, remuxer.segmentCount);
        for (let seq = 1; seq <= remuxer.nextSegment; seq += 1) job.segments.add(seq);
      }
      await writeSegments(job, remuxer, source, job.have);
      let lastError = null;
      for (let attempt = 0; attempt <= MEDIA_LIMITS.rangeRetries; attempt += 1) {
        try {
          while (job.have < total) {
            if (signal.aborted) throw new HttpError(499, "MEDIA_ABORTED", "下载已取消");
            if (!job.foreground && (job.segments.size >= 1 || job.have >= MEDIA_LIMITS.prefetchMaxBytes)) {
              job.state = "prefetched";
              await new Promise((resolve) => {
                const wake = () => {
                  signal.removeEventListener("abort", wake);
                  job.wake = null;
                  resolve();
                };
                job.wake = wake;
                signal.addEventListener("abort", wake, { once: true });
                if (signal.aborted || job.foreground) wake();
              });
              if (signal.aborted) throw aborted();
              job.state = "streaming";
            }
            const from = job.have;
            const to = Math.min(
              from + MEDIA_LIMITS.blockBytes - 1,
              total - 1,
              job.foreground ? total - 1 : MEDIA_LIMITS.prefetchMaxBytes - 1
            );
            const block = await requestRange(url, from, to, { signal });
            const chunk = block.bytes.length > to - from + 1 ? block.bytes.subarray(0, to - from + 1) : block.bytes;
            if (chunk.length === 0) throw new HttpError(502, "MEDIA_TRANSPORT", "视频地址返回空数据");
            let written = 0;
            while (written < chunk.length) {
              const { bytesWritten } = await writeHandle.write(chunk, written, chunk.length - written);
              if (!bytesWritten) throw new HttpError(502, "MEDIA_TRANSPORT", "写入本地缓存失败");
              written += bytesWritten;
            }
            job.have = from + written;
            await writeSegments(job, remuxer, source, job.have);
            const percent = Math.floor(job.have / total * 100);
            if (percent >= job.nextLogPercent) {
              log(`[media] 下载 ${job.episodeId} ${job.definition} ${percent}%（${job.have}/${total}）`);
              job.nextLogPercent = Math.min(100, job.nextLogPercent + 25);
            }
          }
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (isAborted(error) || signal.aborted) throw error;
          if (attempt >= MEDIA_LIMITS.rangeRetries) break;
          log(`[media] 下载中断（${error?.code ?? "UNKNOWN"}），从 ${job.have} 字节续传`);
          await sleep(MEDIA_LIMITS.rangeRetryDelayMs * (attempt + 1));
        }
      }
      if (lastError) throw lastError;
      await writeSegments(job, remuxer, source, total);
      if (!remuxer.done) throw new HttpError(502, "MEDIA_TRUNCATED", "视频数据不完整");
      if (job.info.segmentCount !== job.segments.size) {
        throw new HttpError(500, "MEDIA_SEGMENT_MISMATCH", "分段数量与解析结果不一致");
      }
      await markReady(job);
    } finally {
      await writeHandle.close().catch(() => {
      });
      await readHandle.close().catch(() => {
      });
    }
  };
  const fail2 = (job, error) => {
    const mapped = asHttpError(error);
    job.state = "error";
    job.error = mapped;
    job.rejectInfo(mapped);
    rejectWaiters(job, mapped);
    log(`[media] 失败 ${job.episodeId} ${job.definition}：${mapped.code} ${mapped.message}`);
  };
  const runJob = async (job, urls, keyHex) => {
    let lastError = null;
    for (let index = 0; index < urls.length; index += 1) {
      try {
        await downloadFrom(job, urls[index], keyHex);
        return;
      } catch (error) {
        lastError = error;
        if (isAborted(error) || job.abort.signal.aborted) {
          fail2(job, error);
          return;
        }
        log(`[media] 源 ${index + 1}/${urls.length} 失败：${error?.code ?? "UNKNOWN"} ${error?.message ?? ""}`);
        if (job.served > 0) break;
        job.have = 0;
        job.total = 0;
        await resetQualityDir(job.dir).catch(() => {
        });
      }
    }
    fail2(job, lastError ?? new Error("没有可用的播放地址"));
  };
  const startDefinition = async (episodeId, definition, demand, create) => {
    const key = `${episodeId}:${definition}`;
    const previous = definitionStarts.get(key);
    const task = (async () => {
      if (previous) await previous.catch(() => {
      });
      wanted(demand);
      const running = findDefinitionJob(episodeId, definition);
      if (running && running.state !== "error" && !running.abort.signal.aborted) return attachDemand(running, demand);
      if (running) {
        await running.task;
        forgetJob(running);
      }
      wanted(demand);
      demands.set(demand.key, demand);
      return create();
    })();
    definitionStarts.set(key, task);
    try {
      return await task;
    } finally {
      if (definitionStarts.get(key) === task) definitionStarts.delete(key);
    }
  };
  const startJob = async ({ episodeId, quality, definition, dir, cached }) => {
    const demand = demandFor(`${episodeId}:${quality}`);
    wanted(demand);
    if (cached) return startDefinition(episodeId, definition, demand, () => createJob({ episodeId, quality, definition, dir, info: cached.info, cached: true, demand }));
    const result = await sdk.resolvePlayback(episodeId);
    wanted(demand);
    const playback = result?.playback;
    if (!playback || !Array.isArray(playback.streams) || playback.streams.length === 0) {
      throw new HttpError(502, "CONTENT_UNAVAILABLE", "内容不可用");
    }
    if (playback.protected === true && !result?.contentKey?.key) {
      throw new HttpError(502, "DRM_PROTECTED", "内容受 DRM 保护，无法取得内容密钥");
    }
    const stream = pickStream(playback.streams, quality);
    if (!stream) throw new HttpError(502, "CONTENT_UNAVAILABLE", "没有可用的播放地址");
    return startDefinition(episodeId, stream.definition, demand, async () => {
      const cachedTarget = await readCachedDefinition(episodeId, stream.definition);
      wanted(demand);
      if (cachedTarget) {
        return createJob({
          episodeId,
          quality,
          definition: cachedTarget.definition,
          dir: cachedTarget.dir,
          info: cachedTarget.info,
          cached: true,
          demand
        });
      }
      const keyHex = playback.protected === true ? result.contentKey.key : null;
      const targetDir = qualityDirOf(episodeId, stream.definition);
      await mkdir3(targetDir, { recursive: true, mode: 448 });
      wanted(demand);
      const job = createJob({ episodeId, quality, definition: stream.definition, dir: targetDir, info: null, cached: false, demand });
      job.info = { episodeId, definition: stream.definition, segmentCount: 0, complete: false };
      const urls = [stream.url, stream.backup_url].filter((url) => typeof url === "string" && url);
      job.task = runJob(job, urls, keyHex).catch(() => {
      });
      return job;
    });
  };
  const ensureJob = async (episodeId, quality, background = false, retried = false) => {
    if (disposed || clearing) throw aborted();
    const key = `${episodeId}:${quality}`;
    const demand = demandFor(key);
    if (!background) demand.foreground = true;
    wanted(demand);
    const existing = findJob(episodeId, quality);
    if (existing && existing.state !== "error" && !existing.abort.signal.aborted) {
      existing.lastUsed = Date.now();
      return attachDemand(existing, demand);
    }
    if (existing) {
      await existing.task;
      forgetJob(existing);
      demands.set(key, demand);
    }
    const pendingJob = pending.get(key);
    if (pendingJob) {
      try {
        return attachDemand(await pendingJob, demand);
      } catch (error) {
        if (!background && !retried && isAborted(error) && !disposed && !clearing) {
          return ensureJob(episodeId, quality, false, true);
        }
        throw error;
      }
    }
    const task = (async () => {
      const cached = await findCached(episodeId, quality);
      const job = await startJob({
        episodeId,
        quality,
        definition: cached?.definition ?? quality,
        dir: cached?.dir ?? qualityDirOf(episodeId, quality),
        cached
      });
      await job.infoReady;
      evict();
      return job;
    })();
    pending.set(key, task);
    try {
      return await task;
    } finally {
      if (pending.get(key) === task) pending.delete(key);
      if (!demand.job && !demand.tokens.size && demands.get(key) === demand) demands.delete(key);
    }
  };
  const readSegment = async (job, seq) => {
    await waitForSegment(job, seq);
    job.served += 1;
    job.lastUsed = Date.now();
    void touch(job);
    return readFile3(segmentPathOf(job.dir, seq));
  };
  return {
    /** 只预取下一集开头；正式播放会提升同一任务，取消不能中断已提升的任务。 */
    async prefetch(episodeId, quality, token) {
      if (disposed || clearing || (cancelledTokens.get(token) || 0) > Date.now()) return { accepted: false };
      if (warmups.has(token)) return { accepted: true };
      if (warmups.size >= MEDIA_LIMITS.prefetchMaxJobs) return { accepted: false };
      if ([...jobs.values()].some((job) => job.foreground && !job.complete && job.state !== "error")) return { accepted: false };
      const demand = demandFor(`${episodeId}:${quality}`);
      demand.tokens.add(token);
      const timer = setTimeout(() => cancelPrefetch(token), MEDIA_LIMITS.prefetchTtlMs);
      timer.unref?.();
      warmups.set(token, { demand, timer });
      try {
        const job = await ensureJob(episodeId, quality, true);
        await job.infoReady;
        return { accepted: warmups.has(token) };
      } catch (error) {
        cancelPrefetch(token);
        throw error;
      }
    },
    cancelPrefetch(token) {
      cancelPrefetch(token);
      return { ok: true };
    },
    /** /stream/info：只返回面板拼 MSE 需要的元数据，不含直链与密钥。 */
    async info(episodeId, quality) {
      const job = await ensureJob(episodeId, quality);
      await job.infoReady;
      return {
        codec: job.info.codec,
        durationMs: job.info.durationMs,
        segmentCount: job.info.segmentCount,
        timescale: job.info.timescale,
        mime: job.info.mime,
        definition: job.info.definition,
        bytes: job.info.bytes ?? null
      };
    },
    /** /stream/init：解密后的 init segment（ftyp + moov）。 */
    async init(episodeId, quality) {
      const job = await ensureJob(episodeId, quality);
      await job.infoReady;
      job.lastUsed = Date.now();
      return readFile3(initPathOf(job.dir));
    },
    /** /stream/segment：seq 从 1 开始，连续 30 秒没有新分段落盘才超时。 */
    async segment(episodeId, quality, seq) {
      const job = await ensureJob(episodeId, quality);
      await job.infoReady;
      if (!Number.isFinite(job.info.segmentCount) || seq > job.info.segmentCount) {
        throw new HttpError(404, "SEGMENT_NOT_FOUND", "分段编号超出范围");
      }
      return { seq, bytes: await readSegment(job, seq) };
    },
    /** POST /cache/clear：停掉任务、等在途任务收敛，再释放占用并清空 video/ 与 covers/。 */
    async clearCache() {
      clearing = true;
      for (const token of [...warmups.keys()]) cancelPrefetch(token);
      try {
        const waiting = [...pending.values()];
        for (const job of jobs.values()) job.abort.abort();
        await Promise.allSettled(waiting);
        for (const job of jobs.values()) job.abort.abort();
        const inflight = [...jobs.values()];
        await Promise.allSettled(inflight.map((job) => job.task).filter(Boolean));
        for (const job of inflight) cache.release(job.dir);
        jobs.clear();
        demands.clear();
        const result = await cache.clear();
        return { ok: true, removed: (result.videos ?? 0) + (result.covers ?? 0) };
      } finally {
        clearing = false;
      }
    },
    stats() {
      return {
        jobs: [...jobs.values()].map((job) => ({
          episodeId: job.episodeId,
          definition: job.definition,
          state: job.state,
          segments: job.segments.size,
          segmentCount: job.info?.segmentCount ?? 0,
          have: job.have,
          total: job.total,
          served: job.served
        }))
      };
    },
    dispose() {
      disposed = true;
      for (const token of [...warmups.keys()]) cancelPrefetch(token);
      for (const job of jobs.values()) {
        job.abort.abort();
        cache.release(job.dir);
      }
      jobs.clear();
      pending.clear();
      demands.clear();
    }
  };
}

// src/background/media/transcode.js
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir as mkdir4, open as open2, readFile as readFile4, rename as rename2, rm as rm4, stat as stat3, writeFile as writeFile4 } from "node:fs/promises";
import { join as join4 } from "node:path";
var H264_MIME = "video/mp4";
var H264_CODEC = "avc1.640028,mp4a.40.2";
var DOWNLOAD_SHARE = 40;
var FFMPEG_FALLBACKS = [
  process.env.SNOW_HONGGUO_FFMPEG || "",
  "ffmpeg",
  "ffmpeg.exe",
  "C:\\ffmpeg\\bin\\ffmpeg.exe"
].filter(Boolean);
var safeName = (value) => String(value ?? "").replace(/[^\w.-]/g, "") || "episode";
var readJson = (path) => readFile4(path, "utf8").then(
  (text) => JSON.parse(text),
  () => null
);
var spawnOnce = (bin, args) => new Promise((resolve, reject) => {
  const child = spawn(bin, args, { windowsHide: true });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-2e3);
  });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve();
    else reject(new Error(stderr.trim() || `退出码 ${code}`));
  });
});
function createTranscoder({ media, cache, log = () => {
} }) {
  const jobs = /* @__PURE__ */ new Map();
  const queue = [];
  let queueRunning = false;
  let ffmpegBin = "";
  let ffmpegChecked = false;
  let ffmpegError = "";
  let ffmpegProbe = null;
  const jobDir = (episodeId, definition) => join4(cache.videoDir, safeName(episodeId), `${safeName(definition)}-h264`);
  const outPath = (dir) => join4(dir, "h264.mp4");
  const srcPath = (dir) => join4(dir, "source.mp4");
  const metaPath = (dir) => join4(dir, "meta.json");
  const snapshot = (job) => ({
    status: job.status,
    progress: Math.max(0, Math.min(100, Math.round(job.progress))),
    bytes: job.bytes,
    durationMs: job.durationMs,
    segmentCount: job.segmentCount,
    definition: job.definition,
    mime: H264_MIME,
    codec: H264_CODEC,
    error: job.error,
    // 未探测过 ffmpeg 时按可用处理，让面板敢显示入口；真失败会落到 unavailable。
    ffmpeg: Boolean(ffmpegBin) || !ffmpegChecked
  });
  const resolveFfmpeg = async () => {
    if (ffmpegBin) return ffmpegBin;
    if (ffmpegChecked) {
      throw Object.assign(new Error(ffmpegError || "未找到 ffmpeg"), { code: "FFMPEG_UNAVAILABLE" });
    }
    if (!ffmpegProbe) {
      ffmpegProbe = (async () => {
        try {
          for (const candidate of FFMPEG_FALLBACKS) {
            try {
              await spawnOnce(candidate, ["-hide_banner", "-version"]);
              ffmpegBin = candidate;
              log(`[transcode] 使用 ffmpeg：${candidate}`);
              return candidate;
            } catch {
            }
          }
          ffmpegError = "未找到 ffmpeg（装到 PATH，或用 SNOW_HONGGUO_FFMPEG 指定路径）";
          throw Object.assign(new Error(ffmpegError), { code: "FFMPEG_UNAVAILABLE" });
        } finally {
          ffmpegChecked = true;
          ffmpegProbe = null;
        }
      })();
    }
    return ffmpegProbe;
  };
  const runFfmpeg = (bin, args, { durationMs, onProgress, signal }) => new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", onAbort);
      fn(value);
    };
    const onAbort = () => {
      try {
        child.kill();
      } catch {
      }
      finish(reject, Object.assign(new Error("转码已取消"), { code: "CANCELLED" }));
    };
    child.stdout?.on("data", (chunk2) => {
      const matched = /out_time_us=(\d+)/.exec(String(chunk2));
      if (matched && durationMs > 0) {
        const ratio = Math.min(1, Number(matched[1]) / 1e3 / durationMs);
        onProgress(ratio * 100);
      }
    });
    child.stderr?.on("data", (chunk2) => {
      stderr = (stderr + chunk2).slice(-4e3);
    });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      if (code === 0) finish(resolve);
      else finish(reject, new Error(stderr.trim() || `ffmpeg 退出码 ${code}`));
    });
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
  const evict = (keep) => {
    if (jobs.size <= MEDIA_LIMITS.transcodeMaxJobs) return;
    const candidates = [...jobs.values()].filter((job) => job !== keep && !job.promise).sort((left, right) => (left.lastUsed ?? 0) - (right.lastUsed ?? 0));
    for (const job of candidates) {
      if (jobs.size <= MEDIA_LIMITS.transcodeMaxJobs) break;
      jobs.delete(job.key);
      log(`[transcode] 淘汰任务 ${job.key}`);
    }
  };
  const ensureJob = async (episodeId, quality) => {
    const key = `${episodeId}:${quality}`;
    const existing = jobs.get(key);
    if (existing) return existing;
    const info2 = await media.info(episodeId, quality);
    const definition = info2.definition || quality;
    const dir = jobDir(episodeId, definition);
    const job = {
      key,
      episodeId,
      quality,
      definition,
      dir,
      durationMs: info2.durationMs || 0,
      segmentCount: info2.segmentCount || 0,
      status: "idle",
      progress: 0,
      bytes: 0,
      error: null,
      promise: null,
      lastUsed: Date.now(),
      abort: new AbortController()
    };
    const meta = await readJson(metaPath(dir));
    if (meta && existsSync(outPath(dir))) {
      job.status = "done";
      job.progress = 100;
      job.bytes = Number(meta.bytes) || 0;
      job.durationMs = Number(meta.durationMs) || job.durationMs;
    }
    jobs.set(key, job);
    evict(job);
    return job;
  };
  const buildSource = async (job) => {
    await mkdir4(job.dir, { recursive: true });
    cache.markInUse?.(job.dir);
    const target = srcPath(job.dir);
    const handle = await open2(target, "w");
    try {
      let written = 0;
      const init = await media.init(job.episodeId, job.quality);
      await handle.write(init);
      written += init.length;
      for (let seq = 1; seq <= job.segmentCount; seq += 1) {
        if (job.abort.signal.aborted) {
          throw Object.assign(new Error("转码已取消"), { code: "CANCELLED" });
        }
        const { bytes } = await media.segment(job.episodeId, job.quality, seq);
        await handle.write(bytes);
        written += bytes.length;
        job.progress = Math.round(seq / Math.max(1, job.segmentCount) * DOWNLOAD_SHARE);
      }
      return written;
    } finally {
      await handle.close();
    }
  };
  const run2 = async (job) => {
    try {
      job.error = null;
      const bin = await resolveFfmpeg();
      job.status = "download";
      job.progress = 0;
      const sourceBytes = await buildSource(job);
      if (job.abort.signal.aborted) return;
      job.status = "transcode";
      job.progress = DOWNLOAD_SHARE;
      const out = outPath(job.dir);
      const tmp = `${out}.tmp.mp4`;
      const args = [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-progress",
        "pipe:1",
        "-i",
        srcPath(job.dir),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "26",
        "-maxrate",
        "1200k",
        "-bufsize",
        "2400k",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        tmp
      ];
      await runFfmpeg(bin, args, {
        durationMs: job.durationMs,
        signal: job.abort.signal,
        onProgress: (percent) => {
          job.progress = DOWNLOAD_SHARE + percent * (100 - DOWNLOAD_SHARE) / 100;
        }
      });
      const result = await stat3(tmp);
      await rename2(tmp, out);
      await writeFile4(
        metaPath(job.dir),
        JSON.stringify({
          bytes: result.size,
          sourceBytes,
          durationMs: job.durationMs,
          definition: job.definition,
          mime: H264_MIME,
          codec: H264_CODEC,
          createdAt: Date.now()
        })
      );
      job.status = "done";
      job.progress = 100;
      job.bytes = result.size;
      log(`[transcode] ${job.key} 完成：${Math.round(result.size / 1024 / 1024)}MB / ${Math.round(job.durationMs / 1e3)}s`);
    } finally {
      await Promise.allSettled([
        rm4(srcPath(job.dir), { force: true }),
        rm4(`${outPath(job.dir)}.tmp.mp4`, { force: true })
      ]);
      cache.release?.(job.dir);
    }
  };
  const pumpQueue = () => {
    if (queueRunning) return;
    const item = queue.shift();
    if (!item) return;
    queueRunning = true;
    item.run().then(item.resolve, item.reject).finally(() => {
      queueRunning = false;
      pumpQueue();
    });
  };
  const enqueue = (job) => new Promise((resolve, reject) => {
    queue.push({ job, run: () => run2(job), resolve, reject });
    pumpQueue();
  });
  const start2 = async (episodeId, quality) => {
    const job = await ensureJob(episodeId, quality);
    job.lastUsed = Date.now();
    if (job.status === "done" || job.promise) return snapshot(job);
    if (job.status === "error" || job.status === "unavailable" || job.abort.signal.aborted) {
      job.status = "idle";
      job.abort = new AbortController();
    }
    job.status = "queued";
    job.progress = 0;
    job.promise = enqueue(job).catch((error) => {
      if (error?.code === "CANCELLED") {
        job.status = "idle";
        job.progress = 0;
        return;
      }
      job.status = error?.code === "FFMPEG_UNAVAILABLE" ? "unavailable" : "error";
      job.error = String(error?.message || error);
      log(`[transcode] ${job.key} 失败：${job.error}`);
    }).finally(() => {
      job.promise = null;
      job.lastUsed = Date.now();
    });
    return snapshot(job);
  };
  const info = async (episodeId, quality) => {
    const job = await ensureJob(episodeId, quality);
    job.lastUsed = Date.now();
    return snapshot(job);
  };
  const chunk = async (episodeId, quality, offset, length) => {
    const job = await ensureJob(episodeId, quality);
    job.lastUsed = Date.now();
    if (job.status !== "done") {
      throw new HttpError(409, "TRANSCODE_NOT_READY", "转码尚未完成");
    }
    const file = outPath(job.dir);
    const meta = await stat3(file);
    const from = Math.max(0, Math.min(Number(offset) || 0, meta.size));
    const wanted = Number(length) || MEDIA_LIMITS.blockBytes;
    const size = Math.max(0, Math.min(wanted, meta.size - from));
    if (size <= 0) throw new HttpError(416, "RANGE_NOT_SATISFIABLE", "偏移超出文件范围");
    if (base64Length(size) > MEDIA_LIMITS.maxBase64Bytes) {
      throw new HttpError(500, "BINARY_TOO_LARGE", "分块过大");
    }
    const handle = await open2(file, "r");
    try {
      const buffer = Buffer.alloc(size);
      let read = 0;
      while (read < size) {
        const { bytesRead } = await handle.read(buffer, read, size - read, from + read);
        if (!bytesRead) throw new HttpError(502, "TRANSCODE_TRUNCATED", "转码结果不完整");
        read += bytesRead;
      }
      return { base64: buffer.toString("base64"), offset: from, length: size, total: meta.size };
    } finally {
      await handle.close();
    }
  };
  const clear = async () => {
    const waiting = queue.splice(0, queue.length);
    for (const item of waiting) {
      item.reject(Object.assign(new Error("转码已取消"), { code: "CANCELLED" }));
    }
    const active = [...jobs.values()];
    for (const job of active) job.abort.abort();
    await Promise.allSettled(active.map((job) => job.promise).filter(Boolean));
    for (const job of active) cache.release?.(job.dir);
    jobs.clear();
  };
  return { info, start: start2, chunk, clear, snapshot };
}

// src/background/paths.js
import { createRequire as createRequire2 } from "node:module";
import { tmpdir } from "node:os";
import { join as join5 } from "node:path";
async function resolvePluginDataDir({ log = () => {
} } = {}) {
  const override = String(process.env.SNOW_HONGGUO_DATA_DIR ?? "").trim();
  if (override) {
    log(`使用环境变量指定的数据目录：${override}`);
    return override;
  }
  try {
    const require2 = createRequire2(import.meta.url);
    const electron = require2("electron");
    const app = electron?.app ?? electron?.default?.app;
    const userData = app?.getPath?.("userData");
    if (typeof userData === "string" && userData) {
      return join5(userData, "plugin-data", PLUGIN_ID);
    }
  } catch (error) {
    log(`Electron 不可用，改用回退数据目录：${error?.message ?? error}`);
  }
  const fallback = join5(tmpdir(), "snow-app-plugin-data", PLUGIN_ID);
  log(`使用回退数据目录：${fallback}`);
  return fallback;
}

// src/background/sdk.js
import { mkdir as mkdir5, readFile as readFile5, rename as rename3, rm as rm5, stat as stat4, writeFile as writeFile5 } from "node:fs/promises";
import { dirname as dirname2, join as join6 } from "node:path";

// src/background/throttle.js
var defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function createScheduler({ minIntervalMs = 300, now = Date.now, sleep: sleep2 = defaultSleep } = {}) {
  let tail = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;
  const lastByKey = /* @__PURE__ */ new Map();
  const stats = { runs: 0, waits: 0 };
  const run2 = (key, task) => {
    const normalizedKey = String(key ?? "default");
    const result = tail.then(async () => {
      const lastForThisKey = lastByKey.get(normalizedKey) ?? Number.NEGATIVE_INFINITY;
      const earliest = Math.max(lastStart + minIntervalMs, lastForThisKey + minIntervalMs);
      const waitMs = Math.ceil(earliest - now());
      if (waitMs > 0) {
        stats.waits += 1;
        await sleep2(waitMs);
      }
      const startedAt = now();
      lastStart = startedAt;
      lastByKey.set(normalizedKey, startedAt);
      stats.runs += 1;
      return task();
    });
    tail = result.then(
      () => void 0,
      () => void 0
    );
    return result;
  };
  return { run: run2, stats, minIntervalMs };
}
function retryDelayFor(error, { maxWaitMs = 2e3 } = {}) {
  if (error?.retryable !== true) return 0;
  const ms = Number(error?.retryAfterMs);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(Math.ceil(ms), maxWaitMs);
}

// src/background/util.js
var truncateChars = (value, max) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
};
async function mapWithConcurrency(items, limit, fn) {
  const list = Array.from(items ?? []);
  if (list.length === 0) return [];
  const size = Math.max(1, Math.min(Number(limit) || 1, list.length));
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    for (; ; ) {
      const index = next;
      next += 1;
      if (index >= list.length) return;
      try {
        results[index] = await fn(list[index], index);
      } catch {
        results[index] = void 0;
      }
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}
function createTtlCache({ ttlMs = 5 * 60 * 1e3, max = 200, now = Date.now } = {}) {
  const map = /* @__PURE__ */ new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (hit.expiresAt <= now()) {
        map.delete(key);
        return null;
      }
      map.delete(key);
      map.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { value, expiresAt: now() + ttlMs });
      while (map.size > max) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
    },
    delete(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    }
  };
}
function withSingleFlight(map, key, task) {
  const existing = map.get(key);
  if (existing) return existing;
  const promise = (async () => task())();
  map.set(key, promise);
  const clear = () => {
    if (map.get(key) === promise) map.delete(key);
  };
  promise.then(clear, clear);
  return promise;
}
var byteLength = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
var compactOptions = (options = {}) => Object.fromEntries(Object.entries(options).filter(([, value]) => value !== void 0 && value !== null && value !== ""));

// src/background/sdk.js
var SDK_METHODS = ["discover", "search", "getSeries", "listEpisodes", "resolvePlayback", "resetDevice"];
function createProfileStore(filePath, { log = () => {
} } = {}) {
  return {
    async load() {
      try {
        return await readFile5(filePath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        log(`[profile] 读取失败：${error?.message ?? error}`);
        throw error;
      }
    },
    async save(json) {
      await mkdir5(dirname2(filePath), { recursive: true, mode: 448 });
      const tempPath = `${filePath}.${process.pid}.tmp`;
      await writeFile5(tempPath, json, { mode: 384 });
      await rename3(tempPath, filePath);
    },
    async reset() {
      await rm5(filePath, { force: true });
    }
  };
}
function createSdk({
  dataDir,
  clientFactory: clientFactory2,
  installPath = "",
  log = () => {
  },
  timeoutMs = 2e4,
  retryAttempts = 2,
  maxDeviceResets = 2,
  minIntervalMs = 300,
  maxBackoffMs = 2e3,
  now = Date.now,
  sleep: sleep2
} = {}) {
  if (typeof dataDir !== "string" || !dataDir) throw new TypeError("createSdk 需要 dataDir");
  if (typeof clientFactory2 !== "function") throw new TypeError("createSdk 需要 clientFactory");
  const profilePath = join6(dataDir, "anonymous.json");
  const profile = createProfileStore(profilePath, { log });
  const wait = sleep2 ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const scheduler = createScheduler({ minIntervalMs, now, sleep: wait });
  const state = {
    clientPromise: null,
    loadedAt: null,
    loadMs: null,
    resets: 0,
    lastResetAt: null,
    lastError: null
  };
  const buildClient = async () => {
    const startedAt = now();
    const client = await clientFactory2({
      profile,
      timeoutMs,
      retryAttempts,
      // 设备恢复统一由本模块负责；SDK 内部再换设备会让一次失败连续换多台。
      deviceResets: 0,
      log: (line) => log(`[client] ${line}`)
    });
    for (const method of SDK_METHODS) {
      if (typeof client?.[method] !== "function") {
        throw new Error(`openhongguo 客户端缺少方法：${method}`);
      }
    }
    state.loadedAt = startedAt;
    state.loadMs = now() - startedAt;
    return client;
  };
  const getClient = () => {
    if (!state.clientPromise) {
      state.clientPromise = buildClient().catch((error) => {
        state.clientPromise = null;
        state.lastError = describeError(error);
        throw error;
      });
    }
    return state.clientPromise;
  };
  const invalidateClient = (reason) => {
    if (state.clientPromise) log(`[client] 丢弃当前客户端（${reason}）`);
    state.clientPromise = null;
  };
  const resetDeviceOnce = async (reason) => {
    state.resets += 1;
    state.lastResetAt = now();
    log(`[reset] ${reason} -> 重置匿名设备（第 ${state.resets} 次）`);
    let client = null;
    try {
      client = await getClient();
    } catch (error) {
      state.lastError = describeError(error);
      return;
    }
    try {
      await client.resetDevice();
    } catch (error) {
      state.lastError = describeError(error);
      log(`[reset] resetDevice 失败：${errorCodeOf(error)}，丢弃客户端下次重建`);
      invalidateClient("resetDevice 失败");
    }
  };
  const call = async (label, key, task) => {
    let retried = false;
    for (; ; ) {
      try {
        return await scheduler.run(key, task);
      } catch (error) {
        const delay = retried ? 0 : retryDelayFor(error, { maxWaitMs: maxBackoffMs });
        if (delay > 0) {
          retried = true;
          log(`[throttle] ${label} 限流（${errorCodeOf(error)}），${delay}ms 后重试`);
          await wait(delay);
          continue;
        }
        throw error;
      }
    }
  };
  const execute = async (label, key, method, args) => {
    let resets = 0;
    for (; ; ) {
      try {
        return await call(label, key, async () => {
          const client = await getClient();
          return client[method](...args);
        });
      } catch (error) {
        const code = errorCodeOf(error);
        state.lastError = describeError(error);
        log(`[client] ${label} 失败：${code}${error?.message ? ` - ${error.message}` : ""}`);
        if (!isDeviceRecoveryCode(code) || resets >= maxDeviceResets) throw error;
        resets += 1;
        await resetDeviceOnce(code);
      }
    }
  };
  const inflightPlayback = /* @__PURE__ */ new Map();
  const api = {
    /** 加载客户端（不发网络请求），用于 /probe/wasm。 */
    runtimeInfo: async () => {
      await getClient();
      let bytes = null;
      if (installPath) {
        try {
          bytes = (await stat4(join6(installPath, "dist", "openhongguo.wasm"))).size;
        } catch {
          bytes = null;
        }
      }
      return {
        loaded: true,
        loadMs: state.loadMs,
        hasGlobal: typeof globalThis.__openhongguo?.newClient === "function",
        bytes,
        path: installPath ? join6(installPath, "dist", "openhongguo.wasm") : null
      };
    },
    discover: (options = {}) => execute("discover", "discover", "discover", [compactOptions(options)]),
    shortRank: (options = {}) => execute("shortRank", "shortRank", "shortRank", [compactOptions(options)]),
    shortFilterPanel: (genre = "") => execute("shortFilterPanel", "shortFilterPanel", "shortFilterPanel", [String(genre)]),
    shortFilter: (options = {}) => execute("shortFilter", "shortFilter", "shortFilter", [compactOptions(options)]),
    search: (query, options = {}) => execute("search", "search", "search", [String(query ?? ""), compactOptions(options)]),
    suggest: (prefix) => execute("suggest", "suggest", "suggest", [String(prefix ?? "")]),
    hotSearch: () => execute("hotSearch", "hotSearch", "hotSearch", []),
    getSeries: (seriesId) => execute("getSeries", "getSeries", "getSeries", [String(seriesId)]),
    listEpisodes: (seriesId, options = {}) => execute("listEpisodes", "listEpisodes", "listEpisodes", [String(seriesId), compactOptions(options)]),
    /**
     * 同一 episodeId 的并发调用只跑一次；返回原始结果（含 streams 与 contentKey）。
     * 注意：直链与密钥只允许在后台进程内使用，不能经 HTTP 返回给面板。
     */
    resolvePlayback: (episodeId) => {
      const key = String(episodeId);
      const existing = inflightPlayback.get(key);
      if (existing) return existing;
      const task = execute("resolvePlayback", "resolvePlayback", "resolvePlayback", [key]);
      inflightPlayback.set(key, task);
      const clear = () => {
        if (inflightPlayback.get(key) === task) inflightPlayback.delete(key);
      };
      task.then(clear, clear);
      return task;
    },
    resetDevice: async () => {
      await resetDeviceOnce("manual");
    },
    stats: () => ({
      ready: state.clientPromise !== null,
      loaded: state.loadMs !== null,
      profilePath,
      loadMs: state.loadMs,
      resets: state.resets,
      lastResetAt: state.lastResetAt,
      lastError: state.lastError,
      inflightPlayback: inflightPlayback.size,
      scheduler: { ...scheduler.stats, minIntervalMs }
    }),
    dispose: () => {
      invalidateClient("dispose");
      inflightPlayback.clear();
    }
  };
  return api;
}

// src/background/server.js
import { createServer } from "node:http";

// src/background/media/cover.js
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync2 } from "node:fs";
import { mkdtemp, readFile as readFile6, rm as rm6, writeFile as writeFile6 } from "node:fs/promises";
import { tmpdir as tmpdir2 } from "node:os";
import { delimiter, join as join7 } from "node:path";

// src/background/cover.js
import { lookup } from "node:dns/promises";
import { request as httpsRequest2 } from "node:https";
import { isIP } from "node:net";
var ALLOWED_COVER_SUFFIXES = [
  "fqnovelpic.com",
  "fqnovel.com",
  "byteimg.com",
  "douyinpic.com",
  "snssdk.com",
  "pstatp.com",
  "ibytedtos.com",
  "bytecdntp.com"
];
var USER_AGENT2 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
var REFERER = "https://www.hongguo.com/";
var isAllowedCoverHost = (hostname) => {
  const host = String(hostname ?? "").toLowerCase();
  if (!host || isIP(host)) return false;
  return ALLOWED_COVER_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
};
var isPrivateAddress = (address) => {
  const family = isIP(String(address ?? ""));
  if (family === 4) {
    const [a, b] = String(address).split(".").map((part) => Number(part));
    return a === 0 || a === 10 || a === 127 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224;
  }
  if (family === 6) {
    const lower = String(address).toLowerCase();
    return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80") || lower.startsWith("::ffff:127.") || lower.startsWith("::ffff:10.") || lower.startsWith("::ffff:192.168.");
  }
  return true;
};
var assertCoverUrl = (rawUrl) => {
  const text = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!text || text.length > 2048) throw new HttpError(400, "INVALID_URL", "封面地址不合法");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new HttpError(400, "INVALID_URL", "封面地址不合法");
  }
  if (url.protocol !== "https:") throw new HttpError(400, "INVALID_URL", "封面地址必须是 https");
  if (url.username || url.password) throw new HttpError(403, "URL_FORBIDDEN", "封面地址不能带账号密码");
  if (!isAllowedCoverHost(url.hostname)) {
    throw new HttpError(403, "URL_FORBIDDEN", "封面域名不在允许列表内");
  }
  return url;
};
var requestOnce = (target, { timeoutMs, maxBytes, redirects }) => new Promise((resolve, reject) => {
  let settled = false;
  let req = null;
  const fail2 = (error) => {
    if (settled) return;
    settled = true;
    try {
      req?.destroy();
    } catch {
    }
    reject(error);
  };
  req = httpsRequest2(
    target,
    {
      method: "GET",
      headers: { "user-agent": USER_AGENT2, referer: REFERER, accept: "image/*,*/*;q=0.8" },
      timeout: timeoutMs
    },
    (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) {
          fail2(new HttpError(502, "COVER_FETCH_FAILED", "封面重定向次数过多"));
          return;
        }
        let next;
        try {
          next = assertCoverUrl(new URL(res.headers.location, target).href);
        } catch (error) {
          fail2(error);
          return;
        }
        settled = true;
        resolve(requestOnce(next, { timeoutMs, maxBytes, redirects: redirects - 1 }));
        return;
      }
      if (status !== 200) {
        res.resume();
        fail2(new HttpError(502, "COVER_FETCH_FAILED", `封面地址返回 HTTP ${status}`));
        return;
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.resume();
        fail2(new HttpError(502, "COVER_TOO_LARGE", "封面图片过大"));
        return;
      }
      const contentType = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          fail2(new HttpError(502, "COVER_TOO_LARGE", "封面图片过大"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({ bytes: Buffer.concat(chunks), contentType });
      });
      res.on("error", (error) => fail2(error));
    }
  );
  req.on("timeout", () => fail2(new HttpError(502, "COVER_TIMEOUT", "封面拉取超时")));
  req.on("error", (error) => fail2(error));
  req.end();
});
async function fetchCoverBytes(url, { timeoutMs = 1e4, maxBytes = LIMITS.coverMaxBytes, redirects = 3 } = {}) {
  const target = url instanceof URL ? url : assertCoverUrl(url);
  let addresses = [];
  try {
    addresses = await lookup(target.hostname, { all: true });
  } catch {
    addresses = [];
  }
  if (addresses.length > 0 && addresses.every((item) => isPrivateAddress(item.address))) {
    throw new HttpError(403, "URL_FORBIDDEN", "封面地址解析到内网");
  }
  return requestOnce(target, { timeoutMs, maxBytes, redirects });
}

// src/background/media/cover.js
var BROWSER_IMAGE_TYPES = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
var normalizeType = (value) => String(value ?? "").split(";")[0].trim().toLowerCase();
var which = (name) => {
  const directories = String(process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extra = process.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] : process.platform === "linux" ? ["/usr/local/bin", "/usr/bin"] : [];
  const names = process.platform === "win32" ? [`${name}.exe`, name] : [name];
  for (const directory of [...directories, ...extra]) {
    for (const candidate of names) {
      const full = join7(directory, candidate);
      if (existsSync2(full)) return full;
    }
  }
  return null;
};
var findPowerShell = () => {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const legacy = join7(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (existsSync2(legacy)) return legacy;
  return which("powershell") ?? which("pwsh");
};
var WIC_SCRIPT = [
  "param([string]$InputPath, [string]$OutputPath)",
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName PresentationCore",
  "$decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create([Uri]$InputPath, 'None', 'OnLoad')",
  "$frame = $decoder.Frames[0]",
  "$scale = [Math]::Min(1.0, 320.0 / $frame.PixelWidth)",
  "if ($scale -lt 0.999) {",
  "  $bitmap = New-Object System.Windows.Media.Imaging.TransformedBitmap",
  "  $bitmap.BeginInit()",
  "  $bitmap.Source = $frame",
  "  $bitmap.Transform = New-Object System.Windows.Media.ScaleTransform($scale, $scale)",
  "  $bitmap.EndInit()",
  "  $bitmap.Freeze()",
  "} else { $bitmap = $frame }",
  "$encoder = New-Object System.Windows.Media.Imaging.JpegBitmapEncoder",
  "$encoder.QualityLevel = 60",
  "$encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))",
  "$stream = [System.IO.File]::Create($OutputPath)",
  "try { $encoder.Save($stream) } finally { $stream.Close() }"
].join("\r\n");
var converterCache;
var lastGoodKind = null;
function listImageConverters({ refresh = false } = {}) {
  if (!refresh && converterCache !== void 0) return converterCache;
  const list = [];
  if (process.platform === "darwin" && existsSync2("/usr/bin/sips")) {
    list.push({ kind: "sips", path: "/usr/bin/sips" });
  }
  const ffmpeg = which("ffmpeg");
  if (ffmpeg) list.push({ kind: "ffmpeg", path: ffmpeg });
  if (process.platform === "win32") {
    const powershell = findPowerShell();
    if (powershell) list.push({ kind: "wic", path: powershell });
  }
  converterCache = list;
  return list;
}
var run = (command, args, timeoutMs) => new Promise((resolve, reject) => {
  let settled = false;
  let stderr = "";
  const child = spawn2(command, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve();
  };
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
    }
    finish(new Error("封面转码超时"));
  }, timeoutMs);
  timer.unref?.();
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-2e3);
  });
  child.on("error", (error) => finish(error));
  child.on("close", (code) => code === 0 ? finish() : finish(new Error(stderr.trim() || `退出码 ${code}`)));
});
var isJpeg = (bytes) => bytes && bytes.length > 2 && bytes[0] === 255 && bytes[1] === 216;
var runConverter = async (converter, { input, output, scriptPath }, timeoutMs) => {
  if (converter.kind === "sips") {
    await run(
      converter.path,
      ["-s", "format", "jpeg", "-s", "formatOptions", "60", "-Z", "320", input, "--out", output],
      timeoutMs
    );
    return;
  }
  if (converter.kind === "ffmpeg") {
    await run(
      converter.path,
      ["-loglevel", "error", "-y", "-i", input, "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "5", output],
      timeoutMs
    );
    return;
  }
  await writeFile6(scriptPath, WIC_SCRIPT);
  await run(
    converter.path,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-InputPath",
      input,
      "-OutputPath",
      output
    ],
    Math.max(timeoutMs, 12e3)
  );
};
async function convertToJpeg(bytes, { timeoutMs = MEDIA_LIMITS.coverTimeoutMs } = {}) {
  if (!bytes || bytes.length === 0) return null;
  const converters = listImageConverters();
  if (converters.length === 0) return null;
  const ordered = lastGoodKind ? [...converters.filter((item) => item.kind === lastGoodKind), ...converters.filter((item) => item.kind !== lastGoodKind)] : converters;
  let dir = null;
  try {
    dir = await mkdtemp(join7(tmpdir2(), "hongguo-cover-"));
    const input = join7(dir, "in.heic");
    const output = join7(dir, "out.jpg");
    const scriptPath = join7(dir, "wic-cover.ps1");
    await writeFile6(input, bytes, { mode: 384 });
    for (const converter of ordered) {
      try {
        await runConverter(converter, { input, output, scriptPath }, timeoutMs);
        const jpeg = await readFile6(output);
        if (isJpeg(jpeg)) {
          lastGoodKind = converter.kind;
          return jpeg;
        }
      } catch {
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (dir) await rm6(dir, { recursive: true, force: true }).catch(() => {
    });
  }
}
var toBrowserImage = async (bytes, contentType) => {
  const type = normalizeType(contentType);
  if (BROWSER_IMAGE_TYPES.has(type)) return { bytes, contentType: type, converted: false };
  const jpeg = await convertToJpeg(bytes);
  if (!jpeg) return null;
  return { bytes: jpeg, contentType: "image/jpeg", converted: true };
};
function createCoverResolver({ cache, log = () => {
} } = {}) {
  if (!cache) throw new TypeError("createCoverResolver 需要 cache");
  return {
    async resolve(rawUrl) {
      const url = assertCoverUrl(rawUrl);
      const cached = await cache.readCover(url.href);
      if (cached) {
        const converted2 = await toBrowserImage(cached.bytes, cached.contentType);
        if (!converted2) {
          return { bytes: cached.bytes, contentType: cached.contentType, converted: false, cache: "hit" };
        }
        if (converted2.converted) {
          await cache.writeCover(url.href, converted2.bytes, converted2.contentType).catch((error) => {
            log(`封面转码缓存写入失败：${error?.message ?? error}`);
          });
        }
        return { ...converted2, cache: "hit" };
      }
      let fetched;
      try {
        fetched = await fetchCoverBytes(url, { maxBytes: LIMITS.coverMaxBytes });
      } catch (error) {
        log(`封面拉取失败 ${url.host}${url.pathname}：${error?.code ?? ""} ${error?.message ?? error}`);
        throw error instanceof HttpError ? error : new HttpError(502, "COVER_FETCH_FAILED", "封面拉取失败");
      }
      if (!fetched.contentType.startsWith("image/")) {
        throw new HttpError(502, "COVER_NOT_IMAGE", "封面地址返回的不是图片");
      }
      const converted = await toBrowserImage(fetched.bytes, fetched.contentType);
      const result = converted ?? { bytes: fetched.bytes, contentType: fetched.contentType, converted: false };
      await cache.writeCover(url.href, result.bytes, result.contentType).catch((error) => {
        log(`封面缓存写入失败：${error?.message ?? error}`);
      });
      return { ...result, cache: "miss" };
    }
  };
}

// src/background/cursors.js
import { createHash as createHash2 } from "node:crypto";
function createPageCursors() {
  const prefix = "hg1.";
  const cache = createTtlCache({ ttlMs: 30 * 60 * 1e3, max: 200 });
  return {
    read(value, scope) {
      if (typeof value !== "string" || !value.startsWith(prefix)) return value;
      const entry = cache.get(value);
      if (!entry || entry.scope !== scope) {
        throw new HttpError(410, "CURSOR_EXPIRED", "分页已过期，请重试以重新加载列表");
      }
      return entry.cursor;
    },
    pageInfo(page, scope) {
      const raw = typeof page?.cursor === "string" ? page.cursor : "";
      if (page?.has_more !== true || !raw) return { cursor: null, hasMore: false };
      const cursor = prefix + createHash2("sha256").update(`${scope}\0${raw}`).digest("base64url");
      cache.set(cursor, { scope, cursor: raw });
      return { cursor, hasMore: true };
    }
  };
}

// src/background/catalog.js
var SERIES_CONTENTS = /* @__PURE__ */ new Set(["all", "human", "comic_series_rank", "ai_playlet", "series_album"]);
var ID = /^[0-9A-Za-z_.-]{1,64}$/;
var FILTER_KEY = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
var forbiddenKeys = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var validFilterKey = (key) => typeof key === "string" && FILTER_KEY.test(key) && !forbiddenKeys.has(key);
var fail = (message) => {
  throw new HttpError(400, "INVALID_PARAM", message);
};
var param = (query, key, max = 64, pattern = null) => {
  const value = query.get(key) || "";
  if (value.length > max || value && pattern && !pattern.test(value)) fail(`参数 ${key} 格式不正确`);
  return value;
};
var selectionsOf = (query) => {
  const raw = param(query, "selections", 4096);
  if (!raw) return {};
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    fail("筛选条件不是有效的 JSON");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("筛选条件必须是对象");
  const entries = Object.entries(input);
  if (entries.length > 16) fail("筛选条件过多");
  const result = {};
  for (const [key, values] of entries) {
    if (!validFilterKey(key) || !Array.isArray(values) || values.length > 8) fail("筛选条件格式不正确");
    if (values.some((value) => typeof value !== "string" || value.length > 128 || /[\u0000-\u001f]/.test(value))) {
      fail("筛选值格式不正确");
    }
    const chosen = [...new Set(values.filter(Boolean))];
    if (chosen.length) result[key] = chosen;
  }
  return result;
};
var namedOptions = (raw) => {
  const seen = /* @__PURE__ */ new Set();
  return (Array.isArray(raw) ? raw : []).filter((item) => {
    if (!item || typeof item.id !== "string" || !ID.test(item.id) || typeof item.name !== "string" || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, 32).map((item) => ({ id: item.id, name: truncateChars(item.name, 48), selected: item.selected === true }));
};
var filterRows = (raw) => {
  if (!Array.isArray(raw)) throw new HttpError(502, "PROTOCOL", "筛选面板格式不正确");
  const seen = /* @__PURE__ */ new Set();
  return raw.filter((row) => {
    if (!row || !validFilterKey(row.key) || seen.has(row.key) || !Array.isArray(row.options)) return false;
    seen.add(row.key);
    return true;
  }).slice(0, 16).map((row) => {
    const values = /* @__PURE__ */ new Set();
    return {
      key: row.key,
      name: truncateChars(row.name, 48) || row.key,
      options: row.options.filter((option) => {
        if (!option || typeof option.name !== "string" || typeof option.value !== "string" || option.value.length > 128 || /[\u0000-\u001f]/.test(option.value) || values.has(option.value)) return false;
        values.add(option.value);
        return true;
      }).slice(0, 256).map((option) => ({ name: truncateChars(option.name, 48), value: option.value }))
    };
  }).filter((row) => row.options.length > 0);
};
function createCatalogHandlers({ sdk, toListItem: toListItem2, fetchPage }) {
  const panels = createTtlCache({ ttlMs: 10 * 60 * 1e3, max: 20 });
  const cursors = createPageCursors();
  const inflight = /* @__PURE__ */ new Map();
  const requireMethod = (name) => {
    if (typeof sdk[name] !== "function") throw new HttpError(503, "CATALOG_UNAVAILABLE", "当前后台不支持榜单或分类，请更新插件");
  };
  const readCursor = (query, kind) => {
    return cursors.read(param(query, "cursor", 4096), kind);
  };
  const pageInfo = cursors.pageInfo;
  const seriesItem = (raw) => {
    const item = toListItem2(raw);
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
      const page = await fetchPage(() => sdk.shortRank({ content, ...board ? { board } : {}, ...cursor ? { cursor } : {} }));
      const rawContents = Array.isArray(page?.contents) ? page.contents : [];
      const contents = namedOptions(rawContents).filter((item) => SERIES_CONTENTS.has(item.id)).map((item) => ({
        ...item,
        boards: namedOptions(rawContents.find((raw) => raw?.id === item.id)?.boards)
      }));
      const items = (Array.isArray(page?.items) ? page.items : []).filter((item) => item?.series_id != null && ID.test(String(item.series_id))).map((item) => ({
        ...seriesItem({ ...item, id: item.series_id }),
        position: Number.isInteger(item.position) && item.position > 0 ? item.position : Number.isInteger(item.rank) && item.rank > 0 ? item.rank : null,
        score: truncateChars(item.score, 80),
        promoted: item.promoted === true
      }));
      return { status: 200, payload: {
        items,
        contents,
        content: SERIES_CONTENTS.has(page?.content) ? page.content : content,
        board: typeof page?.board === "string" && ID.test(page.board) ? page.board : board,
        ...pageInfo(page, "rank")
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
        page = await fetchPage(() => sdk.shortFilter({ selections, ...cursor ? { cursor } : {} }));
      } catch (error) {
        if (cursor || error?.code !== "CONTENT_UNAVAILABLE") throw error;
        page = { items: [], has_more: false };
      }
      const items = (Array.isArray(page?.items) ? page.items : []).map(seriesItem).filter((item) => ID.test(item.id));
      return { status: 200, payload: { items, ...pageInfo(page, "filter") } };
    }
  };
}

// src/background/search-discovery.js
var ID2 = /^[0-9A-Za-z_.-]{1,64}$/;
var clean = (value, max) => truncateChars(value, max).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
var unique = (items, key, max) => {
  const seen = /* @__PURE__ */ new Set();
  return items.filter((item) => {
    if (!item || seen.has(item[key])) return false;
    seen.add(item[key]);
    return true;
  }).slice(0, max);
};
function createSearchDiscoveryHandlers({ sdk, toListItem: toListItem2 }) {
  const hotCache = createTtlCache({ ttlMs: 5 * 60 * 1e3, max: 1 });
  const suggestionCache = createTtlCache({ ttlMs: 60 * 1e3, max: 100 });
  const inflight = /* @__PURE__ */ new Map();
  const cached = (cache, key, task) => cache.get(key) || withSingleFlight(inflight, key, async () => {
    const value = await task();
    cache.set(key, value);
    return value;
  });
  const series = (raw) => unique((Array.isArray(raw) ? raw : []).map((item) => {
    if (!ID2.test(String(item?.series_id || "")) || !clean(item?.title, 160)) return null;
    return {
      ...toListItem2({ id: item.series_id, title: clean(item.title, 160), cover_url: item.cover_url, episode_count: item.episode_count }),
      position: Number.isInteger(item.position) && item.position > 0 ? item.position : null,
      score: clean(item.search_score || item.heat, 80),
      tag: clean(item.tag, 24)
    };
  }), "id", 20);
  return {
    hotSearch: async () => ({ status: 200, payload: await cached(hotCache, "hot", async () => {
      const page = await sdk.hotSearch();
      if (!page || typeof page !== "object" || Array.isArray(page)) throw new HttpError(502, "PROTOCOL", "热搜数据格式不正确");
      return {
        guesses: series(page.guesses).slice(0, 8),
        boards: (Array.isArray(page.boards) ? page.boards : []).map((board) => ({
          name: clean(board?.name, 48),
          items: series(board?.items),
          topics: unique((Array.isArray(board?.topics) ? board.topics : []).map((topic) => {
            const title = clean(topic?.title, 160);
            const query = clean(topic?.query || topic?.title, 80).slice(0, 80);
            return title && query ? { title, query, heat: clean(topic.heat, 80) } : null;
          }), "query", 20)
        })).filter((board) => board.name && (board.items.length || board.topics.length)).slice(0, 6)
      };
    }) }),
    suggest: async ({ query }) => {
      const q = (query.get("q") || "").trim();
      if (q.length > 80 || /[\u0000-\u001f\u007f]/.test(q)) throw new HttpError(400, "INVALID_PARAM", "搜索词格式不正确");
      if (!q) return { status: 200, payload: { items: [] } };
      const payload = await cached(suggestionCache, `suggest:${q}`, async () => {
        const rows = await sdk.suggest(q);
        if (!Array.isArray(rows)) throw new HttpError(502, "PROTOCOL", "联想词格式不正确");
        return { items: unique(rows.map((row) => {
          const text = clean(row?.text, 80).slice(0, 80);
          return text ? { text, query: text } : null;
        }), "query", 6) };
      });
      return { status: 200, payload };
    }
  };
}

// src/background/server.js
var HOST = "127.0.0.1";
var MAX_REQUEST_BYTES = 64 * 1024;
var ID_PATTERN = /^[0-9A-Za-z_.-]{1,64}$/;
var DEFAULT_TITLE_PATTERN = /^第\s*\d+\s*[集话]$/;
var readParam = (query, name, { required = false, maxLength = 512, pattern = null } = {}) => {
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
var readId = (query, name) => readParam(query, name, { required: true, maxLength: 64, pattern: ID_PATTERN });
var coverPath = (rawUrl) => typeof rawUrl === "string" && rawUrl ? `${ROUTES.cover}?url=${encodeURIComponent(rawUrl)}` : null;
var toCount = (value) => Number.isFinite(value) ? value : null;
var toListItem = (series) => ({
  id: String(series?.id ?? ""),
  title: String(series?.title ?? ""),
  description: truncateChars(series?.description ?? "", LIMITS.descriptionChars),
  cover: coverPath(series?.cover_url),
  count: toCount(series?.episode_count)
});
var toSeriesDetail = (series) => {
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
    subtitles: Array.isArray(series?.subtitles) ? series.subtitles.slice(0, 6).map(String) : []
  };
};
var compactEpisodes = (seriesId, episodes, { cursor = null, hasMore = false } = {}) => {
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
      truncated: true
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
      truncated: true
    };
  }
  return payload;
};
var toPlaybackSummary = (result) => {
  const playback = result?.playback;
  if (!playback || !Array.isArray(playback.streams)) {
    throw new HttpError(502, "CONTENT_UNAVAILABLE", "内容不可用");
  }
  const byDefinition = /* @__PURE__ */ new Map();
  for (const stream of playback.streams) {
    const definition = typeof stream?.definition === "string" && stream.definition ? stream.definition : "unknown";
    const bitrate = Number.isFinite(stream?.bitrate) ? stream.bitrate : null;
    const previous = byDefinition.get(definition);
    if (!previous || (bitrate ?? -1) > (previous.bitrate ?? -1)) {
      byDefinition.set(definition, {
        definition,
        bitrate,
        codec: typeof stream?.codec === "string" ? stream.codec : null
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
    durationSeconds: Number.isFinite(playback.duration_seconds) ? playback.duration_seconds : null
  };
};
function createRequestHandler({
  sdk,
  cache,
  media = null,
  transcoder = null,
  version = "0.0.0",
  log = () => {
  },
  getPort = () => 0,
  startedAt = Date.now()
}) {
  if (!sdk) throw new TypeError("createRequestHandler 需要 sdk");
  if (!cache) throw new TypeError("createRequestHandler 需要 cache");
  const seriesCache = createTtlCache({ ttlMs: LIMITS.seriesCacheTtlMs, max: LIMITS.seriesCacheMax });
  const seriesInflight = /* @__PURE__ */ new Map();
  const covers = createCoverResolver({ cache, log });
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
  const searchCursors = createPageCursors();
  const handles = {
    ...createCatalogHandlers({ sdk, toListItem, fetchPage }),
    ...createSearchDiscoveryHandlers({ sdk, toListItem }),
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
            lastError: stats.lastError?.code ?? null
          }
        }
      };
    },
    discover: async ({ query }) => {
      const cursor = readParam(query, "cursor", { maxLength: 4096 });
      const page = await fetchPage(() => sdk.discover(cursor ? { cursor } : {}));
      const items = (Array.isArray(page?.items) ? page.items : []).map(toListItem);
      return {
        status: 200,
        payload: { items, cursor: page?.cursor ?? null, hasMore: page?.has_more === true }
      };
    },
    search: async ({ query }) => {
      const q = readParam(query, "q", { required: true, maxLength: 80 });
      const cursor = searchCursors.read(readParam(query, "cursor", { maxLength: 4096 }), `search:${q}`);
      const page = await fetchPage(() => sdk.search(q, cursor ? { cursor } : {}));
      const rawItems = Array.isArray(page?.items) ? page.items : [];
      const items = rawItems.map(toListItem);
      await enrichSearchCovers(items, rawItems);
      return {
        status: 200,
        payload: { items, ...searchCursors.pageInfo(page, `search:${q}`) }
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
      for (; ; ) {
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
        payload: compactEpisodes(seriesId, collected.slice(0, LIMITS.episodesMaxItems), { cursor, hasMore })
      };
    },
    playback: async ({ query }) => {
      const episodeId = readId(query, "episodeId");
      const result = await sdk.resolvePlayback(episodeId);
      return { status: 200, payload: toPlaybackSummary(result) };
    },
    cover: async ({ query }) => {
      const rawUrl = readParam(query, "url", { required: true, maxLength: 2048 });
      const resolved = await covers.resolve(rawUrl);
      return {
        status: 200,
        body: resolved.bytes,
        headers: {
          "content-type": resolved.contentType,
          "cache-control": "public, max-age=86400",
          "x-hongguo-cache": resolved.cache,
          "x-hongguo-cover": resolved.converted ? "jpeg" : "original"
        }
      };
    },
    /** 播放元数据：只给面板拼 MSE 需要的字段，不含直链与密钥。 */
    streamInfo: async ({ query }) => {
      const engine = requireMedia();
      const episodeId = readId(query, "episodeId");
      const quality = readQuality(query);
      return { status: 200, payload: await engine.info(episodeId, quality) };
    },
    streamPrefetch: async ({ query }) => ({
      status: 200,
      payload: await requireMedia().prefetch(readId(query, "episodeId"), readQuality(query), readId(query, "token"))
    }),
    streamPrefetchCancel: async ({ query }) => ({
      status: 200,
      payload: requireMedia().cancelPrefetch(readId(query, "token"))
    }),
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
        payload: { base64: encodeBinary(segment.bytes, `segment ${seq} `), seq: segment.seq }
      };
    },
    /** 清空 video/ 与 covers/；先停转码任务，再停媒体任务并删除，保证真的清干净。 */
    cacheClear: async () => {
      try {
        await transcoder?.clear?.();
      } catch {
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
          payload: { ok: false, wasm: { loaded: false, error: mapped.code, message: mapped.message } }
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
        payload: { ok: false, id, error: { code: "UNKNOWN_METHOD", message: `未知方法：${method || "(空)"}` } }
      };
    }
  };
  const routes = /* @__PURE__ */ new Map([
    [ROUTES.health, { method: "GET", handler: handles.health }],
    [ROUTES.discover, { method: "GET", handler: handles.discover }],
    [ROUTES.rank, { method: "GET", handler: handles.rank }],
    [ROUTES.filterPanel, { method: "GET", handler: handles.filterPanel }],
    [ROUTES.filter, { method: "GET", handler: handles.filter }],
    [ROUTES.search, { method: "GET", handler: handles.search }],
    [ROUTES.suggest, { method: "GET", handler: handles.suggest }],
    [ROUTES.hotSearch, { method: "GET", handler: handles.hotSearch }],
    [ROUTES.series, { method: "GET", handler: handles.series }],
    [ROUTES.episodes, { method: "GET", handler: handles.episodes }],
    [ROUTES.playback, { method: "GET", handler: handles.playback }],
    [ROUTES.cover, { method: "GET", handler: handles.cover }],
    [MEDIA_ROUTES.streamInfo, { method: "GET", handler: handles.streamInfo }],
    [MEDIA_ROUTES.streamInit, { method: "GET", handler: handles.streamInit }],
    [MEDIA_ROUTES.streamSegment, { method: "GET", handler: handles.streamSegment }],
    [MEDIA_ROUTES.streamPrefetch, { method: "POST", handler: handles.streamPrefetch }],
    [MEDIA_ROUTES.streamPrefetchCancel, { method: "POST", handler: handles.streamPrefetchCancel }],
    [MEDIA_ROUTES.cacheClear, { method: "POST", handler: handles.cacheClear }],
    [MEDIA_ROUTES.h264Info, { method: "GET", handler: handles.h264Info }],
    [MEDIA_ROUTES.h264Start, { method: "POST", handler: handles.h264Start }],
    [MEDIA_ROUTES.h264Chunk, { method: "GET", handler: handles.h264Chunk }],
    [ROUTES.wasm, { method: "GET", handler: handles.wasm }],
    [ROUTES.rpc, { method: "POST", handler: handles.rpc }]
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
var listenOnce = (server, port, host) => new Promise((resolve, reject) => {
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
var readBody = (req) => new Promise((resolve, reject) => {
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
async function startHttpServer({
  handle,
  log = () => {
  },
  host = HOST,
  portFirst = PORT_FIRST,
  portLast = PORT_LAST
} = {}) {
  const server = createServer((req, res) => {
    void (async () => {
      const respondJson = (status, payload) => {
        const text = JSON.stringify(payload);
        res.writeHead(status, {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(text),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff"
        });
        res.end(text);
      };
      const respondBuffer = (status, body, headers = {}) => {
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
        res.writeHead(status, {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          ...headers,
          "content-length": buffer.length
        });
        res.end(buffer);
      };
      try {
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
          headers: req.headers
        });
        if (result && result.body !== void 0) {
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
    }
    throw new Error(
      `无法在 ${portFirst}-${portLast} 区间绑定 ${host} 端口：${lastError?.code ?? ""} ${lastError?.message ?? ""}`.trim()
    );
  }
  log(`listening on http://${host}:${port}`);
  let closing = null;
  const close = () => closing ??= new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
  return { port, host, url: `http://${host}:${port}`, close };
}
async function startServer({
  sdk,
  cache,
  media = null,
  transcoder = null,
  version = "0.0.0",
  log = () => {
  },
  portFirst = PORT_FIRST,
  portLast = PORT_LAST,
  startedAt = Date.now()
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
    startedAt
  });
  const server = await startHttpServer({ handle, log, portFirst, portLast });
  state.port = server.port;
  return server;
}

// src/background/main.js
var PRUNE_INTERVAL_MS = 10 * 60 * 1e3;
var clientFactory = ({ profile, timeoutMs, retryAttempts, log }) => createClient({
  profile,
  transport: nodeTransport({ timeoutMs }),
  timeoutMs,
  retryAttempts,
  deviceResets: 0,
  log
});
async function start(ctx) {
  const startedAt = Date.now();
  const tag = (name, text) => {
    try {
      ctx.log(`[hongguo:${name}] ${text}`);
    } catch {
    }
  };
  const dataDir = await resolvePluginDataDir({ log: (text) => tag("paths", text) });
  const cache = createCache({ rootDir: dataDir, log: (text) => tag("cache", text) });
  await cache.init();
  const sdk = createSdk({
    dataDir,
    clientFactory,
    installPath: ctx.installPath ?? "",
    log: (text) => tag("sdk", text),
    minIntervalMs: LIMITS.upstreamMinIntervalMs,
    maxBackoffMs: LIMITS.upstreamMaxBackoffMs
  });
  const media = createMedia({ sdk, cache, log: (text) => tag("media", text) });
  const transcoder = createTranscoder({ media, cache, log: (text) => tag("transcode", text) });
  const server = await startServer({
    sdk,
    cache,
    media,
    transcoder,
    version: ctx.version ?? "0.0.0",
    log: (text) => tag("http", text),
    portFirst: PORT_FIRST,
    portLast: PORT_LAST,
    startedAt
  });
  tag("background", `已启动 v${ctx.version ?? "0.0.0"} port=${server.port} dataDir=${dataDir}`);
  void cache.prune().then((result) => {
    if (result.videos.removed || result.covers.removed) {
      tag("cache", `启动清理：视频 ${result.videos.removed} 项、封面 ${result.covers.removed} 项`);
    }
  }).catch((error) => tag("cache", `启动清理失败：${error?.message ?? error}`));
  let pruneTimer = setInterval(() => {
    void cache.prune().catch((error) => tag("cache", `定时清理失败：${error?.message ?? error}`));
  }, PRUNE_INTERVAL_MS);
  pruneTimer.unref?.();
  let stopPromise = null;
  let onAbort = null;
  const stop = () => stopPromise ??= (async () => {
    if (pruneTimer) {
      clearInterval(pruneTimer);
      pruneTimer = null;
    }
    try {
      if (onAbort) ctx.signal?.removeEventListener?.("abort", onAbort);
    } catch {
    }
    await server.close();
    try {
      await transcoder.clear();
    } catch {
    }
    media.dispose();
    sdk.dispose();
    tag("background", "已停止");
  })();
  onAbort = () => {
    void stop();
  };
  ctx.signal?.addEventListener?.("abort", onAbort, { once: true });
  if (ctx.signal?.aborted) void stop();
  return stop;
}
export {
  start
};
