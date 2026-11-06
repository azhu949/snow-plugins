// MSE 播放引擎。
//
// 状态机（对外通过 onState 快照暴露）：
//   idle -> probing -> opening -> buffering -> ready -> ended
//            |            |          |  \-> recovering -> buffering
//            |            |          \-> error（可重试）
//            \-> degraded（编码不支持 / 无 MSE）
//   error|degraded --retry / switchQuality--> probing
//   any --destroy--> disposed
//
// append 顺序固定为 init -> segment 1 -> segment 2 -> ... -> segment N：
// 每个字节块都等待 SourceBuffer 的 updateend 后才继续，永不并发写同一个 SourceBuffer。
// 预取：最多缓存 PREFETCH_AHEAD 段未 append 的数据；已缓冲超过 HIGH_WATER_SECONDS 时暂停拉取。
import { PanelError } from "../rpc.js";
import { codecLabel, decodeBase64 } from "./util.js";

export const MSE_STATE = Object.freeze({
  IDLE: "idle",
  PROBING: "probing",
  OPENING: "opening",
  BUFFERING: "buffering",
  READY: "ready",
  RECOVERING: "recovering",
  DEGRADED: "degraded",
  ERROR: "error",
  ENDED: "ended",
  DISPOSED: "disposed",
});

const PREFETCH_AHEAD = 3;
const HIGH_WATER_SECONDS = 12;
const MAX_FETCH_ATTEMPTS = 3;
const MAX_REBUILDS = 1;
const SOURCE_OPEN_TIMEOUT_MS = 10000;
const APPEND_TIMEOUT_MS = 20000;
const NON_RETRYABLE = new Set(["INVALID_PARAM", "PARAM_INVALID", "NOT_FOUND"]);

const getMediaSourceCtor = () => {
  if (typeof window === "undefined") return null;
  return window.ManagedMediaSource || window.MediaSource || null;
};

const checkSupport = (mime) => {
  const Ctor = getMediaSourceCtor();
  if (!Ctor || typeof Ctor.isTypeSupported !== "function") return { ok: false, reason: "no-mse" };
  try {
    return Ctor.isTypeSupported(mime) ? { ok: true, reason: "" } : { ok: false, reason: "codec" };
  } catch {
    return { ok: false, reason: "codec" };
  }
};

/**
 * 从媒体信息派生 codec 候选串。
 * 源片的 hvcC 有时给出偏高的 level（例如 hvc1.1.6.L186 = 6.2），
 * 部分平台的 MSE 只认常见 level 或省略 level 的写法，因此逐个回退试探，
 * 只要有一个被接受就用它，避免"编码本身能解、只是字符串太严"被误判为不支持。
 */
const buildMimeCandidates = (info) => {
  const mime = info.mime || "video/mp4";
  const codec = String(info.codec || "").trim();
  const list = [];
  const push = (value) => {
    if (value && !list.includes(value)) list.push(value);
  };

  if (codec) push(`${mime}; codecs="${codec}"`);

  const parts = codec.split(",").map((item) => item.trim()).filter(Boolean);
  const video = parts.find((item) => /^(hvc1|hev1|avc1|av01|vp0?9)/i.test(item)) || "";
  const audio = parts.filter((item) => item !== video);
  const audioSuffix = audio.length ? `,${audio.join(",")}` : "";

  if (/^(hvc1|hev1)/i.test(video)) {
    push(`${mime}; codecs="hvc1${audioSuffix}"`);
    push(`${mime}; codecs="hvc1.1.6.L120.B0${audioSuffix}"`);
    push(`${mime}; codecs="hvc1.1.6.L93.B0${audioSuffix}"`);
    push(`${mime}; codecs="hev1.1.6.L93.B0${audioSuffix}"`);
  }
  if (video) push(`${mime}; codecs="${video}${audioSuffix}"`);
  // 只声明视频轨：部分实现的 SourceBuffer 会因为音频编码不接受而整体失败。
  if (video && audioSuffix) push(`${mime}; codecs="${video}"`);

  return list;
};

const pickSupportedMime = (info) => {
  const Ctor = getMediaSourceCtor();
  if (!Ctor || typeof Ctor.isTypeSupported !== "function") {
    return { ok: false, reason: "no-mse", mime: "", checked: [] };
  }
  const candidates = buildMimeCandidates(info);
  const checked = candidates.map((mime) => ({ mime, ok: checkSupport(mime).ok }));
  const hit = checked.find((item) => item.ok);
  return hit
    ? { ok: true, reason: "", mime: hit.mime, checked }
    : { ok: false, reason: "codec", mime: "", checked };
};

const normalizeInfo = (raw) => ({
  codec: typeof raw?.codec === "string" ? raw.codec : "",
  durationMs: Number.isFinite(Number(raw?.durationMs)) ? Number(raw.durationMs) : 0,
  segmentCount: Math.max(0, Math.floor(Number(raw?.segmentCount) || 0)),
  timescale: Number.isFinite(Number(raw?.timescale)) ? Number(raw.timescale) : 0,
  mime: typeof raw?.mime === "string" && raw.mime ? raw.mime : "video/mp4",
  definition: typeof raw?.definition === "string" ? raw.definition : "",
  bytes: Number.isFinite(Number(raw?.bytes)) ? Number(raw.bytes) : 0,
});

/**
 * @param {object} options
 * @param {HTMLVideoElement} options.video
 * @param {() => object} options.getRpc 返回面板 rpc 客户端（避免捕获过期实例）
 * @param {(snapshot: object) => void} [options.onState]
 * @param {(error: Error) => void} [options.onError] 仅致命错误时回调
 */
export function createMseEngine({ video, getRpc, log = () => {}, onState = () => {}, onError = () => {} }) {
  if (!video) throw new TypeError("createMseEngine 需要 video 元素");

  let disposed = false;
  let session = null;
  let counter = 0;

  const snapshotOf = (target) => {
    if (!target) return { state: disposed ? MSE_STATE.DISPOSED : MSE_STATE.IDLE, quality: "", info: null };
    return {
      state: target.state,
      reason: target.reason,
      quality: target.quality,
      info: target.info,
      mime: target.mime,
      codecLabel: target.info ? codecLabel(target.info.codec) : "",
      appended: target.appended,
      segmentCount: target.info?.segmentCount ?? 0,
      appendedBytes: target.appendedBytes,
      error: target.error || null,
      degradedReason: target.state === MSE_STATE.DEGRADED ? target.degradeReason : "",
      probe: target.probe || [],
      episodeId: target.episodeId,
      mode: target.mode || "mse",
      transcode: target.transcode || null,
      transcodeProgress: target.transcodeProgress ?? 0,
      videoError: target.videoError || null,
      canPlay: target.canPlay || "",
      retryInfo: target.retryInfo || null,
      resumeAppliedMs: target.resumeAppliedMs,
      resumeClamped: target.resumeClamped,
      rebuilds: target.rebuilds,
    };
  };

  const emit = (target) => {
    try {
      onState(snapshotOf(target));
    } catch (error) {
      log("[player] onState 回调异常", String(error?.message || error));
    }
  };

  const isCurrent = (target) => !disposed && !!target && session === target;
  const isLive = (target) => isCurrent(target) && target.active && !target.halted;

  const sleep = (ms, target) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        target.timers.delete(timer);
        resolve();
      }, ms);
      target.timers.add(timer);
    });

  const clearTimers = (target) => {
    for (const timer of target.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    target.timers.clear();
  };

  const durationSeconds = () => {
    const value = Number(video.duration);
    if (Number.isFinite(value) && value > 0) return value;
    const fromInfo = (session?.info?.durationMs || 0) / 1000;
    return Number.isFinite(fromInfo) && fromInfo > 0 ? fromInfo : 0;
  };

  const bufferedAheadSeconds = () => {
    const ranges = video.buffered;
    if (!ranges || !ranges.length) return 0;
    const time = Number(video.currentTime) || 0;
    for (let index = 0; index < ranges.length; index += 1) {
      const start = ranges.start(index);
      const end = ranges.end(index);
      if (time >= start - 0.35 && time <= end + 0.35) return Math.max(0, end - time);
    }
    return 0;
  };

  // ---------------------------------------------------------------- 会话生命周期

  const createSession = (options) => ({
    token: (counter += 1),
    episodeId: options.episodeId,
    quality: options.quality,
    reason: options.reason || "initial",
    resumeMs: Math.max(0, Number(options.resumeMs) || 0),
    autoplay: options.autoplay !== false,
    info: null,
    mime: "",
    state: MSE_STATE.IDLE,
    mediaSource: null,
    sb: null,
    objectUrl: "",
    nextFetch: 1,
    nextAppend: 1,
    fetching: false,
    appending: false,
    store: new Map(),
    appended: 0,
    appendedBytes: 0,
    initAppended: false,
    endedStream: false,
    active: true,
    halted: false,
    tearingDown: false,
    error: null,
    degradeReason: "",
    retryInfo: null,
    resumeAppliedMs: 0,
    resumeClamped: false,
    rebuilds: Math.max(0, Number(options.rebuilds) || 0),
    timers: new Set(),
    cleanups: [],
  });

  const clearSourceBuffer = (target) => {
    const sb = target.sb;
    target.sb = null;
    if (!sb) return;
    try {
      sb.removeEventListener("updateend", target.onUpdateEnd);
      sb.removeEventListener("error", target.onSbError);
    } catch {
      // 元素已释放时忽略。
    }
  };

  const teardown = (target) => {
    if (!target) return;
    target.tearingDown = true;
    target.active = false;
    target.halted = true;
    clearTimers(target);
    for (const cleanup of target.cleanups) {
      try {
        cleanup();
      } catch {
        // 清理函数不允许影响后续卸载。
      }
    }
    target.cleanups = [];
    clearSourceBuffer(target);
    const ms = target.mediaSource;
    target.mediaSource = null;
    try {
      video.pause();
    } catch {
      // 忽略。
    }
    if (target.objectUrl) {
      const url = target.objectUrl;
      target.objectUrl = "";
      try {
        if (video.getAttribute("src") === url || video.src === url) {
          video.removeAttribute("src");
          if (typeof video.load === "function") video.load();
        }
      } catch {
        // 忽略。
      }
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // 忽略。
        }
      }, 0);
    }
    if (ms) {
      try {
        if (ms.readyState === "open") ms.endOfStream();
      } catch {
        // 忽略。
      }
    }
  };

  const halt = (target, state, error, reason) => {
    if (!isCurrent(target)) return;
    target.state = state;
    target.error = error || null;
    if (reason) target.degradeReason = reason;
    target.halted = true;
    try {
      video.pause();
    } catch {
      // 忽略。
    }
    emit(target);
    if (state === MSE_STATE.ERROR) {
      try {
        onError(target.error, snapshotOf(target));
      } catch (callbackError) {
        log("[player] onError 回调异常", String(callbackError?.message || callbackError));
      }
    }
  };

  const fail = (target, error) => {
    const normalized =
      error instanceof Error ? error : new PanelError("PLAYER_ERROR", String(error || "播放失败"));
    log(`[player] 播放失败：${normalized.code || ""} ${normalized.message || ""}`);
    halt(target, MSE_STATE.ERROR, normalized, "");
  };

  const degrade = (target, reason) => {
    log(`[player] 降级：${reason}`);
    halt(target, MSE_STATE.DEGRADED, null, reason || "codec");
  };

  // ---------------------------------------------------------------- 追加管线

  const appendBytes = (target, bytes) =>
    new Promise((resolve, reject) => {
      const sb = target.sb;
      if (!sb) {
        reject(new PanelError("PLAYER_ERROR", "SourceBuffer 已释放"));
        return;
      }
      let settled = false;
      let timer = 0;
      const cleanup = () => {
        sb.removeEventListener("updateend", onEnd);
        sb.removeEventListener("error", onError);
        if (timer) {
          clearTimeout(timer);
          target.timers.delete(timer);
          timer = 0;
        }
      };
      const onEnd = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new PanelError("MEDIA_APPEND_FAILED", "appendBuffer 失败"));
      };
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new PanelError("MEDIA_APPEND_TIMEOUT", "appendBuffer 超时"));
      }, APPEND_TIMEOUT_MS);
      target.timers.add(timer);
      sb.addEventListener("updateend", onEnd);
      sb.addEventListener("error", onError);
      try {
        sb.appendBuffer(bytes);
      } catch (error) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }
    });

  const evictOldBuffer = (target) =>
    new Promise((resolve) => {
      const sb = target.sb;
      if (!sb || sb.updating) {
        resolve();
        return;
      }
      const end = Math.max(0, Math.min((Number(video.currentTime) || 0) - 1, durationSeconds() - 1));
      if (!(end > 0)) {
        resolve();
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        sb.removeEventListener("updateend", finish);
        clearTimeout(timer);
        target.timers.delete(timer);
        resolve();
      };
      const timer = setTimeout(finish, 5000);
      target.timers.add(timer);
      sb.addEventListener("updateend", finish);
      try {
        sb.remove(0, end);
      } catch {
        finish();
      }
    });

  const isQuotaError = (error) =>
    String(error?.name || "").toLowerCase().includes("quota") ||
    String(error?.code || "").toUpperCase() === "QUOTA_EXCEEDED";

  const rebuild = async (target, reason) => {
    if (!isCurrent(target)) return;
    const episodeId = target.episodeId;
    const quality = target.quality;
    const timeMs = Math.max(0, Number(video.currentTime) * 1000);
    const autoplay = !video.paused && !video.ended;
    const rebuilds = target.rebuilds + 1;
    log(`[player] 重建 MSE（${reason}，第 ${rebuilds} 次）`);
    await load({ episodeId, quality, resumeMs: timeMs, autoplay, rebuilds, reason: "rebuild" });
  };

  const finishStream = (target) => {
    if (!isCurrent(target) || target.endedStream) return;
    target.endedStream = true;
    const ms = target.mediaSource;
    try {
      if (ms && ms.readyState === "open") ms.endOfStream();
    } catch {
      // endOfStream 失败不影响已缓冲内容。
    }
    emit(target);
  };

  const appendLoop = async (target) => {
    if (!isLive(target) || target.appending) return;
    target.appending = true;
    // 只有真正追加过数据才在 finally 里继续驱动：store 里还没有下一段时若继续 pump，
    // 会形成 appendLoop -> pump -> appendLoop 的同步递归，最终栈溢出。
    let progressed = false;
    try {
      const total = target.info?.segmentCount || 0;
      while (isLive(target) && target.nextAppend <= total) {
        const bytes = target.store.get(target.nextAppend);
        if (!bytes) break;
        await appendBytes(target, bytes);
        if (!isLive(target)) return;
        target.store.delete(target.nextAppend);
        target.nextAppend += 1;
        target.appended += 1;
        target.appendedBytes += bytes.length;
        target.retryInfo = null;
        progressed = true;
        if (target.state !== MSE_STATE.READY) target.state = MSE_STATE.READY;
        emit(target);
      }
      if (isLive(target) && target.nextAppend > total && !target.endedStream) finishStream(target);
    } catch (error) {
      if (!isLive(target)) return;
      if (isQuotaError(error)) {
        await evictOldBuffer(target);
        if (isLive(target)) {
          try {
            const bytes = target.store.get(target.nextAppend);
            if (bytes) {
              await appendBytes(target, bytes);
              if (!isLive(target)) return;
              target.store.delete(target.nextAppend);
              target.nextAppend += 1;
              target.appended += 1;
              target.appendedBytes += bytes.length;
              target.state = MSE_STATE.READY;
              progressed = true;
              emit(target);
              return;
            }
          } catch (retryError) {
            fail(target, retryError);
            return;
          }
        }
      }
      if (target.rebuilds < MAX_REBUILDS) {
        await rebuild(target, "append");
        return;
      }
      fail(target, error);
    } finally {
      target.appending = false;
      if (progressed && isLive(target)) pump(target);
    }
  };

  const fetchSegment = async (target, seq) => {
    let attempt = 1;
    for (;;) {
      if (!isLive(target)) throw new PanelError("ABORTED", "播放会话已结束");
      try {
        const payload = await getRpc().getStreamSegment(target.episodeId, target.quality, seq);
        if (!isLive(target)) throw new PanelError("ABORTED", "播放会话已结束");
        const bytes = decodeBase64(payload?.base64);
        if (!bytes.length) throw new PanelError("PROTOCOL", `分段 ${seq} 内容为空`);
        return bytes;
      } catch (error) {
        if (!isLive(target)) throw error;
        const code = String(error?.code || "");
        const retryable = !NON_RETRYABLE.has(code);
        if (!retryable || attempt >= MAX_FETCH_ATTEMPTS) throw error;
        target.retryInfo = { seq, attempt, code, message: String(error?.message || "") };
        target.state = MSE_STATE.RECOVERING;
        emit(target);
        log(`[player] 分段 ${seq} 第 ${attempt} 次失败，${attempt === 1 ? 0.7 : 1.6}s 后重试：${code}`);
        await sleep(attempt === 1 ? 700 : 1600, target);
        if (!isLive(target)) throw error;
        target.state = MSE_STATE.BUFFERING;
        emit(target);
        attempt += 1;
      }
    }
  };

  const pumpFetch = (target) => {
    if (!isLive(target) || !target.sb || !target.initAppended || target.fetching) return;
    const total = target.info?.segmentCount || 0;
    if (target.nextFetch > total) return;
    if (target.store.size >= PREFETCH_AHEAD) return;
    // 已缓冲足够时暂停拉取，等播放消费（timeupdate 会重新触发）。
    if (target.nextAppend > 1 && bufferedAheadSeconds() >= HIGH_WATER_SECONDS) return;
    const seq = target.nextFetch;
    target.nextFetch += 1;
    target.fetching = true;
    fetchSegment(target, seq)
      .then((bytes) => {
        if (!isLive(target)) return;
        target.store.set(seq, bytes);
      })
      .catch((error) => {
        if (!isLive(target)) return;
        fail(target, error);
      })
      .finally(() => {
        if (!isLive(target)) return;
        target.fetching = false;
        pump(target);
      });
  };

  function pump(target) {
    if (!isLive(target)) return;
    pumpFetch(target);
    // appendLoop 是 async 函数：内部异常只会变成 rejected promise，必须显式接住。
    void appendLoop(target).catch((error) => {
      log("[player] append 循环异常", String(error?.message || error));
    });
  }

  // ---------------------------------------------------------------- 初始化

  const applyResume = (target) => {
    const targetMs = Math.max(0, Number(target.resumeMs) || 0);
    if (!targetMs) return;
    const attempt = () => {
      if (!isLive(target)) return;
      const reported = Number(video.duration);
      const duration = Number.isFinite(reported) && reported > 0 ? reported : 0;
      let seconds = targetMs / 1000;
      let clamped = false;
      // 目标位置已到片尾（历史停在最后一秒等）时从头播，并标记给界面提示。
      if (duration > 0 && seconds > duration - 0.5) {
        seconds = 0;
        clamped = true;
      }
      try {
        video.currentTime = seconds;
      } catch {
        return;
      }
      target.resumeAppliedMs = Math.round(seconds * 1000);
      target.resumeClamped = clamped;
    };
    const known = Number(video.duration);
    if (Number.isFinite(known) && known > 0) {
      attempt();
      return;
    }
    // moov 刚 append 完时 duration 可能还没刷新：等 metadata，再用 info.durationMs 兜底一次。
    let fallback = 0;
    const onMeta = () => {
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("loadedmetadata", onMeta);
      if (fallback) {
        clearTimeout(fallback);
        target.timers.delete(fallback);
        fallback = 0;
      }
      attempt();
    };
    video.addEventListener("durationchange", onMeta);
    video.addEventListener("loadedmetadata", onMeta);
    fallback = setTimeout(() => {
      target.timers.delete(fallback);
      fallback = 0;
      if (!isLive(target)) return;
      const fromInfo = (target.info?.durationMs || 0) / 1000;
      const tooLate = fromInfo > 0 && targetMs / 1000 > fromInfo - 0.5;
      const seconds = tooLate ? 0 : fromInfo > 0 ? Math.min(targetMs / 1000, fromInfo - 0.3) : targetMs / 1000;
      try {
        video.currentTime = seconds;
      } catch {
        return;
      }
      target.resumeAppliedMs = Math.round(seconds * 1000);
      target.resumeClamped = tooLate;
    }, 1500);
    target.timers.add(fallback);
    target.cleanups.push(() => {
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("loadedmetadata", onMeta);
      if (fallback) clearTimeout(fallback);
    });
  };

  const openSourceBuffer = async (target) => {
    const ms = target.mediaSource;
    if (!isLive(target) || !ms) return;
    if (ms.readyState !== "open") {
      fail(target, new PanelError("MEDIA_STATE", "媒体源未就绪（sourceopen 时状态不是 open）"));
      return;
    }
    let sb;
    try {
      sb = ms.addSourceBuffer(target.mime);
    } catch (error) {
      log(`[player] addSourceBuffer 失败：${String(error?.message || error)}`);
      degrade(target, "add-source-buffer");
      return;
    }
    target.sb = sb;
    try {
      sb.mode = "segments";
    } catch {
      // 某些实现不允许设置，保持默认即可。
    }
    target.state = MSE_STATE.BUFFERING;
    emit(target);
    try {
      const payload = await getRpc().getStreamInit(target.episodeId, target.quality);
      if (!isLive(target)) return;
      const bytes = decodeBase64(payload?.base64);
      if (!bytes.length) throw new PanelError("PROTOCOL", "init segment 为空");
      await appendBytes(target, bytes);
      if (!isLive(target)) return;
      target.initAppended = true;
      applyResume(target);
      emit(target);
      pump(target);
    } catch (error) {
      if (!isLive(target)) return;
      fail(target, error);
    }
  };

  const openMediaSource = (target) => {
    const Ctor = getMediaSourceCtor();
    if (!Ctor) {
      degrade(target, "no-mse");
      return;
    }
    let ms;
    try {
      ms = new Ctor();
    } catch (error) {
      fail(target, error);
      return;
    }
    target.mediaSource = ms;
    try {
      target.objectUrl = URL.createObjectURL(ms);
    } catch (error) {
      fail(target, error);
      return;
    }
    const timer = setTimeout(() => {
      target.timers.delete(timer);
      if (isLive(target) && !target.sb) fail(target, new PanelError("MEDIA_OPEN_TIMEOUT", "媒体源打开超时"));
    }, SOURCE_OPEN_TIMEOUT_MS);
    target.timers.add(timer);
    target.cleanups.push(() => clearTimeout(timer));
    ms.addEventListener("sourceopen", () => {
      clearTimeout(timer);
      void openSourceBuffer(target);
    });
    ms.addEventListener("sourceclose", () => {
      target.timers.delete(timer);
      clearTimeout(timer);
    });
    try {
      video.src = target.objectUrl;
      if (typeof video.load === "function") video.load();
    } catch (error) {
      fail(target, error);
    }
  };

  async function load(options = {}) {
    if (disposed) return;
    const episodeId = String(options.episodeId || "");
    if (!episodeId) return;
    if (session) teardown(session);
    const target = createSession({
      episodeId,
      quality: String(options.quality || "720p"),
      resumeMs: options.resumeMs,
      autoplay: options.autoplay,
      reason: options.reason,
      rebuilds: options.rebuilds,
    });
    session = target;
    target.state = MSE_STATE.PROBING;
    emit(target);
    try {
      const raw = await getRpc().getStreamInfo(target.episodeId, target.quality);
      if (!isLive(target)) return;
      target.info = normalizeInfo(raw);
      if (!target.info.codec) throw new PanelError("PROTOCOL", "媒体信息缺少编码");
      if (!target.info.segmentCount) throw new PanelError("PROTOCOL", "媒体分片数量为 0");
      const support = pickSupportedMime(target.info);
      target.probe = support.checked;
      target.mime = support.mime;
      if (!support.ok) {
        target.state = MSE_STATE.DEGRADED;
        target.degradeReason = support.reason;
        target.halted = true;
        target.active = false;
        emit(target);
        return;
      }
      target.state = MSE_STATE.OPENING;
      emit(target);
      openMediaSource(target);
    } catch (error) {
      if (!isLive(target)) return;
      fail(target, error);
    }
  }

  // ------------------------------------------------ 转码兜底（宿主无 HEVC 解码器）

  const TRANSCODE_TIMEOUT_MS = 10 * 60 * 1000;
  const H264_CHUNK_BYTES = 3 * 1024 * 1024;

  const applyLocalResume = (target) => {
    const ms = Number(target.resumeMs) || 0;
    if (ms <= 0) return;
    const apply = () => {
      try {
        video.currentTime = ms / 1000;
        target.resumeAppliedMs = ms;
      } catch {
        // 超出时长时忽略，从头播放。
      }
    };
    if (video.readyState >= 1) {
      apply();
      return;
    }
    const onMeta = () => {
      video.removeEventListener("loadedmetadata", onMeta);
      if (isLive(target)) apply();
    };
    video.addEventListener("loadedmetadata", onMeta);
    target.cleanups.push(() => video.removeEventListener("loadedmetadata", onMeta));
  };

  const downloadTranscoded = async (target, state) => {
    const rpc = getRpc();
    const total = Number(state?.bytes) || 0;
    const parts = [];
    let offset = 0;
    for (let guard = 0; guard < 200; guard += 1) {
      const chunk = await rpc.h264Chunk(target.episodeId, target.quality, offset, H264_CHUNK_BYTES);
      const bytes = decodeBase64(chunk?.base64);
      if (!bytes.length) break;
      parts.push(bytes);
      offset += bytes.length;
      target.transcodeProgress = total > 0 ? Math.min(100, Math.round((offset / total) * 100)) : 0;
      emit(target);
      if (Number(chunk?.total) > 0 && offset >= Number(chunk.total)) break;
      if (!(Number(chunk?.total) > 0) && bytes.length < H264_CHUNK_BYTES) break;
    }
    if (!parts.length) throw new PanelError("PROTOCOL", "转码结果为空");
    return new Blob(parts, { type: "video/mp4" });
  };

  /**
   * 转码后播放：等后台把这一集转成 H.264，再用 Blob 交给 <video>。
   * 仅由用户在降级面板显式触发：宿主 CSP 没有 media-src，blob: 也可能被 URL 安全检查拒绝，
   * 成败以 loadedmetadata 为准，失败时提示下载本集后用外部播放器打开。
   */
  async function loadLocal(options = {}) {
    if (disposed) return;
    const episodeId = String(options.episodeId || "");
    if (!episodeId) return;
    if (session) teardown(session);
    const target = createSession({
      episodeId,
      quality: String(options.quality || "720p"),
      resumeMs: options.resumeMs,
      autoplay: options.autoplay ?? true,
      reason: options.reason || "transcode",
      rebuilds: 0,
    });
    target.mode = "local";
    session = target;
    target.state = MSE_STATE.PROBING;
    emit(target);

    try {
      const rpc = getRpc();
      let state = await rpc.h264Info(target.episodeId, target.quality);
      if (!isLive(target)) return;
      target.transcode = state;
      if (state?.status === "unavailable") {
        throw new PanelError("TRANSCODE_UNAVAILABLE", state.error || "本机没有可用的 ffmpeg");
      }

      if (state?.status !== "done") {
        target.state = MSE_STATE.BUFFERING;
        emit(target);
        state = await rpc.h264Start(target.episodeId, target.quality);
        const startedAt = Date.now();
        while (state?.status !== "done") {
          if (!isLive(target)) return;
          if (state?.status === "unavailable") {
            throw new PanelError("TRANSCODE_UNAVAILABLE", state.error || "本机没有可用的 ffmpeg");
          }
          if (state?.status === "error") {
            throw new PanelError("TRANSCODE_FAILED", state.error || "转码失败");
          }
          if (Date.now() - startedAt > TRANSCODE_TIMEOUT_MS) {
            throw new PanelError("TRANSCODE_TIMEOUT", "转码超时，请稍后重试");
          }
          target.transcode = state;
          emit(target);
          await sleep(1200, target);
          state = await rpc.h264Info(target.episodeId, target.quality);
        }
      }

      target.transcode = state;
      if (!isLive(target)) return;
      target.state = MSE_STATE.BUFFERING;
      emit(target);

      // 交付只能用 Blob：宿主 CSP 没有 media-src，http://127.0.0.1 与 data: 都会被拦下；
      // blob: 是否放行取决于宿主的 URL 安全检查（部分版本直接拒绝），因此这条路径只作显式兜底。
      const blob = await downloadTranscoded(target, state);
      if (!isLive(target)) return;
      const url = URL.createObjectURL(blob);
      target.objectUrl = url;
      target.info = {
        codec: state?.codec || "avc1.640028,mp4a.40.2",
        durationMs: Number(state?.durationMs) || 0,
        segmentCount: 1,
        timescale: 0,
        mime: "video/mp4",
        definition: state?.definition || target.quality,
        bytes: Number(state?.bytes) || 0,
      };
      target.mime = `video/mp4; codecs="${target.info.codec}"`;
      target.transcodeProgress = 100;
      try {
        video.pause();
        video.removeAttribute("src");
      } catch {
        // 忽略。
      }
      target.canPlay = (() => {
        try {
          return video.canPlayType('video/mp4; codecs="avc1.640028,mp4a.40.2"') || "no";
        } catch {
          return "?";
        }
      })();
      // 以 loadedmetadata 判定是否真的解码成功；超过 20 秒视为失败。
      const loaded = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new PanelError("MEDIA_LOAD_TIMEOUT", "视频加载超时（直链未被解码）"));
        }, 20000);
        const onMeta = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new PanelError("MEDIA_DECODE_FAILED", `视频加载失败（video.error ${video.error?.code ?? 0}）`));
        };
        const cleanup = () => {
          clearTimeout(timer);
          target.timers.delete(timer);
          video.removeEventListener("loadedmetadata", onMeta);
          video.removeEventListener("error", onError);
        };
        target.timers.add(timer);
        target.cleanups.push(cleanup);
        video.addEventListener("loadedmetadata", onMeta);
        video.addEventListener("error", onError);
      });
      try {
        video.src = url;
        if (typeof video.load === "function") video.load();
      } catch (error) {
        fail(target, error);
        return;
      }
      await loaded;
      if (!isLive(target)) return;
      target.state = MSE_STATE.READY;
      applyLocalResume(target);
      emit(target);
      if (target.autoplay) void video.play().catch(() => {});
    } catch (error) {
      if (!isLive(target)) return;
      fail(target, error instanceof Error ? error : new PanelError("PLAYER_ERROR", String(error)));
    }
  }

  // ---------------------------------------------------------------- video 事件

  // 只处理当前会话自己的媒体源事件：切集/切清晰度时旧源可能还会抛一次 error / ended。
  const ownsMedia = (target) => !!target.objectUrl && video.src === target.objectUrl;

  const onVideoError = () => {
    const target = session;
    if (!isCurrent(target) || !target.active || target.halted || target.tearingDown) return;
    if (!ownsMedia(target)) return;
    const code = video.error?.code ?? 0;
    const message = String(video.error?.message || "");
    target.videoError = { code, message };
    // local（转码 Blob）模式下，这里的 error 往往来自上一个 MSE 源被 revoke 后的延迟事件，
    // 不能据此判定失败：成败以 loadedmetadata 为准，另有 15 秒超时兜底。
    if (target.mode === "local") return;
    if (code === 1) return;
    if (code === 4) {
      degrade(target, "src-not-supported");
      return;
    }
    if (code === 3) {
      if (target.rebuilds < MAX_REBUILDS) void rebuild(target, "decode");
      else fail(target, new PanelError("MEDIA_DECODE_FAILED", "视频解码失败"));
      return;
    }
    fail(target, new PanelError("MEDIA_NETWORK", "媒体流读取失败"));
  };

  const onVideoEnded = () => {
    const target = session;
    if (!isLive(target) || !ownsMedia(target)) return;
    target.state = MSE_STATE.ENDED;
    emit(target);
  };

  const onTimeUpdate = () => {
    const target = session;
    if (!isLive(target)) return;
    if (!target.fetching) pumpFetch(target);
  };

  video.addEventListener("error", onVideoError);
  video.addEventListener("ended", onVideoEnded);
  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("waiting", onTimeUpdate);
  video.addEventListener("progress", onTimeUpdate);
  video.addEventListener("seeked", onTimeUpdate);
  video.addEventListener("play", onTimeUpdate);

  // ---------------------------------------------------------------- 对外接口

  const currentTimeMs = () => {
    const value = Number(video.currentTime);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : 0;
  };

  return {
    /** 载入一集；同一 episodeId 换清晰度时由 switchQuality 调用。 */
    load,
    /** 转码兜底：等后台转成 H.264 后用 Blob 直接播放（宿主没有 HEVC 解码器时使用）。 */
    loadLocal,
    /** 换清晰度：销毁 SourceBuffer 重建，尽量保留播放位置。 */
    async switchQuality(quality) {
      const target = session;
      if (!isCurrent(target)) return;
      const next = String(quality || "");
      if (!next || next === target.quality) return;
      const timeMs = currentTimeMs() || target.resumeMs || 0;
      const autoplay = !video.paused && !video.ended;
      await load({
        episodeId: target.episodeId,
        quality: next,
        resumeMs: timeMs,
        autoplay,
        rebuilds: target.rebuilds,
        reason: "quality",
      });
    },
    /** 错误/降级后重试：重建整条链路，位置尽量保留。 */
    async retry() {
      const target = session;
      if (!isCurrent(target)) return;
      const timeMs = currentTimeMs() || target.resumeMs || 0;
      const autoplay = !video.paused && !video.ended;
      await load({
        episodeId: target.episodeId,
        quality: target.quality,
        resumeMs: timeMs,
        autoplay,
        rebuilds: target.rebuilds,
        reason: "retry",
      });
    },
    /** 媒体元素解码错误后由控制器调用。 */
    async recover(reason) {
      const target = session;
      if (!isLive(target)) return;
      if (target.rebuilds < MAX_REBUILDS) await rebuild(target, reason || "media");
      else fail(target, new PanelError("MEDIA_DECODE_FAILED", "视频解码失败"));
    },
    snapshot: () => snapshotOf(session),
    isPlaying: () => !video.paused && !video.ended,
    destroy() {
      if (disposed) return;
      disposed = true;
      if (session) teardown(session);
      session = null;
      try {
        video.removeEventListener("error", onVideoError);
        video.removeEventListener("ended", onVideoEnded);
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("waiting", onTimeUpdate);
        video.removeEventListener("progress", onTimeUpdate);
        video.removeEventListener("seeked", onTimeUpdate);
        video.removeEventListener("play", onTimeUpdate);
      } catch {
        // 忽略。
      }
      try {
        onState({ state: MSE_STATE.DISPOSED });
      } catch {
        // 忽略。
      }
    },
  };
}
