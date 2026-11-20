// 容器日志流管理器：后台只保留一条 docker logs -f 流，面板按 offset 增量读取。
// 本机是常驻子进程，远程是一条 SSH 通道；清屏、滚动与缓冲上限都在面板侧完成。
const MAX_BUFFER_LINES = 4000;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const TRIM_SLACK_LINES = 512;
const TRIM_SLACK_BYTES = 256 * 1024;
const MAX_LINE_CHARS = 2000;
const MAX_STDERR_CHARS = 1200;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const FIRST_DATA_WAIT_MS = 1200;
const REAP_INTERVAL_MS = 30000;
const WAIT_STEP_MS = 100;

let nextStreamId = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const payload = (record, lines, reset) => ({
  streamId: record.streamId,
  containerId: record.containerId,
  lines,
  offset: record.total,
  start: record.start,
  live: record.live,
  ended: record.ended,
  code: record.code,
  error: record.error,
  reset,
});

/**
 * 日志流管理器：同一时刻只保留一条流（面板一次只看一个容器）。
 * 每次读取都会刷新 lastReadAt，空闲 5 分钟后回收，避免后台长期占着 SSH 通道。
 */
export function createLogStreamManager({ log = () => {} } = {}) {
  let current = null;

  /** 缓冲超限时成批丢弃最旧的行，start 是缓冲区第一行的绝对序号。 */
  const trim = (record) => {
    if (
      record.lines.length <= MAX_BUFFER_LINES + TRIM_SLACK_LINES &&
      record.bytes <= MAX_BUFFER_BYTES + TRIM_SLACK_BYTES
    ) {
      return;
    }
    let remove = 0;
    let bytes = 0;
    while (
      remove < record.lines.length &&
      (record.lines.length - remove > MAX_BUFFER_LINES || record.bytes - bytes > MAX_BUFFER_BYTES)
    ) {
      bytes += Buffer.byteLength(record.lines[remove]);
      remove += 1;
    }
    if (remove === 0) return;
    record.lines.splice(0, remove);
    record.bytes -= bytes;
    record.start += remove;
  };

  const pushLine = (record, line, kind) => {
    if (record !== current) return;
    const text = String(line ?? "").replace(/\r$/, "");
    if (!text) return;
    const clipped = text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text;
    record.lines.push(clipped);
    record.bytes += Buffer.byteLength(clipped);
    record.total = record.start + record.lines.length;
    if (kind === "stderr") {
      record.stderrTail = `${record.stderrTail}${text}\n`.slice(-MAX_STDERR_CHARS);
    }
    trim(record);
  };

  const stop = () => {
    const record = current;
    current = null;
    if (!record) return;
    try {
      record.close?.();
    } catch {
      // 流可能已经结束。
    }
  };

  const finish = (record, result) => {
    if (record !== current) return;
    record.live = false;
    record.ended = true;
    record.close = null;
    record.code = Number.isFinite(result?.code) ? result.code : -1;
    const text = String(result?.error || "").trim() || record.stderrTail.trim();
    if (record.code !== 0 && text) record.error = text;
    log(
      `日志流结束 ${record.containerId} exit=${record.code}${record.error ? ` ${record.error.slice(0, 200)}` : ""}`
    );
  };

  const start = ({ api, targetKey, containerId, tail }) => {
    stop();
    const record = {
      streamId: `log-${Date.now().toString(36)}-${++nextStreamId}`,
      containerId,
      targetKey,
      lines: [],
      bytes: 0,
      start: 0,
      total: 0,
      live: true,
      ended: false,
      code: null,
      error: "",
      stderrTail: "",
      lastReadAt: Date.now(),
      close: null,
    };
    current = record;

    if (!api || typeof api.openLogStream !== "function") {
      record.live = false;
      record.ended = true;
      record.error = "当前目标不支持日志流";
      return record;
    }

    try {
      const handle = api.openLogStream(containerId, {
        tail,
        onLine: (line) => pushLine(record, line, "stdout"),
        onStderr: (line) => pushLine(record, line, "stderr"),
        onEnd: (result) => finish(record, result),
      });
      record.close = typeof handle?.close === "function" ? handle.close : null;
      log(`日志流已启动 ${containerId} tail=${tail}`);
    } catch (error) {
      record.live = false;
      record.ended = true;
      record.error = String(error?.message || error);
      log(`日志流启动失败 ${containerId}: ${record.error}`);
    }
    return record;
  };

  /** 首屏等一小会儿，避免面板刚打开时拿到空列表又得等下一轮轮询。 */
  const waitForFirst = async (record) => {
    const deadline = Date.now() + FIRST_DATA_WAIT_MS;
    while (record === current && !record.ended && record.lines.length === 0 && Date.now() < deadline) {
      await sleep(WAIT_STEP_MS);
    }
  };

  const read = async ({
    api,
    targetKey,
    containerId,
    tail = 300,
    streamId = "",
    offset = null,
    reset = false,
  } = {}) => {
    const changed = !current || current.containerId !== containerId || current.targetKey !== targetKey;
    if (reset || changed) {
      const record = start({ api, targetKey, containerId, tail });
      await waitForFirst(record);
      return payload(record, record.lines.slice(), true);
    }

    current.lastReadAt = Date.now();

    // 面板重开或后台换过流时 streamId 会对不上：直接给当前缓冲，让它整体重置。
    if (streamId && streamId !== current.streamId) {
      return payload(current, current.lines.slice(), true);
    }

    const from = Number.isFinite(offset) ? offset : null;
    if (from === null || from < current.start || from > current.total) {
      return payload(current, current.lines.slice(), true);
    }

    return payload(current, current.lines.slice(from - current.start), false);
  };

  const reaper = setInterval(() => {
    if (!current) return;
    if (Date.now() - current.lastReadAt < IDLE_TIMEOUT_MS) return;
    log(`停止空闲日志流 ${current.containerId}`);
    stop();
  }, REAP_INTERVAL_MS);
  reaper.unref?.();

  return {
    read,
    stop() {
      clearInterval(reaper);
      stop();
    },
  };
}
