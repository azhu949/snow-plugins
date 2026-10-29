// issue 数据模型：合并、去重、状态流转与筛选排序。
import { ISSUE_STATUS, SEVERITY, STORE_VERSION, SESSION_MISSING_POLLS, FALLBACK, VERIFY_STATUSES } from "./constants.js";
import { nowMs, uid, normalizeText } from "./util.js";
import { normalizeSeverity, normalizeSeverityScope, severityRank, statusRank } from "./parse.js";
import { normalizeCleanupSessionKinds } from "./settings.js";
// ==================== issue 合并与状态 ====================

// 把位置文本拆成文件路径片段：lowerCase 决定是否做大小写归一化，
// 以便匹配用的小写键与展示用的原始路径共用同一套解析规则。
function splitLocationFiles(location, lowerCase) {
  const raw = normalizeText(location);
  const text = (lowerCase ? raw.toLowerCase() : raw).replace(/\\/g, "/");
  if (!text) return [];
  return text
    .split(/[,;、，；]/)
    .map((part) => {
      const trimmed = part.trim().replace(/^\.\//, "");
      const withoutLine = trimmed.replace(/(?::\d+(?:-\d+)?)+$/, "");
      const hasLine = withoutLine !== trimmed;
      const path = withoutLine.replace(/\/+$/, "");
      if (!path) return "";
      // 只有带行号、路径分隔符或文件扩展名的片段才视为文件位置；
      // “多处”这类描述保持未知，交给调用方按保守策略处理。
      if (!hasLine && !path.includes("/") && !/\.[a-z0-9]+$/i.test(path)) return "";
      return path;
    })
    .filter(Boolean);
}

// 从 issue 位置中提取归一化后的文件路径集合：去掉行号 / 行范围，
// 统一路径分隔符并忽略文件顺序。location 由审查提示词约定为“仓库相对路径:行号”。
function issueLocationFiles(location) {
  const files = splitLocationFiles(location, true);
  return Array.from(new Set(files)).sort();
}

// 位置里的第一处文件路径（保留原始大小写）：按文件聚合视图用它做组标题。
// 多文件位置归入第一处文件所在的组，避免同一条 issue 在多组重复出现。
function issuePrimaryFile(location) {
  return splitLocationFiles(location, false)[0] || "";
}

// 指纹只使用文件路径集合与标题：代码位移导致行号变化时仍命中同一条 issue。
// 无法解析出文件位置时退回原始位置文本，避免所有未标注位置的条目互相折叠。
function issueFingerprint(issue) {
  const files = issueLocationFiles(issue.location);
  const locationKey = files.length ? files.join("|") : normalizeText(issue.location).toLowerCase();
  return `${locationKey}|${normalizeText(issue.title).toLowerCase()}`;
}

function createIssue(row, meta) {
  const at = nowMs();
  return {
    id: uid("issue"),
    severity: row.severity || SEVERITY.major,
    title: row.title || FALLBACK["fx.issues.unlocated"],
    location: row.location || "",
    impact: row.impact || "",
    suggestion: row.suggestion || "",
    evidence: row.evidence || "",
    status: ISSUE_STATUS.open,
    source: {
      conversationId: meta?.conversationId || "",
      reviewedAt: at,
      scopeLabel: meta?.scopeLabel || "",
    },
    fix: null,
    // 修复后的只读复审结论：confirmed / still_present / uncertain。
    verify: null,
    // 进入修复前的状态与取证快照：修复失败或被关闭时按此回滚。
    fixingFrom: null,
    // 最近一次重开的来源：fixed = 修复后回归，not_found = 上次取证结论被推翻。
    reopenedFrom: null,
    createdAt: at,
    updatedAt: at,
  };
}

function mergeReviewIssues(existing, incoming, meta) {
  const issues = Array.isArray(existing) ? existing.slice() : [];
  // 记录键到数组下标的映射：更新时整体替换元素，保证 issue 引用发生变化，
  // 依赖浅比较的 memo 组件（IssueCard）才能感知字段更新。
  const indexByKey = new Map(issues.map((issue, index) => [issueFingerprint(issue), index]));
  let added = 0;
  let updated = 0;
  let reopened = 0;
  // 供自动修复限定范围：只处理本次审查新增或重开的 issue。
  const addedIds = [];
  const reopenedIds = [];
  for (const row of incoming) {
    const key = issueFingerprint(row);
    const index = indexByKey.get(key);
    if (index === undefined) {
      const issue = createIssue(row, meta);
      issues.push(issue);
      indexByKey.set(key, issues.length - 1);
      added += 1;
      addedIds.push(issue.id);
      continue;
    }
    const current = issues[index];
    const next = {
      ...current,
      severity: row.severity || current.severity,
      title: row.title || current.title,
      location: row.location || current.location,
      impact: row.impact || current.impact,
      suggestion: row.suggestion || current.suggestion,
      evidence: row.evidence || current.evidence,
      updatedAt: nowMs(),
      source: {
        conversationId: meta?.conversationId || current.source?.conversationId || "",
        reviewedAt: nowMs(),
        scopeLabel: meta?.scopeLabel || current.source?.scopeLabel || "",
      },
    };
    if (current.status === ISSUE_STATUS.fixed || current.status === ISSUE_STATUS.notFound) {
      // 重开来源决定界面文案：已修复项再次命中是「回归」，已确认不存在的条目再次命中
      // 说明上次取证结论被推翻。保留 fix 供追溯，regression 只统计重开次数。
      next.reopenedFrom = current.status;
      // 回归意味着旧的复审结论已经失效，清空等待下一轮复审。
      next.verify = null;
      next.regression = {
        count: Number(current.regression?.count || 0) + 1,
        detectedAt: nowMs(),
        conversationId: meta?.conversationId || "",
        scopeLabel: meta?.scopeLabel || "",
      };
      next.status = ISSUE_STATUS.open;
      reopened += 1;
      reopenedIds.push(next.id);
    } else if (current.status === ISSUE_STATUS.archived) {
      next.status = ISSUE_STATUS.open;
      next.archivedFrom = null;
      next.fix = null;
      next.verify = null;
      // 归档重开是新的审查命中，不是「修复后回归」，旧回归记录必须一并清除。
      next.regression = null;
      next.reopenedFrom = null;
      reopened += 1;
      reopenedIds.push(next.id);
    }
    issues[index] = next;
    updated += 1;
  }
  return { issues, added, updated, reopened, addedIds, reopenedIds };
}

function applyFixResults(issues, results, meta) {
  const list = Array.isArray(issues) ? issues.slice() : [];
  let fixed = 0;
  let notFound = 0;
  let blocked = 0;
  let matched = 0;
  let ignored = 0;
  // 与 mergeReviewIssues 相同：替换元素而不是原地写字段，保证界面能感知状态变化。
  const indexById = new Map(list.map((issue, index) => [issue.id, index]));
  // 只允许改写本批次白名单内的 issue：模型可能输出不属于本批的 id。
  const allowed = Array.isArray(meta?.issueIds) ? new Set(meta.issueIds.map(String)) : null;
  for (const result of results) {
    const index = indexById.get(result.issueId);
    if (index === undefined) continue;
    const issue = list[index];
    if (allowed && !allowed.has(issue.id)) {
      ignored += 1;
      continue;
    }
    matched += 1;
    const next = {
      ...issue,
      fix: {
        conversationId: meta?.conversationId || "",
        result: result.status,
        summary: result.summary,
        files: result.files,
        verification: result.verification,
        at: nowMs(),
      },
      // 新一轮修复会重新进入复审流程：只有产出新结论（fixed / not_found）时才作废旧复审。
      // blocked 表示问题仍未修复，上一轮复审「仍存在」的结论依然描述当前事实，
      // 保留下来供下一次修复的提示词与卡片追溯。
      verify: result.status === "fixed" || result.status === "not_found" ? null : issue.verify,
      // 本轮已有结论，进入修复前的快照不再需要，避免之后误回滚。
      fixingFrom: null,
      updatedAt: nowMs(),
    };
    // 用户已在修复期间归档：保留归档状态与 archivedFrom，只记录本轮修复摘要。
    if (issue.status !== ISSUE_STATUS.archived) {
      if (result.status === "fixed") {
        next.status = ISSUE_STATUS.fixed;
        fixed += 1;
      } else if (result.status === "not_found") {
        // 取证结论是「问题不存在或已失效」：代码未改动，不能记成已修复。
        next.status = ISSUE_STATUS.notFound;
        notFound += 1;
      } else {
        next.status = ISSUE_STATUS.open;
        blocked += 1;
      }
    }
    list[index] = next;
  }
  return { issues: list, fixed, notFound, blocked, matched, ignored };
}

// 复审只读结论：只允许三种状态；旧数据或非法值不保留。
const VERIFY_STATUS_SET = new Set(VERIFY_STATUSES);

// 复审结论携带被复审那一轮的修复快照：blocked 会覆盖 issue.fix，
// 没有快照时下一轮提示词的 previousFix 与 previousVerify 会指向不同轮次。
// 字段与 fix 同构，供提示词复用同一套格式化逻辑。
function normalizeVerifyFixRef(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    conversationId: String(raw.conversationId || ""),
    result: String(raw.result || ""),
    summary: String(raw.summary || ""),
    files: Array.isArray(raw.files) ? raw.files.map((file) => String(file || "")).filter(Boolean) : [],
    verification: String(raw.verification || ""),
    at: Number(raw.at) || 0,
  };
}

function normalizeIssueVerify(raw) {
  if (!raw || typeof raw !== "object" || !VERIFY_STATUS_SET.has(raw.status)) return null;
  return {
    status: raw.status,
    summary: String(raw.summary || ""),
    evidence: String(raw.evidence || ""),
    conversationId: String(raw.conversationId || ""),
    fixRef: normalizeVerifyFixRef(raw.fixRef),
    at: Number(raw.at) || 0,
  };
}

// 可被复核结论改写的状态：已修复（验证修复是否生效）与已确认不存在（核验旧取证结论）。
// 两类目标的结论语义不同，但都允许被新结论推翻，回写规则共用同一份白名单。
const VERIFIABLE_STATUSES = new Set([ISSUE_STATUS.fixed, ISSUE_STATUS.notFound]);

// 回写复核结论：
// - 只回写当前仍为 fixed / not_found 的条目：复核期间被新审查重开或被新修复接管的条目，
//   其结论已经过期，不能再写入 verify。
// - confirmed：已修复项保持已修复；不存在项保持不存在，表示「复核后仍然不存在」。
// - still_present：记录结论后退回待修复（已修复项表示修复没生效，不存在项表示旧结论被推翻）。
// - uncertain：保持原状态，标记待确认，不参与自动清理。
// 未返回结论的条目同样只在仍为可复核状态时标记 uncertain；
// 已经确认过的条目不能被“复审遗漏”降级，保留原结论与证据。
function applyVerifyResults(issues, results, meta) {
  const list = Array.isArray(issues) ? issues.slice() : [];
  const indexById = new Map(list.map((issue, index) => [issue.id, index]));
  const allowed = Array.isArray(meta?.issueIds) ? new Set(meta.issueIds.map(String)) : null;
  // 复审只对被复审的那一轮修复有效：新一轮修复会改写 issue.fix.conversationId，
  // 旧复审期间产生的结果不能回写。旧数据没有轮次信息时保持原行为。
  const fixRounds = new Set(
    (Array.isArray(meta?.fixSessionIds) ? meta.fixSessionIds : [])
      .map((conversationId) => String(conversationId || ""))
      .filter(Boolean),
  );
  const belongsToFixRound = (issue) =>
    !fixRounds.size || fixRounds.has(String(issue?.fix?.conversationId || ""));
  const seen = new Set();
  let confirmed = 0;
  let stillPresent = 0;
  let uncertain = 0;
  let applied = 0;
  const record = (index, status, row) => {
    const issue = list[index];
    const next = {
      ...issue,
      verify: {
        status,
        summary: row?.summary || "",
        evidence: row?.evidence || "",
        conversationId: meta?.conversationId || "",
        // 被复审的那一轮修复：blocked 覆盖 fix 后仍能与复审结论配对。
        fixRef: normalizeVerifyFixRef(issue.fix),
        at: nowMs(),
      },
      updatedAt: nowMs(),
    };
    // 复核未通过：已修复项退回待修复，已确认不存在项退回待修复（旧取证结论被推翻）；
    // 已归档或被重开的条目不会走到这里。
    if (status === "still_present" && VERIFIABLE_STATUSES.has(issue.status)) {
      next.status = ISSUE_STATUS.open;
    }
    list[index] = next;
  };
  for (const result of Array.isArray(results) ? results : []) {
    const index = indexById.get(String(result?.issueId || ""));
    if (index === undefined) continue;
    const issue = list[index];
    if (allowed && !allowed.has(issue.id)) continue;
    if (!belongsToFixRound(issue)) continue;
    // 复核运行期间 issue 可能被新审查重开或被新修复接管：迟到的结论不再写入。
    if (!VERIFIABLE_STATUSES.has(issue.status)) continue;
    // 同一 issueId 的重复行只保留第一条，避免重复计数或后写覆盖。
    if (seen.has(issue.id)) continue;
    seen.add(issue.id);
    const status = VERIFY_STATUS_SET.has(result.status) ? result.status : "uncertain";
    record(index, status, result);
    applied += 1;
    if (status === "confirmed") {
      confirmed += 1;
    } else if (status === "still_present") {
      stillPresent += 1;
    } else {
      uncertain += 1;
    }
  }
  if (allowed) {
    for (const id of allowed) {
      if (seen.has(id)) continue;
      const index = indexById.get(id);
      if (index === undefined) continue;
      const issue = list[index];
      // 已被审查重开、已归档或被新修复接管的条目不再补写待确认。
      if (!VERIFIABLE_STATUSES.has(issue.status)) continue;
      // 已确认条目来自上一轮人工复核：本次模型漏答不能把 confirmed 降级为 uncertain。
      if (issue.verify?.status === "confirmed") continue;
      // 新一轮修复产生的已修复结果不能因旧复审缺少结论而被标记待确认。
      if (!belongsToFixRound(issue)) continue;
      record(index, "uncertain", null);
      uncertain += 1;
      applied += 1;
    }
  }
  return { issues: list, confirmed, stillPresent, uncertain, applied };
}

// 已定论（已修复 / 已确认不存在）与归档条目不再进入修复：它们没有待修复的问题，
// 投入修复只会在会话失败时覆盖已有结论。fixing 仍然放行，交给 hasFixConflict
// 给出「正在修复中」的提示，而不是静默丢弃。
const FIX_BLOCKED_STATUSES = new Set([
  ISSUE_STATUS.archived,
  ISSUE_STATUS.fixed,
  ISSUE_STATUS.notFound,
]);

function isFixSelectable(issue) {
  return Boolean(issue) && !FIX_BLOCKED_STATUSES.has(issue.status);
}

// 可只读复核的目标：已修复且复审未确认（验证修复是否生效），以及已确认不存在且未复核过
// （定向审查旧取证结论是否仍然成立）。confirmed 已有定论，不再重复消耗会话。
function isVerifySelectable(issue) {
  if (!issue || issue.verify?.status === "confirmed") return false;
  return issue.status === ISSUE_STATUS.fixed || issue.status === ISSUE_STATUS.notFound;
}

// 按文件聚合视图的未定位分组键：与真实文件路径不会冲突。
const UNLOCATED_GROUP_KEY = "__unlocated__";
// 组间排序中「没有可修复条目」的哨兵值：severityRank 最大为 2，3 必然排在其后。
// 不能用 Infinity：两个分组相减会得到 NaN，排序会退化为引擎默认行为。
const NO_FIXABLE_SEVERITY_RANK = 3;

// 按文件聚合 issue：同一文件的问题折叠成一组，多文件位置取第一处文件，
// 无法解析出文件的条目统一归入未定位组。
// 组内顺序沿用传入列表的顺序（调用方已按 status / severity 排序）；
// 组间先比较组内首个可执行条目的严重度，再比较可执行条数与条目数，
// 没有可执行条目的分组排在最后，未定位组固定排在最后。
function groupIssuesByFile(issues) {
  const groups = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const file = issuePrimaryFile(issue?.location);
    // 大小写不敏感归组：不同审查会话写出的路径大小写可能不一致。
    const key = file ? file.toLowerCase() : UNLOCATED_GROUP_KEY;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        file,
        issues: [],
        fixableIds: [],
        fixingIds: [],
        priorityRank: NO_FIXABLE_SEVERITY_RANK,
      };
      groups.set(key, group);
    }
    group.issues.push(issue);
    if (issue.status === ISSUE_STATUS.fixing) {
      // 修复中的条目不计入组头数量：引擎的 hasFixConflict 会直接拦截整组，
      // 计入后按钮会显示一个点击后必然失败的 N。
      group.fixingIds.push(issue.id);
    } else if (isFixSelectable(issue)) {
      // 传入列表已按 status / severity 排序：首个可执行条目的严重度就是该组
      // 最需要处理的档位，已修复 / 归档 / 修复中的严重条目不会把整组顶到前面。
      if (!group.fixableIds.length) group.priorityRank = severityRank(issue.severity);
      group.fixableIds.push(issue.id);
    }
  }
  const output = Array.from(groups.values());
  output.sort((left, right) => {
    const leftUnlocated = left.key === UNLOCATED_GROUP_KEY;
    const rightUnlocated = right.key === UNLOCATED_GROUP_KEY;
    if (leftUnlocated !== rightUnlocated) return leftUnlocated ? 1 : -1;
    if (left.priorityRank !== right.priorityRank) return left.priorityRank - right.priorityRank;
    if (right.fixableIds.length !== left.fixableIds.length) {
      return right.fixableIds.length - left.fixableIds.length;
    }
    if (right.issues.length !== left.issues.length) return right.issues.length - left.issues.length;
    return left.key.localeCompare(right.key);
  });
  return output;
}

function markIssuesFixing(issues, ids, conversationId) {
  const target = new Set(ids);
  return (Array.isArray(issues) ? issues : []).map((issue) => {
    if (!target.has(issue.id)) return issue;
    // 记录进入修复前的状态与取证记录：修复会话失败、被关闭或结果缺失时按此回滚。
    // 已在修复中的条目保留首次快照，避免二次标记把 fixing 当成来源状态。
    // 复审结论一并进快照：回滚后仍要能看到上一轮为什么没通过。
    const fixingFrom =
      issue.status === ISSUE_STATUS.fixing
        ? issue.fixingFrom || null
        : {
            status: issue.status,
            fix: issue.fix && typeof issue.fix === "object" ? issue.fix : null,
            verify: issue.verify && typeof issue.verify === "object" ? issue.verify : null,
          };
    return {
      ...issue,
      status: ISSUE_STATUS.fixing,
      fixingFrom,
      fix: {
        conversationId,
        result: "",
        summary: "",
        files: [],
        verification: "",
        at: nowMs(),
      },
      // 保留上一轮复审结论：它描述的是上一轮修复，不是本轮结果。
      // 本轮结果回写（fixed / not_found）或新一轮审查重开时才清空，
      // 这样修复期间卡片仍能追溯，下一次修复的提示词也能拿到失败原因。
      verify: issue.verify && typeof issue.verify === "object" ? issue.verify : null,
      updatedAt: nowMs(),
    };
  });
}

function restoreFixingIssues(issues, conversationId) {
  return (Array.isArray(issues) ? issues : []).map((issue) => {
    if (issue.status !== ISSUE_STATUS.fixing || issue.fix?.conversationId !== conversationId) return issue;
    const from = issue.fixingFrom;
    // 有快照按进入修复前的状态与取证记录恢复；旧数据没有快照时保持 open/null 兜底。
    return {
      ...issue,
      status: from && ARCHIVABLE_FROM.has(from.status) ? from.status : ISSUE_STATUS.open,
      fix: from && from.fix && typeof from.fix === "object" ? from.fix : null,
      // 快照里的复审结论同样恢复；旧版本快照没有该字段时沿用当前值。
      verify: from && from.verify && typeof from.verify === "object" ? from.verify : issue.verify || null,
      fixingFrom: null,
      updatedAt: nowMs(),
    };
  });
}

// 批量释放多个修复会话锁定的 issue：清理历史台账会话与接管已结束的旧会话时使用。
function restoreFixingIssuesForConversations(issues, conversationIds) {
  return (Array.isArray(conversationIds) ? conversationIds : []).reduce(
    (list, conversationId) => restoreFixingIssues(list, conversationId),
    Array.isArray(issues) ? issues : [],
  );
}

// 归档时记录来源状态：只允许可恢复的业务状态，避免把瞬态修复中写回。
const ARCHIVABLE_FROM = new Set([ISSUE_STATUS.open, ISSUE_STATUS.fixed, ISSUE_STATUS.notFound]);

// 旧版本把 not_found 并入 fixed：按最后一次修复结果校正为独立状态。
// regression 只是历史回归计数，被回归重开的条目状态已是 open，不会进入这里的校正。
function migrateLegacyNotFound(status, fix) {
  return status === ISSUE_STATUS.fixed && fix?.result === "not_found" ? ISSUE_STATUS.notFound : status;
}

function archiveIssueRecord(issue) {
  return {
    ...issue,
    status: ISSUE_STATUS.archived,
    archivedFrom: ARCHIVABLE_FROM.has(issue.status) ? issue.status : ISSUE_STATUS.open,
    updatedAt: nowMs(),
  };
}

// 恢复时还原归档前状态；旧数据没有 archivedFrom 时按修复结果兜底。
function restoreIssueRecord(issue) {
  const hasArchivedFrom = ARCHIVABLE_FROM.has(issue.archivedFrom);
  // 已修复 / 已确认不存在的条目再次被审查命中后是 open + 保留 fix + 重开来源，
  // 不能按 fix 结果误判为已定论；两种来源恢复后都回到待修复。
  const fallback = issue.regression || issue.reopenedFrom
    ? ISSUE_STATUS.open
    : issue.fix?.result === "not_found"
      ? ISSUE_STATUS.notFound
      : issue.fix?.result === "fixed"
        ? ISSUE_STATUS.fixed
        : ISSUE_STATUS.open;
  return {
    ...issue,
    status: hasArchivedFrom ? migrateLegacyNotFound(issue.archivedFrom, issue.fix) : fallback,
    archivedFrom: null,
    updatedAt: nowMs(),
  };
}

// 批量删除：只按 id 过滤，不限制状态；卡在修复中的条目也必须能被删除。
function removeIssues(issues, ids) {
  const list = Array.isArray(issues) ? issues : [];
  const target = new Set((Array.isArray(ids) ? ids : []).map(String));
  if (!target.size) return { issues: list.slice(), removed: 0 };
  const next = list.filter((issue) => !target.has(issue.id));
  return { issues: next, removed: list.length - next.length };
}

// 从 conversations 域判断会话是否存在：true 存在，false 不存在，undefined 无法确认。
// items 与 pinned 分属 active / pin 两种状态，两者都可读且都未命中才允许下「不存在」结论。
function findConversationInDomain(domain, conversationId) {
  const id = String(conversationId || "");
  if (!id || !domain || typeof domain !== "object") return undefined;
  if (String(domain.active?.conversationId || "") === id) return true;
  if (!Array.isArray(domain.items) || !Array.isArray(domain.pinned)) return undefined;
  const hit = (list) => list.some((item) => String(item?.conversationId || "") === id);
  return hit(domain.items) || hit(domain.pinned);
}

// 空消息轮次达到阈值后：确认会话不存在则立即结束跟踪；确认存在则继续等待；
// 无法读取 conversations 域时保留旧行为，仅对重连恢复的跟踪判定缺失。
function shouldDeclareSessionMissing(emptyPolls, resumed, exists) {
  if (Number(emptyPolls) < SESSION_MISSING_POLLS) return false;
  if (exists === false) return true;
  if (exists === true) return false;
  return Boolean(resumed);
}

// 按并行上限把本轮 issue 切成批次：每个批次对应一个新会话。
function planFixBatches(issueIds, batchSize) {
  const list = (Array.isArray(issueIds) ? issueIds : []).map(String);
  const size = Math.max(1, Number(batchSize) || 1);
  const batches = [];
  for (let index = 0; index < list.length; index += size) {
    batches.push(list.slice(index, index + size));
  }
  return batches;
}

// 复审批次规划：条数或估算字符数任一超限即换批。
// 单条自身超预算时独占一批，保证不会产生空批或死循环。
function planVerifyBatches(issues, options = {}) {
  const list = Array.isArray(issues) ? issues : [];
  const maxIssues = Math.max(1, Number(options.maxIssues) || Number.MAX_SAFE_INTEGER);
  const maxChars = Math.max(1, Number(options.maxChars) || Number.MAX_SAFE_INTEGER);
  const estimate = typeof options.estimate === "function" ? options.estimate : () => 0;
  const headerChars = Math.max(0, Number(options.headerChars) || 0);
  const batches = [];
  let current = [];
  let chars = headerChars;
  for (const issue of list) {
    const cost = Math.max(0, Number(estimate(issue)) || 0);
    if (current.length && (current.length >= maxIssues || chars + cost > maxChars)) {
      batches.push(current);
      current = [];
      chars = headerChars;
    }
    current.push(issue);
    chars += cost;
  }
  if (current.length) batches.push(current);
  return batches;
}

// 从剩余队列取下一批：跳过已删除或已归档的 issue，其余按顺序填充到上限。
function takeNextFixBatch(queue, issues, batchSize) {
  const list = Array.isArray(issues) ? issues : [];
  const alive = new Map(list.map((issue) => [issue.id, issue]));
  const size = Math.max(1, Number(batchSize) || 1);
  const batchIds = [];
  const remainingIds = [];
  for (const id of Array.isArray(queue) ? queue : []) {
    const issue = alive.get(String(id));
    if (!issue || issue.status === ISSUE_STATUS.archived) continue;
    if (batchIds.length < size) batchIds.push(issue.id);
    else remainingIds.push(issue.id);
  }
  return { batchIds, remainingIds };
}

function sortIssues(issues) {
  return (Array.isArray(issues) ? issues.slice() : []).sort((left, right) => {
    const statusDiff = statusRank(left.status) - statusRank(right.status);
    if (statusDiff !== 0) return statusDiff;
    const severityDiff = severityRank(left.severity) - severityRank(right.severity);
    if (severityDiff !== 0) return severityDiff;
    return (right.updatedAt || 0) - (left.updatedAt || 0);
  });
}

function statusCounts(issues) {
  const counts = { open: 0, fixing: 0, fixed: 0, not_found: 0, archived: 0 };
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (counts[issue.status] === undefined) counts.open += 1;
    else counts[issue.status] += 1;
  }
  return counts;
}

function createIssueState(project) {
  return {
    version: STORE_VERSION,
    projectId: project?.directoryId || "",
    projectPath: project?.path || "",
    projectName: project?.name || "",
    issues: [],
    sessions: {
      review: null,
      fix: null,
      verify: null,
    },
    // 会话台账：本插件创建过的全部会话。sessions 只保留当前一轮，
    // 分批修复的中间批次与历史审查会话只有台账能覆盖，清理时按类型统一处理。
    conversationLog: [],
    lastReviewAt: 0,
    updatedAt: nowMs(),
  };
}

const SESSION_STATUSES = new Set(["running", "done", "error", "detached", "dismissed"]);

// 自动暂存的修复启动基线：只恢复已知结构；缺失或损坏时为 null，
// 收尾暂存据此降级为仅提示、不执行 git add。
// hashes 是每个改动路径的内容指纹，用于区分「启动前就有改动」与「本轮改了同一文件」；
// 旧数据没有该字段时为 null，收尾暂存退回按路径判断。
function normalizeStageBaseline(raw) {
  if (!raw || typeof raw !== "object") return null;
  const at = Number(raw.at) || 0;
  if (!at) return null;
  const paths = Array.isArray(raw.paths)
    ? Array.from(
        new Set(
          raw.paths
            .map((value) => String(value || "").trim())
            .filter((value) => value && value.length <= 300),
        ),
      )
    : [];
  const hashes = {};
  if (raw.hashes && typeof raw.hashes === "object" && !Array.isArray(raw.hashes)) {
    for (const [file, hash] of Object.entries(raw.hashes)) {
      const path = String(file || "").trim();
      if (!path || path.length > 300) continue;
      hashes[path] = String(hash || "").trim().slice(0, 64);
    }
  }
  return {
    at,
    repoRoot: String(raw.repoRoot || ""),
    prefix: String(raw.prefix || "").replace(/\\/g, "/"),
    paths,
    hashes: Object.keys(hashes).length ? hashes : null,
    error: String(raw.error || ""),
  };
}

function normalizeSession(raw) {
  if (!raw || typeof raw !== "object" || !raw.conversationId) return null;
  const batchNumber = Math.max(1, Number(raw.batchNumber) || 1);
  const batchTotal = Math.max(batchNumber, Number(raw.batchTotal) || batchNumber);
  // 认领文件快照：issue 被删除后仍可判断旧修复会话可能修改过哪些文件。
  // 缺失表示旧数据没有快照，冲突判定会回退到现存 issue 记录并保持保守拦截。
  const claimedIssueFiles = {};
  if (raw.claimedIssueFiles && typeof raw.claimedIssueFiles === "object" && !Array.isArray(raw.claimedIssueFiles)) {
    for (const [issueId, files] of Object.entries(raw.claimedIssueFiles)) {
      const id = String(issueId || "").trim();
      if (!id) continue;
      claimedIssueFiles[id] = Array.isArray(files)
        ? Array.from(new Set(files.map((file) => String(file || "").trim()).filter(Boolean)))
        : [];
    }
  }
  const startedAt = Number(raw.startedAt) || 0;
  const lastUpdateAt = Number(raw.lastUpdateAt) || 0;
  // 最后更新时刻早于本批启动时间说明指标来自上一批：字符数不能沿用旧累计值。
  const staleMetrics = lastUpdateAt < startedAt;
  // 自动暂存开关随本轮冻结：旧数据没有该字段时按是否采集到基线回退，
  // 有基线说明启动时开关是开的（保持旧轮次的暂存行为），没有则视为关闭（收尾静默跳过）。
  const stageBaseline = normalizeStageBaseline(raw.stageBaseline);
  const stageEnabled =
    typeof raw.stageEnabled === "boolean" ? raw.stageEnabled : stageBaseline !== null;
  return {
    conversationId: String(raw.conversationId),
    title: String(raw.title || ""),
    startedAt,
    // 本轮修复的启动时间：续批会把 startedAt 刷成最新一批，自动清理判断审查会话来源时
    // 必须使用该冻结值；0 表示旧数据未记录，依赖该基准的清理需保守跳过。
    runStartedAt: Number(raw.runStartedAt) || 0,
    // 活动指标：重开工作台时恢复真实的最后更新时刻与已接收字符数，旧数据回退到会话启动时间。
    // 最后更新时刻不早于启动时间，避免续批残留值让卡片显示「已运行 1 分钟 / 最后更新 3 小时前」。
    receivedChars: staleMetrics ? 0 : Math.max(0, Math.floor(Number(raw.receivedChars) || 0)),
    lastUpdateAt: Math.max(lastUpdateAt, startedAt),
    status: SESSION_STATUSES.has(raw.status) ? raw.status : "running",
    scopeLabel: String(raw.scopeLabel || ""),
    // 复审目标构成（verify / mixed / recheck）：只接受白名单取值。
    // 缺失或未知值保持 null，续批与完成提示按通用复审处理（与旧数据行为一致）。
    mode: raw.mode === "verify" || raw.mode === "recheck" || raw.mode === "mixed" ? raw.mode : null,
    issueIds: Array.isArray(raw.issueIds) ? raw.issueIds.map(String) : [],
    // 分批修复：当前批次、总批次、每批上限、剩余队列与本轮会话记录。
    batchNumber,
    batchTotal,
    batchSize: Math.max(1, Number(raw.batchSize) || 1),
    queue: Array.isArray(raw.queue) ? raw.queue.map(String) : [],
    allIssueIds: Array.isArray(raw.allIssueIds) ? raw.allIssueIds.map(String) : [],
    claimedIssueFiles,
    // 自动暂存的启动基线与开关：重开后仍按同一轮判断是否暂存，避免误暂存或误报。
    stageEnabled,
    stageBaseline,
    // 暂存去重状态：重载后据此判定本轮是否已经处理过暂存，避免用旧基线重复 git add。
    stageRunIds: Array.isArray(raw.stageRunIds)
      ? Array.from(
          new Set(
            raw.stageRunIds
              .map((id) => String(id || "").trim())
              .filter((id) => id && id.length <= 200),
          ),
        ).slice(0, 64)
      : [],
    stageRunState: ["staging", "done", "error", "empty"].includes(raw.stageRunState)
      ? raw.stageRunState
      : "",
    stageRunAt: Number(raw.stageRunAt) || 0,
    sessionIds: Array.isArray(raw.sessionIds)
      ? raw.sessionIds.map(String).filter(Boolean)
      : [String(raw.conversationId)],
    // 复审会话关联的修复轮次：用于复审结束后触发自动清理，以及重启后恢复清理目标。
    fixConversationId: String(raw.fixConversationId || ""),
    fixSessionIds: Array.isArray(raw.fixSessionIds)
      ? raw.fixSessionIds.map(String).filter(Boolean)
      : [],
    fixIssueIds: Array.isArray(raw.fixIssueIds) ? raw.fixIssueIds.map(String).filter(Boolean) : [],
    autoCleanup: Boolean(raw.autoCleanup),
    cleanupAction: raw.cleanupAction === "delete" ? "delete" : "archive",
    // 自动清理的会话范围在启动时随本轮冻结：旧数据缺失时回退默认（修复 + 复审）。
    cleanupSessionKinds: normalizeCleanupSessionKinds(raw.cleanupSessionKinds),
    // 审查启动时冻结的严重度范围：完成解析必须使用同一范围，兼容旧会话回退当前设置。
    issueSeverities:
      Array.isArray(raw.issueSeverities) && raw.issueSeverities.length
        ? normalizeSeverityScope(raw.issueSeverities)
        : null,
    // 复审批次的累计结论数：分批完成后仍能给出本轮完整统计。
    confirmedCount: Math.max(0, Number(raw.confirmedCount) || 0),
    stillPresentCount: Math.max(0, Number(raw.stillPresentCount) || 0),
    uncertainCount: Math.max(0, Number(raw.uncertainCount) || 0),
    activityDismissed: Boolean(raw.activityDismissed),
    lastError: String(raw.lastError || ""),
  };
}

// 运行中的会话：持久化 status 为主，内存 activity 只对同一会话提供实时补充。
function isSessionBusy(session, activity) {
  if (!session || session.status !== "running") return false;
  if (activity && activity.conversationId === session.conversationId) {
    return !["done", "error", "detached", "dismissed"].includes(activity.phase);
  }
  return true;
}

// 会话台账条目：kind 区分审查 / 修复，清理按类型整批处理。
function normalizeConversationEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const conversationId = String(raw.conversationId || "").trim();
  if (!conversationId) return null;
  return {
    conversationId,
    kind: raw.kind === "fix" ? "fix" : raw.kind === "verify" ? "verify" : "review",
    title: String(raw.title || ""),
    createdAt: Number(raw.createdAt) || 0,
  };
}

function normalizeConversationLog(raw) {
  const seen = new Set();
  const list = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const entry = normalizeConversationEntry(item);
    if (!entry || seen.has(entry.conversationId)) continue;
    seen.add(entry.conversationId);
    list.push(entry);
  }
  return list;
}

// 追加会话记录：同一会话 ID 只保留一条，重复追加时更新标题与类型。
function appendConversationLog(log, entry) {
  const normalized = normalizeConversationEntry(entry);
  const list = Array.isArray(log) ? log.slice() : [];
  if (!normalized) return list;
  const index = list.findIndex((item) => item.conversationId === normalized.conversationId);
  if (index >= 0) list[index] = { ...list[index], ...normalized };
  else list.push(normalized);
  return list;
}

// 按类型取本插件的全部会话：以台账为准，再补齐当前 session 的会话 ID。
// 旧版本没有台账，只有 sessionIds 记录了分批修复的各批会话，这里一并兼容。
function conversationsForKind(state, kind) {
  const log = Array.isArray(state?.conversationLog) ? state.conversationLog : [];
  const seen = new Set();
  const list = [];
  for (const entry of log) {
    if (!entry || entry.kind !== kind || seen.has(entry.conversationId)) continue;
    seen.add(entry.conversationId);
    list.push(entry);
  }
  const session = state?.sessions?.[kind];
  if (session) {
    const ids = [session.conversationId, ...(Array.isArray(session.sessionIds) ? session.sessionIds : [])];
    for (const id of ids) {
      const conversationId = String(id || "");
      if (!conversationId || seen.has(conversationId)) continue;
      seen.add(conversationId);
      list.push({
        conversationId,
        kind,
        title: String(session.title || ""),
        createdAt: Number(session.startedAt) || 0,
      });
    }
  }
  return list;
}

function removeConversationsFromLog(log, ids) {
  const list = Array.isArray(log) ? log : [];
  // 调用方可能传数组或 Set（清理时用 Set 合并归档与删除结果）。
  const values = Array.isArray(ids) ? ids : ids instanceof Set ? Array.from(ids) : [];
  const target = new Set(values.map(String));
  if (!target.size) return list.slice();
  return list.filter((entry) => !target.has(entry.conversationId));
}

// 删除模式清理会话后同步清空引用它们的条目来源：删除不可恢复，会话已不存在，
// 保留 conversationId 只会让卡片渲染出必然打开失败的「来源会话」入口。
// 只清 conversationId，reviewedAt / scopeLabel 保留供审计；归档模式不清，会话恢复后入口仍可用。
function clearIssueSourceConversations(issues, ids) {
  const list = Array.isArray(issues) ? issues : [];
  const values = Array.isArray(ids) ? ids : ids instanceof Set ? Array.from(ids) : [];
  const target = new Set(values.map(String).filter(Boolean));
  if (!target.size) return list.slice();
  return list.map((issue) =>
    target.has(String(issue?.source?.conversationId || ""))
      ? { ...issue, source: { ...issue.source, conversationId: "" } }
      : issue,
  );
}

const SESSION_KINDS = ["review", "fix", "verify"];

// 是否存在可清理的会话记录：当前一轮的审查 / 修复 / 复审会话，或台账中的历史会话。
// 面板在没有 issue 时也要据此保留清理入口，否则 issue 被删空后遗留的历史会话无法归档或删除。
function hasCleanupCandidates(state) {
  const log = Array.isArray(state?.conversationLog) ? state.conversationLog : [];
  if (log.length > 0) return true;
  return SESSION_KINDS.some((kind) => Boolean(state?.sessions?.[kind]));
}

// 清理分组：区分当前会话与台账中的历史会话。历史条目只有会话 ID，没有独立运行状态，
// 清理前必须由调用方用宿主 runtime 再核对一次。
function conversationCleanupGroups(state, actions) {
  return SESSION_KINDS.map((kind) => {
    const session = state?.sessions?.[kind] || null;
    const conversations = conversationsForKind(state, kind);
    const currentId = String(session?.conversationId || "");
    const historicalIds = conversations
      .map((entry) => entry.conversationId)
      .filter((conversationId) => conversationId !== currentId);
    // 已停止跟踪 / 已关闭卡片的当前会话同样无法从持久化状态证明已结束：
    // runtime 不可读时不能比历史台账会话更宽松，必须由用户显式确认。
    const ackIds = historicalIds.slice();
    if (session && (session.status === "detached" || session.status === "dismissed") && currentId) {
      ackIds.push(currentId);
    }
    const requested = actions?.[kind];
    const action = requested === "archive" || requested === "delete" ? requested : "keep";
    return {
      kind,
      session,
      conversations,
      historicalIds,
      ackIds,
      action,
      needsAck: action !== "keep" && ackIds.length > 0,
    };
  });
}

// 已能确认结束的跟踪异常：这些错误发生时读取或解析已经停止，AI 不会再回写结果。
const TERMINAL_SESSION_ERRORS = new Set([
  "session-missing",
  "session-error",
  "session-interrupted",
  "session-empty-response",
  "parse-failed",
  "review-parse-failed",
  // 复审已经返回正文但解析失败：宿主不会再产出新回复，属于可确认结束的终态。
  "verify-parse-failed",
  // 复审结果全部属于过期轮次：宿主已返回正文，属于可确认结束的终态。
  "verify-expired",
  // 复审批次创建失败：上一批结果已回写，队列保留，宿主没有新的在途会话。
  "verify-batch-create-failed",
  "batch-create-failed",
]);

// 超时或未知异常的会话可能仍在宿主中运行：清理时不能当作空闲会话处理。
function isSessionPossiblyRunning(session, activity) {
  if (isSessionBusy(session, activity)) return true;
  if (!session || session.status !== "error") return false;
  return !TERMINAL_SESSION_ERRORS.has(String(session.lastError || ""));
}

// 重开来源：新数据直接读取；旧数据只有 regression 时按最后一次修复结果推断。
function normalizeReopenedFrom(raw) {
  if (raw.reopenedFrom === ISSUE_STATUS.fixed || raw.reopenedFrom === ISSUE_STATUS.notFound) {
    return raw.reopenedFrom;
  }
  if (!raw.regression || typeof raw.regression !== "object") return null;
  return raw.fix?.result === "not_found" ? ISSUE_STATUS.notFound : ISSUE_STATUS.fixed;
}

// 修复中快照：只接受可恢复的业务状态，旧数据缺少该字段时为 null。
function normalizeFixingFrom(raw) {
  if (!raw || typeof raw !== "object" || !ARCHIVABLE_FROM.has(raw.status)) return null;
  return {
    status: raw.status,
    fix: raw.fix && typeof raw.fix === "object" ? raw.fix : null,
    // 旧版本快照没有复审结论：归一化后为 null，不影响回滚语义。
    verify: normalizeIssueVerify(raw.verify),
  };
}

function normalizeIssue(raw) {
  if (!raw || typeof raw !== "object") return null;
  const severity = normalizeSeverity(raw.severity) || SEVERITY.major;
  const storedStatus = Object.values(ISSUE_STATUS).includes(raw.status) ? raw.status : ISSUE_STATUS.open;
  // 旧版本把 not_found 并入 fixed：读取时按最后一次修复结果迁移，历史数据也能显示为「不存在」。
  // regression 只是历史计数，不能改变最后一次取证结论，因此不参与阻断。
  const status = migrateLegacyNotFound(storedStatus, raw.fix);
  return {
    id: String(raw.id || uid("issue")),
    severity,
    title: String(raw.title || ""),
    location: String(raw.location || ""),
    impact: String(raw.impact || ""),
    suggestion: String(raw.suggestion || ""),
    evidence: String(raw.evidence || ""),
    status,
    archivedFrom:
      status === ISSUE_STATUS.archived && ARCHIVABLE_FROM.has(raw.archivedFrom)
        ? migrateLegacyNotFound(raw.archivedFrom, raw.fix)
        : null,
    source: raw.source && typeof raw.source === "object" ? raw.source : { conversationId: "", reviewedAt: 0, scopeLabel: "" },
    fix: raw.fix && typeof raw.fix === "object" ? raw.fix : null,
    verify: normalizeIssueVerify(raw.verify),
    fixingFrom: normalizeFixingFrom(raw.fixingFrom),
    regression:
      raw.regression && typeof raw.regression === "object"
        ? {
            count: Number(raw.regression.count) || 1,
            detectedAt: Number(raw.regression.detectedAt) || 0,
            conversationId: String(raw.regression.conversationId || ""),
            scopeLabel: String(raw.regression.scopeLabel || ""),
          }
        : null,
    reopenedFrom: normalizeReopenedFrom(raw),
    createdAt: Number(raw.createdAt) || nowMs(),
    updatedAt: Number(raw.updatedAt) || nowMs(),
  };
}

function normalizeIssueState(raw, project) {
  const base = createIssueState(project);
  if (!raw || typeof raw !== "object") return base;
  const sessions = {
    review: normalizeSession(raw.sessions?.review),
    fix: normalizeSession(raw.sessions?.fix),
    verify: normalizeSession(raw.sessions?.verify),
  };
  // 旧数据没有台账：从当前会话的 conversationId / sessionIds 补齐，
  // 保证分批修复的历史批次也能出现在清理列表里。
  let conversationLog = normalizeConversationLog(raw.conversationLog);
  const known = new Set(conversationLog.map((entry) => entry.conversationId));
  for (const kind of SESSION_KINDS) {
    for (const entry of conversationsForKind({ sessions, conversationLog }, kind)) {
      if (known.has(entry.conversationId)) continue;
      known.add(entry.conversationId);
      conversationLog.push(entry);
    }
  }
  return {
    ...base,
    ...raw,
    version: STORE_VERSION,
    projectId: project?.directoryId || raw.projectId || "",
    projectPath: project?.path || raw.projectPath || "",
    projectName: project?.name || raw.projectName || "",
    issues: Array.isArray(raw.issues) ? raw.issues.map(normalizeIssue).filter(Boolean) : [],
    sessions,
    conversationLog,
    lastReviewAt: Number(raw.lastReviewAt) || 0,
    updatedAt: Number(raw.updatedAt) || nowMs(),
  };
}

function currentStep(snapshot) {
  const activity = snapshot?.activity;
  const finalPhases = new Set(["done", "error", "detached", "dismissed"]);
  if (activity && !finalPhases.has(activity.phase)) {
    return activity.kind === "review" ? "review" : "fix";
  }
  const issues = snapshot?.state?.issues || [];
  if (!issues.length) return "review";
  const counts = statusCounts(issues);
  // 部分修复、部分仍待处理时停在修复步骤，避免流程条提前跳到清理而掩盖剩余项。
  if (counts.open > 0 || counts.fixing > 0) return "fix";
  // 已修复与已确认不存在都已定论，直接进入清理步骤。
  if (counts.fixed > 0 || counts.not_found > 0) return "cleanup";
  return "cleanup";
}

const STATUS_FILTER_VALUES = new Set(["all", ...Object.values(ISSUE_STATUS)]);

function normalizeStatusFilter(value) {
  const text = String(value || "");
  return STATUS_FILTER_VALUES.has(text) ? text : "all";
}

function normalizeSeverityFilter(value) {
  return value === SEVERITY.critical || value === SEVERITY.major || value === SEVERITY.minor
    ? value
    : "all";
}

// 关键词只匹配标题、位置与影响文本；多个词按 AND 匹配，空查询不参与过滤。
function matchesSearchQuery(issue, tokens) {
  if (!tokens.length) return true;
  const haystack = [
    normalizeText(issue?.title),
    normalizeText(issue?.location),
    normalizeText(issue?.impact),
  ]
    .join("\n")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function listVisibleIssues(issues, options) {
  const hasStatusFilter = typeof options?.statusFilter === "string";
  const statusFilter = hasStatusFilter ? normalizeStatusFilter(options.statusFilter) : "";
  // 旧调用方只传 showArchived 时保留原语义；新调用统一使用 statusFilter。
  const showArchived = Boolean(options?.showArchived);
  const filter = normalizeSeverityFilter(options?.severityFilter);
  const queryTokens = normalizeText(options?.searchQuery).toLowerCase().split(" ").filter(Boolean);
  let list = Array.isArray(issues) ? issues.slice() : [];
  if (statusFilter) {
    // 「全部」保持原列表语义：不显示已归档；查看归档需显式选择「已归档」。
    if (statusFilter === "all") list = list.filter((issue) => issue.status !== ISSUE_STATUS.archived);
    else list = list.filter((issue) => issue.status === statusFilter);
  } else if (!showArchived) {
    list = list.filter((issue) => issue.status !== ISSUE_STATUS.archived);
  }
  if (filter !== "all") list = list.filter((issue) => issue.severity === filter);
  if (queryTokens.length) list = list.filter((issue) => matchesSearchQuery(issue, queryTokens));
  return sortIssues(list);
}

export {
  issueFingerprint,
  issueLocationFiles,
  issuePrimaryFile,
  groupIssuesByFile,
  createIssue,
  mergeReviewIssues,
  applyFixResults,
  applyVerifyResults,
  isFixSelectable,
  isVerifySelectable,
  markIssuesFixing,
  restoreFixingIssues,
  restoreFixingIssuesForConversations,
  archiveIssueRecord,
  restoreIssueRecord,
  removeIssues,
  normalizeConversationLog,
  appendConversationLog,
  conversationsForKind,
  hasCleanupCandidates,
  conversationCleanupGroups,
  removeConversationsFromLog,
  clearIssueSourceConversations,
  findConversationInDomain,
  shouldDeclareSessionMissing,
  planFixBatches,
  planVerifyBatches,
  takeNextFixBatch,
  sortIssues,
  statusCounts,
  createIssueState,
  normalizeIssueState,
  isSessionBusy,
  isSessionPossiblyRunning,
  currentStep,
  listVisibleIssues,
  normalizeStatusFilter,
  normalizeSeverityFilter,
};
