// 日志视图：独立标签页，跟随后台的单条日志流增量读取，可清屏与恢复。
// 后台只启动一次 docker logs -f，面板按 offset 取增量；切走标签页不会丢清屏状态。
import { h, getReact } from "./react.js";
import { Btn, EmptyState, Loading, StateBadge } from "./ui.jsx";
import { DkSelect } from "./select.jsx";
import { sortContainers } from "./containers.jsx";
import { DEFAULT_ANSI, ansiClass, parseAnsiLine } from "./ansi.js";

const FOLLOW_INTERVAL_MS = 1500;
const MAX_LOG_LINES = 1000;
const MAX_BUFFER_LINES = 2000;
/** ANSI 解析缓存上限：只缓存带转义的行，命中即可跳过重复解析。 */
const MAX_ANSI_CACHE = 2048;
const LOG_TAIL = 300;

// docker --timestamps 的行前缀形如 2026-11-18T10:12:33.123456789Z，取出毫秒用于清屏过滤。
const LINE_TIME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/;
const parseLineTime = (line) => {
  const match = LINE_TIME_RE.exec(String(line ?? ""));
  if (!match) return null;
  const value = Date.parse(match[1]);
  return Number.isFinite(value) ? value : null;
};

const EMPTY_LOGS = { status: "idle", lines: [], offset: 0, streamId: "", live: false, ended: false, error: "" };

export function LogsView({ t, rpc, containers, loading, selectedId, setSelectedId, active, visible }) {
  const React = getReact();
  const [logs, setLogs] = React.useState(EMPTY_LOGS);
  const [follow, setFollow] = React.useState(true);
  // 自动换行默认开启，与之前的显示一致；关闭后长行横向滚动（对应 IDEA 的 Soft-Wrap 关）。
  const [wrap, setWrap] = React.useState(true);
  const [cleared, setCleared] = React.useState({ id: "", at: 0 });
  const streamRef = React.useRef({ streamId: "", offset: 0 });
  const containerRef = React.useRef("");
  const queueRef = React.useRef(Promise.resolve());
  const seqRef = React.useRef(0);
  const busyRef = React.useRef(false);
  const boxRef = React.useRef(null);

  const ordered = React.useMemo(() => sortContainers(containers), [containers]);
  const selected = ordered.find((item) => item.id === selectedId) || null;
  const containerId = selected ? selected.id : "";
  const containerState = selected ? selected.state : "";
  const clearedAt = cleared.id === containerId ? cleared.at : 0;
  containerRef.current = containerId;

  // 只有日志页可见时才自动选容器，避免面板一启动就把容器页的第一行展开。
  React.useEffect(() => {
    if (!visible) return;
    if (ordered.length === 0) return;
    if (selectedId && ordered.some((item) => item.id === selectedId)) return;
    setSelectedId(ordered[0].id);
  }, [visible, ordered, selectedId, setSelectedId]);

  /**
   * 串行读取：同一条流同时只跑一个请求，offset 不会被并发请求打乱。
   * 跟随轮询用 skipIfBusy，手动重载与容器切换始终排队执行。
   */
  const readLogs = React.useCallback(
    ({ reset = false, skipIfBusy = false } = {}) => {
      if (!containerId) return Promise.resolve();
      if (skipIfBusy && busyRef.current) return Promise.resolve();
      const run = async () => {
        busyRef.current = true;
        const seq = ++seqRef.current;
        const requestContainer = containerId;
        if (reset) {
          setLogs((prev) => ({ ...prev, status: prev.lines.length ? prev.status : "loading", error: "" }));
        }
        try {
          const data = await rpc.logsStream(containerId, {
            tail: LOG_TAIL,
            streamId: reset ? "" : streamRef.current.streamId,
            offset: reset ? undefined : streamRef.current.offset,
            reset,
          });
          if (seq !== seqRef.current || requestContainer !== containerRef.current) return;
          const incoming = Array.isArray(data?.lines) ? data.lines : [];
          const nextStreamId = String(data?.streamId || streamRef.current.streamId || "");
          const nextOffset = Number.isFinite(data?.offset) ? data.offset : streamRef.current.offset;
          streamRef.current = { streamId: nextStreamId, offset: nextOffset };
          // 后台的 offset 是缓冲区末尾之后的下一个序号，因此每行都有稳定的绝对序号。
          // 用它当行 id：缓冲裁剪后前缀行的 id 不变，React 不会因为下标前移把整屏日志重挂。
          const base = nextOffset - incoming.length;
          const nextLive = data?.live === true;
          const nextEnded = data?.ended === true;
          const nextError = typeof data?.error === "string" ? data.error : "";
          setLogs((prev) => {
            const reset = data?.reset === true;
            if (
              !reset &&
              incoming.length === 0 &&
              prev.status === "ready" &&
              prev.offset === nextOffset &&
              prev.streamId === nextStreamId &&
              prev.live === nextLive &&
              prev.ended === nextEnded &&
              prev.error === nextError
            ) {
              // 没有新行时保持原数组引用，下游的过滤与 ANSI 解析可以直接命中缓存。
              return prev;
            }
            const appended = incoming.map((text, index) => ({ id: base + index, text: String(text ?? "") }));
            const nextLines = reset ? appended : prev.lines.concat(appended);
            return {
              status: "ready",
              lines: nextLines.slice(-MAX_BUFFER_LINES),
              offset: nextOffset,
              streamId: nextStreamId,
              live: nextLive,
              ended: nextEnded,
              error: nextError,
            };
          });
        } catch (error) {
          if (seq !== seqRef.current || requestContainer !== containerRef.current) return;
          setLogs((prev) => ({
            ...prev,
            status: prev.lines.length ? "ready" : "error",
            error: String(error?.message || error),
          }));
        } finally {
          busyRef.current = false;
        }
      };
      const next = queueRef.current.then(run, run);
      queueRef.current = next.catch(() => {});
      return next;
    },
    [containerId, rpc]
  );

  // 换容器或容器状态变化（重启 / 停止）后重建流，旧输出不再混进新会话。
  React.useEffect(() => {
    seqRef.current += 1;
    busyRef.current = false;
    streamRef.current = { streamId: "", offset: 0 };
    if (!containerId) {
      setLogs(EMPTY_LOGS);
      return;
    }
    const shouldLoad = visible && active !== false;
    setLogs({ ...EMPTY_LOGS, status: shouldLoad ? "loading" : "idle" });
    if (shouldLoad) void readLogs({ reset: true });
  }, [containerId, containerState, readLogs]);

  // 从别的标签页切回来或面板重新激活：有流就补增量，没流就重新拉首屏。
  // 不重建流，所以清屏状态与已加载的历史都还在。
  React.useEffect(() => {
    if (!visible || active === false || !containerId || busyRef.current) return;
    if (!logs.streamId) {
      void readLogs({ reset: true });
      return;
    }
    if (!logs.ended) void readLogs({ skipIfBusy: true });
  }, [visible, active]);

  // 增量始终在跑：日志页可见且面板在前台时每 1.5 秒读一次；流结束后停止。
  // 「自动跟随」只决定是否贴着最新一行滚动，不再决定是否刷新。
  React.useEffect(() => {
    if (!visible || active === false || !containerId || logs.ended) return undefined;
    const timer = setInterval(() => void readLogs({ skipIfBusy: true }), FOLLOW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [visible, active, containerId, logs.ended, readLogs]);

  // 回到日志页时立刻补一次，不用等满一个轮询周期。
  React.useEffect(() => {
    if (!visible || active === false || !containerId || logs.ended) return;
    void readLogs({ skipIfBusy: true });
  }, [visible, active, containerId, logs.ended, readLogs]);

  // 自动跟随：新输出到达后贴到底部；关掉后保持当前滚动位置，方便回头翻历史。
  React.useEffect(() => {
    if (!follow) return;
    const box = boxRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  }, [logs.lines, logs.status, visible, follow]);

  // 清屏只影响显示：记下当前最后一行的时间戳，之后拉到的行按时间戳过滤，
  // 旧行仍留在本地缓冲里，「显示全部」可以原样恢复。
  const clearLogs = () => {
    if (!containerId) return;
    const last = logs.lines.length ? parseLineTime(logs.lines[logs.lines.length - 1]?.text) : null;
    setCleared({ id: containerId, at: Number.isFinite(last) ? last : Date.now() });
  };

  const options = ordered.map((item) => ({ value: item.id, label: item.name }));
  const visibleLogs = React.useMemo(
    () =>
      logs.lines
        .filter((line) => {
          if (!clearedAt) return true;
          const time = parseLineTime(line.text);
          return time === null || time > clearedAt;
        })
        .slice(-MAX_LOG_LINES),
    [logs.lines, clearedAt]
  );

  // 按行顺序解析 ANSI：Docker 的 UTC 前缀在这里去掉，没有重置码的续行沿用上一行颜色。
  // 带转义的行按 (入态, 原文) 做有界缓存：行 id 稳定后同一批行会反复出现，命中即可跳过重算。
  const ansiCacheRef = React.useRef(new Map());
  const parsedLogs = React.useMemo(() => {
    const cache = ansiCacheRef.current;
    let state = DEFAULT_ANSI;
    return visibleLogs.map((line) => {
      if (!line.text.includes("\u001B")) {
        const parsed = parseAnsiLine(line.text, state);
        state = parsed.state;
        return { key: line.id, segments: parsed.segments };
      }
      const stateKey = `${state.fg}|${state.bold ? 1 : 0}|${state.dim ? 1 : 0}|${state.italic ? 1 : 0}|${state.underline ? 1 : 0}`;
      const cacheKey = `${stateKey}\u0000${line.text}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        state = cached.state;
        return { key: line.id, segments: cached.segments };
      }
      const parsed = parseAnsiLine(line.text, state);
      if (cache.size >= MAX_ANSI_CACHE) cache.clear();
      cache.set(cacheKey, { segments: parsed.segments, state: parsed.state });
      state = parsed.state;
      return { key: line.id, segments: parsed.segments };
    });
  }, [visibleLogs]);

  return (
    <div className="dk-logs" hidden={!visible}>
      <div className="dk-toolbar">
        <div className="dk-logs-picker">
          <DkSelect
            value={containerId}
            options={options}
            onChange={(next) => setSelectedId(next)}
            ariaLabel={t("logs.select")}
            size="sm"
            disabled={options.length === 0}
            searchable
            searchPlaceholder={t("logs.selectSearch")}
            emptyText={t("logs.selectEmpty")}
          />
        </div>
        <Btn
          size="sm"
          variant="ghost"
          disabled={!containerId || logs.status === "loading"}
          onClick={() => void readLogs({ reset: true })}
        >
          {t("container.logsRefresh")}
        </Btn>
        <Btn
          size="sm"
          variant={follow ? "primary" : "ghost"}
          disabled={!containerId}
          title={t("container.followHint")}
          onClick={() => setFollow((value) => !value)}
        >
          {t("container.follow")}
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          disabled={!containerId || logs.status === "loading"}
          onClick={clearLogs}
        >
          {t("logs.clear")}
        </Btn>
        <Btn
          size="sm"
          variant={wrap ? "primary" : "ghost"}
          onClick={() => setWrap((value) => !value)}
          title={t("logs.wrap")}
        >
          {t("logs.wrap")}
        </Btn>
      </div>

      {selected ? (
        <div className="dk-logs-meta">
          <span className="dk-name" title={selected.name}>
            {selected.name}
          </span>
          <StateBadge state={selected.state} t={t} />
          <span className="dk-meta" title={`${selected.image} · ${selected.status}`}>
            {selected.image} · {selected.status}
          </span>
        </div>
      ) : null}

      {options.length === 0 ? (
        loading ? (
          <Loading text={t("status.refreshing")} />
        ) : (
          <EmptyState title={t("logs.empty")} hint={t("logs.emptyHint")} />
        )
      ) : (
        <div className={`dk-log dk-log-fill${wrap ? "" : " dk-log-nowrap"}`} ref={boxRef}>
          {logs.status === "loading" ? <span className="dk-log-empty">{t("status.refreshing")}</span> : null}
          {logs.error ? <span className="dk-inline-error">{logs.error}</span> : null}
          {logs.status === "ready" && !logs.error && visibleLogs.length === 0 ? (
            <span className="dk-log-empty">{clearedAt ? t("logs.cleared") : t("container.noLogs")}</span>
          ) : null}
          {parsedLogs.map((line) => {
            const hasText = line.segments.some((segment) => segment.text);
            return (
              <span className="dk-log-line" key={line.key}>
                {hasText
                  ? line.segments.map((segment, index) =>
                      segment.text
                        ? h("span", { key: index, className: ansiClass(segment.state) || undefined }, segment.text)
                        : null
                    )
                  : "\u00A0"}
              </span>
            );
          })}
        </div>
      )}

      {logs.ended && !logs.error ? <div className="dk-meta">{t("logs.ended")}</div> : null}

      {clearedAt ? (
        <div className="dk-logs-note">
          <span className="dk-meta">{t("logs.cleared")}</span>
          <Btn size="sm" variant="ghost" onClick={() => setCleared({ id: "", at: 0 })}>
            {t("logs.showAll")}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
