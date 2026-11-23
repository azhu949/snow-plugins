// 构建产物：由 build.mjs 从 src/panel 打包生成，请勿直接编辑。

// src/panel/react.js
var bound = null;
function bindReact(React) {
  if (!React || typeof React.createElement !== "function") return false;
  bound = { React, createElement: React.createElement };
  return true;
}
function getReact() {
  if (!bound) throw new Error("宿主 React 尚未注入");
  return bound.React;
}
function h(type, props, ...children) {
  if (!bound) throw new Error("宿主 React 尚未注入");
  const flat = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      for (const item of child) flat.push(item);
    } else {
      flat.push(child);
    }
  }
  return bound.createElement(type, props, ...flat);
}
var Fragment = (props) => {
  const React = getReact();
  return React.createElement(React.Fragment, null, props?.children ?? null);
};
function ensureReact(api) {
  if (bound) return bound.React;
  const fromGlobal = typeof window !== "undefined" ? window.SnowAppPlugin?.React : null;
  if (bindReact(fromGlobal)) return bound.React;
  if (bindReact(api?.ui?.React)) return bound.React;
  throw new Error("宿主没有提供 React 实例");
}

// locales/zh-CN.json
var zh_CN_default = {
  "app.title": "Purge",
  "tab.status": "状态",
  "tab.prompts": "提示词",
  "tab.approval": "免确认",
  "tab.redteam": "红队",
  "tab.proxy": "请求代理",
  "tab.backup": "备份",
  "tab.audit": "审计",
  "tab.settings": "设置",
  "action.add": "添加",
  "action.apply": "应用",
  "action.delete": "删除",
  "action.load": "读取",
  "action.recheck": "重新自检",
  "action.refresh": "刷新",
  "action.remove": "移除",
  "action.retry": "重试",
  "action.revert": "撤回",
  "action.save": "保存",
  "common.actions": "操作",
  "common.loading": "加载中…",
  "common.no": "否",
  "common.off": "关闭",
  "common.on": "开启",
  "common.state": "状态",
  "common.yes": "是",
  "error.backgroundUnavailable": "连不上插件的后台服务：请确认插件已启用，然后关闭并重新打开面板。",
  "error.generic": "操作失败：{{message}}",
  "error.netUnavailable": "宿主没有开放网络能力：请在插件隐私声明里保留 network。",
  "error.pending": "后台还没有发布连接记录：请关闭并重新打开插件面板。",
  "error.timeout": "请求超时：后台可能正在处理写动作，请稍后刷新确认结果。",
  "error.title": "出错了",
  "notice.applied": "已应用",
  "notice.noop": "没有启用任何托管层：本次没有写入宿主，也没有改动已托管的内容。要让它生效，请先在「提示词」或「请求代理」页开启对应的托管层，再点顶部「应用」。",
  "notice.appliedRecordFailed": "已写入宿主，但撤回记账没有保存成功（{{reason}}）：现在点「撤回」无法自动撤下这次写入的内容，请在存储恢复后重新点「应用」补写记账。",
  "notice.recordFailed": "记账没有写入（{{reason}}）",
  "notice.revertRecordFailed": "已撤回，但残留记账没有清掉（{{reason}}）：再点一次「撤回」会重试",
  "notice.noSnapshot": "已应用，但这些层没有建快照：{{steps}}",
  "notice.partial": "部分步骤失败：{{steps}}",
  "notice.revertEmpty": "没有需要撤回的托管内容",
  "notice.revertPartial": "撤回未全部完成：{{steps}}",
  "notice.revertPartialBySwitch": "已撤回（托管总开关处于关闭状态），但有些层撤回失败：{{steps}}",
  "notice.reverted": "已撤回",
  "notice.revertedBySwitch": "已撤回：托管总开关处于关闭状态，本次点「应用」执行的是撤回",
  "notice.savedWhileDisabled": "配置已保存，但托管总开关处于关闭状态：本次没有写入宿主，也没有撤回任何已托管的层。要让它生效，请先在「设置」页打开「启用托管」，再点顶部「应用」。",
  "status.approval": "免审批清单",
  "status.approvalTracked": "撤回记账里 {{count}} 个工具由本插件新增",
  "status.approvalNone": "本插件未新增",
  "status.approvalUnknown": "没有撤回记账，无法判断",
  "status.boundaries": "能力边界",
  "status.boundary.host": "不修改宿主安装目录，也不打宿主补丁：那部分在 Snow App 里没有对应机制。",
  "status.boundary.proxy": "请求代理只维护自己的托管段；段外内容不动，发现冲突会让位。",
  "status.boundary.sensitive": "敏感命令不能由插件代为批准，只能由你在电脑端确认。",
  "status.boundary.sidebar": "Snow App 没有左侧栏整页容器，本插件以右侧面板形式提供同样的功能。",
  "status.connecting": "正在连接后台",
  "status.enabled": "托管总开关",
  "status.fail": "失败",
  "status.layers": "自检分层",
  "status.lastApplied": "上次应用",
  "status.loading": "正在自检…",
  "status.managed": "托管内容",
  "status.neverApplied": "还没有应用过任何托管内容。",
  "status.off": "未启用",
  "status.ok": "正常",
  "status.port": "端口",
  "status.prompt": "系统提示词",
  "status.proxy": "请求代理",
  "status.role": "全局角色规则",
  "status.summary": "汇总",
  "status.uninstallHint": "卸载或停用插件不会自动撤回上面这些托管内容：请先点「撤回」，再卸载。",
  "status.warn": "待确认",
  "prompts.active": "启用这条提示词",
  "prompts.content": "提示词正文",
  "prompts.managedBadge": "已托管",
  "prompts.name": "条目名称",
  "prompts.namePlaceholder": "例如：Purge 托管指令",
  "prompts.noCustom": "还没有自定义预设。把当前内容存成预设，下次可以一键载入。",
  "prompts.notApplied": "未写入",
  "prompts.notInLibrary": "提示词库里还没有这条条目，点「保存并应用」才会写入。",
  "prompts.presetLoaded": "已载入预设：{{name}}",
  "prompts.presetDeleteConfirm": "再点一次确认删除预设「{{name}}」，删除后可在本页撤销",
  "prompts.presetDeleteArmed": "确认删除",
  "prompts.presetDeleted": "已删除预设：{{name}}",
  "prompts.presetOverwriteConfirm": "编辑框里有未保存的改动，再点一次会用「{{name}}」覆盖当前草稿",
  "prompts.presetOverwriteArmed": "覆盖并载入",
  "prompts.presetRecycleHint": "已删除预设「{{name}}」，副本还留在本页",
  "prompts.presetRestored": "已恢复预设：{{name}}",
  "prompts.presetUndo": "撤销删除",
  "prompts.unreadableBadge": "读不到",
  "prompts.unreadableHint": "请到宿主「设置 - 提示词」核对；若确实读不到，只能在那里手工删除托管条目",
  "prompts.unreadableTitle": "读不到宿主的系统提示词库",
  "prompts.presetNamePlaceholder": "预设名称",
  "prompts.presetNameRequired": "请先填写预设名称",
  "prompts.presetSaved": "预设已保存",
  "prompts.presets": "预设",
  "prompts.presetsHint": "预设只填充编辑框，不会自动写入宿主；确认后再点保存。",
  "prompts.proxyHint": "请求代理当前已启用：这里改完提示词后，记得到「请求代理」页重新应用一次，代理里的注入指令才会跟着更新。",
  "prompts.remove": "删除托管条目",
  "prompts.removeArmed": "确认删除托管条目",
  "prompts.removeConfirm": "再点一次确认删除宿主提示词库中的托管条目：插件不保留副本，只有应用前该条目已存在时，才能在「备份」页回滚「提示词」快照找回原值",
  "prompts.removed": "已删除托管提示词条目",
  "prompts.roleEnable": "角色规则托管",
  "prompts.roleFile": "全局 ROLE 文件",
  "prompts.roleHint": "写入的是标记段，标记外的内容原样保留；撤回时只移除托管段。",
  "prompts.roleRestore": "移除托管段",
  "prompts.roleRestoreArmed": "确认移除并清空草稿",
  "prompts.roleRestoreConfirm": "再点一次确认移除托管段：编辑框里的规则草稿会一并清空，要保留请先「存为预设」",
  "prompts.roleRestored": "已移除角色文件里的托管段",
  "prompts.roleSave": "保存并应用",
  "prompts.roleTitle": "全局角色规则",
  "prompts.saveApply": "保存并应用",
  "prompts.savePreset": "存为预设",
  "prompts.systemHint": "写入系统提示词库里的固定条目（snow-purge.directive），启用后对之后的对话生效。",
  "prompts.systemTitle": "系统提示词",
  "prompts.usePreset": "载入",
  "approval.empty": "清单为空",
  "approval.emptyNotSavable": "全局清单不能保存为空：要清空请到宿主设置的权限页操作",
  "approval.globalHint": "面板显示的是宿主当前的全局清单。保存会用编辑后的完整清单覆盖它，请确认没有漏掉条目；全局清单对所有项目生效，新增项在这些项目里不再弹授权确认（已打开的对话需重新打开后按新清单判定）。本次新增的授权会记入撤回依据，撤回只撤下本插件新增的项。清单不能保存为空，要清空请到宿主设置的权限页操作。",
  "approval.globalDiff": "待写入：共 {{total}} 项，新增 {{added}} 项，移除 {{removed}} 项（全局清单对所有项目生效）",
  "approval.globalSaved": "全局免审批清单已保存",
  "approval.staleList": "全局清单在你打开面板之后已被外部修改（例如在宿主设置页或另一个窗口新增了授权）：本次没有保存。已刷新基线，请核对最新清单后再点一次保存。",
  "approval.globalTitle": "全局免审批工具",
  "approval.unreadableTitle": "读不到宿主的免审批清单",
  "approval.unreadableNotSavable": "读不到宿主当前的全局清单，已禁止保存，避免把整表覆盖成空",
  "approval.unreadableHint": "请到宿主设置的权限页核对；若权限配置文件损坏或不可读，先修复该文件再重试",
  "approval.grant": "授权",
  "approval.invalidTool": "工具名不合法：只允许字母、数字与 . _ : - /",
  "approval.pattern": "匹配模式",
  "approval.projectEmpty": "该项目还没有免审批工具",
  "approval.projectLoadFirst": "填写项目标识后点「读取」，确认清单属于该项目再写入",
  "approval.projectLoadRequired": "还没有读取任何项目的清单：请先填写项目标识并点「读取」",
  "approval.projectReloadRequired": "项目标识与已读取的清单不一致：请先点「读取」，确认清单属于该项目后再授权或撤下",
  "approval.projectUnreadable": "读不到该项目的免审批清单，已禁止写入，避免把既有授权当作空清单处理",
  "approval.projectTarget": "目标项目：{{projectId}}",
  "approval.projectCount": "本次提交 {{count}} 个工具",
  "approval.projectGranted": "已授权项目工具",
  "approval.projectHint": "项目标识与宿主权限域使用同一口径；不确定时先读取一次，确认清单再写入。项目清单只作用于这个项目，不影响其它项目。本次新增的授权会记入撤回依据，撤回只撤下本插件新增的项。",
  "approval.projectLimitReached": "授权已写入宿主，但本次新增项没有全部记入撤回依据（项目撤回记账已达上限）：撤回不会自动撤下它们，请到宿主权限页核对或先清理不再使用的项目记账。",
  "approval.projectPlaceholder": "项目标识，例如 local:/path/to/project",
  "approval.projectRequired": "请先填写项目标识",
  "approval.projectRevoked": "已撤下项目工具",
  "approval.projectTitle": "项目级免审批工具",
  "approval.projectToolsPlaceholder": "每行一个工具全名",
  "approval.replaceWarn": "整表覆盖",
  "approval.revoke": "撤下",
  "approval.ruleId": "规则",
  "approval.saveGlobal": "保存全局清单",
  "approval.sensitiveBoundary": "敏感命令规则只读展示：插件不改写、不删除、也不重置这些规则，匹配这些规则的操作仍需你本人确认。",
  "approval.sensitiveEmpty": "没有敏感命令规则",
  "approval.sensitiveHint": "这里只展示宿主当前的敏感命令规则，用于核对哪些操作仍需你本人确认。",
  "approval.sensitiveTitle": "敏感命令规则",
  "approval.toolPlaceholder": "工具全名，回车添加",
  "approval.toolRequired": "请至少填写一个工具名",
  "redteam.title": "红队技能库",
  "redteam.hint": "上游 dsh-purge 的 23 份红队技能原文随插件一起安装。点「安装」只把 SKILL.md 写进 ~/.snow/skills，不下载工具、不执行命令；装好后在宿主的 Skills 设置里即可看到并启停。",
  "redteam.libraryDir": "技能库",
  "redteam.skillsDir": "安装目录",
  "redteam.enabledCount": "已启用",
  "redteam.library": "技能列表",
  "redteam.allRoles": "全部",
  "redteam.empty": "技能库为空：确认插件安装目录里带 skills/redteam。",
  "redteam.installAll": "全部安装",
  "redteam.install": "安装",
  "redteam.reinstall": "覆盖安装",
  "redteam.update": "更新",
  "redteam.view": "查看",
  "redteam.enable": "启用",
  "redteam.disable": "停用",
  "redteam.close": "收起",
  "redteam.state.broken": "文件异常",
  "redteam.state.enabled": "已启用",
  "redteam.state.disabled": "已停用",
  "redteam.state.notInstalled": "未安装",
  "redteam.installed": "已安装：{{name}}",
  "redteam.updated": "已覆盖更新：{{name}}",
  "redteam.enabled": "已启用：{{name}}",
  "redteam.disabled": "已停用：{{name}}",
  "redteam.removed": "已移除：{{name}}，原目录在 plugin-data 回收区",
  "redteam.installDone": "已安装 {{count}} 项技能",
  "redteam.installPartial": "有 {{count}} 项安装失败，详见审计页",
  "redteam.previewHint": "这是技能库里的原文，先核对内容再决定是否安装。",
  "redteam.env.title": "环境自检",
  "redteam.env.hint": "只读环境变量与 ~/.snow/.env（若存在），不运行任何工具。只取 FOFA_KEY、REDTEAM_VPS_HOST、REDTEAM_VPS_KEY 三个键：密钥只显示长度，私钥只在确认为本机路径时显示路径，主机地址只显示长度。缺项不影响技能安装。",
  "redteam.env.item": "项目",
  "redteam.env.evidence": "证据",
  "redteam.env.fofa": "FOFA_KEY",
  "redteam.env.vpsHost": "VPS 主机",
  "redteam.env.vpsKey": "VPS 私钥",
  "redteam.env.toolkit": "工具箱目录",
  "redteam.env.setupMarker": "完成标记",
  "redteam.env.tools": "工具",
  "redteam.env.ok": "就绪",
  "redteam.env.warn": "缺失",
  "redteam.env.off": "未配置",
  "redteam.env.missing": "未找到",
  "redteam.boundary.title": "能做到哪一步",
  "redteam.boundary.skills": "能做：安装、启停、移除这些技能文档。它们只是操作手册，真正执行仍由对话里的 Agent 按你的授权去做。",
  "redteam.boundary.tools": "不做：不下载、不安装 fscan / nuclei / chisel 等二进制，也不代为执行任何扫描或利用命令。",
  "redteam.boundary.workflow": "不做：上游的 redteam_preflight、任务链编排与报告生成是它自己的工具，Snow App 插件不能注册这类工具，只提供同口径的只读检查。",
  "redteam.boundary.legal": "只在你自己拥有或已获授权的环境中使用；涉及他人系统时先取得书面许可。",
  "roster.open": "编队视图",
  "roster.title": "红队编队",
  "roster.close": "关闭",
  "roster.installAll": "全部编入",
  "roster.installAllConfirm": "确认覆盖同名子代理",
  "roster.install": "编入",
  "roster.reinstall": "重新编入",
  "roster.update": "更新配置",
  "roster.state.ready": "已编入",
  "roster.state.stale": "建议更新",
  "roster.state.pending": "未编入",
  "roster.state.indexOnly": "已编入（仅索引）",
  "roster.verify.hint": "{{count}} 个角色仅按本插件的写入记录显示：宿主只把当前项目的子代理返回给插件，全局角色被删除时这里读不到。若在宿主设置里删过角色，请点「重新编入」。",
  "roster.toast.installed": "已把角色写入子代理配置",
  "roster.toast.updated": "已覆盖更新角色配置",
  "roster.toast.removed": "已从子代理配置移除该角色",
  "roster.toast.allDone": "5 个角色已全部编入",
  "roster.toast.partial": "有 {{count}} 个角色写入失败，详见审计页",
  "roster.toast.overwritten": "覆盖了宿主返回的同名记录 {{name}}，原配置已备份到 {{file}}",
  "roster.toast.overwrittenAll": "全部编入完成，其中 {{count}} 个宿主返回的同名记录被覆盖，原配置已备份",
  "roster.toast.unverified": "{{name}} 已编入；宿主只按当前项目返回子代理，读不到同名的全局记录：若存在已被覆盖且无法自动备份。需要保留时请先在宿主设置的子代理页备份原配置。",
  "roster.toast.unverifiedAll": "全部编入完成；其中 {{count}} 个角色读不到同名的全局记录，若存在已被覆盖且无法自动备份。需要保留时请先在宿主设置的子代理页备份原配置。",
  "roster.toast.projectConflict": "{{name}} 已编入全局；当前项目里还有同名记录，项目级配置会优先生效",
  "roster.toast.indexFailed": "{{name}} 已写入宿主，但插件未能记录编入索引（{{message}}）。面板可能显示为未编入，请重试编入或检查插件数据目录权限。",
  "roster.toast.indexFailedAll": "{{count}} 个角色已写入宿主，但插件未能记录编入索引（{{message}}）。请重试编入或检查插件数据目录权限。",
  "roster.toast.backupSaved": "已备份 {{name}} 的旧配置到 {{file}}",
  "roster.core": "主控会话",
  "roster.coreSub": "编排与汇报",
  "roster.netHint": "节点是子代理角色，连线表示由主控派活。编入状态以本插件的写入记录为准（宿主读取接口按项目过滤，读不到全局角色，因此全局角色被删除时插件也无法核对）。宿主当前只向插件返回主会话记录，角色状态与 token / 耗时 / 请求数未提供，面板不会用 0 值代替。",
  "roster.members": "编队成员",
  "roster.membersHint": "点角色名选中，左侧显示详情",
  "roster.member.in": "已编入",
  "roster.member.out": "未编入",
  "roster.prompt": "系统提示词",
  "roster.promptHide": "收起提示词",
  "roster.boundary": "只写配置：角色、系统提示词与工具白名单会写进宿主 subAgents，不启动子代理、不下载工具，也不代你批准敏感命令。",
  "roster.role.redteam_recon.name": "资产测绘",
  "roster.role.redteam_recon.desc": "铺开授权范围内的公开资产：域名、子域、IP、端口、证书与 Web 指纹，输出带来源的资产表。",
  "roster.role.redteam_recon.t1": "从域名与证书透明日志整理子域，标注来源与置信度",
  "roster.role.redteam_recon.t2": "对存活主机做端口与服务识别，记录版本指纹",
  "roster.role.redteam_recon.t3": "汇总资产表，标出值得进一步验证的暴露面",
  "roster.role.redteam_assess.name": "风险评估",
  "roster.role.redteam_assess.desc": "把资产清单归并成攻击面并排优先级，只做判断与排序，不执行验证。",
  "roster.role.redteam_assess.t1": "按暴露程度与业务重要性给资产分级",
  "roster.role.redteam_assess.t2": "把组件版本与公开漏洞库对照，标注匹配度",
  "roster.role.redteam_assess.t3": "输出 P0-P3 风险表与下一轮验证建议",
  "roster.role.redteam_vuln_scan.name": "漏洞扫描",
  "roster.role.redteam_vuln_scan.desc": "用针对性模板做检测，把疑似问题变成可复现证据，全程控制速率与并发。",
  "roster.role.redteam_vuln_scan.t1": "按指纹选择模板集，限定目标、并发与速率",
  "roster.role.redteam_vuln_scan.t2": "对命中项复核最小请求，排除误报",
  "roster.role.redteam_vuln_scan.t3": "输出结果表与可复现命令，标注误报风险",
  "roster.role.redteam_exploit.name": "利用验证",
  "roster.role.redteam_exploit.desc": "把已确认漏洞做成最小可复现验证，证明影响面而不追求破坏力。",
  "roster.role.redteam_exploit.t1": "为每个漏洞设计最小验证步骤与回退方案",
  "roster.role.redteam_exploit.t2": "记录关键请求、响应与证据，控制在无害范围",
  "roster.role.redteam_exploit.t3": "清理现场与临时连接，给出影响判断",
  "roster.role.redteam_internal.name": "内网横向",
  "roster.role.redteam_internal.desc": "在授权覆盖的内网段内做资产发现、横向路径分析与提权评估。",
  "roster.role.redteam_internal.t1": "低噪声存活与端口发现，绘制内网拓扑",
  "roster.role.redteam_internal.t2": "分析可达关系与凭据类型，规划横向路径",
  "roster.role.redteam_internal.t3": "按需开隧道并立即关闭，输出触达结论",
  "roster.badge.running": "运行中 {{count}}",
  "roster.badge.tasks": "任务 {{count}}",
  "roster.status.running": "运行中",
  "roster.status.completed": "已完成",
  "roster.status.failed": "失败",
  "roster.status.cancelled": "已取消",
  "roster.status.idle": "空闲",
  "roster.status.unavailable": "未提供",
  "roster.status.pending": "未编入",
  "roster.status.queued": "待开始",
  "roster.status.missing": "会话已不在",
  "roster.net.title": "Agent 网络",
  "roster.net.totals": "累计 {{tokens}} token · {{requests}} 次模型请求",
  "roster.net.unavailable": "宿主未提供子代理会话数据",
  "roster.activity.none": "还没有运行记录",
  "roster.activity.unavailable": "未提供运行数据",
  "roster.meta.model": "模型",
  "roster.meta.tokens": "Token",
  "roster.meta.time": "耗时",
  "roster.meta.requests": "请求",
  "roster.meta.messages": "{{count}} 条消息",
  "roster.value.unavailable": "未提供",
  "roster.search": "搜索名称",
  "roster.filter.all": "全部",
  "roster.filter.running": "运行中",
  "roster.filter.done": "已结束",
  "roster.filter.pending": "未编入",
  "roster.filter.empty": "没有匹配的角色",
  "roster.detail": "详情",
  "roster.detail.lastConversation": "已关联会话",
  "roster.dispatch.title": "派发任务",
  "roster.dispatch.hint": "派发会新建一个会话，由主代理把它交给这个角色执行。",
  "roster.dispatch.role": "角色",
  "roster.dispatch.target": "靶标",
  "roster.dispatch.targetHint": "域名、IP 或网段，需在授权范围内",
  "roster.dispatch.template": "任务",
  "roster.dispatch.templateHint": "可直接写，或从右侧模板填入",
  "roster.dispatch.pickTemplate": "选择任务模板",
  "roster.dispatch.note": "补充说明",
  "roster.dispatch.noteHint": "额外约束、字典路径或时间窗口（可选）",
  "roster.dispatch.autoReply": "派发后会立即触发一个回合",
  "roster.dispatch.send": "派发任务",
  "roster.dispatch.sending": "派发中",
  "roster.dispatch.done": "已新建会话并投递任务",
  "roster.dispatch.pickRole": "请选择一个角色",
  "roster.dispatch.forRole": "派发",
  "roster.dispatch.notInstalled": "这个角色还没编入：先在「编队」里点「编入」。",
  "roster.dispatch.templates": "任务模板（可多选）",
  "roster.dispatch.custom": "自定义任务",
  "roster.dispatch.customHint": "模板之外再加一条，按 Enter 加入",
  "roster.dispatch.add": "加入清单",
  "roster.dispatch.remove": "从清单移除",
  "roster.dispatch.queue": "待派发 {{count}} 条任务",
  "roster.dispatch.sendCount": "派发 {{count}} 条任务",
  "roster.dispatch.doneCount": "已派发 {{count}} 条任务（{{conversations}} 个会话）",
  "roster.dispatch.partial": "已派发 {{count}} 条任务，{{failed}} 条失败",
  "roster.dispatch.empty": "先勾选一条模板，或添加一条自定义任务",
  "roster.dispatch.mode": "派发方式",
  "roster.dispatch.modeSingle": "同一会话依次执行",
  "roster.dispatch.modeSplit": "每条任务一个会话",
  "roster.dispatch.modeHint.single": "同一角色的模板通常有先后依赖：合在一个会话里按编号执行，后一项直接复用前一项的产出，token 与目标侧并发都更省。",
  "roster.dispatch.modeHint.split": "每条任务单独开会话，彼此独立、可分别重跑；适合不同靶标或互不依赖的任务，但不会共享前一条的结果。",
  "roster.task.batch": "{{count}} 条任务：{{first}} 等",
  "roster.chain.title": "链路",
  "roster.chain.hint": "按顺序自动接力：上一环的结论会交给下一环。暂停与停止只控制接力，不保证靶标侧已停：远端扫描与隧道需另行收手。判定依赖宿主的会话列表与实时状态；读不到时本步会停下等待确认，不会猜完成。",
  "roster.chain.target": "靶标",
  "roster.chain.steps": "环节与任务",
  "roster.chain.noteHint": "授权范围、时间窗或额外约束（整条链路共用）",
  "roster.chain.orderHint": "按「测绘 → 评估 → 扫描 → 验证 → 横向」固定顺序执行",
  "roster.chain.start": "启动链路",
  "roster.chain.starting": "启动中",
  "roster.chain.started": "链路已启动，当前环节跑完会自动进入下一环",
  "roster.chain.failed": "链路第一步没有派出去",
  "roster.chain.empty": "还没有启动过链路。选好环节、填上靶标，点「启动链路」。",
  "roster.chain.progress": "已完成 {{done}}/{{total}}",
  "roster.chain.pause": "暂停接力",
  "roster.chain.resume": "继续",
  "roster.chain.skip": "跳过本步",
  "roster.chain.stop": "停止接力",
  "roster.chain.remove": "移除链路",
  "roster.chain.paused": "已暂停接力：当前环节的会话仍在运行",
  "roster.chain.resumed": "链路已继续",
  "roster.chain.redispatch": "重新派发本步",
  "roster.chain.resumedRedispatched": "本步已重新派发，旧会话已中止",
  "roster.chain.resumedRedispatchedIdle": "本步已重新派发；旧会话未确认中止：{{reason}}，请到会话列表手动停止",
  "roster.chain.resumedStillRunning": "该会话仍在运行，链路会等它结束后再判断本步",
  "roster.chain.resumedCompleted": "该会话其实已经跑完，继续后会进入下一环",
  "roster.chain.resumedUnknown": "读不到会话列表，未重新派发：切回发起项目后再点继续",
  "roster.chain.redispatchFailed": "重新派发失败：{{reason}}",
  "roster.chain.skipped": "已跳过当前步骤",
  "roster.chain.stopped": "已停止接力",
  "roster.chain.stopAborted": "已停止接力，并中止了当前环节的会话",
  "roster.chain.stopIdle": "已停止接力；未发出中止：{{reason}}",
  "roster.chain.abortUnknown": "会话没有进行中的回合",
  "roster.chain.skippedAborted": "已跳过当前步骤，当前会话已中止",
  "roster.chain.skippedIdle": "已跳过当前步骤；未发出中止：{{reason}}",
  "roster.chain.removed": "已移除链路",
  "roster.chain.removedAborted": "已移除链路，并中止了当前环节的会话",
  "roster.chain.removedIdle": "已移除链路；未发出中止：{{reason}}",
  "roster.chain.status.running": "进行中",
  "roster.chain.status.paused": "已暂停",
  "roster.chain.status.blocked": "已阻塞",
  "roster.chain.status.completed": "已完成",
  "roster.chain.status.stopped": "已停止",
  "roster.tasks.title": "任务",
  "roster.tasks.hint": "状态按会话运行情况推断，仅供参考",
  "roster.tasks.empty": "还没有派发过任务",
  "roster.task.open": "打开会话",
  "roster.task.remove": "移除记录",
  "roster.task.opened": "已切换到任务会话",
  "roster.task.removed": "已移除任务记录",
  "roster.task.notFound": "任务记录已不存在，列表已刷新",
  "roster.task.archived": "更早的 {{count}} 条任务记录已归档保留，不再占用列表",
  "roster.tab.chain": "链路",
  "roster.chain.singleStep": "单步执行",
  "roster.chain.edit": "编辑任务",
  "roster.chain.collapse": "收起",
  "roster.chain.records": "链路记录",
  "roster.chain.stepDefault": "默认任务书",
  "roster.chain.stepTasks": "{{count}} 条任务",
  "roster.chain.stepLimit": "每步最多 {{max}} 条任务：先移除一条再加",
  "roster.chain.stepOver": "{{count}} 条任务（超过上限 {{max}} 条，启动前需要删减）",
  "roster.chain.trimmed": "（{{archived}} 条旧记录已归档保留，{{truncated}} 条任务超过单步上限未派发）",
  "roster.chain.stepAdd": "加入本步",
  "roster.chain.stepAddHint": "在本步默认任务之外再加一条，按 Enter 加入",
  "roster.chain.stepRemove": "从本步移除",
  "roster.chain.stepReset": "恢复默认任务书",
  "roster.chain.toggleStep": "把「{{name}}」加入或移出链路",
  "roster.chain.review": "{{count}} 个环节 · 靶标 {{target}} · 将新建 {{sessions}} 个会话、派发 {{tasks}} 条任务",
  "roster.chain.confirm": "再点一次「确认启动」：靶标 {{target}}，将新建 {{sessions}} 个会话，派发 {{tasks}} 条任务",
  "roster.chain.confirmImpact": "所选环节含 {{names}}，属高影响角色，请先确认靶标与授权范围",
  "roster.chain.startConfirm": "确认启动（{{sessions}} 个会话 / {{tasks}} 条任务）",
  "roster.chain.blocked.target": "填上靶标就能启动",
  "roster.chain.blocked.steps": "至少保留一个环节",
  "roster.chain.blocked.roles": "先编入这些角色：{{names}}",
  "roster.chain.blocked.stepLimit": "「{{name}}」有 {{count}} 条任务，单步最多 {{max}} 条：先删减再启动",
  "roster.chain.blocked.active": "最多同时保留 {{max}} 条未结束的链路（进行中或阻塞）：先在下方记录里停止或移除一条再启动",
  "roster.chain.brief.redteam_recon": "对靶标做资产测绘：子域、存活主机、端口与服务指纹，输出带来源的资产表，并标出值得进一步验证的暴露面。只做信息收集，不做漏洞验证。",
  "roster.chain.brief.redteam_assess": "基于上一环节的资产表，按暴露程度与业务重要性给出 P0-P3 排序，说明每一级的判断依据，并给出下一轮验证建议。只做判断与排序，不执行验证。",
  "roster.chain.brief.redteam_vuln_scan": "对 P0/P1 资产做针对性模板检测，限定目标、并发与速率，输出可复现命中、判定依据与误报风险。不做利用，不扩大验证范围。",
  "roster.chain.brief.redteam_exploit": "对已确认的漏洞做最小可复现验证，只取一条无害证据，不做数据删除、不植入持久化、不做横向移动。每次行动前写清预期结果与回退方案。",
  "roster.chain.brief.redteam_internal": "以已有立足点为起点做低噪声内网发现与横向路径分析，隧道用完即关，输出可达关系、凭据类型与最高价值目标。",
  "roster.summary": "编入 {{installed}}/{{total}} · 运行中 {{running}} · 待跑任务 {{tasks}}",
  "roster.refresh": "刷新数据",
  "roster.installing": "编入中",
  "roster.installingAll": "编入中",
  "roster.installAllCount": "全部编入（{{count}}）",
  "roster.installAllHint": "只编入尚未编入的角色；宿主只按项目返回子代理，同名全局记录读不到，覆盖前无法自动备份。",
  "roster.tab.roster": "编队",
  "roster.tab.dispatch": "派发",
  "roster.tab.tasks": "任务",
  "roster.tab.chains": "{{count}} 条链路在跑",
  "roster.stale": "刷新失败：{{message}}。当前显示的是上次读到的数据。",
  "roster.indexBroken.hint": "编队索引不可用（{{message}}）：角色可能已编入却显示为未编入，请点「编入」重新核对。",
  "roster.updated.none": "尚未同步",
  "roster.updated.just": "刚刚更新",
  "roster.updated.seconds": "{{count}} 秒前更新",
  "roster.updated.minutes": "{{count}} 分钟前更新",
  "roster.net.caption": "五个角色子代理，连线表示由主控派活。",
  "roster.help": "说明与边界",
  "roster.helpHide": "收起说明",
  "roster.search.clear": "清空搜索",
  "roster.empty.filtered.title": "没有匹配的角色",
  "roster.empty.filtered.hint": "换个关键词，或清掉筛选，看看全部角色。",
  "roster.empty.filtered.action": "清除筛选",
  "roster.empty.tasks.title": "还没有派发过任务",
  "roster.empty.tasks.hint": "在「派发」里选好角色、填上靶标，任务就会出现在这里。",
  "roster.empty.tasks.action": "去链路",
  "roster.confirm.remove": "确认移除",
  "roster.confirm.hint": "再点一次「确认移除」，{{name}} 的子代理配置会被删除",
  "roster.confirm.foreignHint": "索引里没有 {{name}} 的编入记录，宿主里可能存在你手工创建的同名全局子代理：再点一次会按 agentId 删除该全局记录且无法恢复。要保留请先在宿主设置的子代理页备份。",
  "roster.confirm.driftHint": "{{name}} 的编入记录来自旧版本的角色定义，宿主里的同名记录可能已被手工改过：再点一次会删除该全局记录，要保留请先备份。",
  "roster.confirm.indexBrokenHint": "读取编队索引失败，无法确认 {{name}} 是哪个版本写入的记录：再点一次会按 agentId 删除该全局记录，要保留请先在宿主设置的子代理页备份。",
  "roster.confirm.task": "确认删除",
  "roster.confirm.taskHint": "再点一次「确认删除」，这条记录会被移除（会话本身不受影响）",
  "roster.confirm.chainHint": "再点一次「确认移除」：这条链路记录会被移除，进行中的会话会先被中止（中止可能失败）",
  "roster.confirm.skip": "确认跳过",
  "roster.confirm.skipHint": "再点一次「确认跳过」：当前环节的会话会被中止，下一环立即开始",
  "roster.toast.removedName": "已移除 {{name}}，随时可以重新编入",
  "roster.toast.removedForeignName": "已移除 {{name}} 的全局记录；索引里没有本插件的编入记录，无法确认它是否由你手工创建，如已误删请到宿主设置的子代理页重建。",
  "roster.toast.removeBlockedName": "{{name}} 未确认移除，请到宿主的子代理设置里核对",
  "roster.toast.notInstalledName": "{{name}} 未安装，无需移除",
  "roster.toast.removedGlobalOnly": "已移除 {{name}} 的全局配置，但仍有 {{count}} 个项目作用域存在同名记录，请到宿主的子代理设置里按项目删除",
  "roster.toast.removedWithBackup": "已移除 {{name}}；编入时备份的原配置仍在本机：{{file}}（需手工写回宿主）",
  "roster.conflict.hint": "索引里没有 {{name}} 的编入记录：无法确认宿主侧是否已有同名全局子代理，再次点击「编入」会直接覆盖，且无法自动备份。需要保留时请先在宿主设置的子代理页备份。",
  "roster.conflict.allHint": "{{count}} 个角色在索引里没有编入记录（{{names}}）：无法确认宿主侧是否已有同名全局子代理，再次点击「确认覆盖」会直接覆盖，且无法自动备份。需要保留时请先在宿主设置的子代理页备份。",
  "roster.detail.templates": "任务模板",
  "roster.detail.tools": "工具白名单 {{count}} 项",
  "roster.dispatch.targetHelp": "只在你自己拥有或已获授权的目标上派发。",
  "roster.dispatch.duplicate": "这条任务已经在清单里",
  "roster.dispatch.review": "将派发给「{{name}}」，共 {{count}} 条",
  "roster.dispatch.blocked.role": "先把这个角色编入，再派发任务",
  "roster.dispatch.blocked.target": "填上靶标就能派发",
  "roster.dispatch.blocked.queue": "先选一条模板，或自己写一条",
  "roster.queue.title": "待派发清单",
  "roster.queue.count": "{{count}} 条",
  "roster.queue.empty": "还没有选任务：从左边勾模板，或自己写一条。",
  "roster.chain.summary": "{{count}} 条记录 · {{active}} 条进行中",
  "audit.action": "动作",
  "audit.detail": "详情",
  "audit.empty": "还没有插件动作记录",
  "audit.failed": "失败",
  "audit.hint": "插件把自己的每次应用、撤回、写入都记在这里，最多保留 200 条。",
  "audit.levelAll": "全部级别",
  "audit.logsDenied": "读不到应用日志：{{reason}}",
  "audit.logsEmpty": "没有符合条件的日志",
  "audit.logsHint": "读取宿主应用日志用于对照，只在打开本页时读取一次。清空会删除日志库的全部记录，涵盖所有会话与系统日志，不受当前筛选条件影响，且不可恢复。",
  "audit.logsTitle": "应用日志",
  "audit.modulePlaceholder": "模块，例如 api / requestProxy",
  "audit.ok": "成功",
  "audit.result": "结果",
  "audit.time": "时间",
  "audit.title": "动作流水",
  "audit.clear": "清空流水",
  "audit.clearConfirm": "确认清空",
  "audit.cleared": "动作流水已清空",
  "audit.logsClear": "清空全部应用日志",
  "audit.logsClearConfirm": "确认清空全部应用日志",
  "audit.logsClearTitle": "删除宿主应用日志库的全部记录，不可恢复",
  "audit.logsCleared": "应用日志已清空，共删除 {{count}} 条，无法恢复",
  "backup.boundary": "备份只覆盖本插件会改动的东西：代理脚本原文、角色文件、托管提示词原值、免审批清单。",
  "backup.dir": "备份目录",
  "backup.empty": "还没有备份。第一次应用时会自动创建。",
  "backup.hint": "应用前自动快照，最多保留 30 份；回滚只影响对应那一层。",
  "backup.kind": "类型",
  "backup.kind.approval": "免审批清单",
  "backup.kind.other": "其它",
  "backup.kind.prompt": "提示词",
  "backup.kind.proxy": "代理脚本",
  "backup.kind.role": "角色规则",
  "backup.restore": "回滚",
  "backup.confirm.approval": "这是免审批清单快照：回滚会用快照覆盖全局清单（以及快照里记录的项目清单），应用后新增且不在快照里的授权不会被保留。确定继续？",
  "backup.confirm.other": "这是未知类型的快照：回滚会直接写入宿主配置。确定继续？",
  "backup.confirm.prompt": "这是提示词快照：回滚会用应用前原值整条覆盖 snow-purge.directive 这一条，其它提示词条目不受影响。确定继续？",
  "backup.confirm.proxyForce": "代理脚本在应用之后被手写过。继续回滚会连同这些内容一起覆盖，确定继续？",
  "backup.confirm.role": "这是角色规则快照：回滚会用应用前原文整份覆盖全局角色文件，托管段之外你之后手写的规则也会一并覆盖。确定继续？",
  "backup.confirm.roleForce": "角色文件里托管段之外的内容与应用前快照不一致。继续回滚会连同这些手写内容一起覆盖，确定继续？",
  "backup.deleteArmed": "确认删除",
  "backup.deleteConfirm": "再点一次确认删除「{{kind}}」备份（{{time}}），删除后这份快照无法恢复",
  "backup.deleteFailed": "删除失败：后台没有确认这次删除，请刷新后重试",
  "backup.deleted": "已删除「{{kind}}」备份，剩余 {{count}} 份",
  "backup.restoreProxyConfirm": "这是代理脚本快照：回滚会整体覆盖代理脚本，托管段之外你手写的内容也会一并覆盖。确定继续？",
  "backup.restored": "已按备份回滚",
  "backup.size": "大小",
  "backup.time": "时间",
  "backup.title": "本机备份",
  "proxy.blockAbsent": "无托管段",
  "proxy.blockHash": "段哈希",
  "proxy.blockPresent": "托管段就位",
  "proxy.boost": "尾部强化段",
  "proxy.boostHint": "在最后一条用户消息的末尾再放一次相同指令，约束更强。",
  "proxy.boundary": "只改请求体，不碰接口地址、请求头与凭据；Responses 的 WebSocket 传输不经过代理层。",
  "proxy.directive": "注入指令",
  "proxy.enable": "启用请求代理托管",
  "proxy.enableHint": "开启后会在宿主代理脚本里维护一段托管内容；关闭不会自动删除，请用「还原」。",
  "proxy.exists": "文件存在",
  "proxy.foreignHook": "段外已有 onRequest",
  "proxy.force": "强制覆盖被改动过的托管段，或清理插件残留",
  "proxy.residue": "插件残留",
  "proxy.residueUnconfirmed": "有孤立标记，无法自动确认",
  "proxy.hint": "面板只替换两个标记之间的内容；写入前会快照原文件。",
  "proxy.path": "代理脚本",
  "proxy.previewEmpty": "代理脚本尚不存在",
  "proxy.previewTitle": "脚本末尾预览",
  "proxy.probeEmpty": "还没有记录到经过代理的对话请求",
  "proxy.probeHint": "托管段按抽样间隔（首次必记）把注入记录追加到探针日志，用来确认注入确实生效；达到大小上限后停止写入。",
  "proxy.probeMode": "注入位置",
  "proxy.probeProvider": "协议",
  "proxy.probeTime": "时间",
  "proxy.probeTitle": "注入探针",
  "proxy.providers": "生效协议",
  "proxy.restore": "还原脚本",
  "proxy.restoreConfirm": "还原会用应用前快照整体覆盖代理脚本，托管段之外你手写的内容也会一并覆盖。确定继续？",
  "proxy.restored": "已还原代理脚本",
  "proxy.restoreRemoved": "脚本只剩托管段，已删除该文件",
  "proxy.restoreStripped": "已移除代理托管段：没有可用的应用前快照，段外内容未逐字还原",
  "proxy.restoreDegraded": "应用前快照已丢失（{{id}}）：本次只移除了托管段，原文未能还原",
  "proxy.restoreCleaned": "已清理 {{count}} 处插件残留（脚本里没有完整的托管段）",
  "proxy.restoreRecreated": "代理脚本此前被删除，已按应用前快照重建",
  "proxy.restoreResidueConfirm": "脚本里检测到插件残留（标记被删掉一半的旧托管段）：本次只清理这些残留，托管段之外你写的内容不会改动。确定继续？",
  "proxy.restoreNoop": "没有可还原的内容：脚本不存在或已无托管段",
  "proxy.save": "保存并应用",
  "proxy.title": "请求代理托管",
  "settings.abilities": "能做什么",
  "settings.ability.approval": "读写全局与项目免审批工具清单，展示敏感命令规则。",
  "settings.ability.audit": "记录并展示插件动作流水，联查宿主应用日志。",
  "settings.ability.backup": "应用前自动快照，支持按层回滚与清理。",
  "settings.ability.prompt": "写入、更新、删除固定的系统提示词条目，支持预设。",
  "settings.ability.proxy": "在代理脚本里维护托管段，按协议注入指令，并提供注入探针。",
  "settings.ability.role": "在全局角色文件里维护标记段，保留用户原有内容。",
  "settings.ability.selfcheck": "逐层核对通道、提示词、角色、代理、探针与免审批清单，并给出证据。",
  "settings.autoSnapshot": "应用前自动快照",
  "settings.autoSnapshotHint": "每层第一次应用前保存一份原值；关闭后需要自行备份。",
  "settings.enabled": "启用托管",
  "settings.enabledHint": "关闭后点顶部「应用」会撤回本插件写入的内容；各页面点保存只保存配置，不写入宿主、也不撤回。",
  "settings.limit.host": "不复刻宿主 asar 补丁与锚点重定位。",
  "settings.limit.restart": "不自动重启宿主，也不代替你决定何时生效。",
  "settings.limit.sensitive": "不代为批准敏感命令。",
  "settings.limit.sidebar": "没有左侧栏整页，功能都在这个右侧面板里。",
  "settings.limit.updater": "不做自建更新器，升级交给插件市场。",
  "settings.limits": "做不到什么",
  "settings.corruptHint": "插件配置内容已损坏，已进入只读保护：修复前不会写入任何配置。",
  "settings.readFailedHint": "读取插件配置失败：当前显示的是插件默认配置，不代表已保存的设置；读取恢复前保存会被拒绝，请稍后刷新面板重试。",
  "settings.repair": "修复配置",
  "settings.repairConfirm": "修复会用默认配置重建插件设置，撤回记账将不可用；原始损坏内容会先另存到插件数据目录。确定继续？",
  "settings.repairNotNeeded": "配置可以正常解析，无需修复",
  "settings.repaired": "已重建插件配置，损坏内容已另存：{{file}}",
  "settings.saved": "设置已保存",
  "settings.title": "插件设置"
};

// locales/zh-TW.json
var zh_TW_default = {
  "app.title": "Purge",
  "tab.status": "狀態",
  "tab.prompts": "提示詞",
  "tab.approval": "免確認",
  "tab.redteam": "紅隊",
  "tab.proxy": "請求代理",
  "tab.backup": "備份",
  "tab.audit": "審計",
  "tab.settings": "設定",
  "action.add": "新增",
  "action.apply": "套用",
  "action.delete": "刪除",
  "action.load": "讀取",
  "action.recheck": "重新自檢",
  "action.refresh": "重新整理",
  "action.remove": "移除",
  "action.retry": "重試",
  "action.revert": "撤回",
  "action.save": "儲存",
  "common.actions": "操作",
  "common.loading": "載入中…",
  "common.no": "否",
  "common.off": "關閉",
  "common.on": "開啟",
  "common.state": "狀態",
  "common.yes": "是",
  "error.backgroundUnavailable": "連不上外掛的背景服務：請確認外掛已啟用，然後關閉並重新開啟面板。",
  "error.generic": "操作失敗：{{message}}",
  "error.netUnavailable": "宿主沒有開放網路能力：請在外掛隱私宣告裡保留 network。",
  "error.pending": "背景還沒有發布連線記錄：請關閉並重新開啟外掛面板。",
  "error.timeout": "請求逾時：背景可能正在處理寫入動作，請稍後重新整理確認結果。",
  "error.title": "發生錯誤",
  "notice.applied": "已套用",
  "notice.noop": "沒有啟用任何託管層：本次沒有寫入宿主，也沒有改動已託管的內容。要讓它生效，請先在「提示詞」或「請求代理」頁開啟對應的託管層，再點頂部「套用」。",
  "notice.appliedRecordFailed": "已寫入宿主，但撤回記帳沒有儲存成功（{{reason}}）：現在點「撤回」無法自動撤下這次寫入的內容，請在儲存恢復後重新點「套用」補寫記帳。",
  "notice.recordFailed": "記帳沒有寫入（{{reason}}）",
  "notice.revertRecordFailed": "已撤回，但殘留記帳沒有清掉（{{reason}}）：再點一次「撤回」會重試",
  "notice.noSnapshot": "已套用，但這些層沒有建立快照：{{steps}}",
  "notice.partial": "部分步驟失敗：{{steps}}",
  "notice.revertEmpty": "沒有需要撤回的託管內容",
  "notice.revertPartial": "撤回未全部完成：{{steps}}",
  "notice.revertPartialBySwitch": "已撤回（託管總開關處於關閉狀態），但有些層撤回失敗：{{steps}}",
  "notice.reverted": "已撤回",
  "notice.revertedBySwitch": "已撤回：託管總開關處於關閉狀態，本次點「套用」執行的是撤回",
  "notice.savedWhileDisabled": "設定已儲存，但託管總開關處於關閉狀態：本次沒有寫入宿主，也沒有撤回任何已託管的層。要讓它生效，請先在「設定」頁開啟「啟用託管」，再點頂部「套用」。",
  "status.approval": "免審批清單",
  "status.approvalTracked": "撤回記帳裡 {{count}} 個工具由本外掛新增",
  "status.approvalNone": "本外掛未新增",
  "status.approvalUnknown": "沒有撤回記帳，無法判斷",
  "status.boundaries": "能力邊界",
  "status.boundary.host": "不修改宿主安裝目錄，也不打宿主補丁：那部分在 Snow App 裡沒有對應機制。",
  "status.boundary.proxy": "請求代理只維護自己的託管段；段外內容不動，發現衝突會讓位。",
  "status.boundary.sensitive": "敏感命令不能由外掛代為批准，只能由你在電腦端確認。",
  "status.boundary.sidebar": "Snow App 沒有左側欄整頁容器，本外掛以右側面板提供同樣的功能。",
  "status.connecting": "正在連線背景",
  "status.enabled": "託管總開關",
  "status.fail": "失敗",
  "status.layers": "自檢分層",
  "status.lastApplied": "上次套用",
  "status.loading": "正在自檢…",
  "status.managed": "託管內容",
  "status.neverApplied": "還沒有套用過任何託管內容。",
  "status.off": "未啟用",
  "status.ok": "正常",
  "status.port": "連接埠",
  "status.prompt": "系統提示詞",
  "status.proxy": "請求代理",
  "status.role": "全域角色規則",
  "status.summary": "彙總",
  "status.uninstallHint": "解除安裝或停用外掛不會自動撤回上面這些託管內容：請先點「撤回」，再解除安裝。",
  "status.warn": "待確認",
  "prompts.active": "啟用這條提示詞",
  "prompts.content": "提示詞正文",
  "prompts.managedBadge": "已託管",
  "prompts.name": "項目名稱",
  "prompts.namePlaceholder": "例如：Purge 託管指令",
  "prompts.noCustom": "還沒有自訂預設。把目前內容存成預設，下次可以一鍵載入。",
  "prompts.notApplied": "未寫入",
  "prompts.notInLibrary": "提示詞庫裡還沒有這條項目，點「儲存並套用」才會寫入。",
  "prompts.presetLoaded": "已載入預設：{{name}}",
  "prompts.presetDeleteConfirm": "再點一次確認刪除預設「{{name}}」，刪除後可在本頁復原",
  "prompts.presetDeleteArmed": "確認刪除",
  "prompts.presetDeleted": "已刪除預設：{{name}}",
  "prompts.presetOverwriteConfirm": "編輯框裡有未儲存的變更，再點一次會用「{{name}}」覆蓋目前草稿",
  "prompts.presetOverwriteArmed": "覆蓋並載入",
  "prompts.presetRecycleHint": "已刪除預設「{{name}}」，副本還留在本頁",
  "prompts.presetRestored": "已復原預設：{{name}}",
  "prompts.presetUndo": "復原刪除",
  "prompts.unreadableBadge": "讀不到",
  "prompts.unreadableHint": "請到宿主「設定 - 提示詞」核對；若確實讀不到，只能在那裡手動刪除託管項目",
  "prompts.unreadableTitle": "讀不到宿主的系統提示詞庫",
  "prompts.presetNamePlaceholder": "預設名稱",
  "prompts.presetNameRequired": "請先填寫預設名稱",
  "prompts.presetSaved": "預設已儲存",
  "prompts.presets": "預設",
  "prompts.presetsHint": "預設只填入編輯框，不會自動寫入宿主；確認後再點儲存。",
  "prompts.proxyHint": "請求代理目前已啟用：這裡改完提示詞後，記得回到「請求代理」頁重新套用一次，代理裡的注入指令才會跟著更新。",
  "prompts.remove": "刪除託管項目",
  "prompts.removeArmed": "確認刪除託管項目",
  "prompts.removeConfirm": "再點一次確認刪除宿主提示詞庫中的託管項目：外掛不保留副本，只有套用前該項目已存在時，才能在「備份」頁回滾「提示詞」快照找回原值",
  "prompts.removed": "已刪除託管提示詞項目",
  "prompts.roleEnable": "角色規則託管",
  "prompts.roleFile": "全域 ROLE 檔案",
  "prompts.roleHint": "寫入的是標記段，標記外的內容原樣保留；撤回時只移除託管段。",
  "prompts.roleRestore": "移除託管段",
  "prompts.roleRestoreArmed": "確認移除並清空草稿",
  "prompts.roleRestoreConfirm": "再點一次確認移除託管段：編輯框裡的規則草稿會一併清空，要保留請先「存為預設」",
  "prompts.roleRestored": "已移除角色檔案裡的託管段",
  "prompts.roleSave": "儲存並套用",
  "prompts.roleTitle": "全域角色規則",
  "prompts.saveApply": "儲存並套用",
  "prompts.savePreset": "存為預設",
  "prompts.systemHint": "寫入系統提示詞庫裡的固定項目（snow-purge.directive），啟用後對之後的對話生效。",
  "prompts.systemTitle": "系統提示詞",
  "prompts.usePreset": "載入",
  "approval.empty": "清單為空",
  "approval.emptyNotSavable": "全域清單不能儲存為空：要清空請到宿主設定的權限頁操作",
  "approval.globalHint": "面板顯示的是宿主目前的全域清單。儲存會用編輯後的完整清單覆蓋它，請確認沒有漏掉項目；全域清單對所有專案生效，新增項在這些專案裡不再彈出授權確認（已開啟的對話需重新開啟後依新清單判定）。本次新增的授權會記入撤回依據，撤回只撤下本外掛新增的項目。清單不能儲存為空，要清空請到宿主設定的權限頁操作。",
  "approval.globalDiff": "待寫入：共 {{total}} 項，新增 {{added}} 項，移除 {{removed}} 項（全域清單對所有專案生效）",
  "approval.globalSaved": "全域免審批清單已儲存",
  "approval.staleList": "全域清單在你開啟面板之後已被外部修改（例如在宿主設定頁或另一個視窗新增了授權）：本次沒有儲存。已重新整理基準，請核對最新清單後再點一次儲存。",
  "approval.globalTitle": "全域免審批工具",
  "approval.unreadableTitle": "讀不到宿主的免審批清單",
  "approval.unreadableNotSavable": "讀不到宿主目前的全域清單，已禁止儲存，避免把整表覆蓋成空",
  "approval.unreadableHint": "請到宿主設定的權限頁核對；若權限設定檔損壞或不可讀，先修復該檔案再重試",
  "approval.grant": "授權",
  "approval.invalidTool": "工具名稱不合法：只允許字母、數字與 . _ : - /",
  "approval.pattern": "比對模式",
  "approval.projectEmpty": "該專案還沒有免審批工具",
  "approval.projectLoadFirst": "填寫專案識別後點「讀取」，確認清單屬於該專案再寫入",
  "approval.projectLoadRequired": "還沒有讀取任何專案的清單：請先填寫專案識別並點「讀取」",
  "approval.projectReloadRequired": "專案識別與已讀取的清單不一致：請先點「讀取」，確認清單屬於該專案後再授權或撤下",
  "approval.projectUnreadable": "讀不到該專案的免審批清單，已禁止寫入，避免把既有授權當作空清單處理",
  "approval.projectTarget": "目標專案：{{projectId}}",
  "approval.projectCount": "本次提交 {{count}} 個工具",
  "approval.projectGranted": "已授權專案工具",
  "approval.projectHint": "專案識別與宿主權限域使用同一口徑；不確定時先讀取一次，確認清單再寫入。專案清單只作用於這個專案，不影響其它專案。本次新增的授權會記入撤回依據，撤回只撤下本外掛新增的項目。",
  "approval.projectLimitReached": "授權已寫入宿主，但本次新增項沒有全部記入撤回依據（專案撤回記帳已達上限）：撤回不會自動撤下它們，請到宿主權限頁核對或先清理不再使用的專案記帳。",
  "approval.projectPlaceholder": "專案識別，例如 local:/path/to/project",
  "approval.projectRequired": "請先填寫專案識別",
  "approval.projectRevoked": "已撤下專案工具",
  "approval.projectTitle": "專案層免審批工具",
  "approval.projectToolsPlaceholder": "每行一個工具全名",
  "approval.replaceWarn": "整表覆蓋",
  "approval.revoke": "撤下",
  "approval.ruleId": "規則",
  "approval.saveGlobal": "儲存全域清單",
  "approval.sensitiveBoundary": "敏感命令規則唯讀展示：外掛不改寫、不刪除、也不重設這些規則，符合這些規則的操作仍需你本人確認。",
  "approval.sensitiveEmpty": "沒有敏感命令規則",
  "approval.sensitiveHint": "這裡只展示宿主目前的敏感命令規則，用於核對哪些操作仍需你本人確認。",
  "approval.sensitiveTitle": "敏感命令規則",
  "approval.toolPlaceholder": "工具全名，按 Enter 新增",
  "approval.toolRequired": "請至少填寫一個工具名稱",
  "redteam.title": "紅隊技能庫",
  "redteam.hint": "上游 dsh-purge 的 23 份紅隊技能原文隨外掛一起安裝。點「安裝」只把 SKILL.md 寫進 ~/.snow/skills，不下載工具、不執行命令；裝好後在宿主的 Skills 設定裡即可看到並啟停。",
  "redteam.libraryDir": "技能庫",
  "redteam.skillsDir": "安裝目錄",
  "redteam.enabledCount": "已啟用",
  "redteam.library": "技能列表",
  "redteam.allRoles": "全部",
  "redteam.empty": "技能庫為空：確認外掛安裝目錄裡帶 skills/redteam。",
  "redteam.installAll": "全部安裝",
  "redteam.install": "安裝",
  "redteam.reinstall": "覆蓋安裝",
  "redteam.update": "更新",
  "redteam.view": "檢視",
  "redteam.enable": "啟用",
  "redteam.disable": "停用",
  "redteam.close": "收合",
  "redteam.state.broken": "檔案異常",
  "redteam.state.enabled": "已啟用",
  "redteam.state.disabled": "已停用",
  "redteam.state.notInstalled": "未安裝",
  "redteam.installed": "已安裝：{{name}}",
  "redteam.updated": "已覆蓋更新：{{name}}",
  "redteam.enabled": "已啟用：{{name}}",
  "redteam.disabled": "已停用：{{name}}",
  "redteam.removed": "已移除：{{name}}，原目錄在 plugin-data 回收區",
  "redteam.installDone": "已安裝 {{count}} 項技能",
  "redteam.installPartial": "有 {{count}} 項安裝失敗，詳見審計頁",
  "redteam.previewHint": "這是技能庫裡的原文，先核對內容再決定是否安裝。",
  "redteam.env.title": "環境自檢",
  "redteam.env.hint": "只讀環境變數與 ~/.snow/.env（若存在），不執行任何工具。只取 FOFA_KEY、REDTEAM_VPS_HOST、REDTEAM_VPS_KEY 三個鍵：金鑰只顯示長度，私鑰只在確認為本機路徑時顯示路徑，主機位址只顯示長度。缺項不影響技能安裝。",
  "redteam.env.item": "項目",
  "redteam.env.evidence": "證據",
  "redteam.env.fofa": "FOFA_KEY",
  "redteam.env.vpsHost": "VPS 主機",
  "redteam.env.vpsKey": "VPS 私鑰",
  "redteam.env.toolkit": "工具箱目錄",
  "redteam.env.setupMarker": "完成標記",
  "redteam.env.tools": "工具",
  "redteam.env.ok": "就緒",
  "redteam.env.warn": "缺失",
  "redteam.env.off": "未設定",
  "redteam.env.missing": "未找到",
  "redteam.boundary.title": "能做到哪一步",
  "redteam.boundary.skills": "能做：安裝、啟停、移除這些技能文件。它們只是操作手冊，真正執行仍由對話裡的 Agent 按你的授權去做。",
  "redteam.boundary.tools": "不做：不下載、不安裝 fscan / nuclei / chisel 等二進位，也不代為執行任何掃描或利用命令。",
  "redteam.boundary.workflow": "不做：上游的 redteam_preflight、任務鏈編排與報告生成是它自己的工具，Snow App 外掛不能註冊這類工具，只提供同口徑的唯讀檢查。",
  "redteam.boundary.legal": "只在你自己擁有或已獲授權的環境中使用；涉及他人系統時先取得書面許可。",
  "roster.open": "編隊視圖",
  "roster.title": "紅隊編隊",
  "roster.close": "關閉",
  "roster.installAll": "全部編入",
  "roster.installAllConfirm": "確認覆蓋同名子代理",
  "roster.install": "編入",
  "roster.reinstall": "重新編入",
  "roster.update": "更新設定",
  "roster.state.ready": "已編入",
  "roster.state.stale": "建議更新",
  "roster.state.pending": "未編入",
  "roster.state.indexOnly": "已編入（僅索引）",
  "roster.verify.hint": "{{count}} 個角色僅依本外掛的寫入記錄顯示：宿主只把目前專案的子代理回傳給外掛，全域角色被刪除時這裡讀不到。若在宿主設定裡刪過角色，請點「重新編入」。",
  "roster.toast.installed": "已把角色寫入子代理設定",
  "roster.toast.updated": "已覆蓋更新角色設定",
  "roster.toast.removed": "已從子代理設定移除該角色",
  "roster.toast.allDone": "5 個角色已全部編入",
  "roster.toast.partial": "有 {{count}} 個角色寫入失敗，詳見審計頁",
  "roster.toast.overwritten": "覆蓋了宿主回傳的同名記錄 {{name}}，原設定已備份到 {{file}}",
  "roster.toast.overwrittenAll": "全部編入完成，其中 {{count}} 個宿主回傳的同名記錄被覆蓋，原設定已備份",
  "roster.toast.unverified": "{{name}} 已編入；宿主只按目前專案回傳子代理，讀不到同名的全域記錄：若存在已被覆蓋且無法自動備份。需要保留時請先在宿主設定的子代理頁備份原設定。",
  "roster.toast.unverifiedAll": "全部編入完成；其中 {{count}} 個角色讀不到同名的全域記錄，若存在已被覆蓋且無法自動備份。需要保留時請先在宿主設定的子代理頁備份原設定。",
  "roster.toast.projectConflict": "{{name}} 已編入全域；目前專案裡還有同名記錄，專案層級設定會優先生效",
  "roster.toast.indexFailed": "{{name}} 已寫入宿主，但外掛未能記錄編入索引（{{message}}）。面板可能顯示為未編入，請重新編入或檢查外掛資料目錄權限。",
  "roster.toast.indexFailedAll": "{{count}} 個角色已寫入宿主，但外掛未能記錄編入索引（{{message}}）。請重新編入或檢查外掛資料目錄權限。",
  "roster.toast.backupSaved": "已備份 {{name}} 的舊設定到 {{file}}",
  "roster.core": "主控會話",
  "roster.coreSub": "編排與彙報",
  "roster.netHint": "節點是子代理角色，連線表示由主控派活。編入狀態以本外掛的寫入記錄為準（宿主讀取介面按專案過濾，讀不到全域角色，因此全域角色被刪除時外掛也無法核對）。宿主目前只向插件回傳主會話記錄，角色狀態與 token / 耗時 / 請求數未提供，面板不會用 0 值代替。",
  "roster.members": "編隊成員",
  "roster.membersHint": "點角色名選中，左側顯示詳情",
  "roster.member.in": "已編入",
  "roster.member.out": "未編入",
  "roster.prompt": "系統提示詞",
  "roster.promptHide": "收起提示詞",
  "roster.boundary": "只寫設定：角色、系統提示詞與工具白名單會寫進宿主 subAgents，不啟動子代理、不下載工具，也不代你核准敏感命令。",
  "roster.role.redteam_recon.name": "資產測繪",
  "roster.role.redteam_recon.desc": "鋪開授權範圍內的公開資產：網域、子網域、IP、連接埠、憑證與 Web 指紋，輸出帶來源的資產表。",
  "roster.role.redteam_recon.t1": "從網域與憑證透明日誌整理子網域，標註來源與信賴度",
  "roster.role.redteam_recon.t2": "對存活主機做連接埠與服務識別，記錄版本指紋",
  "roster.role.redteam_recon.t3": "彙總資產表，標出值得進一步驗證的暴露面",
  "roster.role.redteam_assess.name": "風險評估",
  "roster.role.redteam_assess.desc": "把資產清單歸併成攻擊面並排優先順序，只做判斷與排序，不執行驗證。",
  "roster.role.redteam_assess.t1": "依暴露程度與業務重要性給資產分級",
  "roster.role.redteam_assess.t2": "把元件版本與公開漏洞庫對照，標註匹配度",
  "roster.role.redteam_assess.t3": "輸出 P0-P3 風險表與下一輪驗證建議",
  "roster.role.redteam_vuln_scan.name": "漏洞掃描",
  "roster.role.redteam_vuln_scan.desc": "用針對性範本做檢測，把疑似問題變成可重現證據，全程控制速率與併發。",
  "roster.role.redteam_vuln_scan.t1": "依指紋選擇範本集，限定目標、併發與速率",
  "roster.role.redteam_vuln_scan.t2": "對命中項複核最小請求，排除誤報",
  "roster.role.redteam_vuln_scan.t3": "輸出結果表與可重現命令，標註誤報風險",
  "roster.role.redteam_exploit.name": "利用驗證",
  "roster.role.redteam_exploit.desc": "把已確認漏洞做成最小可重現驗證，證明影響面而不追求破壞力。",
  "roster.role.redteam_exploit.t1": "為每個漏洞設計最小驗證步驟與回退方案",
  "roster.role.redteam_exploit.t2": "記錄關鍵請求、回應與證據，控制在無害範圍",
  "roster.role.redteam_exploit.t3": "清理現場與臨時連線，給出影響判斷",
  "roster.role.redteam_internal.name": "內網橫向",
  "roster.role.redteam_internal.desc": "在授權涵蓋的內網段內做資產發現、橫向路徑分析與提權評估。",
  "roster.role.redteam_internal.t1": "低雜訊存活與連接埠發現，繪製內網拓撲",
  "roster.role.redteam_internal.t2": "分析可達關係與憑證類型，規劃橫向路徑",
  "roster.role.redteam_internal.t3": "視需要開通道並立即關閉，輸出觸達結論",
  "roster.badge.running": "執行中 {{count}}",
  "roster.badge.tasks": "任務 {{count}}",
  "roster.status.running": "執行中",
  "roster.status.completed": "已完成",
  "roster.status.failed": "失敗",
  "roster.status.cancelled": "已取消",
  "roster.status.idle": "閒置",
  "roster.status.unavailable": "未提供",
  "roster.status.pending": "未編入",
  "roster.status.queued": "待開始",
  "roster.status.missing": "會話已不在",
  "roster.net.title": "Agent 網路",
  "roster.net.totals": "累計 {{tokens}} token · {{requests}} 次模型請求",
  "roster.net.unavailable": "宿主未提供子代理會話資料",
  "roster.activity.none": "還沒有執行記錄",
  "roster.activity.unavailable": "未提供執行資料",
  "roster.meta.model": "模型",
  "roster.meta.tokens": "Token",
  "roster.meta.time": "耗時",
  "roster.meta.requests": "請求",
  "roster.meta.messages": "{{count}} 則訊息",
  "roster.value.unavailable": "未提供",
  "roster.search": "搜尋名稱",
  "roster.filter.all": "全部",
  "roster.filter.running": "執行中",
  "roster.filter.done": "已結束",
  "roster.filter.pending": "未編入",
  "roster.filter.empty": "沒有符合的角色",
  "roster.detail": "詳情",
  "roster.detail.lastConversation": "已關聯會話",
  "roster.dispatch.title": "派發任務",
  "roster.dispatch.hint": "派發會新建一個會話，由主代理把它交給這個角色執行。",
  "roster.dispatch.role": "角色",
  "roster.dispatch.target": "標的",
  "roster.dispatch.targetHint": "網域、IP 或網段，需在授權範圍內",
  "roster.dispatch.template": "任務",
  "roster.dispatch.templateHint": "可直接填寫，或從右側範本帶入",
  "roster.dispatch.pickTemplate": "選擇任務範本",
  "roster.dispatch.note": "補充說明",
  "roster.dispatch.noteHint": "額外限制、字典路徑或時間窗（選填）",
  "roster.dispatch.autoReply": "派發後會立即觸發一個回合",
  "roster.dispatch.send": "派發任務",
  "roster.dispatch.sending": "派發中",
  "roster.dispatch.done": "已新建會話並投遞任務",
  "roster.dispatch.pickRole": "請先選擇一個角色",
  "roster.dispatch.forRole": "派發",
  "roster.dispatch.notInstalled": "這個角色還沒編入：先在「編隊」裡點「編入」。",
  "roster.dispatch.templates": "任務範本（可多選）",
  "roster.dispatch.custom": "自訂任務",
  "roster.dispatch.customHint": "範本之外再加一條，按 Enter 加入",
  "roster.dispatch.add": "加入清單",
  "roster.dispatch.remove": "從清單移除",
  "roster.dispatch.queue": "待派發 {{count}} 條任務",
  "roster.dispatch.sendCount": "派發 {{count}} 條任務",
  "roster.dispatch.doneCount": "已派發 {{count}} 條任務（{{conversations}} 個會話）",
  "roster.dispatch.partial": "已派發 {{count}} 條任務，{{failed}} 條失敗",
  "roster.dispatch.empty": "先勾選一條範本，或新增一條自訂任務",
  "roster.dispatch.mode": "派發方式",
  "roster.dispatch.modeSingle": "同一會話依次執行",
  "roster.dispatch.modeSplit": "每條任務一個會話",
  "roster.dispatch.modeHint.single": "同一角色的範本通常有先後依賴：合在一個會話裡按編號執行，後一項直接複用前一項的產出，token 與目標側併發都更省。",
  "roster.dispatch.modeHint.split": "每條任務單獨開會話，彼此獨立、可分別重跑；適合不同標的或互不依賴的任務，但不會共享前一條的結果。",
  "roster.task.batch": "{{count}} 條任務：{{first}} 等",
  "roster.chain.title": "鏈路",
  "roster.chain.hint": "依順序自動接力：上一環的結論會交給下一環。暫停與停止只控制接力，不保證標的一端已停：遠端掃描與通道需另行收手。判定依賴宿主的會話清單與即時狀態；讀不到時本步會停下等待確認，不會猜完成。",
  "roster.chain.target": "標的",
  "roster.chain.steps": "環節與任務",
  "roster.chain.noteHint": "授權範圍、時間窗或額外限制（整條鏈路共用）",
  "roster.chain.orderHint": "依「測繪 → 評估 → 掃描 → 驗證 → 橫向」固定順序執行",
  "roster.chain.start": "啟動鏈路",
  "roster.chain.starting": "啟動中",
  "roster.chain.started": "鏈路已啟動，目前環節跑完會自動進入下一環",
  "roster.chain.failed": "鏈路第一步沒有派出去",
  "roster.chain.empty": "還沒有啟動過鏈路。選好環節、填上標的，點「啟動鏈路」。",
  "roster.chain.progress": "已完成 {{done}}/{{total}}",
  "roster.chain.pause": "暫停接力",
  "roster.chain.resume": "繼續",
  "roster.chain.skip": "跳過本步",
  "roster.chain.stop": "停止接力",
  "roster.chain.remove": "移除鏈路",
  "roster.chain.paused": "已暫停接力：目前環節的會話仍在執行",
  "roster.chain.resumed": "鏈路已繼續",
  "roster.chain.redispatch": "重新派發本步",
  "roster.chain.resumedRedispatched": "本步已重新派發，舊會話已中止",
  "roster.chain.resumedRedispatchedIdle": "本步已重新派發；舊會話未確認中止：{{reason}}，請到會話清單手動停止",
  "roster.chain.resumedStillRunning": "該會話仍在執行，鏈路會等它結束後再判斷本步",
  "roster.chain.resumedCompleted": "該會話其實已經跑完，繼續後會進入下一環",
  "roster.chain.resumedUnknown": "讀不到會話清單，未重新派發：切回發起專案後再點繼續",
  "roster.chain.redispatchFailed": "重新派發失敗：{{reason}}",
  "roster.chain.skipped": "已跳過目前步驟",
  "roster.chain.stopped": "已停止接力",
  "roster.chain.stopAborted": "已停止接力，並中止目前環節的會話",
  "roster.chain.stopIdle": "已停止接力；未送出中止：{{reason}}",
  "roster.chain.abortUnknown": "會話沒有進行中的回合",
  "roster.chain.skippedAborted": "已跳過目前步驟，目前會話已中止",
  "roster.chain.skippedIdle": "已跳過目前步驟；未送出中止：{{reason}}",
  "roster.chain.removed": "已移除鏈路",
  "roster.chain.removedAborted": "已移除鏈路，並中止了目前環節的會話",
  "roster.chain.removedIdle": "已移除鏈路；未發出中止：{{reason}}",
  "roster.chain.status.running": "進行中",
  "roster.chain.status.paused": "已暫停",
  "roster.chain.status.blocked": "已阻塞",
  "roster.chain.status.completed": "已完成",
  "roster.chain.status.stopped": "已停止",
  "roster.tasks.title": "任務",
  "roster.tasks.hint": "狀態依會話執行情況推斷，僅供參考",
  "roster.tasks.empty": "還沒有派發過任務",
  "roster.task.open": "開啟會話",
  "roster.task.remove": "移除記錄",
  "roster.task.opened": "已切換到任務會話",
  "roster.task.removed": "已移除任務記錄",
  "roster.task.notFound": "任務記錄已不存在，清單已重新整理",
  "roster.task.archived": "較早的 {{count}} 條任務記錄已封存保留，不再佔用清單",
  "roster.tab.chain": "鏈路",
  "roster.chain.singleStep": "單步執行",
  "roster.chain.edit": "編輯任務",
  "roster.chain.collapse": "收起",
  "roster.chain.records": "鏈路記錄",
  "roster.chain.stepDefault": "預設任務書",
  "roster.chain.stepTasks": "{{count}} 條任務",
  "roster.chain.stepLimit": "每步最多 {{max}} 條任務：先移除一條再加",
  "roster.chain.stepOver": "{{count}} 條任務（超過上限 {{max}} 條，啟動前需要刪減）",
  "roster.chain.trimmed": "（{{archived}} 條舊記錄已封存保留，{{truncated}} 條任務超過單步上限未派發）",
  "roster.chain.stepAdd": "加入本步",
  "roster.chain.stepAddHint": "在本步預設任務之外再加一條，按 Enter 加入",
  "roster.chain.stepRemove": "從本步移除",
  "roster.chain.stepReset": "恢復預設任務書",
  "roster.chain.toggleStep": "把「{{name}}」加入或移出鏈路",
  "roster.chain.review": "{{count}} 個環節 · 標的 {{target}} · 將新建 {{sessions}} 個會話、派發 {{tasks}} 條任務",
  "roster.chain.confirm": "再點一次「確認啟動」：標的 {{target}}，將新建 {{sessions}} 個會話，派發 {{tasks}} 條任務",
  "roster.chain.confirmImpact": "所選環節含 {{names}}，屬高影響角色，請先確認標的與授權範圍",
  "roster.chain.startConfirm": "確認啟動（{{sessions}} 個會話 / {{tasks}} 條任務）",
  "roster.chain.blocked.target": "填上標的就能啟動",
  "roster.chain.blocked.steps": "至少保留一個環節",
  "roster.chain.blocked.roles": "先編入這些角色：{{names}}",
  "roster.chain.blocked.stepLimit": "「{{name}}」有 {{count}} 條任務，單步最多 {{max}} 條：先刪減再啟動",
  "roster.chain.blocked.active": "最多同時保留 {{max}} 條未結束的鏈路（進行中或阻塞）：先在下方記錄裡停止或移除一條再啟動",
  "roster.chain.brief.redteam_recon": "對標的做資產測繪：子網域、存活主機、連接埠與服務指紋，輸出帶來源的資產表，並標出值得進一步驗證的暴露面。只做資訊收集，不做漏洞驗證。",
  "roster.chain.brief.redteam_assess": "基於上一環節的資產表，依暴露程度與業務重要性給出 P0-P3 排序，說明每一級的判斷依據，並給出下一輪驗證建議。只做判斷與排序，不執行驗證。",
  "roster.chain.brief.redteam_vuln_scan": "對 P0/P1 資產做針對性範本檢測，限定目標、併發與速率，輸出可重現命中、判定依據與誤報風險。不做利用，不擴大驗證範圍。",
  "roster.chain.brief.redteam_exploit": "對已確認的漏洞做最小可重現驗證，只取一條無害證據，不做資料刪除、不植入持久化、不做橫向移動。每次行動前寫清預期結果與回退方案。",
  "roster.chain.brief.redteam_internal": "以既有立足點為起點做低雜訊內網發現與橫向路徑分析，通道用完即關，輸出可達關係、憑證類型與最高價值目標。",
  "roster.summary": "編入 {{installed}}/{{total}} · 執行中 {{running}} · 待跑任務 {{tasks}}",
  "roster.refresh": "重新整理資料",
  "roster.installing": "編入中",
  "roster.installingAll": "編入中",
  "roster.installAllCount": "全部編入（{{count}}）",
  "roster.installAllHint": "只編入尚未編入的角色；宿主只按專案回傳子代理，同名全域記錄讀不到，覆蓋前無法自動備份。",
  "roster.tab.roster": "編隊",
  "roster.tab.dispatch": "派發",
  "roster.tab.tasks": "任務",
  "roster.tab.chains": "{{count}} 條鏈路執行中",
  "roster.stale": "重新整理失敗：{{message}}。目前顯示的是上次讀到的資料。",
  "roster.indexBroken.hint": "編隊索引無法使用（{{message}}）：角色可能已編入卻顯示為未編入，請點「編入」重新核對。",
  "roster.updated.none": "尚未同步",
  "roster.updated.just": "剛剛更新",
  "roster.updated.seconds": "{{count}} 秒前更新",
  "roster.updated.minutes": "{{count}} 分鐘前更新",
  "roster.net.caption": "五個角色子代理，連線表示由主控派活。",
  "roster.help": "說明與邊界",
  "roster.helpHide": "收起說明",
  "roster.search.clear": "清除搜尋",
  "roster.empty.filtered.title": "沒有符合的角色",
  "roster.empty.filtered.hint": "換個關鍵字，或清掉篩選，看看全部角色。",
  "roster.empty.filtered.action": "清除篩選",
  "roster.empty.tasks.title": "還沒有派發過任務",
  "roster.empty.tasks.hint": "在「派發」裡選好角色、填上標的，任務就會出現在這裡。",
  "roster.empty.tasks.action": "去鏈路",
  "roster.confirm.remove": "確認移除",
  "roster.confirm.hint": "再點一次「確認移除」，{{name}} 的子代理設定會被刪除",
  "roster.confirm.foreignHint": "索引裡沒有 {{name}} 的編入記錄，宿主裡可能存在你手工建立的全域同名子代理：再點一次會依 agentId 刪除該全域記錄且無法復原。要保留請先在宿主設定的子代理頁備份。",
  "roster.confirm.driftHint": "{{name}} 的編入記錄來自舊版本的角色定義，宿主裡的全域同名記錄可能已被手工改過：再點一次會刪除該記錄，要保留請先備份。",
  "roster.confirm.indexBrokenHint": "讀取編隊索引失敗，無法確認 {{name}} 是哪個版本寫入的記錄：再點一次會依 agentId 刪除該全域記錄，要保留請先在宿主設定的子代理頁備份。",
  "roster.confirm.task": "確認刪除",
  "roster.confirm.taskHint": "再點一次「確認刪除」，這筆記錄會被移除（會話本身不受影響）",
  "roster.confirm.chainHint": "再點一次「確認移除」：這條鏈路記錄會被移除，進行中的會話會先被中止（中止可能失敗）",
  "roster.confirm.skip": "確認跳過",
  "roster.confirm.skipHint": "再點一次「確認跳過」：目前環節的會話會被中止，下一環立即開始",
  "roster.toast.removedName": "已移除 {{name}}，隨時可以重新編入",
  "roster.toast.removedForeignName": "已移除 {{name}} 的全域記錄；索引裡沒有本外掛的編入記錄，無法確認它是否由你手工建立，如已誤刪請到宿主設定的子代理頁重建。",
  "roster.toast.removeBlockedName": "{{name}} 未確認移除，請到宿主的子代理設定裡核對",
  "roster.toast.notInstalledName": "{{name}} 尚未安裝，無需移除",
  "roster.toast.removedGlobalOnly": "已移除 {{name}} 的全域設定，但仍有 {{count}} 個專案作用域存在同名記錄，請到宿主的子代理設定裡依專案刪除",
  "roster.toast.removedWithBackup": "已移除 {{name}}；編入時備份的原設定仍在本機：{{file}}（需手工寫回宿主）",
  "roster.conflict.hint": "索引裡沒有 {{name}} 的編入記錄：無法確認宿主端是否已有同名的全域子代理，再點一次「編入」會直接覆蓋，且無法自動備份。需要保留時請先在宿主設定的子代理頁備份。",
  "roster.conflict.allHint": "{{count}} 個角色在索引裡沒有編入記錄（{{names}}）：無法確認宿主端是否已有同名的全域子代理，再點一次「確認覆蓋」會直接覆蓋，且無法自動備份。需要保留時請先在宿主設定的子代理頁備份。",
  "roster.detail.templates": "任務範本",
  "roster.detail.tools": "工具白名單 {{count}} 項",
  "roster.dispatch.targetHelp": "只在你自己擁有或已獲授權的目標上派發。",
  "roster.dispatch.duplicate": "這條任務已經在清單裡",
  "roster.dispatch.review": "將派發給「{{name}}」，共 {{count}} 條",
  "roster.dispatch.blocked.role": "先把這個角色編入，再派發任務",
  "roster.dispatch.blocked.target": "填上標的就能派發",
  "roster.dispatch.blocked.queue": "先選一條範本，或自己寫一條",
  "roster.queue.title": "待派發清單",
  "roster.queue.count": "{{count}} 條",
  "roster.queue.empty": "還沒有選任務：從左邊勾範本，或自己寫一條。",
  "roster.chain.summary": "{{count}} 條記錄 · {{active}} 條進行中",
  "audit.action": "動作",
  "audit.detail": "詳情",
  "audit.empty": "還沒有外掛動作記錄",
  "audit.failed": "失敗",
  "audit.hint": "外掛把自己的每次套用、撤回、寫入都記在這裡，最多保留 200 筆。",
  "audit.levelAll": "全部等級",
  "audit.logsDenied": "讀不到應用日誌：{{reason}}",
  "audit.logsEmpty": "沒有符合條件的日誌",
  "audit.logsHint": "讀取宿主應用日誌用於對照，只在開啟本頁時讀取一次。清空會刪除日誌庫的全部記錄，涵蓋所有工作階段與系統日誌，不受目前篩選條件影響，且無法復原。",
  "audit.logsTitle": "應用日誌",
  "audit.modulePlaceholder": "模組，例如 api / requestProxy",
  "audit.ok": "成功",
  "audit.result": "結果",
  "audit.time": "時間",
  "audit.title": "動作流水",
  "audit.clear": "清空流水",
  "audit.clearConfirm": "確認清空",
  "audit.cleared": "動作流水已清空",
  "audit.logsClear": "清空全部應用日誌",
  "audit.logsClearConfirm": "確認清空全部應用日誌",
  "audit.logsClearTitle": "刪除宿主應用日誌庫的全部記錄，無法復原",
  "audit.logsCleared": "應用日誌已清空，共刪除 {{count}} 筆，無法復原",
  "backup.boundary": "備份只涵蓋本外掛會改動的東西：代理腳本原文、角色檔案、託管提示詞原值、免審批清單。",
  "backup.dir": "備份目錄",
  "backup.empty": "還沒有備份。第一次套用時會自動建立。",
  "backup.hint": "套用前自動快照，最多保留 30 份；回滾只影響對應那一層。",
  "backup.kind": "類型",
  "backup.kind.approval": "免審批清單",
  "backup.kind.other": "其它",
  "backup.kind.prompt": "提示詞",
  "backup.kind.proxy": "代理腳本",
  "backup.kind.role": "角色規則",
  "backup.restore": "回滾",
  "backup.confirm.approval": "這是免審批清單快照：回滾會用快照覆蓋全域清單（以及快照裡記錄的專案清單），套用後新增且不在快照裡的授權不會被保留。確定繼續？",
  "backup.confirm.other": "這是未知類型的快照：回滾會直接寫入宿主設定。確定繼續？",
  "backup.confirm.prompt": "這是提示詞快照：回滾會用套用前原值整條覆蓋 snow-purge.directive 這一條，其它提示詞條目不受影響。確定繼續？",
  "backup.confirm.proxyForce": "代理腳本在套用之後被手寫過。繼續回滾會連同這些內容一起覆蓋，確定繼續？",
  "backup.confirm.role": "這是角色規則快照：回滾會用套用前原文整份覆蓋全域角色檔案，託管段之外你之後手寫的規則也會一併覆蓋。確定繼續？",
  "backup.confirm.roleForce": "角色檔案裡託管段之外的內容與套用前快照不一致。繼續回滾會連同這些手寫內容一起覆蓋，確定繼續？",
  "backup.deleteArmed": "確認刪除",
  "backup.deleteConfirm": "再點一次確認刪除「{{kind}}」備份（{{time}}），刪除後這份快照無法還原",
  "backup.deleteFailed": "刪除失敗：後台沒有確認這次刪除，請重新整理後重試",
  "backup.deleted": "已刪除「{{kind}}」備份，剩餘 {{count}} 份",
  "backup.restoreProxyConfirm": "這是代理腳本快照：回滾會整份覆寫代理腳本，託管段之外你手寫的內容也會一併覆寫。確定繼續？",
  "backup.restored": "已依備份回滾",
  "backup.size": "大小",
  "backup.time": "時間",
  "backup.title": "本機備份",
  "proxy.blockAbsent": "無託管段",
  "proxy.blockHash": "段雜湊",
  "proxy.blockPresent": "託管段就位",
  "proxy.boost": "尾部強化段",
  "proxy.boostHint": "在最後一則使用者訊息的末尾再放一次相同指令，約束更強。",
  "proxy.boundary": "只改請求體，不碰介面位址、請求標頭與憑證；Responses 的 WebSocket 傳輸不經過代理層。",
  "proxy.directive": "注入指令",
  "proxy.enable": "啟用請求代理託管",
  "proxy.enableHint": "開啟後會在宿主代理腳本裡維護一段託管內容；關閉不會自動刪除，請用「還原」。",
  "proxy.exists": "檔案存在",
  "proxy.foreignHook": "段外已有 onRequest",
  "proxy.force": "強制覆蓋被改動過的託管段，或清理外掛殘留",
  "proxy.residue": "外掛殘留",
  "proxy.residueUnconfirmed": "有孤立標記，無法自動確認",
  "proxy.hint": "面板只替換兩個標記之間的內容；寫入前會快照原檔案。",
  "proxy.path": "代理腳本",
  "proxy.previewEmpty": "代理腳本尚不存在",
  "proxy.previewTitle": "腳本末尾預覽",
  "proxy.probeEmpty": "還沒有記錄到經過代理的對話請求",
  "proxy.probeHint": "託管段按抽樣間隔（首次必記）把注入記錄追加到探針日誌，用來確認注入確實生效；達到大小上限後停止寫入。",
  "proxy.probeMode": "注入位置",
  "proxy.probeProvider": "協定",
  "proxy.probeTime": "時間",
  "proxy.probeTitle": "注入探針",
  "proxy.providers": "生效協定",
  "proxy.restore": "還原腳本",
  "proxy.restoreConfirm": "還原會用套用前快照整份覆寫代理腳本，託管段之外你手寫的內容也會一併覆寫。確定繼續？",
  "proxy.restored": "已還原代理腳本",
  "proxy.restoreRemoved": "腳本只剩託管段，已刪除該檔案",
  "proxy.restoreStripped": "已移除代理託管段：沒有可用的套用前快照，段外內容未逐字還原",
  "proxy.restoreDegraded": "套用前快照已遺失（{{id}}）：本次只移除了託管段，原文未能還原",
  "proxy.restoreCleaned": "已清理 {{count}} 處外掛殘留（腳本裡沒有完整的託管段）",
  "proxy.restoreRecreated": "代理腳本先前被刪除，已依套用前快照重建",
  "proxy.restoreResidueConfirm": "腳本裡偵測到外掛殘留（標記被刪掉一半的舊託管段）：本次只清理這些殘留，託管段之外你寫的內容不會改動。確定繼續？",
  "proxy.restoreNoop": "沒有可還原的內容：腳本不存在或已無託管段",
  "proxy.save": "儲存並套用",
  "proxy.title": "請求代理託管",
  "settings.abilities": "能做什麼",
  "settings.ability.approval": "讀寫全域與專案免審批工具清單，展示敏感命令規則。",
  "settings.ability.audit": "記錄並展示外掛動作流水，聯查宿主應用日誌。",
  "settings.ability.backup": "套用前自動快照，支援按層回滾與清理。",
  "settings.ability.prompt": "寫入、更新、刪除固定的系統提示詞項目，支援預設。",
  "settings.ability.proxy": "在代理腳本裡維護託管段，按協定注入指令，並提供注入探針。",
  "settings.ability.role": "在全域角色檔案裡維護標記段，保留使用者原有內容。",
  "settings.ability.selfcheck": "逐層核對通道、提示詞、角色、代理、探針與免審批清單，並給出證據。",
  "settings.autoSnapshot": "套用前自動快照",
  "settings.autoSnapshotHint": "每層第一次套用前儲存一份原值；關閉後需要自行備份。",
  "settings.enabled": "啟用託管",
  "settings.enabledHint": "關閉後點頂部「套用」會撤回本外掛寫入的內容；各頁面點儲存只儲存設定，不寫入宿主、也不撤回。",
  "settings.limit.host": "不複製宿主 asar 補丁與錨點重定位。",
  "settings.limit.restart": "不自動重新啟動宿主，也不代替你決定何時生效。",
  "settings.limit.sensitive": "不代為批准敏感命令。",
  "settings.limit.sidebar": "沒有左側欄整頁，功能都在這個右側面板裡。",
  "settings.limit.updater": "不做自建更新器，升級交給外掛市集。",
  "settings.limits": "做不到什麼",
  "settings.corruptHint": "外掛設定內容已損壞，已進入唯讀保護：修復前不會寫入任何設定。",
  "settings.readFailedHint": "讀取外掛設定失敗：目前顯示的是外掛預設設定，不代表已儲存的設定；讀取恢復前儲存會被拒絕，請稍後重新整理面板再試。",
  "settings.repair": "修復設定",
  "settings.repairConfirm": "修復會用預設設定重建外掛設定，撤回記帳將無法使用；原始損壞內容會先另存到外掛資料目錄。確定繼續？",
  "settings.repairNotNeeded": "設定可以正常解析，無需修復",
  "settings.repaired": "已重建外掛設定，損壞內容已另存：{{file}}",
  "settings.saved": "設定已儲存",
  "settings.title": "外掛設定"
};

// locales/en.json
var en_default = {
  "app.title": "Purge",
  "tab.status": "Status",
  "tab.prompts": "Prompts",
  "tab.approval": "Approval",
  "tab.redteam": "Red team",
  "tab.proxy": "Request proxy",
  "tab.backup": "Backup",
  "tab.audit": "Audit",
  "tab.settings": "Settings",
  "action.add": "Add",
  "action.apply": "Apply",
  "action.delete": "Delete",
  "action.load": "Load",
  "action.recheck": "Re-check",
  "action.refresh": "Refresh",
  "action.remove": "Remove",
  "action.retry": "Retry",
  "action.revert": "Revert",
  "action.save": "Save",
  "common.actions": "Actions",
  "common.loading": "Loading…",
  "common.no": "No",
  "common.off": "Off",
  "common.on": "On",
  "common.state": "State",
  "common.yes": "Yes",
  "error.backgroundUnavailable": "Cannot reach the plugin background service. Make sure the plugin is enabled, then close and reopen this panel.",
  "error.generic": "Action failed: {{message}}",
  "error.netUnavailable": "The host did not grant network access: keep the network scope in the plugin privacy declaration.",
  "error.pending": "The background has not published a channel record yet: close and reopen the plugin panel.",
  "error.timeout": "Request timed out. The background may still be applying changes; refresh to confirm the result.",
  "error.title": "Something went wrong",
  "notice.applied": "Applied",
  "notice.noop": "No managed layer is enabled: nothing was written to the host and no managed content was changed. Turn on a layer on the Prompts or Request Proxy tab, then press Apply at the top.",
  "notice.appliedRecordFailed": "Written to the host, but the revert ledger could not be saved ({{reason}}). Revert cannot remove this change automatically: press Apply again once storage recovers to rewrite the ledger.",
  "notice.recordFailed": "The ledger was not written ({{reason}})",
  "notice.revertRecordFailed": "Reverted, but the residual ledger was not cleared ({{reason}}): click Revert again to retry",
  "notice.noSnapshot": "Applied, but these layers were not snapshotted: {{steps}}",
  "notice.partial": "Some steps failed: {{steps}}",
  "notice.revertEmpty": "Nothing to revert",
  "notice.revertPartial": "Revert incomplete: {{steps}}",
  "notice.revertPartialBySwitch": "Reverted (the master switch is off), but some layers failed to revert: {{steps}}",
  "notice.reverted": "Reverted",
  "notice.revertedBySwitch": "Reverted: the master switch is off, so this Apply ran as a revert",
  "notice.savedWhileDisabled": "Configuration saved, but the master switch is off: nothing was written to the host and no managed layer was reverted. To apply it, turn on Enable management in Settings, then press Apply at the top.",
  "status.approval": "Approved tools",
  "status.approvalTracked": "{{count}} tool(s) in the revert ledger were added by this plugin",
  "status.approvalNone": "None added by this plugin",
  "status.approvalUnknown": "No revert ledger, cannot tell",
  "status.boundaries": "Boundaries",
  "status.boundary.host": "The host installation is never modified and no host patch is applied: Snow App has no equivalent mechanism.",
  "status.boundary.proxy": "The proxy managed block is the only part this plugin writes; content outside it is untouched, and conflicts are deferred.",
  "status.boundary.sensitive": "Sensitive commands cannot be approved by a plugin; you must confirm them on the desktop.",
  "status.boundary.sidebar": "Snow App has no full-page sidebar container, so the same features live in this right panel.",
  "status.connecting": "Connecting to the background",
  "status.enabled": "Master switch",
  "status.fail": "Fail",
  "status.layers": "Self-check layers",
  "status.lastApplied": "Last applied",
  "status.loading": "Running self-check…",
  "status.managed": "Managed content",
  "status.neverApplied": "Nothing has been applied yet.",
  "status.off": "Not enabled",
  "status.ok": "OK",
  "status.port": "Port",
  "status.prompt": "System prompt",
  "status.proxy": "Request proxy",
  "status.role": "Global role",
  "status.summary": "Summary",
  "status.uninstallHint": "Uninstalling or disabling the plugin does not revert these managed layers automatically. Click Revert first, then uninstall.",
  "status.warn": "Check",
  "prompts.active": "Enable this prompt",
  "prompts.content": "Prompt body",
  "prompts.managedBadge": "Managed",
  "prompts.name": "Entry name",
  "prompts.namePlaceholder": "For example: Purge directive",
  "prompts.noCustom": "No custom preset yet. Save the current content as a preset to load it later.",
  "prompts.notApplied": "Not written",
  "prompts.notInLibrary": "This entry is not in the prompt library yet. Choose Save and apply to write it.",
  "prompts.presetLoaded": "Preset loaded: {{name}}",
  "prompts.presetDeleteConfirm": 'Click again to delete preset "{{name}}"; it can still be restored on this page',
  "prompts.presetDeleteArmed": "Confirm delete",
  "prompts.presetDeleted": "Preset deleted: {{name}}",
  "prompts.presetOverwriteConfirm": 'The editors have unsaved changes. Click again to overwrite the draft with "{{name}}"',
  "prompts.presetOverwriteArmed": "Overwrite and load",
  "prompts.presetRecycleHint": 'Preset "{{name}}" was deleted; a copy is kept on this page',
  "prompts.presetRestored": "Preset restored: {{name}}",
  "prompts.presetUndo": "Undo delete",
  "prompts.unreadableBadge": "Unreadable",
  "prompts.unreadableHint": "Check the host Settings - Prompts page; if it stays unreadable, delete the managed entry there manually",
  "prompts.unreadableTitle": "Cannot read the host system prompt library",
  "prompts.presetNamePlaceholder": "Preset name",
  "prompts.presetNameRequired": "Enter a preset name first",
  "prompts.presetSaved": "Preset saved",
  "prompts.presets": "Presets",
  "prompts.presetsHint": "A preset only fills the editors; nothing is written to the host until you save.",
  "prompts.proxyHint": "The request proxy is enabled: after changing the prompt here, apply it again on the Request proxy tab so the injected directive follows.",
  "prompts.remove": "Delete managed entry",
  "prompts.removeArmed": "Confirm delete entry",
  "prompts.removeConfirm": "Click again to delete the managed entry from the host prompt library: the plugin keeps no copy, and the original value can only be recovered by restoring a prompt snapshot on the Backup page, and only if the entry already existed before applying",
  "prompts.removed": "Managed prompt entry deleted",
  "prompts.roleEnable": "Role block managed",
  "prompts.roleFile": "Global ROLE file",
  "prompts.roleHint": "Only the marked block is written; content outside the markers is preserved, and revert removes just the block.",
  "prompts.roleRestore": "Remove managed block",
  "prompts.roleRestoreArmed": "Confirm removal and cleared draft",
  "prompts.roleRestoreConfirm": "Click again to remove the managed block: the rule draft in the editor will be cleared too. Save it as a preset first if you want to keep it",
  "prompts.roleRestored": "Managed block removed from the role file",
  "prompts.roleSave": "Save and apply",
  "prompts.roleTitle": "Global role rules",
  "prompts.saveApply": "Save and apply",
  "prompts.savePreset": "Save as preset",
  "prompts.systemHint": "Writes a fixed entry (snow-purge.directive) into the system prompt library; it affects later conversations once active.",
  "prompts.systemTitle": "System prompt",
  "prompts.usePreset": "Load",
  "approval.empty": "The list is empty",
  "approval.emptyNotSavable": "The global list cannot be saved empty: clear it in the host permission settings instead",
  "approval.globalHint": "The panel shows the host's current global list. Saving replaces it with the edited full list, so make sure nothing is missing. The global list applies to every project, and added tools stop asking for authorization there (already-open conversations pick it up after reopening). Tools added by this save are recorded for revert; reverting only removes entries this plugin added. The list cannot be saved empty: clear it in the host permission settings instead.",
  "approval.globalDiff": "Pending: {{total}} entries, {{added}} added, {{removed}} removed (the global list applies to every project)",
  "approval.globalSaved": "Global approved-tool list saved",
  "approval.staleList": "The global list has been changed outside this panel (for example in host settings or another window) since you opened it: nothing was saved. The baseline has been refreshed; review the latest list and press Save again.",
  "approval.globalTitle": "Global approved tools",
  "approval.unreadableTitle": "Cannot read the host approved-tool list",
  "approval.unreadableNotSavable": "The host's current global list cannot be read, so saving is disabled to avoid replacing the whole list with an empty one",
  "approval.unreadableHint": "Check the host permission settings; if the permission config file is damaged or unreadable, repair it and retry",
  "approval.grant": "Approve",
  "approval.invalidTool": "Invalid tool name: only letters, digits and . _ : - / are allowed",
  "approval.pattern": "Pattern",
  "approval.projectEmpty": "No approved tools for this project",
  "approval.projectLoadFirst": "Enter a project id and click Load: confirm the list belongs to that project before writing",
  "approval.projectLoadRequired": "No project list has been loaded yet: enter the project id and click Load first",
  "approval.projectReloadRequired": "The project id differs from the loaded list: click Load and confirm the list belongs to this project before approving or revoking",
  "approval.projectUnreadable": "The project approved-tool list cannot be read, so writing is disabled to avoid treating existing approvals as empty",
  "approval.projectTarget": "Target project: {{projectId}}",
  "approval.projectCount": "{{count}} tools in this submission",
  "approval.projectGranted": "Project tools approved",
  "approval.projectHint": "The project id matches the host permission domain; load once if unsure before writing. The project list only affects this project. Tools added by this save are recorded for revert; reverting only removes entries this plugin added.",
  "approval.projectLimitReached": "The grant was written to the host, but these additions were not fully recorded for revert (the project revert ledger is full). Revert will not remove them automatically: check them in the host permission settings or clear unused project entries first.",
  "approval.projectPlaceholder": "Project id, for example local:/path/to/project",
  "approval.projectRequired": "Enter a project identifier first",
  "approval.projectRevoked": "Project tools revoked",
  "approval.projectTitle": "Project approved tools",
  "approval.projectToolsPlaceholder": "One tool full name per line",
  "approval.replaceWarn": "Replaces the list",
  "approval.revoke": "Revoke",
  "approval.ruleId": "Rule",
  "approval.saveGlobal": "Save global list",
  "approval.sensitiveBoundary": "Sensitive command rules are shown read-only: the plugin never edits, deletes or resets them, and matching actions still need your confirmation.",
  "approval.sensitiveEmpty": "No sensitive command rules",
  "approval.sensitiveHint": "This only shows the host's current sensitive command rules, so you can check which actions still need your confirmation.",
  "approval.sensitiveTitle": "Sensitive command rules",
  "approval.toolPlaceholder": "Tool full name, press Enter to add",
  "approval.toolRequired": "Enter at least one tool name",
  "redteam.title": "Red team skill library",
  "redteam.hint": "The 23 upstream dsh-purge red-team skills ship with this plugin. Installing writes only SKILL.md into ~/.snow/skills: no tools are downloaded and no commands are executed. Installed skills appear in the host Skills settings.",
  "redteam.libraryDir": "Library",
  "redteam.skillsDir": "Install dir",
  "redteam.enabledCount": "Enabled",
  "redteam.library": "Skills",
  "redteam.allRoles": "All",
  "redteam.empty": "Library is empty: check that the plugin install dir contains skills/redteam.",
  "redteam.installAll": "Install all",
  "redteam.install": "Install",
  "redteam.reinstall": "Reinstall",
  "redteam.update": "Update",
  "redteam.view": "View",
  "redteam.enable": "Enable",
  "redteam.disable": "Disable",
  "redteam.close": "Close",
  "redteam.state.broken": "Broken",
  "redteam.state.enabled": "Enabled",
  "redteam.state.disabled": "Disabled",
  "redteam.state.notInstalled": "Not installed",
  "redteam.installed": "Installed: {{name}}",
  "redteam.updated": "Updated: {{name}}",
  "redteam.enabled": "Enabled: {{name}}",
  "redteam.disabled": "Disabled: {{name}}",
  "redteam.removed": "Removed: {{name}} (original folder moved to the plugin-data recycle area)",
  "redteam.installDone": "Installed {{count}} skills",
  "redteam.installPartial": "{{count}} skills failed; see the audit tab",
  "redteam.previewHint": "Read-only preview from the library: review it before installing.",
  "redteam.env.title": "Environment check",
  "redteam.env.hint": "Reads environment variables and ~/.snow/.env (if present) only; no tool is executed. Only FOFA_KEY, REDTEAM_VPS_HOST and REDTEAM_VPS_KEY are used: secrets show their length only, the VPS key shows a path only when it is a verified local path, and the VPS host shows its length only. Missing items do not block skill installation.",
  "redteam.env.item": "Item",
  "redteam.env.evidence": "Evidence",
  "redteam.env.fofa": "FOFA_KEY",
  "redteam.env.vpsHost": "VPS host",
  "redteam.env.vpsKey": "VPS key",
  "redteam.env.toolkit": "Toolkit dir",
  "redteam.env.setupMarker": "Setup marker",
  "redteam.env.tools": "Tools",
  "redteam.env.ok": "Ready",
  "redteam.env.warn": "Missing",
  "redteam.env.off": "Not set",
  "redteam.env.missing": "Not found",
  "redteam.boundary.title": "How far this goes",
  "redteam.boundary.skills": "Yes: install, toggle and remove these skill documents. They are playbooks; execution still happens in the conversation under your authorization.",
  "redteam.boundary.tools": "No: does not download or install fscan / nuclei / chisel binaries and never runs scan or exploit commands.",
  "redteam.boundary.workflow": "No: the upstream redteam_preflight, chain orchestration and reporting are its own tools; a Snow App plugin cannot register such tools and only offers the same read-only checks.",
  "redteam.boundary.legal": "Use only on systems you own or are authorized to test; get written permission before touching third-party systems.",
  "roster.open": "Roster view",
  "roster.title": "Red team roster",
  "roster.close": "Close",
  "roster.installAll": "Install all",
  "roster.installAllConfirm": "Confirm overwrite",
  "roster.install": "Install",
  "roster.reinstall": "Reinstall",
  "roster.update": "Update config",
  "roster.state.ready": "Ready",
  "roster.state.stale": "Update suggested",
  "roster.state.pending": "Not installed",
  "roster.state.indexOnly": "Installed (index only)",
  "roster.verify.hint": "{{count}} role(s) are shown from this plugin's write record only: the host returns project-scoped sub-agents to plugins, so a deleted global role is invisible here. If you removed a role in the host settings, click Reinstall.",
  "roster.toast.installed": "Role written to the sub-agent config",
  "roster.toast.updated": "Role config updated",
  "roster.toast.removed": "Role removed from the sub-agent config",
  "roster.toast.allDone": "All 5 roles installed",
  "roster.toast.partial": "{{count}} role(s) failed to save; see the audit tab",
  "roster.toast.overwritten": "Overwrote the same-ID record {{name}} returned by the host; its original config was backed up to {{file}}",
  "roster.toast.overwrittenAll": "All roles installed; {{count}} same-ID record(s) returned by the host were overwritten and backed up",
  "roster.toast.unverified": "{{name}} installed; the host returns sub-agents per project, so a same-ID global record cannot be read: if one existed, it was overwritten with no automatic backup. Back up the original in the host sub-agent settings first if you need to keep it.",
  "roster.toast.unverifiedAll": "All roles installed; {{count}} role(s) could not read a same-ID global record, which would have been overwritten with no automatic backup. Back up originals in the host sub-agent settings first if needed.",
  "roster.toast.projectConflict": "{{name}} is installed globally; a same-ID record also exists in the current project, and the project-level config wins",
  "roster.toast.indexFailed": "{{name}} was written to the host, but the plugin could not record the install index ({{message}}). It may show as not installed; reinstall or check permissions of the plugin data directory.",
  "roster.toast.indexFailedAll": "{{count}} role(s) were written to the host, but the plugin could not record the install index ({{message}}). Reinstall or check permissions of the plugin data directory.",
  "roster.toast.backupSaved": "Backed up the previous config for {{name}} to {{file}}",
  "roster.core": "Main session",
  "roster.coreSub": "dispatch and report",
  "roster.netHint": "Nodes are sub-agent roles and edges mean the main session dispatches work. Install state follows this plugin's own write records because the host read interface filters by project, so a deleted global role is invisible here. The host currently returns only main-session records to plugins, so role status, tokens, time and request counts are unavailable; the panel never substitutes zeros.",
  "roster.members": "Members",
  "roster.membersHint": "Click a role name to inspect it on the left",
  "roster.member.in": "Installed",
  "roster.member.out": "Not installed",
  "roster.prompt": "System prompt",
  "roster.promptHide": "Hide prompt",
  "roster.boundary": "Config only: roles, system prompts and tool allow-lists are written to the host subAgents config. No sub-agent is started, no tool is downloaded and no sensitive command is approved for you.",
  "roster.role.redteam_recon.name": "Recon",
  "roster.role.redteam_recon.desc": "Map the public asset surface of the authorized target: domains, subdomains, IPs, ports, certificates and web fingerprints, as a table with sources.",
  "roster.role.redteam_recon.t1": "Collect subdomains from domains and certificate transparency logs, noting source and confidence",
  "roster.role.redteam_recon.t2": "Identify ports and services on live hosts and record version fingerprints",
  "roster.role.redteam_recon.t3": "Summarize the asset table and flag exposure worth verifying next",
  "roster.role.redteam_assess.name": "Assessment",
  "roster.role.redteam_assess.desc": "Turn the asset list into an attack surface and rank it. Judgment and ordering only, no verification.",
  "roster.role.redteam_assess.t1": "Grade assets by exposure and business importance",
  "roster.role.redteam_assess.t2": "Match component versions against public vulnerability data",
  "roster.role.redteam_assess.t3": "Produce a P0-P3 risk table and the next verification plan",
  "roster.role.redteam_vuln_scan.name": "Vulnerability scan",
  "roster.role.redteam_vuln_scan.desc": "Run targeted template checks and turn suspicions into reproducible evidence, with bounded rate and concurrency.",
  "roster.role.redteam_vuln_scan.t1": "Pick template sets from fingerprints and fix targets, concurrency and rate",
  "roster.role.redteam_vuln_scan.t2": "Re-verify hits with a minimal request and rule out false positives",
  "roster.role.redteam_vuln_scan.t3": "Report results with reproducible commands and false-positive risk",
  "roster.role.redteam_exploit.name": "Exploitation",
  "roster.role.redteam_exploit.desc": "Turn confirmed findings into minimal reproducible proof of impact, never into destruction.",
  "roster.role.redteam_exploit.t1": "Design the smallest verification step and a rollback plan per finding",
  "roster.role.redteam_exploit.t2": "Record requests, responses and evidence, staying within harmless bounds",
  "roster.role.redteam_exploit.t3": "Clean up artifacts and temporary connections, then state the impact",
  "roster.role.redteam_internal.name": "Internal pivot",
  "roster.role.redteam_internal.desc": "Discover assets, analyze pivot paths and assess privilege escalation inside the authorized network segments.",
  "roster.role.redteam_internal.t1": "Low-noise host and port discovery to sketch the internal topology",
  "roster.role.redteam_internal.t2": "Analyze reachability and credential types, then plan pivot paths",
  "roster.role.redteam_internal.t3": "Open tunnels only when needed and close them immediately; report reach",
  "roster.badge.running": "{{count}} running",
  "roster.badge.tasks": "{{count}} tasks",
  "roster.status.running": "Running",
  "roster.status.completed": "Completed",
  "roster.status.failed": "Failed",
  "roster.status.cancelled": "Cancelled",
  "roster.status.idle": "Idle",
  "roster.status.unavailable": "Unavailable",
  "roster.status.pending": "Not installed",
  "roster.status.queued": "Queued",
  "roster.status.missing": "Session gone",
  "roster.net.title": "Agent network",
  "roster.net.totals": "{{tokens}} tokens · {{requests}} model requests",
  "roster.net.unavailable": "Host does not expose sub-agent sessions",
  "roster.activity.none": "No runs yet",
  "roster.activity.unavailable": "Run data unavailable",
  "roster.meta.model": "Model",
  "roster.meta.tokens": "Tokens",
  "roster.meta.time": "Time",
  "roster.meta.requests": "Requests",
  "roster.meta.messages": "{{count}} messages",
  "roster.value.unavailable": "Unavailable",
  "roster.search": "Search name",
  "roster.filter.all": "All",
  "roster.filter.running": "Running",
  "roster.filter.done": "Finished",
  "roster.filter.pending": "Not installed",
  "roster.filter.empty": "No matching role",
  "roster.detail": "Details",
  "roster.detail.lastConversation": "linked conversation",
  "roster.dispatch.title": "Dispatch a task",
  "roster.dispatch.hint": "Dispatch creates a conversation and lets the main agent hand it to this role.",
  "roster.dispatch.role": "Role",
  "roster.dispatch.target": "Target",
  "roster.dispatch.targetHint": "Domain, IP or CIDR inside the authorized scope",
  "roster.dispatch.template": "Task",
  "roster.dispatch.templateHint": "Write it yourself or fill in a template",
  "roster.dispatch.pickTemplate": "Pick a task template",
  "roster.dispatch.note": "Notes",
  "roster.dispatch.noteHint": "Extra constraints, wordlist paths or a time window (optional)",
  "roster.dispatch.autoReply": "Dispatch starts one turn immediately",
  "roster.dispatch.send": "Dispatch",
  "roster.dispatch.sending": "Dispatching",
  "roster.dispatch.done": "Conversation created and task delivered",
  "roster.dispatch.pickRole": "Pick a role first",
  "roster.dispatch.forRole": "Dispatch",
  "roster.dispatch.notInstalled": "This role is not installed yet: install it under Roster first.",
  "roster.dispatch.templates": "Task templates (multi-select)",
  "roster.dispatch.custom": "Custom task",
  "roster.dispatch.customHint": "Add one beyond the templates; press Enter to queue it",
  "roster.dispatch.add": "Add to queue",
  "roster.dispatch.remove": "Remove from queue",
  "roster.dispatch.queue": "{{count}} task(s) queued",
  "roster.dispatch.sendCount": "Dispatch {{count}} task(s)",
  "roster.dispatch.doneCount": "Dispatched {{count}} task(s) in {{conversations}} conversation(s)",
  "roster.dispatch.partial": "Dispatched {{count}}, {{failed}} failed",
  "roster.dispatch.empty": "Pick a template or add a custom task first",
  "roster.dispatch.mode": "Dispatch mode",
  "roster.dispatch.modeSingle": "One conversation, in order",
  "roster.dispatch.modeSplit": "One conversation per task",
  "roster.dispatch.modeHint.single": "Templates of the same role usually depend on each other: run them in one conversation by number so each step reuses the previous output, which costs fewer tokens and less concurrency on the target.",
  "roster.dispatch.modeHint.split": "Each task gets its own conversation, independent and re-runnable; suited to different targets or unrelated tasks, but results are not shared.",
  "roster.task.batch": "{{count}} tasks: {{first}} …",
  "roster.chain.title": "Chain",
  "roster.chain.hint": "Runs in order: each stage hands its result to the next one. Pause and stop only control the chain; remote scans and tunnels must be stopped separately. Progress depends on the host conversation list and live state; when they are unavailable the stage waits for confirmation instead of guessing.",
  "roster.chain.target": "Target",
  "roster.chain.steps": "Stages and tasks",
  "roster.chain.noteHint": "Authorized scope, time window or extra constraints (shared by the whole chain)",
  "roster.chain.orderHint": "Runs in the fixed order recon → assess → scan → exploit → internal",
  "roster.chain.start": "Start chain",
  "roster.chain.starting": "Starting",
  "roster.chain.started": "Chain started; the next stage begins when the current one finishes",
  "roster.chain.failed": "The first stage was not dispatched",
  "roster.chain.empty": "No chain yet. Pick the stages, add a target and start it.",
  "roster.chain.progress": "{{done}}/{{total}} done",
  "roster.chain.pause": "Pause chain",
  "roster.chain.resume": "Resume",
  "roster.chain.skip": "Skip stage",
  "roster.chain.stop": "Stop chain",
  "roster.chain.remove": "Remove chain",
  "roster.chain.paused": "Chain paused: the current stage conversation keeps running",
  "roster.chain.resumed": "Chain resumed",
  "roster.chain.redispatch": "Redispatch this stage",
  "roster.chain.resumedRedispatched": "This stage was redispatched and the old conversation was aborted",
  "roster.chain.resumedRedispatchedIdle": "This stage was redispatched, but the old conversation was not confirmed aborted: {{reason}}. Stop it manually in the conversation list.",
  "roster.chain.resumedStillRunning": "That conversation is still running; the chain will decide this stage after it ends",
  "roster.chain.resumedCompleted": "That conversation has actually finished; resuming will move to the next stage",
  "roster.chain.resumedUnknown": "The conversation list is unreadable, so nothing was redispatched: switch back to the originating project and resume again",
  "roster.chain.redispatchFailed": "Redispatch failed: {{reason}}",
  "roster.chain.skipped": "Current stage skipped",
  "roster.chain.stopped": "Chain stopped",
  "roster.chain.stopAborted": "Chain stopped; the current stage conversation was aborted",
  "roster.chain.stopIdle": "Chain stopped; abort was not sent: {{reason}}",
  "roster.chain.abortUnknown": "the conversation has no running turn",
  "roster.chain.skippedAborted": "Stage skipped; the previous conversation was aborted",
  "roster.chain.skippedIdle": "Stage skipped; abort was not sent: {{reason}}",
  "roster.chain.removed": "Chain removed",
  "roster.chain.removedAborted": "Chain removed; the current step's conversation was aborted",
  "roster.chain.removedIdle": "Chain removed; no abort was sent: {{reason}}",
  "roster.chain.status.running": "Running",
  "roster.chain.status.paused": "Paused",
  "roster.chain.status.blocked": "Blocked",
  "roster.chain.status.completed": "Completed",
  "roster.chain.status.stopped": "Stopped",
  "roster.tasks.title": "Tasks",
  "roster.tasks.hint": "Status is inferred from conversation runs; treat it as a hint",
  "roster.tasks.empty": "No tasks dispatched yet",
  "roster.task.open": "Open conversation",
  "roster.task.remove": "Remove record",
  "roster.task.opened": "Switched to the task conversation",
  "roster.task.removed": "Task record removed",
  "roster.task.notFound": "The task record no longer exists; the list was refreshed",
  "roster.task.archived": "{{count}} older task records are archived and no longer use the list",
  "roster.tab.chain": "Chain",
  "roster.chain.singleStep": "Single step",
  "roster.chain.edit": "Edit tasks",
  "roster.chain.collapse": "Collapse",
  "roster.chain.records": "Chain runs",
  "roster.chain.stepDefault": "default brief",
  "roster.chain.stepTasks": "{{count}} task(s)",
  "roster.chain.stepLimit": "Up to {{max}} tasks per step: remove one before adding another",
  "roster.chain.stepOver": "{{count}} tasks (over the {{max}} limit; trim before starting)",
  "roster.chain.trimmed": "({{archived}} older records archived, {{truncated}} tasks skipped because they exceed the per-step limit)",
  "roster.chain.stepAdd": "Add to step",
  "roster.chain.stepAddHint": "Add one beyond the default brief; press Enter to queue it",
  "roster.chain.stepRemove": "Remove from this step",
  "roster.chain.stepReset": "Restore the default brief",
  "roster.chain.toggleStep": "Include or exclude {{name}} in the chain",
  "roster.chain.review": "{{count}} stage(s) · target {{target}} · {{sessions}} conversation(s) and {{tasks}} task(s) will be created",
  "roster.chain.confirm": "Click again to confirm: target {{target}}, {{sessions}} conversation(s) and {{tasks}} task(s) will be created",
  "roster.chain.confirmImpact": "The selection includes {{names}}, which are high-impact roles: confirm the target and authorization first",
  "roster.chain.startConfirm": "Confirm start ({{sessions}} sessions / {{tasks}} tasks)",
  "roster.chain.blocked.target": "Add a target to start",
  "roster.chain.blocked.steps": "Keep at least one stage",
  "roster.chain.blocked.roles": "Install these roles first: {{names}}",
  "roster.chain.blocked.stepLimit": '"{{name}}" has {{count}} tasks; a step allows at most {{max}}: trim before starting',
  "roster.chain.blocked.active": "At most {{max}} unfinished chains (running or blocked) can be kept: stop or remove one in the records below before starting",
  "roster.chain.brief.redteam_recon": "Map the target: subdomains, live hosts, ports and service fingerprints. Deliver a sourced asset table and flag the exposure worth verifying next. Collection only, no exploitation.",
  "roster.chain.brief.redteam_assess": "From the previous asset table, rank assets P0-P3 by exposure and business importance, explain each level and propose the next verification round. Judgment and ordering only.",
  "roster.chain.brief.redteam_vuln_scan": "Run targeted template checks against P0/P1 assets with bounded targets, concurrency and rate. Report reproducible hits, rationale and false-positive risk. No exploitation.",
  "roster.chain.brief.redteam_exploit": "Prove confirmed findings with the smallest reproducible step and one harmless piece of evidence. No deletion, no persistence, no lateral movement; state the rollback plan first.",
  "roster.chain.brief.redteam_internal": "From the existing foothold, do low-noise internal discovery and pivot analysis. Close tunnels when done; report reachability, credential types and the highest-value target.",
  "roster.summary": "{{installed}}/{{total}} installed · {{running}} running · {{tasks}} queued",
  "roster.refresh": "Refresh data",
  "roster.installing": "Installing",
  "roster.installingAll": "Installing",
  "roster.installAllCount": "Install {{count}} remaining",
  "roster.installAllHint": "Installs only roles that are not installed yet; the host returns sub-agents per project, so a same-ID global record cannot be read and cannot be backed up before overwriting.",
  "roster.tab.roster": "Roster",
  "roster.tab.dispatch": "Dispatch",
  "roster.tab.tasks": "Tasks",
  "roster.tab.chains": "{{count}} chain(s) running",
  "roster.stale": "Refresh failed: {{message}}. Showing the last data read.",
  "roster.indexBroken.hint": "The roster index is unavailable ({{message}}): installed roles may show as not installed. Click Install to re-verify.",
  "roster.updated.none": "Not synced yet",
  "roster.updated.just": "Updated just now",
  "roster.updated.seconds": "Updated {{count}}s ago",
  "roster.updated.minutes": "Updated {{count}}m ago",
  "roster.net.caption": "Five role sub-agents; edges mean the main session dispatches work.",
  "roster.help": "Notes and limits",
  "roster.helpHide": "Hide notes",
  "roster.search.clear": "Clear search",
  "roster.empty.filtered.title": "No matching role",
  "roster.empty.filtered.hint": "Try another keyword, or clear the filters to see every role.",
  "roster.empty.filtered.action": "Clear filters",
  "roster.empty.tasks.title": "No tasks dispatched yet",
  "roster.empty.tasks.hint": "Pick a role and a target under Dispatch; tasks will show up here.",
  "roster.empty.tasks.action": "Go to chain",
  "roster.confirm.remove": "Confirm removal",
  "roster.confirm.hint": "Click again to delete the sub-agent config for {{name}}",
  "roster.confirm.foreignHint": "There is no install record for {{name}} in the roster index, so a global sub-agent with this name may have been created by you in the host: clicking again deletes that global record by agentId and cannot be undone. Back it up in the host sub-agent settings first if you want to keep it.",
  "roster.confirm.driftHint": "The install record for {{name}} comes from an older role definition, so the host record may have been edited by hand: clicking again deletes that global record. Back it up first if you want to keep it.",
  "roster.confirm.indexBrokenHint": "The roster index could not be read, so the origin of {{name}} cannot be verified: clicking again deletes that global record by agentId. Back it up in the host sub-agent settings first.",
  "roster.confirm.task": "Confirm delete",
  "roster.confirm.taskHint": "Click again to remove this record (the conversation itself stays).",
  "roster.confirm.chainHint": "Click again to remove this chain record. A running conversation is aborted first (the abort may fail).",
  "roster.confirm.skip": "Confirm skip",
  "roster.confirm.skipHint": "Click again to skip: the current stage's conversation is aborted and the next stage starts immediately",
  "roster.toast.removedName": "{{name}} removed; you can install it again anytime",
  "roster.toast.removedForeignName": "Removed the global record for {{name}}; there is no install record from this plugin in the index, so it cannot be confirmed whether you created it by hand. If this was a mistake, recreate it in the host sub-agent settings.",
  "roster.toast.removeBlockedName": "{{name}} removal was not confirmed; check the sub-agent settings in the host",
  "roster.toast.notInstalledName": "{{name}} is not installed; nothing to remove",
  "roster.toast.removedGlobalOnly": "Removed the global config for {{name}}, but {{count}} project scope(s) still contain a same-ID record; delete it per project in the host's sub-agent settings",
  "roster.toast.removedWithBackup": "{{name}} removed; the config backed up at install time is still on this machine: {{file}} (write it back to the host manually)",
  "roster.conflict.hint": "No install record for {{name}}: a same-ID global sub-agent cannot be confirmed because the host filters by project. Clicking Install again overwrites it with no automatic backup. Back up the original in the host sub-agent settings first if you need to keep it.",
  "roster.conflict.allHint": "{{count}} role(s) have no install record ({{names}}): same-ID global sub-agents cannot be confirmed because the host filters by project. Clicking Confirm overwrite again replaces them with no automatic backup. Back up originals in the host sub-agent settings first if needed.",
  "roster.detail.templates": "Task templates",
  "roster.detail.tools": "{{count}} tools in the allow-list",
  "roster.dispatch.targetHelp": "Dispatch only against targets you own or are authorized to test.",
  "roster.dispatch.duplicate": "That task is already in the queue",
  "roster.dispatch.review": "Will dispatch {{count}} task(s) to {{name}}",
  "roster.dispatch.blocked.role": "Install this role before dispatching",
  "roster.dispatch.blocked.target": "Add a target to dispatch",
  "roster.dispatch.blocked.queue": "Pick a template or write one",
  "roster.queue.title": "Queue",
  "roster.queue.count": "{{count}} task(s)",
  "roster.queue.empty": "Nothing queued yet: tick a template or write your own.",
  "roster.chain.summary": "{{count}} record(s) · {{active}} active",
  "audit.action": "Action",
  "audit.detail": "Detail",
  "audit.empty": "No plugin action recorded yet",
  "audit.failed": "Failed",
  "audit.hint": "Every apply, revert and write the plugin performs is recorded here, up to 200 entries.",
  "audit.levelAll": "All levels",
  "audit.logsDenied": "Cannot read app logs: {{reason}}",
  "audit.logsEmpty": "No matching log entries",
  "audit.logsHint": "Reads host app logs for comparison, loaded once when this page opens. Clearing deletes every record in the log database, across all conversations and system logs, regardless of the current filters, and cannot be undone.",
  "audit.logsTitle": "App logs",
  "audit.modulePlaceholder": "Module, for example api / requestProxy",
  "audit.ok": "OK",
  "audit.result": "Result",
  "audit.time": "Time",
  "audit.title": "Action history",
  "audit.clear": "Clear trail",
  "audit.clearConfirm": "Confirm clear",
  "audit.cleared": "Action trail cleared",
  "audit.logsClear": "Clear all app logs",
  "audit.logsClearConfirm": "Confirm clearing all app logs",
  "audit.logsClearTitle": "Deletes every record in the host app log database. This cannot be undone.",
  "audit.logsCleared": "App logs cleared; {{count}} entries deleted, this cannot be undone",
  "backup.boundary": "Backups cover only what this plugin changes: the proxy script, role file, managed prompt value and approved-tool lists.",
  "backup.dir": "Backup directory",
  "backup.empty": "No backups yet. The first apply creates one automatically.",
  "backup.hint": "Snapshots are taken before applying, up to 30 entries; restoring affects only that layer.",
  "backup.kind": "Kind",
  "backup.kind.approval": "Approved tools",
  "backup.kind.other": "Other",
  "backup.kind.prompt": "Prompt",
  "backup.kind.proxy": "Proxy script",
  "backup.kind.role": "Role rules",
  "backup.restore": "Restore",
  "backup.confirm.approval": "This is an approved-tool list snapshot: restoring overwrites the global list (and the project list recorded in the snapshot). Grants added after the snapshot are not preserved. Continue?",
  "backup.confirm.other": "This snapshot has an unknown type: restoring writes directly to the host configuration. Continue?",
  "backup.confirm.prompt": "This is a prompt snapshot: restoring overwrites the single snow-purge.directive entry with the pre-apply value. Other prompt entries are untouched. Continue?",
  "backup.confirm.proxyForce": "The proxy script was edited outside the managed block after it was applied. Restoring will overwrite those edits. Continue?",
  "backup.confirm.role": "This is a role rules snapshot: restoring overwrites the whole global role file with the pre-apply text, including rules you wrote outside the managed block afterwards. Continue?",
  "backup.confirm.roleForce": "Content outside the managed block differs from the pre-apply snapshot. Restoring will overwrite those hand-written rules. Continue?",
  "backup.deleteArmed": "Confirm delete",
  "backup.deleteConfirm": "Click again to delete the {{kind}} backup from {{time}}; this snapshot cannot be recovered",
  "backup.deleteFailed": "Delete failed: the backend did not confirm it. Refresh and retry",
  "backup.deleted": "Deleted the {{kind}} backup; {{count}} remaining",
  "backup.restoreProxyConfirm": "This is a proxy script snapshot: restoring overwrites the whole proxy script, including anything you wrote outside the managed block. Continue?",
  "backup.restored": "Restored from backup",
  "backup.size": "Size",
  "backup.time": "Time",
  "backup.title": "Local backups",
  "proxy.blockAbsent": "No managed block",
  "proxy.blockHash": "Block hash",
  "proxy.blockPresent": "Managed block present",
  "proxy.boost": "Tail reinforcement",
  "proxy.boostHint": "Appends the same directive to the last user message for a stronger constraint.",
  "proxy.boundary": "Only the request body is modified; endpoint, headers and credentials are untouched. The Responses WebSocket transport bypasses this proxy layer.",
  "proxy.directive": "Injected directive",
  "proxy.enable": "Enable request proxy management",
  "proxy.enableHint": "Maintains a managed block in the host proxy script. Disabling does not delete it; use Restore.",
  "proxy.exists": "File exists",
  "proxy.foreignHook": "Foreign onRequest",
  "proxy.force": "Force overwrite a modified managed block, or clean managed residue",
  "proxy.residue": "Managed residue",
  "proxy.residueUnconfirmed": "Orphan marker, cannot be confirmed automatically",
  "proxy.hint": "Only the content between the two markers is replaced, and the original file is snapshotted first.",
  "proxy.path": "Proxy script",
  "proxy.previewEmpty": "The proxy script does not exist yet",
  "proxy.previewTitle": "End of script preview",
  "proxy.probeEmpty": "No proxied conversation request recorded yet",
  "proxy.probeHint": "The managed block appends sampled injection records (the first one always) to the probe log; writing stops once the size limit is reached.",
  "proxy.probeMode": "Placement",
  "proxy.probeProvider": "Protocol",
  "proxy.probeTime": "Time",
  "proxy.probeTitle": "Injection probe",
  "proxy.providers": "Protocols",
  "proxy.restore": "Restore script",
  "proxy.restoreConfirm": "Restoring overwrites the whole proxy script from the pre-apply snapshot, including anything you wrote outside the managed block. Continue?",
  "proxy.restored": "Proxy script restored",
  "proxy.restoreRemoved": "The script contained only the managed block, so the file was deleted",
  "proxy.restoreStripped": "Managed block removed: no pre-apply snapshot was available, so the rest of the file was not restored verbatim",
  "proxy.restoreDegraded": "Pre-apply snapshot is gone ({{id}}): only the managed block was removed, the original could not be restored",
  "proxy.restoreCleaned": "Cleaned {{count}} managed residue block(s); the script had no complete managed block",
  "proxy.restoreRecreated": "The proxy script had been deleted and was recreated from the pre-apply snapshot",
  "proxy.restoreResidueConfirm": "Managed residue was found in the script (an old managed block whose closing marker was removed): this run only removes that residue. Content you wrote outside the block is untouched. Continue?",
  "proxy.restoreNoop": "Nothing to restore: the script is missing or has no managed block",
  "proxy.save": "Save and apply",
  "proxy.title": "Request proxy management",
  "settings.abilities": "What it does",
  "settings.ability.approval": "Reads and writes global and project approved-tool lists and shows sensitive command rules.",
  "settings.ability.audit": "Records plugin actions and cross-checks host app logs.",
  "settings.ability.backup": "Snapshots before applying and restores per layer.",
  "settings.ability.prompt": "Creates, updates and removes a fixed system prompt entry, with presets.",
  "settings.ability.proxy": "Maintains a managed block in the proxy script, injects per protocol and provides a probe.",
  "settings.ability.role": "Maintains a marked block inside the global role file while keeping your own text.",
  "settings.ability.selfcheck": "Checks channel, prompt, role, proxy, probe and approved tools layer by layer, with evidence.",
  "settings.autoSnapshot": "Snapshot before applying",
  "settings.autoSnapshotHint": "Saves the previous value before the first apply of each layer. With it off, back up manually.",
  "settings.enabled": "Enable management",
  "settings.enabledHint": "With it off, Apply at the top reverts everything this plugin wrote; Save on each page only stores the configuration without writing to the host or reverting.",
  "settings.limit.host": "No host asar patch or anchor re-location.",
  "settings.limit.restart": "Never restarts the host for you.",
  "settings.limit.sensitive": "Never approves sensitive commands.",
  "settings.limit.sidebar": "No full-page sidebar; everything lives in this right panel.",
  "settings.limit.updater": "No built-in updater; updates come from the plugin market.",
  "settings.limits": "What it cannot do",
  "settings.corruptHint": "The plugin config is damaged and read-only now: nothing will be written until it is repaired.",
  "settings.readFailedHint": "Failed to read the plugin config: the default config is shown instead of your saved settings; saving is refused until reading recovers. Refresh the panel and retry later.",
  "settings.repair": "Repair config",
  "settings.repairConfirm": "Repair rebuilds the plugin settings from defaults and makes the revert ledger unavailable. The damaged raw content is saved into the plugin data directory first. Continue?",
  "settings.repairNotNeeded": "The config parses correctly; no repair needed",
  "settings.repaired": "Plugin config rebuilt; the damaged content was saved to {{file}}",
  "settings.saved": "Settings saved",
  "settings.title": "Plugin settings"
};

// src/panel/i18n.js
var PACKS = { "zh-CN": zh_CN_default, "zh-TW": zh_TW_default, en: en_default };
var normalizeLocale = (locale) => {
  const raw = String(locale || "").toLowerCase();
  if (!raw) return "zh-CN";
  if (raw.startsWith("zh-tw") || raw.startsWith("zh-hk") || raw === "zh-hant") return "zh-TW";
  if (raw.startsWith("zh")) return "zh-CN";
  if (raw.startsWith("en")) return "en";
  return "zh-CN";
};
var interpolate = (template, values) => {
  if (!values) return template;
  return String(template).replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (match, key) => Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
};
function createTranslator(api, locale) {
  const resolved = normalizeLocale(locale || api?.locale);
  const pack = PACKS[resolved] || PACKS["zh-CN"];
  const fallbackPack = PACKS["zh-CN"];
  const t = (key, values) => {
    const fallback = pack[key] ?? fallbackPack[key] ?? key;
    try {
      if (api && typeof api.t === "function") {
        return api.t(key, { defaultValue: fallback, values });
      }
    } catch {
    }
    return interpolate(fallback, values);
  };
  return { t, locale: resolved };
}

// src/shared/contract.js
var PORT_FIRST = 37301;
var PORT_LAST = 37310;
var CHANNEL_HEADER = "x-snow-purge-channel";
var CHANNEL_HEADER_VALUE = "panel-rpc-v1";
var CHANNEL_TOKEN_HEADER = "x-snow-purge-token";
var CHANNEL_ENDPOINT_STORAGE_KEY = "channelEndpoint";
var ROUTES = {
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
  rosterChainRemove: "/roster/chain/remove"
};
var LIMITS = {
  /** 请求体硬上限，超出直接 413。 */
  requestMaxBytes: 256 * 1024,
  /** 单条提示词 / 角色规则正文上限。 */
  promptCharsMax: 24e3,
  roleCharsMax: 24e3,
  /** 代理注入指令正文上限。 */
  directiveCharsMax: 8e3,
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
  projectIdCharsMax: 512
};
var ROSTER_BATCH_MAX = 8;
var ROSTER_CHAIN_RUNNING_MAX = 3;

// src/panel/rpc.js
var PanelError = class extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = "PanelError";
    this.code = String(code || "UNKNOWN");
    this.status = Number.isFinite(options.status) ? options.status : 0;
  }
};
var isConnectionError = (text) => /ECONNREFUSED|ECONNRESET|ENOTFOUND|EPIPE|connection refused|connection reset|failed to fetch|net::ERR|socket hang up|fetch failed/i.test(
  text
);
var isTimeoutError = (text) => /timeout|timed out|ETIMEDOUT|超时/i.test(text);
var buildQuery = (query) => {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === void 0 || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
};
var CHANNEL_TOKEN_PATTERN = /^[A-Za-z0-9]{32,128}$/;
function createRpc(api, { log = () => {
} } = {}) {
  let endpoint = null;
  let endpointLoaded = false;
  let endpointLoading = null;
  const readEndpoint = async () => {
    if (!api?.storage) return null;
    try {
      const saved = typeof api.storage.getJson === "function" ? await api.storage.getJson(CHANNEL_ENDPOINT_STORAGE_KEY, null) : typeof api.storage.get === "function" ? JSON.parse(await api.storage.get(CHANNEL_ENDPOINT_STORAGE_KEY) || "null") : null;
      const port = Number(saved?.port);
      const token = typeof saved?.token === "string" ? saved.token : "";
      if (!Number.isInteger(port) || port < PORT_FIRST || port > PORT_LAST) return null;
      if (!CHANNEL_TOKEN_PATTERN.test(token)) return null;
      return { port, token };
    } catch (error) {
      log(`[rpc] 读取通道记录失败：${error?.message || error}`);
      return null;
    }
  };
  const ensureEndpoint = async () => {
    if (endpointLoaded) return endpoint;
    endpointLoading ?? (endpointLoading = (async () => {
      try {
        endpoint = await readEndpoint();
        endpointLoaded = Boolean(endpoint);
        return endpoint;
      } finally {
        endpointLoading = null;
      }
    })());
    return endpointLoading;
  };
  const rawRequest = async (target, pathname, { method = "GET", body, query, timeoutMs = 2e4 } = {}) => {
    if (!api?.net || typeof api.net.fetch !== "function") {
      throw new PanelError("NET_UNAVAILABLE", "api.net.fetch 不可用（请在 plugin.json 声明 network 隐私域）");
    }
    const url = `http://127.0.0.1:${target.port}${pathname}${buildQuery(query)}`;
    let response;
    try {
      response = await api.net.fetch(url, {
        method,
        headers: {
          [CHANNEL_HEADER]: CHANNEL_HEADER_VALUE,
          ...target.token ? { [CHANNEL_TOKEN_HEADER]: target.token } : {},
          ...body === void 0 ? {} : { "content-type": "application/json" }
        },
        body: body === void 0 ? void 0 : JSON.stringify(body),
        responseType: "text",
        timeoutMs
      });
    } catch (error) {
      const text2 = String(error?.message || error);
      throw new PanelError(isConnectionError(text2) ? "BACKGROUND_UNAVAILABLE" : "TRANSPORT", text2);
    }
    if (!response || response.error) {
      const failure = String(response?.error || "网络请求失败");
      if (isConnectionError(failure)) throw new PanelError("BACKGROUND_UNAVAILABLE", failure);
      if (isTimeoutError(failure)) throw new PanelError("TIMEOUT", failure);
      throw new PanelError("TRANSPORT", failure);
    }
    const text = typeof response.body === "string" ? response.body : "";
    let payload = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new PanelError("PROTOCOL", `后台响应不是 JSON：${error?.message ?? error}`);
      }
    }
    if (response.ok !== true || payload && payload.error) {
      const detail = payload?.error || null;
      const code = typeof detail?.code === "string" && detail.code ? detail.code : `HTTP_${response.status ?? 0}`;
      const message = typeof detail?.message === "string" && detail.message || response.statusText || `HTTP ${response.status ?? 0}`;
      if (/未知接口/.test(message)) {
        throw new PanelError("BACKGROUND_OUTDATED", "后台还在运行旧版本（缺少新接口），请重启一次 App 后重试", {
          status: response.status
        });
      }
      throw new PanelError(code, message, { status: response.status });
    }
    return payload;
  };
  const request = async (pathname, options = {}) => {
    const retryable = (options.method || "GET").toUpperCase() === "GET";
    const send = async () => {
      const target = await ensureEndpoint();
      if (!target) {
        throw new PanelError("BACKGROUND_PENDING", "后台尚未发布连接记录：请关闭并重新打开插件面板");
      }
      return rawRequest(target, pathname, options);
    };
    try {
      return await send();
    } catch (error) {
      if (error?.code !== "BACKGROUND_UNAVAILABLE") throw error;
      if (!retryable) {
        throw new PanelError(
          "BACKGROUND_UNAVAILABLE",
          `${String(error?.message || error)}（请求可能已被后台受理，请先确认结果再重试）`
        );
      }
      try {
        return await send();
      } catch (again) {
        if (again?.code !== "BACKGROUND_UNAVAILABLE") throw again;
        throw new PanelError(
          "BACKGROUND_UNAVAILABLE",
          `${String(again?.message || again)}（后台可能已重启：请关闭并重新打开插件面板）`
        );
      }
    }
  };
  return {
    resetPort() {
      endpoint = null;
      endpointLoaded = false;
      endpointLoading = null;
    },
    health: () => request(ROUTES.health, { timeoutMs: 4e3 }),
    overview: () => request(ROUTES.overview, { timeoutMs: 45e3 }),
    selfcheck: () => request(ROUTES.selfcheck, { timeoutMs: 45e3 }),
    apply: (forceProxy = false) => request(ROUTES.apply, { method: "POST", body: { forceProxy }, timeoutMs: 9e4 }),
    revert: () => request(ROUTES.revert, { method: "POST", body: {}, timeoutMs: 9e4 }),
    prompts: () => request(ROUTES.prompts, { timeoutMs: 3e4 }),
    applyPrompt: (payload) => request(ROUTES.promptApply, { method: "POST", body: payload, timeoutMs: 6e4 }),
    removePrompt: () => request(ROUTES.promptRemove, { method: "POST", body: {}, timeoutMs: 3e4 }),
    role: () => request(ROUTES.role, { timeoutMs: 2e4 }),
    applyRole: (content) => request(ROUTES.roleApply, { method: "POST", body: { content }, timeoutMs: 6e4 }),
    restoreRole: () => request(ROUTES.roleRestore, { method: "POST", body: {}, timeoutMs: 3e4 }),
    approval: (projectId) => request(ROUTES.approval, { query: { projectId }, timeoutMs: 3e4 }),
    setGlobalTools: (tools, baselineHash) => request(ROUTES.approvalGlobal, { method: "POST", body: { tools, baselineHash }, timeoutMs: 3e4 }),
    setProjectTools: (projectId, toolNames, approved) => request(ROUTES.approvalProject, {
      method: "POST",
      body: { projectId, toolNames, approved },
      timeoutMs: 3e4
    }),
    proxy: () => request(ROUTES.proxy, { timeoutMs: 3e4 }),
    applyProxy: (payload) => request(ROUTES.proxyApply, { method: "POST", body: payload, timeoutMs: 6e4 }),
    restoreProxy: (force = false) => request(ROUTES.proxyRestore, { method: "POST", body: { force }, timeoutMs: 3e4 }),
    probe: () => request(ROUTES.proxyProbe, { timeoutMs: 2e4 }),
    presets: () => request(ROUTES.presets, { timeoutMs: 2e4 }),
    savePreset: (preset) => request(ROUTES.presetSave, { method: "POST", body: { preset }, timeoutMs: 2e4 }),
    removePreset: (id) => request(ROUTES.presetRemove, { method: "POST", body: { id }, timeoutMs: 2e4 }),
    backups: () => request(ROUTES.backups, { timeoutMs: 3e4 }),
    restoreBackup: (id, force = false) => request(ROUTES.backupRestore, { method: "POST", body: { id, force }, timeoutMs: 6e4 }),
    removeBackup: (id) => request(ROUTES.backupRemove, { method: "POST", body: { id }, timeoutMs: 2e4 }),
    audit: (limit = 50) => request(ROUTES.audit, { query: { limit }, timeoutMs: 2e4 }),
    clearAudit: () => request(ROUTES.auditClear, { method: "POST", body: {}, timeoutMs: 3e4 }),
    logs: (params = {}) => request(ROUTES.logs, { query: params, timeoutMs: 3e4 }),
    clearLogs: () => request(ROUTES.logsClear, { method: "POST", body: {}, timeoutMs: 6e4 }),
    redteam: (params) => request(ROUTES.redteam, { query: params, timeoutMs: 3e4 }),
    installRedteam: (payload) => request(ROUTES.redteamInstall, { method: "POST", body: payload, timeoutMs: 9e4 }),
    toggleRedteam: (name, enabled) => request(ROUTES.redteamToggle, { method: "POST", body: { name, enabled }, timeoutMs: 3e4 }),
    removeRedteam: (name) => request(ROUTES.redteamRemove, { method: "POST", body: { name }, timeoutMs: 3e4 }),
    redteamSkill: (name) => request(ROUTES.redteamSkill, { query: { name }, timeoutMs: 2e4 }),
    roster: () => request(ROUTES.roster, { timeoutMs: 3e4 }),
    installRoster: (payload) => request(ROUTES.rosterInstall, { method: "POST", body: payload, timeoutMs: 6e4 }),
    removeRoster: (agentId, confirm = false) => request(ROUTES.rosterRemove, { method: "POST", body: { agentId, confirm }, timeoutMs: 3e4 }),
    rosterRole: (agentId) => request(ROUTES.rosterRole, { query: { agentId }, timeoutMs: 2e4 }),
    dispatchRosterTask: (payload) => request(ROUTES.rosterDispatch, { method: "POST", body: payload, timeoutMs: 6e4 }),
    activateRosterTask: (id) => request(ROUTES.rosterTaskActivate, { method: "POST", body: { id }, timeoutMs: 3e4 }),
    removeRosterTask: (id) => request(ROUTES.rosterTaskRemove, { method: "POST", body: { id }, timeoutMs: 3e4 }),
    startRosterChain: (payload) => request(ROUTES.rosterChainStart, { method: "POST", body: payload, timeoutMs: 6e4 }),
    pauseRosterChain: (id) => request(ROUTES.rosterChainPause, { method: "POST", body: { id }, timeoutMs: 3e4 }),
    resumeRosterChain: (id) => request(ROUTES.rosterChainResume, { method: "POST", body: { id }, timeoutMs: 3e4 }),
    skipRosterChain: (id) => request(ROUTES.rosterChainSkip, { method: "POST", body: { id }, timeoutMs: 6e4 }),
    stopRosterChain: (id) => request(ROUTES.rosterChainStop, { method: "POST", body: { id }, timeoutMs: 3e4 }),
    removeRosterChain: (id) => request(ROUTES.rosterChainRemove, { method: "POST", body: { id }, timeoutMs: 3e4 }),
    settings: () => request(ROUTES.settings, { timeoutMs: 15e3 }),
    saveSettings: (patch) => request(ROUTES.settings, { method: "POST", body: patch, timeoutMs: 3e4 }),
    repairSettings: () => request(ROUTES.settingsRepair, { method: "POST", body: { confirm: true }, timeoutMs: 3e4 })
  };
}

// src/panel/ui.jsx
function Btn({ children, onClick, disabled, variant, size, title, type = "button" }) {
  return /* @__PURE__ */ h(
    "button",
    {
      type,
      className: "pg-btn",
      "data-variant": variant,
      "data-size": size,
      title,
      disabled: disabled === true,
      onClick
    },
    children
  );
}
var TONE = {
  ok: "ok",
  warn: "warn",
  fail: "bad",
  off: "muted"
};
function Badge({ tone = "muted", children }) {
  return /* @__PURE__ */ h("span", { className: "pg-badge", "data-tone": TONE[tone] || tone }, children);
}
function Spinner() {
  return /* @__PURE__ */ h("span", { className: "pg-spinner", "aria-hidden": "true" });
}
function Loading({ text }) {
  return /* @__PURE__ */ h("div", { className: "pg-loading" }, /* @__PURE__ */ h(Spinner, null), /* @__PURE__ */ h("span", null, text));
}
function EmptyState({ title, hint, action }) {
  return /* @__PURE__ */ h("div", { className: "pg-empty" }, title ? /* @__PURE__ */ h("div", { className: "pg-empty-title" }, title) : null, hint ? /* @__PURE__ */ h("div", { className: "pg-empty-hint" }, hint) : null, action || null);
}
function ErrorBox({ title, message, action }) {
  return /* @__PURE__ */ h("div", { className: "pg-error" }, title ? /* @__PURE__ */ h("div", { className: "pg-error-title" }, title) : null, message ? /* @__PURE__ */ h("div", { className: "pg-error-body" }, message) : null, action || null);
}
function SectionTitle({ children, extra }) {
  return /* @__PURE__ */ h("div", { className: "pg-section-title" }, /* @__PURE__ */ h("span", null, children), extra ? /* @__PURE__ */ h("span", null, extra) : null);
}
function Toggle({ checked, onChange, label, hint, disabled }) {
  return /* @__PURE__ */ h("label", { className: "pg-toggle", "data-disabled": disabled === true ? "1" : "0" }, /* @__PURE__ */ h(
    "input",
    {
      type: "checkbox",
      checked: checked === true,
      disabled: disabled === true,
      onChange: (event) => onChange?.(event.target.checked)
    }
  ), /* @__PURE__ */ h("span", { className: "pg-toggle-box", "aria-hidden": "true" }), /* @__PURE__ */ h("span", { className: "pg-toggle-text" }, /* @__PURE__ */ h("span", null, label), hint ? /* @__PURE__ */ h("span", { className: "pg-toggle-hint" }, hint) : null));
}
var collectStepIssues = (steps) => {
  const list = Array.isArray(steps) ? steps : [];
  return {
    failed: list.filter((step) => !step.ok),
    unsnapshotted: list.filter((step) => step.ok && step.snapshot?.skipped)
  };
};
var applyModeOf = (mode) => mode === "revert" ? "revert-by-switch" : mode === "saved" ? "saved" : mode === "noop" ? "noop" : "apply";
var summarizeBaseApplyOutcome = (steps, mode, t) => {
  const { failed, unsnapshotted } = collectStepIssues(steps);
  if (failed.length > 0) {
    const detail = failed.map((step) => `${step.step}: ${step.message}`).join("；");
    if (mode === "revert-by-switch") {
      return { tone: "warn", text: t("notice.revertPartialBySwitch", { steps: detail }) };
    }
    if (mode === "revert") return { tone: "warn", text: t("notice.revertPartial", { steps: detail }) };
    return { tone: "warn", text: t("notice.partial", { steps: detail }) };
  }
  if (mode === "saved") {
    return { tone: "warn", text: t("notice.savedWhileDisabled") };
  }
  if (mode === "noop") {
    return { tone: "warn", text: t("notice.noop") };
  }
  if (mode === "revert-by-switch") {
    const advisory = (Array.isArray(steps) ? steps : []).filter((step) => step.ok && step.advisory).map((step) => step.message);
    return { tone: "warn", text: [t("notice.revertedBySwitch"), ...advisory].join("；") };
  }
  if (mode === "revert") {
    const list = Array.isArray(steps) ? steps : [];
    const nothing = list.length === 1 && list[0]?.step === "revert";
    const advisory = list.filter((step) => step.ok && step.advisory).map((step) => step.message);
    return { tone: "warn", text: [t(nothing ? "notice.revertEmpty" : "notice.reverted"), ...advisory].join("；") };
  }
  if (unsnapshotted.length > 0) {
    return {
      tone: "warn",
      text: t("notice.noSnapshot", { steps: unsnapshotted.map((step) => step.message).join("；") })
    };
  }
  return { tone: "ok", text: t("notice.applied") };
};
var summarizeApplyOutcome = (steps, mode, t, extra = {}) => {
  const base = summarizeBaseApplyOutcome(steps, mode, t);
  if (!extra?.appliedError) return base;
  const landed = (Array.isArray(steps) ? steps : []).some((step) => step.ok);
  const note = mode === "apply" ? landed ? t("notice.appliedRecordFailed", { reason: extra.appliedError }) : t("notice.recordFailed", { reason: extra.appliedError }) : mode === "noop" ? t("notice.recordFailed", { reason: extra.appliedError }) : t("notice.revertRecordFailed", { reason: extra.appliedError });
  return { tone: "warn", text: `${base.text}；${note}` };
};

// src/panel/status.jsx
var TONE2 = { ok: "ok", warn: "warn", fail: "bad", off: "off" };
var STATUS_KEY = {
  ok: "status.ok",
  warn: "status.warn",
  fail: "status.fail",
  off: "status.off"
};
function StatusView({ t, data, busy, onApply, onRevert, onRefresh }) {
  const selfcheck = data?.selfcheck || { items: [], counts: {} };
  const config = data?.config || {};
  const applied = config.applied || null;
  const approvalTracked = (Array.isArray(applied?.globalTools) ? applied.globalTools.length : 0) + Object.values(applied?.projectApprovals || {}).reduce(
    (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
    0
  );
  return /* @__PURE__ */ h("div", { className: "pg-stack" }, /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, { extra: /* @__PURE__ */ h(Badge, { tone: selfcheck.counts?.fail ? "bad" : selfcheck.counts?.warn ? "warn" : "ok" }, t("status.summary")) }, t("status.layers")), /* @__PURE__ */ h("div", { className: "pg-checklist" }, selfcheck.items.map((item) => /* @__PURE__ */ h("div", { className: "pg-check", key: item.id, "data-tone": TONE2[item.status] || "muted" }, /* @__PURE__ */ h("span", { className: "pg-check-dot", "aria-hidden": "true" }), /* @__PURE__ */ h("div", { className: "pg-check-main" }, /* @__PURE__ */ h("div", { className: "pg-check-line" }, /* @__PURE__ */ h("span", { className: "pg-check-title" }, item.title), /* @__PURE__ */ h("span", { className: "pg-check-state" }, t(STATUS_KEY[item.status] || "status.off"))), /* @__PURE__ */ h("div", { className: "pg-check-detail" }, item.detail), item.evidence ? /* @__PURE__ */ h("div", { className: "pg-check-evidence" }, item.evidence) : null)))), /* @__PURE__ */ h("div", { className: "pg-row pg-row-end" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "primary", disabled: busy !== "", onClick: onApply }, t("action.apply")), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: busy !== "", onClick: onRevert }, t("action.revert")), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: busy !== "", onClick: onRefresh }, t("action.recheck")))), /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, null, t("status.managed")), /* @__PURE__ */ h("div", { className: "pg-kv" }, /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("status.enabled")), /* @__PURE__ */ h("span", { className: "pg-kv-value" }, config.enabled ? t("common.on") : t("common.off")), /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("status.prompt")), /* @__PURE__ */ h("span", { className: "pg-kv-value" }, config.prompt?.enabled ? t("common.on") : t("common.off")), /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("status.role")), /* @__PURE__ */ h("span", { className: "pg-kv-value" }, config.role?.enabled ? t("common.on") : t("common.off")), /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("status.proxy")), /* @__PURE__ */ h("span", { className: "pg-kv-value" }, config.proxy?.enabled ? t("common.on") : t("common.off")), /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("status.approval")), /* @__PURE__ */ h("span", { className: "pg-kv-value" }, approvalTracked > 0 ? t("status.approvalTracked", { count: approvalTracked }) : applied ? t("status.approvalNone") : t("status.approvalUnknown")), applied?.at ? /* @__PURE__ */ h(Fragment, null, /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("status.lastApplied")), /* @__PURE__ */ h("span", { className: "pg-kv-value" }, new Date(applied.at).toLocaleString())) : null), !applied ? /* @__PURE__ */ h("div", { className: "pg-note" }, t("status.neverApplied")) : null, applied ? /* @__PURE__ */ h("div", { className: "pg-note" }, t("status.uninstallHint")) : null), /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, null, t("status.boundaries")), /* @__PURE__ */ h("ul", { className: "pg-list" }, /* @__PURE__ */ h("li", null, t("status.boundary.host")), /* @__PURE__ */ h("li", null, t("status.boundary.sensitive")), /* @__PURE__ */ h("li", null, t("status.boundary.sidebar")), /* @__PURE__ */ h("li", null, t("status.boundary.proxy")))));
}

// src/panel/prompts.jsx
var pickLocalized = (value, locale) => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return value[locale] || value.default || value["zh-CN"] || "";
};
var PRESET_CONFIRM_MS = 3500;
var normText = (value) => String(value || "").replace(/\r\n/g, "\n").trim();
function PromptsView({ t, rpc, notify, config, reload, locale = "zh-CN" }) {
  const React = getReact();
  const [state, setState] = React.useState({ status: "loading", error: "", data: null });
  const [presets, setPresets] = React.useState({ builtin: [], custom: [] });
  const [draft, setDraft] = React.useState({ content: "", isActive: true, name: "" });
  const [roleDraft, setRoleDraft] = React.useState("");
  const [roleEnabled, setRoleEnabled] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [presetName, setPresetName] = React.useState("");
  const [presetConfirm, setPresetConfirm] = React.useState("");
  const [recycle, setRecycle] = React.useState(null);
  const baselineRef = React.useRef({ content: "", name: "", role: "" });
  const load = React.useCallback(async () => {
    try {
      const [data, presetData] = await Promise.all([rpc.prompts(), rpc.presets()]);
      setState({ status: "ready", error: "", data });
      setPresets({ builtin: presetData?.builtin || [], custom: presetData?.custom || [] });
      setDraft({
        content: data?.config?.prompt?.content || "",
        isActive: data?.config?.prompt?.isActive !== false,
        name: data?.config?.prompt?.name || ""
      });
      setRoleDraft(data?.config?.role?.content || "");
      setRoleEnabled(data?.config?.role?.enabled === true);
      baselineRef.current = {
        content: data?.config?.prompt?.content || "",
        name: data?.config?.prompt?.name || "",
        role: data?.config?.role?.content || ""
      };
    } catch (error) {
      setState({ status: "error", error: String(error?.message || error), data: null });
    }
  }, [rpc]);
  React.useEffect(() => {
    void load();
  }, [load]);
  React.useEffect(() => {
    if (!presetConfirm) return void 0;
    const timer = setTimeout(() => setPresetConfirm(""), PRESET_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [presetConfirm]);
  const isDirty = () => normText(draft.content) !== normText(baselineRef.current.content) || normText(draft.name) !== normText(baselineRef.current.name) || normText(roleDraft) !== normText(baselineRef.current.role);
  const savePrompt = async () => {
    if (busy) return;
    setBusy("prompt");
    try {
      const result = await rpc.applyPrompt({
        content: draft.content,
        isActive: draft.isActive,
        name: draft.name || void 0
      });
      const summary = summarizeApplyOutcome(result?.steps, applyModeOf(result?.mode), t, {
        appliedError: result?.appliedError
      });
      notify(summary.tone, summary.text);
      await load();
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  const removePrompt = async () => {
    if (busy) return;
    setBusy("prompt");
    try {
      await rpc.removePrompt();
      notify("ok", t("prompts.removed"));
      await load();
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  const requestRemovePrompt = () => {
    const key = "prompt-remove";
    if (presetConfirm !== key) {
      setPresetConfirm(key);
      notify("warn", t("prompts.removeConfirm"));
      return;
    }
    setPresetConfirm("");
    void removePrompt();
  };
  const saveRole = async () => {
    if (busy) return;
    setBusy("role");
    try {
      const result = await rpc.applyRole(roleDraft);
      const summary = summarizeApplyOutcome(result?.steps, applyModeOf(result?.mode), t, {
        appliedError: result?.appliedError
      });
      notify(summary.tone, summary.text);
      await load();
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  const doRestoreRole = async () => {
    if (busy) return;
    setBusy("role");
    try {
      const result = await rpc.restoreRole();
      notify("ok", result?.message || t("prompts.roleRestored"));
      await load();
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  const requestRestoreRole = () => {
    const key = "role-restore";
    if (presetConfirm !== key) {
      setPresetConfirm(key);
      notify("warn", t("prompts.roleRestoreConfirm"));
      return;
    }
    setPresetConfirm("");
    void doRestoreRole();
  };
  const applyPreset = (preset) => {
    setDraft({
      content: preset.directive || "",
      isActive: true,
      name: pickLocalized(preset.name, locale)
    });
    setRoleDraft(preset.role || "");
    setRoleEnabled(Boolean(preset.role));
    setPresetConfirm("");
    notify("info", t("prompts.presetLoaded", { name: pickLocalized(preset.name, locale) }));
  };
  const usePreset = (preset) => {
    const name = pickLocalized(preset.name, locale);
    if (!isDirty()) {
      applyPreset(preset);
      return;
    }
    const key = `load-${preset.id}`;
    if (presetConfirm !== key) {
      setPresetConfirm(key);
      notify("warn", t("prompts.presetOverwriteConfirm", { name }));
      return;
    }
    applyPreset(preset);
  };
  const savePreset = async () => {
    if (busy) return;
    const name = presetName.trim();
    if (!name) {
      notify("warn", t("prompts.presetNameRequired"));
      return;
    }
    setBusy("preset");
    try {
      await rpc.savePreset({
        id: `p${Date.now().toString(36)}`,
        name,
        directive: draft.content,
        role: roleDraft,
        boost: true
      });
      setPresetName("");
      const presetData = await rpc.presets();
      setPresets({ builtin: presetData?.builtin || [], custom: presetData?.custom || [] });
      notify("ok", t("prompts.presetSaved"));
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  const removePreset = async (preset) => {
    if (busy) return;
    setBusy("preset");
    try {
      await rpc.removePreset(preset.id);
      const presetData = await rpc.presets();
      setPresets({ builtin: presetData?.builtin || [], custom: presetData?.custom || [] });
      setRecycle({ preset });
      notify("ok", t("prompts.presetDeleted", { name: preset.name }));
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  const requestRemovePreset = (preset) => {
    const key = `trash-${preset.id}`;
    if (presetConfirm !== key) {
      setPresetConfirm(key);
      notify("warn", t("prompts.presetDeleteConfirm", { name: preset.name }));
      return;
    }
    setPresetConfirm("");
    void removePreset(preset);
  };
  const restoreRecycle = async () => {
    const preset = recycle?.preset;
    if (!preset || busy) return;
    setBusy("preset");
    try {
      await rpc.savePreset({
        id: preset.id,
        name: preset.name,
        directive: preset.directive || "",
        role: preset.role || "",
        boost: preset.boost !== false,
        providers: preset.providers
      });
      const presetData = await rpc.presets();
      setPresets({ builtin: presetData?.builtin || [], custom: presetData?.custom || [] });
      setRecycle(null);
      notify("ok", t("prompts.presetRestored", { name: preset.name }));
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  if (state.status === "loading") return /* @__PURE__ */ h(Loading, { text: t("common.loading") });
  if (state.status === "error") {
    return /* @__PURE__ */ h(
      ErrorBox,
      {
        title: t("error.title"),
        message: state.error,
        action: /* @__PURE__ */ h(Btn, { size: "sm", onClick: () => void load() }, t("action.retry"))
      }
    );
  }
  const promptsList = state.data?.prompts;
  const promptsUnreadable = !Array.isArray(promptsList);
  const prompts = Array.isArray(promptsList) ? promptsList : [];
  const managed = prompts.find((entry) => entry?.promptId === state.data?.managedPromptId);
  const promptBadge = managed ? /* @__PURE__ */ h(Badge, { tone: "ok" }, t("prompts.managedBadge")) : promptsUnreadable ? /* @__PURE__ */ h(Badge, { tone: "warn" }, t("prompts.unreadableBadge")) : /* @__PURE__ */ h(Badge, { tone: "off" }, t("prompts.notApplied"));
  const custom = presets.custom || [];
  return /* @__PURE__ */ h("div", { className: "pg-stack" }, /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, { extra: promptBadge }, t("prompts.systemTitle")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("prompts.systemHint")), promptsUnreadable ? /* @__PURE__ */ h("div", { className: "pg-inline-warn" }, `${t("prompts.unreadableTitle")}：${state.data?.denied?.reason || t("prompts.unreadableHint")}`) : null, /* @__PURE__ */ h("label", { className: "pg-label" }, t("prompts.name")), /* @__PURE__ */ h(
    "input",
    {
      className: "pg-input",
      value: draft.name,
      placeholder: t("prompts.namePlaceholder"),
      onChange: (event) => setDraft((prev) => ({ ...prev, name: event.target.value }))
    }
  ), /* @__PURE__ */ h("label", { className: "pg-label" }, t("prompts.content")), /* @__PURE__ */ h(
    "textarea",
    {
      className: "pg-textarea",
      rows: 8,
      value: draft.content,
      onChange: (event) => setDraft((prev) => ({ ...prev, content: event.target.value }))
    }
  ), /* @__PURE__ */ h("div", { className: "pg-row" }, /* @__PURE__ */ h(
    Toggle,
    {
      checked: draft.isActive,
      onChange: (next) => setDraft((prev) => ({ ...prev, isActive: next })),
      label: t("prompts.active")
    }
  )), /* @__PURE__ */ h("div", { className: "pg-row pg-row-end" }, managed ? /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: presetConfirm === "prompt-remove" ? "danger" : "ghost",
      disabled: busy !== "",
      onClick: () => void requestRemovePrompt()
    },
    presetConfirm === "prompt-remove" ? t("prompts.removeArmed") : t("prompts.remove")
  ) : null, /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: "primary",
      disabled: busy !== "" || promptsUnreadable || !draft.content.trim(),
      onClick: () => void savePrompt()
    },
    t("prompts.saveApply")
  )), !managed && !promptsUnreadable ? /* @__PURE__ */ h("div", { className: "pg-note" }, t("prompts.notInLibrary")) : null), /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, { extra: /* @__PURE__ */ h(Badge, { tone: state.data?.role?.denied ? "bad" : "off" }, state.data?.role?.filePath || t("prompts.roleFile")) }, t("prompts.roleTitle")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("prompts.roleHint")), /* @__PURE__ */ h(
    "textarea",
    {
      className: "pg-textarea",
      rows: 6,
      value: roleDraft,
      onChange: (event) => setRoleDraft(event.target.value)
    }
  ), /* @__PURE__ */ h("div", { className: "pg-row" }, /* @__PURE__ */ h(Toggle, { checked: roleEnabled, onChange: setRoleEnabled, label: t("prompts.roleEnable"), disabled: true })), /* @__PURE__ */ h("div", { className: "pg-row pg-row-end" }, /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: presetConfirm === "role-restore" ? "danger" : "ghost",
      disabled: busy !== "",
      onClick: () => void requestRestoreRole()
    },
    presetConfirm === "role-restore" ? t("prompts.roleRestoreArmed") : t("prompts.roleRestore")
  ), /* @__PURE__ */ h(Btn, { size: "sm", variant: "primary", disabled: busy !== "" || !roleDraft.trim(), onClick: () => void saveRole() }, t("prompts.roleSave")))), /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, null, t("prompts.presets")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("prompts.presetsHint")), /* @__PURE__ */ h("div", { className: "pg-preset-list" }, presets.builtin.map((preset) => /* @__PURE__ */ h("div", { className: "pg-preset", key: preset.id }, /* @__PURE__ */ h("div", { className: "pg-preset-main" }, /* @__PURE__ */ h("div", { className: "pg-preset-name" }, pickLocalized(preset.name, locale)), /* @__PURE__ */ h("div", { className: "pg-preset-summary" }, pickLocalized(preset.summary, locale))), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => usePreset(preset) }, t("prompts.usePreset")))), custom.length === 0 ? /* @__PURE__ */ h(EmptyState, { hint: t("prompts.noCustom") }) : custom.map((preset) => /* @__PURE__ */ h("div", { className: "pg-preset", key: preset.id }, /* @__PURE__ */ h("div", { className: "pg-preset-main" }, /* @__PURE__ */ h("div", { className: "pg-preset-name" }, preset.name), /* @__PURE__ */ h("div", { className: "pg-preset-summary" }, preset.directive)), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: presetConfirm === `load-${preset.id}` ? "primary" : "ghost",
      onClick: () => usePreset(preset)
    },
    presetConfirm === `load-${preset.id}` ? t("prompts.presetOverwriteArmed") : t("prompts.usePreset")
  ), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: presetConfirm === `trash-${preset.id}` ? "danger" : "ghost",
      disabled: busy !== "",
      onClick: () => requestRemovePreset(preset)
    },
    presetConfirm === `trash-${preset.id}` ? t("prompts.presetDeleteArmed") : t("action.delete")
  )))), recycle?.preset ? /* @__PURE__ */ h("div", { className: "pg-row pg-row-end" }, /* @__PURE__ */ h("span", { className: "pg-meta" }, t("prompts.presetRecycleHint", { name: recycle.preset.name })), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: busy !== "", onClick: () => void restoreRecycle() }, t("prompts.presetUndo"))) : null, /* @__PURE__ */ h("div", { className: "pg-row" }, /* @__PURE__ */ h(
    "input",
    {
      className: "pg-input",
      value: presetName,
      placeholder: t("prompts.presetNamePlaceholder"),
      onChange: (event) => setPresetName(event.target.value)
    }
  ), /* @__PURE__ */ h(Btn, { size: "sm", disabled: busy !== "" || !presetName.trim(), onClick: () => void savePreset() }, t("prompts.savePreset")))), config?.proxy?.enabled ? /* @__PURE__ */ h("div", { className: "pg-note" }, t("prompts.proxyHint")) : null);
}

// src/panel/approval.jsx
function ApprovalView({ t, rpc, notify, config, reload }) {
  const React = getReact();
  const [projectId, setProjectId] = React.useState(config?.approval?.projectId || "");
  const [loadedProjectId, setLoadedProjectId] = React.useState("");
  const [state, setState] = React.useState({ status: "loading", error: "", data: null });
  const [globalTools, setGlobalTools] = React.useState([]);
  const [newTool, setNewTool] = React.useState("");
  const [projectTools, setProjectTools] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [projectLoading, setProjectLoading] = React.useState(false);
  const unreadable = Boolean(state.data?.denied || state.data?.unknown);
  const projectKnown = Boolean(state.data?.projectKnown);
  const projectUnreadable = Boolean(loadedProjectId) && !projectKnown;
  const projectMismatch = Boolean(loadedProjectId) && projectId.trim() !== loadedProjectId;
  const readNames = () => projectTools.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const pendingCount = new Set(readNames()).size;
  const globalBaseline = Array.isArray(state.data?.globalTools) ? state.data.globalTools : [];
  const globalAdded = globalTools.filter((tool) => !globalBaseline.includes(tool)).length;
  const globalRemoved = globalBaseline.filter((tool) => !globalTools.includes(tool)).length;
  const load = React.useCallback(
    async (id) => {
      const target = String(id || "").trim();
      setProjectLoading(true);
      try {
        const data2 = await rpc.approval(target);
        setState({ status: "ready", error: "", data: data2 });
        setGlobalTools(data2?.globalTools || []);
        setProjectTools("");
        setLoadedProjectId(target);
      } catch (error) {
        setState({ status: "error", error: String(error?.message || error), data: null });
        setLoadedProjectId("");
      } finally {
        setProjectLoading(false);
      }
    },
    [rpc]
  );
  React.useEffect(() => {
    void load(config?.approval?.projectId || "");
  }, [rpc]);
  const addTool = () => {
    if (unreadable) {
      notify("bad", t("approval.unreadableNotSavable"));
      return;
    }
    const tool = newTool.trim();
    if (!tool) return;
    if (!/^[A-Za-z0-9_.:\-/]{1,160}$/.test(tool)) {
      notify("warn", t("approval.invalidTool"));
      return;
    }
    setGlobalTools((list) => list.includes(tool) ? list : [...list, tool]);
    setNewTool("");
  };
  const saveGlobal = async () => {
    if (busy) return;
    if (unreadable) {
      notify("bad", t("approval.unreadableNotSavable"));
      return;
    }
    if (globalTools.length === 0) {
      notify("warn", t("approval.emptyNotSavable"));
      return;
    }
    setBusy("global");
    try {
      const latest = await rpc.approval(projectId);
      if (latest?.denied || latest?.unknown) {
        setState({ status: "ready", error: "", data: latest });
        notify("bad", t("approval.unreadableNotSavable"));
        return;
      }
      const latestHash = latest?.globalToolsHash || "";
      if (state.data?.globalToolsHash && latestHash !== state.data.globalToolsHash) {
        setState({ status: "ready", error: "", data: latest });
        notify("warn", t("approval.staleList"));
        return;
      }
      const result = await rpc.setGlobalTools(globalTools, latestHash);
      if (result?.current && !result.current.unknown && !result.current.denied) {
        setGlobalTools(result.current.globalTools || globalTools);
      }
      notify("ok", t("approval.globalSaved"));
      await load(projectId);
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  const applyProject = async (approved) => {
    if (busy) return;
    const names = [...new Set(readNames())];
    if (!loadedProjectId) {
      notify("warn", t("approval.projectLoadRequired"));
      return;
    }
    if (projectId.trim() !== loadedProjectId) {
      notify("warn", t("approval.projectReloadRequired"));
      return;
    }
    if (!projectKnown) {
      notify("bad", t("approval.projectUnreadable"));
      return;
    }
    if (names.length === 0) {
      notify("warn", t("approval.toolRequired"));
      return;
    }
    setBusy("project");
    try {
      const result = await rpc.setProjectTools(loadedProjectId, names, approved);
      if (approved && result?.limitReached) {
        notify("warn", t("approval.projectLimitReached"));
      } else {
        notify("ok", approved ? t("approval.projectGranted") : t("approval.projectRevoked"));
      }
      await load(loadedProjectId);
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  if (state.status === "loading") return /* @__PURE__ */ h(Loading, { text: t("common.loading") });
  if (state.status === "error") {
    return /* @__PURE__ */ h(
      ErrorBox,
      {
        title: t("error.title"),
        message: state.error,
        action: /* @__PURE__ */ h(Btn, { size: "sm", onClick: () => void load(projectId) }, t("action.retry"))
      }
    );
  }
  const data = state.data || {};
  const sensitive = Array.isArray(data.sensitiveCommands) ? data.sensitiveCommands : [];
  return /* @__PURE__ */ h("div", { className: "pg-stack" }, /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, { extra: /* @__PURE__ */ h(Badge, { tone: "warn" }, t("approval.replaceWarn")) }, t("approval.globalTitle")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("approval.globalHint")), unreadable ? /* @__PURE__ */ h("div", { className: "pg-inline-warn" }, `${t("approval.unreadableTitle")}：${data.denied?.reason || t("approval.unreadableHint")}`) : null, !unreadable ? /* @__PURE__ */ h("div", { className: "pg-meta" }, t("approval.globalDiff", {
    total: globalTools.length,
    added: globalAdded,
    removed: globalRemoved
  })) : null, /* @__PURE__ */ h("div", { className: "pg-chips" }, globalTools.length === 0 ? /* @__PURE__ */ h("span", { className: "pg-meta" }, t("approval.empty")) : null, globalTools.map((tool) => /* @__PURE__ */ h("span", { className: "pg-chip", key: tool }, /* @__PURE__ */ h("span", null, tool), /* @__PURE__ */ h(
    "button",
    {
      type: "button",
      className: "pg-chip-x",
      title: t("action.remove"),
      onClick: () => setGlobalTools((list) => list.filter((item) => item !== tool))
    },
    "x"
  )))), /* @__PURE__ */ h("div", { className: "pg-row" }, /* @__PURE__ */ h(
    "input",
    {
      className: "pg-input",
      value: newTool,
      placeholder: t("approval.toolPlaceholder"),
      disabled: unreadable,
      onChange: (event) => setNewTool(event.target.value),
      onKeyDown: (event) => {
        if (event.key === "Enter") addTool();
      }
    }
  ), /* @__PURE__ */ h(Btn, { size: "sm", disabled: unreadable, onClick: addTool }, t("action.add")), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: "primary",
      disabled: busy !== "" || unreadable || globalTools.length === 0,
      onClick: () => void saveGlobal()
    },
    t("approval.saveGlobal")
  ))), /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, null, t("approval.projectTitle")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("approval.projectHint")), /* @__PURE__ */ h("div", { className: "pg-row" }, /* @__PURE__ */ h(
    "input",
    {
      className: "pg-input",
      value: projectId,
      placeholder: t("approval.projectPlaceholder"),
      onChange: (event) => setProjectId(event.target.value)
    }
  ), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: "ghost",
      disabled: projectLoading || busy !== "",
      onClick: () => void load(projectId.trim())
    },
    t("action.load")
  )), projectUnreadable ? /* @__PURE__ */ h("div", { className: "pg-inline-warn" }, t("approval.projectUnreadable")) : null, projectMismatch ? /* @__PURE__ */ h("div", { className: "pg-inline-warn" }, t("approval.projectReloadRequired")) : null, projectKnown && Array.isArray(data.projectTools) && data.projectTools.length ? /* @__PURE__ */ h("div", { className: "pg-chips" }, data.projectTools.map((tool) => /* @__PURE__ */ h("span", { className: "pg-chip", "data-tone": "ok", key: tool }, tool))) : projectKnown ? /* @__PURE__ */ h("div", { className: "pg-meta" }, t("approval.projectEmpty")) : /* @__PURE__ */ h("div", { className: "pg-meta" }, t("approval.projectLoadFirst")), /* @__PURE__ */ h(
    "textarea",
    {
      className: "pg-textarea",
      rows: 4,
      value: projectTools,
      placeholder: t("approval.projectToolsPlaceholder"),
      onChange: (event) => setProjectTools(event.target.value)
    }
  ), /* @__PURE__ */ h("div", { className: "pg-meta" }, loadedProjectId ? `${t("approval.projectTarget", { projectId: loadedProjectId })} · ${t("approval.projectCount", {
    count: pendingCount
  })}` : t("approval.projectLoadFirst")), /* @__PURE__ */ h("div", { className: "pg-row pg-row-end" }, /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: "ghost",
      disabled: busy !== "" || projectMismatch || projectUnreadable || !loadedProjectId,
      onClick: () => void applyProject(false)
    },
    t("approval.revoke")
  ), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: "primary",
      disabled: busy !== "" || projectMismatch || projectUnreadable || !loadedProjectId,
      onClick: () => void applyProject(true)
    },
    t("approval.grant")
  ))), /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, { extra: /* @__PURE__ */ h(Badge, { tone: "off" }, sensitive.length) }, t("approval.sensitiveTitle")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("approval.sensitiveHint")), sensitive.length === 0 ? /* @__PURE__ */ h("div", { className: "pg-meta" }, t("approval.sensitiveEmpty")) : /* @__PURE__ */ h("div", { className: "pg-table pg-table-3" }, /* @__PURE__ */ h("div", { className: "pg-table-head" }, /* @__PURE__ */ h("span", null, t("approval.ruleId")), /* @__PURE__ */ h("span", null, t("approval.pattern")), /* @__PURE__ */ h("span", null, t("common.state"))), sensitive.map((rule) => /* @__PURE__ */ h("div", { className: "pg-table-row", key: rule.commandId || rule.id || rule.pattern }, /* @__PURE__ */ h("span", null, rule.commandId || rule.id || "-"), /* @__PURE__ */ h("span", { className: "pg-mono" }, rule.pattern || "-"), /* @__PURE__ */ h("span", null, rule.enabled === false ? t("common.off") : t("common.on"))))), /* @__PURE__ */ h("div", { className: "pg-note" }, t("approval.sensitiveBoundary"))));
}

// src/panel/redteam.jsx
var ENV_LABEL = {
  fofa: "redteam.env.fofa",
  vpsHost: "redteam.env.vpsHost",
  vpsKey: "redteam.env.vpsKey",
  toolkit: "redteam.env.toolkit",
  setupMarker: "redteam.env.setupMarker",
  tools: "redteam.env.tools"
};
var ENV_TONE = { ok: "ok", warn: "warn", off: "off" };
var skillTone = (item) => {
  if (item.broken) return "bad";
  if (item.installed && item.enabled) return "ok";
  if (item.installed) return "off";
  return "muted";
};
function RedteamView({ t, rpc, notify, refreshTick = 0, onOpenRoster }) {
  const React = getReact();
  const [state, setState] = React.useState({ status: "loading", error: "", data: null });
  const [busy, setBusy] = React.useState("");
  const [role, setRole] = React.useState("");
  const [preview, setPreview] = React.useState(null);
  const load = React.useCallback(async ({ force = false } = {}) => {
    try {
      const data2 = await rpc.redteam(force ? { refresh: 1 } : void 0);
      setState({ status: "ready", error: "", data: data2 });
    } catch (error) {
      setState({ status: "error", error: String(error?.message || error), data: null });
    }
  }, [rpc]);
  React.useEffect(() => {
    void load();
  }, [load, refreshTick]);
  const run = async (key, task) => {
    if (busy) return null;
    setBusy(key);
    try {
      const result = await task();
      if (result?.items) setState({ status: "ready", error: "", data: result });
      return result;
    } catch (error) {
      notify("bad", String(error?.message || error));
      return null;
    } finally {
      setBusy("");
    }
  };
  const installOne = (name) => run(name, async () => {
    const result = await rpc.installRedteam({ name });
    const item = result?.results?.[0] || {};
    const action = item.action || "";
    if (item.indexError) {
      notify("warn", String(item.indexError));
    } else {
      notify(
        "ok",
        action === "updated" ? t("redteam.updated", { name }) : t("redteam.installed", { name })
      );
    }
    return result;
  });
  const installAll = () => run("all", async () => {
    const result = await rpc.installRedteam({ all: true });
    const failed = (result?.results || []).filter((item) => item.action === "failed");
    const indexFailed = (result?.results || []).filter((item) => item.indexError);
    if (failed.length) {
      notify("warn", t("redteam.installPartial", { count: failed.length }));
    } else if (indexFailed.length) {
      notify("warn", String(indexFailed[0].indexError));
    } else {
      notify("ok", t("redteam.installDone", { count: (result?.results || []).length }));
    }
    return result;
  });
  const toggle = (item) => run(`t-${item.name}`, async () => {
    const result = await rpc.toggleRedteam(item.name, !item.enabled);
    notify("ok", item.enabled ? t("redteam.disabled", { name: item.name }) : t("redteam.enabled", { name: item.name }));
    return result;
  });
  const removeOne = (item) => run(`r-${item.name}`, async () => {
    const result = await rpc.removeRedteam(item.name);
    if (result?.indexError) notify("warn", String(result.indexError));
    else notify("ok", t("redteam.removed", { name: item.name }));
    if (preview?.name === item.name) setPreview(null);
    return result;
  });
  const view = async (item) => {
    try {
      const data2 = await rpc.redteamSkill(item.name);
      setPreview(data2);
    } catch (error) {
      notify("bad", String(error?.message || error));
    }
  };
  if (state.status === "loading") return /* @__PURE__ */ h(Loading, { text: t("common.loading") });
  if (state.status === "error") {
    return /* @__PURE__ */ h(
      ErrorBox,
      {
        title: t("error.title"),
        message: state.error,
        action: /* @__PURE__ */ h(Btn, { size: "sm", onClick: () => void load({ force: true }) }, t("action.retry"))
      }
    );
  }
  const data = state.data || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const counts = data.counts || {};
  const env = data.env || { items: [], tools: [] };
  const roles = Array.from(new Set(items.map((item) => item.role).filter(Boolean))).sort();
  const visible = role ? items.filter((item) => item.role === role) : items;
  const stateLabel2 = (item) => {
    if (item.broken) return t("redteam.state.broken");
    if (item.installed && item.enabled) return t("redteam.state.enabled");
    if (item.installed) return t("redteam.state.disabled");
    return t("redteam.state.notInstalled");
  };
  return /* @__PURE__ */ h("div", { className: "pg-stack" }, /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(
    SectionTitle,
    {
      extra: /* @__PURE__ */ h(Badge, { tone: counts.installed ? "ok" : "off" }, `${counts.installed || 0}/${counts.total || 0}`)
    },
    t("redteam.title")
  ), /* @__PURE__ */ h("div", { className: "pg-note" }, t("redteam.hint")), /* @__PURE__ */ h("div", { className: "pg-kv" }, /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("redteam.libraryDir")), /* @__PURE__ */ h("span", { className: "pg-kv-value pg-mono" }, data.libraryDir || "-"), /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("redteam.skillsDir")), /* @__PURE__ */ h("span", { className: "pg-kv-value pg-mono" }, data.skillsDir || "-"), /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("redteam.enabledCount")), /* @__PURE__ */ h("span", { className: "pg-kv-value" }, `${counts.enabled || 0}/${counts.total || 0}`)), /* @__PURE__ */ h("div", { className: "pg-row pg-row-end" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: busy !== "", onClick: () => void load({ force: true }) }, t("action.refresh")), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: busy !== "", onClick: () => onOpenRoster?.() }, t("roster.open")), /* @__PURE__ */ h(Btn, { size: "sm", variant: "primary", disabled: busy !== "" || items.length === 0, onClick: () => void installAll() }, t("redteam.installAll")))), /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, { extra: /* @__PURE__ */ h(Badge, { tone: "muted" }, `${visible.length}`) }, t("redteam.library")), /* @__PURE__ */ h("div", { className: "pg-chips" }, /* @__PURE__ */ h("button", { type: "button", className: "pg-chip", "data-tone": role === "" ? "ok" : void 0, onClick: () => setRole("") }, t("redteam.allRoles")), roles.map((id) => /* @__PURE__ */ h(
    "button",
    {
      key: id,
      type: "button",
      className: "pg-chip",
      "data-tone": role === id ? "ok" : void 0,
      onClick: () => setRole(id)
    },
    id
  ))), visible.length === 0 ? /* @__PURE__ */ h("div", { className: "pg-meta" }, t("redteam.empty")) : null, /* @__PURE__ */ h("div", { className: "pg-preset-list" }, visible.map((item) => /* @__PURE__ */ h("div", { className: "pg-preset", key: item.name }, /* @__PURE__ */ h("div", { className: "pg-preset-main" }, /* @__PURE__ */ h("span", { className: "pg-preset-name" }, item.name, item.role ? /* @__PURE__ */ h("span", { className: "pg-role-tag" }, item.role) : null), /* @__PURE__ */ h("span", { className: "pg-preset-summary" }, item.description || item.whenToUse || "")), /* @__PURE__ */ h(Badge, { tone: skillTone(item) }, stateLabel2(item)), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => void view(item) }, t("redteam.view")), item.installed ? /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: busy !== "", onClick: () => void toggle(item) }, item.enabled ? t("redteam.disable") : t("redteam.enable")) : null, /* @__PURE__ */ h(Btn, { size: "sm", variant: item.installed ? "ghost" : "primary", disabled: busy !== "", onClick: () => void installOne(item.name) }, item.installed ? item.updateAvailable ? t("redteam.update") : t("redteam.reinstall") : t("redteam.install")), item.installed ? /* @__PURE__ */ h(
    "button",
    {
      type: "button",
      className: "pg-chip-x",
      title: t("action.remove"),
      disabled: busy !== "",
      onClick: () => void removeOne(item)
    },
    "x"
  ) : null)))), preview ? /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(
    SectionTitle,
    {
      extra: /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => setPreview(null) }, t("redteam.close"))
    },
    `${preview.name} · ${preview.chars}`
  ), /* @__PURE__ */ h("div", { className: "pg-note" }, t("redteam.previewHint")), /* @__PURE__ */ h("pre", { className: "pg-pre" }, preview.content)) : null, /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(
    SectionTitle,
    {
      extra: /* @__PURE__ */ h(Badge, { tone: env.counts?.warn ? "warn" : env.counts?.ok ? "ok" : "off" }, `${env.counts?.ok || 0}/${(env.items || []).length}`)
    },
    t("redteam.env.title")
  ), /* @__PURE__ */ h("div", { className: "pg-note" }, t("redteam.env.hint")), /* @__PURE__ */ h("div", { className: "pg-table pg-table-3" }, /* @__PURE__ */ h("div", { className: "pg-table-head" }, /* @__PURE__ */ h("span", null, t("redteam.env.item")), /* @__PURE__ */ h("span", null, t("redteam.env.evidence")), /* @__PURE__ */ h("span", null, t("common.state"))), (env.items || []).map((item) => /* @__PURE__ */ h("div", { className: "pg-table-row", key: item.id }, /* @__PURE__ */ h("span", null, ENV_LABEL[item.id] ? t(ENV_LABEL[item.id]) : item.id), /* @__PURE__ */ h("span", { className: "pg-mono" }, item.detail || "-"), /* @__PURE__ */ h("span", null, /* @__PURE__ */ h(Badge, { tone: ENV_TONE[item.status] || "muted" }, t(`redteam.env.${item.status}`)))))), /* @__PURE__ */ h("div", { className: "pg-chips" }, (env.tools || []).map((tool) => /* @__PURE__ */ h("span", { className: "pg-chip", "data-tone": tool.found ? "ok" : void 0, key: tool.name, title: tool.path || t("redteam.env.missing") }, tool.name)))), /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, null, t("redteam.boundary.title")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("redteam.boundary.skills")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("redteam.boundary.tools")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("redteam.boundary.workflow")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("redteam.boundary.legal"))));
}

// src/shared/roster-session.js
var TURN_TIMEOUT_MS = 30 * 60 * 1e3;
var TURN_TIMEOUT_MINUTES = Math.round(TURN_TIMEOUT_MS / 6e4);
var SESSION_DONE_STATUSES = ["completed", "failed", "cancelled"];

// src/panel/roster.jsx
var NET = { width: 600, height: 372, cx: 300, cy: 174, radius: 126 };
var NODE_RADIUS = 42;
var POLL_MS = 8e3;
var HINT_MS = 3200;
var CONFIRM_MS = 3500;
var CHAIN_CONFIRM_MS = 8e3;
var STEP_TEXT_MAX = 300;
var nodePosition = (index) => {
  const angle = (-90 + index * 72) * (Math.PI / 180);
  return { x: NET.cx + Math.cos(angle) * NET.radius, y: NET.cy + Math.sin(angle) * NET.radius };
};
var STATUS_TONE = {
  running: "ok",
  completed: "ok",
  failed: "bad",
  cancelled: "warn",
  idle: "muted",
  unavailable: "muted",
  pending: "off",
  queued: "muted",
  missing: "bad"
};
var STATUS_LABEL = {
  running: "roster.status.running",
  completed: "roster.status.completed",
  failed: "roster.status.failed",
  cancelled: "roster.status.cancelled",
  idle: "roster.status.idle",
  unavailable: "roster.status.unavailable",
  pending: "roster.status.pending",
  queued: "roster.status.queued",
  missing: "roster.status.missing"
};
var CHAIN_ROLES = ["redteam_recon", "redteam_assess", "redteam_vuln_scan", "redteam_exploit", "redteam_internal"];
var DEFAULT_CHAIN_ROLES = ["redteam_recon", "redteam_assess", "redteam_vuln_scan"];
var MAX_STEP_TASKS = ROSTER_BATCH_MAX;
var CHAIN_RUNNING_MAX = ROSTER_CHAIN_RUNNING_MAX;
var HIGH_IMPACT_ROLES = ["redteam_exploit", "redteam_internal"];
var CHAIN_CONFIRM_KEY = "chain-start";
var CHAIN_TONE = { running: "ok", paused: "warn", blocked: "bad", completed: "ok", stopped: "muted" };
var MEMBER_FILTERS = [
  ["all", "roster.filter.all"],
  ["running", "roster.filter.running"],
  ["done", "roster.filter.done"],
  ["pending", "roster.filter.pending"]
];
var TASK_FILTERS = [
  ["all", "roster.filter.all"],
  ["running", "roster.filter.running"],
  ["done", "roster.filter.done"]
];
var fmtTokens = (value) => {
  const count = Number(value) || 0;
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}k`;
  return String(count);
};
var fmtDuration = (ms) => {
  const value = Number(ms) || 0;
  if (value <= 0) return "-";
  const total = Math.round(value / 1e3);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
};
var fmtTime = (value) => {
  const stamp = Number(value) || 0;
  if (!stamp) return "-";
  try {
    return new Date(stamp).toLocaleString();
  } catch {
    return "-";
  }
};
var shortModel = (model) => {
  const text = String(model || "").trim();
  if (!text) return "-";
  return text.length > 18 ? `${text.slice(0, 17)}…` : text;
};
var activityOf = (role) => role?.activity && typeof role.activity === "object" ? role.activity : null;
var statusOf = (role, activityAvailable = true) => {
  if (!role?.installed) return "pending";
  if (!activityAvailable) return "unavailable";
  const activity = activityOf(role);
  return activity?.status || "idle";
};
var stateTone = (role) => {
  if (!role?.installed) return "off";
  if (role.verification === "index-only") return "warn";
  if (role.updateAvailable) return "warn";
  return "ok";
};
var stateLabel = (role, t) => {
  if (!role?.installed) return t("roster.state.pending");
  if (role.verification === "index-only") return t("roster.state.indexOnly");
  return role.updateAvailable ? t("roster.state.stale") : t("roster.state.ready");
};
var useDebounced = (React, value, delay) => {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
};
var useNow = (React, enabled, step = 5e3) => {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!enabled) return void 0;
    const timer = setInterval(() => setNow(Date.now()), step);
    return () => clearInterval(timer);
  }, [enabled, step]);
  return now;
};
var fmtAgo = (now, stamp, t) => {
  if (!stamp) return t("roster.updated.none");
  const diff = Math.max(0, now - stamp);
  if (diff < 3e3) return t("roster.updated.just");
  const seconds = Math.round(diff / 1e3);
  if (seconds < 60) return t("roster.updated.seconds", { count: seconds });
  return t("roster.updated.minutes", { count: Math.round(seconds / 60) });
};
var IconRefresh = () => /* @__PURE__ */ h("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, /* @__PURE__ */ h("path", { d: "M20 11a8 8 0 1 0-2.3 5.7" }), /* @__PURE__ */ h("path", { d: "M20 5v6h-6" }));
var IconClose = () => /* @__PURE__ */ h("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, /* @__PURE__ */ h("path", { d: "M6 6l12 12M18 6 6 18" }));
var IconTrash = () => /* @__PURE__ */ h("svg", { width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, /* @__PURE__ */ h("path", { d: "M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" }));
var IconChevron = ({ open }) => /* @__PURE__ */ h("svg", { className: "pg-chevron", "data-open": open ? "1" : "0", width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, /* @__PURE__ */ h("path", { d: "m9 6 6 6-6 6" }));
var initialSteps = () => CHAIN_ROLES.map((roleId) => ({ roleId, enabled: DEFAULT_CHAIN_ROLES.includes(roleId), tasks: [] }));
function RosterModal({ t, rpc, notify, onClose }) {
  const React = getReact();
  const [state, setState] = React.useState({ status: "loading", error: "", data: null });
  const [tab, setTab] = React.useState("roster");
  const [selectedId, setSelectedId] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [prompt, setPrompt] = React.useState(null);
  const [searchInput, setSearchInput] = React.useState("");
  const [memberFilter, setMemberFilter] = React.useState("all");
  const [taskFilter, setTaskFilter] = React.useState("all");
  const [chainForm, setChainForm] = React.useState({ target: "", note: "" });
  const [chainSteps, setChainSteps] = React.useState(initialSteps);
  const [openStep, setOpenStep] = React.useState("");
  const [stepDraft, setStepDraft] = React.useState("");
  const [chainOpen, setChainOpen] = React.useState(null);
  const [confirmKey, setConfirmKey] = React.useState("");
  const [hint, setHint] = React.useState(null);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [toolsOpen, setToolsOpen] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [updatedAt, setUpdatedAt] = React.useState(0);
  const dialogRef = React.useRef(null);
  const targetRef = React.useRef(null);
  const busyRef = React.useRef(false);
  busyRef.current = busy !== "";
  const search = useDebounced(React, searchInput, 200);
  const now = useNow(React, updatedAt > 0);
  const load = React.useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setRefreshing(true);
      try {
        const data = await rpc.roster();
        if (!data) return;
        setState({ status: "ready", error: "", data });
        setUpdatedAt(Date.now());
        const firstReady = (data.roles || []).find((role) => role.installed) || data.roles?.[0] || null;
        const firstId = firstReady?.id || "";
        setSelectedId((current2) => current2 || firstId);
      } catch (error) {
        const message = String(error?.message || error);
        setState(
          (prev) => prev.data ? { ...prev, status: "stale", error: message } : { status: "error", error: message, data: null }
        );
      } finally {
        if (!silent) setRefreshing(false);
      }
    },
    [rpc]
  );
  React.useEffect(() => {
    void load();
  }, [load]);
  React.useEffect(() => {
    const timer = setInterval(() => {
      if (busyRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load({ silent: true });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);
  React.useEffect(() => {
    const el = dialogRef.current?.parentElement;
    if (!el) return void 0;
    const fix = () => {
      el.style.left = "0px";
      el.style.top = "0px";
      const rect = el.getBoundingClientRect();
      if (rect.left || rect.top) {
        el.style.left = `${-rect.left}px`;
        el.style.top = `${-rect.top}px`;
      }
    };
    fix();
    window.addEventListener("resize", fix);
    return () => window.removeEventListener("resize", fix);
  }, []);
  React.useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  React.useEffect(() => {
    const node = dialogRef.current;
    if (!node) return void 0;
    const previous = document.activeElement;
    const selector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const first = node.querySelector(selector);
    (first || node).focus?.();
    const onKey = (event) => {
      if (event.key !== "Tab") return;
      const items = Array.from(node.querySelectorAll(selector)).filter(
        (el) => el === document.activeElement || el.offsetParent !== null || el instanceof SVGElement
      );
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  React.useEffect(() => {
    if (!hint) return void 0;
    const timer = setTimeout(() => setHint(null), HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);
  React.useEffect(() => {
    if (!confirmKey) return void 0;
    const ttl = confirmKey === CHAIN_CONFIRM_KEY ? CHAIN_CONFIRM_MS : CONFIRM_MS;
    const timer = setTimeout(() => setConfirmKey(""), ttl);
    return () => clearTimeout(timer);
  }, [confirmKey]);
  React.useEffect(() => {
    if (tab !== "chain") return;
    const node = targetRef.current;
    if (node && !node.value) node.focus();
  }, [tab]);
  const showHint = (tone, text) => setHint({ tone, text, id: Date.now() });
  const VIEW_FIELDS = [
    "roles",
    "counts",
    "activity",
    "tasks",
    "tasksAvailable",
    "chains",
    "denied",
    "indexBroken",
    "indexReason"
  ];
  const mergeView = (result) => {
    if (!result || typeof result !== "object") return;
    setState((prev) => {
      if (!prev.data) return prev;
      const next = { ...prev.data };
      for (const field of VIEW_FIELDS) {
        if (result[field] !== void 0) next[field] = result[field];
      }
      return { ...prev, data: next };
    });
    setUpdatedAt(Date.now());
  };
  const run = async (key, task) => {
    if (busy) return null;
    setBusy(key);
    try {
      const result = await task();
      if (result) mergeView(result);
      return result;
    } catch (error) {
      notify("bad", String(error?.message || error));
      return null;
    } finally {
      setBusy("");
    }
  };
  const installOne = (role) => {
    const confirming = confirmKey === `conflict-${role.id}`;
    return run(role.id, async () => {
      const result = await rpc.installRoster({ agentId: role.id, confirm: confirming });
      const item = result?.results?.[0] || {};
      const name = t(`roster.role.${role.id}.name`);
      if (item.action === "conflict") {
        setConfirmKey(`conflict-${role.id}`);
        showHint("warn", t("roster.conflict.hint", { name }));
        return result;
      }
      setConfirmKey("");
      if (item.indexError) {
        notify("warn", t("roster.toast.indexFailed", { name, message: item.indexError }));
      } else if (item.unverified) {
        notify("warn", t("roster.toast.unverified", { name }));
      } else if (item.overwritten) {
        notify("warn", t("roster.toast.overwritten", { name, file: item.backup || "-" }));
      } else if (item.backedUp && !item.overwritten) {
        notify("ok", t("roster.toast.backupSaved", { name, file: item.backup || "-" }));
      } else if (item.projectConflict) {
        notify("ok", t("roster.toast.projectConflict", { name }));
      } else {
        notify("ok", item.action === "updated" ? t("roster.toast.updated") : t("roster.toast.installed"));
      }
      return result;
    });
  };
  const installAll = () => {
    const confirming = confirmKey === "conflict-all";
    return run("all", async () => {
      const result = await rpc.installRoster({ all: true, confirm: confirming });
      const results = result?.results || [];
      const conflicts = results.filter((item) => item.action === "conflict");
      const failed = results.filter((item) => item.action === "failed");
      const overwritten = results.filter((item) => item.overwritten).length;
      const unverified = results.filter((item) => item.unverified).length;
      const indexFailed = results.filter((item) => item.indexError);
      const reason = failed[0]?.message ? ` ${String(failed[0].message).slice(0, 200)}` : "";
      if (conflicts.length) {
        const names = conflicts.map((item) => t(`roster.role.${item.id}.name`)).join("、");
        setConfirmKey("conflict-all");
        showHint("warn", t("roster.conflict.allHint", { count: conflicts.length, names }));
        if (failed.length) {
          notify("warn", `${t("roster.toast.partial", { count: failed.length })}${reason}`);
        }
        return result;
      }
      setConfirmKey("");
      if (failed.length) {
        notify("warn", `${t("roster.toast.partial", { count: failed.length })}${reason}`);
      } else if (indexFailed.length > 0) {
        notify(
          "warn",
          t("roster.toast.indexFailedAll", {
            count: indexFailed.length,
            message: indexFailed[0].indexError
          })
        );
      } else if (overwritten > 0) {
        notify("warn", t("roster.toast.overwrittenAll", { count: overwritten }));
      } else if (unverified > 0) {
        notify("warn", t("roster.toast.unverifiedAll", { count: unverified }));
      } else {
        notify("ok", t("roster.toast.allDone"));
      }
      return result;
    });
  };
  const guard = (key, message, action) => {
    if (confirmKey !== key) {
      setConfirmKey(key);
      showHint("warn", message);
      return;
    }
    setConfirmKey("");
    void action();
  };
  const removeOne = (role) => {
    const key = `role-${role.id}`;
    const name = t(`roster.role.${role.id}.name`);
    if (confirmKey !== key) {
      setConfirmKey(key);
      void rpc.removeRoster(role.id, false).then((result) => {
        if (result?.foreign) showHint("warn", t("roster.confirm.foreignHint", { name }));
        else if (result?.drift) showHint("warn", t("roster.confirm.driftHint", { name }));
        else if (result?.indexBroken) showHint("warn", t("roster.confirm.indexBrokenHint", { name }));
        else showHint("warn", t("roster.confirm.hint", { name }));
      }).catch(() => showHint("warn", t("roster.confirm.hint", { name })));
      return;
    }
    setConfirmKey("");
    void run(`remove-${role.id}`, async () => {
      const result = await rpc.removeRoster(role.id, true);
      if (result?.needsConfirm) {
        notify("warn", t("roster.confirm.foreignHint", { name }));
      } else if (result?.foreignRemoved) {
        notify("warn", t("roster.toast.removedForeignName", { name }));
      } else if (!result?.removed) {
        if (result?.existed) notify("bad", t("roster.toast.removeBlockedName", { name }));
        else notify("ok", t("roster.toast.notInstalledName", { name }));
      } else if (result.projectRemaining > 0) {
        notify("warn", t("roster.toast.removedGlobalOnly", { name, count: result.projectRemaining }));
      } else if (Array.isArray(result.backups) && result.backups.length > 0) {
        notify("warn", t("roster.toast.removedWithBackup", { name, file: result.backups[0] }));
      } else {
        notify("ok", t("roster.toast.removedName", { name }));
      }
      if (prompt?.id === role.id) setPrompt(null);
      return result;
    });
  };
  const viewPrompt = async (role) => {
    if (prompt?.id === role.id) {
      setPrompt(null);
      return;
    }
    try {
      const data = await rpc.rosterRole(role.id);
      setPrompt({ id: role.id, systemPrompt: data?.systemPrompt || "" });
    } catch (error) {
      notify("bad", String(error?.message || error));
    }
  };
  const updateStep = (roleId, patch) => {
    setConfirmKey("");
    setChainSteps((current2) => current2.map((item) => item.roleId === roleId ? { ...item, ...patch } : item));
  };
  const toggleStep = (roleId) => {
    setConfirmKey("");
    setChainSteps(
      (current2) => current2.map((item) => item.roleId === roleId ? { ...item, enabled: !item.enabled } : item)
    );
  };
  const toggleStepTask = (roleId, text) => {
    setConfirmKey("");
    setChainSteps(
      (current2) => current2.map((item) => {
        if (item.roleId !== roleId) return item;
        const tasks2 = item.tasks.includes(text) ? item.tasks.filter((value) => value !== text) : [...item.tasks, text];
        return { ...item, tasks: tasks2 };
      })
    );
  };
  const addStepTask = (roleId) => {
    const text = stepDraft.trim().slice(0, STEP_TEXT_MAX);
    if (!text) return;
    const step = chainSteps.find((item) => item.roleId === roleId);
    if (step?.tasks.includes(text)) {
      showHint("warn", t("roster.dispatch.duplicate"));
      return;
    }
    if ((step?.tasks.length || 0) >= MAX_STEP_TASKS) {
      showHint("warn", t("roster.chain.stepLimit", { max: MAX_STEP_TASKS }));
      return;
    }
    updateStep(roleId, { tasks: [...step?.tasks || [], text] });
    setStepDraft("");
  };
  const removeStepTask = (roleId, offset) => {
    const step = chainSteps.find((item) => item.roleId === roleId);
    if (!step) return;
    updateStep(roleId, { tasks: step.tasks.filter((_, index) => index !== offset) });
  };
  const startSingleStep = (role) => {
    setConfirmKey("");
    setSelectedId(role.id);
    setChainSteps((current2) => current2.map((item) => ({ ...item, enabled: item.roleId === role.id })));
    setOpenStep(role.id);
    setStepDraft("");
    setTab("chain");
  };
  const startChain = () => run("chain-start", async () => {
    const result = await rpc.startRosterChain({
      target: chainForm.target,
      note: chainForm.note,
      steps: chainSteps.filter((item) => item.enabled).map((item) => ({ roleId: item.roleId, tasks: item.tasks }))
    });
    const chain = result?.chain || null;
    const ok = chain?.status === "running";
    const archived = Number(chain?.archived) || 0;
    const truncated = Number(chain?.truncated) || 0;
    const trimmed = archived + truncated > 0 ? ` ${t("roster.chain.trimmed", { archived, truncated })}` : "";
    const text = ok ? `${t("roster.chain.started")}${trimmed}` : chain?.lastError || t("roster.chain.failed");
    notify(ok && !trimmed ? "ok" : "warn", text);
    if (ok) setChainForm((current2) => ({ ...current2, target: "" }));
    return result;
  });
  const chainAction = (chain, key, call, doneKey, resolve) => run(`${key}-${chain.id}`, async () => {
    const result = await call(chain.id);
    await load({ silent: true });
    const next = typeof resolve === "function" ? resolve(result) : null;
    notify(next?.tone || "ok", next?.text || t(doneKey));
    return null;
  });
  const skipChain = (chain) => guard(
    `skip-${chain.id}`,
    t("roster.confirm.skipHint"),
    () => chainAction(
      chain,
      "skip",
      rpc.skipRosterChain,
      "roster.chain.skipped",
      (result) => result?.aborted ? { tone: "ok", text: t("roster.chain.skippedAborted") } : {
        tone: "warn",
        text: t("roster.chain.skippedIdle", {
          reason: result?.abortReason || t("roster.chain.abortUnknown")
        })
      }
    )
  );
  const resumeChain = (chain) => chainAction(chain, "resume", rpc.resumeRosterChain, "roster.chain.resumed", (result) => {
    if (result?.redispatched) {
      return result.aborted ? { tone: "ok", text: t("roster.chain.resumedRedispatched") } : {
        tone: "warn",
        text: t("roster.chain.resumedRedispatchedIdle", {
          reason: result.abortReason || t("roster.chain.abortUnknown")
        })
      };
    }
    if (result?.redispatchBlocked === "streaming") {
      return { tone: "warn", text: t("roster.chain.resumedStillRunning") };
    }
    if (result?.redispatchBlocked === "unavailable") {
      return { tone: "warn", text: t("roster.chain.resumedUnknown") };
    }
    if (result?.redispatchBlocked === "completed") {
      return { tone: "ok", text: t("roster.chain.resumedCompleted") };
    }
    if (result?.redispatchBlocked === "dispatch-failed") {
      return {
        tone: "warn",
        text: t("roster.chain.redispatchFailed", {
          reason: result?.chain?.lastError || result?.abortReason || t("roster.chain.abortUnknown")
        })
      };
    }
    return null;
  });
  const startChainConfirmed = () => guard(
    CHAIN_CONFIRM_KEY,
    highImpactNames.length ? `${t("roster.chain.confirm", {
      target: chainTargetBrief,
      sessions: chainSessions,
      tasks: chainDispatches
    })} ${t("roster.chain.confirmImpact", { names: highImpactNames.join("、") })}` : t("roster.chain.confirm", {
      target: chainTargetBrief,
      sessions: chainSessions,
      tasks: chainDispatches
    }),
    startChain
  );
  const activateTask = (task) => run(`open-${task.id}`, async () => {
    await rpc.activateRosterTask(task.id);
    notify("ok", t("roster.task.opened"));
    return null;
  });
  const removeTask = (task) => guard(
    `task-${task.id}`,
    t("roster.confirm.taskHint"),
    () => run(`drop-${task.id}`, async () => {
      const result = await rpc.removeRosterTask(task.id);
      if (Array.isArray(result?.tasks)) {
        setState((prev) => prev.data ? { ...prev, data: { ...prev.data, tasks: result.tasks } } : prev);
      }
      if (result?.removed === false) notify("warn", t("roster.task.notFound"));
      else notify("ok", t("roster.task.removed"));
      return null;
    })
  );
  const removeChain = (chain) => guard(
    `chain-${chain.id}`,
    t("roster.confirm.chainHint"),
    () => chainAction(chain, "drop", rpc.removeRosterChain, "roster.chain.removed", (result) => {
      if (!result?.wasLive) return null;
      return result.aborted ? { tone: "ok", text: t("roster.chain.removedAborted") } : {
        tone: "warn",
        text: t("roster.chain.removedIdle", {
          reason: result?.abortReason || t("roster.chain.abortUnknown")
        })
      };
    })
  );
  const roles = React.useMemo(() => Array.isArray(state.data?.roles) ? state.data.roles : [], [state.data]);
  const tasks = React.useMemo(() => Array.isArray(state.data?.tasks) ? state.data.tasks : [], [state.data]);
  const chains = React.useMemo(() => Array.isArray(state.data?.chains) ? state.data.chains : [], [state.data]);
  const counts = state.data?.counts || {};
  const activityInfo = state.data?.activity || null;
  const activityReady = activityInfo?.available === true;
  const indexBroken = state.data?.indexBroken === true;
  const indexReason = state.data?.indexReason || "";
  const statusOfRole = (role) => statusOf(role, activityReady);
  const installedCount = typeof counts.installed === "number" ? counts.installed : roles.filter((role) => role.installed).length;
  const totalCount = Number(counts.total) || roles.length;
  const current = roles.find((role) => role.id === selectedId) || roles[0] || null;
  const keyword = search.trim().toLowerCase();
  const memberCounts = React.useMemo(
    () => ({
      all: roles.length,
      // 宿主没有提供子代理会话数据时，运行中/已结束的数量无法判定：显示占位而不是 0。
      running: activityReady ? roles.filter((role) => statusOfRole(role) === "running").length : "-",
      done: activityReady ? roles.filter((role) => ["completed", "failed", "cancelled"].includes(statusOfRole(role))).length : "-",
      pending: roles.filter((role) => !role.installed).length
    }),
    [roles, activityReady]
  );
  const visibleRoles = React.useMemo(
    () => roles.filter((role) => {
      if (keyword) {
        const haystack = `${t(`roster.role.${role.id}.name`)} ${t(`roster.role.${role.id}.desc`)} ${role.name || ""} ${role.id}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      if (memberFilter === "running") return activityReady && statusOfRole(role) === "running";
      if (memberFilter === "done")
        return activityReady && ["completed", "failed", "cancelled"].includes(statusOfRole(role));
      if (memberFilter === "pending") return !role.installed;
      return true;
    }),
    [roles, keyword, memberFilter, t, activityReady]
  );
  const taskCounts = React.useMemo(
    () => ({
      all: tasks.length,
      running: tasks.filter((task) => task.status === "running" || task.status === "queued").length,
      done: tasks.filter((task) => SESSION_DONE_STATUSES.includes(task.status)).length
    }),
    [tasks]
  );
  const visibleTasks = React.useMemo(
    () => tasks.filter((task) => {
      if (taskFilter === "running") return task.status === "running" || task.status === "queued";
      if (taskFilter === "done") return SESSION_DONE_STATUSES.includes(task.status);
      return true;
    }),
    [tasks, taskFilter]
  );
  const pendingRoles = roles.filter((role) => !role.installed);
  const chainExpanded = chainOpen === null ? chains.length > 0 : chainOpen;
  const activeChains = chains.filter((chain) => ["running", "paused", "blocked"].includes(chain.status)).length;
  const chainSlotsFull = activeChains >= CHAIN_RUNNING_MAX;
  const enabledSteps = chainSteps.filter((step) => step.enabled);
  const chainSessions = enabledSteps.length;
  const chainDispatches = enabledSteps.reduce(
    (total, step) => total + Math.max(1, Math.min(step.tasks.length, MAX_STEP_TASKS)),
    0
  );
  const highImpactNames = enabledSteps.filter((step) => HIGH_IMPACT_ROLES.includes(step.roleId)).map((step) => t(`roster.role.${step.roleId}.name`));
  const chainTarget = chainForm.target.trim();
  const chainTargetBrief = chainTarget.length > 60 ? `${chainTarget.slice(0, 59)}…` : chainTarget;
  const chainConfirming = confirmKey === CHAIN_CONFIRM_KEY;
  const installedRoleIds = new Set(roles.filter((role) => role.installed).map((role) => role.id));
  const missingRoles = roles.length === 0 ? [] : enabledSteps.filter((step) => !installedRoleIds.has(step.roleId)).map((step) => step.roleId);
  const overLimitStep = enabledSteps.find((step) => step.tasks.length > MAX_STEP_TASKS) || null;
  const chainBlock = !chainForm.target.trim() ? t("roster.chain.blocked.target") : enabledSteps.length === 0 ? t("roster.chain.blocked.steps") : missingRoles.length > 0 ? t("roster.chain.blocked.roles", {
    names: missingRoles.map((id) => t(`roster.role.${id}.name`)).join("、")
  }) : overLimitStep ? t("roster.chain.blocked.stepLimit", {
    name: t(`roster.role.${overLimitStep.roleId}.name`),
    count: overLimitStep.tasks.length,
    max: MAX_STEP_TASKS
  }) : chainSlotsFull ? t("roster.chain.blocked.active", { max: CHAIN_RUNNING_MAX }) : "";
  const updatedLabel = fmtAgo(now, updatedAt, t);
  const summaryText = state.status === "loading" ? t("common.loading") : t("roster.summary", {
    installed: installedCount,
    total: totalCount,
    running: activityReady ? Number(counts.running) || memberCounts.running : "-",
    tasks: taskCounts.running
  });
  const resetMemberFilter = () => {
    setSearchInput("");
    setMemberFilter("all");
  };
  const canClose = busy === "";
  return /* @__PURE__ */ h(
    "div",
    {
      className: "pg-modal-backdrop",
      onClick: (event) => {
        if (event.target === event.currentTarget && canClose) onClose();
      }
    },
    /* @__PURE__ */ h(
      "div",
      {
        className: "pg-modal pg-modal-wide",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "pg-roster-title",
        ref: dialogRef,
        tabIndex: -1
      },
      /* @__PURE__ */ h("div", { className: "pg-modal-head" }, /* @__PURE__ */ h("div", { className: "pg-modal-title" }, /* @__PURE__ */ h("span", { id: "pg-roster-title" }, t("roster.title")), /* @__PURE__ */ h("span", { className: "pg-modal-sum", "aria-live": "polite" }, summaryText)), /* @__PURE__ */ h("div", { className: "pg-modal-actions" }, /* @__PURE__ */ h("span", { className: "pg-updated" }, updatedLabel), /* @__PURE__ */ h(
        "button",
        {
          type: "button",
          className: "pg-icon-btn",
          "data-spinning": refreshing ? "1" : "0",
          title: t("roster.refresh"),
          "aria-label": t("roster.refresh"),
          disabled: refreshing || busy !== "",
          onClick: () => void load({ silent: true })
        },
        /* @__PURE__ */ h(IconRefresh, null)
      ), pendingRoles.length > 0 ? /* @__PURE__ */ h(
        Btn,
        {
          size: "sm",
          variant: confirmKey === "conflict-all" ? "danger" : "primary",
          disabled: busy !== "",
          title: t("roster.installAllHint"),
          onClick: () => void installAll()
        },
        busy === "all" ? /* @__PURE__ */ h(Fragment, null, /* @__PURE__ */ h(Spinner, null), /* @__PURE__ */ h("span", null, t("roster.installingAll"))) : confirmKey === "conflict-all" ? t("roster.installAllConfirm") : t("roster.installAllCount", { count: pendingRoles.length })
      ) : null, /* @__PURE__ */ h("button", { type: "button", className: "pg-modal-x", title: t("roster.close"), "aria-label": t("roster.close"), onClick: onClose }, /* @__PURE__ */ h(IconClose, null)))),
      /* @__PURE__ */ h("div", { className: "pg-modal-tabs" }, /* @__PURE__ */ h("div", { className: "pg-modal-tablist", role: "tablist", "aria-label": t("roster.title") }, [
        ["roster", "roster.tab.roster", memberCounts.all],
        ["chain", "roster.tab.chain", enabledSteps.length],
        ["tasks", "roster.tab.tasks", taskCounts.running]
      ].map(([id, label, num]) => /* @__PURE__ */ h(
        "button",
        {
          key: id,
          type: "button",
          className: "pg-modal-tab",
          role: "tab",
          id: `pg-roster-tab-${id}`,
          "aria-selected": tab === id,
          "aria-controls": `pg-roster-panel-${id}`,
          "data-active": tab === id ? "1" : "0",
          onClick: () => setTab(id)
        },
        /* @__PURE__ */ h("span", null, t(label)),
        num > 0 ? /* @__PURE__ */ h("span", { className: "pg-modal-tab-num" }, num) : null
      ))), activeChains > 0 ? /* @__PURE__ */ h("span", { className: "pg-modal-tab-note" }, t("roster.tab.chains", { count: activeChains })) : null),
      hint ? /* @__PURE__ */ h("div", { className: "pg-flash", "data-tone": hint.tone, role: "status" }, hint.text) : null,
      state.status === "stale" ? /* @__PURE__ */ h("div", { className: "pg-modal-note pg-inline-warn" }, t("roster.stale", { message: state.error })) : null,
      indexBroken ? /* @__PURE__ */ h("div", { className: "pg-modal-note pg-inline-warn" }, t("roster.indexBroken.hint", { message: indexReason || "-" })) : null,
      state.status === "loading" ? /* @__PURE__ */ h("div", { className: "pg-modal-body", "data-layout": "split", "aria-busy": "true" }, /* @__PURE__ */ h("div", { className: "pg-skel-col" }, /* @__PURE__ */ h("div", { className: "pg-skel pg-skel-net" }), /* @__PURE__ */ h("div", { className: "pg-skel pg-skel-line" }), /* @__PURE__ */ h("div", { className: "pg-skel pg-skel-line pg-skel-line-short" })), /* @__PURE__ */ h("div", { className: "pg-skel-col" }, [0, 1, 2, 3].map((index) => /* @__PURE__ */ h("div", { className: "pg-skel pg-skel-card", key: index })))) : null,
      state.status === "error" ? /* @__PURE__ */ h("div", { className: "pg-modal-loading" }, /* @__PURE__ */ h(
        ErrorBox,
        {
          title: t("error.title"),
          message: state.error,
          action: /* @__PURE__ */ h(Btn, { size: "sm", variant: "primary", onClick: () => void load() }, t("action.retry"))
        }
      )) : null,
      state.status === "ready" || state.status === "stale" ? /* @__PURE__ */ h(Fragment, null, tab === "roster" ? /* @__PURE__ */ h("div", { className: "pg-modal-body", "data-layout": "split", role: "tabpanel", id: "pg-roster-panel-roster", "aria-labelledby": "pg-roster-tab-roster" }, /* @__PURE__ */ h("div", { className: "pg-roster-left" }, /* @__PURE__ */ h("div", { className: "pg-roster-head" }, /* @__PURE__ */ h("span", null, t("roster.net.title")), /* @__PURE__ */ h("span", { className: "pg-meta" }, activityInfo?.available ? t("roster.net.totals", {
        tokens: fmtTokens(activityInfo?.totals?.tokens || 0),
        requests: activityInfo?.totals?.requests || 0
      }) : t("roster.net.unavailable"))), /* @__PURE__ */ h("svg", { className: "pg-net", viewBox: `0 0 ${NET.width} ${NET.height}`, role: "group", "aria-label": t("roster.net.title") }, roles.map((role, index) => {
        const pos = nodePosition(index);
        const active = current?.id === role.id;
        const activity = activityOf(role);
        const status = statusOfRole(role);
        const metric = activity ? `${fmtTokens(activity.totalTokens)} · ${fmtDuration(
          activity.status === "running" && activity.live ? activity.live.elapsedMs : activity.totalDurationMs
        )}` : t(activityReady ? "roster.activity.none" : "roster.activity.unavailable");
        return /* @__PURE__ */ h(
          "g",
          {
            key: role.id,
            className: `pg-net-node${role.installed ? " is-installed" : ""}${active ? " is-active" : ""}${status === "running" ? " is-running" : ""}`,
            role: "button",
            tabIndex: 0,
            "aria-pressed": active,
            "aria-label": `${t(`roster.role.${role.id}.name`)} · ${t(STATUS_LABEL[status] || "roster.status.idle")} · ${metric}`,
            onClick: () => setSelectedId(role.id),
            onKeyDown: (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              setSelectedId(role.id);
            }
          },
          /* @__PURE__ */ h("line", { className: "pg-net-link", x1: NET.cx, y1: NET.cy, x2: pos.x, y2: pos.y }),
          status === "running" ? /* @__PURE__ */ h("circle", { className: "pg-net-ring", cx: pos.x, cy: pos.y, r: NODE_RADIUS + 8 }) : null,
          /* @__PURE__ */ h("circle", { className: "pg-net-dot", cx: pos.x, cy: pos.y, r: NODE_RADIUS }),
          /* @__PURE__ */ h("text", { className: "pg-net-label", x: pos.x, y: pos.y - 2, textAnchor: "middle" }, t(`roster.role.${role.id}.name`)),
          /* @__PURE__ */ h("text", { className: "pg-net-sub", x: pos.x, y: pos.y + 15, textAnchor: "middle" }, t(STATUS_LABEL[status] || "roster.status.idle")),
          /* @__PURE__ */ h("text", { className: "pg-net-meta", x: pos.x, y: pos.y + 58, textAnchor: "middle" }, metric)
        );
      }), /* @__PURE__ */ h("g", { className: "pg-net-core" }, /* @__PURE__ */ h("circle", { className: "pg-net-dot", cx: NET.cx, cy: NET.cy, r: NODE_RADIUS + 8 }), /* @__PURE__ */ h("text", { className: "pg-net-label", x: NET.cx, y: NET.cy - 4, textAnchor: "middle" }, t("roster.core")), /* @__PURE__ */ h("text", { className: "pg-net-sub", x: NET.cx, y: NET.cy + 14, textAnchor: "middle" }, t("roster.coreSub")))), /* @__PURE__ */ h("div", { className: "pg-net-list" }, roles.map((role) => {
        const status = statusOfRole(role);
        const activity = activityOf(role);
        return /* @__PURE__ */ h(
          "button",
          {
            key: role.id,
            type: "button",
            className: "pg-net-row",
            "data-active": current?.id === role.id ? "1" : "0",
            onClick: () => setSelectedId(role.id)
          },
          /* @__PURE__ */ h("span", { className: "pg-net-row-main" }, /* @__PURE__ */ h("span", { className: "pg-roster-name" }, t(`roster.role.${role.id}.name`)), /* @__PURE__ */ h("span", { className: "pg-meta" }, t(STATUS_LABEL[status] || "roster.status.idle"))),
          /* @__PURE__ */ h("span", { className: "pg-meta pg-mono" }, activity ? `${fmtTokens(activity.totalTokens)} · ${fmtDuration(activity.totalDurationMs)}` : t(activityReady ? "roster.activity.none" : "roster.activity.unavailable"))
        );
      })), /* @__PURE__ */ h("div", { className: "pg-net-caption" }, /* @__PURE__ */ h("span", null, t("roster.net.caption")), /* @__PURE__ */ h(
        "button",
        {
          type: "button",
          className: "pg-link",
          "aria-expanded": helpOpen,
          onClick: () => setHelpOpen((value) => !value)
        },
        helpOpen ? t("roster.helpHide") : t("roster.help")
      )), helpOpen ? /* @__PURE__ */ h("div", { className: "pg-help" }, /* @__PURE__ */ h("p", null, t("roster.netHint")), /* @__PURE__ */ h("p", null, t("roster.boundary"))) : null, current ? /* @__PURE__ */ h("section", { className: "pg-role-detail", "aria-label": t(`roster.role.${current.id}.name`) }, /* @__PURE__ */ h("div", { className: "pg-role-detail-head" }, /* @__PURE__ */ h("span", { className: "pg-role-detail-name" }, t(`roster.role.${current.id}.name`)), /* @__PURE__ */ h(Badge, { tone: STATUS_TONE[statusOfRole(current)] || "muted" }, t(STATUS_LABEL[statusOfRole(current)] || "roster.status.idle")), /* @__PURE__ */ h(Badge, { tone: stateTone(current) }, stateLabel(current, t)), /* @__PURE__ */ h("span", { className: "pg-meta pg-mono" }, current.id)), /* @__PURE__ */ h("p", { className: "pg-role-detail-desc" }, t(`roster.role.${current.id}.desc`)), /* @__PURE__ */ h("div", { className: "pg-role-metrics" }, /* @__PURE__ */ h("span", { title: activityOf(current)?.model || "-" }, `${t("roster.meta.model")} ${activityOf(current) ? shortModel(activityOf(current).model) : t("roster.value.unavailable")}`), /* @__PURE__ */ h("span", null, `${t("roster.meta.tokens")} ${activityOf(current) ? fmtTokens(activityOf(current).totalTokens) : t("roster.value.unavailable")}`), /* @__PURE__ */ h("span", null, `${t("roster.meta.time")} ${activityOf(current) ? fmtDuration(activityOf(current).totalDurationMs) : t("roster.value.unavailable")}`), /* @__PURE__ */ h("span", null, `${t("roster.meta.requests")} ${activityOf(current) ? activityOf(current).requests || 0 : t("roster.value.unavailable")}`)), /* @__PURE__ */ h("div", { className: "pg-role-block" }, /* @__PURE__ */ h("div", { className: "pg-role-block-head" }, t("roster.detail.templates")), /* @__PURE__ */ h("ol", { className: "pg-roster-tasks" }, [1, 2, 3].map((index) => /* @__PURE__ */ h("li", { className: "pg-roster-task", key: index }, /* @__PURE__ */ h("span", { className: "pg-roster-task-no" }, String(index).padStart(2, "0")), /* @__PURE__ */ h("span", null, t(`roster.role.${current.id}.t${index}`)))))), /* @__PURE__ */ h("div", { className: "pg-roster-actions" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => void viewPrompt(current) }, prompt?.id === current.id ? t("roster.promptHide") : t("roster.prompt")), /* @__PURE__ */ h(
        "button",
        {
          type: "button",
          className: "pg-link",
          "aria-expanded": toolsOpen,
          onClick: () => setToolsOpen((value) => !value)
        },
        t("roster.detail.tools", { count: (current.tools || []).length })
      ), activityOf(current)?.conversationId ? /* @__PURE__ */ h("span", { className: "pg-meta" }, t("roster.detail.lastConversation")) : null), toolsOpen ? /* @__PURE__ */ h("div", { className: "pg-chips" }, (current.tools || []).map((tool) => /* @__PURE__ */ h("span", { className: "pg-chip pg-mono", key: tool }, tool))) : null, prompt?.id === current.id ? /* @__PURE__ */ h("pre", { className: "pg-pre pg-pre-sm" }, prompt.systemPrompt) : null) : null), /* @__PURE__ */ h("div", { className: "pg-roster-right" }, /* @__PURE__ */ h("div", { className: "pg-roster-head" }, /* @__PURE__ */ h("span", null, t("roster.members")), /* @__PURE__ */ h("span", { className: "pg-meta" }, t("roster.membersHint"))), counts.indexOnly > 0 ? /* @__PURE__ */ h("div", { className: "pg-note pg-inline-warn" }, t("roster.verify.hint", { count: counts.indexOnly })) : null, /* @__PURE__ */ h("div", { className: "pg-roster-toolbar" }, /* @__PURE__ */ h("div", { className: "pg-search" }, /* @__PURE__ */ h(
        "input",
        {
          className: "pg-input",
          value: searchInput,
          placeholder: t("roster.search"),
          "aria-label": t("roster.search"),
          onChange: (event) => setSearchInput(event.target.value),
          onKeyDown: (event) => {
            if (event.key !== "Escape" || !searchInput) return;
            event.preventDefault();
            event.stopPropagation();
            setSearchInput("");
          }
        }
      ), searchInput ? /* @__PURE__ */ h(
        "button",
        {
          type: "button",
          className: "pg-icon-btn pg-search-clear",
          title: t("roster.search.clear"),
          "aria-label": t("roster.search.clear"),
          onClick: () => setSearchInput("")
        },
        /* @__PURE__ */ h(IconClose, null)
      ) : null), /* @__PURE__ */ h("div", { className: "pg-chips" }, MEMBER_FILTERS.map(([id, label]) => /* @__PURE__ */ h(
        "button",
        {
          key: id,
          type: "button",
          className: "pg-chip",
          "data-tone": memberFilter === id ? "ok" : void 0,
          "aria-pressed": memberFilter === id,
          onClick: () => setMemberFilter(id)
        },
        `${t(label)} ${memberCounts[id] ?? 0}`
      )))), /* @__PURE__ */ h("div", { className: "pg-roster-list" }, visibleRoles.length === 0 ? /* @__PURE__ */ h(
        EmptyState,
        {
          title: t("roster.empty.filtered.title"),
          hint: t("roster.empty.filtered.hint"),
          action: /* @__PURE__ */ h(Btn, { size: "sm", onClick: resetMemberFilter }, t("roster.empty.filtered.action"))
        }
      ) : null, visibleRoles.map((role, index) => {
        const activity = activityOf(role);
        const status = statusOfRole(role);
        const active = current?.id === role.id;
        const installing = busy === role.id;
        const confirming = confirmKey === `role-${role.id}`;
        return /* @__PURE__ */ h("article", { key: role.id, className: `pg-roster-card${active ? " is-active" : ""}` }, /* @__PURE__ */ h(
          "button",
          {
            type: "button",
            className: "pg-roster-card-head",
            "aria-pressed": active,
            onClick: () => setSelectedId(role.id)
          },
          /* @__PURE__ */ h("span", { className: "pg-roster-no" }, String(index + 1).padStart(2, "0")),
          /* @__PURE__ */ h("span", { className: "pg-roster-name" }, t(`roster.role.${role.id}.name`)),
          /* @__PURE__ */ h(Badge, { tone: STATUS_TONE[status] || "muted" }, t(STATUS_LABEL[status] || "roster.status.idle")),
          /* @__PURE__ */ h(Badge, { tone: stateTone(role) }, stateLabel(role, t))
        ), /* @__PURE__ */ h("div", { className: "pg-roster-desc", title: t(`roster.role.${role.id}.desc`) }, t(`roster.role.${role.id}.desc`)), /* @__PURE__ */ h("div", { className: "pg-roster-meta" }, /* @__PURE__ */ h("span", { title: activity?.model || "-" }, `${t("roster.meta.model")} ${activity ? shortModel(activity.model) : t("roster.value.unavailable")}`), /* @__PURE__ */ h("span", null, `${t("roster.meta.tokens")} ${activity ? fmtTokens(activity.totalTokens) : t("roster.value.unavailable")}`), /* @__PURE__ */ h("span", null, `${t("roster.meta.time")} ${activity ? fmtDuration(activity.totalDurationMs) : t("roster.value.unavailable")}`), /* @__PURE__ */ h("span", null, `${t("roster.meta.requests")} ${activity ? activity.requests || 0 : t("roster.value.unavailable")}`)), /* @__PURE__ */ h(
          "div",
          {
            className: "pg-roster-preview",
            "data-tone": activity?.error ? "bad" : void 0,
            title: activity?.error || activity?.preview || ""
          },
          activity?.error || activity?.preview || t(activityReady ? "roster.activity.none" : "roster.activity.unavailable")
        ), /* @__PURE__ */ h("div", { className: "pg-roster-actions" }, /* @__PURE__ */ h(
          Btn,
          {
            size: "sm",
            variant: role.installed ? "ghost" : "primary",
            disabled: busy !== "",
            onClick: () => void installOne(role)
          },
          installing ? /* @__PURE__ */ h(Fragment, null, /* @__PURE__ */ h(Spinner, null), /* @__PURE__ */ h("span", null, t("roster.installing"))) : !role.installed ? t("roster.install") : role.updateAvailable ? t("roster.update") : t("roster.reinstall")
        ), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: busy !== "", onClick: () => startSingleStep(role) }, t("roster.chain.singleStep")), /* @__PURE__ */ h(
          Btn,
          {
            size: "sm",
            variant: confirming ? "danger" : "ghost",
            disabled: busy !== "",
            onClick: () => removeOne(role)
          },
          confirming ? t("roster.confirm.remove") : t("action.remove")
        )));
      })))) : null, tab === "chain" ? /* @__PURE__ */ h("div", { className: "pg-modal-body", "data-layout": "single", role: "tabpanel", id: "pg-roster-panel-chain", "aria-labelledby": "pg-roster-tab-chain" }, /* @__PURE__ */ h("div", { className: "pg-chain-page" }, /* @__PURE__ */ h("div", { className: "pg-roster-head" }, /* @__PURE__ */ h("span", null, t("roster.chain.title")), /* @__PURE__ */ h("span", { className: "pg-meta" }, t("roster.chain.hint"))), /* @__PURE__ */ h("div", { className: "pg-task-form" }, /* @__PURE__ */ h("div", { className: "pg-form-row" }, /* @__PURE__ */ h("label", { className: "pg-form-label", htmlFor: "pg-chain-target" }, t("roster.chain.target")), /* @__PURE__ */ h(
        "input",
        {
          id: "pg-chain-target",
          ref: targetRef,
          className: "pg-input",
          value: chainForm.target,
          placeholder: t("roster.dispatch.targetHint"),
          "aria-describedby": "pg-chain-target-help",
          onChange: (event) => {
            setConfirmKey("");
            setChainForm((value) => ({ ...value, target: event.target.value }));
          }
        }
      )), /* @__PURE__ */ h("div", { className: "pg-field-help", id: "pg-chain-target-help" }, t("roster.dispatch.targetHelp")), /* @__PURE__ */ h("div", { className: "pg-form-block" }, /* @__PURE__ */ h("span", { className: "pg-form-label" }, t("roster.chain.steps")), /* @__PURE__ */ h("div", { className: "pg-steps" }, CHAIN_ROLES.map((roleId, index) => {
        const step = chainSteps.find((item) => item.roleId === roleId) || {
          roleId,
          enabled: false,
          tasks: []
        };
        const expanded = openStep === roleId;
        const tasksLabel = step.tasks.length ? step.tasks.length > MAX_STEP_TASKS ? t("roster.chain.stepOver", { count: step.tasks.length, max: MAX_STEP_TASKS }) : t("roster.chain.stepTasks", { count: step.tasks.length }) : t("roster.chain.stepDefault");
        return /* @__PURE__ */ h(
          "div",
          {
            className: "pg-step",
            key: roleId,
            "data-enabled": step.enabled ? "1" : "0",
            "data-open": expanded ? "1" : "0"
          },
          /* @__PURE__ */ h("div", { className: "pg-step-head" }, /* @__PURE__ */ h(
            "input",
            {
              type: "checkbox",
              className: "pg-step-check",
              checked: step.enabled,
              "aria-label": t("roster.chain.toggleStep", { name: t(`roster.role.${roleId}.name`) }),
              onChange: () => toggleStep(roleId)
            }
          ), /* @__PURE__ */ h("span", { className: "pg-step-no" }, String(index + 1).padStart(2, "0")), /* @__PURE__ */ h("span", { className: "pg-step-name" }, t(`roster.role.${roleId}.name`)), /* @__PURE__ */ h("span", { className: "pg-step-sub" }, tasksLabel), /* @__PURE__ */ h(
            "button",
            {
              type: "button",
              className: "pg-link",
              "aria-expanded": expanded,
              "aria-controls": `pg-step-${roleId}`,
              onClick: () => {
                setOpenStep(expanded ? "" : roleId);
                setStepDraft("");
              }
            },
            expanded ? t("roster.chain.collapse") : t("roster.chain.edit")
          )),
          expanded ? /* @__PURE__ */ h("div", { className: "pg-step-body", id: `pg-step-${roleId}` }, /* @__PURE__ */ h("div", { className: "pg-step-brief" }, t(`roster.chain.brief.${roleId}`)), /* @__PURE__ */ h("div", { className: "pg-chips" }, [1, 2, 3].map((number) => {
            const text = t(`roster.role.${roleId}.t${number}`);
            const selected = step.tasks.includes(text);
            return /* @__PURE__ */ h(
              "button",
              {
                type: "button",
                key: number,
                className: "pg-chip",
                "data-tone": selected ? "ok" : void 0,
                "aria-pressed": selected,
                onClick: () => toggleStepTask(roleId, text)
              },
              text
            );
          })), /* @__PURE__ */ h("div", { className: "pg-inline-field" }, /* @__PURE__ */ h(
            "input",
            {
              className: "pg-input",
              value: stepDraft,
              maxLength: STEP_TEXT_MAX,
              disabled: step.tasks.length >= MAX_STEP_TASKS,
              title: step.tasks.length >= MAX_STEP_TASKS ? t("roster.chain.stepLimit", { max: MAX_STEP_TASKS }) : void 0,
              placeholder: t("roster.chain.stepAddHint"),
              onChange: (event) => setStepDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addStepTask(roleId);
              }
            }
          ), /* @__PURE__ */ h(
            Btn,
            {
              size: "sm",
              variant: "ghost",
              disabled: !stepDraft.trim() || step.tasks.length >= MAX_STEP_TASKS,
              onClick: () => addStepTask(roleId)
            },
            t("roster.chain.stepAdd")
          )), step.tasks.length ? /* @__PURE__ */ h("div", { className: "pg-queue-list" }, step.tasks.map((text, offset) => /* @__PURE__ */ h("div", { className: "pg-queue-item", key: `${roleId}-${offset}` }, /* @__PURE__ */ h("span", { className: "pg-queue-no" }, String(offset + 1).padStart(2, "0")), /* @__PURE__ */ h("span", { className: "pg-queue-text" }, text), /* @__PURE__ */ h(
            "button",
            {
              type: "button",
              className: "pg-icon-btn",
              title: t("roster.chain.stepRemove"),
              "aria-label": t("roster.chain.stepRemove"),
              onClick: () => removeStepTask(roleId, offset)
            },
            /* @__PURE__ */ h(IconTrash, null)
          ))), /* @__PURE__ */ h("button", { type: "button", className: "pg-link", onClick: () => updateStep(roleId, { tasks: [] }) }, t("roster.chain.stepReset"))) : null) : null
        );
      }))), /* @__PURE__ */ h("div", { className: "pg-form-block" }, /* @__PURE__ */ h("label", { className: "pg-form-label", htmlFor: "pg-chain-note" }, t("roster.dispatch.note")), /* @__PURE__ */ h(
        "textarea",
        {
          id: "pg-chain-note",
          className: "pg-textarea",
          rows: 2,
          value: chainForm.note,
          placeholder: t("roster.chain.noteHint"),
          onChange: (event) => {
            setConfirmKey("");
            setChainForm((value) => ({ ...value, note: event.target.value }));
          }
        }
      )), /* @__PURE__ */ h("div", { className: "pg-chain-submit" }, /* @__PURE__ */ h("span", { className: "pg-submit-note", "aria-live": "polite" }, chainBlock || (chainConfirming ? t("roster.chain.confirm", {
        target: chainTargetBrief,
        sessions: chainSessions,
        tasks: chainDispatches
      }) : t("roster.chain.review", {
        target: chainTargetBrief,
        count: chainSessions,
        sessions: chainSessions,
        tasks: chainDispatches
      }))), /* @__PURE__ */ h(
        Btn,
        {
          size: "sm",
          variant: chainConfirming ? "danger" : "primary",
          disabled: busy !== "" || Boolean(chainBlock),
          onClick: startChainConfirmed
        },
        busy === "chain-start" ? /* @__PURE__ */ h(Fragment, null, /* @__PURE__ */ h(Spinner, null), /* @__PURE__ */ h("span", null, t("roster.chain.starting"))) : chainConfirming ? t("roster.chain.startConfirm", {
          sessions: chainSessions,
          tasks: chainDispatches
        }) : t("roster.chain.start")
      ))), /* @__PURE__ */ h("section", { className: "pg-chain-records", "data-open": chainExpanded ? "1" : "0" }, /* @__PURE__ */ h(
        "button",
        {
          type: "button",
          className: "pg-chain-toggle",
          "aria-expanded": chainExpanded,
          onClick: () => setChainOpen(!chainExpanded)
        },
        /* @__PURE__ */ h(IconChevron, { open: chainExpanded }),
        /* @__PURE__ */ h("span", { className: "pg-chain-title" }, t("roster.chain.records")),
        /* @__PURE__ */ h("span", { className: "pg-meta" }, chains.length ? t("roster.chain.summary", { count: chains.length, active: activeChains }) : t("roster.chain.empty"))
      ), chainExpanded ? chains.length === 0 ? /* @__PURE__ */ h("div", { className: "pg-chain-body" }, /* @__PURE__ */ h("div", { className: "pg-note" }, t("roster.chain.empty"))) : /* @__PURE__ */ h("div", { className: "pg-chain-body" }, /* @__PURE__ */ h("div", { className: "pg-chain-list" }, chains.map((chain) => {
        const step = chain.steps[chain.stepIndex] || null;
        const total = chain.steps.length;
        const done = chain.steps.filter((item) => ["completed", "skipped"].includes(item.status)).length;
        const confirming = confirmKey === `chain-${chain.id}`;
        const skipping = confirmKey === `skip-${chain.id}`;
        return /* @__PURE__ */ h("div", { className: "pg-chain-item", key: chain.id }, /* @__PURE__ */ h("div", { className: "pg-chain-head" }, /* @__PURE__ */ h(Badge, { tone: CHAIN_TONE[chain.status] || "muted" }, t(`roster.chain.status.${chain.status}`)), /* @__PURE__ */ h("span", { className: "pg-task-target", title: chain.target }, chain.target), /* @__PURE__ */ h("span", { className: "pg-meta" }, t("roster.chain.progress", { done, total })), /* @__PURE__ */ h("div", { className: "pg-chain-actions" }, chain.status === "running" ? /* @__PURE__ */ h(
          Btn,
          {
            size: "sm",
            variant: "ghost",
            disabled: busy !== "",
            onClick: () => void chainAction(chain, "pause", rpc.pauseRosterChain, "roster.chain.paused")
          },
          t("roster.chain.pause")
        ) : null, chain.status === "paused" || chain.status === "blocked" ? /* @__PURE__ */ h(
          Btn,
          {
            size: "sm",
            variant: "ghost",
            disabled: busy !== "",
            onClick: () => void resumeChain(chain)
          },
          step?.status === "failed" ? t("roster.chain.redispatch") : t("roster.chain.resume")
        ) : null, ["running", "paused", "blocked"].includes(chain.status) ? /* @__PURE__ */ h(
          Btn,
          {
            size: "sm",
            variant: skipping ? "danger" : "ghost",
            disabled: busy !== "",
            onClick: () => skipChain(chain)
          },
          skipping ? t("roster.confirm.skip") : t("roster.chain.skip")
        ) : null, ["running", "paused", "blocked"].includes(chain.status) ? /* @__PURE__ */ h(
          Btn,
          {
            size: "sm",
            variant: "ghost",
            disabled: busy !== "",
            onClick: () => void chainAction(
              chain,
              "stop",
              rpc.stopRosterChain,
              "roster.chain.stopped",
              (result) => result?.aborted ? { tone: "warn", text: t("roster.chain.stopAborted") } : {
                tone: "warn",
                text: t("roster.chain.stopIdle", {
                  reason: result?.abortReason || t("roster.chain.abortUnknown")
                })
              }
            )
          },
          t("roster.chain.stop")
        ) : null, /* @__PURE__ */ h(
          Btn,
          {
            size: "sm",
            variant: confirming ? "danger" : "ghost",
            disabled: busy !== "",
            onClick: () => removeChain(chain)
          },
          confirming ? t("roster.confirm.remove") : t("roster.chain.remove")
        ))), /* @__PURE__ */ h("div", { className: "pg-chain-steps" }, chain.steps.map((item, index) => {
          const stepTasks = Array.isArray(item.tasks) ? item.tasks : [];
          return /* @__PURE__ */ h(
            "span",
            {
              className: "pg-chain-step",
              key: `${chain.id}-${item.roleId}`,
              "data-state": item.liveStatus || item.status,
              "data-current": index === chain.stepIndex && ["running", "paused", "blocked"].includes(chain.status) ? "1" : void 0,
              title: stepTasks.length ? stepTasks.join("\n") : t(`roster.chain.brief.${item.roleId}`)
            },
            `${index + 1}. ${t(`roster.role.${item.roleId}.name`)}${stepTasks.length > 1 ? `（${stepTasks.length}）` : ""}`
          );
        })), chain.lastError ? /* @__PURE__ */ h("div", { className: "pg-roster-preview", "data-tone": "bad", title: chain.lastError }, chain.lastError) : step?.statusReason ? /* @__PURE__ */ h("div", { className: "pg-note", title: step.statusReason }, step.statusReason) : step?.preview ? /* @__PURE__ */ h("div", { className: "pg-task-preview", title: step.preview }, step.preview) : null);
      }))) : null))) : null, tab === "tasks" ? /* @__PURE__ */ h("div", { className: "pg-modal-body", "data-layout": "single", role: "tabpanel", id: "pg-roster-panel-tasks", "aria-labelledby": "pg-roster-tab-tasks" }, /* @__PURE__ */ h("div", { className: "pg-tasks" }, /* @__PURE__ */ h("div", { className: "pg-roster-head" }, /* @__PURE__ */ h("span", null, t("roster.tasks.title")), /* @__PURE__ */ h("span", { className: "pg-meta" }, t("roster.tasks.hint"))), /* @__PURE__ */ h("div", { className: "pg-chips" }, TASK_FILTERS.map(([id, label]) => /* @__PURE__ */ h(
        "button",
        {
          key: id,
          type: "button",
          className: "pg-chip",
          "data-tone": taskFilter === id ? "ok" : void 0,
          "aria-pressed": taskFilter === id,
          onClick: () => setTaskFilter(id)
        },
        `${t(label)} ${taskCounts[id] ?? 0}`
      ))), Number(state.data?.tasksArchived) > 0 ? /* @__PURE__ */ h("div", { className: "pg-note" }, t("roster.task.archived", { count: Number(state.data.tasksArchived) })) : null, visibleTasks.length === 0 ? /* @__PURE__ */ h(
        EmptyState,
        {
          title: t("roster.empty.tasks.title"),
          hint: t("roster.empty.tasks.hint"),
          action: taskFilter === "all" ? /* @__PURE__ */ h(Btn, { size: "sm", variant: "primary", onClick: () => setTab("chain") }, t("roster.empty.tasks.action")) : /* @__PURE__ */ h(Btn, { size: "sm", onClick: () => setTaskFilter("all") }, t("roster.empty.filtered.action"))
        }
      ) : null, /* @__PURE__ */ h("div", { className: "pg-task-list" }, visibleTasks.map((task) => {
        const confirming = confirmKey === `task-${task.id}`;
        return /* @__PURE__ */ h("div", { className: "pg-task-item", key: task.id }, /* @__PURE__ */ h(Badge, { tone: STATUS_TONE[task.status] || "muted" }, t(STATUS_LABEL[task.status] || "roster.status.idle")), /* @__PURE__ */ h("div", { className: "pg-task-main" }, /* @__PURE__ */ h("span", { className: "pg-task-title" }, t(`roster.role.${task.roleId}.name`), /* @__PURE__ */ h("span", { className: "pg-task-target", title: task.target }, task.target)), /* @__PURE__ */ h("span", { className: "pg-task-sub", title: Array.isArray(task.tasks) ? task.tasks.join("\n") : task.template }, Array.isArray(task.tasks) && task.tasks.length > 1 ? t("roster.task.batch", { count: task.tasks.length, first: task.tasks[0] }) : task.template), /* @__PURE__ */ h("span", { className: "pg-task-meta" }, `${fmtTime(task.createdAt)} · ${fmtTokens(task.tokens || 0)} · ${fmtDuration(
          task.status === "running" ? task.elapsedMs : task.durationMs
        )} · ${t("roster.meta.messages", { count: task.messageCount || 0 })}`), task.preview ? /* @__PURE__ */ h("span", { className: "pg-task-preview", title: task.preview }, task.preview) : null, task.statusReason ? /* @__PURE__ */ h("span", { className: "pg-task-preview", "data-tone": "bad", title: task.statusReason }, task.statusReason) : null), /* @__PURE__ */ h("div", { className: "pg-task-actions" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: busy !== "", onClick: () => void activateTask(task) }, t("roster.task.open")), /* @__PURE__ */ h(
          Btn,
          {
            size: "sm",
            variant: confirming ? "danger" : "ghost",
            disabled: busy !== "",
            onClick: () => removeTask(task)
          },
          confirming ? t("roster.confirm.task") : t("roster.task.remove")
        )));
      })))) : null) : null
    )
  );
}

// src/panel/proxy.jsx
var PROVIDERS = [
  { id: "chat", label: "Chat Completions" },
  { id: "responses", label: "Responses" },
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini", label: "Gemini" }
];
function ProxyView({ t, rpc, notify, config, reload }) {
  const React = getReact();
  const [state, setState] = React.useState({ status: "loading", error: "", data: null });
  const [draft, setDraft] = React.useState({
    enabled: false,
    directive: "",
    boost: true,
    providers: { chat: true, responses: true, anthropic: true, gemini: true }
  });
  const [force, setForce] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const load = React.useCallback(async () => {
    try {
      const data2 = await rpc.proxy();
      setState({ status: "ready", error: "", data: data2 });
      setDraft({
        enabled: data2?.config?.proxy?.enabled === true,
        directive: data2?.config?.proxy?.directive || "",
        boost: data2?.config?.proxy?.boost !== false,
        providers: { ...data2?.config?.proxy?.providers }
      });
    } catch (error) {
      setState({ status: "error", error: String(error?.message || error), data: null });
    }
  }, [rpc]);
  React.useEffect(() => {
    void load();
  }, [load]);
  const save = async () => {
    if (busy) return;
    setBusy("save");
    try {
      const result = await rpc.applyProxy({
        enabled: draft.enabled,
        directive: draft.directive,
        boost: draft.boost,
        providers: draft.providers,
        force
      });
      const summary = summarizeApplyOutcome(result?.steps, applyModeOf(result?.mode), t, {
        appliedError: result?.appliedError
      });
      notify(summary.tone, summary.text);
      setForce(false);
      await load();
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  const restore = async () => {
    if (busy) return;
    const analysis2 = state.data?.analysis || {};
    const residueOnly = Boolean(analysis2.hasManagedResidue) && !analysis2.hasBlock;
    if (!window.confirm(t(residueOnly ? "proxy.restoreResidueConfirm" : "proxy.restoreConfirm"))) return;
    setBusy("restore");
    try {
      const result = await rpc.restoreProxy(force);
      if (result?.degraded || result?.outcome === "degraded") {
        notify("warn", t("proxy.restoreDegraded", { id: result?.snapshotId || "-" }));
      } else if (result?.outcome === "empty") {
        notify("warn", t("proxy.restoreNoop"));
      } else if (result?.outcome === "recreated") {
        notify("ok", t("proxy.restoreRecreated"));
      } else if (result?.outcome === "cleaned") {
        notify("ok", t("proxy.restoreCleaned", { count: result?.removedResidues || 0 }));
      } else if (result?.restored) {
        notify("ok", t("proxy.restored"));
      } else if (result?.removed) {
        notify("ok", t("proxy.restoreRemoved"));
      } else {
        notify("warn", t("proxy.restoreStripped"));
      }
      await load();
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  if (state.status === "loading") return /* @__PURE__ */ h(Loading, { text: t("common.loading") });
  if (state.status === "error") {
    return /* @__PURE__ */ h(
      ErrorBox,
      {
        title: t("error.title"),
        message: state.error,
        action: /* @__PURE__ */ h(Btn, { size: "sm", onClick: () => void load() }, t("action.retry"))
      }
    );
  }
  const data = state.data || {};
  const analysis = data.analysis || {};
  const probe = data.probe || { entries: [] };
  return /* @__PURE__ */ h("div", { className: "pg-stack" }, /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(
    SectionTitle,
    {
      extra: analysis.hasBlock ? /* @__PURE__ */ h(Badge, { tone: "ok" }, t("proxy.blockPresent")) : /* @__PURE__ */ h(Badge, { tone: "off" }, t("proxy.blockAbsent"))
    },
    t("proxy.title")
  ), /* @__PURE__ */ h("div", { className: "pg-note" }, t("proxy.hint")), /* @__PURE__ */ h("div", { className: "pg-kv" }, /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("proxy.path")), /* @__PURE__ */ h("span", { className: "pg-kv-value pg-mono" }, data.path || "-"), /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("proxy.exists")), /* @__PURE__ */ h("span", { className: "pg-kv-value" }, data.exists ? t("common.yes") : t("common.no")), /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("proxy.blockHash")), /* @__PURE__ */ h("span", { className: "pg-kv-value pg-mono" }, analysis.blockHash || "-"), /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("proxy.foreignHook")), /* @__PURE__ */ h("span", { className: "pg-kv-value" }, analysis.hasForeignHook ? t("common.yes") : t("common.no")), /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("proxy.residue")), /* @__PURE__ */ h("span", { className: "pg-kv-value" }, analysis.hasManagedResidue ? `${analysis.residueCount || 0}` : analysis.orphanBegins || analysis.orphanEnds ? t("proxy.residueUnconfirmed") : t("common.no"))), /* @__PURE__ */ h(
    Toggle,
    {
      checked: draft.enabled,
      onChange: (next) => setDraft((prev) => ({ ...prev, enabled: next })),
      label: t("proxy.enable"),
      hint: t("proxy.enableHint")
    }
  ), /* @__PURE__ */ h("label", { className: "pg-label" }, t("proxy.directive")), /* @__PURE__ */ h(
    "textarea",
    {
      className: "pg-textarea",
      rows: 6,
      value: draft.directive,
      onChange: (event) => setDraft((prev) => ({ ...prev, directive: event.target.value }))
    }
  ), /* @__PURE__ */ h(
    Toggle,
    {
      checked: draft.boost,
      onChange: (next) => setDraft((prev) => ({ ...prev, boost: next })),
      label: t("proxy.boost"),
      hint: t("proxy.boostHint")
    }
  ), /* @__PURE__ */ h("label", { className: "pg-label" }, t("proxy.providers")), /* @__PURE__ */ h("div", { className: "pg-providers" }, PROVIDERS.map((provider) => /* @__PURE__ */ h("label", { className: "pg-inline-check", key: provider.id }, /* @__PURE__ */ h(
    "input",
    {
      type: "checkbox",
      checked: draft.providers[provider.id] !== false,
      onChange: (event) => setDraft((prev) => ({
        ...prev,
        providers: { ...prev.providers, [provider.id]: event.target.checked }
      }))
    }
  ), /* @__PURE__ */ h("span", null, provider.label)))), /* @__PURE__ */ h("div", { className: "pg-row" }, /* @__PURE__ */ h("label", { className: "pg-inline-check" }, /* @__PURE__ */ h("input", { type: "checkbox", checked: force, onChange: (event) => setForce(event.target.checked) }), /* @__PURE__ */ h("span", null, t("proxy.force")))), /* @__PURE__ */ h("div", { className: "pg-row pg-row-end" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: busy !== "", onClick: () => void restore() }, t("proxy.restore")), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: "primary",
      disabled: busy !== "" || draft.enabled && !draft.directive.trim(),
      onClick: () => void save()
    },
    t("proxy.save")
  ))), /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, { extra: /* @__PURE__ */ h(Badge, { tone: probe.entries?.length ? "ok" : "off" }, probe.entries?.length || 0) }, t("proxy.probeTitle")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("proxy.probeHint")), !probe.entries?.length ? /* @__PURE__ */ h("div", { className: "pg-meta" }, t("proxy.probeEmpty")) : /* @__PURE__ */ h("div", { className: "pg-table" }, /* @__PURE__ */ h("div", { className: "pg-table-head" }, /* @__PURE__ */ h("span", null, t("proxy.probeTime")), /* @__PURE__ */ h("span", null, t("proxy.probeProvider")), /* @__PURE__ */ h("span", null, t("proxy.probeMode"))), probe.entries.map((entry, index) => /* @__PURE__ */ h("div", { className: "pg-table-row", key: `${entry.at}-${index}` }, /* @__PURE__ */ h("span", null, new Date(Number(entry.at) || 0).toLocaleString()), /* @__PURE__ */ h("span", null, entry.provider || "-"), /* @__PURE__ */ h("span", { className: "pg-mono" }, entry.mode || "system")))), /* @__PURE__ */ h("div", { className: "pg-row pg-row-end" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => void load() }, t("action.refresh")))), /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, null, t("proxy.previewTitle")), /* @__PURE__ */ h("pre", { className: "pg-pre" }, data.preview || t("proxy.previewEmpty")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("proxy.boundary"))));
}

// src/panel/backup.jsx
var formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1048576).toFixed(1)} MB`;
};
var KIND_KEY = {
  proxy: "backup.kind.proxy",
  role: "backup.kind.role",
  prompt: "backup.kind.prompt",
  approval: "backup.kind.approval"
};
var CONFIRM_KEY = {
  proxy: "backup.restoreProxyConfirm",
  role: "backup.confirm.role",
  prompt: "backup.confirm.prompt",
  approval: "backup.confirm.approval"
};
var FORCE_CONFIRM_KEY = {
  role: "backup.confirm.roleForce",
  proxy: "backup.confirm.proxyForce"
};
var DELETE_CONFIRM_MS = 3500;
function BackupView({ t, rpc, notify, reload }) {
  const React = getReact();
  const [state, setState] = React.useState({ status: "loading", error: "", data: null });
  const [busy, setBusy] = React.useState("");
  const [confirmId, setConfirmId] = React.useState("");
  React.useEffect(() => {
    if (!confirmId) return void 0;
    const timer = window.setTimeout(() => setConfirmId(""), DELETE_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirmId]);
  const load = React.useCallback(async () => {
    try {
      const data2 = await rpc.backups();
      setState({ status: "ready", error: "", data: data2 });
      setConfirmId("");
      return data2;
    } catch (error) {
      setState({ status: "error", error: String(error?.message || error), data: null });
      return null;
    }
  }, [rpc]);
  React.useEffect(() => {
    void load();
  }, [load]);
  const restore = async (item) => {
    if (busy) return;
    if (!window.confirm(t(CONFIRM_KEY[item.kind] || "backup.confirm.other"))) return;
    setBusy(item.id);
    try {
      let result;
      try {
        result = await rpc.restoreBackup(item.id, false);
      } catch (error) {
        const forceKey = FORCE_CONFIRM_KEY[item.kind];
        if (forceKey && (error?.code === "ROLE_FOREIGN_EDIT" || error?.code === "PROXY_FOREIGN_EDIT")) {
          if (!window.confirm(t(forceKey))) return;
          result = await rpc.restoreBackup(item.id, true);
        } else {
          throw error;
        }
      }
      notify("ok", result?.appliedNote ? `${t("backup.restored")}${result.appliedNote}` : t("backup.restored"));
      await load();
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  const remove = async (item) => {
    if (busy) return;
    const kind = t(KIND_KEY[item.kind] || "backup.kind.other");
    if (confirmId !== item.id) {
      setConfirmId(item.id);
      notify("warn", t("backup.deleteConfirm", { kind, time: new Date(item.at).toLocaleString() }));
      return;
    }
    setConfirmId("");
    setBusy(item.id);
    try {
      const result = await rpc.removeBackup(item.id);
      if (result?.removed === false) {
        notify("bad", t("backup.deleteFailed"));
        return;
      }
      notify("ok", t("backup.deleted", { kind, count: Number(result?.usage?.count) || 0 }));
      await load();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  if (state.status === "loading") return /* @__PURE__ */ h(Loading, { text: t("common.loading") });
  if (state.status === "error") {
    return /* @__PURE__ */ h(
      ErrorBox,
      {
        title: t("error.title"),
        message: state.error,
        action: /* @__PURE__ */ h(Btn, { size: "sm", onClick: () => void load() }, t("action.retry"))
      }
    );
  }
  const data = state.data || { items: [], usage: {} };
  return /* @__PURE__ */ h("div", { className: "pg-stack" }, /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, { extra: /* @__PURE__ */ h(Badge, { tone: "off" }, `${data.usage?.count || 0} / ${formatBytes(data.usage?.bytes || 0)}`) }, t("backup.title")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("backup.hint")), /* @__PURE__ */ h("div", { className: "pg-kv" }, /* @__PURE__ */ h("span", { className: "pg-kv-key" }, t("backup.dir")), /* @__PURE__ */ h("span", { className: "pg-kv-value pg-mono" }, data.dir || "-")), !data.items?.length ? /* @__PURE__ */ h("div", { className: "pg-meta" }, t("backup.empty")) : /* @__PURE__ */ h("div", { className: "pg-table" }, /* @__PURE__ */ h("div", { className: "pg-table-head" }, /* @__PURE__ */ h("span", null, t("backup.time")), /* @__PURE__ */ h("span", null, t("backup.kind")), /* @__PURE__ */ h("span", null, t("backup.size")), /* @__PURE__ */ h("span", null, t("common.actions"))), data.items.map((item) => /* @__PURE__ */ h("div", { className: "pg-table-row", key: item.id }, /* @__PURE__ */ h("span", null, new Date(item.at).toLocaleString()), /* @__PURE__ */ h("span", null, t(KIND_KEY[item.kind] || "backup.kind.other")), /* @__PURE__ */ h("span", null, formatBytes(item.bytes)), /* @__PURE__ */ h("span", { className: "pg-row pg-row-tight" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: busy !== "", onClick: () => void restore(item) }, t("backup.restore")), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: confirmId === item.id ? "danger" : "ghost",
      disabled: busy !== "",
      onClick: () => void remove(item)
    },
    confirmId === item.id ? t("backup.deleteArmed") : t("action.delete")
  ))))), /* @__PURE__ */ h("div", { className: "pg-row pg-row-end" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => void load() }, t("action.refresh"))), /* @__PURE__ */ h("div", { className: "pg-note" }, t("backup.boundary"))));
}

// src/panel/audit.jsx
var LEVELS = ["", "DEBUG", "INFO", "WARN", "ERROR"];
var summarizeLog = (entry) => {
  if (!entry || typeof entry !== "object") return String(entry ?? "");
  const time = entry.timestamp || entry.time || entry.createdAt || entry.at || "";
  const level = entry.level || "";
  const module = entry.module || "";
  const message = entry.message || entry.text || entry.content || "";
  return [time, level, module, message].filter(Boolean).join("  ");
};
function AuditView({ t, rpc, notify }) {
  const React = getReact();
  const [audit, setAudit] = React.useState({ status: "loading", error: "", items: [] });
  const [logs, setLogs] = React.useState({ status: "loading", error: "", data: null });
  const [filter, setFilter] = React.useState({ level: "", module: "", limit: 50 });
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState("");
  const confirmTimer = React.useRef(null);
  const loadAudit = React.useCallback(async () => {
    try {
      const data = await rpc.audit(100);
      setAudit({ status: "ready", error: "", items: data?.items || [] });
    } catch (error) {
      setAudit({ status: "error", error: String(error?.message || error), items: [] });
    }
  }, [rpc]);
  const loadLogs = React.useCallback(async () => {
    setLogs((prev) => ({ ...prev, status: "loading" }));
    try {
      const data = await rpc.logs({
        level: filter.level || void 0,
        module: filter.module || void 0,
        limit: filter.limit
      });
      setLogs({ status: "ready", error: "", data });
    } catch (error) {
      setLogs({ status: "error", error: String(error?.message || error), data: null });
    }
  }, [rpc, filter]);
  React.useEffect(() => {
    void loadAudit();
    void loadLogs();
  }, [rpc]);
  const refreshAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all([loadAudit(), loadLogs()]);
    } finally {
      setBusy(false);
    }
  };
  const arm = (key) => {
    setConfirm(key);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirm(""), 4e3);
  };
  React.useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    []
  );
  const clearAudit = async () => {
    if (busy) return;
    if (confirm !== "audit") {
      arm("audit");
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirm("");
    setBusy(true);
    try {
      await rpc.clearAudit();
      await loadAudit();
      notify("ok", t("audit.cleared"));
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };
  const clearLogs = async () => {
    if (busy) return;
    if (confirm !== "logs") {
      arm("logs");
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirm("");
    setBusy(true);
    try {
      const result = await rpc.clearLogs();
      await loadLogs();
      notify("ok", t("audit.logsCleared", { count: result?.removed || 0 }));
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };
  const logPayload = logs.data?.logs;
  const logEntries = Array.isArray(logPayload) ? logPayload : Array.isArray(logPayload?.items) ? logPayload.items : Array.isArray(logPayload?.records) ? logPayload.records : [];
  return /* @__PURE__ */ h("div", { className: "pg-stack" }, /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(
    SectionTitle,
    {
      extra: /* @__PURE__ */ h("span", { className: "pg-row pg-row-tight" }, /* @__PURE__ */ h(Badge, { tone: "off" }, audit.items.length), /* @__PURE__ */ h(
        Btn,
        {
          size: "sm",
          variant: "ghost",
          disabled: busy || audit.items.length === 0,
          onClick: () => void clearAudit()
        },
        confirm === "audit" ? t("audit.clearConfirm") : t("audit.clear")
      ))
    },
    t("audit.title")
  ), /* @__PURE__ */ h("div", { className: "pg-note" }, t("audit.hint")), audit.status === "loading" ? /* @__PURE__ */ h(Loading, { text: t("common.loading") }) : null, audit.status === "error" ? /* @__PURE__ */ h(ErrorBox, { message: audit.error }) : null, audit.status === "ready" && audit.items.length === 0 ? /* @__PURE__ */ h("div", { className: "pg-meta" }, t("audit.empty")) : null, audit.items.length ? /* @__PURE__ */ h("div", { className: "pg-table" }, /* @__PURE__ */ h("div", { className: "pg-table-head" }, /* @__PURE__ */ h("span", null, t("audit.time")), /* @__PURE__ */ h("span", null, t("audit.action")), /* @__PURE__ */ h("span", null, t("audit.result")), /* @__PURE__ */ h("span", null, t("audit.detail"))), audit.items.map((item, index) => /* @__PURE__ */ h("div", { className: "pg-table-row", key: `${item.at}-${index}` }, /* @__PURE__ */ h("span", null, new Date(item.at).toLocaleString()), /* @__PURE__ */ h("span", { className: "pg-mono" }, item.action), /* @__PURE__ */ h("span", null, /* @__PURE__ */ h(Badge, { tone: item.ok ? "ok" : "bad" }, item.ok ? t("audit.ok") : t("audit.failed"))), /* @__PURE__ */ h("span", { className: "pg-ellipsis", title: item.detail }, item.detail || "-")))) : null), /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, { extra: /* @__PURE__ */ h(Badge, { tone: "off" }, filter.limit) }, t("audit.logsTitle")), /* @__PURE__ */ h("div", { className: "pg-note" }, t("audit.logsHint")), /* @__PURE__ */ h("div", { className: "pg-row" }, /* @__PURE__ */ h(
    "select",
    {
      className: "pg-input pg-select",
      value: filter.level,
      onChange: (event) => setFilter((prev) => ({ ...prev, level: event.target.value }))
    },
    LEVELS.map((level) => /* @__PURE__ */ h("option", { value: level, key: level || "all" }, level || t("audit.levelAll")))
  ), /* @__PURE__ */ h(
    "input",
    {
      className: "pg-input",
      value: filter.module,
      placeholder: t("audit.modulePlaceholder"),
      onChange: (event) => setFilter((prev) => ({ ...prev, module: event.target.value }))
    }
  ), /* @__PURE__ */ h(
    "select",
    {
      className: "pg-input pg-select",
      value: String(filter.limit),
      onChange: (event) => setFilter((prev) => ({ ...prev, limit: Number(event.target.value) || 50 }))
    },
    [20, 50, 100].map((value) => /* @__PURE__ */ h("option", { value: String(value), key: value }, value))
  ), /* @__PURE__ */ h(Btn, { size: "sm", disabled: busy, onClick: () => void refreshAll() }, t("action.refresh")), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: "ghost",
      title: t("audit.logsClearTitle"),
      disabled: busy || logEntries.length === 0,
      onClick: () => void clearLogs()
    },
    confirm === "logs" ? t("audit.logsClearConfirm") : t("audit.logsClear")
  )), logs.status === "loading" ? /* @__PURE__ */ h(Loading, { text: t("common.loading") }) : null, logs.status === "error" ? /* @__PURE__ */ h(ErrorBox, { message: logs.error }) : null, logs.data?.denied ? /* @__PURE__ */ h("div", { className: "pg-inline-warn" }, t("audit.logsDenied", { reason: logs.data.denied.reason || "" })) : null, logs.status === "ready" && !logs.data?.denied && logEntries.length === 0 ? /* @__PURE__ */ h("div", { className: "pg-meta" }, t("audit.logsEmpty")) : null, logEntries.length ? /* @__PURE__ */ h("div", { className: "pg-lines" }, logEntries.map((entry, index) => /* @__PURE__ */ h("div", { className: "pg-line", key: index }, summarizeLog(entry)))) : null, logs.status === "ready" && !logEntries.length && logPayload && !logs.data?.denied ? /* @__PURE__ */ h("pre", { className: "pg-pre" }, JSON.stringify(logPayload, null, 2)) : null));
}

// src/panel/settings.jsx
function SettingsView({ t, rpc, notify, config, reload }) {
  const React = getReact();
  const savedRef = React.useRef({
    enabled: config?.enabled !== false,
    autoSnapshot: config?.autoSnapshot !== false
  });
  const [draft, setDraft] = React.useState(savedRef.current);
  const [busy, setBusy] = React.useState(false);
  const [repairing, setRepairing] = React.useState(false);
  const issue = config?.settingsIssue || null;
  const issueKind = issue?.kind === "read-failed" ? "read-failed" : "corrupt";
  React.useEffect(() => {
    const next = {
      enabled: config?.enabled !== false,
      autoSnapshot: config?.autoSnapshot !== false
    };
    const prevSaved = savedRef.current;
    savedRef.current = next;
    setDraft(
      (prev) => prev.enabled !== prevSaved.enabled || prev.autoSnapshot !== prevSaved.autoSnapshot ? prev : next
    );
  }, [config]);
  const update = (patch) => setDraft((prev) => ({ ...prev, ...patch }));
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await rpc.saveSettings({ enabled: draft.enabled, autoSnapshot: draft.autoSnapshot });
      const confirmed = {
        enabled: saved?.enabled !== false,
        autoSnapshot: saved?.autoSnapshot !== false
      };
      savedRef.current = confirmed;
      setDraft(confirmed);
      notify("ok", t("settings.saved"));
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };
  const repair = async () => {
    if (repairing) return;
    if (!window.confirm(t("settings.repairConfirm"))) return;
    setRepairing(true);
    try {
      const result = await rpc.repairSettings();
      notify(
        "ok",
        result?.repaired ? t("settings.repaired", { file: result.file || "-" }) : result?.reason || t("settings.repairNotNeeded")
      );
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setRepairing(false);
    }
  };
  return /* @__PURE__ */ h("div", { className: "pg-stack" }, /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, { extra: /* @__PURE__ */ h(Badge, { tone: "off" }, "com.snow.purge") }, t("settings.title")), issue ? /* @__PURE__ */ h("div", { className: "pg-inline-warn" }, /* @__PURE__ */ h("div", null, issueKind === "read-failed" ? t("settings.readFailedHint") : issue.message || t("settings.corruptHint")), issueKind === "corrupt" ? /* @__PURE__ */ h("div", { className: "pg-row pg-row-end" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "danger", disabled: repairing, onClick: () => void repair() }, t("settings.repair"))) : null) : null, /* @__PURE__ */ h(
    Toggle,
    {
      checked: draft.enabled,
      onChange: (next) => update({ enabled: next }),
      label: t("settings.enabled"),
      hint: t("settings.enabledHint")
    }
  ), /* @__PURE__ */ h(
    Toggle,
    {
      checked: draft.autoSnapshot,
      onChange: (next) => update({ autoSnapshot: next }),
      label: t("settings.autoSnapshot"),
      hint: t("settings.autoSnapshotHint")
    }
  ), /* @__PURE__ */ h("div", { className: "pg-row pg-row-end" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "primary", disabled: busy, onClick: () => void save() }, t("action.save")))), /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, null, t("settings.abilities")), /* @__PURE__ */ h("ul", { className: "pg-list" }, /* @__PURE__ */ h("li", null, t("settings.ability.selfcheck")), /* @__PURE__ */ h("li", null, t("settings.ability.prompt")), /* @__PURE__ */ h("li", null, t("settings.ability.role")), /* @__PURE__ */ h("li", null, t("settings.ability.proxy")), /* @__PURE__ */ h("li", null, t("settings.ability.approval")), /* @__PURE__ */ h("li", null, t("settings.ability.backup")), /* @__PURE__ */ h("li", null, t("settings.ability.audit")))), /* @__PURE__ */ h("div", { className: "pg-card" }, /* @__PURE__ */ h(SectionTitle, null, t("settings.limits")), /* @__PURE__ */ h("ul", { className: "pg-list" }, /* @__PURE__ */ h("li", null, t("settings.limit.host")), /* @__PURE__ */ h("li", null, t("settings.limit.sensitive")), /* @__PURE__ */ h("li", null, t("settings.limit.sidebar")), /* @__PURE__ */ h("li", null, t("settings.limit.restart")), /* @__PURE__ */ h("li", null, t("settings.limit.updater")))));
}

// src/panel/main.jsx
if (typeof window !== "undefined" && window.SnowAppPlugin && window.SnowAppPlugin.React) {
  bindReact(window.SnowAppPlugin.React);
}
var TAB_IDS = ["status", "prompts", "approval", "redteam", "proxy", "backup", "audit", "settings"];
var TAB_LABEL = {
  status: "tab.status",
  prompts: "tab.prompts",
  approval: "tab.approval",
  redteam: "tab.redteam",
  proxy: "tab.proxy",
  backup: "tab.backup",
  audit: "tab.audit",
  settings: "tab.settings"
};
var buildTabIcons = () => ({
  status: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("path", { d: "M12 3 4.5 6v6c0 4.2 3.1 7.6 7.5 9 4.4-1.4 7.5-4.8 7.5-9V6Z" }), /* @__PURE__ */ h("path", { d: "m8.6 12.1 2.5 2.5 4.4-4.8" })),
  prompts: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("path", { d: "M5 4h11l3 3v13H5Z" }), /* @__PURE__ */ h("path", { d: "M8 9h8M8 13h8M8 17h5" })),
  approval: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("path", { d: "M12 21s7-3.6 7-9V6l-7-3-7 3v6c0 5.4 7 9 7 9Z" }), /* @__PURE__ */ h("path", { d: "M9 11.5 11 13.5 15 9.5" })),
  redteam: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("circle", { cx: "12", cy: "12", r: "8" }), /* @__PURE__ */ h("circle", { cx: "12", cy: "12", r: "3" }), /* @__PURE__ */ h("path", { d: "M12 2v3M12 19v3M2 12h3M19 12h3" })),
  proxy: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("path", { d: "M4 7h11l-2.5-2.5M20 17H9l2.5 2.5" }), /* @__PURE__ */ h("path", { d: "M4 7h6M14 17h6" })),
  backup: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("path", { d: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3v10c0 1.7-3.6 3-8 3s-8-1.3-8-3Z" }), /* @__PURE__ */ h("path", { d: "M4 7c0 1.7 3.6 3 8 3s8-1.3 8-3" })),
  audit: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("path", { d: "M6 3h12v18H6Z" }), /* @__PURE__ */ h("path", { d: "M9 8h6M9 12h6M9 16h4" })),
  settings: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("circle", { cx: "12", cy: "12", r: "3" }), /* @__PURE__ */ h("path", { d: "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" }))
});
var NOTICE_MS = 4200;
var REFRESH_MS = 25e3;
function PurgePanel({ api, locale, isActive }) {
  const React = ensureReact(api);
  const tabIcons = React.useMemo(buildTabIcons, []);
  const translator = React.useMemo(() => createTranslator(api, locale), [api, locale]);
  const { t, locale: resolvedLocale } = translator;
  const log = React.useCallback(
    (...args) => {
      try {
        api?.log?.(...args);
      } catch {
      }
    },
    [api]
  );
  const rpc = React.useMemo(() => createRpc(api, { log }), [api, log]);
  const [view, setView] = React.useState({ status: "loading", error: "", data: null });
  const [tab, setTab] = React.useState("status");
  const [busy, setBusy] = React.useState("");
  const [notices, setNotices] = React.useState([]);
  const [refreshTick, setRefreshTick] = React.useState(0);
  const [rosterOpen, setRosterOpen] = React.useState(false);
  const aliveRef = React.useRef(true);
  const timersRef = React.useRef(/* @__PURE__ */ new Map());
  React.useEffect(() => {
    aliveRef.current = true;
    const timers = timersRef.current;
    return () => {
      aliveRef.current = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);
  const notify = React.useCallback((tone, text) => {
    if (!aliveRef.current) return;
    const id = `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setNotices((list) => [...list.slice(-2), { id, tone: tone || "info", text: String(text || "") }]);
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      if (!aliveRef.current) return;
      setNotices((list) => list.filter((item) => item.id !== id));
    }, NOTICE_MS);
    timersRef.current.set(id, timer);
  }, []);
  const describeError = React.useCallback(
    (error) => {
      const code = String(error?.code || "");
      if (code === "BACKGROUND_PENDING") return t("error.pending");
      if (code === "BACKGROUND_UNAVAILABLE") return t("error.backgroundUnavailable");
      if (code === "NET_UNAVAILABLE") return t("error.netUnavailable");
      if (code === "TIMEOUT") return t("error.timeout");
      return t("error.generic", { message: String(error?.message || error) });
    },
    [t]
  );
  const reload = React.useCallback(async () => {
    try {
      const data2 = await rpc.overview();
      if (!aliveRef.current) return;
      setView({ status: "ready", error: "", data: data2 });
      setRefreshTick((tick) => tick + 1);
    } catch (error) {
      if (!aliveRef.current) return;
      setView((prev) => ({
        status: prev.data ? "stale" : "error",
        error: describeError(error),
        data: prev.data
      }));
    }
  }, [rpc, describeError]);
  React.useEffect(() => {
    void reload();
  }, [reload]);
  React.useEffect(() => {
    if (isActive === false) return void 0;
    const timer = setInterval(() => {
      void reload();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload, isActive]);
  const summarize = (steps, { revert = false, bySwitch = false, noop = false, appliedError = "" } = {}) => summarizeApplyOutcome(
    steps,
    noop ? "noop" : bySwitch ? "revert-by-switch" : revert ? "revert" : "apply",
    t,
    {
      appliedError
    }
  );
  const runApply = React.useCallback(
    async (forceProxy = false) => {
      if (busy) return;
      setBusy("apply");
      try {
        const result = await rpc.apply(forceProxy);
        const bySwitch = result?.mode === "revert";
        const summary = summarize(result?.steps || [], {
          revert: bySwitch,
          bySwitch,
          noop: result?.mode === "noop",
          appliedError: result?.appliedError
        });
        notify(summary.tone, summary.text);
        await reload();
      } catch (error) {
        notify("bad", describeError(error));
      } finally {
        if (aliveRef.current) setBusy("");
      }
    },
    [busy, rpc, notify, reload, describeError, t]
  );
  const runRevert = React.useCallback(async () => {
    if (busy) return;
    setBusy("revert");
    try {
      const result = await rpc.revert();
      const summary = summarize(result?.steps || [], {
        revert: true,
        appliedError: result?.appliedError
      });
      notify(summary.tone, summary.text);
      await reload();
    } catch (error) {
      notify("bad", describeError(error));
    } finally {
      if (aliveRef.current) setBusy("");
    }
  }, [busy, rpc, notify, reload, describeError, t]);
  const data = view.data;
  const config = data?.config || null;
  const counts = data?.selfcheck?.counts || { ok: 0, warn: 0, fail: 0, off: 0 };
  return /* @__PURE__ */ h("div", { className: "pg-root" }, /* @__PURE__ */ h("div", { className: "pg-head" }, /* @__PURE__ */ h("div", { className: "pg-head-main" }, /* @__PURE__ */ h("span", { className: "pg-title" }, t("app.title")), /* @__PURE__ */ h("span", { className: "pg-sub" }, data?.server ? `v${data.server.version} · ${t("status.port")} ${data.server.port}` : t("status.connecting"))), /* @__PURE__ */ h("div", { className: "pg-head-badges" }, counts.ok > 0 ? /* @__PURE__ */ h(Badge, { tone: "ok" }, `${t("status.ok")} ${counts.ok}`) : null, counts.warn > 0 ? /* @__PURE__ */ h(Badge, { tone: "warn" }, `${t("status.warn")} ${counts.warn}`) : null, counts.fail > 0 ? /* @__PURE__ */ h(Badge, { tone: "bad" }, `${t("status.fail")} ${counts.fail}`) : null), /* @__PURE__ */ h("div", { className: "pg-head-spacer" }), /* @__PURE__ */ h(Btn, { size: "sm", variant: "primary", disabled: busy !== "" || view.status === "loading", onClick: () => void runApply(false) }, t("action.apply")), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: busy !== "" || view.status === "loading", onClick: () => void runRevert() }, t("action.revert")), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: busy !== "", onClick: () => void reload() }, t("action.refresh"))), /* @__PURE__ */ h("div", { className: "pg-tabs" }, TAB_IDS.map((id) => /* @__PURE__ */ h(
    "button",
    {
      key: id,
      type: "button",
      className: "pg-tab",
      "data-active": tab === id ? "1" : "0",
      onClick: () => setTab(id)
    },
    /* @__PURE__ */ h(
      "svg",
      {
        className: "pg-tab-icon",
        width: "14",
        height: "14",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.8",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true"
      },
      tabIcons[id]
    ),
    /* @__PURE__ */ h("span", null, t(TAB_LABEL[id]))
  ))), /* @__PURE__ */ h("div", { className: "pg-body" }, view.status === "loading" ? /* @__PURE__ */ h(Loading, { text: t("status.loading") }) : null, view.status === "error" ? /* @__PURE__ */ h(
    ErrorBox,
    {
      title: t("error.title"),
      message: view.error,
      action: /* @__PURE__ */ h(
        Btn,
        {
          size: "sm",
          variant: "primary",
          onClick: () => {
            rpc.resetPort();
            setView({ status: "loading", error: "", data: null });
            void reload();
          }
        },
        t("action.retry")
      )
    }
  ) : null, view.status === "stale" ? /* @__PURE__ */ h("div", { className: "pg-inline-warn" }, view.error) : null, data && tab === "status" ? /* @__PURE__ */ h(
    StatusView,
    {
      t,
      data,
      busy,
      onApply: () => void runApply(false),
      onRevert: () => void runRevert(),
      onRefresh: () => void reload()
    }
  ) : null, data && tab === "prompts" ? /* @__PURE__ */ h(
    PromptsView,
    {
      t,
      locale: resolvedLocale,
      rpc,
      notify,
      config,
      reload
    }
  ) : null, data && tab === "approval" ? /* @__PURE__ */ h(ApprovalView, { t, rpc, notify, config, reload }) : null, data && tab === "redteam" ? /* @__PURE__ */ h(
    RedteamView,
    {
      t,
      rpc,
      notify,
      refreshTick,
      onOpenRoster: () => setRosterOpen(true)
    }
  ) : null, data && tab === "proxy" ? /* @__PURE__ */ h(ProxyView, { t, rpc, notify, config, reload }) : null, data && tab === "backup" ? /* @__PURE__ */ h(BackupView, { t, rpc, notify, reload }) : null, data && tab === "audit" ? /* @__PURE__ */ h(AuditView, { t, rpc, notify }) : null, data && tab === "settings" ? /* @__PURE__ */ h(SettingsView, { t, rpc, notify, config, reload }) : null), rosterOpen ? /* @__PURE__ */ h(RosterModal, { t, rpc, notify, onClose: () => setRosterOpen(false) }) : null, notices.length ? /* @__PURE__ */ h("div", { className: "pg-notices" }, notices.map((notice) => /* @__PURE__ */ h("div", { className: "pg-notice", "data-tone": notice.tone, key: notice.id }, notice.text))) : null);
}
export {
  PurgePanel as default
};
