// DOM 节点提取与 jsoup 兼容的 CSS 选择器求值（扩展伪类、属性正则）。
import { compileGuardedRegex } from "./regex-guard.js";

// 扩展伪类（:contains/:matches 等）与属性正则 [key~=re] 的同类防护：参与判定的文本/
// 属性值超长直接判不匹配，单个 querySegment 候选集超限停止扫描并保留已命中项，
// 避免恶意书源在渲染线程拖满 CPU（与 PURIFY_TEXT_MAX 同一「宁跳过不冻结」约定）。
export const PSEUDO_TEXT_MAX = 200000;
export const PSEUDO_CANDIDATE_MAX = 10000;
// 三类超限各自的限次门闩：只上报一次，防同一劣质书源把日志刷成瀑布。
let pseudoSkipLog = null;
export let pseudoTextSkipReported = false;
export let pseudoAttrSkipReported = false;
export let pseudoCandidateSkipReported = false;
// ---------------- 通用小工具 ----------------
export function toNodeArray(list) {
  const out = [];
  if (!list) return out;
  for (let i = 0; i < list.length; i += 1) out.push(list[i]);
  return out;
}

export function pickNodeIndex(list, index) {
  const n = Number(index);
  if (!isFinite(n) || !list.length) return [];
  const target = n < 0 ? list.length + n : n;
  return target >= 0 && target < list.length ? [list[target]] : [];
}

// ---------------- 内容提取：text / textNodes / ownText / html / all / href / src / 属性名 ----------------
export const RULE_EXTRACT_MODES = {
  text: 1,
  textNodes: 1,
  ownText: 1,
  html: 1,
  all: 1,
  outerHtml: 1,
  href: 1,
  src: 1,
  content: 1,
  value: 1,
  title: 1,
  alt: 1,
  data: 1
};

export function isExtractMode(segment) {
  const text = String(segment || "").trim();
  if (!text || text.indexOf(".") !== -1 || text.indexOf("[") !== -1) return false;
  return Object.prototype.hasOwnProperty.call(RULE_EXTRACT_MODES, text);
}

// 末段属性名兜底：legado 的 Default 模式里，链末段除特殊模式（text/html/...）外一律按
// 「属性名」处理（element.attr(name)），真实书源依赖它取自定义属性（如 ReadNovelFull 的
// {{@@#rating@data-novel-id}}）。这里只把「不像选择器」的纯标识符归为属性名：
// class./tag./id. 简写、带索引、组合选择器、伪类等仍维持选择器语义。
export function isAttributeNameSegment(segment) {
  const text = String(segment || "").trim();
  if (!text) return false;
  if (isExtractMode(text) || text === "children") return false;
  if (/[.\[\]#>:\s(]/.test(text)) return false;
  return true;
}

// 块级标签：提取文本时在其前面补换行，避免 <p> / <br> 分隔的正文粘成一整行
export const BLOCK_LEVEL_TAGS = {
  P: 1,
  DIV: 1,
  BR: 1,
  LI: 1,
  UL: 1,
  OL: 1,
  DL: 1,
  DT: 1,
  DD: 1,
  H1: 1,
  H2: 1,
  H3: 1,
  H4: 1,
  H5: 1,
  H6: 1,
  TR: 1,
  TD: 1,
  TH: 1,
  TABLE: 1,
  TBODY: 1,
  THEAD: 1,
  SECTION: 1,
  ARTICLE: 1,
  BLOCKQUOTE: 1,
  PRE: 1,
  HR: 1
};

// 块级感知的文本提取：等价于浏览器 innerText 的换行语义（textContent 不含换行，
// 会让 <br> / <p> 分隔的正文在阅读窗里粘成一坨）。
export function extractNodeText(node) {
  if (!node) return "";
  if (node.nodeType === 3) return node.data || "";
  if (node.nodeType !== 1) return node.textContent || "";
  const tag = node.nodeName ? String(node.nodeName).toUpperCase() : "";
  let out = BLOCK_LEVEL_TAGS[tag] ? "\n" : "";
  const children = node.childNodes || [];
  for (let i = 0; i < children.length; i += 1) out += extractNodeText(children[i]);
  return out;
}

export function extractFromNode(node, mode) {
  if (!node) return "";
  const key = String(mode || "text").trim() || "text";
  if (node.nodeType === 2) return node.value || ""; // 属性节点
  if (node.nodeType === 3) return node.data || ""; // 文本节点
  if (key === "text" || key === "textNodes") return extractNodeText(node).trim();
  if (key === "ownText") {
    let out = "";
    const children = node.childNodes || [];
    for (let i = 0; i < children.length; i += 1) {
      if (children[i].nodeType === 3) out += children[i].data || "";
    }
    return out;
  }
  if (key === "html") return node.innerHTML || "";
  if (key === "all" || key === "outerHtml") return node.outerHTML || node.textContent || "";
  if (node.getAttribute) return node.getAttribute(key) || "";
  return "";
}

// ---------------- CSS 选择器（含 legado / jsoup 扩展伪类） ----------------
// legado 把 @css: 与 Default 的选择器直接交给 jsoup，因此这里按 jsoup 求值器语义
// 补上宿主原生不支持的扩展伪类（对应 jsoup 1.x Evaluator，与真实 legado 行为一致）：
//   :eq(n) / :gt(n) / :lt(n)      元素在父节点中的元素序号（0 基，jsoup elementSiblingIndex）
//   :contains(t) / :containsOwn(t)  元素文本（含/不含后代）小写包含，空白归一
//   :matches(re) / :matchesOwn(re)  元素文本（含/不含后代）正则 find（部分匹配）
// :has / :not / :is / :nth-child 等由宿主原生 querySelectorAll 处理。
// 组合器（空格 / > / + / ~）按段求值；顶层逗号分组按并集合并并保持文档顺序。
// 规模护栏：参与判定的文本/属性值超过 PSEUDO_TEXT_MAX、或单段候选集超过
// PSEUDO_CANDIDATE_MAX 时直接判不匹配/停止扫描（各限次上报），防渲染线程被拖满。
export const INDEX_PSEUDO_RE = /:(?:eq|gt|lt|contains|containsOwn|matches|matchesOwn)\s*\(/;
export const TAKEOVER_PSEUDO = { eq: 1, gt: 1, lt: 1, contains: 1, containsOwn: 1, matches: 1, matchesOwn: 1 };
// jsoup 的属性正则选择器 [key~=regex]：jsoup 语义是对属性值跑正则 find，
// 而 CSS 标准把 ~= 当「空白分词字面匹配」，宿主原生实现会静默失配，因此同样接管。
export const ATTR_REGEX_RE = /\[[^\]]*~=/;

// 嵌套伪类：jsoup 允许 :not(:contains(...)) / :has(span:contains(...)) 这类组合，宿主原生
// 选择器只认标准伪类，整串交给 querySelectorAll 会抛 SyntaxError。参数中带接管语法
// （扩展伪类 / 属性正则）的 :not/:has/:is/:where 从核心选择器里摘出，改为候选元素上的
// 后置条件；参数不含接管语法的调用保持原样，仍由宿主原生求值。
export const NESTED_PSEUDO_RE = /:(?:not|has|is|where)\s*\(/;

export function compileJsRegex(source) {
  if (!source) return null;
  // 统一受控编译：:matches / [attr~=re] 的 pattern 来自第三方书源，
  // 静态检查会拒绝嵌套无界量词、重叠分支等灾难性回溯构造。
  return compileGuardedRegex(source, "");
}

// jsoup Element#elementSiblingIndex：元素在父节点元素子列表中的序号（无父节点为 0）
export function nodeSiblingIndex(el) {
  const parent = el && el.parentNode;
  if (!parent || !parent.children) return 0;
  const kids = parent.children;
  for (let i = 0; i < kids.length; i += 1) if (kids[i] === el) return i;
  return 0;
}

// 元素自身的直接文本（不含后代），对应 jsoup Element#ownText 的简化形态
export function ownTextOfNode(el) {
  let out = "";
  const children = el.childNodes || [];
  for (let i = 0; i < children.length; i += 1) {
    if (children[i].nodeType === 3) out += children[i].data || "";
  }
  return out;
}

// jsoup 的 :contains 匹配前会把两侧文本归一化空白并转小写（ContainsText evaluator）
export function normalizePseudoText(text) {
  return String(text == null ? "" : text)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// 顶层逗号分组：引号 / 括号 / 方括号内的逗号不参与切分（td:eq(0),td:eq(5)）
export function splitCssGroups(text) {
  const out = [];
  let buf = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quote) {
      buf += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(" || ch === "[") {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map((item) => item.trim()).filter(Boolean);
}

// 组合器分段：把选择器切成 [{combinator, segment}]（空白 / > / + / ~，引号与括号内不拆）
export function splitCssSegments(text) {
  const segments = [];
  let buf = "";
  let depth = 0;
  let quote = "";
  let pendingComb = "";
  const flush = () => {
    const seg = buf.trim();
    if (seg) {
      segments.push({ combinator: pendingComb, segment: seg });
      pendingComb = "";
    }
    buf = "";
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quote) {
      buf += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(" || ch === "[") {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }
    if (depth === 0) {
      if (ch === ">" || ch === "+" || ch === "~") {
        flush();
        pendingComb = ch;
        continue;
      }
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        if (buf.trim()) {
          flush();
          if (!pendingComb) pendingComb = " ";
        }
        continue;
      }
    }
    buf += ch;
  }
  flush();
  return segments;
}

// 段尾伪类调用：li:eq(0) → { core: "li", cond: { name: "eq", num: 0 } }（引号内括号不参与深度计数）
export function matchTrailingPseudoCall(text) {
  if (text.charAt(text.length - 1) !== ")") return null;
  let depth = 0;
  let openIdx = -1;
  let quote = "";
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const ch = text.charAt(i);
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ")") depth += 1;
    else if (ch === "(") {
      depth -= 1;
      if (depth === 0) {
        openIdx = i;
        break;
      }
    }
  }
  if (openIdx <= 0) return null;
  const head = text.slice(0, openIdx);
  const nameMatch = /:([A-Za-z][A-Za-z0-9-]*)$/.exec(head);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  if (!TAKEOVER_PSEUDO[name]) return null;
  const arg = text.slice(openIdx + 1, text.length - 1).trim();
  return { core: head.slice(0, head.length - nameMatch[0].length), cond: buildPseudoCond(name, arg) };
}

export function buildPseudoCond(name, arg) {
  if (name === "eq" || name === "gt" || name === "lt") {
    const n = Number(arg);
    return { name: name, num: arg !== "" && isFinite(n) ? n : NaN };
  }
  if (name === "matches" || name === "matchesOwn") {
    return { name: name, arg: arg, regex: compileJsRegex(arg) };
  }
  return { name: name, arg: arg };
}

// 剥掉段尾的接管伪类链（可能多个，如 :gt(0):lt(5)）
export function splitTrailingConditions(segment) {
  let core = String(segment || "").trim();
  const conds = [];
  while (core) {
    const parsed = matchTrailingPseudoCall(core);
    if (!parsed) break;
    conds.unshift(parsed.cond);
    core = parsed.core.trim();
  }
  return { core: core, conds: conds };
}

// ---------------- 嵌套伪类条件：:not(...) / :has(...) / :is(...) / :where(...) ----------------
// 参数内出现接管语法时，原生选择器无法求值（Chromium 对 :contains/:eq 直接抛 SyntaxError，
// 旧实现吞掉异常返回空列表）。这里把整个伪类调用从核心选择器中摘出，改由候选元素逐个判定。
let pseudoSelectorSkipReported = false;

function reportSelectorSkip(selector) {
  if (pseudoSelectorSkipReported || typeof pseudoSkipLog !== "function") return;
  pseudoSelectorSkipReported = true;
  pseudoSkipLog("selector skipped: unsupported syntax", String(selector || "").slice(0, 80));
}

function hasTakeoverSyntax(text) {
  return INDEX_PSEUDO_RE.test(text) || ATTR_REGEX_RE.test(text) || NESTED_PSEUDO_RE.test(text);
}

// 从 openIdx 处的 "(" 起找配对右括号（忽略引号与属性选择器内的括号）；未闭合返回 -1
function findClosingParen(text, openIdx) {
  let depth = 0;
  let quote = "";
  let bracket = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "[") {
      bracket += 1;
      continue;
    }
    if (ch === "]") {
      bracket = Math.max(0, bracket - 1);
      continue;
    }
    if (bracket > 0) continue;
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// 摘出核心选择器中「参数含接管语法」的顶层 :not/:has/:is/:where，返回 { core, conds }。
// 参数不含接管语法的调用原样保留在 core 里，交给宿主原生处理。
export function extractNestedPseudoConds(selector) {
  const text = String(selector || "");
  let core = "";
  const conds = [];
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quote) {
      core += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      core += ch;
      continue;
    }
    if (ch === "[") {
      // 属性选择器整体保留：里面的伪类字样不是选择器语法
      let innerQuote = "";
      let close = -1;
      for (let j = i + 1; j < text.length; j += 1) {
        const inner = text.charAt(j);
        if (innerQuote) {
          if (inner === innerQuote) innerQuote = "";
          continue;
        }
        if (inner === '"' || inner === "'") {
          innerQuote = inner;
          continue;
        }
        if (inner === "]") {
          close = j;
          break;
        }
      }
      if (close === -1) {
        core += text.slice(i);
        break;
      }
      core += text.slice(i, close + 1);
      i = close;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      core += ch;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      core += ch;
      continue;
    }
    if (depth === 0 && ch === ":") {
      const match = /^:(not|has|is|where)\s*\(/i.exec(text.slice(i));
      if (match) {
        const openIdx = i + match[0].length - 1;
        const closeIdx = findClosingParen(text, openIdx);
        if (closeIdx !== -1) {
          const arg = text.slice(openIdx + 1, closeIdx).trim();
          if (arg && hasTakeoverSyntax(arg)) {
            conds.push({ name: match[1].toLowerCase(), arg: arg });
            i = closeIdx;
            continue;
          }
          core += text.slice(i, closeIdx + 1);
          i = closeIdx;
          continue;
        }
      }
    }
    core += ch;
  }
  return { core: core.trim(), conds: conds };
}

// 嵌套伪类求值深度上限：只防御病态嵌套（每层参数都是严格变短的子串，正常写法远达不到），
// 不参与普通组合器分段的计数，避免误伤合法的长选择器。
const MAX_NESTED_EVAL_DEPTH = 8;
let nestedEvalDepth = 0;

// 单个组合器段对指定元素的判定：段尾接管伪类、属性正则与嵌套伪类在这里统一收口。
export function matchesSelectorSegment(el, segment) {
  if (!el || el.nodeType !== 1) return false;
  const parsed = splitTrailingConditions(segment);
  const nested = extractNestedPseudoConds(parsed.core);
  const attr = extractAttrRegexConds(nested.core);
  let core = attr.core;
  const conds = parsed.conds.concat(nested.conds, attr.conds);
  if (!core) {
    if (!conds.length) return true;
    core = "*";
  }
  if (!matchesSelectorText(el, core)) return false;
  return conditionsMatch(el, conds);
}

// 按组合器从右向左回溯：el 命中 segs[index] 后，再验证祖先或前兄弟是否命中前面的段。
function matchesSegmentsAt(el, segs, index) {
  if (!el || el.nodeType !== 1) return false;
  if (!matchesSelectorSegment(el, segs[index].segment)) return false;
  if (index === 0) return true;
  const combinator = segs[index].combinator;
  if (combinator === ">") return matchesSegmentsAt(el.parentNode, segs, index - 1);
  if (combinator === "+") return matchesSegmentsAt(el.previousElementSibling, segs, index - 1);
  if (combinator === "~") {
    let prev = el.previousElementSibling;
    while (prev) {
      if (matchesSegmentsAt(prev, segs, index - 1)) return true;
      prev = prev.previousElementSibling;
    }
    return false;
  }
  let parent = el.parentNode;
  while (parent && parent.nodeType === 1) {
    if (matchesSegmentsAt(parent, segs, index - 1)) return true;
    parent = parent.parentNode;
  }
  return false;
}

// 元素是否命中参数选择器（顶层逗号分组取并集）
export function matchesPseudoArgument(el, arg) {
  const groups = splitCssGroups(String(arg || ""));
  for (let g = 0; g < groups.length; g += 1) {
    const segs = splitCssSegments(groups[g]);
    if (!segs.length) continue;
    if (matchesSegmentsAt(el, segs, segs.length - 1)) return true;
  }
  return false;
}

// 段内是否只剩伪类/属性条件（没有元素、类、id 等结构选择器）
function isPseudoOnlySegment(segment) {
  const parsed = splitTrailingConditions(segment);
  const nested = extractNestedPseudoConds(parsed.core);
  const attr = extractAttrRegexConds(nested.core);
  return !attr.core && parsed.conds.length + nested.conds.length + attr.conds.length > 0;
}

// 纯条件段（如 :contains(x)）在 :has 里需要扫描全部后代；selectDescendants 的空核心语义
// 是「直接子元素」，不能直接复用。
function descendantMatchesPseudoOnly(el, segment) {
  const pool = toNodeArray(el.querySelectorAll("*"));
  for (let i = 0; i < pool.length; i += 1) {
    if (i >= PSEUDO_CANDIDATE_MAX) {
      reportSelectorSkip(segment);
      break;
    }
    if (matchesSelectorSegment(pool[i], segment)) return true;
  }
  return false;
}

// :has 的后代存在性：cssQuery(el, selector) 首段会把 el 自身并入，这里排除自身。
function withinMatches(el, selector) {
  const found = cssQuery(el, selector);
  for (let i = 0; i < found.length; i += 1) {
    if (found[i] !== el) return true;
  }
  return false;
}

// 元素是否命中 :has(...) 参数（jsoup 语义：后代存在匹配项；支持 > 直接子代）
export function hasPseudoArgument(el, arg) {
  if (!el || el.nodeType !== 1) return false;
  const groups = splitCssGroups(String(arg || ""));
  for (let g = 0; g < groups.length; g += 1) {
    let text = String(groups[g] || "").trim();
    if (!text) continue;
    if (text.charAt(0) === ">") {
      text = text.slice(1).trim();
      const segs = splitCssSegments(text);
      if (!segs.length) continue;
      // 多段相对选择器（如 > div span）的组合语义不在本次接管范围，显式告警并跳过
      if (segs.length > 1) {
        reportSelectorSkip(groups[g]);
        continue;
      }
      const kids = toNodeArray(el.children);
      for (let i = 0; i < kids.length; i += 1) {
        if (matchesSelectorSegment(kids[i], text)) return true;
      }
      continue;
    }
    if (text.charAt(0) === "+" || text.charAt(0) === "~") {
      reportSelectorSkip(groups[g]);
      continue;
    }
    const segs = splitCssSegments(text);
    if (segs.length === 1 && segs[0].combinator === "" && isPseudoOnlySegment(text)) {
      if (descendantMatchesPseudoOnly(el, text)) return true;
      continue;
    }
    if (!hasTakeoverSyntax(text)) {
      try {
        if (el.querySelector(text)) return true;
        continue;
      } catch (err) {
        // 宿主不支持该写法时退回逐元素判定
      }
    }
    if (withinMatches(el, text)) return true;
  }
  return false;
}

// 提取段内的 jsoup 属性正则条件 [key~=regex]（仅括号外，引号内不处理），返回 { core, conds }。
// 剥离后核心为空的场景由调用方按「任意元素」处理（jsoup 里 [key~=re] 独立使用时匹配范围内
// 所有含该属性且值命中正则的元素）。
export function extractAttrRegexConds(segment) {
  const text = String(segment || "");
  const conds = [];
  let core = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quote) {
      core += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      core += ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      core += ch;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      core += ch;
      continue;
    }
    if (ch === "[" && depth === 0) {
      let innerQuote = "";
      let close = -1;
      for (let j = i + 1; j < text.length; j += 1) {
        const inner = text.charAt(j);
        if (innerQuote) {
          if (inner === innerQuote) innerQuote = "";
          continue;
        }
        if (inner === '"' || inner === "'") {
          innerQuote = inner;
          continue;
        }
        if (inner === "]") {
          close = j;
          break;
        }
      }
      if (close === -1) {
        core += ch;
        continue;
      }
      const attrMatch = /^([^\s~=]+)\s*~=\s*([\s\S]+)$/.exec(text.slice(i + 1, close));
      if (attrMatch) {
        conds.push({ name: "attrRegex", key: attrMatch[1], arg: attrMatch[2], regex: compileJsRegex(attrMatch[2]) });
        i = close;
        continue;
      }
      core += text.slice(i, close + 1);
      i = close;
      continue;
    }
    core += ch;
  }
  return { core: core.trim(), conds: conds };
}

export function conditionsMatch(el, conds) {
  for (let c = 0; c < conds.length; c += 1) {
    const cond = conds[c];
    if (cond.name === "attrRegex") {
      if (!cond.regex || !el.getAttribute || !el.hasAttribute || !el.hasAttribute(cond.key)) return false;
      const attrValue = String(el.getAttribute(cond.key) || "");
      // 属性值超长判不匹配：书源正则任意，灾难性回溯只能靠限制输入规模兜底（限次上报）
      if (attrValue.length > PSEUDO_TEXT_MAX) {
        if (!pseudoAttrSkipReported && typeof pseudoSkipLog === "function") {
          pseudoAttrSkipReported = true;
          pseudoSkipLog("pseudo cond skipped: attr value too long", attrValue.length, cond.key);
        }
        return false;
      }
      cond.regex.lastIndex = 0;
      try {
        if (!cond.regex.test(attrValue)) return false;
      } catch (err) {
        return false;
      }
      continue;
    }
    if (cond.name === "not" || cond.name === "is" || cond.name === "where" || cond.name === "has") {
      if (nestedEvalDepth >= MAX_NESTED_EVAL_DEPTH) {
        reportSelectorSkip(cond.arg);
        return false;
      }
      nestedEvalDepth += 1;
      let matched = false;
      try {
        matched = cond.name === "has" ? hasPseudoArgument(el, cond.arg) : matchesPseudoArgument(el, cond.arg);
      } finally {
        nestedEvalDepth -= 1;
      }
      if (cond.name === "not") {
        if (matched) return false;
      } else if (!matched) {
        return false;
      }
      continue;
    }
    if (cond.name === "eq" || cond.name === "gt" || cond.name === "lt") {
      if (!isFinite(cond.num)) return false;
      const idx = nodeSiblingIndex(el);
      if (cond.name === "eq") {
        if (idx !== cond.num) return false;
      } else if (cond.name === "gt") {
        if (!(idx > cond.num)) return false;
      } else if (!(idx < cond.num)) return false;
      continue;
    }
    const own = cond.name === "containsOwn" || cond.name === "matchesOwn";
    const text = own ? ownTextOfNode(el) : el.textContent || "";
    // 文本超长判不匹配（对齐 PURIFY_TEXT_MAX 约定）：超长输入多来自劣质书源命中大容器，
    // 逐候选跑正则/归一化会在渲染线程成倍叠加（限次上报）
    if (text.length > PSEUDO_TEXT_MAX) {
      if (!pseudoTextSkipReported && typeof pseudoSkipLog === "function") {
        pseudoTextSkipReported = true;
        pseudoSkipLog("pseudo cond skipped: text too long", text.length, cond.name);
      }
      return false;
    }
    if (cond.name === "contains" || cond.name === "containsOwn") {
      if (normalizePseudoText(text).indexOf(normalizePseudoText(cond.arg)) === -1) return false;
    } else {
      if (!cond.regex) return false;
      cond.regex.lastIndex = 0;
      try {
        if (!cond.regex.test(text)) return false;
      } catch (err) {
        return false;
      }
    }
  }
  return true;
}

export function selectDescendants(base, core) {
  if (!core) return toNodeArray(base.children);
  try {
    return toNodeArray(base.querySelectorAll(core));
  } catch (err) {
    reportSelectorSkip(core);
    return [];
  }
}

export function selectChildren(base, core) {
  if (!core) return toNodeArray(base.children);
  try {
    return toNodeArray(base.querySelectorAll(":scope > " + core));
  } catch (err) {
    const out = [];
    const kids = toNodeArray(base.children);
    for (let i = 0; i < kids.length; i += 1) if (matchesSelectorText(kids[i], core)) out.push(kids[i]);
    return out;
  }
}

export function matchesSelectorText(el, core) {
  if (!core) return true;
  try {
    return typeof el.matches === "function" && el.matches(core);
  } catch (err) {
    reportSelectorSkip(core);
    return false;
  }
}

export function selectLateral(base, combinator, core) {
  const out = [];
  if (combinator === "+") {
    const next = base.nextElementSibling;
    if (next && matchesSelectorText(next, core)) out.push(next);
    return out;
  }
  let sib = base.nextElementSibling;
  while (sib) {
    if (matchesSelectorText(sib, core)) out.push(sib);
    sib = sib.nextElementSibling;
  }
  return out;
}

// 去重并恢复文档顺序（去重按引用，排序用 compareDocumentPosition）
export function dedupeDocOrder(list) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const node = list[i];
    if (!node || seen.has(node)) continue;
    seen.add(node);
    out.push(node);
  }
  if (out.length > 1 && typeof out[0].compareDocumentPosition === "function") {
    try {
      out.sort((a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1));
    } catch (err) {
      // 排序失败时保持插入顺序
    }
  }
  return out;
}

export function querySegment(bases, combinator, segment) {
  const parsed = splitTrailingConditions(segment);
  const nested = extractNestedPseudoConds(parsed.core);
  const attr = extractAttrRegexConds(nested.core);
  let core = attr.core;
  // 核心被 [key~=re] 或嵌套伪类条件剥空时按「任意元素」处理；仅索引伪类且核心为空时
  // 保持 legado 的 children 语义（阅读写法 .0 / !0）。
  if (!core && (attr.conds.length || nested.conds.length)) core = "*";
  const conds = parsed.conds.concat(nested.conds, attr.conds);
  const out = [];
  // 候选集规模护栏：跨 base 累计（含 [base].concat 并入的首元素 base），超限停止扫描
  // 后续 base 并保留已命中项，防止全页通配在大文档上把逐元素 test 叠加成O(n^2)量级
  // 的同步开销（限次上报）。
  let candidateTotal = 0;
  let candidatesTruncated = false;
  for (let b = 0; b < bases.length && !candidatesTruncated; b += 1) {
    const base = bases[b];
    if (!base) continue;
    let found;
    if (combinator === ">") found = selectChildren(base, core);
    else if (combinator === "+" || combinator === "~") found = selectLateral(base, combinator, core);
    else {
      found = selectDescendants(base, core);
      // 首段（combinator 为空串）的 base 即查询起点，自身命中核心时并入候选首位（文档序由 dedupeDocOrder 统一恢复）：
      // 对齐 cssQuery 原生分支声明的 jsoup「select 含节点自身」语义，与 fast path、tag/class 糖共同闭环；后代分隔（" "）不受影响。
      if (combinator === "" && base.nodeType === 1 && matchesSelectorText(base, core)) found = [base].concat(found);
    }
    for (let f = 0; f < found.length; f += 1) {
      candidateTotal += 1;
      if (candidateTotal > PSEUDO_CANDIDATE_MAX) {
        candidatesTruncated = true;
        if (!pseudoCandidateSkipReported && typeof pseudoSkipLog === "function") {
          pseudoCandidateSkipReported = true;
          pseudoSkipLog("pseudo cond skipped: candidates too many", bases.length, candidateTotal, String(segment || "").slice(0, 80));
        }
        break;
      }
      if (conditionsMatch(found[f], conds)) out.push(found[f]);
    }
  }
  return dedupeDocOrder(out);
}

export function cssQuery(root, selector) {
  const text = String(selector || "").trim();
  if (!root || !text || typeof root.querySelectorAll !== "function") return [];
  // 无扩展伪类与属性正则时走原生查询（与历史行为完全一致）
  if (!INDEX_PSEUDO_RE.test(text) && !ATTR_REGEX_RE.test(text)) {
    try {
      // jsoup select 含节点自身（Matched elements may include this element, or any of its descendents）；
      // 浏览器 querySelectorAll 只查后代，元素根上补自身匹配。
      const out = [];
      if (root.nodeType === 1 && typeof root.matches === "function" && root.matches(text)) out.push(root);
      const desc = root.querySelectorAll(text);
      for (let i = 0; i < desc.length; i += 1) out.push(desc[i]);
      return out;
    } catch (err) {
      return [];
    }
  }
  const groups = splitCssGroups(text);
  const merged = [];
  for (const group of groups) {
    const segs = splitCssSegments(group);
    if (!segs.length) continue;
    let nodes = [root];
    for (const seg of segs) {
      nodes = querySegment(nodes, seg.combinator, seg.segment);
      if (!nodes.length) break;
    }
    for (const node of nodes) merged.push(node);
  }
  return dedupeDocOrder(merged);
}


// 日志通道由引擎注入（模块层不直接持有 api）。
export function setPseudoSkipLog(log) {
  pseudoSkipLog = typeof log === "function" ? log : null;
}

