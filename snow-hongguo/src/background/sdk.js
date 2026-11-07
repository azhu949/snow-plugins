// openhongguo 客户端的唯一入口：懒加载单例、匿名档案、错误自愈、调用节流与播放去重。
// 这里刻意不 import "openhongguo"：clientFactory 由 main.js 注入，测试可用假客户端而不加载 wasm。
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describeError, errorCodeOf, isDeviceRecoveryCode } from "./errors.js";
import { createScheduler, retryDelayFor } from "./throttle.js";
import { compactOptions } from "./util.js";

const SDK_METHODS = ["discover", "search", "getSeries", "listEpisodes", "resolvePlayback", "resetDevice"];

/** 匿名设备档案：JSON 文件，原子写入，权限 0600（Windows 上 mode 会被忽略）。 */
export function createProfileStore(filePath, { log = () => {} } = {}) {
  return {
    async load() {
      try {
        return await readFile(filePath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        log(`[profile] 读取失败：${error?.message ?? error}`);
        throw error;
      }
    },
    async save(json) {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      const tempPath = `${filePath}.${process.pid}.tmp`;
      await writeFile(tempPath, json, { mode: 0o600 });
      await rename(tempPath, filePath);
    },
    async reset() {
      await rm(filePath, { force: true });
    },
  };
}

/**
 * @param {object} options
 * @param {string} options.dataDir 插件数据目录（anonymous.json 就在这里）
 * @param {(options: object) => Promise<object>} options.clientFactory 返回 openhongguo Client
 * @param {string} [options.installPath] 插件安装目录，仅用于报告 wasm 大小
 * @param {(message: string) => void} [options.log]
 * @param {number} [options.maxDeviceResets] 设备自愈的重置次数上限
 * @param {number} [options.minIntervalMs] 上游调用最小间隔
 */
export function createSdk({
  dataDir,
  clientFactory,
  installPath = "",
  log = () => {},
  timeoutMs = 20000,
  retryAttempts = 2,
  maxDeviceResets = 2,
  minIntervalMs = 300,
  maxBackoffMs = 2000,
  now = Date.now,
  sleep,
} = {}) {
  if (typeof dataDir !== "string" || !dataDir) throw new TypeError("createSdk 需要 dataDir");
  if (typeof clientFactory !== "function") throw new TypeError("createSdk 需要 clientFactory");

  const profilePath = join(dataDir, "anonymous.json");
  const profile = createProfileStore(profilePath, { log });
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const scheduler = createScheduler({ minIntervalMs, now, sleep: wait });

  const state = {
    clientPromise: null,
    loadedAt: null,
    loadMs: null,
    resets: 0,
    lastResetAt: null,
    lastError: null,
  };

  const buildClient = async () => {
    const startedAt = now();
    const client = await clientFactory({
      profile,
      timeoutMs,
      retryAttempts,
      // 设备恢复统一由本模块负责；SDK 内部再换设备会让一次失败连续换多台。
      deviceResets: 0,
      log: (line) => log(`[client] ${line}`),
    });
    for (const method of SDK_METHODS) {
      if (typeof client?.[method] !== "function") {
        throw new Error(`openhongguo 客户端缺少方法：${method}`);
      }
    }
    state.loadedAt = startedAt;
    state.loadMs = now() - startedAt;
    return client;
  };

  const getClient = () => {
    if (!state.clientPromise) {
      state.clientPromise = buildClient().catch((error) => {
        // 加载失败不缓存失败结果：下一次调用重新尝试，并把真实错误抛给调用方。
        state.clientPromise = null;
        state.lastError = describeError(error);
        throw error;
      });
    }
    return state.clientPromise;
  };

  const invalidateClient = (reason) => {
    if (state.clientPromise) log(`[client] 丢弃当前客户端（${reason}）`);
    state.clientPromise = null;
  };

  const resetDeviceOnce = async (reason) => {
    state.resets += 1;
    state.lastResetAt = now();
    log(`[reset] ${reason} -> 重置匿名设备（第 ${state.resets} 次）`);
    let client = null;
    try {
      client = await getClient();
    } catch (error) {
      state.lastError = describeError(error);
      return;
    }
    try {
      await client.resetDevice();
    } catch (error) {
      state.lastError = describeError(error);
      log(`[reset] resetDevice 失败：${errorCodeOf(error)}，丢弃客户端下次重建`);
      invalidateClient("resetDevice 失败");
    }
  };

  /** 限流退避：只有 retryable 且服务端给了 retryAfterMs 才等，最多一次。 */
  const call = async (label, key, task) => {
    let retried = false;
    for (;;) {
      try {
        return await scheduler.run(key, task);
      } catch (error) {
        const delay = retried ? 0 : retryDelayFor(error, { maxWaitMs: maxBackoffMs });
        if (delay > 0) {
          retried = true;
          log(`[throttle] ${label} 限流（${errorCodeOf(error)}），${delay}ms 后重试`);
          await wait(delay);
          continue;
        }
        throw error;
      }
    }
  };

  const execute = async (label, key, method, args) => {
    let resets = 0;
    for (;;) {
      try {
        return await call(label, key, async () => {
          const client = await getClient();
          return client[method](...args);
        });
      } catch (error) {
        const code = errorCodeOf(error);
        state.lastError = describeError(error);
        log(`[client] ${label} 失败：${code}${error?.message ? ` - ${error.message}` : ""}`);
        if (!isDeviceRecoveryCode(code) || resets >= maxDeviceResets) throw error;
        resets += 1;
        await resetDeviceOnce(code);
      }
    }
  };

  const inflightPlayback = new Map();

  const api = {
    /** 加载客户端（不发网络请求），用于 /probe/wasm。 */
    runtimeInfo: async () => {
      await getClient();
      let bytes = null;
      if (installPath) {
        try {
          bytes = (await stat(join(installPath, "dist", "openhongguo.wasm"))).size;
        } catch {
          bytes = null;
        }
      }
      return {
        loaded: true,
        loadMs: state.loadMs,
        hasGlobal: typeof globalThis.__openhongguo?.newClient === "function",
        bytes,
        path: installPath ? join(installPath, "dist", "openhongguo.wasm") : null,
      };
    },

    discover: (options = {}) => execute("discover", "discover", "discover", [compactOptions(options)]),

    shortRank: (options = {}) => execute("shortRank", "shortRank", "shortRank", [compactOptions(options)]),

    shortFilterPanel: (genre = "") => execute("shortFilterPanel", "shortFilterPanel", "shortFilterPanel", [String(genre)]),

    shortFilter: (options = {}) => execute("shortFilter", "shortFilter", "shortFilter", [compactOptions(options)]),

    search: (query, options = {}) =>
      execute("search", "search", "search", [String(query ?? ""), compactOptions(options)]),

    getSeries: (seriesId) => execute("getSeries", "getSeries", "getSeries", [String(seriesId)]),

    listEpisodes: (seriesId, options = {}) =>
      execute("listEpisodes", "listEpisodes", "listEpisodes", [String(seriesId), compactOptions(options)]),

    /**
     * 同一 episodeId 的并发调用只跑一次；返回原始结果（含 streams 与 contentKey）。
     * 注意：直链与密钥只允许在后台进程内使用，不能经 HTTP 返回给面板。
     */
    resolvePlayback: (episodeId) => {
      const key = String(episodeId);
      const existing = inflightPlayback.get(key);
      if (existing) return existing;
      const task = execute("resolvePlayback", "resolvePlayback", "resolvePlayback", [key]);
      inflightPlayback.set(key, task);
      const clear = () => {
        if (inflightPlayback.get(key) === task) inflightPlayback.delete(key);
      };
      task.then(clear, clear);
      return task;
    },

    resetDevice: async () => {
      await resetDeviceOnce("manual");
    },

    stats: () => ({
      ready: state.clientPromise !== null,
      loaded: state.loadMs !== null,
      profilePath,
      loadMs: state.loadMs,
      resets: state.resets,
      lastResetAt: state.lastResetAt,
      lastError: state.lastError,
      inflightPlayback: inflightPlayback.size,
      scheduler: { ...scheduler.stats, minIntervalMs },
    }),

    dispose: () => {
      invalidateClient("dispose");
      inflightPlayback.clear();
    },
  };

  return api;
}
