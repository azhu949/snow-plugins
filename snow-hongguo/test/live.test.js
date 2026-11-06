// 可选的真实网络用例：默认跳过，设置 HONGGUO_LIVE=1 后才运行。
// PowerShell: $env:HONGGUO_LIVE="1"; node --test
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSdk } from "../src/background/sdk.js";

const liveEnabled = process.env.HONGGUO_LIVE === "1";

test(
  "真实网络：discover -> getSeries -> listEpisodes",
  { skip: liveEnabled ? false : "设置 HONGGUO_LIVE=1 后运行" },
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "hongguo-live-"));
    const { createClient } = await import("openhongguo");
    const sdk = createSdk({
      dataDir,
      minIntervalMs: 300,
      clientFactory: ({ profile, timeoutMs, retryAttempts, log }) =>
        createClient({ profile, timeoutMs, retryAttempts, deviceResets: 0, log }),
    });

    try {
      const page = await sdk.discover({});
      assert.ok(page.items.length > 0, "discover 至少返回一部剧");

      const series = await sdk.getSeries(page.items[0].id);
      assert.ok(series.title, "getSeries 返回标题");

      const episodes = await sdk.listEpisodes(series.id, {});
      assert.ok(episodes.items.length > 0, "listEpisodes 至少有 1 集");
    } finally {
      sdk.dispose();
      await rm(dataDir, { recursive: true, force: true });
    }
  }
);
