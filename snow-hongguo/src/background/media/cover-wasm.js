// 每张图独立 Worker，结束即释放 WASM 内存；队列限制避免整页封面同时解码。
import { Worker } from "node:worker_threads";
import { LIMITS } from "../../shared/contract.js";
import { MEDIA_LIMITS } from "./limits.js";

const WORKER_URL = new URL(
  typeof __HONGGUO_COVER_WORKER_PATH__ === "string" ? __HONGGUO_COVER_WORKER_PATH__ : "./cover-worker.js",
  import.meta.url
);
const MAX_WORKERS = 2;
const MAX_PENDING = 80;
const queue = [];
let active = 0;

const pump = () => {
  while (active < MAX_WORKERS && queue.length) queue.shift().start();
};

export function convertWithBundledDecoder(bytes, {
  timeoutMs = MEDIA_LIMITS.coverTimeoutMs,
  workerUrl = WORKER_URL,
} = {}) {
  if (!bytes?.length || bytes.length > LIMITS.coverMaxBytes) {
    return Promise.reject(new Error("封面字节数超出限制"));
  }
  if (queue.length >= MAX_PENDING) return Promise.reject(new Error("封面解码队列已满"));
  return new Promise((resolve, reject) => {
    let worker = null;
    let started = false;
    let settled = false;
    const finish = async (error, jpeg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
      // 等线程真正退出后释放并发名额，超时或崩溃也不能堵住后续封面。
      if (worker) await worker.terminate().catch(() => {});
      if (started) active -= 1;
      pump();
      if (error) reject(error);
      else resolve(jpeg);
    };
    const job = {
      start() {
        started = true;
        active += 1;
        try {
          worker = new Worker(workerUrl, {
            execArgv: [],
            resourceLimits: { maxOldGenerationSizeMb: 128 },
          });
          worker.once("message", (message) => {
            if (message?.error) return void finish(new Error(message.error));
            const data = message?.bytes;
            if (!(data instanceof Uint8Array) || data.length < 3 || data.length > LIMITS.coverMaxBytes ||
                data[0] !== 0xff || data[1] !== 0xd8) {
              return void finish(new Error("内置解码器未返回有效 JPEG"));
            }
            void finish(null, Buffer.from(data));
          });
          worker.once("error", (error) => void finish(error));
          worker.once("messageerror", (error) => void finish(error));
          worker.once("exit", (code) => void finish(new Error(`封面解码线程提前退出：${code}`)));
          const input = Uint8Array.from(bytes);
          worker.postMessage(input, [input.buffer]);
        } catch (error) {
          void finish(error);
        }
      },
    };
    // 超时包含排队时间；不让失败任务长时间占用面板的封面请求。
    const timer = setTimeout(() => void finish(new Error("内置 HEIC 解码超时")), timeoutMs);
    queue.push(job);
    pump();
  });
}
