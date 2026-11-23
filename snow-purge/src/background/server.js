// 协议层：仅监听 127.0.0.1 的 JSON 服务，供本插件面板调用。
// 路由只做参数校验与结果转发；真正的写入逻辑在 apply / prompts / approval / proxy 模块里。
import { createServer } from "node:http";
import {
  CHANNEL_HEADER,
  CHANNEL_HEADER_VALUE,
  CHANNEL_TOKEN_HEADER,
  LIMITS,
  MANAGED_PROMPT_ID,
  PLUGIN_ID,
  PORT_FIRST,
  PORT_LAST,
  ROUTES,
  TOOL_NAME_PATTERN,
  TOOL_NAMES_MAX,
  toolListHash,
} from "../shared/contract.js";
import { BUILTIN_PRESETS } from "../shared/presets.js";
import { findRosterRole } from "../shared/redteam-roster.js";
import { applyAll, revertAll } from "./apply.js";
import { analyzeProxyText, normalizeOutside, readProbeLog, readProxyFile, restoreProxyBlock, toProxyAnalysisView } from "./proxy.js";
import { stripRoleBlock, roleUnreadable } from "./prompts.js";
import { runSelfcheck } from "./selfcheck.js";
import { APPROVAL_PROJECTS_MAX, clearAppliedLayer, hasAppliedLayers } from "./settings.js";
import { PurgeError } from "./errors.js";

const HOST = "127.0.0.1";

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
};

const sendError = (res, status, code, message) => sendJson(res, status, { error: { code, message } });

/**
 * 读取请求体的时限：客户端发完请求头后不再发正文（半开连接）时不会触发 end，
 * 只靠 error 监听等不到任何事件，写请求会永久占住串行链。
 */
const BODY_READ_TIMEOUT_MS = 20000;

/**
 * 读请求体：必须覆盖正常结束、读失败、客户端中途断开与读取超时四种结局。
 * 断连时 Node 只发 aborted / close（req.complete 为 false），不会发 error，
 * 这里统一收敛到一个 finish，保证 Promise 一定 settle 且监听器与定时器都被摘掉。
 */
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const parts = [];
    const finish = (error, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
      req.off("close", onClose);
      if (error) reject(error);
      else resolve(text);
    };
    const onData = (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > LIMITS.requestMaxBytes) {
        try {
          req.pause();
        } catch {
          // 暂停失败不影响写回 413。
        }
        finish(new PurgeError("REQUEST_TOO_LARGE", "请求体过大"));
        return;
      }
      parts.push(chunk);
    };
    const onEnd = () => finish(null, Buffer.concat(parts).toString("utf8"));
    const onError = (error) => finish(error);
    const onAborted = () => finish(new PurgeError("REQUEST_ABORTED", "客户端在请求体发送过程中断开连接"));
    // close 在正常完成后也会触发：只有 req.complete 为假才说明客户端没发完。
    const onClose = () => {
      if (!req.complete) finish(new PurgeError("REQUEST_ABORTED", "客户端在请求完成前关闭了连接"));
    };
    const timer = setTimeout(
      () => finish(new PurgeError("REQUEST_TIMEOUT", "读取请求体超时，连接可能已半开")),
      BODY_READ_TIMEOUT_MS
    );
    timer.unref?.();
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.once("aborted", onAborted);
    req.once("close", onClose);
  });

const readJsonBody = async (req) => {
  const text = await readBody(req);
  if (!text.trim()) return {};
  const parsed = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PurgeError("INVALID_BODY", "请求体必须是 JSON 对象");
  }
  return parsed;
};

const clampLimit = (value, fallback, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
};

/**
 * 直写宿主权限清单前的工具名校验：这里必须逐项拒绝，不能沿用配置层的静默过滤。
 * 返回 trim 后的去重清单；任何一项非法就整体拒绝，并指出第几项，
 * 免得用户以为「授权了 N 个」而宿主清单里少了一个。
 */
const readToolNames = (raw, field) => {
  if (!Array.isArray(raw)) throw new PurgeError("INVALID_PARAM", `${field} 必须是字符串数组`);
  if (raw.length > TOOL_NAMES_MAX) {
    throw new PurgeError("INVALID_PARAM", `${field} 最多 ${TOOL_NAMES_MAX} 项，当前 ${raw.length} 项`);
  }
  const tools = [];
  const seen = new Set();
  raw.forEach((item, index) => {
    const text = typeof item === "string" ? item.trim() : "";
    if (!TOOL_NAME_PATTERN.test(text)) {
      const shown = typeof item === "string" ? JSON.stringify(text).slice(0, 60) : String(item);
      throw new PurgeError(
        "INVALID_PARAM",
        `${field} 第 ${index + 1} 项不是合法工具名：${shown}（只允许字母、数字与 . _ : - /，1-160 字符）`
      );
    }
    if (seen.has(text)) return;
    seen.add(text);
    tools.push(text);
  });
  return tools;
};

/**
 * 撤回记账与宿主清单对齐：只保留写入后清单里仍然存在的项。
 * 用户在清单页新加的工具本就不在记账里，撤回不会误删；已被用户删掉的记账项也不再声称有残留。
 */
const keepTracked = (tracked, current) => {
  const live = new Set(Array.isArray(current) ? current : []);
  return (Array.isArray(tracked) ? tracked : []).filter((tool) => live.has(tool));
};

const toStatus = (error) => {
  switch (error?.code) {
    case "NOT_FOUND":
    case "BACKUP_NOT_FOUND":
      return 404;
    case "INVALID_PARAM":
    case "INVALID_BODY":
    case "INVALID_ACTION":
    case "NO_PROJECT":
      return 400;
    case "REQUEST_TOO_LARGE":
      return 413;
    case "REQUEST_TIMEOUT":
      return 408;
    case "REQUEST_ABORTED":
      return 400;
    case "PROXY_FOREIGN_HOOK":
    case "PROXY_FOREIGN_EDIT":
    case "PROXY_MANAGED_RESIDUE":
    case "PROXY_RESTORE_EMPTY":
    case "PROXY_BINDING_CONFLICT":
    case "PROXY_ANALYSIS_UNVERIFIED":
    case "BACKUP_TAMPERED":
    case "APPROVAL_BASELINE_MISMATCH":
    case "ROLE_FOREIGN_EDIT":
    case "ROLE_PATH_MISMATCH":
    case "NOT_INSTALLED":
    case "SKILL_INVALID":
    case "TASK_IN_USE":
      return 409;
    case "WRITE_FAILED":
      return 502;
    case "SETTINGS_UNAVAILABLE":
    case "WRITE_UNAVAILABLE":
    case "PERMISSIONS_UNAVAILABLE":
      return 503;
    default:
      return 500;
  }
};

/**
 * 记账写入单独兜底：宿主侧已经改完，不能再因为记账失败把这次请求报成失败。
 * 重试一次仍失败时把原因带回面板，并在审计里留痕。
 */
const recordApplied = async ({ settings, audit, applied }) => {
  let reason = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await settings.setApplied(applied);
      return "";
    } catch (error) {
      reason = String(error?.message || error);
    }
  }
  await audit.record({ action: "apply.record_failed", ok: false, detail: reason.slice(0, 300) });
  return reason;
};

/**
 * 保存配置后立即落地，并把每一步的结果原样返回。
 * 面板据此展示「哪一层成功、哪一层失败」，而不是只报一句「已保存」。
 */
const saveAndApply = async ({ deps, patch, forceProxy = false, revertWhenDisabled = true, scope = "" }) => {
  const { settings, audit } = deps;
  await settings.save(patch);
  const config = await settings.get();
  const result = await applyAll({ config, ...deps, forceProxy, revertWhenDisabled });
  // 总开关关闭时的单层保存：只写配置，不碰宿主与撤回记账，也不刷新「上次应用」。
  if (result.mode === "saved") {
    await audit.record({
      action: "apply.skipped",
      ok: true,
      detail: `托管总开关关闭：仅保存${scope || "配置"}，未写入宿主、未撤回任何层`,
    });
    return { config: await settings.get(), steps: [], mode: "saved", appliedError: "" };
  }
  // 记账失败只影响「撤回依据」，不能把已经写进宿主的结果报成失败。
  const appliedError = await recordApplied({ ...deps, applied: result.applied });
  const next = await settings.get();
  // mode 说明这次到底做了什么：总开关关闭时 applyAll 会转成撤回，面板不能统一报「已应用」。
  return { config: next, steps: result.steps, mode: result.mode, appliedError };
};

const handleRequest = async ({ deps, req, pathname, query, serverInfo }) => {
  const method = (req.method || "GET").toUpperCase();
  const { settings, audit, backups, prompts, approval, redteam, roster, rosterTasks, chains, write, proxyPath, probePath } =
    deps;

  if (pathname === ROUTES.health) {
    return {
      status: 200,
      payload: {
        ok: true,
        pluginId: PLUGIN_ID,
        version: serverInfo.version,
        pid: process.pid,
        startedAt: serverInfo.startedAt,
        uptimeMs: Date.now() - serverInfo.startedAt,
        tokenEnforced: true,
      },
    };
  }

  if (pathname === ROUTES.settings) {
    if (method === "GET") return { status: 200, payload: await settings.get() };
    if (method === "POST") {
      const body = await readJsonBody(req);
      // 这个接口只服务面板的两个开关：各层配置必须走各自的 apply 路由，
      // 否则会绕过对应校验与审计，还能改写 applied（撤回依据）与自定义预设。
      const allowed = ["enabled", "autoSnapshot"];
      const rejected = Object.keys(body).filter((key) => !allowed.includes(key));
      if (rejected.length > 0) {
        throw new PurgeError(
          "INVALID_PARAM",
          `设置接口只接受 enabled 与 autoSnapshot，不接受 ${rejected.join("、")}：提示词、角色规则、代理注入、免审批清单与预设请走各自的保存接口`
        );
      }
      const patch = {};
      for (const key of allowed) {
        if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
        if (typeof body[key] !== "boolean") {
          throw new PurgeError("INVALID_PARAM", `${key} 必须是布尔值`);
        }
        patch[key] = body[key];
      }
      const saved = await settings.save(patch);
      const changed = Object.entries(patch).map(([key, value]) => `${key}=${value}`).join(", ");
      await audit.record({ action: "settings.save", ok: true, detail: changed || "无改动" });
      return { status: 200, payload: saved };
    }
  }

  if (pathname === ROUTES.settingsRepair && method === "POST") {
    const body = await readJsonBody(req);
    if (body.confirm !== true) {
      throw new PurgeError("INVALID_PARAM", "修复配置会重建默认配置（原始内容先另存到插件数据目录），需要显式确认");
    }
    const result = await settings.repair();
    if (result.repaired) {
      await audit.record({
        action: "settings.repair",
        ok: true,
        detail: `原始内容已另存：${result.file}`.slice(0, 300),
      });
    }
    return { status: 200, payload: { ...result, config: await settings.get() } };
  }

  if (pathname === ROUTES.selfcheck && method === "GET") {
    const config = await settings.get();
    return {
      status: 200,
      payload: await runSelfcheck({
        config,
        prompts,
        approval,
        proxyPath,
        probePath,
        server: serverInfo,
      }),
    };
  }

  if (pathname === ROUTES.overview && method === "GET") {
    const config = await settings.get();
    const selfcheck = await runSelfcheck({
      config,
      prompts,
      approval,
      proxyPath,
      probePath,
      server: serverInfo,
    });
    const file = await readProxyFile(proxyPath);
    return {
      status: 200,
      payload: {
        config,
        selfcheck,
        server: {
          version: serverInfo.version,
          port: serverInfo.port,
          startedAt: serverInfo.startedAt,
          uptimeMs: Date.now() - serverInfo.startedAt,
        },
        proxy: {
          path: proxyPath,
          exists: file !== null,
          // 只回传判定结果：脚本正文不进入每 25 秒一次的 overview 轮询。
          analysis: toProxyAnalysisView(analyzeProxyText(file ?? "")),
        },
      },
    };
  }

  if (pathname === ROUTES.apply && method === "POST") {
    const body = await readJsonBody(req);
    const result = await saveAndApply({ deps, patch: {}, forceProxy: body.forceProxy === true });
    return { status: 200, payload: result };
  }

  if (pathname === ROUTES.revert && method === "POST") {
    const config = await settings.get();
    const result = await revertAll({ config, ...deps });
    // 宿主侧已经撤下，残留记账没清掉时只回报原因，不把撤回结果报成失败。
    const appliedError = await recordApplied({ ...deps, applied: result.applied });
    return { status: 200, payload: { config: await settings.get(), steps: result.steps, appliedError } };
  }

  if (pathname === ROUTES.prompts && method === "GET") {
    const [promptsState, roleState, config] = await Promise.all([
      prompts.readPrompts(),
      prompts.readRole(),
      settings.get(),
    ]);
    return {
      status: 200,
      payload: {
        prompts: promptsState.prompts,
        denied: promptsState.denied,
        role: roleState,
        managedPromptId: MANAGED_PROMPT_ID,
        config,
      },
    };
  }

  if (pathname === ROUTES.promptApply && method === "POST") {
    const body = await readJsonBody(req);
    const content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) throw new PurgeError("INVALID_PARAM", "提示词内容不能为空");
    if (content.length > LIMITS.promptCharsMax) throw new PurgeError("INVALID_PARAM", "提示词内容过长");
    const result = await saveAndApply({
      deps,
      revertWhenDisabled: false,
      scope: "提示词",
      patch: {
        prompt: {
          enabled: body.enabled !== false,
          name: typeof body.name === "string" ? body.name : undefined,
          content,
          isActive: body.isActive !== false,
        },
      },
    });
    return { status: 200, payload: result };
  }

  if (pathname === ROUTES.promptRemove && method === "POST") {
    const config = await settings.get();
    let removed = false;
    try {
      const state = await prompts.readPrompts();
      // 读不到列表时不能当成「条目不存在」：否则关掉开关、清掉记账，条目却还留在宿主里。
      if (!Array.isArray(state.prompts)) {
        throw new PurgeError(
          "WRITE_FAILED",
          `读不到宿主提示词库（${state.denied?.reason || "宿主未返回条目"}），托管条目未删除，托管开关与撤回记账都未改动`
        );
      }
      if (state.prompts.some((entry) => entry?.promptId === MANAGED_PROMPT_ID)) {
        await prompts.removePrompt(MANAGED_PROMPT_ID);
        removed = true;
      }
    } catch (error) {
      if (error instanceof PurgeError) throw error;
      throw new PurgeError("WRITE_FAILED", String(error?.message || error));
    }
    const applied = clearAppliedLayer(config.applied, "prompt");
    await settings.save({ prompt: { enabled: false }, applied });
    await audit.record({ action: "prompt.remove", ok: true, detail: removed ? "已删除托管条目" : "条目不存在" });
    return { status: 200, payload: { removed, config: await settings.get() } };
  }

  if (pathname === ROUTES.role && method === "GET") {
    return { status: 200, payload: await prompts.readRole() };
  }

  if (pathname === ROUTES.roleApply && method === "POST") {
    const body = await readJsonBody(req);
    const content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) throw new PurgeError("INVALID_PARAM", "角色规则内容不能为空");
    if (content.length > LIMITS.roleCharsMax) throw new PurgeError("INVALID_PARAM", "角色规则内容过长");
    const result = await saveAndApply({
      deps,
      revertWhenDisabled: false,
      scope: "角色规则",
      patch: { role: { enabled: true, content } },
    });
    return { status: 200, payload: result };
  }

  if (pathname === ROUTES.roleRestore && method === "POST") {
    const config = await settings.get();
    const role = await prompts.readRole();
    // 读不到确切原文时不能把空内容当成「文件里没有托管段」：否则会关掉开关、清掉记账，
    // 而文件里的托管段仍在生效。与应用、撤回共用同一判定。
    const roleIssue = roleUnreadable(role);
    if (roleIssue) {
      throw new PurgeError("WRITE_FAILED", `${roleIssue}，角色文件与托管记账都未改动`);
    }
    const next = stripRoleBlock(role.content);
    if (next === role.content) {
      const message = "角色文件里没有托管段，编辑草稿已清空（要保留请先存为预设）";
      // 与有托管段时同样处理：关闭角色托管开关、清掉记账并清空草稿，
      // 否则面板会继续显示旧规则，再点保存就把刚移除的内容写回文件。
      const applied = clearAppliedLayer(config.applied, "role");
      await settings.save({ role: { enabled: false, content: "" }, applied });
      await audit.record({ action: "role.restore", ok: true, detail: message });
      return { status: 200, payload: { content: next, removed: false, message, config: await settings.get() } };
    }
    // 托管段是唯一内容时 saveRole 会删除文件：宿主写动作不接受空 content。
    const result = await prompts.saveRole(next, role.filePath);
    const removedPath = result?.removed ? result.path || role.filePath : "";
    const applied = clearAppliedLayer(config.applied, "role");
    await settings.save({ role: { enabled: false, content: "" }, applied });
    const detail = result?.removed
      ? `托管段是该文件的唯一内容，已删除角色文件（${removedPath}），编辑草稿已清空（要保留请先存为预设）`
      : "已移除角色文件里的托管段，编辑草稿已清空（要保留请先存为预设）";
    await audit.record({ action: "role.restore", ok: true, detail });
    return {
      status: 200,
      payload: {
        content: next,
        removed: Boolean(result?.removed),
        path: removedPath,
        message: detail,
        config: await settings.get(),
      },
    };
  }

  if (pathname === ROUTES.approval && method === "GET") {
    const projectId = query.get("projectId") || "";
    const current = await approval.read(projectId);
    // 面板用这个摘要判断「保存前的清单是否还是打开时那一份」，与后台保存校验共用同一口径。
    return { status: 200, payload: { ...current, globalToolsHash: toolListHash(current.globalTools) } };
  }

  if (pathname === ROUTES.approvalGlobal && method === "POST") {
    const body = await readJsonBody(req);
    const tools = readToolNames(body.tools, "tools");
    // 写入是整表替换：先确认能读到当前清单，读不到就拒绝，避免把用户既有授权覆盖成只剩这几项。
    const before = await approval.read("");
    if (before.denied || before.unknown) {
      const reason = before.denied?.reason || "宿主返回的清单字段为空或类型异常";
      throw new PurgeError(
        "PERMISSIONS_UNAVAILABLE",
        `读不到宿主当前的全局免审批清单，已拒绝覆盖（${reason}）：请到宿主设置的权限页核对后重试`
      );
    }
    // 整表覆盖前必须确认面板看到的仍是当前清单：拒绝会静默抹掉其它窗口或宿主设置页刚新增的授权。
    const baselineHash = typeof body.baselineHash === "string" ? body.baselineHash.trim() : "";
    if (!/^[0-9a-f]{8}$/.test(baselineHash)) {
      throw new PurgeError("INVALID_PARAM", "缺少全局清单基线摘要：请关闭并重新打开插件面板后再保存");
    }
    if (toolListHash(before.globalTools) !== baselineHash) {
      throw new PurgeError(
        "APPROVAL_BASELINE_MISMATCH",
        "全局免审批清单在你打开面板之后已被外部修改：本次没有保存，请重新读取清单、核对新增项后再保存。"
      );
    }
    const result = await approval.setGlobal(tools);
    const current = await approval.read("");
    const config = await settings.get();
    const readable = !current.denied && !current.unknown;
    // 撤回依据只记「本次新增且确实写进宿主清单」的项：用户原有授权不记账，撤回不会误删。
    const landed = readable ? current.globalTools : before.globalTools;
    const added = tools.filter((tool) => !before.globalTools.includes(tool) && landed.includes(tool));
    // 保存清单不等于放弃撤回依据：先并入新增项，再把宿主清单里已经不存在的记账项收敛掉。
    let recorded = false;
    if (config.applied || added.length > 0) {
      const base = config.applied || {};
      const previous = Array.isArray(base.globalTools) ? base.globalTools : [];
      const merged = [...new Set([...previous, ...added])];
      const tracked = readable ? keepTracked(merged, current.globalTools) : merged;
      const changed = added.length > 0 || tracked.length !== previous.length || !config.applied;
      if (changed) {
        const nextApplied = { ...base, at: base.at || Date.now(), globalTools: tracked };
        // 记账收敛到空时必须落 null：否则会留下一个没有任何层的空壳，状态页误显示「已应用」。
        await settings.save({ applied: hasAppliedLayers(nextApplied) ? nextApplied : null });
        // 规范化会按工具条数上限截断：复核落盘结果，被截断时不能声称已记入。
        const savedGlobal = (await settings.get()).applied?.globalTools;
        const savedList = Array.isArray(savedGlobal) ? savedGlobal : [];
        recorded = added.length > 0 && added.every((tool) => savedList.includes(tool));
      }
    }
    await audit.record({
      action: "approval.global",
      ok: true,
      detail: `写入 ${tools.length} 个工具${
        recorded ? `，${added.length} 个新增项已记入撤回依据` : ""
      }${added.length > 0 && !recorded ? "；撤回依据记账已达上限，本次新增项未全部记入" : ""}`.slice(0, 300),
    });
    return {
      status: 200,
      payload: {
        ...result,
        current,
        readable,
        added: added.length,
        recorded,
        baselineHash,
        currentHash: toolListHash(current.globalTools),
      },
    };
  }

  if (pathname === ROUTES.approvalProject && method === "POST") {
    const body = await readJsonBody(req);
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new PurgeError("INVALID_PARAM", "缺少项目目录");
    const toolNames = readToolNames(body.toolNames, "toolNames");
    const approved = body.approved !== false;
    // 授权前先读一次该项目清单：只有确认「原来没有」的工具才算本插件新增。
    // 读不到就不记账，避免把用户已有的项目授权记入撤回依据。
    const before = approved ? await approval.read(projectId) : null;
    const result = await approval.setProjectMany(projectId, toolNames, approved);
    const current = await approval.read(projectId);
    const config = await settings.get();
    const base = config.applied || null;
    const projectApprovals = { ...(base?.projectApprovals || {}) };
    const tracked = Array.isArray(projectApprovals[projectId]) ? projectApprovals[projectId] : [];
    const beforeKnown = Boolean(before) && !before.denied && before.projectKnown;
    const readable = !current.denied && current.projectKnown;
    const landed = readable ? current.projectTools : beforeKnown ? before.projectTools : [];
    const added =
      approved && beforeKnown
        ? toolNames.filter((tool) => !before.projectTools.includes(tool) && landed.includes(tool))
        : [];
    let limitReached = false;
    if (added.length > 0) {
      if (!projectApprovals[projectId] && Object.keys(projectApprovals).length >= APPROVAL_PROJECTS_MAX) {
        // 记账条目已满：不阻止这次宿主写入，但如实回报，避免撤回时才发现撤不到。
        limitReached = true;
      } else {
        projectApprovals[projectId] = [...new Set([...tracked, ...added])];
      }
    }
    // 只按写入后的清单收敛该项目记账：已被用户移除的项不再声称可撤回。
    if (readable) {
      const keep = keepTracked(projectApprovals[projectId] || [], current.projectTools);
      if (keep.length > 0) projectApprovals[projectId] = keep;
      else delete projectApprovals[projectId];
    }
    const changed = JSON.stringify(projectApprovals) !== JSON.stringify(base?.projectApprovals || {});
    // 面板直写宿主清单：记账可能还不存在（从未应用过任何层），
    // 只要本次确实新增了授权，就必须把记账建起来，否则撤回没有依据可撤。
    const hasTracked = Object.keys(projectApprovals).length > 0;
    let recorded = false;
    if ((base || hasTracked) && changed) {
      const nextApplied = { ...(base || {}), at: base?.at || Date.now(), projectApprovals };
      // 同上：项目记账收敛到空且其它层都未应用时写 null，不留空壳。
      await settings.save({ applied: hasAppliedLayers(nextApplied) ? nextApplied : null });
      // 规范化会按项目条数与工具条数上限截断：复核落盘结果，被截断时不能声称已记入。
      const saved = (await settings.get()).applied;
      const savedTools = Array.isArray(saved?.projectApprovals?.[projectId])
        ? saved.projectApprovals[projectId]
        : [];
      recorded = added.length > 0 && added.every((tool) => savedTools.includes(tool));
      if (added.length > 0 && !recorded) limitReached = true;
    }
    await audit.record({
      action: "approval.project",
      ok: true,
      detail: `${projectId} ${approved ? "授权" : "撤下"} ${toolNames.length} 个工具${
        recorded ? `，${added.length} 个新增项已记入撤回依据` : ""
      }${approved && !beforeKnown ? "；读不到写入前的项目清单，本次未记入撤回依据" : ""}${
        approved && beforeKnown && !readable ? "；写入后读不到项目清单，无法确认落地，本次未记入撤回依据" : ""
      }${limitReached ? "；项目撤回记账已达上限，本次新增项未全部记入撤回依据" : ""}`.slice(0, 300),
    });
    return { status: 200, payload: { ...result, current, added: added.length, limitReached, recorded } };
  }

  if (pathname === ROUTES.proxy && method === "GET") {
    const config = await settings.get();
    const file = await readProxyFile(proxyPath);
    const probe = await readProbeLog(probePath, LIMITS.probeLinesMax);
    return {
      status: 200,
      payload: {
        path: proxyPath,
        probePath,
        exists: file !== null,
        analysis: toProxyAnalysisView(analyzeProxyText(file ?? "")),
        preview: file === null ? "" : file.slice(-4000),
        probe,
        config,
      },
    };
  }

  if (pathname === ROUTES.proxyApply && method === "POST") {
    const body = await readJsonBody(req);
    const patch = {
      proxy: {
        enabled: body.enabled !== false,
        directive: typeof body.directive === "string" ? body.directive : undefined,
        boost: body.boost !== false,
        providers: body.providers && typeof body.providers === "object" ? body.providers : undefined,
      },
    };
    if (!patch.proxy.directive) delete patch.proxy.directive;
    if (!patch.proxy.providers) delete patch.proxy.providers;
    const result = await saveAndApply({
      deps,
      patch,
      forceProxy: body.force === true,
      revertWhenDisabled: false,
      scope: "请求代理",
    });
    return { status: 200, payload: result };
  }

  if (pathname === ROUTES.proxyRestore && method === "POST") {
    const body = await readJsonBody(req);
    const config = await settings.get();
    const snapshotId = config.applied?.backups?.proxy || "";
    const snapshot = snapshotId ? await backups.read(snapshotId) : null;
    // 摘要不一致的快照不能作为「应用前原文」写回：退化为只剥离托管段，并如实标注。
    const snapshotTampered = snapshot?.integrity === "mismatch";
    const hasSnapshot =
      !snapshotTampered &&
      Boolean(snapshot && snapshot.payload && typeof snapshot.payload === "object" && "content" in snapshot.payload);
    const original = hasSnapshot ? snapshot.payload.content : null;
    const current = await readProxyFile(proxyPath);
    const currentAnalysis = current === null ? null : analyzeProxyText(current);
    const hadBlock = Boolean(currentAnalysis?.hasBlock);
    const result = await restoreProxyBlock({ filePath: proxyPath, original, force: body.force === true });
    // 快照 id 存在却读不到（被清理、手工删除或损坏）时，这次只能剥离托管段：
    // 必须如实告诉用户原文没有恢复，不能统一报「已还原」。
    const degraded = Boolean(snapshotId) && !hasSnapshot && !result.restored;
    const outcome = result.recreated
      ? "recreated"
      : result.restored
        ? "restored"
        : result.removed
          ? "removed"
          : degraded
            ? "degraded"
            : hadBlock
              ? "stripped"
              : result.removedResidues > 0
                ? "cleaned"
                : "empty";
    const applied = clearAppliedLayer(config.applied, "proxy");
    await settings.save({ proxy: { enabled: false }, applied });
    const detail = snapshotTampered
      ? "应用前快照摘要不一致，已拒绝写回，只移除了托管段"
      : outcome === "recreated"
        ? "已按应用前快照重建代理脚本"
        : outcome === "restored"
          ? "已还原原文件"
          : outcome === "removed"
            ? "已删除只含托管段的代理脚本"
            : outcome === "degraded"
              ? "应用前快照已丢失，只移除了托管段"
              : outcome === "stripped"
                ? "已移除托管段"
                : outcome === "cleaned"
                  ? `已清理 ${result.removedResidues} 处插件残骸`
                  : "没有可还原的内容";
    await audit.record({ action: "proxy.restore", ok: true, detail });
    return {
      status: 200,
      payload: { ...result, outcome, degraded, snapshotId, snapshotTampered, config: await settings.get() },
    };
  }

  if (pathname === ROUTES.proxyProbe && method === "GET") {
    return { status: 200, payload: await readProbeLog(probePath, LIMITS.probeLinesMax) };
  }

  if (pathname === ROUTES.presets && method === "GET") {
    const config = await settings.get();
    return { status: 200, payload: { builtin: BUILTIN_PRESETS, custom: config.presets } };
  }

  if (pathname === ROUTES.presetSave && method === "POST") {
    const body = await readJsonBody(req);
    const preset = body.preset;
    if (!preset || typeof preset !== "object") throw new PurgeError("INVALID_PARAM", "缺少预设内容");
    // 预设正文来自提示词输入框：超限时明确报错，不能交给归一化静默截断。
    const presetChars = (value) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().length : 0);
    if (presetChars(preset.directive) > LIMITS.promptCharsMax) {
      throw new PurgeError("INVALID_PARAM", `预设提示词过长（上限 ${LIMITS.promptCharsMax} 字符）`);
    }
    if (presetChars(preset.role) > LIMITS.roleCharsMax) {
      throw new PurgeError("INVALID_PARAM", `预设角色规则过长（上限 ${LIMITS.roleCharsMax} 字符）`);
    }
    const saved = await settings.addPreset(preset);
    await audit.record({ action: "preset.save", ok: true, detail: String(preset.name || "") });
    return { status: 200, payload: { presets: saved.presets } };
  }

  if (pathname === ROUTES.presetRemove && method === "POST") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) throw new PurgeError("INVALID_PARAM", "缺少预设 id");
    const saved = await settings.removePreset(id);
    return { status: 200, payload: { presets: saved.presets } };
  }

  if (pathname === ROUTES.backups && method === "GET") {
    // 一次扫描同时服务列表与占用统计：两次 list 会把每份快照重复读一遍。
    const items = await backups.list();
    return { status: 200, payload: { items, usage: await backups.usage(items), dir: backups.dir } };
  }

  if (pathname === ROUTES.backupRestore && method === "POST") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    const snapshot = await backups.read(id);
    if (!snapshot) throw new PurgeError("BACKUP_NOT_FOUND", "备份不存在或已过期");
    // 摘要不一致说明快照在落盘后被改写或损坏：这里不提供「强行恢复」，否则校验形同虚设。
    if (snapshot.integrity === "mismatch") {
      throw new PurgeError(
        "BACKUP_TAMPERED",
        "备份内容与落盘时的摘要不一致：快照可能被手工改写或已损坏，已拒绝恢复。请改用其它备份，或重新应用生成新快照。"
      );
    }
    const integrity = snapshot.integrity === "ok" ? "verified" : "unverified";
    const kind = String(snapshot.kind || "");
    if (snapshot.payload !== undefined && snapshot.payload !== null) {
      if (typeof snapshot.payload !== "object" || Array.isArray(snapshot.payload)) {
        throw new PurgeError("INVALID_PARAM", "备份的 payload 结构异常，已拒绝恢复");
      }
    }
    const payload = snapshot.payload || {};
    const force = body.force === true;

    if (kind === "proxy") {
      const original = payload.content ?? null;
      // 快照里的原文必须是字符串或 null：其它类型交给 restoreProxyBlock 会被静默当成「无内容」。
      if (original !== null && typeof original !== "string") {
        throw new PurgeError("INVALID_PARAM", "备份里的代理脚本文本不是字符串，已拒绝恢复");
      }
      const result = await restoreProxyBlock({
        filePath: proxyPath,
        original,
        force,
      });
      // 什么都没写回时必须报错：否则备份页会显示「已回滚」，撤回记账也被顺手清掉。
      if (!result.restored && !result.removed && !(result.removedResidues > 0)) {
        throw new PurgeError(
          "PROXY_RESTORE_EMPTY",
          "该快照没有可写回的内容：代理脚本不存在，或快照记录的原文为空"
        );
      }
    } else if (kind === "role") {
      const role = await prompts.readRole();
      const roleIssue = roleUnreadable(role);
      if (roleIssue) {
        throw new PurgeError("WRITE_FAILED", `${roleIssue}，角色文件未改动`);
      }
      const content = typeof payload.content === "string" ? payload.content : "";
      // 快照存的是「应用前原文」，可能自带旧托管段：两侧都剥离后再比段外内容，
      // 才能区分「只是托管段不同」与「用户在段外手写过」。
      const outsideNow = normalizeOutside(stripRoleBlock(role.content));
      const outsideSnapshot = normalizeOutside(stripRoleBlock(content));
      if (!force && outsideNow !== outsideSnapshot) {
        throw new PurgeError(
          "ROLE_FOREIGN_EDIT",
          "角色文件里托管段之外的内容与应用前快照不一致：整份写回会覆盖你之后手写的规则，因此没有执行。想保留段外改动，请到「提示词」页点「移除托管段」；确认要连段外一起覆盖，再点一次「回滚」并确认覆盖。"
        );
      }
      if (content.trim()) {
        await prompts.saveRole(content);
      } else {
        // 快照记录的是「应用前没有 ROLE 文件」：宿主写动作不接受空 content，改为删除当前文件。
        await prompts.saveRole("", role.filePath);
      }
    } else if (kind === "prompt") {
      if (payload.item !== null && payload.item !== undefined) {
        const item = payload.item;
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new PurgeError("INVALID_PARAM", "备份里的提示词条目结构异常，已拒绝恢复");
        }
        // 本插件只快照自己托管的那一条：其它 promptId 只能来自篡改或其它工具，拒绝覆盖用户自建条目。
        if (item.promptId !== MANAGED_PROMPT_ID) {
          throw new PurgeError(
            "INVALID_PARAM",
            `该备份的提示词条目不是 ${MANAGED_PROMPT_ID}，已拒绝写入其它提示词条目`
          );
        }
        const content = typeof item.content === "string" ? item.content : "";
        if (!content.trim()) {
          throw new PurgeError("INVALID_PARAM", "备份里的提示词正文为空，已拒绝恢复");
        }
        if (content.length > LIMITS.promptCharsMax) {
          throw new PurgeError(
            "INVALID_PARAM",
            `备份里的提示词正文过长（上限 ${LIMITS.promptCharsMax} 字符）`
          );
        }
        await prompts.upsertPrompt({
          promptId: MANAGED_PROMPT_ID,
          name: item.name,
          content,
          isActive: item.isActive,
          sortOrder: item.sortOrder,
        });
      } else {
        const state = await prompts.readPrompts();
        // 读不到列表时不能当成「条目不存在」：否则会返回成功并清掉撤回记账，托管条目却可能仍在生效。
        if (!Array.isArray(state.prompts)) {
          throw new PurgeError(
            "WRITE_FAILED",
            `读不到宿主提示词库（${state.denied?.reason || "宿主未返回条目"}），托管条目未核对，撤回记账保持不变`
          );
        }
        if (state.prompts.some((entry) => entry?.promptId === MANAGED_PROMPT_ID)) {
          await prompts.removePrompt(MANAGED_PROMPT_ID);
        }
      }
    } else if (kind === "approval") {
      // 宿主的写入动作不接受空数组：快照里的全局清单为空时无法自动还原，给出明确指引。
      // 快照内容来自插件数据目录，手工改过也可能是脏值：写入前按同一口径校验工具名。
      const globalTools = readToolNames(Array.isArray(payload.globalTools) ? payload.globalTools : [], "快照 globalTools");
      if (globalTools.length === 0) {
        throw new PurgeError(
          "INVALID_PARAM",
          "该快照记录的全局清单为空，宿主的写入动作不接受空数组：请先在宿主设置的权限页手工清空"
        );
      }
      await approval.setGlobal(globalTools);
      // 项目标识来自快照文件，写入前按配置层同一口径校验：trim、长度上限、不含控制字符。
      let projectId = "";
      if (payload.projectId !== undefined && payload.projectId !== null) {
        if (typeof payload.projectId !== "string") {
          throw new PurgeError("INVALID_PARAM", "备份里的项目标识不是字符串，已拒绝恢复项目清单");
        }
        projectId = payload.projectId.trim();
        if (projectId.length > LIMITS.projectIdCharsMax) {
          throw new PurgeError(
            "INVALID_PARAM",
            `备份里的项目标识过长（上限 ${LIMITS.projectIdCharsMax} 字符），已拒绝恢复项目清单`
          );
        }
        if (/[\u0000-\u001f]/.test(projectId)) {
          throw new PurgeError("INVALID_PARAM", "备份里的项目标识含控制字符，已拒绝恢复项目清单");
        }
      }
      if (projectId) {
        const projectTools = readToolNames(
          Array.isArray(payload.projectTools) ? payload.projectTools : [],
          "快照 projectTools"
        );
        if (projectTools.length > 0) await approval.setProjectMany(projectId, projectTools, true);
      }
    } else {
      throw new PurgeError("INVALID_PARAM", `不支持的备份类型：${kind}`);
    }

    // 该层已回到应用前状态：同步清掉记账，避免再点「撤回」时用旧快照二次覆盖恢复结果。
    let appliedNote = "";
    if (kind === "approval") {
      // 免审批快照只覆盖「应用前清单里已有的工具」，不会撤下应用后新增的授权：
      // 这里保留撤回记账，避免新增授权失去可撤回的依据；但快照已被消费，必须清掉 id。
      try {
        const current = (await settings.get()).applied;
        if (current?.backups?.approval) {
          await settings.setApplied({ ...current, backups: { ...current.backups, approval: "" } });
        }
        appliedNote = "（免审批清单的撤回记账保持不变，应用前快照已标记为已使用）";
      } catch (error) {
        appliedNote = `（免审批清单的撤回记账保持不变；快照标记未更新：${String(error?.message || error)}）`;
      }
    } else {
      try {
        const applied = clearAppliedLayer((await settings.get()).applied, kind);
        await settings.setApplied(applied);
        appliedNote = applied ? "（该层已标记为未应用）" : "（记账已清空）";
      } catch (error) {
        appliedNote = `（记账未更新：${String(error?.message || error)}）`;
      }
    }

    const integrityNote = integrity === "verified" ? "" : "；旧快照未带内容摘要，已按兼容模式恢复";
    await audit.record({
      action: "backup.restore",
      ok: true,
      detail: `${kind} ${id}${appliedNote}${integrityNote}`,
    });
    return { status: 200, payload: { restored: true, kind, id, appliedNote, integrity } };
  }

  if (pathname === ROUTES.backupRemove && method === "POST") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    const removed = await backups.remove(id);
    return { status: 200, payload: { removed, usage: await backups.usage() } };
  }

  if (pathname === ROUTES.audit && method === "GET") {
    return { status: 200, payload: { items: await audit.list(clampLimit(query.get("limit"), 50, 200)) } };
  }

  if (pathname === ROUTES.logs && method === "GET") {
    const params = {
      level: query.get("level") || undefined,
      module: query.get("module") || undefined,
      since: query.get("since") || undefined,
      until: query.get("until") || undefined,
      limit: clampLimit(query.get("limit"), 50, LIMITS.logsLimitMax),
      offset: Math.max(0, Number(query.get("offset") || 0) || 0),
    };
    for (const key of Object.keys(params)) if (params[key] === undefined) delete params[key];
    try {
      const response = await deps.metadata.get("logs", { params });
      return {
        status: 200,
        payload: {
          logs: response?.domains?.logs ?? null,
          denied: response?.denied?.logs || null,
        },
      };
    } catch (error) {
      throw new PurgeError("METADATA_FAILED", String(error?.message || error));
    }
  }

  if (pathname === ROUTES.auditClear && method === "POST") {
    await audit.clear();
    return { status: 200, payload: { items: await audit.list(50) } };
  }

  if (pathname === ROUTES.logsClear && method === "POST") {
    if (!write || typeof write.run !== "function") {
      throw new PurgeError("WRITE_UNAVAILABLE", "后台没有拿到写通道，无法清空应用日志");
    }
    const result = await write.run("logs.clear", {});
    if (!result?.ok) {
      const reason = result?.denied?.reason
        ? `（${result.denied.reason}${result.denied.scope ? `: ${result.denied.scope}` : ""}）`
        : "";
      throw new PurgeError("WRITE_FAILED", `logs.clear 失败：${result?.error || "未知原因"}${reason}`);
    }
    return { status: 200, payload: { cleared: true, removed: Number(result.data) || 0 } };
  }

  if (pathname === ROUTES.redteam && method === "GET") {
    // 环境探测有缓存：只有用户点「刷新」（refresh=1）才强制重扫 PATH。
    return {
      status: 200,
      payload: await redteam.describe({ refreshEnv: query.get("refresh") === "1" }),
    };
  }

  if (pathname === ROUTES.redteamInstall && method === "POST") {
    const body = await readJsonBody(req);
    const results =
      body.all === true ? await redteam.installAll() : [await redteam.install(typeof body.name === "string" ? body.name : "")];
    const failed = results.filter((item) => item.action === "failed");
    await audit.record({
      action: "redteam.install",
      ok: failed.length === 0,
      detail: failed.length ? `${failed.length} 项失败` : `${results.length} 项技能`,
    });
    return { status: 200, payload: { results, ...(await redteam.describe()) } };
  }

  if (pathname === ROUTES.redteamToggle && method === "POST") {
    const body = await readJsonBody(req);
    const result = await redteam.setEnabled(
      typeof body.name === "string" ? body.name : "",
      body.enabled !== false
    );
    await audit.record({
      action: "redteam.toggle",
      ok: true,
      detail: `${result.name} ${result.enabled ? "启用" : "停用"}`,
    });
    return { status: 200, payload: { ...result, ...(await redteam.describe()) } };
  }

  if (pathname === ROUTES.redteamRemove && method === "POST") {
    const body = await readJsonBody(req);
    const result = await redteam.remove(typeof body.name === "string" ? body.name : "");
    await audit.record({
      action: "redteam.remove",
      ok: true,
      detail: `${result.name} ${result.removed ? "已移除" : "未安装"}`,
    });
    return { status: 200, payload: { ...result, ...(await redteam.describe()) } };
  }

  if (pathname === ROUTES.redteamSkill && method === "GET") {
    return { status: 200, payload: await redteam.readSkill(query.get("name") || "") };
  }

  if (pathname === ROUTES.roster && method === "GET") {
    const [described, tasks, chainList] = await Promise.all([roster.describe(), rosterTasks.list(), chains.list()]);
    return {
      status: 200,
      payload: {
        ...described,
        tasks: tasks.tasks,
        tasksAvailable: tasks.available,
        tasksArchived: tasks.archived || 0,
        tasksIndexBroken: tasks.indexBroken === true,
        tasksIndexReason: tasks.indexReason || "",
        chains: chainList.chains,
        chainsAvailable: chainList.available,
        chainsIndexBroken: chainList.indexBroken === true,
        chainsIndexReason: chainList.indexReason || "",
      },
    };
  }

  if (pathname === ROUTES.rosterInstall && method === "POST") {
    const body = await readJsonBody(req);
    const confirm = body.confirm === true;
    const results =
      body.all === true
        ? await roster.installAll({ confirm })
        : [
            await roster.install(typeof body.agentId === "string" ? body.agentId : "", {
              confirm,
            }),
          ];
    const failed = results.filter((item) => item.action === "failed");
    const conflicts = results.filter((item) => item.action === "conflict");
    const indexFailed = results.filter((item) => item.indexError).length;
    const firstError = failed[0]?.message ? `：${String(failed[0].message).slice(0, 200)}` : "";
    await audit.record({
      action: "roster.install",
      ok: failed.length === 0 && indexFailed === 0,
      detail: failed.length
        ? `${failed.length} 项失败${firstError}`
        : `${results.length} 个角色${conflicts.length ? `，${conflicts.length} 项等待确认覆盖` : ""}${
            indexFailed ? `，${indexFailed} 项已写入宿主但索引未写入` : ""
          }`,
    });
    return { status: 200, payload: { results, ...(await roster.describe()) } };
  }

  if (pathname === ROUTES.rosterRemove && method === "POST") {
    const body = await readJsonBody(req);
    const result = await roster.remove(typeof body.agentId === "string" ? body.agentId : "", {
      confirm: body.confirm === true,
    });
    // 索引里没有记录或签名不一致：这次只做探测，不删除、也不写审计。
    if (result.needsConfirm) {
      return { status: 200, payload: { ...result, ...(await roster.describe()) } };
    }
    const detail = result.removed
      ? `${result.id} 已移除${result.foreignRemoved ? "（索引里没有本插件的编入记录）" : ""}${
          result.projectRemaining ? `（另有 ${result.projectRemaining} 个项目级同名记录未处理）` : ""
        }${result.indexError ? `；索引未更新：${result.indexError}` : ""}`
      : result.existed
        ? `${result.id} 未确认移除`
        : `${result.id} 未安装`;
    await audit.record({
      action: "roster.remove",
      // 「未安装」说明目标状态本来就成立，算成功；「仍有记录」或索引未清才算失败。
      ok: (result.removed || !result.existed) && !result.indexError,
      detail,
    });
    return { status: 200, payload: { ...result, ...(await roster.describe()) } };
  }

  if (pathname === ROUTES.rosterRole && method === "GET") {
    return { status: 200, payload: roster.readRole(query.get("agentId") || "") };
  }

  if (pathname === ROUTES.rosterDispatch && method === "POST") {
    const body = await readJsonBody(req);
    const result = await rosterTasks.dispatch({
      roleId: typeof body.roleId === "string" ? body.roleId : "",
      target: typeof body.target === "string" ? body.target : "",
      templates: Array.isArray(body.templates) ? body.templates.filter((item) => typeof item === "string") : [],
      template: typeof body.template === "string" ? body.template : "",
      note: typeof body.note === "string" ? body.note : "",
      mode: body.mode === "split" ? "split" : "single",
    });
    await audit.record({
      action: "roster.dispatch",
      ok: result.failed.length === 0 && !result.indexError && !result.archiveError,
      detail: `${result.task.roleId} → ${result.task.target}，${result.taskCount} 条任务（${result.conversations} 个会话）${
        result.failed.length ? `，${result.failed.length} 条失败` : ""
      }${result.truncatedTemplates > 0 ? `，超出单次上限忽略 ${result.truncatedTemplates} 条` : ""}${
        result.archived > 0 ? `，旧记录归档 ${result.archived} 条` : ""
      }${result.archiveError ? `，归档失败：${result.archiveError}` : ""}${
        result.dropped > 0 ? `，超出硬上限丢弃 ${result.dropped} 条` : ""
      }${result.indexError ? `，索引未写入：${result.indexError}` : ""}`.slice(0, 300),
    });
    const [described, tasks] = await Promise.all([roster.describe(), rosterTasks.list()]);
    return {
      status: 200,
      payload: {
        ...result,
        ...described,
        tasks: tasks.tasks,
        tasksAvailable: tasks.available,
        tasksArchived: tasks.archived || 0,
        tasksIndexBroken: tasks.indexBroken === true,
        tasksIndexReason: tasks.indexReason || "",
      },
    };
  }

  if (pathname === ROUTES.rosterTaskActivate && method === "POST") {
    const body = await readJsonBody(req);
    const result = await rosterTasks.activate(typeof body.id === "string" ? body.id : "");
    await audit.record({ action: "roster.task.activate", ok: true, detail: result.id });
    return { status: 200, payload: result };
  }

  if (pathname === ROUTES.rosterTaskRemove && method === "POST") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    // 旧链路没有把项目归属写进步骤，删掉任务记录后就再也回填不出来：先查引用再删。
    const refs = await chains.taskRefs(id);
    const blockedRef = refs.find(
      (ref) =>
        ["running", "paused", "blocked"].includes(ref.status) &&
        !ref.stepDirectoryId &&
        !ref.directoryId
    );
    if (blockedRef) {
      const roleName = findRosterRole(blockedRef.roleId)?.name || blockedRef.roleId;
      throw new PurgeError(
        "TASK_IN_USE",
        `这条任务记录正被链路 ${blockedRef.chainId} 的第 ${blockedRef.stepIndex + 1} 环（${roleName}）引用，而该链路没有记下项目归属：删掉记录会让它停在「读不到项目归属」。先停止或移除这条链路，再删记录。`
      );
    }
    const result = await rosterTasks.remove(id);
    await audit.record({
      action: "roster.task.remove",
      ok: result.removed === true,
      detail: `${result.id} ${result.removed ? "已移除记录" : "不存在"}`,
    });
    const tasks = await rosterTasks.list();
    return { status: 200, payload: { ...result, tasks: tasks.tasks, tasksAvailable: tasks.available } };
  }

  if (pathname === ROUTES.rosterChainStart && method === "POST") {
    const body = await readJsonBody(req);
    const result = await chains.start({
      target: typeof body.target === "string" ? body.target : "",
      note: typeof body.note === "string" ? body.note : "",
      roleIds: Array.isArray(body.roleIds) ? body.roleIds.filter((item) => typeof item === "string") : [],
      steps: Array.isArray(body.steps)
        ? body.steps
            .filter((item) => item && typeof item === "object" && typeof item.roleId === "string")
            .map((item) => ({
              roleId: item.roleId,
              tasks: Array.isArray(item.tasks) ? item.tasks.filter((text) => typeof text === "string") : [],
            }))
        : [],
    });
    const blocked = result.chain.status !== "running";
    await audit.record({
      action: "roster.chain.start",
      ok: !blocked,
      detail: `${result.chain.target}，${result.chain.steps.length} 环${
        result.chain.lastError ? `：${result.chain.lastError}` : ""
      }`.slice(0, 300),
    });
    const [described, tasks] = await Promise.all([roster.describe(), rosterTasks.list()]);
    return { status: 200, payload: { ...result, ...described, tasks: tasks.tasks, tasksAvailable: tasks.available } };
  }

  if (method === "POST" && pathname.startsWith("/roster/chain/")) {
    const entry =
      {
        [ROUTES.rosterChainPause]: { run: chains.pause, audit: "roster.chain.pause" },
        [ROUTES.rosterChainResume]: { run: chains.resume, audit: "roster.chain.resume" },
        [ROUTES.rosterChainSkip]: { run: chains.skip, audit: "roster.chain.skip" },
        [ROUTES.rosterChainStop]: { run: chains.stop, audit: "roster.chain.stop" },
        [ROUTES.rosterChainRemove]: { run: chains.remove, audit: "roster.chain.remove" },
      }[pathname] || null;
    if (entry) {
      const body = await readJsonBody(req);
      const id = typeof body.id === "string" ? body.id : "";
      const result = await entry.run(id);
      // 停止与跳过会尝试中止当前会话：把结果写进审计，区分「已中止」与「本来就没在跑」。
      const abortNote =
        result?.aborted === true
          ? "已中止当前会话"
          : ["roster.chain.stop", "roster.chain.skip"].includes(entry.audit) && result?.aborted === false
            ? `未中止会话：${result?.abortReason || "没有进行中的回合"}`
            : "";
      const detail = abortNote ? `${id}（${abortNote}）` : id;
      await audit.record({ action: entry.audit, ok: true, detail: detail.slice(0, 300) });
      const [described, tasks] = await Promise.all([roster.describe(), rosterTasks.list()]);
      return { status: 200, payload: { ...result, ...described, tasks: tasks.tasks, tasksAvailable: tasks.available } };
    }
  }

  throw new PurgeError("NOT_FOUND", `未知接口：${pathname}`);
};

/**
 * 起服务：从 portFirst 逐个试到 portLast，取第一个能绑定的端口。
 * 端口与令牌由调用方发布到插件私有存储，面板按那条记录连接。
 */
export async function startServer({
  settings,
  audit,
  backups,
  prompts,
  approval,
  redteam,
  roster,
  rosterTasks,
  chains,
  write,
  metadata,
  proxyPath,
  probePath,
  version,
  channelToken = "",
  log = () => {},
  portFirst = PORT_FIRST,
  portLast = PORT_LAST,
}) {
  const startedAt = Date.now();
  const token = String(channelToken || "");
  if (!token) throw new PurgeError("CHANNEL_TOKEN_MISSING", "未配置通道令牌，拒绝启动本地服务");

  const deps = {
    settings,
    audit,
    backups,
    prompts,
    approval,
    redteam,
    roster,
    rosterTasks,
    chains,
    write,
    metadata,
    proxyPath,
    probePath,
  };
  const serverInfo = { version, startedAt, port: 0 };

  // 写类请求串行执行：面板顶部与各标签页各自维护 busy，HTTP 层若并发，
  // 后完成的请求会基于更早的配置覆盖先写入的记账，托管段仍在但面板显示未应用。
  let writeTail = Promise.resolve();
  const runSerialized = (run) => {
    const next = writeTail.then(run, run);
    writeTail = next.then(
      () => {},
      () => {}
    );
    return next;
  };

  const handler = async (req, res) => {
    const channelOk = String(req.headers[CHANNEL_HEADER] || "") === CHANNEL_HEADER_VALUE;
    const tokenOk = String(req.headers[CHANNEL_TOKEN_HEADER] || "") === token;
    if (!channelOk || !tokenOk) {
      sendError(res, 403, "FORBIDDEN", channelOk ? "通道令牌无效，请重新打开插件面板" : "缺少通道头");
      return;
    }

    let url;
    try {
      url = new URL(req.url || "/", `http://${HOST}`);
    } catch {
      sendError(res, 400, "INVALID_URL", "请求地址不合法");
      return;
    }

    try {
      const method = (req.method || "GET").toUpperCase();
      const run = () =>
        handleRequest({
          deps,
          req,
          pathname: url.pathname,
          query: url.searchParams,
          serverInfo,
        });
      // 本服务的非 GET 请求都是写类：串行执行，避免两个写动作交错覆盖配置与记账。
      const result = method === "GET" || method === "HEAD" ? await run() : await runSerialized(run);
      sendJson(res, result.status, result.payload);
    } catch (error) {
      const code = error instanceof PurgeError ? error.code : "INTERNAL";
      const status = toStatus(error);
      if (code === "INTERNAL" || code === "METADATA_FAILED") {
        log(`请求失败 ${url.pathname}: ${error?.message || error}`);
      }
      // 客户端已经断开时写回没有意义，向已销毁的 socket 写入还会再抛一次错。
      if (res.destroyed || res.writableEnded) return;
      if (code === "REQUEST_TIMEOUT" || code === "REQUEST_ABORTED") {
        try {
          req.destroy();
        } catch {
          // 连接可能已断开。
        }
      }
      if (code === "REQUEST_TOO_LARGE") {
        res.once("finish", () => {
          try {
            req.destroy();
          } catch {
            // 连接可能已断开。
          }
        });
      }
      sendError(res, status, code, String(error?.message || error));
    }
  };

  const tryListen = (port) =>
    new Promise((resolve, reject) => {
      const server = createServer(handler);
      const onListenError = (error) => {
        server.removeListener("listening", onListening);
        server.close(() => {});
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onListenError);
        server.on("error", (error) => {
          log(`本地服务错误：${error?.code ? `${error.code} ` : ""}${error?.message || error}`);
        });
        resolve(server);
      };
      server.once("error", onListenError);
      server.once("listening", onListening);
      server.listen(port, HOST);
    });

  let server = null;
  let port = 0;
  let lastError = null;
  for (let candidate = portFirst; candidate <= portLast; candidate += 1) {
    try {
      server = await tryListen(candidate);
      port = candidate;
      break;
    } catch (error) {
      lastError = error;
      if (error?.code !== "EADDRINUSE") break;
    }
  }

  if (!server) {
    throw new PurgeError("BIND_FAILED", `无法在 ${portFirst}-${portLast} 内绑定端口：${lastError?.message || lastError}`);
  }

  serverInfo.port = port;
  log(`本地服务已监听 http://${HOST}:${port}`);

  return {
    port,
    startedAt,
    url: `http://${HOST}:${port}`,
    getServerInfo: () => ({ ...serverInfo }),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        setTimeout(() => resolve(), 1500).unref?.();
      }),
  };
}
