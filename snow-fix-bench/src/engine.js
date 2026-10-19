// 引擎：项目树、Git 审查请求、会话跟踪、issue 持久化与清理动作。
import {
  STORE_PREFIX,
  SETTINGS_KEY,
  REVIEW_IDLE_TIMEOUT_MS,
  REVIEW_MAX_TIMEOUT_MS,
  FIX_IDLE_TIMEOUT_MS,
  FIX_MAX_TIMEOUT_MS,
  UNKNOWN_RUNTIME_IDLE_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  STREAM_MESSAGE_READ_MS,
  IDLE_MESSAGE_READ_MS,
  RUNTIME_READ_MS,
  WATCH_ABORTED_POLLS,
  WATCH_EMPTY_POLLS,
  WATCH_EMPTY_GRACE_MS,
  WATCH_UNKNOWN_STABLE_POLLS,
  COMMIT_LIMIT,
  COMMIT_COMMAND_LIMIT,
  COMMIT_FIELD_SEP,
  BASH_TOOL_NAMES,
  TREE_IGNORED_DIRS,
  TREE_LOAD_LIMIT,
  SESSION_MISSING_POLLS,
  SESSION_MISSING_RECHECK_POLLS,
  ISSUE_STATUS,
} from "./constants.js";
import {
  nowMs,
  sleep,
  shouldReadMessages,
  shouldReadRuntime,
  isWatchTimedOut,
  resolveWatchIdleTimeoutMs,
  normalizeWatchTimeouts,
  buildRuntimeProgressSignature,
  formatStamp,
  parseLocation,
  resolveIssueFilePath,
  encodeReviewTag,
} from "./util.js";
import {
  createIssueState,
  normalizeIssueState,
  mergeReviewIssues,
  applyFixResults,
  isFixSelectable,
  markIssuesFixing,
  restoreFixingIssues,
  restoreFixingIssuesForConversations,
  removeIssues,
  findConversationInDomain,
  shouldDeclareSessionMissing,
  planFixBatches,
  takeNextFixBatch,
  isSessionPossiblyRunning,
  issueLocationFiles,
  archiveIssueRecord,
  restoreIssueRecord,
  appendConversationLog,
  conversationsForKind,
  conversationCleanupGroups,
  removeConversationsFromLog,
  currentStep,
} from "./issues.js";
import { buildReviewPrompt, buildFixPrompt, langText } from "./prompts.js";
import { parseReviewResult, parseFixResults } from "./parse.js";
import { createStore } from "./store.js";
import { createT } from "./i18n.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings.js";

const ENGINE_CACHE = new WeakMap();

export function resolveEngine(api) {
  let engine = ENGINE_CACHE.get(api);
  if (!engine) {
    engine = createEngine(api);
    ENGINE_CACHE.set(api, engine);
  }
  return engine;
}

function normalizeProjects(domain) {
  const directories = (Array.isArray(domain?.directories) ? domain.directories : [])
    .map((item) => ({
      directoryId: String(item?.directoryId || ""),
      name: String(item?.name || item?.path || ""),
      path: String(item?.path || ""),
      kind: String(item?.kind || "local"),
      isActive: Boolean(item?.isActive),
      sortOrder: Number(item?.sortOrder) || 0,
    }))
    .filter((item) => item.directoryId)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const collections = (Array.isArray(domain?.collections) ? domain.collections : [])
    .map((item) => ({
      collectionId: String(item?.collectionId || ""),
      name: String(item?.name || ""),
      color: String(item?.color || ""),
      sortOrder: Number(item?.sortOrder) || 0,
      memberDirectoryIds: Array.isArray(item?.memberDirectoryIds) ? item.memberDirectoryIds.map(String) : [],
      linkedDirectoryIds: Array.isArray(item?.linkedDirectoryIds) ? item.linkedDirectoryIds.map(String) : [],
    }))
    .filter((item) => item.collectionId)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  return {
    loading: false,
    directories,
    collections,
    activeId: String(domain?.active?.directoryId || ""),
  };
}

function toTreeNodes(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    name: entry.name,
    path: entry.path,
    isDirectory: Boolean(entry.isDirectory),
    children: null,
    loaded: false,
    error: "",
  }));
}

function updateTreeNodes(nodes, path, updater) {
  if (!Array.isArray(nodes)) return nodes;
  let changed = false;
  const next = nodes.map((node) => {
    if (node.path === path) {
      changed = true;
      return updater(node);
    }
    if (node.children && node.children.length) {
      const children = updateTreeNodes(node.children, path, updater);
      if (children !== node.children) {
        changed = true;
        return { ...node, children };
      }
    }
    return node;
  });
  return changed ? next : nodes;
}

// 沙箱档借内置终端 MCP 工具执行只读 git log：命令本身只读取历史，不改动仓库。
function buildCommitLogCommand(limit) {
  const count = Math.max(1, Number(limit) || COMMIT_COMMAND_LIMIT);
  return (
    `git log -n ${count} ` +
    '--date="format:%Y-%m-%d %H:%M" ' +
    '--pretty=format:"%H%x1f%h%x1f%an%x1f%ad%x1f%s"'
  );
}

// 解析 git log 的 %x1f 分隔输出，容忍空行与提交信息内的分隔符。
export function parseCommitLog(stdout, limit) {
  const commits = [];
  const seen = new Set();
  const max = Math.max(1, Number(limit) || COMMIT_COMMAND_LIMIT);
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split(COMMIT_FIELD_SEP);
    if (parts.length < 5) continue;
    const hash = String(parts[0] || "").trim();
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    commits.push({
      hash,
      shortHash: String(parts[1] || hash.slice(0, 7)).trim(),
      author: String(parts[2] || "").trim(),
      date: String(parts[3] || "").trim(),
      message: parts.slice(4).join(COMMIT_FIELD_SEP).trim(),
    });
    if (commits.length >= max) break;
  }
  return commits;
}

// MCP 工具结果由 native 以 JSON 字符串返回，兼容对象形态。
function readToolPayload(data) {
  if (!data) return null;
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return typeof data === "object" ? data : null;
}

function isStagedFile(file) {
  return file.indexStatus !== " " && file.indexStatus !== "?" && file.indexStatus !== "";
}

function isUnstagedFile(file) {
  return file.workdirStatus === "?" || (file.workdirStatus !== " " && file.workdirStatus !== "");
}

function createEngine(api) {
  const t = createT(() => api.locale);
  const store = createStore({
    status: "loading",
    error: "",
    project: null,
    state: createIssueState(null),
    git: {
      loading: false,
      error: "",
      status: null,
      commits: [],
      panelOpen: false,
      commandLoading: false,
      commandError: "",
    },
    tree: { root: "", nodes: [], expanded: {}, loading: {}, error: "", unavailable: false },
    projects: { loading: false, directories: [], collections: [], activeId: "" },
    showArchived: false,
    severityFilter: "all",
    settings: DEFAULT_SETTINGS,
    selected: [],
    dialog: null,
    activity: null,
    toast: null,
  });

  let mounted = 0;
  let projectSubscription = null;
  let projectSubscriptionPromise = null;
  let saving = Promise.resolve();
  let projectEpoch = 0;
  const tracking = new Map();
  const starting = new Map();
  let toastTimer = null;
  let persistBlocked = false;
  let gitSeq = 0;
  let treeSeq = 0;
  let commandSeq = 0;
  const childSeq = new Map();
  // 自动补提交记录的一次性开关：每次打开弹窗 / 刷新 / 切换项目重置。
  let commitAutoTried = false;
  // 终端工具确定性不可用（未启用 / 无权限）时记住结果，避免每次打开弹窗都重复失败调用。
  // 仅由用户刷新或切换项目重置，不写入持久化数据。
  let commitCommandUnavailable = false;

  function currentProjectId() {
    return store.get().project?.directoryId || "";
  }

  function captureProject() {
    const project = store.get().project;
    if (!project?.directoryId) return null;
    return {
      directoryId: project.directoryId,
      name: project.name,
      path: project.path,
      epoch: projectEpoch,
    };
  }

  function isProjectCurrent(token) {
    const project = store.get().project;
    const directoryId = token?.directoryId || token?.projectId;
    if (!project || !directoryId || project.directoryId !== directoryId) return false;
    if (token.epoch !== undefined && token.epoch !== projectEpoch) return false;
    return true;
  }

  function cancelToken(token) {
    if (!token) return;
    token.cancelled = true;
    if (tracking.get(token.kind) === token) tracking.delete(token.kind);
  }

  function isCurrentToken(token) {
    return Boolean(token) && !token.cancelled && tracking.get(token.kind) === token;
  }

  function cancelAllTracking() {
    for (const token of tracking.values()) token.cancelled = true;
    tracking.clear();
  }

  function reserveStart(kind) {
    const active = tracking.get(kind);
    if (active && !active.cancelled) return null;
    const pending = starting.get(kind);
    if (pending && pending.epoch === projectEpoch) return null;
    const reservation = { kind, epoch: projectEpoch };
    starting.set(kind, reservation);
    return reservation;
  }

  function releaseStart(kind, reservation) {
    if (starting.get(kind) === reservation) starting.delete(kind);
  }

  // 会话认领的 issue 文件快照：issue 被删除后，仍需据此判断旧会话可能修改的文件范围。
  function claimIssueFiles(issues) {
    const files = {};
    for (const issue of Array.isArray(issues) ? issues : []) {
      if (!issue?.id) continue;
      files[String(issue.id)] = issueLocationFiles(issue.location);
    }
    return files;
  }

  function fixSessionClaimIds(session) {
    return Array.from(
      new Set(
        [
          ...(Array.isArray(session?.allIssueIds) ? session.allIssueIds : []),
          ...(Array.isArray(session?.issueIds) ? session.issueIds : []),
          ...(Array.isArray(session?.queue) ? session.queue : []),
        ]
          .map(String)
          .filter(Boolean),
      ),
    );
  }

  // 删除 issue 前把其文件位置写入会话快照；旧版本会话没有快照时同样能补齐。
  // 不能直接从认领列表移除已删除的 id：旧会话可能仍在运行并修改该文件。
  function recordDeletedIssueClaims(session, issues, deletedIds) {
    if (!session) return session;
    const deleted = new Set((Array.isArray(deletedIds) ? deletedIds : []).map(String));
    if (!deleted.size) return session;
    const claimed = new Set(fixSessionClaimIds(session));
    const snapshot =
      session.claimedIssueFiles && typeof session.claimedIssueFiles === "object"
        ? { ...session.claimedIssueFiles }
        : {};
    let changed = false;
    for (const issue of Array.isArray(issues) ? issues : []) {
      if (!issue?.id || !deleted.has(issue.id) || !claimed.has(issue.id)) continue;
      if (Object.prototype.hasOwnProperty.call(snapshot, issue.id)) continue;
      snapshot[issue.id] = issueLocationFiles(issue.location);
      changed = true;
    }
    return changed ? { ...session, claimedIssueFiles: snapshot } : session;
  }

  // 修复中或可能仍在运行的修复会话会与新修复并发修改同一批文件。
  // 停止跟踪只停止读取，不会中止宿主会话，因此必须先处理旧会话；
  // 旧会话的当前批次与尚未派发的队列都属于在途工作范围。
  function hasFixConflict(issueIds) {
    const snapshot = store.get();
    const ids = new Set(Array.isArray(issueIds) ? issueIds.map(String) : []);
    if (
      snapshot.state.issues.some(
        (issue) => ids.has(issue.id) && issue.status === ISSUE_STATUS.fixing,
      )
    ) {
      return true;
    }
    const session = snapshot.state.sessions.fix;
    if (!session) return false;
    // 续批会从 queue 取 issue：停止跟踪 / 关闭卡片只停止读取，旧会话仍可能继续处理队列，
    // 因此重叠判断必须覆盖当前批次与尚未派发的队列。allIssueIds 含已完成批次，仅作文件兜底。
    const claimed = new Set(
      [
        ...(Array.isArray(session.issueIds) ? session.issueIds : []),
        ...(Array.isArray(session.queue) ? session.queue : []),
      ]
        .map(String)
        .filter(Boolean),
    );
    // 关闭运行中的卡片只停止跟踪，不会中止宿主会话：dismissed 与 detached 一样
    // 必须继续阻挡可能仍在运行的旧会话，避免两个 AI 并发修改同一批文件。
    const possiblyRunning =
      session.status === "detached" ||
      session.status === "dismissed" ||
      isSessionPossiblyRunning(session, snapshot.activity);
    if (!possiblyRunning) return false;
    if (Array.from(ids).some((id) => claimed.has(id))) return true;
    // 不同 issue 也可能落在同一文件：按 location 的文件路径判断重叠。
    // 关闭卡片后 issueIds / queue 会被清空，此时用 allIssueIds 兜底；
    // 同一 issue 的重新修复沿用现有“关闭即释放”语义，不在这里重复拦截。
    const fileClaimIds = claimed.size
      ? Array.from(claimed)
      : (Array.isArray(session.allIssueIds) ? session.allIssueIds : [])
          .map(String)
          .filter((id) => id && !ids.has(id));
    if (!fileClaimIds.length) return false;
    const claimedFiles = new Set();
    const claimedIssueFiles =
      session.claimedIssueFiles && typeof session.claimedIssueFiles === "object"
        ? session.claimedIssueFiles
        : {};
    const issuesById = new Map(snapshot.state.issues.map((issue) => [issue.id, issue]));
    let unknownClaim = false;
    for (const issueId of fileClaimIds) {
      const issue = issuesById.get(issueId);
      // issue 已删除时使用删除前保存的文件快照；两者都没有则无法证明安全。
      const files = issue ? issueLocationFiles(issue.location) : claimedIssueFiles[issueId];
      if (!Array.isArray(files) || !files.length) {
        unknownClaim = true;
        continue;
      }
      for (const file of files) claimedFiles.add(file);
    }
    if (unknownClaim) return true;
    if (!claimedFiles.size) return false;
    const selectedFiles = new Set();
    for (const issue of snapshot.state.issues) {
      if (!ids.has(issue.id)) continue;
      for (const file of issueLocationFiles(issue.location)) selectedFiles.add(file);
    }
    // 本次选择没有可解析的位置时同样无法证明安全。
    if (!selectedFiles.size) return true;
    return Array.from(selectedFiles).some((file) => claimedFiles.has(file));
  }

  async function closeConversation(conversationId) {
    if (!conversationId) return;
    const removed = await runWrite("conversations.remove", { conversationId });
    if (!removed.ok) await runWrite("conversations.archive", { conversationIds: [conversationId] });
  }

  // 新建会话后把宿主界面切到该会话：宿主的 conversations.create 只负责写库，
  // 不会改变当前选中会话，用户原本需要自己在侧栏再点一次。
  // 切换失败不应影响已创建的会话与跟踪流程，因此只返回结果不抛错。
  async function activateConversation(conversationId) {
    if (!conversationId) return false;
    const result = await runWrite("conversations.activate", { conversationId });
    return Boolean(result.ok);
  }

  async function runWrite(actionId, params) {
    try {
      return await api.write.run(actionId, params);
    } catch (error) {
      return { ok: false, action: actionId, error: String(error?.message || error) };
    }
  }

  function setToast(kind, text) {
    store.set({ toast: { kind, text } });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      const current = store.get().toast;
      if (current && current.text === text) store.set({ toast: null });
    }, 6000);
  }

  function clearToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (store.get().toast) store.set({ toast: null });
  }

  // 弹窗内的动作失败同时写入 dialog.error：toast 会消失，内联错误必须保留到用户重试或关闭。
  function setDialogError(type, message) {
    const dialog = store.get().dialog;
    if (!dialog || dialog.type !== type) return;
    store.set({ dialog: { ...dialog, error: message } });
  }

  function setActivity(patch) {
    const current = store.get().activity;
    if (!current) return;
    store.set({ activity: { ...current, ...patch } });
  }

  function updateActivityProgress(conversationId, phase, message) {
    const current = store.get().activity;
    if (!current || current.conversationId !== conversationId) return;
    if (current.phase === phase && current.message === message) return;
    store.set({ activity: { ...current, phase, message } });
  }

  async function saveState(scope = {}) {
    const snapshot = store.get();
    const projectId = String(scope.projectId || snapshot.project?.directoryId || "");
    if (!projectId) return { ok: false };
    const state = scope.state || snapshot.state;
    const payload = { ...state, projectId, updatedAt: nowMs() };
    // 只有当前项目与目标项目一致时才更新内存态；跨项目写入仍落到捕获项目的 key。
    if (snapshot.project?.directoryId === projectId) store.set({ state: payload });
    if (persistBlocked) {
      setToast("error", t("fx.error.storageBlocked"));
      return { ok: false, blocked: true };
    }
    const key = STORE_PREFIX + projectId;
    saving = saving
      .catch(() => null)
      .then(() => api.storage.setJson(key, payload))
      .then(() => ({ ok: true }))
      .catch((error) => {
        setToast(
          "error",
          t("fx.error.saveFailed", { error: String(error?.cause?.message || error?.message || error) }),
        );
        return { ok: false, error };
      });
    return saving;
  }

  // 脚本级设置与项目 issue 分开存储：读取失败时保留默认值，不打断工作台启动。
  async function loadSettings() {
    try {
      const raw = await api.storage.getJson(SETTINGS_KEY);
      store.set({ settings: normalizeSettings(raw) });
    } catch {
      store.set({ settings: DEFAULT_SETTINGS });
    }
  }

  async function setSettings(patch) {
    const next = normalizeSettings({ ...store.get().settings, ...patch });
    store.set({ settings: next });
    try {
      await api.storage.setJson(SETTINGS_KEY, next);
      return { ok: true, settings: next };
    } catch (error) {
      setToast(
        "error",
        t("fx.settings.failed", {
          error: String(error?.cause?.message || error?.message || error),
        }),
      );
      return { ok: false, error };
    }
  }

  async function readDirectory(path) {
    const snow = window.snow;
    if (!snow || typeof snow.readDirectoryEntries !== "function") {
      throw new Error("readDirectoryEntries unavailable");
    }
    const entries = await snow.readDirectoryEntries(path);
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => !(entry.isDirectory && TREE_IGNORED_DIRS.has(entry.name)))
      .sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
        return String(left.name).localeCompare(String(right.name), "zh-CN");
      })
      .slice(0, TREE_LOAD_LIMIT);
  }

  // 让已打开的审查弹窗跟随 Git 数据刷新：只保留仍然存在的勾选项。
  function syncReviewDialog() {
    const snapshot = store.get();
    const dialog = snapshot.dialog;
    if (!dialog || dialog.type !== "review") return;
    // 弹窗属于打开它的项目：切换项目后旧弹窗的勾选不能回填到新项目。
    if (dialog.directoryId && dialog.directoryId !== snapshot.project?.directoryId) return;
    const git = snapshot.git;
    const files = git.status?.files || [];
    const stagedKeys = new Set(files.filter(isStagedFile).map((file) => `staged:${file.path}`));
    const unstagedKeys = new Set(files.filter(isUnstagedFile).map((file) => `unstaged:${file.path}`));
    const commitKeys = new Set((git.commits || []).map((commit) => `commit:${commit.hash}`));
    // 沙箱档先拿到仓库状态、git log 稍后才返回：提交列表未就绪时不能把「未知」
    // 当成「提交都已消失」，否则刷新会清空用户已勾选的提交。
    const commitsReady = Boolean(git.panelOpen) || Boolean(git.commandLoading);
    store.set({
      dialog: {
        ...dialog,
        staged: dialog.staged.filter((key) => stagedKeys.has(key)),
        unstaged: dialog.unstaged.filter((key) => unstagedKeys.has(key)),
        commits: commitsReady ? dialog.commits.filter((key) => commitKeys.has(key)) : dialog.commits,
        loading: Boolean(git.loading),
      },
    });
  }

  // 统一合并 git 片段：避免整对象替换丢掉命令通道的加载/错误状态。
  function setGit(patch, expectedProjectId) {
    if (expectedProjectId && currentProjectId() !== expectedProjectId) return false;
    store.set({ git: { ...store.get().git, ...patch } });
    return true;
  }

  async function loadGit() {
    const seq = ++gitSeq;
    const project = store.get().project;
    const directoryId = project?.directoryId || "";
    const stale = () => seq !== gitSeq || (directoryId && currentProjectId() !== directoryId);
    if (!project?.path) {
      setGit({ loading: false, error: "", status: null, commits: [], panelOpen: false });
      syncReviewDialog();
      return;
    }
    const appSnow = typeof window !== "undefined" ? window.snow : null;
    setGit({ loading: true, error: "" }, directoryId);
    try {
      if (appSnow && typeof appSnow.gitStatus === "function") {
        const [status, commits] = await Promise.all([
          appSnow.gitStatus(project.path),
          typeof appSnow.gitLog === "function" ? appSnow.gitLog(project.path, 0, COMMIT_LIMIT) : Promise.resolve([]),
        ]);
        if (stale()) return;
        setGit(
          {
            loading: false,
            error: "",
            status,
            commits: Array.isArray(commits) ? commits : [],
            panelOpen: true,
          },
          directoryId,
        );
        syncReviewDialog();
        return;
      }
      // 沙箱档拿不到 window.snow：仓库状态走脚本元数据 git 域，
      // 提交记录只来自只读 git log 命令通道；命令返回前不预置提交。
      const response = await api.metadata.get("git", {
        params: { projectPath: project.path, projectId: project.directoryId },
      });
      if (stale()) return;
      const status = response?.domains?.git?.status || null;
      setGit(
        {
          loading: false,
          error: "",
          status,
          commits: [],
          panelOpen: false,
        },
        directoryId,
      );
      syncReviewDialog();
      void autoLoadCommits({ directoryId, epoch: projectEpoch });
    } catch (error) {
      if (stale()) return;
      setGit(
        {
          loading: false,
          error: String(error?.message || error),
          status: null,
          commits: [],
          panelOpen: false,
        },
        directoryId,
      );
      syncReviewDialog();
    }
  }

  // 沙箱档没有 git IPC：借宿主内置终端 MCP 工具执行只读 git log，取回 stdout。
  // 命令固定、只读，不接受自由输入。
  // silent=true 时不弹 toast：自动补数据不应该打断用户。
  async function loadCommitsViaCommand(options) {
    const silent = Boolean(options?.silent);
    const snapshot = store.get();
    const project = snapshot.project;
    if (!project?.path) {
      if (!silent) setToast("error", t("fx.toast.noProject"));
      return;
    }
    // 必须先检查在途命令再取序号：被 commandLoading 拦下的重复调用若推进 commandSeq，
    // 会让真正在途的调用变成 stale，结果被丢弃且 loading 永远不复位。
    if (snapshot.git.commandLoading) return;
    const seq = ++commandSeq;
    const directoryId = project?.directoryId || "";
    const stale = () => seq !== commandSeq || (directoryId && currentProjectId() !== directoryId);
    store.set({ git: { ...store.get().git, commandLoading: true, commandError: "" } });

    const args = {
      command: buildCommitLogCommand(COMMIT_COMMAND_LIMIT),
      description: t("fx.review.commitsDescription"),
      workingDirectory: project.path,
      timeout: 20000,
    };

    // native 只认内部全名；公开名在旧宿主/新宿主上可能被直接透传，逐个尝试。
    let result = null;
    let lastError = "";
    for (const toolFullName of BASH_TOOL_NAMES) {
      result = await runWrite("mcpTools.call", { toolFullName, projectId: project.directoryId, args });
      // 项目在等待期间被切换：丢弃本次结果，避免写错项目。
      if (stale()) return;
      if (result.ok) break;
      lastError = String(result.error || "");
      // 只有「名字解析不到」才换下一个名字；权限/启用状态问题换名字也没用。
      if (!/no longer available|Invalid MCP tool name|Unknown tool/i.test(lastError)) break;
    }

    const fail = (message) => {
      if (stale()) return;
      store.set({ git: { ...store.get().git, commandLoading: false, commandError: message } });
      if (!silent) setToast("error", t("fx.review.commitsFailed", { error: message }));
    };

    if (!result || !result.ok) {
      const denied = result?.denied?.reason;
      if (denied === "write-declaration-missing") {
        commitCommandUnavailable = true;
        fail(t("fx.review.commitsDenied"));
        return;
      }
      const unavailable =
        /no longer available|Unknown tool|Invalid MCP tool name|is disabled by default|is disabled for the current project|disabled by Lite mode/i.test(
          lastError,
        );
      if (unavailable) commitCommandUnavailable = true;
      fail(unavailable ? t("fx.review.commitsToolUnavailable") : lastError || "mcpTools.call failed");
      return;
    }

    const payload = readToolPayload(result.data);
    if (!payload) {
      fail("empty tool result");
      return;
    }
    const stdout = String(payload.stdout || "");
    const stderr = String(payload.stderr || "");
    const exitCode = payload.exitCode;
    if (payload.error || (typeof exitCode === "number" && exitCode !== 0)) {
      const detail = String(payload.error || stderr || `exit code ${exitCode}`).trim();
      fail(detail.split(/\r?\n/)[0] || "git log failed");
      return;
    }

    if (stale()) return;
    const commits = parseCommitLog(stdout, COMMIT_COMMAND_LIMIT);
    store.set({
      git: {
        ...store.get().git,
        commandLoading: false,
        commandError: "",
        commits,
        panelOpen: true,
      },
    });
    syncReviewDialog();
    if (!silent) setToast("info", t("fx.review.commitsLoaded", { count: commits.length }));
  }

  // 打开审查弹窗 / 刷新时自动补提交记录：同一轮只尝试一次，避免和宿主渲染互相触发。
  // 只在审查弹窗打开时执行，避免用户没看审查面板时也跑命令。
  async function autoLoadCommits(options) {
    if (commitCommandUnavailable) return;
    if (commitAutoTried) return;
    const snapshot = store.get();
    if (snapshot.dialog?.type !== "review") return;
    // status 为 null 表示 git 元数据暂时读不到，仍允许命令通道尝试；
    // 只有明确不是 Git 仓库时才跳过，避免每次打开弹窗都执行注定失败的 git log。
    if (snapshot.git.status?.isRepo === false) return;
    if (!canRunCommitCommand()) return;
    if (!snapshot.project?.path) return;
    if (options?.directoryId && currentProjectId() !== options.directoryId) return;
    if (options?.epoch !== undefined && options.epoch !== projectEpoch) return;
    if (snapshot.git.commandLoading) return;
    if ((snapshot.git.commits || []).length > 0) return;
    commitAutoTried = true;
    await loadCommitsViaCommand({ silent: true });
  }

  // 完全权限档能直接调 gitLog 时不需要这条命令通道。
  function canRunCommitCommand() {
    const appSnow = typeof window !== "undefined" ? window.snow : null;
    return !(appSnow && typeof appSnow.gitLog === "function");
  }

  async function loadRootTree() {
    const seq = ++treeSeq;
    const project = store.get().project;
    if (!project?.path) return;
    const directoryId = project.directoryId;
    const rootPath = project.path;
    const stale = () => seq !== treeSeq || currentProjectId() !== directoryId || store.get().tree.root !== rootPath;
    const appSnow = typeof window !== "undefined" ? window.snow : null;
    const canRead = Boolean(appSnow && typeof appSnow.readDirectoryEntries === "function");
    store.set({
      tree: { root: rootPath, nodes: [], expanded: {}, loading: {}, error: "", unavailable: !canRead },
    });
    if (project.kind !== "local" || !canRead) return;
    try {
      const entries = await readDirectory(project.path);
      if (stale()) return;
      store.set({ tree: { ...store.get().tree, nodes: toTreeNodes(entries), error: "" } });
    } catch (error) {
      if (stale()) return;
      store.set({ tree: { ...store.get().tree, error: String(error?.message || error) } });
    }
  }

  async function toggleDirectory(node) {
    const tree = store.get().tree;
    const expanded = { ...tree.expanded };
    if (expanded[node.path]) {
      delete expanded[node.path];
      store.set({ tree: { ...tree, expanded } });
      return;
    }
    expanded[node.path] = true;
    store.set({ tree: { ...tree, expanded } });
    if (node.loaded || node.loading) return;
    await loadChildren(node.path);
  }

  async function loadChildren(path) {
    const directoryId = currentProjectId();
    const rootPath = store.get().tree.root;
    const seq = (childSeq.get(path) || 0) + 1;
    childSeq.set(path, seq);
    const stale = () =>
      currentProjectId() !== directoryId ||
      store.get().tree.root !== rootPath ||
      childSeq.get(path) !== seq;
    const tree = store.get().tree;
    store.set({ tree: { ...tree, loading: { ...tree.loading, [path]: true } } });
    try {
      const entries = await readDirectory(path);
      if (stale()) return;
      const current = store.get().tree;
      const loading = { ...current.loading };
      delete loading[path];
      const nodes = updateTreeNodes(current.nodes, path, (node) => ({
        ...node,
        children: toTreeNodes(entries),
        loaded: true,
        error: "",
      }));
      store.set({ tree: { ...current, nodes, loading } });
    } catch (error) {
      if (stale()) return;
      const current = store.get().tree;
      const loading = { ...current.loading };
      delete loading[path];
      const nodes = updateTreeNodes(current.nodes, path, (node) => ({
        ...node,
        loaded: false,
        error: String(error?.message || error),
      }));
      store.set({ tree: { ...current, nodes, loading } });
    } finally {
      if (childSeq.get(path) === seq) childSeq.delete(path);
    }
  }

  function sessionActivityBase(kind, session) {
    return {
      kind,
      conversationId: session.conversationId,
      startedAt: session.startedAt,
      phase: "waiting",
      message: "",
      error: "",
      issueIds: session.issueIds || [],
      batchNumber: session.batchNumber || 1,
      batchTotal: session.batchTotal || 1,
    };
  }

  function describeSessionError(lastError) {
    if (!lastError || lastError === "timeout") return "";
    if (lastError === "parse-failed") return t("fx.toast.fixParseFailed");
    if (lastError === "review-parse-failed") return t("fx.toast.reviewParseFailed");
    if (lastError === "session-interrupted") return t("fx.activity.sessionInterrupted");
    if (lastError === "session-empty-response") return t("fx.activity.sessionEmptyResponse");
    return t("fx.activity.failed", { error: lastError });
  }

  // 重开工作台或切回项目时从持久化会话重建活动卡片：
  // 运行中的继续自动跟踪；未被用户关闭的已停止/报错会话保留卡片，供用户「继续跟踪」重试。
  function buildActivityFromState(state) {
    const fix = state?.sessions?.fix;
    const review = state?.sessions?.review;
    if (fix && fix.status === "running") return { ...sessionActivityBase("fix", fix), phase: "waiting" };
    if (review && review.status === "running") return { ...sessionActivityBase("review", review), phase: "waiting" };
    if (fix && (fix.status === "detached" || fix.status === "error") && !fix.activityDismissed) {
      return {
        ...sessionActivityBase("fix", fix),
        phase: fix.status === "detached" ? "detached" : "error",
        error: describeSessionError(fix.lastError),
        timedOut: fix.lastError === "timeout",
      };
    }
    if (review && (review.status === "detached" || review.status === "error") && !review.activityDismissed) {
      return {
        ...sessionActivityBase("review", review),
        phase: review.status === "detached" ? "detached" : "error",
        error: describeSessionError(review.lastError),
        timedOut: review.lastError === "timeout",
      };
    }
    return null;
  }

  async function setProject(directory) {
    const project = {
      directoryId: String(directory?.directoryId || ""),
      name: String(directory?.name || directory?.path || ""),
      path: String(directory?.path || ""),
      kind: String(directory?.kind || "local"),
    };
    if (!project.directoryId) return;
    const epoch = ++projectEpoch;
    // 切换项目时停止所有跟踪并作废在途启动，避免上一项目的会话结果写入新项目状态。
    cancelAllTracking();
    starting.clear();
    persistBlocked = false;
    commitAutoTried = false;
    commitCommandUnavailable = false;
    let raw = null;
    let loadError = null;
    try {
      raw = await api.storage.getJson(STORE_PREFIX + project.directoryId);
    } catch (error) {
      loadError = error;
    }
    // 读取期间又切换了项目：丢弃本次加载，避免旧项目晚到覆盖新项目。
    if (epoch !== projectEpoch) return;
    if (loadError) {
      if (loadError.code === "parse") {
        if (loadError.backupError) {
          // 原始数据既损坏又备份失败：暂停写入，避免下次保存覆盖仅存的原始内容。
          persistBlocked = true;
          setToast(
            "error",
            t("fx.error.storageBackup", {
              error: String(loadError.backupError?.message || loadError.backupError),
            }),
          );
        } else {
          setToast("error", t("fx.error.loadCorrupt", { key: `${STORE_PREFIX}${project.directoryId}:corrupt` }));
        }
      } else {
        persistBlocked = true;
        setToast(
          "error",
          t("fx.error.storageRead", {
            error: String(loadError?.cause?.message || loadError?.message || loadError),
          }),
        );
      }
      raw = null;
    }
    let state = normalizeIssueState(raw, project);
    // 旧版本关闭超时 / 未知错误卡片时只写了 activityDismissed，会话 claim 仍会阻挡重试；
    // 加载时补做一次释放，避免升级后同一批 issue 仍然无法再次修复。
    const dismissedFix = state.sessions.fix;
    if (dismissedFix?.activityDismissed && shouldReleaseFixLock(dismissedFix)) {
      state = {
        ...state,
        issues: restoreFixingIssues(state.issues, dismissedFix.conversationId),
        sessions: { ...state.sessions, fix: releaseFixSession(dismissedFix) },
      };
    }
    store.set({
      project,
      state,
      status: "ready",
      error: "",
      selected: [],
      showArchived: false,
      severityFilter: "all",
      dialog: null,
      activity: buildActivityFromState(state),
      tree: { root: project.path, nodes: [], expanded: {}, loading: {}, error: "", unavailable: false },
      git: {
        loading: true,
        error: "",
        status: null,
        commits: [],
        panelOpen: false,
        commandLoading: false,
        commandError: "",
      },
    });
    void loadGit();
    void loadRootTree();
    if (mounted > 0) resumeTracking();
  }

  function ensureProjectSubscription() {
    if (projectSubscription || projectSubscriptionPromise) return projectSubscriptionPromise;
    const attach = (subscription) => {
      if (!subscription || typeof subscription.unsubscribe !== "function") return null;
      projectSubscription = subscription;
      if (mounted === 0) {
        subscription.unsubscribe();
        projectSubscription = null;
      }
      return subscription;
    };
    let subscription = null;
    try {
      subscription = api.metadata.subscribe("projects", (next) => {
        const domain = next?.domains?.projects;
        if (domain) store.set({ projects: normalizeProjects(domain) });
        const nextActive = domain?.active;
        if (!nextActive?.directoryId) return;
        if (nextActive.directoryId === store.get().project?.directoryId) return;
        void setProject(nextActive);
      });
    } catch {
      return null;
    }
    // 脚本插件的 snow.metadata.subscribe 同步返回 { unsubscribe }；
    // 旧宿主 / 面板 API 可能返回 Promise，这里同时兼容两种形态。
    if (subscription && typeof subscription.then === "function") {
      projectSubscriptionPromise = Promise.resolve(subscription)
        .then(attach)
        .catch(() => null)
        .finally(() => {
          projectSubscriptionPromise = null;
        });
      return projectSubscriptionPromise;
    }
    attach(subscription);
    return projectSubscriptionPromise;
  }

  async function init() {
    if (!api?.write?.run || !api?.metadata?.get) {
      store.set({ status: "unsupported" });
      return;
    }
    if (!api.storage?.getJson || !api.storage?.setJson) {
      store.set({ status: "unsupported" });
      return;
    }
    await loadSettings();
    try {
      const response = await api.metadata.get("projects");
      const domain = response?.domains?.projects;
      store.set({ projects: normalizeProjects(domain) });
      const active = domain?.active;
      if (!active?.directoryId) {
        store.set({ status: "no-project" });
        ensureProjectSubscription();
        return;
      }
      await setProject(active);
      ensureProjectSubscription();
    } catch (error) {
      store.set({ status: "error", error: String(error?.message || error) });
    }
  }

  async function mount() {
    mounted += 1;
    if (mounted !== 1) return;
    if (store.get().status === "loading") {
      await init();
      return;
    }
    if (store.get().status === "ready") {
      ensureProjectSubscription();
      resumeTracking();
    }
  }

  function unmount() {
    mounted = Math.max(0, mounted - 1);
    if (mounted > 0) return;
    cancelAllTracking();
    if (projectSubscription) {
      projectSubscription.unsubscribe();
      projectSubscription = null;
    }
  }

  async function loadProjects() {
    try {
      const response = await api.metadata.get("projects");
      store.set({ projects: normalizeProjects(response?.domains?.projects) });
    } catch {
      // 项目列表刷新失败不阻断当前工作。
    }
  }

  async function activateProject(directoryId) {
    const targetId = String(directoryId || "");
    if (!targetId || targetId === store.get().project?.directoryId) return;
    const result = await runWrite("projects.activate", { directoryId: targetId });
    if (!result.ok) {
      setToast("error", result.error || "projects.activate failed");
      return;
    }
    const response = await api.metadata.get("projects").catch(() => null);
    const domain = response?.domains?.projects;
    if (domain) store.set({ projects: normalizeProjects(domain) });
    const active = domain?.active;
    if (active?.directoryId) await setProject(active);
  }

  function refresh() {
    // 用户主动刷新时允许重新自动尝试一次提交读取（例如刚在 MCP 面板启用 Terminal）。
    commitAutoTried = false;
    commitCommandUnavailable = false;
    void loadGit();
    void loadRootTree();
    void loadProjects();
  }

  async function reload() {
    store.set({ status: "loading", error: "" });
    await init();
  }

  function setShowArchived(value) {
    store.set({ showArchived: Boolean(value), selected: [] });
  }

  function setSeverityFilter(value) {
    store.set({ severityFilter: value || "all", selected: [] });
  }

  function toggleSelected(issueId) {
    const selected = store.get().selected.slice();
    const index = selected.indexOf(issueId);
    if (index >= 0) selected.splice(index, 1);
    else selected.push(issueId);
    store.set({ selected });
  }

  function selectMany(issueIds) {
    store.set({ selected: Array.from(new Set(issueIds)) });
  }

  function clearSelection() {
    store.set({ selected: [] });
  }

  function openDialog(dialog) {
    store.set({ dialog });
  }

  function closeDialog() {
    store.set({ dialog: null });
  }

  function buildScopeSelection(dialog) {
    const git = store.get().git;
    const files = git.status?.files || [];
    const stagedKeys = new Set(dialog?.staged || []);
    const unstagedKeys = new Set(dialog?.unstaged || []);
    const commitKeys = new Set(dialog?.commits || []);
    const stagedFiles = files.filter((file) => {
      const key = `staged:${file.path}`;
      return stagedKeys.has(key) && file.indexStatus !== " " && file.indexStatus !== "?" && file.indexStatus !== "";
    });
    const unstagedFiles = files.filter((file) => {
      const key = `unstaged:${file.path}`;
      return (
        unstagedKeys.has(key) &&
        (file.workdirStatus === "?" || (file.workdirStatus !== " " && file.workdirStatus !== ""))
      );
    });
    const commits = (git.commits || []).filter((commit) => commitKeys.has(`commit:${commit.hash}`));
    return { stagedFiles, unstagedFiles, commits };
  }

  function gitFileLabel(file) {
    return file.oldPath ? `${file.status} ${file.oldPath} -> ${file.path}` : `${file.status} ${file.path}`;
  }

  function gitCommitLabel(commit) {
    return `${commit.shortHash} ${commit.date} - ${commit.message}（${commit.author}）`;
  }

  // diff 读取失败不应中断整次审查：逐项捕获并把失败项降级为清单备注。
  async function readDiffItem(label, read) {
    try {
      const result = await read();
      if (!result || typeof result !== "object") {
        return { label, diff: "", isBinary: false, failed: true, error: "" };
      }
      const error = String(result.error || "").trim();
      if (error) {
        return { label, diff: "", isBinary: false, failed: true, error };
      }
      return {
        label,
        diff: result.content || "",
        isBinary: Boolean(result.isBinary),
        failed: false,
        error: "",
      };
    } catch (error) {
      return {
        label,
        diff: "",
        isBinary: false,
        failed: true,
        error: String(error?.message || error || "").trim(),
      };
    }
  }

  async function buildReviewRequest(dialog) {
    const project = store.get().project;
    const token = captureProject();
    const git = store.get().git;
    const appSnow = typeof window !== "undefined" ? window.snow : null;
    const selection = buildScopeSelection(dialog);
    const statusLimitHit = Boolean(git.status?.statusLimitHit);
    // 只有按文件范围审查时，Git 清单截断才会造成漏审；只选提交记录时不受影响。
    const scopeTruncated =
      statusLimitHit && selection.stagedFiles.length + selection.unstagedFiles.length > 0;
    const sections = [];
    const diffFailures = [];
    const count = selection.stagedFiles.length + selection.unstagedFiles.length + selection.commits.length;
    let scopeLabel = t("fx.review.scopeCurrent");

    if (count > 0 && appSnow && typeof appSnow.gitFileDiff === "function") {
      const staged = await Promise.all(
        selection.stagedFiles.map((file) =>
          readDiffItem(gitFileLabel(file), () => appSnow.gitFileDiff(project.path, file.path, true)),
        ),
      );
      const unstaged = await Promise.all(
        selection.unstagedFiles.map((file) =>
          readDiffItem(gitFileLabel(file), () => appSnow.gitFileDiff(project.path, file.path, false)),
        ),
      );
      const commits =
        typeof appSnow.gitCommitDiff === "function"
          ? await Promise.all(
              selection.commits.map((commit) =>
                readDiffItem(gitCommitLabel(commit), () => appSnow.gitCommitDiff(project.path, commit.hash)),
              ),
            )
          : [];
      const pushSection = (title, items) => {
        if (!items.length) return;
        for (const item of items) {
          if (item.failed) diffFailures.push({ label: item.label, error: item.error });
        }
        const readable = items.filter((item) => !item.failed);
        if (readable.length) sections.push({ title, items: readable });
      };
      pushSection(langText(api.locale).staged, staged);
      pushSection(langText(api.locale).unstaged, unstaged);
      pushSection(langText(api.locale).commits, commits);
    }
    if (count > 0) scopeLabel = t("fx.review.scopeChanges", { count });
    // diff 读取期间可能已经切换项目：丢弃旧项目的审查范围。
    if (token && !isProjectCurrent(token)) throw new Error(t("fx.error.projectSwitched"));

    // 沙箱档拿不到 diff：把选中的文件与提交清单交给 AI，由它自行读取文件并执行 git diff / git show。
    const scopeFiles = [];
    if (sections.length === 0 && count > 0) {
      const labels = langText(api.locale);
      for (const file of selection.stagedFiles) scopeFiles.push(`${labels.staged}: ${gitFileLabel(file)}`);
      for (const file of selection.unstagedFiles) scopeFiles.push(`${labels.unstaged}: ${gitFileLabel(file)}`);
      for (const commit of selection.commits) {
        scopeFiles.push(`${labels.commits}: ${gitCommitLabel(commit)}`);
      }
    }

    const currentCode = sections.length === 0 && scopeFiles.length === 0;
    const prompt = buildReviewPrompt({
      locale: api.locale,
      repoPath: project.path,
      branch: git.status?.currentBranch || "",
      sections,
      scopeFiles,
      diffFailures,
      note: dialog?.note || "",
      currentCode,
      scopeTruncated,
    });
    return {
      prompt,
      scopeLabel,
      summary: `${t("fx.review.title")} · ${scopeLabel}`,
      currentCode,
      repoMissing: git.status?.isRepo === false,
      statusLimitHit,
      scopeTruncated,
      diffFailures: diffFailures.length,
    };
  }

  async function startReview(dialog) {
    const token = captureProject();
    if (!token) throw new Error(t("fx.toast.noProject"));
    const reservation = reserveStart("review");
    if (!reservation) {
      setToast("error", t("fx.toast.reviewBusy"));
      setDialogError("review", t("fx.toast.reviewBusy"));
      return;
    }
    try {
      const built = await buildReviewRequest(dialog);
      if (!isProjectCurrent(token)) throw new Error(t("fx.error.projectSwitched"));
      const title = t("fx.title.review", { project: token.name, time: formatStamp(new Date()) });
      // 走宿主官方 review 标签：消息显示为审查 chip，后端发送时展开为完整提示词。
      const reviewText = encodeReviewTag({
        prompt: built.prompt,
        summary: built.summary,
        charCount: built.prompt.length,
        branch: store.get().git.status?.currentBranch || "",
        repoPath: token.path,
      });
      const created = await runWrite("conversations.create", {
        directoryId: token.directoryId,
        title,
        text: reviewText,
        autoReply: true,
      });
      if (!created.ok) {
        throw new Error(t("fx.toast.reviewFailed", { error: created.error || "conversations.create failed" }));
      }
      const conversationId = created.data?.conversationId;
      if (!conversationId) throw new Error("conversations.create returned no id");
      if (!isProjectCurrent(token)) {
        await closeConversation(conversationId);
        throw new Error(t("fx.error.projectSwitched"));
      }
      // 会话创建成功后就切过去，避免用户还要在侧栏手动点一次。
      await activateConversation(conversationId);
      // activate 是宿主 IPC 往返：期间可能切换项目，必须重新校验后再读取当前状态。
      if (!isProjectCurrent(token)) {
        await closeConversation(conversationId);
        throw new Error(t("fx.error.projectSwitched"));
      }
      const current = store.get();
      const at = nowMs();
      const state = {
        ...current.state,
        sessions: {
          ...current.state.sessions,
          review: {
            conversationId,
            title,
            startedAt: at,
            status: "running",
            scopeLabel: built.scopeLabel,
            issueIds: [],
            lastError: "",
          },
        },
        conversationLog: appendConversationLog(current.state.conversationLog, {
          conversationId,
          kind: "review",
          title,
          createdAt: at,
        }),
      };
      store.set({
        state,
        selected: [],
        dialog: null,
        activity: {
          kind: "review",
          conversationId,
          startedAt: at,
          phase: "waiting",
          message: "",
          error: "",
          issueIds: [],
        },
      });
      setToast(
        "info",
        built.currentCode
          ? t(built.repoMissing ? "fx.toast.gitUnavailable" : "fx.review.noChanges")
          : t("fx.toast.reviewStarted"),
      );
      await saveState({ projectId: token.directoryId, state });
      void track({
        kind: "review",
        conversationId,
        projectId: token.directoryId,
        epoch: token.epoch,
      });
    } finally {
      releaseStart("review", reservation);
    }
  }

  async function readConversationText(conversationId) {
    const response = await api.metadata.get(["messages"], { params: { conversationId } });
    const domain = response?.domains?.messages;
    const items = domain?.items;
    // live 是该会话的实时状态，用于判断停止跟踪后宿主是否仍在运行。
    const live = domain?.live && typeof domain.live === "object" ? domain.live : null;
    if (!Array.isArray(items)) return { text: "", live };
    // 错误状态的助手消息不是有效结果：重新解析时必须跳过，否则会把错误文本当审查结果。
    const isErrorStatus = (message) =>
      ["error", "failed"].includes(String(message?.status || "").toLowerCase());
    return {
      text: items
        .filter(
          (message) =>
            message.role === "assistant" &&
            String(message.content || "").trim() &&
            !isErrorStatus(message),
        )
        .map((message) => message.content)
        .join("\n\n"),
      live,
    };
  }

  // 用 conversations 域确认会话是否还在宿主里：true 存在，false 不存在，undefined 无法确认。
  async function readSessionExists(conversationId, directoryId) {
    if (!directoryId) return undefined;
    try {
      const response = await api.metadata.get(["conversations"], { params: { directoryId } });
      return findConversationInDomain(response?.domains?.conversations, conversationId);
    } catch {
      // 读取失败不等于会话不存在，交给旧逻辑兜底。
      return undefined;
    }
  }

  // 停止跟踪只停止读取，宿主会话可能仍在运行：返回 streaming / idle / unknown 三态。
  async function readSessionRunState(conversationId, live) {
    const isRunning = (value) =>
      Boolean(value) &&
      (value.isStreaming === true || Number(value.pendingMessageCount) > 0);
    if (live && String(live.conversationId || "") === conversationId) {
      return isRunning(live) ? "streaming" : "idle";
    }
    try {
      const response = await api.metadata.get(["runtime"]);
      const runtime = response?.domains?.runtime;
      if (!runtime) return "unknown";
      const streaming = (Array.isArray(runtime.streamingSessions) ? runtime.streamingSessions : []).some(
        (session) => String(session?.conversationId || "") === conversationId,
      );
      if (streaming) return "streaming";
      const focused = runtime.conversation;
      if (focused && String(focused.conversationId || "") === conversationId) {
        return isRunning(focused) ? "streaming" : "idle";
      }
      // runtime 可读且该会话不在运行中列表里，视为已结束；runtime 不可读则无法确认。
      return "idle";
    } catch {
      return "unknown";
    }
  }

  // 清理前一次性读取 runtime，核对全部待处理会话（含历史台账）是否仍在运行。
  // 历史条目没有运行状态；runtime 不可读时 known=false，由调用方要求用户显式确认。
  async function readCleanupRunState(conversationIds) {
    const wanted = new Set((Array.isArray(conversationIds) ? conversationIds : []).map(String));
    try {
      const response = await api.metadata.get(["runtime"]);
      const runtime = response?.domains?.runtime;
      if (!runtime || !Array.isArray(runtime.streamingSessions)) {
        return { known: false, runningIds: new Set() };
      }
      const runningIds = new Set(
        runtime.streamingSessions
          .map((session) => String(session?.conversationId || ""))
          .filter((conversationId) => wanted.has(conversationId)),
      );
      const focused = runtime.conversation;
      const focusedId = String(focused?.conversationId || "");
      if (
        wanted.has(focusedId) &&
        (focused.isStreaming === true || Number(focused.pendingMessageCount) > 0)
      ) {
        runningIds.add(focusedId);
      }
      return { known: true, runningIds };
    } catch {
      return { known: false, runningIds: new Set() };
    }
  }

  async function watchConversation(conversationId, timeouts, token, options = {}) {
    // 入口统一校验阈值：漏传、字段改名或写入非法值时回退到对应任务的默认阈值，
    // 不能因为参数问题让空闲 / 绝对超时检查静默失效。
    const watchTimeouts = normalizeWatchTimeouts(
      timeouts,
      token.kind === "review"
        ? { idleMs: REVIEW_IDLE_TIMEOUT_MS, maxMs: REVIEW_MAX_TIMEOUT_MS }
        : { idleMs: FIX_IDLE_TIMEOUT_MS, maxMs: FIX_MAX_TIMEOUT_MS },
    );
    if (watchTimeouts.usedFallback) {
      console.warn("[snow-fix-bench] invalid watch timeouts, fallback applied", {
        kind: token.kind,
        idleMs: timeouts?.idleMs,
        maxMs: timeouts?.maxMs,
        usedIdleMs: watchTimeouts.idleMs,
        usedMaxMs: watchTimeouts.maxMs,
      });
    }
    const startedAt = nowMs();
    // 最近一次“有新进展”的时刻：正文变化、消息行变化与 runtime 可观测进展都算进展。
    // 超时只看这个时间与绝对上限，不再使用固定总时长。
    let lastActivityAt = startedAt;
    // 上一轮 runtime 是否可读；runtime 不可读时无法确认会话是否仍在执行工具，
    // 因此不能沿用常规的 idle 阈值（首轮未知，此时尚无空闲，不影响判定）。
    let runtimeKnown = false;
    let lastMessageSignature = "";
    // 上一轮 runtime 进展签名；签名不变说明没有新 token / 新消息 / 新 run 起点。
    let lastRuntimeProgress = "";
    let lastCombined = "";
    let stable = 0;
    // runtime 不可读期间的独立稳定计数：不能复用 stable，否则可读 / 未知切换会沿用旧计数。
    let stableUnknown = 0;
    let wasRuntimeKnown = null;
    let errorCandidate = "";
    let errorSeen = 0;
    let emptyPolls = 0;
    let nextMissingCheck = 0;
    let lastMessagesAt = 0;
    let hasMessages = false;
    // runtime 快照按间隔节流读取；缓存用于其余轮次判断运行状态。
    let lastRuntimeAt = 0;
    let runtimeDomain = null;
    let wasStreaming = false;
    // 中止或空响应的终态判定：只在 runtime 明确可读、会话明确空闲且没有有效正文时累计。
    let abortedPolls = 0;
    let emptyResponsePolls = 0;
    let sawStreaming = false;
    let sawAssistantRow = false;
    const isErrorStatus = (message) =>
      ["error", "failed"].includes(String(message?.status || "").toLowerCase());
    while (true) {
      if (token.cancelled) throw new Error("cancelled");
      if (
        isWatchTimedOut({
          now: nowMs(),
          startedAt,
          lastActivityAt,
          // runtime 不可读时没有可观察的运行状态信号，长工具阶段会长时间没有正文变化：
          // 使用放大后的未知态阈值（且不小于常规阈值），避免被误判为空闲超时。
          idleTimeoutMs: resolveWatchIdleTimeoutMs({
            runtimeKnown,
            idleTimeoutMs: watchTimeouts.idleMs,
            unknownIdleTimeoutMs: UNKNOWN_RUNTIME_IDLE_TIMEOUT_MS,
          }),
          maxTimeoutMs: watchTimeouts.maxMs,
        })
      ) {
        throw new Error("timeout");
      }
      await sleep(POLL_INTERVAL_MS);
      if (token.cancelled) throw new Error("cancelled");
      // runtime 是轻量快照：按 RUNTIME_READ_MS 节流读取，其余轮次复用上次快照。
      // 不订阅 live 域：宿主在流式期间约每 250ms 更新快照，订阅推送反而比轮询更频繁。
      const runtimeAt = nowMs();
      // 终态确认期间每轮刷新 runtime：避免缓存中的空闲状态把新启动的 run 误判为结束。
      const confirmRuntime = abortedPolls > 0 || emptyResponsePolls > 0 || errorSeen > 0;
      if (
        confirmRuntime ||
        shouldReadRuntime({
          // 缓存缺少 streamingSessions 时视为未知：下一轮立即重试，避免停用节流判断。
          known: Boolean(runtimeDomain && Array.isArray(runtimeDomain.streamingSessions)),
          sinceLastReadMs: lastRuntimeAt ? runtimeAt - lastRuntimeAt : Number.POSITIVE_INFINITY,
          intervalMs: RUNTIME_READ_MS,
        })
      ) {
        try {
          const runtimeResponse = await api.metadata.get(["runtime"]);
          runtimeDomain = runtimeResponse?.domains?.runtime || null;
        } catch {
          runtimeDomain = null;
        }
        lastRuntimeAt = nowMs();
      }
      // streamingSessions 是判断任意会话（包括非焦点会话）是否仍在运行的主信号。
      runtimeKnown = Boolean(runtimeDomain && Array.isArray(runtimeDomain.streamingSessions));
      if (wasRuntimeKnown !== null && wasRuntimeKnown !== runtimeKnown) {
        stable = 0;
        stableUnknown = 0;
      }
      wasRuntimeKnown = runtimeKnown;
      const liveConversation = runtimeDomain?.conversation;
      const focusedConversation =
        liveConversation && String(liveConversation.conversationId || "") === conversationId
          ? liveConversation
          : null;
      // pendingMessageCount 是输入区排队消息数：大于 0 时随时可能开启新一轮 run，不能判定终态。
      const pendingMessageCount = focusedConversation
        ? Math.max(0, Number(focusedConversation.pendingMessageCount) || 0)
        : 0;
      const streamingSession =
        (Array.isArray(runtimeDomain?.streamingSessions) ? runtimeDomain.streamingSessions : []).find(
          (session) => String(session?.conversationId || "") === conversationId,
        ) || null;
      const isStreaming = Boolean(
        streamingSession || (focusedConversation && focusedConversation.isStreaming),
      );
      const busy = isStreaming || pendingMessageCount > 0;
      if (isStreaming) sawStreaming = true;
      // 会话仍在运行不代表仍有进展：暂停等待授权、streamStartedAt 未清理或 run 卡死时，
      // 宿主会持续报告流式 / 排队，但没有新的 token、消息或 run 起点。
      // 只有可观测进展才刷新活动时间，空闲看门狗才能按 20 / 30 分钟阈值生效。
      const runtimeProgress = runtimeKnown
        ? buildRuntimeProgressSignature({ streamingSession, focusedConversation })
        : "";
      if (runtimeProgress) {
        if (runtimeProgress !== lastRuntimeProgress) {
          lastRuntimeProgress = runtimeProgress;
          if (busy) lastActivityAt = nowMs();
        }
      } else if (busy) {
        // 旧宿主未提供 tokenCount / messageCount / startedAt：没有可观测进展信号，
        // 保持原有等待行为，避免把没有可观测指标的长工具阶段误判为空闲。
        lastActivityAt = nowMs();
      }
      // 流式刚结束的一轮必须立即补读一次消息：空闲间隔不能让已完成结果多等一轮。
      const streamingChangedToIdle = wasStreaming && runtimeKnown && !isStreaming;
      wasStreaming = isStreaming;
      if (busy || !runtimeKnown) {
        // runtime 不可读时无法确认会话已空闲，保持原有等待行为。
        abortedPolls = 0;
        emptyResponsePolls = 0;
      }
      // 终态确认轮次强制读取：流式转空闲、已发现中止/空响应/错误候选或消息为空时
      // 不能等空闲间隔，避免把会话缺失与新 run 的终态判定推迟。
      const forceMessagesRead =
        streamingChangedToIdle ||
        abortedPolls > 0 ||
        emptyResponsePolls > 0 ||
        errorSeen > 0 ||
        emptyPolls > 0;
      if (
        !shouldReadMessages({
          // runtime 不可读时传 null：保持原有“未知状态立即读取”的判定节奏。
          streaming: isStreaming ? true : runtimeKnown ? false : null,
          hasMessages,
          sinceLastReadMs: lastMessagesAt ? nowMs() - lastMessagesAt : Number.POSITIVE_INFINITY,
          fallbackMs: STREAM_MESSAGE_READ_MS,
          idleFallbackMs: IDLE_MESSAGE_READ_MS,
          force: forceMessagesRead,
        })
      ) {
        // 已有助手正文时才是 streaming；只有用户消息或工具调用时保持等待文案。
        if (lastCombined) updateActivityProgress(conversationId, "streaming", "");
        else updateActivityProgress(conversationId, "waiting", t("fx.activity.waiting"));
        continue;
      }
      let response = null;
      try {
        response = await api.metadata.get(["messages"], { params: { conversationId } });
      } catch {
        response = null;
      }
      if (!response) {
        abortedPolls = 0;
        emptyResponsePolls = 0;
        updateActivityProgress(conversationId, "waiting", t("fx.activity.waiting"));
        continue;
      }
      lastMessagesAt = nowMs();
      const rawItems = response.domains?.messages?.items;
      const items = Array.isArray(rawItems) ? rawItems : [];
      const messagesKnown = Array.isArray(rawItems);
      hasMessages = items.length > 0;
      // 消息行数量、末条 id / 状态 / 正文长度、思维链与工具调用参数长度的变化都说明会话仍在推进。
      const lastRow = items[items.length - 1] || null;
      const messageSignature = `${items.length}|${String(lastRow?.id || "")}|${String(
        lastRow?.status || "",
      )}|${String(lastRow?.content || "").length}|${String(lastRow?.thinking || "").length}|${String(
        lastRow?.toolCallsJson || "",
      ).length}`;
      if (messageSignature !== lastMessageSignature) {
        lastMessageSignature = messageSignature;
        lastActivityAt = nowMs();
      }
      // 会话可能在中途被删除：连续为空达到阈值后用 conversations 域确认存在性，
      // 首次跟踪与重连恢复都适用；确认不存在时立即结束，避免修复中状态挂到超时。
      if (items.length) {
        emptyPolls = 0;
        nextMissingCheck = 0;
      } else {
        emptyPolls += 1;
        if (emptyPolls >= SESSION_MISSING_POLLS && emptyPolls >= nextMissingCheck) {
          const exists = await readSessionExists(conversationId, token.directoryId);
          if (token.cancelled) throw new Error("cancelled");
          if (shouldDeclareSessionMissing(emptyPolls, options.resumed, exists)) {
            throw new Error("session-missing");
          }
          nextMissingCheck = emptyPolls + SESSION_MISSING_RECHECK_POLLS;
        }
      }
      const assistantItems = items.filter((message) => message.role === "assistant");
      const lastAssistant = assistantItems[assistantItems.length - 1] || null;
      if (lastAssistant) sawAssistantRow = true;
      // 只把尾部、非流式、空内容的错误消息视为当前失败；历史错误或已重试成功不算。
      if (
        !isStreaming &&
        lastAssistant &&
        isErrorStatus(lastAssistant) &&
        !String(lastAssistant.content || "").trim()
      ) {
        const candidateId = String(lastAssistant.id || `${lastAssistant.status}:${lastAssistant.createdAt || ""}`);
        if (candidateId === errorCandidate) errorSeen += 1;
        else {
          errorCandidate = candidateId;
          errorSeen = 1;
        }
        if (errorSeen >= 2) throw new Error("session-error");
        updateActivityProgress(conversationId, "waiting", t("fx.activity.waiting"));
        continue;
      }
      errorCandidate = "";
      errorSeen = 0;
      const assistants = assistantItems.filter(
        (message) => String(message.content || "").trim() && !isErrorStatus(message),
      );
      const combined = assistants.map((message) => message.content).join("\n\n");
      if (combined) {
        if (combined === lastCombined) {
          stable += 1;
          if (!runtimeKnown) stableUnknown += 1;
        } else {
          lastCombined = combined;
          stable = 0;
          stableUnknown = 0;
          lastActivityAt = nowMs();
        }
        abortedPolls = 0;
        emptyResponsePolls = 0;
        updateActivityProgress(conversationId, "streaming", "");
        if (!busy) {
          // runtime 可读且确认空闲时才允许快速收尾；不可读时必须经过更长稳定窗口，
          // 避免工具调用期间正文不变就把半成品交给解析器。
          if (runtimeKnown && stable >= 1) return combined;
          if (!runtimeKnown && stableUnknown >= WATCH_UNKNOWN_STABLE_POLLS) return combined;
        }
      } else {
        const lastContent = String(lastAssistant?.content || "");
        const lastStatus = String(lastAssistant?.status || "").toLowerCase();
        const interruptionReason = String(lastAssistant?.interruptionReason || "").trim();
        // 宿主中止会话时通常落库为 cancelled + 空正文 + interruptionReason=null。
        const explicitlyAborted =
          Boolean(lastAssistant) &&
          !lastContent.trim() &&
          (lastStatus === "cancelled" || lastStatus === "canceled");
        if (explicitlyAborted) {
          abortedPolls = runtimeKnown && !busy ? abortedPolls + 1 : 0;
          emptyResponsePolls = 0;
          if (abortedPolls >= WATCH_ABORTED_POLLS) throw new Error("session-interrupted");
        } else {
          abortedPolls = 0;
          // 终端状态或明确的中断原因 + 空正文；没有 assistant 行时需要更长的启动宽限期。
          const terminalEmpty =
            Boolean(lastAssistant) &&
            !lastContent.trim() &&
            (Boolean(interruptionReason) ||
              ["completed", "incomplete", "length", "max_tokens"].includes(lastStatus));
          const gracePassed =
            Boolean(lastAssistant) ||
            sawAssistantRow ||
            sawStreaming ||
            nowMs() - startedAt >= WATCH_EMPTY_GRACE_MS;
          if (
            runtimeKnown &&
            messagesKnown &&
            !busy &&
            gracePassed &&
            (terminalEmpty || !lastAssistant)
          ) {
            emptyResponsePolls += 1;
            if (emptyResponsePolls >= WATCH_EMPTY_POLLS) {
              throw new Error("session-empty-response");
            }
          } else {
            emptyResponsePolls = 0;
          }
        }
        updateActivityProgress(conversationId, "waiting", t("fx.activity.waiting"));
      }
    }
  }

  async function finishReview(conversationId, text, token) {
    const snapshot = store.get();
    if (token && (!isCurrentToken(token) || !isProjectCurrent(token))) return false;
    const session = snapshot.state.sessions.review;
    if (!session || session.conversationId !== conversationId) return false;
    const parsedResult = parseReviewResult(text);
    // 只有显式空结果才是「未发现问题」；缺少结构化块或内容无法解析必须显式报错，
    // 否则真实缺陷会被静默丢弃，工作台给出错误的干净结论。
    if (parsedResult.status === "failed") {
      const failedState = {
        ...snapshot.state,
        sessions: {
          ...snapshot.state.sessions,
          review: { ...session, status: "error", lastError: "review-parse-failed" },
        },
      };
      store.set({
        state: failedState,
        activity:
          snapshot.activity?.conversationId === conversationId
            ? { ...snapshot.activity, phase: "error", message: "", error: t("fx.toast.reviewParseFailed") }
            : snapshot.activity,
      });
      setToast("error", t("fx.toast.reviewParseFailed"));
      await saveState({ projectId: snapshot.project?.directoryId, state: failedState });
      return true;
    }
    const parsed = parsedResult.issues;
    const nextState = {
      ...snapshot.state,
      sessions: {
        ...snapshot.state.sessions,
        review: { ...session, status: "done", lastError: "" },
      },
    };
    const activityDone =
      snapshot.activity?.conversationId === conversationId
        ? { ...snapshot.activity, phase: "done", message: "" }
        : snapshot.activity;
    let added = 0;
    let updated = 0;
    let reopened = 0;
    // 本次审查新增 / 重开的 issue：自动修复只处理这批，避免把历史 open 项一并交给 AI。
    let autoFixIds = [];
    if (parsed.length) {
      const merged = mergeReviewIssues(snapshot.state.issues, parsed, {
        conversationId,
        scopeLabel: session.scopeLabel || "",
      });
      nextState.issues = merged.issues;
      nextState.lastReviewAt = nowMs();
      added = merged.added;
      updated = merged.updated;
      reopened = merged.reopened;
      autoFixIds = Array.from(new Set([...merged.addedIds, ...merged.reopenedIds]));
      store.set({ state: nextState, activity: activityDone, selected: [] });
      setToast("success", t("fx.toast.reviewDone", { added, updated, reopened }));
    } else {
      store.set({ state: nextState, activity: activityDone });
      setToast("info", t("fx.toast.reviewEmpty"));
    }
    await saveState({ projectId: snapshot.project?.directoryId, state: nextState });
    // 自动修复：用户显式开启后，仅修复本次审查新增或重开的 issue；
    // 保存期间可能被归档 / 删除，因此以最新状态复核后仍为 open 才启动。
    if (autoFixIds.length && store.get().settings.autoFixAfterReview && (!token || isProjectCurrent(token))) {
      const current = store.get();
      const openIds = new Set(
        current.state.issues
          .filter((issue) => issue.status === ISSUE_STATUS.open)
          .map((issue) => issue.id),
      );
      const targets = autoFixIds.filter((id) => openIds.has(id));
      if (targets.length) {
        void startFix(targets, { auto: true }).catch((error) => {
          setToast("error", String(error?.message || error));
        });
      }
    }
    return true;
  }

  async function finishFix(conversationId, text, token, options = {}) {
    const snapshot = store.get();
    if (token && (!isCurrentToken(token) || !isProjectCurrent(token))) return false;
    const session = snapshot.state.sessions.fix;
    if (!session || session.conversationId !== conversationId) return false;
    const parsedResults = parseFixResults(text);
    // 只接受 session.issueIds 白名单内的结果，避免模型越界改写其它 issue。
    // 旧数据没有 issueIds 时，退回本会话正在修复的 issue，与 restoreFixingIssues 同口径。
    const allowedIds = (
      Array.isArray(session.issueIds) && session.issueIds.length
        ? session.issueIds
        : snapshot.state.issues
            .filter(
              (issue) =>
                issue.status === ISSUE_STATUS.fixing && issue.fix?.conversationId === conversationId,
            )
            .map((issue) => issue.id)
    ).map(String);
    const allowedSet = new Set(allowedIds);
    const results = parsedResults.filter((result) => allowedSet.has(result.issueId));
    const ignoredResults = parsedResults.filter((result) => !allowedSet.has(result.issueId));
    if (ignoredResults.length) {
      console.warn("[snow-fix-bench] ignored out-of-batch fix results", {
        conversationId,
        count: ignoredResults.length,
        issueIds: ignoredResults.slice(0, 10).map((result) => result.issueId),
      });
    }
    const activityDone =
      snapshot.activity?.conversationId === conversationId
        ? { ...snapshot.activity, phase: "done", message: "" }
        : snapshot.activity;
    if (!results.length) {
      // 手动重新解析已停止跟踪的修复会话时，宿主可能仍在运行：保留 fixing，等待会话结束。
      const keepFixing = options.preserveFixing === true;
      const restored = keepFixing
        ? snapshot.state.issues
        : restoreFixingIssues(snapshot.state.issues, conversationId);
      const nextState = {
        ...snapshot.state,
        issues: restored,
        sessions: {
          ...snapshot.state.sessions,
          fix: {
            ...session,
            status: keepFixing ? "detached" : "error",
            lastError: "parse-failed",
          },
        },
      };
      store.set({
        state: nextState,
        activity:
          snapshot.activity?.conversationId === conversationId
            ? {
                ...snapshot.activity,
                phase: keepFixing ? "detached" : "error",
                error: t("fx.toast.fixParseFailed"),
              }
            : snapshot.activity,
      });
      setToast("error", t("fx.toast.fixParseFailed"));
      await saveState({ projectId: snapshot.project?.directoryId, state: nextState });
      return true;
    }
    const applied = applyFixResults(snapshot.state.issues, results, {
      conversationId,
      issueIds: allowedIds,
    });
    // 未返回结果的条目仍停在 fixing：按进入修复前的快照恢复，
    // 不能一律回落 open，否则已定论条目的结论与取证记录会被覆盖。
    const issues = restoreFixingIssues(applied.issues, conversationId);
    const nextState = {
      ...snapshot.state,
      issues,
      sessions: {
        ...snapshot.state.sessions,
        fix: { ...session, status: "done", lastError: "" },
      },
    };
    store.set({ state: nextState, activity: activityDone });
    setToast(
      "success",
      t("fx.toast.fixDone", {
        fixed: applied.fixed,
        notFound: applied.notFound,
        blocked: applied.blocked,
      }),
    );
    await saveState({ projectId: snapshot.project?.directoryId, state: nextState });

    // 分批修复：本批完成后继续下一批；队列为空时收尾并按需自动清理。
    // 手动重新解析的路径不自动续批，避免与可能仍在运行的旧会话并发修改同一批文件。
    if (options.skipContinue === true) return true;
    const latest = store.get();
    const currentSession = latest.state.sessions.fix;
    if (currentSession && currentSession.conversationId === conversationId) {
      const outcome = await continueFixQueue(latest, currentSession, token);
      if (outcome === "empty") await finishFixRun(currentSession);
    }
    return true;
  }

  // 续批创建失败：保留剩余队列，将会话与活动卡片一起切到 error，
  // 避免界面停在上一批的 done、刷新后也没有可恢复的卡片。
  function failFixQueue(latest, currentSession, errorMessage) {
    const failedState = {
      ...latest.state,
      sessions: {
        ...latest.state.sessions,
        fix: {
          ...currentSession,
          status: "error",
          lastError: "batch-create-failed",
          activityDismissed: false,
        },
      },
    };
    const base =
      latest.activity?.conversationId === currentSession.conversationId
        ? latest.activity
        : sessionActivityBase("fix", currentSession);
    store.set({
      state: failedState,
      activity: {
        ...base,
        phase: "error",
        message: "",
        error: errorMessage,
        timedOut: false,
      },
    });
    return failedState;
  }

  // 取下一批 issue 新建会话；返回 empty 表示队列已耗尽，error 表示创建失败。
  async function continueFixQueue(snapshot, session, token) {
    // guard 用于 directoryId + epoch 校验；project 提供标题所需的名称与路径。
    const guard = token || captureProject();
    const project = snapshot.project;
    if (
      !guard?.directoryId ||
      !project?.directoryId ||
      project.directoryId !== guard.directoryId ||
      !isProjectCurrent(guard)
    ) {
      return "error";
    }
    const batchSize = Math.max(1, Number(session.batchSize) || 1);
    const next = takeNextFixBatch(session.queue, snapshot.state.issues, batchSize);
    // 旧版本留下的队列可能含已定论条目：取批时再次过滤，避免重新标记为修复中。
    const issues = snapshot.state.issues.filter(
      (issue) => next.batchIds.includes(issue.id) && isFixSelectable(issue),
    );
    if (!issues.length) return "empty";
    const batchNumber = Math.min(session.batchTotal, Number(session.batchNumber || 0) + 1);
    const prompt = buildFixPrompt({
      locale: api.locale,
      issues,
      parallelLimit: batchSize,
    });
    const title = t("fx.title.fixBatch", {
      project: project.name || project.path,
      count: issues.length,
      batch: batchNumber,
      total: session.batchTotal,
      time: formatStamp(new Date()),
    });
    const created = await runWrite("conversations.create", {
      directoryId: project.directoryId,
      title,
      text: prompt,
      autoReply: true,
    });
    if (!created.ok) {
      if (!isProjectCurrent(guard)) return "error";
      const latest = store.get();
      const currentSession = latest.state.sessions.fix;
      if (!currentSession || currentSession.conversationId !== session.conversationId) return "error";
      // 等待创建期间用户已停止跟踪 / 关闭：不要用失败卡片覆盖用户操作。
      if (["detached", "dismissed"].includes(currentSession.status)) return "error";
      const message = created.error || "conversations.create failed";
      const failedState = failFixQueue(
        latest,
        currentSession,
        t("fx.activity.failed", { error: message }),
      );
      setToast("error", t("fx.toast.fixFailed", { error: message }));
      await saveState({ projectId: project.directoryId, state: failedState });
      return "error";
    }
    const conversationId = created.data?.conversationId;
    if (!conversationId) {
      if (!isProjectCurrent(guard)) return "error";
      const latest = store.get();
      const currentSession = latest.state.sessions.fix;
      if (!currentSession || currentSession.conversationId !== session.conversationId) return "error";
      if (["detached", "dismissed"].includes(currentSession.status)) return "error";
      const message = "conversations.create returned no id";
      const failedState = failFixQueue(
        latest,
        currentSession,
        t("fx.activity.failed", { error: message }),
      );
      setToast("error", t("fx.toast.fixFailed", { error: message }));
      await saveState({ projectId: project.directoryId, state: failedState });
      return "error";
    }
    if (!isProjectCurrent(guard)) {
      await closeConversation(conversationId);
      return "error";
    }
    // 续批同样切换到新会话，用户可以立即看到下一批的执行过程。
    await activateConversation(conversationId);
    // activate 也是异步等待：期间可能切换项目、刷新或审查完成，必须重新校验。
    if (!isProjectCurrent(guard)) {
      await closeConversation(conversationId);
      return "error";
    }
    const latest = store.get();
    const currentSession = latest.state.sessions.fix;
    if (
      !currentSession ||
      currentSession.conversationId !== session.conversationId ||
      ["detached", "dismissed", "error"].includes(currentSession.status)
    ) {
      await closeConversation(conversationId);
      return "error";
    }
    // 基于最新状态只更新本批 issue、sessions.fix 与 conversationLog，避免整份旧快照覆盖。
    const batchIds = new Set(issues.map((issue) => issue.id));
    const liveIssues = latest.state.issues.filter(
      (issue) => batchIds.has(issue.id) && issue.status !== ISSUE_STATUS.archived,
    );
    if (!liveIssues.length) {
      await closeConversation(conversationId);
      return "error";
    }
    const at = nowMs();
    const nextSession = {
      ...currentSession,
      conversationId,
      title,
      startedAt: at,
      status: "running",
      scopeLabel: t("fx.fix.scopeBatch", {
        count: liveIssues.length,
        batch: batchNumber,
        total: currentSession.batchTotal,
      }),
      issueIds: liveIssues.map((issue) => issue.id),
      batchNumber,
      queue: next.remainingIds,
      sessionIds: [...(currentSession.sessionIds || []), conversationId],
      activityDismissed: false,
      lastError: "",
    };
    const nextState = {
      ...latest.state,
      issues: markIssuesFixing(latest.state.issues, nextSession.issueIds, conversationId),
      sessions: { ...latest.state.sessions, fix: nextSession },
      conversationLog: appendConversationLog(latest.state.conversationLog, {
        conversationId,
        kind: "fix",
        title,
        createdAt: at,
      }),
    };
    store.set({
      state: nextState,
      activity: {
        kind: "fix",
        conversationId,
        startedAt: at,
        phase: "waiting",
        message: "",
        error: "",
        issueIds: nextSession.issueIds,
        batchNumber,
        batchTotal: currentSession.batchTotal,
      },
    });
    setToast(
      "info",
      t("fx.toast.fixBatchStarted", {
        batch: batchNumber,
        total: currentSession.batchTotal,
        count: nextSession.issueIds.length,
      }),
    );
    await saveState({ projectId: project.directoryId, state: nextState });
    void track({
      kind: "fix",
      conversationId,
      projectId: project.directoryId,
      epoch: guard.epoch ?? projectEpoch,
    });
    return "started";
  }

  // 全部批次完成：收尾会话状态，并按需执行自动清理。
  async function finishFixRun(session) {
    const snapshot = store.get();
    const projectId = snapshot.project?.directoryId;
    if (!projectId) return;
    if (snapshot.state.sessions.fix?.conversationId !== session.conversationId) return;
    const doneState = {
      ...snapshot.state,
      sessions: {
        ...snapshot.state.sessions,
        fix: { ...session, status: "done", lastError: "", queue: [] },
      },
    };
    store.set({ state: doneState });
    setToast("success", t("fx.toast.fixAllDone", { batches: session.batchTotal }));
    await saveState({ projectId, state: doneState });
    if (session.autoCleanup) await autoCleanupFixRun(session);
  }

  // 自动清理本轮已修复 issue 与本轮全部修复会话，动作为归档或删除。
  async function autoCleanupFixRun(session) {
    const snapshot = store.get();
    const projectId = snapshot.project?.directoryId;
    if (!projectId) return;
    if (snapshot.state.sessions.fix?.conversationId !== session.conversationId) return;
    const targetIds = new Set(
      (Array.isArray(session.allIssueIds) && session.allIssueIds.length
        ? session.allIssueIds
        : session.issueIds) || [],
    );
    const sessionIds = Array.from(
      new Set(
        (Array.isArray(session.sessionIds) ? session.sessionIds : [session.conversationId]).filter(
          Boolean,
        ),
      ),
    );
    const sessionIdSet = new Set(sessionIds.map((conversationId) => String(conversationId)));
    const action = session.cleanupAction === "delete" ? "delete" : "archive";
    let cleanupError = "";
    const cleanedIds = new Set();
    if (action === "delete") {
      for (const conversationId of sessionIds) {
        const result = await runWrite("conversations.remove", { conversationId });
        if (result.ok) cleanedIds.add(conversationId);
        else if (!cleanupError) cleanupError = result.error || "conversations.remove failed";
      }
    } else if (sessionIds.length) {
      const result = await runWrite("conversations.archive", { conversationIds: sessionIds });
      if (result.ok) for (const conversationId of sessionIds) cleanedIds.add(conversationId);
      else cleanupError = result.error || "conversations.archive failed";
    }
    if (currentProjectId() !== projectId) return;
    // 全部会话都未处理成功时不改动 issue、台账与 sessions：保留完整状态供下一次清理重试。
    if (cleanupError && !cleanedIds.size) {
      setToast("error", t("fx.toast.autoCleanupFailed", { error: cleanupError }));
      return;
    }
    const latest = store.get();
    // 清理写会话期间可能已有审查完成并重新打开某个 issue：必须以最新状态重新筛选，
    // 只处理仍是 fixed 且修复会话属于本轮的条目，避免误删回归项或归档为错误来源状态。
    const fixedIssues = latest.state.issues.filter(
      (issue) =>
        targetIds.has(issue.id) &&
        (issue.status === ISSUE_STATUS.fixed || issue.status === ISSUE_STATUS.notFound) &&
        sessionIdSet.has(String(issue.fix?.conversationId || "")),
    );
    const fixedIds = new Set(fixedIssues.map((issue) => issue.id));
    let issues = latest.state.issues;
    if (action === "delete") {
      issues = issues.filter((issue) => !fixedIds.has(issue.id));
    } else {
      issues = issues.map((issue) => (fixedIds.has(issue.id) ? archiveIssueRecord(issue) : issue));
    }
    // 只有确认处理成功的会话才从台账移除；未成功的保留在 sessions.fix 供下一次清理重试。
    const pendingIds = sessionIds.filter((conversationId) => !cleanedIds.has(conversationId));
    const sessions = { ...latest.state.sessions };
    const fixSession = sessions.fix;
    if (!fixSession || !fixSession.conversationId || cleanedIds.has(String(fixSession.conversationId))) {
      sessions.fix = null;
    } else {
      sessions.fix = { ...fixSession, sessionIds: pendingIds };
    }
    const nextState = {
      ...latest.state,
      issues,
      conversationLog: removeConversationsFromLog(latest.state.conversationLog, cleanedIds),
      sessions,
    };
    // 只关闭本轮修复会话的卡片；等待期间新启动的审查卡片不能被一并清掉。
    const activity =
      latest.activity && sessionIdSet.has(String(latest.activity.conversationId || ""))
        ? null
        : latest.activity;
    store.set({ state: nextState, activity, selected: [] });
    setToast(
      cleanupError ? "error" : "success",
      cleanupError
        ? t("fx.toast.autoCleanupFailed", { error: cleanupError })
        : action === "delete"
          ? t("fx.toast.autoCleanupDeleted", { count: fixedIssues.length })
          : t("fx.toast.autoCleanupDone", { count: fixedIssues.length }),
    );
    await saveState({ projectId, state: nextState });
  }

  async function track(job) {
    const token = {
      kind: job.kind,
      conversationId: job.conversationId,
      projectId: job.projectId || currentProjectId(),
      directoryId: job.projectId || currentProjectId(),
      epoch: job.epoch ?? projectEpoch,
      cancelled: false,
    };
    // 启动路径在 await saveState 之后才调用 track：保存窗口内用户可能已停止跟踪
    // 或关闭卡片。进入轮询前复核最新状态，避免把结果写回已放弃的会话。
    const latest = store.get();
    const trackedSession = latest.state.sessions[token.kind === "review" ? "review" : "fix"];
    const trackedActivity = latest.activity;
    const stoppedByActivity =
      trackedActivity &&
      trackedActivity.conversationId === token.conversationId &&
      (trackedActivity.phase === "detached" || trackedActivity.phase === "dismissed");
    if (
      !trackedSession ||
      trackedSession.conversationId !== token.conversationId ||
      trackedSession.status !== "running" ||
      stoppedByActivity
    ) {
      return;
    }
    const previous = tracking.get(token.kind);
    if (previous && previous.conversationId === token.conversationId && !previous.cancelled) return;
    if (previous) cancelToken(previous);
    tracking.set(token.kind, token);
    if (!isProjectCurrent(token)) {
      if (tracking.get(token.kind) === token) tracking.delete(token.kind);
      return;
    }
    const timeouts =
      job.kind === "review"
        ? { idleMs: REVIEW_IDLE_TIMEOUT_MS, maxMs: REVIEW_MAX_TIMEOUT_MS }
        : { idleMs: FIX_IDLE_TIMEOUT_MS, maxMs: FIX_MAX_TIMEOUT_MS };
    try {
      const text = await watchConversation(job.conversationId, timeouts, token, {
        resumed: Boolean(job.resumed),
      });
      if (!isCurrentToken(token) || !isProjectCurrent(token)) return;
      if (job.kind === "review") await finishReview(job.conversationId, text, token);
      else await finishFix(job.conversationId, text, token);
    } catch (error) {
      if (!isCurrentToken(token) || !isProjectCurrent(token)) return;
      const message = String(error?.message || error);
      const timedOut = message === "timeout";
      const snapshot = store.get();
      const sessionKey = job.kind === "review" ? "review" : "fix";
      const session = snapshot.state.sessions[sessionKey];
      const nextState = { ...snapshot.state };
      if (session && session.conversationId === job.conversationId) {
        nextState.sessions = {
          ...nextState.sessions,
          [sessionKey]: { ...session, status: "error", lastError: timedOut ? "timeout" : message },
        };
      }
      if (job.kind === "fix") {
        nextState.issues = restoreFixingIssues(snapshot.state.issues, job.conversationId);
      }
      const sessionMissing = message === "session-missing";
      const displayError = timedOut
        ? ""
        : sessionMissing
          ? t("fx.activity.sessionMissing")
          : message === "session-error"
            ? t("fx.activity.sessionError")
            : message === "session-interrupted"
              ? t("fx.activity.sessionInterrupted")
              : message === "session-empty-response"
                ? t("fx.activity.sessionEmptyResponse")
                : t("fx.activity.failed", { error: message });
      store.set({
        state: nextState,
        activity:
          snapshot.activity && snapshot.activity.conversationId === job.conversationId
            ? {
                ...snapshot.activity,
                phase: "error",
                error: displayError,
                timedOut,
              }
            : snapshot.activity,
      });
      setToast(
        "error",
        timedOut ? t("fx.activity.timeout") : displayError,
      );
      await saveState({ projectId: token.projectId, state: nextState });
    } finally {
      if (tracking.get(token.kind) === token) tracking.delete(token.kind);
    }
  }

  function resumeTracking() {
    const snapshot = store.get();
    const project = snapshot.project;
    if (!project?.directoryId) return;
    for (const kind of ["review", "fix"]) {
      const session = snapshot.state.sessions[kind];
      if (!session || session.status !== "running") continue;
      const activity = snapshot.activity;
      if (
        activity?.conversationId === session.conversationId &&
        ["detached", "dismissed"].includes(activity.phase)
      ) {
        continue;
      }
      const existing = tracking.get(kind);
      if (existing && existing.conversationId === session.conversationId && !existing.cancelled) continue;
      if (existing) cancelToken(existing);
      void track({
        kind,
        conversationId: session.conversationId,
        projectId: project.directoryId,
        epoch: projectEpoch,
        resumed: true,
      });
    }
  }

  async function detachTracking() {
    const snapshot = store.get();
    const activity = snapshot.activity;
    if (!activity) return;
    const token = tracking.get(activity.kind);
    if (token && token.conversationId === activity.conversationId) cancelToken(token);
    const sessionKey = activity.kind === "review" ? "review" : "fix";
    const session = snapshot.state.sessions[sessionKey];
    if (session && session.conversationId === activity.conversationId && session.status === "running") {
      const state = {
        ...snapshot.state,
        sessions: {
          ...snapshot.state.sessions,
          [sessionKey]: { ...session, status: "detached", lastError: "" },
        },
      };
      store.set({ state, activity: { ...activity, phase: "detached", message: "" } });
      await saveState({ projectId: snapshot.project?.directoryId, state });
      return;
    }
    setActivity({ phase: "detached", message: "" });
  }

  async function retryParse() {
    const snapshot = store.get();
    const activity = snapshot.activity;
    if (!activity) return;
    const sessionKey = activity.kind === "review" ? "review" : "fix";
    const session = snapshot.state.sessions[sessionKey];
    if (!session || session.conversationId !== activity.conversationId) {
      setToast("error", t("fx.activity.sessionError"));
      return;
    }
    // done 会话的结果已经合并过：再次解析会把已修复 issue 标成回归并重新打开。
    if (activity.phase !== "error" && activity.phase !== "detached") return;
    const projectId = snapshot.project?.directoryId || "";
    // detached 只表示工作台停止读取，报错 / 超时同样不代表宿主会话已经结束。
    // 重新解析会合并结果，但仍要先确认会话已空闲，避免与仍在运行的宿主会话并发改文件。
    const detachedFix = sessionKey === "fix" && activity.phase === "detached";
    try {
      const { text, live } = await readConversationText(activity.conversationId);
      if (currentProjectId() !== projectId) return;
      if (store.get().activity?.conversationId !== activity.conversationId) return;
      const runState = await readSessionRunState(activity.conversationId, live);
      if (currentProjectId() !== projectId) return;
      const latest = store.get();
      const latestSession = latest.state.sessions[sessionKey];
      if (
        latest.activity?.conversationId !== activity.conversationId ||
        latest.activity?.phase !== activity.phase ||
        !latestSession ||
        latestSession.conversationId !== activity.conversationId ||
        latestSession.status !== session.status
      ) {
        return;
      }
      if (runState !== "idle") {
        setToast("error", t("fx.activity.sessionUnsettled"));
        return;
      }
      if (!text) {
        setToast(
          "error",
          t(activity.kind === "review" ? "fx.toast.reviewParseFailed" : "fx.toast.fixParseFailed"),
        );
        return;
      }
      if (!detachedFix) {
        const nextState = {
          ...store.get().state,
          sessions: {
            ...store.get().state.sessions,
            [sessionKey]: { ...session, status: "running", lastError: "", activityDismissed: false },
          },
        };
        store.set({ state: nextState });
      }
      if (activity.kind === "review") await finishReview(activity.conversationId, text);
      else {
        // 手动重新解析只回写本批结果，不自动新建下一批会话。
        // 队列没有可派发的 issue 时仍交给 finishFix 收尾，保留自动清理路径。
        let finishOptions = {};
        if (detachedFix) {
          finishOptions = { preserveFixing: true, skipContinue: true };
        } else {
          const next = takeNextFixBatch(
            latestSession.queue,
            latest.state.issues,
            Math.max(1, Number(latestSession.batchSize) || 1),
          );
          if (next.batchIds.length) finishOptions = { skipContinue: true };
        }
        await finishFix(activity.conversationId, text, null, finishOptions);
      }
    } catch (error) {
      setToast("error", t("fx.activity.failed", { error: String(error?.message || error) }));
    }
  }

  // 手动停止跟踪或跟踪报错后，重新挂接同一会话：
  // 先把会话状态恢复为 running、活动回到 waiting，再按原有轮询继续读取结果。
  async function resumeActivityTracking() {
    const snapshot = store.get();
    const activity = snapshot.activity;
    if (!activity) return;
    if (activity.phase === "done" || activity.phase === "dismissed") return;
    const project = snapshot.project;
    if (!project?.directoryId) return;
    const sessionKey = activity.kind === "review" ? "review" : "fix";
    const session = snapshot.state.sessions[sessionKey];
    if (!session || session.conversationId !== activity.conversationId) {
      setToast("error", t("fx.activity.sessionError"));
      return;
    }
    const state = {
      ...snapshot.state,
      sessions: {
        ...snapshot.state.sessions,
        [sessionKey]: { ...session, status: "running", lastError: "", activityDismissed: false },
      },
    };
    store.set({
      state,
      activity: {
        ...activity,
        phase: "waiting",
        message: "",
        error: "",
        timedOut: false,
        startedAt: activity.startedAt || nowMs(),
      },
    });
    await saveState({ projectId: project.directoryId, state });
    if (currentProjectId() !== project.directoryId) return;
    void track({
      kind: activity.kind,
      conversationId: activity.conversationId,
      projectId: project.directoryId,
      epoch: projectEpoch,
      resumed: true,
    });
  }

  async function startFix(issueIds, options = {}) {
    const token = captureProject();
    if (!token) throw new Error(t("fx.toast.noProject"));
    const reservation = reserveStart("fix");
    if (!reservation) {
      setToast("error", t("fx.toast.fixBusy"));
      setDialogError("fix", t("fx.toast.fixBusy"));
      return;
    }
    try {
      const selectedIds = Array.isArray(issueIds) ? issueIds.map(String) : [];
      const snapshot = store.get();
      const issues = snapshot.state.issues.filter(
        (issue) => selectedIds.includes(issue.id) && isFixSelectable(issue),
      );
      if (!issues.length) throw new Error(t("fx.toast.noSelection"));
      // 同一批 issue 仍在修复中（含停止跟踪后旧会话可能继续运行）时拒绝新建会话，
      // 否则两个 AI 会话会并发修改同一批文件。
      if (hasFixConflict(issues.map((issue) => issue.id))) {
        setToast("error", t("fx.toast.fixConflict"));
        setDialogError("fix", t("fx.toast.fixConflict"));
        return;
      }
      // 并行上限同时决定单会话的 issue 条数：超出的 issue 进入后续批次。
      const batchSize = Math.max(1, Number(snapshot.settings?.parallelLimit) || 1);
      const batches = planFixBatches(issues.map((issue) => issue.id), batchSize);
      const batchIds = batches[0] || [];
      const queue = batches.slice(1).flat();
      const batchIssues = issues.filter((issue) => batchIds.includes(issue.id));
      const batchTotal = Math.max(1, batches.length);
      const isMultiBatch = batchTotal > 1;
      const prompt = buildFixPrompt({
        locale: api.locale,
        issues: batchIssues,
        parallelLimit: batchSize,
      });
      const time = formatStamp(new Date());
      const title = isMultiBatch
        ? t("fx.title.fixBatch", {
            project: token.name,
            count: batchIssues.length,
            batch: 1,
            total: batchTotal,
            time,
          })
        : t("fx.title.fix", {
            project: token.name,
            count: batchIssues.length,
            time,
          });
      const created = await runWrite("conversations.create", {
        directoryId: token.directoryId,
        title,
        text: prompt,
        autoReply: true,
      });
      if (!created.ok) {
        throw new Error(t("fx.toast.fixFailed", { error: created.error || "conversations.create failed" }));
      }
      const conversationId = created.data?.conversationId;
      if (!conversationId) throw new Error("conversations.create returned no id");
      if (!isProjectCurrent(token)) {
        await closeConversation(conversationId);
        throw new Error(t("fx.error.projectSwitched"));
      }
      // 会话创建成功后就切过去，避免用户还要在侧栏手动点一次。
      await activateConversation(conversationId);
      // activate 期间可能切换项目，也可能有其他审查完成并更新 store：
      // 先复核项目，再基于最新状态构造本批修改，避免旧快照覆盖并发结果。
      if (!isProjectCurrent(token)) {
        await closeConversation(conversationId);
        throw new Error(t("fx.error.projectSwitched"));
      }
      const current = store.get();
      const liveIssues = current.state.issues.filter(
        (issue) => batchIds.includes(issue.id) && isFixSelectable(issue),
      );
      if (!liveIssues.length) {
        await closeConversation(conversationId);
        throw new Error(t("fx.toast.noSelection"));
      }
      const at = nowMs();
      // 覆盖已结束的旧修复会话前，释放其残留的修复中状态；可能仍在运行的旧会话
      // 由 hasFixConflict 阻挡，不能在这里提前解锁，否则会允许并发修改同一批文件。
      const previousFix = current.state.sessions.fix;
      const previousFixSettled =
        previousFix &&
        previousFix.conversationId !== conversationId &&
        !["running", "detached", "dismissed"].includes(previousFix.status) &&
        !isSessionPossiblyRunning(previousFix, current.activity);
      const issuesBase = previousFixSettled
        ? restoreFixingIssuesForConversations(current.state.issues, [
            previousFix.conversationId,
            ...(Array.isArray(previousFix.sessionIds) ? previousFix.sessionIds : []),
          ])
        : current.state.issues;
      const nextState = {
        ...current.state,
        issues: markIssuesFixing(issuesBase, liveIssues.map((issue) => issue.id), conversationId),
        sessions: {
          ...current.state.sessions,
          fix: {
            conversationId,
            title,
            startedAt: at,
            status: "running",
            scopeLabel: isMultiBatch
              ? t("fx.fix.scopeBatch", { count: liveIssues.length, batch: 1, total: batchTotal })
              : t("fx.fix.scopeIssues", { count: liveIssues.length }),
            issueIds: liveIssues.map((issue) => issue.id),
            batchNumber: 1,
            batchTotal,
            batchSize,
            queue,
            allIssueIds: issues.map((issue) => issue.id),
            claimedIssueFiles: claimIssueFiles(issues),
            sessionIds: [conversationId],
            autoCleanup: Boolean(current.settings?.autoCleanupAfterFix),
            cleanupAction: current.settings?.autoCleanupAction === "delete" ? "delete" : "archive",
            lastError: "",
          },
        },
        conversationLog: appendConversationLog(current.state.conversationLog, {
          conversationId,
          kind: "fix",
          title,
          createdAt: at,
        }),
      };
      store.set({
        state: nextState,
        selected: [],
        dialog: null,
        activity: {
          kind: "fix",
          conversationId,
          startedAt: at,
          phase: "waiting",
          message: "",
          error: "",
          issueIds: liveIssues.map((issue) => issue.id),
          batchNumber: 1,
          batchTotal,
        },
      });
      setToast(
        "info",
        options.auto
          ? t("fx.toast.autoFixStarted", { count: issues.length })
          : t("fx.toast.fixStarted"),
      );
      await saveState({ projectId: token.directoryId, state: nextState });
      void track({
        kind: "fix",
        conversationId,
        projectId: token.directoryId,
        epoch: token.epoch,
      });
    } finally {
      releaseStart("fix", reservation);
    }
  }

  async function applyCleanup(options) {
    const token = captureProject();
    if (!token) throw new Error(t("fx.toast.noProject"));
    const initial = store.get();
    const issueIds = Array.isArray(options?.issueIds) ? options.issueIds : [];
    const issueAction = options?.issueAction === "delete" ? "delete" : "archive";
    const sessionActions = options?.sessions || {};
    const sessionKeys = ["review", "fix"];
    const cleanedByKey = new Map();
    const ackIds = new Set();
    // 开始时只确定清理意图：busy 拦截与待清理会话 id。
    // 台账包含分批修复的每一批与会话历史，避免只归档最后一批。
    const groups = conversationCleanupGroups(initial.state, sessionActions);
    for (const group of groups) {
      if (group.action === "keep") continue;
      if (group.session && isSessionPossiblyRunning(group.session, initial.activity)) {
        throw new Error(t("fx.cleanup.runningBlocked"));
      }
      if (!group.conversations.length) continue;
      for (const conversationId of group.ackIds) ackIds.add(conversationId);
      cleanedByKey.set(group.kind, group.conversations.map((entry) => entry.conversationId));
    }
    const archiveSet = new Set();
    const removeSet = new Set();
    for (const [key, ids] of cleanedByKey) {
      const action = sessionActions[key];
      for (const conversationId of ids) {
        if (action === "archive") archiveSet.add(conversationId);
        else if (action === "delete") removeSet.add(conversationId);
      }
    }
    // 同一会话只处理一次：归档优先，避免重复写。
    for (const conversationId of archiveSet) removeSet.delete(conversationId);
    // 历史台账会话不在 tracking 中，sessions[key] 只能代表最后一个会话；
    // 清理前用 runtime 一次性核对全部待处理会话，避免归档 / 删除仍在运行的旧会话。
    const pendingIds = Array.from(new Set([...archiveSet, ...removeSet]));
    if (pendingIds.length) {
      const runState = await readCleanupRunState(pendingIds);
      if (!isProjectCurrent(token)) throw new Error(t("fx.error.projectSwitched"));
      if (runState.runningIds.size) throw new Error(t("fx.cleanup.runningBlocked"));
      // runtime 不可读时无法确认待处理历史会话或已停止跟踪 / 关闭卡片的当前会话
      // 是否已结束：必须由用户显式确认后再处理。
      const pendingUnverified = pendingIds.some((conversationId) => ackIds.has(conversationId));
      if (!runState.known && pendingUnverified && options?.riskAcknowledged !== true) {
        throw new Error(t("fx.cleanup.unverifiedBlocked"));
      }
    }
    if (archiveSet.size) {
      const result = await runWrite("conversations.archive", { conversationIds: Array.from(archiveSet) });
      if (!result.ok) throw new Error(t("fx.toast.cleanupFailed", { error: result.error || "conversations.archive failed" }));
      if (!isProjectCurrent(token)) throw new Error(t("fx.error.projectSwitched"));
    }
    // 删除逐个执行：单个会话不存在或失败不应阻断其他会话的清理。
    const removedIds = new Set();
    let cleanupError = "";
    for (const conversationId of removeSet) {
      const result = await runWrite("conversations.remove", { conversationId });
      if (result.ok) removedIds.add(conversationId);
      else if (!cleanupError) cleanupError = result.error || "conversations.remove failed";
      if (!isProjectCurrent(token)) throw new Error(t("fx.error.projectSwitched"));
    }

    // 归档/删除期间的 await 可能让其他审查或修复完成：必须基于最新状态合并本次清理，
    // 不能用开始时的快照整体覆盖，否则新 issue 与会话完成状态会回退。
    if (!isProjectCurrent(token)) throw new Error(t("fx.error.projectSwitched"));
    const latest = store.get();
    const cleanedIds = new Set([...archiveSet, ...removedIds]);
    // 修复会话被归档或删除后不会再回写结果：释放所有被清理修复会话锁定的 issue。
    // 不能只看当前 sessions.fix：分批批次与已被新会话覆盖的旧会话只存在于台账里。
    const cleanedFixIds = new Set(
      (cleanedByKey.get("fix") || []).filter((conversationId) => cleanedIds.has(conversationId)),
    );
    const latestFixConversationId = latest.state.sessions.fix?.conversationId || "";
    if (latestFixConversationId && cleanedIds.has(latestFixConversationId)) {
      cleanedFixIds.add(latestFixConversationId);
    }
    // 再应用用户勾选的归档/删除（用户显式选择优先）。
    const baseIssues = restoreFixingIssuesForConversations(
      latest.state.issues,
      Array.from(cleanedFixIds),
    );
    const selectedSet = new Set(issueIds);
    let issues = baseIssues;
    if (issueAction === "delete") {
      issues = issues.filter((issue) => !selectedSet.has(issue.id));
    } else {
      issues = issues.map((issue) => (selectedSet.has(issue.id) ? archiveIssueRecord(issue) : issue));
    }
    const sessions = { ...latest.state.sessions };
    // 清理时删除 issue 同样要保留旧修复会话的文件占用证据。
    if (issueAction === "delete" && sessions.fix) {
      sessions.fix = recordDeletedIssueClaims(sessions.fix, latest.state.issues, issueIds);
    }
    for (const key of sessionKeys) {
      const ids = cleanedByKey.get(key) || [];
      const session = sessions[key];
      if (!session || !ids.includes(session.conversationId) || !cleanedIds.has(session.conversationId)) continue;
      const tracked = tracking.get(key);
      if (tracked && tracked.conversationId === session.conversationId) cancelToken(tracked);
      sessions[key] = null;
    }
    let activity = latest.activity;
    if (activity && cleanedIds.has(activity.conversationId)) activity = null;
    else if (activity && activity.phase === "done") activity = null;
    const nextState = {
      ...latest.state,
      issues,
      conversationLog: removeConversationsFromLog(latest.state.conversationLog, cleanedIds),
      sessions,
    };
    store.set({
      state: nextState,
      selected: [],
      dialog: null,
      activity,
    });
    if (cleanupError) {
      setToast("error", t("fx.toast.cleanupFailed", { error: cleanupError }));
    } else {
      setToast(
        "success",
        t("fx.toast.cleanupDone", { issues: selectedSet.size, sessions: cleanedIds.size }),
      );
    }
    await saveState({ projectId: token.directoryId, state: nextState });
  }

  async function archiveIssue(issueId) {
    const snapshot = store.get();
    const issues = snapshot.state.issues.map((issue) =>
      issue.id === issueId ? archiveIssueRecord(issue) : issue,
    );
    const nextState = { ...snapshot.state, issues };
    store.set({ state: nextState, selected: snapshot.selected.filter((id) => id !== issueId) });
    setToast("info", t("fx.toast.archived", { count: 1 }));
    await saveState({ projectId: snapshot.project?.directoryId, state: nextState });
  }

  async function restoreIssue(issueId) {
    const snapshot = store.get();
    const issues = snapshot.state.issues.map((issue) =>
      issue.id === issueId ? restoreIssueRecord(issue) : issue,
    );
    const nextState = { ...snapshot.state, issues };
    store.set({ state: nextState });
    setToast("info", t("fx.toast.restored"));
    await saveState({ projectId: snapshot.project?.directoryId, state: nextState });
  }

  // 删除主入口：单条删除与批量删除共用同一套过滤与持久化逻辑。
  async function applyDelete(issueIds) {
    const snapshot = store.get();
    const removed = removeIssues(snapshot.state.issues, issueIds);
    if (!removed.removed) {
      store.set({ dialog: null });
      return;
    }
    const target = new Set((Array.isArray(issueIds) ? issueIds : []).map(String));
    const fixSession = snapshot.state.sessions.fix;
    const nextFixSession = recordDeletedIssueClaims(
      fixSession,
      snapshot.state.issues,
      Array.from(target),
    );
    const sessions =
      nextFixSession === fixSession
        ? snapshot.state.sessions
        : { ...snapshot.state.sessions, fix: nextFixSession };
    const nextState = { ...snapshot.state, issues: removed.issues, sessions };
    store.set({
      state: nextState,
      selected: snapshot.selected.filter((id) => !target.has(id)),
      dialog: null,
    });
    setToast("info", t("fx.toast.deleted", { count: removed.removed }));
    await saveState({ projectId: snapshot.project?.directoryId, state: nextState });
  }

  async function deleteIssue(issueId) {
    await applyDelete([issueId]);
  }

  // 列表批量删除：只针对当前选中项，先弹确认框，避免误删。
  function deleteSelectedIssues() {
    const snapshot = store.get();
    const ids = snapshot.selected.filter((id) => snapshot.state.issues.some((issue) => issue.id === id));
    if (!ids.length) {
      setToast("error", t("fx.toast.noSelection"));
      return;
    }
    store.set({ dialog: { type: "delete", issueIds: ids, error: "" } });
  }

  async function openIssueLocation(issue) {
    const parsed = parseLocation(issue.location);
    if (!parsed.file) {
      setToast("error", t("fx.issues.unlocated"));
      return;
    }
    // issue 位置来自 AI 输出，只能打开当前项目内的文件；绝对路径同样走边界校验。
    const resolved = resolveIssueFilePath(store.get().project, parsed.file);
    if (!resolved) {
      setToast("error", t("fx.issues.outsideProject"));
      return;
    }
    const params = { filePath: resolved.filePath };
    if (resolved.sshWorkspacePath) {
      params.sshWorkspacePath = resolved.sshWorkspacePath;
      params.sshWorkspaceRoot = resolved.sshWorkspaceRoot;
    }
    if (resolved.sshWorkspaceId) params.sshWorkspaceId = resolved.sshWorkspaceId;
    if (parsed.line > 0) params.focusLine = parsed.line;
    const result = await runWrite("panels.openFile", params);
    if (!result.ok) {
      setToast("error", t("fx.issues.openFailed", { error: result.error || "panels.openFile failed" }));
    }
  }

  async function openConversation(conversationId) {
    const result = await runWrite("conversations.activate", { conversationId });
    if (!result.ok) setToast("error", result.error || "conversations.activate failed");
  }

  // 关闭 error / detached 修复卡片时，用户是在明确放弃这次跟踪：
  // 已确认结束的终态错误只需隐藏卡片；超时 / 未知错误与停止跟踪的会话仍占用
  // issue claim（issueIds / queue），必须同时释放，否则 hasFixConflict 会永久拒绝同一批 issue。
  function shouldReleaseFixLock(session) {
    if (!session) return false;
    if (session.status === "detached") return true;
    return session.status === "error" && isSessionPossiblyRunning(session, null);
  }

  function releaseFixSession(session) {
    const allIssueIds = Array.from(
      new Set(
        [
          ...(Array.isArray(session.allIssueIds) ? session.allIssueIds : []),
          ...(Array.isArray(session.issueIds) ? session.issueIds : []),
          ...(Array.isArray(session.queue) ? session.queue : []),
        ]
          .map(String)
          .filter(Boolean),
      ),
    );
    return {
      ...session,
      status: "dismissed",
      issueIds: [],
      queue: [],
      allIssueIds,
      activityDismissed: true,
    };
  }

  async function dismissActivity() {
    const snapshot = store.get();
    const activity = snapshot.activity;
    if (!activity) return;
    if (activity.phase === "done" || activity.phase === "dismissed") {
      store.set({ activity: null });
      return;
    }
    // error / detached 卡片会在重开工作台时由 buildActivityFromState 重建：
    // 必须把「已关闭」写入会话状态并持久化，否则用户点关闭看起来无效。
    if (activity.phase === "error" || activity.phase === "detached") {
      const sessionKey = activity.kind === "review" ? "review" : "fix";
      const session = snapshot.state.sessions[sessionKey];
      if (session && session.conversationId === activity.conversationId) {
        // 终态错误也可能残留 fixing（旧数据或异常中断），关闭时统一释放。
        const issues =
          sessionKey === "fix"
            ? restoreFixingIssues(snapshot.state.issues, activity.conversationId)
            : snapshot.state.issues;
        const nextSession =
          sessionKey === "fix" && shouldReleaseFixLock(session)
            ? releaseFixSession(session)
            : { ...session, activityDismissed: true };
        const state = {
          ...snapshot.state,
          issues,
          sessions: {
            ...snapshot.state.sessions,
            [sessionKey]: nextSession,
          },
        };
        // 报错 / 停止跟踪后通常已无令牌；这里兜底取消，避免残留轮询把结果写回已关闭的卡片。
        const token = tracking.get(sessionKey);
        if (token && token.conversationId === activity.conversationId) cancelToken(token);
        store.set({ state, activity: null });
        await saveState({ projectId: snapshot.project?.directoryId, state });
        return;
      }
      store.set({ activity: null });
      return;
    }
    const token = tracking.get(activity.kind);
    if (token && token.conversationId === activity.conversationId) cancelToken(token);
    const sessionKey = activity.kind === "review" ? "review" : "fix";
    const session = snapshot.state.sessions[sessionKey];
    let state = snapshot.state;
    if (session && session.conversationId === activity.conversationId && session.status === "running") {
      // 关闭运行中的修复卡片等于放弃本次跟踪：先释放修复中状态，避免 issue 永久停在修复中。
      const issues =
        sessionKey === "fix"
          ? restoreFixingIssues(snapshot.state.issues, activity.conversationId)
          : snapshot.state.issues;
      state = {
        ...snapshot.state,
        issues,
        sessions: {
          ...snapshot.state.sessions,
          [sessionKey]: { ...session, status: "dismissed", lastError: "" },
        },
      };
    }
    store.set({ state, activity: null });
    await saveState({ projectId: snapshot.project?.directoryId, state });
  }

  function openReviewDialog() {
    // 与宿主 /review 面板一致：每次打开都重新读取 Git 状态，并且初始不勾选任何变更。
    // 同时允许自动补一次提交记录，打开弹窗即可直接看到提交列表。
    commitAutoTried = false;
    store.set({
      dialog: {
        type: "review",
        directoryId: store.get().project?.directoryId || "",
        staged: [],
        unstaged: [],
        commits: [],
        note: "",
        loading: true,
        error: "",
      },
    });
    // loadGit 完成后由 syncReviewDialog 回填勾选项与加载态。
    void loadGit();
  }

  function openFixDialog(issueIds) {
    const snapshot = store.get();
    const ids = Array.isArray(issueIds) && issueIds.length ? issueIds : snapshot.selected;
    if (!ids.length) {
      setToast("error", t("fx.toast.noSelection"));
      return;
    }
    // 归档项可以勾选用于批量删除，但不能进入修复；已修复与已确认不存在的条目同理。
    // 这里与 startFix 一样过滤掉，确保弹窗展示的条目与实际修复范围一致。
    const issues = snapshot.state.issues.filter(
      (issue) => ids.includes(issue.id) && isFixSelectable(issue),
    );
    if (!issues.length) {
      setToast("error", t("fx.toast.noSelection"));
      return;
    }
    if (hasFixConflict(issues.map((issue) => issue.id))) {
      setToast("error", t("fx.toast.fixConflict"));
      return;
    }
    store.set({ dialog: { type: "fix", issueIds: issues.map((issue) => issue.id), error: "" } });
  }

  function openCleanupDialog() {
    const snapshot = store.get();
    const fixedIds = snapshot.state.issues
      .filter((issue) => issue.status === ISSUE_STATUS.fixed || issue.status === ISSUE_STATUS.notFound)
      .map((issue) => issue.id);
    const sessions = snapshot.state.sessions;
    // 运行中或跟踪超时后可能仍在运行的会话不能清理：默认保持，避免用户确认后才被引擎拒绝。
    // 没有当前 session 的历史台账会话不在跟踪中，默认归档（可恢复）。
    const defaultAction = (session) =>
      session &&
      (session.status === "dismissed" || isSessionPossiblyRunning(session, snapshot.activity))
        ? "keep"
        : "archive";
    store.set({
      dialog: {
        type: "cleanup",
        issueIds: fixedIds,
        issueAction: "archive",
        error: "",
        riskAcknowledged: false,
        sessions: {
          review: defaultAction(sessions.review),
          fix: defaultAction(sessions.fix),
        },
      },
    });
  }

  function openSettingsDialog() {
    const settings = store.get().settings || DEFAULT_SETTINGS;
    store.set({
      dialog: {
        type: "settings",
        error: "",
        parallelLimit: settings.parallelLimit,
        autoFixAfterReview: settings.autoFixAfterReview,
        autoCleanupAfterFix: settings.autoCleanupAfterFix,
        autoCleanupAction: settings.autoCleanupAction,
      },
    });
  }

  async function saveSettingsDialog(dialog) {
    const result = await setSettings({
      parallelLimit: dialog.parallelLimit,
      autoFixAfterReview: dialog.autoFixAfterReview,
      autoCleanupAfterFix: dialog.autoCleanupAfterFix,
      autoCleanupAction: dialog.autoCleanupAction,
    });
    if (!result.ok) {
      setDialogError(
        "settings",
        t("fx.settings.failed", {
          error: String(result.error?.cause?.message || result.error?.message || result.error),
        }),
      );
      return;
    }
    store.set({ dialog: null });
    setToast("success", t("fx.settings.saved"));
  }

  function updateDialog(patch) {
    const dialog = store.get().dialog;
    if (!dialog) return;
    store.set({ dialog: { ...dialog, ...patch } });
  }

  async function confirmDialog() {
    const snapshot = store.get();
    const dialog = snapshot.dialog;
    if (!dialog) return;
    if (dialog.error) store.set({ dialog: { ...dialog, error: "" } });
    try {
      if (dialog.type === "review") {
        await startReview(dialog);
      } else if (dialog.type === "fix") {
        await startFix(dialog.issueIds);
      } else if (dialog.type === "cleanup") {
        await applyCleanup(dialog);
      } else if (dialog.type === "delete") {
        await applyDelete(dialog.issueIds);
      } else if (dialog.type === "settings") {
        await saveSettingsDialog(dialog);
      }
    } catch (error) {
      const message = String(error?.message || error);
      // 弹窗仍打开时把失败原因留在弹窗内；已被替换或关闭时不回写，避免复活旧弹窗。
      const current = store.get().dialog;
      if (current && current.type === dialog.type) {
        store.set({ dialog: { ...current, error: message } });
      }
      setToast("error", message);
    }
  }

  return {
    store,
    mount,
    unmount,
    refresh,
    reload,
    clearToast,
    activateProject,
    loadProjects,
    setShowArchived,
    setSeverityFilter,
    toggleSelected,
    selectMany,
    clearSelection,
    deleteSelectedIssues,
    openDialog,
    closeDialog,
    toggleDirectory,
    startReview,
    startFix,
    applyCleanup,
    archiveIssue,
    restoreIssue,
    deleteIssue,
    applyDelete,
    openIssueLocation,
    openConversation,
    dismissActivity,
    openReviewDialog,
    openFixDialog,
    openCleanupDialog,
    openSettingsDialog,
    setSettings,
    updateDialog,
    confirmDialog,
    detachTracking,
    retryParse,
    resumeActivityTracking,
    loadCommitsViaCommand,
    canRunCommitCommand,
    buildReviewRequest,
    buildScopeSelection,
    getSnapshot: () => store.get(),
    currentStep: () => currentStep(store.get()),
  };
}
