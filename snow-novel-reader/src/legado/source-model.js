// legado 书源模型：解析、合并与不支持特性标注。

// ==================== 书源：解析与请求 ====================
// 把 legado 书源 JSON 归一化为内部模型，并标注不支持的特性。

// 不支持的规则特征：命中即记录警告，导入时提示用户（不阻止导入）
export const SOURCE_UNSUPPORTED_FEATURES = [
  { key: "js", re: /@js:|<js>|<\/js>|java\./, label: "source.warn.js" },
  { key: "webView", re: /"webView"|"webJs"|webView/, label: "source.warn.webview" },
  { key: "sourceRegex", re: /sourceRegex/, label: "source.warn.sourceRegex" },
  { key: "putGet", re: /@put:|@get:/, label: "source.warn.putGet" }
];

export function collectSourceWarnings(source) {
  const warnings = [];
  const seen = {};
  const scan = (value) => {
    if (typeof value !== "string") return;
    for (const feature of SOURCE_UNSUPPORTED_FEATURES) {
      if (feature.re.test(value) && !seen[feature.key]) {
        seen[feature.key] = true;
        warnings.push(feature.label);
      }
    }
  };
  const walk = (node, depth) => {
    if (depth > 4 || node === null || node === undefined) return;
    if (typeof node === "string") {
      scan(node);
      return;
    }
    if (typeof node !== "object") return;
    for (const key of Object.keys(node)) walk(node[key], depth + 1);
  };
  walk(source, 0);
  return warnings;
}

// 归一化规则对象：只保留字符串字段
export function normalizeRuleGroup(raw, keys) {
  const out = {};
  const source = raw && typeof raw === "object" ? raw : {};
  for (const key of keys) {
    out[key] = typeof source[key] === "string" ? source[key].trim() : "";
  }
  return out;
}

export const SEARCH_RULE_KEYS = [
  "url",
  "bookList",
  "name",
  "author",
  "kind",
  "wordCount",
  "lastChapter",
  "intro",
  "coverUrl",
  "bookUrl"
];
export const BOOK_INFO_RULE_KEYS = ["name", "author", "kind", "wordCount", "lastChapter", "intro", "coverUrl", "tocUrl"];
export const TOC_RULE_KEYS = ["chapterList", "chapterName", "chapterUrl", "isVip", "updateTime", "nextTocUrl"];
export const CONTENT_RULE_KEYS = ["content", "replaceRegex", "nextContentUrl"];

// 解析单本书源；返回 null 表示不是合法的书源对象
export function parseBookSource(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const url = typeof raw.bookSourceUrl === "string" ? raw.bookSourceUrl.trim() : "";
  const name = typeof raw.bookSourceName === "string" ? raw.bookSourceName.trim() : "";
  if (!url) return null;
  let header = null;
  if (typeof raw.header === "string" && raw.header.trim()) {
    try {
      const parsed = JSON.parse(raw.header);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) header = parsed;
    } catch (err) {
      /* header 不是合法 JSON，忽略 */
    }
  } else if (raw.header && typeof raw.header === "object") {
    header = raw.header;
  }
  return {
    id: url,
    name: name || url,
    group: typeof raw.bookSourceGroup === "string" ? raw.bookSourceGroup.trim() : "",
    url: url,
    header: header,
    searchUrl: typeof raw.searchUrl === "string" ? raw.searchUrl.trim() : "",
    ruleSearch: normalizeRuleGroup(raw.ruleSearch, SEARCH_RULE_KEYS),
    ruleBookInfo: normalizeRuleGroup(raw.ruleBookInfo, BOOK_INFO_RULE_KEYS),
    ruleToc: normalizeRuleGroup(raw.ruleToc, TOC_RULE_KEYS),
    ruleContent: normalizeRuleGroup(raw.ruleContent, CONTENT_RULE_KEYS),
    enabled: raw.enabled !== false,
    warnings: collectSourceWarnings(raw),
    order: index
  };
}

// 兼容多种导入形态：单本对象、书源数组、{"bookSources":[...]} 包装
export function parseBookSourcePayload(text) {
  let data;
  try {
    data = JSON.parse(String(text == null ? "" : text));
  } catch (err) {
    return { sources: [], error: "parse" };
  }
  let list = [];
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === "object") {
    if (Array.isArray(data.bookSources)) list = data.bookSources;
    else if (Array.isArray(data.sources)) list = data.sources;
    else list = [data];
  }
  const sources = [];
  for (let i = 0; i < list.length; i += 1) {
    const parsed = parseBookSource(list[i], i);
    if (parsed) sources.push(parsed);
  }
  return { sources: sources, error: sources.length ? "" : "empty" };
}

// 按 bookSourceUrl（即 id）合并导入结果：overwrite 为真时，同地址的旧条目整体换用新规则，
// 但保留旧条目的启用/停用状态与列表位置；为假时同地址一律跳过（旧版行为）。
// 直接修改 existing 数组并返回计数；纯函数（放在模块顶层，测试切片可直接提取）。
export function mergeBookSources(existing, incoming, overwrite) {
  // 字典必须无原型：id 来自 bookSourceUrl，取「constructor」「__proto__」这类原型成员名时，
  // 字面量对象的 known[id] 会命中原型链成员而被误判为已存在，条目会被静默丢弃。
  const known = Object.create(null);
  for (const item of existing) known[item.id] = item;
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const item of incoming) {
    const old = known[item.id];
    if (!old) {
      known[item.id] = item;
      existing.push(item);
      added += 1;
      continue;
    }
    if (overwrite === true) {
      // 覆盖只换规则内容，不重置用户的启用选择，也不改变源在列表中的位置
      item.enabled = old.enabled !== false;
      item.order = old.order;
      const pos = existing.indexOf(old);
      if (pos !== -1) existing[pos] = item;
      known[item.id] = item;
      updated += 1;
      continue;
    }
    skipped += 1;
  }
  return { added: added, updated: updated, skipped: skipped };
}
