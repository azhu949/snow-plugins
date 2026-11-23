// 插件配置：托管开关、提示词、角色规则、代理注入、免审批清单与自定义预设。
// 全部存在插件私有存储里；「已应用」状态单独记账，用于安全撤回（只撤我们加进去的东西）。
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LIMITS,
  MANAGED_PROMPT_ID,
  MANAGED_PROMPT_NAME,
  PROVIDER_IDS,
  TOOL_NAME_PATTERN,
  TOOL_NAMES_MAX,
} from "../shared/contract.js";

const STORAGE_KEY = "purgeConfig";

const PRESET_ID_PATTERN = /^[A-Za-z0-9_.:\-]{1,64}$/;

export const DEFAULT_DIRECTIVE =
  "继续执行当前任务，不要为每一步重复请求确认。遇到不明确的地方，先给出你能执行的下一步并说明假设；已经有结论的部分不要重述。只在确实需要用户本人决定时停下来提问。";

export const DEFAULT_ROLE =
  "协作方式：直接执行用户已经明确的任务，不要为每一步重复确认；需要用户决定时一次问清。回答以结论和证据优先，避免复述与空泛的免责声明。";

const DEFAULTS = {
  enabled: true,
  prompt: {
    enabled: true,
    promptId: MANAGED_PROMPT_ID,
    name: MANAGED_PROMPT_NAME,
    content: DEFAULT_DIRECTIVE,
    isActive: true,
  },
  role: {
    enabled: false,
    content: DEFAULT_ROLE,
  },
  proxy: {
    enabled: false,
    directive: DEFAULT_DIRECTIVE,
    boost: true,
    providers: { chat: true, responses: true, anthropic: true, gemini: true },
  },
  approval: {
    enabled: false,
    tools: [],
    projectId: "",
    projectTools: [],
  },
  presets: [],
  autoSnapshot: true,
  applied: null,
};

const cleanText = (value, maxLength) => {
  if (typeof value !== "string") return "";
  const text = value.replace(/\r\n/g, "\n").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

/**
 * 归一化会裁剪超长文本，因此长度只能对原始 patch 判断：校验放在归一之后时永远不触发，
 * 用户粘贴的超长指令只会被静默截掉尾部。判长口径与 cleanText 一致（先统一换行再去首尾空白），
 * 避免把仅尾部空白的合法文本误判为超长。
 */
const assertPatchedTextLength = (patch) => {
  const value = patch?.proxy?.directive;
  if (typeof value !== "string") return;
  const length = value.replace(/\r\n/g, "\n").trim().length;
  if (length <= LIMITS.directiveCharsMax) return;
  const error = new Error(`代理注入指令过长（上限 ${LIMITS.directiveCharsMax} 字符，当前 ${length} 字符）`);
  error.code = "INVALID_PARAM";
  throw error;
};

/**
 * 项目标识只做 trim，绝不截断：宿主用 local:<绝对路径> 作为项目 id，
 * 截断后写入的是另一个项目的键，授权与撤回都会落到不存在的项目上。
 */
const projectIdText = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeProviders = (raw) => {
  const out = {};
  for (const id of PROVIDER_IDS) out[id] = raw?.[id] !== false;
  return out;
};

const normalizeTools = (raw) => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const tools = [];
  for (const item of raw) {
    const text = typeof item === "string" ? item.trim() : "";
    if (!TOOL_NAME_PATTERN.test(text) || seen.has(text)) continue;
    seen.add(text);
    tools.push(text);
    if (tools.length >= TOOL_NAMES_MAX) break;
  }
  return tools;
};

const normalizePresets = (raw) => {
  if (!Array.isArray(raw)) return [];
  const presets = [];
  const seen = new Set();
  for (const item of raw) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    const name = cleanText(item?.name, 40);
    if (!PRESET_ID_PATTERN.test(id) || !name || seen.has(id)) continue;
    seen.add(id);
    presets.push({
      id,
      name,
      // 预设的 directive 存的是提示词正文（面板 draft.content），上限与提示词正文一致。
      directive: cleanText(item?.directive, LIMITS.promptCharsMax),
      role: cleanText(item?.role, LIMITS.roleCharsMax),
      boost: item?.boost !== false,
      providers: normalizeProviders(item?.providers),
    });
    if (presets.length >= LIMITS.presetCountMax) break;
  }
  return presets;
};

/** 项目级免审批记账的条数上限：只防无限增长，正常使用远达不到。 */
export const APPROVAL_PROJECTS_MAX = 20;

/**
 * 「是否还有任何一层托管」的唯一判定：normalizeApplied / clearAppliedLayer 与写入侧共用。
 * 只看层标记，不看 at —— 空壳（只有时间、没有任何层）必须视为未应用。
 */
export const hasAppliedLayers = (applied) => {
  if (!applied || typeof applied !== "object" || Array.isArray(applied)) return false;
  const projects = applied.projectApprovals;
  const projectCount =
    projects && typeof projects === "object" && !Array.isArray(projects) ? Object.keys(projects).length : 0;
  return (
    applied.prompt === true ||
    applied.roleBlock === true ||
    Boolean(applied.proxyHash) ||
    (Array.isArray(applied.globalTools) && applied.globalTools.length > 0) ||
    projectCount > 0
  );
};

const normalizeApplied = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const backups = raw.backups && typeof raw.backups === "object" ? raw.backups : {};
  const text = (value) => (typeof value === "string" ? value : "");
  // 项目级记账按项目分别保存：同一个工具在 A、B 两个项目各新增一次时，不能只留最后一个项目。
  const projectApprovals = {};
  if (raw.projectApprovals && typeof raw.projectApprovals === "object" && !Array.isArray(raw.projectApprovals)) {
    for (const [key, value] of Object.entries(raw.projectApprovals)) {
      const projectId = projectIdText(key);
      const tools = normalizeTools(value);
      if (!projectId || tools.length === 0) continue;
      projectApprovals[projectId] = tools;
      if (Object.keys(projectApprovals).length >= APPROVAL_PROJECTS_MAX) break;
    }
  }
  // 旧记录只有一个 projectId + projectTools：迁移成一条映射，否则撤回时整层漏撤。
  const legacyId = projectIdText(raw.projectId);
  const legacyTools = normalizeTools(raw.projectTools);
  if (Object.keys(projectApprovals).length === 0 && legacyId && legacyTools.length > 0) {
    projectApprovals[legacyId] = legacyTools;
  }
  const next = {
    at: Number.isFinite(Number(raw.at)) ? Number(raw.at) : 0,
    prompt: raw.prompt === true,
    roleBlock: raw.roleBlock === true,
    proxyHash: text(raw.proxyHash),
    globalTools: normalizeTools(raw.globalTools),
    projectApprovals,
    backups: {
      proxy: text(backups.proxy),
      role: text(backups.role),
      prompt: text(backups.prompt),
      approval: text(backups.approval),
    },
  };
  // 所有层都为空时返回 null：否则 at 与 backups 会让状态页把空壳当成「已应用」。
  return hasAppliedLayers(next) ? next : null;
};

/**
 * 恢复备份或单独还原某一层之后，把该层的「已应用」记账清掉。
 * 同一层的应用前快照 id 也一并清掉：还原后再次应用必须重新快照，否则撤回会拿旧原文比对。
 * 全部层都清空时返回 null，面板据此显示「未应用」。
 */
export const clearAppliedLayer = (applied, layer) => {
  if (!applied || typeof applied !== "object" || Array.isArray(applied)) return null;
  const next = {
    ...applied,
    backups: { proxy: "", role: "", prompt: "", approval: "", ...(applied.backups || {}) },
  };
  if (layer === "prompt") {
    next.prompt = false;
    next.backups.prompt = "";
  }
  if (layer === "role") {
    next.roleBlock = false;
    next.backups.role = "";
  }
  if (layer === "proxy") {
    next.proxyHash = "";
    next.backups.proxy = "";
  }
  if (layer === "approval") {
    next.globalTools = [];
    next.projectApprovals = {};
    next.backups.approval = "";
  }
  return hasAppliedLayers(next) ? next : null;
};

export const normalizeConfig = (raw) => ({
  enabled: raw?.enabled !== false,
  prompt: {
    enabled: raw?.prompt?.enabled !== false,
    promptId: MANAGED_PROMPT_ID,
    name: cleanText(raw?.prompt?.name, 80) || MANAGED_PROMPT_NAME,
    content: cleanText(raw?.prompt?.content ?? DEFAULTS.prompt.content, LIMITS.promptCharsMax),
    isActive: raw?.prompt?.isActive !== false,
  },
  role: {
    enabled: raw?.role?.enabled === true,
    content: cleanText(raw?.role?.content ?? DEFAULTS.role.content, LIMITS.roleCharsMax),
  },
  proxy: {
    enabled: raw?.proxy?.enabled === true,
    directive: cleanText(raw?.proxy?.directive ?? DEFAULTS.proxy.directive, LIMITS.directiveCharsMax),
    boost: raw?.proxy?.boost !== false,
    providers: normalizeProviders(raw?.proxy?.providers),
  },
  approval: {
    enabled: raw?.approval?.enabled === true,
    tools: normalizeTools(raw?.approval?.tools),
    projectId: projectIdText(raw?.approval?.projectId),
    projectTools: normalizeTools(raw?.approval?.projectTools),
  },
  presets: normalizePresets(raw?.presets),
  autoSnapshot: raw?.autoSnapshot !== false,
  applied: normalizeApplied(raw?.applied),
});

export const validateConfig = (next) => {
  if (next.prompt.enabled && !next.prompt.content) return "提示词内容不能为空";
  if (next.prompt.content.length > LIMITS.promptCharsMax) return "提示词内容过长";
  if (next.role.enabled && !next.role.content) return "角色规则内容不能为空";
  if (next.role.content.length > LIMITS.roleCharsMax) return "角色规则内容过长";
  if (next.proxy.enabled) {
    if (!next.proxy.directive) return "代理注入指令不能为空";
    if (next.proxy.directive.length > LIMITS.directiveCharsMax) return "代理注入指令过长";
    if (!PROVIDER_IDS.some((id) => next.proxy.providers[id])) return "代理注入至少要选择一个协议";
  }
  for (const tool of next.approval.tools) {
    if (!TOOL_NAME_PATTERN.test(tool)) return `工具名不合法：${tool}`;
  }
  for (const tool of next.approval.projectTools) {
    if (!TOOL_NAME_PATTERN.test(tool)) return `工具名不合法：${tool}`;
  }
  if (next.approval.projectId.length > LIMITS.projectIdCharsMax) {
    return `项目目录标识过长（上限 ${LIMITS.projectIdCharsMax} 字符）`;
  }
  if (next.approval.projectTools.length > 0 && !next.approval.projectId) {
    return "填写项目免审批工具前，需要先填写项目目录";
  }
  return "";
};

export function createSettings({ storage, log = () => {}, onChange, quarantineDir = "" } = {}) {
  let current = normalizeConfig(DEFAULTS);
  let loaded = null;
  let storageReadFailed = false;
  /**
   * 配置内容不是合法 JSON：与「键不存在」分开记账。损坏时禁止任何写盘，
   * 否则一次保存就会用默认值覆盖存储，把 applied（撤回依据）一起抹掉。
   */
  let storageCorrupt = false;
  let corruptText = "";
  let corruptLogged = false;

  /**
   * 读改写的串行队列：save 与 setApplied 都是「读 current → 算 next → 写盘 → 赋值」，
   * 两个请求交错时后写者会基于过期快照覆盖先写者，把刚写入的设置或记账一起抹掉。
   */
  let writeQueue = Promise.resolve();
  const withWriteLock = (run) => {
    const next = writeQueue.then(run, run);
    writeQueue = next.then(
      () => {},
      () => {}
    );
    return next;
  };

  /**
   * 读取插件配置：失败重试一次并退避。返回是否成功，调用方据此决定能否写盘。
   * 读失败不能当「读到空」：用默认值覆盖会把用户的托管设置与撤回记账一起抹掉。
   */
  const readStorageRaw = async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        // 必须读原始字符串：宿主的 getJson 会把解析失败静默换成 fallback，
        // 「损坏」与「从未配置」在那里无法区分，随后一次保存就会覆盖掉撤回记账。
        const text = await storage.get(STORAGE_KEY);
        if (typeof text !== "string" || text.trim() === "") {
          return { ok: true, corrupt: false, raw: null, text: "" };
        }
        try {
          const parsed = JSON.parse(text);
          // 合法 JSON 但不是对象同样算损坏：交给 normalizeConfig 会被静默吃成默认值。
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            log("插件配置内容的结构不是对象，已按损坏处理");
            return { ok: true, corrupt: true, raw: null, text };
          }
          return { ok: true, corrupt: false, raw: parsed, text };
        } catch (error) {
          log(`插件配置内容无法解析（不是合法 JSON）：${error?.message || error}`);
          return { ok: true, corrupt: true, raw: null, text };
        }
      } catch (error) {
        log(`读取插件配置失败（第 ${attempt + 1} 次）：${error?.message || error}`);
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    return { ok: false, corrupt: false, raw: null, text: "" };
  };

  /** 读失败后的最小重试间隔：避免面板轮询把日志刷满，也不让会话永久只读。 */
  let readRetryAt = 0;

  const ensure = async () => {
    if (loaded) return loaded;
    if (storageReadFailed && Date.now() < readRetryAt) return current;
    const result = await readStorageRaw();
    storageReadFailed = !result.ok;
    storageCorrupt = result.ok && result.corrupt;
    corruptText = storageCorrupt ? result.text : "";
    if (storageCorrupt && !corruptLogged) {
      corruptLogged = true;
      log("插件配置内容已损坏：已进入只读保护，保存与记账写入都会被拒绝，需要先在设置页执行修复");
    }
    if (!result.ok) {
      readRetryAt = Date.now() + 5000;
      return current;
    }
    current = normalizeConfig(result.raw ?? DEFAULTS);
    // 损坏时不缓存：用户修复后无需重启即可重新读取。
    if (!storageCorrupt) loaded = Promise.resolve(current);
    return current;
  };

  const corruptError = () => {
    const error = new Error(
      "插件配置内容已损坏（不是合法 JSON）：为避免用默认值覆盖原有设置与撤回记账，本次写入已取消。请到设置页点「修复配置」：插件会先把损坏内容另存到插件数据目录，再从默认值重建。"
    );
    error.code = "SETTINGS_UNAVAILABLE";
    return error;
  };

  /**
   * 写前确认磁盘状态可读：读取曾失败时重试一次，成功就用磁盘值作为合并基线，
   * 避免拿默认值 + patch 覆盖用户已有的设置。
   */
  const ensureWritable = async () => {
    await ensure();
    if (storageCorrupt) throw corruptError();
    if (!storageReadFailed) return;
    const result = await readStorageRaw();
    if (!result.ok) {
      const error = new Error(
        "读取插件配置失败，已重试仍无法读取，本次保存未执行：请稍后重试，无需重启 Snow App"
      );
      error.code = "SETTINGS_UNAVAILABLE";
      throw error;
    }
    if (result.corrupt) {
      storageCorrupt = true;
      corruptText = result.text;
      throw corruptError();
    }
    storageReadFailed = false;
    readRetryAt = 0;
    current = normalizeConfig(result.raw ?? DEFAULTS);
    loaded = Promise.resolve(current);
  };

  const persist = async (next) => {
    const invalid = validateConfig(next);
    if (invalid) {
      const error = new Error(invalid);
      error.code = "INVALID_PARAM";
      throw error;
    }
    if (storageReadFailed) {
      const error = new Error(
        "读取插件配置失败，为避免覆盖已有设置，本次保存已取消：请稍后重试，无需重启 Snow App"
      );
      error.code = "SETTINGS_UNAVAILABLE";
      throw error;
    }
    if (storageCorrupt) throw corruptError();
    await storage.setJson(STORAGE_KEY, next);
    current = next;
    try {
      onChange?.(next);
    } catch (error) {
      log(`应用配置回调失败：${error?.message || error}`);
    }
    return next;
  };

  return {
    async get() {
      await ensure();
      // 只读附加字段，不参与 normalize / save：区分「内容损坏」与「读不到存储」。
      // 两者都会拒绝写入，但处置方式不同：损坏可以修复，读失败只能等存储恢复后重试。
      let settingsIssue = null;
      if (storageCorrupt) {
        settingsIssue = {
          code: "SETTINGS_UNAVAILABLE",
          kind: "corrupt",
          message:
            "插件配置内容已损坏（不是合法 JSON）：当前显示的是默认值，撤回记账不可用；修复前不会写入任何配置。",
        };
      } else if (storageReadFailed) {
        settingsIssue = {
          code: "SETTINGS_UNAVAILABLE",
          kind: "read-failed",
          message:
            "读取插件配置失败：当前显示的是插件默认配置，不代表已保存的设置；读取恢复前保存与记账都会被拒绝，请稍后刷新面板重试。",
        };
      }
      return settingsIssue ? { ...current, settingsIssue } : current;
    },

    /**
     * 修复损坏的配置：先把原始内容隔离到插件数据目录，再从默认值重建。
     * 隔离失败时保持现状（不写任何东西），避免在无法留证的情况下抹掉原文。
     */
    async repair() {
      return withWriteLock(async () => {
        if (!storageCorrupt) {
          return {
            repaired: false,
            file: "",
            reason: storageReadFailed
              ? "读取插件配置失败，尚未确认配置内容是否损坏：本次未执行修复，请稍后重试"
              : "配置可以正常解析，无需修复",
          };
        }
        if (!quarantineDir) {
          const error = new Error("插件数据目录不可用，无法隔离损坏的配置内容，修复已取消");
          error.code = "WRITE_FAILED";
          throw error;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const file = join(quarantineDir, `purgeConfig-${stamp}.json`);
        try {
          await mkdir(quarantineDir, { recursive: true });
          await writeFile(file, corruptText, "utf8");
        } catch (error) {
          const failure = new Error(
            `无法把损坏的配置内容另存到插件数据目录（${error?.message || error}）：修复已取消，原始内容保持不变`
          );
          failure.code = "WRITE_FAILED";
          throw failure;
        }
        const next = normalizeConfig(DEFAULTS);
        await storage.setJson(STORAGE_KEY, next);
        storageCorrupt = false;
        corruptText = "";
        storageReadFailed = false;
        readRetryAt = 0;
        current = next;
        loaded = Promise.resolve(current);
        try {
          onChange?.(next);
        } catch (error) {
          log(`应用配置回调失败：${error?.message || error}`);
        }
        return { repaired: true, file, reason: "" };
      });
    },

    /** 浅合并 + 各分区深合并；未传的字段保持原值。 */
    async save(patch) {
      return withWriteLock(async () => {
        await ensureWritable();
        assertPatchedTextLength(patch);
        const next = normalizeConfig({
          ...current,
          ...patch,
          prompt: { ...current.prompt, ...(patch?.prompt || {}) },
          role: { ...current.role, ...(patch?.role || {}) },
          proxy: {
            ...current.proxy,
            ...(patch?.proxy || {}),
            providers: { ...current.proxy.providers, ...(patch?.proxy?.providers || {}) },
          },
          approval: { ...current.approval, ...(patch?.approval || {}) },
        });
        return persist(next);
      });
    },

    /** 记录「这次真正落地了什么」：撤回时只撤这些。 */
    async setApplied(applied) {
      return withWriteLock(async () => {
        await ensureWritable();
        return persist(normalizeConfig({ ...current, applied }));
      });
    },

    async addPreset(preset) {
      return withWriteLock(async () => {
        await ensureWritable();
        const presets = [
          ...current.presets.filter((item) => item.id !== preset.id),
          { ...preset, id: preset.id || `p${Date.now().toString(36)}` },
        ];
        return persist(normalizeConfig({ ...current, presets: presets.slice(-LIMITS.presetCountMax) }));
      });
    },

    async removePreset(id) {
      return withWriteLock(async () => {
        await ensureWritable();
        return persist(
          normalizeConfig({ ...current, presets: current.presets.filter((item) => item.id !== id) })
        );
      });
    },
  };
}
