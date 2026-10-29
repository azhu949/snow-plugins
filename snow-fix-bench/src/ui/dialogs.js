// 面板对话框：审查范围、批量修复确认、结果清理、自定义提示词。
import { h, createPortal, iconEl, severityLabel, severityClass, statusLabel, useEffect, useId, useRef, useState } from "./host.js";
import {
  ISSUE_STATUS,
  DEFAULT_PARALLEL_LIMIT,
  MIN_PARALLEL_LIMIT,
  MAX_PARALLEL_LIMIT,
  ISSUE_SEVERITIES,
  DEFAULT_ISSUE_SEVERITIES,
  CLEANUP_SESSION_KINDS,
  CUSTOM_PROMPT_SLOTS,
  MAX_CUSTOM_PROMPT_CHARS,
} from "../constants.js";
import { normalizeSeverityScope } from "../parse.js";
import { DEFAULT_REVIEW_MODE, REVIEW_MODES, normalizeCleanupSessionKinds } from "../settings.js";
import { defaultRulesForSlot } from "../prompts.js";
import { isSessionBusy, isSessionPossiblyRunning, conversationCleanupGroups } from "../issues.js";

// 会话类型与文案键的映射：设置面板与清理弹窗共用同一组标签。
const CLEANUP_SESSION_LABEL_KEYS = {
  review: "fx.cleanup.reviewSession",
  fix: "fx.cleanup.fixSession",
  verify: "fx.cleanup.verifySession",
};

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
    // 自动暂存会在收尾阶段执行 git add：开启时必须在确认框内披露，条件与引擎执行条件一致。
    snapshot.settings?.autoStageAfterFix === true
      ? h("div", { className: "fx-warn" }, t("fx.fix.stageNotice"))
      : null,
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
  // 目标构成决定标题与确认文案：定向审查复核的是「不存在」结论，不是修复结果。
  const mode = dialog.mode === "recheck" || dialog.mode === "mixed" ? dialog.mode : "verify";
  const notFoundCount = issues.filter((issue) => issue.status === ISSUE_STATUS.notFound).length;
  const fixedCount = issues.length - notFoundCount;
  const confirmKey =
    mode === "recheck"
      ? "fx.verify.confirmRecheck"
      : mode === "mixed"
        ? "fx.verify.confirmMixed"
        : "fx.verify.confirm";
  const body = h(
    "div",
    { className: "fx-fix-confirm" },
    h("p", null, t(confirmKey, { count: issues.length, batches, fixed: fixedCount, notFound: notFoundCount })),
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
          // 复核目标类型必须可见：两类条目的结论语义不同，不能只靠数量判断。
          h("span", { className: `fx-status is-${issue.status}` }, statusLabel(t, issue.status)),
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
      busy ? t("fx.verify.busy") : t(mode === "recheck" ? "fx.verify.recheckStart" : "fx.verify.start"),
    ),
  );
  return h(
    DialogShell,
    {
      title: t(mode === "recheck" ? "fx.verify.recheckTitle" : "fx.verify.title"),
      closeLabel: t("fx.close"),
      api,
      error: dialog.error,
      onClose: () => engine.closeDialog(),
      footer,
    },
    body,
  );
}

function CleanupDialog({ dialog, snapshot, engine, api, t }) {
  const [busy, setBusy] = useState(false);
  // 全部归档 / 全部删除的待确认动作：点击按钮先在内联确认条里二次确认，再直接执行。
  const [pendingAll, setPendingAll] = useState(null);
  const cleanupIssues = snapshot.state.issues.filter((issue) => issue.status !== ISSUE_STATUS.archived);
  // 删除全部会连同修复中的条目一并删除：与批量删除确认框口径一致，先标明影响条数。
  const fixingCount = cleanupIssues.filter((issue) => issue.status === ISSUE_STATUS.fixing).length;
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
  // 「全部处理」与底部确认共用同一组阻塞条件：运行中会话、可能仍在运行的会话、
  // 历史会话风险确认都直接体现在按钮状态上，避免确认后才被引擎拒绝。
  const allBlocked =
    busy ||
    blockedByBusy ||
    blockedByRisky ||
    (needsRiskAck && dialog.riskAcknowledged !== true);
  // 「全部」会强制归档 / 删除全部会话，因此任何仍在运行或可能仍在运行的会话都会让整体操作失败。
  // 逐项的 blockedByBusy / blockedByRisky 只统计被选为归档或删除的会话，不能直接复用。
  const bulkBlocked =
    busy ||
    busyKeys.size > 0 ||
    riskyKeys.size > 0 ||
    (needsRiskAck && dialog.riskAcknowledged !== true);
  const bulkBlockedHint =
    busyKeys.size > 0 || riskyKeys.size > 0
      ? t("fx.cleanup.allRunningHint")
      : needsRiskAck && dialog.riskAcknowledged !== true
        ? t("fx.cleanup.allRiskHint")
        : "";
  // 确认文案要给出实际会话数：只看 issue 条数容易低估「全部」的处理范围。
  const bulkSessionCount = sessions.reduce((sum, entry) => sum + entry.conversations.length, 0);
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
      ? h("div", { className: "fx-empty-small" }, t("fx.cleanup.noIssues"))
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
  // 整体处理入口放在底栏左侧，与「取消 / 确认处理」同一行：
  // 让用户清楚它们与右侧按钮处理的是同一批 issue 与会话。
  const bulkButtons = cleanupIssues.length
    ? h(
        "div",
        { className: "fx-cleanup-bulk" },
        h(
          "button",
          {
            type: "button",
            className: "fx-btn",
            disabled: bulkBlocked,
            title: bulkBlockedHint || undefined,
            onClick: () => setPendingAll(pendingAll === "archive" ? null : "archive"),
          },
          t("fx.cleanup.archiveAll"),
        ),
        h(
          "button",
          {
            type: "button",
            className: "fx-btn danger",
            disabled: bulkBlocked,
            title: bulkBlockedHint || undefined,
            onClick: () => setPendingAll(pendingAll === "delete" ? null : "delete"),
          },
          t("fx.cleanup.deleteAll"),
        ),
      )
    : null;
  // 二次确认条紧贴底栏按钮：确认后 issue 与会话按同一动作整体处理。
  const bulkConfirm =
    pendingAll && cleanupIssues.length
      ? h(
          "div",
          { className: `fx-cleanup-bulk-confirm${pendingAll === "delete" ? " is-danger" : ""}` },
          h(
            "span",
            { className: "fx-cleanup-bulk-text" },
            t(
              pendingAll === "delete" ? "fx.cleanup.confirmDeleteAll" : "fx.cleanup.confirmArchiveAll",
              { count: cleanupIssues.length, sessions: bulkSessionCount },
            ),
          ),
          pendingAll === "delete" && fixingCount > 0
            ? h(
                "div",
                { className: "fx-warn fx-cleanup-bulk-warn" },
                t("fx.delete.fixingHint", { count: fixingCount }),
              )
            : null,
          h(
            "div",
            { className: "fx-cleanup-bulk-actions" },
            h(
              "button",
              {
                type: "button",
                className: "fx-btn small ghost",
                disabled: busy,
                onClick: () => setPendingAll(null),
              },
              t("fx.cleanup.cancel"),
            ),
            h(
              "button",
              {
                type: "button",
                className: `fx-btn small ${pendingAll === "delete" ? "danger" : "primary"}`,
                disabled: busy,
                onClick: async () => {
                  setBusy(true);
                  await engine.confirmCleanupAll(pendingAll);
                  setBusy(false);
                  setPendingAll(null);
                },
              },
              t(pendingAll === "delete" ? "fx.cleanup.deleteAllOk" : "fx.cleanup.archiveAllOk"),
            ),
          ),
        )
      : null;
  const footer = h(
    "div",
    { className: "fx-cleanup-foot" },
    bulkConfirm,
    h(
      "div",
      { className: "fx-dialog-actions fx-cleanup-foot-actions" },
      bulkButtons,
      h(
        "div",
        { className: "fx-cleanup-foot-main" },
        h("button", { className: "fx-btn", onClick: () => engine.closeDialog() }, t("fx.cleanup.cancel")),
        h(
          "button",
          {
            className: "fx-btn primary",
            // 批量确认条展开时先处理它，避免把右侧确认误当成对批量动作的确认。
            disabled:
              allBlocked ||
              pendingAll !== null ||
              (dialog.issueIds.length === 0 && sessions.length === 0),
            onClick: async () => {
              setBusy(true);
              await engine.confirmDialog();
              setBusy(false);
            },
          },
          t("fx.cleanup.confirm"),
        ),
      ),
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

// API 供应商选择器：可搜索下拉框（参照宿主用量统计的 CustomSelect）。
// 收起时只占一行；展开层经 portal 渲染到 document.body 并 fixed 锚定在触发按钮上，
// 逃逸设置卡片 / 弹窗的 overflow 裁剪。列表保持宿主全局设置的档案顺序。
function ApiProfilePicker({ dialog, engine, api, t, headRow }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [popRect, setPopRect] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const searchRef = useRef(null);
  const profiles = Array.isArray(dialog.apiProfiles) ? dialog.apiProfiles : [];
  const state = dialog.apiProfilesState;
  const selected = String(dialog.apiProfile || "");
  const search = query.trim().toLowerCase();
  const label = (profile) =>
    profile.displayName && profile.displayName !== profile.profileName
      ? `${profile.profileName} · ${profile.displayName}`
      : profile.profileName;
  // 搜索只过滤不重排；匹配档案名与显示名，两者都可能被用来搜。
  const visible = search
    ? profiles.filter((profile) => {
        const name = profile.profileName.toLowerCase();
        const display = profile.displayName.toLowerCase();
        return name.includes(search) || display.includes(search);
      })
    : profiles;
  const selectedProfile = profiles.find((profile) => profile.profileName === selected);
  const triggerLabel = selected
    ? selectedProfile
      ? label(selectedProfile)
      : selected
    : t("fx.settings.apiProfileFollow");
  // 已保存的档案不在宿主清单里（被删除或改名）：保留选择并提示，避免静默丢失。
  const missing = selected && state === "ready" && !selectedProfile;

  // 打开时测量并锚定下拉位置；resize / 滚动（含捕获阶段）期间跟随触发按钮。
  // 下方空间不足且上方更宽裕时向上弹出，避免贴近视口底部的触发按钮被截断。
  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    const measure = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 240);
      const maxLeft = Math.max(0, window.innerWidth - width - 8);
      const estimatedHeight = 306;
      const fitBelow = window.innerHeight - rect.bottom - 4;
      const top =
        fitBelow < estimatedHeight && rect.top > fitBelow
          ? Math.max(8, rect.top - estimatedHeight - 4)
          : rect.bottom + 4;
      setPopRect({ top, left: Math.min(rect.left, maxLeft), width });
    };
    measure();
    // 下拉挂载后再聚焦搜索框，与宿主 CustomSelect 的打开体验一致。
    requestAnimationFrame(() => searchRef.current?.focus());
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  // 外点与 Escape 收起：下拉在 portal 里不在容器内，须单独判断。
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (rootRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const pick = (value) => {
    setOpen(false);
    engine.updateDialog({ apiProfile: value });
  };

  const row = (value, title, badge) =>
    h(
      "button",
      {
        type: "button",
        className: `fx-profile-row ${selected === value ? "is-selected" : ""}`,
        key: value || "__follow__",
        role: "option",
        "aria-selected": selected === value ? "true" : "false",
        onClick: () => pick(value),
      },
      h("span", { className: "fx-profile-row-label" }, title),
      badge || null,
      selected === value
        ? h("span", { className: "fx-profile-check" }, iconEl(api, "Check", 12))
        : null,
    );

  // 读取失败且没有绑定值时只提示；有绑定值时仍渲染选择器（清单为空时只有
  // 「跟随全局设置」一行），否则失效的档案名无法在界面上改回跟随全局设置。
  if (state === "error" && !selected) {
    return h(
      "div",
      { className: "fx-setting is-stack" },
      headRow(t("fx.settings.apiProfile"), null),
      h("span", { className: "fx-hint" }, t("fx.settings.apiProfileHint")),
      h("span", { className: "fx-hint" }, t("fx.settings.apiProfilesFailed")),
    );
  }

  return h(
    "div",
    { className: "fx-setting is-stack" },
    headRow(
      t("fx.settings.apiProfile"),
      h(
        "div",
        { className: "fx-combobox", ref: rootRef },
      h(
        "button",
        {
          type: "button",
          className: "fx-combobox-trigger",
          ref: triggerRef,
          "aria-haspopup": "listbox",
          "aria-expanded": open ? "true" : "false",
          // 清单为空但有绑定值时仍可打开：至少能选回「跟随全局设置」。
          disabled: state === "loading" || (!profiles.length && !selected),
          onClick: () => setOpen(!open),
        },
        h(
          "span",
          { className: "fx-combobox-value", title: triggerLabel },
          state === "loading" ? t("fx.settings.apiProfilesLoading") : triggerLabel,
        ),
        h("span", { className: `fx-combobox-caret ${open ? "is-open" : ""}` }, iconEl(api, "ChevronDown", 12)),
      ),
      state === "ready" && !profiles.length && !selected
        ? h("span", { className: "fx-hint" }, t("fx.settings.apiProfilesEmpty"))
        : null,
      state === "error" ? h("span", { className: "fx-hint" }, t("fx.settings.apiProfilesFailed")) : null,
      ),
    ),
    h("span", { className: "fx-hint" }, t("fx.settings.apiProfileHint")),
    open && popRect
      ? createPortal(
          h(
            "div",
            {
              className: "fx-combobox-pop",
              ref: popRef,
              style: {
                position: "fixed",
                top: `${popRect.top}px`,
                left: `${popRect.left}px`,
                width: `${popRect.width}px`,
              },
            },
            h("input", {
              className: "fx-search fx-profile-search",
              ref: searchRef,
              type: "text",
              placeholder: t("fx.settings.apiProfileSearch"),
              "aria-label": t("fx.settings.apiProfileSearch"),
              value: query,
              onChange: (event) => setQuery(event.target.value),
            }),
            h(
              "div",
              { className: "fx-profile-list", role: "listbox", "aria-label": t("fx.settings.apiProfile") },
              row("", t("fx.settings.apiProfileFollow"), h("span", { className: "fx-profile-badge" }, t("fx.settings.apiProfileFollowBadge"))),
              visible.map((profile) =>
                row(profile.profileName, label(profile), profile.isActive
                  ? h("span", { className: "fx-profile-badge is-active" }, t("fx.settings.apiProfileActiveBadge"))
                  : null),
              ),
              search && !visible.length
                ? h("div", { className: "fx-profile-empty fx-hint", key: "__no-hit__" }, t("fx.settings.apiProfileNoHit"))
                : null,
            ),
          ),
          document.body,
        )
      : null,
    missing
      ? h(
          "div",
          { className: "fx-warn fx-settings-profile-missing" },
          h(
            "span",
            { className: "fx-settings-profile-missing-text" },
            t("fx.settings.apiProfileMissing", { name: selected }),
          ),
          h(
            "button",
            {
              type: "button",
              className: "fx-btn small",
              onClick: () => engine.updateDialog({ apiProfile: "" }),
            },
            t("fx.settings.apiProfileClear"),
          ),
        )
      : null,
  );
}

function SettingsDialog({ dialog, engine, api, t }) {
  const [busy, setBusy] = useState(false);
  const severities = Array.isArray(dialog.issueSeverities)
    ? dialog.issueSeverities
    : DEFAULT_ISSUE_SEVERITIES;
  const autoCleanup = Boolean(dialog.autoCleanupAfterFix);
  const cleanupAction = dialog.autoCleanupAction || "archive";
  const cleanupSessionKinds = normalizeCleanupSessionKinds(dialog.autoCleanupSessionKinds);
  const reviewMode = dialog.reviewMode || DEFAULT_REVIEW_MODE;

  // 名称行与常显说明：说明常驻可见，键盘、触屏与读屏用户无需悬停即可读到。
  const nameRow = (label, hint) =>
    h(
      "span",
      { className: "fx-setting-name-block" },
      h("span", { className: "fx-setting-name" }, label),
      h("span", { className: "fx-hint" }, hint),
    );

  // 整行都是 label：点标题或圆钮都能切换，说明常显在名称下方。
  const switchRow = (label, hint, checked, onChange) =>
    h(
      "label",
      { className: "fx-setting is-toggle" },
      h("span", { className: "fx-setting-main" }, nameRow(label, hint)),
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

  // 首行：名称在左、控件在右；说明由调用方放在下一行，跨整行展示。
  const headRow = (label, control) =>
    h(
      "div",
      { className: "fx-setting-head" },
      h("span", { className: "fx-setting-name" }, label),
      control,
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
        // 审查方式：决定打开审查弹窗时默认勾选的变更范围。
        h(
          "div",
          { className: "fx-setting is-stack" },
          headRow(
            t("fx.settings.reviewMode"),
            h(
              "div",
              {
                className: "fx-segment",
                role: "radiogroup",
                "aria-label": t("fx.settings.reviewMode"),
              },
              REVIEW_MODES.map((mode) =>
                h(
                  "label",
                  {
                    className: `fx-segment-item ${reviewMode === mode ? "is-active" : ""}`,
                    key: mode,
                  },
                  h("input", {
                    type: "radio",
                    name: "fx-review-mode",
                    checked: reviewMode === mode,
                    onChange: () => engine.updateDialog({ reviewMode: mode }),
                  }),
                  h("span", null, t(`fx.settings.reviewMode.${mode}`)),
                ),
              ),
            ),
          ),
          // 说明跨整行：右侧分段控件不再挤压文字宽度。
          h("span", { className: "fx-hint" }, t("fx.settings.reviewModeHint")),
        ),
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
            // 并行上限决定单次批量规模：说明常显，键盘与触屏用户都能直接读到。
            h("span", { className: "fx-hint" }, t("fx.settings.parallelHint")),
            h(
              "span",
              { className: "fx-hint" },
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
        // API 供应商：可搜索下拉框，顺序与宿主全局设置的档案列表一致。
          h(ApiProfilePicker, {
            dialog,
            engine,
            api,
            t,
            headRow,
          }),
      ),
    ),
    h(
      "section",
      { className: "fx-settings-section" },
      h("div", { className: "fx-settings-section-title" }, t("fx.settings.severityScope")),
      // 修复范围说明常显在分组标题下方：不依赖悬停即可读取。
      h("div", { className: "fx-hint" }, t("fx.settings.severityScopeHint")),
      h(
        "div",
        { className: "fx-settings-card" },
        h(
          "div",
          { className: "fx-check-list" },
          ISSUE_SEVERITIES.map((severity) =>
            h(
              "label",
              { className: "fx-check-row", key: severity },
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
          t("fx.settings.stageAfterFix"),
          t("fx.settings.stageAfterFixHint"),
          dialog.autoStageAfterFix === true,
          (checked) => engine.updateDialog({ autoStageAfterFix: checked }),
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
        autoCleanup
          ? h(
              "div",
              { className: "fx-setting fx-setting-sub is-stack" },
              headRow(
                t("fx.settings.autoCleanupSessions"),
                h(
                  "div",
                  { className: "fx-check-list" },
                  CLEANUP_SESSION_KINDS.map((kind) =>
                    h(
                      "label",
                      { className: "fx-check-row", key: kind },
                      h("input", {
                        type: "checkbox",
                        checked: cleanupSessionKinds.includes(kind),
                        onChange: (event) => {
                          const next = event.target.checked
                            ? [...cleanupSessionKinds, kind]
                            : cleanupSessionKinds.filter((item) => item !== kind);
                          engine.updateDialog({
                            autoCleanupSessionKinds: normalizeCleanupSessionKinds(next),
                          });
                        },
                      }),
                      h("span", null, t(CLEANUP_SESSION_LABEL_KEYS[kind])),
                    ),
                  ),
                ),
              ),
              // 说明跨整行：会话范围说明较长，不能挤在复选框左侧的窄列里。
              h("span", { className: "fx-hint" }, t("fx.settings.autoCleanupSessionsHint")),
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
  if (dialog.type === "prompts") {
    return h(PromptsDialog, { dialog, engine, api, t });
  }
  return null;
}

// 自定义提示词编辑弹窗：三类插槽 = 只读固定规则 + 可编辑附加要求（开关 + 多行文本）。
// 固定规则来自与构建函数同一份文案源，展示与实际注入内容不会漂移。
function PromptsDialog({ dialog, engine, api, t }) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleRules = (slot) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });
  };
  const body = h(
    "div",
    { className: "fx-prompts" },
    dialog.loadFailed ? h("div", { className: "fx-warn" }, t("fx.settings.loadFailedNotice")) : null,
    h("p", { className: "fx-prompts-desc" }, t("fx.prompts.description")),
    CUSTOM_PROMPT_SLOTS.map((slot) =>
      h(
        "section",
        { className: "fx-prompts-slot", key: slot },
        h(
          "label",
          { className: "fx-prompts-slot-head" },
          h(
            "div",
            { className: "fx-setting-main" },
            h("span", { className: "fx-setting-name" }, t(`fx.prompts.slot.${slot}`)),
            h("span", { className: "fx-hint" }, t(`fx.prompts.slotHint.${slot}`)),
          ),
          h(
            "span",
            { className: "fx-switch" },
            h("input", {
              type: "checkbox",
              checked: dialog[slot]?.enabled === true,
              "aria-label": t(`fx.prompts.slot.${slot}`),
              onChange: (event) =>
                engine.updateDialog({
                  [slot]: { ...dialog[slot], enabled: event.target.checked },
                }),
            }),
            h("span", { className: "fx-switch-track", "aria-hidden": "true" }),
          ),
        ),
        h("textarea", {
          className: "fx-prompts-input",
          rows: 4,
          placeholder: t(`fx.prompts.placeholder.${slot}`),
          value: dialog[slot]?.text || "",
          maxLength: MAX_CUSTOM_PROMPT_CHARS,
          disabled: dialog[slot]?.enabled !== true,
          onChange: (event) =>
            engine.updateDialog({
              [slot]: { ...dialog[slot], text: event.target.value },
            }),
        }),
        h(
          "div",
          { className: "fx-prompts-meta" },
          h(
            "span",
            { className: "fx-hint" },
            t("fx.prompts.chars", { count: (dialog[slot]?.text || "").length, max: MAX_CUSTOM_PROMPT_CHARS }),
          ),
          h(
            "button",
            { className: "fx-prompts-toggle", onClick: () => toggleRules(slot) },
            expanded.has(slot) ? t("fx.issues.less") : t("fx.prompts.defaultRules"),
          ),
        ),
        expanded.has(slot)
          ? h("pre", { className: "fx-prompts-rules" }, defaultRulesForSlot(slot, api?.locale))
          : null,
      ),
    ),
    h("div", { className: "fx-prompts-note" }, t("fx.prompts.conflictNote")),
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
    { title: t("fx.prompts.title"), closeLabel: t("fx.close"), api, error: dialog.error, onClose: () => engine.closeDialog(), footer },
    body,
  );
}

export { Dialogs };
