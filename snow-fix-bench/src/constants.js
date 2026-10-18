// 修复工作台（Fix Bench）- Snow App 客户端脚本插件
// 界面：聊天输入框入口 + 居中浮层工作台；代码审查 / issue 清单 / 批量修复 / 结果清理。
// 入口契约：脚本入口 src/script/main.js 自建容器，数据经 snow.metadata / snow.write 读写。
//
// 数据流：
//   1. 审查：读取 Git 变更（staged / unstaged / 最近提交）→ 组装与内置 /review 等价的提示词
//      → 新建会话自动发送 → 只读跟踪会话消息 → 解析结构化 issue 清单。
//   2. 修复：勾选 issue → 按内置批量修复流程组装提示词 → 新建会话 → 跟踪结果 → 回写状态。
//   3. 清理：由用户在对话框内确认后归档 / 删除 issue，归档 / 删除会话。
// 所有应用数据写入都走 api.write，读取会话消息走 api.metadata；issue 本身保存在插件私有存储。

const PANEL_ID = "fix-bench";
const STORE_PREFIX = "fixbench:v2:";
const STORE_VERSION = 2;
// 脚本级偏好：与项目 issue 分开存放，切换项目后仍然生效。
const SETTINGS_KEY = `${STORE_PREFIX}settings`;

const REVIEW_TIMEOUT_MS = 15 * 60 * 1000;
const FIX_TIMEOUT_MS = 60 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;
// 流式期间 messages 域的兜底读取间隔：runtime 只用于廉价判断会话是否仍在运行。
const STREAM_MESSAGE_READ_MS = 10000;
// 空闲（非流式）期间的 messages 读取间隔：避免轮次间隙每 2 秒全量读取会话正文。
const IDLE_MESSAGE_READ_MS = 5000;
// runtime 快照轮询间隔。runtime 是 live 域：宿主流式期间约每 250ms 更新快照，
// 订阅会在 200ms 防抖后重新采集推送，频率反而高于轮询，因此保持按间隔读取。
const RUNTIME_READ_MS = 5000;
// 会话已空闲但没有任何助手正文时的终态判定：中止消息通常落库为 cancelled + 空内容。
// 连续 aborted 轮询用于快速结束；通用空响应需要更长宽限，避免新建会话尚未启动时误判。
const WATCH_ABORTED_POLLS = 2;
const WATCH_EMPTY_POLLS = 5;
const WATCH_EMPTY_GRACE_MS = 60 * 1000;
// runtime 不可读时的收尾判定：连续相同正文快照达到该轮次才允许返回。
// runtime 可读且空闲时仍按稳定快照快速收尾；未知状态用更长窗口覆盖工具调用期间正文不变。
const WATCH_UNKNOWN_STABLE_POLLS = 5;

// 并行上限：写入修复提示词，约束同一轮中的并行取证与并行实施数量。
const DEFAULT_PARALLEL_LIMIT = 3;
const MIN_PARALLEL_LIMIT = 1;
const MAX_PARALLEL_LIMIT = 10;
// 断线重连后消息域连续为空的轮询次数：达到阈值即判定会话已不存在。
const SESSION_MISSING_POLLS = 8;
// 已确认会话仍存在但消息域持续为空时，隔一段轮询再复核一次。
const SESSION_MISSING_RECHECK_POLLS = 30;

const MAX_DIFF_CHARS = 40000;
const MAX_TOTAL_DIFF_CHARS = 180000;
const COMMIT_LIMIT = 20;
// 沙箱档借内置终端 MCP 工具执行只读 git log 时的条数上限。
const COMMIT_COMMAND_LIMIT = 50;
// git log 输出字段分隔符（US，不会出现在提交信息里）。
const COMMIT_FIELD_SEP = "\u001f";
// 内置终端 MCP 工具名（宿主 native/src/mcp/servers/bash/mod.rs）。
// native 侧只认内部全名 `{server_id}-{tool_name}`；`mcp__bash__terminal-execute`
// 是渲染层给模型看的公开名，直接透传给 mcpTools.call 会被当成外部服务器而报
// "MCP tool is no longer available"。两个名字都试，兼容不同宿主版本。
const BASH_TOOL_NAMES = ["bash-terminal-execute", "mcp__bash__terminal-execute"];

// 文件树默认隐藏的重型目录（与宿主导航体验对齐，避免一次展开卡住面板）。
const TREE_IGNORED_DIRS = new Set([".git", "node_modules"]);
const TREE_LOAD_LIMIT = 400;

const ISSUE_STATUS = {
  open: "open",
  fixing: "fixing",
  fixed: "fixed",
  archived: "archived",
};

const SEVERITY = {
  critical: "严重",
  major: "一般",
  minor: "建议",
};

// 语言包缺失时的内置兜底文案（简体中文）。
const FALLBACK = {
  "fx.name": "修复工作台",
  "fx.subtitle": "当前项目",
  "fx.refresh": "刷新",
  "fx.refreshTitle": "重新读取项目与 Git 状态",
  "fx.noProject": "请先在侧边栏打开一个项目。",
  "fx.unsupported": "当前宿主版本缺少插件面板所需的 write / metadata 能力。",
  "fx.loading": "正在读取项目…",
  "fx.loadFailed": "加载失败：{{error}}",
  "fx.retry": "重试",
  "fx.close": "关闭",
  "fx.launcher": "修复工作台",

  "fx.projects.title": "项目",
  "fx.projects.empty": "暂无项目",
  "fx.projects.ungrouped": "未分组",
  "fx.projects.current": "当前",
  "fx.tree.title": "项目文件",
  "fx.tree.hint": "已隐藏 {{names}}",
  "fx.tree.empty": "空目录",
  "fx.tree.loading": "读取中…",
  "fx.tree.error": "读取失败：{{error}}",
  "fx.tree.noProject": "未打开项目",
  "fx.tree.ssh": "SSH 项目暂不显示文件树，审查与修复仍可使用。",
  "fx.tree.openHint": "点击文件在内置阅读器中打开",

  "fx.step.review": "审查",
  "fx.step.extract": "提取",
  "fx.step.fix": "修复",
  "fx.step.cleanup": "清理",

  "fx.empty.title": "当前项目还没有 issue",
  "fx.empty.desc": "先执行一次代码审查，系统会把「一般」及以上的问题写入工作台，并自动生成修复清单。",
  "fx.empty.start": "开始代码审查",
  "fx.empty.hint": "审查使用与内置 /review 相同的范围选择与提示词规则。",

  "fx.issues.title": "项目 issue",
  "fx.issues.count": "共 {{count}} 条",
  "fx.issues.selected": "已选 {{count}} 条",
  "fx.issues.selectAll": "全选",
  "fx.issues.clearSelection": "取消选择",
  "fx.issues.showArchived": "显示已归档",
  "fx.issues.hideArchived": "隐藏已归档",
  "fx.issues.filterAll": "全部",
  "fx.issues.filterCritical": "严重",
  "fx.issues.filterMajor": "一般",
  "fx.issues.empty": "没有符合条件的 issue。",
  "fx.issues.startFix": "修复选中项（{{count}}）",
  "fx.issues.deleteSelected": "删除选中项（{{count}}）",
  "fx.issues.archive": "归档",
  "fx.issues.delete": "删除",
  "fx.issues.restore": "恢复",
  "fx.issues.openLocation": "打开位置",
  "fx.issues.impact": "影响",
  "fx.issues.suggestion": "建议",
  "fx.issues.fixNote": "修复记录",
  "fx.issues.source": "来源会话",
  "fx.issues.unlocated": "未标注位置",
  "fx.issues.more": "展开详情",
  "fx.issues.less": "收起详情",
  "fx.issues.outsideProject": "该位置不在当前项目内，已拒绝打开。",
  "fx.issues.openFailed": "打开文件失败：{{error}}",
  "fx.issues.regressed": "已回归",

  "fx.sev.critical": "严重",
  "fx.sev.major": "一般",
  "fx.sev.minor": "建议",
  "fx.status.open": "待修复",
  "fx.status.fixing": "修复中",
  "fx.status.fixed": "已修复",
  "fx.status.archived": "已归档",

  "fx.activity.review": "代码审查进行中",
  "fx.activity.fix": "缺陷修复进行中",
  "fx.activity.waiting": "等待会话输出…",
  "fx.activity.streaming": "正在接收会话输出…",
  "fx.activity.done": "已完成",
  "fx.activity.detached": "已停止跟踪",
  "fx.activity.open": "打开会话",
  "fx.activity.detach": "停止跟踪",
  "fx.activity.close": "关闭",
  "fx.activity.timeout": "等待超时。可打开会话查看结果，或重新解析最后回复。",
  "fx.activity.failed": "跟踪失败：{{error}}",
  "fx.activity.parseRetry": "重新解析",
  "fx.activity.resume": "继续跟踪",
  "fx.activity.session": "会话 {{id}}",
  "fx.activity.hint": "面板只读取会话进度，不会中止 AI 运行。",
  "fx.activity.elapsed": "已运行 {{time}}",
  "fx.activity.phase": "阶段：{{phase}}",
  "fx.activity.batch": "第 {{batch}}/{{total}} 批",
  "fx.activity.sessionError": "会话未产生有效输出，可能已失败。",
  "fx.activity.sessionInterrupted": "会话已中止，且没有产生任何回复；已停止跟踪并释放修复中状态。",
  "fx.activity.sessionEmptyResponse": "会话已结束，但没有产生有效回复；已停止跟踪并释放修复中状态。",
  "fx.activity.sessionMissing": "会话已不存在或无法读取，已停止跟踪并释放修复中状态。",
  "fx.activity.fixUnsettled": "修复会话可能仍在运行，请先继续跟踪或等待其结束后再重新解析。",
  "fx.activity.sessionUnsettled": "会话可能仍在运行，请先继续跟踪或等待其结束后再重新解析。",

  "fx.toast.reviewStarted": "已新建审查会话，正在跟踪结果。",
  "fx.toast.reviewDone": "审查完成：新增 {{added}} 条，更新 {{updated}} 条，重新打开 {{reopened}} 条。",
  "fx.toast.reviewEmpty": "审查完成：未发现「一般」及以上问题。",
  "fx.toast.reviewParseFailed": "未能从审查结果中解析出 issue，请打开会话检查。",
  "fx.toast.reviewFailed": "审查启动失败：{{error}}",
  "fx.toast.reviewBusy": "已有审查任务正在运行，请等待完成或先停止跟踪。",
  "fx.toast.fixStarted": "已新建修复会话，正在跟踪结果。",
  "fx.toast.fixDone": "修复完成：{{fixed}} 条已修复，{{blocked}} 条待处理。",
  "fx.toast.fixParseFailed": "未找到结构化修复结果，issue 状态保持不变。",
  "fx.toast.fixFailed": "修复启动失败：{{error}}",
  "fx.toast.fixBusy": "已有修复任务正在运行，请等待完成或先停止跟踪。",
  "fx.toast.fixConflict": "选中的 issue 正在修复中，或与可能仍在运行的修复会话重叠；请取消勾选这些 issue，或先继续跟踪、等待当前修复结束。",
  "fx.toast.autoFixStarted": "审查完成，已自动开始修复 {{count}} 条待修复 issue。",
  "fx.toast.fixBatchStarted": "第 {{batch}}/{{total}} 批修复已启动（{{count}} 条）。",
  "fx.toast.fixAllDone": "全部 {{batches}} 批修复完成。",
  "fx.toast.autoCleanupDone": "自动清理完成：已归档 {{count}} 条已修复 issue 及本轮会话。",
  "fx.toast.autoCleanupDeleted": "自动清理完成：已删除 {{count}} 条已修复 issue 及本轮会话。",
  "fx.toast.autoCleanupFailed": "自动清理未完全成功：{{error}}",
  "fx.toast.archived": "已归档 {{count}} 条 issue。",
  "fx.toast.deleted": "已删除 {{count}} 条 issue。",
  "fx.toast.cleanupDone": "处理完成：{{issues}} 条 issue，{{sessions}} 个会话。",
  "fx.toast.cleanupFailed": "处理失败：{{error}}",
  "fx.toast.noSelection": "请先勾选 issue。",
  "fx.toast.noProject": "请先打开一个项目。",
  "fx.toast.gitUnavailable": "未检测到 Git 仓库，将改为审查当前项目代码。",
  "fx.toast.restored": "已恢复该 issue。",

  "fx.review.title": "代码审查",
  "fx.review.description": "选择要审查的 Git 变更范围，AI 只做分析、不修改文件。",
  "fx.review.scope": "审查范围",
  "fx.review.staged": "已暂存变更",
  "fx.review.unstaged": "工作区变更",
  "fx.review.commits": "提交记录",
  "fx.review.noStaged": "暂无已暂存的变更",
  "fx.review.noUnstaged": "暂无工作区变更",
  "fx.review.noCommits": "暂无提交记录",
  "fx.review.noCommitsPanel": "提交记录尚未读取，可点击刷新重试",
  "fx.review.loadingCommits": "正在读取…",
  "fx.review.commitsLoaded": "已读取 {{count}} 条提交",
  "fx.review.commitsFailed": "读取提交记录失败：{{error}}",
  "fx.review.commitsDenied": "脚本未声明 mcpSecrets 隐私域，请在元数据头补充后重新安装脚本",
  "fx.review.commitsNoRepo": "当前目录不是 Git 仓库，无法读取提交记录",
  "fx.review.commitsToolUnavailable": "内置终端工具不可用：请在 MCP 面板为当前项目启用 Terminal（bash）后重试",
  "fx.review.selectAll": "全选",
  "fx.review.clearAll": "取消全选",
  "fx.review.note": "补充审查重点（可选）",
  "fx.review.notePlaceholder": "例如：重点关注性能、并发安全、错误处理...",
  "fx.review.start": "开始审查",
  "fx.review.cancel": "取消",
  "fx.review.loading": "正在加载 Git 信息...",
  "fx.review.error": "读取 Git 变更失败：{{error}}",
  "fx.review.noChanges": "没有勾选任何变更。将让 AI 直接审查当前项目代码。",
  "fx.review.selected": "已选 {{count}} 项",
  "fx.review.currentCode": "直接审查当前项目代码（不附带 diff）",
  "fx.review.repo": "仓库 {{path}}",
  "fx.review.branch": "分支 {{branch}}",
  "fx.review.promptBranch": "当前分支",
  "fx.review.refresh": "刷新",
  "fx.review.empty": "没有可审查的内容",
  "fx.review.notRepo": "当前工作目录不是 Git 仓库",
  "fx.review.notRepoHint": "请先在一个 Git 仓库中打开项目，再使用代码审查。",
  "fx.review.busy": "正在创建审查会话…",
  "fx.review.scopeCurrent": "当前代码",
  "fx.review.scopeChanges": "{{count}} 项变更",
  "fx.review.statusLimitHit":
    "变更过多，Git 仅返回了部分变更。下方列表与本次审查范围可能不完整；可在 Git 设置中调大变更数量上限，或分批审查。",
  "fx.review.commitsDescription": "读取 Git 提交记录（只读 git log）",
  "fx.title.review": "代码审查 · {{project}} · {{time}}",
  "fx.title.fix": "缺陷修复 · {{project}} · {{count}} 项 · {{time}}",
  "fx.title.fixBatch": "缺陷修复 · {{project}} · {{count}} 项 · 第 {{batch}}/{{total}} 批 · {{time}}",
  "fx.fix.scopeIssues": "{{count}} 条 issue",

  "fx.fix.title": "批量修复",
  "fx.fix.confirm": "将新建会话，按修复流程处理选中的 {{count}} 条 issue。修复期间不会自动执行 Git 操作。",
  "fx.fix.start": "开始修复",
  "fx.fix.cancel": "取消",
  "fx.fix.note": "修复流程",
  "fx.fix.step1": "逐条取证，确认问题真实存在",
  "fx.fix.step2": "并行只读取证，输出涉及文件清单",
  "fx.fix.step3": "冲突分析：文件重叠串行，其余并行",
  "fx.fix.step4": "最小范围实施，统一验证",
  "fx.fix.step5": "输出结构化结果，自动回写状态",
  "fx.fix.tooMany": "本轮 {{count}} 条，建议单次不超过 {{limit}} 条以保证质量。",
  "fx.fix.parallel": "并行上限：{{count}}（可在设置中调整）",
  "fx.fix.batchHint": "共 {{count}} 条，将分 {{batches}} 批执行，每批最多 {{limit}} 条；每批完成后自动新建会话继续下一批。",
  "fx.fix.scopeBatch": "{{count}} 条 issue（第 {{batch}}/{{total}} 批）",
  "fx.fix.busy": "正在创建修复会话…",

  "fx.cleanup.title": "处理本轮结果",
  "fx.cleanup.issues": "项目 issue",
  "fx.cleanup.archivedSelected": "归档选中",
  "fx.cleanup.deleteSelected": "删除选中",
  "fx.cleanup.sessions": "会话处理",
  "fx.cleanup.reviewSession": "审查会话",
  "fx.cleanup.fixSession": "修复会话",
  "fx.cleanup.keep": "保留",
  "fx.cleanup.archive": "归档",
  "fx.cleanup.delete": "删除",
  "fx.cleanup.confirm": "确认处理",
  "fx.cleanup.cancel": "取消",
  "fx.cleanup.noSessions": "暂无可处理的会话",
  "fx.cleanup.sessionGroup": "{{label}} · {{count}} 个会话",
  "fx.cleanup.fixedHint": "已修复的 issue 默认勾选；修复中或待修复项也可勾选后一并删除。",
  "fx.cleanup.deleteWarn": "删除 issue 与删除会话都不可恢复。",
  "fx.cleanup.runningTag": "运行中",
  "fx.cleanup.runningBlocked": "会话仍在运行，已取消清理。请等待其完成，或先停止跟踪。",
  "fx.cleanup.runningHint": "会话仍在运行，暂不可归档或删除。",
  "fx.cleanup.detachedHint": "跟踪已停止，但会话可能仍在运行；删除会丢失后续消息。",
  "fx.cleanup.historicalHint": "历史会话不在当前跟踪中，工作台无法确认其是否仍在运行；归档可恢复，删除不可恢复。",
  "fx.cleanup.riskAck": "我已确认这些会话均已结束，仍要继续",
  "fx.cleanup.unverifiedBlocked": "有会话无法确认运行状态，已取消清理。请确认其结束后重试。",
  "fx.cleanup.open": "处理结果",

  "fx.error.projectSwitched": "项目已切换，操作已取消。",
  "fx.error.saveFailed": "保存失败：{{error}}",
  "fx.error.loadCorrupt": "本地数据损坏，原始内容已备份到 {{key}}；本次以空列表启动。",
  "fx.error.storageRead": "读取本地数据失败：{{error}}",
  "fx.error.storageBackup": "本地数据损坏且备份失败：{{error}}；已暂停写入以避免覆盖原始数据。",
  "fx.error.storageBlocked": "本地数据读取失败，已暂停写入以避免覆盖原始数据。",

  "fx.delete.title": "删除 issue",
  "fx.delete.confirm": "确定删除选中的 {{count}} 条 issue 吗？此操作不可恢复。",
  "fx.delete.fixingHint": "其中 {{count}} 条处于修复中，删除后不会再回写修复结果。",
  "fx.delete.ok": "删除",
  "fx.delete.cancel": "取消",

  "fx.settings.title": "设置",
  "fx.settings.open": "设置",
  "fx.settings.parallel": "并行上限",
  "fx.settings.parallelHint":
    "并行上限会写入修复提示词，约束同一轮中的并行取证与并行实施数量；它不改变宿主的实际并发能力，超出上限的任务按顺序排队。",
  "fx.settings.parallelRange": "范围 {{min}} - {{max}}，默认 {{default}}。",
  "fx.settings.autoFix": "审查完成后自动开始修复",
  "fx.settings.autoFixHint": "默认关闭。开启后，仅自动修复本次审查新增或重开的 issue。",
  "fx.settings.autoCleanup": "全部修复完成后自动清理",
  "fx.settings.autoCleanupHint": "所有批次修复完成后，自动处理本轮已修复的 issue 与修复会话。",
  "fx.settings.autoCleanupAction": "自动清理动作",
  "fx.settings.cleanupArchive": "归档（可恢复）",
  "fx.settings.cleanupDelete": "删除（不可恢复）",
  "fx.settings.save": "保存",
  "fx.settings.cancel": "取消",
  "fx.settings.saved": "设置已保存。",
  "fx.settings.failed": "设置保存失败：{{error}}",

  "fx.confirm.title": "确认操作",
  "fx.confirm.cancel": "取消",
  "fx.confirm.ok": "确认",
};

export {
  PANEL_ID,
  STORE_PREFIX,
  STORE_VERSION,
  SETTINGS_KEY,
  REVIEW_TIMEOUT_MS,
  FIX_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  STREAM_MESSAGE_READ_MS,
  IDLE_MESSAGE_READ_MS,
  RUNTIME_READ_MS,
  WATCH_ABORTED_POLLS,
  WATCH_EMPTY_POLLS,
  WATCH_EMPTY_GRACE_MS,
  WATCH_UNKNOWN_STABLE_POLLS,
  DEFAULT_PARALLEL_LIMIT,
  MIN_PARALLEL_LIMIT,
  MAX_PARALLEL_LIMIT,
  SESSION_MISSING_POLLS,
  SESSION_MISSING_RECHECK_POLLS,
  MAX_DIFF_CHARS,
  MAX_TOTAL_DIFF_CHARS,
  COMMIT_LIMIT,
  COMMIT_COMMAND_LIMIT,
  COMMIT_FIELD_SEP,
  BASH_TOOL_NAMES,
  TREE_IGNORED_DIRS,
  TREE_LOAD_LIMIT,
  ISSUE_STATUS,
  SEVERITY,
  FALLBACK,
};