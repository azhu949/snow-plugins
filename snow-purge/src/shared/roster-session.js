// 会话结果判定：编队任务页、编队链路与角色活动卡共用同一套口径。
// 宿主的根会话没有 subAgentStatus，只能看消息数与最近一次回复是否为空。

/** 单步 / 单任务的最长等待：超过且仍无回复就按失败处理，避免永久停在排队中。 */
export const TURN_TIMEOUT_MS = 30 * 60 * 1000;
export const TURN_TIMEOUT_MINUTES = Math.round(TURN_TIMEOUT_MS / 60000);

const clean = (value, max) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * 判定一条会话记录的结果。
 * status：unknown（没有记录）| running | pending | completed | failed | cancelled
 * emptyReply：已有消息但最近一次回复为空，多半是回合失败或被中断。
 * waiting：会话声明在等待用户输入（根会话不提供该字段时恒为 false）。
 */
export function readSessionOutcome(record, { previewLimit = 400, waiting: waitingFlag = false } = {}) {
  if (!record) {
    return {
      status: "unknown",
      messages: 0,
      preview: "",
      displayPreview: "",
      error: "",
      emptyReply: false,
      waiting: false,
    };
  }
  const agent = String(record.subAgentStatus || "").trim();
  const messages = num(record.messageCount);
  const preview = clean(record.lastMessagePreview, previewLimit);
  const displayPreview = preview || clean(record.summary, previewLimit);
  const error = clean(record.subAgentError, previewLimit);
  const emptyReply = messages >= 2 && preview === "";
  // waitingFlag 由调用方按宿主的「等待确认」会话集合传入：根会话的 subAgentStatus 恒为空串。
  const waiting = waitingFlag === true || agent === "waiting_input";
  if (agent === "failed") {
    return { status: "failed", messages, preview, displayPreview, error, emptyReply, waiting };
  }
  if (agent === "cancelled" || agent === "interrupted") {
    return { status: "cancelled", messages, preview, displayPreview, error, emptyReply, waiting };
  }
  if (waiting) {
    // 等待工具授权或用户回答时回合还没结束：消息数与上一条回复虽然都已存在，但不能算完成。
    return { status: "pending", messages, preview, displayPreview, error, emptyReply, waiting };
  }
  if (agent === "running" || agent === "finalizing" || agent === "cancelling") {
    return { status: "running", messages, preview, displayPreview, error, emptyReply, waiting };
  }
  if (agent === "completed") {
    return { status: "completed", messages, preview, displayPreview, error, emptyReply, waiting };
  }
  if (agent === "queued" || agent === "waiting_input") {
    return { status: "pending", messages, preview, displayPreview, error, emptyReply, waiting };
  }
  // 根会话至少要有一条助手回复才算完成：只有用户消息说明回合还没跑完。
  return {
    status: messages >= 2 && preview !== "" ? "completed" : "pending",
    messages,
    preview,
    displayPreview,
    error,
    emptyReply,
    waiting,
  };
}

/** 已经结束的任务状态：面板的「已完成」筛选与后端判定共用。 */
export const SESSION_DONE_STATUSES = ["completed", "failed", "cancelled"];
