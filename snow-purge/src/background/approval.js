// 免审批工具清单：只负责「我们额外加进去的那些」，读取时与宿主现有清单合并。
// 敏感命令规则只读展示，插件不代为批准任何授权。
import { PurgeError } from "./errors.js";

const asList = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);

/**
 * 宿主逐字段用 safe() 包住采集，单个字段读取失败时该字段是 null 而不是抛出：
 * 此时 denied 仍为空，空数组与「真实空清单」在值上无法区分。写入动作是整表替换，
 * 一旦把「读不到」当成「清单为空」，用户自己授权的工具会被静默清空，因此必须显式标记。
 */
const hasField = (value, key) => Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);

export function createApprovalManager({ write, metadata, log = () => {} }) {
  const callWrite = async (action, params) => {
    const result = await write.run(action, params);
    if (result?.ok) return result.data;
    const reason = result?.denied?.reason ? `（${result.denied.reason}${result.denied.scope ? `: ${result.denied.scope}` : ""}）` : "";
    throw new PurgeError("WRITE_FAILED", `${action} 失败：${result?.error || "未知原因"}${reason}`);
  };

  return {
    async read(projectId = "") {
      // 宿主对缺省或空白的 projectId 会回落到当前活动项目（metadata 域的 projectId(ctx)），
      // 那份清单与本次调用无关：只在拿到非空项目标识时才请求，也不采信回落值。
      const id = typeof projectId === "string" ? projectId.trim() : "";
      try {
        const response = await metadata.get("permissions", {
          params: id ? { projectId: id } : undefined,
        });
        const domains = response?.domains;
        const value = domains?.permissions;
        // 只有字段确实是数组才算读取成功：[] 是合法空清单，null / 缺失 / 其它类型都算未知。
        const globalKnown = hasField(domains, "permissions") && Array.isArray(value?.alwaysApprovedTools);
        // 未指定项目时一律视为「没有请求项目清单」：projectKnown 为假，projectTools 是占位空数组。
        const projectKnown = Boolean(id) && Array.isArray(value?.projectApprovedTools);
        return {
          globalTools: globalKnown ? value.alwaysApprovedTools.filter((item) => typeof item === "string") : [],
          projectTools: projectKnown ? asList(value?.projectApprovedTools) : [],
          readonlyTools: asList(value?.readonlyTools),
          sensitiveCommands: Array.isArray(value?.sensitiveCommands) ? value.sensitiveCommands : [],
          globalKnown,
          projectKnown,
          projectId: id,
          unknown: !globalKnown,
          denied: response?.denied?.permissions || null,
        };
      } catch (error) {
        log(`读取免审批清单失败：${error?.message || error}`);
        return {
          globalTools: [],
          projectTools: [],
          readonlyTools: [],
          sensitiveCommands: [],
          globalKnown: false,
          projectKnown: false,
          projectId: id,
          unknown: true,
          denied: { reason: String(error?.message || error) },
        };
      }
    },

    async setGlobal(tools) {
      const list = asList(tools);
      // 宿主写动作 toolApproval.setGlobal 要求非空数组：空清单只能由用户在宿主设置里清空。
      if (list.length === 0) {
        throw new PurgeError(
          "INVALID_PARAM",
          "宿主的写入动作不接受空的免审批清单，请在 Snow App 设置的权限页手工清空"
        );
      }
      return callWrite("toolApproval.setGlobal", { tools: list });
    },

    async setProjectMany(projectId, toolNames, approved) {
      if (!projectId) throw new PurgeError("INVALID_PARAM", "缺少项目目录标识");
      return callWrite("toolApproval.setProjectMany", {
        projectId,
        toolNames: asList(toolNames),
        approved: approved !== false,
      });
    },
  };
}
