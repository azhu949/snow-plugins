// 通用工具：本地日期区间、数字与金额格式化、JSON 安全解析。
// 日期一律用本地时间构造：usage_records.created_at 由 SQLite
// datetime('now','localtime') 写入，格式为 YYYY-MM-DD HH:MM:SS。
import { ALL_TIME_SINCE } from "./constants.js";

const DATE_PAD = 2;

function pad2(value) {
  return String(value).padStart(DATE_PAD, "0");
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

// YYYY-MM-DD（本地时间）。
export function formatLocalDate(value) {
  const date = toDate(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// YYYY-MM-DD HH:MM:SS（本地时间，与 usage_records.created_at 同格式）。
export function formatLocalDateTime(value) {
  const date = toDate(value);
  return `${formatLocalDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

// 今日：本地 00:00:00 → 23:59:59。
export function todayRange(now = new Date()) {
  const day = formatLocalDate(now);
  return { since: `${day} 00:00:00`, until: `${day} 23:59:59` };
}

// 近 N 天（含今天）：起点是 N-1 天前的本地零点，跨月 / 跨年由 Date 构造器处理。
export function lastNDaysRange(days, now = new Date()) {
  const raw = Number(days);
  const count = Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 1;
  const date = toDate(now);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - (count - 1));
  return { since: `${formatLocalDate(start)} 00:00:00`, until: `${formatLocalDate(date)} 23:59:59` };
}

// 全量：固定早起点 → 今天 23:59:59。
export function allTimeRange(now = new Date()) {
  return { since: ALL_TIME_SINCE, until: `${formatLocalDate(now)} 23:59:59` };
}

export function periodRange(period, now = new Date()) {
  if (period === "7d") return lastNDaysRange(7, now);
  if (period === "30d") return lastNDaysRange(30, now);
  if (period === "all") return allTimeRange(now);
  return todayRange(now);
}

function trimFixed(value, digits) {
  const fixed = value.toFixed(digits);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

// token 展示统一用的紧凑计数：999 / 1.2K / 1.23M / 2.5B。
// 阈值留出四舍五入余量，999_999 显示 1M 而不是 1000K。
export function compactTokens(value) {
  const count = Math.max(0, Number(value) || 0);
  if (count < 1000) return String(Math.round(count));
  if (count < 999_950) return `${trimFixed(count / 1000, 1)}K`;
  if (count < 999_950_000) return `${trimFixed(count / 1e6, 2)}M`;
  return `${trimFixed(count / 1e9, 2)}B`;
}

// 千分位整数，不依赖运行环境的 locale。
export function formatNumber(value) {
  const count = Math.round(Number(value) || 0);
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// USD 金额：小额保留更多小数位，避免一堆 $0.00；不做去零，保持金额位数稳定。
export function formatUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  if (amount < 1000) return `$${amount.toFixed(2)}`;
  return `$${formatNumber(amount)}`;
}

// CNY 金额：固定两位小数，整数部分带千分位。
export function formatCny(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "¥0.00";
  const fixed = amount.toFixed(2);
  const [integer, fraction] = fixed.split(".");
  return `¥${formatNumber(Number(integer))}.${fraction}`;
}

// 相对时间：刚刚 / n 分钟前 / n 小时前 / n 天前 / 具体日期。
export function timeAgo(timestamp, now = Date.now()) {
  const target = timestamp instanceof Date ? timestamp.getTime() : Number(timestamp);
  if (!Number.isFinite(target) || target <= 0) return "";
  const current = now instanceof Date ? now.getTime() : Number(now);
  const base = Number.isFinite(current) ? current : Date.now();
  const diff = Math.max(0, base - target);
  if (diff < 60 * 1000) return "刚刚";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))} 天前`;
  return formatLocalDate(target);
}

export function safeJsonParse(raw, fallback = null) {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

export function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
