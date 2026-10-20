// 脚本级偏好：归一化与默认值。设置与项目 issue 分开存储，切换项目后仍然生效。
import {
  DEFAULT_PARALLEL_LIMIT,
  MIN_PARALLEL_LIMIT,
  MAX_PARALLEL_LIMIT,
  DEFAULT_ISSUE_SEVERITIES,
} from "./constants.js";
import { normalizeSeverityScope } from "./parse.js";

// 设置结构版本：schemaVersion 3 新增 verifyAfterFix、issueSeverities 与 autoFixOptIn。
// autoFixAfterReview 默认开启，但未确认前不会静默修改工作区。
const SETTINGS_SCHEMA_VERSION = 3;

const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  parallelLimit: DEFAULT_PARALLEL_LIMIT,
  autoFixAfterReview: true,
  // 用户是否已显式确认自动修复：默认开启不等于已确认，首次触发仍要先确认一次。
  autoFixOptIn: false,
  autoCleanupAfterFix: false,
  autoCleanupAction: "archive",
  // 修复完成后的只读复审默认关闭：会额外消耗一次完整会话。
  verifyAfterFix: false,
  // 纳入修复范围的严重程度：只有范围内的审查结论才会写入 issue 清单。
  issueSeverities: [...DEFAULT_ISSUE_SEVERITIES],
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// 并行上限只接受整数；空值与非法值回退默认值，越界值收敛到允许区间。
function normalizeParallelLimit(value) {
  if (value === "" || value === null || value === undefined) return DEFAULT_PARALLEL_LIMIT;
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_PARALLEL_LIMIT;
  return clamp(Math.round(number), MIN_PARALLEL_LIMIT, MAX_PARALLEL_LIMIT);
}

function normalizeSettings(raw) {
  // 旧存储无法区分「旧默认值 false」与「用户主动关闭」，升级时不能替用户改写选择：
  // 只在字段缺失或类型非法时使用默认值，显式写入的布尔值一律保留。
  const autoFixAfterReview =
    typeof raw?.autoFixAfterReview === "boolean"
      ? raw.autoFixAfterReview
      : DEFAULT_SETTINGS.autoFixAfterReview;
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    parallelLimit: normalizeParallelLimit(raw?.parallelLimit),
    autoFixAfterReview,
    // 旧记录里显式开启视为已确认；没有记录或字段缺失时需要首次确认。
    autoFixOptIn:
      typeof raw?.autoFixOptIn === "boolean"
        ? raw.autoFixOptIn
        : raw?.autoFixAfterReview === true,
    autoCleanupAfterFix: Boolean(raw?.autoCleanupAfterFix),
    autoCleanupAction: raw?.autoCleanupAction === "delete" ? "delete" : "archive",
    verifyAfterFix: Boolean(raw?.verifyAfterFix),
    // 非法值、重复值与空数组统一按默认范围处理，保持「严重 + 一般」。
    issueSeverities: normalizeSeverityScope(raw?.issueSeverities),
  };
}

export { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, normalizeParallelLimit, normalizeSettings };
