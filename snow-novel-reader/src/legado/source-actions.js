// 书源业务动作：搜索、目录与正文解析。
import { defaultQuery, jsonPathQuery, splitCssRule, stripRuleIndex, xpathQuery } from "./rule-query.js";
import { ruleRoot, ruleSourceKind, ruleString, ruleStringList, splitRuleTopLevel } from "./rule-eval.js";
import { cssQuery, isExtractMode, toNodeArray } from "./dom.js";
import { resolveSourceUrl } from "./source-request.js";
import { applyPurify } from "./purify.js";

// ==================== 书源：业务动作 ====================
// 解析响应文本：JSON 走 JSONPath，其余按 HTML 建 DOM
export function buildSourceContext(text, contentType, baseUrl) {
  const raw = String(text == null ? "" : text);
  // baseUrl：当前响应/文档的地址，供字段规则模板 {{baseUrl}} 使用（legado setContent 的 baseUrl）
  const context = { text: raw, doc: null, root: null, json: null, baseUrl: typeof baseUrl === "string" ? baseUrl : "" };
  const trimmed = raw.trim();
  const looksJson = /^[[{]/.test(trimmed);
  if (looksJson) {
    try {
      context.json = JSON.parse(trimmed);
    } catch (err) {
      context.json = null;
    }
  }
  const type = String(contentType || "").toLowerCase();
  const jsonPreferred = context.json !== null && (type.indexOf("json") !== -1 || looksJson);
  if (!jsonPreferred && typeof DOMParser === "function") {
    try {
      const parser = new DOMParser();
      context.doc = parser.parseFromString(raw, "text/html");
      context.root = context.doc;
    } catch (err) {
      context.doc = null;
      context.root = null;
    }
  }
  return context;
}

// ---------------- 列表规则解析：顶层连接符与 ! 排除索引 ----------------
// legado 的 bookList / chapterList 除 @ 链外还有两类整条规则级语法：
//   1) 顶层连接符：A||B 先取 A、为空时取 B；A&&B 合并；A%%B 交替拼接
//   2) ! 排除索引：选择器末尾 !0:1:2 / !-1 表示剔除命中结果的指定下标（负数从末尾数）
// 切分连接符要感知引号、[属性选择器] 方括号与伪类圆括号，避免把
// [href$="a||b"] / :contains(A||B) 这类选择器切坏；字段规则与列表规则共用
// rule-eval.js 的 splitRuleTopLevel，保证两套入口语义一致。
export function splitTopBranches(raw) {
  return splitRuleTopLevel(raw, false);
}

// 列表规则与普通字段共用同一套尾部索引语义（阅读写法 . / ! 与括号写法 []），
// 由 defaultQuery（stripRuleIndex + applyRuleIndex）统一实现；保留旧函数名作为兼容别名。
export function splitExcludeIndex(text) {
  const split = stripRuleIndex(text);
  if (!split.index || split.index.mode !== "exclude") {
    return { selector: String(text == null ? "" : text).trim(), exclude: null };
  }
  const exclude = [];
  for (const item of split.index.items) {
    if (item.kind === "index") exclude.push(item.n);
  }
  return { selector: split.body, exclude: exclude.length ? exclude : null };
}

export function defaultQueryEx(root, segment) {
  return defaultQuery(root, segment);
}

// 单个分支的节点解析（@ 链式，遇提取段截止）；context 已含 doc/root 时直接复用
export function listNodesSingleEx(rawRule, context, useExcl) {
  const text = String(rawRule == null ? "" : rawRule).trim();
  if (!text) return [];
  const kind = ruleSourceKind(text);
  if (kind === "json") {
    if (context.json === null || context.json === undefined) return [];
    return jsonPathQuery(context.json, text);
  }
  const root = ruleRoot(context);
  if (!root) return [];
  if (kind === "css") {
    const css = splitCssRule(text.slice("@css:".length));
    return cssQuery(root, css.selector);
  }
  if (kind === "xpath") {
    const body = text.indexOf("@XPath:") === 0 ? text.slice("@XPath:".length) : text;
    return xpathQuery(root, body);
  }
  const segments = text.split("@").map((item) => item.trim()).filter(Boolean);
  let current = [root];
  for (const segment of segments) {
    if (isExtractMode(segment)) break;
    const next = [];
    for (const node of current) {
      if (!node) continue;
      const found = useExcl ? defaultQueryEx(node, segment) : defaultQuery(node, segment);
      for (const f of found) next.push(f);
    }
    current = next;
    if (!current.length) break;
  }
  return current;
}

// 整条列表规则：先切顶层分支，逐分支求值并按连接符合并
export function listNodesFixed(rawRule, context, useBranch, useExcl) {
  if (!useBranch) return listNodesSingleEx(rawRule, context, useExcl);
  const parts = splitTopBranches(rawRule);
  if (parts.segs.length === 1) return listNodesSingleEx(parts.segs[0], context, useExcl);
  let result = listNodesSingleEx(parts.segs[0], context, useExcl);
  for (let i = 1; i < parts.segs.length; i += 1) {
    const conn = parts.conns[i];
    const list = listNodesSingleEx(parts.segs[i], context, useExcl);
    if (conn === "&&") {
      result = result.concat(list);
    } else if (conn === "||") {
      if (!result.length) result = list.slice();
    } else if (conn === "%%") {
      const merged = [];
      const max = Math.max(result.length, list.length);
      for (let j = 0; j < max; j += 1) {
        if (j < result.length) merged.push(result[j]);
        if (j < list.length) merged.push(list[j]);
      }
      result = merged;
    } else {
      result = result.concat(list);
    }
  }
  return result;
}

// 搜索结果解析：bookList 取列表，字段规则相对每个书籍节点求值。
// 输出过滤对齐 legado BookList.getSearchItem：书名为空即丢弃该项；详情地址为空回退当前页地址；
// 并按「书名 + 地址 + 作者」去重（legado 侧用 LinkedHashSet 去重）。
export function parseSearchResult(source, context, baseUrl) {
  const rule = source.ruleSearch || {};
  const out = [];
  if (!rule.bookList) return out;
  // 列表规则直接复用调用方已构建的 context：doc/json 由 buildSourceContext 预置，
  // doc 为空时 ruleRoot 会按需惰性解析一次，不要对同一份响应重建整份文档。
  const nodes = listNodesFixed(rule.bookList, context, true, true);
  const fallbackUrl = baseUrl || source.url || "";
  const seen = new Set();
  for (const node of nodes) {
    const isDomNode = node && typeof node === "object" && typeof node.nodeType === "number";
    const itemContext = isDomNode
      ? { text: context.text, doc: context.doc || null, root: node, json: null, baseUrl: context.baseUrl || "" }
      : { text: context.text, doc: null, root: null, json: node, baseUrl: context.baseUrl || "" };
    if (!isDomNode && itemContext.json === null) continue;
    const name = ruleString(rule.name, itemContext);
    if (!name) continue;
    const item = {
      name: name,
      author: ruleString(rule.author, itemContext),
      kind: ruleString(rule.kind, itemContext),
      wordCount: ruleString(rule.wordCount, itemContext),
      lastChapter: ruleString(rule.lastChapter, itemContext),
      intro: ruleString(rule.intro, itemContext),
      coverUrl: resolveSourceUrl(fallbackUrl, ruleString(rule.coverUrl, itemContext)),
      bookUrl: resolveSourceUrl(fallbackUrl, ruleString(rule.bookUrl, itemContext))
    };
    if (!item.bookUrl) item.bookUrl = fallbackUrl;
    const key = item.name + "\u0001" + item.bookUrl + "\u0001" + item.author;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// 目录解析：chapterList 取列表，章节名/地址相对每个章节节点求值
export function parseTocResult(source, context, baseUrl) {
  const rule = source.ruleToc || {};
  const out = [];
  if (!rule.chapterList) return out;
  let rawRule = rule.chapterList;
  let reversed = false;
  if (rawRule.charAt(0) === "-") {
    reversed = true;
    rawRule = rawRule.slice(1);
  }
  // 目录列表同样复用调用方上下文，避免同一页目录被重复解析。
  const nodes = listNodesFixed(rawRule, context, true, true);
  for (const node of nodes) {
    const isDomNode = node && typeof node === "object" && typeof node.nodeType === "number";
    const itemContext = isDomNode
      ? { text: context.text, doc: context.doc || null, root: node, json: null, baseUrl: context.baseUrl || "" }
      : { text: context.text, doc: null, root: null, json: node, baseUrl: context.baseUrl || "" };
    if (!isDomNode && itemContext.json === null) continue;
    const title = ruleString(rule.chapterName, itemContext);
    const href = ruleString(rule.chapterUrl, itemContext);
    if (!href) continue;
    out.push({
      title: title || href,
      url: resolveSourceUrl(baseUrl || source.url, href)
    });
  }
  if (reversed) out.reverse();
  return out;
}

// 分页目录的下一页地址：legado 用 ruleToc.nextTocUrl（可能带 @XPath:/@css: 前缀，也可能取属性）
export function parseTocNextUrl(source, context) {
  const toc = source.ruleToc || {};
  const rule = toc.nextTocUrl;
  if (!rule) return "";
  return ruleString(rule, context);
}

// 正文解析：content 取内容，多个结果拼接；replaceRegex 是 legado 的正则净化规则（约四分之一的
// 真实书源用它清广告与标题行），按 ## 规则语义在去标签之前作用在提取结果上。
export function parseContentResult(source, context) {
  const rule = source.ruleContent || {};
  if (!rule.content) return "";
  const list = ruleStringList(rule.content, context);
  const replaceRule = String(rule.replaceRegex || "").trim();
  const parts = [];
  for (const item of list) {
    let text = String(item == null ? "" : item);
    if (!text) continue;
    if (replaceRule) text = applyPurify(text, replaceRule.indexOf("##") === 0 ? replaceRule : "##" + replaceRule);
    // html 提取的结果去掉标签，保留换行语义
    parts.push(/<[a-z!/]/i.test(text) ? htmlFragmentToText(text) : text);
  }
  return normalizeSourceContent(parts.join("\n"));
}

// 把正文 HTML 片段转纯文本：块级标签转换行，去脚本样式
export function htmlFragmentToText(html) {
  const raw = String(html == null ? "" : html);
  if (!raw) return "";
  if (typeof DOMParser !== "function") {
    return raw.replace(/<[^>]*>/g, "");
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, "text/html");
    const drop = doc.querySelectorAll("script, style, noscript");
    for (const node of toNodeArray(drop)) {
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    const blocks = doc.querySelectorAll("p, div, br, li, h1, h2, h3, h4, h5, h6");
    for (const node of toNodeArray(blocks)) {
      if (node.nodeName === "BR") {
        if (node.parentNode) node.parentNode.replaceChild(doc.createTextNode("\n"), node);
      } else if (node.parentNode) {
        node.parentNode.insertBefore(doc.createTextNode("\n"), node.nextSibling);
      }
    }
    return doc.body ? doc.body.textContent || "" : "";
  } catch (err) {
    return raw.replace(/<[^>]*>/g, "");
  }
}

// 正文清理：统一换行、去零宽字符、压缩连续空行
export function normalizeSourceContent(text) {
  return String(text == null ? "" : text)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200b-\u200f\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
