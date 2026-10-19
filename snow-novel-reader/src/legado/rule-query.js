// 规则查询层：Default/CSS/XPath/JSONPath 的定位与索引裁剪。
import { cssQuery, toNodeArray } from "./dom.js";

export function splitCssRule(body) {
  const text = String(body || "").trim();
  const index = text.lastIndexOf("@");
  if (index === -1) return { selector: text, mode: "text" };
  return { selector: text.slice(0, index).trim(), mode: text.slice(index + 1).trim() || "text" };
}

// ---------------- Default(JSOUP) 规则段 ----------------
// legado 的 Default 规则 = 「核心选择器 + 尾部索引」两层：
//   核心：class/tag/id/text/children 简写（legado 写法糖），或标准 CSS（含 jsoup 扩展伪类）
//   索引（legado ElementsSingle.findIndexSet 语义，作用于核心命中的元素列表）：
//     - 阅读写法：a.0:1:2（选这些下标）/ a!0:1（排除），下标可为负（-1 为末尾）
//     - 括号写法：a[0,2:4,-1] / a[!0:2]，支持区间 start:end:step，反向区间 [-1:0] 可整体倒序
//   选择写法按书写顺序取元素（去重）；排除写法剔除对应下标后保持原序。
export function parseBracketIndex(inner) {
  let text = String(inner == null ? "" : inner).trim();
  if (!text) return null;
  let mode = "select";
  if (text.charAt(0) === "!") {
    mode = "exclude";
    text = text.slice(1).trim();
  }
  if (!text || !/^[\d\s:,-]+$/.test(text)) return null;
  const items = [];
  for (const piece of text.split(",")) {
    const part = piece.trim();
    if (!part) continue;
    if (part.indexOf(":") === -1) {
      if (!/^-?\d+$/.test(part)) return null;
      items.push({ kind: "index", n: Number(part) });
      continue;
    }
    const segs = part.split(":");
    if (segs.length > 3) return null;
    const nums = segs.map((seg) => {
      const value = seg.trim();
      if (value === "") return null;
      return /^-?\d+$/.test(value) ? Number(value) : NaN;
    });
    if (nums.some((n) => n !== null && !isFinite(n))) return null;
    if (nums.every((n) => n === null)) return null;
    items.push({
      kind: "range",
      start: nums.length > 0 ? nums[0] : null,
      end: nums.length > 1 ? nums[1] : null,
      step: nums.length > 2 && nums[2] !== null ? nums[2] : 1
    });
  }
  if (!items.length) return null;
  return { mode: mode, items: items };
}

// 剥离规则尾部的索引（先括号写法，再阅读写法），返回 { body, index }
export function stripRuleIndex(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return { body: text, index: null };
  if (text.charAt(text.length - 1) === "]") {
    let depth = 0;
    let open = -1;
    for (let i = text.length - 1; i >= 0; i -= 1) {
      const ch = text.charAt(i);
      if (ch === "]") depth += 1;
      else if (ch === "[") {
        depth -= 1;
        if (depth === 0) {
          open = i;
          break;
        }
      }
    }
    if (open !== -1) {
      const parsedBracket = parseBracketIndex(text.slice(open + 1, text.length - 1));
      if (parsedBracket) return { body: text.slice(0, open).trim(), index: parsedBracket };
    }
  }
  const match = /^(.*?)([.!])(-?\d+(?::-?\d+)*)$/.exec(text);
  if (match) {
    const nums = match[3].split(":").map((item) => Number(item));
    if (nums.length && nums.every((n) => isFinite(n))) {
      return {
        body: match[1].trim(),
        index: { mode: match[2] === "!" ? "exclude" : "select", items: nums.map((n) => ({ kind: "index", n: n })) }
      };
    }
  }
  return { body: text, index: null };
}

// 展开索引项为下标集合（legado 语义：越界忽略，区间端点自动 clamp，步长不小于列表长度时只取起点）
export function expandRuleIndexItems(items, len) {
  const set = new Set();
  if (!len) return set;
  for (const item of items) {
    if (item.kind === "index") {
      let n = item.n;
      if (n < 0) n += len;
      if (n >= 0 && n < len) set.add(n);
      continue;
    }
    let start = item.start === null || item.start === undefined ? 0 : item.start;
    if (start < 0) start += len;
    let end = item.end === null || item.end === undefined ? len - 1 : item.end;
    if (end < 0) end += len;
    if ((start < 0 && end < 0) || (start >= len && end >= len)) continue;
    if (start >= len) start = len - 1;
    else if (start < 0) start = 0;
    if (end >= len) end = len - 1;
    else if (end < 0) end = 0;
    const step = Math.abs(item.step || 1) || 1;
    if (start === end || step >= len) {
      set.add(start);
      continue;
    }
    if (end > start) {
      for (let i = start; i <= end; i += step) set.add(i);
    } else {
      for (let i = start; i >= end; i -= step) set.add(i);
    }
  }
  return set;
}

export function applyRuleIndex(list, index) {
  if (!index) return list;
  const set = expandRuleIndexItems(index.items, list.length);
  if (index.mode === "exclude") return list.filter((_, i) => !set.has(i));
  const out = [];
  set.forEach((i) => out.push(list[i]));
  return out;
}

// 核心选择器：空/children → 直接子元素；class/tag/id/text 糖；其余走 cssQuery
export function queryRuleCore(root, body) {
  const text = String(body || "").trim();
  if (!text || text === "children") return toNodeArray(root.children);
  const sugar = /^(class|tag|id|text)\.([\s\S]+)$/.exec(text);
  if (sugar) {
    const type = sugar[1];
    const name = sugar[2].split(".")[0];
    try {
      // jsoup 语义（getElementsByClass / getElementsByTag / getElementById）命中范围含节点自身；
      // 浏览器对应 API 只查后代，这里补「自身优先」以对齐 legado（节点自身即目标时字段规则可命中）。
      if (type === "class") {
        const out = [];
        // jsoup Element#hasClass 语义：class 属性整串相等（忽略大小写），或按空白拆分的某个完整
        // 类名相等；命中范围含节点自身。多类名查询（如 "box chapter"）据此命中 class="box chapter"
        // 的节点自身（浏览器 getElementsByClassName 只查后代、且不支持含空格的整串查询）。
        if (root.getAttribute) {
          const attr = String(root.getAttribute("class") || "");
          const want = name.toLowerCase();
          if (attr && attr.toLowerCase() === want) out.push(root);
          else if (attr) {
            const tokens = attr.split(/\s+/).filter(Boolean);
            for (let t = 0; t < tokens.length; t += 1) {
              if (tokens[t].toLowerCase() === want) { out.push(root); break; }
            }
          }
        }
        const found = root.getElementsByClassName ? root.getElementsByClassName(name) : [];
        for (let i = 0; i < found.length; i += 1) out.push(found[i]);
        return out;
      }
      if (type === "tag") {
        const out = [];
        if (root.tagName && String(root.tagName).toLowerCase() === String(name).toLowerCase()) out.push(root);
        const found = root.getElementsByTagName(name);
        for (let i = 0; i < found.length; i += 1) out.push(found[i]);
        return out;
      }
      if (type === "id") {
        if (root.id && root.id === name) return [root];
        const found = root.querySelector ? root.querySelector("#" + name) : null;
        return found ? [found] : [];
      }
      return toNodeArray(root.getElementsByTagName("*")).filter((el) => (el.textContent || "").indexOf(name) !== -1);
    } catch (err) {
      return [];
    }
  }
  return cssQuery(root, text);
}

export function defaultQuery(root, segment) {
  const text = String(segment || "").trim();
  if (!root || !text) return [];
  const stripped = stripRuleIndex(text);
  const list = queryRuleCore(root, stripped.body);
  return applyRuleIndex(list, stripped.index);
}

// ---------------- XPath（浏览器原生 document.evaluate） ----------------
// 关键：书源里的 XPath 多为 //h3/a/text() 这类写法，但列表项字段规则是在「单个书籍/章节节点」
// 上求值的。若直接交给 document.evaluate，// 会从文档根查找，导致每本书都匹配到全文档的
// 第一个元素（所有书名相同）。因此在元素上下文里把前导 // 改写为 .//（相对当前节点），
// 在 document 上下文里保持原样。
export function xpathQuery(root, expression) {
  const text = String(expression || "").trim();
  if (!root || !text) return [];
  const doc = root.ownerDocument || root;
  if (!doc || typeof doc.evaluate !== "function") return [];
  const isDocument = root.nodeType === 9;
  let expr = text;
  if (!isDocument && expr.indexOf("//") === 0) expr = "." + expr;
  try {
    // ORDERED_NODE_SNAPSHOT_TYPE = 7
    const result = doc.evaluate(expr, root, null, 7, null);
    const out = [];
    for (let i = 0; i < result.snapshotLength; i += 1) out.push(result.snapshotItem(i));
    return out;
  } catch (err) {
    return [];
  }
}

// ---------------- JSONPath 简化子集：$.a.b / $..a / [n] / [*] ----------------
export function parseJsonPathSteps(expression) {
  let expr = String(expression || "").trim();
  expr = expr.replace(/^@json:/, "").trim();
  if (expr.charAt(0) === "$") expr = expr.slice(1);
  const steps = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr.charAt(i);
    if (ch === ".") {
      if (expr.charAt(i + 1) === ".") {
        i += 2;
        const match = /^[^.\[\]]+/.exec(expr.slice(i));
        if (match) {
          steps.push({ type: "descend", key: match[0] });
          i += match[0].length;
        }
        continue;
      }
      i += 1;
      const match = /^[^.\[\]]+/.exec(expr.slice(i));
      if (match) {
        steps.push({ type: "key", key: match[0] });
        i += match[0].length;
      }
      continue;
    }
    if (ch === "[") {
      const close = expr.indexOf("]", i);
      if (close === -1) break;
      const inner = expr.slice(i + 1, close).trim();
      if (inner === "*") steps.push({ type: "all" });
      else if (inner !== "") steps.push({ type: "index", index: Number(inner) });
      i = close + 1;
      continue;
    }
    i += 1;
  }
  return steps;
}

export function collectDescendKey(node, key, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectDescendKey(item, key, out);
    return;
  }
  for (const name of Object.keys(node)) {
    if (name === key) out.push(node[name]);
    collectDescendKey(node[name], key, out);
  }
}

export function jsonPathQuery(data, expression) {
  const steps = parseJsonPathSteps(expression);
  if (!steps.length) return [];
  let current = [data];
  for (const step of steps) {
    const next = [];
    for (const node of current) {
      if (step.type === "key") {
        if (node && typeof node === "object" && !Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, step.key)) {
          next.push(node[step.key]);
        }
      } else if (step.type === "index") {
        if (Array.isArray(node)) {
          const target = step.index < 0 ? node.length + step.index : step.index;
          if (target >= 0 && target < node.length) next.push(node[target]);
        }
      } else if (step.type === "all") {
        if (Array.isArray(node)) {
          for (const item of node) next.push(item);
        } else if (node && typeof node === "object") {
          for (const name of Object.keys(node)) next.push(node[name]);
        }
      } else if (step.type === "descend") {
        collectDescendKey(node, step.key, next);
      }
    }
    current = next;
  }
  return current;
}
