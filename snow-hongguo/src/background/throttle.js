// 上游调用节流：全局串行 + 同一接口最小间隔，外加按 retryAfterMs 的一次退避。
// 时钟与 sleep 都可注入，测试里用假时钟就不会真的等待。
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} options
 * @param {number} [options.minIntervalMs] 两次上游调用之间的最小间隔
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createScheduler({ minIntervalMs = 300, now = Date.now, sleep = defaultSleep } = {}) {
  let tail = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;
  const lastByKey = new Map();
  const stats = { runs: 0, waits: 0 };

  const run = (key, task) => {
    const normalizedKey = String(key ?? "default");
    const result = tail.then(async () => {
      const lastForThisKey = lastByKey.get(normalizedKey) ?? Number.NEGATIVE_INFINITY;
      const earliest = Math.max(lastStart + minIntervalMs, lastForThisKey + minIntervalMs);
      const waitMs = Math.ceil(earliest - now());
      if (waitMs > 0) {
        stats.waits += 1;
        await sleep(waitMs);
      }
      const startedAt = now();
      lastStart = startedAt;
      lastByKey.set(normalizedKey, startedAt);
      stats.runs += 1;
      return task();
    });
    // 前一个任务失败不能卡死队列：tail 始终指向已消化异常的版本。
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  return { run, stats, minIntervalMs };
}

/** retryable 且服务端给了 retryAfterMs 时才退避；单次等待封顶，避免请求挂太久。 */
export function retryDelayFor(error, { maxWaitMs = 2000 } = {}) {
  if (error?.retryable !== true) return 0;
  const ms = Number(error?.retryAfterMs);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(Math.ceil(ms), maxWaitMs);
}
