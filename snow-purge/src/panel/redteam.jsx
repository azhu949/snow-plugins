// 红队页：把上游 dsh-purge 的红队技能包安装到 Snow App 技能目录，并做只读环境自检。
// 这里不下载工具、不执行任何命令：安装动作只写 SKILL.md 文本。
import { getReact, h } from "./react.js";
import { Badge, Btn, ErrorBox, Loading, SectionTitle } from "./ui.jsx";

const ENV_LABEL = {
  fofa: "redteam.env.fofa",
  vpsHost: "redteam.env.vpsHost",
  vpsKey: "redteam.env.vpsKey",
  toolkit: "redteam.env.toolkit",
  setupMarker: "redteam.env.setupMarker",
  tools: "redteam.env.tools",
};

const ENV_TONE = { ok: "ok", warn: "warn", off: "off" };

const skillTone = (item) => {
  if (item.broken) return "bad";
  if (item.installed && item.enabled) return "ok";
  if (item.installed) return "off";
  return "muted";
};

export function RedteamView({ t, rpc, notify, refreshTick = 0, onOpenRoster }) {
  const React = getReact();
  const [state, setState] = React.useState({ status: "loading", error: "", data: null });
  const [busy, setBusy] = React.useState("");
  const [role, setRole] = React.useState("");
  const [preview, setPreview] = React.useState(null);

  // force=true 只在用户点「刷新」或「重试」时使用：后台的环境探测有缓存，靠它强制重扫。
  const load = React.useCallback(async ({ force = false } = {}) => {
    try {
      const data = await rpc.redteam(force ? { refresh: 1 } : undefined);
      setState({ status: "ready", error: "", data });
    } catch (error) {
      setState({ status: "error", error: String(error?.message || error), data: null });
    }
  }, [rpc]);

  React.useEffect(() => {
    void load();
  }, [load, refreshTick]);

  const run = async (key, task) => {
    if (busy) return null;
    setBusy(key);
    try {
      const result = await task();
      if (result?.items) setState({ status: "ready", error: "", data: result });
      return result;
    } catch (error) {
      notify("bad", String(error?.message || error));
      return null;
    } finally {
      setBusy("");
    }
  };

  const installOne = (name) =>
    run(name, async () => {
      const result = await rpc.installRedteam({ name });
      const item = result?.results?.[0] || {};
      const action = item.action || "";
      if (item.indexError) {
        // SKILL.md 已写入但索引没记上：安装时间与「可更新」判断会不准。
        notify("warn", String(item.indexError));
      } else {
        notify(
          "ok",
          action === "updated" ? t("redteam.updated", { name }) : t("redteam.installed", { name })
        );
      }
      return result;
    });

  const installAll = () =>
    run("all", async () => {
      const result = await rpc.installRedteam({ all: true });
      const failed = (result?.results || []).filter((item) => item.action === "failed");
      const indexFailed = (result?.results || []).filter((item) => item.indexError);
      if (failed.length) {
        notify("warn", t("redteam.installPartial", { count: failed.length }));
      } else if (indexFailed.length) {
        // 技能都已落盘，只是索引没记上：明确说清影响面，别让用户重复安装。
        notify("warn", String(indexFailed[0].indexError));
      } else {
        notify("ok", t("redteam.installDone", { count: (result?.results || []).length }));
      }
      return result;
    });

  const toggle = (item) =>
    run(`t-${item.name}`, async () => {
      const result = await rpc.toggleRedteam(item.name, !item.enabled);
      notify("ok", item.enabled ? t("redteam.disabled", { name: item.name }) : t("redteam.enabled", { name: item.name }));
      return result;
    });

  const removeOne = (item) =>
    run(`r-${item.name}`, async () => {
      const result = await rpc.removeRedteam(item.name);
      if (result?.indexError) notify("warn", String(result.indexError));
      else notify("ok", t("redteam.removed", { name: item.name }));
      if (preview?.name === item.name) setPreview(null);
      return result;
    });

  const view = async (item) => {
    try {
      const data = await rpc.redteamSkill(item.name);
      setPreview(data);
    } catch (error) {
      notify("bad", String(error?.message || error));
    }
  };

  if (state.status === "loading") return <Loading text={t("common.loading")} />;
  if (state.status === "error") {
    return (
      <ErrorBox
        title={t("error.title")}
        message={state.error}
        action={
          <Btn size="sm" onClick={() => void load({ force: true })}>
            {t("action.retry")}
          </Btn>
        }
      />
    );
  }

  const data = state.data || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const counts = data.counts || {};
  const env = data.env || { items: [], tools: [] };
  const roles = Array.from(new Set(items.map((item) => item.role).filter(Boolean))).sort();
  const visible = role ? items.filter((item) => item.role === role) : items;

  const stateLabel = (item) => {
    if (item.broken) return t("redteam.state.broken");
    if (item.installed && item.enabled) return t("redteam.state.enabled");
    if (item.installed) return t("redteam.state.disabled");
    return t("redteam.state.notInstalled");
  };

  return (
    <div className="pg-stack">
      <div className="pg-card">
        <SectionTitle
          extra={<Badge tone={counts.installed ? "ok" : "off"}>{`${counts.installed || 0}/${counts.total || 0}`}</Badge>}
        >
          {t("redteam.title")}
        </SectionTitle>
        <div className="pg-note">{t("redteam.hint")}</div>
        <div className="pg-kv">
          <span className="pg-kv-key">{t("redteam.libraryDir")}</span>
          <span className="pg-kv-value pg-mono">{data.libraryDir || "-"}</span>
          <span className="pg-kv-key">{t("redteam.skillsDir")}</span>
          <span className="pg-kv-value pg-mono">{data.skillsDir || "-"}</span>
          <span className="pg-kv-key">{t("redteam.enabledCount")}</span>
          <span className="pg-kv-value">{`${counts.enabled || 0}/${counts.total || 0}`}</span>
        </div>
        <div className="pg-row pg-row-end">
          <Btn size="sm" variant="ghost" disabled={busy !== ""} onClick={() => void load({ force: true })}>
            {t("action.refresh")}
          </Btn>
          <Btn size="sm" variant="ghost" disabled={busy !== ""} onClick={() => onOpenRoster?.()}>
            {t("roster.open")}
          </Btn>
          <Btn size="sm" variant="primary" disabled={busy !== "" || items.length === 0} onClick={() => void installAll()}>
            {t("redteam.installAll")}
          </Btn>
        </div>
      </div>

      <div className="pg-card">
        <SectionTitle extra={<Badge tone="muted">{`${visible.length}`}</Badge>}>{t("redteam.library")}</SectionTitle>
        <div className="pg-chips">
          <button type="button" className="pg-chip" data-tone={role === "" ? "ok" : undefined} onClick={() => setRole("")}>
            {t("redteam.allRoles")}
          </button>
          {roles.map((id) => (
            <button
              key={id}
              type="button"
              className="pg-chip"
              data-tone={role === id ? "ok" : undefined}
              onClick={() => setRole(id)}
            >
              {id}
            </button>
          ))}
        </div>
        {visible.length === 0 ? <div className="pg-meta">{t("redteam.empty")}</div> : null}
        <div className="pg-preset-list">
          {visible.map((item) => (
            <div className="pg-preset" key={item.name}>
              <div className="pg-preset-main">
                <span className="pg-preset-name">
                  {item.name}
                  {item.role ? <span className="pg-role-tag">{item.role}</span> : null}
                </span>
                <span className="pg-preset-summary">{item.description || item.whenToUse || ""}</span>
              </div>
              <Badge tone={skillTone(item)}>{stateLabel(item)}</Badge>
              <Btn size="sm" variant="ghost" onClick={() => void view(item)}>
                {t("redteam.view")}
              </Btn>
              {item.installed ? (
                <Btn size="sm" variant="ghost" disabled={busy !== ""} onClick={() => void toggle(item)}>
                  {item.enabled ? t("redteam.disable") : t("redteam.enable")}
                </Btn>
              ) : null}
              <Btn size="sm" variant={item.installed ? "ghost" : "primary"} disabled={busy !== ""} onClick={() => void installOne(item.name)}>
                {item.installed ? (item.updateAvailable ? t("redteam.update") : t("redteam.reinstall")) : t("redteam.install")}
              </Btn>
              {item.installed ? (
                <button
                  type="button"
                  className="pg-chip-x"
                  title={t("action.remove")}
                  disabled={busy !== ""}
                  onClick={() => void removeOne(item)}
                >
                  x
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {preview ? (
        <div className="pg-card">
          <SectionTitle
            extra={
              <Btn size="sm" variant="ghost" onClick={() => setPreview(null)}>
                {t("redteam.close")}
              </Btn>
            }
          >
            {`${preview.name} · ${preview.chars}`}
          </SectionTitle>
          <div className="pg-note">{t("redteam.previewHint")}</div>
          <pre className="pg-pre">{preview.content}</pre>
        </div>
      ) : null}

      <div className="pg-card">
        <SectionTitle
          extra={<Badge tone={env.counts?.warn ? "warn" : env.counts?.ok ? "ok" : "off"}>{`${env.counts?.ok || 0}/${(env.items || []).length}`}</Badge>}
        >
          {t("redteam.env.title")}
        </SectionTitle>
        <div className="pg-note">{t("redteam.env.hint")}</div>
        <div className="pg-table pg-table-3">
          <div className="pg-table-head">
            <span>{t("redteam.env.item")}</span>
            <span>{t("redteam.env.evidence")}</span>
            <span>{t("common.state")}</span>
          </div>
          {(env.items || []).map((item) => (
            <div className="pg-table-row" key={item.id}>
              <span>{ENV_LABEL[item.id] ? t(ENV_LABEL[item.id]) : item.id}</span>
              <span className="pg-mono">{item.detail || "-"}</span>
              <span>
                <Badge tone={ENV_TONE[item.status] || "muted"}>{t(`redteam.env.${item.status}`)}</Badge>
              </span>
            </div>
          ))}
        </div>
        <div className="pg-chips">
          {(env.tools || []).map((tool) => (
            <span className="pg-chip" data-tone={tool.found ? "ok" : undefined} key={tool.name} title={tool.path || t("redteam.env.missing")}>
              {tool.name}
            </span>
          ))}
        </div>
      </div>

      <div className="pg-card">
        <SectionTitle>{t("redteam.boundary.title")}</SectionTitle>
        <div className="pg-note">{t("redteam.boundary.skills")}</div>
        <div className="pg-note">{t("redteam.boundary.tools")}</div>
        <div className="pg-note">{t("redteam.boundary.workflow")}</div>
        <div className="pg-note">{t("redteam.boundary.legal")}</div>
      </div>
    </div>
  );
}
