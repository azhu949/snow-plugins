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
import { createTempoRenderer } from "./tempo-audio.js";

import { PLAYBACK_RATES } from "../playback-prefs.js";
export { PLAYBACK_RATES } from "../playback-prefs.js";

const MAX_DECODE_PER_TICK = 16;
// 720x1280 的 VideoFrame 单帧约 3.7MB，囤太多会撑爆显存反过来拖慢解码器。
const MAX_BUFFERED_FRAMES = 40;
// 画面落后时冻结音画时钟；恢复前按当前倍速预留一小段真实播放时间。
const MAX_VIDEO_LAG_US = 100_000;
const RESUME_AHEAD_MS = 80;
const AUDIO_START_DELAY_SECONDS = 0.06;
const AUDIO_FADE_SECONDS = 0.005;
// 本机解码的内存护栏：单段上限 2MB，128 段约 256MB；正常单集远小于此值。
const MAX_LOCAL_SEGMENTS = 128;

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
  // 音频：整集解成一条 AudioBuffer，AudioContext 的硬件时钟同时充当播放主时钟。
  let audioTrack = null;
  let audioSamples = [];
  let activeAudioDecoder = null;
  let audioCtx = null;
  let audioBuffer = null;
  let audioSource = null;
  let audioSourceGain = null;
  let audioGain = null;
  let tempoRenderer = null;
  let preparingAudio = false;
  let audioStartSeq = 0;
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
    if (audioClockActive && audioSource && audioCtx) {
      return Math.min(state.durationMs, audioMediaMs(audibleContextTime()));
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
    // 按解码顺序提交，但只从目标显示时间之前最近的关键帧开始。
    for (let index = 0; index < samples.length; index += 1) {
      if (samples[index].key && samples[index].ctsUs <= targetMs * 1000) nextIndex = index;
    }
  };

  const pump = () => {
    if (disposed || state.phase === "error" || !decodeConfig || decoderFlushing || decoderFlushed) return;
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
    if (nextIndex === samples.length) {
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
      if (playing) {
        const videoBehind = lastDrawnTs < 0 || at * 1000 > lastDrawnEndUs + MAX_VIDEO_LAG_US;
        const tailPending = at >= state.durationMs && !videoCovers(at);
        if (!state.buffering && (videoBehind || tailPending)) {
          anchorTimeMs = at;
          state.buffering = true;
          stopAudio();
        }
        if (state.buffering && !preparingAudio && readyToResume(at)) {
          // 音频预处理期间保持buffering，不让墙钟先行，也不在每帧重复创建Worker。
          void startAudio(at);
        }
        if (!state.buffering && at >= state.durationMs) {
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
    // 暂停、seek、连续改速、切集都作废异步音频任务，旧结果不能重新发声。
    audioStartSeq += 1;
    preparingAudio = false;
    tempoRenderer?.cancel();
    audioClockActive = false;
    audioClock = null;
    const source = audioSource;
    const gain = audioSourceGain;
    audioSource = null;
    audioSourceGain = null;
    if (!source) return;
    try {
      if (!disposed && audioCtx?.state === "running" && gain) {
        // 极短淡出消除暂停/切速时硬截波形的爆音；新音源在独立的确定时刻启动。
        const now = audioCtx.currentTime;
        gain.gain.cancelAndHoldAtTime(now);
        gain.gain.linearRampToValueAtTime(0, now + AUDIO_FADE_SECONDS);
        source.stop(now + AUDIO_FADE_SECONDS);
      } else {
        source.stop();
        source.disconnect();
        gain?.disconnect();
      }
    } catch {
      source.disconnect();
      gain?.disconnect();
    }
  };

  const startAudio = async (fromMs) => {
    stopAudio();
    const seq = audioStartSeq;
    const at = Math.max(0, Math.min(Number(fromMs) || 0, state.durationMs));
    const rate = playbackRate;
    anchorTimeMs = at;
    anchorWall = performance.now();
    if (disposed || !playing) return;
    if (!audioCtx || !audioBuffer || !audioGain || at >= audioBuffer.duration * 1000 || at >= state.durationMs) {
      state.buffering = false;
      return;
    }
    const context = audioCtx;
    state.buffering = true;
    preparingAudio = true;
    void context.resume().catch(() => {});
    emit(true);
    if (disposed || seq !== audioStartSeq || !playing) return;
    try {
      tempoRenderer ??= createTempoRenderer(context, audioBuffer);
      const buffer = await tempoRenderer.getBuffer(rate);
      if (disposed || seq !== audioStartSeq || !playing || context !== audioCtx) return;
      preparingAudio = false;
      anchorTimeMs = at;
      anchorWall = performance.now();
      // 被自动播放策略挂起时继续使用同倍率墙钟，用户手势恢复后再对齐音频。
      if (context.state !== "running") {
        state.buffering = false;
        emit(true);
        return;
      }
      const quantum = 128 / context.sampleRate;
      const when = Math.ceil((context.currentTime + AUDIO_START_DELAY_SECONDS) / quantum) * quantum;
      // 保调音频的长度是原长/rate：offset与时钟必须使用同一个倍率换算，不能二次加速。
      const offset = Math.min(at / 1000 / rate, buffer.duration);
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = 1;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(1, when + AUDIO_FADE_SECONDS);
      source.connect(gain);
      gain.connect(audioGain);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      audioSource = source;
      audioSourceGain = gain;
      source.start(when, offset);
      audioClock = { contextTime: when, mediaMs: at, rate };
      audioClockActive = true;
      state.buffering = false;
      emit(true);
    } catch (error) {
      if (disposed || seq !== audioStartSeq) return;
      preparingAudio = false;
      if (error?.name !== "AbortError") fail(error);
    }
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
      if (playing && !state.buffering && !audioClockActive) void startAudio(currentMs());
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

  /**
   * 整集音频先全解成一条 AudioBuffer。
   * 一集 720p 约 43MB Float32，换来 seek/暂停都不必重新解码，实现也简单。
   */
  const prepareAudio = async () => {
    if (!audioTrack || !audioSamples.length) {
      onProgress("audio: 无音轨");
      return;
    }
    if (typeof AudioDecoder === "undefined") {
      onProgress("audio: 无 AudioDecoder");
      return;
    }
    const sampleRate = Number(audioTrack.sampleRate) || 44100;
    const channels = Math.max(1, Number(audioTrack.channels) || 2);
    const chunks = [];
    let total = 0;
    let failure = "";
    const audioDecoder = new AudioDecoder({
      output: (data) => {
        try {
          // 被切集销毁的解码输出只释放，不再分配整集 PCM。
          if (disposed) return;
          const count = data.numberOfFrames;
          const planes = [];
          for (let channel = 0; channel < data.numberOfChannels; channel += 1) {
            const plane = new Float32Array(count);
            data.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
            planes.push(plane);
          }
          chunks.push({ planes, frames: count });
          total += count;
        } catch (error) {
          failure = String(error?.message || error).slice(0, 80);
        } finally {
          data.close();
        }
      },
      error: (error) => {
        failure = String(error?.message || error).slice(0, 80);
      },
    });
    activeAudioDecoder = audioDecoder;
    try {
      audioDecoder.configure({ codec: audioTrack.codec, sampleRate, numberOfChannels: channels });
      for (const sample of audioSamples) {
        audioDecoder.decode(
          new EncodedAudioChunk({ type: "key", timestamp: sample.ctsUs, data: sample.data })
        );
      }
      await audioDecoder.flush();
    } catch (error) {
      failure = String(error?.message || error).slice(0, 80);
    } finally {
      try {
        audioDecoder.close();
      } catch {
        // destroy 可能已关闭。
      }
      if (activeAudioDecoder === audioDecoder) activeAudioDecoder = null;
    }

    // 切集销毁期间 flush 仍可能完成，不要为旧实例重新创建音频上下文。
    if (disposed) return;
    if (failure || !total) {
      onProgress(`audio 失败: ${failure || "无输出"}`);
      return;
    }

    try {
      audioCtx = new AudioContext({ sampleRate });
      audioCtx.addEventListener("statechange", syncAudioState);
      const targetRate = Number(audioCtx.sampleRate) || sampleRate;
      audioGain = audioCtx.createGain();
      audioGain.gain.value = volumeLevel;
      audioGain.connect(audioCtx.destination);

      // AAC priming 延迟按轨道 timescale 换算成采样数，不能假定 timescale 总等于采样率。
      const primingFrames = Math.round((Math.max(0, Number(audioTrack.mediaTime) || 0) / (Number(audioTrack.timescale) || sampleRate)) * sampleRate);
      const skip = Math.min(primingFrames, total);
      const usable = Math.max(0, total - skip);
      const source = [];
      for (let channel = 0; channel < channels; channel += 1) {
        source.push(new Float32Array(Math.max(1, usable)));
      }
      let consumed = 0;
      let written = 0;
      for (const chunk of chunks) {
        const drop = Math.max(0, skip - consumed);
        const count = Math.min(Math.max(0, chunk.frames - drop), Math.max(0, usable - written));
        if (count > 0) {
          for (let channel = 0; channel < channels; channel += 1) {
            const plane = chunk.planes[Math.min(channel, chunk.planes.length - 1)];
            if (!plane) continue;
            source[channel].set(plane.subarray(drop, drop + count), written);
          }
          written += count;
        }
        consumed += chunk.frames;
      }

      // 设备采样率和轨道采样率不一致时必须重采样：
      // 直接把 44.1k 数据塞进 48k 的 AudioBuffer 会让整条音轨快 8.8%，越播越不对口型。
      const outFrames = Math.max(1, Math.round((written / sampleRate) * targetRate));
      audioBuffer = audioCtx.createBuffer(channels, outFrames, targetRate);
      for (let channel = 0; channel < channels; channel += 1) {
        const input = source[channel];
        const output = audioBuffer.getChannelData(channel);
        if (targetRate === sampleRate) {
          output.set(input.subarray(0, Math.min(outFrames, input.length)));
          continue;
        }
        const step = sampleRate / targetRate;
        for (let index = 0; index < outFrames; index += 1) {
          const position = index * step;
          const base = Math.floor(position);
          const fraction = position - base;
          const a = input[base] || 0;
          const b = input[Math.min(base + 1, Math.max(0, written - 1))] || 0;
          output[index] = a + (b - a) * fraction;
        }
      }

      onProgress(
        `audio ok: ${channels}ch ${sampleRate}Hz ctx=${targetRate}Hz ${(outFrames / targetRate).toFixed(1)}s skip=${skip}`
      );
    } catch (error) {
      onProgress(`audio 初始化失败: ${String(error?.message || error).slice(0, 80)}`);
      audioCtx?.removeEventListener("statechange", syncAudioState);
      void audioCtx?.close().catch(() => {});
      audioCtx = null;
      audioGain = null;
      audioBuffer = null;
    }
  };

  const stopLoop = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const load = async ({ episodeId, quality, segmentCount, resumeMs = 0 }) => {
    if (disposed) return;
    const rpc = getRpc();
    state.phase = "loading";
    state.error = "";
    emit(true);
    onProgress(`load: init q=${quality}`);

    const initPayload = await rpc.getStreamInit(episodeId, quality);
    if (disposed) return;
    const initBytes = decodeBase64(initPayload?.base64);
    if (!initBytes.length) throw new PanelError("PROTOCOL", "init 段为空");
    const parsed = parseMp4(initBytes);
    track = parsed.video;
    audioTrack = parsed.audio;
    if (!track) throw new PanelError("PROTOCOL", "init 段没有视频轨");
    onProgress(`init ok: ${track.codec} ${track.width}x${track.height} desc=${track.description?.length ?? 0}B`);

    canvas.width = track.width || 854;
    canvas.height = track.height || 480;
    state.width = canvas.width;
    state.height = canvas.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 以服务端分片数为准；超过本机解码上限时明确报错，不再静默截断。
    const declared = Math.floor(Number(segmentCount) || 0);
    if (declared <= 0) throw new PanelError("PROTOCOL", "服务端未返回分片数量");
    if (declared > MAX_LOCAL_SEGMENTS) {
      throw new PanelError("SEGMENT_LIMIT", `本集共 ${declared} 段，超过本机解码上限 ${MAX_LOCAL_SEGMENTS} 段`);
    }
    // 整集拉进内存换实现简单：seek 时不必回后台重取。
    samples = [];
    const total = declared;
    for (let seq = 1; seq <= total; seq += 1) {
      if (disposed) return;
      const payload = await rpc.getStreamSegment(episodeId, quality, seq);
      if (disposed) return;
      const bytes = decodeBase64(payload?.base64);
      if (!bytes.length) throw new PanelError("PROTOCOL", `分片 ${seq} 内容为空`);
      const buckets = parseSegment(bytes, parsed.tracks, parsed.trex);
      const list = buckets.get(track.id) || [];
      const videoShift = Number(track.mediaTime) || 0;
      for (const sample of list) {
        samples.push({
          // 减去 elst 的 media_time，把各轨对齐到同一条时间轴。
          ctsUs: toMicros(Math.max(0, sample.time + sample.cts - videoShift), track.timescale),
          durationUs: toMicros(sample.duration, track.timescale),
          key: sample.key,
          data: bytes.subarray(sample.offset, sample.offset + sample.size),
        });
      }
      if (audioTrack) {
        const audioList = buckets.get(audioTrack.id) || [];
        for (const sample of audioList) {
          audioSamples.push({
            ctsUs: toMicros(sample.time, audioTrack.timescale),
            data: bytes.subarray(sample.offset, sample.offset + sample.size),
          });
        }
      }
      state.phase = "loading";
      state.durationMs = 0;
      emit(true);
      onProgress(`seg ${seq}/${total}: ${bytes.length}B samples=${samples.length}`);
    }

    if (!samples.length) throw new PanelError("PROTOCOL", "没有解析到视频样本");

    // 解码顺序不一定是显示顺序，片尾取所有帧的最大显示结束时间。
    state.durationMs = Math.round(samples.reduce((end, sample) => Math.max(end, sample.ctsUs + sample.durationUs), 0) / 1000);
    // 帧持续显示到源轨的下一显示时间；真实时间戳空隙不是解码欠帧，不能因此永久缓冲。
    const timestamps = [...new Set(samples.map((sample) => sample.ctsUs))].sort((a, b) => a - b);
    firstVideoTimeUs = timestamps[0];
    videoFrameEnds.clear();
    timestamps.forEach((timestamp, index) => {
      videoFrameEnds.set(timestamp, timestamps[index + 1] ?? state.durationMs * 1000);
    });

    decodeConfig = {
      codec: track.codec,
      description: track.description,
      codedWidth: canvas.width,
      codedHeight: canvas.height,
      // 有硬件解码就走硬件，没有会自动回退软件解码；高倍速下仍以音画同步优先。
      hardwareAcceleration: "prefer-hardware",
    };
    onProgress(`cfg ${track.codec} keys=${samples.filter((sample) => sample.key).length}`);

    anchorTimeMs = Math.max(0, Math.min(Number(resumeMs) || 0, state.durationMs));
    anchored = true;
    // 续播与切清晰度直接从目标附近预热，不让旧起点的画面追赶已经续播的声音。
    resetVideoAt(anchorTimeMs);
    pump();
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (disposed || state.phase === "error") return;
    draw(anchorTimeMs);
    pump();

    await prepareAudio();
    if (disposed || state.phase === "error") return;

    anchorWall = performance.now();
    state.phase = "ready";
    previewing = true;
    rafId = requestAnimationFrame(tick);
    log(`[wvc] 就绪 ${track.codec} ${canvas.width}x${canvas.height} 样本=${samples.length} 时长=${state.durationMs}ms`);
    onProgress(`ready ${samples.length} 帧 / ${state.durationMs}ms`);
    emit(true);
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
    tempoRenderer?.destroy();
    tempoRenderer = null;
    try {
      audioCtx?.removeEventListener?.("statechange", syncAudioState);
      void audioCtx?.close().catch(() => {});
    } catch {
      // 忽略。
    }
    audioCtx = null;
    audioGain = null;
    audioBuffer = null;
    audioSamples = [];
    try {
      activeAudioDecoder?.close();
    } catch {
      // 已关闭时忽略。
    }
    activeAudioDecoder = null;
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
    if (audioGain) audioGain.gain.value = volumeLevel;
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
