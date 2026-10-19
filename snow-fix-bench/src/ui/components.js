// 面板展示组件：流程条、文件树、issue 卡片与活动卡片。
import { h, iconEl, STEP_KEYS, formatElapsed, formatDateTime, statusLabel, severityLabel, severityClass, useEffect, useState } from "./host.js";
import { ISSUE_STATUS, SEVERITY } from "../constants.js";
import { statusCounts, isFixSelectable } from "../issues.js";

function Stepper({ current, t, api }) {
  const currentIndex = STEP_KEYS.indexOf(current);
  return h(
    "nav",
    { className: "fx-steps", "aria-label": t("fx.name") },
    STEP_KEYS.map((key, index) => {
      const state = index < currentIndex ? "is-done" : index === currentIndex ? "is-active" : "";
      return h(
        "div",
        { className: `fx-step ${state}`, key },
        h(
          "span",
          { className: "fx-step-index" },
          index < currentIndex ? iconEl(api, "Check", 11) : String(index + 1),
        ),
        h("span", { className: "fx-step-label" }, t(`fx.step.${key}`)),
      );
    }),
  );
}

function ProjectRow({ directory, color, active, engine, t }) {
  return h(
    "button",
    {
      className: `fx-project-row ${active ? "is-active" : ""}`,
      title: directory.path || directory.name,
      onClick: () => void engine.activateProject(directory.directoryId),
    },
    h("span", {
      className: `fx-project-dot ${color ? "" : "is-default"}`,
      style: color ? { background: color } : undefined,
    }),
    h("span", { className: "fx-project-name" }, directory.name || directory.path),
    active ? h("span", { className: "fx-project-current" }, t("fx.projects.current")) : null,
  );
}

// 合集默认折叠：只保留当前项目所在的分组展开，其余分组收起。
function defaultCollapsedGroups(groupIds, activeGroupId) {
  return new Set(groupIds.filter((groupId) => groupId !== activeGroupId));
}

function ProjectPane({ snapshot, engine, api, t }) {
  const projects = snapshot.projects || { directories: [], collections: [] };
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [autoSeeded, setAutoSeeded] = useState(false);
  const activeId = snapshot.project?.directoryId || projects.activeId;
  const directoryMap = new Map(projects.directories.map((item) => [item.directoryId, item]));
  const grouped = new Set();
  const groups = projects.collections
    .map((collection) => {
      const members = collection.memberDirectoryIds
        .map((directoryId) => directoryMap.get(directoryId))
        .filter(Boolean);
      for (const member of members) grouped.add(member.directoryId);
      return { ...collection, members };
    })
    .filter((collection) => collection.members.length > 0);
  const ungrouped = projects.directories.filter((directory) => !grouped.has(directory.directoryId));
  const activeGroupId =
    groups.find((group) => group.members.some((item) => item.directoryId === activeId))?.collectionId ||
    (groups.length && ungrouped.some((item) => item.directoryId === activeId) ? "ungrouped" : "");
  // 首次拿到项目数据时按「只展开当前项目所在分组」播种；之后宿主切换项目会展开新的分组，
  // 但用户手动折叠当前分组后 activeGroupId 不变，不会被强制打开。
  useEffect(() => {
    const groupIds = groups.map((group) => group.collectionId);
    if (groups.length && ungrouped.length) groupIds.push("ungrouped");
    if (!autoSeeded) {
      if (groupIds.length === 0) return;
      setCollapsed(defaultCollapsedGroups(groupIds, activeGroupId));
      setAutoSeeded(true);
      return;
    }
    if (!activeGroupId) return;
    setCollapsed((current) => {
      if (!current.has(activeGroupId)) return current;
      const next = new Set(current);
      next.delete(activeGroupId);
      return next;
    });
  }, [autoSeeded, activeGroupId, groups.length, ungrouped.length]);
  const toggleGroup = (groupId) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };
  const renderGroupHead = (groupId, color, name, count, iconName = "Library") => {
    const isCollapsed = collapsed.has(groupId);
    return h(
      "button",
      {
        type: "button",
        className: "fx-project-group-head",
        onClick: () => toggleGroup(groupId),
        "aria-expanded": !isCollapsed,
        title: name,
      },
      h(
        "span",
        { className: "fx-project-chevron" },
        iconEl(api, isCollapsed ? "ChevronRight" : "ChevronDown", 12),
      ),
      h("span", { className: "fx-project-group-icon" }, iconEl(api, iconName, 13)),
      h("span", {
        className: `fx-project-dot${color ? "" : " is-default"}`,
        style: color ? { background: color } : undefined,
      }),
      h("span", { className: "fx-project-group-name" }, name),
      h("span", { className: "fx-project-group-count" }, String(count)),
    );
  };
  const renderRow = (directory, color) =>
    h(ProjectRow, {
      key: directory.directoryId,
      directory,
      color,
      active: directory.directoryId === activeId,
      engine,
      t,
    });
  return h(
    "aside",
    { className: "fx-pane fx-left" },
    h(
      "div",
      { className: "fx-pane-head" },
      h("span", { className: "fx-pane-title" }, t("fx.projects.title")),
      h(
        "button",
        { className: "fx-icon-btn", title: t("fx.refreshTitle"), onClick: () => engine.refresh() },
        iconEl(api, "RefreshCw", 13),
      ),
    ),
    h(
      "div",
      { className: "fx-projects" },
      groups.map((group) => {
        const isCollapsed = collapsed.has(group.collectionId);
        return h(
          "div",
          { className: "fx-project-group", key: group.collectionId },
          renderGroupHead(group.collectionId, group.color, group.name, group.members.length),
          isCollapsed ? null : group.members.map((directory) => renderRow(directory, group.color)),
        );
      }),
      ungrouped.length
        ? h(
            "div",
            { className: "fx-project-group" },
            groups.length
              ? renderGroupHead("ungrouped", "", t("fx.projects.ungrouped"), ungrouped.length, "Folder")
              : null,
            groups.length && collapsed.has("ungrouped")
              ? null
              : ungrouped.map((directory) => renderRow(directory, "")),
          )
        : null,
      projects.directories.length === 0
        ? h("div", { className: "fx-empty-small" }, t("fx.projects.empty"))
        : null,
    ),
  );
}

function IssueCard({ issue, selected, engine, api, t }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmLeft, setConfirmLeft] = useState(0);
  const archived = issue.status === ISSUE_STATUS.archived;
  // 重开来源决定详情文案：not_found 重开是取证结论被推翻，不是修复后回归。
  const reopenedKey =
    issue.reopenedFrom === ISSUE_STATUS.notFound ? "fx.issues.overturned" : "fx.issues.regressed";
  useEffect(() => {
    if (confirmLeft <= 0) return;
    const timer = setInterval(() => setConfirmLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [confirmLeft > 0]);
  const requestDelete = () => {
    if (confirmLeft <= 0) {
      setConfirmLeft(4);
      return;
    }
    setConfirmLeft(0);
    void engine.deleteIssue(issue.id);
  };
  return h(
    "article",
    { className: `fx-issue ${selected ? "is-selected" : ""} is-${issue.status}` },
    h(
      "div",
      { className: "fx-issue-head" },
      h("input", {
        type: "checkbox",
        checked: selected,
        onChange: () => engine.toggleSelected(issue.id),
        "aria-label": issue.title,
      }),
      h("span", { className: `fx-sev ${severityClass(issue.severity)}` }, severityLabel(t, issue.severity)),
      h(
        "button",
        { className: "fx-issue-title", onClick: () => setExpanded(!expanded), title: issue.title },
        issue.title,
      ),
      h("span", { className: `fx-status is-${issue.status}` }, statusLabel(t, issue.status)),
    ),
    h(
      "div",
      { className: "fx-issue-meta" },
      issue.location
        ? h(
            "button",
            { className: "fx-link", onClick: () => engine.openIssueLocation(issue) },
            h("span", { className: "fx-link-icon" }, iconEl(api, "MapPin", 11)),
            issue.location,
          )
        : h("span", { className: "fx-muted" }, t("fx.issues.unlocated")),
      h(
        "button",
        { className: "fx-link", onClick: () => setExpanded(!expanded) },
        expanded ? t("fx.issues.less") : t("fx.issues.more"),
      ),
    ),
    expanded
      ? h(
          "div",
          { className: "fx-issue-detail" },
          issue.impact
            ? h("p", null, h("b", null, t("fx.issues.impact")), h("span", null, issue.impact))
            : null,
          issue.suggestion
            ? h("p", null, h("b", null, t("fx.issues.suggestion")), h("span", null, issue.suggestion))
            : null,
          issue.fix?.summary
            ? h(
                "p",
                null,
                h("b", null, t("fx.issues.fixNote")),
                h("span", null, issue.fix.summary),
                issue.fix.verification ? h("span", { className: "fx-muted" }, ` · ${issue.fix.verification}`) : null,
              )
            : null,
          issue.regression
            ? h(
                "p",
                { className: "fx-regressed" },
                `${t(reopenedKey)} · ${issue.regression.count || 1}`,
              )
            : null,
          issue.source?.conversationId
            ? h(
                "p",
                null,
                h("b", null, t("fx.issues.source")),
                h(
                  "button",
                  { className: "fx-link", onClick: () => engine.openConversation(issue.source.conversationId) },
                  issue.source.conversationId.slice(0, 12),
                ),
              )
            : null,
          h(
            "div",
            { className: "fx-issue-actions" },
            archived
              ? h("button", { className: "fx-btn small", onClick: () => void engine.restoreIssue(issue.id) }, t("fx.issues.restore"))
              : h("button", { className: "fx-btn small", onClick: () => void engine.archiveIssue(issue.id) }, t("fx.issues.archive")),
            h(
              "button",
              { className: `fx-btn small ${confirmLeft > 0 ? "danger" : ""}`, onClick: requestDelete },
              confirmLeft > 0 ? `${t("fx.confirm.ok")} (${confirmLeft})` : t("fx.issues.delete"),
            ),
          ),
        )
      : null,
  );
}

function IssuesSection({ snapshot, visible, engine, api, t }) {
  const counts = statusCounts(snapshot.state.issues);
  const selected = snapshot.selected;
  // 清理入口同时覆盖已修复与已确认不存在的条目：两者都已定论，不再需要修复。
  const settledCount = counts.fixed + counts.not_found;
  const toggleFilters = [
    { key: "all", label: t("fx.issues.filterAll") },
    { key: SEVERITY.critical, label: t("fx.issues.filterCritical") },
    { key: SEVERITY.major, label: t("fx.issues.filterMajor") },
  ];
  // 归档项也能勾选（用于批量删除），但「修复选中项」只统计仍可修复的条目：
  // 已修复与已确认不存在都已定论，再次投入修复会在会话失败时覆盖结论。
  const selectableIds = visible.map((issue) => issue.id);
  const fixableSelectedCount = snapshot.state.issues.filter(
    (issue) => selected.includes(issue.id) && isFixSelectable(issue),
  ).length;
  // 清理入口也要覆盖没有当前跟踪会话、但存在历史会话台账的情况。
  const hasSessionLog =
    (snapshot.state.conversationLog || []).length > 0 ||
    Boolean(snapshot.state.sessions.review) ||
    Boolean(snapshot.state.sessions.fix);
  return h(
    "section",
    { className: "fx-section" },
    h(
      "div",
      { className: "fx-section-head" },
      h(
        "div",
        { className: "fx-section-title" },
        t("fx.issues.title"),
        h("span", { className: "fx-count" }, t("fx.issues.count", { count: counts.open + counts.fixing + settledCount })),
      ),
      h(
        "div",
        { className: "fx-section-actions" },
        h("button", { className: "fx-btn small", onClick: () => engine.openReviewDialog() }, t("fx.review.title")),
        h(
          "button",
          {
            className: "fx-btn small primary",
            disabled: fixableSelectedCount === 0,
            onClick: () => engine.openFixDialog(),
          },
          t("fx.issues.startFix", { count: fixableSelectedCount }),
        ),
        h(
          "button",
          {
            className: "fx-btn small danger",
            disabled: selected.length === 0,
            onClick: () => engine.deleteSelectedIssues(),
          },
          t("fx.issues.deleteSelected", { count: selected.length }),
        ),
        settledCount > 0 || hasSessionLog
          ? h(
              "button",
              { className: "fx-btn small", onClick: () => engine.openCleanupDialog() },
              t("fx.cleanup.open"),
            )
          : null,
      ),
    ),
    h(
      "div",
      { className: "fx-filters" },
      toggleFilters.map((item) =>
        h(
          "button",
          {
            key: item.key,
            className: `fx-chip ${snapshot.severityFilter === item.key ? "is-active" : ""}`,
            onClick: () => engine.setSeverityFilter(item.key),
          },
          item.label,
        ),
      ),
      h(
        "label",
        { className: "fx-check" },
        h("input", {
          type: "checkbox",
          checked: snapshot.showArchived,
          onChange: (event) => engine.setShowArchived(event.target.checked),
        }),
        h("span", null, snapshot.showArchived ? t("fx.issues.hideArchived") : t("fx.issues.showArchived")),
      ),
      h(
        "button",
        { className: "fx-link", onClick: () => engine.selectMany(selectableIds) },
        t("fx.issues.selectAll"),
      ),
      selected.length > 0
        ? h(
            "button",
            { className: "fx-link", onClick: () => engine.clearSelection() },
            t("fx.issues.clearSelection"),
          )
        : null,
      selected.length > 0 ? h("span", { className: "fx-muted" }, t("fx.issues.selected", { count: selected.length })) : null,
    ),
    h(
      "div",
      { className: "fx-issues" },
      visible.length === 0
        ? h("div", { className: "fx-empty-small" }, t("fx.issues.empty"))
        : visible.map((issue) =>
            h(IssueCard, {
              key: issue.id,
              issue,
              selected: selected.includes(issue.id),
              engine,
              api,
              t,
            }),
          ),
    ),
  );
}

function ActivityCard({ activity, engine, api, t }) {
  const running = !["done", "error", "detached"].includes(activity.phase);
  // 手动停止或跟踪报错后允许重新挂接同一会话，继续读取后续输出。
  const resumable = activity.phase === "detached" || activity.phase === "error";
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const elapsed = activity.startedAt ? formatElapsed(now - activity.startedAt) : "";
  let phaseText = "";
  if (activity.phase === "waiting") phaseText = t("fx.activity.waiting");
  else if (activity.phase === "streaming") phaseText = t("fx.activity.streaming");
  else if (activity.phase === "done") phaseText = t("fx.activity.done");
  else if (activity.phase === "detached") phaseText = t("fx.activity.detached");
  return h(
    "section",
    { className: `fx-activity is-${activity.phase}` },
    h(
      "div",
      { className: "fx-activity-head" },
      h("span", { className: `fx-pulse ${running ? "is-running" : ""}` }, running ? null : iconEl(api, "Check", 12)),
      h("b", null, activity.kind === "review" ? t("fx.activity.review") : t("fx.activity.fix")),
      elapsed ? h("span", { className: "fx-muted" }, t("fx.activity.elapsed", { time: elapsed })) : null,
      activity.batchTotal > 1
        ? h(
            "span",
            { className: "fx-muted" },
            t("fx.activity.batch", {
              batch: activity.batchNumber || 1,
              total: activity.batchTotal,
            }),
          )
        : null,
      h("span", { className: "fx-muted fx-activity-id" }, t("fx.activity.session", { id: activity.conversationId.slice(0, 10) })),
    ),
    h("div", { className: "fx-activity-body" }, phaseText),
    activity.error ? h("div", { className: "fx-error" }, activity.error) : null,
    activity.timedOut ? h("div", { className: "fx-warn" }, t("fx.activity.timeout")) : null,
    h(
      "div",
      { className: "fx-activity-actions" },
      h(
        "button",
        { className: "fx-btn small", onClick: () => void engine.openConversation(activity.conversationId) },
        t("fx.activity.open"),
      ),
      running
        ? h("button", { className: "fx-btn small", onClick: () => void engine.detachTracking() }, t("fx.activity.detach"))
        : resumable
          ? [
              h(
                "button",
                { key: "resume", className: "fx-btn small", onClick: () => void engine.resumeActivityTracking() },
                t("fx.activity.resume"),
              ),
              h(
                "button",
                { key: "parse", className: "fx-btn small", onClick: () => void engine.retryParse() },
                t("fx.activity.parseRetry"),
              ),
            ]
          : null,
      h("button", { className: "fx-btn small", onClick: () => void engine.dismissActivity() }, t("fx.activity.close")),
    ),
    h("div", { className: "fx-hint" }, t("fx.activity.hint")),
  );
}

function EmptyState({ snapshot, engine, api, t }) {
  return h(
    "section",
    { className: "fx-empty" },
    h("div", { className: "fx-empty-mark" }, iconEl(api, "ListChecks", 22)),
    h("div", { className: "fx-empty-title" }, t("fx.empty.title")),
    h("p", { className: "fx-empty-desc" }, t("fx.empty.desc")),
    h(
      "button",
      { className: "fx-btn primary", onClick: () => engine.openReviewDialog() },
      t("fx.empty.start"),
    ),
    h("div", { className: "fx-hint" }, t("fx.empty.hint")),
    snapshot.state.lastReviewAt
      ? h("div", { className: "fx-muted" }, `${formatDateTime(snapshot.state.lastReviewAt)}`)
      : null,
  );
}

export { Stepper, ProjectPane, IssuesSection, ActivityCard, EmptyState, defaultCollapsedGroups };
