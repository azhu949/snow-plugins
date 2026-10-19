// legado 规则表达式：{{}} 模板求值、条件表达式与 URL 模板。

// ---------------- 表达式求值（{{}} 模板用，替代 eval） ----------------
// 词法：数字、单双引号字符串、标识符、比较/逻辑运算符、算术与括号；含无法识别字符时返回 null。
export function tokenizeRuleExpr(source) {
  const tokens = [];
  const re = /(\d+\.?\d*|\.\d+)|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([A-Za-z_$][\w$]*)|(==|!=|<=|>=|&&|\|\|)|([+\-*/%<>!?:()])/g;
  let last = 0;
  let match;
  while ((match = re.exec(source)) !== null) {
    if (source.slice(last, match.index).trim() !== "") return null;
    last = re.lastIndex;
    if (match[1] !== undefined) tokens.push({ t: "num", v: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ t: "str", v: match[2].replace(/\\(.)/g, "$1") });
    else if (match[3] !== undefined) tokens.push({ t: "str", v: match[3].replace(/\\(.)/g, "$1") });
    else if (match[4] !== undefined) tokens.push({ t: "ident", v: match[4] });
    else if (match[5] !== undefined) tokens.push({ t: "op", v: match[5] });
    else tokens.push({ t: "op", v: match[6] });
  }
  if (source.slice(last).trim() !== "") return null;
  return tokens.length ? tokens : null;
}

// 递归下降求值；语法不支持或求值出错时返回 undefined（调用方保留原样）
export function evalRuleExpr(source, vars) {
  const tokens = tokenizeRuleExpr(source);
  if (!tokens) return undefined;
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (value) => {
    const token = tokens[pos];
    if (token && token.t === "op" && token.v === value) {
      pos += 1;
      return true;
    }
    return false;
  };
  const toNum = (value) => {
    const n = Number(value);
    return isFinite(n) ? n : 0;
  };
  const truthy = (value) => !(value === "" || value === 0 || value === false || value === null || value === undefined);
  const looseEq = (a, b) => String(a) === String(b);

  function parseTernary() {
    const cond = parseOr();
    if (eat("?")) {
      const yes = parseTernary();
      if (!eat(":")) throw new Error("ternary missing colon");
      const no = parseTernary();
      return truthy(cond) ? yes : no;
    }
    return cond;
  }
  function parseOr() {
    let left = parseAnd();
    while (eat("||")) {
      const right = parseAnd();
      left = truthy(left) ? left : right;
    }
    return left;
  }
  function parseAnd() {
    let left = parseCompare();
    while (eat("&&")) {
      const right = parseCompare();
      left = truthy(left) ? right : left;
    }
    return left;
  }
  function parseCompare() {
    let left = parseAdd();
    for (;;) {
      const token = peek();
      if (!token || token.t !== "op") break;
      if (["==", "!=", "<", ">", "<=", ">="].indexOf(token.v) === -1) break;
      pos += 1;
      const right = parseAdd();
      if (token.v === "==") left = looseEq(left, right);
      else if (token.v === "!=") left = !looseEq(left, right);
      else if (token.v === "<") left = toNum(left) < toNum(right);
      else if (token.v === ">") left = toNum(left) > toNum(right);
      else if (token.v === "<=") left = toNum(left) <= toNum(right);
      else left = toNum(left) >= toNum(right);
    }
    return left;
  }
  function parseAdd() {
    let left = parseMul();
    for (;;) {
      const token = peek();
      if (!token || token.t !== "op" || (token.v !== "+" && token.v !== "-")) break;
      pos += 1;
      const right = parseMul();
      // 任一侧是字符串时按字符串拼接（legado 模板常见 {{'/' + page}} 拼 URL 片段）
      if (typeof left === "string" || typeof right === "string") {
        left = token.v === "+" ? String(left) + String(right) : toNum(left) - toNum(right);
      } else {
        left = token.v === "+" ? toNum(left) + toNum(right) : toNum(left) - toNum(right);
      }
    }
    return left;
  }
  function parseMul() {
    let left = parseUnary();
    for (;;) {
      const token = peek();
      if (!token || token.t !== "op" || (token.v !== "*" && token.v !== "/" && token.v !== "%")) break;
      pos += 1;
      const right = parseUnary();
      if (token.v === "*") left = toNum(left) * toNum(right);
      else if (token.v === "/") left = toNum(left) / toNum(right);
      else left = toNum(left) % toNum(right);
    }
    return left;
  }
  function parseUnary() {
    if (eat("!")) return !truthy(parseUnary());
    if (eat("-")) return -toNum(parseUnary());
    if (eat("+")) return toNum(parseUnary());
    return parseAtom();
  }
  // 允许的零参/一元函数：真实书源模板里用于 URL 编码（如 {{encodeURIComponent(key)}}）
  const RULE_EXPR_FUNCS = {
    encodeURIComponent: (value) => encodeURIComponent(String(value == null ? "" : value)),
    encodeURI: (value) => encodeURI(String(value == null ? "" : value)),
    decodeURIComponent: (value) => {
      try {
        return decodeURIComponent(String(value == null ? "" : value));
      } catch (err) {
        return String(value == null ? "" : value);
      }
    },
    String: (value) => String(value == null ? "" : value),
    Number: (value) => toNum(value),
  };

  function parseAtom() {
    const token = peek();
    if (!token) throw new Error("unexpected end");
    if (token.t === "num" || token.t === "str") {
      pos += 1;
      return token.v;
    }
    if (token.t === "ident") {
      pos += 1;
      if (token.v === "true") return true;
      if (token.v === "false") return false;
      if (token.v === "null") return null;
      if (eat("(")) {
        const args = [];
        if (!eat(")")) {
          for (;;) {
            args.push(parseTernary());
            if (eat(")")) break;
            if (!eat(",")) throw new Error("missing , in args");
          }
        }
        const fn = Object.prototype.hasOwnProperty.call(RULE_EXPR_FUNCS, token.v) ? RULE_EXPR_FUNCS[token.v] : null;
        if (!fn) throw new Error("unsupported function: " + token.v);
        return fn(args.length > 0 ? args[0] : "");
      }
      return Object.prototype.hasOwnProperty.call(vars, token.v) ? vars[token.v] : "";
    }
    if (token.t === "op" && token.v === "(") {
      pos += 1;
      const value = parseTernary();
      if (!eat(")")) throw new Error("missing )");
      return value;
    }
    throw new Error("unexpected token");
  }

  try {
    const value = parseTernary();
    if (pos !== tokens.length) return undefined;
    return value;
  } catch (err) {
    return undefined;
  }
}

// ---------------- URL 模板：{{key}} / {{page}} / {{(page-1)*20}} ----------------
// 求值失败时原样保留 {{...}}，便于用户在请求失败时看出是哪段表达式不支持。
// encodedVars：只对「直接引用」的指定变量做 URL 编码（如 URL 里的 {{key}}）。
// 显式写成 {{encodeURIComponent(key)}} 的书源走表达式分支，不会二次编码。
export function fillRuleTemplate(template, vars, encodedVars) {
  if (typeof template !== "string" || template.indexOf("{{") === -1) return template;
  return template.replace(/\{\{([\s\S]*?)\}\}/g, (match, expr) => {
    const code = String(expr).trim();
    if (!code) return "";
    if (Object.prototype.hasOwnProperty.call(vars, code)) {
      const text = String(vars[code]);
      return encodedVars && encodedVars[code] ? encodeURIComponent(text) : text;
    }
    const value = evalRuleExpr(code, vars);
    if (value === undefined) return match;
    return value === null ? "" : String(value);
  });
}

// ---------------- URL 与请求选项：url,{"method":"POST","body":"...","charset":"gbk"} ----------------
export function splitSourceUrl(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return { url: "", options: null };
  const index = text.lastIndexOf(",{");
  if (index === -1 || text.charAt(text.length - 1) !== "}") return { url: text, options: null };
  try {
    const options = JSON.parse(text.slice(index + 1));
    if (options && typeof options === "object" && !Array.isArray(options)) {
      return { url: text.slice(0, index).trim(), options: options };
    }
  } catch (err) {
    /* 尾部不是合法 JSON，整体按 URL 处理 */
  }
  return { url: text, options: null };
}
