// legado 净化规则：##正则##替换 与 ###OnlyOne，带超长文本与正则缓存防护。
import { compileGuardedRegex } from "./regex-guard.js";

// ---------------- 净化：##正则##替换（循环）与 ###（正则之OnlyOne：取首个匹配段替换后返回） ----------------
// 净化防护：参净化文本超过该长度直接跳过。第三方书源的净化正则是任意字符串，
// 灾难性回溯会在渲染线程同步跑满 CPU，只能靠限制输入规模兜底。
export const PURIFY_TEXT_MAX = 200000;
export const PURIFY_REGEX_CACHE_MAX = 200;
// 编译结果按 pattern+flags 复用：同一条规则会对多个提取结果反复净化，避免重复编译。
// 使用场景：字符串 replace / 无 g 正则的 exec（OnlyOne 取首个匹配，不维护 lastIndex）。
// 不要对带 g 的正则调用 test / exec，否则 g 标志的 lastIndex 状态会在多次调用之间互相污染。
export const purifyRegexCache = new Map();
// 超长跳过只上报一次；模块层没有日志通道，由 createEngine 把 api.log 注入进来。
let purifySkipLog = null;
export let purifySkipReported = false;
export function applyPurify(text, rule) {
  const raw = String(rule == null ? "" : rule);
  if (raw.indexOf("##") !== 0) return text;
  const onlyFirst = /###\s*$/.test(raw);
  const body = onlyFirst ? raw.replace(/###\s*$/, "") : raw;
  const rest = body.slice(2);
  const sep = rest.indexOf("##");
  const pattern = sep === -1 ? rest : rest.slice(0, sep);
  const replacement = sep === -1 ? "" : rest.slice(sep + 2);
  if (!pattern) return text;
  const source = String(text);
  // 超长文本跳过净化：第三方正则可能是灾难性回溯构造，宁可放弃净化也不能冻结界面
  if (source.length > PURIFY_TEXT_MAX) {
    if (!purifySkipReported && typeof purifySkipLog === "function") {
      purifySkipReported = true;
      purifySkipLog("purify skipped: text too long", source.length, pattern);
    }
    return text;
  }
  const flags = onlyFirst ? "" : "g";
  const cacheKey = pattern + "\u0000" + flags;
  let regex = purifyRegexCache.get(cacheKey);
  if (!regex) {
    // 统一受控编译：嵌套量词、重叠分支等灾难性回溯构造直接拒绝，避免冻结渲染线程。
    regex = compileGuardedRegex(pattern, flags);
    if (!regex) return text;
    if (purifyRegexCache.size >= PURIFY_REGEX_CACHE_MAX) purifyRegexCache.clear();
    purifyRegexCache.set(cacheKey, regex);
  }
  try {
    if (onlyFirst) {
      // legado「正则之OnlyOne」（##match##replace###）：取第一个匹配段，只返回该段替换后的结果。
      // 等价 legado replaceRegex()：matcher.group(0).replaceFirst(regex, replacement)。
      // 社区源用它从节点 HTML 里「抠」URL / 属性值；若返回整串替换结果会残留 HTML 残渣。
      const match = regex.exec(source);
      if (!match) return "";
      return match[0].replace(regex, replacement);
    }
    return source.replace(regex, replacement);
  } catch (err) {
    return text;
  }
}

// 剥离规则尾部的净化段：返回 { rule, purify }
export function splitRulePurify(raw) {
  const text = String(raw == null ? "" : raw);
  const index = text.indexOf("##");
  if (index === -1) return { rule: text, purify: "" };
  return { rule: text.slice(0, index), purify: text.slice(index) };
}

// 日志通道由引擎注入（模块层不直接持有 api）。
export function setPurifySkipLog(log) {
  purifySkipLog = typeof log === "function" ? log : null;
}

