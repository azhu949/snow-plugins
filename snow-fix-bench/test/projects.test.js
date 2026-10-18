import test from "node:test";
import assert from "node:assert/strict";
import { defaultCollapsedGroups } from "../src/ui/components.js";

test("defaultCollapsedGroups 只展开当前项目所在合集", () => {
  const collapsed = defaultCollapsedGroups(["c1", "c2", "ungrouped"], "c2");
  assert.deepEqual([...collapsed].sort(), ["c1", "ungrouped"]);
});

test("defaultCollapsedGroups 当前项目在未分组时展开未分组分组", () => {
  const collapsed = defaultCollapsedGroups(["c1", "c2", "ungrouped"], "ungrouped");
  assert.deepEqual([...collapsed].sort(), ["c1", "c2"]);
});

test("defaultCollapsedGroups 没有匹配分组时全部折叠", () => {
  const collapsed = defaultCollapsedGroups(["c1", "c2"], "");
  assert.equal(collapsed.size, 2);
});
