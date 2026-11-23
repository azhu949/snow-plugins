// 面板入口：状态 / 提示词 / 免确认 / 红队 / 请求代理 / 备份 / 审计 / 设置。
// 宿主注入 props：api / locale / panelId / panel / pluginId / isActive / inputText。
import { bindReact, ensureReact, h } from "./react.js";
import { createTranslator } from "./i18n.js";
import { createRpc } from "./rpc.js";
import { Badge, Btn, ErrorBox, Loading, summarizeApplyOutcome } from "./ui.jsx";
import { StatusView } from "./status.jsx";
import { PromptsView } from "./prompts.jsx";
import { ApprovalView } from "./approval.jsx";
import { RedteamView } from "./redteam.jsx";
import { RosterModal } from "./roster.jsx";
import { ProxyView } from "./proxy.jsx";
import { BackupView } from "./backup.jsx";
import { AuditView } from "./audit.jsx";
import { SettingsView } from "./settings.jsx";

// 宿主在挂载前已注入 window.SnowAppPlugin，先在这里兜底绑定，避免子模块取不到 React。
if (typeof window !== "undefined" && window.SnowAppPlugin && window.SnowAppPlugin.React) {
  bindReact(window.SnowAppPlugin.React);
}

const TAB_IDS = ["status", "prompts", "approval", "redteam", "proxy", "backup", "audit", "settings"];
const TAB_LABEL = {
  status: "tab.status",
  prompts: "tab.prompts",
  approval: "tab.approval",
  redteam: "tab.redteam",
  proxy: "tab.proxy",
  backup: "tab.backup",
  audit: "tab.audit",
  settings: "tab.settings",
};

/**
 * 标签图标在渲染期才构造：JSX 会被编译成 h()，模块求值时 React 还没绑定，
 * 放在顶层会直接抛错，ensureReact 的兜底也走不到。
 */
const buildTabIcons = () => ({
  status: (
    <g>
      <path d="M12 3 4.5 6v6c0 4.2 3.1 7.6 7.5 9 4.4-1.4 7.5-4.8 7.5-9V6Z" />
      <path d="m8.6 12.1 2.5 2.5 4.4-4.8" />
    </g>
  ),
  prompts: (
    <g>
      <path d="M5 4h11l3 3v13H5Z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </g>
  ),
  approval: (
    <g>
      <path d="M12 21s7-3.6 7-9V6l-7-3-7 3v6c0 5.4 7 9 7 9Z" />
      <path d="M9 11.5 11 13.5 15 9.5" />
    </g>
  ),
  redteam: (
    <g>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </g>
  ),
  proxy: (
    <g>
      <path d="M4 7h11l-2.5-2.5M20 17H9l2.5 2.5" />
      <path d="M4 7h6M14 17h6" />
    </g>
  ),
  backup: (
    <g>
      <path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3v10c0 1.7-3.6 3-8 3s-8-1.3-8-3Z" />
      <path d="M4 7c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </g>
  ),
  audit: (
    <g>
      <path d="M6 3h12v18H6Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </g>
  ),
  settings: (
    <g>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </g>
  ),
});

const NOTICE_MS = 4200;
const REFRESH_MS = 25000;

export default function PurgePanel({ api, locale, isActive }) {
  const React = ensureReact(api);
  // 图标只在首次渲染时构造一次：此时 React 必然已绑定。
  const tabIcons = React.useMemo(buildTabIcons, []);
  const translator = React.useMemo(() => createTranslator(api, locale), [api, locale]);
  const { t, locale: resolvedLocale } = translator;

  const log = React.useCallback(
    (...args) => {
      try {
        api?.log?.(...args);
      } catch {
        // 日志失败不影响界面。
      }
    },
    [api]
  );

  const rpc = React.useMemo(() => createRpc(api, { log }), [api, log]);

  const [view, setView] = React.useState({ status: "loading", error: "", data: null });
  const [tab, setTab] = React.useState("status");
  const [busy, setBusy] = React.useState("");
  const [notices, setNotices] = React.useState([]);
  // 顶部刷新时自增：让按需加载的标签页（红队）跟着重新拉一次数据。
  const [refreshTick, setRefreshTick] = React.useState(0);
  // 编队弹窗：全窗视图，与标签页内容互不干扰。
  const [rosterOpen, setRosterOpen] = React.useState(false);

  const aliveRef = React.useRef(true);
  const timersRef = React.useRef(new Map());

  React.useEffect(() => {
    aliveRef.current = true;
    const timers = timersRef.current;
    return () => {
      aliveRef.current = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const notify = React.useCallback((tone, text) => {
    if (!aliveRef.current) return;
    const id = `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setNotices((list) => [...list.slice(-2), { id, tone: tone || "info", text: String(text || "") }]);
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      if (!aliveRef.current) return;
      setNotices((list) => list.filter((item) => item.id !== id));
    }, NOTICE_MS);
    timersRef.current.set(id, timer);
  }, []);

  const describeError = React.useCallback(
    (error) => {
      const code = String(error?.code || "");
      if (code === "BACKGROUND_PENDING") return t("error.pending");
      if (code === "BACKGROUND_UNAVAILABLE") return t("error.backgroundUnavailable");
      if (code === "NET_UNAVAILABLE") return t("error.netUnavailable");
      if (code === "TIMEOUT") return t("error.timeout");
      return t("error.generic", { message: String(error?.message || error) });
    },
    [t]
  );

  const reload = React.useCallback(async () => {
    try {
      const data = await rpc.overview();
      if (!aliveRef.current) return;
      setView({ status: "ready", error: "", data });
      setRefreshTick((tick) => tick + 1);
    } catch (error) {
      if (!aliveRef.current) return;
      setView((prev) => ({
        status: prev.data ? "stale" : "error",
        error: describeError(error),
        data: prev.data,
      }));
    }
  }, [rpc, describeError]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  React.useEffect(() => {
    if (isActive === false) return undefined;
    const timer = setInterval(() => {
      void reload();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload, isActive]);

  // mode 说明后台这次实际做了什么：总开关关闭时「应用」等于撤回，没有任何层参与时是 noop。
  const summarize = (steps, { revert = false, bySwitch = false, noop = false, appliedError = "" } = {}) =>
    summarizeApplyOutcome(
      steps,
      noop ? "noop" : bySwitch ? "revert-by-switch" : revert ? "revert" : "apply",
      t,
      {
        appliedError,
      }
    );

  const runApply = React.useCallback(
    async (forceProxy = false) => {
      if (busy) return;
      setBusy("apply");
      try {
        const result = await rpc.apply(forceProxy);
        const bySwitch = result?.mode === "revert";
        const summary = summarize(result?.steps || [], {
          revert: bySwitch,
          bySwitch,
          noop: result?.mode === "noop",
          appliedError: result?.appliedError,
        });
        notify(summary.tone, summary.text);
        await reload();
      } catch (error) {
        notify("bad", describeError(error));
      } finally {
        if (aliveRef.current) setBusy("");
      }
    },
    [busy, rpc, notify, reload, describeError, t]
  );

  const runRevert = React.useCallback(async () => {
    if (busy) return;
    setBusy("revert");
    try {
      const result = await rpc.revert();
      const summary = summarize(result?.steps || [], {
        revert: true,
        appliedError: result?.appliedError,
      });
      notify(summary.tone, summary.text);
      await reload();
    } catch (error) {
      notify("bad", describeError(error));
    } finally {
      if (aliveRef.current) setBusy("");
    }
  }, [busy, rpc, notify, reload, describeError, t]);

  const data = view.data;
  const config = data?.config || null;
  const counts = data?.selfcheck?.counts || { ok: 0, warn: 0, fail: 0, off: 0 };

  return (
    <div className="pg-root">
      <div className="pg-head">
        <div className="pg-head-main">
          <span className="pg-title">{t("app.title")}</span>
          <span className="pg-sub">
            {data?.server ? `v${data.server.version} · ${t("status.port")} ${data.server.port}` : t("status.connecting")}
          </span>
        </div>
        <div className="pg-head-badges">
          {counts.ok > 0 ? <Badge tone="ok">{`${t("status.ok")} ${counts.ok}`}</Badge> : null}
          {counts.warn > 0 ? <Badge tone="warn">{`${t("status.warn")} ${counts.warn}`}</Badge> : null}
          {counts.fail > 0 ? <Badge tone="bad">{`${t("status.fail")} ${counts.fail}`}</Badge> : null}
        </div>
        <div className="pg-head-spacer" />
        <Btn size="sm" variant="primary" disabled={busy !== "" || view.status === "loading"} onClick={() => void runApply(false)}>
          {t("action.apply")}
        </Btn>
        <Btn size="sm" variant="ghost" disabled={busy !== "" || view.status === "loading"} onClick={() => void runRevert()}>
          {t("action.revert")}
        </Btn>
        <Btn size="sm" variant="ghost" disabled={busy !== ""} onClick={() => void reload()}>
          {t("action.refresh")}
        </Btn>
      </div>

      <div className="pg-tabs">
        {TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="pg-tab"
            data-active={tab === id ? "1" : "0"}
            onClick={() => setTab(id)}
          >
            <svg
              className="pg-tab-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {tabIcons[id]}
            </svg>
            <span>{t(TAB_LABEL[id])}</span>
          </button>
        ))}
      </div>

      <div className="pg-body">
        {view.status === "loading" ? <Loading text={t("status.loading")} /> : null}

        {view.status === "error" ? (
          <ErrorBox
            title={t("error.title")}
            message={view.error}
            action={
              <Btn
                size="sm"
                variant="primary"
                onClick={() => {
                  rpc.resetPort();
                  setView({ status: "loading", error: "", data: null });
                  void reload();
                }}
              >
                {t("action.retry")}
              </Btn>
            }
          />
        ) : null}

        {view.status === "stale" ? <div className="pg-inline-warn">{view.error}</div> : null}

        {data && tab === "status" ? (
          <StatusView
            t={t}
            data={data}
            busy={busy}
            onApply={() => void runApply(false)}
            onRevert={() => void runRevert()}
            onRefresh={() => void reload()}
          />
        ) : null}

        {data && tab === "prompts" ? (
          <PromptsView
            t={t}
            locale={resolvedLocale}
            rpc={rpc}
            notify={notify}
            config={config}
            reload={reload}
          />
        ) : null}
        {data && tab === "approval" ? <ApprovalView t={t} rpc={rpc} notify={notify} config={config} reload={reload} /> : null}
        {data && tab === "redteam" ? (
          <RedteamView
            t={t}
            rpc={rpc}
            notify={notify}
            refreshTick={refreshTick}
            onOpenRoster={() => setRosterOpen(true)}
          />
        ) : null}
        {data && tab === "proxy" ? <ProxyView t={t} rpc={rpc} notify={notify} config={config} reload={reload} /> : null}
        {data && tab === "backup" ? <BackupView t={t} rpc={rpc} notify={notify} reload={reload} /> : null}
        {data && tab === "audit" ? <AuditView t={t} rpc={rpc} notify={notify} /> : null}
        {data && tab === "settings" ? <SettingsView t={t} rpc={rpc} notify={notify} config={config} reload={reload} /> : null}
      </div>

      {rosterOpen ? (
        <RosterModal t={t} rpc={rpc} notify={notify} onClose={() => setRosterOpen(false)} />
      ) : null}

      {notices.length ? (
        <div className="pg-notices">
          {notices.map((notice) => (
            <div className="pg-notice" data-tone={notice.tone} key={notice.id}>
              {notice.text}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
