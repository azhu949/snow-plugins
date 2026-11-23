// 常驻后台模块入口（Electron 主进程，Node 全权限）。
// 生命周期：定位数据目录 -> 建存储/审计/备份/写入适配层 -> 起本地回环 HTTP 服务 -> 发布通道记录 -> 注册停止清理。
import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CHANNEL_ENDPOINT_STORAGE_KEY, PLUGIN_ID } from "../shared/contract.js";
import { createSettings } from "./settings.js";
import { createAudit } from "./audit.js";
import { createBackupStore } from "./backup.js";
import { createPromptManager } from "./prompts.js";
import { createApprovalManager } from "./approval.js";
import { resolveProbeLogPath } from "./proxy.js";
import { createRedteamManager } from "./redteam.js";
import { createRosterManager } from "./roster.js";
import { createRosterTaskManager } from "./roster-tasks.js";
import { createRosterChainManager } from "./roster-chain.js";
import { startServer } from "./server.js";

/**
 * 宿主数据根固定为 <home>/.snowapp，请求代理脚本固定为 <home>/.snowapp/request-proxy/proxy.mjs
 * （与后台同在主进程，homedir() 取值一致）。两条路径都不随插件安装位置变化，因此直接锚定，
 * 不再从 ctx.installPath 反推：反推只在安装目录形如 <别的根>/plugins/<pluginId> 时指错位置。
 */
const SNOW_APP_HOME = join(homedir(), ".snowapp");

/**
 * 通道记录：后台把「实际监听端口 + 随机令牌」作为一条记录写入插件私有存储，面板只按这条记录连接。
 * 每次启动都换新令牌：面板快照里的旧令牌一律失效。
 * 写入失败时宁可让服务停下，也不退化成「只校验固定请求头」。
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
      ctx.log(`[purge] ${text}`);
    } catch {
      // 宿主日志异常不应影响服务。
    }
  };

  const pluginId = typeof ctx.id === "string" && ctx.id ? ctx.id : PLUGIN_ID;
  const pluginDataDir = join(SNOW_APP_HOME, "plugin-data", pluginId);
  const proxyPath = join(SNOW_APP_HOME, "request-proxy", "proxy.mjs");
  const probePath = resolveProbeLogPath(pluginDataDir);

  // 探针日志与备份/索引共用这个目录：托管段只会 appendFileSync，不会自己建目录。
  // 建目录失败不阻断启动：探针只用于自检，提示词/代理/免审批与它无关。
  try {
    await mkdir(pluginDataDir, { recursive: true });
    await access(pluginDataDir, fsConstants.W_OK);
  } catch (error) {
    tag(`插件数据目录不可用，探针日志将写不进去：${error?.message || error}`);
  }

  const backups = createBackupStore({ dir: join(pluginDataDir, "backups"), log: tag });
  const settings = createSettings({
    storage: ctx.storage,
    log: tag,
    // 配置内容损坏时先隔离到插件数据目录，再从默认值重建。
    quarantineDir: join(pluginDataDir, "config-quarantine"),
  });
  const audit = createAudit({ storage: ctx.storage, log: tag });
  const prompts = createPromptManager({ write: ctx.write, metadata: ctx.metadata, log: tag });
  const approval = createApprovalManager({ write: ctx.write, metadata: ctx.metadata, log: tag });

  // 红队技能库随插件一起安装：面板只读安装目录里的原文，装到 ~/.snow/skills 供宿主扫描。
  const installDir =
    typeof ctx.installPath === "string" && ctx.installPath
      ? ctx.installPath
      : join(SNOW_APP_HOME, "plugins", pluginId);
  const snowHome = join(homedir(), ".snow");
  const redteam = createRedteamManager({
    libraryDir: join(installDir, "skills", "redteam"),
    skillsDir: join(snowHome, "skills"),
    removedDir: join(pluginDataDir, "redteam-removed"),
    indexFile: join(pluginDataDir, "redteam-index.json"),
    snowHome,
    log: tag,
  });

  // 红队编队：只写宿主 subAgents 配置（5 个角色子代理），不启动任何子代理。
  const roster = createRosterManager({
    indexFile: join(pluginDataDir, "redteam-roster.json"),
    write: ctx.write,
    metadata: ctx.metadata,
    // 覆盖同名子代理前把原记录备份到这里：移除时可提示用户回滚。
    overwriteDir: join(pluginDataDir, "roster-overwrites"),
    log: tag,
  });

  // 编队任务：新建主会话并把任务投递进去，让主代理按 subAgents 规则派给对应角色。
  const rosterTasks = createRosterTaskManager({
    indexFile: join(pluginDataDir, "redteam-tasks.json"),
    write: ctx.write,
    metadata: ctx.metadata,
    log: tag,
  });

  // 编队链路：把五个角色按顺序串起来，前一环完成后自动把结论交给下一环。
  // 巡检由后台自己跑（面板关着也推进）：宿主没有完成事件，只能定时读会话状态。
  const chains = createRosterChainManager({
    indexFile: join(pluginDataDir, "redteam-chains.json"),
    roster,
    tasks: rosterTasks,
    metadata: ctx.metadata,
    // 停止接力与跳过本步要中止当前环节的会话，必须拿到宿主写接口。
    write: ctx.write,
    log: tag,
  });
  const channelToken = randomBytes(24).toString("hex");
  let server = null;
  let published = false;
  try {
    server = await startServer({
      settings,
      audit,
      backups,
      prompts,
      approval,
      redteam,
      roster,
      rosterTasks,
      chains,
      write: ctx.write,
      metadata: ctx.metadata,
      proxyPath,
      probePath,
      version: ctx.version ?? "0.0.0",
      channelToken,
      log: tag,
    });

    published = await publishChannelEndpoint({
      storage: ctx.storage,
      log: tag,
      endpoint: { port: server.port, token: channelToken },
    });
  } catch (error) {
    await server?.close?.();
    throw error;
  }
  if (!published) {
    await server.close();
    throw new Error("通道记录无法写入插件存储，本地服务已停止：请检查插件数据目录权限后重启 App");
  }

  // 巡检只在服务与通道记录都就绪之后才开始：启动失败不会留下无人回收的定时器。
  const stopChainLoop = chains.startLoop(15000);

  tag(`已启动 v${ctx.version ?? "0.0.0"} port=${server.port} 数据目录=${pluginDataDir} 代理=${proxyPath}`);

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
      stopChainLoop();
      try {
        const config = await settings.get();
        const applied = config?.applied;
        const projectApproved =
          Object.values(applied?.projectApprovals || {}).reduce(
            (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
            0
          );
        const pending = [
          applied?.prompt ? "提示词" : "",
          applied?.roleBlock ? "角色规则" : "",
          applied?.proxyHash ? "请求代理" : "",
          (applied?.globalTools?.length || 0) + projectApproved > 0 ? "免审批清单" : "",
        ].filter(Boolean);
        if (pending.length > 0) {
          tag(`仍有 ${pending.length} 层托管未撤回（${pending.join("、")}）：卸载或停用前请先在面板点「撤回」`);
        }
      } catch (error) {
        tag(`检查未撤回的托管内容失败：${error?.message || error}`);
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
