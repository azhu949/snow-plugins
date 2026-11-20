// ANSI SGR 解析：把 `ESC[36m` 这类控制码转换成面板可渲染的颜色状态。
// 不依赖 React，方便单独校验；原始日志行仍保留 Docker 时间戳，供清屏过滤使用。
const ESCAPE_PATTERN =
  /\u001B(?:\[([0-9;]*)m|\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\u0007|\u001B\\)|[@-_])/g;

const DOCKER_TS_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z /;

export const DEFAULT_ANSI = Object.freeze({
  fg: 0,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
});

const fresh = () => ({ ...DEFAULT_ANSI });

const applyCodes = (state, source) => {
  const codes = String(source || "0")
    .split(";")
    .map((part) => (part === "" ? 0 : Number(part)));
  let next = state;
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (!Number.isFinite(code)) continue;
    if (code === 0) {
      next = fresh();
      continue;
    }
    if (next === state) next = { ...state };
    if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 39) next.fg = 0;
    else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) next.fg = code;
    else if (code === 38 || code === 48) {
      // 扩展色（38;5;n / 38;2;r;g;b）：吃掉参数，避免数字被当成正文。
      if (codes[index + 1] === 5) index += 2;
      else if (codes[index + 1] === 2) index += 4;
    }
  }
  return next;
};

/**
 * 解析一行日志：去掉 Docker 的 UTC 前缀，保留 ANSI 颜色状态并返回文本片段。
 * state 需要按行顺序传递，这样没有重置码的续行会沿用上一行的颜色。
 */
export function parseAnsiLine(raw, state = DEFAULT_ANSI) {
  const text = String(raw ?? "")
    .replace(DOCKER_TS_PREFIX, "")
    // 后台按长度截断可能切断转义序列，尾部残留的半个 CSI 丢弃，避免显示成 "[3"。
    .replace(/\u001B\[[0-9;]*$/, "");
  if (!text.includes("\u001B")) {
    return { text, segments: [{ text, state }], state };
  }
  let current = state;
  const segments = [];
  let last = 0;
  ESCAPE_PATTERN.lastIndex = 0;
  let match = ESCAPE_PATTERN.exec(text);
  while (match) {
    const chunk = text.slice(last, match.index).replace(/[\u001B\u009B]/g, "");
    if (chunk) segments.push({ text: chunk, state: current });
    if (match[1] !== undefined) current = applyCodes(current, match[1]);
    last = ESCAPE_PATTERN.lastIndex;
    match = ESCAPE_PATTERN.exec(text);
  }
  const tail = text.slice(last).replace(/[\u001B\u009B]/g, "");
  if (tail) segments.push({ text: tail, state: current });
  if (segments.length === 0) segments.push({ text: "", state: current });
  return { text, segments, state: current };
}

export function ansiClass(state) {
  const names = [];
  if (state.fg) names.push(`dk-ansi-fg-${state.fg}`);
  if (state.bold) names.push("dk-ansi-bold");
  if (state.dim) names.push("dk-ansi-dim");
  if (state.italic) names.push("dk-ansi-italic");
  if (state.underline) names.push("dk-ansi-underline");
  return names.join(" ");
}
