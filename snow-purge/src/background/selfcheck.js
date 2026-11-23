// 分层自检：每一项都给出证据（文件路径、哈希、条目 id、时间），不靠「应该生效了」。
import { MANAGED_PROMPT_ID, ROLE_BEGIN } from "../shared/contract.js";
import { analyzeProxyText, readProbeLog, readProxyFile } from "./proxy.js";

const OUTCOME = { ok: "ok", warn: "warn", fail: "fail", off: "off" };

const item = (id, title, status, detail, evidence = "") => ({ id, title, status, detail, evidence });

const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

export async function runSelfcheck({
  config,
  prompts,
  approval,
  proxyPath,
  probePath,
  server,
}) {
  const items = [];

  const startedAt = server?.startedAt || 0;
  items.push(
    item(
      "channel",
      "后台通道",
      OUTCOME.ok,
      `本地回环服务运行中，端口 ${server?.port ?? "-"}`,
      `pid=${process.pid} uptime=${Math.max(0, Math.round((Date.now() - startedAt) / 1000))}s`
    )
  );

  // 提示词
  const promptState = await prompts.readPrompts();
  if (!config.prompt.enabled) {
    // 关掉开关只是不再维护：条目还在宿主里生效，所以先探测残留再决定是否为 off。
    const promptList = Array.isArray(promptState.prompts) ? promptState.prompts : null;
    const leftover = promptList
      ? promptList.find((entry) => entry?.promptId === MANAGED_PROMPT_ID) || null
      : null;
    if (leftover) {
      const active = leftover.isActive === true;
      items.push(
        item(
          "prompt",
          "系统提示词",
          OUTCOME.warn,
          `托管条目仍留在系统提示词列表里${active ? "并处于启用状态" : "（当前停用）"}：关闭开关不会撤下它，请在「提示词」页点「删除托管条目」`,
          `promptId=${MANAGED_PROMPT_ID} active=${active}`
        )
      );
    } else if (!promptList) {
      items.push(
        item(
          "prompt",
          "系统提示词",
          OUTCOME.warn,
          "未启用托管提示词，但读不到条目列表，无法确认是否残留",
          promptState.denied?.reason || ""
        )
      );
    } else {
      items.push(item("prompt", "系统提示词", OUTCOME.off, "未启用托管提示词，列表里也没有托管条目", ""));
    }
  } else if (!promptState.prompts) {
    items.push(
      item(
        "prompt",
        "系统提示词",
        OUTCOME.fail,
        "读不到系统提示词条目（隐私声明或宿主能力不可用）",
        promptState.denied?.reason || ""
      )
    );
  } else {
    const found = promptState.prompts.find((entry) => entry?.promptId === MANAGED_PROMPT_ID);
    if (!found) {
      items.push(item("prompt", "系统提示词", OUTCOME.fail, "托管条目不存在，尚未应用", `promptId=${MANAGED_PROMPT_ID}`));
    } else if (String(found.content || "").trim() !== config.prompt.content.trim()) {
      items.push(
        item(
          "prompt",
          "系统提示词",
          OUTCOME.warn,
          "条目存在，但内容与面板保存的不一致",
          `promptId=${MANAGED_PROMPT_ID} active=${found.isActive === true}`
        )
      );
    } else {
      const active = found.isActive === true;
      items.push(
        item(
          "prompt",
          "系统提示词",
          active ? OUTCOME.ok : OUTCOME.warn,
          active ? "托管条目已写入并启用" : "托管条目已写入，但处于停用状态，不会生效",
          `promptId=${MANAGED_PROMPT_ID} sortOrder=${found.sortOrder ?? "-"}`
        )
      );
    }
  }

  // 角色规则
  const roleState = await prompts.readRole();
  if (!config.role.enabled) {
    // 关掉开关不会剥掉角色文件里的托管段，这里先探测残留再决定是否为 off。
    if (roleState.denied) {
      items.push(
        item(
          "role",
          "全局角色规则",
          OUTCOME.warn,
          "未启用角色规则托管，但读不到全局 ROLE 文件，无法确认托管段是否残留",
          roleState.denied.reason || ""
        )
      );
    } else if (roleState.content.includes(ROLE_BEGIN)) {
      items.push(
        item(
          "role",
          "全局角色规则",
          OUTCOME.warn,
          "角色文件里仍有托管段：关闭开关不会撤下它，请在「提示词」页点「还原角色文件」",
          roleState.filePath || ""
        )
      );
    } else {
      items.push(item("role", "全局角色规则", OUTCOME.off, "未启用角色规则托管，角色文件里没有托管段", ""));
    }
  } else if (roleState.denied) {
    items.push(item("role", "全局角色规则", OUTCOME.fail, "读不到全局 ROLE 文件", roleState.denied.reason || ""));
  } else {
    const hasBlock = roleState.content.includes(ROLE_BEGIN);
    const matches = hasBlock && roleState.content.includes(config.role.content.trim());
    items.push(
      item(
        "role",
        "全局角色规则",
        matches ? OUTCOME.ok : hasBlock ? OUTCOME.warn : OUTCOME.fail,
        matches
          ? "托管段已写入角色文件，标记外内容保留"
          : hasBlock
            ? "托管段存在，但内容与面板保存的不一致"
            : "角色文件里没有托管段",
        roleState.filePath || ""
      )
    );
  }

  // 请求代理
  let proxyText = null;
  let proxyReadError = "";
  try {
    proxyText = await readProxyFile(proxyPath);
  } catch (error) {
    proxyReadError = String(error?.message || error);
  }
  if (!config.proxy.enabled) {
    // 关掉开关不会移除托管段，注入仍在生效：先探测残留再决定是否为 off。
    if (proxyReadError) {
      items.push(
        item(
          "proxy",
          "请求代理",
          OUTCOME.warn,
          "未启用代理托管，但读不到代理脚本，无法确认托管段是否残留",
          proxyReadError
        )
      );
    } else if (proxyText === null) {
      items.push(item("proxy", "请求代理", OUTCOME.off, "未启用代理托管，代理脚本不存在", proxyPath));
    } else if (analyzeProxyText(proxyText).hasBlock) {
      items.push(
        item(
          "proxy",
          "请求代理",
          OUTCOME.warn,
          "代理脚本里仍有托管段，主进程仍会在每次请求时注入：请在「请求代理」页点「还原脚本」",
          proxyPath
        )
      );
    } else {
      items.push(item("proxy", "请求代理", OUTCOME.off, "未启用代理托管，代理脚本里没有托管段", proxyPath));
    }
  } else if (proxyReadError) {
    items.push(item("proxy", "请求代理", OUTCOME.fail, "读不到代理脚本文件", proxyReadError));
  } else {
    const current = proxyText;
    const analysis = analyzeProxyText(current ?? "");
    const appliedHash = config.applied?.proxyHash || "";
    if (current === null) {
      items.push(item("proxy", "请求代理", OUTCOME.fail, "代理脚本文件不存在", proxyPath));
    } else if (!analysis.hasBlock) {
      items.push(item("proxy", "请求代理", OUTCOME.fail, "脚本里找不到托管段", proxyPath));
    } else if (analysis.segmentCount > 1) {
      items.push(
        item(
          "proxy",
          "请求代理",
          OUTCOME.fail,
          `脚本里有 ${analysis.segmentCount} 个托管段：重复的 import 与 export 会让脚本加载失败，请点「还原脚本」清理后重新应用`,
          proxyPath
        )
      );
    } else if (analysis.hasForeignHook) {
      items.push(
        item("proxy", "请求代理", OUTCOME.fail, "托管段外还有另一个 onRequest 导出，脚本会加载失败", proxyPath)
      );
    } else if (analysis.bindingConflicts.length > 0) {
      items.push(
        item(
          "proxy",
          "请求代理",
          OUTCOME.fail,
          `段外已声明 ${analysis.bindingConflicts.join("、")}，与托管段内的同名绑定冲突，脚本会整体加载失败`,
          `${proxyPath}（重复声明：${analysis.bindingConflicts.join(", ")}）`
        )
      );
    } else if (appliedHash && analysis.blockHash !== appliedHash) {
      items.push(
        item("proxy", "请求代理", OUTCOME.warn, "托管段被改动过，与上次应用记录的哈希不一致", `hash=${analysis.blockHash.slice(0, 12)}`)
      );
    } else {
      items.push(
        item(
          "proxy",
          "请求代理",
          OUTCOME.ok,
          "托管段就位（插件未验证整份脚本可加载），脚本下次请求时热加载",
          `${proxyPath}（${analysis.lines} 行 / ${analysis.bytes} 字节）`
        )
      );
    }
    const probe = await readProbeLog(probePath, 5);
    const last = probe.entries[0];
    if (!last) {
      items.push(
        item("probe", "注入探针", OUTCOME.warn, "还没有记录到经过代理的对话请求", probePath)
      );
    } else {
      const fresh = Date.now() - Number(last.at || 0) < FRESH_MS;
      items.push(
        item(
          "probe",
          "注入探针",
          fresh ? OUTCOME.ok : OUTCOME.warn,
          fresh ? `最近一次探针记录：${last.provider}（${last.mode || "system"}）` : "探针记录已超过 7 天",
          `at=${new Date(Number(last.at) || 0).toLocaleString()} conversation=${last.conversationId || "-"}`
        )
      );
    }
  }

  // 免审批清单：面板直接写宿主清单，托管开关不参与判定。
  // 这里读宿主真实清单，并说明撤回记账里有多少项是本插件新增的。
  const current = await approval.read(config.approval.projectId);
  const trackedGlobal = Array.isArray(config.applied?.globalTools) ? config.applied.globalTools.length : 0;
  const trackedProjects = Object.values(config.applied?.projectApprovals || {}).reduce(
    (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
    0
  );
  const trackedTotal = trackedGlobal + trackedProjects;
  const projectConfigured = Boolean(config.approval.projectId);
  // projectKnown 为假表示「没有请求项目清单」或「读不到」：未填项目目录时属于前者，不是故障。
  const projectUnreadable = projectConfigured && !current.projectKnown;
  const missing = config.approval.tools.filter((tool) => !current.globalTools.includes(tool));
  const missingProject = projectUnreadable
    ? []
    : config.approval.projectTools.filter((tool) => !current.projectTools.includes(tool));
  const trackedNote =
    trackedTotal > 0
      ? `；其中 ${trackedTotal} 个由本插件新增，已记入撤回依据`
      : config.applied
        ? "；本插件未新增条目"
        : "；插件还没有撤回记账，无法判断哪些免审批工具由本插件新增";
  if (current.denied || current.unknown) {
    // unknown 不是「清单为空」：宿主逐字段吞掉采集异常时字段为 null，此时无法判断授权状态。
    const reason = current.denied?.reason || "宿主返回的清单字段为空或类型异常";
    items.push(item("approval", "免审批清单", OUTCOME.fail, "读不到权限清单", reason));
  } else if (projectUnreadable) {
    items.push(
      item(
        "approval",
        "免审批清单",
        OUTCOME.fail,
        `读不到项目免审批清单，无法确认该项目的授权状态${
          missing.length ? `；另有 ${missing.length} 个全局工具没进清单` : ""
        }`,
        `globalKnown=${current.globalKnown} projectKnown=${current.projectKnown} projectId=${
          config.approval.projectId
        } missingGlobal=${missing.join(", ") || "-"}`
      )
    );
  } else if (missing.length || missingProject.length) {
    items.push(
      item(
        "approval",
        "免审批清单",
        OUTCOME.warn,
        `还有 ${missing.length + missingProject.length} 个配置里的工具没进清单${trackedNote}`,
        missing.concat(missingProject).join(", ")
      )
    );
  } else {
    items.push(
      item(
        "approval",
        "免审批清单",
        OUTCOME.ok,
        `宿主全局 ${current.globalTools.length} 个、项目 ${current.projectTools.length} 个免审批工具${trackedNote}`,
        `${
          projectConfigured ? `projectId=${config.approval.projectId}` : "未指定项目，项目清单未读取"
        }；插件直接写入，撤回只撤新增项`
      )
    );
  }

  const counts = items.reduce(
    (acc, entry) => {
      acc[entry.status] = (acc[entry.status] || 0) + 1;
      return acc;
    },
    { ok: 0, warn: 0, fail: 0, off: 0 }
  );

  return { items, counts, at: Date.now() };
}
