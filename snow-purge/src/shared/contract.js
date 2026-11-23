// 面板与后台模块共用的通道契约：监听区间、请求头、路由与各类上限都在这里。
export const PLUGIN_ID = "com.snow.purge";

/**
 * 后台 HTTP 服务从 PORT_FIRST 开始逐个试到 PORT_LAST，取第一个能绑定的端口。
 * 区间与本仓库其它插件错开（docker 37291-37300、红果 37191-37200）。
 * 实际端口与令牌一起发布到插件私有存储，面板按那条记录连接，不扫描端口。
 */
export const PORT_FIRST = 37301;
export const PORT_LAST = 37310;

/**
 * 自定义请求头：网页跨站请求带不上它，而本服务不应答 CORS 预检，可挡掉网页发起的调用。
 * 它不是身份认证：同机进程可以照抄，所以真正的调用方校验靠下面的随机令牌。
 */
export const CHANNEL_HEADER = "x-snow-purge-channel";
export const CHANNEL_HEADER_VALUE = "panel-rpc-v1";

/**
 * 通道令牌：后台启动时生成并明文写入插件私有存储，面板读取后随每个请求发送。
 * 令牌无法被本机进程凭空猜出，但能从插件存储读到：同一用户下能读取该存储的进程可冒充面板。
 */
export const CHANNEL_TOKEN_HEADER = "x-snow-purge-token";
export const CHANNEL_ENDPOINT_STORAGE_KEY = "channelEndpoint";

/**
 * 免审批清单的基线摘要：去重、排序后按行拼接，用 FNV-1a 32 位十六进制表示。
 * 宿主返回顺序不承载语义，只有集合变化才算清单变化；面板与后台共用同一口径。
 */
export const toolListHash = (list) => {
  const text = [...new Set((Array.isArray(list) ? list : []).filter((item) => typeof item === "string"))]
    .sort()
    .join("\n");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export const ROUTES = {
  health: "/health",
  overview: "/overview",
  selfcheck: "/selfcheck",
  apply: "/apply",
  revert: "/revert",
  prompts: "/prompts",
  promptApply: "/prompt/apply",
  promptRemove: "/prompt/remove",
  role: "/role",
  roleApply: "/role/apply",
  roleRestore: "/role/restore",
  approval: "/approval",
  approvalGlobal: "/approval/global",
  approvalProject: "/approval/project",
  proxy: "/proxy",
  proxyApply: "/proxy/apply",
  proxyRestore: "/proxy/restore",
  proxyProbe: "/proxy/probe",
  presets: "/presets",
  presetSave: "/preset/save",
  presetRemove: "/preset/remove",
  backups: "/backups",
  backupRestore: "/backup/restore",
  backupRemove: "/backup/remove",
  audit: "/audit",
  auditClear: "/audit/clear",
  logs: "/logs",
  logsClear: "/logs/clear",
  settings: "/settings",
  settingsRepair: "/settings/repair",
  redteam: "/redteam",
  redteamInstall: "/redteam/install",
  redteamToggle: "/redteam/toggle",
  redteamRemove: "/redteam/remove",
  redteamSkill: "/redteam/skill",
  roster: "/roster",
  rosterInstall: "/roster/install",
  rosterRemove: "/roster/remove",
  rosterRole: "/roster/role",
  rosterDispatch: "/roster/dispatch",
  rosterTaskRemove: "/roster/task/remove",
  rosterTaskActivate: "/roster/task/activate",
  rosterChainStart: "/roster/chain/start",
  rosterChainPause: "/roster/chain/pause",
  rosterChainResume: "/roster/chain/resume",
  rosterChainSkip: "/roster/chain/skip",
  rosterChainStop: "/roster/chain/stop",
  rosterChainRemove: "/roster/chain/remove",
};

export const LIMITS = {
  /** 请求体硬上限，超出直接 413。 */
  requestMaxBytes: 256 * 1024,
  /** 单条提示词 / 角色规则正文上限。 */
  promptCharsMax: 24000,
  roleCharsMax: 24000,
  /** 代理注入指令正文上限。 */
  directiveCharsMax: 8000,
  /** 备份文件数量上限，超出后从最旧的开始淘汰。 */
  backupCountMax: 30,
  /** 审计流水条数上限。 */
  auditMax: 200,
  /** 探针日志读取行数上限。 */
  probeLinesMax: 50,
  /** 探针日志大小上限：托管段超过就停止写入并只告警一次，读取侧只读。 */
  probeMaxBytes: 64 * 1024,
  /** 应用日志一次读取条数上限。 */
  logsLimitMax: 100,
  /** 自定义预设数量上限。 */
  presetCountMax: 20,
  /** 项目标识上限：宿主用 local:<绝对路径> 作为项目 id，必须原样保存。 */
  projectIdCharsMax: 512,
};

/**
 * 工具全名：MCP 公开名里可能出现 . : - / 与下划线。
 * 配置层归一化与后台直写接口共用这一条正则，避免两处口径漂移。
 */
export const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.:\-/]{1,160}$/;

/** 单次写入免审批清单的工具条数上限：与配置层归一化的截断口径一致。 */
export const TOOL_NAMES_MAX = 200;

/**
 * 编队一次派发的任务条数上限：单次批量与链路每一步共用同一口径。
 * 面板与后台都从这里取值，避免三处硬编码各自漂移。
 */
export const ROSTER_BATCH_MAX = 8;

/**
 * 链路并发上限：running / paused / blocked 以及启动中的 queued 都算占用名额。
 * 面板据此禁用启动并说明原因，后台在 start 里再做一次权威校验。
 */
export const ROSTER_CHAIN_RUNNING_MAX = 3;

/** 系统提示词与角色规则里的托管标记：只替换标记内的内容。 */
export const ROLE_BEGIN = "<!-- >>> snow-purge managed >>> -->";
export const ROLE_END = "<!-- <<< snow-purge managed <<< -->";

/** 代理脚本里的托管标记。 */
export const PROXY_BEGIN = "// >>> snow-purge managed >>>";
export const PROXY_END = "// <<< snow-purge managed <<<";

/**
 * 托管标记必须独占一行才算段边界：正文里内联出现的标记（夹在 JSON 字符串或句子中间）
 * 一旦被当成边界，段区间就会切错，后续应用与还原都会写坏文件。
 * 边界容忍两处编辑器产物：文件最前面的 BOM，以及标记行尾的水平空白（空格 / Tab）。
 * 二者都不改变「整行只有标记」的语义，行中的 BOM、标记前后的其它字符仍然不算边界。
 */
export const findMarkerLines = (source, marker) => {
  const text = String(source ?? "");
  const indexes = [];
  let from = 0;
  for (;;) {
    const index = text.indexOf(marker, from);
    if (index < 0) break;
    const prev = index === 0 ? "" : text[index - 1];
    // 行首：文件开头、换行之后，或文件开头那个 BOM 之后（BOM 只在文件最前才容忍）。
    const lineStart = index === 0 || prev === "\n" || prev === "\r" || (prev === "\uFEFF" && index === 1);
    // 行尾：本行剩余只允许水平空白，之后必须是换行或文件结尾。
    const lineEnd = /^[ \t]*(?:\r\n|\r|\n|$)/.test(text.slice(index + marker.length));
    if (lineStart && lineEnd) indexes.push(index);
    from = index + marker.length;
  }
  return indexes;
};

/**
 * 拼接托管段两侧的原文：只清理接缝处的空行，段外内容逐字保留。
 * 应用时按「前缀 + 空行 + 托管段」写入，这里按同一口径还原，保证剥离与应用互逆；
 * 不对整份文本做 trim 或空行压缩 —— 段外格式属于用户内容。
 */
export const joinOutsideManagedSection = (head, tail, eolSource = head) => {
  const eol = /\r\n/.test(String(eolSource ?? "")) ? "\r\n" : "\n";
  const headCore = String(head ?? "").replace(/(?:[ \t]*\r?\n)+$/, "");
  const tailCore = String(tail ?? "").replace(/^(?:[ \t]*\r?\n)+/, "");
  if (!headCore) return tailCore;
  if (!tailCore) return headCore;
  return `${headCore}${eol}${eol}${tailCore}`;
};

/** 内联用户正文前拆开标记字面量：只把连续尖括号之间插入空格，其余字符逐字保留。 */
export const defuseManagedMarker = (text, markers) => {
  let out = String(text ?? "");
  for (const marker of markers) {
    if (!marker) continue;
    const safe = marker.replace(/<{3}|>{3}/g, (run) => run.split("").join(" "));
    out = out.split(marker).join(safe);
  }
  return out;
};

/** 本插件托管的提示词条目固定 id：便于自检与安全卸载。 */
export const MANAGED_PROMPT_ID = "snow-purge.directive";
export const MANAGED_PROMPT_NAME = "Purge 托管指令";

/** 请求代理支持的协议分支。 */
export const PROVIDER_IDS = ["chat", "responses", "anthropic", "gemini"];
