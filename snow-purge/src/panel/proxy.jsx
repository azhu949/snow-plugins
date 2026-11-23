// 请求代理页：托管段开关、注入指令、协议分流、冲突让位与探针记录。
import { getReact, h } from "./react.js";
import { applyModeOf, Badge, Btn, ErrorBox, Loading, SectionTitle, Toggle, summarizeApplyOutcome } from "./ui.jsx";

const PROVIDERS = [
  { id: "chat", label: "Chat Completions" },
  { id: "responses", label: "Responses" },
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini", label: "Gemini" },
];

export function ProxyView({ t, rpc, notify, config, reload }) {
  const React = getReact();
  const [state, setState] = React.useState({ status: "loading", error: "", data: null });
  const [draft, setDraft] = React.useState({
    enabled: false,
    directive: "",
    boost: true,
    providers: { chat: true, responses: true, anthropic: true, gemini: true },
  });
  const [force, setForce] = React.useState(false);
  const [busy, setBusy] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const data = await rpc.proxy();
      setState({ status: "ready", error: "", data });
      setDraft({
        enabled: data?.config?.proxy?.enabled === true,
        directive: data?.config?.proxy?.directive || "",
        boost: data?.config?.proxy?.boost !== false,
        providers: { ...data?.config?.proxy?.providers },
      });
    } catch (error) {
      setState({ status: "error", error: String(error?.message || error), data: null });
    }
  }, [rpc]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (busy) return;
    setBusy("save");
    try {
      const result = await rpc.applyProxy({
        enabled: draft.enabled,
        directive: draft.directive,
        boost: draft.boost,
        providers: draft.providers,
        force,
      });
      const summary = summarizeApplyOutcome(result?.steps, applyModeOf(result?.mode), t, {
        appliedError: result?.appliedError,
      });
      notify(summary.tone, summary.text);
      setForce(false);
      await load();
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };

  const restore = async () => {
    if (busy) return;
    // 还原会用快照整体覆盖文件，先把「可能覆盖段外手写内容」讲清楚再动手。
    // 只剩插件残骸时改写口径：本次只清理插件写入的内容。
    const analysis = state.data?.analysis || {};
    const residueOnly = Boolean(analysis.hasManagedResidue) && !analysis.hasBlock;
    if (!window.confirm(t(residueOnly ? "proxy.restoreResidueConfirm" : "proxy.restoreConfirm"))) return;
    setBusy("restore");
    try {
      const result = await rpc.restoreProxy(force);
      // 后台按实际结果分档：快照丢了只能剥离托管段，不能报「已还原」。
      if (result?.degraded || result?.outcome === "degraded") {
        notify("warn", t("proxy.restoreDegraded", { id: result?.snapshotId || "-" }));
      } else if (result?.outcome === "empty") {
        notify("warn", t("proxy.restoreNoop"));
      } else if (result?.outcome === "recreated") {
        notify("ok", t("proxy.restoreRecreated"));
      } else if (result?.outcome === "cleaned") {
        notify("ok", t("proxy.restoreCleaned", { count: result?.removedResidues || 0 }));
      } else if (result?.restored) {
        notify("ok", t("proxy.restored"));
      } else if (result?.removed) {
        notify("ok", t("proxy.restoreRemoved"));
      } else {
        notify("warn", t("proxy.restoreStripped"));
      }
      await load();
      await reload();
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

  const data = state.data || {};
  const analysis = data.analysis || {};
  const probe = data.probe || { entries: [] };

  return (
    <div className="pg-stack">
      <div className="pg-card">
        <SectionTitle
          extra={
            analysis.hasBlock ? (
              <Badge tone="ok">{t("proxy.blockPresent")}</Badge>
            ) : (
              <Badge tone="off">{t("proxy.blockAbsent")}</Badge>
            )
          }
        >
          {t("proxy.title")}
        </SectionTitle>
        <div className="pg-note">{t("proxy.hint")}</div>
        <div className="pg-kv">
          <span className="pg-kv-key">{t("proxy.path")}</span>
          <span className="pg-kv-value pg-mono">{data.path || "-"}</span>
          <span className="pg-kv-key">{t("proxy.exists")}</span>
          <span className="pg-kv-value">{data.exists ? t("common.yes") : t("common.no")}</span>
          <span className="pg-kv-key">{t("proxy.blockHash")}</span>
          <span className="pg-kv-value pg-mono">{analysis.blockHash || "-"}</span>
          <span className="pg-kv-key">{t("proxy.foreignHook")}</span>
          <span className="pg-kv-value">{analysis.hasForeignHook ? t("common.yes") : t("common.no")}</span>
          <span className="pg-kv-key">{t("proxy.residue")}</span>
          <span className="pg-kv-value">
            {analysis.hasManagedResidue
              ? `${analysis.residueCount || 0}`
              : analysis.orphanBegins || analysis.orphanEnds
                ? t("proxy.residueUnconfirmed")
                : t("common.no")}
          </span>
        </div>
        <Toggle
          checked={draft.enabled}
          onChange={(next) => setDraft((prev) => ({ ...prev, enabled: next }))}
          label={t("proxy.enable")}
          hint={t("proxy.enableHint")}
        />
        <label className="pg-label">{t("proxy.directive")}</label>
        <textarea
          className="pg-textarea"
          rows={6}
          value={draft.directive}
          onChange={(event) => setDraft((prev) => ({ ...prev, directive: event.target.value }))}
        />
        <Toggle
          checked={draft.boost}
          onChange={(next) => setDraft((prev) => ({ ...prev, boost: next }))}
          label={t("proxy.boost")}
          hint={t("proxy.boostHint")}
        />
        <label className="pg-label">{t("proxy.providers")}</label>
        <div className="pg-providers">
          {PROVIDERS.map((provider) => (
            <label className="pg-inline-check" key={provider.id}>
              <input
                type="checkbox"
                checked={draft.providers[provider.id] !== false}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    providers: { ...prev.providers, [provider.id]: event.target.checked },
                  }))
                }
              />
              <span>{provider.label}</span>
            </label>
          ))}
        </div>
        <div className="pg-row">
          <label className="pg-inline-check">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
            <span>{t("proxy.force")}</span>
          </label>
        </div>
        <div className="pg-row pg-row-end">
          <Btn size="sm" variant="ghost" disabled={busy !== ""} onClick={() => void restore()}>
            {t("proxy.restore")}
          </Btn>
          <Btn
            size="sm"
            variant="primary"
            disabled={busy !== "" || (draft.enabled && !draft.directive.trim())}
            onClick={() => void save()}
          >
            {t("proxy.save")}
          </Btn>
        </div>
      </div>

      <div className="pg-card">
        <SectionTitle extra={<Badge tone={probe.entries?.length ? "ok" : "off"}>{probe.entries?.length || 0}</Badge>}>
          {t("proxy.probeTitle")}
        </SectionTitle>
        <div className="pg-note">{t("proxy.probeHint")}</div>
        {!probe.entries?.length ? (
          <div className="pg-meta">{t("proxy.probeEmpty")}</div>
        ) : (
          <div className="pg-table">
            <div className="pg-table-head">
              <span>{t("proxy.probeTime")}</span>
              <span>{t("proxy.probeProvider")}</span>
              <span>{t("proxy.probeMode")}</span>
            </div>
            {probe.entries.map((entry, index) => (
              <div className="pg-table-row" key={`${entry.at}-${index}`}>
                <span>{new Date(Number(entry.at) || 0).toLocaleString()}</span>
                <span>{entry.provider || "-"}</span>
                <span className="pg-mono">{entry.mode || "system"}</span>
              </div>
            ))}
          </div>
        )}
        <div className="pg-row pg-row-end">
          <Btn size="sm" variant="ghost" onClick={() => void load()}>
            {t("action.refresh")}
          </Btn>
        </div>
      </div>

      <div className="pg-card">
        <SectionTitle>{t("proxy.previewTitle")}</SectionTitle>
        <pre className="pg-pre">{data.preview || t("proxy.previewEmpty")}</pre>
        <div className="pg-note">{t("proxy.boundary")}</div>
      </div>
    </div>
  );
}
