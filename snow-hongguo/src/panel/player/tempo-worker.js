// 整集离线保调：左右声道共用一次 WSOLA 匹配，不改变采样率或音高。
import { Stretch } from "@soundtouchjs/core";

const BLOCK_FRAMES = 8192;
const SEQUENCE_MS = 50;
const SEEK_WINDOW_MS = 15;
const OVERLAP_MS = 8;

function renderTempo(data) {
  const { rate, sampleRate, frameCount, channels, planes } = data || {};
  if (!Number.isFinite(rate) || rate < 0.75 || rate > 3) {
    throw new RangeError("保调倍率必须是 0.75 到 3 之间的有限数值");
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError("保调音频的采样率无效");
  }
  if (!Number.isSafeInteger(frameCount) || frameCount < 1) {
    throw new RangeError("保调音频的帧数必须是有限正整数");
  }
  if (channels !== 1 && channels !== 2) {
    throw new RangeError("离线保调仅支持单声道或双声道音频");
  }
  if (!Array.isArray(planes) || planes.length !== channels) {
    throw new TypeError("保调音频的声道平面不完整");
  }
  for (const plane of planes) {
    if (!(plane instanceof Float32Array) || plane.length !== frameCount) {
      throw new TypeError("保调音频必须使用等长的 Float32 声道平面");
    }
  }

  const outputFrames = Math.max(1, Math.round(frameCount / rate));
  if (!Number.isSafeInteger(outputFrames)) {
    throw new RangeError("保调输出帧数超出安全范围");
  }
  const outputPlanes = Array.from({ length: channels }, () => new Float32Array(outputFrames));
  const stretch = new Stretch({ createBuffers: true, sampleRate });
  // 短语音窗口减少对白瞬态被拉长；同一组参数用于所有倍率。
  stretch.setStretchParameters({
    sequenceMs: SEQUENCE_MS,
    seekWindowMs: SEEK_WINDOW_MS,
    overlapMs: OVERLAP_MS,
    quickSeek: true,
  });
  stretch.tempo = rate;
  if (
    !Number.isSafeInteger(stretch.inputChunkSize) || stretch.inputChunkSize < 1 ||
    !Number.isSafeInteger(stretch.outputChunkSize) || rate * stretch.outputChunkSize < 1
  ) {
    throw new RangeError("保调参数未能产生有效的输入步长与输出窗口");
  }

  const input = new Float32Array(BLOCK_FRAMES * 2);
  const output = new Float32Array(BLOCK_FRAMES * 2);
  const left = planes[0];
  const right = planes[channels === 1 ? 0 : 1];
  let writtenFrames = 0;

  function processBlock(frames) {
    // putSamples/receiveSamples 的长度单位均为立体声帧，不是 float 数量。
    stretch.inputBuffer.putSamples(input, 0, frames);
    stretch.process();
    const available = stretch.outputBuffer.frameCount;
    for (let consumed = 0; consumed < available; consumed += BLOCK_FRAMES) {
      const received = Math.min(BLOCK_FRAMES, available - consumed);
      stretch.outputBuffer.receiveSamples(output, received);
      const toCopy = Math.min(received, outputFrames - writtenFrames);
      for (let frame = 0; frame < toCopy; frame += 1) {
        const l = output[frame * 2];
        const r = output[frame * 2 + 1];
        if (!Number.isFinite(l) || !Number.isFinite(r)) {
          throw new Error("保调算法产生了非有限音频样本");
        }
        outputPlanes[0][writtenFrames + frame] = l;
        if (channels === 2) outputPlanes[1][writtenFrames + frame] = r;
      }
      writtenFrames += toCopy;
    }
  }

  for (let offset = 0; offset < frameCount; offset += BLOCK_FRAMES) {
    const frames = Math.min(BLOCK_FRAMES, frameCount - offset);
    for (let frame = 0; frame < frames; frame += 1) {
      const l = left[offset + frame];
      const r = right[offset + frame];
      if (!Number.isFinite(l) || !Number.isFinite(r)) {
        throw new TypeError("保调输入包含非有限音频样本");
      }
      input[frame * 2] = l;
      input[frame * 2 + 1] = r;
    }
    processBlock(frames);
  }

  // bootstrap 消耗 overlap；每个完整窗口输出 outputChunkSize 帧。
  // 有限补零覆盖 lookahead、bootstrap 和一次名义输入步长，排出最后不足一窗的音频。
  // 只裁理论时长后的输出，不把算法的等待窗口算入媒体时间，也不以静音填补未处理尾音。
  const paddingBudget = Math.ceil(
    stretch.inputChunkSize + rate * stretch.outputChunkSize + (sampleRate * OVERLAP_MS) / 1000,
  );
  if (!Number.isSafeInteger(paddingBudget) || paddingBudget < 1) {
    throw new RangeError("保调尾部窗口长度无效");
  }
  input.fill(0);
  for (let padded = 0; padded < paddingBudget && writtenFrames < outputFrames; padded += BLOCK_FRAMES) {
    processBlock(Math.min(BLOCK_FRAMES, paddingBudget - padded));
  }
  if (writtenFrames !== outputFrames) {
    throw new Error("保调尾部未能在有限补零窗口内排空");
  }
  return { type: "done", rate, sampleRate, channels, frameCount: outputFrames, planes: outputPlanes };
}

self.onmessage = (event) => {
  // 一个 Worker 只处理一项任务；宿主收到完成或错误消息后立即 terminate。
  self.onmessage = null;
  try {
    const result = renderTempo(event.data);
    self.postMessage(result, result.planes.map((plane) => plane.buffer));
  } catch (error) {
    self.postMessage({
      type: "error",
      name: error?.name || "Error",
      message: error?.message || String(error),
    });
  } finally {
    self.close();
  }
};
