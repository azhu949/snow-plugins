import assert from "node:assert/strict";

// 用真实帧数和时间轴模拟 Web Audio；记录排程，禁止迟到播放和两倍速二次加速。
export function installAudio(t, setGlobals, clock = () => 0, { outputSampleRate, deferred = false } = {}) {
  const contexts = [], decoders = [], sources = [];
  class Chunk { constructor(options) { Object.assign(this, options); } }
  class Decoder {
    constructor(callbacks) { this.callbacks = callbacks; this.state = "unconfigured"; this.decodeQueueSize = 0; this.flushes = 0; this.pending = []; this.maxQueue = 0; decoders.push(this); }
    configure(config) { this.config = config; this.state = "configured"; }
    decode(chunk) {
      assert.equal(this.state, "configured");
      if (!deferred) { this.output(chunk); return; }
      this.pending.push(chunk);
      this.decodeQueueSize++;
      this.maxQueue = Math.max(this.maxQueue, this.decodeQueueSize);
    }
    output(chunk) {
      const sampleRate = outputSampleRate || this.config.sampleRate;
      const count = Math.round((chunk.duration || 23220) / 1e6 * sampleRate);
      this.callbacks.output({ sampleRate, numberOfFrames: count,
        numberOfChannels: this.config.numberOfChannels, timestamp: chunk.timestamp,
        copyTo(plane) { plane.fill(0.25); }, close() {} });
    }
    drain(count = Infinity) {
      while (this.pending.length && count-- > 0) {
        this.output(this.pending.shift());
        this.decodeQueueSize--;
        this.ondequeue?.();
      }
      if (!this.pending.length) this.resolveFlush?.();
    }
    async flush() { this.flushes++; if (this.pending.length) await new Promise((resolve) => { this.resolveFlush = resolve; }); }
    close() { this.state = "closed"; }
  }
  class Context {
    constructor() { this.sampleRate = 48000; this.state = "running"; this.destination = {}; this.listeners = new Set(); contexts.push(this); }
    get currentTime() { return clock() / 1000; }
    addEventListener(_name, fn) { this.listeners.add(fn); }
    removeEventListener(_name, fn) { this.listeners.delete(fn); }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
    createGain() { return { connect() {}, disconnect() {}, gain: { value: 1, setValueAtTime() {}, cancelAndHoldAtTime() {}, linearRampToValueAtTime() {} } }; }
    createBuffer(channels, length, sampleRate) {
      const planes = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
        getChannelData: (c) => planes[c], copyToChannel: (plane, c) => planes[c].set(plane) };
    }
    createBufferSource() {
      const context = this;
      const source = { context, playbackRate: { value: 1 }, connect() {}, disconnect() {},
        start(when) { assert.ok(when >= context.currentTime - 0.006, "音块不能迟到排程"); this.when = when; sources.push(this); },
        stop(when = context.currentTime) { this.stopped = true; this.stopAt = when; } };
      return source;
    }
  }
  setGlobals({ AudioContext: Context, AudioDecoder: Decoder, EncodedAudioChunk: Chunk });
  // 音频事件独立于动画帧；按声卡时间交付，包括暂停后迟到的 ended。
  const dispatchEnded = () => {
    for (const source of [...sources]) {
      const end = Math.min(source.when + source.buffer.duration, source.stopAt ?? Infinity);
      if (source.ended || end > source.context.currentTime + 1e-9) continue;
      source.ended = true;
      source.onended?.();
    }
  };
  return { contexts, decoders, sources, dispatchEnded };
}
