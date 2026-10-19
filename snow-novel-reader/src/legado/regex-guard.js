// 第三方正则护栏：书源里的净化正则、:matches/:matchesOwn 与 [attr~=re] 都是任意字符串，
// 灾难性回溯无法被 try/catch 或输入长度上限中断（30 个字符就足以卡住渲染线程数秒）。
// 这里在编译前做静态形态检查，拒绝典型的指数级回溯构造；宁可跳过该规则，也不能冻结界面。
// 说明：静态检查不能覆盖所有 ReDoS 变体，但能挡住嵌套无界量词、重叠分支、空分支重复、
// 超大计数重复等常见构造；真正的硬隔离（Worker 超时）属于后续架构任务。

// 第三方 pattern 长度上限：合法书源净化规则通常远低于该值，超长直接视为可疑。
export const THIRD_PARTY_REGEX_SOURCE_MAX = 2048;
// 单次计数重复的上限：闭区间 {m,n} 看 max，开区间 {m,} 只看 min；
// Infinity 不参与上限比较，否则所有开区间量词都会被判为超大重复。
const LARGE_REPEAT_MIN = 1000;
const LARGE_REPEAT_MAX = 10000;

// 日志通道由引擎注入；同一 pattern 只上报一次，避免劣质书源刷屏。
let regexGuardLog = null;
const reportedUnsafe = new Set();
const REPORT_LIMIT = 50;

export function setRegexGuardLog(log) {
  regexGuardLog = typeof log === "function" ? log : null;
}

function reportUnsafe(source, reason) {
  const key = reason + "\u0000" + source;
  if (reportedUnsafe.has(key)) return;
  if (reportedUnsafe.size >= REPORT_LIMIT) reportedUnsafe.clear();
  reportedUnsafe.add(key);
  if (typeof regexGuardLog === "function") {
    regexGuardLog("unsafe third-party regex skipped", reason, String(source).slice(0, 80));
  }
}

// 解析量词：返回 { end, unbounded, nullable, large }；不是量词返回 null。
// 惰性量词（+? / *? / ?? / {m,n}?）与贪婪量词的回溯风险相同，按同一类处理。
function readQuantifier(text, index) {
  const ch = text.charAt(index);
  let end = index + 1;
  if (ch === "*" || ch === "+") {
    if (text.charAt(end) === "?") end += 1;
    return { end: end, unbounded: true, nullable: true, large: false };
  }
  if (ch === "?") {
    if (text.charAt(end) === "?") end += 1;
    return { end: end, unbounded: false, nullable: true, large: false };
  }
  if (ch !== "{") return null;
  const match = /^\{(\d+)(?:,(\d*))?\}/.exec(text.slice(index));
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] === undefined ? min : match[2] === "" ? Infinity : Number(match[2]);
  end = index + match[0].length;
  if (text.charAt(end) === "?") end += 1;
  return {
    end: end,
    unbounded: max === Infinity,
    nullable: min === 0,
    large: min > LARGE_REPEAT_MIN || (max !== Infinity && max > LARGE_REPEAT_MAX)
  };
}

// 原子签名：用于判断两个分支是否可能匹配同一前缀。
// lit:x 单字符；class:x 字符类（任意两个字符类都可能有交集，保守按重叠处理）；
// group 嵌套分组 / 反向引用（保守按重叠处理）。
function atomOverlap(a, b) {
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.indexOf("class:") === 0 && b.indexOf("class:") === 0) return true;
  if (a === "group" || b === "group") return true;
  if (a === "backref" || b === "backref") return true;
  return false;
}

// 前缀是否可能重叠：逐原子比较，遇到明确不同的字面量即可判定不重叠；
// 某一分支先结束（是另一分支的前缀）视为重叠，例如 a 与 aa。
function prefixOverlap(a, b) {
  const count = Math.min(a.length, b.length);
  if (count === 0) return true;
  for (let i = 0; i < count; i += 1) {
    if (!atomOverlap(a[i], b[i])) return false;
  }
  return true;
}

function newFrame() {
  return {
    atoms: 0,
    firstSig: null,
    firstUnbounded: false,
    firstNullable: false,
    lastSig: null,
    lastUnbounded: false,
    hasAlt: false,
    alts: [],
    currentAlt: null
  };
}

function recordAtom(frame, sig) {
  if (!sig) return;
  frame.atoms += 1;
  if (frame.firstSig === null) frame.firstSig = sig;
  frame.lastSig = sig;
  frame.lastUnbounded = false;
  if (!frame.currentAlt) frame.currentAlt = { sigs: [], firstUnbounded: false, firstNullable: false };
  if (frame.currentAlt.sigs.length < 3) frame.currentAlt.sigs.push(sig);
}

function recordQuantifier(frame, quant) {
  if (frame.currentAlt && frame.currentAlt.sigs.length === 1) {
    frame.currentAlt.firstUnbounded = quant.unbounded;
    frame.currentAlt.firstNullable = quant.nullable;
  }
  if (frame.atoms === 1) {
    frame.firstUnbounded = quant.unbounded;
    frame.firstNullable = quant.nullable;
  }
  frame.lastUnbounded = quant.unbounded;
}

// 无界量词作用在含重叠分支的分组上：典型 (a|aa)+、(.*a|.*b)+、(a|)+。
function alternationOverlap(frame) {
  const alts = frame.alts.slice();
  if (frame.currentAlt) alts.push(frame.currentAlt);
  if (alts.length < 2) return false;
  let hasEmpty = false;
  for (const alt of alts) if (!alt.sigs.length) hasEmpty = true;
  if (hasEmpty) return true;
  for (let i = 0; i < alts.length; i += 1) {
    for (let j = i + 1; j < alts.length; j += 1) {
      const a = alts[i];
      const b = alts[j];
      if (a.firstUnbounded && b.firstUnbounded && atomOverlap(a.sigs[0], b.sigs[0])) return true;
      if (prefixOverlap(a.sigs, b.sigs)) return true;
    }
  }
  return false;
}

function readEscapeAtom(text, index) {
  const ch = text.charAt(index + 1);
  if (!ch) return { end: index + 2, sig: "lit:\\" };
  if (ch === "b" || ch === "B") return { end: index + 2, sig: "" };
  if (ch === "d" || ch === "D" || ch === "w" || ch === "W" || ch === "s" || ch === "S") {
    return { end: index + 2, sig: "class:" + ch.toLowerCase() };
  }
  if (ch === "p" || ch === "P") {
    const open = text.indexOf("{", index + 2);
    const close = open === -1 ? -1 : text.indexOf("}", open + 1);
    return { end: close === -1 ? index + 2 : close + 1, sig: "class:any" };
  }
  if (ch === "k") {
    const close = text.indexOf(">", index + 2);
    return { end: close === -1 ? index + 2 : close + 1, sig: "backref" };
  }
  if (/[1-9]/.test(ch)) {
    let end = index + 2;
    while (/\d/.test(text.charAt(end))) end += 1;
    return { end: end, sig: "backref" };
  }
  if (ch === "u") {
    const hex = text.slice(index + 2, index + 6);
    return { end: /^[0-9a-fA-F]{4}$/.test(hex) ? index + 6 : index + 2, sig: "lit:u" };
  }
  if (ch === "x") {
    const hex = text.slice(index + 2, index + 4);
    return { end: /^[0-9a-fA-F]{2}$/.test(hex) ? index + 4 : index + 2, sig: "lit:x" };
  }
  return { end: index + 2, sig: "lit:" + ch.toLowerCase() };
}

// 返回 true 表示该第三方 pattern 可以安全编译执行。
export function isSafeThirdPartyRegex(source) {
  const text = String(source == null ? "" : source);
  if (!text) return false;
  if (text.length > THIRD_PARTY_REGEX_SOURCE_MAX) return false;
  const stack = [newFrame()];
  let unsafe = false;
  let largeRepeat = false;

  const consumeQuantifier = (frame, index) => {
    const quant = readQuantifier(text, index);
    // 没有量词时返回 index - 1：调用方把 i 赋成返回值后由 for 循环自增，
    // 这样正好回到 index 本身，不会跳过紧跟原子之后的字符（如 | 或 )）。
    if (!quant) return index - 1;
    recordQuantifier(frame, quant);
    if (quant.large) largeRepeat = true;
    return quant.end - 1;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    const frame = stack[stack.length - 1];

    if (ch === "\\") {
      const atom = readEscapeAtom(text, i);
      recordAtom(frame, atom.sig);
      i = atom.end - 1;
      if (atom.sig) i = consumeQuantifier(frame, i + 1);
      continue;
    }

    if (ch === "[") {
      let j = i + 1;
      if (text.charAt(j) === "^") j += 1;
      if (text.charAt(j) === "]") j += 1;
      for (; j < text.length; j += 1) {
        if (text.charAt(j) === "\\") {
          j += 1;
          continue;
        }
        if (text.charAt(j) === "]") break;
      }
      if (j >= text.length) return false;
      const body = text.slice(i + 1, j);
      const sig = /^[A-Za-z0-9\u4e00-\u9fff]$/.test(body) ? "lit:" + body.toLowerCase() : "class:any";
      recordAtom(frame, sig);
      i = j;
      i = consumeQuantifier(frame, i + 1);
      continue;
    }

    if (ch === "(") {
      // 跳过 (?...) 前缀：?: / ?= / ?! / ?<= / ?<! / ?<name>
      if (text.charAt(i + 1) === "?") {
        if (text.charAt(i + 2) === "<" && text.charAt(i + 3) !== "=" && text.charAt(i + 3) !== "!") {
          const close = text.indexOf(">", i + 2);
          if (close === -1) return false;
          i = close;
        } else {
          i += 2;
          if (text.charAt(i) === "<" && (text.charAt(i + 1) === "=" || text.charAt(i + 1) === "!")) i += 1;
        }
      }
      stack.push(newFrame());
      continue;
    }

    if (ch === ")") {
      if (stack.length <= 1) return false;
      const inner = stack.pop();
      const parent = stack[stack.length - 1];
      recordAtom(parent, "group");
      const quant = readQuantifier(text, i + 1);
      if (quant) {
        recordQuantifier(parent, quant);
        if (quant.large) largeRepeat = true;
        i = quant.end - 1;
      }
      if (quant && quant.unbounded) {
        if (inner.atoms === 0) unsafe = true;
        else if (inner.atoms === 1 && (inner.firstUnbounded || inner.firstNullable)) unsafe = true;
        else if (inner.firstUnbounded) unsafe = true;
        else if (inner.lastUnbounded && atomOverlap(inner.firstSig, inner.lastSig)) unsafe = true;
        else if (inner.hasAlt && alternationOverlap(inner)) unsafe = true;
      }
      continue;
    }

    if (ch === "|") {
      frame.hasAlt = true;
      if (frame.currentAlt) frame.alts.push(frame.currentAlt);
      else frame.alts.push({ sigs: [], firstUnbounded: false, firstNullable: false });
      frame.currentAlt = null;
      continue;
    }

    if (ch === "^" || ch === "$") continue;

    if (ch === ".") recordAtom(frame, "class:any");
    else recordAtom(frame, "lit:" + ch.toLowerCase());
    i = consumeQuantifier(frame, i + 1);
  }

  if (stack.length !== 1) return false;
  if (largeRepeat) return false;
  return !unsafe;
}

// 统一编译入口：危险 pattern 返回 null，调用方按「不匹配 / 跳过净化」处理。
export function compileGuardedRegex(source, flags) {
  const text = String(source == null ? "" : source);
  if (!text) return null;
  if (text.length > THIRD_PARTY_REGEX_SOURCE_MAX) {
    reportUnsafe(text, "pattern too long");
    return null;
  }
  if (!isSafeThirdPartyRegex(text)) {
    reportUnsafe(text, "unsafe backtracking pattern");
    return null;
  }
  try {
    return new RegExp(text, flags || "");
  } catch (err) {
    return null;
  }
}
