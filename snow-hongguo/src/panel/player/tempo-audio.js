// build.mjs 将完整 Worker 注入字符串；源码单独加载时给出明确错误，不解析相对 URL。
const WORKER_SOURCE = typeof __HONGGUO_TEMPO_WORKER__ === "string" ? __HONGGUO_TEMPO_WORKER__ : "";
const RENDER_TIMEOUT_MS = 60_000;

function abortError() {
  return new DOMException("离线保调任务已取消", "AbortError");
}

/**
 * 整集按需保调。调用方仍以原媒体时间计时，输出 AudioBuffer 以 playbackRate=1 播放。
 * 仅持有一个已完成的非 1 倍缓存；同倍率 pending 返回同一个 Promise。
 * cancel 保留缓存，destroy 同时释放本模块持有的源音频、缓存和 context 引用。
 */
export function createTempoRenderer(context, sourceBuffer) {
  let destroyed = false;
  let pending = null;
  let cachedRate = null;
  let cachedBuffer = null;

  function releaseJob(job) {
    if (job.timer !== null) clearTimeout(job.timer);
    job.timer = null;
    if (job.worker) {
      job.worker.onmessage = null;
      job.worker.onerror = null;
      job.worker.onmessageerror = null;
      job.worker.terminate();
      job.worker = null;
    }
    if (job.url) URL.revokeObjectURL(job.url);
    job.url = null;
  }

  function settle(job, error, buffer) {
    if (pending !== job) return;
    pending = null;
    releaseJob(job);
    if (error) {
      job.reject(error);
    } else {
      cachedRate = job.rate;
      cachedBuffer = buffer;
      job.resolve(buffer);
    }
    job.resolve = null;
    job.reject = null;
  }

  function cancel() {
    if (pending) settle(pending, abortError());
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancel();
    cachedRate = null;
    cachedBuffer = null;
    sourceBuffer = null;
    context = null;
  }

  function getBuffer(rate) {
    if (destroyed) return Promise.reject(abortError());
    if (!Number.isFinite(rate) || rate < 0.75 || rate > 3) {
      return Promise.reject(new RangeError("保调倍率必须是 0.75 到 3 之间的有限数值"));
    }
    if (pending?.rate === rate) return pending.promise;
    // 包括回到 1 倍或已完成缓存的情况：新倍率首先取消旧的未完成任务。
    cancel();
    if (rate === 1) return Promise.resolve(sourceBuffer);
    if (cachedRate === rate && cachedBuffer) return Promise.resolve(cachedBuffer);

    const job = { rate, promise: null, resolve: null, reject: null, worker: null, url: null, timer: null };
    job.promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    pending = job;

    try {
      if (!sourceBuffer || typeof sourceBuffer.getChannelData !== "function") {
        throw new TypeError("离线保调需要有效的 AudioBuffer");
      }
      if (!context || typeof context.createBuffer !== "function") {
        throw new TypeError("离线保调需要有效的音频上下文");
      }
      const { numberOfChannels: channels, sampleRate, length: frameCount } = sourceBuffer;
      if (channels !== 1 && channels !== 2) {
        throw new RangeError("离线保调仅支持单声道或双声道音频");
      }
      if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isSafeInteger(frameCount) || frameCount < 1) {
        throw new RangeError("保调源音频的采样率或帧数无效");
      }
      const outputFrames = Math.max(1, Math.round(frameCount / rate));
      if (!Number.isSafeInteger(outputFrames)) throw new RangeError("保调输出帧数超出安全范围");
      if (
        typeof Worker !== "function" || typeof Blob !== "function" || typeof URL === "undefined" ||
        typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function"
      ) {
        throw new Error("当前宿主不支持 Blob Worker，无法进行保调播放");
      }
      if (!WORKER_SOURCE) throw new Error("缺少内嵌保调 Worker，请使用 build.mjs 生成的面板入口");

      job.url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
      try {
        job.worker = new Worker(job.url);
      } catch (error) {
        throw new Error(`无法启动保调 Worker（可能被 CSP 拒绝）：${error?.message || error}`);
      }
      job.worker.onmessage = (event) => {
        if (pending !== job) return;
        try {
          const result = event.data;
          if (result?.type === "error") {
            const error = new Error(`离线保调失败：${result.message || "Worker 未返回错误详情"}`);
            error.name = result.name || "Error";
            throw error;
          }
          if (
            result?.type !== "done" || result.rate !== rate || result.sampleRate !== sampleRate ||
            result.channels !== channels || result.frameCount !== outputFrames ||
            !Array.isArray(result.planes) || result.planes.length !== channels
          ) {
            throw new Error("保调 Worker 返回了无效的音频格式");
          }
          for (const plane of result.planes) {
            if (!(plane instanceof Float32Array) || plane.length !== outputFrames) {
              throw new Error("保调 Worker 返回了无效的 Float32 声道平面");
            }
          }
          const buffer = context.createBuffer(channels, outputFrames, sampleRate);
          for (let channel = 0; channel < channels; channel += 1) {
            buffer.copyToChannel(result.planes[channel], channel);
          }
          settle(job, null, buffer);
        } catch (error) {
          settle(job, error);
        }
      };
      job.worker.onerror = (event) => {
        event.preventDefault();
        settle(job, new Error(`保调 Worker 启动或执行失败（请检查 CSP 与宿主支持）：${event.message || "未知错误"}`));
      };
      job.worker.onmessageerror = () => settle(job, new Error("保调 Worker 音频结果无法反序列化"));
      job.timer = setTimeout(() => {
        const error = new Error("离线保调处理超时（60 秒）");
        error.name = "TimeoutError";
        settle(job, error);
      }, RENDER_TIMEOUT_MS);

      // 只转移独立副本，绝不 transfer AudioBuffer 的原始通道存储。
      const planes = [];
      for (let channel = 0; channel < channels; channel += 1) {
        const plane = sourceBuffer.getChannelData(channel);
        if (!(plane instanceof Float32Array) || plane.length !== frameCount) {
          throw new TypeError("保调源音频必须使用等长的 Float32 声道平面");
        }
        planes.push(new Float32Array(plane));
      }
      job.worker.postMessage(
        { rate, sampleRate, frameCount, channels, planes },
        planes.map((plane) => plane.buffer),
      );
    } catch (error) {
      settle(job, error);
    }
    return job.promise;
  }

  return { getBuffer, cancel, destroy };
}
