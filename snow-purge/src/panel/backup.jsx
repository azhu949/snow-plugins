// 备份页：只列出本插件创建的快照，可回滚或删除。
import { getReact, h } from "./react.js";
import { Badge, Btn, ErrorBox, Loading, SectionTitle } from "./ui.jsx";

const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1048576).toFixed(1)} MB`;
};

const KIND_KEY = {
  proxy: "backup.kind.proxy",
  role: "backup.kind.role",
  prompt: "backup.kind.prompt",
  approval: "backup.kind.approval",
};

/** 每一类快照都先确认覆盖范围：不同层的覆盖语义差别很大，不能只给代理脚本弹确认。 */
const CONFIRM_KEY = {
  proxy: "backup.restoreProxyConfirm",
  role: "backup.confirm.role",
  prompt: "backup.confirm.prompt",
  approval: "backup.confirm.approval",
};

const FORCE_CONFIRM_KEY = {
  role: "backup.confirm.roleForce",
  proxy: "backup.confirm.proxyForce",
};

/** 删除确认的有效期：与提示词页、编队页的二次点击口径保持一致。 */
const DELETE_CONFIRM_MS = 3500;

export function BackupView({ t, rpc, notify, reload }) {
  const React = getReact();
  const [state, setState] = React.useState({ status: "loading", error: "", data: null });
  const [busy, setBusy] = React.useState("");
  const [confirmId, setConfirmId] = React.useState("");

  React.useEffect(() => {
    if (!confirmId) return undefined;
    const timer = window.setTimeout(() => setConfirmId(""), DELETE_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirmId]);

  const load = React.useCallback(async () => {
    try {
      const data = await rpc.backups();
      setState({ status: "ready", error: "", data });
      setConfirmId("");
      return data;
    } catch (error) {
      setState({ status: "error", error: String(error?.message || error), data: null });
      return null;
    }
  }, [rpc]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const restore = async (item) => {
    if (busy) return;
    if (!window.confirm(t(CONFIRM_KEY[item.kind] || "backup.confirm.other"))) return;
    setBusy(item.id);
    try {
      let result;
      try {
        result = await rpc.restoreBackup(item.id, false);
      } catch (error) {
        // 段外内容被改过时后台会让位：再确认一次，确认后才带 force 整份覆盖。
        const forceKey = FORCE_CONFIRM_KEY[item.kind];
        if (forceKey && (error?.code === "ROLE_FOREIGN_EDIT" || error?.code === "PROXY_FOREIGN_EDIT")) {
          if (!window.confirm(t(forceKey))) return;
          result = await rpc.restoreBackup(item.id, true);
        } else {
          throw error;
        }
      }
      notify("ok", result?.appliedNote ? `${t("backup.restored")}${result.appliedNote}` : t("backup.restored"));
      await load();
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };

  const remove = async (item) => {
    if (busy) return;
    const kind = t(KIND_KEY[item.kind] || "backup.kind.other");
    // 备份删除不可恢复：先切到确认态，3.5 秒内再点一次才真正删除。
    if (confirmId !== item.id) {
      setConfirmId(item.id);
      notify("warn", t("backup.deleteConfirm", { kind, time: new Date(item.at).toLocaleString() }));
      return;
    }
    setConfirmId("");
    setBusy(item.id);
    try {
      const result = await rpc.removeBackup(item.id);
      if (result?.removed === false) {
        notify("bad", t("backup.deleteFailed"));
        return;
      }
      notify("ok", t("backup.deleted", { kind, count: Number(result?.usage?.count) || 0 }));
      await load();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };

  if (state.status === "loading") return <Loading text={t("common.loading")} />;
  if (state.status === "error") {
    return (
      <ErrorBox
        title={t("error.title")}
        message={state.error}
        action={<Btn size="sm" onClick={() => void load()}>{t("action.retry")}</Btn>}
      />
    );
  }

  const data = state.data || { items: [], usage: {} };

  return (
    <div className="pg-stack">
      <div className="pg-card">
        <SectionTitle extra={<Badge tone="off">{`${data.usage?.count || 0} / ${formatBytes(data.usage?.bytes || 0)}`}</Badge>}>
          {t("backup.title")}
        </SectionTitle>
        <div className="pg-note">{t("backup.hint")}</div>
        <div className="pg-kv">
          <span className="pg-kv-key">{t("backup.dir")}</span>
          <span className="pg-kv-value pg-mono">{data.dir || "-"}</span>
        </div>
        {!data.items?.length ? (
          <div className="pg-meta">{t("backup.empty")}</div>
        ) : (
          <div className="pg-table">
            <div className="pg-table-head">
              <span>{t("backup.time")}</span>
              <span>{t("backup.kind")}</span>
              <span>{t("backup.size")}</span>
              <span>{t("common.actions")}</span>
            </div>
            {data.items.map((item) => (
              <div className="pg-table-row" key={item.id}>
                <span>{new Date(item.at).toLocaleString()}</span>
                <span>{t(KIND_KEY[item.kind] || "backup.kind.other")}</span>
                <span>{formatBytes(item.bytes)}</span>
                <span className="pg-row pg-row-tight">
                  <Btn size="sm" variant="ghost" disabled={busy !== ""} onClick={() => void restore(item)}>
                    {t("backup.restore")}
                  </Btn>
                  <Btn
                    size="sm"
                    variant={confirmId === item.id ? "danger" : "ghost"}
                    disabled={busy !== ""}
                    onClick={() => void remove(item)}
                  >
                    {confirmId === item.id ? t("backup.deleteArmed") : t("action.delete")}
                  </Btn>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="pg-row pg-row-end">
          <Btn size="sm" variant="ghost" onClick={() => void load()}>
            {t("action.refresh")}
          </Btn>
        </div>
        <div className="pg-note">{t("backup.boundary")}</div>
      </div>
    </div>
  );
}
