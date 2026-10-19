// 阅读设置默认值、收敛规则表与可自定义键位。
import { FONT_STACKS, THEMES } from "./ui/assets.js";

export const DEFAULT_SETTINGS = {
  winVisible: false,
  opacity: 0.92,
  sleepMode: "fade",
  sleepOpacity: 0.06,
  sleepDelay: 500,
  x: null,
  y: null,
  width: 460,
  height: 380,
  theme: "auto",
  fontSize: 15,
  lineHeight: 1.9,
  font: "default",
  indent: false,
  // 正文与标题的字形：auto 跟随宿主界面语言（简体界面转简体、繁体界面转繁体、其它语言不处理）
  scriptConvert: "auto",
  wheelPaging: true,
  hotkeys: "hover",
  autoScroll: false,
  autoScrollSpeed: 40
};

// 设置项收敛规则表：键必须与 DEFAULT_SETTINGS 一一对应，sanitizeSettings 逐键按此收敛，
// 并在末尾做双向差集校验；新增设置字段时忘记在此登记会被日志告警（而不是静默重置）。
// kind：bool 布尔；num 数字（min/max 收敛）；oneOf 候选集（values 延迟求值，避免依赖声明顺序）；
// nullableNum 数字或 null（如窗口坐标 x/y 的「未设置」语义）。
// num 型键的 min/max 同时是界面滑杆的取值范围（带单位换算的项按 scale 换算：opacity/sleepOpacity 乘 100、lineHeight 乘 10）；
// 滑杆必须直接引用本表，不得另写字面量。
export const SETTINGS_SPEC = {
  winVisible: { kind: "bool" },
  opacity: { kind: "num", min: 0.05, max: 1 },
  sleepMode: { kind: "oneOf", values: () => ["always", "fade", "hide"] },
  sleepOpacity: { kind: "num", min: 0.01, max: 1 },
  sleepDelay: { kind: "num", min: 0, max: 10000 },
  x: { kind: "nullableNum" },
  y: { kind: "nullableNum" },
  width: { kind: "num", min: 220, max: 1400 },
  height: { kind: "num", min: 140, max: 1200 },
  theme: { kind: "oneOf", values: () => ["auto"].concat(Object.keys(THEMES)) },
  fontSize: { kind: "num", min: 11, max: 36 },
  lineHeight: { kind: "num", min: 1.2, max: 3 },
  font: { kind: "oneOf", values: () => Object.keys(FONT_STACKS) },
  indent: { kind: "bool" },
  scriptConvert: { kind: "oneOf", values: () => ["auto", "simplified", "traditional", "none"] },
  wheelPaging: { kind: "bool" },
  hotkeys: { kind: "oneOf", values: () => ["hover", "global", "off"] },
  autoScroll: { kind: "bool" },
  autoScrollSpeed: { kind: "num", min: 5, max: 400 }
};

// 可自定义键位的默认绑定：动作 id -> 键位标识数组（如 "Ctrl+ArrowRight"）
export const DEFAULT_KEY_BINDINGS = {
  pageDown: ["PageDown", "ArrowDown", "ArrowRight", "Space", "KeyJ"],
  pageUp: ["PageUp", "ArrowUp", "ArrowLeft", "KeyK"],
  nextChapter: ["Ctrl+ArrowRight", "Ctrl+PageDown"],
  prevChapter: ["Ctrl+ArrowLeft", "Ctrl+PageUp"],
  top: ["Home"],
  bottom: ["End"]
};

export function cloneKeyBindings(map) {
  const result = {};
  for (const key of Object.keys(map || {})) result[key] = map[key].slice();
  return result;
}

// 修饰键与无意义按键：录制与匹配时忽略
export const MODIFIER_CODE_RE = /^(Control|Shift|Alt|Meta|OS|Hyper|Super)(Left|Right)?$/;
export const DEAD_KEY_CODE_RE = /^(CapsLock|NumLock|ScrollLock|ContextMenu|Dead|Unidentified|Process|Compose|Convert|NonConvert|KanaMode|Lang[0-9]?)$/;
export const NAMED_KEY_ALIASES = { " ": "Space", Spacebar: "Space", Esc: "Escape", Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight" };

// 把键盘事件归一化为键位标识（如 "Ctrl+ArrowRight"）；只按下修饰键时返回 null
export function eventKeyId(e) {
  if (!e || e.isComposing) return null;
  const code = typeof e.code === "string" ? e.code : "";
  const key = typeof e.key === "string" ? e.key : "";
  let base = "";
  if (code && !MODIFIER_CODE_RE.test(code) && !DEAD_KEY_CODE_RE.test(code)) {
    base = code;
  } else if (key && key.length === 1) {
    if (key === " ") base = "Space";
    else if (/[a-z]/i.test(key)) base = "Key" + key.toUpperCase();
    else if (/[0-9]/.test(key)) base = "Digit" + key;
    else base = "Char:" + key;
  } else if (key && !MODIFIER_CODE_RE.test(key) && !DEAD_KEY_CODE_RE.test(key)) {
    base = NAMED_KEY_ALIASES[key] || key;
  }
  if (!base) return null;
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.metaKey) parts.push("Meta");
  parts.push(base);
  return parts.join("+");
}
