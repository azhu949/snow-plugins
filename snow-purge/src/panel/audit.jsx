// 审计页：插件动作流水 + 宿主应用日志（logs 域）对照。
import { getReact, h } from "./react.js";
import { Badge, Btn, ErrorBox, Loading, SectionTitle } from "./ui.jsx";

const LEVELS = ["", "DEBUG", "INFO", "WARN", "ERROR"];

const summarizeLog = (entry) => {
  if (!entry || typeof entry !== "object") return String(entry ?? "");
  const time = entry.timestamp || entry.time || entry.createdAt || entry.at || "";
  const level = entry.level || "";
  const module = entry.module || "";
  const message = entry.message || entry.text || entry.content || "";
  return [time, level, module, message].filter(Boolean).join("  ");
};

export function AuditView({ t, rpc, notify }) {
  const React = getReact();
  const [audit, setAudit] = React.useState({ status: "loading", error: "", items: [] });
  const [logs, setLogs] = React.useState({ status: "loading", error: "", data: null });
  const [filter, setFilter] = React.useState({ level: "", module: "", limit: 50 });
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState("");
  const confirmTimer = React.useRef(null);

  const loadAudit = React.useCallback(async () => {
    try {
      const data = await rpc.audit(100);
      setAudit({ status: "ready", error: "", items: data?.items || [] });
    } catch (error) {
      setAudit({ status: "error", error: String(error?.message || error), items: [] });
    }
  }, [rpc]);

  const loadLogs = React.useCallback(async () => {
    setLogs((prev) => ({ ...prev, status: "loading" }));
    try {
      const data = await rpc.logs({
        level: filter.level || undefined,
        module: filter.module || undefined,
        limit: filter.limit,
      });
      setLogs({ status: "ready", error: "", data });
    } catch (error) {
      setLogs({ status: "error", error: String(error?.message || error), data: null });
    }
  }, [rpc, filter]);

  React.useEffect(() => {
    void loadAudit();
    void loadLogs();
    // 首次加载；筛选变化由「刷新日志」按钮触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc]);

  const refreshAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all([loadAudit(), loadLogs()]);
    } finally {
      setBusy(false);
    }
  };

  // 清空不可逆：第一次点击把按钮切成确认态，4 秒内再点一次才真正执行。
  const arm = (key) => {
    setConfirm(key);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirm(""), 4000);
  };

  React.useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    []
  );

  const clearAudit = async () => {
    if (busy) return;
    if (confirm !== "audit") {
      arm("audit");
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirm("");
    setBusy(true);
    try {
      await rpc.clearAudit();
      await loadAudit();
      notify("ok", t("audit.cleared"));
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const clearLogs = async () => {
    if (busy) return;
    if (confirm !== "logs") {
      arm("logs");
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirm("");
    setBusy(true);
    try {
      const result = await rpc.clearLogs();
      await loadLogs();
      notify("ok", t("audit.logsCleared", { count: result?.removed || 0 }));
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const logPayload = logs.data?.logs;
  const logEntries = Array.isArray(logPayload)
    ? logPayload
    : Array.isArray(logPayload?.items)
      ? logPayload.items
      : Array.isArray(logPayload?.records)
        ? logPayload.records
        : [];

  return (
    <div className="pg-stack">
      <div className="pg-card">
        <SectionTitle
          extra={
            <span className="pg-row pg-row-tight">
              <Badge tone="off">{audit.items.length}</Badge>
              <Btn
                size="sm"
                variant="ghost"
                disabled={busy || audit.items.length === 0}
                onClick={() => void clearAudit()}
              >
                {confirm === "audit" ? t("audit.clearConfirm") : t("audit.clear")}
              </Btn>
            </span>
          }
        >
          {t("audit.title")}
        </SectionTitle>
        <div className="pg-note">{t("audit.hint")}</div>
        {audit.status === "loading" ? <Loading text={t("common.loading")} /> : null}
        {audit.status === "error" ? <ErrorBox message={audit.error} /> : null}
        {audit.status === "ready" && audit.items.length === 0 ? (
          <div className="pg-meta">{t("audit.empty")}</div>
        ) : null}
        {audit.items.length ? (
          <div className="pg-table">
            <div className="pg-table-head">
              <span>{t("audit.time")}</span>
              <span>{t("audit.action")}</span>
              <span>{t("audit.result")}</span>
              <span>{t("audit.detail")}</span>
            </div>
            {audit.items.map((item, index) => (
              <div className="pg-table-row" key={`${item.at}-${index}`}>
                <span>{new Date(item.at).toLocaleString()}</span>
                <span className="pg-mono">{item.action}</span>
                <span>
                  <Badge tone={item.ok ? "ok" : "bad"}>{item.ok ? t("audit.ok") : t("audit.failed")}</Badge>
                </span>
                <span className="pg-ellipsis" title={item.detail}>
                  {item.detail || "-"}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="pg-card">
        <SectionTitle extra={<Badge tone="off">{filter.limit}</Badge>}>{t("audit.logsTitle")}</SectionTitle>
        <div className="pg-note">{t("audit.logsHint")}</div>
        <div className="pg-row">
          <select
            className="pg-input pg-select"
            value={filter.level}
            onChange={(event) => setFilter((prev) => ({ ...prev, level: event.target.value }))}
          >
            {LEVELS.map((level) => (
              <option value={level} key={level || "all"}>
                {level || t("audit.levelAll")}
              </option>
            ))}
          </select>
          <input
            className="pg-input"
            value={filter.module}
            placeholder={t("audit.modulePlaceholder")}
            onChange={(event) => setFilter((prev) => ({ ...prev, module: event.target.value }))}
          />
          <select
            className="pg-input pg-select"
            value={String(filter.limit)}
            onChange={(event) => setFilter((prev) => ({ ...prev, limit: Number(event.target.value) || 50 }))}
          >
            {[20, 50, 100].map((value) => (
              <option value={String(value)} key={value}>
                {value}
              </option>
            ))}
          </select>
          <Btn size="sm" disabled={busy} onClick={() => void refreshAll()}>
            {t("action.refresh")}
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            title={t("audit.logsClearTitle")}
            disabled={busy || logEntries.length === 0}
            onClick={() => void clearLogs()}
          >
            {confirm === "logs" ? t("audit.logsClearConfirm") : t("audit.logsClear")}
          </Btn>
        </div>

        {logs.status === "loading" ? <Loading text={t("common.loading")} /> : null}
        {logs.status === "error" ? <ErrorBox message={logs.error} /> : null}
        {logs.data?.denied ? (
          <div className="pg-inline-warn">{t("audit.logsDenied", { reason: logs.data.denied.reason || "" })}</div>
        ) : null}
        {logs.status === "ready" && !logs.data?.denied && logEntries.length === 0 ? (
          <div className="pg-meta">{t("audit.logsEmpty")}</div>
        ) : null}
        {logEntries.length ? (
          <div className="pg-lines">
            {logEntries.map((entry, index) => (
              <div className="pg-line" key={index}>
                {summarizeLog(entry)}
              </div>
            ))}
          </div>
        ) : null}
        {logs.status === "ready" && !logEntries.length && logPayload && !logs.data?.denied ? (
          <pre className="pg-pre">{JSON.stringify(logPayload, null, 2)}</pre>
        ) : null}
      </div>
    </div>
  );
}
