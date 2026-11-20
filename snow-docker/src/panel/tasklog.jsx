// 任务日志：构建、compose、镜像上传共用同一套输出区与取消交互。
import { h, getReact } from "./react.js";
import { Btn } from "./ui.jsx";

const STATUS_KEY = {
  running: "task.running",
  succeeded: "task.succeeded",
  cancelled: "task.cancelled",
  failed: "task.failed",
};

const STATUS_TONE = {
  running: "warn",
  succeeded: "ok",
  cancelled: "muted",
  failed: "bad",
};

/**
 * 任务输出区：标题显示 kind · title，正文按行滚动到底部，运行中可取消。
 * 数据结构与后台 /task 的返回一致：{ id, kind, title, status, exitCode, error, lines }。
 */
export function TaskLog({ t, task, onCancel, onClear, maxHeight = "180px" }) {
  const React = getReact();
  const boxRef = React.useRef(null);

  React.useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [task?.lines?.length]);

  if (!task) return null;
  const running = task.status === "running";
  const statusText = t(STATUS_KEY[task.status] || "task.running");
  const tone = STATUS_TONE[task.status] || "muted";

  return (
    <div className="dk-card" style={{ marginBottom: "8px" }}>
      <div className="dk-card-title">
        <span title={task.title}>{task.title ? `${task.kind} · ${task.title}` : task.kind}</span>
        <span className="dk-pill">
          <span className="dk-dot" data-tone={tone} />
          {statusText}
          {task.exitCode !== null && task.exitCode !== undefined ? ` (exit ${task.exitCode})` : ""}
        </span>
      </div>
      <div className="dk-log" ref={boxRef} style={{ maxHeight }}>
        {task.lines.length === 0 ? <span className="dk-log-empty">{t("task.running")}</span> : null}
        {task.lines.map((line, index) => (
          <span className="dk-log-line" key={`${index}-${line.slice(0, 16)}`}>
            {line}
          </span>
        ))}
      </div>
      {task.truncated ? <div className="dk-meta" style={{ paddingTop: "4px" }}>{t("task.truncated")}</div> : null}
      {task.error ? <div className="dk-inline-error">{task.error}</div> : null}
      <div style={{ display: "flex", gap: "5px", marginTop: "6px" }}>
        {running ? (
          <Btn size="sm" onClick={onCancel}>
            {t("task.cancel")}
          </Btn>
        ) : null}
        {!running ? (
          <Btn size="sm" variant="ghost" onClick={onClear}>
            {t("task.clear")}
          </Btn>
        ) : null}
      </div>
    </div>
  );
}
