// WebCodecs 播放引擎：绕开 <video> 的媒体加载，自己解 fMP4 并渲染到 canvas。
//
// 背景：宿主页面 CSP 是 default-src 'self'，没有 media-src，<video> 连 blob: 都加载不了
// （实测 video.error.message = "Media load rejected by URL safety check"），
// MSE / Blob / data: / http 回环全部不可用。唯一能走的是直接在渲染进程解码：
//   init + 分片 -> 解析样本 -> VideoDecoder -> VideoFrame -> canvas.drawImage
// 这条链路不经过任何 URL 加载，CSP 管不到。
//
// 音频播放与视频选帧共用媒体时间轴，倍速切换不改变当前播放位置。
import { PanelError } from "../rpc.js";
import { parseMp4, parseSegment, toMicros } from "./mp4.js";
import { decodeBase64 } from "./util.js";
import { createStreamingAudio } from "./stream-audio.js";
import { readSegments } from "./segments.js";
import { LIMITS } from "../../shared/contract.js";

import { PLAYBACK_RATES } from "../playback-prefs.js";
export { PLAYBACK_RATES } from "../playback-prefs.js";

const MAX_DECODE_PER_TICK = 16;
// 720x1280 的 VideoFrame 单帧约 3.7MB，囤太多会撑爆显存反过来拖慢解码器。
const MAX_BUFFERED_FRAMES = 40;
// 画面落后时冻结音画时钟；恢复前按当前倍速预留一小段真实播放时间。
const MAX_VIDEO_LAG_US = 100_000;
const RESUME_AHEAD_MS = 400;
// 先留出三秒实际播放时间，避免小首段在高倍速下只够播放一两秒。
const SOURCE_AHEAD_MS = 3000;
const AUDIO_START_DELAY_SECONDS = 0.06;
// 本机解码的内存护栏：单段上限 2MB，128 段约 256MB；正常单集远小于此值。
const MAX_LOCAL_SEGMENTS = LIMITS.localSegmentsMax;

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas 渲染目标
 * @param {() => object} options.getRpc 返回面板 rpc 客户端
 * @param {(state: object) => void} [options.onState] 状态变化回调
 * @param {(message: string) => void} [options.log]
 */
export const createWebCodecsPlayer = ({ canvas, getRpc, onState = () => {}, onProgress = () => {}, log = () => {} }) => {
  const ctx = canvas.getContext("2d", { alpha: false });

  let disposed = false;
  let track = null;
  let decodeConfig = null;
  let samples = [];
  let decoder = null;
  let nextIndex = 0;
  const frames = new Map();
  const videoFrameEnds = new Map();
  let firstVideoTimeUs = 0;
  let rafId = 0;
  let anchored = false;
  let anchorWall = 0;
  let anchorTimeMs = 0;
  let playing = false;
  let playbackRate = 1;
  let lastEmitAt = 0;
  // 同一帧不重复 drawImage：视频 30fps、rAF 60fps，重复绘制纯属浪费主线程。
  let lastDrawnTs = -1;
  let lastDrawnEndUs = -1;
  let decoderFlushing = false;
  let decoderFlushed = false;
  let inputComplete = false;
  let pendingVideoTarget = null;
  let settleLoad = null;
  // 音频随分段增量解码，声卡时钟仍是唯一的音画时间基准。
  let audioTrack = null;
  let audioCtx = null;
  let audio = null;
  // 音源始终1倍播放预处理的保调音频；时钟把输出时间换回原始媒体时间。
  let audioClock = null;
  let audioClockActive = false;
  let volumeLevel = 1;
  let previewing = false;

  const state = {
    phase: "idle",
    timeMs: 0,
    durationMs: 0,
    playbackRate: 1,
    buffering: false,
    width: 0,
    height: 0,
    decoded: 0,
    buffered: 0,
    bufferedEndMs: 0,
    downloadComplete: false,
    dropped: 0,
    output: 0,
    picked: 0,
    decoderState: "",
    drawError: "",
    error: "",
  };

  const emit = (force) => {
    if (disposed) return;
    const now = Date.now();
    if (!force && now - lastEmitAt < 400) return;
    lastEmitAt = now;
    state.buffered = frames.size;
    state.timeMs = currentMs();
    state.decoderState = decoder ? decoder.state : "none";
    try {
      onState({ ...state });
    } catch {
      // 回调异常不影响解码。
    }
  };

  const audioMediaMs = (contextTime) => {
    if (!audioClock) return anchorTimeMs;
    return audioClock.mediaMs + Math.max(0, contextTime - audioClock.contextTime) * audioClock.rate * 1000;
  };

  const audibleContextTime = () => {
    const now = audioCtx.currentTime;
    // currentTime 是渲染到声卡的时间，不是实际出声时间；高倍速会放大设备延迟带来的口型差。
    const stamp = audioCtx.getOutputTimestamp?.();
    if (stamp?.contextTime > 0 && stamp.performanceTime > 0) {
      const elapsed = audioCtx.state === "running" ? Math.max(0, performance.now() - stamp.performanceTime) / 1000 : 0;
      return Math.min(now, stamp.contextTime + elapsed);
    }
    const latency = Math.max(0, Number(audioCtx.baseLatency) || 0) + Math.max(0, Number(audioCtx.outputLatency) || 0);
    return Math.max(0, now - latency);
  };

  const currentMs = () => {
    if (!anchored || !playing || state.buffering) return anchorTimeMs;
    if (audioClockActive && audioCtx) {
      return Math.min(state.durationMs, audio?.ended ? Infinity : audio.scheduledEndMs, audioMediaMs(audibleContextTime()));
    }
    // 没有可播放音轨或自动播放被拦截时用同倍率墙钟；恢复音频时从此位置重新对齐。
    return Math.min(state.durationMs, anchorTimeMs + Math.max(0, performance.now() - anchorWall) * playbackRate);
  };

  const clearFrames = () => {
    lastDrawnTs = -1;
    lastDrawnEndUs = -1;
    for (const frame of frames.values()) {
      try {
        frame.close();
      } catch {
        // 已关闭时忽略。
      }
    }
    frames.clear();
  };

  const fail = (error) => {
    if (disposed || state.phase === "error") return;
    anchorTimeMs = currentMs();
    playing = false;
    previewing = false;
    state.buffering = false;
    stopLoop();
    stopAudio();
    state.error = String(error?.message || error).slice(0, 120);
    state.phase = "error";
    settleLoad?.(error);
    log(`[wvc] 播放失败：${state.error}`);
    emit(true);
  };

  const ensureDecoder = () => {
    if (decoder && decoder.state === "configured") return decoder;
    const nextDecoder = new VideoDecoder({
      output: (frame) => {
        // seek / 切集后的旧解码回调不能污染新时间轴。
        if (disposed || decoder !== nextDecoder) {
          frame.close();
          return;
        }
        state.output += 1;
        frames.get(frame.timestamp)?.close();
        frames.set(frame.timestamp, frame);
      },
      error: (error) => {
        if (decoder === nextDecoder) fail(error);
      },
    });
    decoder = nextDecoder;
    decoder.configure(decodeConfig);
    return decoder;
  };

  const resetVideoAt = (targetMs) => {
    clearFrames();
    try {
      decoder?.close();
    } catch {
      // 已关闭时忽略。
    }
    decoder = null;
    decoderFlushing = false;
    decoderFlushed = false;
    nextIndex = 0;
    pendingVideoTarget = !inputComplete && targetMs >= state.bufferedEndMs ? targetMs : null;
    // 按解码顺序提交，但只从目标显示时间之前最近的关键帧开始。
    for (let index = 0; index < samples.length; index += 1) {
      if (samples[index].key && samples[index].ctsUs <= targetMs * 1000) nextIndex = index;
    }
  };

  const pump = () => {
    if (disposed || state.phase === "error" || !decodeConfig || decoderFlushing || decoderFlushed) return;
    if (pendingVideoTarget !== null) {
      if (!inputComplete && pendingVideoTarget >= state.bufferedEndMs) return;
      resetVideoAt(pendingVideoTarget);
    }
    if (!samples.length) return;
    const dec = ensureDecoder();
    let count = 0;
    while (nextIndex < samples.length && count < MAX_DECODE_PER_TICK) {
      // 倍速不放宽内存护栏：按媒体时间丢弃过期帧，而不是无限囤积解码输出。
      if (frames.size + dec.decodeQueueSize >= MAX_BUFFERED_FRAMES) break;
      const sample = samples[nextIndex];
      dec.decode(
        new EncodedVideoChunk({
          type: sample.key ? "key" : "delta",
          timestamp: sample.ctsUs,
          duration: sample.durationUs,
          data: sample.data,
        })
      );
      nextIndex += 1;
      state.decoded += 1;
      count += 1;
    }
    if (inputComplete && nextIndex === samples.length) {
      // HEVC 的尾部重排序帧必须 flush 出来，否则临近片尾可能一直等不到画面。
      decoderFlushing = true;
      void dec.flush().then(() => {
        if (disposed || decoder !== dec) return;
        decoderFlushing = false;
        decoderFlushed = true;
      }).catch((error) => {
        if (!disposed && decoder === dec) fail(error);
      });
    }
  };

  const dropFrame = (timestamp) => {
    const frame = frames.get(timestamp);
    if (!frame) return;
    try {
      frame.close();
    } catch {
      // 已关闭时忽略。
    }
    frames.delete(timestamp);
  };

  const frameEndUs = (frame) => videoFrameEnds.get(frame.timestamp)
    ?? frame.timestamp + (Number(frame.duration) || samples[0]?.durationUs || 1);

  const draw = (timeMs) => {
    if (!track) return;
    // 音视频轨首帧不一定同为0；视频开始前保持首帧，不让冻结时钟永远等不到第一帧。
    const nowUs = Math.max(timeMs * 1000, firstVideoTimeUs);
    let pick = -1;
    for (const timestamp of frames.keys()) {
      if (timestamp > lastDrawnTs && timestamp <= nowUs && timestamp > pick) pick = timestamp;
    }
    if (pick >= 0) {
      const frame = frames.get(pick);
      try {
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
        lastDrawnTs = pick;
        lastDrawnEndUs = frameEndUs(frame);
        state.picked += 1;
      } catch (error) {
        state.drawError = String(error?.message || error).slice(0, 90);
        throw error;
      }
    }
    // 延迟输出的旧帧也必须释放，否则暂停预览或追帧会被旧帧占满队列。
    for (const timestamp of [...frames.keys()]) {
      if (timestamp <= lastDrawnTs) {
        if (timestamp !== pick) state.dropped += 1;
        dropFrame(timestamp);
      }
    }
  };

  const videoCovers = (timeMs) => lastDrawnTs >= 0 && lastDrawnEndUs + 1000 >= timeMs * 1000;

  const readyToResume = (timeMs) => {
    if (!videoCovers(timeMs)) return false;
    const sourceTarget = Math.min(state.durationMs, timeMs + SOURCE_AHEAD_MS * playbackRate);
    if (!inputComplete && state.bufferedEndMs + 1 < sourceTarget) return false;
    const targetUs = Math.min(state.durationMs, timeMs + RESUME_AHEAD_MS * playbackRate) * 1000;
    let endUs = lastDrawnEndUs;
    let coveredFrames = 0;
    // 按源轨的显示区间检查连续缓冲，不能拿重排序输出中的孤立远期帧冒充已缓冲区间。
    for (const timestamp of [...frames.keys()].sort((a, b) => a - b)) {
      if (timestamp > endUs + 1000) break;
      endUs = Math.max(endUs, frameEndUs(frames.get(timestamp)));
      coveredFrames += 1;
    }
    // 极高帧率下，所需预缓冲不能超过内存护栏，否则满队列与冻结时钟会互相等待。
    return endUs + 1000 >= targetUs || coveredFrames >= MAX_BUFFERED_FRAMES - 2;
  };

  const tick = () => {
    rafId = 0;
    if (disposed || state.phase === "error" || (!playing && !previewing)) return;
    try {
      const at = currentMs();
      draw(at);
      pump();
      audio?.update();
      if (playing) {
        const videoBehind = lastDrawnTs < 0 || at * 1000 > lastDrawnEndUs + MAX_VIDEO_LAG_US;
        const tailPending = at >= state.durationMs && !videoCovers(at);
        const audioBehind = audioClockActive && (audio.missed || (!audio.ended && at >= audio.scheduledEndMs));
        if (!state.buffering && (videoBehind || tailPending || audioBehind)) {
          anchorTimeMs = at;
          state.buffering = true;
          stopAudio();
        }
        if (state.buffering) {
          // 音频预处理与视频预热并行，但两边都攒够连续缓冲才启动时钟。
          const audioReady = !audio || audio.prepare(at, playbackRate);
          if (audioReady && readyToResume(at)) startAudio(at);
        }
        if (inputComplete && !state.buffering && at >= state.durationMs) {
          playing = false;
          anchorTimeMs = state.durationMs;
          state.phase = "ended";
          stopAudio();
          emit(true);
          return;
        }
      } else if (videoCovers(at)) {
        previewing = false;
      }
      emit(false);
      if (playing || previewing) rafId = requestAnimationFrame(tick);
    } catch (error) {
      fail(error);
    }
  };
  const stopAudio = () => {
    audio?.cancel();
    audioClockActive = false;
    audioClock = null;
  };

  const startAudio = (fromMs) => {
    const at = Math.max(0, Math.min(Number(fromMs) || 0, state.durationMs));
    anchorTimeMs = at;
    anchorWall = performance.now();
    if (disposed || !playing) return;
    if (!audio || (audio.complete && at >= audio.bufferedMs) || at >= state.durationMs) {
      state.buffering = false;
      return;
    }
    void audioCtx.resume().catch(() => {});
    // 自动播放被宿主挂起时沿用墙钟；用户手势恢复后重新对齐声音。
    if (audioCtx.state !== "running") {
      state.buffering = false;
      return;
    }
    const quantum = 128 / audioCtx.sampleRate;
    const when = Math.ceil((audioCtx.currentTime + AUDIO_START_DELAY_SECONDS) / quantum) * quantum;
    if (!audio.start(when)) return;
    audioClock = { contextTime: when, mediaMs: at, rate: playbackRate };
    audioClockActive = true;
    state.buffering = false;
    emit(true);
  };

  /** 从当前媒体位置切换到保调音频；准备完成前冻结音画，不把旧时段按新速度重算。 */
  const setPlaybackRate = (value) => {
    const next = Number(value);
    if (disposed || !PLAYBACK_RATES.includes(next) || next === playbackRate) return playbackRate;
    const at = currentMs();
    stopAudio();
    anchorTimeMs = at;
    anchorWall = performance.now();
    playbackRate = next;
    state.playbackRate = next;
    state.buffering = playing;
    emit(true);
    return playbackRate;
  };

  /** 挂起时从最后的音频位置接回墙钟，恢复后按最新倍速重新对齐；暂停/缓冲期间不发声。 */
  const syncAudioState = () => {
    if (disposed || !audioCtx) return;
    if (audioCtx.state === "running") {
      if (playing && !state.buffering && !audioClockActive) {
        const at = currentMs();
        stopAudio();
        anchorTimeMs = at;
        state.buffering = true;
      }
      return;
    }
    if (!audioClockActive) return;
    const at = currentMs();
    stopAudio();
    anchorTimeMs = at;
    anchorWall = performance.now();
  };

  /** 用户手势到来时尝试恢复被自动播放策略挂起的音频上下文。 */
  const resumeAudio = () => {
    if (disposed || !audioCtx || audioCtx.state === "running") return;
    void audioCtx.resume().catch(() => {});
  };

  const stopLoop = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };


  const load = async ({ episodeId, quality, segmentCount, initPayload: preparedInit, durationMs = 0, resumeMs = 0 }) => {
    if (disposed) return;
    const startedAt = performance.now();
    const rpc = getRpc();
    state.phase = "loading";
    state.error = "";
    emit(true);
    const initPayload = preparedInit || await rpc.getStreamInit(episodeId, quality);
    if (disposed) return;
    const initBytes = decodeBase64(initPayload?.base64);
    if (!initBytes.length) throw new PanelError("PROTOCOL", "init 段为空");
    const parsed = parseMp4(initBytes);
    track = parsed.video;
    audioTrack = parsed.audio;
    if (!track) throw new PanelError("PROTOCOL", "init 段没有视频轨");
    const declared = Math.floor(Number(segmentCount) || 0);
    if (declared <= 0) throw new PanelError("PROTOCOL", "服务端未返回分片数量");
    if (declared > MAX_LOCAL_SEGMENTS) throw new PanelError("SEGMENT_LIMIT", "本集分段数量超过本机解码上限 " + MAX_LOCAL_SEGMENTS);
    state.durationMs = Math.max(0, Number(durationMs) || parsed.durationMs || 0);
    if (!state.durationMs) throw new PanelError("PROTOCOL", "服务端未返回有效时长");
    canvas.width = track.width || 854;
    canvas.height = track.height || 480;
    state.width = canvas.width;
    state.height = canvas.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    decodeConfig = {
      codec: track.codec, description: track.description,
      codedWidth: canvas.width, codedHeight: canvas.height, hardwareAcceleration: "prefer-hardware",
    };
    anchorTimeMs = Math.max(0, Math.min(Number(resumeMs) || 0, state.durationMs));
    anchored = true;
    audio = createStreamingAudio({ track: audioTrack, onError: fail, onStateChange: syncAudioState });
    audioCtx = audio?.context || null;
    audio?.setVolume(volumeLevel);
    resetVideoAt(anchorTimeMs);

    // load 只等首段。后续读取独立推进，失败仍归属当前实例；切集/关闭后停止继续排请求。
    const ready = new Promise((resolve, reject) => {
      settleLoad = (error) => { settleLoad = null; if (error) reject(error); else resolve(); };
    });
    const consume = async () => {
      for await (const { seq, bytes } of readSegments({
        rpc, episodeId, quality, count: declared, cancelled: () => disposed || state.phase === "error",
      })) {
        const buckets = parseSegment(bytes, parsed.tracks, parsed.trex);
        const shift = Number(track.mediaTime) || 0;
        for (const sample of buckets.get(track.id) || []) {
          samples.push({
            ctsUs: toMicros(Math.max(0, sample.time + sample.cts - shift), track.timescale),
            durationUs: toMicros(sample.duration, track.timescale), key: sample.key,
            data: bytes.subarray(sample.offset, sample.offset + sample.size),
          });
        }
        inputComplete = seq === declared;
        state.downloadComplete = inputComplete;
        const timestamps = [...new Set(samples.map((sample) => sample.ctsUs))].sort((a, b) => a - b);
        firstVideoTimeUs = timestamps[0] || 0;
        const endUs = samples.reduce((end, sample) => Math.max(end, sample.ctsUs + sample.durationUs), 0);
        state.bufferedEndMs = endUs / 1000;
        if (inputComplete) {
          if (!samples.length) throw new PanelError("PROTOCOL", "没有解析到视频样本");
          state.durationMs = Math.round(endUs / 1000);
          anchorTimeMs = Math.min(anchorTimeMs, state.durationMs);
        }
        timestamps.forEach((timestamp, index) => videoFrameEnds.set(timestamp, timestamps[index + 1] ?? endUs));
        if (lastDrawnTs >= 0) lastDrawnEndUs = videoFrameEnds.get(lastDrawnTs) ?? lastDrawnEndUs;
        if (audioTrack) audio?.append((buckets.get(audioTrack.id) || []).map((sample) => ({
          ctsUs: toMicros(sample.time, audioTrack.timescale),
          durationUs: toMicros(sample.duration, audioTrack.timescale),
          data: bytes.subarray(sample.offset, sample.offset + sample.size),
        })));
        if (inputComplete) audio?.finish();
        if (disposed || state.phase === "error") return;
        if (state.phase === "loading" && samples.length) {
          resetVideoAt(anchorTimeMs);
          state.phase = "ready";
          previewing = true;
          pump();
          rafId = requestAnimationFrame(tick);
          log("[wvc] 首段就绪 " + track.codec + " 准备=" + Math.round(performance.now() - startedAt) + "ms");
          settleLoad?.();
        } else if (playing || previewing) pump();
        onProgress("seg " + seq + "/" + declared + ": " + bytes.length + "B");
        emit(true);
      }
    };
    void consume().catch((error) => { if (!disposed) fail(error); });
    return ready;
  };

  const play = () => {
    if (disposed || !decodeConfig || state.phase === "loading" || state.phase === "error" || playing) return;
    if (state.phase === "ended") seek(0);
    anchorTimeMs = currentMs();
    anchorWall = performance.now();
    playing = true;
    previewing = false;
    state.phase = "playing";
    // 首帧/seek 先等画面追到锚点再同时启动音画，不能让音频先跑。
    state.buffering = true;
    resumeAudio();
    stopLoop();
    rafId = requestAnimationFrame(tick);
    emit(true);
  };

  const pause = () => {
    if (disposed || !decodeConfig || state.phase === "loading" || state.phase === "error") return;
    anchorTimeMs = currentMs();
    playing = false;
    state.buffering = false;
    stopAudio();
    state.phase = "paused";
    stopLoop();
    // 缓冲中暂停也把画面补到当前媒体位置，但绝不恢复声音。
    previewing = !videoCovers(anchorTimeMs);
    if (previewing) rafId = requestAnimationFrame(tick);
    emit(true);
  };

  const seek = (ms) => {
    if (disposed || !decodeConfig || state.phase === "loading" || state.phase === "error") return;
    const target = Math.max(0, Math.min(Number(ms) || 0, state.durationMs));
    stopLoop();
    stopAudio();
    resetVideoAt(target);
    anchorTimeMs = target;
    anchorWall = performance.now();
    anchored = true;
    state.error = "";
    state.buffering = playing;
    previewing = !playing;
    state.phase = playing ? "playing" : "paused";
    // 暂停拖动也跑解码预览，进度不前进；播放中则等待目标帧后再排音频。
    rafId = requestAnimationFrame(tick);
    emit(true);
  };

  const destroy = () => {
    if (disposed) return;
    anchorTimeMs = currentMs();
    disposed = true;
    playing = false;
    previewing = false;
    state.buffering = false;
    stopLoop();
    stopAudio();

    settleLoad?.();
    audio?.destroy();
    audio = null;
    audioCtx = null;
    clearFrames();
    videoFrameEnds.clear();
    try {
      decoder?.close();
    } catch {
      // 忽略。
    }
    decoder = null;
    samples = [];
    state.phase = "disposed";
  };

  const setVolume = (value) => {
    volumeLevel = Math.max(0, Math.min(1, Number(value) || 0));
    audio?.setVolume(volumeLevel);
    return volumeLevel;
  };

  return {
    load,
    play,
    pause,
    seek,
    setPlaybackRate,
    setVolume,
    destroy,
    resumeAudio,
    getState: () => ({ ...state, timeMs: currentMs(), volume: volumeLevel }),
  };
};
