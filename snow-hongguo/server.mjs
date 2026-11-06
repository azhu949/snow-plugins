// 本机常驻服务的独立入口，仅用于宿主 0.5.11 及更早版本，或本地调试。
// 宿主 0.5.12 起会读取 plugin.json 的 background.entry，在主进程内加载 background.mjs，
// 不再需要这个文件；此时手动运行会占用 37191，宿主自己的后台模块会退到下一个端口。
//   node server.mjs
// 服务只监听 127.0.0.1，端口 37191-37200，供面板通过 api.net.fetch 调用。
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ID = "com.snow.hongguo";

// 与宿主后台模块共用同一个数据目录（Electron userData）：
//   Windows %APPDATA% / macOS ~/Library/Application Support / Linux $XDG_CONFIG_HOME 或 ~/.config
// 打包版的应用目录名是 "Snow App"，源码运行时是 "snow-app"；以宿主已经写过的目录为准。
if (!process.env.SNOW_HONGGUO_DATA_DIR) {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const appDir =
    ["Snow App", "snow-app"].find((name) => existsSync(join(base, name, "plugin-data", PLUGIN_ID))) ||
    "Snow App";
  process.env.SNOW_HONGGUO_DATA_DIR = join(base, appDir, "plugin-data", PLUGIN_ID);
}

// 必须在设置环境变量之后再加载后台 bundle。
const { start } = await import("./background.mjs");

const pkg = JSON.parse(await readFile(join(here, "package.json"), "utf8"));
const controller = new AbortController();

const stop = await start({
  id: PLUGIN_ID,
  version: pkg.version,
  installPath: here,
  signal: controller.signal,
  log: (...args) => console.log(...args),
});

const shutdown = () => {
  void stop().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("[server] 服务已启动，Ctrl+C 停止");
