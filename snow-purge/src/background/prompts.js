// 系统提示词与全局角色规则：读写都经宿主写动作/元数据，插件只维护自己的那一条与托管标记段。
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  MANAGED_PROMPT_ID,
  ROLE_BEGIN,
  ROLE_END,
  defuseManagedMarker,
  findMarkerLines,
  joinOutsideManagedSection,
} from "../shared/contract.js";
import { PurgeError } from "./errors.js";

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** 宿主 personalization 域固定返回的全局角色文件：~/.snow/ROLE.md。 */
const globalRoleFile = () => join(homedir(), ".snow", "ROLE.md");

/**
 * 只允许删除宿主的全局 ROLE 文件。
 * resolve 先归一「..」、重复分隔符与两种分隔符混用；relative 在 Windows 下忽略大小写，
 * 在 POSIX 下严格区分，因此不需要按平台分支，也不能用 basename 或 startsWith 代替。
 */
const isGlobalRoleFile = (target) => Boolean(target) && relative(resolve(globalRoleFile()), target) === "";

/**
 * 角色规则文件里的托管段：标记外内容原样保留。
 * 正文里出现标记字面量会破坏段边界，内联前先把连续尖括号拆开。
 */
export const composeRoleBlock = (text) =>
  `${ROLE_BEGIN}\n${defuseManagedMarker(text, [ROLE_BEGIN, ROLE_END]).trim()}\n${ROLE_END}`;

/**
 * 托管段配对：每个结束标记配它前面最近的、尚未被上一段占用的开始标记。
 * 只取第一个结束标记会留下上一代托管段（应用是在末尾追加新段，文件里会长期保留两段）；
 * 取最后一个结束标记则会把两段之间的用户内容一并删掉。缺另一半的孤立标记不参与配对：
 * 宁可留一行标记，也不删除标记之外的正文。
 */
const findManagedSections = (source) => {
  const begins = findMarkerLines(source, ROLE_BEGIN);
  const ends = findMarkerLines(source, ROLE_END);
  const sections = [];
  let cursor = -1;
  for (const end of ends) {
    if (end <= cursor) continue;
    let start = -1;
    for (let index = begins.length - 1; index >= 0; index -= 1) {
      const begin = begins[index];
      if (begin > cursor && begin < end) {
        start = begin;
        break;
      }
    }
    if (start < 0) continue;
    sections.push([start, end + ROLE_END.length]);
    cursor = end + ROLE_END.length;
  }
  return sections;
};

/**
 * 剥离托管段：起止都要求标记独占一行，正文里内联出现的标记不参与配对。
 * 只清理接缝两侧的空行，标记外的格式（含代码块里的连续空行）逐字保留。
 */
export const stripRoleBlock = (content) => {
  const source = String(content || "");
  const sections = findManagedSections(source);
  if (sections.length === 0) return source;
  // 从后往前删：后面的删除不会影响前面区间的下标。
  let text = source;
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const [start, end] = sections[index];
    text = joinOutsideManagedSection(text.slice(0, start), text.slice(end), text);
  }
  return text;
};

/**
 * readRole 的结果是否可信：读不到确切原文时，调用方不能把空内容当成「文件里没有托管段」，
 * 更不能整份写回。应用、撤回与单独还原共用这一口径。
 */
export const roleUnreadable = (role) =>
  role?.denied
    ? `读不到全局 ROLE 文件：${role.denied.reason || "未知原因"}`
    : !role?.filePath
      ? "宿主没有返回全局 ROLE 文件路径，无法确认读到的是哪份文件"
      : "";

/**
 * 清空全局 ROLE 文件：宿主的 personalization.saveRole 写动作拒绝空 content，
 * 因此「文件里只剩托管段」时改为删除文件 —— 与代理脚本只剩说明头时的处理一致。
 * 只认宿主返回的全局 ROLE 路径，且必须是 ROLE.md，避免误删项目级或其它文件。
 */
const removeRoleFile = async (filePath) => {
  const raw = typeof filePath === "string" ? filePath.trim() : "";
  if (!raw) {
    throw new PurgeError(
      "WRITE_FAILED",
      "读不到全局 ROLE 文件的路径，无法清空：请在宿主「个性化」设置里手工清空"
    );
  }
  const target = resolve(raw);
  // 删除不可恢复：只认宿主全局 ROLE 文件这一个绝对路径，文件名校验会放行任意同名文件。
  if (!isGlobalRoleFile(target)) {
    throw new PurgeError(
      "ROLE_PATH_MISMATCH",
      `宿主返回的角色文件不是全局 ROLE 文件（${target}），已拒绝删除：请在宿主「个性化」设置里手工清空该文件`
    );
  }
  await rm(target, { force: true });
  return { content: "", removed: true, path: target };
};

export function createPromptManager({ write, metadata, log = () => {} }) {
  const callWrite = async (action, params) => {
    const result = await write.run(action, params);
    if (result?.ok) return result.data;
    const reason = result?.denied?.reason ? `（${result.denied.reason}${result.denied.scope ? `: ${result.denied.scope}` : ""}）` : "";
    throw new PurgeError("WRITE_FAILED", `${action} 失败：${result?.error || "未知原因"}${reason}`);
  };

  return {
    async readPrompts() {
      try {
        const response = await metadata.get("systemPrompts");
        const list = response?.domains?.systemPrompts;
        return {
          prompts: Array.isArray(list) ? list : null,
          denied: response?.denied?.systemPrompts || null,
        };
      } catch (error) {
        log(`读取系统提示词失败：${error?.message || error}`);
        return { prompts: null, denied: { reason: String(error?.message || error) } };
      }
    },

    async readRole() {
      try {
        const response = await metadata.get("personalization");
        const value = response?.domains?.personalization;
        return {
          content: typeof value?.content === "string" ? value.content : "",
          filePath: typeof value?.filePath === "string" ? value.filePath : "",
          denied: response?.denied?.personalization || null,
        };
      } catch (error) {
        log(`读取全局角色规则失败：${error?.message || error}`);
        return { content: "", filePath: "", denied: { reason: String(error?.message || error) } };
      }
    },

    async upsertPrompt({ promptId, name, content, isActive, sortOrder = 100 }) {
      if (!isRecord({ promptId }) || !promptId) throw new PurgeError("INVALID_PARAM", "提示词条目缺少 id");
      return callWrite("systemPrompts.upsert", {
        item: {
          promptId,
          name: String(name || "").slice(0, 80),
          content: String(content || ""),
          isActive: isActive !== false,
          sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 100,
          scope: "global",
        },
      });
    },

    async removePrompt(promptId) {
      if (promptId !== MANAGED_PROMPT_ID) {
        throw new PurgeError("INVALID_PARAM", "只能删除本插件托管的那条提示词");
      }
      return callWrite("systemPrompts.remove", { promptId });
    },

    /**
     * 写入全局角色规则。宿主写动作不接受空 content，空内容改为删除 ROLE 文件。
     * 返回 { removed } 供调用方区分「已移除托管段」与「已删除文件」。
     */
    async saveRole(content, filePath = "") {
      const text = String(content ?? "");
      if (text.trim()) {
        await callWrite("personalization.saveRole", { content: text });
        return { content: text, removed: false, path: filePath };
      }
      return removeRoleFile(filePath);
    },
  };
}
