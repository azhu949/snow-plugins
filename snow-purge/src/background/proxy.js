// 请求代理脚本的托管段：只动本插件标记块内的内容，段外内容原样保留。
// 三条底线：写前快照、越界改动让位、撤回时还原。
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  LIMITS,
  PROXY_BEGIN,
  PROXY_END,
  PROVIDER_IDS,
  defuseManagedMarker,
  findMarkerLines,
  joinOutsideManagedSection,
} from "../shared/contract.js";
import { PurgeError } from "./errors.js";

const HEADER = [
  "// 对话请求代理脚本（Snow App 主进程加载）。",
  "// 保存后在下一次请求或响应事件到达时自动重新加载，无需重启应用。",
  "// 本文件由你与本插件的托管段共同组成：托管段之外的内容不会被修改。",
].join("\n");

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** 正则字面量可以出现在这些字符之后（运算符、分隔符与表达式起始处）。 */
const REGEX_PREFIX_CHARS = "(,=:[!&|?{};+-*%^~<>";
/** 关键字之后的 `/` 是正则起点，不是除号。 */
const REGEX_PREFIX_WORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/** 按前一个有效字符/关键字区分「正则字面量起点」与「除号」。 */
const startsRegexLiteral = (source, index) => {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(source[cursor])) cursor -= 1;
  if (cursor < 0) return true;
  const previous = source[cursor];
  if (REGEX_PREFIX_CHARS.includes(previous)) return true;
  if (!/[A-Za-z0-9_$]/.test(previous)) return false;
  let start = cursor;
  while (start >= 0 && /[A-Za-z0-9_$]/.test(source[start])) start -= 1;
  return REGEX_PREFIX_WORDS.has(source.slice(start + 1, cursor + 1));
};

/**
 * 非代码区域（字符串、模板字符串、注释、正则字面量）替换成等长空白，保留换行。
 * 之后再跑声明正则与花括号深度扫描，正文里的 "const x = 1" 不会被当成模块级声明。
 * issues 记录无法确定边界的片段：调用方据此判定「模块级收集不可信」，写入前保守拒绝。
 */
const maskNonCode = (text, issues = []) => {
  const source = String(text ?? "");
  const chars = source.split("");
  const blank = (start, end) => {
    for (let index = start; index < end; index += 1) {
      if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
    }
  };
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (current === "/" && next === "/") {
      const lineEnd = source.indexOf("\n", index);
      const stop = lineEnd < 0 ? source.length : lineEnd;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (current === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      if (close < 0) {
        // 未闭合的块注释：不猜边界，交给可靠性判定；否则会把后面整份代码当成注释。
        issues.push({ offset: index, kind: "comment-unterminated" });
        break;
      }
      const stop = close + 2;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (current === '"' || current === "'" || current === "`") {
      const quote = current;
      let cursor = index + 1;
      let closed = false;
      while (cursor < source.length) {
        if (source[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (source[cursor] === quote) {
          cursor += 1;
          closed = true;
          break;
        }
        // 单双引号字符串不允许裸换行：到行尾视为未闭合，避免把后面整份代码都当成字符串。
        if (quote !== "`" && (source[cursor] === "\n" || source[cursor] === "\r")) break;
        cursor += 1;
      }
      blank(index + 1, Math.max(index + 1, cursor - 1));
      if (!closed) {
        issues.push({ offset: index, kind: quote === "`" ? "template-unterminated" : "string-unterminated" });
      }
      index = cursor;
      continue;
    }
    if (current === "/" && startsRegexLiteral(source, index)) {
      // 正则体：\ 转义、[ 字符类 ]、字符类内的 / 都不结束；闭合后再吃掉 flags。
      let cursor = index + 1;
      let inClass = false;
      let closed = false;
      while (cursor < source.length) {
        const char = source[cursor];
        if (char === "\\") {
          cursor += 2;
          continue;
        }
        if (char === "\n" || char === "\r") break;
        if (char === "[") inClass = true;
        else if (char === "]") inClass = false;
        else if (char === "/" && !inClass) {
          cursor += 1;
          closed = true;
          break;
        }
        cursor += 1;
      }
      if (!closed) {
        // 未闭合的正则（多半是除号被误判成正则）：不掩码、不吞行，只标记不可信。
        issues.push({ offset: index, kind: "regex-unterminated" });
        index += 1;
        continue;
      }
      while (cursor < source.length && /[a-z]/i.test(source[cursor])) cursor += 1;
      blank(index, cursor);
      index = cursor;
      continue;
    }
    index += 1;
  }
  return chars.join("");
};

/** 每个字符处的花括号深度：只有深度 0 的声明才属于模块作用域。 */
const braceDepthOf = (masked) => {
  const depths = new Uint32Array(masked.length + 1);
  let depth = 0;
  for (let index = 0; index < masked.length; index += 1) {
    depths[index] = depth;
    if (masked[index] === "{") depth += 1;
    else if (masked[index] === "}") depth = Math.max(0, depth - 1);
  }
  depths[masked.length] = depth;
  return depths;
};

/**
 * 模块级绑定与导出名的收集口径：
 * - 只认花括号深度 0 的 import / 声明 / export，函数体与块内的同名声明不参与冲突判定；
 * - 字符串、模板字符串与注释先置空，正文里出现的声明字样不会被误报；
 * - export { onRequest } / export { x as onRequest } from ... 这类重复导出单独收集，
 *   重复具名导出同样会让整份脚本编译失败；export default 只会被宿主忽略，不算冲突。
 */
const IMPORT_STATEMENT = /^[ \t]*import\s+([^;]+?)\s+from\s+["'][^"']+["'];?/gm;
const TOP_LEVEL_DECLARATION =
  /^[ \t]*(?:export\s+)?(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/gm;
const TOP_LEVEL_DESTRUCTURE = /^[ \t]*(?:export\s+)?(?:const|let|var)\s*(\{[^}]*\}|\[[^\]]*\])/gm;
const EXPORT_DEFAULT_NAME = /^[ \t]*export\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^[ \t]*export\s*\{([^}]*)\}/gm;

/** 解构模式里的绑定名：跳过键名与默认值表达式，收集真正声明出来的标识符。 */
const collectPatternNames = (pattern, names) => {
  const text = String(pattern ?? "").trim();
  const body = text.startsWith("{") || text.startsWith("[") ? text.slice(1, -1) : text;
  let segment = "";
  let depth = 0;
  const flush = () => {
    const part = segment.trim();
    segment = "";
    if (!part) return;
    const withoutDefault = part.split("=")[0].trim();
    const rest = withoutDefault.replace(/^\.\.\./, "").trim();
    // 对象解构的 key: value 只取 value 侧；数组与展开项直接取标识符。
    const valueSide = rest.includes(":") ? rest.split(":").slice(1).join(":").trim() : rest;
    const name = valueSide.match(/^([A-Za-z_$][\w$]*)$/);
    if (name) names.add(name[1]);
  };
  for (const char of body) {
    if (char === "{" || char === "[" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      flush();
      continue;
    }
    segment += char;
  }
  flush();
};

const collectModuleInfo = (text) => {
  const issues = [];
  const masked = maskNonCode(text, issues);
  const depths = braceDepthOf(masked);
  const atModuleLevel = (index) => (depths[index] || 0) === 0;
  const bindings = new Set();
  const exports = new Set();
  for (const match of masked.matchAll(IMPORT_STATEMENT)) {
    if (!atModuleLevel(match.index)) continue;
    const clause = match[1].trim();
    const defaultName = clause.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (defaultName) bindings.add(defaultName[1]);
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) {
      for (const part of braced[1].split(",")) {
        const item = part.trim();
        if (!item) continue;
        const alias = item.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
        if (alias) {
          bindings.add(alias[1]);
          continue;
        }
        const direct = item.match(/^([A-Za-z_$][\w$]*)$/);
        if (direct) bindings.add(direct[1]);
      }
    }
    const star = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (star) bindings.add(star[1]);
  }
  for (const match of masked.matchAll(TOP_LEVEL_DECLARATION)) {
    if (!atModuleLevel(match.index)) continue;
    bindings.add(match[1]);
    // export function / export const 同时是具名导出：重复导出检测必须看到它。
    if (/^\s*export\b/.test(match[0])) exports.add(match[1]);
  }
  for (const match of masked.matchAll(TOP_LEVEL_DESTRUCTURE)) {
    if (!atModuleLevel(match.index)) continue;
    const declared = new Set();
    collectPatternNames(match[1], declared);
    const exported = /^\s*export\b/.test(match[0]);
    for (const name of declared) {
      bindings.add(name);
      if (exported) exports.add(name);
    }
  }
  for (const match of masked.matchAll(EXPORT_DEFAULT_NAME)) {
    if (atModuleLevel(match.index)) bindings.add(match[1]);
  }
  for (const match of masked.matchAll(EXPORT_LIST)) {
    if (!atModuleLevel(match.index)) continue;
    const rest = masked.slice(match.index + match[0].length);
    const reexported = /^\s*from\b/.test(rest);
    for (const part of match[1].split(",")) {
      const item = part.trim();
      if (!item) continue;
      const alias = item.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      const exported = alias ? alias[1] : item.match(/^([A-Za-z_$][\w$]*)$/)?.[1];
      if (!exported) continue;
      exports.add(exported);
      // 没有 from 的 export 列表引用本地绑定；有 from 的只产生导出名，不产生本地绑定。
      if (!reexported) bindings.add(exported);
    }
  }
  // 掩码后花括号必须回到 0：否则说明有片段没被正确识别（正则、嵌套模板等），
  // 这一份文本的「模块级」结论不可信，写入前要保守拒绝而不是放行。
  if ((depths[masked.length] || 0) !== 0) issues.push({ offset: 0, kind: "brace-unbalanced" });
  return { bindings, exports, reliable: issues.length === 0, issues };
};

/**
 * 同目录内的唯一临时名：并发写不能共用同一个临时文件，否则后写的那个会把前一个刚写好的内容
 * rename 成正式文件（内容与返回值对不上），先 rename 的一方还会拿到 ENOENT。
 */
const tempPathFor = (filePath) =>
  `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.snow-purge.tmp`;

/** 原子写：先写同目录临时文件再 rename，写到一半失败也不会破坏宿主正在加载的脚本。 */
const writeProxyText = async (filePath, text) => {
  await mkdir(dirname(filePath), { recursive: true });
  const temp = tempPathFor(filePath);
  try {
    await writeFile(temp, text, "utf8");
    await rename(temp, filePath);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
};

/** 段外内容的比较口径：只忽略首尾空白与行尾风格差异，业务内容必须逐字一致。 */
export const normalizeOutside = (text) =>
  String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();

/** 生成托管段；directive / 开关都内联成字面量，改配置后需要重新应用。 */
export function composeBlock({ directive, boost, providers, probeLogPath }) {
  const enabled = PROVIDER_IDS.filter((id) => providers?.[id] !== false);
  // 正文里出现标记字面量会破坏段边界，内联前先拆开连续尖括号。
  const text = defuseManagedMarker(directive, [PROXY_BEGIN, PROXY_END]);
  const lines = [
    PROXY_BEGIN,
    "// 本段由 snow-purge 维护：重新应用会覆盖段内内容，请在插件面板里修改。",
    'import { appendFile as __purgeAppendFile, mkdir as __purgeMkdir, stat as __purgeStat } from "node:fs/promises";',
    'import { dirname as __purgeDirname } from "node:path";',
    "",
    `const DIRECTIVE = ${JSON.stringify(text)};`,
    `const TAIL = ${boost ? `DIRECTIVE` : "null"};`,
    `const PROVIDERS = ${JSON.stringify(enabled)};`,
    `const PROBE_LOG = ${JSON.stringify(probeLogPath)};`,
    `const PROBE_MAX_BYTES = ${LIMITS.probeMaxBytes};`,
    "const PROBE_SAMPLE_EVERY = 20;",
    "",
    "let __purgeProbeSeq = 0;",
    "let __purgeProbeBytes = -1;",
    "let __purgeProbeStopped = false;",
    "let __purgeProbeWarned = false;",
    "let __purgeProbeQueue = Promise.resolve();",
    "",
    "const __purgeProbeWarn = (message) => {",
    "  if (__purgeProbeWarned) return;",
    "  __purgeProbeWarned = true;",
    "  console.warn(`[snow-purge] ${message}（注入本身不受影响）`);",
    "};",
    "",
    "// 异步串行队列：探针只用于自检，写盘不能阻塞宿主主进程的对话请求。",
    "const __purgeProbeWrite = (line) => {",
    "  __purgeProbeQueue = __purgeProbeQueue.then(async () => {",
    "    if (__purgeProbeStopped) return;",
    "    if (__purgeProbeBytes < 0) {",
    "      try {",
    "        __purgeProbeBytes = (await __purgeStat(PROBE_LOG)).size;",
    "      } catch {",
    "        __purgeProbeBytes = 0;",
    "      }",
    "    }",
    "    const size = Buffer.byteLength(line, \"utf8\");",
    "    if (__purgeProbeBytes + size > PROBE_MAX_BYTES) {",
    "      // 超过上限只告警一次并停止写入：不再整份读取日志再覆盖。",
    "      __purgeProbeStopped = true;",
    "      __purgeProbeWarn(\"探针日志已达上限，后续注入不再记录\");",
    "      return;",
    "    }",
    "    try {",
    "      await __purgeAppendFile(PROBE_LOG, line, \"utf8\");",
    "    } catch {",
    "      // 目录缺失是首次写入最常见的情况：补建一次再重试。",
    "      try {",
    "        await __purgeMkdir(__purgeDirname(PROBE_LOG), { recursive: true });",
    "        await __purgeAppendFile(PROBE_LOG, line, \"utf8\");",
    "      } catch (error) {",
    "        __purgeProbeWarn(`探针写入失败：${error?.message || error}`);",
    "        return;",
    "      }",
    "    }",
    "    __purgeProbeBytes += size;",
    "  }).catch(() => {});",
    "};",
    "",
    "const probe = (provider, context, mode) => {",
    "  __purgeProbeSeq += 1;",
    "  // 首次必记（自检要看注入是否生效），之后按抽样间隔记录，避免每个请求都写盘。",
    "  if (__purgeProbeSeq !== 1 && __purgeProbeSeq % PROBE_SAMPLE_EVERY !== 0) return;",
    "  __purgeProbeWrite(`${JSON.stringify({ at: Date.now(), provider, conversationId: context?.conversationId ?? null, streamId: context?.streamId ?? \"\", mode })}\\n`);",
    "};",
    "",
    "const appendText = (value, extra) => (typeof value === \"string\" && value ? `${value}\\n\\n${extra}` : extra);",
    "",
    "// 形状自适应：数组形态的 content 追加一个 text 片段，不能整段替换掉宿主原有内容。",
    "const pushText = (content, extra) => {",
    "  if (Array.isArray(content)) return [...content, { type: \"text\", text: extra }];",
    "  if (typeof content === \"string\" && content) return `${content}\\n\\n${extra}`;",
    "  return extra;",
    "};",
    "",
    "const injectChat = (body, text) => {",
    "  const messages = Array.isArray(body?.messages) ? [...body.messages] : null;",
    "  if (!messages || messages.length === 0) return undefined;",
    "  const first = messages[0];",
    "  if (first?.role === \"system\") {",
    "    messages[0] = { ...first, content: pushText(first.content, text) };",
    "  } else {",
    "    messages.unshift({ role: \"system\", content: text });",
    "  }",
    "  return { ...body, messages };",
    "};",
    "",
    "const injectResponses = (body, text) => {",
    "  const instructions = typeof body?.instructions === \"string\" ? body.instructions : \"\";",
    "  return { ...body, instructions: appendText(instructions, text) };",
    "};",
    "",
    "const injectAnthropic = (body, text) => {",
    "  const system = body?.system;",
    "  if (Array.isArray(system)) {",
    "    return { ...body, system: [...system, { type: \"text\", text }] };",
    "  }",
    "  return { ...body, system: appendText(typeof system === \"string\" ? system : \"\", text) };",
    "};",
    "",
    "const injectGemini = (body, text) => {",
    "  const current = body?.systemInstruction;",
    "  if (typeof current === \"string\") {",
    "    return { ...body, systemInstruction: { parts: current ? [{ text: current }, { text }] : [{ text }] } };",
    "  }",
    "  // 数组不是 Content 形状，展开会生成数字键：只接受普通对象。",
    "  const base = current && typeof current === \"object\" && !Array.isArray(current) ? current : {};",
    "  const parts = Array.isArray(base.parts) ? [...base.parts] : [];",
    "  parts.push({ text });",
    "  return { ...body, systemInstruction: { ...base, parts } };",
    "};",
    "",
    "const injectSystem = (body, provider, text) => {",
    "  if (provider === \"chat\") return injectChat(body, text);",
    "  if (provider === \"responses\") return injectResponses(body, text);",
    "  if (provider === \"anthropic\") return injectAnthropic(body, text);",
    "  if (provider === \"gemini\") return injectGemini(body, text);",
    "  return undefined;",
    "};",
    "",
    "const injectTailMessages = (body, text) => {",
    "  const messages = Array.isArray(body?.messages) ? [...body.messages] : null;",
    "  if (!messages || messages.length === 0) return undefined;",
    "  for (let index = messages.length - 1; index >= 0; index -= 1) {",
    "    const message = messages[index];",
    "    if (message?.role !== \"user\") continue;",
    "    if (typeof message.content === \"string\") {",
    "      messages[index] = { ...message, content: appendText(message.content, text) };",
    "      return { ...body, messages };",
    "    }",
    "    if (Array.isArray(message.content)) {",
    "      messages[index] = { ...message, content: [...message.content, { type: \"text\", text }] };",
    "      return { ...body, messages };",
    "    }",
    "  }",
    "  return undefined;",
    "};",
    "",
    "const injectTailResponses = (body, text) => {",
    "  const input = body?.input;",
    "  if (typeof input === \"string\") return { ...body, input: appendText(input, text) };",
    "  if (!Array.isArray(input)) return undefined;",
    "  return { ...body, input: [...input, { role: \"user\", content: [{ type: \"input_text\", text }] }] };",
    "};",
    "",
    "const injectTailGemini = (body, text) => {",
    "  const contents = Array.isArray(body?.contents) ? [...body.contents] : null;",
    "  if (!contents || contents.length === 0) return undefined;",
    "  for (let index = contents.length - 1; index >= 0; index -= 1) {",
    "    const item = contents[index];",
    "    if (item?.role && item.role !== \"user\") continue;",
    "    const parts = Array.isArray(item?.parts) ? [...item.parts] : [];",
    "    parts.push({ text });",
    "    contents[index] = { ...item, parts };",
    "    return { ...body, contents };",
    "  }",
    "  return undefined;",
    "};",
    "",
    "const injectTail = (body, provider, text) => {",
    "  if (provider === \"chat\" || provider === \"anthropic\") return injectTailMessages(body, text);",
    "  if (provider === \"responses\") return injectTailResponses(body, text);",
    "  if (provider === \"gemini\") return injectTailGemini(body, text);",
    "  return undefined;",
    "};",
    "",
    "export function onRequest({ body, context }) {",
    "  try {",
    "    if (!body || typeof body !== \"object\") return undefined;",
    "    const provider = String(context?.provider || \"\");",
    "    if (!PROVIDERS.includes(provider)) return undefined;",
    "    let next = injectSystem(body, provider, DIRECTIVE);",
    "    const mode = [\"system\"];",
    "    if (next && TAIL) {",
    "      const tailed = injectTail(next, provider, TAIL);",
    "      if (tailed) {",
    "        next = tailed;",
    "        mode.push(\"tail\");",
    "      }",
    "    }",
    "    if (!next) return undefined;",
    "    probe(provider, context, mode.join(\"+\"));",
    "    return next;",
    "  } catch {",
    "    // 任何异常都放行原请求：代理层不能把对话弄坏。",
    "    return undefined;",
    "  }",
    "}",
    PROXY_END,
  ];
  return lines.join("\n");
}

/**
 * 插件托管段的模板：正文里除 4 行动态赋值外逐字固定，用来识别「标记被删掉一半」的残骸。
 * 只做行级连续对齐，不猜花括号或字符串，误切的概率最低。
 */
let managedTemplateCache = null;
const managedTemplateLines = () => {
  if (!managedTemplateCache) {
    managedTemplateCache = composeBlock({
      directive: "",
      boost: true,
      providers: {},
      probeLogPath: "",
    }).split("\n");
  }
  return managedTemplateCache;
};

const TEMPLATE_DYNAMIC = /^const (?:DIRECTIVE|TAIL|PROVIDERS|PROBE_LOG) = /;

const lineMatchesTemplate = (line, templateLine) => {
  const left = String(line).trimEnd();
  const right = String(templateLine).trimEnd();
  if (left === right) return true;
  const dynamic = TEMPLATE_DYNAMIC.exec(right);
  return Boolean(dynamic) && left.startsWith(dynamic[0]);
};

/** 按行切分并记录每行在原文里的区间：清理残骸要按行边界切，不能按字符猜。 */
const splitLines = (text) => {
  const lines = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text[index] === "\n") {
      lines.push({ start, end: index, text: text.slice(start, index) });
      start = index + 1;
    }
  }
  return lines;
};

const lineIndexOf = (lines, offset) => {
  for (let index = 0; index < lines.length; index += 1) {
    if (offset >= lines[index].start && offset <= lines[index].end) return index;
  }
  return -1;
};

/** 向下对齐：孤立开始标记之后必须逐行等于模板正文，少一行都不认定。 */
const matchTemplateForward = (lines, beginLine) => {
  const template = managedTemplateLines();
  const bodyLines = template.length - 2;
  let matched = 0;
  for (let index = 1; index <= bodyLines; index += 1) {
    const line = lines[beginLine + matched + 1];
    if (!line || !lineMatchesTemplate(line.text, template[index])) return matched;
    matched += 1;
  }
  return matched;
};

/** 向上对齐：孤立结束标记之前必须逐行等于模板正文。 */
const matchTemplateBackward = (lines, endLine) => {
  const template = managedTemplateLines();
  const bodyLines = template.length - 2;
  let matched = 0;
  for (let index = bodyLines; index >= 1; index -= 1) {
    const line = lines[endLine - matched - 1];
    if (!line || !lineMatchesTemplate(line.text, template[index])) return matched;
    matched += 1;
  }
  return matched;
};

/**
 * 定位残骸区间：只有「孤立标记 + 与模板完整对齐」才认定，对不齐的一律不切割，
 * 只作为孤立标记提示，避免误删用户自己写的代码。
 */
const findManagedResidues = (source, orphanBegins, orphanEnds) => {
  const lines = splitLines(source);
  const template = managedTemplateLines();
  const bodyLines = template.length - 2;
  const blocks = [];
  for (const offset of orphanBegins) {
    const lineIndex = lineIndexOf(lines, offset);
    if (lineIndex < 0) continue;
    const matched = matchTemplateForward(lines, lineIndex);
    if (matched < bodyLines) continue;
    blocks.push({ start: offset, end: lines[lineIndex + matched].end, kind: "begin" });
  }
  for (const offset of orphanEnds) {
    const lineIndex = lineIndexOf(lines, offset);
    if (lineIndex < 0) continue;
    const matched = matchTemplateBackward(lines, lineIndex);
    if (matched < bodyLines) continue;
    blocks.push({ start: lines[lineIndex - matched].start, end: offset + PROXY_END.length, kind: "end" });
  }
  blocks.sort((left, right) => left.start - right.start);
  const merged = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (last && block.start <= last.end) {
      last.end = Math.max(last.end, block.end);
      continue;
    }
    merged.push({ ...block });
  }
  return merged;
};

/** 按区间删除文本：区间互不重叠，内部按起点从后往前删，前面的坐标不受影响。 */
const stripRanges = (source, ranges) => {
  const ordered = [...ranges].sort((left, right) => right.start - left.start);
  let next = source;
  for (const { start, end } of ordered) {
    next = `${next.slice(0, start)}${next.slice(end)}`;
  }
  return next;
};

/**
 * 托管段配对：每个结束标记配它前面最近的、尚未被上一段占用的开始标记。
 * 手工复制或旧版本残留可能留下多段：只认第一段会让残留段继续注入，
 * 甚至把残留段里的 export onRequest 误判成段外钩子。
 */
const findProxySections = (source) => {
  const begins = findMarkerLines(source, PROXY_BEGIN);
  const ends = findMarkerLines(source, PROXY_END);
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
    sections.push({ begin: start, end: end + PROXY_END.length });
    cursor = end + PROXY_END.length;
  }
  return sections;
};

/**
 * 一次扫描的完整结论：配对段、孤立标记与可清理的残骸区间。
 * 三处（分析、清理、还原）共用同一口径，避免识别与清理判断不一致。
 */
const inspectProxyText = (source) => {
  const begins = findMarkerLines(source, PROXY_BEGIN);
  const ends = findMarkerLines(source, PROXY_END);
  const sections = findProxySections(source);
  const usedBegins = new Set(sections.map((section) => section.begin));
  const usedEnds = new Set(sections.map((section) => section.end - PROXY_END.length));
  const orphanBegins = begins.filter((offset) => !usedBegins.has(offset));
  const orphanEnds = ends.filter((offset) => !usedEnds.has(offset));
  return {
    sections,
    orphanBegins,
    orphanEnds,
    residueBlocks: findManagedResidues(source, orphanBegins, orphanEnds),
  };
};

/** 只清掉可认定的插件残骸：孤立标记与模板对不齐时原样保留，交给用户处理。 */
export const stripManagedResidues = (text) => {
  const source = String(text ?? "");
  const { residueBlocks } = inspectProxyText(source);
  return stripRanges(source, residueBlocks);
};

/**
 * 分析当前文件：是否有托管段、段哈希、段外是否已有 onRequest 导出、是否有插件残骸。
 * candidateBlock 用于写前校验：传了就用「即将写入的段」参与绑定与导出比对；
 * 不传（概览、自检）时沿用文件里已有的段，语义与改动前一致。
 */
export const analyzeProxyText = (text, candidateBlock = "") => {
  const source = String(text ?? "");
  // 起止标记都必须独占一行：正文里内联出现的标记不能当成段边界。
  const { sections, orphanBegins, orphanEnds, residueBlocks } = inspectProxyText(source);
  const first = sections[0] || null;
  const hasBlock = Boolean(first);
  const block = first ? source.slice(first.begin, first.end) : "";
  // 段外内容 = 原文去掉全部配对段；残骸另算，避免把插件自己的旧正文当成用户代码。
  const stripped = stripRanges(source, sections.map((section) => ({ start: section.begin, end: section.end })));
  const outsideText = stripRanges(source, [
    ...sections.map((section) => ({ start: section.begin, end: section.end })),
    ...residueBlocks,
  ]);
  const activeBlock = candidateBlock ? String(candidateBlock) : block;
  const blockInfo = collectModuleInfo(activeBlock);
  const outsideInfo = collectModuleInfo(outsideText);
  // 重复的具名导出同样会让整份脚本编译失败；export default 只会被宿主忽略，不算冲突。
  const duplicateExports = [...blockInfo.exports].filter((name) => outsideInfo.exports.has(name)).sort();
  const hasForeignHook =
    outsideInfo.exports.has("onRequest") ||
    /export\s+(?:async\s+)?function\s+onRequest\b/.test(outsideText) ||
    /export\s+(?:const|let|var)\s+onRequest\b/.test(outsideText);
  // 段外若已声明同名模块级绑定，追加托管段会让整份脚本因重复声明而加载失败（宿主按 fail-open 放行全部请求）。
  const bindingConflicts = [...blockInfo.bindings].filter((name) => outsideInfo.bindings.has(name)).sort();
  const lineIn = (value, offset) => String(value || "").slice(0, Math.max(0, offset)).split("\n").length;
  const analysisIssues = [
    ...blockInfo.issues.map((issue) => ({ where: "block", kind: issue.kind, line: lineIn(activeBlock, issue.offset) })),
    ...outsideInfo.issues.map((issue) => ({
      where: "outside",
      kind: issue.kind,
      line: lineIn(outsideText, issue.offset),
    })),
  ];
  return {
    hasBlock,
    begin: hasBlock ? first.begin : -1,
    end: hasBlock ? first.end : -1,
    blockHash: hasBlock ? sha256(block) : "",
    segmentCount: sections.length,
    segments: sections,
    orphanBegins: orphanBegins.length,
    orphanEnds: orphanEnds.length,
    residueCount: residueBlocks.length,
    hasManagedResidue: residueBlocks.length > 0,
    hasForeignHook,
    bindingConflicts,
    duplicateExports,
    // 静态分析是否可信：不可信时 bindingConflicts / duplicateExports 可能漏检（也可能误报）。
    analysisReliable: blockInfo.reliable && outsideInfo.reliable,
    analysisIssues,
    stripped,
    outsideText,
    bytes: Buffer.byteLength(source, "utf8"),
    lines: source ? source.split("\n").length : 0,
  };
};

/**
 * 对外投影：面板只展示判定结果与计数，不接收脚本正文。
 * 应用、还原与自检继续使用 analyzeProxyText 的完整返回。
 */
export const toProxyAnalysisView = (analysis) => ({
  hasBlock: Boolean(analysis?.hasBlock),
  blockHash: String(analysis?.blockHash || ""),
  segmentCount: Number(analysis?.segmentCount) || 0,
  orphanBegins: Number(analysis?.orphanBegins) || 0,
  orphanEnds: Number(analysis?.orphanEnds) || 0,
  residueCount: Number(analysis?.residueCount) || 0,
  hasManagedResidue: Boolean(analysis?.hasManagedResidue),
  hasForeignHook: Boolean(analysis?.hasForeignHook),
  bindingConflicts: Array.isArray(analysis?.bindingConflicts) ? [...analysis.bindingConflicts] : [],
  duplicateExports: Array.isArray(analysis?.duplicateExports) ? [...analysis.duplicateExports] : [],
  // 默认 true：旧调用方不传该字段时保持「未发现异常」的展示口径。
  analysisReliable: analysis?.analysisReliable !== false,
  analysisIssues: Array.isArray(analysis?.analysisIssues)
    ? analysis.analysisIssues.map((issue) => ({
        where: issue?.where === "block" ? "block" : "outside",
        kind: String(issue?.kind || ""),
        line: Number(issue?.line) || 0,
      }))
    : [],
  bytes: Number(analysis?.bytes) || 0,
  lines: Number(analysis?.lines) || 0,
});

export const readProxyFile = async (filePath) => {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};

/**
 * 应用托管段：
 * - 文件不存在：新建（含说明头）。
 * - 有托管段：只替换段内内容；若段被外部改过且不是我们写的哈希，默认让位（除非 force）。
 * - 无托管段：追加到文件末尾；段外已有 onRequest 导出时拒绝（会与我们的导出冲突）。
 * - 有插件残骸（标记被删掉一半）：默认拒绝并说明两条修复入口；force 时先清理残骸再写入。
 */
export async function applyProxyBlock({
  filePath,
  block,
  appliedHash = "",
  force = false,
}) {
  const current = await readProxyFile(filePath);
  // 用「即将写入的段」参与绑定与导出比对：首次写入时文件里还没有托管段，
  // 只按旧段比对会漏掉真正会让脚本加载失败的同名顶层声明。
  let analysis = analyzeProxyText(current ?? "", block);
  const newHash = sha256(block);
  let base = current;
  let cleanedResidues = 0;

  // 残骸里的旧托管段仍在被宿主加载：不清理就写入会变成重复声明或双导出，因此先处理它。
  if (analysis.residueCount > 0) {
    if (!force) {
      throw new PurgeError(
        "PROXY_MANAGED_RESIDUE",
        "代理脚本里有一处没配对的插件标记（多半是手工删掉了结尾那行），后面残留的是插件旧托管段的正文：它现在仍会被宿主加载并注入。勾选「强制覆盖」后再保存会清理残骸并写入新段；只想清除残骸就点「还原脚本」。"
      );
    }
    base = stripManagedResidues(current ?? "");
    cleanedResidues = analysis.residueCount;
    analysis = analyzeProxyText(base ?? "", block);
  }

  if (analysis.hasForeignHook || analysis.duplicateExports.length > 0) {
    const detail = analysis.duplicateExports.length
      ? `段外已有同名导出 ${analysis.duplicateExports.join("、")}`
      : "段外已有你自己写的 onRequest 导出";
    throw new PurgeError(
      "PROXY_FOREIGN_HOOK",
      `代理脚本${detail}（不在插件托管段内）：再加一段会出现重复导出，脚本会整体加载失败。请先把它合并进面板指令，或改用手动维护。`
    );
  }
  if (analysis.bindingConflicts.length > 0 && !force) {
    throw new PurgeError(
      "PROXY_BINDING_CONFLICT",
      `代理脚本段外（模块顶层）已声明 ${analysis.bindingConflicts.join("、")}，与托管段内的同名绑定冲突：模块级重复声明会让整份脚本加载失败，宿主会静默放行全部请求。请先把段外这些名字改名，或改用手动维护；确认要由插件写入时再勾选「强制覆盖」。`
    );
  }
  // 分析不可信时上面两个冲突检查都可能漏检：宁可不写，也不能让宿主加载失败后静默放行全部请求。
  if (!analysis.analysisReliable && !force) {
    const outside = analysis.analysisIssues.filter((issue) => issue.where !== "block");
    const place = outside.length > 0 ? outside : analysis.analysisIssues;
    const lines = [...new Set(place.map((issue) => issue.line).filter((line) => line > 0))].slice(0, 5).join("、");
    throw new PurgeError(
      "PROXY_ANALYSIS_UNVERIFIED",
      `代理脚本里有插件无法静态判定的片段${lines ? `（第 ${lines} 行附近）` : ""}：可能是没闭合的正则、字符串、模板或注释。插件既不能确认段外是否存在与托管段同名的顶层绑定，也不能确认写入后整份脚本仍可加载；宿主加载失败会静默放行全部请求（注入等于没生效）。请先在编辑器里核对该段语法，确认无误后勾选「强制覆盖」再保存。`
    );
  }
  const sections = analysis.segments;
  const multiple = sections.length > 1;
  if (multiple && !force) {
    throw new PurgeError(
      "PROXY_FOREIGN_EDIT",
      `代理脚本里有 ${sections.length} 个托管段（多为手工复制或旧版本残留）：重复段会让脚本加载失败。请先点「还原脚本」清理；确认由插件保留一段并删除其余 ${sections.length - 1} 段时，再勾选「强制覆盖」后保存。`
    );
  }
  if (!multiple && analysis.hasBlock && appliedHash && analysis.blockHash !== appliedHash && !force) {
    throw new PurgeError(
      "PROXY_FOREIGN_EDIT",
      "托管段在应用之后被改过，插件不会覆盖你的改动。确认要用当前面板内容覆盖时，再勾选「强制覆盖」。"
    );
  }

  let next;
  let cleaned = 0;
  if (current === null) {
    next = `${HEADER}\n\n${block}\n`;
  } else if (multiple) {
    // 先删除第 2..n 段，再原位替换第一段：段外内容逐字保留，前面的坐标不受删除影响。
    let trimmed = base;
    for (let index = sections.length - 1; index >= 1; index -= 1) {
      trimmed = `${trimmed.slice(0, sections[index].begin)}${trimmed.slice(sections[index].end)}`;
    }
    next = `${trimmed.slice(0, sections[0].begin)}${block}${trimmed.slice(sections[0].end)}`;
    cleaned = sections.length - 1;
  } else if (analysis.hasBlock) {
    next = `${base.slice(0, analysis.begin)}${block}${base.slice(analysis.end)}`;
  } else {
    const tail = base.endsWith("\n") ? base : `${base}\n`;
    next = `${tail}\n${block}\n`;
  }

  await writeProxyText(filePath, next);

  return {
    path: filePath,
    created: current === null,
    replaced: analysis.hasBlock,
    cleaned,
    cleanedResidues,
    hash: newHash,
    bytes: Buffer.byteLength(next, "utf8"),
  };
}

/**
 * 撤回：有原始快照就还原原文件（文件已被删除时按快照重建）；没有就只剥掉托管段与残骸。
 * 有快照时先比较「当前文件去掉托管段与残骸」与快照，段外被手写过就不覆盖（除非 force）。
 */
export async function restoreProxyBlock({ filePath, original = null, force = false }) {
  const current = await readProxyFile(filePath);
  const restorable = typeof original === "string" && original !== "";
  if (current === null) {
    // 文件被用户删除：快照里存的是完整原文，直接重建；没有可写回的原文时保持「无内容可还原」。
    if (!restorable) {
      return { path: filePath, restored: false, removed: false, recreated: false, removedSegments: 0, removedResidues: 0 };
    }
    await writeProxyText(filePath, original);
    return { path: filePath, restored: true, removed: false, recreated: true, removedSegments: 0, removedResidues: 0 };
  }

  const removedResidues = analyzeProxyText(current).residueCount;
  if (typeof original === "string") {
    // 残骸属于插件自己的旧正文，不能算成「段外被手写」，否则只是删了结尾标记也会被拒绝。
    const outside = analyzeProxyText(stripManagedResidues(current)).stripped;
    if (!force && normalizeOutside(outside) !== normalizeOutside(original)) {
      throw new PurgeError(
        "PROXY_FOREIGN_EDIT",
        "托管段之外的内容与应用前快照不一致：还原会覆盖你在应用之后手写的部分，因此没有执行。确认要覆盖时，请在「请求代理」页勾选「强制覆盖」后点「还原脚本」。"
      );
    }
    await writeProxyText(filePath, original);
    return {
      path: filePath,
      restored: true,
      removed: false,
      recreated: false,
      removedSegments: 0,
      removedResidues,
    };
  }

  const cleanedText = stripManagedResidues(current);
  const analysis = analyzeProxyText(cleanedText);
  if (!analysis.hasBlock) {
    if (removedResidues === 0) {
      return { path: filePath, restored: false, removed: false, recreated: false, removedSegments: 0, removedResidues: 0 };
    }
    // 只有残骸、没有配对段：清理后按「移除插件写入内容」处理，只剩说明头时连文件一起删。
    if (!cleanedText || cleanedText === HEADER) {
      await rm(filePath, { force: true });
      return { path: filePath, restored: false, removed: true, recreated: false, removedSegments: 0, removedResidues };
    }
    await writeProxyText(filePath, `${cleanedText}\n`);
    return {
      path: filePath,
      restored: false,
      removed: false,
      recreated: false,
      removedSegments: 0,
      removedResidues,
    };
  }
  // 剥离全部托管段，只清理接缝两侧的空行：段外内容（含用户手写的连续空行）逐字保留。
  let next = cleanedText;
  for (let index = analysis.segments.length - 1; index >= 0; index -= 1) {
    const { begin, end } = analysis.segments[index];
    next = joinOutsideManagedSection(next.slice(0, begin), next.slice(end), current);
  }
  if (!next || next === HEADER) {
    await rm(filePath, { force: true });
    return {
      path: filePath,
      restored: false,
      removed: true,
      recreated: false,
      removedSegments: analysis.segmentCount,
      removedResidues,
    };
  }
  await writeProxyText(filePath, `${next}\n`);
  return {
    path: filePath,
    restored: false,
    removed: false,
    recreated: false,
    removedSegments: analysis.segmentCount,
    removedResidues,
  };
}

/** 读取探针记录：只读，不改写文件；历史长度由托管段的写入侧轮转封顶。 */
export async function readProbeLog(filePath, limit = 20) {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return { entries: [], truncated: false, bytes: 0 };
  }
  const lines = text.split("\n").filter((line) => line.trim());
  const size = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const entries = [];
  for (const line of lines.slice(-size).reverse()) {
    try {
      const item = JSON.parse(line);
      if (item && typeof item === "object") entries.push(item);
    } catch {
      // 手工写入的坏行直接跳过。
    }
  }
  // truncated 表示文件里还有更早的记录；历史丢弃由托管段的写入侧轮转负责，读取不再改写文件。
  return { entries, truncated: lines.length > size, bytes: Buffer.byteLength(text, "utf8") };
}

export const resolveProbeLogPath = (pluginDataDir) => join(pluginDataDir, "proxy-probe.log");
