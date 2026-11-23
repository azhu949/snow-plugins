// 应用与撤回：每一步独立结算，某一层失败不影响其它层；撤回只撤本插件标记过的东西。
import { createHash } from "node:crypto";
import { MANAGED_PROMPT_ID, MANAGED_PROMPT_NAME, ROLE_BEGIN } from "../shared/contract.js";
import {
  analyzeProxyText,
  applyProxyBlock,
  composeBlock,
  readProxyFile,
  restoreProxyBlock,
} from "./proxy.js";
import { composeRoleBlock, roleUnreadable, stripRoleBlock } from "./prompts.js";
import { hasAppliedLayers } from "./settings.js";

const unique = (list) => [...new Set(list)];

const sha256 = (text) => createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");

const stepResult = (step, ok, message, extra = {}) => ({ step, ok, message, ...extra });

/**
 * 只在第一次落地前快照，避免每次应用都堆一份。
 * 返回 { id, skipped, bytes, limit }：id 为空时 skipped 说明原因（关闭 / 超限 / 写入失败）。
 */
const snapshotOnce = async ({
  backups,
  appliedKey,
  applied,
  kind,
  reason,
  payload,
  enabled = true,
  log = () => {},
}) => {
  // 只有该层当前仍处于已应用状态时才复用快照：还原/回滚后层标记已清，
  // 再次应用必须重新快照，否则撤回会拿上一次应用前的原文比对。
  const layerApplied =
    appliedKey === "prompt"
      ? applied?.prompt === true
      : appliedKey === "role"
        ? applied?.roleBlock === true
        : appliedKey === "proxy"
          ? Boolean(applied?.proxyHash)
          : appliedKey === "approval"
            ? (Array.isArray(applied?.globalTools) && applied.globalTools.length > 0) ||
              Object.keys(applied?.projectApprovals || {}).length > 0
            : true;
  const existing = layerApplied ? applied?.backups?.[appliedKey] : "";
  if (existing) return { id: existing, skipped: "", bytes: 0, limit: 0 };
  if (!enabled) {
    log(`按设置跳过应用前快照：${kind}`);
    return { id: "", skipped: "DISABLED", bytes: 0, limit: 0 };
  }
  const meta = await backups.create({ kind, reason, payload });
  const id = typeof meta?.id === "string" ? meta.id : "";
  return {
    id,
    skipped: typeof meta?.skipped === "string" && meta.skipped ? meta.skipped : id ? "" : "BACKUP_FAILED",
    bytes: Number(meta?.bytes) || 0,
    limit: Number(meta?.limit) || 0,
  };
};

/** 快照没建成时，把原因写进该层的步骤结果，面板与审计都能看到。 */
const snapshotNote = (snapshot) => {
  if (!snapshot?.skipped) return "";
  if (snapshot.skipped === "DISABLED") return "（未快照：应用前自动快照已关闭）";
  if (snapshot.skipped === "PAYLOAD_TOO_LARGE") {
    return `（未快照：原文约 ${Math.ceil(snapshot.bytes / 1024)} KB，超过 ${Math.ceil(snapshot.limit / 1024)} KB 上限）`;
  }
  return "（未快照：写入备份失败）";
};

export async function applyAll({
  config,
  prompts,
  approval,
  backups,
  proxyPath,
  probePath,
  audit,
  log = () => {},
  forceProxy = false,
  revertWhenDisabled = true,
}) {
  const steps = [];
  // 只有真正写入宿主的层才置真：四层全关或全部失败时不能制造一条「已应用」的空记账。
  let wrote = false;
  if (!config.enabled) {
    // 单层保存（提示词 / 角色 / 代理）在总开关关闭时只保存配置：不能顺手撤回其它页的托管层。
    if (!revertWhenDisabled) {
      return { steps, applied: config.applied ?? null, config, mode: "saved" };
    }
    // 顶部「应用」在总开关关闭时仍执行撤回：把真实动作带回去，面板不能报「已应用」。
    const result = await revertAll({ config, prompts, approval, backups, proxyPath, audit, log });
    return { ...result, mode: "revert" };
  }
  // 关闭「应用前自动快照」时跳过备份：撤回会退化为只剥离托管段。
  const autoSnapshot = config.autoSnapshot !== false;

  const applied = {
    at: 0,
    prompt: false,
    roleBlock: false,
    proxyHash: "",
    globalTools: [],
    ...(config.applied || {}),
    // 项目级记账按项目分开存：切换项目后旧项目仍能被撤下。
    projectApprovals: { ...(config.applied?.projectApprovals || {}) },
    backups: { proxy: "", role: "", prompt: "", approval: "", ...(config.applied?.backups || {}) },
  };

  // 1) 系统提示词
  if (config.prompt.enabled) {
    try {
      const state = await prompts.readPrompts();
      if (!state.prompts) {
        steps.push(stepResult("prompt", false, "读不到系统提示词条目，跳过写入"));
      } else {
        const existing = state.prompts.find((entry) => entry?.promptId === MANAGED_PROMPT_ID);
        if (existing && !applied.prompt && existing.name !== config.prompt.name) {
          steps.push(
            stepResult("prompt", false, `promptId ${MANAGED_PROMPT_ID} 已被另一条提示词占用（${existing.name}），未覆盖`)
          );
        } else {
          const snapshot = await snapshotOnce({
            backups,
            appliedKey: "prompt",
            applied,
            kind: "prompt",
            reason: "应用托管提示词前",
            payload: { promptId: MANAGED_PROMPT_ID, item: existing || null },
            enabled: autoSnapshot,
            log,
          });
          applied.backups.prompt = snapshot.id;
          await prompts.upsertPrompt({
            promptId: MANAGED_PROMPT_ID,
            name: config.prompt.name || MANAGED_PROMPT_NAME,
            content: config.prompt.content,
            isActive: config.prompt.isActive,
            sortOrder: existing?.sortOrder ?? 100,
          });
          applied.prompt = true;
          wrote = true;
          steps.push(stepResult("prompt", true, `已写入提示词条目 ${MANAGED_PROMPT_ID}${snapshotNote(snapshot)}`, { snapshot }));
        }
      }
    } catch (error) {
      steps.push(stepResult("prompt", false, String(error?.message || error)));
    }
  }

  // 2) 全局角色规则（保留标记外的用户内容）
  if (config.role.enabled) {
    try {
      const role = await prompts.readRole();
      // 读不到确切原文时绝不写入：空内容一旦被当成原文，托管段会顶掉整份文件且无从还原。
      const unreadable = roleUnreadable(role);
      if (unreadable) {
        steps.push(stepResult("role", false, unreadable));
      } else {
        const snapshot = await snapshotOnce({
          backups,
          appliedKey: "role",
          applied,
          kind: "role",
          reason: "应用托管角色规则前",
          payload: {
            content: role.content,
            filePath: role.filePath,
            chars: role.content.length,
            hash: sha256(role.content),
          },
          enabled: autoSnapshot,
          log,
        });
        applied.backups.role = snapshot.id;
        // 写入前再读一次：内容变了说明这次读取不可信（或被并发改写），本层让位。
        const verify = await prompts.readRole();
        if (!verify.filePath || verify.content !== role.content) {
          steps.push(stepResult("role", false, "重新读取全局 ROLE 文件失败或内容已变化，已跳过写入"));
        } else {
          const base = stripRoleBlock(role.content);
          const next = base
            ? `${base}\n\n${composeRoleBlock(config.role.content)}`
            : composeRoleBlock(config.role.content);
          await prompts.saveRole(next);
          applied.roleBlock = true;
          wrote = true;
          steps.push(stepResult("role", true, `已写入全局角色规则的托管段${snapshotNote(snapshot)}`, { snapshot }));
        }
      }
    } catch (error) {
      steps.push(stepResult("role", false, String(error?.message || error)));
    }
  }

  // 3) 请求代理脚本
  if (config.proxy.enabled) {
    try {
      const current = await readProxyFile(proxyPath);
      const snapshot = await snapshotOnce({
        backups,
        appliedKey: "proxy",
        applied,
        kind: "proxy",
        reason: "应用代理托管段前",
        payload: { content: current },
        enabled: autoSnapshot,
        log,
      });
      applied.backups.proxy = snapshot.id;
      const block = composeBlock({
        directive: config.proxy.directive,
        boost: config.proxy.boost,
        providers: config.proxy.providers,
        probeLogPath: probePath,
      });
      const result = await applyProxyBlock({
        filePath: proxyPath,
        block,
        appliedHash: applied.proxyHash,
        force: forceProxy === true,
      });
      applied.proxyHash = result.hash;
      wrote = true;
      steps.push(
        stepResult(
          "proxy",
          true,
          `${
            result.created ? "已新建代理脚本并写入托管段" : result.replaced ? "已更新托管段" : "已追加托管段（原有内容保留）"
          }${result.cleaned ? `，并清理了 ${result.cleaned} 个重复托管段` : ""}${
            result.cleanedResidues ? `，并清理了 ${result.cleanedResidues} 处插件残骸` : ""
          }${snapshotNote(snapshot)}`,
          { path: result.path, snapshot }
        )
      );
    } catch (error) {
      steps.push(stepResult("proxy", false, String(error?.message || error), { code: error?.code || "" }));
    }
  }

  // 4) 免审批清单（历史托管层）：面板没有该层开关，设置接口也不接受 approval 字段，
  //    正常路径下 config.approval.enabled 恒为 false；本段只为已存在的手工/旧版配置保留。
  if (config.approval.enabled) {
    try {
      const current = await approval.read(config.approval.projectId);
      // 宿主逐字段吞掉采集异常时字段为 null：此时清单不是「空」，而是「读不到」。
      // 写入是整表替换，必须拒绝，否则用户已有授权会被静默清空。
      // 未填项目目录时 approval.read 不会请求项目清单，projectKnown 必然为假：
      // 只有「配了项目却读不到」才应阻断整层。
      const projectUnreadable = Boolean(config.approval.projectId) && !current.projectKnown;
      const unreadable = current.denied
        ? `读不到权限清单：${current.denied.reason || "未知原因"}`
        : current.unknown
          ? "宿主返回的全局免审批清单不可读（字段为空或类型异常），已跳过写入以免覆盖既有授权"
          : projectUnreadable
            ? "宿主返回的项目免审批清单不可读，已跳过写入"
            : "";
      if (unreadable) {
        steps.push(stepResult("approval", false, unreadable));
      } else {
        const snapshot = await snapshotOnce({
          backups,
          appliedKey: "approval",
          applied,
          kind: "approval",
          reason: "应用免审批清单前",
          payload: {
            globalTools: current.globalTools,
            projectTools: current.projectTools,
            projectId: config.approval.projectId,
          },
          enabled: autoSnapshot,
          log,
        });
        applied.backups.approval = snapshot.id;

        const addedGlobal = config.approval.tools.filter((tool) => !current.globalTools.includes(tool));
        const globalTools = unique([...current.globalTools, ...addedGlobal]);
        if (globalTools.length !== current.globalTools.length) {
          await approval.setGlobal(globalTools);
          wrote = true;
        }
        applied.globalTools = unique([...applied.globalTools, ...addedGlobal]);

        const projectAdded = config.approval.projectTools.filter(
          (tool) => !current.projectTools.includes(tool)
        );
        if (config.approval.projectId && projectAdded.length > 0) {
          const projectId = config.approval.projectId;
          await approval.setProjectMany(projectId, projectAdded, true);
          wrote = true;
          applied.projectApprovals = {
            ...applied.projectApprovals,
            [projectId]: unique([...(applied.projectApprovals?.[projectId] || []), ...projectAdded]),
          };
        }
        steps.push(
          stepResult(
            "approval",
            true,
            `全局新增 ${addedGlobal.length} 个、项目新增 ${projectAdded.length} 个免审批工具${snapshotNote(snapshot)}`,
            { snapshot }
          )
        );
      }
    } catch (error) {
      steps.push(stepResult("approval", false, String(error?.message || error)));
    }
  }

  // 只有真正写入宿主的层才刷新「上次应用」；四层全关或全部失败时不制造一条空记账。
  if (wrote) applied.at = Date.now();
  // 记账里没有任何层时写 null：撤回据此先做残留探测，而不是直接报「已撤回」。
  const hasLayers = hasAppliedLayers(applied);
  await audit.record({
    action: "apply",
    ok: steps.length === 0 || steps.every((step) => step.ok),
    detail: steps.length
      ? steps.map((step) => `${step.step}:${step.ok ? "ok" : "fail"}`).join(" ")
      : "noop 未启用任何托管层，本次未写入宿主",
  });

  // 没有任何层参与时返回独立 mode：面板不能把「什么都没做」报成「已应用」，与审计共用同一口径。
  return { steps, applied: hasLayers ? applied : null, config, mode: steps.length > 0 ? "apply" : "noop" };
}

/**
 * 记账丢失时的残留探测：只看宿主里仍然可见的标记，不猜测应用前的原值。
 * 口径与自检一致（提示词条目 id、ROLE 标记、代理托管段）。
 */
const detectResidual = async ({ config, prompts, proxyPath, audit }) => {
  const items = [];
  try {
    const state = await prompts.readPrompts();
    const list = Array.isArray(state.prompts) ? state.prompts : null;
    items.push({
      id: "prompt",
      label: "系统提示词托管条目",
      status: list ? (list.some((entry) => entry?.promptId === MANAGED_PROMPT_ID) ? "found" : "none") : "unknown",
    });
  } catch {
    items.push({ id: "prompt", label: "系统提示词托管条目", status: "unknown" });
  }
  try {
    const role = await prompts.readRole();
    items.push({
      id: "role",
      label: "角色文件托管段",
      status: role.denied ? "unknown" : String(role.content || "").includes(ROLE_BEGIN) ? "found" : "none",
    });
  } catch {
    items.push({ id: "role", label: "角色文件托管段", status: "unknown" });
  }
  try {
    const text = await readProxyFile(proxyPath);
    const analysis = text === null ? null : analyzeProxyText(text);
    items.push({
      id: "proxy",
      label: "代理脚本托管段",
      status:
        text === null
          ? "none"
          : analysis.hasBlock || analysis.hasManagedResidue
            ? "found"
            : "none",
    });
  } catch {
    items.push({ id: "proxy", label: "代理脚本托管段", status: "unknown" });
  }
  // 免审批清单在宿主里没有托管标记，探测不出「插件新增过哪些」：只有撤回记账里确实有
  // 新增项时才提示人工核对。记账丢失后宿主清单本身无法区分，不能凭配置开关虚构提示；
  // 但审计里留有面板授权记录时应当提示核对，否则旧版本写入的授权会静默漏撤。
  const trackedApprovals =
    (Array.isArray(config?.applied?.globalTools) ? config.applied.globalTools.length : 0) +
    Object.values(config?.applied?.projectApprovals || {}).reduce(
      (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
      0
    );
  if (trackedApprovals > 0) {
    items.push({ id: "approval", label: "免审批清单", status: "unknown" });
  } else if (audit) {
    try {
      const history = await audit.list(200);
      const wrote = (Array.isArray(history) ? history : []).some(
        (entry) => entry?.action === "approval.global" || entry?.action === "approval.project"
      );
      if (wrote) items.push({ id: "approval", label: "免审批清单", status: "unknown" });
    } catch {
      // 审计不可读时不额外提示。
    }
  }
  return items;
};

export async function revertAll({ config, prompts, approval, backups, proxyPath, audit, log = () => {} }) {
  const applied = config.applied;
  const steps = [];

  /**
   * 没有可撤层时的统一收尾：探测宿主里是否仍有残留。
   * 记账丢失与「记账里没有任何层」必须同一口径，否则第一次会报「已撤回」，第二次才提示残留。
   */
  const reportResidual = async ({ tracked }) => {
    const residual = await detectResidual({ config, prompts, proxyPath, audit });
    const found = residual.filter((item) => item.status === "found");
    // 免审批清单没有托管标记：记账丢失时只能提示人工核对，不能据此把撤回判成失败。
    const approvalOnly = residual.find((item) => item.id === "approval" && item.status === "unknown") || null;
    const unknown = residual.filter((item) => item.status === "unknown" && item.id !== "approval");
    if (found.length === 0 && unknown.length === 0) {
      steps.push(
        stepResult(
          "revert",
          true,
          approvalOnly
            ? "没有需要撤回的托管内容；免审批清单没有撤回记账，如曾通过本面板授权，请到宿主权限页核对是否已撤下"
            : "没有需要撤回的内容",
          approvalOnly ? { advisory: true } : {}
        )
      );
      await audit.record({ action: "revert", ok: true, detail: tracked ? "nothing-tracked" : "no-record-none" });
      return { steps, applied: null, config };
    }
    // 无法确定应用前的原值，只报残留与逐层入口，不假装已经撤回。
    const detail = [
      found.length ? `检测到残留：${found.map((item) => item.label).join("、")}` : "",
      unknown.length ? `无法判定：${unknown.map((item) => item.label).join("、")}` : "",
    ]
      .filter(Boolean)
      .join("；");
    const approvalHint = approvalOnly ? "；免审批清单请到宿主权限页核对" : "";
    const head = tracked
      ? `记账里没有记录任何已应用的层，但宿主里仍有内容（${detail}）`
      : `撤回记账已丢失（${detail}）`;
    steps.push(
      stepResult(
        "revert",
        false,
        `${head}。逐层还原：在「提示词」页点「删除托管条目」与「还原角色文件」，在「请求代理」页点「还原脚本」${approvalHint}`
      )
    );
    await audit.record({
      action: "revert",
      ok: false,
      detail: `${tracked ? "no-layer" : "no-record"} ${found.map((item) => item.id).join(",") || "unknown"}`,
    });
    return { steps, applied: null, config };
  };

  if (!applied) {
    return reportResidual({ tracked: false });
  }

  const backupOf = async (id) => (id ? backups.read(id) : null);
  // 摘要不一致的快照不能当「应用前原值」：与备份页 BACKUP_TAMPERED 同口径，按无快照处理。
  const snapshotTampered = (snapshot) => snapshot?.integrity === "mismatch";

  // 1) 提示词：有原值就还原，没有就删除托管条目
  if (applied.prompt) {
    try {
      const snapshot = await backupOf(applied.backups?.prompt);
      // 摘要不一致的快照不能当原值写回：否则会把被改写的内容覆盖进宿主的提示词库。
      const tampered = snapshotTampered(snapshot);
      const previous = tampered ? null : snapshot?.payload?.item || null;
      if (previous) {
        await prompts.upsertPrompt({
          promptId: previous.promptId,
          name: previous.name,
          content: previous.content,
          isActive: previous.isActive,
          sortOrder: previous.sortOrder,
        });
        steps.push(stepResult("prompt", true, "已还原应用前的提示词条目"));
      } else {
        const state = await prompts.readPrompts();
        // 读不到列表时不能当成「条目不存在」：条目可能仍在宿主里生效，记账一清就失去再次撤回的依据。
        // 与 server.js 的 promptRemove 同口径：非数组即视为读不到，交给外层 catch 记为该层失败。
        if (!Array.isArray(state.prompts)) {
          throw new Error(
            `读不到宿主提示词库（${state.denied?.reason || "宿主未返回条目"}），无法确认托管条目是否已撤下，撤回记账已保留，可稍后重试`
          );
        }
        const exists = state.prompts.some((entry) => entry?.promptId === MANAGED_PROMPT_ID);
        if (exists) await prompts.removePrompt(MANAGED_PROMPT_ID);
        steps.push(
          stepResult(
            "prompt",
            true,
            exists
              ? tampered
                ? "已删除托管提示词条目（应用前快照摘要不一致，未按快照写回）"
                : snapshot
                  ? "已删除托管提示词条目"
                  : "已删除托管提示词条目（没有应用前快照，原值未保存）"
              : "托管提示词条目已不存在",
            tampered ? { advisory: true } : {}
          )
        );
      }
    } catch (error) {
      steps.push(stepResult("prompt", false, String(error?.message || error)));
    }
  }

  // 2) 角色规则：只移除托管段，不整份覆盖。
  // 应用前快照是「应用前原文」，应用之后用户可能又在标记外手写了规则：整份写回会静默抹掉
  // 这些改动，与面板承诺的「撤回时只移除托管段」相反。这里以当前文件为准，只剥离本插件写入的段。
  if (applied.roleBlock) {
    try {
      const role = await prompts.readRole();
      // 与 apply 侧同口径：读不到确切原文时不能把空内容当成「文件里没有托管段」。
      const unreadable = roleUnreadable(role);
      if (unreadable) {
        throw new Error(`${unreadable}，角色文件与托管记账都未改动，可稍后重试撤回`);
      }
      const next = stripRoleBlock(role.content);
      const suffix = applied.backups?.role
        ? "（只移除托管段，标记外内容保持当前版本）"
        : "（没有应用前快照，只移除了托管段）";
      if (next === role.content) {
        steps.push(stepResult("role", true, `角色文件里没有托管段${suffix}`));
      } else {
        const result = await prompts.saveRole(next, role.filePath);
        steps.push(
          stepResult(
            "role",
            true,
            `${
              result?.removed ? "角色文件里只有托管段，已删除该文件" : "已移除角色文件里的托管段"
            }${suffix}`
          )
        );
      }
    } catch (error) {
      steps.push(stepResult("role", false, String(error?.message || error)));
    }
  }

  // 3) 代理脚本
  if (applied.proxyHash) {
    try {
      const snapshot = await backupOf(applied.backups?.proxy);
      // 摘要不一致的快照不能作为「应用前原文」写回：与备份页 BACKUP_TAMPERED 同口径，按无快照处理。
      const tampered = snapshotTampered(snapshot);
      // 与 server.js 的 proxyRestore 同口径：先确认 payload 是对象，再用 in 判断字段。
      const hasOriginal = Boolean(
        !tampered && snapshot && snapshot.payload && typeof snapshot.payload === "object" && "content" in snapshot.payload
      );
      const original = hasOriginal ? snapshot.payload.content : null;
      const snapshotDamaged = Boolean(snapshot) && !tampered && !hasOriginal;
      // 撤回前先看文件里到底有没有托管段：三个布尔值全为假时不能把空操作报成「已移除托管段」。
      const before = await readProxyFile(proxyPath);
      const hadBlock = before === null ? false : analyzeProxyText(before).hasBlock;
      const result = await restoreProxyBlock({ filePath: proxyPath, original });
      const stripped = !result.recreated && !result.restored && !result.removed && hadBlock;
      // 原值不可用时说明原因：快照被改写、快照缺字段，或压根没有快照。
      const note = tampered
        ? "应用前快照摘要不一致，已拒绝写回，原文未能逐字还原"
        : snapshotDamaged
          ? "应用前快照缺少内容字段，快照已损坏，原文未能逐字还原"
          : snapshot
            ? ""
            : "没有应用前快照，段外原有内容未逐字保存";
      steps.push(
        stepResult(
          "proxy",
          true,
          result.recreated
            ? "已按应用前快照重建代理脚本"
            : result.restored
              ? "已还原应用前的代理脚本"
              : result.removed
                ? "已删除只含托管段的代理脚本"
                : stripped
                  ? `已移除代理托管段${note ? `（${note}）` : ""}`
                  : result.removedResidues > 0
                    ? `已清理 ${result.removedResidues} 处插件残留（脚本里没有完整的托管段）`
                    : before === null
                      ? "代理脚本不存在，无需还原"
                      : "代理脚本里没有托管段与插件残留，无需还原",
          tampered ? { advisory: true } : {}
        )
      );
    } catch (error) {
      steps.push(stepResult("proxy", false, String(error?.message || error)));
    }
  }

  // 4) 免审批清单：只撤我们新增的；项目级按项目逐个撤，避免切换项目后旧项目残留。
  // 读不到清单时必须报失败：把 denied 当成「清单为空」会让授权继续生效，却显示成撤回成功。
  const projectApprovals = applied.projectApprovals || {};
  const projectIds = Object.keys(projectApprovals);
  if (applied.globalTools?.length || projectIds.length > 0) {
    let failed = 0;
    let removedGlobal = 0;
    let removedProject = 0;
    let missingGlobal = 0;
    let missingProject = 0;
    if (applied.globalTools?.length) {
      try {
        const current = await approval.read("");
        if (current.denied || current.unknown) {
          failed += 1;
          const reason = current.denied?.reason || "宿主返回的清单字段为空或类型异常";
          steps.push(
            stepResult(
              "approval",
              false,
              `读不到全局免审批清单（${reason}），无法确认插件新增的 ${applied.globalTools.length} 个工具已撤下，清单未改动`
            )
          );
        } else {
          const present = applied.globalTools.filter((tool) => current.globalTools.includes(tool));
          missingGlobal += applied.globalTools.length - present.length;
          if (present.length > 0) {
            const next = current.globalTools.filter((tool) => !applied.globalTools.includes(tool));
            if (next.length === 0) {
              // 宿主的写入动作不接受空数组：撤到空只能由用户在宿主设置里完成，这里如实报失败。
              failed += 1;
              steps.push(
                stepResult(
                  "approval",
                  false,
                  `全局清单撤到空需要到宿主设置的权限页手工清空，插件无法代为清空（${present.length} 个工具仍保留）`
                )
              );
            } else {
              await approval.setGlobal(next);
              removedGlobal += present.length;
            }
          }
        }
      } catch (error) {
        failed += 1;
        steps.push(stepResult("approval", false, `全局清单撤回失败：${String(error?.message || error)}`));
      }
    }
    for (const projectId of projectIds) {
      const tracked = projectApprovals[projectId] || [];
      try {
        const current = await approval.read(projectId);
        if (current.denied || !current.projectKnown) {
          failed += 1;
          const reason = current.denied?.reason || "宿主返回的项目清单字段为空或类型异常";
          steps.push(
            stepResult(
              "approval",
              false,
              `读不到项目 ${projectId} 的免审批清单（${reason}），无法确认插件新增的工具已撤下，该项目清单未改动`
            )
          );
          continue;
        }
        const keep = tracked.filter((tool) => current.projectTools.includes(tool));
        missingProject += tracked.length - keep.length;
        if (keep.length > 0) {
          await approval.setProjectMany(projectId, keep, false);
          removedProject += keep.length;
        }
      } catch (error) {
        failed += 1;
        steps.push(
          stepResult("approval", false, `项目 ${projectId} 撤回失败：${String(error?.message || error)}`)
        );
      }
    }
    if (failed === 0) {
      const removed = removedGlobal + removedProject;
      const missing = missingGlobal + missingProject;
      const head = removed > 0 ? `已从清单撤下 ${removed} 个工具` : "清单里已没有插件新增的工具";
      const parts = [];
      if (removedGlobal > 0) parts.push(`全局 ${removedGlobal} 个`);
      if (removedProject > 0) parts.push(`项目 ${removedProject} 个`);
      const tail = missing > 0 ? `；${missing} 个已不在清单中，无需撤下` : "";
      steps.push(stepResult("approval", true, `${head}${parts.length ? `（${parts.join("、")}）` : ""}${tail}`));
    }
  }

  // 记账存在但没有任何层可撤（四层全关或上次全部失败）：同样先探测宿主里的残留，
  // 否则会把「其实还有内容」报成「已撤回」。
  if (steps.length === 0) return reportResidual({ tracked: true });

  await audit.record({
    action: "revert",
    ok: steps.every((step) => step.ok),
    detail: steps.map((step) => `${step.step}:${step.ok ? "ok" : "fail"}`).join(" "),
  });

  // 失败层原样留在记账里：面板再点一次「撤回」就是重试，不会显示成「没有需要撤回的内容」。
  const failedLayers = new Set(steps.filter((step) => !step.ok).map((step) => step.step));
  if (failedLayers.size === 0) return { steps, applied: null, config };
  const approvalFailed = failedLayers.has("approval");
  const residual = {
    ...applied,
    prompt: failedLayers.has("prompt"),
    roleBlock: failedLayers.has("role"),
    proxyHash: failedLayers.has("proxy") ? applied.proxyHash : "",
    globalTools: approvalFailed ? applied.globalTools : [],
    projectApprovals: approvalFailed ? { ...(applied.projectApprovals || {}) } : {},
    backups: { proxy: "", role: "", prompt: "", approval: "", ...(applied.backups || {}) },
  };
  return { steps, applied: residual, config };
}
