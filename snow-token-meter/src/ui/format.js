// 展示层格式化：币种、金额、比例与相对时间。
// 核心口径（token 拆分、成本公式）在 cost.js / util.js，这里只做展示换算：
// CNY 金额由调用方按 settings.fxRate 换算后交给 formatCny，本模块不访问 snow。
import { compactTokens, formatCny, formatNumber, formatUsd } from "../util.js";

const DEFAULT_FX_RATE = 7.2;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function resolveCurrency(settings) {
  return settings?.displayCurrency === "CNY" ? "CNY" : "USD";
}

function resolveFxRate(settings) {
  const rate = Number(settings?.fxRate);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_FX_RATE;
}

// 自动汇率优先：fxMode=auto 且已拿到有效汇率时，用它覆盖设置里的手动值；
// 手动模式或还没取到汇率时仍用手动值（它同时是自动失败时的回退）。
function withFxRate(settings, fx) {
  if (!settings || settings.fxMode !== "auto") return settings;
  const rate = Number(fx?.rate);
  if (!Number.isFinite(rate) || rate <= 0 || rate === settings.fxRate) return settings;
  return { ...settings, fxRate: rate };
}

function toUsd(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

// 主币种金额：USD 直接格式化；CNY 先乘手动汇率再格式化。
function formatMoney(usd, settings) {
  const amount = toUsd(usd);
  if (resolveCurrency(settings) === "CNY") return formatCny(amount * resolveFxRate(settings));
  return formatUsd(amount);
}

// 另一币种的近似值，浮层里以「· ≈¥0.60」的形式并列展示。
function formatAltMoney(usd, settings) {
  const amount = toUsd(usd);
  if (resolveCurrency(settings) === "CNY") return formatUsd(amount);
  return formatCny(amount * resolveFxRate(settings));
}

function formatCostPair(usd, settings) {
  return { primary: formatMoney(usd, settings), alt: formatAltMoney(usd, settings) };
}

// 徽标只用主币种，避免顶栏过宽。
function formatCost(usd, settings) {
  return formatMoney(usd, settings);
}

// token 一律按 K/M/B 紧凑展示；formatExactTokens 只留给请求数、目录条数等非 token 计数。
function formatExactTokens(value) {
  return formatNumber(value);
}

function formatTokens(value) {
  return compactTokens(value);
}

// 0.9967 → "99.7%"；缺省或 0 时显示 "0%"，不显示 NaN。
function formatPercent(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value) || value <= 0) return "0%";
  const percent = Math.min(1, value) * 100;
  if (percent >= 99.95 && percent < 100) return "99.9%";
  const digits = percent >= 10 ? 1 : 2;
  return `${percent.toFixed(digits).replace(/\.?0+$/, "")}%`;
}

function formatRatio(numerator, denominator) {
  const total = Number(denominator);
  if (!Number.isFinite(total) || total <= 0) return "0%";
  return formatPercent(Number(numerator) / total);
}

// 目录单价是 USD/token，展示成「每 1M token」更易读，保留 3-4 位小数。
function formatPerMillion(price, symbol = "$") {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return `${symbol}0.00`;
  const perMillion = value * 1e6;
  if (perMillion < 0.01) return `${symbol}${perMillion.toFixed(4)}`;
  if (perMillion < 1) return `${symbol}${perMillion.toFixed(4)}`;
  if (perMillion < 100) return `${symbol}${perMillion.toFixed(3)}`;
  return `${symbol}${formatNumber(Math.round(perMillion))}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

// 相对时间按语言输出：timeAgo() 是核心中文实现，展示层需要三语言版本。
function formatAgo(timestamp, t, now = Date.now()) {
  const target = Number(timestamp);
  if (!Number.isFinite(target) || target <= 0) return t("tm.catalog.missing");
  const diff = Math.max(0, Number(now) - target);
  if (diff < MINUTE_MS) return t("tm.time.justNow");
  if (diff < HOUR_MS) return t("tm.time.minutes", { count: Math.floor(diff / MINUTE_MS) });
  if (diff < DAY_MS) return t("tm.time.hours", { count: Math.floor(diff / HOUR_MS) });
  if (diff < 7 * DAY_MS) return t("tm.time.days", { count: Math.floor(diff / DAY_MS) });
  const date = new Date(target);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export {
  DEFAULT_FX_RATE,
  resolveCurrency,
  resolveFxRate,
  withFxRate,
  formatMoney,
  formatAltMoney,
  formatCost,
  formatCostPair,
  formatExactTokens,
  formatTokens,
  formatPercent,
  formatRatio,
  formatPerMillion,
  formatAgo,
};
