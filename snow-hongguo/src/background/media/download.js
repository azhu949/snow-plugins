// 媒体管道：range 分块下载 -> cenc 解密 -> fMP4 分段。纯 Node，不依赖 ffmpeg。
// 缓存布局：<plugin-data>/video/<episodeId>/<definition>/{init.mp4,info.json,seg-00001.m4s,source.part}
//
// 下载流程（prepare 取头、pick 选流、备用源重试、分块喂给 remuxer）参考
// J3n5en/enso-hongguo（Apache-2.0）：
//   https://github.com/J3n5en/enso-plugins/tree/main/packages/enso.hongguo
// 本实现改成纯 ESM、可注入 cache/sdk、按分段落盘（原实现是整文件内存 + 字节偏移切片）。
//
// 设计取舍：
//   1) source.part 保存「原始加密字节」，是源文件的连续前缀，断点续传就是按文件大小接着要 Range；
//      解密后的分段单独落盘，播放时只读分段，源文件在下载完成后删除（不占双份磁盘）。
//   2) 顶层条目是「集」目录，cache.prune() 按 mtime 保留最近 6 集；同一集的多清晰度只算一个条目。
//   3) 分段编号从 1 开始，seq 与 info.json 里的 segmentCount 一一对应；只有样本字节全部到齐的分段才落盘。
//   4) 主源失败时若还没把任何分段交给面板，才允许切 backup_url；已经服务过分段再换源会导致
//      moov/样本表不一致，宁可报错。
import { open, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { HttpError, mapSdkError } from "../errors.js";
import { MEDIA_LIMITS, QUALITIES, base64Length } from "./limits.js";
import { Remuxer, scanHead } from "./remux.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SEGMENT_NAME = (seq) => `seg-${String(seq).padStart(5, "0")}.m4s`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const safeId = (value) => String(value ?? "").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 64);

const qualityRank = (definition) => {
  const index = QUALITIES.indexOf(definition);
  return index === -1 ? -1 : index;
};

/**
 * 选流：优先取「不高于请求清晰度的最高一档」，没有就取最高可用档。
 * 与面板 /playback 的排序口径一致（360p < 480p < 540p < 720p < 1080p）。
 */
export function pickStream(streams, quality) {
  const sorted = (Array.isArray(streams) ? streams : [])
    .filter((stream) => typeof stream?.url === "string" && stream.url)
    .sort((left, right) => qualityRank(left.definition) - qualityRank(right.definition) || (left.bitrate ?? 0) - (right.bitrate ?? 0));
  const wanted = qualityRank(quality);
  if (wanted < 0) return sorted[0] ?? null;
  return sorted.filter((stream) => qualityRank(stream.definition) <= wanted).pop() ?? sorted[0] ?? null;
}

/** 按 base64 上限反推单段原始字节上限，供写入前自检。 */
const segmentBase64Ok = (bytes) => base64Length(bytes.length) <= MEDIA_LIMITS.maxBase64Bytes;

/**
 * 单次 Range 请求。返回 { bytes, total, status }。
 * status 200 表示服务器忽略了 Range（只在 from=0 时接受），会主动截断到请求长度。
 */
export function requestRange(rawUrl, from, to, { timeoutMs = MEDIA_LIMITS.rangeTimeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      try {
        request?.destroy();
      } catch {
        // 连接已关闭。
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
    const transport =
      target.protocol === "http:" ? httpRequest : target.protocol === "https:" ? httpsRequest : null;
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
          accept: "*/*",
        },
        timeout: timeoutMs,
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
            // 只要够本块长度就不再等剩余响应：先 settle 再断开，避免 aborted 抢先 reject。
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

const isAborted = (error) => error?.code === "MEDIA_ABORTED";

/** 按绝对偏移读取一段文件；一次只分配一个分段大小的缓冲区。 */
const readRange = async (handle, from, to) => {
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

/**
 * 取 ftyp+moov：先要 512KB，moov 超界时按 scanHead() 的 need 重新要一次。
 * moov 的最大大小在这里兜底，避免异常文件把内存打满。
 */
export async function fetchHead(url, { signal, maxBytes = MEDIA_LIMITS.maxHeadBytes } = {}) {
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

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

/** 把 SDK/网络异常统一成 HttpError，便于 server.js 直接映射状态码。 */
const asHttpError = (error) => {
  if (error instanceof HttpError) return error;
  if (typeof error?.code === "string" && error.code && !error.code.startsWith("MEDIA_")) {
    const mapped = mapSdkError(error);
    return new HttpError(mapped.status, mapped.code, mapped.message);
  }
  // 内部异常只回固定文案：错误信息里可能带路径或主机名，不进响应。
  return new HttpError(502, "MEDIA_FAILED", "视频准备失败，请稍后重试");
};

/**
 * 媒体服务：解析播放模型、下载解密、分段缓存、封面无关。
 * @param {object} options
 * @param {{resolvePlayback: Function}} options.sdk 后台 SDK 单例
 * @param {object} options.cache cache.js 实例（需要 videoDir/markInUse/release/clear）
 * @param {(message: string) => void} [options.log]
 */
export function createMedia({ sdk, cache, log = () => {} }) {
  if (!sdk) throw new TypeError("createMedia 需要 sdk");
  if (!cache?.videoDir) throw new TypeError("createMedia 需要 cache");

  const jobs = new Map();
  const pending = new Map();
  const definitionStarts = new Map();
  const demands = new Map();
  const warmups = new Map();
  const cancelledTokens = new Map();
  let disposed = false;
  let clearing = false;
  const aborted = () => new HttpError(499, "MEDIA_ABORTED", "下载已取消");
  const demandFor = (key) => {
    if (!demands.has(key)) demands.set(key, { key, foreground: false, tokens: new Set(), job: null });
    return demands.get(key);
  };
  const wanted = (demand) => {
    if (disposed || clearing || (!demand.foreground && !demand.tokens.size)) throw aborted();
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
    // 取消可能比启动请求先到，保留短期墓碑，防止迟到请求又启动下载。
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
      // 等最后一次写入结束再释放占用，不与缓存清理竞争。
      void Promise.resolve(job.task).finally(() => forgetJob(job));
    } else if (!job && !lease.demand.foreground && !lease.demand.tokens.size && !pending.has(lease.demand.key)) {
      demands.delete(lease.demand.key);
    }
  };

  const episodeDirOf = (episodeId) => join(cache.videoDir, safeId(episodeId));
  const qualityDirOf = (episodeId, definition) => join(episodeDirOf(episodeId), definition);
  const infoPathOf = (dir) => join(dir, "info.json");
  const initPathOf = (dir) => join(dir, "init.mp4");
  const segmentPathOf = (dir, seq) => join(dir, SEGMENT_NAME(seq));

  const touch = async (job) => {
    const now = new Date();
    await utimes(job.episodeDir, now, now).catch(() => {});
  };

  const newWaiterSet = () => new Set();

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
        // 下载按顺序产出分段；前段落盘代表仍有进展，给并行预读的后段重新计时。
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
      segments: new Set(),
      waiters: new Map(),
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
      demands: new Set(),
      wake: null,
    };
    job.infoReady = new Promise((resolve, reject) => {
      job.resolveInfo = resolve;
      job.rejectInfo = reject;
    });
    // 失败先于任何请求到达时不要让 Promise 变成 unhandled rejection。
    job.infoReady.catch(() => {});
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
      const victim = [...jobs.values()]
        .filter((job) => job.state !== "preparing")
        .sort((left, right) => left.lastUsed - right.lastUsed)[0];
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
    // 不同请求档位可共用同一实际档位；后续读取沿用已绑定任务，避免反复解析上游。
    const alias = demands.get(key)?.job;
    if (alias && jobs.get(alias.key) === alias) return alias;
    return findDefinitionJob(episodeId, quality);
  };

  /**
   * 读取指定清晰度的完整磁盘缓存：只认 `<video>/<episodeId>/<definition>/` 这一个目录。
   * 命中条件是 info.json 标记 complete、分段数为正、init.mp4 与全部分段文件都在。
   * 命中返回 { info, dir, definition }，否则返回 null。
   */
  const readCachedDefinition = async (episodeId, definition) => {
    if (!QUALITIES.includes(definition)) return null;
    const dir = qualityDirOf(episodeId, definition);
    let info;
    try {
      info = JSON.parse(await readFile(infoPathOf(dir), "utf8"));
    } catch {
      return null;
    }
    if (info?.complete !== true || !Number.isFinite(info.segmentCount) || info.segmentCount <= 0) {
      return null;
    }
    if (!(await exists(initPathOf(dir)))) return null;
    for (let seq = 1; seq <= info.segmentCount; seq += 1) {
      if (!(await exists(segmentPathOf(dir, seq)))) return null;
    }
    return { info: { ...info, definition }, dir, definition };
  };

  /** 只复用完全相同清晰度的完整缓存；没有就重新取流，不做降级复用。 */
  const findCached = async (episodeId, quality) => readCachedDefinition(episodeId, quality);

  /** 清掉某个清晰度目录下的下载中间态，用于换源或重来。 */
  const resetQualityDir = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      await rm(join(dir, entry.name), { recursive: true, force: true }).catch(() => {});
    }
  };

  const writeSegments = async (job, remuxer, source, have) => {
    const emitted = await remuxer.drainFrom(source, have);
    for (const segment of emitted) {
      if (!segmentBase64Ok(segment.bytes)) {
        throw new HttpError(500, "SEGMENT_TOO_LARGE", "分段超过面板 5MB 接收上限");
      }
      await writeFile(segmentPathOf(job.dir, segment.seq), segment.bytes, { mode: 0o600 });
      job.segments.add(segment.seq);
      job.bytes += segment.bytes.length;
      resolveWaiters(job, segment.seq);
    }
    return emitted.length;
  };

  const markReady = async (job) => {
    job.state = "ready";
    job.complete = true;
    await writeFile(infoPathOf(job.dir), JSON.stringify({ ...job.info, complete: true }), { mode: 0o600 });
    await rm(join(job.dir, "source.part"), { force: true }).catch(() => {});
    await touch(job);
    job.resolveInfo(job.info);
  };

  /**
   * 从指定地址下载：先取头建 Remuxer，再按 3MB 分块拉取并持续产出分段。
   * job.have 是已写入 source.part 的字节数，失败重试时从它继续。
   */
  const downloadFrom = async (job, url, keyHex) => {
    const signal = job.abort.signal;
    const partPath = join(job.dir, "source.part");

    // 每次下载都重新取头：.part 只在本次任务内有效，启动清理也会删掉残留文件。
    const fetched = await fetchHead(url, { signal, maxBytes: job.foreground ? MEDIA_LIMITS.maxHeadBytes : MEDIA_LIMITS.prefetchMaxBytes });
    const head = fetched.head;
    const total = fetched.total;
    await resetQualityDir(job.dir);
    await writeFile(partPath, head, { mode: 0o600 });
    job.have = head.length;

    job.total = total;
    const remuxer = new Remuxer(head, keyHex, {
      segmentTargetBytes: MEDIA_LIMITS.segmentTargetBytes,
      segmentMaxBytes: MEDIA_LIMITS.segmentMaxBytes,
    });
    // 已经用主源解析过 moov 时，备用源的分段结构必须一致，否则面板手里的 init/分段会错位。
    if (job.info?.segmentCount > 0 && job.info.segmentCount !== remuxer.segmentCount) {
      throw new HttpError(502, "MEDIA_SOURCE_MISMATCH", "备用源的分段结构与主源不一致");
    }
    const { segmentBytes: _segmentBytes, segmentNeeds: _segmentNeeds, ...infoBase } = remuxer.info();
    const info = {
      ...infoBase,
      episodeId: job.episodeId,
      definition: job.definition,
      bytes: total,
      complete: false,
    };
    job.remuxer = remuxer;
    job.info = info;
    job.state = "streaming";
    await writeFile(initPathOf(job.dir), remuxer.init, { mode: 0o600 });
    await writeFile(infoPathOf(job.dir), JSON.stringify(info), { mode: 0o600 });
    job.resolveInfo(info);
    log(
      `[media] 解析 ${job.episodeId} ${job.definition} codec=${info.codec} 时长=${info.durationMs}ms 分段=${info.segmentCount} 总字节=${total}`
    );

    // 全程只保留 ftyp+moov 与单段随机读缓冲区，不再按源文件大小分配整块内存。
    const writeHandle = await open(partPath, "a");
    const readHandle = await open(partPath, "r");
    const source = {
      size: total,
      read: (from, to) => readRange(readHandle, from, to),
    };
    try {
      // 已有分段（同源续传）时跳过对应编号，避免重复写。
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
                const wake = () => { signal.removeEventListener("abort", wake); job.wake = null; resolve(); };
                job.wake = wake;
                signal.addEventListener("abort", wake, { once: true });
                if (signal.aborted || job.foreground) wake();
              });
              if (signal.aborted) throw aborted();
              job.state = "streaming";
            }
            const from = job.have;
            const to = Math.min(from + MEDIA_LIMITS.blockBytes - 1, total - 1,
              job.foreground ? total - 1 : MEDIA_LIMITS.prefetchMaxBytes - 1);
            const block = await requestRange(url, from, to, { signal });
            const chunk = block.bytes.length > to - from + 1 ? block.bytes.subarray(0, to - from + 1) : block.bytes;
            if (chunk.length === 0) throw new HttpError(502, "MEDIA_TRANSPORT", "视频地址返回空数据");
            let written = 0;
            while (written < chunk.length) {
              // append 模式下 position 会被忽略，短写后继续把剩余部分追加到末尾。
              const { bytesWritten } = await writeHandle.write(chunk, written, chunk.length - written);
              if (!bytesWritten) throw new HttpError(502, "MEDIA_TRANSPORT", "写入本地缓存失败");
              written += bytesWritten;
            }
            // 先落盘再推进 have：随机读只能读到已经写入的字节。
            job.have = from + written;
            await writeSegments(job, remuxer, source, job.have);
            const percent = Math.floor((job.have / total) * 100);
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

      // 最后一轮 drain：头或尾已经全部就绪时把剩余分段补出来。
      await writeSegments(job, remuxer, source, total);
      if (!remuxer.done) throw new HttpError(502, "MEDIA_TRUNCATED", "视频数据不完整");
      if (job.info.segmentCount !== job.segments.size) {
        throw new HttpError(500, "MEDIA_SEGMENT_MISMATCH", "分段数量与解析结果不一致");
      }
      await markReady(job);
    } finally {
      await writeHandle.close().catch(() => {});
      await readHandle.close().catch(() => {});
    }
  };

  const fail = (job, error) => {
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
          fail(job, error);
          return;
        }
        log(`[media] 源 ${index + 1}/${urls.length} 失败：${error?.code ?? "UNKNOWN"} ${error?.message ?? ""}`);
        // 已经交过分段就不能换源：不同源的 moov/样本表可能不同，续播会花屏。
        if (job.served > 0) break;
        job.have = 0;
        job.total = 0;
        await resetQualityDir(job.dir).catch(() => {});
      }
    }
    fail(job, lastError ?? new Error("没有可用的播放地址"));
  };

  // 请求档位不同也可能落到同一个实际档位，目录创建与换源只能有一个写入者。
  const startDefinition = async (episodeId, definition, demand, create) => {
    const key = `${episodeId}:${definition}`;
    const previous = definitionStarts.get(key);
    const task = (async () => {
      if (previous) await previous.catch(() => {});
      wanted(demand);
      const running = findDefinitionJob(episodeId, definition);
      if (running && running.state !== "error" && !running.abort.signal.aborted) return attachDemand(running, demand);
      if (running) { await running.task; forgetJob(running); }
      wanted(demand);
      demands.set(demand.key, demand);
      return create();
    })();
    definitionStarts.set(key, task);
    try { return await task; }
    finally { if (definitionStarts.get(key) === task) definitionStarts.delete(key); }
  };

  const startJob = async ({ episodeId, quality, definition, dir, cached }) => {
    const demand = demandFor(`${episodeId}:${quality}`);
    wanted(demand);
    if (cached) return startDefinition(episodeId, definition, demand, () =>
      createJob({ episodeId, quality, definition, dir, info: cached.info, cached: true, demand }));

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
      // 源站没有请求档位时 pickStream 会落到别的清晰度：该档位若已完整缓存就直接复用，不重复下载。
      const cachedTarget = await readCachedDefinition(episodeId, stream.definition);
      wanted(demand);
      if (cachedTarget) {
        return createJob({ episodeId, quality, definition: cachedTarget.definition, dir: cachedTarget.dir,
          info: cachedTarget.info, cached: true, demand });
      }
      const keyHex = playback.protected === true ? result.contentKey.key : null;
      const targetDir = qualityDirOf(episodeId, stream.definition);
      await mkdir(targetDir, { recursive: true, mode: 0o700 });
      wanted(demand);
      const job = createJob({ episodeId, quality, definition: stream.definition, dir: targetDir, info: null, cached: false, demand });
      job.info = { episodeId, definition: stream.definition, segmentCount: 0, complete: false };
      const urls = [stream.url, stream.backup_url].filter((url) => typeof url === "string" && url);
      job.task = runJob(job, urls, keyHex).catch(() => {});
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
      try { return attachDemand(await pendingJob, demand); }
      catch (error) {
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
        cached,
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
    return readFile(segmentPathOf(job.dir, seq));
  };

  return {
    /** 只预取下一集开头；正式播放会提升同一任务，取消不能中断已提升的任务。 */
    async prefetch(episodeId, quality, token) {
      if (disposed || clearing || (cancelledTokens.get(token) || 0) > Date.now()) return { accepted: false };
      if (warmups.has(token)) return { accepted: true };
      if (warmups.size >= MEDIA_LIMITS.prefetchMaxJobs) return { accepted: false };
      // 当前集下载优先，预加载不与尚未完成的正式播放抢网络。
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
    cancelPrefetch(token) { cancelPrefetch(token); return { ok: true }; },
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
        bytes: job.info.bytes ?? null,
      };
    },

    /** /stream/init：解密后的 init segment（ftyp + moov）。 */
    async init(episodeId, quality) {
      const job = await ensureJob(episodeId, quality);
      await job.infoReady;
      job.lastUsed = Date.now();
      return readFile(initPathOf(job.dir));
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
        // 等待期间可能又创建了任务：再中止一次，确保没有新的写入落到清理后的目录。
        for (const job of jobs.values()) job.abort.abort();
        const inflight = [...jobs.values()];
        await Promise.allSettled(inflight.map((job) => job.task).filter(Boolean));
        for (const job of inflight) cache.release(job.dir);
        jobs.clear();
        demands.clear();
        const result = await cache.clear();
        return { ok: true, removed: (result.videos ?? 0) + (result.covers ?? 0) };
      } finally { clearing = false; }
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
          served: job.served,
        })),
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
    },
  };
}
