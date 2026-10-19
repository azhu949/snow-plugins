// 书源请求构造：URL 模板、请求头合并与 charset 表单编码。
import { fillRuleTemplate, splitSourceUrl } from "./rule-expr.js";

// URL 模板里需要按 URL 语义编码的变量：搜索关键词来自用户输入，未编码时 & 会拆出多余参数、
// # 会把后续内容截成片段、% 会形成非法转义。选项与请求体不编码，避免表单值被二次编码。
const URL_ENCODED_VARS = { key: 1 };

// 相对 URL 转绝对：标准 URL 解析（等价 legado NetworkUtils.getAbsoluteURL）。
// 注意不能对基准强制补 "/"：当页面地址本身是文件路径（.../index.html）时，
// 补斜杠会把相对地址拼进文件名的下一层，导致全链路 404。
export function resolveSourceUrl(base, path) {
  const text = String(path == null ? "" : path).trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  // legado 语义：javascript 伪链接不是可用地址，置空
  if (/^javascript:/i.test(text)) return "";
  const root = String(base || "").trim();
  if (!root) return text;
  try {
    return new URL(text, root).href;
  } catch (err) {
    return text;
  }
}

// 默认请求头：真实站点普遍要求浏览器 UA 与同源 Referer，缺失时直接 403。
// 社区实现（so-novel 等）都对每个请求补 UA + Referer，这里照做，书源自带的 header 优先级更高。
export function buildDefaultSourceHeaders(url) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };
  try {
    const parsed = new URL(String(url || ""));
    headers.Referer = parsed.origin + "/";
  } catch (err) {
    /* 非标准地址：不补 Referer */
  }
  return headers;
}

// 合并请求头：默认头 < 书源头 < 请求选项头（后者覆盖前者，键名不区分大小写）
export function mergeSourceHeaders(defaults, ...layers) {
  const merged = {};
  const keyOf = (name) => String(name).toLowerCase();
  const put = (source) => {
    if (!source || typeof source !== "object") return;
    const known = {};
    for (const name of Object.keys(merged)) known[keyOf(name)] = name;
    for (const name of Object.keys(source)) {
      const value = source[name];
      if (typeof value !== "string") continue;
      const existing = known[keyOf(name)];
      if (existing) delete merged[existing];
      merged[name] = value;
      known[keyOf(name)] = name;
    }
  };
  put(defaults);
  for (const layer of layers) put(layer);
  return merged;
}

// 选项字段里的模板仍需填充（如 body、headers 的 Referer 值），键名按字面使用不展开；
// 填充只发生在选项对象内部，结果不回写 JSON 文本，因此不会改写选项结构。
export function fillOptionTemplates(options, vars) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return null;
  const out = {};
  for (const name of Object.keys(options)) {
    const value = options[name];
    if (typeof value === "string") out[name] = fillRuleTemplate(value, vars);
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = {};
      for (const key of Object.keys(value)) {
        nested[key] = typeof value[key] === "string" ? fillRuleTemplate(value[key], vars) : value[key];
      }
      out[name] = nested;
    } else out[name] = value;
  }
  return out;
}

// ---------------- POST 表单请求体编码（对齐 legado AnalyzeUrl.encodeParams） ----------------
// legado 对 POST 请求：body 非 JSON/XML 且未显式声明 Content-Type 时，按 charset 对表单逐段做
// URL 编码（Java URLEncoder 语义：空格 -> +，[A-Za-z0-9*-._] 保留，其余按目标 charset 的字节
// 转大写 %XX），再以 application/x-www-form-urlencoded 发送；charset 未声明时默认 UTF-8，
// 且先逐段检查是否已是合法编码形态（含 %XX 的段原样保留）。编码产物为纯 ASCII，
// 宿主按 UTF-8 发送即可让 GBK 等传统编码站点收到正确的表单值（52书库、御宅文屋均依赖此语义）。
// JSON/XML 形态的 body 不经过这条表单链：原样发送，未显式声明 Content-Type 时由
// prepareSourceRequestBody 按形态补 application/json（{ 或 [ 开头）或 application/xml（< 开头）。
export const URLENCODER_SAFE_RE = /[A-Za-z0-9\-_.*]/;
export const CHARSET_ENCODE_TABLES = Object.create(null);
export let utf8EncoderSingleton = null;

export function isHexDigitChar(ch) {
  return (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}

// legado NetworkUtils.encodedForm：判断表单段是否已是合法编码形态（[A-Za-z0-9*-._] 与 %XX 之外视为未编码）
export function isEncodedFormSegment(text) {
  const seg = String(text == null ? "" : text);
  let i = 0;
  while (i < seg.length) {
    if (URLENCODER_SAFE_RE.test(seg[i])) {
      i += 1;
      continue;
    }
    if (seg[i] === "%" && i + 2 < seg.length && isHexDigitChar(seg[i + 1]) && isHexDigitChar(seg[i + 2])) {
      i += 3;
      continue;
    }
    return false;
  }
  return true;
}

// 懒构建「Unicode -> charset 字节」反查表：单字节编码逐字节反查，双字节编码按 lead/trail 配对反查。
// 单字节编码（windows-1252 等）由「[0xE9, 0xE9] 解成两个字符」这一探针识别，表值为单元素 [byte]，
// 避免把 lead 字节拼进表值（否则 é 会编成 %81%E9）；双字节编码按 lead/trail 交错的 380 字节整行批量解码，
// 行内长度不匹配时退化为逐对解码并逐对判定写入，不再按行放弃，避免 shift_jis / euc-kr 这类含非法字节对
// 的编码整表退化（shift_jis 会误回退 UTF-8，euc-kr 会把非 ASCII 全部编成 %3F）。
// 失败（TextDecoder 不支持该名字）返回 null，调用方回退 UTF-8；首次遇到该编码的站点时构建一次并缓存。
export function charsetEncodeTable(charsetName) {
  const name = String(charsetName || "").toLowerCase();
  if (!name) return null;
  if (CHARSET_ENCODE_TABLES[name] !== undefined) return CHARSET_ENCODE_TABLES[name];
  let table = null;
  try {
    const decoder = new TextDecoder(name);
    const map = new Map();
    // 探针：单字节编码会把 [0xE9, 0xE9] 解成两个字符，双字节编码解成一个字符
    const singleByte = decoder.decode(new Uint8Array([0xe9, 0xe9])).length !== 1;
    if (singleByte) {
      for (let byte = 0x80; byte <= 0xff; byte += 1) {
        const ch = decoder.decode(new Uint8Array([byte]));
        if (ch.length !== 1 || ch === "\ufffd") continue;
        if (!map.has(ch)) map.set(ch, [byte]);
      }
    } else {
      const row = new Uint8Array(380);
      for (let lead = 0x81; lead <= 0xfe; lead += 1) {
        const trails = [];
        let pos = 0;
        for (let trail = 0x40; trail <= 0xfe; trail += 1) {
          if (trail === 0x7f) continue;
          row[pos] = lead;
          row[pos + 1] = trail;
          trails.push(trail);
          pos += 2;
        }
        const text = decoder.decode(row);
        if (text.length !== trails.length) {
          // 解码器在个别字节对上吞字节或拆成两个字符：退化为逐对解码，逐对判定后写入
          for (const trail of trails) {
            const ch = decoder.decode(new Uint8Array([lead, trail]));
            if (ch.length !== 1 || ch === "\ufffd") continue;
            if (!map.has(ch)) map.set(ch, [lead, trail]);
          }
          continue;
        }
        for (let i = 0; i < trails.length; i += 1) {
          const ch = text[i];
          if (ch === "\ufffd") continue;
          if (!map.has(ch)) map.set(ch, [lead, trails[i]]);
        }
      }
    }
    const single = decoder.decode(new Uint8Array([0x80]));
    if (single.length === 1 && single !== "\ufffd" && !map.has(single)) map.set(single, [0x80]);
    table = map.size ? map : null;
  } catch (err) {
    table = null;
  }
  CHARSET_ENCODE_TABLES[name] = table;
  return table;
}

export function percentEncodeBytes(bytes) {
  let out = "";
  for (const b of bytes) {
    out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function utf8BytesOfChar(ch) {
  if (!utf8EncoderSingleton) utf8EncoderSingleton = new TextEncoder();
  return utf8EncoderSingleton.encode(ch);
}

// Java URLEncoder.encode(segment, charset) 等价实现（按码点处理，代理对整体转换）
export function javaUrlEncodeSegment(segment, charsetName) {
  const seg = String(segment == null ? "" : segment);
  const name = String(charsetName || "").toLowerCase();
  const isUtf8 = !name || name === "utf-8" || name === "utf8";
  const table = isUtf8 ? null : charsetEncodeTable(name);
  let out = "";
  for (const ch of seg) {
    const code = ch.codePointAt(0);
    if (code < 0x80) {
      if (URLENCODER_SAFE_RE.test(ch)) out += ch;
      else if (ch === " ") out += "+";
      else out += percentEncodeBytes([code]);
      continue;
    }
    if (isUtf8) {
      out += percentEncodeBytes(utf8BytesOfChar(ch));
      continue;
    }
    const bytes = table ? table.get(ch) : null;
    if (bytes) out += percentEncodeBytes(bytes);
    else if (!table) out += percentEncodeBytes(utf8BytesOfChar(ch));
    else out += "%3F"; // 目标 charset 无此字符：对齐 Java URLEncoder 的替换行为
  }
  return out;
}

// legado EncoderUtils.escape（charset 声明为 "escape" 时使用；现有书源极少使用，纯对齐保留）
export function escapeSegment(segment) {
  const seg = String(segment == null ? "" : segment);
  let out = "";
  for (let i = 0; i < seg.length; i += 1) {
    const code = seg.charCodeAt(i);
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      out += seg[i];
      continue;
    }
    const prefix = code < 16 ? "%0" : code < 256 ? "%" : "%u";
    out += prefix + code.toString(16);
  }
  return out;
}

// legado AnalyzeUrl.encodeParams：按 & 与 = 拆段后逐段编码；
// 未声明 charset 时先做「已编码」检查（不过度编码作者手写的现成编码串）
export function encodeFormParams(params, charsetName) {
  const text = String(params == null ? "" : params);
  const declared = typeof charsetName === "string" ? charsetName.trim().toLowerCase() : "";
  const checkEncoded = !declared;
  const escapeMode = declared === "escape";
  const parts = [];
  const len = text.length;
  let pos = 0;
  while (pos <= len) {
    if (parts.length) parts.push("&");
    let amp = text.indexOf("&", pos);
    if (amp === -1) amp = len;
    const eq = text.indexOf("=", pos);
    let key;
    let value;
    if (eq === -1 || eq > amp) {
      key = text.slice(pos, amp);
      value = null;
    } else {
      key = text.slice(pos, eq);
      value = text.slice(eq + 1, amp);
    }
    parts.push(encodeFormSegment(key));
    if (value !== null) {
      parts.push("=");
      parts.push(encodeFormSegment(value));
    }
    pos = amp + 1;
  }
  return parts.join("");

  function encodeFormSegment(segment) {
    if (checkEncoded && isEncodedFormSegment(segment)) return segment;
    if (escapeMode) return escapeSegment(segment);
    return javaUrlEncodeSegment(segment, declared || "utf-8");
  }
}

export function hasHeaderIgnoreCase(headers, name) {
  if (!headers || typeof headers !== "object") return false;
  const needle = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === needle) return true;
  }
  return false;
}

// POST 请求体预处理：JSON/XML 形态的 body 原样发送，未显式声明 Content-Type 时按形态补
// application/json（{ 或 [ 开头）或 application/xml（< 开头）；其余 body 做表单编码并补
// application/x-www-form-urlencoded。书源已显式声明 Content-Type 时一律不覆盖、不重复。
// 与 legado 的差异：legado 对未声明 Content-Type 的 JSON/XML body 均走 postJson（application/json），
// 这里 XML 补 application/xml 属有意增强，JSON 与 legado 一致。
export function prepareSourceRequestBody(body, charsetName, headers) {
  const text = typeof body === "string" ? body : "";
  if (!text.trim()) return text;
  const trimmed = text.trim();
  const isJsonBody = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (isJsonBody || trimmed.startsWith("<")) {
    if (!hasHeaderIgnoreCase(headers, "content-type")) {
      headers["Content-Type"] = isJsonBody ? "application/json" : "application/xml";
    }
    return text;
  }
  if (hasHeaderIgnoreCase(headers, "content-type")) return text;
  headers["Content-Type"] = "application/x-www-form-urlencoded";
  return encodeFormParams(text, charsetName);
}

// 组装一次请求：先按书源模板原文拆选项 -> 分别填充 URL 与选项字段 -> 拼绝对地址 -> 合并书源头
// 顺序不能颠倒：{{key}} 一类的模板变量含用户输入（搜索框关键词），若先填充再拆选项，
// 用户输入会被 splitSourceUrl 当成请求选项 JSON 解析，从而改写请求方法与请求头。
// 拆选项只针对书源模板原文，用户输入永远不进入选项的 JSON 解析区。
// 返回 { url, method, body, headers, charset }
export function buildSourceRequest(source, urlTemplate, vars) {
  const values = vars || {};
  const split = splitSourceUrl(String(urlTemplate || ""));
  const options = fillOptionTemplates(split.options, values) || {};
  const method = typeof options.method === "string" ? options.method.toUpperCase() : "GET";
  const url = resolveSourceUrl(source ? source.url : "", fillRuleTemplate(split.url, values, URL_ENCODED_VARS));
  const headers = mergeSourceHeaders(buildDefaultSourceHeaders(url), source ? source.header : null, options.headers);
  const charset = typeof options.charset === "string" ? options.charset.toLowerCase() : "";
  const bodyless = method === "GET" || method === "HEAD";
  let body = bodyless || typeof options.body !== "string" ? "" : options.body;
  if (!bodyless && body) body = prepareSourceRequestBody(body, charset, headers);
  return {
    url: url,
    method: method,
    body: body,
    headers: headers,
    charset: charset
  };
}
