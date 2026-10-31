// 浮层主视图 / 设置视图 / 模型映射视图。
// 全部是纯展示组件：只接收 engine + state + t，不直接读取 snow 或 GM_*。
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { PRICE_MULTIPLIER, defaultPricingUrl } from "../constants.js";
import { mappingKey, mappingValueOf, matchModel } from "../match.js";
import { priceRecordOf } from "../prices.js";
import { Icon } from "./icons.js";
import {
  formatAgo,
  formatClockTime,
  formatCost,
  formatCostPair,
  formatCostRange,
  formatExactTokens,
  formatMoney,
  formatPercent,
  formatPerMillion,
  formatRatio,
  formatRecordTime,
  formatTokens,
  formatUsdRange,
  formatUsdValue,
  resolveCurrency,
  withFxRate,
} from "./format.js";

const MODEL_LIMIT = 50;
const CATALOG_LIMIT = 50;
const NOTICE_MS = 1800;
const CALC_HOVER_DELAY = 110;
const PERIOD_KEYS = ["today", "7d", "30d", "all"];
const REFRESH_OPTIONS = [30, 60, 120, 300];
const TTL_OPTIONS = [1, 6, 12, 24, 72, 168];
const PRECISE_OPTIONS = ["auto", "always", "off"];
const CACHE_TTL_OPTIONS = ["5m", "1h"];

// 自定义价草稿的离开守卫：MappingView 挂载时注册，Panel 的返回 / 设置与脚本层的关闭 /
// Esc / 外部点击统一经过这里询问。返回 false 表示已拦截（草稿未保存或正在保存），
// 未注册时视为可直接离开。
let leaveGuard = null;

export function setLeaveGuard(guard) {
  leaveGuard = typeof guard === "function" ? guard : null;
}

export function requestLeave(proceed) {
  if (!leaveGuard) return true;
  return leaveGuard(typeof proceed === "function" ? proceed : () => {}) !== false;
}

const STATUS_TONE = {
  exact: "ok",
  normalized: "ok",
  fuzzy: "warn",
  guess: "warn",
  manual: "info",
  provider: "ok",
  canonical: "ok",
  // 自定义价是用户声明的确定值：与手工映射同色调，且不共用猜测的 ≈ 后缀。
  custom: "info",
  unmatched: "warn",
  ignored: "muted",
};

// 计价模式的徽标色调：精算是实测结果，聚合是下限估计。
const MODE_TONE = { precise: "ok", aggregate: "muted" };

const ASSUMPTION_KEYS = {
  cacheWrite5m: "tm.cost.assume5m",
  cacheWrite1hAssumed: "tm.cost.assume1h",
  cacheWrite5mOnly: "tm.cost.assume5mOnly",
};

const UNESTIMATED_KEYS = {
  serviceTier: "tm.cost.unestimatedTier",
  imageTokens: "tm.cost.unestimatedImage",
  reasoningSplit: "tm.cost.unestimatedReasoning",
};

function statusLabel(t, status) {
  const key = `tm.status.${status}`;
  const label = t(key);
  return label === key ? String(status || "") : label;
}

function modeLabel(t, mode) {
  return t(mode === "precise" ? "tm.cost.mode.precise" : "tm.cost.mode.aggregate");
}

// 金额的语义（模式 / 区间 / 下限 / 假设 / 未估算维度 / 目录版本）统一进 title，界面不堆文字。
function costTitle(cost, settings, t) {
  if (!cost) return "";
  const lines = [t("tm.cost.modeTitle", { mode: modeLabel(t, cost.mode) })];
  const range = formatCostRange(cost.lowerUsd, cost.upperUsd, settings);
  if (range) lines.push(t("tm.cost.range", { range }));
  if (cost.isLowerBound) lines.push(t("tm.cost.lowerBoundHint"));
  const snapshot = formatRecordTime(cost.recordsSnapshotAt);
  if (cost.recordsStatus === "complete" && cost.recordsRows > 0) {
    lines.push(
      t("tm.cost.preciseRows", {
        count: formatExactTokens(cost.recordsRows),
        time: snapshot || "—",
      }),
    );
  }
  for (const key of cost.assumptions || []) {
    if (ASSUMPTION_KEYS[key]) lines.push(t(ASSUMPTION_KEYS[key]));
  }
  for (const key of cost.unestimated || []) {
    if (UNESTIMATED_KEYS[key]) lines.push(t(UNESTIMATED_KEYS[key]));
  }
  const pricedAt = formatClockTime(cost.pricedAt);
  if (pricedAt) lines.push(t("tm.cost.pricedAt", { time: pricedAt }));
  return lines.join("\n");
}

// 计算过程的数据形态：标签 / 算式 / 金额分开，自绘浮层才能按列对齐。
// 聚合行的 parts 就是「tokens × 下限向量单价」一次算出；精算行逐条计价，
// 只有全部请求同价时才给单价，否则只给 token 数与分项（分项是逐条小计之和）。
export function modelCalcData(row, settings, t) {
  if (!row) return null;
  const precise = row.mode === "precise";
  const data = {
    mode: precise ? "precise" : "aggregate",
    modeLabel: t(precise ? "tm.cost.mode.precise" : "tm.cost.mode.aggregate"),
    entry:
      row.entryName && row.entryName !== row.model
        ? t("tm.models.calcEntry", { entry: row.entryName })
        : "",
    lines: [],
    total: "",
    notes: [],
    empty: "",
    tokensText: "",
  };
  const tokenParts = row.tokenParts || null;
  if (!tokenParts) return data;
  if (row.status === "ignored") {
    data.empty = t("tm.models.calcIgnored");
    return data;
  }
  const price = row.price || null;
  const mixed = Boolean(row.priceMixed);
  if (!price && !mixed) {
    data.empty = t("tm.models.calcUnpriced");
    data.tokensText = t("tm.models.calcTokens", {
      input: formatExactTokens(tokenParts.input),
      cacheRead: formatExactTokens(tokenParts.cacheRead),
      cacheWrite: formatExactTokens(tokenParts.cacheWrite),
      output: formatExactTokens(tokenParts.output),
    });
    return data;
  }
  const parts = row.parts || {};
  const has1h = price ? price.cacheWrite1h !== null && price.cacheWrite1h !== undefined : false;
  const writePrice = price && row.writeTtl === "1h" && has1h ? price.cacheWrite1h : price?.cacheWrite;
  const push = (label, count, unitPrice, partUsd) => {
    data.lines.push({
      label,
      formula: mixed
        ? formatExactTokens(count)
        : t("tm.models.calcFormula", {
            tokens: formatExactTokens(count),
            price: formatPerMillion(unitPrice),
          }),
      value: formatUsdValue(partUsd),
      approx: precise && !mixed,
    });
  };
  if (tokenParts.input > 0) {
    push(t("tm.models.calcNonCached"), tokenParts.input, price?.prompt, parts.input);
  }
  if (tokenParts.cacheRead > 0) {
    push(t("tm.price.cacheRead"), tokenParts.cacheRead, price?.cacheRead, parts.cacheRead);
  }
  if (tokenParts.cacheWrite > 0) {
    push(t("tm.price.cacheWrite"), tokenParts.cacheWrite, writePrice, parts.cacheWrite);
  }
  if (tokenParts.output > 0) {
    push(t("tm.price.output"), tokenParts.output, price?.completion, parts.output);
  }
  if ((parts.request || 0) > 0) {
    data.lines.push({
      label: t("tm.models.calcRequestLabel"),
      formula: t("tm.models.calcRequestFormula", {
        count: formatExactTokens(Math.max(0, (row.requests || 0) - (row.errorRequests || 0))),
      }),
      value: formatUsdValue(parts.request),
      approx: false,
    });
  }
  data.total = formatUsdValue(row.costUsd);
  if (resolveCurrency(settings) !== "USD") {
    data.notes.push(t("tm.models.calcDisplay", { value: formatMoney(row.costUsd, settings) }));
  }
  const range = formatUsdRange(row.costUsd, row.upperUsd);
  if (range) data.notes.push(t("tm.models.calcRange", { range }));
  if (row.tierAbove !== null && row.tierAbove !== undefined) {
    data.notes.push(t("tm.cost.tierTitle", { above: formatExactTokens(row.tierAbove) }));
  }
  if (row.writeTtl === "1h") data.notes.push(t("tm.models.calc1h"));
  if (mixed) data.notes.push(t("tm.models.calcMixedNote"));
  return data;
}

const TIP_WIDTH = 340;
const TIP_GAP = 6;
const TIP_MARGIN = 8;
const TIP_MIN_SPACE = 220;

// 悬停位置：优先放行下方，下方空间不足时翻到上方（CSS 用 translateY(-100%) 贴住行顶），
// 水平与行左对齐并按视口夹取。坐标是视口坐标（fixed），不会被浮层的滚动容器裁掉。
export function calcTipAnchor(rect) {
  const width = Math.min(TIP_WIDTH, window.innerWidth - TIP_MARGIN * 2);
  const maxLeft = Math.max(TIP_MARGIN, window.innerWidth - width - TIP_MARGIN);
  const left = Math.min(Math.max(rect.left, TIP_MARGIN), maxLeft);
  const below = window.innerHeight - rect.bottom;
  const above = rect.top;
  const flip = below < TIP_MIN_SPACE && above > below;
  return {
    left: Math.round(left),
    top: Math.round(flip ? rect.top - TIP_GAP : rect.bottom + TIP_GAP),
    width: Math.round(width),
    flip,
  };
}

// 自绘计算过程浮层：固定定位、不接收指针事件，悬停行时出现，移出即消失。
function CalcTip({ data, anchor, t }) {
  return h(
    "div",
    {
      class: `tm-calc-tip${anchor.flip ? " is-above" : ""}`,
      role: "tooltip",
      style: {
        left: `${anchor.left}px`,
        top: `${anchor.top}px`,
        width: `${anchor.width}px`,
      },
    },
    h(
      "div",
      { class: "tm-calc-head" },
      h("span", { class: "tm-calc-heading" }, t("tm.models.calcHead")),
      h("span", { class: `tm-pill is-${MODE_TONE[data.mode] || "muted"}` }, data.modeLabel),
    ),
    data.entry ? h("div", { class: "tm-calc-entry" }, data.entry) : null,
    data.empty ? h("div", { class: "tm-calc-empty" }, data.empty) : null,
    data.tokensText ? h("div", { class: "tm-calc-mono" }, data.tokensText) : null,
    data.lines.length
      ? h(
          "div",
          { class: "tm-calc-grid" },
          data.lines.flatMap((line) => [
            h("span", { class: "tm-calc-label", key: `${line.label}-l` }, line.label),
            h("span", { class: "tm-calc-formula", key: `${line.label}-f` }, line.formula),
            h(
              "span",
              { class: "tm-calc-value", key: `${line.label}-v` },
              line.approx ? t("tm.value.approx", { value: line.value }) : line.value,
            ),
          ]),
        )
      : null,
    data.total
      ? h(
          "div",
          { class: "tm-calc-total" },
          h("span", { class: "tm-calc-label" }, t("tm.models.calcTotalLabel")),
          h("span", { class: "tm-calc-total-value" }, data.total),
        )
      : null,
    data.notes.length
      ? h(
          "div",
          { class: "tm-calc-notes" },
          data.notes.map((note, index) => h("div", { class: "tm-calc-note", key: index }, note)),
        )
      : null,
  );
}

// records 状态说明：只在「与聚合有关」的状态上出现，避免把正常精算也写成告警。
// recordsRows 是「采集到的行数」：mismatch 时行已取到但与汇总 Token 不符，因此不再参与计价。
function recordsNote(cost, t) {
  if (!cost) return null;
  const status = cost.recordsStatus;
  let note = "";
  if (status === "truncated") {
    // 截断可能来自页数 / 行数上限、预算用尽或翻页失败：只说「取到多少行」，不假称具体原因。
    note = t("tm.cost.truncated", { rows: formatExactTokens(cost.recordsRows || 0) });
  } else if (status === "mismatch") {
    note = t("tm.cost.mismatch", { rows: formatExactTokens(cost.recordsRows || 0) });
  } else if (status === "partial-no-tier") {
    note = t("tm.cost.partialNoTier");
  } else if (status === "no-records") {
    note = t("tm.cost.noRecords");
  } else if (status === "off") {
    note = t("tm.cost.recordsOff");
  }
  // 逐条数据里出现的模型多于 models 汇总（并发新增模型行）：提示但不降级计价。
  const extra = Number(cost.recordsExtraModels) || 0;
  if (extra > 0) {
    const extraText = t("tm.cost.extraModels", { count: formatExactTokens(extra) });
    note = note ? `${note} · ${extraText}` : extraText;
  }
  return note;
}

function periodLabel(t, key) {
  return t(`tm.period.${key}`);
}

// 汇率状态：自动模式显示实际汇率与同步时间，手动模式显示手填值。
function fxStatusText(state, t) {
  const settings = state.settings || {};
  if (settings.fxMode === "manual") {
    return t("tm.fx.manual", { rate: Number(settings.fxRate).toFixed(4) });
  }
  const fx = state.fx || {};
  if (!fx.rate) return fx.error ? t("tm.fx.error", { message: fx.error }) : t("tm.fx.missing");
  const base = t("tm.fx.synced", { rate: fx.rate.toFixed(4), value: formatAgo(fx.fetchedAt, t) });
  return fx.error || fx.stale ? `${base} · ${t("tm.fx.cached")}` : base;
}

// 当前选中的区间：engine 在 periodKey 为 today / all 时把 period 指向对应区间。
function activeRange(state) {
  return state.period || state.today;
}

// 选中区间的目标周期：切换后、刷新返回前必须以它为准，不能继续展示上一周期的数字。
function periodKeyOf(state) {
  return state.periodKey || state.period?.key || state.settings?.period || "today";
}

// ready 只由 summary 判定：null 表示还没成功取到数据，零值 summary 对象代表区间确实没有用量。
function rangeOf(state) {
  const key = periodKeyOf(state);
  const range = activeRange(state);
  if (!range || range.key !== key) return { key, range: null, ready: false };
  return { key, range, ready: Boolean(range.summary) };
}

function findModelRow(state, model) {
  for (const range of [state.period, state.today, state.allTime]) {
    const row = range?.cost?.byModel?.find((item) => item.model === model);
    if (row) return row;
  }
  return null;
}

function catalogEntries(state) {
  const models = state.catalog?.models;
  return Array.isArray(models) ? models : [];
}

// 自定义价编辑区的四个 token 单价字段（USD / 1M token）：按次费、档位与 1 小时价只走导入。
// entryField 是目录条目上的同义字段名（input / output → prompt / completion）。
const PRICE_INPUTS = Object.freeze([
  { field: "input", entryField: "prompt", labelKey: "tm.price.input" },
  { field: "output", entryField: "completion", labelKey: "tm.price.output" },
  { field: "cacheRead", entryField: "cacheRead", labelKey: "tm.price.cacheRead" },
  { field: "cacheWrite", entryField: "cacheWrite", labelKey: "tm.price.cacheWrite" },
]);

// USD/token → USD/1M 的展示值（界面与存储同单位，这里只做换算并去掉浮点尾差）。
function perMillionText(usdPerToken) {
  const number = Number(usdPerToken);
  if (usdPerToken === null || usdPerToken === undefined || !Number.isFinite(number)) return "";
  return String(Math.round(number * 1e12) / 1e6);
}

// 输入草稿一律用字符串保存："" 表示继承（null），"0" 表示显式免费，两者在界面上必须可区分。
function priceDraftOf(record) {
  const text = (value) => (value === null || value === undefined ? "" : String(value));
  return {
    input: text(record?.input),
    output: text(record?.output),
    cacheRead: text(record?.cacheRead),
    cacheWrite: text(record?.cacheWrite),
    multiplier: record?.multiplier === undefined ? "1" : String(record.multiplier),
    note: record?.note || "",
  };
}

// 空串 = null（继承）；非数字或负数返回 NaN，由调用方提示「价格必须是大于等于 0 的数字」。
function readPriceNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : Number.NaN;
}

// 倍率与四个价字段的语义不同：0 不是免费，越界必须在保存前拦截，而不是交给引擎静默夹取。
// 空值按记录默认值 1 处理（与 priceMultiplierOf 一致）。
function readMultiplierDraft(value) {
  const text = String(value ?? "").trim();
  if (!text) return { value: 1 };
  const number = Number(text);
  if (!Number.isFinite(number)) return { invalid: true };
  if (number < PRICE_MULTIPLIER.min || number > PRICE_MULTIPLIER.max) {
    return { outOfRange: true };
  }
  return { value: number };
}

function Money({ usd, settings, t, bound = false, title }) {
  const pair = formatCostPair(usd, settings);
  return h(
    "span",
    { class: "tm-money", title: title || undefined },
    h(
      "span",
      { class: "tm-money-main" },
      bound ? `${t("tm.cost.boundPrefix")}${pair.primary}` : pair.primary,
    ),
    h("span", { class: "tm-money-alt" }, t("tm.value.approx", { value: pair.alt })),
  );
}

function Header({ t, state, view, onBack, onTogglePin, onOpenSettings, onClose }) {
  const catalog = state.catalog || {};
  let statusTone = "ok";
  let statusText = t("tm.catalog.missing");
  let statusTitle = statusText;
  if (catalog.error) {
    statusTone = "warn";
    statusText = t("tm.catalog.error", { message: catalog.error });
    statusTitle = statusText;
  } else if (catalog.fetchedAt) {
    statusText = t("tm.catalog.synced", { value: formatAgo(catalog.fetchedAt, t) });
    statusTitle = statusText;
    if (catalog.stale) {
      statusTone = "warn";
      statusText = `${statusText} · ${t("tm.catalog.cached")}`;
      statusTitle = `${statusTitle}\n${t("tm.warn.stale")}`;
    }
  }

  // 汇率同步信息跟在价格同步右侧，同一行展示。
  const fxLine = fxStatusText(state, t);
  const statusLine = `${statusText} · ${fxLine}`;
  const statusLineTitle = `${statusTitle}\n${fxLine}`;

  const title =
    view.name === "settings"
      ? t("tm.settings.title")
      : view.name === "mapping"
        ? t("tm.mapping.title")
        : t("tm.panel.title");
  const pinned = Boolean(state.settings?.panelPinned);

  return h(
    "header",
    { class: "tm-head" },
    view.name === "main"
      ? null
      : h(
          "button",
          {
            type: "button",
            class: "tm-icon-btn",
            "data-tm-action": "back",
            title: t("tm.panel.back"),
            "aria-label": t("tm.panel.back"),
            onClick: onBack,
          },
          h(Icon, { name: "ChevronLeft", size: 14 }),
        ),
    h(
      "div",
      { class: "tm-head-main" },
      h("div", { class: "tm-title" }, title),
      h("div", { class: `tm-sub tm-status is-${statusTone}`, title: statusLineTitle }, statusLine),
    ),
    h(
      "div",
      { class: "tm-head-actions" },
      h(
        "button",
        {
          type: "button",
          class: `tm-icon-btn${pinned ? " is-active" : ""}`,
          "data-tm-action": "pin",
          title: pinned ? t("tm.panel.unpin") : t("tm.panel.pin"),
          "aria-label": pinned ? t("tm.panel.unpin") : t("tm.panel.pin"),
          "aria-pressed": pinned ? "true" : "false",
          onClick: onTogglePin,
        },
        h(Icon, { name: pinned ? "PinOff" : "Pin", size: 14 }),
      ),
      view.name === "settings"
        ? null
        : h(
            "button",
            {
              type: "button",
              class: "tm-icon-btn",
              "data-tm-action": "settings",
              title: t("tm.panel.settings"),
              "aria-label": t("tm.panel.settings"),
              onClick: onOpenSettings,
            },
            h(Icon, { name: "Settings", size: 14 }),
          ),
      h(
        "button",
        {
          type: "button",
          class: "tm-icon-btn",
          "data-tm-action": "close",
          title: t("tm.panel.close"),
          "aria-label": t("tm.panel.close"),
          onClick: onClose,
        },
        h(Icon, { name: "X", size: 14 }),
      ),
    ),
  );
}

function Banner({ tone, title, detail }) {
  return h(
    "div",
    { class: `tm-banner is-${tone}`, role: "status" },
    h(Icon, { name: "AlertTriangle", size: 13 }),
    h("div", { class: "tm-banner-text" }, h("strong", null, title), detail ? h("span", null, detail) : null),
  );
}

function OverviewCard({ label, range, settings, t, kind }) {
  const summary = range?.summary || null;
  const cost = range?.cost || null;
  // 没有 summary 就是还没成功取到用量：token、金额与请求数一起占位，不能显示成 0 花费。
  const ready = Boolean(summary);
  const totalTokens = summary?.totalTokens || 0;
  const requests = summary?.totalRequests || 0;
  return h(
    "div",
    { class: "tm-card", "data-tm-overview": kind },
    h("div", { class: "tm-card-label" }, label),
    h(
      "div",
      { class: "tm-card-tokens" },
      h("span", { class: "tm-num" }, ready ? formatTokens(totalTokens) : t("tm.value.empty")),
      h("span", { class: "tm-unit" }, t("tm.metric.tokens")),
    ),
    h(
      "div",
      { class: "tm-card-meta" },
      ready
        ? h(Money, {
            usd: cost?.totalUsd || 0,
            settings,
            t,
            bound: Boolean(cost?.isLowerBound),
            title: costTitle(cost, settings, t),
          })
        : h("span", { class: "tm-money" }, t("tm.value.empty")),
      h(
        "span",
        { class: "tm-card-requests" },
        ready
          ? t("tm.value.requests", { count: formatExactTokens(requests) })
          : t("tm.value.empty"),
      ),
    ),
  );
}

// 计价口径说明：价格源与「金额是下限还是实测」分开写，避免把两件事混成一句。
function costNoteKey(state) {
  const source = state.settings?.pricingSource;
  if (source === "modelsdev") return "tm.cost.noteModelsDev";
  if (source === "litellm") return "tm.cost.noteLiteLLM";
  return "tm.cost.note";
}

function Overview({ t, state }) {
  const settings = withFxRate(state.settings, state.fx);
  return h(
    "div",
    { class: "tm-overview" },
    h(OverviewCard, {
      label: t("tm.overview.today"),
      range: state.today,
      settings,
      t,
      kind: "today",
    }),
    h(OverviewCard, {
      label: t("tm.overview.total"),
      range: state.allTime,
      settings,
      t,
      kind: "total",
    }),
    h("div", { class: "tm-note" }, t(costNoteKey(state))),
  );
}

function PeriodTabs({ t, state, engine }) {
  const current = periodKeyOf(state);
  return h(
    "div",
    { class: "tm-tabs", role: "tablist" },
    PERIOD_KEYS.map((key) =>
      h(
        "button",
        {
          key,
          type: "button",
          role: "tab",
          class: `tm-tab${current === key ? " is-active" : ""}`,
          "data-tm-period": key,
          "aria-selected": current === key ? "true" : "false",
          onClick: () => {
            engine.setPeriod(key).catch(() => {});
          },
        },
        periodLabel(t, key),
      ),
    ),
  );
}

function PeriodSection({ t, state, onOpenMapping }) {
  const [calcTip, setCalcTip] = useState(null);
  const calcTimer = useRef(0);
  const { key: periodKey, range, ready } = rangeOf(state);
  const summary = ready ? range.summary : null;
  const cost = ready ? range.cost : null;
  const settings = withFxRate(state.settings, state.fx);
  const emptyText = periodKey === "today" ? t("tm.period.empty") : t("tm.period.emptyRange");
  // 数据没到（首次加载或刚切换周期）时只渲染占位，不能把上一周期的数字或 0 当成新区间结果。
  const hitRate = ready
    ? formatRatio(summary.totalCacheReadInputTokens, summary.totalInputTokens)
    : null;
  const emptyStateText = ready
    ? emptyText
    : state.loading
      ? t("tm.action.refreshing")
      : t("tm.value.empty");

  const rows = (cost?.byModel || []).slice().sort((left, right) => right.tokens - left.tokens);
  const shown = rows.slice(0, MODEL_LIMIT);
  const hidden = rows.length - shown.length;
  const modeNote = ready ? recordsNote(cost, t) : "";

  // 悬停计算过程：延迟一小段出现，避免快速划过时闪烁；滚动 / 缩放 / 切周期时收起。
  function showCalc(row, element) {
    if (calcTimer.current) clearTimeout(calcTimer.current);
    calcTimer.current = setTimeout(() => {
      calcTimer.current = 0;
      setCalcTip({ row, anchor: calcTipAnchor(element.getBoundingClientRect()) });
    }, CALC_HOVER_DELAY);
  }

  function hideCalc() {
    if (calcTimer.current) clearTimeout(calcTimer.current);
    calcTimer.current = 0;
    setCalcTip(null);
  }

  useEffect(
    () => () => {
      if (calcTimer.current) clearTimeout(calcTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!calcTip) return undefined;
    const hide = () => setCalcTip(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [calcTip]);

  useEffect(() => {
    setCalcTip(null);
  }, [periodKey, cost]);

  const tipData = calcTip ? modelCalcData(calcTip.row, settings, t) : null;

  return h(
    "section",
    { class: "tm-period" },
    h(
      "div",
      { class: "tm-stats" },
      h(
        "div",
        { class: "tm-stat" },
        h("span", { class: "tm-stat-label" }, t("tm.metric.tokens")),
        h(
          "span",
          { class: "tm-stat-value" },
          ready ? formatTokens(summary.totalTokens) : t("tm.value.empty"),
        ),
      ),
      h(
        "div",
        { class: "tm-stat" },
        h("span", { class: "tm-stat-label" }, t("tm.metric.cost")),
        h(
          "span",
          { class: "tm-stat-value" },
          ready
            ? h(Money, {
                usd: cost?.totalUsd || 0,
                settings,
                t,
                bound: Boolean(cost?.isLowerBound),
                title: costTitle(cost, settings, t),
              })
            : t("tm.value.empty"),
        ),
      ),
      h(
        "div",
        { class: "tm-stat" },
        h("span", { class: "tm-stat-label" }, t("tm.metric.requests")),
        h(
          "span",
          { class: "tm-stat-value" },
          ready ? formatExactTokens(summary.totalRequests) : t("tm.value.empty"),
        ),
      ),
    ),
    // 计价模式 + records 诊断：模式徽标给「这条金额是怎么来的」，说明只在回退时出现。
    ready
      ? h(
          "div",
          { class: "tm-mode" },
          h(
            "span",
            {
              class: `tm-pill is-${MODE_TONE[cost?.mode] || "muted"}`,
              "data-tm-mode": cost?.mode || "",
              title: costTitle(cost, settings, t),
            },
            modeLabel(t, cost?.mode),
          ),
          modeNote ? h("span", { class: "tm-mode-note" }, modeNote) : null,
        )
      : null,
    hitRate ? h("div", { class: "tm-cache" }, t("tm.period.cacheHit", { percent: hitRate })) : null,
    h(
      "div",
      { class: "tm-models" },
      h("div", { class: "tm-section-title" }, t("tm.models.title")),
      shown.length === 0
        ? h("div", { class: "tm-empty" }, emptyStateText)
        : h(
            "div",
            { class: "tm-model-list" },
            shown.map((row) => {
              return h(
                "div",
                {
                  class: "tm-model",
                  "data-tm-model": row.model,
                  key: row.model,
                  // 悬停整行显示计算过程；子元素自己的 title 会盖住行事件，所以 pill/按钮单独收起。
                  onMouseEnter: (event) => showCalc(row, event.currentTarget),
                  onMouseLeave: hideCalc,
                },
                h("span", { class: "tm-model-name" }, row.model),
                h("span", { class: "tm-model-tokens" }, formatTokens(row.tokens)),
                h(
                  "span",
                  { class: "tm-model-cost" },
                  // 猜测匹配（-latest / 日期后缀 / 渠道前缀）按价计价但不计入覆盖率，金额后缀 ≈ 提示。
                  row.guessed
                    ? `${formatCost(row.costUsd, settings)}${t("tm.cost.guessMark")}`
                    : formatCost(row.costUsd, settings),
                ),
                row.tierAbove === null || row.tierAbove === undefined
                  ? null
                  : h(
                      "span",
                      { class: "tm-pill is-info tm-tier" },
                      t("tm.cost.tier"),
                    ),
                h(
                  "button",
                  {
                    type: "button",
                    class: `tm-pill is-${STATUS_TONE[row.status] || "muted"}`,
                    "aria-label": t("tm.status.edit"),
                    onClick: () => onOpenMapping(row.model),
                    "data-tm-action": "map",
                  },
                  statusLabel(t, row.status),
                ),
              );
            }),
          ),
      hidden > 0 ? h("div", { class: "tm-more" }, t("tm.models.more", { count: hidden })) : null,
    ),
    tipData ? h(CalcTip, { data: tipData, anchor: calcTip.anchor, t }) : null,
  );
}

function Footer({ t, state, refreshing, onRefresh }) {
  const { range, ready } = rangeOf(state);
  const cost = ready ? range.cost : null;
  // 覆盖率与未计价都依赖成本结果：没有数据时统一占位，不能调用 formatPercent 变成 0%。
  const coverageText = ready ? formatPercent(cost?.coverage || 0) : t("tm.value.empty");
  const unpricedText = ready ? formatTokens(cost?.unpricedTokens || 0) : t("tm.value.empty");
  const ignoredText = ready ? formatTokens(cost?.ignoredTokens || 0) : t("tm.value.empty");
  const guessedText = ready ? formatTokens(cost?.guessedTokens || 0) : t("tm.value.empty");
  const preciseCount = cost?.mode === "precise" ? cost?.recordsRows || 0 : 0;
  // 自定义价只影响成本，不影响用量：单独统计一次，用户才知道金额是按自己填的价算的。
  const customCount = cost?.customModels || 0;
  const catalogCount = catalogEntries(state).length;
  const busy = refreshing || Boolean(state.loading);
  return h(
    "footer",
    { class: "tm-foot" },
    h(
      "div",
      { class: "tm-foot-stats" },
      h("span", { class: "tm-foot-stat" }, t("tm.footer.coverage", { percent: coverageText })),
      // 未计价是告警型条目：只有确实存在未计价 token 时才染告警色，
      // 为 0 或未就绪都降级成中性色，避免页脚常亮橙色与覆盖率告警互相矛盾。
      // 用数值判断而不是比较格式化文本：formatTokens(0) 给出「0」，未就绪是「—」。
      h(
        "span",
        {
          class: `tm-foot-stat ${
            ready && Number(cost?.unpricedTokens) > 0 ? "is-warn" : "is-muted"
          }`,
        },
        t("tm.footer.unpriced", { tokens: unpricedText }),
      ),
      h(
        "span",
        { class: "tm-foot-stat is-muted" },
        t("tm.footer.ignored", { tokens: ignoredText }),
      ),
      // 猜测匹配单独统计：金额已计入，但不作为「已计价覆盖率」的分子。
      // 用数值判断而不是比较格式化文本：guessedTokens 为 0 时 formatTokens 会给出「0」，
      // 与空占位「—」不相等，会导致页脚恒显示橙色「猜测 0」。
      ready && Number(cost?.guessedTokens) > 0
        ? h(
            "span",
            { class: "tm-foot-stat is-warn" },
            t("tm.footer.guessed", { tokens: guessedText }),
          )
        : null,
      ready && preciseCount > 0
        ? h(
            "span",
            { class: "tm-foot-stat is-muted" },
            t("tm.footer.precise", { count: formatExactTokens(preciseCount) }),
          )
        : null,
      ready && customCount > 0
        ? h(
            "span",
            { class: "tm-foot-stat is-muted" },
            t("tm.footer.custom", { count: formatExactTokens(customCount) }),
          )
        : null,
      h(
        "span",
        { class: "tm-foot-stat is-muted" },
        t("tm.footer.catalog", { count: formatExactTokens(catalogCount) }),
      ),
    ),
    h(
      "button",
      {
        type: "button",
        class: "tm-btn tm-btn-primary",
        "data-tm-action": "refresh",
        disabled: busy,
        title: t("tm.action.refresh"),
        onClick: onRefresh,
      },
      h(Icon, { name: "RefreshCw", size: 13, className: busy ? "tm-spin" : "" }),
      h("span", null, busy ? t("tm.action.refreshing") : t("tm.action.refresh")),
    ),
  );
}

function MappingView({ t, state, view, engine, onBack }) {
  const model = view.model || "";
  const row = findModelRow(state, model);
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = catalogEntries(state);
    const filtered = keyword
      ? list.filter(
          (entry) =>
            String(entry.id || "").toLowerCase().includes(keyword) ||
            String(entry.name || "").toLowerCase().includes(keyword) ||
            String(entry.provider || "").toLowerCase().includes(keyword),
        )
      : list;
    return filtered.slice(0, CATALOG_LIMIT);
  }, [query, state.catalog?.models]);

  // 映射按钮的入口只决定「草稿怎么办」：映射写入本身不读草稿，也不把草稿当副作用写进存储。
  function apply(target) {
    if (applying || savingRef.current || clearingRef.current) return;
    // 确认条已经显示时不再接受新的映射点击：待执行动作只保留一个。
    if (leaveRequest) return;
    if (!priceDirty()) {
      void runApply(target);
      return;
    }
    // 草稿脏时登记待执行动作，复用离开确认条让用户显式选择；
    // 不先调 savePrice，否则非法 / 全空草稿会让映射点击静默失效。
    setLeaveRequest({ proceed: () => void runApply(target) });
  }

  // 真正写映射：不读价格草稿，也不以映射点击作为价格保存的副作用。
  async function runApply(target) {
    if (applying) return;
    setApplying(true);
    try {
      let result = null;
      try {
        result = await engine.setMapping(model, target);
      } catch {
        result = null;
      }
      // saved=false 表示仅内存生效、重启后会回退，不能当作已保存直接离开。
      if (!result || !result.saved) {
        flashPrice(t("tm.settings.writeFailed"));
        return;
      }
      onBack();
    } finally {
      setApplying(false);
    }
  }

  // 自定义价草稿：字符串态与存储态分离，"" = 继承、0 = 显式免费，输入过程不会把 0 归一成空。
  const priceKey = mappingKey(model);
  const priceRecord = priceRecordOf(state.prices, model);
  // 继承来源取「目录匹配结果」而不是当前生效条目：自定义价生效时 row.entryId 已是 custom:，
  // 只有 matchModel 能回答「留空会继承哪一条目录价」。
  const catalogMatch = useMemo(
    () => matchModel(model, catalogEntries(state), state.mappings),
    [model, state.catalog?.models, state.mappings],
  );
  const [draft, setDraft] = useState(() => priceDraftOf(priceRecord));
  const [priceNotice, setPriceNotice] = useState("");
  // 映射写入进行中：避免 await 期间重复点击造成并发写入。
  const [applying, setApplying] = useState(false);
  // 保存进行中：价格输入与按钮禁用，避免 await 期间的新输入被 priceVersion 触发的 effect 覆盖。
  const [savingPrice, setSavingPrice] = useState(false);
  const savingRef = useRef(false);
  // 移除自定义价：第一次点击只进入待确认态，第二次才写存储；clearing 用于禁用按钮与离开守卫。
  const [pendingClear, setPendingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const clearingRef = useRef(false);
  // 离开确认：守卫被拦截时记住调用方要执行的动作（返回 / 切设置 / 关闭浮层）。
  const [leaveRequest, setLeaveRequest] = useState(null);
  const leaveNoticeRef = useRef(null);
  const noticeTimer = useRef(0);

  // 挂载 effect 可能在用户首次点击之后才执行：首次执行只同步草稿，
  // 之后价格身份变化（换模型 / 保存 / 外部改动）才重置待确认态。
  const priceIdentityRef = useRef(null);
  useEffect(() => {
    const identity = `${priceKey}|${priceRecord?.updatedAt || 0}|${state.priceVersion}`;
    if (priceIdentityRef.current !== null && priceIdentityRef.current !== identity) {
      setPendingClear(false);
    }
    priceIdentityRef.current = identity;
    // 模型切换、价表被外部改动（导入 / 清空 / 保存）时重置草稿。
    setDraft(priceDraftOf(priceRecord));
    // priceRecord 的身份随 state.prices 变化：用规范化键 + 更新时间 + 价格版本三个稳定值做依赖。
  }, [priceKey, priceRecord?.updatedAt, state.priceVersion]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  function flashPrice(message) {
    setPriceNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => {
      noticeTimer.current = 0;
      setPriceNotice("");
    }, NOTICE_MS);
  }

  // 草稿是否与已保存记录不同：按保存时的归一化口径比较，避免 "1.00" 与 "1" 误判。
  // 非法草稿一律视为 dirty，不能被 onBack 静默丢弃。
  function priceDirty() {
    const base = priceDraftOf(priceRecord);
    for (const item of PRICE_INPUTS) {
      const next = readPriceNumber(draft[item.field]);
      if (Number.isNaN(next)) return true;
      const prev = base[item.field] === "" ? null : Number(base[item.field]);
      if (next !== prev) return true;
    }
    const nextMultiplier = readPriceNumber(draft.multiplier);
    if (Number.isNaN(nextMultiplier)) return true;
    const prevMultiplier = Number(base.multiplier);
    const nextValue = nextMultiplier === null ? 1 : nextMultiplier;
    const prevValue = Number.isFinite(prevMultiplier) ? prevMultiplier : 1;
    if (nextValue !== prevValue) return true;
    return draft.note.trim() !== base.note.trim();
  }

  // 守卫每次渲染都读最新草稿与保存状态：它由 Panel 与脚本层在导航 / 关闭前调用。
  const leaveStateRef = useRef({ dirty: false, saving: false });
  leaveStateRef.current = {
    dirty: priceDirty(),
    saving: savingRef.current || clearingRef.current,
  };
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    setLeaveGuard((proceed) => {
      if (savingRef.current || clearingRef.current || leaveStateRef.current.saving) {
        flashPrice(tRef.current(clearingRef.current ? "tm.price.clearing" : "tm.price.saving"));
        return false;
      }
      if (!leaveStateRef.current.dirty) return true;
      // 已有待执行动作时不再覆盖：确认条已在，Esc / 返回不能换掉用户刚点的映射目标。
      setLeaveRequest((pending) => pending || { proceed });
      return false;
    });
    return () => setLeaveGuard(null);
  }, []);

  useEffect(() => {
    if (!leaveRequest) return;
    // 用户可能停在价格区底部：把确认条滚进视野，避免以为点击没生效。
    leaveNoticeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [leaveRequest]);

  function inheritedValue(field) {
    const entry = catalogMatch?.entry;
    return entry ? perMillionText(entry[field]) : "";
  }

  // 一键把当前目录条目价填进草稿：给「在目录价基础上打折」的用户一个起点。
  function fillFromCatalog() {
    const entry = catalogMatch?.entry;
    if (!entry) {
      flashPrice(t("tm.price.fillNone"));
      return;
    }
    setDraft((current) => ({
      ...current,
      input: perMillionText(entry.prompt),
      output: perMillionText(entry.completion),
      cacheRead: perMillionText(entry.cacheRead),
      cacheWrite: perMillionText(entry.cacheWrite),
    }));
  }

  // 返回 true 表示草稿已写入（含清空记录），调用方可继续后续动作。
  async function savePrice() {
    // 保存期间禁止重入：连点保存、移除进行中或保存中按 Esc 不能重复写存储。
    if (savingRef.current || clearingRef.current) return false;
    savingRef.current = true;
    setSavingPrice(true);
    try {
      const patch = { note: draft.note.trim() };
      for (const item of PRICE_INPUTS) {
        const parsed = readPriceNumber(draft[item.field]);
        if (Number.isNaN(parsed)) {
          flashPrice(t("tm.price.invalid"));
          return false;
        }
        patch[item.field] = parsed;
      }
      // 四项全空在引擎侧等价于删除整条记录（备注与倍率一并丢失）：保存按钮不承担删除语义，
      // 恢复目录价必须走「移除自定义价」的显式入口。
      if (PRICE_INPUTS.every((item) => patch[item.field] === null)) {
        flashPrice(t(priceRecord ? "tm.price.emptyRemove" : "tm.price.emptyNew"));
        return false;
      }
      // 倍率留空按 1 处理（与记录默认值一致）；越界在保存前拦截，不能交给引擎静默夹取。
      const multiplier = readMultiplierDraft(draft.multiplier);
      if (multiplier.invalid) {
        flashPrice(t("tm.price.invalid"));
        return false;
      }
      if (multiplier.outOfRange) {
        flashPrice(
          t("tm.price.multiplierRange", {
            min: PRICE_MULTIPLIER.min,
            max: PRICE_MULTIPLIER.max,
          }),
        );
        return false;
      }
      patch.multiplier = multiplier.value;
      let result = null;
      try {
        result = await engine.setCustomPrice(model, patch);
      } catch {
        result = null;
      }
      if (!result || result.invalid) {
        flashPrice(t("tm.price.invalid"));
        return false;
      }
      // 全空保存等价于删除该条：提示要说「已恢复目录价」，而不是「已保存」。
      if (!result.saved) {
        flashPrice(t("tm.settings.writeFailed"));
        return false;
      }
      flashPrice(result.cleared ? t("tm.price.cleared") : t("tm.price.saved"));
      return true;
    } finally {
      savingRef.current = false;
      setSavingPrice(false);
    }
  }

  // 移除自定义价：两击确认 + 进行中禁用 + 草稿保护。
  // 第一击只进入待确认态（不写存储），第二击才真正删除；
  // 草稿与已保存记录不同时拒绝，避免 priceVersion 重置把未保存输入一并丢掉。
  async function clearPrice() {
    if (savingRef.current || clearingRef.current) return;
    if (priceDirty()) {
      flashPrice(t("tm.price.clearDirty"));
      return;
    }
    if (!pendingClear) {
      setPendingClear(true);
      return;
    }
    setPendingClear(false);
    clearingRef.current = true;
    setClearing(true);
    try {
      let result = null;
      try {
        result = await engine.clearCustomPrice(model);
      } catch {
        result = null;
      }
      flashPrice(result && result.saved ? t("tm.price.cleared") : t("tm.settings.writeFailed"));
    } finally {
      clearingRef.current = false;
      setClearing(false);
    }
  }

  // 离开确认的两个分支：保存失败或草稿非法时停在当前视图，提示由 savePrice 给出。
  async function leaveWithSave() {
    const request = leaveRequest;
    if (!request || savingRef.current) return;
    // 草稿已被改回与存储一致时不必重复写一次存储，直接执行待执行动作。
    if (priceDirty() && !(await savePrice())) return;
    setLeaveRequest(null);
    request.proceed();
  }

  function leaveWithDiscard() {
    const request = leaveRequest;
    if (!request || savingRef.current) return;
    setLeaveRequest(null);
    setDraft(priceDraftOf(priceRecord));
    request.proceed();
  }

  return h(
    "section",
    { class: "tm-mapping" },
    leaveRequest
      ? h(
          "div",
          {
            class: "tm-price-hint is-warn",
            role: "alert",
            ref: leaveNoticeRef,
            "data-tm-leave": "confirm",
          },
          h("div", null, t("tm.price.leavePrompt")),
          h(
            "div",
            { class: "tm-price-actions" },
            h(
              "button",
              {
                type: "button",
                class: "tm-btn tm-btn-primary",
                "data-tm-action": "leave-save",
                disabled: savingPrice,
                onClick: leaveWithSave,
              },
              t("tm.price.leaveSave"),
            ),
            h(
              "button",
              {
                type: "button",
                class: "tm-btn is-danger",
                "data-tm-action": "leave-discard",
                disabled: savingPrice,
                onClick: leaveWithDiscard,
              },
              t("tm.price.leaveDiscard"),
            ),
            h(
              "button",
              {
                type: "button",
                class: "tm-btn",
                "data-tm-action": "leave-cancel",
                disabled: savingPrice,
                onClick: () => setLeaveRequest(null),
              },
              t("tm.price.leaveStay"),
            ),
          ),
        )
      : null,
    h(
      "div",
      { class: "tm-map-head" },
      h("div", { class: "tm-map-label" }, t("tm.mapping.model")),
      h("div", { class: "tm-map-model", title: model }, model),
      h(
        "div",
        { class: "tm-map-current" },
        h("span", { class: "tm-map-label" }, t("tm.mapping.current")),
        h(
          "span",
          { class: `tm-pill is-${STATUS_TONE[row?.status] || "muted"}` },
          statusLabel(t, row?.status || "unmatched"),
        ),
        row?.entryName ? h("span", { class: "tm-map-entry", title: row.entryId }, row.entryName) : null,
      ),
    ),
    h(
      "div",
      { class: "tm-map-quick" },
      h("div", { class: "tm-section-title" }, t("tm.mapping.candidates")),
      row?.candidates?.length
        ? row.candidates.slice(0, 3).map((candidate) => {
            const value = mappingValueOf(candidate.entryId, candidate.provider);
            return h(
              "button",
              {
                key: value,
                type: "button",
                disabled: applying || savingPrice || Boolean(leaveRequest),
                class: "tm-quick-btn",
                "data-tm-action": "candidate",
                "data-tm-entry": value,
                title: t("tm.mapping.candidateHint"),
                onClick: () => apply(value),
              },
              h(Icon, { name: "ArrowDownToLine", size: 12 }),
              h(
                "span",
                { class: "tm-quick-name" },
                candidate.provider ? `${candidate.provider}/` : "",
                candidate.name || candidate.entryId,
              ),
            );
          })
        : h("div", { class: "tm-map-hint" }, t("tm.mapping.noCandidates")),
      h(
        "div",
        { class: "tm-map-actions" },
        h(
          "button",
          {
            type: "button",
            disabled: applying || savingPrice || Boolean(leaveRequest),
            class: "tm-btn",
            "data-tm-action": "ignore",
            onClick: () => apply("__ignore__"),
          },
          h(Icon, { name: "X", size: 12 }),
          h("span", null, t("tm.mapping.ignore")),
        ),
        h(
          "button",
          {
            type: "button",
            disabled: applying || savingPrice || Boolean(leaveRequest),
            class: "tm-btn",
            "data-tm-action": "auto",
            onClick: () => apply(null),
          },
          h(Icon, { name: "RefreshCw", size: 12 }),
          h("span", null, t("tm.mapping.auto")),
        ),
      ),
    ),
    h(
      "div",
      { class: "tm-price", "data-tm-price-block": "1" },
      h(
        "div",
        { class: "tm-price-head" },
        h("div", { class: "tm-section-title" }, t("tm.price.title")),
        h(
          "span",
          { class: `tm-pill is-${STATUS_TONE[row?.status] || "muted"}` },
          statusLabel(t, row?.status || "unmatched"),
        ),
      ),
      h(
        "div",
        { class: "tm-price-source" },
        t("tm.price.source", { source: statusLabel(t, row?.status || "unmatched") }),
      ),
      h(
        "div",
        { class: "tm-price-grid" },
        PRICE_INPUTS.map((item) =>
          h(
            "label",
            { class: "tm-price-field", key: item.field },
            h("span", { class: "tm-field-label" }, t(item.labelKey)),
            h("input", {
              // type=number 遇到 1.2.3 这类坏输入时 value 会变空，草稿被当成「继承」；
              // 改用 text 保留原文，交给 readPriceNumber 判定并提示 tm.price.invalid。
              type: "text",
              inputMode: "decimal",
              autoComplete: "off",
              class: "tm-input",
              "data-tm-price": item.field,
              disabled: savingPrice,
              // placeholder 就是「留空会继承到的目录价」，空值与 0 因此在界面上可区分。
              placeholder: inheritedValue(item.entryField) || t("tm.value.empty"),
              value: draft[item.field],
              // 事件对象只在派发期间有效：先取值再更新，函数式更新里不能读 event.currentTarget。
              onInput: (event) => {
                const value = event.currentTarget.value;
                setDraft((current) => ({ ...current, [item.field]: value }));
              },
            }),
          ),
        ),
      ),
      h(
        "div",
        { class: "tm-price-grid" },
        h(
          "label",
          { class: "tm-price-field" },
          h("span", { class: "tm-field-label" }, t("tm.price.multiplier")),
          h("input", {
            // 与四个价字段一致：text 保留原文，坏输入走 tm.price.invalid，而不是静默按 1 处理。
            type: "text",
            inputMode: "decimal",
            autoComplete: "off",
            class: "tm-input",
            "data-tm-price": "multiplier",
            disabled: savingPrice,
            value: draft.multiplier,
            onInput: (event) => {
              const value = event.currentTarget.value;
              setDraft((current) => ({ ...current, multiplier: value }));
            },
          }),
          h(
            "span",
            { class: "tm-field-hint" },
            t("tm.price.multiplierHint", {
              min: PRICE_MULTIPLIER.min,
              max: PRICE_MULTIPLIER.max,
            }),
          ),
        ),
        h(
          "label",
          { class: "tm-price-field is-wide" },
          h("span", { class: "tm-field-label" }, t("tm.price.note")),
          h("input", {
            type: "text",
            class: "tm-input",
            "data-tm-price": "note",
            disabled: savingPrice,
            maxLength: 200,
            value: draft.note,
            onInput: (event) => {
              const value = event.currentTarget.value;
              setDraft((current) => ({ ...current, note: value }));
            },
          }),
        ),
      ),
      h(
        "div",
        { class: "tm-price-actions" },
        h(
          "button",
          {
            type: "button",
            class: "tm-btn tm-btn-primary",
            "data-tm-action": "save-price",
            disabled: savingPrice || clearing,
            onClick: savePrice,
          },
          h(Icon, { name: "Check", size: 12 }),
          h("span", null, t("tm.price.save")),
        ),
        h(
          "button",
          {
            type: "button",
            class: "tm-btn",
            "data-tm-action": "fill-price",
            disabled: savingPrice || clearing,
            onClick: fillFromCatalog,
          },
          h(Icon, { name: "ArrowDownToLine", size: 12 }),
          h("span", null, t("tm.price.fillCatalog")),
        ),
        priceRecord
          ? h(
              "button",
              {
                type: "button",
                class: `tm-btn is-danger${pendingClear ? " is-armed" : ""}`,
                "data-tm-action": "clear-price",
                "aria-pressed": pendingClear ? "true" : "false",
                disabled: savingPrice || clearing,
                onClick: clearPrice,
              },
              h(Icon, { name: "X", size: 12 }),
              h("span", null, t(pendingClear ? "tm.price.clearArmed" : "tm.price.clear")),
            )
          : null,
        pendingClear
          ? h(
              "button",
              {
                type: "button",
                class: "tm-btn",
                "data-tm-action": "clear-price-cancel",
                disabled: clearing,
                onClick: () => setPendingClear(false),
              },
              t("tm.settings.cancelConfirm"),
            )
          : null,
      ),
      pendingClear
        ? h(
            "div",
            {
              class: "tm-price-hint is-warn",
              role: "alert",
              "data-tm-clear": "confirm",
            },
            t("tm.price.clearConfirm"),
          )
        : null,
      h("div", { class: "tm-price-hint" }, t("tm.price.hint")),
      h("div", { class: "tm-price-hint" }, t("tm.price.tiersHint")),
      catalogMatch?.entry
        ? h(
            "div",
            { class: "tm-price-hint" },
            t("tm.price.inheritFrom", {
              entry: catalogMatch.entry.name || catalogMatch.entry.id || "",
            }),
          )
        : h("div", { class: "tm-price-hint" }, t("tm.price.inheritNone")),
      row?.status === "ignored"
        ? h("div", { class: "tm-price-hint is-warn" }, t("tm.price.ignoredHint"))
        : null,
      priceNotice ? h("div", { class: "tm-price-notice", role: "status" }, priceNotice) : null,
    ),
    h(
      "div",
      { class: "tm-search" },
      h("span", { class: "tm-search-label" }, t("tm.mapping.searchLabel")),
      h(
        "div",
        { class: "tm-search-box" },
        h(Icon, { name: "Search", size: 13 }),
        h("input", {
          type: "search",
          class: "tm-search-input",
          "data-tm-search": "catalog",
          placeholder: t("tm.mapping.searchPlaceholder"),
          "aria-label": t("tm.mapping.searchPlaceholder"),
          value: query,
          onInput: (event) => setQuery(event.currentTarget.value),
        }),
      ),
    ),
    h(
      "div",
      { class: "tm-entry-list" },
      entries.length === 0
        ? h("div", { class: "tm-empty" }, t("tm.mapping.empty"))
        : entries.map((entry) => {
            const value = mappingValueOf(entry.id, entry.provider);
            const active = value === mappingValueOf(row?.entryId, row?.entryProvider);
            return h(
              "button",
              {
                key: value,
                type: "button",
                disabled: applying || savingPrice || Boolean(leaveRequest),
                class: `tm-entry${active ? " is-active" : ""}`,
                "data-tm-entry": value,
                onClick: () => apply(value),
              },
              h(
                "span",
                { class: "tm-entry-id", title: value },
                entry.provider
                  ? h("span", { class: "tm-entry-provider" }, `${entry.provider}/`)
                  : null,
                entry.id,
              ),
              h("span", { class: "tm-entry-name" }, entry.name),
              h(
                "span",
                { class: "tm-entry-price" },
                t("tm.mapping.price", {
                  input: formatPerMillion(entry.prompt),
                  output: formatPerMillion(entry.completion),
                }),
              ),
            );
          }),
    ),
  );
}

function SelectField({ name, label, hint, value, options, t, onChange }) {
  return h(
    "label",
    { class: "tm-field" },
    h("span", { class: "tm-field-label" }, label),
    h(
      "select",
      {
        class: "tm-select",
        "data-tm-setting": name,
        value: String(value),
        onChange: (event) => onChange(event.currentTarget.value),
      },
      options.map((option) =>
        h("option", { key: String(option.value), value: String(option.value) }, option.label),
      ),
    ),
    hint ? h("span", { class: "tm-field-hint" }, hint) : null,
  );
}

function SettingsView({
  t,
  state,
  engine,
  onClearCatalog,
  onClearPrices,
  onResetMappings,
  onResetSettings,
  onResetFloatPosition,
}) {
  const settings = state.settings;
  const [fxRate, setFxRate] = useState(String(settings.fxRate));
  const [fxUrl, setFxUrl] = useState(settings.fxUrl);
  const [pricingUrl, setPricingUrl] = useState(settings.pricingUrl);
  const [profile, setProfile] = useState(settings.profileName);
  const [notice, setNotice] = useState("");
  const [showSources, setShowSources] = useState(false);
  const [pendingDanger, setPendingDanger] = useState("");
  const timer = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = 0;
    },
    [],
  );

  function flash(message) {
    setNotice(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = 0;
      setNotice("");
    }, NOTICE_MS);
  }

  function apply(patch) {
    engine.setSettings(patch).catch(() => {});
  }

  async function save() {
    const rate = Number.parseFloat(fxRate);
    const nextUrl = pricingUrl.trim();
    const nextProfile = profile.trim();
    const nextFxUrl = fxUrl.trim();
    let saved = false;
    try {
      const result = await engine.setSettings({
        fxRate: Number.isFinite(rate) ? rate : settings.fxRate,
        pricingUrl: nextUrl,
        fxUrl: nextFxUrl,
        profileName: nextProfile,
      });
      saved = result.saved;
    } catch {
      // 存储异常时保留界面输入，不阻塞后续操作；失败提示统一由 saved 分支给出。
    }
    const normalized = engine.getState().settings;
    setFxRate(String(normalized.fxRate));
    setFxUrl(normalized.fxUrl);
    setPricingUrl(normalized.pricingUrl);
    setProfile(normalized.profileName);
    // 两个 URL 分别判断：归一化结果与输入不一致即为被回退，提示要对得上具体字段。
    const pricingFellBack = nextUrl !== normalized.pricingUrl;
    const fxFellBack = nextFxUrl !== normalized.fxUrl;
    if (pricingFellBack && fxFellBack) flash(t("tm.settings.invalidUrls"));
    else if (pricingFellBack) flash(t("tm.settings.invalidUrl"));
    else if (fxFellBack) flash(t("tm.settings.invalidFxUrl"));
    else flash(saved ? t("tm.settings.saved") : t("tm.settings.writeFailed"));
  }

  // 危险操作统一走两步确认：第一次点击只进入待确认态，第二次才执行，避免误点清空数据。
  async function runDanger(name, action, doneMessage) {
    if (pendingDanger !== name) {
      setPendingDanger(name);
      return;
    }
    setPendingDanger("");
    let saved = true;
    try {
      saved = await action();
    } catch {
      // 执行异常按写入失败提示，避免未处理的拒绝。
      saved = false;
    }
    flash(saved === false ? t("tm.settings.writeFailed") : doneMessage);
  }

  function dangerLabel(name) {
    if (name === "clear-catalog") return t("tm.settings.clearCatalog");
    if (name === "reset-settings") return t("tm.settings.resetSettings");
    if (name === "clear-prices") return t("tm.settings.clearPrices");
    return t("tm.settings.resetMappings");
  }

  async function clearCatalog() {
    await onClearCatalog();
    return true;
  }

  async function clearPrices() {
    return onClearPrices();
  }

  async function resetMappings() {
    return onResetMappings();
  }

  async function resetSettings() {
    const saved = await onResetSettings();
    // 输入框是本地状态：重置后手动同步，避免界面还显示旧值。
    const normalized = engine.getState().settings;
    setFxRate(String(normalized.fxRate));
    setFxUrl(normalized.fxUrl);
    setPricingUrl(normalized.pricingUrl);
    setProfile(normalized.profileName);
    return saved;
  }

  async function resetFloatPosition() {
    let saved = true;
    try {
      saved = await onResetFloatPosition();
    } catch {
      saved = false;
    }
    flash(
      saved === false ? t("tm.settings.writeFailed") : t("tm.settings.resetFloatPositionDone"),
    );
  }

  const currency = settings.displayCurrency;
  const mode = settings.displayMode;
  // 自动模式下输入框显示实际获取到的汇率；手动模式显示可编辑的手动值。
  const autoRate =
    settings.fxMode === "auto" && Number(state.fx?.rate) > 0 ? Number(state.fx.rate) : null;
  const rateValue = autoRate !== null ? autoRate.toFixed(4) : fxRate;

  return h(
    "section",
    { class: "tm-settings" },
    h(
      "div",
      { class: "tm-settings-grid" },
      h(SelectField, {
        name: "currency",
        label: t("tm.settings.currency"),
        value: currency,
        t,
        options: [
          { value: "CNY", label: "CNY (¥)" },
          { value: "USD", label: "USD ($)" },
        ],
        onChange: (value) => apply({ displayCurrency: value }),
      }),
      h(SelectField, {
        name: "refresh-seconds",
        label: t("tm.settings.refresh"),
        value: settings.refreshSeconds,
        t,
        options: REFRESH_OPTIONS.map((seconds) => ({
          value: seconds,
          label: t("tm.settings.refreshValue", { seconds }),
        })),
        onChange: (value) => apply({ refreshSeconds: Number(value) }),
      }),
      h(SelectField, {
        name: "badge-style",
        label: t("tm.settings.badge"),
        value: settings.badgeStyle,
        t,
        options: [
          { value: "today", label: t("tm.settings.badgeToday") },
          { value: "total", label: t("tm.settings.badgeTotal") },
        ],
        onChange: (value) => apply({ badgeStyle: value }),
      }),
      h(SelectField, {
        name: "display-mode",
        label: t("tm.settings.displayMode"),
        value: mode,
        t,
        options: [
          { value: "float", label: t("tm.settings.modeFloat") },
          { value: "topbar", label: t("tm.settings.modeTopbar") },
        ],
        onChange: (value) =>
          // 切回顶栏时清除悬浮坐标，避免下次切成悬浮仍停在旧位置。
          apply(value === "topbar" ? { displayMode: "topbar", floatPosition: null } : { displayMode: "float" }),
      }),
      h(SelectField, {
        name: "catalog-ttl",
        label: t("tm.settings.ttl"),
        value: settings.catalogTtlHours,
        t,
        options: TTL_OPTIONS.map((hours) => ({
          value: hours,
          label: t("tm.settings.ttlValue", { hours }),
        })),
        onChange: (value) => apply({ catalogTtlHours: Number(value) }),
      }),
      h(SelectField, {
        name: "fx-mode",
        label: t("tm.settings.fxMode"),
        value: settings.fxMode,
        t,
        options: [
          { value: "auto", label: t("tm.settings.fxAuto") },
          { value: "manual", label: t("tm.settings.fxManual") },
        ],
        onChange: (value) => {
          if (value === "manual" && Number(state.fx?.rate) > 0) {
            // 切到手动时用当前自动汇率预填，避免看到过时的回退值。
            const rate = Number(state.fx.rate);
            setFxRate(rate.toFixed(4));
            apply({ fxMode: "manual", fxRate: rate });
            return;
          }
          apply({ fxMode: value });
        },
      }),
      h(
        "label",
        { class: "tm-field" },
        h("span", { class: "tm-field-label" }, t("tm.settings.fxRate")),
        h("input", {
          type: "number",
          class: "tm-input",
          "data-tm-setting": "fx-rate",
          min: "0.1",
          max: "20",
          step: "0.0001",
          value: rateValue,
          readOnly: settings.fxMode === "auto",
          onInput: (event) => setFxRate(event.currentTarget.value),
        }),
        h(
          "span",
          { class: "tm-field-hint" },
          settings.fxMode === "auto"
            ? t("tm.settings.fxRateAutoHint", { rate: Number(settings.fxRate).toFixed(4) })
            : t("tm.settings.fxRateHint"),
        ),
      ),
      // 计价方式会改变金额语义：精算是逐条请求，聚合是下限估计，hint 必须说清而不是只说「更准」。
      h(SelectField, {
        name: "precise",
        label: t("tm.settings.precise"),
        value: settings.preciseRequests,
        t,
        hint: t("tm.settings.preciseHint"),
        options: PRECISE_OPTIONS.map((value) => ({
          value,
          label:
            value === "always"
              ? t("tm.settings.preciseAlways")
              : value === "off"
                ? t("tm.settings.preciseOff")
                : t("tm.settings.preciseAuto"),
        })),
        onChange: (value) => apply({ preciseRequests: value }),
      }),
      h(SelectField, {
        name: "cache-ttl",
        label: t("tm.settings.cacheTtl"),
        value: settings.cacheWriteTtl,
        t,
        hint: t("tm.settings.cacheTtlHint"),
        options: CACHE_TTL_OPTIONS.map((value) => ({
          value,
          label: value === "1h" ? t("tm.settings.cacheTtl1h") : t("tm.settings.cacheTtl5m"),
        })),
        onChange: (value) => apply({ cacheWriteTtl: value }),
      }),
    ),
    h(
      "label",
      { class: "tm-field is-wide" },
      h("span", { class: "tm-field-label" }, t("tm.settings.profile")),
      h("input", {
        type: "text",
        class: "tm-input",
        "data-tm-setting": "profile",
        placeholder: t("tm.settings.profilePlaceholder"),
        value: profile,
        onInput: (event) => setProfile(event.currentTarget.value),
      }),
    ),
    h(
      "div",
      { class: "tm-settings-actions" },
      h(
        "button",
        { type: "button", class: "tm-btn tm-btn-primary", "data-tm-action": "save-settings", onClick: save },
        h(Icon, { name: "Check", size: 13 }),
        h("span", null, t("tm.settings.save")),
      ),
      h(
        "label",
        { class: "tm-toggle" },
        h("input", {
          type: "checkbox",
          "data-tm-setting": "auto-refresh",
          checked: Boolean(settings.autoRefresh),
          onChange: (event) => apply({ autoRefresh: Boolean(event.currentTarget.checked) }),
        }),
        h("span", { class: "tm-toggle-track", "aria-hidden": "true" }),
        h("span", { class: "tm-toggle-label" }, t("tm.settings.autoRefresh")),
      ),
      h(
        "span",
        { class: `tm-notice${notice ? " is-visible" : ""}`, role: "status" },
        notice,
      ),
    ),
    h("div", { class: "tm-sep" }),
    h(
      "div",
      { class: "tm-settings-actions" },
      h(
        "button",
        {
          type: "button",
          class: "tm-btn",
          "data-tm-action": "refresh-pricing",
          onClick: () => {
            engine.refreshPricing({ force: true }).catch(() => {});
          },
        },
        h(Icon, { name: "RefreshCw", size: 13 }),
        h("span", null, t("tm.settings.refreshPricing")),
      ),
      h(
        "button",
        {
          type: "button",
          class: "tm-btn",
          "data-tm-action": "refresh-fx",
          onClick: () => {
            engine.refreshFx({ force: true }).catch(() => {});
          },
        },
        h(Icon, { name: "RefreshCw", size: 13 }),
        h("span", null, t("tm.settings.refreshFx")),
      ),
      h(
        "button",
        {
          type: "button",
          class: "tm-btn",
          "data-tm-action": "reset-float-position",
          title: t("tm.settings.resetFloatPositionHint"),
          onClick: resetFloatPosition,
        },
        h(Icon, { name: "Move", size: 13 }),
        h("span", null, t("tm.settings.resetFloatPosition")),
      ),
    ),
    h(
      "div",
      { class: "tm-danger", "data-tm-danger": "1" },
      h("div", { class: "tm-danger-title" }, t("tm.settings.dangerTitle")),
      h(
        "div",
        { class: "tm-settings-actions" },
        h(
          "button",
          {
            type: "button",
            class: `tm-btn${pendingDanger === "clear-catalog" ? " is-armed" : ""}`,
            "data-tm-action": "clear-catalog",
            "aria-pressed": pendingDanger === "clear-catalog" ? "true" : "false",
            onClick: () => runDanger("clear-catalog", clearCatalog, t("tm.settings.clearCatalogDone")),
          },
          h(Icon, { name: "Eraser", size: 13 }),
          h("span", null, t("tm.settings.clearCatalog")),
        ),
        h(
          "button",
          {
            type: "button",
            class: `tm-btn${pendingDanger === "reset-settings" ? " is-armed" : ""}`,
            "data-tm-action": "reset-settings",
            title: t("tm.settings.resetSettingsHint"),
            "aria-pressed": pendingDanger === "reset-settings" ? "true" : "false",
            onClick: () => runDanger("reset-settings", resetSettings, t("tm.settings.resetSettingsDone")),
          },
          h(Icon, { name: "Settings", size: 13 }),
          h("span", null, t("tm.settings.resetSettings")),
        ),
        h(
          "button",
          {
            type: "button",
            class: `tm-btn is-danger${pendingDanger === "reset-mappings" ? " is-armed" : ""}`,
            "data-tm-action": "reset-mappings",
            "aria-pressed": pendingDanger === "reset-mappings" ? "true" : "false",
            onClick: () => runDanger("reset-mappings", resetMappings, t("tm.settings.resetMappingsDone")),
          },
          h(Icon, { name: "X", size: 13 }),
          h("span", null, t("tm.settings.resetMappings")),
        ),
        // 自定义价单独一个危险操作：与「重置全部映射」分开确认，避免误清手抄的价格。
        h(
          "button",
          {
            type: "button",
            class: `tm-btn is-danger${pendingDanger === "clear-prices" ? " is-armed" : ""}`,
            "data-tm-action": "clear-prices",
            "aria-pressed": pendingDanger === "clear-prices" ? "true" : "false",
            onClick: () => runDanger("clear-prices", clearPrices, t("tm.settings.clearPricesDone")),
          },
          h(Icon, { name: "Trash2", size: 13 }),
          h("span", null, t("tm.settings.clearPrices")),
        ),
      ),
      pendingDanger
        ? h(
            "div",
            { class: "tm-danger-confirm", role: "status" },
            h("span", null, t("tm.settings.confirmDanger", { action: dangerLabel(pendingDanger) })),
            h(
              "button",
              {
                type: "button",
                class: "tm-btn",
                "data-tm-action": "cancel-confirm",
                onClick: () => setPendingDanger(""),
              },
              t("tm.settings.cancelConfirm"),
            ),
          )
        : h("div", { class: "tm-danger-hint" }, t("tm.settings.dangerHint")),
    ),
    h("div", { class: "tm-sep" }),
    h(
      "button",
      {
        type: "button",
        class: "tm-btn tm-sources-toggle",
        "data-tm-action": "toggle-sources",
        "aria-expanded": showSources ? "true" : "false",
        title: t("tm.settings.sourcesHint"),
        onClick: () => setShowSources((value) => !value),
      },
      h(Icon, {
        name: "ChevronDown",
        size: 13,
        className: `tm-chevron${showSources ? " is-open" : ""}`,
      }),
      h("span", null, t("tm.settings.sources")),
    ),
    showSources
      ? h(
          "div",
          { class: "tm-sources", "data-tm-sources": "1" },
          h(SelectField, {
            name: "pricing-source",
            label: t("tm.settings.pricingSource"),
            value: settings.pricingSource,
            t,
            hint: t("tm.settings.pricingSourceHint"),
            options: [
              { value: "openrouter", label: t("tm.settings.pricingOpenrouter") },
              { value: "modelsdev", label: t("tm.settings.pricingModelsDev") },
              { value: "litellm", label: t("tm.settings.pricingLiteLLM") },
            ],
            onChange: (value) => {
              // 换源同时换回该源的默认接口；自定义地址可在下方输入框覆盖。
              const nextUrl = defaultPricingUrl(value);
              setPricingUrl(nextUrl);
              apply({ pricingSource: value, pricingUrl: nextUrl });
            },
          }),
          h(
            "label",
            { class: "tm-field is-wide" },
            h("span", { class: "tm-field-label" }, t("tm.settings.fxUrl")),
            h("input", {
              type: "url",
              class: "tm-input",
              "data-tm-setting": "fx-url",
              value: fxUrl,
              onInput: (event) => setFxUrl(event.currentTarget.value),
            }),
            h("span", { class: "tm-field-hint" }, t("tm.settings.fxUrlHint")),
            h("span", { class: "tm-field-hint is-warn" }, t("tm.settings.urlTrustHint")),
          ),
          h(
            "label",
            { class: "tm-field is-wide" },
            h("span", { class: "tm-field-label" }, t("tm.settings.pricingUrl")),
            h("input", {
              type: "url",
              class: "tm-input",
              "data-tm-setting": "pricing-url",
              value: pricingUrl,
              onInput: (event) => setPricingUrl(event.currentTarget.value),
            }),
            h("span", { class: "tm-field-hint" }, t("tm.settings.pricingUrlHint")),
            h("span", { class: "tm-field-hint is-warn" }, t("tm.settings.urlTrustHint")),
          ),
          h(
            "div",
            { class: "tm-settings-actions" },
            h(
              "button",
              {
                type: "button",
                class: "tm-btn tm-btn-primary",
                "data-tm-action": "save-sources",
                onClick: save,
              },
              h(Icon, { name: "Check", size: 13 }),
              h("span", null, t("tm.settings.save")),
            ),
          ),
        )
      : null,
    h("div", { class: "tm-map-hint" }, t("tm.settings.pinnedHint")),
  );
}

export default function MeterPanel({
  engine,
  state,
  t,
  view,
  onView,
  onClose,
  onTogglePin,
  onClearCatalog,
  onClearPrices,
  onResetMappings,
  onResetSettings,
  onResetFloatPosition,
}) {
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  function openMapping(model) {
    onView({ name: "mapping", model, from: "main" });
  }

  // 视图切换统一走草稿守卫：Header 的返回 / 设置与脚本层的关闭共用同一套拦截。
  function leaveTo(next) {
    if (!requestLeave(() => onView(next))) return;
    onView(next);
  }

  async function refreshAll() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        engine.refresh({ forceUsage: true }),
        engine.refreshPricing({ force: true }),
      ]);
    } catch {
      // 引擎内部已把错误写入 state。
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }

  const catalogCount = catalogEntries(state).length;
  const banners = [];
  if (state.denied) {
    banners.push(
      h(Banner, {
        key: "denied",
        tone: "warn",
        title: t("tm.denied.title"),
        detail: t("tm.denied.hint"),
      }),
    );
  }
  if (!state.denied && state.error) {
    banners.push(
      h(Banner, {
        key: "error",
        tone: "danger",
        title: t("tm.error.title"),
        detail: state.error,
      }),
    );
  }
  if (state.initialized && catalogCount === 0) {
    banners.push(
      h(Banner, {
        key: "catalog",
        tone: "warn",
        title: t("tm.catalog.unavailable"),
        detail: state.catalog?.error || "",
      }),
    );
  }

  let body = null;
  if (view.name === "settings") {
    body = h(SettingsView, {
      t,
      state,
      engine,
      onClearCatalog,
      onClearPrices,
      onResetMappings,
      onResetSettings,
      onResetFloatPosition,
    });
  } else if (view.name === "mapping") {
    body = h(MappingView, {
      t,
      state,
      view,
      engine,
      onBack: () => onView({ name: "main" }),
    });
  } else {
    body = h(
      "div",
      { class: "tm-main" },
      h(Overview, { t, state }),
      h(PeriodTabs, { t, state, engine }),
      h(PeriodSection, { t, state, onOpenMapping: openMapping }),
    );
  }

  return h(
    "div",
    { class: "tm-panel", role: "dialog", "aria-modal": "false", "aria-label": t("tm.panel.title") },
    h(Header, {
      t,
      state,
      view,
      onBack: () => leaveTo({ name: "main" }),
      onTogglePin,
      onOpenSettings: () => leaveTo({ name: "settings" }),
      onClose,
    }),
    h(
      "div",
      { class: "tm-body" },
      banners.length ? h("div", { class: "tm-banners" }, banners) : null,
      body,
    ),
    view.name === "main"
      ? h(Footer, { t, state, refreshing, onRefresh: refreshAll })
      : null,
  );
}
