// 浮层主视图 / 设置视图 / 模型映射视图。
// 全部是纯展示组件：只接收 engine + state + t，不直接读取 snow 或 GM_*。
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { defaultPricingUrl } from "../constants.js";
import { mappingValueOf } from "../match.js";
import { Icon } from "./icons.js";
import {
  formatAgo,
  formatCost,
  formatCostPair,
  formatExactTokens,
  formatPercent,
  formatPerMillion,
  formatRatio,
  formatTokens,
  withFxRate,
} from "./format.js";

const MODEL_LIMIT = 50;
const CATALOG_LIMIT = 50;
const NOTICE_MS = 1800;
const PERIOD_KEYS = ["today", "7d", "30d", "all"];
const REFRESH_OPTIONS = [30, 60, 120, 300];
const TTL_OPTIONS = [1, 6, 12, 24, 72, 168];

const STATUS_TONE = {
  exact: "ok",
  normalized: "ok",
  fuzzy: "warn",
  manual: "info",
  provider: "ok",
  canonical: "ok",
  unmatched: "warn",
  ignored: "muted",
};

function statusLabel(t, status) {
  const key = `tm.status.${status}`;
  const label = t(key);
  return label === key ? String(status || "") : label;
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

function Money({ usd, settings, t }) {
  const pair = formatCostPair(usd, settings);
  return h(
    "span",
    { class: "tm-money" },
    h("span", { class: "tm-money-main" }, pair.primary),
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
        ? h(Money, { usd: cost?.totalUsd || 0, settings, t })
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
    h(
      "div",
      { class: "tm-note" },
      t(state.settings?.pricingSource === "modelsdev" ? "tm.cost.noteModelsDev" : "tm.cost.note"),
    ),
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
          ready ? h(Money, { usd: cost?.totalUsd || 0, settings, t }) : t("tm.value.empty"),
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
            shown.map((row) =>
              h(
                "div",
                { class: "tm-model", "data-tm-model": row.model, key: row.model },
                h("span", { class: "tm-model-name", title: row.entryName || row.model }, row.model),
                h("span", { class: "tm-model-tokens" }, formatTokens(row.tokens)),
                h("span", { class: "tm-model-cost" }, formatCost(row.costUsd, settings)),
                h(
                  "button",
                  {
                    type: "button",
                    class: `tm-pill is-${STATUS_TONE[row.status] || "muted"}`,
                    title: t("tm.status.edit"),
                    "aria-label": t("tm.status.edit"),
                    onClick: () => onOpenMapping(row.model),
                    "data-tm-action": "map",
                  },
                  statusLabel(t, row.status),
                ),
              ),
            ),
          ),
      hidden > 0 ? h("div", { class: "tm-more" }, t("tm.models.more", { count: hidden })) : null,
    ),
  );
}

function Footer({ t, state, refreshing, onRefresh }) {
  const { range, ready } = rangeOf(state);
  const cost = ready ? range.cost : null;
  // 覆盖率与未计价都依赖成本结果：没有数据时统一占位，不能调用 formatPercent 变成 0%。
  const coverageText = ready ? formatPercent(cost?.coverage || 0) : t("tm.value.empty");
  const unpricedText = ready ? formatTokens(cost?.unpricedTokens || 0) : t("tm.value.empty");
  const ignoredText = ready ? formatTokens(cost?.ignoredTokens || 0) : t("tm.value.empty");
  const catalogCount = catalogEntries(state).length;
  const busy = refreshing || Boolean(state.loading);
  return h(
    "footer",
    { class: "tm-foot" },
    h(
      "div",
      { class: "tm-foot-stats" },
      h("span", { class: "tm-foot-stat" }, t("tm.footer.coverage", { percent: coverageText })),
      h(
        "span",
        { class: "tm-foot-stat is-warn" },
        t("tm.footer.unpriced", { tokens: unpricedText }),
      ),
      h(
        "span",
        { class: "tm-foot-stat is-muted" },
        t("tm.footer.ignored", { tokens: ignoredText }),
      ),
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

  function apply(target) {
    engine.setMapping(model, target).catch(() => {});
    onBack();
  }

  return h(
    "section",
    { class: "tm-mapping" },
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
    return t("tm.settings.resetMappings");
  }

  async function clearCatalog() {
    await onClearCatalog();
    return true;
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
          h(Icon, { name: "ArrowDownToLine", size: 13 }),
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
      ),
      pendingDanger
        ? h(
            "div",
            { class: "tm-danger-confirm", role: "status" },
            h("span", null, t("tm.settings.confirmDanger", { action: dangerLabel(pendingDanger) })),
            h(
              "button",
              { type: "button", class: "tm-btn", onClick: () => setPendingDanger("") },
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
      onBack: () => onView({ name: "main" }),
      onTogglePin,
      onOpenSettings: () => onView({ name: "settings" }),
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
