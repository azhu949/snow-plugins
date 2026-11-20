// 常驻后台模块入口（Electron 主进程，Node 全权限）。
// 生命周期：读连接设置 -> 建 docker 执行层、任务执行器与 SSH 会话 -> 起本地回环 HTTP 服务 -> 注册停止清理。
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { CHANNEL_ENDPOINT_STORAGE_KEY } from "../shared/contract.js";
import { createDocker, setDockerRuntime } from "./docker.js";
import { createSettings, normalizeSettings, toDockerEnv } from "./settings.js";
import { createSshSession } from "./ssh.js";
import { createTaskRunner } from "./tasks.js";
import { startServer } from "./server.js";

/** 后台模块所在目录：打包后由构建 banner 注入 __dirname，源码直跑时退回 cwd。 */
const resolveModuleDir = () => {
  try {
    return __dirname;
  } catch {
    return process.cwd();
  }
};

/**
 * 备份不能落在插件安装目录：宿主安装/更新插件会先删掉整个安装目录再复制（snow-plugin 的
 * install_plugin_internal），备份会被一并清掉；安装目录若位于源码仓库内，运行期写入的
 * 真实主机、用户名与运行配置路径还会出现在 git 工作区。
 * 这里放到宿主数据目录下的 plugin-data/<pluginId>/，与安装目录分离。
 */
const resolveBackupPath = (ctx) => {
  const installPath = typeof ctx.installPath === "string" ? ctx.installPath : "";
  const pluginsDir = installPath ? dirname(installPath) : "";
  const appDataDir =
    pluginsDir && basename(pluginsDir) === "plugins"
      ? dirname(pluginsDir)
      : join(homedir(), ".snowapp");
  const pluginId = typeof ctx.id === "string" && ctx.id ? ctx.id : "com.snow.docker-panel";
  return join(appDataDir, "plugin-data", pluginId, "connection-backup.json");
};

/** 旧位置的文件是不是空模板：{} 或只有空字段时不迁移，否则会占住新位置、挡住真正的旧备份。 */
const isBlankBackup = (text) => {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 解析失败说明文件已损坏：按旧行为照搬，交给恢复流程判断。
    return false;
  }
  const settings = normalizeSettings(parsed);
  return (
    !settings.cliPath &&
    !settings.dockerHost &&
    !settings.context &&
    settings.ssh.servers.length === 0 &&
    Object.keys(settings.runConfigs).length === 0
  );
};

/** 旧版本把备份写在安装目录；升级后首次启动搬到新位置，避免恢复链路断档。 */
const migrateLegacyBackup = async ({ legacyPath, backupPath, log }) => {
  if (legacyPath === backupPath) return;
  try {
    await access(backupPath);
    return;
  } catch {
    // 新位置还没有备份，继续检查旧位置。
  }
  try {
    const text = await readFile(legacyPath, "utf8");
    if (!text.trim() || isBlankBackup(text)) return;
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, text, "utf8");
    log(`配置备份已迁移到 ${backupPath}`);
  } catch {
    // 旧备份不存在或不可读：首次保存配置时会创建新备份。
  }
};

/**
 * 通道记录：后台把「实际监听端口 + 随机令牌」作为一条记录写入插件私有存储，面板只按这条记录连接。
 * 不再扫描端口，令牌也就不会投递给区间内的其它监听者。
 * 每次启动都换新令牌：面板快照里的旧令牌一律失效，即使旧端口被本机其它进程占用也拿不到可用凭据。
 * 写入失败时不再降级成「只校验固定请求头」——那种模式等于放弃调用方校验，宁可让服务不启动。
 */
const publishChannelEndpoint = async ({ storage, log, endpoint }) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await storage.setJson(CHANNEL_ENDPOINT_STORAGE_KEY, endpoint);
      return true;
    } catch (error) {
      log(`发布通道记录失败（第 ${attempt + 1} 次）：${error?.message || error}`);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  return false;
};

export async function start(ctx) {
  const tag = (text) => {
    try {
      ctx.log(`[docker] ${text}`);
    } catch {
      // 宿主日志异常不应影响服务。
    }
  };

  // connection 是当前生效的本机连接设置；SSH 只影响远程上传，不改变本机 CLI 的目标 daemon。
  let connection = {
    cliPath: "",
    dockerHost: "",
    context: "",
  };

  const ssh = createSshSession({ log: (text) => tag(text) });

  const syncRuntime = () => {
    setDockerRuntime({ bin: connection.cliPath || "", env: toDockerEnv(connection) });
  };

  // 旧版本把备份写在安装目录；升级后首次启动先搬一次，宿主存储被重置时才能从新位置恢复。
  const legacyBackupPath = join(resolveModuleDir(), "connection-backup.json");
  const backupPath = resolveBackupPath(ctx);
  await migrateLegacyBackup({ legacyPath: legacyBackupPath, backupPath, log: (text) => tag(text) });

  const settings = createSettings({
    storage: ctx.storage,
    secrets: ctx.secrets,
    // 备份放在宿主数据目录的 plugin-data 下：不随插件更新被删，也不落进源码仓库。
    backupPath,
    log: (text) => tag(text),
    onChange: (next) => {
      connection = next;
      syncRuntime();
    },
  });

  connection = await settings.get();
  syncRuntime();

  const docker = createDocker({ log: (text) => tag(text) });

  const tasks = createTaskRunner({
    log: (text) => tag(text),
    getBin: () => connection.cliPath || "docker",
    getEnv: () => toDockerEnv(connection),
  });

  // 端口与令牌是同一条记录：面板按记录连接，令牌不再经过端口扫描。
  const channelToken = randomBytes(24).toString("hex");
  const server = await startServer({
    docker,
    settings,
    tasks,
    ssh,
    version: ctx.version ?? "0.0.0",
    channelToken,
    log: (text) => tag(text),
  });

  const published = await publishChannelEndpoint({
    storage: ctx.storage,
    log: (text) => tag(text),
    endpoint: { port: server.port, token: channelToken },
  });
  if (!published) {
    await server.close();
    throw new Error("通道记录无法写入插件存储，本地服务已停止：请检查插件数据目录权限后重启 App");
  }

  tag(`已启动 v${ctx.version ?? "0.0.0"} port=${server.port}`);

  let stopped = false;
  let stopPromise = null;
  const stop = () =>
    (stopPromise ??= (async () => {
      if (stopped) return;
      stopped = true;
      try {
        ctx.signal?.removeEventListener?.("abort", onAbort);
      } catch {
        // 宿主 signal 已失效时忽略。
      }
      try {
        // 先取消任务再断开 SSH：前置构建子进程与远程命令都要随插件一起停下。
        tasks.dispose();
      } catch {
        // 任务清理失败不影响退出流程。
      }
      try {
        await ssh.disconnect();
      } catch {
        // SSH 关闭失败不影响退出流程。
      }
      await server.close();
      tag("已停止");
    })());

  const onAbort = () => {
    void stop();
  };
  ctx.signal?.addEventListener?.("abort", onAbort, { once: true });
  if (ctx.signal?.aborted) void stop();

  return stop;
}
