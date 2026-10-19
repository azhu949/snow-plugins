// 响应字节解码与书源网络请求。
import { SOURCE_FETCH_TIMEOUT_MS } from "../constants.js";

// ==================== 响应文本解码 ====================
// 宿主 `net.fetch` 支持 responseType: "arraybuffer"：以原始字节（bodyBase64）回传，
// 由插件自行解码，GBK / GB18030 / UTF-16 等编码的站点不再受宿主字符集猜测影响。
// 下面这条解码链同时服务于在线书源响应与本地 TXT 导入（见 normalizeText(decodeBuffer(buffer))）。
// 注意：这些函数处于 engine.test.js 的引擎段切片范围内，必须保持模块顶层定义。

// 粗略可读性评分：CJK 与全角标点、可打印 ASCII 加分，零字节、替换字符与控制字符扣分；
// 返回前 300 字符的每码点平均分，避免候选与对照文本长度不同时总分不可比
export function readableScore(text) {
  let value = 0;
  const probe = String(text == null ? "" : text).slice(0, 300);
  for (const ch of probe) {
    const code = ch.codePointAt(0);
    if (code === 0 || code === 0xfffd) value -= 4;
    else if (code < 32 && code !== 9 && code !== 10 && code !== 13) value -= 4;
    else if (code >= 0x4e00 && code <= 0x9fff) value += 2;
    else if (code >= 0x20 && code <= 0x7e) value += 1;
    else if (code >= 0x3000 && code <= 0x303f) value += 1;
    else if (code >= 0xff00 && code <= 0xffef) value += 1;
    else if (code >= 0x2000 && code <= 0x206f) value += 0;
    else value -= 1;
  }
  // 分母按码点计数，与 for-of 的迭代口径一致（代理对只算一个字符）
  const units = Array.from(probe).length;
  return units ? value / units : 0;
}

// 按 16 位单元统计结构特征：CJK 及中文标点命中数、两侧字节同为可打印 ASCII 的单元数。
// 真 UTF-16 中文以汉字为主（CJK 命中率高、ASCII 配对率低）；Latin-1 等单字节西文被
// 误当作 UTF-16 时字母会两两配成 ASCII 单元（ASCII 配对率显著偏高）。
export function utf16UnitStats(u8, littleEndian) {
  const limit = Math.min(u8.length, 4096);
  let units = 0;
  let cjk = 0;
  let bothAscii = 0;
  for (let i = 0; i + 1 < limit; i += 2) {
    const lo = littleEndian ? u8[i] : u8[i + 1];
    const hi = littleEndian ? u8[i + 1] : u8[i];
    const code = lo | (hi << 8);
    units += 1;
    if (code >= 0x4e00 && code <= 0x9fff) cjk += 1;
    else if (code >= 0x3000 && code <= 0x303f) cjk += 1;
    else if (code >= 0xff00 && code <= 0xffef) cjk += 1;
    else if (code >= 0x2000 && code <= 0x206f) cjk += 1;
    if (lo >= 0x20 && lo <= 0x7e && hi >= 0x20 && hi <= 0x7e) bothAscii += 1;
  }
  return { units: units, cjk: cjk, bothAscii: bothAscii };
}

// 纯中文的 UTF-16 正文几乎没有零字节，零字节探测不会触发；按两种字节序试解码，
// 只有结构特征可信（CJK 命中率 >= 0.5 且 ASCII 配对率 <= 0.6）时才返回候选，
// 否则返回 null 继续原有 GB18030 -> GBK -> UTF-8 回退链，避免把单字节西文误判为 UTF-16。
export function decodeUtf16Candidate(u8) {
  const le = utf16UnitStats(u8, true);
  const be = utf16UnitStats(u8, false);
  const trusted = (stats) =>
    stats.units > 0 && stats.cjk / stats.units >= 0.5 && stats.bothAscii / stats.units <= 0.6;
  const leOk = trusted(le);
  const beOk = trusted(be);
  if (!leOk && !beOk) return null;
  const useLe = leOk && (!beOk || le.cjk >= be.cjk);
  return useLe ? new TextDecoder("utf-16le").decode(u8) : new TextDecoder("utf-16be").decode(u8);
}

// 编码标签规范化：GB 系统一走 gb18030（GBK/GB2312 的超集）；
// 去掉引号与空白，utf8 归一为 utf-8。空值表示未声明。
const GB_CHARSET_LABELS = { gb2312: 1, gbk: 1, "x-gbk": 1, cp936: 1, gb18030: 1, "gb-18030": 1 };

function normalizeCharsetLabel(name) {
  const text = String(name == null ? "" : name)
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, "");
  if (!text) return "";
  if (text === "utf8") return "utf-8";
  if (text === "utf16") return "utf-16";
  if (text === "utf16le") return "utf-16le";
  if (text === "utf16be") return "utf-16be";
  if (GB_CHARSET_LABELS[text]) return "gb18030";
  return text;
}

// 从响应头 Content-Type 提取 charset；头名大小写无关，值允许单/双引号。
function contentTypeCharset(headers) {
  if (!headers || typeof headers !== "object") return "";
  let contentType = "";
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === "content-type") {
      contentType = headers[key];
      break;
    }
  }
  const match = /charset\s*=\s*["']?([\w.:-]+)["']?/i.exec(String(contentType || ""));
  return match ? match[1] : "";
}

function declaredCharsetRaw(headers, requestCharset) {
  const fromHeader = contentTypeCharset(headers);
  const raw = fromHeader || String(requestCharset == null ? "" : requestCharset);
  return raw.trim().toLowerCase().replace(/^["']|["']$/g, "");
}

// 供解码使用的声明编码：响应头 charset 优先于 request.charset（后者是 POST 表单编码，
// 只在响应头没有 charset 时作为兜底）；伪编码 escape 忽略。
export function responseCharset(headers, requestCharset) {
  const raw = declaredCharsetRaw(headers, requestCharset);
  if (!raw || raw === "escape") return "";
  return normalizeCharsetLabel(raw);
}

function tryDecode(label, u8, fatal) {
  try {
    return fatal ? new TextDecoder(label, { fatal: true }).decode(u8) : new TextDecoder(label).decode(u8);
  } catch (err) {
    return null;
  }
}

// 替换符占非 ASCII 字符的比例：用于识别「主体仍是 UTF-8 / 声明编码」的个别坏字节。
function replacementRatio(text) {
  let repl = 0;
  let nonAscii = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === 0xfffd) repl += 1;
    if (code > 0x7f) nonAscii += 1;
  }
  return repl / Math.max(1, nonAscii);
}

// 解码原始字节并返回 { text, charset, encodingRisk }。
// 顺序：BOM -> 无 BOM UTF-16 零字节探测 -> 声明 utf-16 -> 严格 UTF-8 -> 宽松 UTF-8
// -> 声明编码严格/低替换率 -> GB18030 与 UTF-16 结构候选择优 -> GBK -> 宽松 UTF-8。
// 声明编码成功时 encodingRisk 为空；声明非 UTF-8 但最终只能走回退链时返回该声明，
// 供界面提示「声明编码未能按预期解码」。声明结果不与 GB18030 做可读性择优：
// readableScore 对假名/韩文为负分，会把正确的日韩文本稳定改选成 GB18030 乱码。
export function decodeBufferReport(buffer, declaredCharset) {
  const u8 = new Uint8Array(buffer);
  const declared = normalizeCharsetLabel(declaredCharset);
  const done = (text, charset, risk) => ({ text: text, charset: charset, encodingRisk: risk || "" });
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return done(new TextDecoder("utf-8").decode(u8.subarray(3)), "utf-8", "");
  }
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
    return done(new TextDecoder("utf-16le").decode(u8.subarray(2)), "utf-16le", "");
  }
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
    return done(new TextDecoder("utf-16be").decode(u8.subarray(2)), "utf-16be", "");
  }
  // 无 BOM 的 UTF-16 探测（大量零字节）：UTF-16LE 下 ASCII 的零字节落在奇数索引，
  // 故 oddZeros 更高时是 utf-16le，evenZeros 更高时是 utf-16be。
  const sample = Math.min(u8.length, 4096);
  if (sample >= 16) {
    let evenZeros = 0;
    let oddZeros = 0;
    for (let i = 0; i + 1 < sample; i += 2) {
      if (u8[i] === 0) evenZeros += 1;
      if (u8[i + 1] === 0) oddZeros += 1;
    }
    const half = sample / 2 / 8;
    if (evenZeros > half || oddZeros > half) {
      const useLe = oddZeros > evenZeros;
      return done(
        useLe ? new TextDecoder("utf-16le").decode(u8) : new TextDecoder("utf-16be").decode(u8),
        useLe ? "utf-16le" : "utf-16be",
        ""
      );
    }
  }
  // 声明 utf-16 时先按声明严格解码：纯中文 UTF-16 正文可能没有足够零字节触发上面的探测。
  if (declared === "utf-16" || declared === "utf-16le" || declared === "utf-16be") {
    const declaredText = tryDecode(declared, u8, true);
    if (declaredText !== null && declaredText.indexOf("\uFFFD") === -1) return done(declaredText, declared, "");
  }
  // 严格 UTF-8 优先：错标成 big5/shift_jis 的 UTF-8 页面不能被声明编码改写成乱码。
  const strictUtf8 = tryDecode("utf-8", u8, true);
  if (strictUtf8 !== null) return done(strictUtf8, "utf-8", "");
  // 严格 UTF-8 仅因个别非法字节失败时，页面主体仍是 UTF-8：宽松解码只会留下极少量
  // 替换符（占非 ASCII 字符 <= 5%），此时优先返回宽松 UTF-8。
  const looseUtf8 = new TextDecoder("utf-8").decode(u8);
  if (replacementRatio(looseUtf8) <= 0.05) return done(looseUtf8, "utf-8", "");
  // 站点声明的编码：严格解码成功即采用；个别坏字节时允许 <= 2% 的替换符。
  if (declared && declared !== "utf-8") {
    const strictDeclared = tryDecode(declared, u8, true);
    if (strictDeclared !== null && strictDeclared.indexOf("\uFFFD") === -1) {
      return done(strictDeclared, declared, "");
    }
    const looseDeclared = tryDecode(declared, u8, false);
    if (looseDeclared !== null && replacementRatio(looseDeclared) <= 0.02) {
      return done(looseDeclared, declared, "");
    }
  }
  // 未声明或声明解码失败：沿用原有回退链。GB18030 与 UTF-16 结构候选按可读性择优。
  const fallbackRisk = declared && declared !== "utf-8" ? declared : "";
  const gbText = tryDecode("gb18030", u8, true);
  const utf16Text = decodeUtf16Candidate(u8);
  const useUtf16 = utf16Text !== null && (gbText === null || readableScore(utf16Text) > readableScore(gbText));
  if (useUtf16) return done(utf16Text, "utf-16", fallbackRisk);
  if (gbText !== null) return done(gbText, "gb18030", fallbackRisk);
  const gbkText = tryDecode("gbk", u8, false);
  if (gbkText !== null) return done(gbkText, "gbk", fallbackRisk);
  return done(new TextDecoder("utf-8").decode(u8), "utf-8", fallbackRisk);
}

// 兼容旧调用：只返回文本；需要编码与风险信息时使用 decodeBufferReport。
export function decodeBuffer(buffer, declaredCharset) {
  return decodeBufferReport(buffer, declaredCharset).text;
}

// base64 -> 原始字节：宿主以 bodyBase64 回传的原文在这里转回字节。
// 环境缺少 atob 或内容非法时返回 null，调用方回退到 UTF-8 文本通道。
export function base64ToBytes(base64) {
  const raw = String(base64 == null ? "" : base64).trim();
  if (!raw) return null;
  if (typeof atob !== "function") return null;
  try {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (err) {
    return null;
  }
}

// 统一换行并去掉 BOM 残留
export function normalizeText(text) {
  return String(text == null ? "" : text)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
}

// 判断响应是否可能因非 UTF-8 编码而乱码：响应头 charset 优先于传入的 charset，
// 头名大小写无关、值支持引号；伪编码 escape 忽略。
// 旧宿主回退路径用它给出提示；bodyBase64 通道由 decodeBufferReport 报告声明编码是否失败。
export function detectEncodingRisk(charset, headers) {
  const declared = declaredCharsetRaw(headers, charset);
  if (!declared || declared === "utf-8" || declared === "utf8" || declared === "escape") return "";
  return declared;
}

// 发起书源请求；返回 { ok, text, status, headers, error, encodingRisk }
// 优先走宿主「原始字节」通道（responseType: "arraybuffer"）：拿到 bodyBase64 后本地解码，
// 声明编码能还原的站点不再乱码；声明编码不受支持或解码失败时仍走回退链，并用 encodingRisk 提示。
// 旧宿主忽略该选项、只回 UTF-8 文本（或 base64 非法）时退回文本通道，并保留编码风险提示。
export async function sourceFetch(api, source, request, timeoutMs) {
  const result = {
    ok: false,
    text: "",
    status: 0,
    headers: {},
    error: "",
    encodingRisk: ""
  };
  if (!api || !api.net || typeof api.net.fetch !== "function") {
    result.error = "net-unavailable";
    return result;
  }
  let response;
  try {
    response = await api.net.fetch(request.url, {
      method: request.method || "GET",
      headers: request.headers && Object.keys(request.headers).length ? request.headers : undefined,
      body: request.body || undefined,
      timeoutMs: timeoutMs || SOURCE_FETCH_TIMEOUT_MS,
      responseType: "arraybuffer"
    });
  } catch (err) {
    result.error = (err && err.message) || String(err);
    return result;
  }
  if (!response || typeof response !== "object") {
    result.error = "invalid-response";
    return result;
  }
  result.status = Number(response.status) || 0;
  result.headers = response.headers && typeof response.headers === "object" ? response.headers : {};
  if (response.error) {
    result.error = String(response.error);
    return result;
  }
  if (!response.ok) {
    result.error = "http-" + result.status;
    return result;
  }
  result.ok = true;
  // 新宿主：原始字节 -> 本地解码链恢复原文。bodyBase64 与 body 同时存在时 body 为空串，以 bodyBase64 为准。
  const bytes = typeof response.bodyBase64 === "string" ? base64ToBytes(response.bodyBase64) : null;
  if (bytes) {
    // 响应头声明的 charset 优先；没有头时才回退到请求选项的 charset（POST 表单编码）。
    const declared = responseCharset(result.headers, request.charset);
    const decoded = decodeBufferReport(bytes, declared);
    result.text = normalizeText(decoded.text);
    result.encodingRisk = decoded.encodingRisk || "";
    return result;
  }
  // 旧宿主回退：只有宿主按 UTF-8 解码后的文本，声明非 UTF-8 时保留乱码风险提示
  result.text = typeof response.body === "string" ? response.body : "";
  result.encodingRisk = detectEncodingRisk(request.charset, result.headers);
  return result;
}
