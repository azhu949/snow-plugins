// 脚本级偏好：归一化与默认值。设置与项目 issue 分开存储，切换项目后仍然生效。
import {
  DEFAULT_PARALLEL_LIMIT,
  MIN_PARALLEL_LIMIT,
  MAX_PARALLEL_LIMIT,
} from "./constants.js";

// 设置结构版本：用于后续结构迁移；autoFixAfterReview 不再按版本强制改值。
const SETTINGS_SCHEMA_VERSION = 2;

const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  parallelLimit: DEFAULT_PARALLEL_LIMIT,
  autoFixAfterReview: false,
  autoCleanupAfterFix: false,
  autoCleanupAction: "archive",
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
  // 显式写入的布尔值一律保留（包括旧版存储里的 false）；缺失时才使用默认值。
  // 默认关闭，避免审查完成后未经用户开启就自动修改工作区。
  const autoFixAfterReview =
    typeof raw?.autoFixAfterReview === "boolean"
      ? raw.autoFixAfterReview
      : DEFAULT_SETTINGS.autoFixAfterReview;
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    parallelLimit: normalizeParallelLimit(raw?.parallelLimit),
    autoFixAfterReview,
    autoCleanupAfterFix: Boolean(raw?.autoCleanupAfterFix),
    autoCleanupAction: raw?.autoCleanupAction === "delete" ? "delete" : "archive",
  };
}

export { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, normalizeParallelLimit, normalizeSettings };
