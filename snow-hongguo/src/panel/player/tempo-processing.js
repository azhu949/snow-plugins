// 连续 PCM 块共用 WSOLA 状态，分段边界不重置窗口、不补静音；只在真正片尾排空。
import { Stretch } from "@soundtouchjs/core";

const BLOCK_FRAMES = 8192;
const OVERLAP_MS = 8;

export function createTempoProcessor({ rate, sampleRate, channels }) {
  if (!Number.isFinite(rate) || rate < 0.75 || rate > 3) throw new RangeError("无效的保调倍率");
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError("无效的采样率");
  if (channels !== 1 && channels !== 2) throw new RangeError("保调仅支持单声道或双声道");
  const stretch = new Stretch({ createBuffers: true, sampleRate });
  stretch.setStretchParameters({ sequenceMs: 50, seekWindowMs: 15, overlapMs: OVERLAP_MS, quickSeek: true });
  stretch.tempo = rate;
  const input = new Float32Array(BLOCK_FRAMES * 2);
  const output = new Float32Array(BLOCK_FRAMES * 2);
  let received = 0;
  let emitted = 0;
  let finished = false;

  return {
    append(planes, final = false) {
      if (finished) throw new Error("保调流已经结束");
      if (!Array.isArray(planes) || planes.length !== channels) throw new TypeError("声道平面不完整");
      const frames = planes[0]?.length;
      if (!Number.isSafeInteger(frames) || planes.some((plane) => !(plane instanceof Float32Array) || plane.length !== frames)) {
        throw new TypeError("保调输入必须是等长 Float32 声道平面");
      }
      received += frames;
      const expected = Math.round(received / rate);
      const blocks = [];
      let count = 0;
      const process = (size) => {
        stretch.inputBuffer.putSamples(input, 0, size);
        stretch.process();
        while (stretch.outputBuffer.frameCount > 0 && emitted < expected) {
          const size = Math.min(BLOCK_FRAMES, stretch.outputBuffer.frameCount, expected - emitted);
          stretch.outputBuffer.receiveSamples(output, size);
          const block = Array.from({ length: channels }, () => new Float32Array(size));
          for (let i = 0; i < size; i++) {
            for (let c = 0; c < channels; c++) {
              const value = output[i * 2 + c];
              if (!Number.isFinite(value)) throw new Error("保调产生了无效音频样本");
              block[c][i] = value;
            }
          }
          blocks.push(block);
          emitted += size;
          count += size;
        }
      };
      for (let offset = 0; offset < frames; offset += BLOCK_FRAMES) {
        const size = Math.min(BLOCK_FRAMES, frames - offset);
        for (let i = 0; i < size; i++) {
          const left = planes[0][offset + i];
          const right = planes[channels === 1 ? 0 : 1][offset + i];
          if (!Number.isFinite(left) || !Number.isFinite(right)) throw new TypeError("保调输入含无效音频样本");
          input[i * 2] = left;
          input[i * 2 + 1] = right;
        }
        process(size);
      }
      if (final) {
        const budget = Math.ceil(stretch.inputChunkSize + rate * stretch.outputChunkSize + sampleRate * OVERLAP_MS / 1000);
        input.fill(0);
        for (let padded = 0; padded < budget && emitted < expected; padded += BLOCK_FRAMES) {
          process(Math.min(BLOCK_FRAMES, budget - padded));
        }
        if (emitted !== expected) throw new Error("保调尾部未能排空");
        finished = true;
      }
      const result = Array.from({ length: channels }, () => new Float32Array(count));
      let offset = 0;
      for (const block of blocks) {
        for (let c = 0; c < channels; c++) result[c].set(block[c], offset);
        offset += block[0].length;
      }
      return { planes: result, frameCount: count, final, rate, sampleRate, channels };
    },
  };
}
