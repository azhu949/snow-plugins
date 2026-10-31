import test from "node:test";
import assert from "node:assert/strict";
import { ALL_TIME_SINCE } from "../src/constants.js";
import {
  allTimeRange,
  clamp,
  compactTokens,
  formatCny,
  formatLocalDateTime,
  formatNumber,
  formatUsd,
  lastNDaysRange,
  periodRange,
  safeJsonParse,
  timeAgo,
  todayRange,
} from "../src/util.js";

test("todayRange 使用本地日边界", () => {
  assert.deepEqual(todayRange(new Date(2026, 9, 30, 15, 4, 5)), {
    since: "2026-10-30 00:00:00",
    until: "2026-10-30 23:59:59",
  });
});

test("todayRange 不受时区偏移影响，始终是本地零点与 23:59:59", () => {
  const range = todayRange(new Date(2026, 0, 1, 23, 59, 59));
  assert.equal(range.since, "2026-01-01 00:00:00");
  assert.equal(range.until, "2026-01-01 23:59:59");
});

test("lastNDaysRange 跨月正确", () => {
  assert.deepEqual(lastNDaysRange(7, new Date(2026, 2, 1, 8, 30)), {
    since: "2026-02-23 00:00:00",
    until: "2026-03-01 23:59:59",
  });
});

test("lastNDaysRange 跨年正确", () => {
  assert.deepEqual(lastNDaysRange(10, new Date(2026, 0, 3, 0, 0, 1)), {
    since: "2025-12-25 00:00:00",
    until: "2026-01-03 23:59:59",
  });
});

test("lastNDaysRange(1) 等于今天", () => {
  const now = new Date(2026, 6, 15, 9, 0, 0);
  assert.deepEqual(lastNDaysRange(1, now), todayRange(now));
});

test("allTimeRange 使用固定早起点", () => {
  assert.deepEqual(allTimeRange(new Date(2026, 0, 1, 12)), {
    since: ALL_TIME_SINCE,
    until: "2026-01-01 23:59:59",
  });
});

test("periodRange 映射四个周期", () => {
  const now = new Date(2026, 9, 30, 12);
  assert.deepEqual(periodRange("today", now), todayRange(now));
  assert.deepEqual(periodRange("7d", now), lastNDaysRange(7, now));
  assert.deepEqual(periodRange("30d", now), lastNDaysRange(30, now));
  assert.deepEqual(periodRange("all", now), allTimeRange(now));
  assert.deepEqual(periodRange("unknown", now), todayRange(now));
});

test("periodRange 30 天跨月", () => {
  assert.equal(lastNDaysRange(30, new Date(2026, 9, 30)).since, "2026-10-01 00:00:00");
});

test("formatLocalDateTime 输出 SQLite 本地时间格式", () => {
  assert.equal(formatLocalDateTime(new Date(2026, 0, 2, 3, 4, 5)), "2026-01-02 03:04:05");
});

test("compactTokens 紧凑计数", () => {
  assert.equal(compactTokens(0), "0");
  assert.equal(compactTokens(999), "999");
  assert.equal(compactTokens(1000), "1K");
  assert.equal(compactTokens(1500), "1.5K");
  assert.equal(compactTokens(1_234_567), "1.23M");
  assert.equal(compactTokens(2_500_000_000), "2.5B");
  assert.equal(compactTokens(999_949), "999.9K");
  assert.equal(compactTokens(999_999), "1M");
  assert.equal(compactTokens(999_999_999), "1B");
  assert.equal(compactTokens(-5), "0");
  assert.equal(compactTokens("abc"), "0");
});

test("formatNumber 千分位", () => {
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(1234567), "1,234,567");
  assert.equal(formatNumber(1234.6), "1,235");
});

test("formatUsd 小额保留更多小数", () => {
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatUsd(0.0042), "$0.0042");
  assert.equal(formatUsd(0.5), "$0.500");
  assert.equal(formatUsd(1.5), "$1.50");
  assert.equal(formatUsd(1234.5), "$1,235");
  assert.equal(formatUsd("bad"), "$0.00");
});

test("formatCny 固定两位小数并带千分位", () => {
  assert.equal(formatCny(0), "¥0.00");
  assert.equal(formatCny(1.5), "¥1.50");
  assert.equal(formatCny(12345.678), "¥12,345.68");
});

test("formatCny 小额自适应：不再把有花费显示成 ¥0.00", () => {
  assert.equal(formatCny(0.00001), "<¥0.0001");
  assert.equal(formatCny(0.002), "¥0.0020");
  assert.equal(formatCny(0.0086688), "¥0.01", "0.005 以上仍显示到分位");
  assert.equal(formatCny(0.05), "¥0.050");
  assert.equal(formatCny(0.5), "¥0.500");
  assert.equal(formatCny(2000.5), "¥2,000.50");
  assert.equal(formatCny(-1), "¥0.00");
  assert.equal(formatCny("bad"), "¥0.00");
});

test("timeAgo 相对时间", () => {
  const now = new Date(2026, 9, 30, 12, 0, 0).getTime();
  assert.equal(timeAgo(now - 30_000, now), "刚刚");
  assert.equal(timeAgo(now - 5 * 60_000, now), "5 分钟前");
  assert.equal(timeAgo(now - 3 * 60 * 60_000, now), "3 小时前");
  assert.equal(timeAgo(now - 2 * 24 * 60 * 60_000, now), "2 天前");
  assert.equal(timeAgo(now - 10 * 24 * 60 * 60_000, now), "2026-10-20");
  assert.equal(timeAgo(0, now), "");
});

test("safeJsonParse 损坏时回退", () => {
  assert.deepEqual(safeJsonParse('{"a":1}', null), { a: 1 });
  assert.equal(safeJsonParse("{bad", null), null);
  assert.equal(safeJsonParse("", { ok: true }).ok, true);
  assert.deepEqual(safeJsonParse({ a: 1 }, null), { a: 1 });
});

test("clamp 非法输入回退下限", () => {
  assert.equal(clamp(5, 1, 3), 3);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp("abc", 2, 8), 2);
  assert.equal(clamp("4", 2, 8), 4);
});
