import { createTempoStreamRenderer } from "./tempo-audio.js";

const MAX_PCM_BYTES = 128 * 1024 * 1024;
const DECODE_QUEUE_LIMIT = 64;
const AHEAD_SECONDS = 3;
const START_AHEAD_SECONDS = 1;

/** 增量解 AAC；原始 PCM 按块保存供 seek，播放/保调只准备前方三秒的输出。 */
export function createStreamingAudio({ track, onError, onStateChange = () => {}, createRenderer = createTempoStreamRenderer }) {
  if (!track || typeof AudioDecoder !== "function" || typeof AudioContext !== "function") return null;
  let sampleRate = Number(track.sampleRate) || 44100;
  const channels = Math.max(1, Number(track.channels) || 2);
  const context = new AudioContext({ sampleRate });
  context.addEventListener("statechange", onStateChange);
  const gain = context.createGain();
  gain.connect(context.destination);
  const pcm = [];
  const encoded = [];
  let totalFrames = 0;
  let formatReady = false;
  let skip = Math.round(Math.max(0, Number(track.mediaTime) || 0) / (Number(track.timescale) || sampleRate) * sampleRate);
  let inputDone = false;
  let decodedDone = false;
  let flushing = false;
  let pumping = false;
  let disposed = false;
  let failed = false;
  let session = null;
  const error = (reason) => {
    if (disposed || failed) return;
    failed = true;
    onError(reason);
  };

  const decoder = new AudioDecoder({
    output(data) {
      try {
        if (disposed || failed) return;
        if (!formatReady) {
          // HE-AAC 解码输出可能采用扩展采样率；后续缓存与保调以实际 PCM 格式计时。
          if (!(data.sampleRate > 0)) throw new Error("音频解码采样率无效");
          if (sampleRate !== data.sampleRate) cancel();
          sampleRate = data.sampleRate;
          skip = Math.round(Math.max(0, Number(track.mediaTime) || 0) / (Number(track.timescale) || sampleRate) * sampleRate);
          formatReady = true;
        }
        if (data.sampleRate !== sampleRate) throw new Error("播放过程中音频采样率发生变化");
        const drop = Math.min(skip, data.numberOfFrames);
        skip -= drop;
        const size = data.numberOfFrames - drop;
        if (!size) return;
        if ((totalFrames + size) * channels * 4 > MAX_PCM_BYTES) throw new Error("本集音频超出本机内存上限");
        const planes = Array.from({ length: channels }, (_, channel) => {
          const plane = new Float32Array(data.numberOfFrames);
          data.copyTo(plane, { planeIndex: Math.min(channel, data.numberOfChannels - 1), format: "f32-planar" });
          return drop ? plane.slice(drop) : plane;
        });
        pcm.push({ start: totalFrames, size, planes });
        totalFrames += size;
        pumpOutput();
      } catch (reason) { error(reason); } finally { data.close(); }
    },
    error,
  });

  const pumpDecode = () => {
    if (disposed || failed || pumping || flushing) return;
    pumping = true;
    try {
      while (encoded.length && decoder.decodeQueueSize < DECODE_QUEUE_LIMIT) {
        const sample = encoded.shift();
        decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: sample.ctsUs, duration: sample.durationUs, data: sample.data }));
      }
      if (inputDone && !encoded.length) {
        flushing = true;
        // flush 只在整条音轨提交完毕后调用，不在每个网络分段边界重置解码状态。
        void decoder.flush().then(() => {
          if (disposed || failed) return;
          decodedDone = true;
          decoder.close();
          pumpOutput();
        }).catch(error);
      }
    } catch (reason) { error(reason); } finally { pumping = false; }
  };
  decoder.ondequeue = pumpDecode;
  try {
    decoder.configure({ codec: track.codec, sampleRate, numberOfChannels: channels,
      ...(track.description?.byteLength ? { description: track.description } : {}) });
  }
  catch (reason) { decoder.close(); void context.close().catch(() => {}); throw reason; }

  const readPcm = (target, count) => {
    const planes = Array.from({ length: channels }, () => new Float32Array(count));
    let copied = 0;
    while (copied < count) {
      const chunk = pcm[target.index];
      if (!chunk) throw new Error("音频缓冲区不完整");
      const offset = target.cursor + copied - chunk.start;
      if (offset >= chunk.size) { target.index++; continue; }
      const size = Math.min(count - copied, chunk.size - offset);
      for (let c = 0; c < channels; c++) planes[c].set(chunk.planes[c].subarray(offset, offset + size), copied);
      copied += size;
    }
    target.cursor += count;
    return planes;
  };

  const schedule = (target) => {
    if (session !== target || target.when === null || target.missed) return;
    while (target.queue.length) {
      const when = target.when + target.scheduled / sampleRate;
      // 已错过声卡排程时间，交给播放器冻结并从当前位置重建，不能把迟到的音块拼到错误时间轴。
      if (when < context.currentTime - 0.005) { target.missed = true; return; }
      const buffer = target.queue.shift();
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 1;
      source.connect(target.gain);
      target.sources.add(source);
      source.onended = () => {
        source.disconnect();
        target.sources.delete(source);
        if (target.cancelled && !target.sources.size) target.gain.disconnect();
        // 音频事件在后台仍会交付；不依赖可能暂停的动画帧续排。
        // 暂停、seek 或销毁后迟到的事件只能清理旧源。
        if (session === target) pumpOutput();
      };
      source.start(when);
      target.scheduled += buffer.length;
    }
  };

  const accept = (target, result) => {
    if (disposed || session !== target) return;
    target.busy = false;
    target.final = result.final;
    const length = result.planes[0].length;
    if (length) {
      // 保留轨道采样率，由 Web Audio 重采样到设备，避免把 44.1k PCM 当成 48k 播放。
      const buffer = context.createBuffer(channels, length, sampleRate);
      for (let c = 0; c < channels; c++) buffer.copyToChannel(result.planes[c], c);
      target.queue.push(buffer);
      target.produced += length;
    }
    schedule(target);
  };

  function pumpOutput() {
    const target = session;
    if (!target || disposed || failed || target.busy || target.final || target.missed) return;
    try {
      // 用排程起点和声卡时钟计算已播放的输出秒数；画面停止刷新也会继续推进。
      const elapsed = target.when === null ? 0 : Math.max(0, context.currentTime - target.when);
      while (!target.busy && !target.final && !target.missed && target.produced / sampleRate - elapsed < AHEAD_SECONDS) {
        const available = Math.max(0, totalFrames - target.cursor);
        if (!decodedDone && available < sampleRate / 4) break;
        const count = Math.min(available, sampleRate);
        const planes = readPcm(target, count);
        const final = decodedDone && target.cursor >= totalFrames;
        if (target.rate === 1) accept(target, { planes, final });
        else {
          target.renderer ??= createRenderer({ rate: target.rate, sampleRate, channels });
          target.busy = true;
          void target.renderer.append(planes, final).then((result) => {
            try { accept(target, result); pumpOutput(); } catch (reason) { error(reason); }
          }).catch((reason) => { if (session === target && reason?.name !== "AbortError") error(reason); });
        }
      }
    } catch (reason) { error(reason); }
  }

  const cancel = () => {
    const target = session;
    session = null;
    if (!target) return;
    target.renderer?.destroy();
    target.cancelled = true;
    const now = context.currentTime;
    let end = now;
    if (!disposed && context.state === "running" && target.sources.size) {
      target.gain.gain.cancelAndHoldAtTime(now);
      target.gain.gain.linearRampToValueAtTime(0, now + 0.005);
      end += 0.005;
    }
    // 旧源（含尚未开始的源）全部取消，异步 Worker 回包也不能重新发声。
    for (const source of target.sources) {
      try { source.stop(end); } catch { /* 已结束。 */ }
      if (end === now) source.disconnect();
    }
    if (end === now || !target.sources.size) { target.sources.clear(); target.gain.disconnect(); }
    target.queue.length = 0;
  };

  return {
    context,
    append(samples) { if (!disposed && !inputDone) { for (const sample of samples) encoded.push(sample); pumpDecode(); } },
    finish() { if (!disposed) { inputDone = true; pumpDecode(); } },
    get bufferedMs() { return totalFrames / sampleRate * 1000; },
    get complete() { return decodedDone; },
    get scheduledEndMs() { return session ? session.startMs + session.scheduled / sampleRate * session.rate * 1000 : 0; },
    get ended() { return decodedDone && (!session || (session.final && !session.queue.length)); },
    get missed() { return session?.missed === true; },
    prepare(at, rate) {
      if (disposed || failed) return false;
      if (decodedDone && at >= totalFrames / sampleRate * 1000) return true;
      if (!session || session.startMs !== at || session.rate !== rate) {
        cancel();
        const cursor = Math.floor(at / 1000 * sampleRate);
        const index = pcm.findIndex((chunk) => chunk.start + chunk.size > cursor);
        const sessionGain = context.createGain();
        sessionGain.connect(gain);
        session = { startMs: at, rate, cursor, index: index < 0 ? pcm.length : index, produced: 0, scheduled: 0,
          queue: [], sources: new Set(), gain: sessionGain, when: null, missed: false, busy: false, final: false, renderer: null };
      }
      pumpOutput();
      return Boolean(session && (session.produced >= sampleRate * START_AHEAD_SECONDS || (session.final && session.produced > 0)));
    },
    start(when) {
      if (!session || !session.produced) return false;
      session.when = when;
      session.gain.gain.setValueAtTime(0, when);
      session.gain.gain.linearRampToValueAtTime(1, when + 0.005);
      schedule(session);
      return true;
    },
    update() { if (session && session.when !== null) { pumpOutput(); if (session) schedule(session); } },
    setVolume(value) { gain.gain.value = value; },
    cancel,
    destroy() {
      if (disposed) return;
      disposed = true;
      cancel();
      try { decoder.close(); } catch { /* 已关闭。 */ }
      context.removeEventListener("statechange", onStateChange);
      void context.close().catch(() => {});
      gain.disconnect();
      pcm.length = encoded.length = 0;
    },
  };
}
