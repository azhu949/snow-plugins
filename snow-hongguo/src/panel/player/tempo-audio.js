// build.mjs 内嵌完整 Worker；每段连续播放共用一个 Worker，暂停/seek/改速时销毁。
const WORKER_SOURCE = typeof __HONGGUO_TEMPO_WORKER__ === "string" ? __HONGGUO_TEMPO_WORKER__ : "";

export function createTempoStreamRenderer({ rate, sampleRate, channels }) {
  let worker = null;
  let url = null;
  let pending = null;
  let destroyed = false;
  const release = () => {
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    if (url) URL.revokeObjectURL(url);
    url = null;
  };
  const settle = (error, result) => {
    const job = pending;
    if (!job) return;
    pending = null;
    clearTimeout(job.timer);
    if (error || result?.final) { destroyed = true; release(); }
    if (error) job.reject(error); else job.resolve(result);
  };
  return {
    append(planes, final = false) {
      if (destroyed) return Promise.reject(new DOMException("保调流已取消", "AbortError"));
      if (pending) return Promise.reject(new Error("保调块必须顺序提交"));
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, timer: setTimeout(() => settle(new Error("保调处理超时")), 60000) };
        try {
          if (!worker) {
            if (!WORKER_SOURCE) throw new Error("缺少内嵌保调 Worker，请重新构建插件");
            url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
            worker = new Worker(url);
            worker.onmessage = ({ data }) => {
              if (data?.type === "error") { settle(new Error(data.message)); return; }
              if (data?.type !== "chunk" || data.rate !== rate || data.sampleRate !== sampleRate || data.channels !== channels
                || !Number.isSafeInteger(data.frameCount) || data.frameCount < 0
                || !Array.isArray(data.planes) || data.planes.length !== channels
                || data.planes.some((plane) => !(plane instanceof Float32Array) || plane.length !== data.frameCount)) {
                settle(new Error("保调 Worker 返回无效音频格式")); return;
              }
              settle(null, data);
            };
            worker.onerror = (event) => { event.preventDefault(); settle(new Error(event.message || "保调 Worker 失败")); };
            worker.onmessageerror = () => settle(new Error("保调音频无法反序列化"));
          }
          // 调用方传入独立副本；原始 PCM 留在播放缓存中供 seek 和改速使用。
          worker.postMessage({ rate, sampleRate, channels, planes, final }, planes.map((plane) => plane.buffer));
        } catch (error) { settle(error); }
      });
    },
    destroy() {
      destroyed = true;
      settle(new DOMException("保调流已取消", "AbortError"));
      release();
    },
  };
}
