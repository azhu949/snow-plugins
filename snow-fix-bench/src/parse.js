// 结构化结果解析：从审查 / 修复会话的最终回复中提取 JSON 块。
import { ISSUE_STATUS, SEVERITY, ISSUE_SEVERITIES, DEFAULT_ISSUE_SEVERITIES } from "./constants.js";
import { escapeRegExp, normalizeText, truncate } from "./util.js";

function extractFence(text, tag) {
  const source = String(text || "");
  const pattern = new RegExp("```[ \\t]*" + escapeRegExp(tag) + "[^\\n]*\\n([\\s\\S]*?)```", "gi");
  let match = null;
  let last = null;
  while ((match = pattern.exec(source))) {
    last = match[1];
  }
  if (last === null) {
    // 输出被截断时没有闭合围栏：取标记之后的内容再尝试一次。
    const openPattern = new RegExp("```[ \\t]*" + escapeRegExp(tag) + "[^\\n]*\\n([\\s\\S]*)$", "i");
    const open = source.match(openPattern);
    if (open) last = open[1];
  }
  return last;
}

// JSON 容错修复：模型输出经常带一些「人类可读、解析器不接受」的成分——
// 尾逗号、注释、字符串里的裸换行、单引号键名、Python 字面量、全角结构标点，
// 以及被 max_tokens 截断导致括号不闭合。这里逐字符扫描修复，字符串内的正文保持原样，
// 避免把代码片段或路径改坏；修复只在原样解析失败后作为候选使用。
// 只映射全角「结构」字符：全角引号左右难区分，替换后会让字符串状态错乱，因此不做映射。
const STRUCTURE_CHARS = {
  "\uFF0C": ",",
  "\uFF1A": ":",
  "\uFF5B": "{",
  "\uFF5D": "}",
  "\uFF3B": "[",
  "\uFF3D": "]",
  "\u3000": " ",
};

const PY_LITERALS = { True: "true", False: "false", None: "null" };

// 字符串外逐字符重建：剥注释、统一引号、转义裸控制字符、映射全角结构标点。
// 返回值携带两个判定信息，供上层区分「规整」与「截断」：
// closedString 表示末尾原本处于字符串中（补引号才成立，内容已被切断）；
// unclosedComment 表示存在没有 */ 的块注释（边界不确定，不能继续做结构修复）。
function normalizeJsonBody(source) {
  const input = String(source || "");
  let out = "";
  let inString = false;
  let quote = '"';
  let escaped = false;
  let unclosedComment = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        out += char;
        continue;
      }
      if (char === "\\") {
        // 非法转义（\x、\' 等）在 JSON 里直接报错：改为字面反斜杠，保住正文。
        const next = input[index + 1] || "";
        if (!next || !/["\\/bfnrtu]/.test(next)) {
          out += "\\\\";
          continue;
        }
        escaped = true;
        out += char;
        continue;
      }
      if (char === quote) {
        out += '"';
        inString = false;
        continue;
      }
      if (quote === "'" && char === '"') {
        out += '\\"';
        continue;
      }
      if (char === "\n") {
        out += "\\n";
        continue;
      }
      if (char === "\r") {
        out += "\\r";
        continue;
      }
      if (char === "\t") {
        out += "\\t";
        continue;
      }
      if (char < " ") {
        out += `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
        continue;
      }
      out += char;
      continue;
    }
    // 注释不是 JSON 内容：模型常在数组里贴说明或注释掉的示例。
    if (char === "/" && input[index + 1] === "/") {
      while (index < input.length && input[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && input[index + 1] === "*") {
      const close = input.indexOf("*/", index + 2);
      if (close < 0) {
        // 没有 */ 的注释没有确定边界：保留 /* 原文交给 JSON.parse 显式报错，
        // 不能把注释之后的条目整段吞掉再当作解析成功。
        unclosedComment = true;
        out += char;
        continue;
      }
      index = close + 1;
      continue;
    }
    const mapped = STRUCTURE_CHARS[char];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    if (char === "'") {
      inString = true;
      quote = "'";
      out += '"';
      continue;
    }
    if (char === '"') {
      inString = true;
      quote = '"';
      out += char;
      continue;
    }
    out += char;
  }
  if (inString) {
    out += '"';
    return { text: out, closedString: true, unclosedComment };
  }
  return { text: out, closedString: false, unclosedComment };
}

// Python 风格字面量只替换字符串外的整词，正文里出现的 True / None 保持原样。
function replacePythonLiterals(source) {
  const input = String(source || "");
  let out = "";
  let inString = false;
  let escaped = false;
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = index;
      while (end < input.length && /[A-Za-z0-9_]/.test(input[end])) end += 1;
      const word = input.slice(index, end);
      out += Object.prototype.hasOwnProperty.call(PY_LITERALS, word) ? PY_LITERALS[word] : word;
      index = end;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

// 尾逗号：`[1, 2,]` / `{"a": 1,}` 都是模型高频产出，JSON.parse 一律拒绝。
function stripTrailingCommas(source) {
  const input = String(source || "");
  let out = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === ",") {
      let look = index + 1;
      while (look < input.length && /\s/.test(input[look])) look += 1;
      if (input[look] === "}" || input[look] === "]") continue;
    }
    out += char;
  }
  return out;
}

// 补齐被截断的输出：字符串未闭合先补引号，再按栈逆序补右括号。
// 补齐被截断的输出：字符串未闭合先补引号，再按栈逆序补右括号。
// tailComplete 表示原文停在元素级 `}` 上、且只缺最外层数组的 `]`：这时末元素完整，
// 补完可以按完整结论使用；其它补括号形态都可能吞掉半个元素，调用方一律按截断处理。
function closeJsonBrackets(source) {
  const input = String(source || "");
  let out = "";
  const stack = [];
  let inString = false;
  let escaped = false;
  let lastSignificant = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
    if ((char === "}" || char === "]") && stack[stack.length - 1] === char) stack.pop();
    if (!/\s/.test(char)) lastSignificant = char;
    out += char;
  }
  if (inString) out += '"';
  // 只认「栈里仅剩外层数组的 ]」且末个字符串外字符是 `}`：嵌套未闭合、括号错配、
  // 尾逗号后结束等形态都保持截断，避免把半个元素当成完整结论。
  const tailComplete = !inString && lastSignificant === "}" && stack.length === 1 && stack[0] === "]";
  while (stack.length) out += stack.pop();
  return { text: out, tailComplete };
}

// 截断恢复的裁断点：尾部若干个字符串外的闭合符，从后往前取。
// 一次扫描同时给出该裁断点待补的右括号串：裁剪后只需拼尾段，不必再对整串重跑
// stripTrailingCommas / closeJsonBrackets。前提是入参已经过 stripTrailingCommas。
function tailCutPaths(source, limit) {
  const input = String(source || "");
  const cuts = [];
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
    if ((char === "}" || char === "]") && stack[stack.length - 1] === char) stack.pop();
    if (char === "}" || char === "]") {
      cuts.push({ end: index + 1, closer: stack.slice().reverse().join("") });
    }
  }
  return cuts.slice(-Math.max(1, limit)).reverse();
}

// 裁尾候选的「成功」有两种来源：真截断（尾段是残片）与原文语法错（尾段还留着完整结构）。
// 尾段里出现字符串外的闭合括号，说明裁断点之后原文仍有结构，这次裁尾只是把坏内容丢掉了。
function tailHasClosingBracket(tail) {
  const input = String(tail || "");
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "}" || char === "]") return true;
  }
  return false;
}

// 从 start 处的 { 或 [ 起配平，返回配平结束下标；未闭合返回 -1。
// 复用与 tailCutPaths 相同的字符串 / 转义判定，避免把说明文字里的引号当成结构。
function jsonFragmentEnd(input, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

// 片段能独立解析成 JSON 值，才算「尾部确实还有第二组结论」。
function isJsonValueFragment(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// 首个顶层值闭合之后的尾部是否只是噪声（说明文字、多余的右括号）。
// 尾部出现对象起点时，只有它确实构成第二个 JSON 值或处于未闭合状态才算「还有结论」；
// 平衡但解析不成立的片段（如说明里的「示例 {file:line}」）属于说明文字，按噪声处理。
function isJsonTailNoise(tail) {
  const input = String(tail || "");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      const fragmentEnd = jsonFragmentEnd(input, index);
      // 未闭合的对象起点：可能是第二组结论被切断，尾部条目已丢失，不能当噪声。
      if (fragmentEnd < 0) return false;
      // 平衡且可独立解析：确实是第二个 JSON 值，同样不能当噪声。
      if (isJsonValueFragment(input.slice(index, fragmentEnd + 1))) return false;
      // 平衡但不成 JSON：说明文字里的示例片段，跳过它继续扫描后续字符。
      index = fragmentEnd;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      if (depth === 0) continue;
      depth -= 1;
    }
  }
  return !inString && depth === 0;
}

// 原文里首个完整 JSON 值的起止位置：尾部只剩说明或多条右括号时返回该区间。
// 模型常在结果块里追加「共 [2] 处，详见 README」之类说明，这是完整结论之后的噪声，
// 不能按截断整份丢弃。尾部还带对象起点或未闭合结构时返回 null，维持截断判定。
function leadingJsonRange(source) {
  const input = String(source || "");
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      // 顶层多余的右括号属于尾部噪声，不参与配平，避免整段被误判成未闭合。
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const end = index + 1;
        return isJsonTailNoise(input.slice(end)) ? { start, end } : null;
      }
    }
  }
  return null;
}

const JSON_REPAIR_CUT_LIMIT = 12;

// 未闭合块注释是候选级致命信号：注释边界不确定，之后的条目可能已经被切掉。
// 解析器收到该信号立即中止全部候选，按「JSON 非法」上报。
const UNCLOSED_COMMENT = Symbol("unclosed-comment");

function buildJsonCandidates(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const list = [trimmed];
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) list.push(trimmed.slice(arrayStart, arrayEnd + 1));
  const objStart = trimmed.indexOf("{");
  const objEnd = trimmed.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) list.push(trimmed.slice(objStart, objEnd + 1));
  return list;
}

// 候选顺序由「改得最少」到「改得最多」：原样 → 归一化 → 字面量 → 去尾逗号 → 完整前缀 → 补括号 → 截断恢复。
// 「完整前缀」用于结果块里 JSON 之后追加说明或多出右括号的场景：结构已闭合，尾部只是噪声。
// 惰性生成：首个能解析的候选即返回，合法 JSON 不再为尾部 12 个裁断候选付出扫描成本。
// 每项带 repaired（做过字符级修复）与 truncated（靠补引号、补括号吞掉半个元素或裁掉尾部元素才成立）。
function* buildJsonVariants(candidate) {
  const seen = new Set();
  const offer = (value, repaired, truncated) => {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) return null;
    seen.add(text);
    return { text, repaired, truncated };
  };
  const first = offer(candidate, false, false);
  if (first) yield first;
  const normalized = normalizeJsonBody(candidate);
  // 未闭合块注释边界不确定：只保留原文候选，交给 JSON.parse 显式失败。
  // 这是候选级致命信号，调用方收到后必须中止全部候选：只停当前候选的话，
  // 同一份文本的其它切片会解析成功，把截断误报成「结构不符合要求」，甚至吞掉注释之后的条目。
  if (normalized.unclosedComment) {
    yield UNCLOSED_COMMENT;
    return;
  }
  const closedString = normalized.closedString;
  let next = offer(normalized.text, true, closedString);
  if (next) yield next;
  const literals = replacePythonLiterals(normalized.text);
  next = offer(literals, true, closedString);
  if (next) yield next;
  const noTrailing = stripTrailingCommas(literals);
  next = offer(noTrailing, true, closedString);
  if (next) yield next;
  // 完整结论加尾部说明（如「共 [2] 处，详见 README」）或多一个右括号：结构已经闭合，
  // 尾部只是噪声，不能按截断丢弃。该候选必须排在补括号 / 裁断候选之前，
  // 否则这类原文会先被裁断候选命中并被标成 truncated。
  const headRange = leadingJsonRange(noTrailing);
  if (headRange) {
    next = offer(noTrailing.slice(headRange.start, headRange.end), true, false);
    if (next) yield next;
  }
  // 补括号只在末元素被切断时才判截断：原文停在元素级 `}` 上、只缺最外层 `]` 时
  // 末元素是完整的，按完整结论接受（README 容错清单承诺的场景）；其余形态仍按截断处理。
  const closed = closeJsonBrackets(noTrailing);
  next = offer(closed.text, true, !closed.tailComplete);
  if (next) yield next;
  for (const cut of tailCutPaths(noTrailing, JSON_REPAIR_CUT_LIMIT)) {
    next = offer(noTrailing.slice(0, cut.end) + cut.closer, true, true);
    if (!next) continue;
    // 尾段仍带闭合结构时，这次裁尾掩盖的是原文语法错，不是模型输出被截断。
    next.hidesSyntaxError = tailHasClosingBracket(noTrailing.slice(cut.end));
    yield next;
  }
}

const JSON_ERROR_POSITION = /at position (\d+)/;

// V8 的 SyntaxError 只有 "Expected ..." 一族带 position；"Unexpected token ..." 与
// "Unexpected end of JSON input" 没有位置信息。-1 表示无法定位，调用方改用通用文案。
function readJsonErrorIndex(message, length) {
  const matched = JSON_ERROR_POSITION.exec(String(message || ""));
  if (!matched) return -1;
  const index = Number(matched[1]);
  if (!Number.isFinite(index) || index < 0) return -1;
  return Math.min(index, length);
}

// 「最接近成功」的报错：位置已知者优先，位置更靠后者优先，平手保留更早的候选。
// 只留第一条会把不含 JSON 的散文前缀报错当作原因，用户按提示根本找不到出错位置。
function isCloserJsonError(current, index) {
  if (!current) return true;
  if (index < 0) return false;
  if (current.index < 0) return true;
  return index > current.index;
}

// 报错下标换算成行列：下标来自未归一化的候选文本，所以先按原始文本切出 before，
// 再只对 before 归一化 CRLF。用归一化后的全文配原始下标，会让每个 \r 累积成列号偏移。
function jsonErrorSite(text, index) {
  const source = String(text || "");
  const offset = Math.min(Math.max(0, Number(index) || 0), source.length);
  const before = source.slice(0, offset).replace(/\r\n/g, "\n");
  return {
    line: before.split("\n").length,
    column: before.length - before.lastIndexOf("\n"),
  };
}

// 返回解析结果与失败原因：调用方据此给出可定位的提示，而不是笼统的「解析失败」。
// repaired / truncated 逐层透传：截断结果不得当成完整结论入库。
// 失败时给出结构化信息（errorCode / errorLine / errorColumn），由调用方本地化，
// 避免把 JSON.parse 的英文原文拼进中文提示。
function parseJsonLooseDetailed(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return {
      value: null,
      error: "empty content",
      errorCode: "empty-content",
      errorLine: 0,
      errorColumn: 0,
      errorSiteRepaired: false,
      repaired: false,
      truncated: false,
    };
  }
  let closest = null;
  // 失败结果在「全部候选失败」与「裁尾改判」两处都要用：抽成一处，保证行列换算口径一致。
  const buildFailure = (hit) => {
    const located = Boolean(hit) && hit.index >= 0;
    // 下标属于产生该报错的候选文本：修复变体（归一化、补括号、裁断、切片）的行列只能按它自己的
    // 文本换算，因此额外标记「位置不是基于围栏原文」，由调用方在文案里说明。
    const site = located ? jsonErrorSite(hit.text, hit.index) : { line: 0, column: 0 };
    return {
      value: null,
      error: hit ? hit.message : "invalid JSON",
      errorCode: located ? "json-syntax" : "invalid-json",
      errorLine: site.line,
      errorColumn: site.column,
      errorSiteRepaired: located && hit.text !== text,
      repaired: false,
      truncated: false,
    };
  };
  // 未闭合块注释会让整份围栏不可信：收到致命信号后中止全部候选，按 JSON 非法上报。
  candidates: for (const candidate of buildJsonCandidates(text)) {
    for (const variant of buildJsonVariants(candidate)) {
      if (variant === UNCLOSED_COMMENT) break candidates;
      try {
        const value = JSON.parse(variant.text);
        // 截断恢复的优先级在这里显式固定，不依赖候选生成顺序：
        // 1) 裁尾候选命中、被裁掉的尾段仍带闭合结构、且围栏原文有可定位语法错 -> 按「JSON 非法」报位置；
        // 2) 拿不到位置信息时保留 truncated，由调用方报「输出被截断」；
        // 3) 真截断（尾段是残片）、补引号、末元素完整只缺 ] 的形态都走原判定。
        // 只对围栏原文候选改判：切片候选的报错位置与用户原回复不是同一基准，改判会让提示指错行。
        if (variant.truncated && variant.hidesSyntaxError && candidate === text && closest && closest.index >= 0) {
          return buildFailure(closest);
        }
        return {
          value,
          error: "",
          errorCode: "",
          errorLine: 0,
          errorColumn: 0,
          errorSiteRepaired: false,
          repaired: variant.repaired,
          truncated: variant.truncated,
        };
      } catch (error) {
        const message = String(error?.message || error);
        const index = readJsonErrorIndex(message, variant.text.length);
        if (isCloserJsonError(closest, index)) closest = { message, index, text: variant.text };
      }
    }
  }
  return buildFailure(closest);
}

// 读取指定围栏：区分「围栏不存在」「围栏存在但 JSON 非法」「JSON 合法但形状不符」。
// 专用围栏存在时，调用方不得再回退到通用 json 或文本行，避免把其它内容当作结果。
function readTaggedFence(text, tag, predicate) {
  const raw = extractFence(text, tag);
  if (raw === null) {
    return {
      present: false,
      ok: false,
      value: null,
      reason: "fence-missing",
      error: "",
      rowCount: -1,
      detailRepaired: false,
      repaired: false,
      truncated: false,
    };
  }
  const parsed = parseJsonLooseDetailed(raw);
  // 失败判定看 error 而不是 value：围栏内是合法 JSON 字面量 null 时 value 同样为 null，
  // 按 value 判断会把合法内容报成语法错误，且 error 为空串，提示里会留下断句。
  if (parsed.error) {
    return {
      present: true,
      ok: false,
      value: null,
      reason: "json-invalid",
      error: parsed.error,
      errorCode: parsed.errorCode || "",
      errorLine: Number(parsed.errorLine) || 0,
      errorColumn: Number(parsed.errorColumn) || 0,
      rowCount: -1,
      // 位置是按修复后的候选文本换算的：调用方需要在文案里说明，避免用户按原回复数行。
      detailRepaired: parsed.errorSiteRepaired === true,
      repaired: parsed.repaired,
      truncated: parsed.truncated,
    };
  }
  const ok = !predicate || predicate(parsed.value);
  // 元素个数一并带出：「不是数组」与「数组元素不合格」必须分成两种提示。
  const rowCount = Array.isArray(parsed.value) ? parsed.value.length : -1;
  return ok
    ? {
        present: true,
        ok: true,
        value: parsed.value,
        reason: "",
        error: "",
        rowCount,
        detailRepaired: false,
        repaired: parsed.repaired,
        truncated: parsed.truncated,
      }
    : {
        present: true,
        ok: false,
        value: null,
        // 它确实是数组，只是元素不合格：再报「应为对象数组」会让用户改结构，方向相反。
        reason: rowCount >= 0 ? "rows-unusable" : "shape-mismatch",
        error: "",
        rowCount,
        detailRepaired: false,
        repaired: parsed.repaired,
        truncated: parsed.truncated,
      };
}

// 围栏级失败的 detail：rows-unusable 要报元素个数，其它失败才是解析器报错文本。
function fenceFailureDetail(fence) {
  if (fence?.reason === "rows-unusable") return String(Number(fence.rowCount) || 0);
  return fence?.error || "";
}

function isIssueArray(value) {
  return (
    Array.isArray(value) &&
    (value.length === 0 ||
      value.some((item) => item && typeof item === "object" && (item.severity || item.level || item.title || item.summary)))
  );
}

// 通用 json 回退块必须显式带严重程度，避免把普通说明或引用列表当作审查结果。
function isStrictIssueArray(value) {
  return (
    Array.isArray(value) &&
    (value.length === 0 ||
      value.some(
        (item) =>
          item &&
          typeof item === "object" &&
          (item.severity || item.level) &&
          (item.title || item.summary || item.location || item.file || item.impact || item.description),
      ))
  );
}

function normalizeSeverity(raw) {
  const text = normalizeText(raw).toLowerCase();
  if (!text) return "";
  if (/严重|高|critical|high|blocker|fatal|p0|p1/.test(text)) return SEVERITY.critical;
  if (/一般|中|major|medium|moderate|normal|p2/.test(text)) return SEVERITY.major;
  if (/建议|低|minor|low|suggestion|info|trivial|p3/.test(text)) return SEVERITY.minor;
  return "";
}

// 纳入修复范围的严重程度：过滤非法值并按「严重 / 一般 / 建议」固定顺序去重；
// 空数组或全部非法时回退默认范围，避免设置损坏导致审查结果无处可去。
function normalizeSeverityScope(value) {
  const source = Array.isArray(value) ? value : [];
  const picked = new Set();
  for (const item of source) {
    const severity = normalizeSeverity(item);
    if (severity) picked.add(severity);
  }
  if (!picked.size) return [...DEFAULT_ISSUE_SEVERITIES];
  return ISSUE_SEVERITIES.filter((severity) => picked.has(severity));
}

function severityRank(severity) {
  if (severity === SEVERITY.critical) return 0;
  if (severity === SEVERITY.major) return 1;
  return 2;
}

function statusRank(status) {
  if (status === ISSUE_STATUS.open) return 0;
  if (status === ISSUE_STATUS.fixing) return 1;
  if (status === ISSUE_STATUS.fixed) return 2;
  // 不存在的条目已经定论、无需修复，排在已修复之后、归档之前。
  if (status === ISSUE_STATUS.notFound) return 3;
  return 4;
}

function issueLocationText(row) {
  const location = normalizeText(row.location ?? row.position ?? row.place);
  if (location) return location;
  const file = normalizeText(row.file ?? row.path ?? row.filename);
  const line = normalizeText(row.line ?? row.lineNumber ?? row.startLine);
  if (!file) return "";
  return line ? `${file}:${line}` : file;
}

function normalizeIssueRow(row) {
  if (!row || typeof row !== "object") return null;
  const title = normalizeText(row.title ?? row.summary ?? row.problem ?? row.name ?? row.message);
  let severity = normalizeSeverity(row.severity ?? row.level ?? row.priority);
  if (!severity) severity = SEVERITY.major;
  const location = issueLocationText(row);
  const impact = normalizeText(row.impact ?? row.effect ?? row.risk ?? row.description);
  const suggestion = normalizeText(row.suggestion ?? row.fix ?? row.recommendation ?? row.solution);
  if (!title && !location && !impact) return null;
  return {
    severity,
    title: title || truncate(location || impact, 80).text,
    location,
    impact,
    suggestion,
    evidence: normalizeText(row.evidence ?? row.proof),
  };
}

// 文本兜底只认「行首严重度 + 冒号 + 标题」：分隔符必填，避免把「严重程度：」这类说明行当成问题。
const FALLBACK_ISSUE_PATTERN =
  /^ {0,3}(?:[-*+]\s+)?(?:\*\*)?[【\[]?(严重|一般|建议|critical|major|minor|high|medium|low)[】\]]?(?:\*\*)?[ \t]*[:：][ \t]*(\S.*)$/i;

// 说明性文字不是问题：标题为程度描述或以「未发现问题」收尾时丢弃。
function isFallbackNoiseTitle(title) {
  return (
    /^(?:程度|级别|等级|评级)\s*[:：]/.test(title) ||
    /(?:未发现问题|没有发现问题|无问题|没有问题|no\s+(?:issues?|findings?|problems?)|nothing\s+(?:found|to\s+report)|lgtm)/i.test(
      title,
    )
  );
}

// 续行位置识别：只从当前条目的续行取值，遇到下一条严重度行立即停止。
// 缩进深于条目的行视为续行；与条目同缩进时只接受「见 / 位置：path:line」这类位置行，
// 避免把下一条 issue 的标题或位置算给当前条目。
const FALLBACK_ANY_ISSUE_PATTERN =
  /^\s*(?:[-*+]\s+)?(?:\*\*)?[【\[]?(严重|一般|建议|critical|major|minor|high|medium|low)[】\]]?(?:\*\*)?[ \t]*[:：]/i;
const FALLBACK_POSITION_PREFIX =
  /^(?:[-*+]\s+)?(?:见|详见|参见|位置|文件|相关文件|路径|行号|at|located(?:\s+at)?|file|line)\s*[:：]?\s*/i;
const FALLBACK_LOCATION_PATTERN = /([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+):(\d+)(?:-\d+)?/;

function leadingIndentWidth(line) {
  let width = 0;
  for (const char of String(line || "")) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

function matchFallbackLocation(text) {
  const match = String(text || "").match(FALLBACK_LOCATION_PATTERN);
  return match ? `${match[1]}:${match[2]}` : "";
}

function resolveFallbackLocation(visible, index) {
  const line = visible[index];
  // 标题行自带位置（如「严重：src/a.ts:12 未判空」）时优先采用。
  const own = matchFallbackLocation(line);
  if (own) return own;
  const baseIndent = leadingIndentWidth(line);
  for (let cursor = index + 1; cursor < visible.length; cursor += 1) {
    const next = visible[cursor];
    // 空行结束当前条目；围栏内容已在上方被置空，同样在此结束。
    if (!next.trim()) break;
    // 下一条 issue（含建议级与「严重程度：」说明行）立即停止。
    if (FALLBACK_ANY_ISSUE_PATTERN.test(next)) break;
    const indent = leadingIndentWidth(next);
    if (indent < baseIndent) break;
    const positionLine = FALLBACK_POSITION_PREFIX.test(next.trim());
    if (indent === baseIndent && !positionLine) break;
    const found = matchFallbackLocation(next);
    if (found) return found;
  }
  return "";
}

function parseFallbackIssueLines(text) {
  const lines = String(text || "").split(/\r?\n/);
  // 围栏内的代码与 diff 不是审查结论，先屏蔽，位置窗口也不会再从中取路径。
  const visible = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      visible.push("");
      continue;
    }
    visible.push(inFence ? "" : line);
  }
  const rows = [];
  for (let index = 0; index < visible.length; index += 1) {
    const line = visible[index];
    const match = line.match(FALLBACK_ISSUE_PATTERN);
    if (!match) continue;
    const severity = normalizeSeverity(match[1]);
    if (!severity) continue;
    const title = normalizeText(match[2].replace(/^\*\*|\*\*$/g, ""));
    if (!title || isFallbackNoiseTitle(title)) continue;
    const location = resolveFallbackLocation(visible, index);
    rows.push({
      severity,
      title,
      location,
      impact: "",
      suggestion: "",
      evidence: "",
    });
  }
  return rows;
}

// 审查结果三态：issues 有条目；empty 是可信的空结论；failed 表示缺少结构化块或内容无法解析。
// detailed 版本额外带上原因（reason）与解析器错误（detail），供界面给出可定位的提示。
function parseReviewResultDetailed(text, options) {
  const source = String(text || "");
  const scope = new Set(normalizeSeverityScope(options?.severities));
  const tagged = readTaggedFence(source, "snow-issues", isIssueArray);
  let rows = null;
  let reason = "";
  let detail = "";
  // 结构化失败细节：由 readTaggedFence 透传，调用方据此给出本地化的位置提示，
  // 不再把 JSON.parse 的英文原文拼进中文文案。
  let failure = null;
  let repaired = false;
  if (tagged.present) {
    // 专用围栏存在时不再回退：坏 JSON 就是解析失败，不能当成「没有发现问题」。
    repaired = tagged.repaired;
    if (tagged.truncated) {
      // 靠补引号 / 裁掉尾部元素才成立的 JSON：尾部条目已经丢失，不能当作完整结论入库。
      reason = "output-truncated";
    } else if (tagged.ok) rows = tagged.value;
    else {
      reason = tagged.reason;
      detail = fenceFailureDetail(tagged);
      failure = tagged;
    }
  } else {
    const jsonTagged = readTaggedFence(source, "json", isStrictIssueArray);
    if (jsonTagged.present && jsonTagged.truncated) {
      repaired = jsonTagged.repaired;
      // 通用 json 回退块被截断时，尾部条目虽已丢失，正文里的「严重：…」文本结论仍然有效：
      // 先走文本行兜底，兜底结果为空才按截断失败上报。截断判定只对专用围栏收紧。
      const fallback = parseFallbackIssueLines(source);
      if (fallback.length) rows = fallback;
      else reason = "output-truncated";
    } else if (jsonTagged.ok) {
      repaired = jsonTagged.repaired;
      rows = jsonTagged.value;
    } else {
      // 通用 json 块不合法时仍允许文本兜底，但文本行本身已收紧，不会把说明行当作问题。
      const fallback = parseFallbackIssueLines(source);
      if (fallback.length) rows = fallback;
      else if (jsonTagged.present) {
        reason = jsonTagged.reason;
        detail = fenceFailureDetail(jsonTagged);
        failure = jsonTagged;
      } else {
        reason = "fence-missing";
      }
    }
  }
  if (!Array.isArray(rows)) {
    // 旧路径不返回 filtered：保持与升级前完全一致的返回形状。
    return {
      issues: [],
      status: "failed",
      reason: reason || "fence-missing",
      detail,
      detailCode: String(failure?.errorCode || ""),
      detailLine: Number(failure?.errorLine) || 0,
      detailColumn: Number(failure?.errorColumn) || 0,
      // 位置来自修复后的文本：调用方据此换一句更准确的提示。
      detailRepaired: Boolean(failure?.detailRepaired),
      repaired,
      truncated: reason === "output-truncated",
    };
  }
  const normalized = [];
  // 可用行数在范围过滤之前统计：用于区分「合法但都不在范围内」与「整组行都缺正文字段」。
  let usable = 0;
  for (const row of rows) {
    const issue = normalizeIssueRow(row);
    if (!issue) continue;
    usable += 1;
    if (!scope.has(issue.severity)) continue;
    normalized.push(issue);
  }
  // 非空数组却没有任何可用行（如 [{"severity":"严重"}]）属于格式异常，必须报解析失败，
  // 不能当成「未发现问题」；真正的空数组与「都落在范围外」才是 empty。
  const status = normalized.length ? "issues" : rows.length > 0 && usable === 0 ? "failed" : "empty";
  // filtered 只统计「合法但落在范围外」的条目，供调用方区分可信空结果与被范围过滤。
  return {
    issues: normalized,
    status,
    filtered: usable - normalized.length,
    reason: status === "failed" ? "rows-unusable" : "",
    detail: status === "failed" ? String(rows.length) : "",
    repaired,
    truncated: false,
  };
}

function parseReviewResult(text, options) {
  const detailed = parseReviewResultDetailed(text, options);
  const result = { issues: detailed.issues, status: detailed.status };
  // 失败且围栏缺失时旧实现没有 filtered：保持该形状，避免调用方与既有断言受影响。
  if (typeof detailed.filtered === "number") result.filtered = detailed.filtered;
  return result;
}

function parseReviewIssues(text, options) {
  return parseReviewResult(text, options).issues;
}

function isFixResultArray(value) {
  return (
    Array.isArray(value) &&
    (value.length === 0 ||
      value.some((item) => item && typeof item === "object" && (item.issueId || item.issue_id || item.id)))
  );
}

// 通用 json 回退块必须是修复结果形状：契约 id 加状态，避免把引用的 issue 列表当作修复结果。
function isStrictFixResultArray(value) {
  return (
    Array.isArray(value) &&
    (value.length === 0 ||
      value.some(
        (item) =>
          item &&
          typeof item === "object" &&
          (item.issueId || item.issue_id) &&
          (item.status || item.result || item.outcome),
      ))
  );
}

function normalizeFixStatus(raw) {
  // 统一空白/连字符，先识别否定与 not_found，再匹配整串肯定词，避免 not fixed 落入 fixed。
  const text = normalizeText(raw)
    .toLowerCase()
    // 先去掉包裹引号（含中文引号），否则右引号会挡住尾部标点。
    .replace(/^[\s"'`“‘「『]+|[\s"'`”’」』]+$/g, "")
    // 再去掉尾部中英文标点与空白，兼容「已修复。」「Fixed.」「已修复. 」。
    .replace(/[\s。．.!！,，;；]+$/g, "")
    .replace(/[\s-]+/g, "_");
  if (!text) return "blocked";
  if (text === "fixed" || text === "not_found" || text === "blocked") return text;
  if (/^(not_found|notfound|missing|invalid|gone|不存在|已失效|未复现|无法复现|不再复现)$/.test(text)) {
    return "not_found";
  }
  if (
    /^(not_fixed|unfixed|not_done|undone|unresolved|not_resolved|partially_fixed|wontfix|not_applicable|未修复|未通过|未完成|未修好|没有修复|未能修复|无法修复|修复失败|部分修复|blocked|pending|open|todo|failed|error|cannot|阻塞|待处理|待确认|需要确认)$/.test(
      text,
    )
  ) {
    return "blocked";
  }
  if (/^(fixed|done|resolved|已修复|修复完成|通过|验证通过|passed|pass)$/.test(text)) {
    return "fixed";
  }
  return "blocked";
}

function isVerifyResultArray(value) {
  return (
    Array.isArray(value) &&
    (value.length === 0 ||
      value.some(
        (item) =>
          item &&
          typeof item === "object" &&
          (item.issueId || item.issue_id || item.id) &&
          normalizeVerifyStatusStrict(item.status ?? item.result ?? item.verdict ?? item.outcome),
      ))
  );
}

function isStrictVerifyResultArray(value) {
  return (
    Array.isArray(value) &&
    (value.length === 0 ||
      value.some(
        (item) =>
          item &&
          typeof item === "object" &&
          (item.issueId || item.issue_id) &&
          (item.status || item.result || item.verdict || item.outcome),
      ))
  );
}

// 复审状态归一化：明确肯定 → confirmed，明确否定 → still_present，其余一律 uncertain。
// strict 版本对缺失或无法识别的状态返回空串，供解析器判定输出是否满足契约。
function normalizeVerifyStatusStrict(raw) {
  const text = normalizeText(raw)
    .toLowerCase()
    .replace(/^[\s"'`“‘「『]+|[\s"'`”’」』]+$/g, "")
    .replace(/[\s。．.!！,，;；]+$/g, "")
    .replace(/[\s-]+/g, "_");
  if (!text) return "";
  if (
    /^(confirmed|verified|fixed|pass|passed|resolved|已修复|确认修复|通过|验证通过|不存在|已不存在|not_found|notfound|no_issue)$/.test(
      text,
    )
  ) {
    return "confirmed";
  }
  if (
    /^(still_present|present|exists|still_exists|unfixed|not_fixed|failed|fail|remaining|仍存在|依然存在|未修复|未通过|问题存在|仍复现)$/.test(
      text,
    )
  ) {
    return "still_present";
  }
  if (
    /^(uncertain|unknown|unsure|inconclusive|cannot_confirm|cannot_verify|不确定|无法确认|无法确定|无法判断|待确认|未确认)$/.test(
      text,
    )
  ) {
    return "uncertain";
  }
  return "";
}

// 复审结果只认专用围栏（或带 issueId + status 的 json 回退），不做自然语言兜底。
// 缺少合法状态的记录不进入结果；同一 issueId 只保留第一条，避免重复计数或后写覆盖。
function parseVerifyResultsDetailed(text) {
  const source = String(text || "");
  const tagged = readTaggedFence(source, "snow-verify-results", isVerifyResultArray);
  let rows = null;
  let reason = "";
  let detail = "";
  let failure = null;
  let repaired = false;
  if (tagged.present) {
    repaired = tagged.repaired;
    // 截断结果（靠补引号或裁掉尾部条目才成立）不得当作结论：尾部记录已经丢失。
    if (tagged.truncated) reason = "output-truncated";
    else if (tagged.ok) rows = tagged.value;
    else {
      reason = tagged.reason;
      detail = fenceFailureDetail(tagged);
      failure = tagged;
    }
  } else {
    const jsonTagged = readTaggedFence(source, "json", isStrictVerifyResultArray);
    if (jsonTagged.present && jsonTagged.truncated) {
      repaired = jsonTagged.repaired;
      reason = "output-truncated";
    } else if (jsonTagged.ok) {
      repaired = jsonTagged.repaired;
      rows = jsonTagged.value;
    } else if (jsonTagged.present) {
      reason = jsonTagged.reason;
      detail = fenceFailureDetail(jsonTagged);
      failure = jsonTagged;
    } else {
      reason = "fence-missing";
    }
  }
  if (!Array.isArray(rows)) {
    return {
      results: [],
      reason: reason || "fence-missing",
      detail,
      detailCode: String(failure?.errorCode || ""),
      detailLine: Number(failure?.errorLine) || 0,
      detailColumn: Number(failure?.errorColumn) || 0,
      // 位置来自修复后的文本：调用方据此换一句更准确的提示。
      detailRepaired: Boolean(failure?.detailRepaired),
      repaired,
      truncated: reason === "output-truncated",
    };
  }
  const results = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const issueId = normalizeText(row.issueId ?? row.issue_id ?? row.id);
    if (!issueId) continue;
    const status = normalizeVerifyStatusStrict(row.status ?? row.result ?? row.verdict ?? row.outcome);
    if (!status) continue;
    if (seen.has(issueId)) continue;
    seen.add(issueId);
    results.push({
      issueId,
      status,
      summary: normalizeText(row.summary ?? row.message ?? row.note),
      evidence: normalizeText(row.evidence ?? row.proof ?? row.reason),
    });
  }
  // 合法空数组表示「本次没有给出任何结论」，与「有元素但都不可用」（字段缺失）是两类问题，
  // 前者下一步是让模型补写结论，后者是修正字段，提示不能共用同一个模板。
  const empty = rows.length === 0;
  return {
    results,
    reason: results.length ? "" : empty ? "empty-array" : "no-usable-rows",
    detail: results.length || empty ? "" : String(rows.length),
    repaired,
    truncated: false,
  };
}

function parseVerifyResults(text) {
  return parseVerifyResultsDetailed(text).results;
}

function parseFixResultsDetailed(text) {
  const source = String(text || "");
  const tagged = readTaggedFence(source, "snow-fix-results", isFixResultArray);
  let rows = null;
  let reason = "";
  let detail = "";
  let failure = null;
  let repaired = false;
  if (tagged.present) {
    repaired = tagged.repaired;
    // 截断结果（靠补引号或裁掉尾部元素才成立）不得当作结论：半截记录不能落成 blocked。
    if (tagged.truncated) reason = "output-truncated";
    else if (tagged.ok) rows = tagged.value;
    else {
      reason = tagged.reason;
      detail = fenceFailureDetail(tagged);
      failure = tagged;
    }
  } else {
    const jsonTagged = readTaggedFence(source, "json", isStrictFixResultArray);
    if (jsonTagged.present && jsonTagged.truncated) {
      repaired = jsonTagged.repaired;
      reason = "output-truncated";
    } else if (jsonTagged.ok) {
      repaired = jsonTagged.repaired;
      rows = jsonTagged.value;
    } else if (jsonTagged.present) {
      reason = jsonTagged.reason;
      detail = fenceFailureDetail(jsonTagged);
      failure = jsonTagged;
    } else {
      reason = "fence-missing";
    }
  }
  if (!Array.isArray(rows)) {
    return {
      results: [],
      reason: reason || "fence-missing",
      detail,
      detailCode: String(failure?.errorCode || ""),
      detailLine: Number(failure?.errorLine) || 0,
      detailColumn: Number(failure?.errorColumn) || 0,
      // 位置来自修复后的文本：调用方据此换一句更准确的提示。
      detailRepaired: Boolean(failure?.detailRepaired),
      repaired,
      truncated: reason === "output-truncated",
    };
  }
  const results = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const issueId = normalizeText(row.issueId ?? row.issue_id ?? row.id);
    if (!issueId) continue;
    const status = normalizeFixStatus(row.status ?? row.result ?? row.outcome) || "blocked";
    const files = Array.isArray(row.files)
      ? row.files.map((item) => normalizeText(item)).filter(Boolean)
      : normalizeText(row.files)
        ? [normalizeText(row.files)]
        : [];
    results.push({
      issueId,
      status,
      summary: normalizeText(row.summary ?? row.message ?? row.note),
      files,
      verification: normalizeText(row.verification ?? row.verify ?? row.test),
    });
  }
  // 合法空数组表示「本次没有给出任何结论」，与「有元素但都不可用」（字段缺失）是两类问题，
  // 前者下一步是让模型补写结论，后者是修正字段，提示不能共用同一个模板。
  const empty = rows.length === 0;
  return {
    results,
    reason: results.length ? "" : empty ? "empty-array" : "no-usable-rows",
    detail: results.length || empty ? "" : String(rows.length),
    repaired,
    truncated: false,
  };
}

function parseFixResults(text) {
  return parseFixResultsDetailed(text).results;
}

export {
  normalizeSeverity,
  normalizeSeverityScope,
  severityRank,
  statusRank,
  parseReviewResult,
  parseReviewResultDetailed,
  parseReviewIssues,
  parseFixResults,
  parseFixResultsDetailed,
  parseVerifyResults,
  parseVerifyResultsDetailed,
};
