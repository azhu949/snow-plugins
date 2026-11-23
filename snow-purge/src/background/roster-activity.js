// 编队活动：尝试从宿主 conversations 元数据里找出各角色子代理跑过的会话，汇总成状态卡。
// 宿主当前只返回主会话（原生查询排除 sub_agent_sessions，子代理字段是空字面量），
// 因此取不到角色级数据时如实返回 available:false，面板显示「未提供运行数据」，不拿 0 值冒充。
import { REDTEAM_ROSTER } from "../shared/redteam-roster.js";
import { readSessionOutcome } from "../shared/roster-session.js";

const PREVIEW_CHARS = 160;

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const stamp = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const cleanText = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PREVIEW_CHARS);

/** 会话记录里的子代理身份：subAgentId 优先，其次按名称匹配（宿主旧版本可能只写名称）。 */
const matchesRole = (record, role) => {
  const id = typeof record?.subAgentId === "string" ? record.subAgentId.trim() : "";
  if (id) return id === role.id;
  const name = typeof record?.subAgentName === "string" ? record.subAgentName.trim() : "";
  return Boolean(name) && name === role.name;
};

/**
 * 与任务页、链路共用同一会话判定：子代理会话优先看 subAgentStatus，
 * 没有该字段的旧记录按消息数与最近一次回复兜底；都判不出状态时显示「空闲」。
 */
const pickStatus = (record, live) => {
  if (live) return "running";
  // 与任务页、链路共用同一会话判定；没有可判定状态时仍显示「空闲」。
  const outcome = readSessionOutcome(record);
  if (outcome.status === "running") return "running";
  if (outcome.status === "completed") return "completed";
  if (outcome.status === "failed") return "failed";
  if (outcome.status === "cancelled") return "cancelled";
  return "idle";
};

const summarizeRole = (records, role, streaming) => {
  const scoped = records.filter((record) => matchesRole(record, role));
  if (scoped.length === 0) return null;
  scoped.sort((a, b) => stamp(b.updatedAt) - stamp(a.updatedAt));

  // 有运行中的会话时优先展示它，否则展示最近一次。
  const liveRecord = scoped.find((record) => {
    const key = typeof record.conversationId === "string" ? record.conversationId : "";
    return key ? streaming.has(key) : false;
  });
  const record = liveRecord || scoped[0];
  const conversationId = typeof record.conversationId === "string" ? record.conversationId : "";
  const live = conversationId ? streaming.get(conversationId) || null : null;

  const inputTokens = num(record.inputTokens);
  const outputTokens = num(record.outputTokens);
  return {
    status: pickStatus(record, live),
    model: typeof record.model === "string" ? record.model : "",
    conversationId,
    title: typeof record.title === "string" ? record.title : "",
    totalTokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    totalDurationMs: num(record.totalDurationMs),
    lastRunDurationMs: num(record.lastRunDurationMs),
    requests: num(record.runRequestCount),
    messageCount: num(record.messageCount),
    updatedAt: stamp(record.updatedAt),
    preview: cleanText(record.lastMessagePreview || record.summary),
    error: typeof record.subAgentError === "string" ? cleanText(record.subAgentError) : "",
    live: live
      ? {
          elapsedMs: num(live.elapsedMs),
          tokenCount: num(live.tokenCount),
          ttftMs: num(live.ttftMs),
          startedAt: num(live.startedAt),
        }
      : null,
    runs: scoped.length,
  };
};

/**
 * metadata 读取失败（未声明 conversations 隐私、宿主版本较旧）时返回 available:false，
 * 面板据此显示「宿主未提供运行数据」，而不是把所有人都画成空闲。
 */
export async function readRosterActivity({ metadata, roles = REDTEAM_ROSTER, log = () => {} }) {
  if (!metadata || typeof metadata.get !== "function") {
    return { available: false, reason: "metadata-unavailable", byRole: {}, running: 0, totals: null };
  }

  const [convResult, runtimeResult] = await Promise.allSettled([
    metadata.get("conversations"),
    metadata.get("runtime"),
  ]);

  const convPayload = convResult.status === "fulfilled" ? convResult.value : null;
  const runtimePayload = runtimeResult.status === "fulfilled" ? runtimeResult.value : null;

  if (convResult.status === "rejected") log(`读取会话记录失败：${convResult.reason?.message || convResult.reason}`);
  if (runtimeResult.status === "rejected") log(`读取运行态失败：${runtimeResult.reason?.message || runtimeResult.reason}`);

  const denied = convPayload?.denied?.conversations || null;
  const conv = convPayload?.domains?.conversations || null;
  const items = Array.isArray(conv?.items) ? conv.items : null;
  if (!items) {
    return {
      available: false,
      reason: denied?.reason || "conversations-unavailable",
      byRole: {},
      running: 0,
      totals: null,
    };
  }

  const streaming = new Map();
  const sessions = runtimePayload?.domains?.runtime?.streamingSessions;
  if (Array.isArray(sessions)) {
    for (const item of sessions) {
      const key = typeof item?.conversationId === "string" ? item.conversationId : "";
      if (key) streaming.set(key, item);
    }
  }

  // 宿主是否真的给出了子代理身份：只有出现真实 subAgentId / subAgentName 时才按角色汇总。
  // 当前宿主把这两列写成空字面量，继续往下算只会得到「全员空闲 + 0 指标」。
  const hasSubAgentRecords = items.some((record) => {
    const id = typeof record?.subAgentId === "string" ? record.subAgentId.trim() : "";
    const name = typeof record?.subAgentName === "string" ? record.subAgentName.trim() : "";
    return Boolean(id) || Boolean(name);
  });
  if (!hasSubAgentRecords) {
    return {
      available: false,
      reason: "subagent-sessions-unavailable",
      byRole: {},
      running: 0,
      totals: null,
    };
  }

  const byRole = {};
  let running = 0;
  let totalTokens = 0;
  let totalRequests = 0;
  for (const role of roles) {
    const summary = summarizeRole(items, role, streaming);
    if (!summary) continue;
    byRole[role.id] = summary;
    if (summary.status === "running") running += 1;
    totalTokens += summary.totalTokens;
    totalRequests += summary.requests;
  }

  return {
    available: true,
    reason: "",
    directoryId: typeof conv?.directoryId === "string" ? conv.directoryId : "",
    byRole,
    running,
    totals: { tokens: totalTokens, requests: totalRequests, roles: Object.keys(byRole).length },
  };
}
