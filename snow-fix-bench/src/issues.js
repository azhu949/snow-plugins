// issue 数据模型：合并、去重、状态流转与筛选排序。
import { ISSUE_STATUS, SEVERITY, STORE_VERSION, SESSION_MISSING_POLLS, FALLBACK } from "./constants.js";
import { nowMs, uid, normalizeText } from "./util.js";
import { normalizeSeverity, severityRank, statusRank } from "./parse.js";
// ==================== issue 合并与状态 ====================

// 从 issue 位置中提取归一化后的文件路径集合：去掉行号 / 行范围，
// 统一路径分隔符并忽略文件顺序。location 由审查提示词约定为“仓库相对路径:行号”。
function issueLocationFiles(location) {
  const text = normalizeText(location).toLowerCase().replace(/\\/g, "/");
  if (!text) return [];
  const files = text
    .split(/[,;、，；]/)
    .map((part) => {
      const trimmed = part.trim().replace(/^\.\//, "");
      const withoutLine = trimmed.replace(/(?::\d+(?:-\d+)?)+$/, "");
      const hasLine = withoutLine !== trimmed;
      const path = withoutLine.replace(/\/+$/, "");
      if (!path) return "";
      // 只有带行号、路径分隔符或文件扩展名的片段才视为文件位置；
      // “多处”这类描述保持未知，交给调用方按保守策略处理。
      if (!hasLine && !path.includes("/") && !/\.[a-z0-9]+$/i.test(path)) return "";
      return path;
    })
    .filter(Boolean);
  return Array.from(new Set(files)).sort();
}

// 指纹只使用文件路径集合与标题：代码位移导致行号变化时仍命中同一条 issue。
// 无法解析出文件位置时退回原始位置文本，避免所有未标注位置的条目互相折叠。
function issueFingerprint(issue) {
  const files = issueLocationFiles(issue.location);
  const locationKey = files.length ? files.join("|") : normalizeText(issue.location).toLowerCase();
  return `${locationKey}|${normalizeText(issue.title).toLowerCase()}`;
}

function createIssue(row, meta) {
  const at = nowMs();
  return {
    id: uid("issue"),
    severity: row.severity || SEVERITY.major,
    title: row.title || FALLBACK["fx.issues.unlocated"],
    location: row.location || "",
    impact: row.impact || "",
    suggestion: row.suggestion || "",
    evidence: row.evidence || "",
    status: ISSUE_STATUS.open,
    source: {
      conversationId: meta?.conversationId || "",
      reviewedAt: at,
      scopeLabel: meta?.scopeLabel || "",
    },
    fix: null,
    createdAt: at,
    updatedAt: at,
  };
}

function mergeReviewIssues(existing, incoming, meta) {
  const issues = Array.isArray(existing) ? existing.slice() : [];
  const byKey = new Map(issues.map((issue) => [issueFingerprint(issue), issue]));
  let added = 0;
  let updated = 0;
  let reopened = 0;
  // 供自动修复限定范围：只处理本次审查新增或重开的 issue。
  const addedIds = [];
  const reopenedIds = [];
  for (const row of incoming) {
    const key = issueFingerprint(row);
    const current = byKey.get(key);
    if (!current) {
      const issue = createIssue(row, meta);
      issues.push(issue);
      byKey.set(key, issue);
      added += 1;
      addedIds.push(issue.id);
      continue;
    }
    current.severity = row.severity || current.severity;
    current.title = row.title || current.title;
    current.location = row.location || current.location;
    current.impact = row.impact || current.impact;
    current.suggestion = row.suggestion || current.suggestion;
    current.evidence = row.evidence || current.evidence;
    current.updatedAt = nowMs();
    current.source = {
      conversationId: meta?.conversationId || current.source?.conversationId || "",
      reviewedAt: nowMs(),
      scopeLabel: meta?.scopeLabel || current.source?.scopeLabel || "",
    };
    if (current.status === ISSUE_STATUS.fixed) {
      // 已修复的问题再次被审查命中：保留上次修复记录，标记回归并重新打开。
      current.regression = {
        count: Number(current.regression?.count || 0) + 1,
        detectedAt: nowMs(),
        conversationId: meta?.conversationId || "",
        scopeLabel: meta?.scopeLabel || "",
      };
      current.status = ISSUE_STATUS.open;
      reopened += 1;
      reopenedIds.push(current.id);
    } else if (current.status === ISSUE_STATUS.archived) {
      current.status = ISSUE_STATUS.open;
      current.archivedFrom = null;
      current.fix = null;
      // 归档重开是新的审查命中，不是「修复后回归」，旧回归记录必须一并清除。
      current.regression = null;
      reopened += 1;
      reopenedIds.push(current.id);
    }
    updated += 1;
  }
  return { issues, added, updated, reopened, addedIds, reopenedIds };
}

function applyFixResults(issues, results, meta) {
  const list = Array.isArray(issues) ? issues.slice() : [];
  let fixed = 0;
  let blocked = 0;
  let matched = 0;
  let ignored = 0;
  const byId = new Map(list.map((issue) => [issue.id, issue]));
  // 只允许改写本批次白名单内的 issue：模型可能输出不属于本批的 id。
  const allowed = Array.isArray(meta?.issueIds) ? new Set(meta.issueIds.map(String)) : null;
  for (const result of results) {
    const issue = byId.get(result.issueId);
    if (!issue) continue;
    if (allowed && !allowed.has(issue.id)) {
      ignored += 1;
      continue;
    }
    matched += 1;
    issue.fix = {
      conversationId: meta?.conversationId || "",
      result: result.status,
      summary: result.summary,
      files: result.files,
      verification: result.verification,
      at: nowMs(),
    };
    issue.updatedAt = nowMs();
    // 用户已在修复期间归档：保留归档状态与 archivedFrom，只记录本轮修复摘要。
    if (issue.status === ISSUE_STATUS.archived) continue;
    if (result.status === "fixed" || result.status === "not_found") {
      issue.status = ISSUE_STATUS.fixed;
      fixed += 1;
    } else {
      issue.status = ISSUE_STATUS.open;
      blocked += 1;
    }
  }
  return { issues: list, fixed, blocked, matched, ignored };
}

function markIssuesFixing(issues, ids, conversationId) {
  const target = new Set(ids);
  return (Array.isArray(issues) ? issues : []).map((issue) =>
    target.has(issue.id)
      ? {
          ...issue,
          status: ISSUE_STATUS.fixing,
          fix: {
            conversationId,
            result: "",
            summary: "",
            files: [],
            verification: "",
            at: nowMs(),
          },
          updatedAt: nowMs(),
        }
      : issue,
  );
}

function restoreFixingIssues(issues, conversationId) {
  return (Array.isArray(issues) ? issues : []).map((issue) =>
    issue.status === ISSUE_STATUS.fixing && issue.fix?.conversationId === conversationId
      ? { ...issue, status: ISSUE_STATUS.open, fix: null, updatedAt: nowMs() }
      : issue,
  );
}

// 批量释放多个修复会话锁定的 issue：清理历史台账会话与接管已结束的旧会话时使用。
function restoreFixingIssuesForConversations(issues, conversationIds) {
  return (Array.isArray(conversationIds) ? conversationIds : []).reduce(
    (list, conversationId) => restoreFixingIssues(list, conversationId),
    Array.isArray(issues) ? issues : [],
  );
}

// 归档时记录来源状态：只允许可恢复的业务状态，避免把瞬态修复中写回。
function archiveIssueRecord(issue) {
  return {
    ...issue,
    status: ISSUE_STATUS.archived,
    archivedFrom: issue.status === ISSUE_STATUS.fixed ? ISSUE_STATUS.fixed : ISSUE_STATUS.open,
    updatedAt: nowMs(),
  };
}

// 恢复时还原归档前状态；旧数据没有 archivedFrom 时按修复结果兜底。
function restoreIssueRecord(issue) {
  const hasArchivedFrom = issue.archivedFrom === ISSUE_STATUS.open || issue.archivedFrom === ISSUE_STATUS.fixed;
  const fixedByResult = issue.fix?.result === "fixed" || issue.fix?.result === "not_found";
  // 已修复项再次被审查命中后是 open + 保留 fix + regression，不能按 fix 结果误判为已修复。
  const fallback = fixedByResult && !issue.regression ? ISSUE_STATUS.fixed : ISSUE_STATUS.open;
  return {
    ...issue,
    status: hasArchivedFrom ? issue.archivedFrom : fallback,
    archivedFrom: null,
    updatedAt: nowMs(),
  };
}

// 批量删除：只按 id 过滤，不限制状态；卡在修复中的条目也必须能被删除。
function removeIssues(issues, ids) {
  const list = Array.isArray(issues) ? issues : [];
  const target = new Set((Array.isArray(ids) ? ids : []).map(String));
  if (!target.size) return { issues: list.slice(), removed: 0 };
  const next = list.filter((issue) => !target.has(issue.id));
  return { issues: next, removed: list.length - next.length };
}

// 从 conversations 域判断会话是否存在：true 存在，false 不存在，undefined 无法确认。
// items 与 pinned 分属 active / pin 两种状态，两者都可读且都未命中才允许下「不存在」结论。
function findConversationInDomain(domain, conversationId) {
  const id = String(conversationId || "");
  if (!id || !domain || typeof domain !== "object") return undefined;
  if (String(domain.active?.conversationId || "") === id) return true;
  if (!Array.isArray(domain.items) || !Array.isArray(domain.pinned)) return undefined;
  const hit = (list) => list.some((item) => String(item?.conversationId || "") === id);
  return hit(domain.items) || hit(domain.pinned);
}

// 空消息轮次达到阈值后：确认会话不存在则立即结束跟踪；确认存在则继续等待；
// 无法读取 conversations 域时保留旧行为，仅对重连恢复的跟踪判定缺失。
function shouldDeclareSessionMissing(emptyPolls, resumed, exists) {
  if (Number(emptyPolls) < SESSION_MISSING_POLLS) return false;
  if (exists === false) return true;
  if (exists === true) return false;
  return Boolean(resumed);
}

// 按并行上限把本轮 issue 切成批次：每个批次对应一个新会话。
function planFixBatches(issueIds, batchSize) {
  const list = (Array.isArray(issueIds) ? issueIds : []).map(String);
  const size = Math.max(1, Number(batchSize) || 1);
  const batches = [];
  for (let index = 0; index < list.length; index += size) {
    batches.push(list.slice(index, index + size));
  }
  return batches;
}

// 从剩余队列取下一批：跳过已删除或已归档的 issue，其余按顺序填充到上限。
function takeNextFixBatch(queue, issues, batchSize) {
  const list = Array.isArray(issues) ? issues : [];
  const alive = new Map(list.map((issue) => [issue.id, issue]));
  const size = Math.max(1, Number(batchSize) || 1);
  const batchIds = [];
  const remainingIds = [];
  for (const id of Array.isArray(queue) ? queue : []) {
    const issue = alive.get(String(id));
    if (!issue || issue.status === ISSUE_STATUS.archived) continue;
    if (batchIds.length < size) batchIds.push(issue.id);
    else remainingIds.push(issue.id);
  }
  return { batchIds, remainingIds };
}

function sortIssues(issues) {
  return (Array.isArray(issues) ? issues.slice() : []).sort((left, right) => {
    const statusDiff = statusRank(left.status) - statusRank(right.status);
    if (statusDiff !== 0) return statusDiff;
    const severityDiff = severityRank(left.severity) - severityRank(right.severity);
    if (severityDiff !== 0) return severityDiff;
    return (right.updatedAt || 0) - (left.updatedAt || 0);
  });
}

function statusCounts(issues) {
  const counts = { open: 0, fixing: 0, fixed: 0, archived: 0 };
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (counts[issue.status] === undefined) counts.open += 1;
    else counts[issue.status] += 1;
  }
  return counts;
}

function createIssueState(project) {
  return {
    version: STORE_VERSION,
    projectId: project?.directoryId || "",
    projectPath: project?.path || "",
    projectName: project?.name || "",
    issues: [],
    sessions: {
      review: null,
      fix: null,
    },
    // 会话台账：本插件创建过的全部会话。sessions 只保留当前一轮，
    // 分批修复的中间批次与历史审查会话只有台账能覆盖，清理时按类型统一处理。
    conversationLog: [],
    lastReviewAt: 0,
    updatedAt: nowMs(),
  };
}

const SESSION_STATUSES = new Set(["running", "done", "error", "detached", "dismissed"]);

function normalizeSession(raw) {
  if (!raw || typeof raw !== "object" || !raw.conversationId) return null;
  const batchNumber = Math.max(1, Number(raw.batchNumber) || 1);
  const batchTotal = Math.max(batchNumber, Number(raw.batchTotal) || batchNumber);
  // 认领文件快照：issue 被删除后仍可判断旧修复会话可能修改过哪些文件。
  // 缺失表示旧数据没有快照，冲突判定会回退到现存 issue 记录并保持保守拦截。
  const claimedIssueFiles = {};
  if (raw.claimedIssueFiles && typeof raw.claimedIssueFiles === "object" && !Array.isArray(raw.claimedIssueFiles)) {
    for (const [issueId, files] of Object.entries(raw.claimedIssueFiles)) {
      const id = String(issueId || "").trim();
      if (!id) continue;
      claimedIssueFiles[id] = Array.isArray(files)
        ? Array.from(new Set(files.map((file) => String(file || "").trim()).filter(Boolean)))
        : [];
    }
  }
  return {
    conversationId: String(raw.conversationId),
    title: String(raw.title || ""),
    startedAt: Number(raw.startedAt) || 0,
    status: SESSION_STATUSES.has(raw.status) ? raw.status : "running",
    scopeLabel: String(raw.scopeLabel || ""),
    issueIds: Array.isArray(raw.issueIds) ? raw.issueIds.map(String) : [],
    // 分批修复：当前批次、总批次、每批上限、剩余队列与本轮会话记录。
    batchNumber,
    batchTotal,
    batchSize: Math.max(1, Number(raw.batchSize) || 1),
    queue: Array.isArray(raw.queue) ? raw.queue.map(String) : [],
    allIssueIds: Array.isArray(raw.allIssueIds) ? raw.allIssueIds.map(String) : [],
    claimedIssueFiles,
    sessionIds: Array.isArray(raw.sessionIds)
      ? raw.sessionIds.map(String).filter(Boolean)
      : [String(raw.conversationId)],
    autoCleanup: Boolean(raw.autoCleanup),
    cleanupAction: raw.cleanupAction === "delete" ? "delete" : "archive",
    activityDismissed: Boolean(raw.activityDismissed),
    lastError: String(raw.lastError || ""),
  };
}

// 运行中的会话：持久化 status 为主，内存 activity 只对同一会话提供实时补充。
function isSessionBusy(session, activity) {
  if (!session || session.status !== "running") return false;
  if (activity && activity.conversationId === session.conversationId) {
    return !["done", "error", "detached", "dismissed"].includes(activity.phase);
  }
  return true;
}

// 会话台账条目：kind 区分审查 / 修复，清理按类型整批处理。
function normalizeConversationEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const conversationId = String(raw.conversationId || "").trim();
  if (!conversationId) return null;
  return {
    conversationId,
    kind: raw.kind === "fix" ? "fix" : "review",
    title: String(raw.title || ""),
    createdAt: Number(raw.createdAt) || 0,
  };
}

function normalizeConversationLog(raw) {
  const seen = new Set();
  const list = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const entry = normalizeConversationEntry(item);
    if (!entry || seen.has(entry.conversationId)) continue;
    seen.add(entry.conversationId);
    list.push(entry);
  }
  return list;
}

// 追加会话记录：同一会话 ID 只保留一条，重复追加时更新标题与类型。
function appendConversationLog(log, entry) {
  const normalized = normalizeConversationEntry(entry);
  const list = Array.isArray(log) ? log.slice() : [];
  if (!normalized) return list;
  const index = list.findIndex((item) => item.conversationId === normalized.conversationId);
  if (index >= 0) list[index] = { ...list[index], ...normalized };
  else list.push(normalized);
  return list;
}

// 按类型取本插件的全部会话：以台账为准，再补齐当前 session 的会话 ID。
// 旧版本没有台账，只有 sessionIds 记录了分批修复的各批会话，这里一并兼容。
function conversationsForKind(state, kind) {
  const log = Array.isArray(state?.conversationLog) ? state.conversationLog : [];
  const seen = new Set();
  const list = [];
  for (const entry of log) {
    if (!entry || entry.kind !== kind || seen.has(entry.conversationId)) continue;
    seen.add(entry.conversationId);
    list.push(entry);
  }
  const session = state?.sessions?.[kind];
  if (session) {
    const ids = [session.conversationId, ...(Array.isArray(session.sessionIds) ? session.sessionIds : [])];
    for (const id of ids) {
      const conversationId = String(id || "");
      if (!conversationId || seen.has(conversationId)) continue;
      seen.add(conversationId);
      list.push({
        conversationId,
        kind,
        title: String(session.title || ""),
        createdAt: Number(session.startedAt) || 0,
      });
    }
  }
  return list;
}

function removeConversationsFromLog(log, ids) {
  const list = Array.isArray(log) ? log : [];
  // 调用方可能传数组或 Set（清理时用 Set 合并归档与删除结果）。
  const values = Array.isArray(ids) ? ids : ids instanceof Set ? Array.from(ids) : [];
  const target = new Set(values.map(String));
  if (!target.size) return list.slice();
  return list.filter((entry) => !target.has(entry.conversationId));
}

const SESSION_KINDS = ["review", "fix"];

// 清理分组：区分当前会话与台账中的历史会话。历史条目只有会话 ID，没有独立运行状态，
// 清理前必须由调用方用宿主 runtime 再核对一次。
function conversationCleanupGroups(state, actions) {
  return SESSION_KINDS.map((kind) => {
    const session = state?.sessions?.[kind] || null;
    const conversations = conversationsForKind(state, kind);
    const currentId = String(session?.conversationId || "");
    const historicalIds = conversations
      .map((entry) => entry.conversationId)
      .filter((conversationId) => conversationId !== currentId);
    // 已停止跟踪 / 已关闭卡片的当前会话同样无法从持久化状态证明已结束：
    // runtime 不可读时不能比历史台账会话更宽松，必须由用户显式确认。
    const ackIds = historicalIds.slice();
    if (session && (session.status === "detached" || session.status === "dismissed") && currentId) {
      ackIds.push(currentId);
    }
    const requested = actions?.[kind];
    const action = requested === "archive" || requested === "delete" ? requested : "keep";
    return {
      kind,
      session,
      conversations,
      historicalIds,
      ackIds,
      action,
      needsAck: action !== "keep" && ackIds.length > 0,
    };
  });
}

// 已能确认结束的跟踪异常：这些错误发生时读取或解析已经停止，AI 不会再回写结果。
const TERMINAL_SESSION_ERRORS = new Set([
  "session-missing",
  "session-error",
  "session-interrupted",
  "session-empty-response",
  "parse-failed",
  "review-parse-failed",
  "batch-create-failed",
]);

// 超时或未知异常的会话可能仍在宿主中运行：清理时不能当作空闲会话处理。
function isSessionPossiblyRunning(session, activity) {
  if (isSessionBusy(session, activity)) return true;
  if (!session || session.status !== "error") return false;
  return !TERMINAL_SESSION_ERRORS.has(String(session.lastError || ""));
}

function normalizeIssue(raw) {
  if (!raw || typeof raw !== "object") return null;
  const severity = normalizeSeverity(raw.severity) || SEVERITY.major;
  const status = Object.values(ISSUE_STATUS).includes(raw.status) ? raw.status : ISSUE_STATUS.open;
  return {
    id: String(raw.id || uid("issue")),
    severity,
    title: String(raw.title || ""),
    location: String(raw.location || ""),
    impact: String(raw.impact || ""),
    suggestion: String(raw.suggestion || ""),
    evidence: String(raw.evidence || ""),
    status,
    archivedFrom:
      status === ISSUE_STATUS.archived &&
      (raw.archivedFrom === ISSUE_STATUS.open || raw.archivedFrom === ISSUE_STATUS.fixed)
        ? raw.archivedFrom
        : null,
    source: raw.source && typeof raw.source === "object" ? raw.source : { conversationId: "", reviewedAt: 0, scopeLabel: "" },
    fix: raw.fix && typeof raw.fix === "object" ? raw.fix : null,
    regression:
      raw.regression && typeof raw.regression === "object"
        ? {
            count: Number(raw.regression.count) || 1,
            detectedAt: Number(raw.regression.detectedAt) || 0,
            conversationId: String(raw.regression.conversationId || ""),
            scopeLabel: String(raw.regression.scopeLabel || ""),
          }
        : null,
    createdAt: Number(raw.createdAt) || nowMs(),
    updatedAt: Number(raw.updatedAt) || nowMs(),
  };
}

function normalizeIssueState(raw, project) {
  const base = createIssueState(project);
  if (!raw || typeof raw !== "object") return base;
  const sessions = {
    review: normalizeSession(raw.sessions?.review),
    fix: normalizeSession(raw.sessions?.fix),
  };
  // 旧数据没有台账：从当前会话的 conversationId / sessionIds 补齐，
  // 保证分批修复的历史批次也能出现在清理列表里。
  let conversationLog = normalizeConversationLog(raw.conversationLog);
  const known = new Set(conversationLog.map((entry) => entry.conversationId));
  for (const kind of SESSION_KINDS) {
    for (const entry of conversationsForKind({ sessions, conversationLog }, kind)) {
      if (known.has(entry.conversationId)) continue;
      known.add(entry.conversationId);
      conversationLog.push(entry);
    }
  }
  return {
    ...base,
    ...raw,
    version: STORE_VERSION,
    projectId: project?.directoryId || raw.projectId || "",
    projectPath: project?.path || raw.projectPath || "",
    projectName: project?.name || raw.projectName || "",
    issues: Array.isArray(raw.issues) ? raw.issues.map(normalizeIssue).filter(Boolean) : [],
    sessions,
    conversationLog,
    lastReviewAt: Number(raw.lastReviewAt) || 0,
    updatedAt: Number(raw.updatedAt) || nowMs(),
  };
}

function currentStep(snapshot) {
  const activity = snapshot?.activity;
  const finalPhases = new Set(["done", "error", "detached", "dismissed"]);
  if (activity && !finalPhases.has(activity.phase)) {
    return activity.kind === "review" ? "review" : "fix";
  }
  const issues = snapshot?.state?.issues || [];
  if (!issues.length) return "review";
  const counts = statusCounts(issues);
  // 部分修复、部分仍待处理时停在修复步骤，避免流程条提前跳到清理而掩盖剩余项。
  if (counts.open > 0 || counts.fixing > 0) return "fix";
  if (counts.fixed > 0) return "cleanup";
  return "cleanup";
}

function listVisibleIssues(issues, options) {
  const showArchived = Boolean(options?.showArchived);
  const filter = options?.severityFilter || "all";
  let list = Array.isArray(issues) ? issues.slice() : [];
  if (!showArchived) list = list.filter((issue) => issue.status !== ISSUE_STATUS.archived);
  if (filter === SEVERITY.critical) list = list.filter((issue) => issue.severity === SEVERITY.critical);
  if (filter === SEVERITY.major) list = list.filter((issue) => issue.severity === SEVERITY.major);
  return sortIssues(list);
}

export {
  issueFingerprint,
  issueLocationFiles,
  createIssue,
  mergeReviewIssues,
  applyFixResults,
  markIssuesFixing,
  restoreFixingIssues,
  restoreFixingIssuesForConversations,
  archiveIssueRecord,
  restoreIssueRecord,
  removeIssues,
  normalizeConversationLog,
  appendConversationLog,
  conversationsForKind,
  conversationCleanupGroups,
  removeConversationsFromLog,
  findConversationInDomain,
  shouldDeclareSessionMissing,
  planFixBatches,
  takeNextFixBatch,
  sortIssues,
  statusCounts,
  createIssueState,
  normalizeIssueState,
  isSessionBusy,
  isSessionPossiblyRunning,
  currentStep,
  listVisibleIssues,
};
