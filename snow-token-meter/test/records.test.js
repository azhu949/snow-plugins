// 逐请求精算的数据层：records 归一化、分页采集、窗口过滤、快照上界、去重、预算与覆盖判定。
import test from "node:test";
import assert from "node:assert/strict";
import {
  collectRecords,
  isValidRecordTime,
  normalizeRecord,
  normalizeRecords,
  recordsCacheKey,
  recordsCoverage,
  recordsDataKey,
} from "../src/usage.js";

const SINCE = "2026-10-30 00:00:00";
const UNTIL = "2026-10-30 23:59:59";

function row(id, createdAt, input, output, extra = {}) {
  return {
    id,
    conversationId: "c1",
    responseId: `r-${id}`,
    model: "deepseek/deepseek-v4.1-flash",
    apiProfileName: "",
    apiConfigId: "",
    requestMethod: "chat",
    inputTokens: input,
    outputTokens: output,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    status: "success",
    isSubAgent: false,
    directoryId: "",
    createdAt,
    ...extra,
  };
}

function summaryOf(input, output, requests) {
  return {
    totalInputTokens: input,
    totalOutputTokens: output,
    totalCacheCreationInputTokens: 0,
    totalCacheReadInputTokens: 0,
    totalRequests: requests,
    errorRequests: 0,
    totalTokens: input + output,
  };
}

// 假的分页源：pages 是每页的 items，超出范围返回空数组；calls 记录每次 offset。
function createSource(pages) {
  const calls = [];
  return {
    calls,
    async fetchRecordsPage({ limit, offset }) {
      calls.push(offset);
      const index = offset / limit;
      return { items: pages[index] || [], total: pages.flat().length };
    },
  };
}

test("normalizeRecord 只保留冻结字段并整数化 token", () => {
  const record = normalizeRecord(row("a", "2026-10-30 10:00:00", 12.9, -5, { status: " error " }));
  assert.equal(record.inputTokens, 12);
  assert.equal(record.outputTokens, 0);
  assert.equal(record.status, "error");
  assert.equal(record.createdAt, "2026-10-30 10:00:00");
  assert.equal(record.isSubAgent, false);
  assert.equal(normalizeRecord(null), null);
  assert.equal(normalizeRecord({ createdAt: "", model: "", id: "" }), null);
});

test("normalizeRecords 在 items 缺失或非数组时视为没有 records", () => {
  assert.equal(normalizeRecords(undefined), null);
  assert.equal(normalizeRecords({}), null);
  assert.equal(normalizeRecords({ items: null }), null);
  assert.deepEqual(normalizeRecords({ items: [], total: 0 }), { items: [], total: 0 });
  const page = normalizeRecords({ items: [row("a", SINCE, 1, 1), null], total: 3 });
  assert.equal(page.items.length, 1);
  assert.equal(page.total, 3);
});

test("isValidRecordTime 只接受本地时间文本", () => {
  assert.equal(isValidRecordTime("2026-10-30 12:00:00"), true);
  assert.equal(isValidRecordTime("2026-10-30T12:00:00Z"), false);
  assert.equal(isValidRecordTime("2026-10-30"), false);
  assert.equal(isValidRecordTime(""), false);
});

test("recordsCoverage 用行数 + input/output 容差判定覆盖", () => {
  const rows = [row("a", SINCE, 1000, 500), row("b", SINCE, 1000, 500)];
  const exact = recordsCoverage(rows, summaryOf(2000, 1000, 2));
  assert.equal(exact.covered, true);
  assert.equal(exact.rowsOk, true);
  // token 差 5000 超过 max(2000, 1%) 容差
  const off = recordsCoverage(rows, summaryOf(7000, 1000, 2));
  assert.equal(off.covered, false);
  assert.equal(off.rowsOk, true);
  assert.equal(off.inputOk, false);
  // 行数不足
  const short = recordsCoverage(rows, summaryOf(2000, 1000, 5));
  assert.equal(short.rowsOk, false);
});

test("recordsDataKey 只含数据身份，recordsCacheKey 再叠加目录与映射版本", () => {
  const summary = summaryOf(100, 50, 2);
  const data = recordsDataKey({
    rangeKey: "today",
    since: SINCE,
    until: UNTIL,
    profileName: "main",
    summary,
  });
  assert.equal(data, `today|${SINCE}|${UNTIL}|main|2|100|50`);
  assert.equal(
    recordsCacheKey({
      rangeKey: "today",
      since: SINCE,
      until: UNTIL,
      profileName: "main",
      summary,
      catalogFetchedAt: 111,
      mappingVersion: 2,
    }),
    `${data}|111|2`,
  );
});

test("第 1 页覆盖完整时不追加任何调用", async () => {
  const page0 = {
    items: [row("a", "2026-10-30 10:00:00", 1000, 500), row("b", "2026-10-30 09:00:00", 1000, 500)],
    total: 2,
  };
  const source = createSource([]);
  const result = await collectRecords({
    page0,
    source,
    since: SINCE,
    until: UNTIL,
    summary: summaryOf(2000, 1000, 2),
    maxPages: 5,
    budget: { remaining: 10 },
    limit: 100,
  });
  assert.equal(result.status, "complete");
  assert.equal(result.rows.length, 2);
  assert.equal(result.pages, 1);
  assert.equal(result.extraCalls, 0);
  assert.equal(source.calls.length, 0);
  assert.equal(result.snapshotAt, "2026-10-30 10:00:00");
});

test("按 offset 顺序翻页，末页不足 limit 时停止", async () => {
  // 每行 5000 / 1000 token：差一行的缺口大于 2000 token 的容差下限，必须真的翻到最后一页。
  const pages = [
    [row("a", "2026-10-30 12:00:00", 5000, 1000), row("b", "2026-10-30 11:00:00", 5000, 1000)],
    [row("c", "2026-10-30 10:00:00", 5000, 1000), row("d", "2026-10-30 09:00:00", 5000, 1000)],
    [row("e", "2026-10-30 08:00:00", 5000, 1000)],
  ];
  const source = createSource(pages);
  const result = await collectRecords({
    page0: { items: pages[0], total: 5 },
    source,
    since: SINCE,
    until: UNTIL,
    summary: summaryOf(25000, 5000, 5),
    maxPages: 5,
    budget: { remaining: 10 },
    limit: 2,
  });
  assert.equal(result.status, "complete");
  assert.equal(result.rows.length, 5);
  assert.equal(result.pages, 3);
  assert.equal(result.extraCalls, 2);
  assert.deepEqual(source.calls, [2, 4]);
});

test("预算用尽时回退（truncated）且保留已取到的行", async () => {
  const pages = [
    [row("a", "2026-10-30 12:00:00", 5000, 1000), row("b", "2026-10-30 11:00:00", 5000, 1000)],
    [row("c", "2026-10-30 10:00:00", 5000, 1000), row("d", "2026-10-30 09:00:00", 5000, 1000)],
    [row("e", "2026-10-30 08:00:00", 5000, 1000)],
  ];
  const result = await collectRecords({
    page0: { items: pages[0], total: 5 },
    source: createSource(pages),
    since: SINCE,
    until: UNTIL,
    summary: summaryOf(25000, 5000, 5),
    maxPages: 5,
    budget: { remaining: 1 },
    limit: 2,
  });
  assert.equal(result.status, "truncated");
  assert.equal(result.rows.length, 4);
  assert.equal(result.pages, 2);
  assert.equal(result.extraCalls, 1);
});

test("页数上限先到也回退（truncated）", async () => {
  const pages = [
    [row("a", "2026-10-30 12:00:00", 5000, 1000), row("b", "2026-10-30 11:00:00", 5000, 1000)],
    [row("c", "2026-10-30 10:00:00", 5000, 1000), row("d", "2026-10-30 09:00:00", 5000, 1000)],
  ];
  const result = await collectRecords({
    page0: { items: pages[0], total: 6 },
    source: createSource(pages),
    since: SINCE,
    until: UNTIL,
    summary: summaryOf(30000, 6000, 6),
    maxPages: 2,
    budget: { remaining: 10 },
    limit: 2,
  });
  assert.equal(result.status, "truncated");
  assert.equal(result.pages, 2);
  assert.equal(result.extraCalls, 1);
});

test("窗口过滤、快照上界与 id 去重同时生效", async () => {
  const pages = [
    [row("a", "2026-10-30 12:00:00", 5000, 1000), row("b", "2026-10-30 11:00:00", 5000, 1000)],
    // b 重复（offset 漂移）；c 比快照更新（并发插入）
    [row("b", "2026-10-30 11:00:00", 5000, 1000), row("c", "2026-10-30 13:00:00", 5000, 1000)],
    // e 在窗口内；d 早于 since（窗口外）
    [row("e", "2026-10-30 08:00:00", 5000, 1000), row("d", "2026-10-29 23:00:00", 5000, 1000)],
  ];
  const result = await collectRecords({
    page0: { items: pages[0], total: 5 },
    source: createSource(pages),
    since: SINCE,
    until: UNTIL,
    summary: summaryOf(15000, 3000, 3),
    maxPages: 5,
    budget: { remaining: 10 },
    limit: 2,
  });
  assert.deepEqual(
    result.rows.map((item) => item.id),
    ["a", "b", "e"],
  );
  assert.equal(result.status, "complete");
  assert.equal(result.pages, 3);
  assert.equal(result.extraCalls, 2);
});

test("createdAt 异常的行计入 badRows 且不参与覆盖判定", async () => {
  const page0 = {
    items: [
      row("a", "2026-10-30 10:00:00", 1000, 500),
      row("bad", "not-a-time", 1000, 500),
    ],
    total: 1,
  };
  const result = await collectRecords({
    page0,
    source: createSource([]),
    since: SINCE,
    until: UNTIL,
    summary: summaryOf(1000, 500, 1),
    maxPages: 5,
    budget: { remaining: 10 },
  });
  assert.equal(result.badRows, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.status, "complete");
});

test("行数够但 token 不符时状态为 mismatch", async () => {
  const page0 = { items: [row("a", "2026-10-30 10:00:00", 1000, 500)], total: 1 };
  const result = await collectRecords({
    page0,
    source: createSource([]),
    since: SINCE,
    until: UNTIL,
    summary: summaryOf(90000, 500, 1),
    maxPages: 5,
    budget: { remaining: 10 },
  });
  assert.equal(result.status, "mismatch");
});

test("翻页中途抛错：保留已取到的行，状态为 truncated", async () => {
  const page0 = {
    items: [row("a", "2026-10-30 12:00:00", 1000, 100), row("b", "2026-10-30 11:00:00", 1000, 100)],
    total: 4,
  };
  const source = {
    calls: 0,
    async fetchRecordsPage() {
      this.calls += 1;
      throw new Error("boom");
    },
  };
  const result = await collectRecords({
    page0,
    source,
    since: SINCE,
    until: UNTIL,
    summary: summaryOf(4000, 400, 4),
    maxPages: 5,
    budget: { remaining: 10 },
    limit: 2,
  });
  assert.equal(result.status, "truncated");
  assert.equal(result.rows.length, 2);
  assert.equal(result.extraCalls, 0);
  assert.equal(source.calls, 1);
});

test("records 缺失时返回 no-records 且不抛错", async () => {
  const result = await collectRecords({ page0: null, source: null, since: SINCE, until: UNTIL });
  assert.equal(result.status, "no-records");
  assert.equal(result.rows.length, 0);
  assert.equal(result.pages, 0);
});

test("已越过 since 时不再继续翻页", async () => {
  const page0 = {
    items: [row("a", "2026-10-30 12:00:00", 1000, 100), row("b", "2026-10-29 23:00:00", 1000, 100)],
    total: 4,
  };
  const source = createSource([]);
  const result = await collectRecords({
    page0,
    source,
    since: SINCE,
    until: UNTIL,
    summary: summaryOf(4000, 400, 4),
    maxPages: 5,
    budget: { remaining: 10 },
    limit: 2,
  });
  // 第 1 页已跨过窗口起点：不再请求下一页，覆盖不足按 truncated 回退。
  assert.equal(source.calls.length, 0);
  assert.equal(result.status, "truncated");
  assert.equal(result.rows.length, 1);
});
