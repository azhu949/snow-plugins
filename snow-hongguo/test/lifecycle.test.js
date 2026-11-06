import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src/background/main.js";
import {
  CHANNEL_HEADER,
  CHANNEL_HEADER_VALUE,
  PLUGIN_ID,
  PORT_FIRST,
  PORT_LAST,
} from "../src/shared/contract.js";

test("start(ctx) 启动服务、按 abort 清理并保留日志前缀", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "hongguo-life-"));
  const previousDataDir = process.env.SNOW_HONGGUO_DATA_DIR;
  process.env.SNOW_HONGGUO_DATA_DIR = dataDir;

  const logs = [];
  const controller = new AbortController();
  let stop = null;

  t.after(async () => {
    await stop?.();
    if (previousDataDir === undefined) delete process.env.SNOW_HONGGUO_DATA_DIR;
    else process.env.SNOW_HONGGUO_DATA_DIR = previousDataDir;
    await rm(dataDir, { recursive: true, force: true });
  });

  stop = await start({
    version: "0.0.0-test",
    installPath: process.cwd(),
    signal: controller.signal,
    log: (...args) => logs.push(args.join(" ")),
  });

  let port = null;
  for (let candidate = PORT_FIRST; candidate <= PORT_LAST; candidate += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${candidate}/health`, {
        headers: { [CHANNEL_HEADER]: CHANNEL_HEADER_VALUE },
      });
      if (!response.ok) continue;
      const health = await response.json();
      if (health.pluginId === PLUGIN_ID && health.pid === process.pid) {
        port = candidate;
        break;
      }
    } catch {
      // 该端口没有服务。
    }
  }

  assert.ok(port, "应能在端口区间内找到本进程启动的服务");
  assert.equal(
    logs.some((line) => line.startsWith("[hongguo:background]")),
    true
  );
  assert.equal(
    logs.some((line) => line.startsWith("[hongguo:http]")),
    true
  );

  controller.abort();
  await stop();

  await assert.rejects(
    fetch(`http://127.0.0.1:${port}/health`, { headers: { [CHANNEL_HEADER]: CHANNEL_HEADER_VALUE } })
  );
  assert.equal(
    logs.some((line) => line.includes("[hongguo:background] 已停止")),
    true
  );
});
