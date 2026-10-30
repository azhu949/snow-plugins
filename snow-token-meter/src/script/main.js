// 客户端脚本入口：注入样式、初始化引擎、挂载悬浮胶囊（或顶栏徽标）与浮层。
// 脚本插件没有面板容器，界面由脚本自建：顶栏形态把徽标挂在 topbar.actions 插槽，
// 悬浮形态直接挂到 body —— 顶栏卡片的 backdrop-filter 会成为 fixed 的包含块，
// 使按视口坐标算出的 left/top 被当成卡片内坐标，默认位与拖动都会错位。
// 浮层挂在 body 下的独立 Preact root，关闭时只隐藏不卸载。
import { h, render } from "preact";
import { STORAGE_KEYS } from "../constants.js";
import { createEngine } from "../engine.js";
import { createT } from "../i18n.js";
import MeterPanel from "../ui/meter-panel.js";
import { iconMarkup } from "../ui/icons.js";
import { formatAgo, formatCost, formatExactTokens, formatPercent, withFxRate } from "../ui/format.js";
import { clamp, compactTokens } from "../util.js";
import { createScriptApi, createScriptStorage, hasScriptHost } from "./api.js";
import styles from "../../style.css";

const BADGE_HOST_ID = "snow-token-meter-badge";
const PANEL_HOST_ID = "snow-token-meter-panel";
const TOPBAR_SLOT = "topbar.actions";
const TOPBAR_ANCHOR = "topbar";
// 宿主 React 重渲染后补挂的防抖窗口：太短会与宿主渲染互相推挤，太长会明显闪烁。
const REMOUNT_DEBOUNCE_MS = 100;
const STREAM_REFRESH_DELAY_MS = 1500;
const DRAG_THRESHOLD_PX = 3;
const PANEL_MAX_WIDTH = 400;
const PANEL_MIN_WIDTH = 240;
const VIEWPORT_GUTTER = 8;
const ANCHOR_GAP = 8;
// 悬浮形态的默认位置：与顶栏同一行垂直居中；量不到顶栏时贴住视口顶部。
const FALLBACK_FLOAT_TOP = 8;
const FALLBACK_BADGE_HEIGHT = 30;
// 窗口尺寸变化后回写悬浮坐标的去抖窗口：避免拖动窗口边缘时连续写存储并重置自动刷新定时器。
const FLOAT_PERSIST_DEBOUNCE_MS = 200;
const COVERAGE_WARN = 0.95;
// 首屏顶栏可能晚于脚本注入：在有界次数内重试挂载，避免错过 context 事件后徽标一直缺席。
const MOUNT_RETRY_MS = 200;
const MOUNT_RETRY_LIMIT = 20;

function log(...args) {
  try {
    if (typeof GM_log === "function") GM_log(...args);
    else console.log(...args);
  } catch {
    // 日志失败不影响主流程。
  }
}

function currentLocale() {
  try {
    return String((snow.context && snow.context.locale) || "zh-CN");
  } catch {
    return "zh-CN";
  }
}

function currentViewId() {
  try {
    return String((snow.context && snow.context.view) || "");
  } catch {
    return "";
  }
}

function findSlot() {
  try {
    if (typeof snow !== "undefined" && typeof snow.slot === "function") {
      const slot = snow.slot(TOPBAR_SLOT);
      if (slot && typeof slot.append === "function") return slot;
    }
  } catch {
    // 宿主不支持插槽 API 时走 DOM 回退。
  }
  return document.querySelector(`[data-snow-slot="${TOPBAR_SLOT}"]`);
}

function findAnchor() {
  try {
    if (typeof snow !== "undefined" && typeof snow.anchor === "function") {
      const anchor = snow.anchor(TOPBAR_ANCHOR);
      if (anchor) return anchor;
    }
  } catch {
    // 宿主不支持锚点 API 时走选择器回退。
  }
  return document.querySelector(`[data-snow-anchor="${TOPBAR_ANCHOR}"]`);
}

// 只在需要时创建元素并同步文本：徽标不经过 Preact，避免顶栏插槽里的节点被宿主重建。
function createBadge() {
  const host = document.createElement("div");
  host.id = BADGE_HOST_ID;
  host.className = "tm-badge-host";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tm-badge";
  button.setAttribute("data-tm-action", "toggle");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = [
    `<span class="tm-badge-icon">${iconMarkup("Coins", 13)}</span>`,
    '<span class="tm-badge-tokens"></span>',
    '<span class="tm-badge-cost"></span>',
    '<span class="tm-badge-dot" aria-hidden="true"></span>',
  ].join("");

  host.append(button);
  return {
    host,
    button,
    tokens: host.querySelector(".tm-badge-tokens"),
    cost: host.querySelector(".tm-badge-cost"),
  };
}

function injectStyles(css) {
  try {
    if (typeof GM_addStyle === "function") {
      GM_addStyle(css);
      return null;
    }
  } catch {
    // GM_addStyle 不可用（或抛错）时回退到 <style>，卸载时由我们自己移除。
  }
  const style = document.createElement("style");
  style.setAttribute("data-tm-style", "1");
  style.textContent = css;
  (document.head || document.documentElement).append(style);
  return style;
}

function mount() {
  if (!hasScriptHost()) {
    console.warn("[Token 用量仪表] 当前宿主缺少 snow.metadata 或 GM_* 能力，脚本未启动。");
    return;
  }

  const injectedStyle = injectStyles(styles);

  const api = createScriptApi();
  const storage = createScriptStorage();
  const fetchFn = (url, init) => snow.fetch(url, init);
  const engine = createEngine({ api, storage, fetchFn });
  const t = createT(() => currentLocale());

  let snapshot = engine.getState();
  const badge = createBadge();
  const badgeHost = badge.host;
  const badgeButton = badge.button;

  const panelHost = document.createElement("div");
  panelHost.id = PANEL_HOST_ID;
  panelHost.className = "tm-panel-host is-hidden";
  panelHost.setAttribute("data-tm-view", "main");
  document.body.append(panelHost);

  let open = false;
  let view = { name: "main" };
  let lastLocale = currentLocale();
  let lastViewId = currentViewId();
  let streamTimer = 0;
  let observeTimer = 0;
  let suppressTimer = 0;
  let mountRetry = 0;
  let mountAttempts = 0;
  let floatPersistTimer = 0;
  let suppressToggle = false;
  let drag = null;
  let observedAnchor = null;
  let disposed = false;

  function readDisplayMode() {
    const settings = snapshot && snapshot.settings;
    return settings && settings.displayMode === "float" ? "float" : "topbar";
  }

  // 悬浮形态的 fixed 定位必须相对视口：徽标挂在 body；顶栏形态才用插槽。
  // 插槽取不到时返回 null，由补挂逻辑等待宿主重建顶栏。
  function badgeParentOf(mode) {
    return mode === "float" ? document.body : findSlot();
  }

  /* ------------------------------ 徽标渲染 ------------------------------ */

  function catalogStatusText() {
    const catalog = snapshot.catalog || {};
    if (catalog.error) return t("tm.catalog.error", { message: catalog.error });
    if (!catalog.fetchedAt) return t("tm.catalog.missing");
    const base = t("tm.catalog.synced", { value: formatAgo(catalog.fetchedAt, t) });
    return catalog.stale ? `${base} · ${t("tm.catalog.cached")}` : base;
  }

  // 徽标 title 里的价格行自己带前缀，避免与 tm.catalog.synced 的「价格同步：」重复。
  function catalogStatusLine() {
    const catalog = snapshot.catalog || {};
    if (catalog.error) return t("tm.catalog.error", { message: catalog.error });
    if (!catalog.fetchedAt) return t("tm.badge.title.pricing", { value: t("tm.catalog.missing") });
    const base = t("tm.catalog.synced", { value: formatAgo(catalog.fetchedAt, t) });
    return catalog.stale ? `${base} · ${t("tm.catalog.cached")}` : base;
  }

  // 徽标 title 里的汇率行：自动模式显示同步时间，手动模式显示手动值。
  function fxStatusLine() {
    const settings = snapshot.settings || {};
    if (settings.fxMode !== "auto") {
      return t("tm.fx.manual", { rate: Number(settings.fxRate).toFixed(4) });
    }
    const fx = snapshot.fx || {};
    if (!fx.rate) return t("tm.fx.missing");
    const base = t("tm.fx.synced", {
      rate: fx.rate.toFixed(4),
      value: formatAgo(fx.fetchedAt, t),
    });
    return fx.error ? `${base} · ${t("tm.fx.cached")}` : base;
  }

  function badgeWarnings() {
    const list = [];
    const settings = snapshot.settings || {};
    const catalog = snapshot.catalog || {};
    if (catalog.error) list.push(t("tm.warn.catalog", { message: catalog.error }));
    else if (catalog.stale && (catalog.fetchedAt || catalog.count)) list.push(t("tm.warn.stale"));
    const fx = snapshot.fx || {};
    if (settings.fxMode === "auto" && fx.error && !fx.rate) {
      list.push(t("tm.warn.fx", { message: fx.error }));
    }
    if (snapshot.denied) list.push(t("tm.warn.denied"));
    const cost = snapshot.today && snapshot.today.cost;
    if (cost && cost.totalTokens > 0 && cost.coverage < COVERAGE_WARN) {
      list.push(t("tm.warn.coverage", { percent: formatPercent(cost.coverage) }));
    }
    return list;
  }

  function badgeTitle() {
    const settings = withFxRate(snapshot.settings || {}, snapshot.fx);
    const today = snapshot.today || {};
    const all = snapshot.allTime || {};
    const summary = today.summary || null;
    const allSummary = all.summary || null;
    const lines = [
      t("tm.badge.title.today", {
        tokens: compactTokens(summary ? summary.totalTokens : 0),
        cost: formatCost(today.cost ? today.cost.totalUsd : 0, settings),
      }),
    ];
    if (summary) {
      lines.push(
        [
          t("tm.badge.title.input", { value: compactTokens(summary.totalInputTokens) }),
          t("tm.badge.title.output", { value: compactTokens(summary.totalOutputTokens) }),
          t("tm.badge.title.cacheRead", {
            value: compactTokens(summary.totalCacheReadInputTokens),
          }),
        ].join(" · "),
      );
    }
    lines.push(
      t("tm.badge.title.requests", {
        value: formatExactTokens(summary ? summary.totalRequests : 0),
      }),
    );
    lines.push(
      t("tm.badge.title.total", {
        tokens: compactTokens(allSummary ? allSummary.totalTokens : 0),
        cost: formatCost(all.cost ? all.cost.totalUsd : 0, settings),
      }),
    );
    lines.push(catalogStatusLine());
    lines.push(fxStatusLine());
    const warnings = badgeWarnings();
    if (warnings.length) lines.push(...warnings);
    return lines.join("\n");
  }

  function renderBadge() {
    const settings = withFxRate(snapshot.settings || {}, snapshot.fx);
    const range = settings.badgeStyle === "total" ? snapshot.allTime : snapshot.today;
    const summary = range ? range.summary : null;
    const cost = range ? range.cost : null;
    const ready = Boolean(summary);
    const tokensText = ready ? compactTokens(summary.totalTokens) : t("tm.badge.empty");
    const costText = ready ? formatCost(cost ? cost.totalUsd : 0, settings) : t("tm.badge.empty");

    badge.tokens.textContent = tokensText;
    badge.cost.textContent = costText;

    const warnings = badgeWarnings();
    badgeButton.title = badgeTitle();
    badgeButton.setAttribute("aria-label", `${t("tm.badge.toggle")} · ${tokensText} token · ${costText}`);
    badgeHost.classList.toggle("is-loading", !snapshot.initialized || Boolean(snapshot.loading));
    badgeHost.classList.toggle("is-warn", warnings.length > 0);
    badgeHost.classList.toggle("is-open", open);
    syncBadgeAria();
  }

  function syncBadgeAria() {
    badgeButton.setAttribute("aria-expanded", open ? "true" : "false");
    badgeButton.setAttribute("aria-pressed", open ? "true" : "false");
  }

  // 悬浮形态默认停在窗口顶部中间：垂直与顶栏同一行居中，水平按会话消息列居中；
  // 量不到锚点时 left 为 null（交给 CSS 居中）、top 退回视口顶部 8px。
  function defaultFloatPlacement() {
    const area =
      document.querySelector('[data-snow-anchor="chat.messages"]') ||
      document.querySelector('[data-snow-anchor="main.view"]');
    const areaRect = area ? area.getBoundingClientRect() : null;
    const badgeRect = badgeHost.getBoundingClientRect();
    const badgeWidth = badgeRect.width;
    const badgeHeight = badgeRect.height > 0 ? badgeRect.height : FALLBACK_BADGE_HEIGHT;

    let left = null;
    if (areaRect && areaRect.width > 0 && badgeWidth > 0) {
      left = Math.round(areaRect.left + (areaRect.width - badgeWidth) / 2);
    }

    let top = FALLBACK_FLOAT_TOP;
    const topbar = document.querySelector('[data-snow-anchor="topbar"]');
    if (topbar) {
      const rect = topbar.getBoundingClientRect();
      if (rect.height > 0) {
        top = Math.round(rect.top + Math.max(0, (rect.height - badgeHeight) / 2));
      }
    }
    return { left, top };
  }

  function clearInlinePosition() {
    badgeHost.style.left = "";
    badgeHost.style.top = "";
    badgeHost.style.right = "";
    badgeHost.style.bottom = "";
    badgeHost.style.transform = "";
  }

  // 保存坐标是视口坐标（悬浮形态为 position: fixed）。窗口变小或换到小屏后必须按当前视口重新夹取，
  // 否则徽标整体落在视口外，而它是插件唯一入口。完全不可见时返回 null，交给默认位。
  function fitFloatPosition(position) {
    if (!position) return null;
    const rect = badgeHost.getBoundingClientRect();
    const badgeWidth = rect.width > 0 ? rect.width : badgeHost.offsetWidth;
    const badgeHeight = rect.height > 0 ? rect.height : FALLBACK_BADGE_HEIGHT;
    if (!(badgeWidth > 0) || !(badgeHeight > 0)) return null;
    if (
      position.left >= window.innerWidth ||
      position.top >= window.innerHeight ||
      position.left + badgeWidth <= 0 ||
      position.top + badgeHeight <= 0
    ) {
      return null;
    }
    const maxLeft = Math.max(VIEWPORT_GUTTER, window.innerWidth - badgeWidth - VIEWPORT_GUTTER);
    const maxTop = Math.max(VIEWPORT_GUTTER, window.innerHeight - badgeHeight - VIEWPORT_GUTTER);
    return {
      left: Math.round(clamp(position.left, VIEWPORT_GUTTER, maxLeft)),
      top: Math.round(clamp(position.top, VIEWPORT_GUTTER, maxTop)),
    };
  }

  function applyDisplayMode() {
    const isFloat = readDisplayMode() === "float";
    if (!isFloat) {
      const slot = findSlot();
      if (!slot) {
        // 顶栏插槽暂时缺失（首屏或宿主重建顶栏）：先保持悬浮态与现有坐标，
        // 避免徽标以 position: relative 掉到页面末尾，等补挂后归位。
        badgeHost.classList.add("is-float");
        if (badgeHost.parentElement !== document.body) document.body.append(badgeHost);
        scheduleMountRetry();
        return;
      }
      badgeHost.classList.remove("is-float");
      if (badgeHost.parentElement !== slot) slot.append(badgeHost);
      clearInlinePosition();
      return;
    }
    badgeHost.classList.add("is-float");
    if (badgeHost.parentElement !== document.body) document.body.append(badgeHost);
    // 拖动中的坐标由 onDragMove 直接写入：此时重排会把徽标弹回保存位置。
    if (drag && drag.moved) return;
    const position = snapshot.settings && snapshot.settings.floatPosition;
    const fitted =
      position && Number.isFinite(position.left) && Number.isFinite(position.top)
        ? fitFloatPosition(position)
        : null;
    if (fitted) {
      badgeHost.style.transform = "none";
      badgeHost.style.left = `${fitted.left}px`;
      badgeHost.style.top = `${fitted.top}px`;
      badgeHost.style.right = "auto";
      badgeHost.style.bottom = "auto";
    } else {
      // 没有保存坐标或坐标已完全越界时回到默认位：窗口顶部中间（与顶栏同一行）。
      const placement = defaultFloatPlacement();
      const hasLeft = Boolean(placement) && placement.left !== null;
      badgeHost.style.transform = hasLeft ? "none" : "";
      badgeHost.style.left = hasLeft ? `${placement.left}px` : "";
      badgeHost.style.right = "";
      badgeHost.style.bottom = "";
      badgeHost.style.top = `${(placement && placement.top) || FALLBACK_FLOAT_TOP}px`;
    }
    if (open) positionPanel();
  }

  /* ------------------------------ 浮层定位 ------------------------------ */

  function panelMetrics() {
    const rect = panelHost.getBoundingClientRect();
    const fallbackWidth = Math.min(PANEL_MAX_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2);
    return {
      width: rect.width > 0 ? rect.width : fallbackWidth,
      height: rect.height > 0 ? rect.height : 0,
    };
  }

  function positionPanel() {
    if (!open) return;
    const width = Math.min(
      PANEL_MAX_WIDTH,
      Math.max(PANEL_MIN_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2),
    );
    panelHost.style.width = `${width}px`;
    panelHost.style.maxWidth = `${Math.max(0, window.innerWidth - VIEWPORT_GUTTER * 2)}px`;

    const anchor = badgeHost.getBoundingClientRect();
    const { height } = panelMetrics();
    const maxLeft = Math.max(VIEWPORT_GUTTER, window.innerWidth - width - VIEWPORT_GUTTER);
    // 以徽标的水平中心展开浮层：顶栏靠右与悬浮居中两种位置都能自然对齐，最后夹进视口。
    const centerX = anchor.left + anchor.width / 2;
    const left = clamp(centerX - width / 2, VIEWPORT_GUTTER, maxLeft);

    const below = anchor.bottom + ANCHOR_GAP;
    const above = anchor.top - height - ANCHOR_GAP;
    const fitsBelow = height === 0 || below + height <= window.innerHeight - VIEWPORT_GUTTER;
    let top = fitsBelow ? below : above;
    if (top < VIEWPORT_GUTTER) top = below;
    const maxTop = Math.max(
      VIEWPORT_GUTTER,
      height > 0 ? window.innerHeight - height - VIEWPORT_GUTTER : window.innerHeight - VIEWPORT_GUTTER,
    );
    top = clamp(top, VIEWPORT_GUTTER, maxTop);

    panelHost.style.left = `${Math.round(left)}px`;
    panelHost.style.top = `${Math.round(top)}px`;
    panelHost.style.right = "auto";
    panelHost.style.bottom = "auto";
    // 浮层内的本地展开（如设置页的「数据源设置」）不经过 setView，不会再触发定位：
    // 把到视口底部的剩余高度交给 CSS 变量，与 style.css 里的 70vh / 620px 取最小值，
    // 内容继续增长时改为浮层自身内部滚动，底部按钮始终可以滚到。
    if (height > 0) {
      const available = Math.max(0, window.innerHeight - Math.round(top) - VIEWPORT_GUTTER);
      panelHost.style.setProperty("--tm-panel-available-h", `${available}px`);
    }
  }

  /* ------------------------------ 视图与开关 ------------------------------ */

  function panelProps() {
    return {
      engine,
      state: snapshot,
      t,
      view,
      onView: setView,
      onClose: closePanel,
      onTogglePin: togglePinned,
      onClearCatalog: clearCatalog,
      onResetMappings: resetMappings,
      onResetSettings: resetDefaultSettings,
      onResetFloatPosition: resetFloatPosition,
    };
  }

  function renderPanel() {
    panelHost.setAttribute("data-tm-view", view.name);
    render(h(MeterPanel, panelProps()), panelHost);
  }

  function setView(next) {
    view = next && next.name ? next : { name: "main" };
    panelHost.setAttribute("data-tm-view", view.name);
    if (!open) return;
    renderPanel();
    positionPanel();
  }

  function openPanel() {
    if (open || disposed) return;
    open = true;
    panelHost.classList.remove("is-hidden");
    panelHost.setAttribute("data-tm-open", "1");
    badgeHost.classList.add("is-open");
    syncBadgeAria();
    renderPanel();
    positionPanel();
    // 打开浮层属于自动触发：走 10 秒节流，避免反复开关就发起多轮 metadata 请求。
    engine.refresh().catch(() => {
      // 引擎已把错误写入 state。
    });
  }

  function closePanel() {
    if (!open) return;
    open = false;
    panelHost.classList.add("is-hidden");
    panelHost.removeAttribute("data-tm-open");
    badgeHost.classList.remove("is-open");
    view = { name: "main" };
    panelHost.setAttribute("data-tm-view", "main");
    syncBadgeAria();
  }

  function togglePanel() {
    if (open) closePanel();
    else openPanel();
  }

  function togglePinned() {
    const current = snapshot.settings || {};
    engine.setSettings({ panelPinned: !current.panelPinned }).catch(() => {});
  }

  async function clearCatalog() {
    try {
      if (typeof GM_deleteValue === "function") {
        // 两个价格源各有一份缓存，一并清掉，避免切换来源后仍复用旧目录。
        GM_deleteValue(STORAGE_KEYS.catalog);
        GM_deleteValue(STORAGE_KEYS.catalogModelsDev);
      }
    } catch {
      // 删除失败时仍尝试拉取一次，让引擎自行覆盖。
    }
    await engine.refreshPricing({ force: true });
  }

  // 一次写空映射表、一次重算成本：逐条重算会让界面长时间无响应。
  async function resetMappings() {
    return (await engine.clearMappings()).saved;
  }

  // 重置设置只回到默认值，映射、价格目录与用量数据都保留。
  async function resetDefaultSettings() {
    return (await engine.resetSettings()).saved;
  }

  // 只清悬浮坐标：坐标失效时用它回到默认位，不连带重置其它设置。
  async function resetFloatPosition() {
    return (await engine.setSettings({ floatPosition: null })).saved;
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  function onBadgeClick(event) {
    event.preventDefault();
    if (suppressToggle) return;
    togglePanel();
  }

  function onDocumentPointerDown(event) {
    if (!open) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (panelHost.contains(target) || badgeHost.contains(target)) return;
    if (snapshot.settings && snapshot.settings.panelPinned) return;
    closePanel();
  }

  function onDocumentKeyDown(event) {
    if (!open || event.key !== "Escape") return;
    // 钉住时 Esc 仍然关闭，避免浮层只能靠头部按钮收起。
    closePanel();
  }

  function onWindowResize() {
    ensureBadgeMounted();
    if (open) positionPanel();
    scheduleFloatPositionPersist();
  }

  // 窗口尺寸变化后把夹取结果写回存储（去抖）：下次启动或再次缩小窗口时坐标仍然有效。
  function scheduleFloatPositionPersist() {
    if (readDisplayMode() !== "float") return;
    if (floatPersistTimer) clearTimeout(floatPersistTimer);
    floatPersistTimer = setTimeout(() => {
      floatPersistTimer = 0;
      persistFloatPosition();
    }, FLOAT_PERSIST_DEBOUNCE_MS);
  }

  // 徽标未挂载或处于 display:none 时量不到尺寸，此时不能判断坐标是否越界。
  function badgeMeasurable() {
    const rect = badgeHost.getBoundingClientRect();
    return rect.width > 0 || badgeHost.offsetWidth > 0;
  }

  function persistFloatPosition() {
    if (disposed || readDisplayMode() !== "float") return;
    const position = snapshot.settings && snapshot.settings.floatPosition;
    if (!position || !Number.isFinite(position.left) || !Number.isFinite(position.top)) return;
    // 量不到尺寸时保留原坐标，留到下次 resize 再夹取，避免误判为完全越界。
    if (!badgeMeasurable()) return;
    const fitted = fitFloatPosition(position);
    if (!fitted) {
      // 完全越界：清掉失效坐标，让默认位成为持久状态。
      engine.setSettings({ floatPosition: null }).catch(() => {});
      return;
    }
    if (fitted.left === Math.round(position.left) && fitted.top === Math.round(position.top)) return;
    engine.setSettings({ floatPosition: fitted }).catch(() => {});
  }

  /* ------------------------------ 悬浮拖动 ------------------------------ */

  function removeDragListeners() {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
    window.removeEventListener("blur", onDragEnd);
  }

  function onDragMove(event) {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      // 默认位置是 CSS transform 居中：先换成等价的 left/top，拖动与松手时才不会跳位。
      badgeHost.style.transform = "none";
      badgeHost.style.left = `${Math.round(drag.left)}px`;
      badgeHost.style.top = `${Math.round(drag.top)}px`;
      badgeHost.style.right = "auto";
      badgeHost.style.bottom = "auto";
      badgeHost.classList.add("is-dragging");
    }
    const left = clamp(
      drag.left + dx,
      VIEWPORT_GUTTER,
      Math.max(VIEWPORT_GUTTER, window.innerWidth - drag.width - VIEWPORT_GUTTER),
    );
    const top = clamp(
      drag.top + dy,
      VIEWPORT_GUTTER,
      Math.max(VIEWPORT_GUTTER, window.innerHeight - drag.height - VIEWPORT_GUTTER),
    );
    badgeHost.style.left = `${Math.round(left)}px`;
    badgeHost.style.top = `${Math.round(top)}px`;
    badgeHost.style.right = "auto";
    badgeHost.style.bottom = "auto";
    if (open) positionPanel();
  }

  function onDragEnd() {
    removeDragListeners();
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    badgeHost.classList.remove("is-dragging");
    if (!moved) return;
    // 拖动结束时浏览器仍会派发一次 click：吞掉它，避免拖完顺手把浮层打开。
    suppressToggle = true;
    if (suppressTimer) clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => {
      suppressToggle = false;
      suppressTimer = 0;
    }, 0);
    const rect = badgeHost.getBoundingClientRect();
    engine
      .setSettings({
        floatPosition: { left: Math.round(rect.left), top: Math.round(rect.top) },
      })
      .catch(() => {});
  }

  function onBadgePointerDown(event) {
    if (readDisplayMode() !== "float") return;
    if (typeof event.button === "number" && event.button !== 0) return;
    const rect = badgeHost.getBoundingClientRect();
    drag = {
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", onDragEnd);
    window.addEventListener("blur", onDragEnd);
  }

  /* ------------------------------ 挂载与补挂 ------------------------------ */

  function ensureBadgeMounted() {
    const parent = badgeParentOf(readDisplayMode());
    if (!parent) return;
    if (!document.contains(badgeHost) || badgeHost.parentElement !== parent) {
      parent.append(badgeHost);
    }
    applyDisplayMode();
  }

  function isBadgeMounted() {
    const parent = badgeParentOf(readDisplayMode());
    return Boolean(parent) && badgeHost.parentElement === parent && document.contains(badgeHost);
  }

  function scheduleMountRetry() {
    if (mountRetry || disposed) return;
    if (mountAttempts >= MOUNT_RETRY_LIMIT) return;
    mountRetry = setTimeout(() => {
      mountRetry = 0;
      mountAttempts += 1;
      if (disposed) return;
      ensureBadgeMounted();
      retargetObserver();
      if (!isBadgeMounted()) scheduleMountRetry();
    }, MOUNT_RETRY_MS);
  }

  const badgeObserver = new MutationObserver(() => scheduleEnsure());
  const bodyObserver = new MutationObserver(() => {
    if (!document.body.contains(panelHost)) document.body.append(panelHost);
    if (readDisplayMode() === "float" && !document.body.contains(badgeHost)) {
      document.body.append(badgeHost);
    }
  });

  function scheduleEnsure() {
    if (observeTimer) return;
    observeTimer = setTimeout(() => {
      observeTimer = 0;
      // 锚点自身被宿主替换时，旧 observer 不再有事件：每次补挂前先校正观察目标。
      retargetObserver();
      ensureBadgeMounted();
    }, REMOUNT_DEBOUNCE_MS);
  }

  // 只观察 topbar 锚点子树：观察整个 body 会被聊天流式输出与浮层自身渲染噪声打爆。
  function retargetObserver() {
    const anchor = findAnchor();
    if (!anchor) {
      if (observedAnchor) {
        badgeObserver.disconnect();
        observedAnchor = null;
      }
      return;
    }
    if (anchor === observedAnchor) return;
    observedAnchor = anchor;
    badgeObserver.disconnect();
    badgeObserver.observe(anchor, { childList: true, subtree: true });
    scheduleEnsure();
  }

  /* ------------------------------ 引擎订阅与宿主事件 ------------------------------ */

  function onState(next) {
    snapshot = next;
    renderBadge();
    applyDisplayMode();
    if (open) {
      renderPanel();
      positionPanel();
    }
  }

  const unsubscribe = engine.subscribe(onState);

  function scheduleStreamRefresh() {
    if (streamTimer) clearTimeout(streamTimer);
    streamTimer = setTimeout(() => {
      streamTimer = 0;
      if (disposed) return;
      // 流式结束同样是自动触发：去抖后走受节流刷新，避免多会话结束时各自强制查询用量库。
      engine.refresh().catch(() => {});
    }, STREAM_REFRESH_DELAY_MS);
  }

  function onContext() {
    const locale = currentLocale();
    if (locale !== lastLocale) {
      lastLocale = locale;
      renderBadge();
      if (open) renderPanel();
    }
    retargetObserver();
    ensureBadgeMounted();
    const viewId = currentViewId();
    if (open && viewId !== lastViewId) {
      lastViewId = viewId;
      positionPanel();
    }
  }

  badgeButton.addEventListener("click", onBadgeClick);
  badgeButton.addEventListener("pointerdown", onBadgePointerDown);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeyDown, true);
  window.addEventListener("resize", onWindowResize);

  try {
    snow.on("stream-end", scheduleStreamRefresh);
    snow.on("context", onContext);
  } catch {
    // 事件订阅失败时仍保留手动刷新。
  }

  bodyObserver.observe(document.body, { childList: true });
  ensureBadgeMounted();
  retargetObserver();
  scheduleMountRetry();
  renderBadge();
  applyDisplayMode();

  engine.init().catch((error) => {
    log("[Token 用量仪表] 初始化失败", error);
  });

  /* ------------------------------ 清理 ------------------------------ */

  // 每个释放步骤单独保护：任何一步抛错都不能中断后续清理，节点移除必须落在 finally 里。
  function runCleanupStep(label, step) {
    try {
      step();
    } catch (error) {
      log(`[Token 用量仪表] 清理失败：${label}`, error);
    }
  }

  try {
    snow.onCleanup(() => {
      disposed = true;
      try {
        runCleanupStep("timers", () => {
          clearTimeout(observeTimer);
          clearTimeout(streamTimer);
          clearTimeout(suppressTimer);
          clearTimeout(mountRetry);
          clearTimeout(floatPersistTimer);
          observeTimer = 0;
          streamTimer = 0;
          suppressTimer = 0;
          mountRetry = 0;
          floatPersistTimer = 0;
        });
        // observer 必须最先断开：否则节点被移除后会被 bodyObserver 重新挂回 body。
        runCleanupStep("observers", () => {
          badgeObserver.disconnect();
          bodyObserver.disconnect();
        });
        observedAnchor = null;
        runCleanupStep("drag", removeDragListeners);
        drag = null;
        runCleanupStep("window-listeners", () => {
          window.removeEventListener("resize", onWindowResize);
          document.removeEventListener("pointerdown", onDocumentPointerDown, true);
          document.removeEventListener("keydown", onDocumentKeyDown, true);
        });
        runCleanupStep("badge-listeners", () => {
          badgeButton.removeEventListener("click", onBadgeClick);
          badgeButton.removeEventListener("pointerdown", onBadgePointerDown);
        });
        runCleanupStep("unsubscribe", unsubscribe);
      } finally {
        // 先摘节点再卸载 Preact：即使卸载抛错，界面上也不会残留不可用节点。
        runCleanupStep("panel-host", () => panelHost.remove());
        runCleanupStep("badge-host", () => badgeHost.remove());
        runCleanupStep("render-null", () => render(null, panelHost));
        runCleanupStep("engine", () => engine.dispose());
        runCleanupStep("style", () => {
          if (injectedStyle) injectedStyle.remove();
        });
      }
    });
  } catch (error) {
    log("[Token 用量仪表] 注册清理回调失败", error);
  }
}

mount();
