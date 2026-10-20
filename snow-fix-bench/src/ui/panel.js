// 工作台根组件：组合工具栏、步骤条、双栏内容与对话框。
// 脚本版由入口渲染到自建浮层容器；关闭动作由入口注入 onClose。
import { h, iconEl, useStore, makeT, useEffect, useMemo, createPortal } from "./host.js";
import { resolveEngine } from "../engine.js";
import { currentStep, listVisibleIssues } from "../issues.js";
import { Stepper, ProjectPane, IssuesSection, ActivityCard, EmptyState } from "./components.js";
import { Dialogs } from "./dialogs.js";

function PanelStatus({ text, detail }) {
  return h(
    "div",
    { className: "fx-state" },
    h("div", { className: "fx-state-title" }, text),
    detail ? h("div", { className: "fx-muted" }, detail) : null,
  );
}

function FixBenchView({ api, onClose }) {
  const engine = useMemo(() => resolveEngine(api), [api]);
  const snapshot = useStore(engine);
  const t = makeT(api);
  useEffect(() => {
    void engine.mount();
    return () => engine.unmount();
  }, [engine]);

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
    );
  }

  const project = snapshot.project;
  const visible = listVisibleIssues(snapshot.state.issues, snapshot);
  const hasIssues = snapshot.state.issues.length > 0;
  const step = currentStep(snapshot);
  // toast 必须挂在 body 上：审查弹窗通过 Portal 位于浮层之上，留在面板内会被遮罩或弹窗挡住。
  const toast =
    snapshot.toast && typeof document !== "undefined" && document.body
      ? createPortal(
          h(
            "div",
            { className: "fx-toast-layer" },
            h(
              "div",
              { className: `fx-toast is-${snapshot.toast.kind || "info"}`, role: "status" },
              snapshot.toast.text,
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
        snapshot.activity ? h(ActivityCard, { activity: snapshot.activity, engine, api, t }) : null,
        hasIssues || snapshot.activity
          ? h(IssuesSection, { snapshot, visible, engine, api, t })
          : h(EmptyState, { snapshot, engine, api, t }),
      ),
    ),
    toast,
    h(Dialogs, { dialog: snapshot.dialog, snapshot, engine, api, t }),
  );
}

export default function FixBenchPanel({ api, onClose }) {
  return h(FixBenchView, { api, onClose });
}
