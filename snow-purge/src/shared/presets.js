// 内置预设：只填充面板上的可编辑字段，不会自动写入宿主。
// 用户可以在此基础上改名保存成自己的预设（存插件私有存储）。
const ALL_PROVIDERS = { chat: true, responses: true, anthropic: true, gemini: true };

export const BUILTIN_PRESETS = [
  {
    id: "builtin:standard",
    builtin: true,
    name: { default: "Standard", "zh-CN": "标准", "zh-TW": "標準" },
    summary: {
      default: "Reduce confirmation loops, keep the work continuous.",
      "zh-CN": "减少确认往返，保持任务连贯。",
      "zh-TW": "減少確認往返，保持任務連貫。",
    },
    directive:
      "继续执行当前任务，不要为每一步重复请求确认。遇到不明确的地方，先给出你能执行的下一步并说明假设；已经有结论的部分不要重述。只在确实需要用户本人决定时停下来提问。",
    boost: true,
    providers: ALL_PROVIDERS,
  },
  {
    id: "builtin:compact",
    builtin: true,
    name: { default: "Compact", "zh-CN": "精简", "zh-TW": "精簡" },
    summary: {
      default: "Shortest directive, lowest token overhead.",
      "zh-CN": "最短指令，token 开销最低。",
      "zh-TW": "最短指令，token 開銷最低。",
    },
    directive: "直接执行，不要为每一步重复确认；信息不足时先做可做的部分并说明假设。",
    boost: false,
    providers: { chat: true, responses: true, anthropic: true, gemini: false },
  },
  {
    id: "builtin:strict",
    builtin: true,
    name: { default: "Strict", "zh-CN": "强化", "zh-TW": "強化" },
    summary: {
      default: "Directive in both the system position and the tail of the request.",
      "zh-CN": "系统位置与请求尾部各放一次，约束更强。",
      "zh-TW": "系統位置與請求尾部各放一次，約束更強。",
    },
    directive:
      "执行任务时保持连续：不要为同一件事反复请求确认，不要把已确认的决定重新拿出来讨论。优先给出可验证的结果与证据，其次才是解释。遇到工具失败时先尝试一次替代路径，再报告失败原因。只在涉及不可逆的破坏性操作时停下来确认。",
    boost: true,
    providers: ALL_PROVIDERS,
  },
  {
    id: "builtin:role",
    builtin: true,
    name: { default: "Role block", "zh-CN": "角色规则", "zh-TW": "角色規則" },
    summary: {
      default: "Also writes a matching global role block.",
      "zh-CN": "同时写入一份匹配的全局角色规则。",
      "zh-TW": "同時寫入一份匹配的全域角色規則。",
    },
    directive:
      "在本机项目里与用户协作时保持连续执行：减少确认往返，优先完成已经明确的任务，改动前说明影响面。",
    role:
      "协作方式：直接执行用户已经明确的任务，不要为每一步重复确认；需要用户决定时一次问清。回答以结论和证据优先，避免复述与空泛的免责声明。",
    boost: true,
    providers: ALL_PROVIDERS,
  },
];

export const findBuiltinPreset = (id) => BUILTIN_PRESETS.find((item) => item.id === id) || null;
