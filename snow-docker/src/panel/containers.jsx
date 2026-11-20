// 容器视图：列表 + 内联详情（操作、配置、资源）。日志在独立的「日志」标签页。
import { h, getReact } from "./react.js";
import { Btn, EmptyState, ErrorBox, Field, Loading, SectionTitle, StateBadge } from "./ui.jsx";

const MAX_ENV_CHIPS = 40;

export const sortContainers = (list) => {
  const weight = (item) => {
    if (item.state === "running") return 0;
    if (item.state === "paused") return 1;
    if (item.state === "restarting") return 2;
    return 3;
  };
  return [...list].sort((a, b) => {
    const delta = weight(a) - weight(b);
    if (delta !== 0) return delta;
    return String(a.name).localeCompare(String(b.name));
  });
};

const matchesFilter = (item, filter) => {
  if (!filter) return true;
  const text = filter.trim().toLowerCase();
  if (!text) return true;
  return [item.name, item.image, item.ports, item.status, item.shortId]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(text));
};

function ActionBar({ t, container, busy, onAction, onOpenLogs }) {
  const running = container.state === "running";
  const paused = container.state === "paused";
  const [confirmRemove, setConfirmRemove] = getReact().useState(false);

  getReact().useEffect(() => {
    if (!confirmRemove) return undefined;
    const timer = setTimeout(() => setConfirmRemove(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmRemove]);

  return (
    <div className="dk-actionbar">
      {running ? (
        <Btn size="sm" disabled={busy} onClick={() => onAction("stop")}>
          {t("container.stop")}
        </Btn>
      ) : (
        <Btn size="sm" variant="primary" disabled={busy || paused} onClick={() => onAction("start")}>
          {t("container.start")}
        </Btn>
      )}
      <Btn size="sm" disabled={busy} onClick={() => onAction("restart")}>
        {t("container.restart")}
      </Btn>
      {running ? (
        <Btn size="sm" disabled={busy} onClick={() => onAction("pause")}>
          {t("container.pause")}
        </Btn>
      ) : null}
      {paused ? (
        <Btn size="sm" disabled={busy} onClick={() => onAction("unpause")}>
          {t("container.unpause")}
        </Btn>
      ) : null}
      <Btn size="sm" variant="ghost" onClick={onOpenLogs}>
        {t("container.openLogs")}
      </Btn>
      <Btn
        size="sm"
        variant="danger"
        disabled={busy}
        onClick={() => {
          if (!confirmRemove) {
            setConfirmRemove(true);
            return;
          }
          setConfirmRemove(false);
          onAction("remove", { force: running });
        }}
      >
        {confirmRemove ? t("container.removeConfirm") : t("container.remove")}
      </Btn>
    </div>
  );
}

function ContainerDetail({ t, container, rpc, notify, onChanged, onOpenLogs }) {
  const React = getReact();
  const [inspect, setInspect] = React.useState({ status: "loading", data: null, error: "" });
  const [stats, setStats] = React.useState({ status: "idle", data: null, error: "" });
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState("");
  const seqRef = React.useRef(0);

  const containerId = container.id;

  const loadInspect = React.useCallback(async () => {
    const seq = ++seqRef.current;
    setInspect({ status: "loading", data: null, error: "" });
    try {
      const data = await rpc.inspect(containerId);
      if (seq !== seqRef.current) return;
      setInspect({ status: "ready", data, error: "" });
    } catch (error) {
      if (seq !== seqRef.current) return;
      setInspect({ status: "error", data: null, error: String(error?.message || error) });
    }
  }, [containerId, rpc]);

  // 容器身份或状态变化时重新拉配置，保证操作后看到的是新状态。
  React.useEffect(() => {
    void loadInspect();
    setStats({ status: "idle", data: null, error: "" });
    setActionError("");
  }, [containerId, container.state, loadInspect]);

  const runAction = async (action, options = {}) => {
    setBusy(true);
    setActionError("");
    try {
      await rpc.containerAction(containerId, action, options.force === true);
      notify("success", `${t("notice.actionDone", { action: t(`container.${action === "remove" ? "remove" : action}`) })}`);
      if (action === "remove") {
        onChanged();
        return;
      }
      onChanged();
    } catch (error) {
      setActionError(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const loadStats = async () => {
    setStats({ status: "loading", data: null, error: "" });
    try {
      const data = await rpc.stats(containerId);
      setStats({ status: "ready", data, error: "" });
    } catch (error) {
      setStats({ status: "error", data: null, error: String(error?.message || error) });
    }
  };

  const data = inspect.data;

  return (
    <div className="dk-detail">
      <ActionBar t={t} container={container} busy={busy} onAction={runAction} onOpenLogs={onOpenLogs} />
      {actionError ? <div className="dk-inline-error">{actionError}</div> : null}

      {inspect.status === "loading" ? <Loading text={t("container.detailLoading")} /> : null}
      {inspect.status === "error" ? <div className="dk-inline-error">{inspect.error}</div> : null}

      {data ? (
        <div>
          <SectionTitle>{t("container.inspect")}</SectionTitle>
          <div className="dk-kv">
            <Field label={t("container.command")} value={data.command || data.entrypoint} />
            <Field label={t("container.created")} value={data.created ? data.created.replace("T", " ").slice(0, 19) : ""} />
            <Field label={t("container.exitCode")} value={data.state?.exitCode} />
            <Field label={t("container.restartPolicy")} value={data.restartPolicy} />
            <Field label={t("container.networks")} value={Array.isArray(data.networks) ? data.networks.join(", ") : ""} />
          </div>

          {data.ports?.length ? (
            <div style={{ marginTop: "8px" }}>
              <SectionTitle>{t("container.ports")}</SectionTitle>
              <div className="dk-chips">
                {data.ports.map((item) => (
                  <span className="dk-chip" key={item.containerPort}>
                    {item.containerPort}
                    {item.host ? ` -> ${item.host}` : ""}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {data.mounts?.length ? (
            <div style={{ marginTop: "8px" }}>
              <SectionTitle>{t("container.mounts")}</SectionTitle>
              <div className="dk-chips">
                {data.mounts.map((item) => (
                  <span className="dk-chip" key={`${item.destination}-${item.source}`}>
                    {item.source ? `${item.source} -> ` : ""}
                    {item.destination}
                    {item.readOnly ? " (ro)" : ""}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {data.env?.length ? (
            <div style={{ marginTop: "8px" }}>
              <SectionTitle>{t("container.env")}</SectionTitle>
              <div className="dk-chips">
                {data.env.slice(0, MAX_ENV_CHIPS).map((item, index) => (
                  <span className="dk-chip" key={`${item}-${index}`} title={item}>
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <SectionTitle
          extra={
            <Btn size="sm" variant="ghost" disabled={stats.status === "loading"} onClick={loadStats}>
              {stats.status === "loading" ? t("container.statsLoading") : t("container.stats")}
            </Btn>
          }
        >
          {t("container.stats")}
        </SectionTitle>
        {stats.status === "error" ? <div className="dk-inline-error">{stats.error}</div> : null}
        {stats.data ? (
          <div className="dk-kv">
            <Field label={t("container.cpu")} value={stats.data.cpu} />
            <Field label={t("container.memory")} value={`${stats.data.memoryUsage} ${stats.data.memoryPercent}`} />
            <Field label={t("container.netIO")} value={stats.data.netIO} />
            <Field label={t("container.blockIO")} value={stats.data.blockIO} />
            <Field label={t("container.pids")} value={stats.data.pids} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ContainerRow({ t, container, expanded, onToggle, children }) {
  return (
    <div className="dk-row" data-selected={expanded ? "1" : "0"}>
      <div className="dk-row-head" onClick={onToggle} role="button" tabIndex={0}>
        <div className="dk-row-main">
          <div className="dk-row-title">
            <span className="dk-name" title={container.name}>
              {container.name}
            </span>
            <StateBadge state={container.state} t={t} />
          </div>
          <span className="dk-meta" title={`${container.image} · ${container.status}`}>
            {container.image}
          </span>
          {container.ports ? <span className="dk-ports">{container.ports}</span> : null}
        </div>
      </div>
      {expanded ? children : null}
    </div>
  );
}

export function ContainersView({
  t,
  rpc,
  containers,
  loading,
  error,
  filter,
  setFilter,
  onlyRunning,
  setOnlyRunning,
  selectedId,
  setSelectedId,
  notify,
  onChanged,
  onOpenLogs,
}) {
  const visible = sortContainers(containers)
    .filter((item) => (onlyRunning ? item.state === "running" : true))
    .filter((item) => matchesFilter(item, filter));

  return (
    <div className="dk-body">
      <div className="dk-toolbar">
        <input
          className="dk-input"
          value={filter}
          placeholder={t("filter.placeholder")}
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="dk-toggle">
          <button type="button" data-active={onlyRunning ? "0" : "1"} onClick={() => setOnlyRunning(false)}>
            {t("filter.all")}
          </button>
          <button type="button" data-active={onlyRunning ? "1" : "0"} onClick={() => setOnlyRunning(true)}>
            {t("filter.running")}
          </button>
        </div>
      </div>

      {error ? <ErrorBox title={t("error.title")} message={error} /> : null}
      {loading && containers.length === 0 ? <Loading text={t("status.refreshing")} /> : null}

      {!loading && !error && visible.length === 0 ? <EmptyState title={t("list.empty")} /> : null}

      <div className="dk-list">
        {visible.map((item) => {
          const expanded = selectedId === item.id;
          return (
            <ContainerRow
              key={item.id}
              t={t}
              container={item}
              expanded={expanded}
              onToggle={() => setSelectedId(expanded ? "" : item.id)}
            >
              <ContainerDetail
                t={t}
                container={item}
                rpc={rpc}
                notify={notify}
                onChanged={onChanged}
                onOpenLogs={() => onOpenLogs(item.id)}
              />
            </ContainerRow>
          );
        })}
      </div>
    </div>
  );
}
