import test from "node:test";
import assert from "node:assert/strict";
import { createScheduler, retryDelayFor } from "../src/background/throttle.js";

const fakeClock = () => {
  let current = 0;
  const waits = [];
  return {
    now: () => current,
    sleep: async (ms) => {
      waits.push(ms);
      current += ms;
    },
    waits,
    advance: (ms) => {
      current += ms;
    },
  };
};

test("全局串行：任务按提交顺序执行，并按最小间隔等待", async () => {
  const clock = fakeClock();
  const scheduler = createScheduler({ minIntervalMs: 300, now: clock.now, sleep: clock.sleep });
  const order = [];
  await Promise.all([
    scheduler.run("discover", async () => {
      order.push("a");
    }),
    scheduler.run("search", async () => {
      order.push("b");
    }),
    scheduler.run("discover", async () => {
      order.push("c");
    }),
  ]);
  assert.deepEqual(order, ["a", "b", "c"]);
  assert.deepEqual(clock.waits, [300, 300]);
  assert.equal(scheduler.stats.runs, 3);
});

test("前一个任务失败不会卡死队列", async () => {
  const clock = fakeClock();
  const scheduler = createScheduler({ minIntervalMs: 0, now: clock.now, sleep: clock.sleep });
  const failed = scheduler.run("discover", async () => {
    throw new Error("boom");
  });
  const next = scheduler.run("discover", async () => "ok");
  await assert.rejects(failed, /boom/);
  assert.equal(await next, "ok");
});

test("同一接口连续调用至少间隔 minIntervalMs", async () => {
  const clock = fakeClock();
  const scheduler = createScheduler({ minIntervalMs: 300, now: clock.now, sleep: clock.sleep });
  const starts = [];
  const run = () =>
    scheduler.run("playback", async () => {
      starts.push(clock.now());
    });
  await run();
  await run();
  await run();
  assert.deepEqual(starts, [0, 300, 600]);
});

test("retryAfterMs 退避封顶且只对 retryable 生效", () => {
  assert.equal(retryDelayFor({ retryable: true, retryAfterMs: 1200 }), 1200);
  assert.equal(retryDelayFor({ retryable: true, retryAfterMs: 5000 }, { maxWaitMs: 2000 }), 2000);
  assert.equal(retryDelayFor({ retryable: false, retryAfterMs: 1200 }), 0);
  assert.equal(retryDelayFor({ retryable: true, retryAfterMs: 0 }), 0);
  assert.equal(retryDelayFor({}), 0);
});
