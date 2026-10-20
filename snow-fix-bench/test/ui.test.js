// 面板渲染测试：直接调用展示组件并检查渲染文案，覆盖状态筛选下的计数口径。
import { strict as assert } from "node:assert";
import test from "node:test";

import { IssuesSection } from "../src/ui/components.js";
import { listVisibleIssues } from "../src/issues.js";
import { createT } from "../src/i18n.js";
import { ISSUE_STATUS, SEVERITY } from "../src/constants.js";

const t = createT("zh-CN");

// 只遍历组件返回的 vnode 子节点，不执行 IssueCard 等子组件。
function collectText(node, output = []) {
  if (node === null || node === undefined || typeof node === "boolean") return output;
  if (typeof node === "string" || typeof node === "number") {
    output.push(String(node));
    return output;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, output);
    return output;
  }
  if (typeof node === "object" && node.props) collectText(node.props.children, output);
  return output;
}

function findByClass(node, className, output = []) {
  if (!node || typeof node !== "object") return output;
  if (Array.isArray(node)) {
    for (const child of node) findByClass(child, className, output);
    return output;
  }
  if (node.props?.className === className) output.push(node);
  findByClass(node.props?.children, className, output);
  return output;
}

function textsByClass(node, className) {
  return findByClass(node, className).map((item) => collectText(item.props.children).join(""));
}

function renderSection(issues, overrides = {}) {
  const snapshot = {
    statusFilter: "all",
    severityFilter: "all",
    searchQuery: "",
    selected: [],
    // 组件会读取会话与台账决定清理入口，fixture 给全字段。
    state: { issues, sessions: { review: null, fix: null, verify: null }, conversationLog: [] },
    ...overrides,
  };
  const visible = listVisibleIssues(snapshot.state.issues, snapshot);
  return IssuesSection({ snapshot, visible, engine: {}, api: {}, t });
}

const ISSUES = [
  { id: "o1", status: ISSUE_STATUS.open, severity: SEVERITY.critical, title: "待修复", updatedAt: 2 },
  { id: "a1", status: ISSUE_STATUS.archived, severity: SEVERITY.major, title: "已归档 A", updatedAt: 1 },
  { id: "a2", status: ISSUE_STATUS.archived, severity: SEVERITY.minor, title: "已归档 B", updatedAt: 0 },
];

test("已归档筛选下标题与筛选计数的分母都按归档统计", () => {
  const vnode = renderSection(ISSUES, { statusFilter: ISSUE_STATUS.archived });
  assert.deepEqual(textsByClass(vnode, "fx-count"), ["共 2 条"]);
  assert.ok(textsByClass(vnode, "fx-muted").includes("当前 2 / 2 条"));
});

test("归档筛选叠加严重度时 visible 与 total 使用同一口径", () => {
  const vnode = renderSection(ISSUES, {
    statusFilter: ISSUE_STATUS.archived,
    severityFilter: SEVERITY.minor,
  });
  assert.deepEqual(textsByClass(vnode, "fx-count"), ["共 2 条"]);
  assert.ok(textsByClass(vnode, "fx-muted").includes("当前 1 / 2 条"));
});

test("全部筛选的标题与分母都不含已归档条目", () => {
  const vnode = renderSection(ISSUES, { statusFilter: "all", severityFilter: SEVERITY.major });
  assert.deepEqual(textsByClass(vnode, "fx-count"), ["共 1 条"]);
  assert.ok(textsByClass(vnode, "fx-muted").includes("当前 0 / 1 条"));
});

test("存在待确认的自动修复范围时在列表显示入口", () => {
  const vnode = renderSection(
    [{ id: "o1", status: ISSUE_STATUS.open, severity: SEVERITY.critical, title: "待修复", updatedAt: 2 }],
    { pendingAutoFix: { issueIds: ["o1"], notice: "等待确认" } },
  );
  assert.ok(textsByClass(vnode, "fx-btn small primary").includes("开始自动修复（1）"));
});

test("存在复审待确认项时在列表显示重新复审入口", () => {
  const vnode = renderSection([
    {
      id: "f1",
      status: ISSUE_STATUS.fixed,
      severity: SEVERITY.major,
      title: "待确认",
      updatedAt: 1,
      verify: { status: "uncertain" },
    },
  ]);
  assert.ok(textsByClass(vnode, "fx-btn small").includes("重新复审（1）"));
});
