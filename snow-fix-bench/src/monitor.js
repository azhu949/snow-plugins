// 跨项目执行监控：登记每个项目的审查 / 修复 / 复审会话，并为非当前项目维护后台引擎。
// 主引擎只跟踪宿主当前项目；监控面板通过 headless 引擎让其它项目的批次继续执行，
// 同时把进度汇总到一份独立存储，切换项目或重载页面后仍能恢复。
import {
  MONITOR_FINISHED_KEEP_MS,
  MONITOR_KEY,
  MONITOR_MAX_ENTRIES,
  MONITOR_VERSION,
  STORE_PREFIX,
} from "./constants.js";
import { createHeadlessEngine, planCleanupRun } from "./engine.js";
import { createT } from "./i18n.js";
import { resolveStageRunState } from "./issues.js";
import { createStore } from "./store.js";
import { nowMs } from "./util.js";

const SAVE_DEBOUNCE_MS = 800;
// 连续变更的最大等待上限：多个项目同时执行时，800ms 防抖会被反复重置，
// 没有上限就可能长时间不落盘（页面崩溃 / 强杀后丢失运行中条目）。到期强制写一次。
const SAVE_MAX_WAIT_MS = 5_000;
// 后台引擎创建失败后的指数退避：15s、30s、60s ...，上限 5 分钟。
const HEADLESS_RETRY_BASE_MS = 15_000;
const HEADLESS_RETRY_MAX_MS = 5 * 60_000;

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// 计时起点（流程 / 节点）不得晚于当前批起点：晚于本批说明数据来自别的轮次，
// 收敛为 0 让界面按本批起点展示，避免出现负时长或串轮。
function normalizeStartPoint(value, startedAt) {
  const start = numberOr(value);
  if (start <= 0) return 0;
  if (startedAt > 0 && start > startedAt) return 0;
  return start;
}

function sessionKeyOf(kind) {
  return kind === "verify" ? "verify" : kind === "fix" ? "fix" : "review";
}

// 一条自动化链上的会话集合：分批续批累积在 sessionIds，自动复审冻结了修复轮的
// fixConversationId / fixSessionIds。监控据此区分「同链续接」与「上一轮被顶掉」。
function chainIdsOfSessions(conversationId, session) {
  return Array.from(
    new Set(
      [
        conversationId,
        ...(Array.isArray(session?.sessionIds) ? session.sessionIds : []),
        session?.fixConversationId,
        ...(Array.isArray(session?.fixSessionIds) ? session.fixSessionIds : []),
      ]
        .map((id) => String(id || ""))
        .filter(Boolean),
    ),
  );
}

function normalizeKind(kind) {
  return kind === "verify" || kind === "fix" ? kind : "review";
}

// 自动暂存只对本机项目可用：SSH 项目的远端工作区不在本地 Git 中，
// engine.stageRunChanges 对同一判定直接拒绝。
function isSshProjectPath(path) {
  return /^ssh:\/\//i.test(String(path || "").trim());
}

// 面板「清理」入口的可用性：与 engine.cleanupRunManually 的前置条件保持一致——
// 本轮修复会话仍是当前 sessions.fix、已结束、且冻结了自动清理。
// 用户用「处理结果」归档 / 删除修复会话后这里为 false，面板不能继续给出必然空转的入口。
function cleanupReadyOf(snapshot, kind, session) {
  const fixSession = snapshot?.state?.sessions?.fix;
  if (!fixSession || fixSession.status !== "done" || fixSession.autoCleanup !== true) return false;
  const expected =
    kind === "verify" ? String(session?.fixConversationId || "") : String(session?.conversationId || "");
  return Boolean(expected) && String(fixSession.conversationId || "") === expected;
}

// 快照在流式期间持续刷新，但条目字段多数不变：逐字段比较后再落盘，
// 避免每秒重写整份登记、也避免面板整树重渲染。
const ENTRY_COMPARE_FIELDS = [
  "projectName",
  "projectPath",
  "kind",
  "conversationId",
  "phase",
  "status",
  "startedAt",
  "flowStartedAt",
  "stageStartedAt",
  "lastUpdateAt",
  "completedAt",
  "receivedChars",
  "batchNumber",
  "batchTotal",
  "issueCount",
  "scopeLabel",
  "title",
  "error",
  "timedOut",
  // 本轮冻结的自动化开关：面板据此决定是否显示「暂存改动」与「清理」。
  "stageEnabled",
  "autoCleanup",
  // 续批被停止后遗留的非空队列：条目需要持续提示，直到用户处理。
  "queueInterrupted",
  // 面板入口的可用性：项目类型与本轮修复会话是否仍在，决定按钮显示还是说明原因。
  "stageSupported",
  "cleanupReady",
  "stageState",
  // 暂存开始时刻：面板据此判断 staging 是否已超时，避免禁用按钮永久卡死。
  "stageRunAt",
  "cleanupState",
  // 清理确认态展示的动作与范围：由引擎的清理计划推导，与自动清理同源。
  "cleanupAction",
  "cleanupIssueCount",
  "cleanupSessionCount",
  "cleanupBaselineCount",
];

// carryover 是对象，不能按引用比较：逐字段拼成稳定键，否则同一快照会被反复判为变化并重复落盘。
function carryoverKeyOf(carryover) {
  if (!carryover) return "";
  return [
    carryover.kind,
    carryover.conversationId,
    carryover.title,
    carryover.issueCount,
    carryover.completedAt,
    carryover.stagePending ? 1 : 0,
    carryover.cleanupPending ? 1 : 0,
  ].join("\u0001");
}

function sameEntryFields(left, right) {
  if (!ENTRY_COMPARE_FIELDS.every((field) => left[field] === right[field])) return false;
  return carryoverKeyOf(left.carryover) === carryoverKeyOf(right.carryover);
}

// 批量收尾的候选判定：与条目按钮使用同一套条件，避免「按钮能点、批量不包含」这类口径分裂。
// 暂存只取尚未处理过的轮次：done / empty 已结束，staging 正在执行，重复触发没有意义。
const BULK_STAGE_STATES = new Set(["", "error"]);

function bulkStageTargets(entries, now = nowMs()) {
  return entries.filter((entry) => {
    if (entry.status !== "done" || !entry.stageEnabled || entry.stageSupported === false) return false;
    const state = resolveStageRunState(
      { stageRunState: entry.stageState, stageRunAt: entry.stageRunAt },
      now,
    );
    return BULK_STAGE_STATES.has(state);
  });
}

// 清理只取本轮冻结了自动清理、仍有清理计划且修复会话仍在台账的条目。
// 动作未知的旧登记不在批量范围：无法说明将要归档还是删除，不能做不可逆操作。
function bulkCleanupTargets(entries) {
  return entries.filter(
    (entry) =>
      entry.status === "done" &&
      entry.autoCleanup === true &&
      entry.cleanupState !== "done" &&
      entry.cleanupReady !== false &&
      (entry.cleanupAction === "archive" || entry.cleanupAction === "delete"),
  );
}

function cleanupPlanSummaryOf(entries) {
  const summary = {
    projects: entries.length,
    archiveProjects: 0,
    deleteProjects: 0,
    issues: 0,
    sessions: 0,
    baseline: 0,
  };
  for (const entry of entries) {
    if (entry.cleanupAction === "delete") summary.deleteProjects += 1;
    else summary.archiveProjects += 1;
    summary.issues += Math.max(0, Math.floor(numberOr(entry.cleanupIssueCount)));
    summary.sessions += Math.max(0, Math.floor(numberOr(entry.cleanupSessionCount)));
    summary.baseline += Math.max(0, Math.floor(numberOr(entry.cleanupBaselineCount)));
  }
  return summary;
}

export function monitorStatusOfPhase(phase) {
  if (phase === "done") return "done";
  if (phase === "error") return "error";
  if (phase === "detached" || phase === "dismissed") return "detached";
  return "running";
}

// 从引擎快照生成监控条目：只登记当前活动卡片对应的一次会话。
// 项目名 / 路径取项目本身，避免会话标题变化导致面板标题跳动。
export function buildMonitorEntry(snapshot) {
  const project = snapshot?.project;
  const activity = snapshot?.activity;
  if (!project?.directoryId || !activity?.conversationId) return null;
  const kind = normalizeKind(activity.kind);
  const session = snapshot?.state?.sessions?.[sessionKeyOf(kind)];
  const status = monitorStatusOfPhase(activity.phase);
  const startedAt = numberOr(activity.startedAt);
  // 活动快照优先；旧卡片没有新字段时回退到会话记录与旧的 runStartedAt，二者都不可用则按本批展示。
  const legacyRunStart = numberOr(activity.runStartedAt) || numberOr(session?.runStartedAt);
  const flowStartedAt = normalizeStartPoint(
    numberOr(activity.flowStartedAt) || numberOr(session?.flowStartedAt) || legacyRunStart,
    startedAt,
  );
  const stageStartedAt = normalizeStartPoint(
    numberOr(activity.stageStartedAt) || numberOr(session?.stageStartedAt) || legacyRunStart,
    startedAt,
  );
  const lastUpdateAt = Math.max(numberOr(activity.lastUpdateAt), startedAt);
  const issueIds = Array.isArray(activity.issueIds)
    ? activity.issueIds
    : Array.isArray(session?.issueIds)
      ? session.issueIds
      : [];
  // 本轮清理结果的幂等标记：同一轮修复已清理时不再显示「清理」入口。
  const fixConversationId =
    kind === "verify"
      ? String(session?.fixConversationId || "")
      : String(session?.conversationId || "");
  const cleanupState =
    fixConversationId && String(snapshot?.state?.cleanupRun?.fixConversationId || "") === fixConversationId
      ? "done"
      : "";
  // 面板入口的可用性：SSH 项目无法暂存；本轮修复会话已不在台账时清理入口必然空转。
  const stageSupported = !isSshProjectPath(project.path);
  const cleanupReady = cleanupReadyOf(snapshot, kind, session);
  // 清理确认态要展示「动作 + 条数」：直接复用引擎的清理计划，面板不再另写一份清理口径。
  const cleanupPlan = cleanupReady ? planCleanupRun(snapshot, snapshot.state.sessions.fix) : null;
  // 续批被停止后可能留下「本批已完成 + 非空队列」：队列不会再自动派发，
  // 条目上明确提示用户重新勾选剩余 issue，而不是静默停在已完成。
  const queueInterrupted =
    kind === "fix" &&
    session?.status === "done" &&
    Array.isArray(session.queue) &&
    session.queue.length > 0;
  return {
    projectId: String(project.directoryId),
    projectName: String(project.name || project.path || project.directoryId),
    projectPath: String(project.path || ""),
    kind,
    conversationId: String(activity.conversationId),
    // 本轮自动化链的会话集合：只用于判断条目的接续关系，不参与持久化字段比较。
    chainIds: chainIdsOfSessions(activity.conversationId, session),
    phase: String(activity.phase || "waiting"),
    status,
    startedAt,
    flowStartedAt,
    stageStartedAt,
    lastUpdateAt,
    completedAt: status === "done" ? lastUpdateAt : 0,
    receivedChars: Math.max(0, Math.floor(numberOr(activity.receivedChars))),
    batchNumber: Math.max(1, numberOr(activity.batchNumber, 1)),
    batchTotal: Math.max(1, numberOr(activity.batchTotal, 1)),
    issueCount: issueIds.length,
    scopeLabel: String(session?.scopeLabel || ""),
    title: String(session?.title || ""),
    // 本轮冻结的自动化开关：设置里勾选后由 startFix / startVerify 写进会话，
    // 运行期间改设置不影响已开始的轮次，面板必须按这个值决定按钮。
    stageEnabled: Boolean(session?.stageEnabled),
    autoCleanup: Boolean(session?.autoCleanup),
    queueInterrupted,
    stageSupported,
    // 与恢复条目同源：面板按会话持久化的暂存状态去重，并据此判断清理入口是否仍有效。
    cleanupReady,
    stageState: String(session?.stageRunState || ""),
    stageRunAt: numberOr(session?.stageRunAt),
    cleanupState,
    cleanupAction: cleanupPlan ? cleanupPlan.action : "",
    cleanupIssueCount: cleanupPlan ? cleanupPlan.issueCount : 0,
    cleanupSessionCount: cleanupPlan ? cleanupPlan.sessionIds.length : 0,
    cleanupBaselineCount:
      cleanupPlan && cleanupPlan.reviewBaselineMissing ? cleanupPlan.reviewCandidateCount : 0,
    error: String(activity.error || ""),
    timedOut: Boolean(activity.timedOut),
    updatedAt: nowMs(),
  };
}

function sessionStatusOf(session) {
  if (session?.status === "done") return "done";
  if (session?.status === "error") return "error";
  if (session?.status === "detached" || session?.status === "dismissed") return "detached";
  return "running";
}

// 没有活动卡片时的恢复条目：用于后台引擎确认某个项目其实已经没有运行中的会话。
// 只挑选当前轮次（运行中优先），避免把历史已完成会话重新挂到面板上。
export function buildRecoveredMonitorEntry(snapshot) {
  const project = snapshot?.project;
  const sessions = snapshot?.state?.sessions;
  if (!project?.directoryId || !sessions) return null;
  const order = ["fix", "verify", "review"];
  const kind =
    order.find((item) => sessions[item]?.status === "running" && sessions[item]?.conversationId) ||
    order.find((item) => sessions[item]?.conversationId);
  if (!kind) return null;
  const session = sessions[kind];
  const status = sessionStatusOf(session);
  const startedAt = numberOr(session.startedAt);
  // 会话记录是两级起点的持久化来源；旧数据只有 runStartedAt 时用它作为两者的回退。
  const legacyRunStart = numberOr(session.runStartedAt);
  const flowStartedAt = normalizeStartPoint(
    numberOr(session.flowStartedAt) || legacyRunStart,
    startedAt,
  );
  const stageStartedAt = normalizeStartPoint(
    numberOr(session.stageStartedAt) || legacyRunStart,
    startedAt,
  );
  const lastUpdateAt = Math.max(numberOr(session.lastUpdateAt), startedAt);
  const issueIds = Array.isArray(session.issueIds) ? session.issueIds : [];
  const fixConversationId =
    kind === "verify"
      ? String(session.fixConversationId || "")
      : String(session.conversationId || "");
  const cleanupState =
    fixConversationId && String(snapshot?.state?.cleanupRun?.fixConversationId || "") === fixConversationId
      ? "done"
      : "";
  // 与活动快照同源：恢复条目同样要按项目类型与本轮修复会话判断入口可用性。
  const stageSupported = !isSshProjectPath(project.path);
  const cleanupReady = cleanupReadyOf(snapshot, kind, session);
  // 恢复条目与活动条目共用同一份清理计划：重载页面后确认态仍能看到动作与范围。
  const cleanupPlan = cleanupReady ? planCleanupRun(snapshot, snapshot.state.sessions.fix) : null;
  // 同活动条目：续批中断留下的非空队列要在恢复条目上继续提示，
  // 否则页面重载后会显示为普通的已完成轮次。
  const queueInterrupted =
    kind === "fix" &&
    session?.status === "done" &&
    Array.isArray(session.queue) &&
    session.queue.length > 0;
  return {
    projectId: String(project.directoryId),
    projectName: String(project.name || project.path || project.directoryId),
    projectPath: String(project.path || ""),
    kind: normalizeKind(kind),
    conversationId: String(session.conversationId),
    // 同上：恢复条目同样携带本轮链的会话集合，重载后仍能识别同链续接。
    chainIds: chainIdsOfSessions(session.conversationId, session),
    phase: status === "running" ? "waiting" : status,
    status,
    startedAt,
    flowStartedAt,
    stageStartedAt,
    lastUpdateAt,
    completedAt: status === "done" ? lastUpdateAt : 0,
    receivedChars: Math.max(0, Math.floor(numberOr(session.receivedChars))),
    batchNumber: Math.max(1, numberOr(session.batchNumber, 1)),
    batchTotal: Math.max(1, numberOr(session.batchTotal, 1)),
    issueCount: issueIds.length,
    scopeLabel: String(session.scopeLabel || ""),
    title: String(session.title || ""),
    stageEnabled: Boolean(session?.stageEnabled),
    autoCleanup: Boolean(session?.autoCleanup),
    queueInterrupted,
    stageSupported,
    cleanupReady,
    stageState: String(session?.stageRunState || ""),
    stageRunAt: numberOr(session?.stageRunAt),
    cleanupState,
    cleanupAction: cleanupPlan ? cleanupPlan.action : "",
    cleanupIssueCount: cleanupPlan ? cleanupPlan.issueCount : 0,
    cleanupSessionCount: cleanupPlan ? cleanupPlan.sessionIds.length : 0,
    cleanupBaselineCount:
      cleanupPlan && cleanupPlan.reviewBaselineMissing ? cleanupPlan.reviewCandidateCount : 0,
    error: "",
    timedOut: session.lastError === "timeout",
    updatedAt: nowMs(),
  };
}

// 旧条目仍允许补做自动收尾的暂存状态：从未执行（含后台收尾直接 deferred）、暂存中、暂存失败。
// 与面板入口的显示条件保持一致，避免提示与按钮口径不一致。
const STAGE_PENDING_STATES = new Set(["", "staging", "error"]);

// 覆盖同项目条目时保留的「上一轮没做完的自动收尾」：只压缩成只读提示所需的最小信息。
// 旧轮会话记录会被新一轮整体替换（engine.startFix 直接覆盖 sessions.fix），
// 面板无法再对它执行暂存 / 清理，因此不保留任何可触发补做的字段。
function carryoverOf(entry) {
  // 运行中的轮次仍由引擎继续跟踪、到链尾自行收尾，不生成提示；
  // done / error / detached 都不会再自动补做，只要冻结的自动收尾尚未完成就带出提示。
  if (!entry || entry.status === "running") return null;
  const conversationId = String(entry.conversationId || "");
  if (!conversationId) return null;
  const stagePending =
    Boolean(entry.stageEnabled) && STAGE_PENDING_STATES.has(String(entry.stageState || ""));
  const cleanupPending = Boolean(entry.autoCleanup) && entry.cleanupState !== "done";
  if (!stagePending && !cleanupPending) return null;
  return {
    kind: normalizeKind(entry.kind),
    conversationId,
    title: String(entry.title || ""),
    issueCount: Math.max(0, Math.floor(numberOr(entry.issueCount))),
    completedAt: numberOr(entry.completedAt || entry.lastUpdateAt || entry.updatedAt || entry.startedAt),
    stagePending,
    cleanupPending,
  };
}

// 持久化数据不可信：字段类型与状态都要重新收敛，无法确认指向某条会话的提示直接丢弃。
function normalizeCarryover(raw) {
  if (!raw || typeof raw !== "object") return null;
  const conversationId = String(raw.conversationId || "").trim();
  if (!conversationId) return null;
  const stagePending = raw.stagePending === true;
  const cleanupPending = raw.cleanupPending === true;
  if (!stagePending && !cleanupPending) return null;
  return {
    kind: normalizeKind(raw.kind),
    conversationId,
    title: String(raw.title || ""),
    issueCount: Math.max(0, Math.floor(numberOr(raw.issueCount))),
    completedAt: numberOr(raw.completedAt),
    stagePending,
    cleanupPending,
  };
}

// 提示指向的会话是否属于当前条目的自动化链：链上的暂存 / 清理会在链尾统一执行，
// 面板无法再对旧会话补做，也不存在「上一轮」语义。
function entryChainHas(entry, conversationId) {
  const id = String(conversationId || "");
  if (!id) return false;
  return Array.isArray(entry?.chainIds) && entry.chainIds.includes(id);
}

// 条目自身冻结了自动收尾开关：只有这种续接才会替链上的上一会话完成暂存 / 清理。
// 手动复审两项都为 false，不能把上一轮真正的遗留提示吞掉。
function settlesChain(entry) {
  return Boolean(entry?.stageEnabled || entry?.autoCleanup);
}

// 新条目是否承接了同一条自动化链：链上包含被顶掉的会话，且自身冻结了自动收尾开关。
function continuesChain(entry, conversationId) {
  if (!settlesChain(entry)) return false;
  return entryChainHas(entry, conversationId);
}

// 计算条目最终携带的遗留提示：显式传入（含 null）优先；链内提示每次快照都丢弃；
// 同一条自动化链的续接不生成提示；只有真正被其它轮次顶掉时才生成。
function resolveCarryover(existing, entry) {
  if (entry.carryover !== undefined) return normalizeCarryover(entry.carryover);
  if (!existing) return null;
  const prior = existing.carryover || null;
  // 旧版本已落盘的误报、页面重载恢复的链内提示：本轮会统一收尾时不再沿用，后续快照即自动清除。
  if (prior && settlesChain(entry) && entryChainHas(entry, prior.conversationId)) return null;
  if (existing.conversationId === entry.conversationId) return prior;
  // 续批 / 修复转自动复审：链尾仍统一执行暂存与清理，不能把上一会话尚未收尾当成遗留。
  if (continuesChain(entry, existing.conversationId)) return null;
  return carryoverOf(existing) || prior;
}

// 持久化数据不可信：字段类型、状态与项目 id 都要重新收敛，损坏条目直接丢弃。
export function normalizeMonitorEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const projectId = String(raw.projectId || "").trim();
  const conversationId = String(raw.conversationId || "").trim();
  if (!projectId || !conversationId) return null;
  const kind = normalizeKind(raw.kind);
  const status =
    raw.status === "done" || raw.status === "error" || raw.status === "detached"
      ? raw.status
      : "running";
  const startedAt = numberOr(raw.startedAt);
  // 旧登记没有两级起点：收敛为 0，恢复后按本批起点展示，直到引擎写回新快照。
  const legacyRunStart = numberOr(raw.runStartedAt);
  const flowStartedAt = normalizeStartPoint(
    numberOr(raw.flowStartedAt) || legacyRunStart,
    startedAt,
  );
  const stageStartedAt = normalizeStartPoint(
    numberOr(raw.stageStartedAt) || legacyRunStart,
    startedAt,
  );
  const lastUpdateAt = Math.max(numberOr(raw.lastUpdateAt), startedAt);
  return {
    projectId,
    projectName: String(raw.projectName || raw.projectPath || projectId),
    projectPath: String(raw.projectPath || ""),
    kind,
    conversationId,
    phase: String(raw.phase || (status === "running" ? "waiting" : status)),
    status,
    startedAt,
    flowStartedAt,
    stageStartedAt,
    lastUpdateAt,
    completedAt: status === "done" ? Math.max(numberOr(raw.completedAt), lastUpdateAt) : 0,
    receivedChars: Math.max(0, Math.floor(numberOr(raw.receivedChars))),
    batchNumber: Math.max(1, numberOr(raw.batchNumber, 1)),
    batchTotal: Math.max(1, numberOr(raw.batchTotal, 1)),
    issueCount: Math.max(0, Math.floor(numberOr(raw.issueCount))),
    scopeLabel: String(raw.scopeLabel || ""),
    title: String(raw.title || ""),
    // 旧登记没有这两个开关：按 false 处理，面板不显示自动收尾入口。
    stageEnabled: raw.stageEnabled === true,
    autoCleanup: raw.autoCleanup === true,
    // 旧登记没有该字段：按无中断处理，下一次快照会按真实会话状态重算。
    queueInterrupted: raw.queueInterrupted === true,
    // 旧登记没有这两个字段：暂存支持性按持久化的项目路径推导（路径缺失时保持旧行为），
    // 清理可用性按可用处理，首次快照会按真实会话状态重算，避免误藏合法入口。
    stageSupported:
      typeof raw.stageSupported === "boolean" ? raw.stageSupported : !isSshProjectPath(raw.projectPath),
    cleanupReady: raw.cleanupReady !== false,
    stageState: ["staging", "done", "error", "empty"].includes(raw.stageState) ? raw.stageState : "",
    // 旧条目没有该字段：按 0 处理，面板会把它视为已超时并给出「重试暂存」。
    stageRunAt: numberOr(raw.stageRunAt),
    cleanupState: raw.cleanupState === "done" ? "done" : "",
    // 旧登记没有清理计划：动作留空表示「范围未知」，面板不在这种条目上做不可逆操作。
    cleanupAction:
      raw.cleanupAction === "delete" || raw.cleanupAction === "archive" ? raw.cleanupAction : "",
    cleanupIssueCount: Math.max(0, Math.floor(numberOr(raw.cleanupIssueCount))),
    cleanupSessionCount: Math.max(0, Math.floor(numberOr(raw.cleanupSessionCount))),
    cleanupBaselineCount: Math.max(0, Math.floor(numberOr(raw.cleanupBaselineCount))),
    // 上一轮遗留的只读提示：字段缺失或无法指向具体会话时按无提示处理。
    carryover: normalizeCarryover(raw.carryover),
    error: String(raw.error || ""),
    timedOut: Boolean(raw.timedOut),
    updatedAt: numberOr(raw.updatedAt),
  };
}

export function normalizeMonitorData(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : [];
  const byProject = new Map();
  for (const item of list) {
    const entry = normalizeMonitorEntry(item);
    if (!entry) continue;
    const existing = byProject.get(entry.projectId);
    // 同一项目只保留一个当前轮次：优先最新更新的条目。
    if (!existing || entry.updatedAt >= existing.updatedAt) byProject.set(entry.projectId, entry);
  }
  return Array.from(byProject.values());
}

export function sortMonitorEntries(entries) {
  return entries.slice().sort((left, right) => {
    const leftRunning = left.status === "running" ? 1 : 0;
    const rightRunning = right.status === "running" ? 1 : 0;
    if (leftRunning !== rightRunning) return rightRunning - leftRunning;
    if (leftRunning) return (right.startedAt || 0) - (left.startedAt || 0);
    return (right.completedAt || right.updatedAt || 0) - (left.completedAt || left.updatedAt || 0);
  });
}

// 条目对应的会话已不在工作台台账（归档 / 删除都会从 conversationLog 移除）：
// 结果已经处理，监控面板不能继续保留这条打不开的「已完成」记录。
// 运行中的条目不做判断：清理会拒绝仍在运行的会话，未结束的会话也可能尚未写台账。
export function isMonitorEntryRetired(entry, state) {
  if (!entry || entry.status === "running") return false;
  const conversationId = String(entry.conversationId || "");
  if (!conversationId || !state || typeof state !== "object") return false;
  const log = Array.isArray(state.conversationLog) ? state.conversationLog : [];
  if (log.some((item) => String(item?.conversationId || "") === conversationId)) return false;
  const sessions = state.sessions && typeof state.sessions === "object" ? state.sessions : {};
  return !["review", "fix", "verify"].some(
    (kind) => String(sessions[kind]?.conversationId || "") === conversationId,
  );
}

export function pruneMonitorEntries(entries, at = nowMs()) {
  const kept = [];
  for (const entry of entries) {
    if (entry.status === "running") {
      kept.push(entry);
      continue;
    }
    const reference = entry.completedAt || entry.lastUpdateAt || entry.updatedAt || entry.startedAt;
    if (at - reference <= MONITOR_FINISHED_KEEP_MS) kept.push(entry);
  }
  return sortMonitorEntries(kept).slice(0, MONITOR_MAX_ENTRIES);
}

export function mergeMonitorEntry(entries, entry) {
  const next = entries.filter((item) => item.projectId !== entry.projectId);
  next.push(entry);
  return sortMonitorEntries(next).slice(0, MONITOR_MAX_ENTRIES);
}

export function monitorCounts(entries) {
  let running = 0;
  let finished = 0;
  for (const entry of entries) {
    if (entry.status === "running") running += 1;
    else finished += 1;
  }
  return { running, finished };
}

// 悬浮面板控制器：持有跨项目登记，按当前项目切换主引擎与后台引擎的责任边界。
export function createMonitor(api, options = {}) {
  const mainEngine = options.engine;
  const showWorkbench = typeof options.showWorkbench === "function" ? options.showWorkbench : () => {};
  const hideWorkbench = typeof options.hideWorkbench === "function" ? options.hideWorkbench : () => {};
  const t = createT(() => api.locale);
  // 默认折叠成胶囊：有执行记录时也只显示胶囊，用户主动展开后才出现完整面板。
  const store = createStore({
    entries: [],
    collapsed: true,
    pinned: false,
    // 工作台浮层是否可见：可见期间监控只以胶囊存在，展开前会先收起工作台。
    workbenchVisible: false,
    ready: false,
    currentProjectId: "",
    // 面板内动作的即时状态：异步执行期间按钮切换为「暂存中 / 清理中」，
    // 不依赖引擎快照回写，避免重复点击与「点了没反应」。
    actions: {},
    // 每个项目最近一次操作结果：直接显示在条目上，不依赖工作台 toast（工作台可能没打开）。
    notices: {},
    // 批量收尾的内存状态：stage / cleanup 表示正在执行的动作，notice 是面板级结果提示。
    // 不写入持久化条目：页面重载后不会残留一个未经确认的批量操作。
    bulk: { stage: "", cleanup: "", notice: null },
    // 登记读取失败：内存里只有本次会话的条目，写回会整表覆盖其它项目的记录。
    registryUnavailable: false,
  });
  const headlessEngines = new Map();
  const headlessSubscriptions = new Map();
  // 后台引擎创建失败的退避记录（projectId -> { count, nextAt }）与待执行的重建定时器。
  // 两者只存在内存中，不写入持久化条目结构。
  const headlessFailures = new Map();
  const headlessRetryTimers = new Map();
  const noticeTimers = new Map();
  // 后台引擎最近一次提示的对象引用：收尾（自动暂存 / 自动清理）在后台执行时没有渲染器，
  // 面板据此把新的 toast 镜像成条目提示，失败原因不会只留在后台 store 里。
  const headlessToasts = new Map();
  let bulkNoticeTimer = 0;
  let mainSubscription = null;
  let mainProjectId = "";
  let started = false;
  let loaded = false;
  let disposed = false;
  let saveTimer = 0;
  // 本轮待写窗口的上限计时器：从第一次变更开始计时，避免防抖被持续变化无限推迟。
  let saveMaxTimer = 0;

  function currentEntries() {
    return store.get().entries;
  }

  function findEntry(projectId) {
    return currentEntries().find((entry) => entry.projectId === projectId) || null;
  }

  function headlessRetryDelay(count) {
    const exponent = Math.max(0, Math.min(6, count - 1));
    return Math.min(HEADLESS_RETRY_MAX_MS, HEADLESS_RETRY_BASE_MS * 2 ** exponent);
  }

  function clearHeadlessRetry(projectId) {
    headlessFailures.delete(projectId);
    const timer = headlessRetryTimers.get(projectId);
    if (timer) clearTimeout(timer);
    headlessRetryTimers.delete(projectId);
  }

  // 失败后按退避窗口安排一次重建：不依赖主引擎是否继续产生快照。
  function scheduleHeadlessRetry(projectId) {
    if (disposed || !projectId) return;
    if (headlessRetryTimers.has(projectId)) return;
    const failure = headlessFailures.get(projectId);
    if (!failure) return;
    const delay = Math.max(0, failure.nextAt - nowMs());
    const timer = setTimeout(() => {
      headlessRetryTimers.delete(projectId);
      if (disposed) return;
      const entry = findEntry(projectId);
      // 已停止跟踪的条目不再自动重建引擎，否则用户的「停止跟踪」会被立刻撤销。
      if (!entry || entry.status === "done" || entry.status === "detached") return;
      const mainProject = mainEngine?.store?.get()?.project?.directoryId;
      if (mainProject === projectId) return;
      void ensureHeadless(projectId);
    }, delay);
    headlessRetryTimers.set(projectId, timer);
  }

  function recordHeadlessFailure(projectId) {
    const previous = headlessFailures.get(projectId);
    const count = (previous?.count || 0) + 1;
    headlessFailures.set(projectId, { count, nextAt: nowMs() + headlessRetryDelay(count) });
  }

  // 会话仍在宿主里运行，只是后台跟踪暂时不可用：条目降为 error，
  // 面板不再显示「执行中」；退避重建成功后会由新的快照恢复为 running。
  function markEntryTrackingError(projectId) {
    const existing = findEntry(projectId);
    if (!existing || existing.status === "done") return;
    upsertEntry({ ...existing, phase: "error", status: "error", error: "", updatedAt: nowMs() });
  }

  function writeEntries() {
    // 初始登记没有成功读出时暂停写盘：flush 与 dispose 都走这里，
    // 单点闸门即可避免空表或残缺表覆盖磁盘上的其它项目记录。
    if (!loaded) return;
    const entries = currentEntries().map((entry) => ({ ...entry }));
    try {
      // api.storage.setJson 是同步适配器（内部调用 GM_setValue），不能当 Promise 链式处理。
      api.storage.setJson(MONITOR_KEY, { version: MONITOR_VERSION, entries });
    } catch {
      // 监控登记写入失败不阻断主流程：面板仍按内存状态工作。
    }
  }

  // 防抖负责合并短时间内的连续变化，上限计时保证持续变化时也能定期落盘。
  function flushEntries() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = 0;
    if (saveMaxTimer) clearTimeout(saveMaxTimer);
    saveMaxTimer = 0;
    if (disposed) return;
    writeEntries();
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushEntries, SAVE_DEBOUNCE_MS);
    if (!saveMaxTimer) saveMaxTimer = setTimeout(flushEntries, SAVE_MAX_WAIT_MS);
  }

  function setEntries(entries) {
    store.set({ entries: pruneMonitorEntries(entries) });
    scheduleSave();
  }

  function upsertEntry(entry) {
    const existing = findEntry(entry.projectId);
    // 同一项目出现新的执行轮次：上一轮遗留的「暂存中 / 确认清理」临时动作必须作废，
    // 否则新条目会继承一次未经确认的清理点击（delete 不可逆）。
    if (existing && existing.conversationId !== entry.conversationId) {
      setAction(entry.projectId, {
        stage: undefined,
        cleanup: undefined,
        cleanupConversationId: undefined,
      });
    }
    // 新一轮会顶掉上一轮条目：旧轮若还有未完成的自动暂存 / 清理，把这条信息带到新条目上。
    // 旧轮会话记录已被新一轮替换，面板无法再对它执行补做，因此只保留只读提示与旧会话 id。
    // 分批续批与修复转自动复审属于同一条链，由链尾统一收尾，不再生成提示；链内残留提示每次快照都会清掉。
    // 显式传入 carryover（含 null）时以调用方为准：用户点「知道了」就是清掉提示。
    const carried = resolveCarryover(existing, entry);
    const next = { ...entry, carryover: carried };
    if (existing && sameEntryFields(existing, next)) return;
    setEntries(mergeMonitorEntry(currentEntries(), next));
  }

  // 面板动作状态：只保留有值的键，避免空对象堆积。
  function setAction(projectId, patch) {
    const actions = store.get().actions || {};
    const next = { ...(actions[projectId] || {}), ...patch };
    for (const key of Object.keys(next)) {
      if (next[key] === undefined || next[key] === null) delete next[key];
    }
    const merged = { ...actions };
    if (Object.keys(next).length) merged[projectId] = next;
    else delete merged[projectId];
    store.set({ actions: merged });
  }

  // 操作结果直接留在面板条目上：工作台没打开时 toast 不可见，用户需要看到执行结果。
  function setNotice(projectId, kind, text) {
    if (!projectId || !text) return;
    const timer = noticeTimers.get(projectId);
    if (timer) clearTimeout(timer);
    store.set({ notices: { ...(store.get().notices || {}), [projectId]: { kind, text } } });
    noticeTimers.set(
      projectId,
      setTimeout(() => {
        noticeTimers.delete(projectId);
        if (disposed) return;
        const current = store.get().notices || {};
        if (current[projectId]?.text !== text) return;
        const next = { ...current };
        delete next[projectId];
        store.set({ notices: next });
      }, 8000),
    );
  }

  // 批量操作状态与结果：只存在内存，面板关闭后自然消失。
  function setBulk(patch) {
    store.set({ bulk: { ...(store.get().bulk || {}), ...patch } });
  }

  function setBulkNotice(kind, text) {
    if (!text) return;
    setBulk({ notice: { kind, text } });
    if (bulkNoticeTimer) clearTimeout(bulkNoticeTimer);
    bulkNoticeTimer = setTimeout(() => {
      bulkNoticeTimer = 0;
      if (disposed) return;
      setBulk({ notice: null });
    }, 12000);
  }

  // 批量结果同时写主引擎 toast：全部条目清理完后面板会整块消失，
  // 只留在面板上的提示用户就看不到了。
  function showBulkResult(kind, text) {
    setBulkNotice(kind, text);
    if (mainEngine && typeof mainEngine.showToast === "function") mainEngine.showToast(kind, text);
  }

  function removeEntry(projectId) {
    const next = currentEntries().filter((entry) => entry.projectId !== projectId);
    if (next.length === currentEntries().length) return;
    setEntries(next);
    // 条目消失后同一项目还可能挂回新一轮：临时动作不能跨条目生命周期留存。
    setAction(projectId, {
      stage: undefined,
      cleanup: undefined,
      cleanupConversationId: undefined,
    });
  }

  function engineFor(projectId) {
    if (mainEngine?.store?.get()?.project?.directoryId === projectId) return mainEngine;
    return headlessEngines.get(projectId) || null;
  }

  function hasEngine(projectId) {
    return Boolean(engineFor(projectId));
  }

  // 三个会话动作都依赖引擎快照里的 activity：装载窗口内 activity 仍为空，
  // 引擎侧会直接 return 且不产生任何可观察结果，按钮看起来像点了没反应。
  function isEngineActionReady(engine) {
    const snapshot = engine?.store?.get();
    return Boolean(snapshot) && snapshot.status === "ready" && Boolean(snapshot.activity);
  }

  function stopHeadless(projectId, options = {}) {
    // keepRetry：只停引擎，保留失败退避记录与待执行定时器。
    // 后台引擎因错误快照被停止时必须使用，否则失败计数每轮都被清零，
    // 指数退避会退化成固定 15 秒重建。主引擎接管、用户放弃与项目移除仍按默认清理。
    if (!options.keepRetry) clearHeadlessRetry(projectId);
    const engine = headlessEngines.get(projectId);
    if (!engine) return;
    headlessEngines.delete(projectId);
    const unsubscribe = headlessSubscriptions.get(projectId);
    headlessSubscriptions.delete(projectId);
    if (unsubscribe) unsubscribe();
    let flush = null;
    try {
      // unmount 返回已入队的写盘链：主引擎接管该项目前会 await 它，
      // 避免后台引擎的在途保存与接管方读盘交错后被旧快照覆盖。
      flush = engine.unmount();
    } catch {
      // 引擎已卸载时忽略。
    }
    // 引擎可用性决定条目按钮（继续跟踪 / 重新解析）：通知面板重算。
    if (!disposed) store.set({});
    return flush;
  }

  async function ensureHeadless(projectId, options = {}) {
    if (disposed || !projectId) return null;
    const mainProject = mainEngine?.store?.get()?.project?.directoryId;
    if (mainProject === projectId) return null;
    const existing = headlessEngines.get(projectId);
    if (existing) return existing;
    // 失败退避窗口内不重建：主引擎的快照会持续触发本函数，没有这道门
    // 就会在每次快照时重复创建同一项目的后台引擎并再次失败。
    // 用户主动恢复（force）时清掉旧失败记录与待执行定时器，重新开始退避序列。
    if (options.force) clearHeadlessRetry(projectId);
    const failure = headlessFailures.get(projectId);
    if (!options.force && failure && failure.nextAt > nowMs()) {
      scheduleHeadlessRetry(projectId);
      return null;
    }
    const engine = createHeadlessEngine(api, projectId);
    headlessEngines.set(projectId, engine);
    headlessSubscriptions.set(
      projectId,
      engine.store.subscribe((snapshot) => handleEngineSnapshot(projectId, snapshot, false)),
    );
    // 引擎可用性决定条目按钮（继续跟踪 / 重新解析）：创建后立即让面板重算。
    store.set({});
    await engine.mount().catch(() => {
      // 项目不可用等错误由快照状态体现，面板会移除失效条目或安排重试。
    });
    // 挂载期间可能已因错误快照被停止：不要把已销毁的引擎交回调用方。
    if (headlessEngines.get(projectId) !== engine) return null;
    return engine;
  }

  function dismissRecord(projectId, snapshot) {
    const dismissed = snapshot?.dismissedActivity;
    if (!dismissed?.conversationId) return false;
    const entry = findEntry(projectId);
    if (entry && entry.conversationId === dismissed.conversationId) {
      removeEntry(projectId);
      return true;
    }
    return false;
  }

  function applySnapshot(projectId, snapshot) {
    if (!projectId || !snapshot || snapshot.status !== "ready") return;
    if (dismissRecord(projectId, snapshot)) return;
    const entry = buildMonitorEntry(snapshot);
    if (entry) {
      upsertEntry(entry);
      return;
    }
    // 没有活动卡片：校验已登记的运行中条目是否还对应真实会话。
    // 后台引擎恢复一个已完成 / 已清理的项目时，不能让它永远停在「执行中」。
    const existing = findEntry(projectId);
    if (!existing) return;
    // 引擎读盘失败：快照里的空台账不代表会话已经结束，不能据此判定退休或删除条目。
    // 保留 conversationId 与「打开会话」入口，等下一次成功读盘后由正常快照恢复。
    if (snapshot.stateUnavailable === true) {
      if (existing.status === "running") {
        upsertEntry({
          ...existing,
          phase: "error",
          status: "error",
          error: t("fx.monitor.stateUnreadable"),
          updatedAt: nowMs(),
        });
      }
      return;
    }
    // 会话已被「处理结果」归档 / 删除：工作台台账里不再有这条会话，
    // 条目上的「打开会话」与「处理结果」入口都已失效，必须随之移除；
    // 后台引擎恢复项目或页面重载后同样适用，清理过的记录不会重新挂回面板。
    if (isMonitorEntryRetired(existing, snapshot.state)) {
      removeEntry(projectId);
      return;
    }
    const recovered = buildRecoveredMonitorEntry(snapshot);
    if (!recovered) {
      if (existing.status === "running") removeEntry(projectId);
      return;
    }
    if (recovered.status === "detached") {
      if (existing.status === "running" || existing.conversationId === recovered.conversationId) {
        removeEntry(projectId);
      }
      return;
    }
    if (existing.status !== "running" && existing.conversationId !== recovered.conversationId) return;
    if (existing.conversationId !== recovered.conversationId && recovered.status !== "running") {
      removeEntry(projectId);
      return;
    }
    upsertEntry(recovered);
  }

  function handleEngineSnapshot(projectId, snapshot, isMain) {
    if (disposed) return;
    // 后台引擎的自动暂存 / 自动清理没有渲染器：把新的提示镜像到条目上，
    // 收尾失败或需要人工处理时用户能在面板直接看到原因。
    if (!isMain && snapshot?.status === "ready") {
      const toast = snapshot.toast || null;
      if (toast?.text && headlessToasts.get(projectId) !== toast) {
        headlessToasts.set(projectId, toast);
        setNotice(projectId, String(toast.kind || "info"), String(toast.text));
      }
    }
    if (isMain) {
      const nextProjectId = snapshot?.project?.directoryId || "";
      if (nextProjectId !== mainProjectId) {
        const previous = mainProjectId;
        mainProjectId = nextProjectId;
        store.set({ currentProjectId: nextProjectId });
        // 主引擎切走后旧项目仍保留未完成记录：交给后台引擎继续跟踪或提供恢复入口。
        if (previous && previous !== nextProjectId) {
          const previousEntry = findEntry(previous);
          if (previousEntry && previousEntry.status !== "done") void ensureHeadless(previous);
        }
        // 主引擎接管当前项目后，同项目的后台引擎必须停止，避免两个引擎同时写状态。
        if (nextProjectId) stopHeadless(nextProjectId);
      }
    }
    if (snapshot?.status === "error" && !isMain) {
      const directories = Array.isArray(snapshot?.projects?.directories) ? snapshot.projects.directories : [];
      const mainProjects = mainEngine?.store?.get()?.projects;
      const mainDirectories = Array.isArray(mainProjects?.directories) ? mainProjects.directories : [];
      // 宿主项目列表短暂不可用（域缺失 / 读取失败）时会把正常项目判成 project-missing：
      // 只有后台引擎与主引擎都读到非空列表、且都不含该项目时，才确认项目已从宿主移除。
      const confirmedMissing =
        snapshot.error === "project-missing" &&
        directories.length > 0 &&
        !directories.some((item) => item.directoryId === projectId) &&
        mainDirectories.length > 0 &&
        !mainDirectories.some((item) => item.directoryId === projectId);
      // 项目确认已从宿主移除：连退避记录一起清掉，不再安排重建；
      // 其它错误（含列表不可信）保留失败序列，让重建间隔按 15s / 30s / 60s ... 递增。
      stopHeadless(projectId, { keepRetry: !confirmedMissing });
      if (confirmedMissing) {
        removeEntry(projectId);
        return;
      }
      // 这里必须沿用 stopHeadless 保留的失败记录，计数才能持续递增。
      recordHeadlessFailure(projectId);
      markEntryTrackingError(projectId);
      scheduleHeadlessRetry(projectId);
      return;
    }
    if (!isMain && snapshot?.status === "ready") clearHeadlessRetry(projectId);
    applySnapshot(snapshot?.project?.directoryId || projectId, snapshot);
    if (isMain && (snapshot?.status === "ready" || snapshot?.status === "no-project")) {
      // 页面重载 / 宿主没有打开项目时恢复非当前项目的未完成条目：
      // 主引擎就绪后再创建后台引擎，避免与主引擎正在载入的项目重复跟踪；
      // 已完成条目只保留面板展示。
      for (const entry of currentEntries()) {
        // 只恢复运行中 / 跟踪中断的条目：用户显式停止跟踪（detached）后不自动重建引擎。
        if (
          (entry.status === "running" || entry.status === "error") &&
          entry.projectId !== mainProjectId
        ) {
          void ensureHeadless(entry.projectId);
        }
      }
    }
  }

  // 升级兼容：旧版本写入的已完成条目没有本轮冻结的自动化开关，恢复登记后
  // 从对应项目的持久化状态补齐一次，否则面板不会出现「暂存改动」入口。
  // 本轮两个开关确实都关闭时读取结果相同，不会产生额外写入。
  async function hydrateFinishedEntries() {
    const targets = currentEntries().filter(
      (entry) =>
        entry.status === "done" && !entry.stageEnabled && !entry.autoCleanup && !entry.stageState,
    );
    for (const entry of targets) {
      let state = null;
      try {
        state = await api.storage.getJson(STORE_PREFIX + entry.projectId);
      } catch {
        continue;
      }
      if (disposed) return;
      const session = state?.sessions?.[entry.kind] || null;
      if (!session) continue;
      // 持久化状态只保留每种会话的最新一轮：会话 id 不一致说明项目已进入新一轮，
      // 旧条目不能继承这一轮的自动化开关（面板按钮实际作用于当前会话）。
      if (String(session.conversationId || "") !== String(entry.conversationId || "")) continue;
      const fixConversationId =
        entry.kind === "verify"
          ? String(session.fixConversationId || "")
          : String(session.conversationId || "");
      // 读取期间登记可能已被新的快照替换：只在会话仍是同一条时补齐。
      const current = findEntry(entry.projectId);
      if (!current || current.conversationId !== entry.conversationId) continue;
      if (current.stageEnabled || current.autoCleanup || current.stageState) continue;
      upsertEntry({
        ...current,
        stageEnabled: Boolean(session.stageEnabled),
        autoCleanup: Boolean(session.autoCleanup),
        stageState: String(session.stageRunState || ""),
        stageRunAt: numberOr(session.stageRunAt),
        cleanupState:
          fixConversationId &&
          String(state?.cleanupRun?.fixConversationId || "") === fixConversationId
            ? "done"
            : "",
        updatedAt: nowMs(),
      });
    }
  }

  async function start() {
    if (started) return;
    started = true;
    if (!mainEngine?.store) {
      store.set({ ready: true });
      return;
    }
    let raw = null;
    let loadError = null;
    try {
      raw = await api.storage.getJson(MONITOR_KEY);
      // 只有读取成功才允许写盘：读取失败时把内存登记写回会覆盖其它项目的记录。
      loaded = true;
    } catch (error) {
      loadError = error;
    }
    if (disposed) return;
    // 先保留持久化条目，再由主引擎快照校正当前项目与无效条目。
    // 折叠与钉住都是会话内状态，不落盘：每次启动都先收成胶囊，面板只在用户主动展开后出现。
    store.set({
      // 读取失败时不能把「读不到」当成「没有记录」：内存条目从空表开始，但 loaded 保持 false，
      // writeEntries 会跳过写入，直到本次会话结束都不会覆盖磁盘上的其它项目记录。
      entries: loaded ? pruneMonitorEntries(normalizeMonitorData(raw)) : [],
      collapsed: true,
      pinned: false,
      ready: true,
      registryUnavailable: Boolean(loadError),
    });
    // 旧版本的已完成条目没有开关字段：恢复后补齐一次，面板才能显示补做入口。
    void hydrateFinishedEntries();
    mainProjectId = mainEngine.store.get()?.project?.directoryId || "";
    store.set({ currentProjectId: mainProjectId });
    // 主引擎切换项目前先停掉同项目的后台引擎，避免两个引擎同时写同一个项目状态。
    if (typeof mainEngine.setProjectSwitchHook === "function") {
      mainEngine.setProjectSwitchHook((projectId) => stopHeadless(projectId));
    }
    mainSubscription = mainEngine.store.subscribe((snapshot) =>
      handleEngineSnapshot(snapshot?.project?.directoryId || "", snapshot, true),
    );
    handleEngineSnapshot(mainProjectId, mainEngine.store.get(), true);
  }

  function toggleCollapsed(value) {
    const collapsed = typeof value === "boolean" ? value : !store.get().collapsed;
    // 工作台可见时展开监控会立刻被浮层盖住：先收起工作台，让这次点击有可见结果。
    if (!collapsed && store.get().workbenchVisible) hideWorkbench();
    store.set({ collapsed });
  }

  // 工作台显隐由脚本装载层通知：可见期间监控必须收成胶囊。
  // 展开面板与工作台浮层几何重叠且层级更低，重叠区内的按钮既点不到、又会被 Tab 聚焦，
  // 只提高 z-index 会反过来吞掉浮层头部按钮的点击，因此按可见性收起而不是抬层级。
  // pinned 是用户在面板里表达的持久意图，这里不改写，关闭工作台后用户可以自行展开。
  function setWorkbenchVisible(value) {
    const next = Boolean(value);
    if (store.get().workbenchVisible === next) return;
    store.set(next ? { workbenchVisible: true, collapsed: true } : { workbenchVisible: false });
  }

  // 钉住时保持展开：点击面板外部不再自动收起；取消钉住后恢复自动折叠行为。
  function togglePinned(value) {
    const pinned = typeof value === "boolean" ? value : !store.get().pinned;
    store.set(pinned ? { pinned, collapsed: false } : { pinned });
  }

  async function openWorkbench(projectId) {
    showWorkbench();
    if (!projectId) return;
    if (mainEngine.store.get()?.project?.directoryId !== projectId) {
      await mainEngine.activateProject(projectId);
    }
  }

  async function openCleanup(projectId) {
    await openWorkbench(projectId);
    if (mainEngine.store.get()?.project?.directoryId !== projectId) return;
    mainEngine.openCleanupDialog();
  }

  // 宿主只认当前项目下的会话：先切到目标项目再激活会话，否则跨项目打开会失败。
  async function openSession(projectId, conversationId) {
    if (!conversationId) return;
    if (projectId && mainEngine.store.get()?.project?.directoryId !== projectId) {
      await mainEngine.activateProject(projectId);
    }
    const engine = engineFor(projectId) || mainEngine;
    await engine.openConversation(conversationId);
  }

  async function stop(projectId) {
    const engine = engineFor(projectId);
    let engineLoading = false;
    if (engine) {
      if (isEngineActionReady(engine)) {
        await engine.detachTracking();
        return;
      }
      // 装载中的引擎 activity 仍为空，引擎侧无法接收停止；直接卸载，避免 mount 完成后
      // resumeTracking 重新开始跟踪，把用户的停止动作撤销。已就绪但没有活动卡片时
      // 没有可停止的会话，继续走下面的面板侧兜底。
      engineLoading = engine.store.get()?.status !== "ready";
      if (engineLoading) stopHeadless(projectId);
    }
    // 该项目已没有可用引擎（例如项目元数据读不到、后台引擎已停止）：面板无法替宿主会话
    // 停止读取，只能停掉本面板的跟踪。会话可能仍在运行，必须保留条目与「打开会话 /
    // 打开工作台」入口，否则这一轮再也找不回来。
    const entry = findEntry(projectId);
    if (!entry || entry.status !== "running") return;
    // 不写 lastUpdateAt：停止跟踪不是新进展，避免龄期显示成「刚刚」。
    upsertEntry({ ...entry, phase: "detached", status: "detached", updatedAt: nowMs() });
    setNotice(
      projectId,
      "info",
      t(engineLoading ? "fx.monitor.detachNotReady" : "fx.monitor.detachNoEngine"),
    );
  }

  async function resume(projectId) {
    const current = engineFor(projectId);
    if (current && !isEngineActionReady(current)) {
      setNotice(projectId, "info", t("fx.monitor.actionNotReady"));
      return;
    }
    // 后台引擎可能因创建失败已被移除：用户主动恢复时强制重建一次，不受退避窗口限制。
    const engine = current || (await ensureHeadless(projectId, { force: true }));
    if (!engine) {
      // 项目状态读不到或重建期间被停止：必须给出原因，不能让按钮点了没有任何反应。
      setNotice(projectId, "error", t("fx.toast.resumeTrackingUnavailable"));
      return;
    }
    // 重建完成但快照里仍没有活动记录：引擎侧会静默返回，这里明确说明原因。
    if (!isEngineActionReady(engine)) {
      setNotice(projectId, "info", t("fx.monitor.actionNotReady"));
      return;
    }
    try {
      await engine.resumeActivityTracking();
    } catch {
      setNotice(projectId, "error", t("fx.toast.resumeTrackingUnavailable"));
    }
  }

  async function retry(projectId) {
    const current = engineFor(projectId);
    if (current && !isEngineActionReady(current)) {
      setNotice(projectId, "info", t("fx.monitor.actionNotReady"));
      return;
    }
    const engine = current || (await ensureHeadless(projectId, { force: true }));
    if (!engine) {
      setNotice(projectId, "error", t("fx.toast.retryParseUnavailable"));
      return;
    }
    if (!isEngineActionReady(engine)) {
      setNotice(projectId, "info", t("fx.monitor.actionNotReady"));
      return;
    }
    try {
      await engine.retryParse();
    } catch {
      setNotice(projectId, "error", t("fx.toast.retryParseUnavailable"));
    }
  }

  // 用户在面板上显式补做自动暂存：主引擎与后台引擎共用同一实现，
  // 用户不需要知道当前由哪个引擎跟踪。执行期间按钮显示「暂存中」，
  // 结果直接留在条目上（工作台浮层关闭时 toast 不可见）。
  // 单条按钮与批量入口共用本函数：options.claimed 表示批量入口已预先占位。
  async function executeStage(projectId, options = {}) {
    const pending = (store.get().actions || {})[projectId] || {};
    if (!options.claimed && pending.stage === "running") return "running";
    const entry = findEntry(projectId);
    // SSH 项目无法暂存：直接说明原因，不要落到通用的「暂存失败」提示。
    if (entry?.stageSupported === false) {
      setNotice(projectId, "info", t("fx.monitor.stageUnsupported"));
      return "empty";
    }
    setAction(projectId, { stage: "running" });
    try {
      const engine = engineFor(projectId) || (await ensureHeadless(projectId, { force: true }));
      if (!engine) {
        setNotice(projectId, "error", t("fx.toast.stageManualUnavailable"));
        return "error";
      }
      // 暂存明细（实际暂存 / 未暂存的文件名）由引擎写在它自己的 toast 里：
      // 后台引擎的 toast 没有渲染器，这里取本次调用新写入的那条作为条目提示。
      const beforeToast = engine.store?.get?.().toast || null;
      const outcome =
        typeof engine.stageRunManually === "function" ? await engine.stageRunManually() : "empty";
      const written = engine.store?.get?.().toast || null;
      // 去重命中时不会写新 toast：对象身份比较避免把上一条旧提示当成本次结果。
      const detail = written && written !== beforeToast ? written : null;
      let kind = "error";
      let text = t("fx.toast.stageManualFailed");
      if (detail && detail.text) {
        kind = String(detail.kind || "info");
        text = String(detail.text);
      } else if (outcome === "done") {
        kind = "success";
        text = t("fx.toast.stageManualDone");
      } else if (outcome === "empty") {
        kind = "info";
        text = t("fx.toast.stageManualEmpty");
      } else if (outcome === "deferred") {
        kind = "info";
        text = t("fx.toast.stageManualDeferred");
      }
      setNotice(projectId, kind, text);
      // 与 confirmCleanup 一致：后台引擎的提示要镜像到主引擎，条目退休后仍能看到明细。
      if (detail && engine !== mainEngine && typeof mainEngine?.showToast === "function") {
        mainEngine.showToast(kind, text);
      }
      return String(outcome || "error");
    } catch {
      setNotice(projectId, "error", t("fx.toast.stageManualFailed"));
      return "error";
    } finally {
      setAction(projectId, { stage: undefined });
    }
  }

  async function stageRun(projectId) {
    return await executeStage(projectId);
  }

  // 批量补做暂存：一次处理所有「已完成且仍有待暂存改动」的项目。
  // 不切换项目、不打开会话，逐个项目交给它自己的引擎执行；单个失败不影响后续项目。
  async function stageAll() {
    const bulk = store.get().bulk || {};
    if (bulk.stage === "running" || bulk.cleanup === "running" || bulk.cleanup === "confirm") return;
    const targets = bulkStageTargets(currentEntries()).map((entry) => entry.projectId);
    if (!targets.length) {
      setBulkNotice("info", t("fx.monitor.bulkStageEmpty"));
      return;
    }
    // 先逐个占位：批量执行期间条目上的单条按钮同步显示「暂存中」，不会重复触发。
    for (const projectId of targets) setAction(projectId, { stage: "running" });
    setBulk({ stage: "running", notice: null });
    let done = 0;
    let failed = 0;
    let skipped = 0;
    for (const projectId of targets) {
      if (disposed) break;
      const outcome = await executeStage(projectId, { claimed: true });
      if (outcome === "done") done += 1;
      else if (outcome === "error") failed += 1;
      else skipped += 1;
    }
    setBulk({ stage: "", notice: null });
    const values = { done, failed, skipped, total: targets.length };
    if (failed) showBulkResult("error", t("fx.monitor.bulkStageFailed", values));
    else if (skipped) showBulkResult("info", t("fx.monitor.bulkStageSkipped", values));
    else showBulkResult("success", t("fx.monitor.bulkStageDone", values));
  }

  // 面板内清理：先点「清理」进入确认态，再点「确认清理」才执行，不跳转工作台。
  // 清理范围沿用本轮冻结的自动清理设置（动作与会话范围），与自动收尾完全一致。
  function beginCleanup(projectId) {
    const entry = findEntry(projectId);
    setAction(projectId, {
      cleanup: "confirm",
      // 记录用户点「清理」的那一轮：条目被新一轮替换后，这次确认必须作废。
      cleanupConversationId: String(entry?.conversationId || ""),
    });
  }

  function cancelCleanup(projectId) {
    setAction(projectId, { cleanup: undefined, cleanupConversationId: undefined });
  }

  // 单个项目的清理执行：清理范围与动作沿用本轮冻结的自动清理设置。
  // 单条确认与批量入口共用本函数；options.claimed 表示调用方已预先占位。
  async function executeCleanup(projectId, options = {}) {
    const pending = (store.get().actions || {})[projectId] || {};
    if (!options.claimed && pending.cleanup === "running") return { status: "running" };
    const entry = findEntry(projectId);
    if (!entry) {
      // 批量占位后条目可能已被清理 / 关闭：清掉占位，避免 actions 永久停在 running。
      setAction(projectId, { cleanup: undefined, cleanupConversationId: undefined });
      return { status: "empty" };
    }
    setAction(projectId, { cleanup: "running", cleanupConversationId: entry.conversationId });
    try {
      const engine = engineFor(projectId) || (await ensureHeadless(projectId, { force: true }));
      if (!engine) {
        setNotice(projectId, "error", t("fx.toast.cleanupManualUnavailable"));
        return { status: "error" };
      }
      const result =
        typeof engine.cleanupRunManually === "function"
          ? await engine.cleanupRunManually()
          : { status: "empty" };
      const status = String(result?.status || "empty");
      if (status === "done") {
        const values = {
          count: Math.max(0, Number(result?.issues) || 0),
          sessions: Math.max(0, Number(result?.sessions) || 0),
          skipped: Math.max(0, Number(result?.skipped) || 0),
          baseline: Math.max(0, Number(result?.baseline) || 0),
        };
        const outcome = {
          status: "done",
          action: result?.action,
          issues: values.count,
          sessions: values.sessions,
          // 部分会话 / issue 清理失败时仍是 done（副作用可能已发生），但批量统计要单列失败。
          failed: Boolean(result?.error),
          kind: "success",
          text: "",
        };
        if (result?.error) {
          outcome.kind = "error";
          outcome.text = t("fx.toast.cleanupManualFailed", { error: result.error });
          setNotice(projectId, outcome.kind, outcome.text);
          return outcome;
        }
        // 文案优先级与引擎收尾一致：删除降级 > 基准缺失 > 常规归档 / 删除。
        // 降级与跳过必须显式说明，否则「已清理 N 条 issue，M 个会话」会被误读成删除已执行。
        const deleting = result?.action === "delete";
        let kind = "success";
        let key = deleting ? "fx.toast.autoCleanupDeleted" : "fx.toast.autoCleanupDone";
        if (result?.downgraded === true) {
          key = "fx.toast.autoCleanupDowngraded";
          kind = "error";
        } else if (values.baseline > 0) {
          key = deleting
            ? values.skipped > 0
              ? "fx.toast.autoCleanupBaselineDeletedSkipped"
              : "fx.toast.autoCleanupBaselineDeleted"
            : values.skipped > 0
              ? "fx.toast.autoCleanupBaselineArchivedSkipped"
              : "fx.toast.autoCleanupBaselineArchived";
          kind = "error";
        } else if (values.skipped > 0) {
          key = deleting ? "fx.toast.autoCleanupDeletedSkipped" : "fx.toast.autoCleanupDoneSkipped";
          kind = "info";
        }
        outcome.kind = kind;
        outcome.text = t(key, values);
        setNotice(projectId, kind, outcome.text);
        // 后台引擎的 toast 没有渲染器订阅：补写主引擎 toast，条目随清理退休后仍能看到原因。
        if (engine !== mainEngine && typeof mainEngine?.showToast === "function") {
          mainEngine.showToast(kind, outcome.text);
        }
        return outcome;
      }
      if (status === "deferred") {
        setNotice(projectId, "info", t("fx.toast.cleanupManualDeferred"));
        return { status: "deferred" };
      }
      setNotice(projectId, "info", t("fx.toast.cleanupManualEmpty"));
      return { status: "empty" };
    } catch {
      setNotice(projectId, "error", t("fx.toast.cleanupManualFailed", { error: "unexpected error" }));
      return { status: "error" };
    } finally {
      setAction(projectId, { cleanup: undefined, cleanupConversationId: undefined });
    }
  }

  async function confirmCleanup(projectId) {
    const pending = (store.get().actions || {})[projectId] || {};
    if (pending.cleanup === "running") return;
    // 确认态必须仍属于当前条目：条目已被新一轮替换时，这次点击不能落到用户没看过的轮次上。
    const entry = findEntry(projectId);
    if (!pending.cleanupConversationId || pending.cleanupConversationId !== entry?.conversationId) {
      setAction(projectId, { cleanup: undefined, cleanupConversationId: undefined });
      return;
    }
    return await executeCleanup(projectId);
  }

  // 批量清理：先进入一次汇总确认态，确认后逐个项目执行。
  // 汇总在渲染时按当前条目实时计算，执行时重新取候选：期间被新一轮顶掉的项目会自动排除。
  function beginCleanupAll() {
    const bulk = store.get().bulk || {};
    if (bulk.stage === "running" || bulk.cleanup === "running") return;
    if (!bulkCleanupTargets(currentEntries()).length) {
      setBulkNotice("info", t("fx.monitor.bulkCleanupEmpty"));
      return;
    }
    setBulk({ cleanup: "confirm", notice: null });
  }

  function cancelCleanupAll() {
    if ((store.get().bulk || {}).cleanup === "running") return;
    setBulk({ cleanup: "" });
  }

  async function confirmCleanupAll() {
    if ((store.get().bulk || {}).cleanup !== "confirm") return;
    const targets = bulkCleanupTargets(currentEntries()).map((entry) => entry.projectId);
    if (!targets.length) {
      setBulk({ cleanup: "" });
      setBulkNotice("info", t("fx.monitor.bulkCleanupEmpty"));
      return;
    }
    // 先占位再执行：确认后立即锁住每个条目的单条入口，避免同一轮被并发处理两次。
    for (const projectId of targets) {
      const entry = findEntry(projectId);
      setAction(projectId, { cleanup: "running", cleanupConversationId: entry?.conversationId });
    }
    setBulk({ cleanup: "running", notice: null });
    let done = 0;
    let failed = 0;
    let skipped = 0;
    let issues = 0;
    let sessions = 0;
    for (const projectId of targets) {
      if (disposed) break;
      const result = await executeCleanup(projectId, { claimed: true });
      if (result.status === "done") {
        if (result.failed) failed += 1;
        else done += 1;
        issues += Math.max(0, Number(result.issues) || 0);
        sessions += Math.max(0, Number(result.sessions) || 0);
      } else if (result.status === "error") {
        failed += 1;
      } else {
        skipped += 1;
      }
    }
    setBulk({ cleanup: "", notice: null });
    const values = { done, failed, skipped, issues, sessions, total: targets.length };
    if (failed) showBulkResult("error", t("fx.monitor.bulkCleanupFailed", values));
    else if (skipped) showBulkResult("info", t("fx.monitor.bulkCleanupSkipped", values));
    else showBulkResult("success", t("fx.monitor.bulkCleanupDone", values));
  }

  // 用户确认上一轮遗留的自动收尾已经处理：只清掉提示，不改动任何会话或 Git 状态。
  function dismissCarryover(projectId) {
    const entry = findEntry(projectId);
    if (!entry || !entry.carryover) return;
    upsertEntry({ ...entry, carryover: null, updatedAt: nowMs() });
  }

  async function dismiss(projectId) {
    const engine = engineFor(projectId);
    if (engine) {
      await engine.dismissActivity();
      if (headlessEngines.has(projectId)) stopHeadless(projectId);
    }
    setAction(projectId, {
      stage: undefined,
      cleanup: undefined,
      cleanupConversationId: undefined,
    });
    const noticeTimer = noticeTimers.get(projectId);
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimers.delete(projectId);
    const notices = { ...(store.get().notices || {}) };
    delete notices[projectId];
    store.set({ notices });
    removeEntry(projectId);
  }

  // 面板渲染用的批量计划：候选与条目按钮共用同一套判定，汇总与时序无关。
  function bulkPlan() {
    const entries = currentEntries();
    const stage = bulkStageTargets(entries);
    const cleanup = bulkCleanupTargets(entries);
    return { stage, cleanup, summary: cleanupPlanSummaryOf(cleanup) };
  }

  function dispose() {
    disposed = true;
    for (const timer of headlessRetryTimers.values()) clearTimeout(timer);
    headlessRetryTimers.clear();
    headlessFailures.clear();
    for (const timer of noticeTimers.values()) clearTimeout(timer);
    noticeTimers.clear();
    if (bulkNoticeTimer) clearTimeout(bulkNoticeTimer);
    bulkNoticeTimer = 0;
    headlessToasts.clear();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = 0;
    if (saveMaxTimer) clearTimeout(saveMaxTimer);
    saveMaxTimer = 0;
    // debounce 窗口内刚完成的状态在卸载前补写一次；尚未完成初始读取时不写，避免空登记覆盖历史。
    if (loaded) writeEntries();
    if (mainEngine && typeof mainEngine.setProjectSwitchHook === "function") {
      mainEngine.setProjectSwitchHook(null);
    }
    if (mainSubscription) mainSubscription();
    mainSubscription = null;
    for (const unsubscribe of headlessSubscriptions.values()) unsubscribe();
    headlessSubscriptions.clear();
    for (const engine of headlessEngines.values()) {
      try {
        engine.unmount();
      } catch {
        // 忽略卸载失败。
      }
    }
    headlessEngines.clear();
  }

  return {
    store,
    start,
    dispose,
    toggleCollapsed,
    togglePinned,
    setWorkbenchVisible,
    openWorkbench,
    openCleanup,
    openSession,
    stop,
    resume,
    retry,
    stageRun,
    stageAll,
    beginCleanup,
    cancelCleanup,
    confirmCleanup,
    beginCleanupAll,
    cancelCleanupAll,
    confirmCleanupAll,
    bulkPlan,
    dismiss,
    dismissCarryover,
    hasEngine,
    engineFor,
  };
}
