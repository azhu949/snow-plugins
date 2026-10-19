// 结构化结果解析：从审查 / 修复会话的最终回复中提取 JSON 块。
import { ISSUE_STATUS, SEVERITY } from "./constants.js";
import { escapeRegExp, normalizeText, truncate } from "./util.js";

function extractFence(text, tag) {
  const source = String(text || "");
  const pattern = new RegExp("```[ \\t]*" + escapeRegExp(tag) + "[^\\n]*\\n([\\s\\S]*?)```", "gi");
  let match = null;
  let last = null;
  while ((match = pattern.exec(source))) {
    last = match[1];
  }
  if (last === null) {
    // 输出被截断时没有闭合围栏：取标记之后的内容再尝试一次。
    const openPattern = new RegExp("```[ \\t]*" + escapeRegExp(tag) + "[^\\n]*\\n([\\s\\S]*)$", "i");
    const open = source.match(openPattern);
    if (open) last = open[1];
  }
  return last;
}

function parseJsonLoose(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const candidates = [text];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) candidates.push(text.slice(objStart, objEnd + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 继续尝试下一个候选片段。
    }
  }
  return null;
}

// 读取指定围栏：区分「围栏不存在」与「围栏存在但内容非法」。
// 专用围栏存在时，调用方不得再回退到通用 json 或文本行，避免把其它内容当作结果。
function readTaggedFence(text, tag, predicate) {
  const raw = extractFence(text, tag);
  if (raw === null) return { present: false, ok: false, value: null };
  const parsed = parseJsonLoose(raw);
  const ok = parsed !== null && (!predicate || predicate(parsed));
  return { present: true, ok, value: ok ? parsed : null };
}

function isIssueArray(value) {
  return (
    Array.isArray(value) &&
    (value.length === 0 ||
      value.some((item) => item && typeof item === "object" && (item.severity || item.level || item.title || item.summary)))
  );
}

// 通用 json 回退块必须显式带严重程度，避免把普通说明或引用列表当作审查结果。
function isStrictIssueArray(value) {
  return (
    Array.isArray(value) &&
    (value.length === 0 ||
      value.some(
        (item) =>
          item &&
          typeof item === "object" &&
          (item.severity || item.level) &&
          (item.title || item.summary || item.location || item.file || item.impact || item.description),
      ))
  );
}

function normalizeSeverity(raw) {
  const text = normalizeText(raw).toLowerCase();
  if (!text) return "";
  if (/严重|高|critical|high|blocker|fatal|p0|p1/.test(text)) return SEVERITY.critical;
  if (/一般|中|major|medium|moderate|normal|p2/.test(text)) return SEVERITY.major;
  if (/建议|低|minor|low|suggestion|info|trivial|p3/.test(text)) return SEVERITY.minor;
  return "";
}

function severityRank(severity) {
  if (severity === SEVERITY.critical) return 0;
  if (severity === SEVERITY.major) return 1;
  return 2;
}

function statusRank(status) {
  if (status === ISSUE_STATUS.open) return 0;
  if (status === ISSUE_STATUS.fixing) return 1;
  if (status === ISSUE_STATUS.fixed) return 2;
  // 不存在的条目已经定论、无需修复，排在已修复之后、归档之前。
  if (status === ISSUE_STATUS.notFound) return 3;
  return 4;
}

function issueLocationText(row) {
  const location = normalizeText(row.location ?? row.position ?? row.place);
  if (location) return location;
  const file = normalizeText(row.file ?? row.path ?? row.filename);
  const line = normalizeText(row.line ?? row.lineNumber ?? row.startLine);
  if (!file) return "";
  return line ? `${file}:${line}` : file;
}

function normalizeIssueRow(row) {
  if (!row || typeof row !== "object") return null;
  const title = normalizeText(row.title ?? row.summary ?? row.problem ?? row.name ?? row.message);
  let severity = normalizeSeverity(row.severity ?? row.level ?? row.priority);
  if (!severity) severity = SEVERITY.major;
  const location = issueLocationText(row);
  const impact = normalizeText(row.impact ?? row.effect ?? row.risk ?? row.description);
  const suggestion = normalizeText(row.suggestion ?? row.fix ?? row.recommendation ?? row.solution);
  if (!title && !location && !impact) return null;
  return {
    severity,
    title: title || truncate(location || impact, 80).text,
    location,
    impact,
    suggestion,
    evidence: normalizeText(row.evidence ?? row.proof),
  };
}

// 文本兜底只认「行首严重度 + 冒号 + 标题」：分隔符必填，避免把「严重程度：」这类说明行当成问题。
const FALLBACK_ISSUE_PATTERN =
  /^ {0,3}(?:[-*+]\s+)?(?:\*\*)?[【\[]?(严重|一般|建议|critical|major|minor|high|medium|low)[】\]]?(?:\*\*)?[ \t]*[:：][ \t]*(\S.*)$/i;

// 说明性文字不是问题：标题为程度描述或以「未发现问题」收尾时丢弃。
function isFallbackNoiseTitle(title) {
  return (
    /^(?:程度|级别|等级|评级)\s*[:：]/.test(title) ||
    /(?:未发现问题|没有发现问题|无问题|没有问题|no\s+(?:issues?|findings?|problems?)|nothing\s+(?:found|to\s+report)|lgtm)/i.test(
      title,
    )
  );
}

// 续行位置识别：只从当前条目的续行取值，遇到下一条严重度行立即停止。
// 缩进深于条目的行视为续行；与条目同缩进时只接受「见 / 位置：path:line」这类位置行，
// 避免把下一条 issue 的标题或位置算给当前条目。
const FALLBACK_ANY_ISSUE_PATTERN =
  /^\s*(?:[-*+]\s+)?(?:\*\*)?[【\[]?(严重|一般|建议|critical|major|minor|high|medium|low)[】\]]?(?:\*\*)?[ \t]*[:：]/i;
const FALLBACK_POSITION_PREFIX =
  /^(?:[-*+]\s+)?(?:见|详见|参见|位置|文件|相关文件|路径|行号|at|located(?:\s+at)?|file|line)\s*[:：]?\s*/i;
const FALLBACK_LOCATION_PATTERN = /([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+):(\d+)(?:-\d+)?/;

function leadingIndentWidth(line) {
  let width = 0;
  for (const char of String(line || "")) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

function matchFallbackLocation(text) {
  const match = String(text || "").match(FALLBACK_LOCATION_PATTERN);
  return match ? `${match[1]}:${match[2]}` : "";
}

function resolveFallbackLocation(visible, index) {
  const line = visible[index];
  // 标题行自带位置（如「严重：src/a.ts:12 未判空」）时优先采用。
  const own = matchFallbackLocation(line);
  if (own) return own;
  const baseIndent = leadingIndentWidth(line);
  for (let cursor = index + 1; cursor < visible.length; cursor += 1) {
    const next = visible[cursor];
    // 空行结束当前条目；围栏内容已在上方被置空，同样在此结束。
    if (!next.trim()) break;
    // 下一条 issue（含建议级与「严重程度：」说明行）立即停止。
    if (FALLBACK_ANY_ISSUE_PATTERN.test(next)) break;
    const indent = leadingIndentWidth(next);
    if (indent < baseIndent) break;
    const positionLine = FALLBACK_POSITION_PREFIX.test(next.trim());
    if (indent === baseIndent && !positionLine) break;
    const found = matchFallbackLocation(next);
    if (found) return found;
  }
  return "";
}

function parseFallbackIssueLines(text) {
  const lines = String(text || "").split(/\r?\n/);
  // 围栏内的代码与 diff 不是审查结论，先屏蔽，位置窗口也不会再从中取路径。
  const visible = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      visible.push("");
      continue;
    }
    visible.push(inFence ? "" : line);
  }
  const rows = [];
  for (let index = 0; index < visible.length; index += 1) {
    const line = visible[index];
    const match = line.match(FALLBACK_ISSUE_PATTERN);
    if (!match) continue;
    const severity = normalizeSeverity(match[1]);
    if (!severity) continue;
    const title = normalizeText(match[2].replace(/^\*\*|\*\*$/g, ""));
    if (!title || isFallbackNoiseTitle(title)) continue;
    const location = resolveFallbackLocation(visible, index);
    rows.push({
      severity,
      title,
      location,
      impact: "",
      suggestion: "",
      evidence: "",
    });
  }
  return rows;
}

// 审查结果三态：issues 有条目；empty 是可信的空结论；failed 表示缺少结构化块或内容无法解析。
function parseReviewResult(text) {
  const source = String(text || "");
  const tagged = readTaggedFence(source, "snow-issues", isIssueArray);
  let rows = null;
  if (tagged.present) {
    // 专用围栏存在时不再回退：坏 JSON 就是解析失败，不能当成「没有发现问题」。
    rows = tagged.ok ? tagged.value : null;
  } else {
    const jsonTagged = readTaggedFence(source, "json", isStrictIssueArray);
    if (jsonTagged.ok) {
      rows = jsonTagged.value;
    } else {
      // 通用 json 块不合法时仍允许文本兜底，但文本行本身已收紧，不会把说明行当作问题。
      const fallback = parseFallbackIssueLines(source);
      if (fallback.length) rows = fallback;
    }
  }
  if (!Array.isArray(rows)) return { issues: [], status: "failed" };
  const normalized = [];
  // 可用行数在过滤建议级之前统计：用于区分「合法但只有建议级」与「整组行都缺正文字段」。
  let usable = 0;
  for (const row of rows) {
    const issue = normalizeIssueRow(row);
    if (!issue) continue;
    usable += 1;
    if (issue.severity === SEVERITY.minor) continue;
    normalized.push(issue);
  }
  // 非空数组却没有任何可用行（如 [{"severity":"严重"}]）属于格式异常，必须报解析失败，
  // 不能当成「未发现问题」；只有真正的空数组或仅含可用建议级行才是 empty。
  const status = normalized.length ? "issues" : rows.length > 0 && usable === 0 ? "failed" : "empty";
  return { issues: normalized, status };
}

function parseReviewIssues(text) {
  return parseReviewResult(text).issues;
}

function isFixResultArray(value) {
  return (
    Array.isArray(value) &&
    (value.length === 0 ||
      value.some((item) => item && typeof item === "object" && (item.issueId || item.issue_id || item.id)))
  );
}

// 通用 json 回退块必须是修复结果形状：契约 id 加状态，避免把引用的 issue 列表当作修复结果。
function isStrictFixResultArray(value) {
  return (
    Array.isArray(value) &&
    (value.length === 0 ||
      value.some(
        (item) =>
          item &&
          typeof item === "object" &&
          (item.issueId || item.issue_id) &&
          (item.status || item.result || item.outcome),
      ))
  );
}

function normalizeFixStatus(raw) {
  // 统一空白/连字符，先识别否定与 not_found，再匹配整串肯定词，避免 not fixed 落入 fixed。
  const text = normalizeText(raw)
    .toLowerCase()
    // 先去掉包裹引号（含中文引号），否则右引号会挡住尾部标点。
    .replace(/^[\s"'`“‘「『]+|[\s"'`”’」』]+$/g, "")
    // 再去掉尾部中英文标点与空白，兼容「已修复。」「Fixed.」「已修复. 」。
    .replace(/[\s。．.!！,，;；]+$/g, "")
    .replace(/[\s-]+/g, "_");
  if (!text) return "blocked";
  if (text === "fixed" || text === "not_found" || text === "blocked") return text;
  if (/^(not_found|notfound|missing|invalid|gone|不存在|已失效|未复现|无法复现|不再复现)$/.test(text)) {
    return "not_found";
  }
  if (
    /^(not_fixed|unfixed|not_done|undone|unresolved|not_resolved|partially_fixed|wontfix|not_applicable|未修复|未通过|未完成|未修好|没有修复|未能修复|无法修复|修复失败|部分修复|blocked|pending|open|todo|failed|error|cannot|阻塞|待处理|待确认|需要确认)$/.test(
      text,
    )
  ) {
    return "blocked";
  }
  if (/^(fixed|done|resolved|已修复|修复完成|通过|验证通过|passed|pass)$/.test(text)) {
    return "fixed";
  }
  return "blocked";
}

function parseFixResults(text) {
  const source = String(text || "");
  const tagged = readTaggedFence(source, "snow-fix-results", isFixResultArray);
  let rows = null;
  if (tagged.present) {
    rows = tagged.ok ? tagged.value : null;
  } else {
    const jsonTagged = readTaggedFence(source, "json", isStrictFixResultArray);
    if (jsonTagged.present) rows = jsonTagged.ok ? jsonTagged.value : null;
  }
  if (!Array.isArray(rows)) return [];
  const results = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const issueId = normalizeText(row.issueId ?? row.issue_id ?? row.id);
    if (!issueId) continue;
    const status = normalizeFixStatus(row.status ?? row.result ?? row.outcome) || "blocked";
    const files = Array.isArray(row.files)
      ? row.files.map((item) => normalizeText(item)).filter(Boolean)
      : normalizeText(row.files)
        ? [normalizeText(row.files)]
        : [];
    results.push({
      issueId,
      status,
      summary: normalizeText(row.summary ?? row.message ?? row.note),
      files,
      verification: normalizeText(row.verification ?? row.verify ?? row.test),
    });
  }
  return results;
}

export { normalizeSeverity, severityRank, statusRank, parseReviewResult, parseReviewIssues, parseFixResults };
