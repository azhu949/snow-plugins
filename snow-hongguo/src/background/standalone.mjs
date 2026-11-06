// 纯 Node 自测入口：不依赖宿主，直接起后台服务。
// 用法：node src/background/standalone.mjs
// 数据目录默认回退到系统临时目录；可用 SNOW_HONGGUO_DATA_DIR 指定。
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { start } from "./main.js";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, "..", "..");
const pkg = JSON.parse(await readFile(join(pluginRoot, "package.json"), "utf8"));
const controller = new AbortController();

const stop = await start({
  version: pkg.version,
  installPath: pluginRoot,
  signal: controller.signal,
  log: (message) => {
    if (message !== undefined && message !== null && message !== "") console.log(message);
  },
});

const shutdown = () => {
  void stop().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("[standalone] 服务已启动，Ctrl+C 停止");
