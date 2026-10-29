// 工作台根组件：组合工具栏、步骤条、双栏内容与对话框。
// 脚本版由入口渲染到自建浮层容器；关闭动作由入口注入 onClose。
import { h, iconEl, useStore, makeT, useCallback, useEffect, useMemo, createPortal, useState } from "./host.js";
import { resolveEngine } from "../engine.js";
import { currentStep, hasCleanupCandidates, listVisibleIssues } from "../issues.js";
import { Stepper, ProjectPane, IssuesSection, ActivityCard, EmptyState, buildIssueView } from "./components.js";
import { Dialogs } from "./dialogs.js";

function PanelStatus({ text, detail }) {
  return h(
    "div",
    { className: "fx-state" },
    h("div", { className: "fx-state-title" }, text),
    detail ? h("div", { className: "fx-muted" }, detail) : null,
  );
}

// 脚本浮层的缩放手柄：靠近右 / 下 / 右下角，指针事件由入口统一接管。
// 面板插件形态是宿主任意尺寸的容器，不需要也不能拖动改尺寸，因此只在可缩放时渲染。
function resizeHandles() {
  return [
    h("div", { className: "fx-resize is-e", "data-fx-resize": "e", "aria-hidden": "true" }),
    h("div", { className: "fx-resize is-s", "data-fx-resize": "s", "aria-hidden": "true" }),
    h("div", { className: "fx-resize is-se", "data-fx-resize": "se", "aria-hidden": "true" }),
  ];
}

function FixBenchView({ api, onClose, resizable }) {
  const engine = useMemo(() => resolveEngine(api), [api]);
  const snapshot = useStore(engine);
  // 文案与回调保持引用稳定：issue 分组与卡片依赖它们做 memo 比较。
  // locale 变化时必须换引用，否则 memo 卡片不会随宿主语言切换重渲染。
  const locale = typeof api === "string" ? api : api?.locale;
  const t = useMemo(() => makeT(api), [api, locale]);
  // issue 列表视图偏好只属于当前面板会话：与状态 / 严重度筛选一样不落盘。
  // 默认按列表展示，需要合并同文件问题时再切到按文件。
  const [issueView, setIssueView] = useState("list");
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const toggleIssueGroup = useCallback((key) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  useEffect(() => {
    void engine.mount();
    return () => engine.unmount();
  }, [engine]);

  const issues = Array.isArray(snapshot.state?.issues) ? snapshot.state.issues : [];
  // 筛选与派生统计只在 issue 集合 / 筛选条件 / 勾选变化时重建：
  // 活动指标刷新只替换 activity，不会让 issue 列表重算或重建行。
  const visible = useMemo(
    () => listVisibleIssues(issues, snapshot),
    [issues, snapshot.statusFilter, snapshot.severityFilter, snapshot.searchQuery],
  );
  const issueViewData = useMemo(
    () => buildIssueView(snapshot, visible),
    [issues, visible, snapshot.selected, snapshot.statusFilter],
  );
  // 步骤条只依赖 issue 状态与活动相位：指标刷新不应重算状态计数。
  const step = useMemo(
    () => currentStep(snapshot),
    [issues, snapshot.activity?.phase, snapshot.activity?.kind],
  );

  if (snapshot.status === "loading" || snapshot.status === "unsupported" || snapshot.status === "no-project" || snapshot.status === "error") {
    const message =
      snapshot.status === "loading"
        ? t("fx.loading")
        : snapshot.status === "unsupported"
          ? t("fx.unsupported")
          : snapshot.status === "no-project"
            ? t("fx.noProject")
            : t("fx.loadFailed", { error: snapshot.error });
    return h(
      "div",
      { className: "fx-panel" },
      h(
        "header",
        { className: "fx-head" },
        h(
          "div",
          { className: "fx-head-main" },
          h("div", { className: "fx-title" }, t("fx.name")),
          h("div", { className: "fx-sub" }, t("fx.subtitle")),
        ),
        h(
          "div",
          { className: "fx-head-actions" },
          onClose
            ? h(
                "button",
                { className: "fx-icon-btn", title: t("fx.close"), onClick: onClose },
                iconEl(api, "X", 14),
              )
            : null,
        ),
      ),
      h(PanelStatus, { text: message }),
      snapshot.status === "error"
        ? h("div", { className: "fx-state-actions" }, h("button", { className: "fx-btn", onClick: () => void engine.reload() }, t("fx.retry")))
        : null,
      resizable ? resizeHandles() : null,
    );
  }

  const project = snapshot.project;
  const hasIssues = issues.length > 0;
  // issue 被清空后可能仍留着历史会话：空状态也必须保留清理入口。
  const hasSessions = hasCleanupCandidates(snapshot.state);
  // toast 必须挂在 body 上：审查弹窗通过 Portal 位于浮层之上，留在面板内会被遮罩或弹窗挡住。
  // 展示最近几条提示：一次收尾会连续出现「修复完成 → 暂存失败 → 复审启动」，
  // 只留最新一条会让错误提示瞬间被绿色提示盖住。
  const toastItems =
    Array.isArray(snapshot.toasts) && snapshot.toasts.length
      ? snapshot.toasts
      : snapshot.toast
        ? [{ id: "current", kind: snapshot.toast.kind, text: snapshot.toast.text }]
        : [];
  const toast =
    toastItems.length && typeof document !== "undefined" && document.body
      ? createPortal(
          h(
            "div",
            { className: "fx-toast-layer" },
            toastItems.map((item) =>
              h(
                "div",
                {
                  key: item.id ?? `${item.kind || "info"}:${item.text}`,
                  className: `fx-toast is-${item.kind || "info"}`,
                  role: "status",
                },
                item.text,
              ),
            ),
          ),
          document.body,
        )
      : null;
  return h(
    "div",
    { className: "fx-panel" },
    h(
      "header",
      { className: "fx-head" },
      h(
        "div",
        { className: "fx-head-main" },
        h("div", { className: "fx-title" }, t("fx.name")),
        h(
          "div",
          { className: "fx-sub", title: project?.path },
          h("span", { className: "fx-project-name" }, project?.name || ""),
          h("span", { className: "fx-project-path" }, project?.path || ""),
        ),
      ),
      h(
        "div",
        { className: "fx-head-actions" },
        h(
          "button",
          { className: "fx-btn small", onClick: () => engine.openReviewDialog() },
          iconEl(api, "ScanSearch", 13),
          h("span", null, t("fx.review.title")),
        ),
        h(
          "button",
          { className: "fx-icon-btn", title: t("fx.settings.open"), onClick: () => engine.openSettingsDialog() },
          iconEl(api, "Settings", 14),
        ),
        h(
          "button",
          { className: "fx-icon-btn", title: t("fx.prompts.open"), onClick: () => engine.openPromptsDialog() },
          iconEl(api, "FileText", 14),
        ),
        h(
          "button",
          { className: "fx-icon-btn", title: t("fx.refreshTitle"), onClick: () => engine.refresh() },
          iconEl(api, "RefreshCw", 14),
        ),
        onClose
          ? h(
              "button",
              { className: "fx-icon-btn", title: t("fx.close"), onClick: onClose },
              iconEl(api, "X", 14),
            )
          : null,
      ),
    ),
    h(Stepper, { current: step, snapshot, t, api }),
    h(
      "div",
      { className: "fx-body" },
      h(ProjectPane, { snapshot, engine, api, t }),
      h(
        "main",
        { className: "fx-main" },
        snapshot.activity
          ? h(ActivityCard, {
              // 切换项目会直接替换活动对象：按会话重建卡片，避免沿用上一会话的计时终点。
              key: `${snapshot.activity.kind}:${snapshot.activity.conversationId}`,
              activity: snapshot.activity,
              engine,
              api,
              t,
            })
          : null,
        hasIssues || snapshot.activity
          ? h(IssuesSection, {
              snapshot,
              visible,
              engine,
              api,
              t,
              view: issueViewData,
              viewMode: issueView,
              onViewModeChange: setIssueView,
              collapsedGroups,
              onToggleGroup: toggleIssueGroup,
            })
          : h(EmptyState, { engine, api, t, cleanupAvailable: hasSessions }),
      ),
    ),
    toast,
    h(Dialogs, { dialog: snapshot.dialog, snapshot, engine, api, t }),
    resizable ? resizeHandles() : null,
  );
}

export default function FixBenchPanel({ api, onClose, resizable }) {
  return h(FixBenchView, { api, onClose, resizable });
}
