// 跨项目执行监控浮层：列出各项目正在执行或已完成待处理的修复流程，并提供直接操作。
// 布局参考 Token 用量仪表：紧凑头部、单行指标、文字操作，尽量降低对窗口的遮挡。
import { h, iconEl, formatElapsed, useStore, makeT, useEffect, useRef, useState } from "./host.js";
import { resolveStageRunState } from "../issues.js";

const STATUS_KEY = {
  running: "fx.monitor.status.running",
  done: "fx.monitor.status.done",
  error: "fx.monitor.status.error",
  detached: "fx.monitor.status.detached",
};

const KIND_KEY = {
  review: "fx.monitor.kind.review",
  fix: "fx.monitor.kind.fix",
  verify: "fx.monitor.kind.verify",
};

// 相对更新时间复用活动卡片的秒 / 分 / 时文案，避免两套口径。
function formatUpdateAge(t, elapsedMs) {
  const seconds = Math.max(0, Math.floor(Number(elapsedMs) / 1000));
  if (!Number.isFinite(seconds) || seconds < 2) return t("fx.activity.agoJustNow");
  if (seconds < 60) return t("fx.activity.agoSeconds", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("fx.activity.agoMinutes", { count: minutes });
  return t("fx.activity.agoHours", { count: Math.floor(minutes / 60) });
}

// 条目操作一律用文字按钮：图标无法说明「打开会话」「重新解析」这类动作的具体含义。
function textAction(key, label, onClick, disabled = false) {
  return h(
    "button",
    { key, type: "button", className: "fx-monitor-action", title: label, disabled, onClick },
    label,
  );
}

// 已完成条目的主操作同样用文字，仅以强调色区分：它是这一行里唯一会改变工作台数据的动作。
function primaryAction(key, label, onClick) {
  return h(
    "button",
    { key, type: "button", className: "fx-monitor-primary", title: label, onClick },
    label,
  );
}

function MonitorEntry({ entry, monitor, api, t, now, current, pending, notice }) {
  const running = entry.status === "running";
  const resumable = entry.status === "error" || entry.status === "detached";
  const elapsedEnd = running
    ? now
    : Math.max(entry.completedAt || entry.lastUpdateAt || 0, entry.startedAt || 0);
  // 两个耗时始终并列展示：总耗时从整条流程的审查开始算起（旧登记回退到本批起点），
  // 节点耗时从当前节点（审查 / 修复 / 复审）的起点算起，二者都跨批次稳定。
  const flowStart =
    Number(entry.flowStartedAt) > 0
      ? Number(entry.flowStartedAt)
      : Number(entry.startedAt) || 0;
  const stageStart =
    Number(entry.stageStartedAt) > 0
      ? Number(entry.stageStartedAt)
      : Number(entry.startedAt) || 0;
  const totalElapsed = flowStart ? formatElapsed(elapsedEnd - flowStart) : "";
  const nodeElapsed = stageStart ? formatElapsed(elapsedEnd - stageStart) : "";
  const totalLabelKey = running ? "fx.monitor.totalElapsed" : "fx.monitor.totalFinished";
  const lastUpdateAt = Number(entry.lastUpdateAt) || Number(entry.startedAt) || 0;
  const updateAge = lastUpdateAt ? formatUpdateAge(t, now - lastUpdateAt) : "";
  const statusText = t(STATUS_KEY[entry.status] || STATUS_KEY.running);
  const kindText = t(KIND_KEY[entry.kind] || KIND_KEY.fix);
  const scope = entry.scopeLabel
    ? entry.scopeLabel
    : entry.batchTotal > 1
      ? t("fx.monitor.batch", { batch: entry.batchNumber, total: entry.batchTotal })
      : "";
  // 指标与操作同处一行：操作是文字按钮，放不下时整组换到指标下方并贴右。
  const metrics = [
    totalElapsed
      ? h("span", { key: "total" }, t(totalLabelKey, { time: totalElapsed }))
      : null,
    nodeElapsed
      ? h("span", { key: "node" }, t("fx.monitor.nodeElapsed", { time: nodeElapsed }))
      : null,
    running && entry.receivedChars > 0
      ? h(
          "span",
          { key: "received" },
          t("fx.monitor.received", { count: entry.receivedChars.toLocaleString() }),
        )
      : null,
    updateAge ? h("span", { key: "updated" }, t("fx.monitor.updated", { time: updateAge })) : null,
  ].filter(Boolean);
  const actions = [];
  // 自动暂存不可用时的说明（SSH 项目）：不提供必然失败的入口，改为直接说明原因。
  let stageHint = "";
  // 上一轮被新一轮顶掉后遗留的自动收尾：只给只读提示与安全入口（打开旧会话 / 处理结果）。
  // 不能复用「暂存改动 / 清理」按钮：引擎的补做接口只作用于当前会话，旧条目点击会落到新一轮。
  const carryover = entry.carryover || null;
  if (running) {
    actions.push(
      textAction("session", t("fx.monitor.openSession"), () =>
        void monitor.openSession(entry.projectId, entry.conversationId),
      ),
      textAction("workbench", t("fx.monitor.openWorkbench"), () =>
        void monitor.openWorkbench(entry.projectId),
      ),
      textAction("stop", t("fx.monitor.stop"), () => void monitor.stop(entry.projectId)),
    );
  } else if (entry.status === "done") {
    // 本轮开启了自动暂存：面板直接给出补做入口。执行期间用面板本地状态显示
    // 「暂存中」，不等引擎快照回写，避免用户重复点击或以为没反应；
    // 引擎持久化的 stageState 用于跨会话去重，已成功处理过的轮次不再显示入口。
    // 收尾暂存失败（error）同样保留入口并改为「重试暂存」，否则用户只能去终端手动 git add。
    // staging 可能因切换项目 / 卸载 / 关闭页面而永远等不到终态：超过阈值后不再禁用按钮，
    // 交给用户显式重试；未超时或面板本地正在执行时仍显示「暂存中」。
    // 暂存状态统一按当前时刻收敛：staging 超时视为可重试的中断，
    // 与引擎去重使用同一口径（resolveStageRunState）。
    const stageState = resolveStageRunState(
      { stageRunState: entry.stageState, stageRunAt: entry.stageRunAt },
      now,
    );
    const staging = pending.stage === "running" || stageState === "staging";
    const retryStage = !staging && stageState === "error";
    if (entry.stageEnabled && entry.stageSupported === false) {
      stageHint = t("fx.monitor.stageUnsupported");
    } else if (
      entry.stageEnabled &&
      (stageState === "" || stageState === "staging" || stageState === "error")
    ) {
      actions.push(
        staging
          ? textAction("stage", t("fx.monitor.staging"), null, true)
          : textAction(
              "stage",
              retryStage ? t("fx.monitor.stageRetry") : t("fx.monitor.stage"),
              () => void monitor.stageRun(entry.projectId),
            ),
      );
    }
    // 本轮开启了自动清理：面板内二次确认后直接执行，不跳转工作台。
    // 已清理过的轮次不再显示入口；没有自动清理授权时保留工作台手动入口。
    // 面板侧同时要求本轮修复会话仍存在（cleanupReady）：引擎的清理只作用于 sessions.fix，
    // 修复会话被「处理结果」归档后这个按钮点了只会提示没有可清理的内容。
    const cleanupPending = entry.autoCleanup && entry.cleanupState !== "done";
    // 确认态必须让用户看到动作与范围：删除不可恢复。
    // 旧登记没有清理计划时无法说明范围，此时不在面板内执行，改走工作台的清理对话框。
    const cleanupPlanKnown = entry.cleanupAction === "delete" || entry.cleanupAction === "archive";
    const cleanupConfirming = pending.cleanup === "confirm" && cleanupPlanKnown;
    if (cleanupPending && entry.cleanupReady !== false) {
      if (pending.cleanup === "running") {
        actions.push(textAction("cleanup", t("fx.monitor.cleanupRunning"), null, true));
      } else if (cleanupConfirming) {
        actions.push(
          primaryAction(
            "cleanup-confirm",
            t(
              entry.cleanupAction === "delete"
                ? "fx.monitor.cleanupConfirmDelete"
                : "fx.monitor.cleanupConfirmArchive",
            ),
            () => void monitor.confirmCleanup(entry.projectId),
          ),
          textAction("cleanup-cancel", t("fx.monitor.cleanupCancel"), () =>
            monitor.cancelCleanup(entry.projectId),
          ),
        );
      } else {
        actions.push(
          primaryAction("cleanup", t("fx.monitor.cleanupRun"), () =>
            cleanupPlanKnown
              ? monitor.beginCleanup(entry.projectId)
              : void monitor.openCleanup(entry.projectId),
          ),
        );
      }
    } else if (!entry.autoCleanup || cleanupPending) {
      actions.push(
        textAction("cleanup", t("fx.monitor.cleanup"), () =>
          void monitor.openCleanup(entry.projectId),
        ),
      );
    }
    actions.push(
      textAction("session", t("fx.monitor.openSession"), () =>
        void monitor.openSession(entry.projectId, entry.conversationId),
      ),
      textAction("dismiss", t("fx.monitor.dismiss"), () => void monitor.dismiss(entry.projectId)),
    );
  } else {
    // 引擎可能因创建失败已被移除：恢复动作会按需重建后台引擎，不能按当前可用性隐藏入口。
    if (resumable) {
      actions.push(
        textAction("resume", t("fx.monitor.resume"), () => void monitor.resume(entry.projectId)),
        textAction("retry", t("fx.monitor.retry"), () => void monitor.retry(entry.projectId)),
      );
    }
    actions.push(
      textAction("session", t("fx.monitor.openSession"), () =>
        void monitor.openSession(entry.projectId, entry.conversationId),
      ),
      textAction("workbench", t("fx.monitor.openWorkbench"), () =>
        void monitor.openWorkbench(entry.projectId),
      ),
      textAction("dismiss", t("fx.monitor.dismiss"), () => void monitor.dismiss(entry.projectId)),
    );
  }
  return h(
    "article",
    { className: `fx-monitor-item is-${entry.status}` },
    h(
      "div",
      { className: "fx-monitor-item-head" },
      h(
        "span",
        { className: `fx-monitor-state is-${entry.status}` },
        running
          ? h("span", { className: "fx-pulse is-running" })
          : iconEl(api, entry.status === "done" ? "Check" : "CircleAlert", 11),
      ),
      h(
        "span",
        { className: "fx-monitor-project", title: entry.projectPath || entry.projectName },
        entry.projectName,
      ),
      current ? h("span", { className: "fx-monitor-current" }, t("fx.monitor.current")) : null,
      h("span", { className: `fx-monitor-status is-${entry.status}` }, statusText),
    ),
    h(
      "div",
      { className: "fx-monitor-meta" },
      h("span", { className: "fx-monitor-kind" }, kindText),
      scope ? h("span", { className: "fx-monitor-scope", title: scope }, scope) : null,
      entry.issueCount > 0
        ? h("span", null, t("fx.monitor.issues", { count: entry.issueCount }))
        : null,
    ),
    h(
      "div",
      { className: "fx-monitor-line" },
      h("div", { className: "fx-monitor-metrics" }, metrics),
      h("div", { className: "fx-monitor-actions" }, actions),
    ),
    // 清理确认态的范围说明：动作、条数与不可恢复警告在第二次点击前可见。
    cleanupConfirming
      ? h(
          "div",
          { className: "fx-monitor-cleanup" },
          h(
            "div",
            { className: "fx-monitor-cleanup-plan" },
            t(
              entry.cleanupAction === "delete"
                ? "fx.monitor.cleanupPlanDelete"
                : "fx.monitor.cleanupPlanArchive",
              {
                issues: Math.max(0, Number(entry.cleanupIssueCount) || 0),
                sessions: Math.max(0, Number(entry.cleanupSessionCount) || 0),
              },
            ),
          ),
          entry.cleanupAction === "delete"
            ? h("div", { className: "fx-monitor-warn" }, t("fx.monitor.cleanupIrreversible"))
            : null,
          Number(entry.cleanupBaselineCount) > 0
            ? h(
                "div",
                { className: "fx-monitor-warn" },
                t("fx.monitor.cleanupBaseline", { count: entry.cleanupBaselineCount }),
              )
            : null,
        )
      : null,
    entry.error ? h("div", { className: "fx-monitor-error" }, entry.error) : null,
    // 续批在交接窗口被停止：剩余批次不会自动派发，明确提示用户重新勾选。
    entry.queueInterrupted
      ? h("div", { className: "fx-monitor-warn" }, t("fx.activity.fixQueueInterrupted"))
      : null,
    entry.timedOut ? h("div", { className: "fx-monitor-warn" }, t("fx.activity.timeout")) : null,
    // 自动暂存不可用（SSH 项目）：入口已隐藏，这里说明原因与替代做法。
    stageHint ? h("div", { className: "fx-monitor-warn" }, stageHint) : null,
    // 上一轮被新一轮顶掉：只提示遗留的自动收尾与安全入口，不渲染会命中当前轮的暂存 / 清理按钮。
    carryover
      ? h(
          "div",
          { className: "fx-monitor-carryover" },
          h(
            "div",
            { className: "fx-monitor-carryover-text" },
            t("fx.monitor.carryover", { kind: t(KIND_KEY[carryover.kind] || KIND_KEY.fix) }),
          ),
          carryover.stagePending
            ? h("div", { className: "fx-monitor-carryover-hint" }, t("fx.monitor.carryoverStage"))
            : null,
          carryover.cleanupPending
            ? h("div", { className: "fx-monitor-carryover-hint" }, t("fx.monitor.carryoverCleanup"))
            : null,
          h(
            "div",
            { className: "fx-monitor-actions" },
            textAction("carryover-session", t("fx.monitor.carryoverSession"), () =>
              void monitor.openSession(entry.projectId, carryover.conversationId),
            ),
            carryover.cleanupPending
              ? textAction("carryover-cleanup", t("fx.monitor.cleanup"), () =>
                  void monitor.openCleanup(entry.projectId),
                )
              : null,
            textAction("carryover-dismiss", t("fx.monitor.carryoverDismiss"), () =>
              monitor.dismissCarryover(entry.projectId),
            ),
          ),
        )
      : null,
    notice
      ? h("div", { className: `fx-monitor-notice is-${notice.kind}` }, notice.text)
      : null,
  );
}

export default function FixBenchMonitor({ api, monitor }) {
  // useStore 的参数是需要带 .store 的对象（与工作台面板传引擎一致）：传 monitor，不能传 monitor.store。
  const snapshot = useStore(monitor);
  const t = makeT(api);
  const [now, setNow] = useState(() => Date.now());
  const entries = snapshot.entries || [];
  const actions = snapshot.actions || {};
  const notices = snapshot.notices || {};
  const collapsed = Boolean(snapshot.collapsed);
  const pinned = Boolean(snapshot.pinned);
  // 工作台可见时面板只以胶囊存在：展开会先收起工作台，按钮文案要说明这次点击的结果。
  const workbenchVisible = Boolean(snapshot.workbenchVisible);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!entries.length) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [entries.length]);
  useEffect(() => {
    if (collapsed || pinned) return undefined;
    // 点击面板以外的任意位置自动收成胶囊；capture 阶段监听，宿主阻止冒泡也不影响。
    function onDocumentPointerDown(event) {
      const root = rootRef.current;
      if (!root) return;
      const target = event.target;
      if (target instanceof Node && root.contains(target)) return;
      monitor.toggleCollapsed(true);
    }
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  }, [collapsed, pinned, monitor]);
  const registryUnavailable = Boolean(snapshot.registryUnavailable);
  // 没有条目但登记读取失败时仍要给出提示：否则写盘已暂停而用户看不到任何原因。
  if (!entries.length && !registryUnavailable) return null;
  if (!entries.length) {
    return h(
      "section",
      { ref: rootRef, className: "fx-monitor", "aria-label": t("fx.monitor.aria") },
      h(
        "header",
        { className: "fx-monitor-head", "data-fx-monitor-head": "true" },
        h("span", { className: "fx-monitor-head-icon" }, iconEl(api, "CircleAlert", 14)),
        h(
          "div",
          { className: "fx-monitor-head-main" },
          h("div", { className: "fx-monitor-title" }, t("fx.monitor.title")),
          h("div", { className: "fx-monitor-sub" }, t("fx.monitor.registryUnavailable")),
        ),
      ),
    );
  }
  const running = entries.filter((entry) => entry.status === "running").length;
  const finished = entries.length - running;
  const currentProjectId = snapshot.currentProjectId || "";
  if (collapsed) {
    // 折叠态没有标题栏：整颗胶囊都是拖动热区，位移不足阈值时仍按点击展开。
    return h(
      "section",
      {
        className: "fx-monitor is-collapsed",
        "aria-label": t("fx.monitor.aria"),
        "data-fx-monitor-drag": "true",
      },
      h(
        "button",
        {
          type: "button",
          className: "fx-monitor-pill",
          title: t(workbenchVisible ? "fx.monitor.expandOverWorkbench" : "fx.monitor.expand"),
          "aria-label": t(workbenchVisible ? "fx.monitor.expandOverWorkbench" : "fx.monitor.expand"),
          onClick: () => monitor.toggleCollapsed(false),
        },
        h("span", { className: "fx-monitor-pill-icon" }, iconEl(api, "Wrench", 13)),
        h("span", { className: "fx-monitor-pill-title" }, t("fx.monitor.title")),
        h(
          "span",
          {
            className: `fx-monitor-pill-badge${running ? " is-running" : ""}`,
            title: t("fx.monitor.summary", { running, finished }),
          },
          running ? h("span", { className: "fx-pulse is-running" }) : null,
          String(running || finished),
        ),
        h("span", { className: "fx-monitor-pill-caret" }, iconEl(api, "ChevronDown", 12)),
      ),
    );
  }
  return h(
    "section",
    { ref: rootRef, className: "fx-monitor", "aria-label": t("fx.monitor.aria") },
    h(
      "header",
      { className: "fx-monitor-head", "data-fx-monitor-head": "true" },
      h("span", { className: "fx-monitor-head-icon" }, iconEl(api, "Wrench", 14)),
      h(
        "div",
        { className: "fx-monitor-head-main" },
        h("div", { className: "fx-monitor-title" }, t("fx.monitor.title")),
        h(
          "div",
          { className: "fx-monitor-sub" },
          running > 0
            ? h(
                "span",
                { className: "fx-monitor-sum is-running" },
                h("span", { className: "fx-pulse is-running" }),
                t("fx.monitor.running", { count: running }),
              )
            : null,
          h("span", { className: "fx-monitor-sum" }, t("fx.monitor.pending", { count: finished })),
        ),
      ),
      h(
        "button",
        {
          type: "button",
          className: `fx-icon-btn fx-monitor-pin${pinned ? " is-active" : ""}`,
          title: t(pinned ? "fx.monitor.pinned" : "fx.monitor.pin"),
          "aria-label": t(pinned ? "fx.monitor.pinned" : "fx.monitor.pin"),
          "aria-pressed": pinned ? "true" : "false",
          "data-no-drag": "true",
          onClick: () => monitor.togglePinned(),
        },
        iconEl(api, "Pin", 13),
      ),
      h(
        "button",
        {
          type: "button",
          className: "fx-icon-btn",
          title: t("fx.monitor.collapse"),
          "aria-label": t("fx.monitor.collapse"),
          "data-no-drag": "true",
          onClick: () => monitor.toggleCollapsed(true),
        },
        iconEl(api, "ChevronDown", 14, undefined, "fx-monitor-collapse-icon"),
      ),
    ),
    h(
      "div",
      { className: "fx-monitor-list" },
      entries.map((entry) =>
        h(MonitorEntry, {
          key: entry.projectId,
          entry,
          monitor,
          api,
          t,
          now,
          current: entry.projectId === currentProjectId,
          pending: actions[entry.projectId] || {},
          notice: notices[entry.projectId] || null,
        }),
      ),
    ),
    registryUnavailable
      ? h("div", { className: "fx-monitor-warn" }, t("fx.monitor.registryUnavailable"))
      : null,
    h("div", { className: "fx-monitor-foot" }, t("fx.monitor.hint")),
  );
}
