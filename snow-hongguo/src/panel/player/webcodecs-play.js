// WebCodecs 播放引擎：绕开 <video> 的媒体加载，自己解 fMP4 并渲染到 canvas。
//
// 背景：宿主页面 CSP 是 default-src 'self'，没有 media-src，<video> 连 blob: 都加载不了
// （实测 video.error.message = "Media load rejected by URL safety check"），
// MSE / Blob / data: / http 回环全部不可用。唯一能走的是直接在渲染进程解码：
//   init + 分片 -> 解析样本 -> VideoDecoder -> VideoFrame -> canvas.drawImage
// 这条链路不经过任何 URL 加载，CSP 管不到。
//
// 本文件只负责「视频画面 + 时钟」，音频由上层另外接管。
import { PanelError } from "../rpc.js";
import { parseMp4, parseSegment, toMicros } from "./mp4.js";
import { decodeBase64 } from "./util.js";

const MAX_DECODE_PER_TICK = 16;
// 720x1280 的 VideoFrame 单帧约 3.7MB，囤太多会撑爆显存反过来拖慢解码器。
const MAX_BUFFERED_FRAMES = 40;
// 落后超过这个量就认为是解码跟不上，直接跳到目标时间前的关键帧，避免画面越拖越远。
const RESYNC_LAG_US = 1_500_000;
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
  let rafId = 0;
  let anchored = false;
  let anchorWall = 0;
  let anchorTimeMs = 0;
  let playing = false;
  let lastEmitAt = 0;
  // 同一帧不重复 drawImage：视频 30fps、rAF 60fps，重复绘制纯属浪费主线程。
  let lastDrawnTs = -1;
  // 音频：整集解成一条 AudioBuffer，AudioContext 的硬件时钟同时充当播放主时钟。
  let audioTrack = null;
  let audioSamples = [];
  let audioCtx = null;
  let audioBuffer = null;
  let audioSource = null;
  let audioGain = null;
  let audioStartCtxTime = 0;
  let audioStartMs = 0;
  // 音频时钟只有在上下文真正运行时才可信；挂起时 currentTime 不前进。
  let audioClockActive = false;

  const state = {
    phase: "idle",
    timeMs: 0,
    durationMs: 0,
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

  const currentMs = () => {
    // 音频时钟只在上下文真正运行时可信：被自动播放策略挂起时 currentTime 不前进，
    // 若仍按它计时，画面与进度会永久停在起点，也永远到不了 ended。
    if (playing && audioClockActive && audioSource && audioCtx && audioCtx.state === "running") {
      // 音频没到 start(when) 之前 elapsed 为负，此时交给下面的墙钟兜底。
      const elapsed = audioCtx.currentTime - audioStartCtxTime;
      if (elapsed >= 0) return audioStartMs + elapsed * 1000;
    }
    if (!anchored) return anchorTimeMs;
    if (!playing) return anchorTimeMs;
    return anchorTimeMs + (performance.now() - anchorWall);
  };

  const clearFrames = () => {
    lastDrawnTs = -1;
    for (const frame of frames.values()) {
      try {
        frame.close();
      } catch {
        // 已关闭时忽略。
      }
    }
    frames.clear();
  };

  const ensureDecoder = () => {
    if (decoder && decoder.state === "configured") return decoder;
    try {
      decoder?.close();
    } catch {
      // 忽略。
    }
    decoder = new VideoDecoder({
      output: (frame) => {
        state.output += 1;
        // 跳帧后同一时间点可能重复产出，先释放旧对象再覆盖，避免 VideoFrame 泄漏。
        const existing = frames.get(frame.timestamp);
        if (existing) {
          try {
            existing.close();
          } catch {
            // 忽略。
          }
        }
        frames.set(frame.timestamp, frame);
      },
      error: (error) => {
        state.error = String(error?.message || error).slice(0, 120);
        state.phase = "error";
        log(`[wvc] 解码器错误：${state.error}`);
        emit(true);
      },
    });
    try {
      decoder.configure(decodeConfig);
    } catch (error) {
      state.error = `configure: ${String(error?.message || error)}`.slice(0, 120);
      state.phase = "error";
      log(`[wvc] configure 失败：${state.error}`);
      emit(true);
      throw error;
    }
    return decoder;
  };

  const pump = () => {
    if (disposed || !decodeConfig || nextIndex >= samples.length) return;
    const dec = ensureDecoder();
    let count = 0;
    while (nextIndex < samples.length && count < MAX_DECODE_PER_TICK) {
      // 控制解码领先量：已缓冲帧 + 解码器内部队列过多时先停手。
      if (frames.size + dec.decodeQueueSize >= MAX_BUFFERED_FRAMES) break;
      const sample = samples[nextIndex];
      nextIndex += 1;
      try {
        dec.decode(
          new EncodedVideoChunk({
            type: sample.key ? "key" : "delta",
            timestamp: sample.ctsUs,
            duration: sample.durationUs,
            data: sample.data,
          })
        );
        state.decoded += 1;
      } catch (error) {
        state.error = String(error?.message || error).slice(0, 120);
        state.phase = "error";
        log(`[wvc] decode 异常：${state.error}`);
        emit(true);
        break;
      }
      count += 1;
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

  const draw = () => {
    if (!track) return;
    const nowUs = currentMs() * 1000;
    // 只向前推进：已绘制过的时间点不再回头，帧一画完就释放。
    let pick = -1;
    for (const timestamp of frames.keys()) {
      if (timestamp > lastDrawnTs && timestamp <= nowUs && (pick < 0 || timestamp > pick)) {
        pick = timestamp;
      }
    }
    if (pick < 0) return;
    const frame = frames.get(pick);
    lastDrawnTs = pick;
    try {
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      state.picked += 1;
    } catch (error) {
      state.drawError = String(error?.message || error).slice(0, 90);
      log(`[wvc] drawImage 失败：${state.drawError}`);
    }
    // 当前帧与被跳过的旧帧一起释放：像素已经进 canvas，继续持有只会占显存并给解码器制造背压。
    for (const timestamp of [...frames.keys()]) {
      if (timestamp <= pick) dropFrame(timestamp);
    }
  };

  /**
   * 解码跟不上时（缓冲空了、下一帧还远在当前时间之前），直接跳到目标时间前的关键帧。
   * 不这样做的话，音频时钟继续走、画面还停在旧帧，看起来就是越拖越远的音画不同步。
   */
  const resyncIfBehind = (nowUs) => {
    if (disposed || !decodeConfig || nextIndex >= samples.length) return;
    if (decoder?.decodeQueueSize > 0) return;
    const next = samples[nextIndex];
    if (!next || next.ctsUs >= nowUs - RESYNC_LAG_US) return;
    let index = nextIndex;
    for (let cursor = nextIndex; cursor < samples.length; cursor += 1) {
      if (samples[cursor].ctsUs > nowUs) break;
      if (samples[cursor].key) index = cursor;
    }
    if (index <= nextIndex) return;
    nextIndex = index;
    state.dropped += 1;
    for (const timestamp of [...frames.keys()]) dropFrame(timestamp);
    lastDrawnTs = -1;
    try {
      decoder?.reset();
    } catch {
      // 忽略。
    }
    decoder = null;
    log(`[wvc] 解码落后，跳到 ${Math.round(samples[index].ctsUs / 1000)}ms`);
  };

  const tick = () => {
    if (disposed || !playing) return;
    try {
      resyncIfBehind(currentMs() * 1000);
      pump();
      draw();
    } catch (error) {
      state.error = String(error?.message || error).slice(0, 120);
      state.phase = "error";
      log(`[wvc] 播放循环异常：${state.error}`);
      emit(true);
      return;
    }
    if (currentMs() >= state.durationMs) {
      playing = false;
      anchorTimeMs = state.durationMs;
      state.phase = "ended";
      stopAudio();
      emit(true);
      return;
    }
    emit(false);
    rafId = requestAnimationFrame(tick);
  };

  const stopAudio = () => {
    audioClockActive = false;
    if (!audioSource) return;
    try {
      audioSource.stop();
    } catch {
      // 已停止时忽略。
    }
    try {
      audioSource.disconnect();
    } catch {
      // 忽略。
    }
    audioSource = null;
  };

  const startAudio = (fromMs) => {
    if (!audioCtx || !audioBuffer || !audioGain) return;
    stopAudio();
    const at = Math.max(0, Math.min(Number(fromMs) || 0, state.durationMs));
    // 两个时钟共用同一基准：音频未获准播放时，画面靠墙钟继续推进。
    anchorTimeMs = at;
    anchorWall = performance.now();
    audioStartMs = at;
    void audioCtx.resume().catch(() => {});
    // 上下文仍被挂起时不排音频，避免冻结的 currentTime 又接管主时钟。
    if (audioCtx.state !== "running") return;
    const offset = Math.min(at / 1000, audioBuffer.duration);
    // resume() 是异步的：用 start(when) 给一个确定的启动时刻，并把它当播放时钟基准，
    // 否则音频会晚 resume 的那几十毫秒才响，而视频已经用 performance.now() 先走了。
    const when = audioCtx.currentTime + 0.06;
    audioStartCtxTime = when;
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioGain);
    source.start(when, offset);
    audioSource = source;
    audioClockActive = true;
  };

  /** AudioContext 状态变化时重排音频：恢复后从墙钟当前位置接回，挂起时立即停止音频计时。 */
  const syncAudioState = () => {
    if (disposed || !audioCtx) return;
    if (audioCtx.state === "running") {
      if (playing && !audioClockActive) startAudio(currentMs());
      return;
    }
    if (!audioClockActive) return;
    const at = currentMs();
    audioClockActive = false;
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
        // 忽略。
      }
    }

    if (failure || !total) {
      onProgress(`audio 失败: ${failure || "无输出"}`);
      return;
    }

    try {
      audioCtx = new AudioContext({ sampleRate });
      audioCtx.addEventListener("statechange", syncAudioState);
      const targetRate = Number(audioCtx.sampleRate) || sampleRate;
      audioGain = audioCtx.createGain();
      audioGain.gain.value = 1;
      audioGain.connect(audioCtx.destination);

      // AAC 编码器有 priming 延迟，elst 的 media_time 正是开头要丢掉的采样数（红果是 2048）。
      const skip = Math.max(0, Math.min(Number(audioTrack.mediaTime) || 0, total));
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
      audioCtx = null;
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

    // 时长取最后一帧的显示结束时间，比 info 里的 durationMs 更贴合实际样本。
    const last = samples[samples.length - 1];
    state.durationMs = Math.round((last.ctsUs + last.durationUs) / 1000);

    decodeConfig = {
      codec: track.codec,
      description: track.description,
      codedWidth: canvas.width,
      codedHeight: canvas.height,
      // 有硬件解码就走硬件，没有会自动回退软件解码；720x1280 竖屏纯软解只能勉强实时。
      hardwareAcceleration: "prefer-hardware",
    };
    onProgress(`cfg ${track.codec} keys=${samples.filter((sample) => sample.key).length}`);

    // 预热：先解出一批帧，点播放时立刻就有画面，不会出现「声音先到、画面还在解」。
    pump();
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (disposed) return;
    pump();

    // 音频要整集解码成 AudioBuffer，耗时主要花在这里。
    await prepareAudio();
    if (disposed) return;

    anchorTimeMs = Math.max(0, Math.min(Number(resumeMs) || 0, state.durationMs));
    anchorWall = performance.now();
    anchored = true;
    state.phase = "ready";
    log(`[wvc] 就绪 ${track.codec} ${canvas.width}x${canvas.height} 样本=${samples.length} 时长=${state.durationMs}ms`);
    onProgress(`ready ${samples.length} 帧 / ${state.durationMs}ms`);
    emit(true);
  };

  const play = () => {
    if (disposed || !decodeConfig) return;
    if (state.phase === "ended") seek(0);
    if (!playing) {
      const from = currentMs();
      anchorWall = performance.now();
      playing = true;
      startAudio(from);
    }
    state.phase = "playing";
    pump();
    stopLoop();
    rafId = requestAnimationFrame(tick);
    emit(true);
  };

  const pause = () => {
    if (!playing) return;
    anchorTimeMs = currentMs();
    playing = false;
    stopAudio();
    state.phase = "paused";
    stopLoop();
    emit(true);
  };

  const seek = (ms) => {
    if (!decodeConfig) return;
    const target = Math.max(0, Math.min(Number(ms) || 0, state.durationMs));
    const targetUs = target * 1000;

    // 回到目标时间之前最近的关键帧，重新解码。
    let index = 0;
    for (let cursor = 0; cursor < samples.length; cursor += 1) {
      if (samples[cursor].ctsUs > targetUs) break;
      if (samples[cursor].key) index = cursor;
    }

    clearFrames();
    stopLoop();
    stopAudio();
    try {
      decoder?.reset();
    } catch {
      // 忽略。
    }
    decoder = null;
    nextIndex = index;
    anchorTimeMs = target;
    anchorWall = performance.now();
    anchored = true;
    state.error = "";
    if (playing) {
      state.phase = "playing";
      pump();
      startAudio(target);
      rafId = requestAnimationFrame(tick);
    } else {
      state.phase = "paused";
      pump();
    }
    emit(true);
  };

  const destroy = () => {
    if (disposed) return;
    disposed = true;
    playing = false;
    stopLoop();
    stopAudio();
    try {
      audioCtx?.removeEventListener?.("statechange", syncAudioState);
      void audioCtx?.close();
    } catch {
      // 忽略。
    }
    audioCtx = null;
    audioBuffer = null;
    audioSamples = [];
    clearFrames();
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
    const level = Math.max(0, Math.min(1, Number(value) || 0));
    if (audioGain) audioGain.gain.value = level;
    return level;
  };

  return {
    load,
    play,
    pause,
    seek,
    setVolume,
    destroy,
    resumeAudio,
    getState: () => ({ ...state, timeMs: currentMs(), volume: audioGain ? audioGain.gain.value : 1 }),
  };
};
