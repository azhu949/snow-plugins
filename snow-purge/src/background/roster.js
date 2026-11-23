// 红队编队：把 5 个角色写进宿主 subAgents 配置。
// 这里只写配置（agentId / 名称 / 职责 / 系统提示词 / 工具白名单），不执行任何命令、不启动任何子代理。
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REDTEAM_ROSTER, findRosterRole, rosterSignature } from "../shared/redteam-roster.js";
import { PurgeError } from "./errors.js";
import { writeJsonAtomic } from "./index-file.js";
import { readRosterActivity } from "./roster-activity.js";

const sha1 = (text) => createHash("sha1").update(String(text), "utf8").digest("hex").slice(0, 12);

/** 覆盖前备份的文件版本：读回时能识别来源与结构。 */
const OVERWRITE_VERSION = 1;
/** 单个角色最多保留几份覆盖备份：每次覆盖都备份后必须限制堆积。 */
const OVERWRITE_KEEP = 5;

const backupStamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** 把被覆盖的同名子代理记录写到插件数据目录：文件名带时间戳，移除时可据此回滚。 */
const writeOverwriteBackup = async ({ dir, agentId, record }) => {
  await mkdir(dir, { recursive: true });
  const fileName = `${agentId}-${backupStamp()}-${randomBytes(3).toString("hex")}.json`;
  const payload = {
    version: OVERWRITE_VERSION,
    at: new Date().toISOString(),
    agentId,
    projectId: typeof record?.projectId === "string" ? record.projectId : "",
    reason: "overwritten-by-roster-install",
    record,
  };
  await writeFile(join(dir, fileName), JSON.stringify(payload, null, 2), "utf8");
  // 新文件排在前面（文件名带 ISO 时间戳），只保留最近几份，避免每次重装都无限堆积。
  const stale = (await listOverwriteBackups(dir, agentId)).slice(OVERWRITE_KEEP);
  for (const name of stale) {
    await unlink(join(dir, name)).catch(() => {});
  }
  return fileName;
};

/** 该角色名下的覆盖备份：新的在前，供面板提示「可以回滚」。 */
const listOverwriteBackups = async (dir, agentId) => {
  if (!dir || !existsSync(dir)) return [];
  try {
    const files = await readdir(dir);
    return files
      .filter((name) => name.startsWith(`${agentId}-`) && name.endsWith(".json"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
};

const ID_PATTERN = /^redteam_[a-z0-9_]{2,40}$/;

const assertAgentId = (agentId) => {
  const value = typeof agentId === "string" ? agentId.trim() : "";
  if (!ID_PATTERN.test(value)) throw new PurgeError("INVALID_PARAM", "角色标识不合法");
  if (!findRosterRole(value)) throw new PurgeError("NOT_FOUND", `编队里没有 ${value}`);
  return value;
};

/**
 * 宿主对 subAgents 域做字段级遮罩：读回来的 systemPrompt / toolsJson 不可信，
 * 因此「是否最新」用插件自己的索引判断，宿主只用来确认角色是否存在。
 */
export function createRosterManager({ indexFile, write, metadata, overwriteDir = "", log = () => {} }) {
  const callWrite = async (action, params) => {
    const result = await write.run(action, params);
    if (result?.ok) return result.data;
    const reason = result?.denied?.reason
      ? `（${result.denied.reason}${result.denied.scope ? `: ${result.denied.scope}` : ""}）`
      : "";
    throw new PurgeError("WRITE_FAILED", `${action} 失败：${result?.error || "未知原因"}${reason}`);
  };

  /** 最近一次索引写入失败的原因：面板据此提示「已写进宿主但索引没记上」。 */
  let indexError = "";

  /**
   * 读索引：文件不存在按空表处理；解析失败与无权限必须标记出来。
   * 把读取失败当成空表会让 describe 把已编入的角色显示成未编入。
   */
  const readIndexState = async () => {
    try {
      const parsed = JSON.parse(await readFile(indexFile, "utf8"));
      return {
        index: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {},
        broken: false,
        reason: "",
      };
    } catch (error) {
      if (error?.code === "ENOENT") return { index: {}, broken: false, reason: "" };
      const reason = `读取编队索引失败：${error?.message || error}`;
      log(reason);
      return { index: {}, broken: true, reason };
    }
  };

  const readIndex = async () => (await readIndexState()).index;

  /**
   * 写索引：失败必须回报给调用方。宿主记录已经写入时，这里静默失败会让面板显示
   * 「未编入」（宿主按项目过滤读不到全局行），链路也会拒绝启动。
   */
  const writeIndex = async (index) => {
    try {
      // 原子写：进程中断时不会留下半截 JSON（否则角色会被显示成未编入并诱发重复编入）。
      await writeJsonAtomic(indexFile, index, "编队索引");
      indexError = "";
      return true;
    } catch (error) {
      indexError = `写入编队索引失败：${error?.message || error}`;
      log(indexError);
      return false;
    }
  };

  const readInstalled = async () => {
    try {
      const response = await metadata.get("subAgents");
      const list = response?.domains?.subAgents;
      const denied = response?.denied?.subAgents || null;
      // 宿主按当前项目过滤：拿到数组只代表「当前项目可见」，全局行与其它项目都读不到。
      return {
        list: Array.isArray(list) ? list : [],
        denied,
        available: Array.isArray(list) && !denied,
      };
    } catch (error) {
      log(`读取子代理配置失败：${error?.message || error}`);
      return { list: [], denied: { reason: String(error?.message || error) }, available: false };
    }
  };

  const describe = async () => {
    const [installed, indexState, activity] = await Promise.all([
      readInstalled(),
      readIndexState(),
      readRosterActivity({ metadata, log }),
    ]);
    const index = indexState.index;
    const byId = new Map();
    for (const record of installed.list) {
      const key = typeof record?.agentId === "string" ? record.agentId.trim() : "";
      if (key) byId.set(key, record);
    }
    const roles = REDTEAM_ROSTER.map((role) => {
      const record = byId.get(role.id) || null;
      const saved = index[role.id] && typeof index[role.id] === "object" ? index[role.id] : null;
      const signature = sha1(rosterSignature(role));
      const recordProjectId = record && typeof record.projectId === "string" ? record.projectId.trim() : "";
      const globalRecord = record && !recordProjectId ? record : null;
      const projectRecord = record && recordProjectId ? record : null;
      // 宿主读取接口按「当前项目」过滤（agent_id + project_id 精确匹配），全局子代理读不回来：
      // 编入状态以插件自己的写入记录为准；只有恰好读到全局行时才算宿主确认。
      const installedHere = Boolean(saved) || Boolean(globalRecord);
      const verification = globalRecord ? "host-confirmed" : saved ? "index-only" : "absent";
      return {
        id: role.id,
        role: role.role,
        order: role.order,
        accent: role.accent,
        name: role.name,
        description: role.description,
        tools: role.tools,
        systemPromptChars: role.systemPrompt.length,
        installed: installedHere,
        // 仅索引：宿主没有返回全局行，无法确认这条记录是否仍在宿主侧（可能已被删除）。
        verification,
        verified: verification === "host-confirmed",
        // 已编入但签名对不上：可能是旧版本，也可能被手工改过，统一提示可覆盖。
        updateAvailable: installedHere && saved?.signature !== signature,
        installedAt: typeof saved?.installedAt === "string" ? saved.installedAt : "",
        projectId: projectRecord ? recordProjectId : "",
        // 宿主只返回主会话记录：拿不到角色级数据时 activity 为 null，
        // 面板按 activity.available === false 显示「未提供运行数据」，不再回落成 0。
        activity: activity.byRole[role.id] || null,
      };
    });
    const installedCount = roles.filter((role) => role.installed).length;
    return {
      roles,
      counts: {
        total: roles.length,
        installed: installedCount,
        pending: roles.length - installedCount,
        updateAvailable: roles.filter((role) => role.updateAvailable).length,
        // 仅凭插件索引显示的角色数：面板据此提示「无法与宿主核对」。
        indexOnly: roles.filter((role) => role.verification === "index-only").length,
        running: activity.running,
      },
      activity: {
        available: activity.available,
        reason: activity.reason,
        directoryId: activity.directoryId || "",
        totals: activity.totals,
      },
      // 宿主只把当前项目的子代理返回给插件：这里如实标注确认范围。
      hostView: { scope: "project", available: installed.available, denied: installed.denied },
      denied: installed.denied,
      // 索引读取或写入失败：面板据此提示「已编入也可能显示为未编入」。
      indexBroken: indexState.broken || Boolean(indexError),
      indexReason: indexState.reason || indexError,
    };
  };

  /**
   * 已编入的角色 id：与 describe 的 installed 口径一致（插件写入记录或宿主可见的全局记录），
   * 供链路在派发前做一次轻量校验。宿主的项目视图天然不含全局行，不能与索引求交，
   * 否则所有全局角色都会被判成未编入；全局角色是否仍在宿主侧无法只读确认。
   */
  const installedIds = async () => {
    const [installed, index] = await Promise.all([readInstalled(), readIndex()]);
    const ids = new Set(Object.keys(index).filter((id) => findRosterRole(id)));
    for (const record of installed.list) {
      const key = typeof record?.agentId === "string" ? record.agentId.trim() : "";
      if (key) ids.add(key);
    }
    return REDTEAM_ROSTER.map((role) => role.id).filter((id) => ids.has(id));
  };

  const install = async (agentId, { confirm = false } = {}) => {
    const id = assertAgentId(agentId);
    const role = findRosterRole(id);
    const [before, index] = await Promise.all([readInstalled(), readIndex()]);
    const saved = index[id] && typeof index[id] === "object" ? index[id] : null;
    const existing = before.list.filter((record) => String(record?.agentId || "").trim() === id);
    const globalRecord = existing.find((record) => !String(record?.projectId || "").trim()) || null;
    const projectConflict = existing.some((record) => String(record?.projectId || "").trim() !== "");
    // 宿主按当前项目过滤返回（只含项目级记录），索引里没有本插件记录时无法排除宿主侧已有
    // 同名全局子代理：先返回冲突让用户确认，确认后才写入。
    // 同名全局行在常规路径下读不到，因此覆盖前也无法自动备份：面板必须让用户先自行保留原配置。
    const scopeUnconfirmed = !saved;
    if (scopeUnconfirmed && !confirm) {
      return {
        id: role.id,
        action: "conflict",
        count: 0,
        conflict: {
          name: typeof globalRecord?.name === "string" ? globalRecord.name : "",
          source: typeof globalRecord?.source === "string" ? globalRecord.source : "",
          projectId: "",
          // 读不到同名全局记录时不存在任何可备份的原值：不要在这里承诺可回滚。
          backupPossible: false,
        },
        projectConflict,
      };
    }
    let backup = "";
    // 只有宿主确实返回了同名全局记录才谈得上备份：常规路径（当前项目过滤）下这段不会执行，
    // 因此 overwritten / backedUp 只在「读到了全局行」的边缘场景成立，不能当作通用承诺。
    if (globalRecord) {
      if (!overwriteDir) {
        throw new PurgeError("WRITE_FAILED", "插件数据目录不可用，无法备份被覆盖的子代理，已取消编入");
      }
      backup = await writeOverwriteBackup({ dir: overwriteDir, agentId: id, record: globalRecord });
    } else if (scopeUnconfirmed && !overwriteDir) {
      // 读不到全局视图，也就无法为可能被覆盖的同名记录备份：没有备份目录时拒绝写入。
      throw new PurgeError(
        "WRITE_FAILED",
        "插件数据目录不可用，无法为可能被覆盖的同名子代理备份，已取消编入"
      );
    }
    const existed = Boolean(saved) || Boolean(globalRecord);
    const data = await callWrite("subAgents.upsert", {
      item: {
        agentId: role.id,
        name: role.name,
        description: role.description,
        systemPrompt: role.systemPrompt,
        toolsJson: JSON.stringify(role.tools),
        configProfile: "",
        model: "",
        builtin: false,
        sortOrder: role.order,
        source: "manual",
      },
    });
    index[role.id] = {
      signature: sha1(rosterSignature(role)),
      installedAt: new Date().toISOString(),
      // 插件写的是全局记录：面板据此说明「宿主只能按项目确认」。
      scope: "global",
      ...(backup ? { backup } : {}),
    };
    const indexOk = await writeIndex(index);
    return {
      id: role.id,
      action: existed ? "updated" : "installed",
      count: Array.isArray(data) ? data.length : 0,
      // 覆盖了宿主返回的同名记录且原配置已备份（只有读到全局行时才成立）。
      overwritten: Boolean(backup) && !saved,
      // 本插件旧记录被覆盖时也有备份，但语义不是「覆盖了外部配置」。
      backedUp: Boolean(backup),
      backup,
      projectConflict,
      // 宿主只返回当前项目视图：索引里没有记录时，无法确认是否覆盖了同名全局记录，也无法自动备份。
      // 宿主视图不可用时同样为真：读不到就无从核对，不能当成「已核对无冲突」。
      unverified: scopeUnconfirmed && !globalRecord,
      // 宿主已写入但索引没记上：面板必须提示「可能显示为未编入」。
      indexError: indexOk ? "" : indexError,
    };
  };

  const installAll = async ({ confirm = false } = {}) => {
    const results = [];
    for (const role of REDTEAM_ROSTER) {
      try {
        // 批量编入与单角色同口径：confirm=false 只探测，命中同名全局记录的角色返回 conflict 不写入；
        // 用户确认后第二次调用再备份并覆盖。
        results.push(await install(role.id, { confirm }));
      } catch (error) {
        results.push({ id: role.id, action: "failed", message: String(error?.message || error) });
      }
    }
    return results;
  };

  const remove = async (agentId, { confirm = false } = {}) => {
    const id = assertAgentId(agentId);
    // 宿主删除按 agentId + 作用域精确匹配，删不存在的记录也不报错；它返回的是删除后的
    // 子代理列表（不是影响行数），所以按「列表里是否还含这个 agentId」判定是否真的删掉。
    // 不传 projectId：只有这样返回的列表才是全量视图，索引被重置后仍能确认全局记录已清理。
    const indexState = await readIndexState();
    const index = indexState.index;
    const recorded = Boolean(index[id] && typeof index[id] === "object");
    // 索引是唯一来源证明：没有记录时无法排除同名全局记录由用户手工创建；
    // 签名不一致只说明角色定义来自旧版本或其它写法，同样需要用户确认。
    const signature = sha1(rosterSignature(findRosterRole(id)));
    const drift = recorded && index[id].signature !== signature;
    const foreign = !recorded;
    const backups = await listOverwriteBackups(overwriteDir, id);
    // 任何删除都必须由调用方显式确认：面板第一次点击只做来源探测，不能因为
    // 「记录看起来是本插件写入的」就跳过二次确认直接删除。
    if (!confirm) {
      return {
        id,
        removed: false,
        existed: recorded,
        verified: false,
        recorded,
        needsConfirm: true,
        foreign,
        drift,
        indexBroken: indexState.broken,
        projectRemaining: 0,
        backups,
        scope: "global",
      };
    }
    let remaining = null;
    try {
      const data = await callWrite("subAgents.remove", { agentId: id });
      if (Array.isArray(data)) remaining = data;
    } catch (error) {
      const message = String(error?.message || error);
      if (/built-?in|内置/i.test(message)) {
        throw new PurgeError("INVALID_PARAM", `宿主把 ${id} 当作内置子代理，没有执行删除`);
      }
      throw error;
    }
    const verified = Array.isArray(remaining);
    // 宿主只在「不传 projectId」时返回全表；本次删除只作用于 project_id 为空的全局行，
    // 因此确认用的比对集也必须只看全局行，否则任意项目里的同名记录都会让移除永远失败。
    const scopeOf = (record) => (typeof record?.projectId === "string" ? record.projectId.trim() : "");
    const globalRows = verified ? remaining.filter((record) => scopeOf(record) === "") : [];
    const stillPresent = globalRows.some((record) => String(record?.agentId || "").trim() === id);
    const removed = verified ? !stillPresent : false;
    // 无法确认删除结果时按「仍可能存在」处理：宁可提示未确认，也不谎报已移除或未安装。
    // foreign / drift 的记录同样算「存在过」：否则删掉用户手工创建的记录后会提示「未安装」。
    const existed = recorded || stillPresent || !verified || foreign || drift;
    // 全局已清掉、但同名记录仍存在于某些项目作用域：如实告知，不代删项目级配置。
    const projectRemaining = verified
      ? remaining.filter(
          (record) => scopeOf(record) !== "" && String(record?.agentId || "").trim() === id
        ).length
      : 0;
    // 只有确认删掉才清索引：接口异常或返回形状变化时保留「已编入」，不凭一次失败抹掉状态。
    let indexFailure = "";
    if (removed && recorded) {
      delete index[id];
      const indexOk = await writeIndex(index);
      if (!indexOk) indexFailure = indexError;
    }
    return {
      id,
      removed,
      existed,
      verified,
      recorded,
      projectRemaining,
      backups,
      scope: "global",
      foreign,
      drift,
      foreignRemoved: removed && foreign,
      // 索引没清掉时面板仍会显示「已编入」：把原因带回面板。
      indexError: indexFailure,
    };
  };

  /** 详情只看插件内置原文，不读宿主（宿主会遮罩 systemPrompt）。 */
  const readRole = (agentId) => {
    const id = assertAgentId(agentId);
    const role = findRosterRole(id);
    return {
      id: role.id,
      role: role.role,
      name: role.name,
      description: role.description,
      tools: role.tools,
      systemPrompt: role.systemPrompt,
      chars: role.systemPrompt.length,
    };
  };

  return { describe, installedIds, install, installAll, remove, readRole };
}
