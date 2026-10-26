// 脚本级偏好：归一化与默认值。设置与项目 issue 分开存储，切换项目后仍然生效。
import {
  DEFAULT_PARALLEL_LIMIT,
  MIN_PARALLEL_LIMIT,
  MAX_PARALLEL_LIMIT,
  DEFAULT_ISSUE_SEVERITIES,
  CLEANUP_SESSION_KINDS,
  DEFAULT_AUTO_CLEANUP_SESSION_KINDS,
  CUSTOM_PROMPT_SLOTS,
  MAX_CUSTOM_PROMPT_CHARS,
} from "./constants.js";
import { normalizeSeverityScope } from "./parse.js";

// 审查弹窗的默认勾选范围：default 不勾选；staged / unstaged 打开时预选对应分组。
const REVIEW_MODES = ["default", "staged", "unstaged"];
const DEFAULT_REVIEW_MODE = "default";

function normalizeReviewMode(value) {
  return REVIEW_MODES.includes(value) ? value : DEFAULT_REVIEW_MODE;
}

// 自定义提示词插槽：enabled + text。text 保留换行（多行指令是合理需求），
// 其余清洗（打散连续 @、控制围栏、限长）在注入时统一进行，这里只做结构与长度归一。
function normalizeCustomPromptSlot(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const text = typeof value.text === "string" ? value.text.slice(0, MAX_CUSTOM_PROMPT_CHARS) : "";
  return {
    enabled: value.enabled === true,
    text,
  };
}

// 三槽结构固定，未知插槽直接丢弃；每个槽都生成完整对象，调用方无需判空。
function normalizeCustomPrompts(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const slots = {};
  for (const slot of CUSTOM_PROMPT_SLOTS) {
    slots[slot] = normalizeCustomPromptSlot(source[slot]);
  }
  return slots;
}

// 设置结构版本：schemaVersion 5 新增 apiProfile（会话绑定的 API 档案）。
// autoFixAfterReview 默认开启，但未确认前不会静默修改工作区。
const SETTINGS_SCHEMA_VERSION = 5;

const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  parallelLimit: DEFAULT_PARALLEL_LIMIT,
  // 审查 / 修复 / 复审会话创建时绑定的 API 档案名；空串表示不绑定、跟随宿主全局激活档案。
  apiProfile: "",
  autoFixAfterReview: true,
  // 用户是否已显式确认自动修复：默认开启不等于已确认，首次触发仍要先确认一次。
  autoFixOptIn: false,
  autoCleanupAfterFix: false,
  autoCleanupAction: "archive",
  // 自动清理可以处理的会话类型：默认与本轮自动清理的原行为一致（修复 + 复审）。
  autoCleanupSessionKinds: [...DEFAULT_AUTO_CLEANUP_SESSION_KINDS],
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

// 自动清理会话范围：字段缺失或类型非法时回退默认（修复 + 复审）。
// 显式空数组保留，表示只处理 issue、不动任何会话；顺序固定为 review / fix / verify。
function normalizeCleanupSessionKinds(value) {
  if (!Array.isArray(value)) return [...DEFAULT_AUTO_CLEANUP_SESSION_KINDS];
  const picked = new Set(value.map(String));
  return CLEANUP_SESSION_KINDS.filter((kind) => picked.has(kind));
}

function normalizeApiProfile(value) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

function normalizeSettings(raw) {
  // 旧存储无法区分「旧默认值 false」与「用户主动关闭」，升级时不能替用户改写选择：
  // 只在字段缺失或类型非法时使用默认值，显式写入的布尔值一律保留。
  const autoFixAfterReview =
    typeof raw?.autoFixAfterReview === "boolean"
      ? raw.autoFixAfterReview
      : DEFAULT_SETTINGS.autoFixAfterReview;
  const settings = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    parallelLimit: normalizeParallelLimit(raw?.parallelLimit),
    apiProfile: normalizeApiProfile(raw?.apiProfile),
    autoFixAfterReview,
    // 旧记录里显式开启视为已确认；没有记录或字段缺失时需要首次确认。
    autoFixOptIn:
      typeof raw?.autoFixOptIn === "boolean"
        ? raw.autoFixOptIn
        : raw?.autoFixAfterReview === true,
    autoCleanupAfterFix: Boolean(raw?.autoCleanupAfterFix),
    autoCleanupAction: raw?.autoCleanupAction === "delete" ? "delete" : "archive",
    autoCleanupSessionKinds: normalizeCleanupSessionKinds(raw?.autoCleanupSessionKinds),
    verifyAfterFix: Boolean(raw?.verifyAfterFix),
    // 非法值、重复值与空数组统一按默认范围处理，保持「严重 + 一般」。
    issueSeverities: normalizeSeverityScope(raw?.issueSeverities),
    // 自定义提示词：三槽结构固定；未配置时全部为关闭 + 空文本，行为与默认一致。
    customPrompts: normalizeCustomPrompts(raw?.customPrompts),
  };
  // 审查方式只在用户显式保存过时写回：旧存储不补默认键，避免无意义地改写配置。
  if (raw && Object.prototype.hasOwnProperty.call(raw, "reviewMode")) {
    settings.reviewMode = normalizeReviewMode(raw.reviewMode);
  }
  return settings;
}

export {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  REVIEW_MODES,
  DEFAULT_REVIEW_MODE,
  normalizeReviewMode,
  normalizeParallelLimit,
  normalizeApiProfile,
  normalizeCleanupSessionKinds,
  normalizeCustomPrompts,
  normalizeCustomPromptSlot,
  normalizeSettings,
};
