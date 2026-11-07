import test from "node:test";
import assert from "node:assert/strict";
import { resolveObjectURL } from "node:buffer";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createTempoProcessor } from "../src/panel/player/tempo-processing.js";
import { createStreamingAudio } from "../src/panel/player/stream-audio.js";
import { installAudio } from "./helpers/audio-env.js";

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
const track = { codec: "mp4a.40.2", sampleRate: 44100, channels: 2, mediaTime: 0, timescale: 44100 };
const packets = (seconds) => Array.from({ length: seconds * 10 }, (_, i) => ({ ctsUs: i * 100000, durationUs: 100000, data: new Uint8Array(1) }));
const workerBuild = await build({ entryPoints: [fileURLToPath(new URL("../src/panel/player/tempo-worker.js", import.meta.url))], bundle: true, write: false, format: "iife", platform: "browser" });
const bridgeBuild = await build({ entryPoints: [fileURLToPath(new URL("../src/panel/player/tempo-audio.js", import.meta.url))], bundle: true, write: false, format: "esm", platform: "browser",
  define: { __HONGGUO_TEMPO_WORKER__: JSON.stringify(workerBuild.outputFiles[0].text) } });
const { createTempoStreamRenderer } = await import(`data:text/javascript;base64,${Buffer.from(bridgeBuild.outputFiles[0].text).toString("base64")}`);

const setup = (t, options = {}) => {
  const previous = new Map(), workers = [];
  const globals = (values) => {
    for (const [key, value] of Object.entries(values)) {
      if (!previous.has(key)) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
  };
  let now = 0;
  const env = installAudio(t, globals, () => now, options);
  class Worker {
    constructor(url) {
      this.terminated = false;
      this.scope = { close() {}, postMessage: (data) => {
        const copy = structuredClone(data, { transfer: data.planes?.map((plane) => plane.buffer) || [] });
        queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: copy }); });
      } };
      this.ready = resolveObjectURL(url).text().then((source) => { new Function("self", source)(this.scope); });
      workers.push(this);
    }
    postMessage(data, transfer) {
      const copy = structuredClone(data, { transfer });
      void this.ready.then(() => { if (!this.terminated) this.scope.onmessage({ data: copy }); });
    }
    terminate() { this.terminated = true; }
  }
  globals({ Worker });
  t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return { ...env, workers, advance: (ms) => { now += ms; } };
};

test("MP4 原始 AAC 帧把 AudioSpecificConfig 交给解码器，保留 HE-AAC v2 类型", (t) => {
  const env = setup(t);
  const description = Uint8Array.from([0xeb, 0x8a, 0x08, 0x00]);
  const audio = createStreamingAudio({ track: { ...track, codec: "mp4a.40.29", description }, onError: assert.fail });
  t.after(() => audio.destroy());
  assert.equal(env.decoders[0].config.codec, "mp4a.40.29");
  assert.deepEqual(env.decoders[0].config.description, description, "缺少 ASC 会把裸 AAC 误当成 ADTS");
});

test("音频起播与缓冲恢复不接受只有一小块的输出，片尾短音频可以直接播完", async (t) => {
  const env = setup(t), errors = [];
  const audio = createStreamingAudio({ track, onError: (error) => errors.push(error) });
  t.after(() => audio.destroy());
  audio.append(packets(0.3));
  assert.equal(audio.prepare(0, 1), false);
  audio.append(packets(1));
  assert.equal(audio.prepare(0, 1), true);
  audio.start(0.06); audio.cancel();
  assert.equal(audio.prepare(1100, 1), false);
  audio.finish(); await settle();
  assert.equal(audio.prepare(1100, 1), true, "不能在不足起播门槛的片尾死等");
  assert.equal(audio.start(0.06), true);
  assert.deepEqual(errors, []);
  assert.ok(env.sources.every((source) => source.playbackRate.value === 1));
});

test("连续 WSOLA 在不同输入分块下结果一致，全部八档保持音高和完整尾音", () => {
  const sampleRate = 44100, length = sampleRate * 3;
  const wave = Float32Array.from({ length }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / sampleRate) * 0.5);
  for (const rate of [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
    const full = createTempoProcessor({ rate, sampleRate, channels: 2 }).append([wave, wave], true);
    const stream = createTempoProcessor({ rate, sampleRate, channels: 2 });
    const chunks = [];
    for (let offset = 0; offset < length; offset += 4096) {
      const part = wave.subarray(offset, offset + 4096);
      chunks.push(stream.append([part, part], offset + part.length === length));
    }
    assert.ok(chunks.slice(0, -1).some((chunk) => chunk.frameCount > 0), "必须在片尾前就有输出");
    assert.equal(chunks.reduce((sum, chunk) => sum + chunk.frameCount, 0), Math.round(length / rate));
    const joined = new Float32Array(full.frameCount);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk.planes[0], offset); offset += chunk.frameCount; }
    assert.deepEqual(joined, full.planes[0], "网络分段不能重置保调状态");
    assert.deepEqual(full.planes[0], full.planes[1], "双声道不能漂移");
    let crossings = 0;
    const from = Math.floor(sampleRate * 0.1), to = joined.length - from;
    for (let i = from + 1; i < to; i++) if (joined[i - 1] <= 0 && joined[i] > 0) crossings++;
    assert.ok(Math.abs(crossings * sampleRate / (to - from) - 440) < 8, "倍速后音高保持 440Hz 附近");
    assert.ok(joined.slice(-2000).some((value) => Math.abs(value) > 0.1), "片尾不能被静音替代");
  }
});

test("真实 Worker 桥按块回传、完成后释放；取消时拒绝在途任务", async (t) => {
  const env = setup(t);
  const renderer = createTempoStreamRenderer({ rate: 2, sampleRate: 44100, channels: 1 });
  const first = await renderer.append([new Float32Array(44100)]);
  assert.ok(first.frameCount > 0);
  assert.equal(env.workers.length, 1);
  assert.equal(env.workers[0].terminated, false);
  const last = await renderer.append([new Float32Array(44100)], true);
  assert.equal(first.frameCount + last.frameCount, 44100);
  assert.equal(env.workers[0].terminated, true);
  const cancelled = createTempoStreamRenderer({ rate: 1.5, sampleRate: 44100, channels: 1 });
  const rejection = assert.rejects(cancelled.append([new Float32Array(44100)]), { name: "AbortError" });
  cancelled.destroy(); await rejection; await settle();
  assert.equal(env.workers.at(-1).terminated, true);
});

test("音频不等整集，连续排程且采用原采样率；暂停和销毁停止所有已排程音源", async (t) => {
  const env = setup(t), errors = [];
  const audio = createStreamingAudio({ track, onError: (error) => errors.push(error) });
  t.after(() => audio.destroy());
  audio.append(packets(6));
  assert.equal(audio.complete, false);
  assert.equal(env.decoders[0].flushes, 0);
  assert.equal(audio.prepare(0, 1), true);
  assert.equal(audio.start(0.06), true);
  assert.ok(env.sources.length > 0);
  for (let i = 0; i < env.sources.length; i++) {
    assert.equal(env.sources[i].buffer.sampleRate, 44100, "48k 设备不能改变 44.1k PCM 的时长");
    if (i) assert.ok(Math.abs(env.sources[i].when - env.sources[i - 1].when - env.sources[i - 1].buffer.duration) < 1e-9);
  }
  assert.ok(audio.scheduledEndMs <= 4000, "只排程前方几秒，不持有整集播放缓冲");
  audio.cancel(); assert.ok(env.sources.every((source) => source.stopped));
  assert.equal(audio.prepare(4500, 1), true);
  audio.start(0.06);
  audio.finish(); await settle();
  assert.equal(env.decoders[0].flushes, 1);
  assert.equal(audio.complete, true);
  assert.equal(audio.bufferedMs, 6000);
  audio.destroy(); assert.equal(env.contexts[0].state, "closed");
  assert.ok(env.sources.every((source) => source.stopped));
  assert.deepEqual(errors, []);
});

test("没有动画帧更新时，音频事件仍按声卡时钟连续续排且缓冲有界", async (t) => {
  for (const rate of [0.75, 1, 2, 3]) await t.test(`${rate} 倍`, async (t) => {
    const env = setup(t), errors = [];
    const audio = createStreamingAudio({ track, onError: (error) => errors.push(error), createRenderer: createTempoStreamRenderer });
    t.after(() => audio.destroy());
    audio.append(packets(45)); audio.finish(); await settle();
    audio.prepare(5000, rate); await settle();
    assert.equal(audio.prepare(5000, rate), true);
    assert.equal(audio.start(0.06), true);
    for (let elapsed = 100; elapsed <= 10000; elapsed += 100) {
      env.advance(100);
      env.dispatchEnded();
      await settle();
      // 故意不调用 update 或任何动画帧：只有真实音频时间与 ended 事件推进。
      const scheduledEnd = env.sources.at(-1).when + env.sources.at(-1).buffer.duration;
      assert.ok(scheduledEnd > elapsed / 1000 + 1, "始终保留后续音块，不能在最初三秒后断音");
      assert.ok(scheduledEnd < elapsed / 1000 + 4.5, "后台也只准备有限窗口，不退回整集排程");
    }
    for (let i = 1; i < env.sources.length; i++) {
      assert.ok(Math.abs(env.sources[i].when - env.sources[i - 1].when - env.sources[i - 1].buffer.duration) < 1e-9);
      assert.equal(env.sources[i].playbackRate.value, 1);
    }
    audio.cancel();
    const count = env.sources.length;
    env.advance(5000); env.dispatchEnded(); await settle();
    assert.equal(env.sources.length, count, "暂停后的迟到 ended 不能恢复声音");
    assert.deepEqual(errors, []);
  });
});

test("倍速只处理当前位置后的有限窗口，改速取消旧 Worker，迟到结果不发声", async (t) => {
  const env = setup(t), errors = [];
  const audio = createStreamingAudio({ track, onError: (error) => errors.push(error), createRenderer: createTempoStreamRenderer });
  t.after(() => audio.destroy());
  audio.append(packets(30));
  assert.equal(audio.prepare(5000, 2), false);
  audio.cancel();
  assert.equal(audio.prepare(5000, 1.5), false);
  await settle();
  assert.equal(env.workers[0].terminated, true);
  assert.equal(env.sources.length, 0, "只有预处理不能发声");
  assert.equal(audio.prepare(5000, 1.5), true);
  assert.equal(audio.start(0.06), true);
  assert.ok(env.sources.length > 0);
  assert.ok(env.sources.every((source) => source.playbackRate.value === 1));
  assert.ok(audio.scheduledEndMs > 5000 && audio.scheduledEndMs < 11000);
  audio.cancel();
  const count = env.sources.length;
  await settle();
  assert.equal(env.sources.length, count);
  assert.ok(env.workers.every((worker) => worker.terminated));
  assert.deepEqual(errors, []);
});

test("新分段到达时保调窗口不中断，并在真正片尾排空", async (t) => {
  const env = setup(t), errors = [];
  const audio = createStreamingAudio({ track, onError: (error) => errors.push(error), createRenderer: createTempoStreamRenderer });
  t.after(() => audio.destroy());
  audio.append(packets(3));
  audio.prepare(0, 2); await settle();
  assert.equal(audio.prepare(0, 2), true);
  audio.start(0.06);
  audio.append(packets(1)); audio.finish(); await settle();
  audio.update();
  assert.equal(env.workers.length, 1);
  assert.equal(audio.ended, true);
  assert.equal(audio.scheduledEndMs, 4000);
  assert.ok(Math.abs(env.sources.reduce((sum, source) => sum + source.buffer.duration, 0) - 2) < 1e-9);
  assert.deepEqual(errors, []);
});

test("实际解码采样率用于 priming 和时长，设备采样率不会引入进度漂移", async (t) => {
  const env = setup(t, { outputSampleRate: 44100 }), errors = [];
  const audio = createStreamingAudio({ track: { ...track, sampleRate: 22050, timescale: 11025, mediaTime: 1102.5 }, onError: (error) => errors.push(error) });
  t.after(() => audio.destroy());
  audio.append(packets(2)); audio.finish(); await settle();
  assert.equal(audio.bufferedMs, 1900);
  assert.equal(audio.prepare(0, 1), true); audio.start(0.06);
  assert.ok(env.sources.every((source) => source.buffer.sampleRate === 44100));
  assert.equal(audio.scheduledEndMs, 1900);
  assert.deepEqual(errors, []);
});

test("异步解码队列有界，等待实际输出后才准备声音，销毁后的输出只释放", async (t) => {
  const env = setup(t, { deferred: true }), errors = [];
  const audio = createStreamingAudio({ track, onError: (error) => errors.push(error) });
  t.after(() => audio.destroy());
  audio.append(packets(30)); audio.finish();
  assert.equal(audio.prepare(0, 1), false);
  assert.equal(env.decoders[0].decodeQueueSize, 64);
  assert.equal(env.decoders[0].flushes, 0);
  env.decoders[0].drain(); await settle();
  assert.equal(env.decoders[0].maxQueue, 64);
  assert.equal(env.decoders[0].flushes, 1);
  assert.equal(audio.prepare(0, 1), true);
  audio.destroy();
  let closed = false;
  env.decoders[0].callbacks.output({ close() { closed = true; }, copyTo() { assert.fail("销毁后不能复制 PCM"); } });
  assert.equal(closed, true);
  assert.deepEqual(errors, []);
});
