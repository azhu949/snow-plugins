// 数据目录解析：宿主内以 app.getPath('userData') 为根，纯 Node 下回退到临时目录。
// 目录布局：<userData>/plugin-data/com.snow.hongguo/{anonymous.json,video,covers}
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN_ID } from "../shared/contract.js";

/**
 * 优先使用宿主 userData；失败时用环境变量或系统临时目录，保证纯 Node 自测也能跑。
 * @param {{ log?: (message: string) => void }} [options]
 */
export async function resolvePluginDataDir({ log = () => {} } = {}) {
  const override = String(process.env.SNOW_HONGGUO_DATA_DIR ?? "").trim();
  if (override) {
    log(`使用环境变量指定的数据目录：${override}`);
    return override;
  }

  try {
    // Electron 主进程里 require('electron') 最稳；纯 Node 下会抛 MODULE_NOT_FOUND。
    const require = createRequire(import.meta.url);
    const electron = require("electron");
    const app = electron?.app ?? electron?.default?.app;
    const userData = app?.getPath?.("userData");
    if (typeof userData === "string" && userData) {
      return join(userData, "plugin-data", PLUGIN_ID);
    }
  } catch (error) {
    log(`Electron 不可用，改用回退数据目录：${error?.message ?? error}`);
  }

  const fallback = join(tmpdir(), "snow-app-plugin-data", PLUGIN_ID);
  log(`使用回退数据目录：${fallback}`);
  return fallback;
}
