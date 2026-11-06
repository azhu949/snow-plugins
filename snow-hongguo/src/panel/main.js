// 面板入口：推荐 / 搜索 / 历史 / 设置四个页签，详情页作为覆盖层；播放器由 player.js 挂载。
import { bindReact, h } from "./ui/runtime.js";
import { createTranslator } from "./i18n.js";
import { createRpc } from "./rpc.js";
import { createCoverStore } from "./cover.js";
import { DEFAULT_MINI_WINDOW, readPrefs, writePrefs } from "./storage.js";
import { Icon, Spinner, describeError } from "./ui/common.js";
import { DiscoverPage } from "./pages/discover.js";
import { SearchPage } from "./pages/search.js";
import { DetailPage } from "./pages/detail.js";
import { HistoryPage } from "./pages/history.js";
import { SettingsPage } from "./pages/settings.js";

// 播放器挂载契约对外导出：下一个节点可直接 import 这些符号，或替换 player.js 的实现。
export { PLAYER_SLOT_ID, PlayerMount, renderPlayer } from "./player.js";

const TABS = [
  { id: "discover", icon: "Sparkles", labelKey: "tab.discover" },
  { id: "search", icon: "Search", labelKey: "tab.search" },
  { id: "history", icon: "History", labelKey: "tab.history" },
  { id: "settings", icon: "Settings", labelKey: "tab.settings" },
];

const NOTICE_ICONS = { success: "CircleCheck", error: "CircleAlert", info: "Info" };

const getHostReact = (api) =>
  (api && api.ui && api.ui.React) ||
  (typeof window !== "undefined" && window.SnowAppPlugin && window.SnowAppPlugin.React) ||
  null;

function PanelApp({ api, React, locale }) {
  const translator = React.useMemo(() => createTranslator(api, locale), [api, locale]);
  const t = translator.t;
  const resolvedLocale = translator.locale;
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
  const cover = React.useMemo(() => createCoverStore(rpc, { log }), [rpc, log]);

  const [boot, setBoot] = React.useState({ status: "loading", error: null, health: null });
  const [activeTab, setActiveTab] = React.useState("discover");
  const [route, setRoute] = React.useState(null);
  const [detailVisible, setDetailVisible] = React.useState(false);
  const [miniActive, setMiniActive] = React.useState(false);
  const [visited, setVisited] = React.useState(() => ({ discover: true }));
  const [prefs, setPrefs] = React.useState({ quality: "720p", miniWindow: { ...DEFAULT_MINI_WINDOW } });
  const [historyVersion, setHistoryVersion] = React.useState(0);
  const [notices, setNotices] = React.useState([]);

  const prefsRef = React.useRef(prefs);
  const aliveRef = React.useRef(true);
  const bootSeqRef = React.useRef(0);
  const routeSeqRef = React.useRef(0);
  const noticeTimersRef = React.useRef(new Map());

  // 清单若已声明 styles，宿主会在挂载前注入 style[data-snow-plugin]；这里只在缺失时
  // 从插件目录读取 style.css 作为兜底，避免「忘了声明 styles」直接变成无样式界面。
  React.useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const pluginId = api?.id || "com.snow.hongguo";
    if (document.querySelector(`style[data-snow-plugin="${pluginId}"]`)) {
      for (const node of document.querySelectorAll("style[data-hg-fallback]")) node.remove();
      return undefined;
    }
    if (document.querySelector("style[data-hg-fallback]")) return undefined;
    let disposed = false;
    (async () => {
      try {
        const dataUrl = await api?.assets?.resolve?.("style.css");
        if (disposed || typeof dataUrl !== "string" || !dataUrl.includes(";base64,")) return;
        if (document.querySelector(`style[data-snow-plugin="${pluginId}"]`)) return;
        const binary = atob(dataUrl.slice(dataUrl.indexOf(";base64,") + 8));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        const style = document.createElement("style");
        style.dataset.hgFallback = "1";
        style.textContent = new TextDecoder().decode(bytes);
        document.head.appendChild(style);
        log("[panel] 清单未注入样式，已使用 style.css 兜底");
      } catch (error) {
        log("[panel] 样式兜底注入失败", String(error?.message || error));
      }
    })();
    return () => {
      disposed = true;
    };
  }, [api, log]);

  React.useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  React.useEffect(() => {
    aliveRef.current = true;
    const timers = noticeTimersRef.current;
    return () => {
      aliveRef.current = false;
      cover.dispose();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [cover]);

  const notify = React.useCallback((kind, text) => {
    if (!aliveRef.current) return;
    const id = `notice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setNotices((list) => [...list.slice(-2), { id, kind: kind || "info", text: String(text || "") }]);
    const timer = setTimeout(() => {
      noticeTimersRef.current.delete(id);
      if (!aliveRef.current) return;
      setNotices((list) => list.filter((item) => item.id !== id));
    }, 4000);
    noticeTimersRef.current.set(id, timer);
  }, []);

  const updatePrefs = React.useCallback(
    (patch) => {
      const next = { ...prefsRef.current, ...patch };
      prefsRef.current = next;
      setPrefs(next);
      writePrefs(api, next).catch((error) => {
        notify("error", t("settings.saveFailed", { error: String(error?.message || error) }));
      });
    },
    [api, notify, t]
  );

  const startBoot = React.useCallback(() => {
    const seq = bootSeqRef.current + 1;
    bootSeqRef.current = seq;
    setBoot({ status: "loading", error: null, health: null });
    rpc
      .ensureReady()
      .then((health) => {
        if (!aliveRef.current || seq !== bootSeqRef.current) return;
        setBoot({ status: "ready", error: null, health });
      })
      .catch((error) => {
        if (!aliveRef.current || seq !== bootSeqRef.current) return;
        setBoot({ status: "failed", error, health: null });
      });
  }, [rpc]);

  React.useEffect(() => {
    startBoot();
  }, [startBoot]);

  React.useEffect(() => {
    if (boot.status !== "ready") return undefined;
    let alive = true;
    readPrefs(api)
      .then((value) => {
        if (!alive || !value) return;
        prefsRef.current = value;
        setPrefs(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, boot.status]);

  const ctx = React.useMemo(
    () => ({
      api,
      rpc,
      t,
      locale: resolvedLocale,
      cover,
      prefs,
      updatePrefs,
      notify,
      log,
      bumpHistory: () => setHistoryVersion((value) => value + 1),
      onMiniChange: (active) => {
        setMiniActive(active);
        // 小窗按钮的语义是“返回详情页”：即使从其它底部菜单退出，也重新露出原详情层。
        if (!active) setDetailVisible(true);
      },
      openSeries: (seed) => {
        if (!seed || !seed.id) return;
        // 小窗中重新选剧必须换一个新实例，显式结束旧播放器，不能复用到另一部剧。
        routeSeqRef.current += 1;
        setRoute({ id: String(seed.id), seed, instance: routeSeqRef.current });
        setMiniActive(false);
        setDetailVisible(true);
      },
      openTab: (id) => {
        setActiveTab(id);
        setVisited((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
        if (miniActive) {
          // 只隐藏详情层，保留 PlayerMount；否则切页卸载详情会连同小窗一起销毁。
          setDetailVisible(false);
          return;
        }
        setRoute(null);
        setDetailVisible(false);
      },
    }),
    [api, rpc, t, resolvedLocale, cover, prefs, updatePrefs, notify, log, miniActive]
  );

  // 渲染期异常兜底：保留页签与底部导航，只替换出错区域。
  const ErrorBoundary = React.useMemo(() => {
    class Boundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      componentDidCatch(error, info) {
        log("[panel] render error", String(error?.message || error), String(info?.componentStack || ""));
      }

      componentDidUpdate(prevProps) {
        if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
          this.setState({ error: null });
        }
      }

      render() {
        if (this.state.error) {
          return h(
            "div",
            { className: "hg-panel hg-boot" },
            h("div", { className: "hg-boot-title" }, t("error.renderTitle")),
            h("div", { className: "hg-boot-text" }, String(this.state.error?.message || this.state.error)),
            h(
              "button",
              { type: "button", className: "hg-btn primary", onClick: () => this.setState({ error: null }) },
              t("error.retryPanel")
            )
          );
        }
        return this.props.children;
      }
    }
    return Boundary;
  }, [log, t]);

  if (boot.status === "loading") {
    return h(
      "div",
      { className: "hg-panel" },
      h(
        "div",
        { className: "hg-boot" },
        h(Spinner, { label: t("boot.loading") }),
        h("div", { className: "hg-boot-title" }, t("plugin.title")),
        h("div", { className: "hg-boot-text" }, t("boot.loading"))
      )
    );
  }

  if (boot.status === "failed") {
    const info = describeError(t, boot.error);
    return h(
      "div",
      { className: "hg-panel" },
      h(
        "div",
        { className: "hg-boot" },
        h("div", { className: "hg-boot-icon" }, h(Icon, { ctx, name: "ServerOff", size: 24 })),
        h("div", { className: "hg-boot-title" }, t("boot.failedTitle")),
        h("div", { className: "hg-boot-text" }, info.message),
        h("div", { className: "hg-boot-hint" }, t("boot.failedHint")),
        boot.error?.message
          ? h("code", { className: "hg-boot-detail" }, String(boot.error.message))
          : null,
        h(
          "button",
          { type: "button", className: "hg-btn primary", onClick: startBoot },
          t("boot.retry")
        )
      )
    );
  }

  const covered = Boolean(route && detailVisible);
  const tabPanes = h(
    "div",
    {
      className: `hg-tabpanes${covered ? " is-covered" : ""}`,
      "aria-hidden": covered ? "true" : undefined,
    },
    visited.discover
      ? h(
          "div",
          { className: "hg-tabpane", hidden: activeTab !== "discover" },
          h(DiscoverPage, { ctx, active: activeTab === "discover" && !covered })
        )
      : null,
    visited.search
      ? h(
          "div",
          { className: "hg-tabpane", hidden: activeTab !== "search" },
          h(SearchPage, { ctx, active: activeTab === "search" })
        )
      : null,
    visited.history
      ? h(
          "div",
          { className: "hg-tabpane", hidden: activeTab !== "history" },
          h(HistoryPage, { ctx, active: activeTab === "history", historyVersion })
        )
      : null,
    visited.settings
      ? h(
          "div",
          { className: "hg-tabpane", hidden: activeTab !== "settings" },
          h(SettingsPage, { ctx, active: activeTab === "settings" })
        )
      : null
  );

  // 详情层覆盖在常驻页签之上：返回时列表不卸载；小窗切页时仅隐藏详情层，播放器继续运行。
  const detailLayer = route
    ? h(
        "div",
        {
          className: "hg-detail-layer",
          hidden: !detailVisible,
          "aria-hidden": !detailVisible ? "true" : undefined,
        },
        h(DetailPage, {
          key: `${route.id}:${route.instance || 0}`,
          ctx,
          seed: route.seed,
          onBack: () => {
            setRoute(null);
            setDetailVisible(false);
            setMiniActive(false);
          },
        })
      )
    : null;

  return h(
    "div",
    { className: "hg-panel" },
    h(
      "header",
      { className: "hg-head" },
      h("div", { className: "hg-head-mark" }, h(Icon, { ctx, name: "Film", size: 16 })),
      h(
        "div",
        { className: "hg-head-text" },
        h("div", { className: "hg-head-title" }, t("plugin.title")),
        h(
          "div",
          { className: "hg-head-sub" },
            t("app.subtitle")
        )
      ),
      h("span", { className: "hg-head-dot", title: t("settings.running") })
    ),
    h(
      "main",
      { className: "hg-body" },
      h(
        ErrorBoundary,
        { resetKey: route ? `detail:${route.id}` : `tab:${activeTab}` },
        tabPanes,
        detailLayer
      )
    ),
    notices.length > 0
      ? h(
          "div",
          { className: "hg-notices" },
          notices.map((notice) =>
            h(
              "div",
              { key: notice.id, className: `hg-notice is-${notice.kind}`, role: "status" },
              h(Icon, { ctx, name: NOTICE_ICONS[notice.kind] || "Info", size: 13 }),
              h("span", null, notice.text)
            )
          )
        )
      : null,
    h(
      "nav",
      { className: "hg-tabs", role: "tablist" },
      TABS.map((tab) => {
        const selected = activeTab === tab.id;
        return h(
          "button",
          {
            key: tab.id,
            type: "button",
            role: "tab",
            "aria-selected": selected,
            className: `hg-tab${selected ? " is-active" : ""}`,
            onClick: () => ctx.openTab(tab.id),
          },
          h(Icon, { ctx, name: tab.icon, size: 16 }),
          h("span", { className: "hg-tab-label" }, t(tab.labelKey))
        );
      })
    )
  );
}

export default function Panel(props) {
  const api = props?.api;
  const React = getHostReact(api);
  if (!React) return null;
  bindReact(React);
  return React.createElement(PanelApp, {
    api,
    React,
    locale: props?.locale,
    panelId: props?.panelId,
    isActive: props?.isActive,
  });
}
