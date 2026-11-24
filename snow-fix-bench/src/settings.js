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

// 可按项目覆盖的执行字段：只覆盖「走哪个 API 档案」与「并发上限」，
// 其余设置保持全局共享，避免每个项目各维护一份完整配置。
const EXECUTION_OVERRIDE_FIELDS = ["apiProfile", "parallelLimit"];

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

// 项目覆盖专用：只有真正落在允许区间内的值才算「本项目覆盖了并行上限」。
// 不能复用 normalizeParallelLimit —— 它把空值/非法值回退成默认值，写进覆盖后会把
// 全局设置压掉（全局 8 也会被项目覆盖成 3）；越界值同理，回退成区间端点同样是一次
// 用户没有做过的显式选择。返回 null 表示该字段未覆盖，交由全局值决定。
function normalizeOverrideParallelLimit(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  if (rounded < MIN_PARALLEL_LIMIT || rounded > MAX_PARALLEL_LIMIT) return null;
  return rounded;
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

// 项目执行覆盖：只保存用户显式写过的字段。字段缺失表示沿用全局默认。
// 空串 apiProfile 不写入覆盖：会话创建时空串表示「跟随宿主当前激活档案」，
// 而项目作用域的「跟随全局设置」应当沿用全局层选定的档案，写成覆盖会把它压成空串；
// 旧存储里残留的空串覆盖同样按「未覆盖」处理。
function normalizeExecutionOverride(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const override = {};
  if (Object.prototype.hasOwnProperty.call(raw, "apiProfile")) {
    const apiProfile = normalizeApiProfile(raw.apiProfile);
    if (apiProfile) override.apiProfile = apiProfile;
  }
  if (Object.prototype.hasOwnProperty.call(raw, "parallelLimit")) {
    // 非法/越界值不写入覆盖：否则损坏的旧数据或空输入会被归一化成默认值并长期压掉全局设置。
    const parallelLimit = normalizeOverrideParallelLimit(raw.parallelLimit);
    if (parallelLimit !== null) override.parallelLimit = parallelLimit;
  }
  return Object.keys(override).length ? override : null;
}

// 生效设置 = 全局设置叠加项目覆盖。覆盖只会包含执行字段，其它设置仍取全局值。
function mergeExecutionSettings(settings, override) {
  const base = settings && typeof settings === "object" ? settings : DEFAULT_SETTINGS;
  if (!override) return base;
  const merged = { ...base };
  for (const field of EXECUTION_OVERRIDE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(override, field)) merged[field] = override[field];
  }
  return merged;
}

function hasExecutionOverride(override, field) {
  return Boolean(override) && Object.prototype.hasOwnProperty.call(override, field);
}

// 执行作用域草稿：{ global: { parallelLimit, apiProfile }, project: {...} }，只保存用户
// 切走某个作用域时还没提交的表单值，切回该作用域时回填，避免未保存的编辑被快照值覆盖。
// 引擎把某个作用域的执行字段对齐到存储值（清除项目覆盖、失效档案回退）时必须同步丢弃
// 对应草稿，否则切回该作用域会把已被清除的值填回表单并在保存时再次写盘。
// field 省略时丢弃整个作用域的草稿；传入字段名时只丢该字段，其余草稿继续保留。
function dropScopeDraft(drafts, scope, field) {
  const base = drafts && typeof drafts === "object" ? drafts : null;
  const draft = base?.[scope];
  if (!draft || typeof draft !== "object") return drafts;
  const next = { ...base };
  if (!field) {
    delete next[scope];
    return next;
  }
  const remaining = { ...draft };
  delete remaining[field];
  if (Object.keys(remaining).length) next[scope] = remaining;
  else delete next[scope];
  return next;
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
    // 旧记录里显式开启视为已确认（仅作为历史偏好保留）；真正的自动执行凭据是
    // autoFixOptInConfirmedAt，旧配置没有该字段时仍需在本版本内首次确认。
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
  // 自动暂存默认关闭：只在用户显式开启时写回，关闭时不写键。
  // 与 reviewMode 同理，避免给旧存储补默认键、改写既有配置结构。
  if (raw && raw.autoStageAfterFix === true) {
    settings.autoStageAfterFix = true;
  }
  // 自动修复的显式确认凭据：只有确认过 opt-in 且记录了确认时间才保留。
  // 旧记录的 autoFixOptIn 推断只代表历史偏好，不构成本版本的确认凭据；
  // 无值时不补键，避免无意义地改写旧配置结构。
  if (settings.autoFixOptIn === true && Number(raw?.autoFixOptInConfirmedAt) > 0) {
    settings.autoFixOptInConfirmedAt = Number(raw.autoFixOptInConfirmedAt);
  }
  return settings;
}

export {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  EXECUTION_OVERRIDE_FIELDS,
  REVIEW_MODES,
  DEFAULT_REVIEW_MODE,
  normalizeReviewMode,
  normalizeParallelLimit,
  normalizeApiProfile,
  normalizeExecutionOverride,
  mergeExecutionSettings,
  hasExecutionOverride,
  dropScopeDraft,
  normalizeCleanupSessionKinds,
  normalizeCustomPrompts,
  normalizeCustomPromptSlot,
  normalizeSettings,
};
