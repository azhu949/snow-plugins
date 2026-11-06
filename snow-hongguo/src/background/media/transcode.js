// H.264 转码兜底。
//
// 背景：宿主 Chromium 对 `MediaSource.isTypeSupported('video/mp4; codecs="hvc1..."')`
// 返回 true，但真正 append 后 video.error.code = 4（MEDIA_ERR_SRC_NOT_SUPPORTED）——
// 容器/codec 字符串被接受，却没有可用的 HEVC 解码器。此时只能换成 H.264：
// 把已解密的 fMP4 分段拼成一个完整 MP4，用系统 ffmpeg 转码，产物供面板以 Blob 直接播放。
//
// 设计约束：
// - 直链与内容密钥仍然只在后台；这里只产出转码后的普通 MP4。
// - 产物按「集」缓存，重复播放直接命中；下载与转码进度都通过 /h264/info 上报。
// - ffmpeg 不是硬依赖：找不到就返回 unavailable，面板保留「下载本集」兜底。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpError } from "../errors.js";
import { MEDIA_LIMITS, base64Length } from "./limits.js";

const H264_MIME = "video/mp4";
const H264_CODEC = "avc1.640028,mp4a.40.2";
/** 进度里下载（拼源文件）占前 40%，转码占后 60%。 */
const DOWNLOAD_SHARE = 40;

const FFMPEG_FALLBACKS = [
  process.env.SNOW_HONGGUO_FFMPEG || "",
  "ffmpeg",
  "ffmpeg.exe",
  "C:\\ffmpeg\\bin\\ffmpeg.exe",
].filter(Boolean);

const safeName = (value) => String(value ?? "").replace(/[^\w.-]/g, "") || "episode";

const readJson = (path) =>
  readFile(path, "utf8").then(
    (text) => JSON.parse(text),
    () => null
  );

const spawnOnce = (bin, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `退出码 ${code}`));
    });
  });

export function createTranscoder({ media, cache, log = () => {} }) {
  const jobs = new Map();
  // 转码串行执行：同时只跑一个 ffmpeg，避免快速切集把 CPU 与磁盘打满。
  const queue = [];
  let queueRunning = false;
  let ffmpegBin = "";
  let ffmpegChecked = false;
  let ffmpegError = "";
  let ffmpegProbe = null;

  const jobDir = (episodeId, definition) =>
    join(cache.videoDir, safeName(episodeId), `${safeName(definition)}-h264`);
  const outPath = (dir) => join(dir, "h264.mp4");
  const srcPath = (dir) => join(dir, "source.mp4");
  const metaPath = (dir) => join(dir, "meta.json");

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
    ffmpeg: Boolean(ffmpegBin) || !ffmpegChecked,
  });

  const resolveFfmpeg = async () => {
    if (ffmpegBin) return ffmpegBin;
    if (ffmpegChecked) {
      throw Object.assign(new Error(ffmpegError || "未找到 ffmpeg"), { code: "FFMPEG_UNAVAILABLE" });
    }
    // 探测单飞：并发进入时共用同一个探测 Promise，成功与失败都只探测一次。
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
              // 试下一个候选。
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

  const runFfmpeg = (bin, args, { durationMs, onProgress, signal }) =>
    new Promise((resolve, reject) => {
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
          // 进程可能已退出。
        }
        finish(reject, Object.assign(new Error("转码已取消"), { code: "CANCELLED" }));
      };
      child.stdout?.on("data", (chunk) => {
        const matched = /out_time_us=(\d+)/.exec(String(chunk));
        if (matched && durationMs > 0) {
          const ratio = Math.min(1, Number(matched[1]) / 1000 / durationMs);
          onProgress(ratio * 100);
        }
      });
      child.stderr?.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-4000);
      });
      child.on("error", (error) => finish(reject, error));
      child.on("close", (code) => {
        if (code === 0) finish(resolve);
        else finish(reject, new Error(stderr.trim() || `ffmpeg 退出码 ${code}`));
      });
      signal?.addEventListener?.("abort", onAbort, { once: true });
    });

  /** 只淘汰没有在跑/排队的任务；产物按 mtime 交给 cache.prune 处理。 */
  const evict = (keep) => {
    if (jobs.size <= MEDIA_LIMITS.transcodeMaxJobs) return;
    const candidates = [...jobs.values()]
      .filter((job) => job !== keep && !job.promise)
      .sort((left, right) => (left.lastUsed ?? 0) - (right.lastUsed ?? 0));
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

    const info = await media.info(episodeId, quality);
    const definition = info.definition || quality;
    const dir = jobDir(episodeId, definition);
    const job = {
      key,
      episodeId,
      quality,
      definition,
      dir,
      durationMs: info.durationMs || 0,
      segmentCount: info.segmentCount || 0,
      status: "idle",
      progress: 0,
      bytes: 0,
      error: null,
      promise: null,
      lastUsed: Date.now(),
      abort: new AbortController(),
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

  /** 拼接 init + 全部分段为单个 MP4，ffmpeg 才能按普通文件读取。 */
  const buildSource = async (job) => {
    await mkdir(job.dir, { recursive: true });
    cache.markInUse?.(job.dir);
    const target = srcPath(job.dir);
    const handle = await open(target, "w");
    try {
      let written = 0;
      const init = await media.init(job.episodeId, job.quality);
      await handle.write(init);
      written += init.length;
      for (let seq = 1; seq <= job.segmentCount; seq += 1) {
        // 下载阶段也要响应清理/停止：否则 abort 之后仍会继续往已删除的目录写文件。
        if (job.abort.signal.aborted) {
          throw Object.assign(new Error("转码已取消"), { code: "CANCELLED" });
        }
        const { bytes } = await media.segment(job.episodeId, job.quality, seq);
        await handle.write(bytes);
        written += bytes.length;
        job.progress = Math.round((seq / Math.max(1, job.segmentCount)) * DOWNLOAD_SHARE);
      }
      return written;
    } finally {
      await handle.close();
    }
  };

  const run = async (job) => {
    try {
      job.error = null;
      // 先探测 ffmpeg：没有可用转换器时不必先白跑一次整集下载。
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
        tmp,
      ];

      await runFfmpeg(bin, args, {
        durationMs: job.durationMs,
        signal: job.abort.signal,
        onProgress: (percent) => {
          job.progress = DOWNLOAD_SHARE + (percent * (100 - DOWNLOAD_SHARE)) / 100;
        },
      });

      const result = await stat(tmp);
      await rename(tmp, out);
      await writeFile(
        metaPath(job.dir),
        JSON.stringify({
          bytes: result.size,
          sourceBytes,
          durationMs: job.durationMs,
          definition: job.definition,
          mime: H264_MIME,
          codec: H264_CODEC,
          createdAt: Date.now(),
        })
      );
      job.status = "done";
      job.progress = 100;
      job.bytes = result.size;
      log(`[transcode] ${job.key} 完成：${Math.round(result.size / 1024 / 1024)}MB / ${Math.round(job.durationMs / 1000)}s`);
    } finally {
      // 失败、取消与中途 return 都不会走到成功清理：源文件与半成品统一在这里删除。
      // allSettled 保证清理失败不会覆盖原始异常，也不会把已完成的转码标成失败。
      await Promise.allSettled([
        rm(srcPath(job.dir), { force: true }),
        rm(`${outPath(job.dir)}.tmp.mp4`, { force: true }),
      ]);
      // 产物交给 mtime 淘汰：长期 markInUse 会让整集目录永远不被清理。
      cache.release?.(job.dir);
    }
  };

  const pumpQueue = () => {
    if (queueRunning) return;
    const item = queue.shift();
    if (!item) return;
    queueRunning = true;
    item
      .run()
      .then(item.resolve, item.reject)
      .finally(() => {
        queueRunning = false;
        pumpQueue();
      });
  };

  /** 入队并串行执行：同一时刻只允许一个转码任务。 */
  const enqueue = (job) =>
    new Promise((resolve, reject) => {
      queue.push({ job, run: () => run(job), resolve, reject });
      pumpQueue();
    });

  const start = async (episodeId, quality) => {
    const job = await ensureJob(episodeId, quality);
    job.lastUsed = Date.now();
    if (job.status === "done" || job.promise) return snapshot(job);

    // 上次失败/取消后允许重来；取消过的 AbortController 必须换新，否则一启动就再次取消。
    if (job.status === "error" || job.status === "unavailable" || job.abort.signal.aborted) {
      job.status = "idle";
      job.abort = new AbortController();
    }

    job.status = "queued";
    job.progress = 0;
    job.promise = enqueue(job)
      .catch((error) => {
        if (error?.code === "CANCELLED") {
          job.status = "idle";
          job.progress = 0;
          return;
        }
        job.status = error?.code === "FFMPEG_UNAVAILABLE" ? "unavailable" : "error";
        job.error = String(error?.message || error);
        log(`[transcode] ${job.key} 失败：${job.error}`);
      })
      .finally(() => {
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
    const meta = await stat(file);
    const from = Math.max(0, Math.min(Number(offset) || 0, meta.size));
    const wanted = Number(length) || MEDIA_LIMITS.blockBytes;
    const size = Math.max(0, Math.min(wanted, meta.size - from));
    if (size <= 0) throw new HttpError(416, "RANGE_NOT_SATISFIABLE", "偏移超出文件范围");
    if (base64Length(size) > MEDIA_LIMITS.maxBase64Bytes) {
      throw new HttpError(500, "BINARY_TOO_LARGE", "分块过大");
    }
    const handle = await open(file, "r");
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
    // 排队中的任务先拒绝，避免清理之后队列又把转码跑起来。
    const waiting = queue.splice(0, queue.length);
    for (const item of waiting) {
      item.reject(Object.assign(new Error("转码已取消"), { code: "CANCELLED" }));
    }
    const active = [...jobs.values()];
    for (const job of active) job.abort.abort();
    // 等 ffmpeg/下载真正退出后再释放，避免清理时又落新文件。
    await Promise.allSettled(active.map((job) => job.promise).filter(Boolean));
    for (const job of active) cache.release?.(job.dir);
    jobs.clear();
  };

  return { info, start, chunk, clear, snapshot };
}
