// 面板对话框：审查范围、批量修复确认、结果清理。
import { h, createPortal, iconEl, severityLabel, severityClass, statusLabel, useEffect, useId, useRef, useState } from "./host.js";
import {
  ISSUE_STATUS,
  DEFAULT_PARALLEL_LIMIT,
  MIN_PARALLEL_LIMIT,
  MAX_PARALLEL_LIMIT,
  ISSUE_SEVERITIES,
  DEFAULT_ISSUE_SEVERITIES,
} from "../constants.js";
import { normalizeSeverityScope } from "../parse.js";
import { isSessionBusy, isSessionPossiblyRunning, conversationCleanupGroups } from "../issues.js";

function DialogShell({ title, closeLabel, api, onClose, children, footer, error }) {
  return h(
    "div",
    {
      className: "fx-mask",
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) onClose();
      },
    },
    h(
      "section",
      { className: "fx-dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
      h(
        "header",
        { className: "fx-dialog-head" },
        h("b", null, title),
        h("button", { className: "fx-icon-btn", onClick: onClose, title: closeLabel }, iconEl(api, "X", 14)),
      ),
      h(
        "div",
        { className: "fx-dialog-body" },
        error ? h("div", { className: "fx-error", role: "alert" }, error) : null,
        children,
      ),
      h("footer", { className: "fx-dialog-foot" }, footer),
    ),
  );
}

// 审查弹窗 1:1 复刻宿主内置 /review 面板：与宿主 Modal 一样通过 Portal 挂到 body，
// 沿用宿主的 app-modal / review-* 结构与类名，视觉完全由宿主样式提供，
// 本文件只负责数据与交互。
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function ReviewModal({ title, description, closeLabel, api, onClose, children, footer }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  // 与宿主 Modal 一致：打开时锁定页面滚动并把焦点移入对话框，关闭时还原。
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (dialogRef.current) dialogRef.current.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, []);

  // 与宿主 Modal 一致的 Tab 焦点陷阱；宿主 /review 未开启 ESC 关闭，这里同样不处理 ESC。
  const handleKeyDown = (event) => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialogRef.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    h(
      "div",
      { className: "app-modal-overlay fx-review-overlay" },
      h(
        "div",
        {
          "aria-describedby": description ? descriptionId : undefined,
          "aria-labelledby": titleId,
          "aria-modal": "true",
          className: "app-modal-dialog app-modal-large review-modal",
          onKeyDown: handleKeyDown,
          ref: dialogRef,
          role: "dialog",
          tabIndex: -1,
        },
        h(
          "div",
          { className: "app-modal-header" },
          h(
            "div",
            { className: "app-modal-title-group" },
            h("strong", { id: titleId }, title),
            description ? h("span", { id: descriptionId }, description) : null,
          ),
          h(
            "button",
            {
              "aria-label": closeLabel,
              className: "icon-btn ghost app-modal-close",
              onClick: onClose,
              title: closeLabel,
              type: "button",
            },
            iconEl(api, "X", 16, 1.9),
          ),
        ),
        h("div", { className: "app-modal-body" }, children),
        footer ? h("div", { className: "app-modal-footer" }, footer) : null,
      ),
    ),
    document.body,
  );
}

function ReviewDialog({ dialog, snapshot, engine, api, t }) {
  const [busy, setBusy] = useState(false);
  const git = snapshot.git || {};
  const status = git.status || null;
  const workDir = snapshot.project?.path || "";
  const files = status?.files || [];
  // 与宿主 ReviewPanel 的划分保持一致：index 列为状态字符（非空格、非未跟踪、非空）。
  const stagedFiles = files.filter(
    (file) => file.indexStatus !== " " && file.indexStatus !== "?" && file.indexStatus !== "",
  );
  // 工作区变更：未跟踪（?）或 workdir 列有修改状态。
  const unstagedFiles = files.filter(
    (file) => file.workdirStatus === "?" || (file.workdirStatus !== " " && file.workdirStatus !== ""),
  );
  const commits = git.commits || [];
  const selectedCount = dialog.staged.length + dialog.unstaged.length + dialog.commits.length;
  const isRepo = status?.isRepo ?? true;
  const statusLimitHit = Boolean(status?.statusLimitHit);
  // 提交记录由引擎在打开弹窗时通过只读 git log 读取；panelOpen 表示命令通道是否已成功返回。
  const commitsEmptyText = git.commandLoading
    ? t("fx.review.loadingCommits")
    : git.commandError
      ? t("fx.review.commitsFailed").replace("{{error}}", git.commandError)
      : t(git.panelOpen ? "fx.review.noCommits" : "fx.review.noCommitsPanel");

  const toggle = (group, key) => {
    const current = dialog[group];
    engine.updateDialog({
      [group]: current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    });
  };
  const toggleAll = (group, keys) => {
    const current = dialog[group];
    const allSelected = keys.length > 0 && keys.every((key) => current.includes(key));
    const next = allSelected ? current.filter((key) => !keys.includes(key)) : Array.from(new Set([...current, ...keys]));
    engine.updateDialog({ [group]: next });
  };
  const rowKeyDown = (event, handler) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handler();
    }
  };

  const renderFileRow = (group, file) => {
    const key = `${group}:${file.path}`;
    const checked = dialog[group].includes(key);
    const isUntracked = String(file.workdirStatus || "").trim() === "?";
    return h(
      "li",
      {
        className: `review-file-row${checked ? " is-selected" : ""}`,
        key,
        role: "checkbox",
        "aria-checked": checked,
        tabIndex: 0,
        onClick: () => toggle(group, key),
        onKeyDown: (event) => rowKeyDown(event, () => toggle(group, key)),
      },
      h(
        "span",
        { className: `review-check${checked ? " is-checked" : ""}` },
        checked ? iconEl(api, "Check", 12, 2.6) : null,
      ),
      h("span", { className: "review-file-path", title: file.path }, file.path),
      h(
        "span",
        { className: `review-kind is-${isUntracked ? "untracked" : group}` },
        isUntracked ? "U" : file.status,
      ),
    );
  };

  const renderCommitRow = (commit) => {
    const key = `commit:${commit.hash}`;
    const checked = dialog.commits.includes(key);
    return h(
      "li",
      {
        className: `review-commit-row${checked ? " is-selected" : ""}`,
        key,
        role: "checkbox",
        "aria-checked": checked,
        tabIndex: 0,
        onClick: () => toggle("commits", key),
        onKeyDown: (event) => rowKeyDown(event, () => toggle("commits", key)),
      },
      h(
        "span",
        { className: `review-check${checked ? " is-checked" : ""}` },
        checked ? iconEl(api, "Check", 12, 2.6) : null,
      ),
      iconEl(api, "GitCommitHorizontal", 13, 1.9, "review-commit-icon"),
      h("span", { className: "review-commit-hash" }, commit.shortHash),
      h("span", { className: "review-commit-message", title: commit.message }, commit.message),
      h("span", { className: "review-commit-author" }, commit.author),
      h("span", { className: "review-commit-date" }, commit.date),
    );
  };

  const renderSection = (group, title, rows, emptyText, options) => {
    const actions = [];
    if (rows.length > 0) {
      actions.push(
        h(
          "button",
          {
            type: "button",
            className: "review-select-all",
            onClick: () => toggleAll(group, rows.map((row) => row.key)),
          },
          t("fx.review.selectAll"),
        ),
      );
    }
    return h(
      "section",
      { className: "review-section", key: group },
      h(
        "div",
        { className: "review-section-header" },
        h("span", { className: "review-section-title" }, title),
        actions.length > 0 ? h("div", { className: "review-section-actions" }, actions) : null,
      ),
      rows.length > 0
        ? h(
            "ul",
            { className: `review-list${options?.listClassName ? ` ${options.listClassName}` : ""}` },
            rows.map((row) => row.node),
            options?.footer,
          )
        : h("div", { className: "review-section-empty" }, emptyText),
    );
  };

  const emptyState = (title, hint) =>
    h(
      "div",
      { className: "review-empty" },
      h("span", { className: "review-empty-title" }, title),
      hint ? h("span", { className: "review-empty-hint" }, hint) : null,
    );

  let content;
  if (!workDir) {
    content = emptyState(t("fx.review.notRepo"), t("fx.review.notRepoHint"));
  } else if (git.loading) {
    content = h(
      "div",
      { className: "review-loading" },
      iconEl(api, "Loader2", 18, 1.9, "spin"),
      h("span", null, t("fx.review.loading")),
    );
  } else if (git.error) {
    content = h(
      "div",
      { className: "review-error" },
      iconEl(api, "CircleAlert", 15),
      h("span", null, git.error),
      h(
        "button",
        { type: "button", className: "review-retry-btn", onClick: () => engine.refresh() },
        iconEl(api, "RefreshCw", 12),
        t("fx.review.refresh"),
      ),
    );
  } else if (!isRepo) {
    content = emptyState(t("fx.review.notRepo"), t("fx.toast.gitUnavailable"));
  } else {
    content = h(
      "div",
      { className: "review-content" },
      h(
        "div",
        { className: "review-toolbar" },
        h(
          "span",
          { className: "review-branch" },
          status?.currentBranch ? `${t("fx.review.promptBranch")}: ${status.currentBranch}` : workDir,
        ),
        h(
          "button",
          { type: "button", className: "review-refresh-btn", onClick: () => engine.refresh() },
          iconEl(api, "RefreshCw", 12),
          t("fx.review.refresh"),
        ),
      ),
      statusLimitHit
        ? h(
            "div",
            { className: "review-status-limit", role: "status" },
            iconEl(api, "CircleAlert", 13),
            h("span", null, t("fx.review.statusLimitHit")),
          )
        : null,
      renderSection(
        "staged",
        t("fx.review.staged"),
        stagedFiles.map((file) => ({ key: `staged:${file.path}`, node: renderFileRow("staged", file) })),
        t("fx.review.noStaged"),
      ),
      renderSection(
        "unstaged",
        t("fx.review.unstaged"),
        unstagedFiles.map((file) => ({ key: `unstaged:${file.path}`, node: renderFileRow("unstaged", file) })),
        t("fx.review.noUnstaged"),
      ),
      renderSection(
        "commits",
        t("fx.review.commits"),
        commits.map((commit) => ({ key: `commit:${commit.hash}`, node: renderCommitRow(commit) })),
        commitsEmptyText,
        { listClassName: "is-commits" },
      ),
      h(
        "div",
        { className: "review-instructions" },
        h(
          "label",
          { className: "review-instructions-label", htmlFor: "fx-review-instructions" },
          t("fx.review.note"),
        ),
        h("textarea", {
          id: "fx-review-instructions",
          className: "review-instructions-input",
          placeholder: t("fx.review.notePlaceholder"),
          rows: 3,
          value: dialog.note,
          onChange: (event) => engine.updateDialog({ note: event.target.value }),
        }),
      ),
    );
  }

  const footer = h(
    "div",
    { className: "review-footer" },
    h(
      "span",
      { className: "review-selected-count" },
      selectedCount === 0
        ? t("fx.review.noChanges")
        : t("fx.review.selected", { count: selectedCount }),
    ),
    h(
      "button",
      {
        type: "button",
        className: "review-start-btn",
        disabled: busy || !workDir || git.loading,
        title: selectedCount === 0 ? t("fx.review.currentCode") : undefined,
        onClick: async () => {
          setBusy(true);
          await engine.confirmDialog();
          setBusy(false);
        },
      },
      busy ? iconEl(api, "Loader2", 14, 1.9, "spin") : iconEl(api, "ScanSearch", 14),
      t("fx.review.start"),
    ),
  );

  return h(
    ReviewModal,
    {
      title: t("fx.review.title"),
      description: t("fx.review.description"),
      closeLabel: t("fx.close"),
      api,
      onClose: () => engine.closeDialog(),
      footer,
    },
    h(
      "div",
      { className: "review-body" },
      dialog.error ? h("div", { className: "fx-error", role: "alert" }, dialog.error) : null,
      content,
    ),
  );
}

function FixDialog({ dialog, snapshot, engine, api, t }) {
  const [busy, setBusy] = useState(false);
  const issues = snapshot.state.issues.filter((issue) => dialog.issueIds.includes(issue.id));
  const steps = [t("fx.fix.step1"), t("fx.fix.step2"), t("fx.fix.step3"), t("fx.fix.step4"), t("fx.fix.step5")];
  const limit = snapshot.settings?.parallelLimit ?? DEFAULT_PARALLEL_LIMIT;
  const batches = Math.max(1, Math.ceil(issues.length / limit));
  const body = h(
    "div",
    { className: "fx-fix-confirm" },
    h("p", null, t("fx.fix.confirm", { count: issues.length })),
    dialog.notice ? h("div", { className: "fx-warn" }, dialog.notice) : null,
    h(
      "div",
      { className: "fx-hint" },
      t("fx.fix.parallel", { count: snapshot.settings?.parallelLimit ?? DEFAULT_PARALLEL_LIMIT }),
    ),
    issues.length > limit
      ? h("div", { className: "fx-hint" }, t("fx.fix.batchHint", { count: issues.length, batches, limit }))
      : null,
    h(
      "ul",
      { className: "fx-fix-steps" },
      steps.map((step) => h("li", { key: step }, step)),
    ),
    h(
      "div",
      { className: "fx-fix-issues" },
      issues.map((issue) =>
        h(
          "div",
          { className: "fx-fix-issue", key: issue.id },
          h("span", { className: `fx-sev ${severityClass(issue.severity)}` }, severityLabel(t, issue.severity)),
          h("span", { className: "fx-fix-title" }, issue.title),
          h("span", { className: "fx-muted" }, issue.location),
        ),
      ),
    ),
  );
  const footer = h(
    "div",
    { className: "fx-dialog-actions" },
    h("button", { className: "fx-btn", onClick: () => engine.closeDialog() }, t("fx.fix.cancel")),
    h(
      "button",
      {
        className: "fx-btn primary",
        disabled: busy,
        onClick: async () => {
          setBusy(true);
          await engine.confirmDialog();
          setBusy(false);
        },
      },
      busy ? t("fx.fix.busy") : t("fx.fix.start"),
    ),
  );
  return h(DialogShell, { title: t("fx.fix.title"), closeLabel: t("fx.close"), api, error: dialog.error, onClose: () => engine.closeDialog(), footer }, body);
}

function VerifyDialog({ dialog, snapshot, engine, api, t }) {
  const [busy, setBusy] = useState(false);
  const issues = snapshot.state.issues.filter((issue) => dialog.issueIds.includes(issue.id));
  const batches = Math.max(1, Number(dialog.batchTotal) || 1);
  const body = h(
    "div",
    { className: "fx-fix-confirm" },
    h("p", null, t("fx.verify.confirm", { count: issues.length, batches })),
    h(
      "div",
      { className: "fx-fix-issues" },
      issues.map((issue) =>
        h(
          "div",
          { className: "fx-fix-issue", key: issue.id },
          h("span", { className: `fx-sev ${severityClass(issue.severity)}` }, severityLabel(t, issue.severity)),
          h("span", { className: "fx-fix-title" }, issue.title),
          h("span", { className: "fx-muted" }, issue.location),
        ),
      ),
    ),
  );
  const footer = h(
    "div",
    { className: "fx-dialog-actions" },
    h("button", { className: "fx-btn", onClick: () => engine.closeDialog() }, t("fx.fix.cancel")),
    h(
      "button",
      {
        className: "fx-btn primary",
        disabled: busy,
        onClick: async () => {
          setBusy(true);
          await engine.confirmDialog();
          setBusy(false);
        },
      },
      busy ? t("fx.verify.busy") : t("fx.verify.start"),
    ),
  );
  return h(
    DialogShell,
    { title: t("fx.verify.title"), closeLabel: t("fx.close"), api, error: dialog.error, onClose: () => engine.closeDialog(), footer },
    body,
  );
}

function CleanupDialog({ dialog, snapshot, engine, api, t }) {
  const [busy, setBusy] = useState(false);
  const cleanupIssues = snapshot.state.issues.filter((issue) => issue.status !== ISSUE_STATUS.archived);
  const selectedSet = new Set(dialog.issueIds);
  // 历史台账会话不在当前跟踪中，删除或归档前需要显式确认风险。
  const sessions = conversationCleanupGroups(snapshot.state, dialog.sessions)
    .map((entry) => ({
      ...entry,
      key: entry.kind,
      label:
        entry.kind === "review"
          ? t("fx.cleanup.reviewSession")
          : entry.kind === "verify"
            ? t("fx.cleanup.verifySession")
            : t("fx.cleanup.fixSession"),
    }))
    .filter((entry) => entry.session || entry.conversations.length);
  const historicalCount = sessions.reduce((sum, entry) => sum + entry.historicalIds.length, 0);
  const needsRiskAck = sessions.some((entry) => entry.needsAck);
  // 运行中的会话不能被清理：禁用其破坏性选项，并阻止确认。
  const busyKeys = new Set(
    sessions
      .filter(({ session }) => session && isSessionBusy(session, snapshot.activity))
      .map(({ key }) => key),
  );
  // 超时或跟踪异常结束的会话可能仍在运行：同样不允许直接归档或删除。
  const riskyKeys = new Set(
    sessions
      .filter(
        ({ key, session }) =>
          session && !busyKeys.has(key) && isSessionPossiblyRunning(session, snapshot.activity),
      )
      .map(({ key }) => key),
  );
  const blockedByBusy = [...busyKeys].some((key) => {
    const action = dialog.sessions[key] || "keep";
    return action === "archive" || action === "delete";
  });
  const blockedByRisky = [...riskyKeys].some((key) => {
    const action = dialog.sessions[key] || "keep";
    return action === "archive" || action === "delete";
  });
  const toggleIssue = (issueId) => {
    const next = selectedSet.has(issueId)
      ? dialog.issueIds.filter((id) => id !== issueId)
      : [...dialog.issueIds, issueId];
    engine.updateDialog({ issueIds: next });
  };
  const body = h(
    "div",
    { className: "fx-cleanup" },
    h("div", { className: "fx-cleanup-title" }, t("fx.cleanup.issues")),
    cleanupIssues.length === 0
      ? h("div", { className: "fx-empty-small" }, t("fx.issues.empty"))
      : h(
          "div",
          { className: "fx-cleanup-issues" },
          cleanupIssues.map((issue) =>
            h(
              "label",
              { className: "fx-cleanup-row", key: issue.id },
              h("input", {
                type: "checkbox",
                checked: selectedSet.has(issue.id),
                onChange: () => toggleIssue(issue.id),
              }),
              h("span", { className: `fx-sev ${severityClass(issue.severity)}` }, severityLabel(t, issue.severity)),
              h("span", { className: "fx-cleanup-issue-title" }, issue.title),
              h("span", { className: `fx-status is-${issue.status}` }, statusLabel(t, issue.status)),
              h("span", { className: "fx-muted" }, issue.location),
            ),
          ),
        ),
    h(
      "div",
      { className: "fx-cleanup-actions" },
      h(
        "label",
        { className: "fx-radio" },
        h("input", {
          type: "radio",
          name: "issue-action",
          checked: dialog.issueAction === "archive",
          onChange: () => engine.updateDialog({ issueAction: "archive" }),
        }),
        h("span", null, t("fx.cleanup.archivedSelected")),
      ),
      h(
        "label",
        { className: "fx-radio" },
        h("input", {
          type: "radio",
          name: "issue-action",
          checked: dialog.issueAction === "delete",
          onChange: () => engine.updateDialog({ issueAction: "delete" }),
        }),
        h("span", null, t("fx.cleanup.deleteSelected")),
      ),
    ),
    h("div", { className: "fx-hint" }, t("fx.cleanup.fixedHint")),
    h("div", { className: "fx-cleanup-title" }, t("fx.cleanup.sessions")),
    sessions.length
      ? h(
          "div",
          { className: "fx-cleanup-sessions" },
          sessions.map(({ key, label, session, conversations }) => {
            const sessionBusy = busyKeys.has(key);
            const sessionRisky = riskyKeys.has(key);
            const detached = session?.status === "detached";
            const dismissed = session?.status === "dismissed";
            const count = conversations.length;
            const title = session?.title || conversations[count - 1]?.title || "";
            const fallback = conversations[0]?.conversationId?.slice(0, 10) || "";
            return h(
              "div",
              { className: `fx-cleanup-session${sessionBusy ? " is-running" : ""}`, key },
              h(
                "div",
                { className: "fx-cleanup-session-name" },
                count > 1
                  ? t("fx.cleanup.sessionGroup", { label, count })
                  : `${label} · ${title || fallback}`,
                sessionBusy ? h("span", { className: "fx-running-tag" }, t("fx.cleanup.runningTag")) : null,
              ),
              h(
                "div",
                { className: "fx-cleanup-actions" },
                ["keep", "archive", "delete"].map((action) =>
                  h(
                    "label",
                    { className: "fx-radio", key: action },
                    h("input", {
                      type: "radio",
                      name: `session-${key}`,
                      checked: (dialog.sessions[key] || "keep") === action,
                      disabled: (sessionBusy || sessionRisky) && action !== "keep",
                      onChange: () =>
                        engine.updateDialog({ sessions: { ...dialog.sessions, [key]: action } }),
                    }),
                    h(
                      "span",
                      null,
                      action === "keep"
                        ? t("fx.cleanup.keep")
                        : action === "archive"
                          ? t("fx.cleanup.archive")
                          : t("fx.cleanup.delete"),
                    ),
                  ),
                ),
              ),
              sessionBusy
                ? h("div", { className: "fx-hint" }, t("fx.cleanup.runningHint"))
                : detached || dismissed || sessionRisky
                  ? h("div", { className: "fx-hint" }, t("fx.cleanup.detachedHint"))
                  : null,
            );
          }),
        )
      : h("div", { className: "fx-empty-small" }, t("fx.cleanup.noSessions")),
    historicalCount > 0
      ? h("div", { className: "fx-hint" }, t("fx.cleanup.historicalHint"))
      : null,
    needsRiskAck
      ? h(
          "label",
          { className: "fx-cleanup-ack" },
          h("input", {
            type: "checkbox",
            checked: dialog.riskAcknowledged === true,
            onChange: () =>
              engine.updateDialog({ riskAcknowledged: dialog.riskAcknowledged !== true }),
          }),
          h("span", null, t("fx.cleanup.riskAck")),
        )
      : null,
    h("div", { className: "fx-warn" }, t("fx.cleanup.deleteWarn")),
  );
  const footer = h(
    "div",
    { className: "fx-dialog-actions" },
    h("button", { className: "fx-btn", onClick: () => engine.closeDialog() }, t("fx.cleanup.cancel")),
    h(
      "button",
      {
        className: "fx-btn primary",
        disabled:
          busy ||
          blockedByBusy ||
          blockedByRisky ||
          (needsRiskAck && dialog.riskAcknowledged !== true) ||
          (dialog.issueIds.length === 0 && sessions.length === 0),
        onClick: async () => {
          setBusy(true);
          await engine.confirmDialog();
          setBusy(false);
        },
      },
      t("fx.cleanup.confirm"),
    ),
  );
  return h(
    DialogShell,
    { title: t("fx.cleanup.title"), closeLabel: t("fx.close"), api, error: dialog.error, onClose: () => engine.closeDialog(), footer },
    body,
  );
}

function DeleteDialog({ dialog, snapshot, engine, api, t }) {
  const [busy, setBusy] = useState(false);
  const issues = snapshot.state.issues.filter((issue) => dialog.issueIds.includes(issue.id));
  const fixingCount = issues.filter((issue) => issue.status === ISSUE_STATUS.fixing).length;
  const body = h(
    "div",
    { className: "fx-delete-confirm" },
    h("p", null, t("fx.delete.confirm", { count: issues.length })),
    fixingCount > 0
      ? h("div", { className: "fx-warn" }, t("fx.delete.fixingHint", { count: fixingCount }))
      : null,
    h(
      "div",
      { className: "fx-fix-issues" },
      issues.map((issue) =>
        h(
          "div",
          { className: "fx-fix-issue", key: issue.id },
          h("span", { className: `fx-sev ${severityClass(issue.severity)}` }, severityLabel(t, issue.severity)),
          h("span", { className: "fx-fix-title" }, issue.title),
          h("span", { className: "fx-muted" }, issue.location),
        ),
      ),
    ),
    h("div", { className: "fx-hint" }, t("fx.cleanup.deleteWarn")),
  );
  const footer = h(
    "div",
    { className: "fx-dialog-actions" },
    h("button", { className: "fx-btn", onClick: () => engine.closeDialog() }, t("fx.delete.cancel")),
    h(
      "button",
      {
        className: "fx-btn danger",
        disabled: busy,
        onClick: async () => {
          setBusy(true);
          await engine.confirmDialog();
          setBusy(false);
        },
      },
      t("fx.delete.ok"),
    ),
  );
  return h(
    DialogShell,
    { title: t("fx.delete.title"), closeLabel: t("fx.close"), api, error: dialog.error, onClose: () => engine.closeDialog(), footer },
    body,
  );
}

function SettingsDialog({ dialog, engine, api, t }) {
  const [busy, setBusy] = useState(false);
  const severities = Array.isArray(dialog.issueSeverities)
    ? dialog.issueSeverities
    : DEFAULT_ISSUE_SEVERITIES;
  const autoCleanup = Boolean(dialog.autoCleanupAfterFix);
  const cleanupAction = dialog.autoCleanupAction || "archive";

  // 整行都是 label：点标题、说明或圆钮都能切换，减少小目标点击成本。
  const switchRow = (label, hint, checked, onChange) =>
    h(
      "label",
      { className: "fx-setting is-toggle" },
      h(
        "span",
        { className: "fx-setting-main" },
        h("span", { className: "fx-setting-name" }, label),
        h("span", { className: "fx-setting-hint" }, hint),
      ),
      h(
        "span",
        { className: "fx-switch" },
        h("input", {
          type: "checkbox",
          checked,
          onChange: (event) => onChange(event.target.checked),
        }),
        h("span", { className: "fx-switch-track", "aria-hidden": "true" }),
      ),
    );

  const body = h(
    "div",
    { className: "fx-settings" },
    // 设置读取失败时弹窗展示的是默认值：提示用户保存只会写入实际改动的项。
    dialog.loadFailed ? h("div", { className: "fx-warn" }, t("fx.settings.loadFailedNotice")) : null,
    h(
      "section",
      { className: "fx-settings-section" },
      h("div", { className: "fx-settings-section-title" }, t("fx.settings.groupExecution")),
      h(
        "div",
        { className: "fx-settings-card" },
        h(
          "div",
          { className: "fx-setting" },
          h(
            "div",
            { className: "fx-setting-main" },
            h(
              "label",
              { className: "fx-setting-name", for: "fx-settings-parallel" },
              t("fx.settings.parallel"),
            ),
            h("span", { className: "fx-setting-hint" }, t("fx.settings.parallelHint")),
            h(
              "span",
              { className: "fx-setting-meta" },
              t("fx.settings.parallelRange", {
                min: MIN_PARALLEL_LIMIT,
                max: MAX_PARALLEL_LIMIT,
                default: DEFAULT_PARALLEL_LIMIT,
              }),
            ),
          ),
          h("input", {
            id: "fx-settings-parallel",
            className: "fx-settings-number",
            type: "number",
            min: MIN_PARALLEL_LIMIT,
            max: MAX_PARALLEL_LIMIT,
            step: 1,
            value: dialog.parallelLimit,
            onChange: (event) => engine.updateDialog({ parallelLimit: event.target.value }),
          }),
        ),
      ),
    ),
    h(
      "section",
      { className: "fx-settings-section" },
      h("div", { className: "fx-settings-section-title" }, t("fx.settings.severityScope")),
      h(
        "div",
        { className: "fx-settings-card" },
        h(
          "div",
          { className: "fx-scope-chips" },
          ISSUE_SEVERITIES.map((severity) =>
            h(
              "label",
              { className: "fx-scope-chip", key: severity },
              h("input", {
                type: "checkbox",
                checked: severities.includes(severity),
                onChange: (event) => {
                  const next = event.target.checked
                    ? [...severities, severity]
                    : severities.filter((item) => item !== severity);
                  // 全部取消时 normalizeSeverityScope 会恢复默认范围，避免出现空清单。
                  engine.updateDialog({ issueSeverities: normalizeSeverityScope(next) });
                },
              }),
              h("span", null, severityLabel(t, severity)),
            ),
          ),
        ),
        h("div", { className: "fx-scope-hint" }, t("fx.settings.severityScopeHint")),
      ),
    ),
    h(
      "section",
      { className: "fx-settings-section" },
      h("div", { className: "fx-settings-section-title" }, t("fx.settings.groupAutomation")),
      h(
        "div",
        { className: "fx-settings-card" },
        switchRow(
          t("fx.settings.autoFix"),
          t("fx.settings.autoFixHint"),
          dialog.autoFixAfterReview,
          (checked) => engine.updateDialog({ autoFixAfterReview: checked }),
        ),
        switchRow(
          t("fx.settings.verify"),
          t("fx.settings.verifyHint"),
          dialog.verifyAfterFix,
          (checked) => engine.updateDialog({ verifyAfterFix: checked }),
        ),
        switchRow(
          t("fx.settings.autoCleanup"),
          t("fx.settings.autoCleanupHint"),
          dialog.autoCleanupAfterFix,
          (checked) => engine.updateDialog({ autoCleanupAfterFix: checked }),
        ),
        autoCleanup
          ? h(
              "div",
              { className: "fx-setting fx-setting-sub" },
              h(
                "span",
                { className: "fx-setting-main" },
                h("span", { className: "fx-setting-name" }, t("fx.settings.autoCleanupAction")),
              ),
              h(
                "div",
                {
                  className: "fx-segment",
                  role: "radiogroup",
                  "aria-label": t("fx.settings.autoCleanupAction"),
                },
                ["archive", "delete"].map((action) =>
                  h(
                    "label",
                    {
                      className: [
                        "fx-segment-item",
                        cleanupAction === action ? "is-active" : "",
                        action === "delete" ? "is-danger" : "",
                      ]
                        .filter(Boolean)
                        .join(" "),
                      key: action,
                    },
                    h("input", {
                      type: "radio",
                      name: "fx-auto-cleanup-action",
                      checked: cleanupAction === action,
                      onChange: () => engine.updateDialog({ autoCleanupAction: action }),
                    }),
                    h(
                      "span",
                      null,
                      action === "archive"
                        ? t("fx.settings.cleanupArchive")
                        : t("fx.settings.cleanupDelete"),
                    ),
                  ),
                ),
              ),
            )
          : null,
      ),
    ),
  );
  const footer = h(
    "div",
    { className: "fx-dialog-actions" },
    h("button", { className: "fx-btn", onClick: () => engine.closeDialog() }, t("fx.settings.cancel")),
    h(
      "button",
      {
        className: "fx-btn primary",
        disabled: busy,
        onClick: async () => {
          setBusy(true);
          await engine.confirmDialog();
          setBusy(false);
        },
      },
      t("fx.settings.save"),
    ),
  );
  return h(
    DialogShell,
    { title: t("fx.settings.title"), closeLabel: t("fx.close"), api, error: dialog.error, onClose: () => engine.closeDialog(), footer },
    body,
  );
}

function Dialogs({ dialog, snapshot, engine, api, t }) {
  if (!dialog) return null;
  if (dialog.type === "review") {
    return h(ReviewDialog, { dialog, snapshot, engine, api, t });
  }
  if (dialog.type === "fix") {
    return h(FixDialog, { dialog, snapshot, engine, api, t });
  }
  if (dialog.type === "verify") {
    return h(VerifyDialog, { dialog, snapshot, engine, api, t });
  }
  if (dialog.type === "cleanup") {
    return h(CleanupDialog, { dialog, snapshot, engine, api, t });
  }
  if (dialog.type === "delete") {
    return h(DeleteDialog, { dialog, snapshot, engine, api, t });
  }
  if (dialog.type === "settings") {
    return h(SettingsDialog, { dialog, snapshot, engine, api, t });
  }
  return null;
}

export { Dialogs };
