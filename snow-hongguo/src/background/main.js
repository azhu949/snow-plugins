// 常驻后台模块入口（Electron 主进程，Node 全权限）。
// 生命周期：解析数据目录 -> 建缓存目录 -> 起本地 HTTP 服务 -> 注册清理；面板调用时才会加载 SDK。
import { createClient as createSdkClient, nodeTransport } from "openhongguo";
import { LIMITS, PORT_FIRST, PORT_LAST } from "../shared/contract.js";
import { createCache } from "./cache.js";
import { createMedia } from "./media/download.js";
import { createTranscoder } from "./media/transcode.js";
import { resolvePluginDataDir } from "./paths.js";
import { createSdk } from "./sdk.js";
import { startServer } from "./server.js";

const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

/** 真实的 openhongguo 客户端；设备恢复由 sdk.js 统一负责，故关闭 SDK 内部换设备。 */
const clientFactory = ({ profile, timeoutMs, retryAttempts, log }) =>
  createSdkClient({
    profile,
    transport: nodeTransport({ timeoutMs }),
    timeoutMs,
    retryAttempts,
    deviceResets: 0,
    log,
  });

export async function start(ctx) {
  const startedAt = Date.now();
  const tag = (name, text) => {
    try {
      ctx.log(`[hongguo:${name}] ${text}`);
    } catch {
      // 宿主日志异常不应影响服务。
    }
  };

  const dataDir = await resolvePluginDataDir({ log: (text) => tag("paths", text) });

  const cache = createCache({ rootDir: dataDir, log: (text) => tag("cache", text) });
  await cache.init();

  const sdk = createSdk({
    dataDir,
    clientFactory,
    installPath: ctx.installPath ?? "",
    log: (text) => tag("sdk", text),
    minIntervalMs: LIMITS.upstreamMinIntervalMs,
    maxBackoffMs: LIMITS.upstreamMaxBackoffMs,
  });

  // 媒体管道与 HTTP 路由共用同一个 sdk / cache：直链与内容密钥只留在后台进程内。
  const media = createMedia({ sdk, cache, log: (text) => tag("media", text) });

  // 转码兜底：宿主没有 HEVC 解码器时把分集转成 H.264（依赖系统 ffmpeg，缺失时自动降级）。
  const transcoder = createTranscoder({ media, cache, log: (text) => tag("transcode", text) });

  const server = await startServer({
    sdk,
    cache,
    media,
    transcoder,
    version: ctx.version ?? "0.0.0",
    log: (text) => tag("http", text),
    portFirst: PORT_FIRST,
    portLast: PORT_LAST,
    startedAt,
  });

  tag("background", `已启动 v${ctx.version ?? "0.0.0"} port=${server.port} dataDir=${dataDir}`);

  // 启动清理放到服务起来之后，避免拖慢 /health；*.part 已在 cache.init() 里同步清掉。
  void cache
    .prune()
    .then((result) => {
      if (result.videos.removed || result.covers.removed) {
        tag("cache", `启动清理：视频 ${result.videos.removed} 项、封面 ${result.covers.removed} 项`);
      }
    })
    .catch((error) => tag("cache", `启动清理失败：${error?.message ?? error}`));

  let pruneTimer = setInterval(() => {
    void cache
      .prune()
      .catch((error) => tag("cache", `定时清理失败：${error?.message ?? error}`));
  }, PRUNE_INTERVAL_MS);
  pruneTimer.unref?.();

  let stopPromise = null;
  let onAbort = null;
  const stop = () =>
    (stopPromise ??= (async () => {
      if (pruneTimer) {
        clearInterval(pruneTimer);
        pruneTimer = null;
      }
      try {
        if (onAbort) ctx.signal?.removeEventListener?.("abort", onAbort);
      } catch {
        // 宿主 signal 已失效时忽略。
      }
      await server.close();
      try {
        await transcoder.clear();
      } catch {
        // 转码任务清理失败不影响停止流程。
      }
      media.dispose();
      sdk.dispose();
      tag("background", "已停止");
    })());

  onAbort = () => {
    void stop();
  };
  ctx.signal?.addEventListener?.("abort", onAbort, { once: true });
  if (ctx.signal?.aborted) void stop();

  return stop;
}
