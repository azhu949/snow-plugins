// 磁盘缓存：<plugin-data>/video 与 <plugin-data>/covers。
// 规则：视频保留最近 6 集，封面保留最近 300 张；启动清理 *.part；clear() 保留标记为使用中的路径。
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { LIMITS } from "../shared/contract.js";

const COVER_EXT_BY_MIME = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
  // 红果封面实测返回 image/heic（URL 带 ~tplv-...heic），照原样缓存，由面板决定能否解码。
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);
const COVER_MIME_BY_EXT = new Map([
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["avif", "image/avif"],
  ["heic", "image/heic"],
  ["heif", "image/heif"],
]);
const COVER_NAME_RE = /^([0-9a-f]{40})\.(jpg|png|webp|gif|avif|heic|heif)$/;
/** 同一个封面哈希可能同时存在 .heic（原图）与 .jpg（转码结果），优先用浏览器能解的格式。 */
const COVER_FORMAT_PRIORITY = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"];

/** 封面缓存键忽略查询串：签名参数每次都会变，路径才是图片身份。 */
const coverHash = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    return createHash("sha1").update(`${url.host}${url.pathname}`).digest("hex");
  } catch {
    return null;
  }
};

const listEntries = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const info = await stat(path).catch(() => null);
    if (!info) continue;
    out.push({ name: entry.name, path, mtimeMs: info.mtimeMs, size: info.size, isDirectory: entry.isDirectory() });
  }
  return out;
};

export function createCache({
  rootDir,
  log = () => {},
  videoKeep = LIMITS.videoKeep,
  coverKeep = LIMITS.coverKeep,
  maxCoverBytes = LIMITS.coverMaxBytes,
} = {}) {
  if (typeof rootDir !== "string" || !rootDir) throw new TypeError("createCache 需要 rootDir");

  const videoDir = join(rootDir, "video");
  const coversDir = join(rootDir, "covers");
  const inUse = new Set();
  const coverIndex = new Map();

  const isProtected = (absPath) =>
    [...inUse].some(
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

  /** 清理残留的分片下载文件；只在启动时调用，避免误删正在写的文件。 */
  // 真实路径是 video/<集>/<清晰度>/source.part，需要下钻到第 4 层。
  const cleanupPartials = async (dir = rootDir, depth = 4) => {
    let removed = 0;
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) removed += await cleanupPartials(path, depth - 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".part")) continue;
      try {
        await unlink(path);
        removed += 1;
      } catch {
        // 文件被占用就留给下一次启动。
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
      await rm(entry.path, { recursive: true, force: true }).catch(() => {});
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
      await rm(entry.path, { recursive: true, force: true }).catch(() => {});
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
      await rm(entry.path, { recursive: true, force: true }).catch(() => {});
      removed += 1;
    }
    return removed;
  };

  return {
    rootDir,
    videoDir,
    coversDir,

    async init() {
      await mkdir(videoDir, { recursive: true, mode: 0o700 });
      await mkdir(coversDir, { recursive: true, mode: 0o700 });
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
      const path = join(coversDir, entry.name);
      try {
        const bytes = await readFile(path);
        return { bytes, contentType: entry.contentType, path };
      } catch {
        coverIndex.delete(hash);
        return null;
      }
    },

    /** 只接受 image/* 且不超过上限的字节；返回落盘信息，拒绝时返回 null。 */
    async writeCover(rawUrl, bytes, contentType) {
      const hash = coverHash(rawUrl);
      const type = String(contentType ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const ext = COVER_EXT_BY_MIME.get(type);
      if (!hash || !ext || !bytes || bytes.length === 0 || bytes.length > maxCoverBytes) return null;
      const name = `${hash}.${ext}`;
      const previous = coverIndex.get(hash);
      await writeFile(join(coversDir, name), bytes, { mode: 0o600 });
      if (previous && previous.name !== name) {
        await rm(join(coversDir, previous.name), { force: true }).catch(() => {});
      }
      coverIndex.set(hash, { name, contentType: type });
      if (coverIndex.size > coverKeep) await pruneCovers();
      return { path: join(coversDir, name), contentType: type };
    },

    stats() {
      return {
        rootDir,
        videoDir,
        coversDir,
        covers: coverIndex.size,
        inUse: inUse.size,
        videoKeep,
        coverKeep,
      };
    },
  };
}
