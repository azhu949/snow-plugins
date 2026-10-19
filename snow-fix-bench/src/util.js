// 通用工具：纯函数，不依赖宿主或 DOM。
import { FIX_MAX_TIMEOUT_MS, UNKNOWN_RUNTIME_IDLE_TIMEOUT_MS } from "./constants.js";

export function nowMs() {
  return Date.now();
}

export function uid(prefix) {
  return `${prefix || "fb"}_${nowMs().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 是否需要在本次轮询读取 messages 域。
// streaming=true 使用流式兜底间隔，streaming=false 使用空闲间隔；未知状态一律读取，
// 保证 runtime 不可读时完成、错误与会话缺失判定仍按原有轮询节奏推进。
// force 用于终态确认轮次（流式转空闲、已发现中止/空响应/错误候选）：必须立即读取，
// 避免节流推迟终态判定。
export function shouldReadMessages({
  streaming,
  hasMessages,
  sinceLastReadMs,
  fallbackMs,
  idleFallbackMs,
  force,
}) {
  if (force === true) return true;
  if (!hasMessages) return true;
  const elapsed = Number(sinceLastReadMs);
  if (!Number.isFinite(elapsed)) return true;
  if (streaming === true) {
    const fallback = Number(fallbackMs);
    if (!Number.isFinite(fallback)) return true;
    return elapsed >= fallback;
  }
  if (streaming === false) {
    const idleFallback = Number(idleFallbackMs);
    if (!Number.isFinite(idleFallback)) return true;
    return elapsed >= idleFallback;
  }
  return true;
}

// 是否需要在本次轮询读取 runtime 域：未知状态立即重试，已知状态按间隔节流。
export function shouldReadRuntime({ known, sinceLastReadMs, intervalMs }) {
  if (!known) return true;
  const elapsed = Number(sinceLastReadMs);
  const interval = Number(intervalMs);
  if (!Number.isFinite(elapsed) || !Number.isFinite(interval)) return true;
  return elapsed >= interval;
}

// 会话跟踪阈值只接受有限正数：未传、NaN、Infinity、0、负数与非数字字符串一律视为非法。
// 非法阈值不能让超时检查被静默跳过，必须回退到调用方默认值或全局兜底值。
export function toPositiveMs(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

// watchConversation 入口的阈值归一化：缺失或非法的 idleMs / maxMs 回退到调用方默认值，
// 同时保证绝对上限不小于空闲阈值，避免参数写反导致提前中断跟踪。
export function normalizeWatchTimeouts(timeouts, defaults = {}) {
  const source = timeouts && typeof timeouts === "object" ? timeouts : {};
  const fallbackIdle = toPositiveMs(defaults?.idleMs) ?? UNKNOWN_RUNTIME_IDLE_TIMEOUT_MS;
  const fallbackMax = toPositiveMs(defaults?.maxMs) ?? FIX_MAX_TIMEOUT_MS;
  const idleMs = toPositiveMs(source.idleMs) ?? fallbackIdle;
  const rawMax = toPositiveMs(source.maxMs) ?? fallbackMax;
  return {
    idleMs,
    maxMs: Math.max(rawMax, idleMs),
    usedFallback: toPositiveMs(source.idleMs) === null || toPositiveMs(source.maxMs) === null,
  };
}

// runtime 进展签名：只纳入能证明会话仍在推进的累积量或本轮 run 起点。
// 明确排除 elapsedMs / streamElapsedMs / ttftMs 等随时间自然增长的派生值，
// 否则签名每轮都会变化，等同于无条件刷新活动时间。
// 返回空串表示当前宿主没有提供任何可观测字段，调用方需要降级处理。
export function buildRuntimeProgressSignature({ streamingSession, focusedConversation } = {}) {
  const formatFields = (values) => {
    const normalized = values.map((value) => {
      if (value === null || value === undefined || value === "") return "";
      const number = Number(value);
      return Number.isFinite(number) ? number : "";
    });
    return normalized.some((value) => value !== "") ? normalized.join("|") : "";
  };
  const parts = [];
  if (streamingSession && typeof streamingSession === "object") {
    const streamingPart = formatFields([
      streamingSession.startedAt,
      streamingSession.messageCount,
      streamingSession.tokenCount,
    ]);
    if (streamingPart) parts.push(`s:${streamingPart}`);
  }
  if (focusedConversation && typeof focusedConversation === "object") {
    const focusedPart = formatFields([
      focusedConversation.streamStartedAt,
      focusedConversation.messageCount,
      focusedConversation.streamTokenCount,
      focusedConversation.pendingMessageCount,
    ]);
    if (focusedPart) parts.push(`f:${focusedPart}`);
  }
  return parts.join(";");
}

// 会话跟踪的 idle 阈值：runtime 可读时使用常规阈值；不可读时没有可观察的运行状态信号，
// 采用不小于常规阈值的未知态阈值，覆盖长构建 / 长测试等长时间没有正文变化的工具阶段。
export function resolveWatchIdleTimeoutMs({ runtimeKnown, idleTimeoutMs, unknownIdleTimeoutMs }) {
  const idle = toPositiveMs(idleTimeoutMs) ?? UNKNOWN_RUNTIME_IDLE_TIMEOUT_MS;
  if (runtimeKnown) return idle;
  const unknown = toPositiveMs(unknownIdleTimeoutMs) ?? UNKNOWN_RUNTIME_IDLE_TIMEOUT_MS;
  return Math.max(idle, unknown);
}

// 会话跟踪是否超时：只有「连续一段时间没有任何新进展」或「超过绝对上限」才算超时。
// 调用方在正文变化、消息行变化或 runtime 可观测进展时刷新 lastActivityAt；
// 宿主仅报告运行中、却没有新 token / 新消息 / 新 run 起点时不再续期，
// 空闲阈值因此能兜住暂停等待授权、streamStartedAt 未清理或 run 卡死的运行态。
// runtime 不可读时没有可观察的运行状态信号，调用方改用放大后的 idle 阈值覆盖长工具阶段；
// maxTimeoutMs 只用于兜住永久挂起。阈值或时间戳非法时回退到安全默认值，不允许静默退化为永不超时。
export function isWatchTimedOut({
  now,
  startedAt,
  lastActivityAt,
  idleTimeoutMs,
  maxTimeoutMs,
}) {
  const current = Number(now);
  if (!Number.isFinite(current)) return false;
  const started = Number(startedAt);
  const last = Number(lastActivityAt);
  const startedMs = Number.isFinite(started) ? started : current;
  const lastActivityMs = Number.isFinite(last) ? last : startedMs;
  const idleTimeout = toPositiveMs(idleTimeoutMs) ?? UNKNOWN_RUNTIME_IDLE_TIMEOUT_MS;
  const maxTimeout = toPositiveMs(maxTimeoutMs) ?? FIX_MAX_TIMEOUT_MS;
  if (current - startedMs > maxTimeout) return true;
  return current - lastActivityMs > idleTimeout;
}

export function truncate(text, limit) {
  const value = String(text ?? "");
  if (value.length <= limit) return { text: value, truncated: false };
  return { text: value.slice(0, limit), truncated: true };
}

export function joinProjectPath(root, relative) {
  const base = String(root || "").replace(/[\\/]+$/, "");
  const rel = String(relative || "").replace(/^[\\/]+/, "");
  if (!base) return rel;
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base}${separator}${rel.replace(/[\\/]+/g, separator)}`;
}

export function isAbsolutePath(value) {
  const text = String(value || "");
  return /^[A-Za-z]:[\\/]/.test(text) || text.startsWith("/") || text.startsWith("\\\\");
}

function splitPath(value) {
  return String(value || "")
    .replace(/^[A-Za-z]:[\\/]/, "")
    .replace(/^\\\\/, "")
    .split(/[\\/]+/)
    .filter(Boolean);
}

// 本地路径规范化：解析 . 与 ..，保留盘符 / UNC / POSIX 根。
function normalizeLocalPath(value) {
  const text = String(value || "");
  const drive = text.match(/^([A-Za-z]):[\\/]/);
  const unc = text.startsWith("\\\\");
  const posix = !drive && !unc && text.startsWith("/");
  const separator = drive || unc ? "\\" : "/";
  const parts = [];
  for (const part of splitPath(text)) {
    if (part === ".") continue;
    if (part === "..") {
      if (!parts.length) return "";
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (drive) return `${drive[1]}:\\${parts.join("\\")}`;
  if (unc) return `\\\\${parts.join("\\")}`;
  if (parts.length) return `/${parts.join(separator)}`.replace(/^\/+/, separator === "/" ? "/" : "");
  return posix ? "/" : "";
}

// POSIX 路径规范化（SSH 远端）；越过根目录返回空串。
function normalizePosixPath(value) {
  const parts = [];
  for (const part of String(value || "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return "";
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function isWithinPath(root, candidate) {
  if (!root || !candidate) return false;
  const caseInsensitive = root.includes("\\");
  const normalizedRoot = caseInsensitive ? root.toLowerCase() : root;
  const normalizedCandidate = caseInsensitive ? candidate.toLowerCase() : candidate;
  const separator = caseInsensitive ? "\\" : "/";
  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(
    normalizedRoot.endsWith(separator) ? normalizedRoot : `${normalizedRoot}${separator}`,
  );
}

function resolveSshIssuePath(projectPath, directoryId, file) {
  const rootMatch = String(projectPath).match(/^ssh:\/\/([^/\s]+)(\/.*)?$/);
  if (!rootMatch) return null;
  const authority = rootMatch[1];
  const remoteRoot = normalizePosixPath(rootMatch[2] || "/");
  if (!remoteRoot) return null;

  let rawPath = String(file || "").trim();
  if (/^ssh:\/\//i.test(rawPath)) {
    const fileMatch = rawPath.match(/^ssh:\/\/([^/\s]+)(\/.*)?$/);
    if (!fileMatch || fileMatch[1] !== authority) return null;
    rawPath = fileMatch[2] || "/";
  }
  const candidate = normalizePosixPath(rawPath.startsWith("/") ? rawPath : `${remoteRoot}/${rawPath}`);
  if (!candidate || !isWithinPath(remoteRoot, candidate)) return null;
  return {
    filePath: candidate,
    sshWorkspacePath: String(projectPath),
    sshWorkspaceRoot: String(projectPath),
    ...(directoryId ? { sshWorkspaceId: String(directoryId) } : {}),
  };
}

function resolveLocalIssuePath(root, file) {
  const normalizedRoot = normalizeLocalPath(root);
  if (!normalizedRoot || !isAbsolutePath(normalizedRoot)) return null;
  const rawPath = String(file || "").trim();
  if (/^[A-Za-z]:(?![\\/])/.test(rawPath)) return null;
  if (/^\\\\[?.][\\/]/.test(rawPath)) return null;
  const candidate = normalizeLocalPath(isAbsolutePath(rawPath) ? rawPath : joinProjectPath(normalizedRoot, rawPath));
  if (!candidate || !isWithinPath(normalizedRoot, candidate)) return null;
  return { filePath: candidate };
}

// issue 位置来自 AI 对仓库内容的总结：只允许打开当前项目内的文件。
export function resolveIssueFilePath(project, file) {
  const raw = String(file || "").trim();
  if (!raw || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(raw)) return null;
  const root = String(project?.path || "").trim();
  if (!root) return null;
  if (project?.kind === "ssh" || /^ssh:\/\//i.test(root)) {
    return resolveSshIssuePath(root, project?.directoryId, raw);
  }
  return resolveLocalIssuePath(root, raw);
}

export function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatStamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseLocation(location) {
  const text = String(location || "").trim();
  if (!text) return { file: "", line: 0 };
  const match = text.match(/^(.*?):(\d+)(?:-\d+)?$/);
  if (!match) return { file: text, line: 0 };
  return { file: match[1].trim(), line: Number(match[2]) || 0 };
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// 与宿主 ReviewPanel 一致：UTF-8 转 base64，避免 diff 中的 @@ 破坏标签终止符。
export function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(String(text));
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : -1;
    const third = index + 2 < bytes.length ? bytes[index + 2] : -1;
    result += BASE64_CHARS[first >> 2];
    result += BASE64_CHARS[((first & 3) << 4) | (second < 0 ? 0 : second >> 4)];
    result += second < 0 ? "=" : BASE64_CHARS[((second & 15) << 2) | (third < 0 ? 0 : third >> 6)];
    result += third < 0 ? "=" : BASE64_CHARS[third & 63];
  }
  return result;
}

export function encodeReviewTag(tag) {
  const body = JSON.stringify({
    prompt: utf8ToBase64(tag?.prompt || ""),
    summary: tag?.summary || "",
    charCount: Number(tag?.charCount) || 0,
    branch: tag?.branch || "",
    repoPath: tag?.repoPath || "",
  });
  // 宿主以首个 @@ 作为标签终止符（snow-app native/src/api/conversation/tags.rs）。
  // JSON 字符串内的字面 @ 统一写成 \u0040：serde_json 与 JSON.parse 都会还原为 @，
  // 显示与回读值不变，同时保证标签体内不出现连续 @@。
  return `@@review:${body.replace(/@/g, "\\u0040")}@@`;
}
