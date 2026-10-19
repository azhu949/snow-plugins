// 字段级规则求值：|| / && / %% 连接符、{{}} 模板与净化。
import { applyPurify, splitRulePurify } from "./purify.js";
import { evalRuleExpr } from "./rule-expr.js";
import { defaultQuery, jsonPathQuery, splitCssRule, xpathQuery } from "./rule-query.js";
import { cssQuery, extractFromNode, isAttributeNameSegment, isExtractMode } from "./dom.js";

// ---------------- 规则上下文与求值 ----------------
export function ruleSourceKind(rule) {
  const text = String(rule || "").trim();
  if (text.indexOf("@css:") === 0) return "css";
  if (text.indexOf("@XPath:") === 0 || text.indexOf("//") === 0) return "xpath";
  if (text.indexOf("@json:") === 0 || text.indexOf("$.") === 0 || text.indexOf("$..") === 0 || text.indexOf("$[") === 0) return "json";
  return "default";
}

// 惰性构建 DOM：JSON 响应不需要解析 HTML，避免无谓开销
export function ruleRoot(context) {
  if (context.root) return context.root;
  if (!context.doc) {
    if (typeof DOMParser !== "function") return null;
    try {
      const parser = new DOMParser();
      context.doc = parser.parseFromString(context.text, "text/html");
    } catch (err) {
      context.doc = null;
    }
  }
  context.root = context.doc || null;
  return context.root;
}

export function stringifyRuleValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch (err) {
    return String(value);
  }
}

// 「独立净化」（无选择器 + 仅 ## 规则）的作用对象：元素节点取 outerHTML，文档级用响应原文
export function purifyBaseText(context) {
  if (!context) return "";
  const root = context.root;
  if (root && root.nodeType === 1 && typeof root.outerHTML === "string") return root.outerHTML;
  return typeof context.text === "string" ? context.text : "";
}

// ---------------- 字段级 {{}} 模板（legado AnalyzeRule Mode.Regex 分支） ----------------
// legado 语义：`{{` 出现在首个 `##` 之前时，整条规则按「纯字符串模板」处理——段间文本原样
// 保留，`{{}}` 段分流：规则段（@ / $. / $[ / // 开头）以当前上下文求值取首个非空结果；
// 否则按表达式求值（可用 baseUrl / src / result 变量）。组装完成后的整段文本再套用尾部净化
// （## 之后的净化段），最后 trim。御宅文屋 tocUrl 即此形态：
//   {{baseUrl}}##.*\/(\d+)\/##https://m.yuzhaiwen.com/novel/list/$1/1.html
// {{}} 段求值失败（表达式语法不支持 → evalRuleExpr 返回 undefined）时保留原文（fail-visible），
// 便于用户定位不支持的表达式；未知变量名与 result 一样按空串替换（evalRuleExpr 对未定义标识符
// 返回空串而非 undefined，不属 fail-visible），并非保留原文。
export function isTemplateRuleExpression(rawRule) {
  const text = String(rawRule == null ? "" : rawRule);
  const index = text.indexOf("##");
  const head = index === -1 ? text : text.slice(0, index);
  return head.indexOf("{{") !== -1;
}

// 模板段内容是否按嵌套规则求值：legado AnalyzeRule.isRule 的判定前缀
export function isFieldTemplateRule(code) {
  const text = String(code == null ? "" : code).trim();
  return (
    text.charAt(0) === "@" ||
    text.indexOf("$.") === 0 ||
    text.indexOf("$[") === 0 ||
    text.indexOf("//") === 0
  );
}

export function fillFieldTemplate(rawRule, context) {
  const split = splitRulePurify(rawRule);
  const vars = {
    baseUrl: context && typeof context.baseUrl === "string" ? context.baseUrl : "",
    src: context && typeof context.text === "string" ? context.text : "",
    result: ""
  };
  const text = split.rule.replace(/\{\{([\s\S]*?)\}\}/g, (match, expr) => {
    const code = String(expr).trim();
    if (!code) return match;
    if (isFieldTemplateRule(code)) {
      for (const value of evalSingleRule(code, context)) {
        const inner = String(value == null ? "" : value).trim();
        if (inner) return inner;
      }
      return match;
    }
    const value = evalRuleExpr(code, vars);
    if (value === undefined) return match;
    return value === null ? "" : String(value);
  });
  const purified = split.purify ? applyPurify(text, split.purify) : text;
  return String(purified == null ? "" : purified).trim();
}

// 单条规则（已剥离净化）→ 字符串数组
export function evalSingleRule(rawRule, context) {
  if (isTemplateRuleExpression(rawRule)) {
    const filled = fillFieldTemplate(rawRule, context);
    return filled ? [filled] : [];
  }
  const split = splitRulePurify(rawRule);
  const text = split.rule.trim();
  if (!text) {
    // 无选择器：legado「正则之净化」独立使用等价于 all##...##（作用在「当前内容」上）；
    // 「正则之OnlyOne」（### 结尾）由 applyPurify 取第一个匹配段返回
    if (!split.purify) return [];
    const base = purifyBaseText(context);
    if (!base) return [];
    const out = applyPurify(base, split.purify);
    return out ? [out] : [];
  }
  const kind = ruleSourceKind(text);
  let values = [];

  if (kind === "json") {
    if (context.json === null || context.json === undefined) return [];
    for (const item of jsonPathQuery(context.json, text)) values.push(stringifyRuleValue(item));
  } else if (kind === "css") {
    const root = ruleRoot(context);
    if (root) {
      const css = splitCssRule(text.slice("@css:".length));
      for (const node of cssQuery(root, css.selector)) values.push(extractFromNode(node, css.mode));
    }
  } else if (kind === "xpath") {
    const root = ruleRoot(context);
    if (root) {
      const body = text.indexOf("@XPath:") === 0 ? text.slice("@XPath:".length) : text;
      for (const node of xpathQuery(root, body)) values.push(extractFromNode(node, "text"));
    }
  } else {
    const segments = text.split("@").map((item) => item.trim()).filter(Boolean);
    if (segments.length) {
      // 单独一段 all：legado 语义为整页内容
      if (segments.length === 1 && segments[0] === "all") {
        values.push(context.text);
      } else {
        let nodes = [ruleRoot(context)];
        for (let i = 0; i < segments.length; i += 1) {
          const segment = segments[i];
          const isLast = i === segments.length - 1;
          if (isLast && (isExtractMode(segment) || isAttributeNameSegment(segment))) {
            for (const node of nodes) if (node) values.push(extractFromNode(node, segment));
            nodes = [];
            break;
          }
          const next = [];
          for (const node of nodes) {
            if (!node) continue;
            for (const found of defaultQuery(node, segment)) next.push(found);
          }
          nodes = next;
          if (!nodes.length) break;
        }
        // 末段不是提取模式：按文本取全部结果
        if (nodes.length) for (const node of nodes) values.push(extractFromNode(node, "text"));
      }
    }
  }

  if (split.purify) values = values.map((value) => applyPurify(value, split.purify));
  return values;
}

// 顶层连接符切分器：引号、方括号、圆括号内的连接符不参与切分。
// 字段规则（fieldMode=true）还要把 ##正则## 段当作不透明区域：净化正则里出现 || / && / %%
// 很常见（例如 ##作者：(.*?)[\||<]##$1###），先切连接符会把规则切坏；
// 连接符右侧是新的规则段，仍可再次出现 ## 净化段。
// 只有后面还存在第二个 ## 时才按 ##正则##替换 处理；单 ## 是「删除匹配」形态，
// 此时顶层连接符必须结束净化段（A##广告||B 的 ||B 是回退分支，不能吞进正则）。
// 列表规则（fieldMode=false）保持原语义：不识别净化段，只补上圆括号感知。
// 两个入口共用同一套状态机，避免字段规则与列表规则的切分语义再次分叉。
export function splitRuleTopLevel(rawRule, fieldMode) {
  const text = String(rawRule == null ? "" : rawRule);
  const segs = [];
  const conns = [];
  let buf = "";
  let pending = "";
  let quote = "";
  let bracketDepth = 0;
  let parenDepth = 0;
  // rule：普通规则段；regex：## 之后的双 ## 正则段；regexSingle：只有单个 ## 的删除段；
  // replacement：第二个 ## 之后的替换串
  let phase = "rule";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    const two = text.slice(i, i + 2);
    if (quote) {
      buf += ch;
      if (ch === "\\") {
        // 转义字符原样带上下一个字符，避免 \" 被当成引号结束
        if (i + 1 < text.length) {
          buf += text.charAt(i + 1);
          i += 1;
        }
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (phase === "regex") {
      if (two === "##") {
        buf += two;
        i += 1;
        phase = "replacement";
      } else {
        buf += ch;
      }
      continue;
    }
    if (phase === "regexSingle") {
      if (ch === "\\") {
        // 转义字符原样带上下一个字符，避免 \|\| 被当成连接符
        buf += ch;
        if (i + 1 < text.length) {
          buf += text.charAt(i + 1);
          i += 1;
        }
        continue;
      }
      if (bracketDepth > 0) {
        // 字符类内部的 | / && / %% 不参与切分
        if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
        buf += ch;
        continue;
      }
      if (ch === "[") {
        bracketDepth += 1;
        buf += ch;
        continue;
      }
      if (ch === "(") {
        parenDepth += 1;
        buf += ch;
        continue;
      }
      if (ch === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
        buf += ch;
        continue;
      }
      if (parenDepth === 0 && (two === "&&" || two === "||" || two === "%%")) {
        // 单 ## 删除形态下，顶层连接符结束净化段，右侧交给回退/合并逻辑。
        segs.push(buf);
        conns.push(pending);
        pending = two;
        buf = "";
        i += 1;
        phase = "rule";
        bracketDepth = 0;
        parenDepth = 0;
        continue;
      }
      buf += ch;
      continue;
    }
    if (phase === "replacement") {
      if (two === "&&" || two === "||" || two === "%%") {
        segs.push(buf);
        conns.push(pending);
        pending = two;
        buf = "";
        i += 1;
        // 连接符右侧是新的规则段，可能再次出现 ## 净化段
        phase = "rule";
        bracketDepth = 0;
        parenDepth = 0;
        continue;
      }
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      buf += ch;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      buf += ch;
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      buf += ch;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      buf += ch;
      continue;
    }
    if (fieldMode && bracketDepth === 0 && parenDepth === 0 && two === "##") {
      buf += two;
      i += 1;
      // 只有后面还存在第二个 ## 时才可能是 ##正则##替换；否则是「删除匹配」的单 ## 形态。
      // 这里的分隔判定必须与 purify.js 的 indexOf("##") 保持一致。
      phase = text.indexOf("##", i + 1) !== -1 ? "regex" : "regexSingle";
      continue;
    }
    if (bracketDepth === 0 && parenDepth === 0 && (two === "&&" || two === "||" || two === "%%")) {
      segs.push(buf);
      conns.push(pending);
      pending = two;
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
  }
  segs.push(buf);
  conns.push(pending);
  return { segs: segs, conns: conns };
}

// 字段规则入口：分割为 [{connector, value}]，首项的 connector 为空。
// 连接符语义上属于「它右边的规则段」：`A||B` 表示先算 A，为空时用 B，
// 因此分割时把连接符挂到后一段上（A 的 connector 为空，B 的 connector 为 "||"）。
export function splitRuleConnectors(rawRule) {
  const split = splitRuleTopLevel(rawRule, true);
  return split.segs.map((value, index) => ({ connector: split.conns[index], value: value }));
}

export function evalRuleList(rawRule, context) {
  // 模板形态不拆连接符：{{a || b}} 里的 || 属于段落表达式，拆开会让模板失去闭合
  if (isTemplateRuleExpression(rawRule)) return evalSingleRule(rawRule, context);
  const parts = splitRuleConnectors(rawRule);
  if (parts.length === 1) return evalSingleRule(parts[0].value, context);
  let result = evalSingleRule(parts[0].value, context);
  for (let i = 1; i < parts.length; i += 1) {
    const list = evalSingleRule(parts[i].value, context);
    const connector = parts[i].connector;
    if (connector === "&&") {
      result = result.concat(list);
    } else if (connector === "||") {
      // 与 ruleString 的「第一个非空字符串」语义一致：命中但净化后为空也算无内容，
      // 否则 [""] 的长度为 1，回退分支永远不会被求值。
      const hasValue = result.some((value) => String(value == null ? "" : value).trim() !== "");
      if (!hasValue) result = list.slice();
    } else if (connector === "%%") {
      const merged = [];
      const max = Math.max(result.length, list.length);
      for (let j = 0; j < max; j += 1) {
        if (j < result.length) merged.push(result[j]);
        if (j < list.length) merged.push(list[j]);
      }
      result = merged;
    }
  }
  return result;
}

// 取第一个非空结果（字段级规则用）
export function ruleString(rawRule, context) {
  for (const value of evalRuleList(rawRule, context)) {
    const text = String(value == null ? "" : value).trim();
    if (text) return text;
  }
  return "";
}

// 取全部非空结果（列表类规则用）
export function ruleStringList(rawRule, context) {
  const out = [];
  for (const value of evalRuleList(rawRule, context)) {
    const text = String(value == null ? "" : value).trim();
    if (text) out.push(text);
  }
  return out;
}
