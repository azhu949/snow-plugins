// 客户端脚本入口：注入样式、初始化引擎、挂载悬浮胶囊（或顶栏徽标）与浮层。
// 脚本插件没有面板容器，界面由脚本自建：顶栏形态把徽标挂在 topbar.actions 插槽，
// 悬浮形态直接挂到 body —— 顶栏卡片的 backdrop-filter 会成为 fixed 的包含块，
// 使按视口坐标算出的 left/top 被当成卡片内坐标，默认位与拖动都会错位。
// 浮层挂在 body 下的独立 Preact root，关闭时只隐藏不卸载。
import { h, render } from "preact";
import { STORAGE_KEYS } from "../constants.js";
import { createEngine } from "../engine.js";
import { createT } from "../i18n.js";
import MeterPanel, { requestLeave } from "../ui/meter-panel.js";
import { iconMarkup } from "../ui/icons.js";
import { formatAgo, formatCost, formatCostPair, formatExactTokens, formatPercent, withFxRate } from "../ui/format.js";
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
// 胶囊动效时长：必须与 style.css 的过渡时间一致，脚本只用它安排收尾与清理。
const MORPH_OPEN_MS = 240;
const MORPH_CLOSE_MS = 170;
const BADGE_PULSE_MS = 480;
// 徽标悬停浮层：宽度、间距与出现延迟。浮层挂在 body 下，用 fixed 视口坐标。
const BADGE_TIP_WIDTH = 300;
const BADGE_TIP_GAP = 6;
const BADGE_TIP_MARGIN = 8;
const BADGE_TIP_MIN_SPACE = 220;
const BADGE_TIP_DELAY = 110;
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
    // 扫描光层：只做视觉，不参与布局与命中，状态由宿主类名驱动。
    '<span class="tm-badge-sheen" aria-hidden="true"></span>',
    '<span class="tm-badge-dot" aria-hidden="true"></span>',
  ].join("");

  host.append(button);

  // 徽标悬停浮层与徽标同级挂在 body 下：fixed 定位不受顶栏插槽的 transform /
  // backdrop-filter 影响，也不占用插槽布局。文本一律转义后写入。
  const tip = document.createElement("div");
  tip.className = "tm-badge-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);

  return {
    host,
    button,
    tip,
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
  // 徽标浮层的显示状态与延迟计时器：与徽标同生命周期。
  let badgeTipTimer = 0;
  let badgeTipVisible = false;
  // 胶囊动效：开合 morph 的收尾计时器与数值脉冲计时器，全部在 cleanup 里清掉。
  let morphTimer = 0;
  let closeTimer = 0;
  const pulseTimers = { tokens: 0, cost: 0 };
  let lastTokensValue = null;
  let lastCostText = "";
  let streaming = false;
  let observedAnchor = null;
  let disposed = false;

  // 系统级「减少动态效果」：morph 直接跳过，不与用户偏好对抗。
  function prefersReducedMotion() {
    try {
      return (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    } catch {
      return false;
    }
  }

  // 宿主 context 是流式状态的唯一真相：stream-start / stream-end 只是即时通知，
  // 脚本补挂或视图重建后仍要能从 context 取回当前状态。
  function readStreaming() {
    try {
      return Boolean(snow.context && snow.context.isStreaming);
    } catch {
      return false;
    }
  }

  function setStreaming(next) {
    const value = Boolean(next);
    if (streaming === value) return;
    streaming = value;
    badgeHost.classList.toggle("is-streaming", value);
  }

  // 数值脉冲：移除类 → 强制一次重排 → 再加回，同一动画可以连续重放。
  // 只动已存在的节点，textContent 始终是单一新值，读文本的逻辑不受影响。
  function pulseValue(element, key) {
    if (!element) return;
    element.classList.remove("is-bump");
    void element.offsetWidth;
    element.classList.add("is-bump");
    if (pulseTimers[key]) clearTimeout(pulseTimers[key]);
    pulseTimers[key] = setTimeout(() => {
      pulseTimers[key] = 0;
      element.classList.remove("is-bump");
    }, BADGE_PULSE_MS);
  }

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

  // 徽标浮层里的价格同步值：只给时间 / 失败状态，标签由排版层提供。
  function catalogValue() {
    const catalog = snapshot.catalog || {};
    if (catalog.error) return t("tm.badge.tip.failed");
    if (!catalog.fetchedAt) return t("tm.catalog.missing");
    const base = formatAgo(catalog.fetchedAt, t);
    return catalog.stale ? `${base} · ${t("tm.catalog.cached")}` : base;
  }

  // 汇率值：自动模式给「汇率 · 同步于」，手动模式只给手填数值。
  function fxValue() {
    const settings = snapshot.settings || {};
    if (settings.fxMode !== "auto") return Number(settings.fxRate).toFixed(4);
    const fx = snapshot.fx || {};
    if (!fx.rate) return fx.error ? t("tm.fx.error", { message: fx.error }) : t("tm.fx.missing");
    const base = t("tm.badge.tip.fxValue", {
      rate: fx.rate.toFixed(4),
      value: formatAgo(fx.fetchedAt, t),
    });
    return fx.error || fx.stale ? `${base} · ${t("tm.fx.cached")}` : base;
  }

  // 金额下限前缀：未计价 token 或档位 / 1h 区间都会让 totalUsd 只是下界。
  function boundPrefix(cost) {
    return cost && cost.isLowerBound ? t("tm.cost.boundPrefix") : "";
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
    if (cost && cost.totalTokens > 0) {
      // 告警用 rowCoverage（分子分母同源）：coverage 的分母取 summary，两次查询不同快照时会假告警。
      const ratio = Number.isFinite(cost.rowCoverage) ? cost.rowCoverage : cost.coverage;
      if (ratio < COVERAGE_WARN) {
        list.push(t("tm.warn.coverage", { percent: formatPercent(ratio) }));
      }
      if (cost.isLowerBound) list.push(t("tm.warn.lowerBound"));
    }
    return list;
  }

  // 徽标悬停浮层：标签与值分开，排版交给 CSS 两列网格；数字统一等宽。
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function badgeTipData() {
    const settings = withFxRate(snapshot.settings || {}, snapshot.fx);
    const totalMode = settings.badgeStyle === "total";
    const main = totalMode ? snapshot.allTime : snapshot.today;
    const other = totalMode ? snapshot.today : snapshot.allTime;
    const summary = main ? main.summary : null;
    const cost = main ? main.cost : null;
    const otherSummary = other ? other.summary : null;
    const otherCost = other ? other.cost : null;
    const pair = formatCostPair(cost ? cost.totalUsd : 0, settings);
    const data = {
      label: t(totalMode ? "tm.badge.total" : "tm.badge.today"),
      tokens: summary ? compactTokens(summary.totalTokens) : t("tm.badge.empty"),
      unit: summary ? t("tm.badge.tip.unit") : "",
      cost: summary ? `${boundPrefix(cost)}${pair.primary}` : "",
      alt: summary ? t("tm.value.approx", { value: pair.alt }) : "",
      rows: [],
      other: null,
      meta: [],
      warnings: badgeWarnings(),
      hint: t("tm.badge.tip.hint"),
    };
    if (summary) {
      data.rows.push(
        { label: t("tm.badge.tip.input"), value: compactTokens(summary.totalInputTokens) },
        { label: t("tm.badge.tip.output"), value: compactTokens(summary.totalOutputTokens) },
        { label: t("tm.badge.tip.cacheRead"), value: compactTokens(summary.totalCacheReadInputTokens) },
        { label: t("tm.badge.tip.requests"), value: formatExactTokens(summary.totalRequests) },
      );
    }
    const otherLabel = t(totalMode ? "tm.badge.today" : "tm.badge.total");
    if (otherSummary) {
      const otherPair = formatCostPair(otherCost ? otherCost.totalUsd : 0, settings);
      data.other = {
        label: otherLabel,
        value: `${compactTokens(otherSummary.totalTokens)} ${t("tm.badge.tip.unit")} · ${boundPrefix(otherCost)}${otherPair.primary}`,
      };
    } else {
      data.other = { label: otherLabel, value: t("tm.badge.empty") };
    }
    data.meta.push(
      { label: t("tm.badge.tip.mode"), value: cost ? modeLabelOf(cost) : t("tm.badge.empty") },
      { label: t("tm.badge.tip.pricing"), value: catalogValue() },
      { label: t("tm.badge.tip.fx"), value: fxValue() },
    );
    return data;
  }

  function renderBadgeTip() {
    const data = badgeTipData();
    const parts = [
      `<div class="tm-tip-head"><span class="tm-tip-label">${escapeHtml(data.label)}</span><span class="tm-tip-tokens">${escapeHtml(data.tokens)}${
        data.unit ? `<span class="tm-tip-unit">${escapeHtml(data.unit)}</span>` : ""
      }</span></div>`,
    ];
    if (data.cost) {
      parts.push(
        `<div class="tm-tip-cost"><span class="tm-tip-cost-main">${escapeHtml(data.cost)}</span><span class="tm-tip-cost-alt">${escapeHtml(data.alt)}</span></div>`,
      );
    }
    if (data.rows.length) {
      parts.push(
        `<div class="tm-tip-grid">${data.rows
          .map(
            (row) =>
              `<span class="tm-tip-key">${escapeHtml(row.label)}</span><span class="tm-tip-val">${escapeHtml(row.value)}</span>`,
          )
          .join("")}</div>`,
      );
    }
    if (data.other) {
      parts.push(
        `<div class="tm-tip-sep"></div><div class="tm-tip-grid"><span class="tm-tip-key">${escapeHtml(data.other.label)}</span><span class="tm-tip-val">${escapeHtml(data.other.value)}</span></div>`,
      );
    }
    parts.push(
      `<div class="tm-tip-sep"></div><div class="tm-tip-grid">${data.meta
        .map(
          (row) =>
            `<span class="tm-tip-key">${escapeHtml(row.label)}</span><span class="tm-tip-val">${escapeHtml(row.value)}</span>`,
        )
        .join("")}</div>`,
    );
    if (data.warnings.length) {
      parts.push(
        `<div class="tm-tip-warn"><div class="tm-tip-warn-title">${escapeHtml(t("tm.badge.tip.warn"))}</div>${data.warnings
          .map((warn) => `<div>${escapeHtml(warn)}</div>`)
          .join("")}</div>`,
      );
    }
    parts.push(`<div class="tm-tip-hint">${escapeHtml(data.hint)}</div>`);
    badge.tip.innerHTML = parts.join("");
  }

  function positionBadgeTip() {
    const rect = badgeHost.getBoundingClientRect();
    const width = Math.min(BADGE_TIP_WIDTH, window.innerWidth - BADGE_TIP_MARGIN * 2);
    const maxLeft = Math.max(BADGE_TIP_MARGIN, window.innerWidth - width - BADGE_TIP_MARGIN);
    const left = Math.min(Math.max(rect.left, BADGE_TIP_MARGIN), maxLeft);
    badge.tip.style.left = `${Math.round(left)}px`;
    badge.tip.style.width = `${Math.round(width)}px`;
    // 宽度落定后再量高度：换行行数取决于宽度，先量会低估。
    const height = badge.tip.offsetHeight || BADGE_TIP_MIN_SPACE;
    const needed = Math.max(height + BADGE_TIP_GAP + BADGE_TIP_MARGIN, BADGE_TIP_MIN_SPACE);
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    const flip = below < needed && above > below;
    badge.tip.style.top = `${Math.round(flip ? rect.top - BADGE_TIP_GAP : rect.bottom + BADGE_TIP_GAP)}px`;
    badge.tip.classList.toggle("is-above", flip);
  }

  function showBadgeTip() {
    if (disposed || open || drag) return;
    if (badgeTipTimer) clearTimeout(badgeTipTimer);
    badgeTipTimer = setTimeout(() => {
      badgeTipTimer = 0;
      if (disposed || open || drag) return;
      renderBadgeTip();
      // 先占位显示再量高度：hidden 时 display:none 量不到尺寸；visibility 隐藏
      // 保留布局，定位完成后再显示，避免在旧坐标闪一帧。
      badge.tip.hidden = false;
      badge.tip.style.visibility = "hidden";
      positionBadgeTip();
      badge.tip.style.visibility = "";
      badgeTipVisible = true;
    }, BADGE_TIP_DELAY);
  }

  function hideBadgeTip() {
    if (badgeTipTimer) {
      clearTimeout(badgeTipTimer);
      badgeTipTimer = 0;
    }
    if (!badgeTipVisible) return;
    badgeTipVisible = false;
    badge.tip.hidden = true;
  }

  function modeLabelOf(cost) {
    return t(cost && cost.mode === "precise" ? "tm.cost.mode.precise" : "tm.cost.mode.aggregate");
  }

  function renderBadge() {
    const settings = withFxRate(snapshot.settings || {}, snapshot.fx);
    const range = settings.badgeStyle === "total" ? snapshot.allTime : snapshot.today;
    const summary = range ? range.summary : null;
    const cost = range ? range.cost : null;
    const ready = Boolean(summary);
    const tokensText = ready ? compactTokens(summary.totalTokens) : t("tm.badge.empty");
    const costText = ready
      ? `${boundPrefix(cost)}${formatCost(cost ? cost.totalUsd : 0, settings)}`
      : t("tm.badge.empty");

    badge.tokens.textContent = tokensText;
    badge.cost.textContent = costText;

    // 首屏与口径切换不算「新数据」：只有已知旧值确实变化时才播放脉冲，避免启动即闪。
    const tokenValue = ready && Number.isFinite(summary.totalTokens) ? summary.totalTokens : null;
    const tokensChanged =
      tokenValue !== null && lastTokensValue !== null && tokenValue !== lastTokensValue;
    const costChanged = ready && lastCostText !== "" && costText !== lastCostText;
    if (tokensChanged) pulseValue(badge.tokens, "tokens");
    if (costChanged) pulseValue(badge.cost, "cost");
    lastTokensValue = tokenValue;
    lastCostText = costText;

    const warnings = badgeWarnings();
    if (badgeTipVisible) {
      renderBadgeTip();
      positionBadgeTip();
    }
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
      onClearPrices: clearCustomPrices,
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

  /* ------------------------------ 胶囊 morph ------------------------------ */

  // 起始几何：水平原点落在胶囊中心（相对面板宽度的百分比），纵向把面板顶部
  // 拉到胶囊顶部。必须在自然态下测量，transform 会污染 getBoundingClientRect。
  function morphGeometry() {
    const anchor = badgeHost.getBoundingClientRect();
    const panel = panelHost.getBoundingClientRect();
    if (!(panel.width > 0) || !(panel.height > 0)) return null;
    const centerX = anchor.left + anchor.width / 2;
    return {
      originX: `${(clamp((centerX - panel.left) / panel.width, 0, 1) * 100).toFixed(2)}%`,
      offsetY: Math.round(anchor.top - panel.top),
    };
  }

  function applyMorphVars(geometry) {
    panelHost.style.setProperty("--tm-morph-origin", geometry.originX);
    panelHost.style.setProperty("--tm-morph-y", `${geometry.offsetY}px`);
  }

  function clearMorphVars() {
    panelHost.style.removeProperty("--tm-morph-origin");
    panelHost.style.removeProperty("--tm-morph-y");
  }

  // 展开：起始帧写完先读一次布局，再切回自然态，浏览器才有一帧可以过渡。
  function playOpenMorph() {
    if (prefersReducedMotion()) return;
    const geometry = morphGeometry();
    if (!geometry) return;
    applyMorphVars(geometry);
    panelHost.classList.add("is-morph-in");
    void panelHost.offsetHeight;
    requestAnimationFrame(() => {
      if (disposed || !open) return;
      panelHost.classList.remove("is-morph-in");
    });
    if (morphTimer) clearTimeout(morphTimer);
    morphTimer = setTimeout(() => {
      morphTimer = 0;
      panelHost.classList.remove("is-morph-in");
    }, MORPH_OPEN_MS);
  }

  // 收起：量不到几何（未布局 / 减少动态）时零延迟隐藏，避免卡在收起中途。
  function playCloseMorph() {
    const finish = () => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = 0;
      }
      panelHost.classList.remove("is-morph-in", "is-morph-out");
      panelHost.classList.add("is-hidden");
      panelHost.removeAttribute("data-tm-open");
      clearMorphVars();
    };
    const geometry = prefersReducedMotion() ? null : morphGeometry();
    if (!geometry) {
      finish();
      return;
    }
    if (morphTimer) {
      clearTimeout(morphTimer);
      morphTimer = 0;
    }
    applyMorphVars(geometry);
    panelHost.classList.remove("is-morph-in");
    panelHost.classList.add("is-morph-out");
    closeTimer = setTimeout(() => {
      closeTimer = 0;
      if (open || disposed) return;
      finish();
    }, MORPH_CLOSE_MS);
  }

  function openPanel() {
    if (open || disposed) return;
    hideBadgeTip();
    open = true;
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = 0;
    }
    // 关闭动画中途重开：先复位到自然态，后面的定位与测量才是真实尺寸。
    panelHost.classList.remove("is-hidden", "is-morph-in", "is-morph-out");
    panelHost.setAttribute("data-tm-open", "1");
    badgeHost.classList.add("is-open");
    syncBadgeAria();
    renderPanel();
    positionPanel();
    playOpenMorph();
    // 打开浮层属于自动触发：走 10 秒节流，避免反复开关就发起多轮 metadata 请求。
    engine.refresh().catch(() => {
      // 引擎已把错误写入 state。
    });
  }

  function closePanel(options = {}) {
    if (!open) return;
    // 关闭前统一询问草稿守卫：X、Esc、外部点击与徽标 toggle 都收口在这里。
    // 确认后的回调带 skipLeaveGuard 再次进来，避免同一次关闭重复弹确认。
    if (!options.skipLeaveGuard && !requestLeave(() => closePanel({ skipLeaveGuard: true }))) return;
    open = false;
    badgeHost.classList.remove("is-open");
    view = { name: "main" };
    panelHost.setAttribute("data-tm-view", "main");
    syncBadgeAria();
    playCloseMorph();
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
        // 三个价格源各有一份缓存，一并清掉，避免切换来源后仍复用旧目录。
        // 只删目录键：自定义价与映射属于用户声明，不能被「清缓存」顺手清掉。
        GM_deleteValue(STORAGE_KEYS.catalog);
        GM_deleteValue(STORAGE_KEYS.catalogModelsDev);
        GM_deleteValue(STORAGE_KEYS.catalogLiteLLM);
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

  // 清空全部自定义价：只动价格键，映射、目录缓存与用量数据都保留（界面上是独立的两步确认）。
  async function clearCustomPrices() {
    return (await engine.clearCustomPrices()).saved;
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
    hideBadgeTip();
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
    hideBadgeTip();
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
    // 流式结束先熄掉活性光，数据刷新再等去抖窗口。
    setStreaming(false);
    if (streamTimer) clearTimeout(streamTimer);
    streamTimer = setTimeout(() => {
      streamTimer = 0;
      if (disposed) return;
      // 流式结束同样是自动触发：去抖后走受节流刷新，避免多会话结束时各自强制查询用量库。
      engine.refresh().catch(() => {});
    }, STREAM_REFRESH_DELAY_MS);
  }

  function onStreamStart() {
    setStreaming(true);
  }

  function onContext() {
    setStreaming(readStreaming());
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
  badgeButton.addEventListener("mouseenter", showBadgeTip);
  badgeButton.addEventListener("mouseleave", hideBadgeTip);
  badgeButton.addEventListener("focus", showBadgeTip);
  badgeButton.addEventListener("blur", hideBadgeTip);
  window.addEventListener("scroll", hideBadgeTip, true);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeyDown, true);
  window.addEventListener("resize", onWindowResize);

  try {
    snow.on("stream-start", onStreamStart);
    snow.on("stream-end", scheduleStreamRefresh);
    snow.on("context", onContext);
  } catch {
    // 事件订阅失败时仍保留手动刷新。
  }

  bodyObserver.observe(document.body, { childList: true });
  ensureBadgeMounted();
  retargetObserver();
  scheduleMountRetry();
  // 补挂时可能正处在流式中：context 是唯一可信来源，不依赖是否见过 stream-start。
  setStreaming(readStreaming());
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
          clearTimeout(badgeTipTimer);
          clearTimeout(morphTimer);
          clearTimeout(closeTimer);
          clearTimeout(pulseTimers.tokens);
          clearTimeout(pulseTimers.cost);
          observeTimer = 0;
          streamTimer = 0;
          suppressTimer = 0;
          mountRetry = 0;
          floatPersistTimer = 0;
          badgeTipTimer = 0;
          morphTimer = 0;
          closeTimer = 0;
          pulseTimers.tokens = 0;
          pulseTimers.cost = 0;
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
          window.removeEventListener("scroll", hideBadgeTip, true);
          document.removeEventListener("pointerdown", onDocumentPointerDown, true);
          document.removeEventListener("keydown", onDocumentKeyDown, true);
        });
        runCleanupStep("badge-listeners", () => {
          badgeButton.removeEventListener("click", onBadgeClick);
          badgeButton.removeEventListener("pointerdown", onBadgePointerDown);
          badgeButton.removeEventListener("mouseenter", showBadgeTip);
          badgeButton.removeEventListener("mouseleave", hideBadgeTip);
          badgeButton.removeEventListener("focus", showBadgeTip);
          badgeButton.removeEventListener("blur", hideBadgeTip);
        });
        runCleanupStep("unsubscribe", unsubscribe);
      } finally {
        // 先摘节点再卸载 Preact：即使卸载抛错，界面上也不会残留不可用节点。
        runCleanupStep("panel-host", () => panelHost.remove());
        runCleanupStep("badge-host", () => badgeHost.remove());
        runCleanupStep("badge-tip", () => badge.tip.remove());
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
