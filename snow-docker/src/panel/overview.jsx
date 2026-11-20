// 概览视图：本机连接配置（CLI 路径 / DOCKER_HOST / context）、CLI 与引擎状态、磁盘占用、Compose 项目。
// 远程 SSH 上传在独立的「远程」标签页里（ssh.jsx）。
import { h, getReact } from "./react.js";
import { Btn, EmptyState, ErrorBox, Field, Loading } from "./ui.jsx";
import { DkSelect } from "./select.jsx";

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
};

/** 连接配置卡片：本机 docker CLI 的目标（路径 / DOCKER_HOST / context）。 */
export function ConnectionCard({ t, rpc, notify, onSaved, title }) {
  const React = getReact();
  const [form, setForm] = React.useState({ cliPath: "", dockerHost: "", context: "" });
  const [detect, setDetect] = React.useState({ status: "idle", data: null, error: "" });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [loaded, setLoaded] = React.useState(false);

  const applySaved = React.useCallback((saved) => {
    setForm({
      cliPath: String(saved?.cliPath || ""),
      dockerHost: String(saved?.dockerHost || ""),
      context: String(saved?.context || ""),
    });
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await rpc.settings();
        if (!alive) return;
        applySaved(saved);
        setLoaded(true);
      } catch (cause) {
        if (alive) setError(String(cause?.message || cause));
      }
    })();
    return () => {
      alive = false;
    };
  }, [rpc, applySaved]);

  const runDetect = React.useCallback(async () => {
    setDetect({ status: "loading", data: null, error: "" });
    try {
      const data = await rpc.detect();
      setDetect({ status: "ready", data, error: "" });
    } catch (cause) {
      setDetect({ status: "error", data: null, error: String(cause?.message || cause) });
    }
  }, [rpc]);

  React.useEffect(() => {
    void runDetect();
  }, [runDetect]);

  const buildPayload = () => ({ ...form });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const saved = await rpc.saveSettings(buildPayload());
      applySaved(saved);
      await runDetect();
      onSaved?.();
      notify("success", t("conn.saved"));
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setSaving(false);
    }
  };

  const contexts = detect.data?.contexts || [];
  const contextOptions = [
    { value: "", label: t("conn.contextDefault") },
    ...contexts.map((item) => ({
      value: item.name,
      label: item.current ? `${item.name} (${t("conn.current")})` : item.name,
    })),
  ];

  return (
    <div className="dk-card">
      <div className="dk-card-title">
        <span>{title || t("conn.title")}</span>
        <span className="dk-pill">
          <Btn size="sm" variant="ghost" disabled={detect.status === "loading"} onClick={() => void runDetect()}>
            {detect.status === "loading" ? t("conn.detecting") : t("conn.detect")}
          </Btn>
        </span>
      </div>

      {!loaded ? <Loading text={t("status.checking")} /> : null}

      {loaded ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <span className="dk-meta">{t("conn.cliPath")}</span>
            <input
              className="dk-input"
              value={form.cliPath}
              placeholder="docker"
              onChange={(event) => setForm((prev) => ({ ...prev, cliPath: event.target.value }))}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <span className="dk-meta">{t("conn.dockerHost")}</span>
            <input
              className="dk-input"
              value={form.dockerHost}
              placeholder="npipe:////./pipe/docker_engine"
              onChange={(event) => setForm((prev) => ({ ...prev, dockerHost: event.target.value }))}
            />
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <span className="dk-meta">{t("conn.context")}</span>
            <DkSelect
              value={form.context}
              options={contextOptions}
              onChange={(next) => setForm((prev) => ({ ...prev, context: next }))}
              ariaLabel={t("conn.context")}
            />
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <Btn size="sm" variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? t("conn.saving") : t("conn.save")}
            </Btn>
            {error ? <span className="dk-inline-error">{error}</span> : null}
          </div>
        </div>
      ) : null}

      {detect.status === "error" ? <div className="dk-inline-error">{detect.error}</div> : null}

      {detect.data ? (
        <div className="dk-kv" style={{ marginTop: "8px" }}>
          <Field label={t("conn.cliFound")} value={detect.data.cli?.found ? detect.data.cli.version || t("conn.yes") : t("conn.no")} />
          <Field label={t("conn.cliUsed")} value={detect.data.cli?.bin} />
          <Field label={t("conn.envHost")} value={detect.data.env?.dockerHost} />
          <Field label={t("conn.envContext")} value={detect.data.env?.dockerContext} />
          <Field
            label={t("conn.contexts")}
            value={contexts.length ? contexts.map((item) => item.name).join(", ") : t("overview.none")}
          />
        </div>
      ) : null}
      {detect.data?.cli?.error ? <div className="dk-inline-error">{detect.data.cli.error}</div> : null}
    </div>
  );
}

export function OverviewView({ t, rpc, notify, system, loading, error, onRetry, targetKind }) {
  if (error) {
    return (
      <div className="dk-body">
        <ErrorBox title={t("error.title")} message={error} />
      </div>
    );
  }
  if (!system) {
    return (
      <div className="dk-body">
        {loading ? <Loading text={t("status.checking")} /> : <EmptyState title={t("error.title")} />}
      </div>
    );
  }

  const { cli, daemon, disk, compose } = system;
  const containersText =
    daemon.containers?.running !== null && daemon.containers?.total !== null
      ? `${daemon.containers.running} / ${daemon.containers.total}`
      : "";

  return (
    <div className="dk-body">
      <div className="dk-overview">
        <div className="dk-card">
          <div className="dk-card-title">
            <span>
              {t("overview.daemon")}
              {system.target?.label ? ` · ${system.target.label}` : ""}
            </span>
            <span className="dk-pill">
              <span className="dk-dot" data-tone={daemon.online ? "ok" : "bad"} />
              {daemon.online ? t("status.online") : t("status.daemonOffline")}
            </span>
          </div>
          <div className="dk-kv">
            <Field label={t("overview.version")} value={daemon.version} />
            <Field label={t("overview.apiVersion")} value={daemon.apiVersion} />
            <Field label={t("overview.os")} value={daemon.operatingSystem} />
            <Field label={t("overview.arch")} value={daemon.architecture} />
            <Field label={t("overview.cpus")} value={daemon.cpus} />
            <Field label={t("overview.memory")} value={formatBytes(daemon.memoryBytes)} />
            <Field label={t("overview.driver")} value={daemon.driver} />
            <Field label={t("overview.containers")} value={containersText} />
            <Field label={t("overview.images")} value={daemon.images} />
            <Field label={t("overview.rootDir")} value={daemon.rootDir} />
          </div>
          {daemon.error ? <div className="dk-inline-error">{daemon.error}</div> : null}
          {!daemon.online && onRetry ? (
            <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
              <Btn size="sm" onClick={onRetry}>
                {t("action.retry")}
              </Btn>
              <span className="dk-meta">{t("conn.autoRetry")}</span>
            </div>
          ) : null}
        </div>

        {/* 现在只面向远程 daemon，连接卡片固定显示当前服务器 */}
        <div className="dk-card">
          <div className="dk-card-title">
            <span>{t("overview.target")}</span>
          </div>
          <div className="dk-kv">
            <Field label={t("target.label")} value={system.target?.label || ""} />
            <Field label={t("overview.cli")} value={system.cli?.bin || ""} />
          </div>
          <div className="dk-meta" style={{ marginTop: "6px" }}>
            {t("overview.remoteHint")}
          </div>
        </div>

        <div className="dk-card">
          <div className="dk-card-title">
            <span>{t("overview.cli")}</span>
            <span className="dk-pill">
              <span className="dk-dot" data-tone={cli.available ? "ok" : "bad"} />
              {cli.available ? t("overview.version") : t("status.cliMissing")}
            </span>
          </div>
          <div className="dk-kv">
            <Field label={t("overview.version")} value={cli.version} />
            <Field label={t("overview.apiVersion")} value={cli.apiVersion} />
            <Field label={t("overview.os")} value={cli.os} />
            <Field label={t("overview.arch")} value={cli.arch} />
          </div>
          {cli.error ? <div className="dk-inline-error">{cli.error}</div> : null}
        </div>

        {disk?.length ? (
          <div className="dk-card">
            <div className="dk-card-title">
              <span>{t("overview.disk")}</span>
            </div>
            <div className="dk-kv">
              {disk.map((row) => (
                <Field
                  key={`${row.Type}-${row.TotalCount}`}
                  label={row.Type}
                  value={`${row.Size || ""} · ${row.Reclaimable || ""} ${t("overview.reclaimable")}`}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="dk-card">
          <div className="dk-card-title">
            <span>{t("overview.compose")}</span>
          </div>
          {compose?.length ? (
            <div className="dk-kv">
              {compose.map((item) => (
                <Field key={item.Name} label={item.Name} value={item.Status} />
              ))}
            </div>
          ) : (
            <div className="dk-meta">{t("overview.none")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
