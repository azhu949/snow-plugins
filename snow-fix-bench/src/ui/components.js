// 面板展示组件：流程条、文件树、issue 卡片与活动卡片。
import { h, iconEl, STEP_KEYS, formatElapsed, formatDateTime, statusLabel, severityLabel, severityClass, memo, useEffect, useState } from "./host.js";
import { ISSUE_STATUS, SEVERITY } from "../constants.js";
import { statusCounts, isFixSelectable, isVerifySelectable, groupIssuesByFile } from "../issues.js";

function Stepper({ current, snapshot, t, api }) {
  const currentIndex = STEP_KEYS.indexOf(current);
  // 复审属于修复阶段的内部状态：不新增步骤，只在修复节点上显示副标。
  const verifying = snapshot?.state?.sessions?.verify?.status === "running";
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
        key === "fix" && verifying
          ? h("span", { className: "fx-step-sub" }, t("fx.step.verifying"))
          : null,
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

// 卡片只依赖单条 issue 与勾选状态：活动指标刷新不重建行，memo 才能跳到下一次渲染。
const IssueCard = memo(function IssueCard({ issue, selected, engine, api, t }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmLeft, setConfirmLeft] = useState(0);
  const archived = issue.status === ISSUE_STATUS.archived;
  // 重开来源决定详情文案：not_found 重开是取证结论被推翻，不是修复后回归。
  const reopenedKey =
    issue.reopenedFrom === ISSUE_STATUS.notFound ? "fx.issues.overturned" : "fx.issues.regressed";
  // 修复结果：改动文件去重后逐个做成文件链接，验证摘要单行展示。
  const fixFiles = Array.from(
    new Set(
      (issue.fix?.files || [])
        .map((file) => String(file || "").trim())
        .filter(Boolean),
    ),
  );
  const fixVerification = String(issue.fix?.verification || "").trim();
  // 仅当最后一次修复结论仍然有效时才把文件与验证当作当前结果：
  // blocked / not_found 未改动代码；回归重开或复审未通过的条目 fix 只是历史记录。
  // 归档项只有从「已修复」归档时才继续展示。
  const fixIsCurrent =
    issue.fix?.result === "fixed" &&
    (issue.status === ISSUE_STATUS.fixed ||
      (issue.status === ISSUE_STATUS.archived && issue.archivedFrom === ISSUE_STATUS.fixed));
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
      issue.verify?.status === "still_present"
        ? h("span", { className: "fx-verify-badge is-failed" }, t("fx.issues.verifyFailed"))
        : issue.verify?.status === "uncertain"
          ? h("span", { className: "fx-verify-badge" }, t("fx.issues.verifyUncertain"))
          : null,
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
    fixIsCurrent && (fixFiles.length || fixVerification)
      ? h(
          "div",
          { className: "fx-issue-fix" },
          fixFiles.length
            ? h(
                "div",
                { className: "fx-fix-files" },
                h("span", { className: "fx-fix-label" }, t("fx.issues.fixFiles")),
                fixFiles.map((file) =>
                  h(
                    "button",
                    {
                      key: file,
                      className: "fx-link fx-fix-file",
                      title: file,
                      onClick: () => engine.openIssueLocation({ ...issue, location: file }),
                    },
                    h("span", { className: "fx-link-icon" }, iconEl(api, "File", 10)),
                    h("span", { className: "fx-fix-file-text" }, file),
                  ),
                ),
              )
            : null,
          fixVerification
            ? h(
                "div",
                { className: "fx-fix-verify" },
                h("span", { className: "fx-fix-label" }, t("fx.issues.fixVerifySummary")),
                h("span", { className: "fx-fix-verify-text", title: fixVerification }, fixVerification),
              )
            : null,
        )
      : null,
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
            ? h("p", null, h("b", null, t("fx.issues.fixNote")), h("span", null, issue.fix.summary))
            : null,
          // 非当前修复（not_found、blocked、回归重开、复审未通过等）的验证摘要属于历史记录，
          // 折叠时不展示，展开详情时补上，保证上一轮执行过的验证仍可追溯。
          !fixIsCurrent && fixVerification
            ? h(
                "p",
                null,
                h("b", null, t("fx.issues.fixVerifyHistory")),
                h("span", { className: "fx-muted", title: fixVerification }, fixVerification),
              )
            : null,
          issue.verify
            ? h(
                "p",
                { className: issue.verify.status === "still_present" ? "fx-regressed" : "" },
                h("b", null, t("fx.issues.verify")),
                h(
                  "span",
                  null,
                  [
                    issue.verify.status === "confirmed"
                      ? t("fx.issues.verifyConfirmed")
                      : issue.verify.status === "still_present"
                        ? t("fx.issues.verifyFailed")
                        : t("fx.issues.verifyUncertain"),
                    issue.verify.summary,
                    issue.verify.evidence,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                ),
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
});

// 按文件聚合视图的分组：组头显示文件路径与条数，「修复本组」只提交组内当前可执行条目。
// 同文件问题一次提交，天然串行，能明显减少文件冲突，也更容易判断影响面。
// 分组本身不套 memo：组头「修复本组」要按当前引擎会话与活动相位实时判定冲突，
// 每次渲染都取最新结论；组内卡片由 IssueCard 的 memo 复用，活动指标刷新不会重建。
function IssueFileGroup({ group, collapsed, onToggle, selected, engine, api, t }) {
  const unlocated = !group.file;
  const title = unlocated ? t("fx.issues.groupUnlocated") : group.file;
  const fixableIds = Array.isArray(group.fixableIds) ? group.fixableIds : [];
  const fixingCount = Array.isArray(group.fixingIds) ? group.fixingIds.length : 0;
  // 与引擎共用同一套冲突判定：修复中、队列认领或文件重叠时直接禁用组头按钮，
  // 避免点击后才弹出通用冲突提示，也避免把整组一并提交给必然失败的会话。
  const conflict =
    fixableIds.length > 0 && typeof engine?.previewFixConflict === "function"
      ? engine.previewFixConflict(fixableIds)
      : false;
  const blocked = fixableIds.length === 0 || conflict;
  // 仅在按钮确实被禁用且原因可归为修复冲突时解释原因；会话已结束时残留的
  // fixing 状态不应阻止组内其余条目，也不应显示误导性的阻塞提示。
  const fixHint =
    blocked && (fixingCount > 0 || conflict)
      ? t("fx.issues.fixGroupBlocked")
      : t("fx.issues.fixGroupHint");
  return h(
    "section",
    { className: "fx-issue-group" },
    h(
      "div",
      { className: "fx-issue-group-head" },
      h(
        "button",
        {
          type: "button",
          className: "fx-issue-group-toggle",
          onClick: () => {
            if (typeof onToggle === "function") onToggle(group.key);
          },
          "aria-expanded": !collapsed,
          title,
        },
        h(
          "span",
          { className: "fx-issue-group-chevron" },
          iconEl(api, collapsed ? "ChevronRight" : "ChevronDown", 12),
        ),
        h("span", { className: "fx-issue-group-icon" }, iconEl(api, unlocated ? "MapPin" : "File", 13)),
        h("span", { className: "fx-issue-group-file" }, title),
      ),
      h("span", { className: "fx-issue-group-count" }, t("fx.issues.groupCount", { count: group.issues.length })),
      h(
        "button",
        {
          type: "button",
          className: "fx-btn small",
          disabled: blocked,
          title: fixHint,
          onClick: () => {
            // openFixDialog 会把空数组回退成当前勾选项，禁用态下不能透传空集合。
            if (!blocked) engine.openFixDialog(fixableIds);
          },
        },
        t("fx.issues.fixGroup", { count: fixableIds.length }),
      ),
    ),
    collapsed
      ? null
      : h(
          "div",
          { className: "fx-issue-group-body" },
          group.issues.map((issue) =>
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

// issue 区的派生数据：状态计数、勾选统计、复审范围与按文件分组。
// 面板在 useMemo 中预先算好，活动指标刷新时不再重复遍历全部 issue；
// 直接调用组件（如渲染测试）未传 view 时按需自算。
function buildIssueView(snapshot, visible) {
  const issues = Array.isArray(snapshot?.state?.issues) ? snapshot.state.issues : [];
  const selected = Array.isArray(snapshot?.selected) ? snapshot.selected : [];
  const counts = statusCounts(issues);
  const statusFilter = snapshot?.statusFilter || "all";
  // 标题与「当前 x / y」共用同一状态口径：全部=非归档总量，其余=该状态总量；
  // 非法状态值按「全部」处理，与 listVisibleIssues 的归一规则保持一致。
  const statusScopeCount =
    statusFilter === "all" || counts[statusFilter] === undefined
      ? counts.open + counts.fixing + counts.fixed + counts.not_found
      : counts[statusFilter];
  // 归档项也能勾选（用于批量删除），但「修复选中项」只统计仍可修复的条目：
  // 已修复与已确认不存在都已定论，再次投入修复会在会话失败时覆盖结论。
  const fixableSelectedCount = issues.filter(
    (issue) => selected.includes(issue.id) && isFixSelectable(issue),
  ).length;
  // 复审入口只处理当前勾选或当前可见的条目：按钮计数与实际启动范围共用同一份 id 列表。
  const verifyScopeIssues = (
    selected.length ? issues.filter((issue) => selected.includes(issue.id)) : visible
  ).filter(isVerifySelectable);
  return {
    counts,
    statusScopeCount,
    visibleIds: visible.map((issue) => issue.id),
    fixableSelectedCount,
    verifyScopeIssues,
    verifyScopeIds: verifyScopeIssues.map((issue) => issue.id),
    reverifyCount: verifyScopeIssues.length,
    // 已有历史复审结论时用「重新复审」，首次复审用「复审」。
    verifyLabelKey: verifyScopeIssues.some((issue) => Boolean(issue.verify))
      ? "fx.issues.reverifyCount"
      : "fx.issues.verifyCount",
    groups: groupIssuesByFile(visible),
  };
}

function IssuesSection({ snapshot, visible, engine, api, t, viewMode, onViewModeChange, collapsedGroups, onToggleGroup, view }) {
  // 默认按文件聚合：同文件问题一次提交，冲突更少，影响面也更直观。
  const mode = viewMode === "list" ? "list" : "file";
  const collapsed = collapsedGroups instanceof Set ? collapsedGroups : new Set();
  const setMode = (next) => {
    if (typeof onViewModeChange === "function") onViewModeChange(next);
  };
  const derived = view || buildIssueView(snapshot, visible);
  const {
    counts,
    statusScopeCount,
    visibleIds,
    fixableSelectedCount,
    verifyScopeIds,
    reverifyCount,
    verifyLabelKey,
    groups,
  } = derived;
  const selected = Array.isArray(snapshot.selected) ? snapshot.selected : [];
  // 清理入口同时覆盖已修复与已确认不存在的条目：两者都已定论，不再需要修复。
  const settledCount = counts.fixed + counts.not_found;
  const statusFilters = [
    { key: "all", label: t("fx.issues.filterAll") },
    { key: ISSUE_STATUS.open, label: t("fx.status.open") },
    { key: ISSUE_STATUS.fixing, label: t("fx.status.fixing") },
    { key: ISSUE_STATUS.fixed, label: t("fx.status.fixed") },
    { key: ISSUE_STATUS.notFound, label: t("fx.status.not_found") },
    { key: ISSUE_STATUS.archived, label: t("fx.status.archived") },
  ];
  const severityFilters = [
    { key: "all", label: t("fx.issues.filterAll") },
    { key: SEVERITY.critical, label: t("fx.issues.filterCritical") },
    { key: SEVERITY.major, label: t("fx.issues.filterMajor") },
    { key: SEVERITY.minor, label: t("fx.issues.filterMinor") },
  ];
  const hasFilter =
    snapshot.statusFilter !== "all" ||
    snapshot.severityFilter !== "all" ||
    Boolean(String(snapshot.searchQuery || "").trim());
  // 清理入口也要覆盖没有当前跟踪会话、但存在历史会话台账的情况。
  const hasSessionLog =
    (snapshot.state.conversationLog || []).length > 0 ||
    Boolean(snapshot.state.sessions.review) ||
    Boolean(snapshot.state.sessions.fix);
  const renderIssue = (issue) =>
    h(IssueCard, {
      key: issue.id,
      issue,
      selected: selected.includes(issue.id),
      engine,
      api,
      t,
    });
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
        h("span", { className: "fx-count" }, t("fx.issues.count", { count: statusScopeCount })),
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
        snapshot.pendingAutoFix?.issueIds?.length
          ? h(
              "button",
              {
                className: "fx-btn small primary",
                onClick: () => void engine.openPendingAutoFix(),
              },
              t("fx.issues.startAutoFix", { count: snapshot.pendingAutoFix.issueIds.length }),
            )
          : null,
        h(
          "button",
          {
            className: "fx-btn small danger",
            disabled: selected.length === 0,
            onClick: () => engine.deleteSelectedIssues(),
          },
          t("fx.issues.deleteSelected", { count: selected.length }),
        ),
        reverifyCount > 0
          ? h(
              "button",
              {
                className: "fx-btn small",
                onClick: () => void engine.openVerifyDialog(verifyScopeIds),
              },
              t(verifyLabelKey, { count: reverifyCount }),
            )
          : null,
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
      h("span", { className: "fx-filter-label" }, t("fx.issues.filterStatus")),
      statusFilters.map((item) =>
        h(
          "button",
          {
            key: item.key,
            className: `fx-chip ${snapshot.statusFilter === item.key ? "is-active" : ""}`,
            onClick: () => engine.setStatusFilter(item.key),
          },
          item.label,
        ),
      ),
    ),
    h(
      "div",
      { className: "fx-filters" },
      h("span", { className: "fx-filter-label" }, t("fx.issues.filterSeverity")),
      severityFilters.map((item) =>
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
      h("input", {
        className: "fx-search",
        type: "search",
        value: snapshot.searchQuery || "",
        placeholder: t("fx.issues.searchPlaceholder"),
        "aria-label": t("fx.issues.searchPlaceholder"),
        onInput: (event) => engine.setSearchQuery(event.target.value),
      }),
    ),
    h(
      "div",
      { className: "fx-filters" },
      h("span", { className: "fx-filter-label" }, t("fx.issues.view")),
      h(
        "button",
        {
          className: `fx-chip ${mode === "file" ? "is-active" : ""}`,
          onClick: () => setMode("file"),
        },
        t("fx.issues.viewFile"),
      ),
      h(
        "button",
        {
          className: `fx-chip ${mode === "list" ? "is-active" : ""}`,
          onClick: () => setMode("list"),
        },
        t("fx.issues.viewList"),
      ),
      h("span", { className: "fx-filter-divider", "aria-hidden": "true" }),
      h(
        "button",
        {
          className: "fx-link",
          disabled: visibleIds.length === 0,
          onClick: () => engine.selectMany(visibleIds),
        },
        t("fx.issues.selectAll"),
      ),
      h(
        "button",
        {
          className: "fx-link",
          disabled: visibleIds.length === 0,
          onClick: () => engine.invertSelection(visibleIds),
        },
        t("fx.issues.invertSelection"),
      ),
      selected.length > 0
        ? h(
            "button",
            { className: "fx-link", onClick: () => engine.clearSelection() },
            t("fx.issues.clearSelection"),
          )
        : null,
      selected.length > 0 ? h("span", { className: "fx-muted" }, t("fx.issues.selected", { count: selected.length })) : null,
      hasFilter
        ? h(
            "span",
            { className: "fx-muted" },
            t("fx.issues.filteredCount", {
              visible: visible.length,
              total: statusScopeCount,
            }),
          )
        : null,
    ),
    h(
      "div",
      { className: "fx-issues" },
      visible.length === 0
        ? h("div", { className: "fx-empty-small" }, t("fx.issues.empty"))
        : mode === "list"
          ? visible.map(renderIssue)
          : groups.map((group) =>
              h(IssueFileGroup, {
                key: group.key,
                group,
                collapsed: collapsed.has(group.key),
                onToggle: onToggleGroup,
                selected,
                engine,
                api,
                t,
              }),
            ),
    ),
  );
}

function formatUpdateAge(t, elapsedMs) {
  const seconds = Math.max(0, Math.floor(Number(elapsedMs) / 1000));
  if (!Number.isFinite(seconds) || seconds < 2) return t("fx.activity.agoJustNow");
  if (seconds < 60) return t("fx.activity.agoSeconds", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("fx.activity.agoMinutes", { count: minutes });
  return t("fx.activity.agoHours", { count: Math.floor(minutes / 60) });
}

// 非运行态卡片的耗时终点取自会话自身的最后进展时刻：
// 卡片可能因切换项目被重建，既不能沿用上一个会话的结束时刻，也不能用重建时刻顶替。
function settledEndOf(activity, running) {
  if (running) return null;
  const lastUpdateAt = Number(activity.lastUpdateAt);
  if (!Number.isFinite(lastUpdateAt)) return null;
  // 旧数据可能残留早于本批启动时间的时刻：展示不得出现负时长。
  return Math.max(lastUpdateAt, Number(activity.startedAt) || 0);
}

function ActivityCard({ activity, engine, api, t }) {
  const running = !["done", "error", "detached"].includes(activity.phase);
  // 手动停止或跟踪报错后允许重新挂接同一会话，继续读取后续输出。
  const resumable = activity.phase === "detached" || activity.phase === "error";
  const [now, setNow] = useState(Date.now());
  const [settledAt, setSettledAt] = useState(() => settledEndOf(activity, running));
  // 相对更新时间在卡片存续期间都要前进：done/error/detached 后也保留每秒时钟，
  // 否则“最后更新 X 前”会永久停在相位切换的瞬间。
  // “已运行”停在结束时刻：挂载即为非运行态时用会话自身的最后进展时刻，
  // 运行中转为终态时用观察到切换的时刻，继续跟踪时重新计时。
  useEffect(() => {
    const tick = Date.now();
    setNow(tick);
    if (running) setSettledAt(null);
    else setSettledAt((value) => (value == null ? tick : value));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const elapsedEnd = running ? now : settledAt ?? now;
  const elapsed = activity.startedAt ? formatElapsed(elapsedEnd - activity.startedAt) : "";
  // 已接收字符数来自正文 + 思考内容；最后更新时间只在检测到新输出 / 工具进展时刷新。
  const receivedChars = Number.isFinite(activity.receivedChars) ? activity.receivedChars : 0;
  const lastUpdateAt = Number.isFinite(activity.lastUpdateAt)
    ? activity.lastUpdateAt
    : Number.isFinite(activity.startedAt)
      ? activity.startedAt
      : null;
  const updateAge = lastUpdateAt ? formatUpdateAge(t, now - lastUpdateAt) : "";
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
      h(
        "b",
        null,
        activity.kind === "review"
          ? t("fx.activity.review")
          : activity.kind === "verify"
            ? t("fx.activity.verify")
            : t("fx.activity.fix"),
      ),
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
    h(
      "div",
      { className: "fx-activity-metrics" },
      h("span", null, t("fx.activity.receivedChars", { count: receivedChars.toLocaleString() })),
      lastUpdateAt
        ? h(
            "span",
            { title: formatDateTime(lastUpdateAt) },
            t("fx.activity.lastUpdate", { time: updateAge }),
          )
        : null,
    ),
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

export {
  Stepper,
  ProjectPane,
  IssuesSection,
  ActivityCard,
  EmptyState,
  defaultCollapsedGroups,
  buildIssueView,
};
