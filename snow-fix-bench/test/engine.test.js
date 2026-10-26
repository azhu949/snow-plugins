// 引擎运行时测试：用 mock API 覆盖项目载入、项目切换与订阅生命周期。
import { strict as assert } from "node:assert";
import test from "node:test";

import { resolveEngine } from "../src/engine.js";

const DIRECTORY_A = { directoryId: "a", name: "Alpha", path: "D:/alpha", kind: "local", sortOrder: 0 };
const DIRECTORY_B = { directoryId: "b", name: "Beta", path: "D:/beta", kind: "local", sortOrder: 1 };
const COLLECTION = {
  collectionId: "c1",
  name: "Group",
  color: "#ff8800",
  sortOrder: 0,
  memberDirectoryIds: ["b"],
  linkedDirectoryIds: ["b"],
};

function createMockApi(options = {}) {
  const state = {
    projects: {
      directories: (options.directories || [DIRECTORY_A, DIRECTORY_B]).slice(),
      collections: (options.collections || [COLLECTION]).slice(),
      active: null,
    },
    stored: options.stored ?? null,
    messages: options.messages || [],
    conversations: options.conversations ?? null,
    runtime: options.runtime ?? null,
    live: options.live ?? null,
    values: new Map(),
    writes: [],
    unsubscribes: 0,
    listener: null,
    createCalls: 0,
    createGate: options.createGate || null,
    createResults: Array.isArray(options.createResults) ? options.createResults.slice() : null,
    writeFailures: options.writeFailures || {},
  };
  const setActive = (directoryId) => {
    state.projects.active = state.projects.directories.find((item) => item.directoryId === directoryId) || null;
  };
  setActive(options.activeId === undefined ? "a" : options.activeId);

  const api = {
    get locale() {
      return "zh-CN";
    },
    metadata: {
      async get(domain) {
        const ids = Array.isArray(domain) ? domain : [domain];
        if (ids.includes("git")) return { domains: { git: { status: options.gitStatus ?? null } } };
        if (ids.includes("runtime")) return { domains: { runtime: state.runtime } };
        if (ids.includes("messages")) return { domains: { messages: { items: state.messages, live: state.live } } };
        if (ids.includes("conversations")) return { domains: { conversations: state.conversations } };
        return { domains: { projects: state.projects } };
      },
      subscribe(domain, listener) {
        state.listener = listener;
        const subscription = {
          unsubscribe() {
            state.unsubscribes += 1;
          },
        };
        return options.asyncSubscribe ? Promise.resolve(subscription) : subscription;
      },
    },
    write: {
      async run(action, params) {
        state.writes.push({ action, params });
        const gate = options.writeGate ? options.writeGate(action, params) : null;
        if (gate) await gate.promise;
        if (state.writeFailures[action]) {
          return { ok: false, action, error: String(state.writeFailures[action]) };
        }
        if (action === "projects.activate") setActive(params.directoryId);
        if (action === "conversations.create") {
          state.createCalls += 1;
          if (state.createGate) await state.createGate.promise;
          if (state.createResults?.length) return state.createResults.shift();
          return { ok: true, data: { conversationId: options.conversationId || `conv-${state.createCalls}` } };
        }
        if (action === "mcpTools.call") {
          return {
            ok: true,
            data: JSON.stringify({ stdout: options.commitStdout || "", stderr: "", exitCode: 0 }),
          };
        }
        return { ok: true, data: {} };
      },
    },
    storage: {
      async getJson(key) {
        if (state.values.has(key)) return state.values.get(key);
        return state.stored;
      },
      async setJson(key, value) {
        state.values.set(key, value);
      },
    },
  };

  return { api, state, setActive };
}

// 完全权限档通过 window.snow 提供 Git IPC；测试结束后恢复全局状态。
async function withWindowSnow(snow, fn) {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const previous = globalThis.window;
  globalThis.window = { snow };
  try {
    await fn();
  } finally {
    if (hadWindow) globalThis.window = previous;
    else delete globalThis.window;
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(predicate, timeoutMs = 12000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("waitFor timeout");
}

test("mount 载入项目与合集，同步订阅不报错", async () => {
  const { api, state } = createMockApi();
  const engine = resolveEngine(api);
  await engine.mount();
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.error, "");
  assert.equal(snapshot.project.directoryId, "a");
  assert.equal(snapshot.projects.directories.length, 2);
  assert.equal(snapshot.projects.collections.length, 1);
  assert.equal(snapshot.projects.collections[0].memberDirectoryIds[0], "b");
  engine.unmount();
  assert.equal(state.unsubscribes, 1);
});

test("activateProject 调用 projects.activate 并切换当前项目", async () => {
  const { api, state } = createMockApi();
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.activateProject("b");
  assert.deepEqual(state.writes, [{ action: "projects.activate", params: { directoryId: "b" } }]);
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.project.directoryId, "b");
  assert.equal(snapshot.projects.activeId, "b");
  engine.unmount();
});

test("项目订阅推送新激活项目时自动切换", async () => {
  const { api, state, setActive } = createMockApi();
  const engine = resolveEngine(api);
  await engine.mount();
  setActive("b");
  state.listener({ domains: { projects: state.projects } });
  await tick();
  assert.equal(engine.getSnapshot().project.directoryId, "b");
  engine.unmount();
});

test("无激活项目时进入 no-project 且保持订阅", async () => {
  const { api, state } = createMockApi({ activeId: null });
  const engine = resolveEngine(api);
  await engine.mount();
  assert.equal(engine.getSnapshot().status, "no-project");
  assert.equal(engine.getSnapshot().projects.directories.length, 2);
  assert.equal(typeof state.listener, "function");
  engine.unmount();
});

test("兼容返回 Promise 的订阅实现", async () => {
  const { api } = createMockApi({ asyncSubscribe: true });
  const engine = resolveEngine(api);
  await engine.mount();
  await tick();
  assert.equal(engine.getSnapshot().status, "ready");
  engine.unmount();
});

test("startReview 在建会话期间切换项目时关闭会话并拒绝", async () => {
  const gate = createDeferred();
  const { api, state, setActive } = createMockApi({ createGate: gate, conversationId: "conv-race" });
  const engine = resolveEngine(api);
  await engine.mount();
  const pending = engine.startReview({ note: "" }).catch((error) => error);
  while (state.createCalls < 1) await tick();
  setActive("b");
  state.listener({ domains: { projects: state.projects } });
  await tick();
  gate.resolve();
  const error = await pending;
  assert.ok(error instanceof Error);
  assert.match(error.message, /项目已切换/);
  assert.ok(
    state.writes.some(
      (item) => item.action === "conversations.remove" && item.params.conversationId === "conv-race",
    ),
  );
  assert.equal(engine.getSnapshot().project.directoryId, "b");
  assert.equal(engine.getSnapshot().state.sessions.review, null);
  engine.unmount();
});

test("同类任务并发启动时第二次直接提示忙碌", async () => {
  const gate = createDeferred();
  const { api, state, setActive } = createMockApi({ createGate: gate, conversationId: "conv-busy" });
  const engine = resolveEngine(api);
  await engine.mount();
  const first = engine.startReview({}).catch((error) => error);
  while (state.createCalls < 1) await tick();
  await engine.startReview({});
  assert.equal(state.createCalls, 1);
  assert.match(engine.getSnapshot().toast.text, /已有审查任务正在/);
  // 切换项目放弃第一个启动，避免进入轮询跟踪。
  setActive("b");
  state.listener({ domains: { projects: state.projects } });
  await tick();
  gate.resolve();
  const error = await first;
  assert.ok(error instanceof Error);
  assert.ok(state.writes.some((item) => item.action === "conversations.remove"));
  engine.unmount();
});

test("未选择变更时构建当前代码审查请求", async () => {
  const { api } = createMockApi({
    gitStatus: { isRepo: true, currentBranch: "main", files: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  while (engine.getSnapshot().git.loading) await tick();
  const built = await engine.buildReviewRequest({ staged: [], unstaged: [], commits: [], note: "" });
  assert.equal(built.currentCode, true);
  assert.equal(built.repoMissing, false);
  assert.equal(built.scopeLabel, "当前代码");
  assert.match(built.prompt, /请审查当前项目的代码变更与实现质量/);
  engine.unmount();
});

test("非 Git 项目仍可构建当前代码审查请求", async () => {
  const { api } = createMockApi({
    gitStatus: { isRepo: false, currentBranch: "", files: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  while (engine.getSnapshot().git.loading) await tick();
  const built = await engine.buildReviewRequest({ staged: [], unstaged: [], commits: [], note: "" });
  assert.equal(built.currentCode, true);
  assert.equal(built.repoMissing, true);
  assert.match(built.prompt, /请审查当前项目的代码变更与实现质量/);
  engine.unmount();
});

test("空选择发起审查时提示改为审查当前项目代码", async () => {
  const { api, state } = createMockApi({
    gitStatus: { isRepo: true, currentBranch: "main", files: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  while (engine.getSnapshot().git.loading) await tick();
  await engine.startReview({ staged: [], unstaged: [], commits: [], note: "" });
  assert.ok(state.writes.some((item) => item.action === "conversations.create"));
  assert.match(engine.getSnapshot().toast.text, /没有勾选任何变更/);
  engine.unmount();
});

test("非 Git 项目发起审查时提示未检测到仓库", async () => {
  const { api, state } = createMockApi({
    gitStatus: { isRepo: false, currentBranch: "", files: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  while (engine.getSnapshot().git.loading) await tick();
  await engine.startReview({ staged: [], unstaged: [], commits: [], note: "" });
  assert.ok(state.writes.some((item) => item.action === "conversations.create"));
  assert.match(engine.getSnapshot().toast.text, /未检测到 Git 仓库/);
  engine.unmount();
});

test("openReviewDialog 在非 Git 仓库不执行提交命令", async () => {
  const { api, state } = createMockApi({
    gitStatus: { isRepo: false, currentBranch: "", files: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  while (engine.getSnapshot().git.loading) await tick();
  engine.openReviewDialog();
  while (engine.getSnapshot().git.loading) await tick();
  await tick();
  assert.equal(engine.getSnapshot().git.status.isRepo, false);
  assert.equal(
    state.writes.some((item) => item.action === "mcpTools.call"),
    false,
  );
  engine.unmount();
});

test("终端工具不可用时只尝试一次，刷新后可重试", async () => {
  const { api, state } = createMockApi({
    gitStatus: { isRepo: true, currentBranch: "main", files: [] },
    writeFailures: { "mcpTools.call": "Unknown tool: bash-terminal-execute" },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  const calls = () => state.writes.filter((item) => item.action === "mcpTools.call").length;

  engine.openReviewDialog();
  await waitFor(() => calls() >= 2);
  await waitFor(() => Boolean(engine.getSnapshot().git.commandError));
  assert.equal(calls(), 2);
  assert.match(engine.getSnapshot().git.commandError, /Terminal/);

  // 再次打开弹窗不应重复尝试确定不可用的工具。
  engine.closeDialog();
  engine.openReviewDialog();
  await tick();
  assert.equal(calls(), 2);

  // 用户主动刷新视为重新检测工具状态。
  engine.refresh();
  await waitFor(() => calls() >= 4);
  engine.unmount();
});

test("并行上限默认值、区间收敛与持久化", async () => {
  const { api, state } = createMockApi();
  const engine = resolveEngine(api);
  await engine.mount();
  assert.equal(engine.getSnapshot().settings.parallelLimit, 3);
  assert.equal(engine.getSnapshot().settings.autoFixAfterReview, true);
  assert.equal(engine.getSnapshot().settings.autoFixOptIn, false);

  const saved = await engine.setSettings({ parallelLimit: 99 });
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.parallelLimit, 10);
  assert.equal(engine.getSnapshot().settings.parallelLimit, 10);
  assert.deepEqual(state.values.get("fixbench:v2:settings"), {
    schemaVersion: 5,
    parallelLimit: 10,
    apiProfile: "",
    autoFixAfterReview: true,
    autoFixOptIn: false,
    autoCleanupAfterFix: false,
    autoCleanupAction: "archive",
    autoCleanupSessionKinds: ["fix", "verify"],
    verifyAfterFix: false,
    issueSeverities: ["严重", "一般"],
    customPrompts: {
      review: { enabled: false, text: "" },
      fix: { enabled: false, text: "" },
      verify: { enabled: false, text: "" },
    },
  });

  // 重新加载后从存储恢复，而不是回退默认值。
  await engine.reload();
  assert.equal(engine.getSnapshot().settings.parallelLimit, 10);
  engine.unmount();
});

test("设置读取失败时自动修复改为等待确认", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-review",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  // 仅设置读取失败，项目状态仍可正常加载。
  const originalGetJson = api.storage.getJson;
  api.storage.getJson = async (key) => {
    if (key === "fixbench:v2:settings") throw new Error("settings unavailable");
    return originalGetJson(key);
  };
  state.messages = [
    {
      role: "assistant",
      content:
        '```snow-issues\n[{"severity":"一般","title":"读取失败","location":"fallback.ts:1"}]\n```',
    },
  ];
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.settingsLoadFailed, true);
  assert.equal(snapshot.settings.autoFixAfterReview, true);
  assert.equal(snapshot.state.sessions.fix, null);
  assert.equal(state.createCalls, 0);
  assert.equal(snapshot.dialog.type, "fix");
  assert.deepEqual(snapshot.dialog.issueIds, [snapshot.state.issues[0].id]);
  assert.match(snapshot.dialog.notice, /等待确认/);

  await engine.confirmDialog();
  await waitFor(() => engine.getSnapshot().state.sessions.fix?.status === "running");
  assert.equal(state.createCalls, 1);
  // 设置仍读不到时，opt-in 只保留在内存，不得把默认设置写回覆盖用户配置。
  assert.equal(state.values.has("fixbench:v2:settings"), false);
  assert.equal(engine.getSnapshot().settingsLoadFailed, true);
  engine.unmount();
});

test("审查结论全部落在范围外时给出独立提示", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-review",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content:
          '```snow-issues\n[{"severity":"严重","title":"范围外","location":"a.ts:1"}]\n```',
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ issueSeverities: ["建议"] });
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues.length, 0);
  assert.equal(snapshot.state.sessions.review.status, "done");
  assert.match(snapshot.toast.text, /均不在本次审查使用的修复范围内/);
  engine.unmount();
});

test("设置读取失败后重试成功时以存储值为基底合并", async () => {
  const storedSettings = {
    schemaVersion: 3,
    parallelLimit: 5,
    autoFixAfterReview: false,
    autoFixOptIn: false,
    autoCleanupAfterFix: true,
    autoCleanupAction: "delete",
    verifyAfterFix: true,
    issueSeverities: ["建议"],
  };
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-review",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content:
          '```snow-issues\n[{"severity":"一般","title":"读取恢复","location":"a.ts:1"}]\n```',
      },
    ],
  });
  state.values.set("fixbench:v2:settings", storedSettings);
  const originalGetJson = api.storage.getJson;
  let failedOnce = false;
  api.storage.getJson = async (key) => {
    if (key === "fixbench:v2:settings" && !failedOnce) {
      failedOnce = true;
      throw new Error("settings unavailable");
    }
    return originalGetJson(key);
  };
  const engine = resolveEngine(api);
  await engine.mount();
  assert.equal(engine.getSnapshot().settingsLoadFailed, true);
  await engine.retryParse();
  assert.equal(engine.getSnapshot().dialog.type, "fix");
  await engine.confirmDialog();
  await waitFor(() => engine.getSnapshot().state.sessions.fix?.status === "running");

  const saved = state.values.get("fixbench:v2:settings");
  assert.equal(saved.parallelLimit, 5);
  assert.deepEqual(saved.issueSeverities, ["建议"]);
  assert.equal(saved.autoFixAfterReview, false);
  assert.equal(saved.autoCleanupAfterFix, true);
  assert.equal(saved.autoCleanupAction, "delete");
  assert.equal(saved.verifyAfterFix, true);
  assert.equal(saved.autoFixOptIn, true);
  assert.equal(engine.getSnapshot().settingsLoadFailed, false);
  engine.unmount();
});

// 三条共用：设置读取失败一次后恢复，弹窗打开时看到的是默认值。
function createSettingsReadFailureApi(storedSettings) {
  const { api, state } = createMockApi();
  state.values.set("fixbench:v2:settings", storedSettings);
  const originalGetJson = api.storage.getJson;
  let failedOnce = false;
  api.storage.getJson = async (key) => {
    if (key === "fixbench:v2:settings" && !failedOnce) {
      failedOnce = true;
      throw new Error("settings unavailable");
    }
    return originalGetJson(key);
  };
  return { api, state };
}

const STORED_SETTINGS = {
  schemaVersion: 3,
  parallelLimit: 5,
  autoFixAfterReview: false,
  autoFixOptIn: false,
  autoCleanupAfterFix: true,
  autoCleanupAction: "delete",
  verifyAfterFix: true,
  issueSeverities: ["建议"],
};

test("设置读取失败时弹窗保存只写入改动字段，不覆盖存储中的原有配置", async () => {
  const { api, state } = createSettingsReadFailureApi(STORED_SETTINGS);
  const engine = resolveEngine(api);
  await engine.mount();
  assert.equal(engine.getSnapshot().settingsLoadFailed, true);

  // 读取失败时弹窗展示默认值，并带上读取失败标记与基线快照。
  engine.openSettingsDialog();
  const opened = engine.getSnapshot().dialog;
  assert.equal(opened.type, "settings");
  assert.equal(opened.loadFailed, true);
  assert.equal(opened.parallelLimit, 3);
  assert.deepEqual(opened.issueSeverities, ["严重", "一般"]);

  // 用户只改并行上限：保存只写入该项，其余配置保持存储中的原值。
  engine.updateDialog({ parallelLimit: 7 });
  await engine.confirmDialog();

  const saved = state.values.get("fixbench:v2:settings");
  assert.equal(saved.parallelLimit, 7);
  assert.equal(saved.autoFixAfterReview, false);
  assert.equal(saved.autoFixOptIn, false);
  assert.equal(saved.autoCleanupAfterFix, true);
  assert.equal(saved.autoCleanupAction, "delete");
  assert.equal(saved.verifyAfterFix, true);
  assert.deepEqual(saved.issueSeverities, ["建议"]);
  assert.equal(engine.getSnapshot().settingsLoadFailed, false);
  assert.equal(engine.getSnapshot().dialog, null);
  engine.unmount();
});

test("设置弹窗打开后配置被成功重读时，未改动字段不被弹窗默认值覆盖", async () => {
  const { api, state } = createSettingsReadFailureApi(STORED_SETTINGS);
  const engine = resolveEngine(api);
  await engine.mount();
  engine.openSettingsDialog();
  assert.equal(engine.getSnapshot().dialog.loadFailed, true);

  // 弹窗打开后设置被成功重读（例如自动修复确认写入 opt-in）：内存回到存储值，
  // 弹窗仍显示默认值；此时保存不得把未改动字段的默认值写回。
  await engine.setSettings({ autoFixOptIn: true });
  assert.equal(engine.getSnapshot().settingsLoadFailed, false);

  engine.updateDialog({ parallelLimit: 7 });
  await engine.confirmDialog();

  const saved = state.values.get("fixbench:v2:settings");
  assert.equal(saved.parallelLimit, 7);
  assert.equal(saved.autoFixAfterReview, false);
  assert.equal(saved.autoCleanupAfterFix, true);
  assert.equal(saved.autoCleanupAction, "delete");
  assert.equal(saved.verifyAfterFix, true);
  assert.deepEqual(saved.issueSeverities, ["建议"]);
  engine.unmount();
});

test("设置读取失败且重读仍失败时不落盘，改动只在当前会话生效", async () => {
  const { api, state } = createMockApi();
  const originalGetJson = api.storage.getJson;
  api.storage.getJson = async (key) => {
    if (key === "fixbench:v2:settings") throw new Error("settings unavailable");
    return originalGetJson(key);
  };
  const engine = resolveEngine(api);
  await engine.mount();

  engine.openSettingsDialog();
  engine.updateDialog({ verifyAfterFix: true });
  await engine.confirmDialog();

  const snapshot = engine.getSnapshot();
  assert.equal(state.values.has("fixbench:v2:settings"), false);
  assert.equal(snapshot.settingsLoadFailed, true);
  assert.equal(snapshot.dialog.type, "settings");
  assert.match(snapshot.dialog.error, /当前会话/);
  // 内存中只有用户改动过的字段变化，其余保持弹窗打开时的默认值。
  assert.equal(snapshot.settings.verifyAfterFix, true);
  assert.equal(snapshot.settings.parallelLimit, 3);
  engine.unmount();
});

test("设置弹窗没有改动时不写盘并给出提示", async () => {
  const { api, state } = createMockApi();
  const engine = resolveEngine(api);
  await engine.mount();

  engine.openSettingsDialog();
  await engine.confirmDialog();

  assert.equal(state.values.has("fixbench:v2:settings"), false);
  assert.equal(engine.getSnapshot().dialog, null);
  assert.match(engine.getSnapshot().toast.text, /无需保存/);
  engine.unmount();
});

test("审查完成时用户正在使用的弹窗不被自动修复确认框覆盖", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-review",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content:
          '```snow-issues\n[{"severity":"一般","title":"新问题","location":"a.ts:1"}]\n```',
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  engine.openSettingsDialog();
  engine.updateDialog({ parallelLimit: 7 });
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.dialog.type, "settings");
  assert.equal(snapshot.dialog.parallelLimit, 7);
  assert.equal(snapshot.pendingAutoFix.issueIds.length, 1);
  assert.equal(state.createCalls, 0);
  assert.equal(snapshot.state.sessions.fix, null);

  // 用户关闭设置弹窗后，从 issue 列表入口重新打开自动修复确认框。
  engine.closeDialog();
  engine.openPendingAutoFix();
  const reopened = engine.getSnapshot();
  assert.equal(reopened.dialog.type, "fix");
  assert.equal(reopened.dialog.autoFixOptIn, true);
  assert.equal(reopened.pendingAutoFix, null);

  await engine.confirmDialog();
  await waitFor(() => engine.getSnapshot().state.sessions.fix?.status === "running");
  assert.equal(state.createCalls, 1);
  engine.unmount();
});

test("旧存储显式关闭自动修复时升级后仍保持关闭", async () => {
  const { api, state } = createMockApi();
  state.values.set("fixbench:v2:settings", { schemaVersion: 2, autoFixAfterReview: false });
  const engine = resolveEngine(api);
  await engine.mount();
  assert.equal(engine.getSnapshot().settings.autoFixAfterReview, false);

  // 用户只改其它设置时，也不能把升级后的默认值写回并覆盖原选择。
  const saved = await engine.setSettings({ parallelLimit: 4 });
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.autoFixAfterReview, false);
  assert.equal(state.values.get("fixbench:v2:settings").autoFixAfterReview, false);
  engine.unmount();
});

test("无设置记录或旧记录缺字段时默认开启但需先确认", async () => {
  const { api, state } = createMockApi();
  const engine = resolveEngine(api);
  await engine.mount();
  assert.equal(engine.getSnapshot().settings.autoFixAfterReview, true);
  assert.equal(engine.getSnapshot().settings.autoFixOptIn, false);
  // 首次挂载只读，不把默认值写入存储。
  assert.equal(state.values.has("fixbench:v2:settings"), false);

  // 旧记录缺少字段：保存其它设置也不会被当作已确认。
  state.values.set("fixbench:v2:settings", { schemaVersion: 2, parallelLimit: 5 });
  await engine.reload();
  assert.equal(engine.getSnapshot().settings.autoFixAfterReview, true);
  assert.equal(engine.getSnapshot().settings.autoFixOptIn, false);
  const saved = await engine.setSettings({ parallelLimit: 4 });
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.autoFixOptIn, false);
  assert.equal(state.values.get("fixbench:v2:settings").autoFixOptIn, false);

  // 旧记录里显式开启过自动修复：视为已确认。
  state.values.set("fixbench:v2:settings", { schemaVersion: 2, autoFixAfterReview: true });
  await engine.reload();
  assert.equal(engine.getSnapshot().settings.autoFixOptIn, true);
  engine.unmount();
});

test("首次自动修复先等待确认，确认后记住 opt-in", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-review",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  state.messages = [
    {
      role: "assistant",
      content: '```snow-issues\n[{"severity":"一般","title":"新问题","location":"new.ts:1"}]\n```',
    },
  ];
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.sessions.fix, null);
  assert.equal(state.createCalls, 0);
  assert.equal(snapshot.dialog.type, "fix");
  assert.equal(snapshot.dialog.autoFixOptIn, true);
  assert.match(snapshot.dialog.notice, /等待确认/);

  await engine.confirmDialog();
  await waitFor(() => engine.getSnapshot().state.sessions.fix?.status === "running");
  assert.equal(state.createCalls, 1);
  assert.equal(state.values.get("fixbench:v2:settings").autoFixOptIn, true);
  engine.unmount();
});

test("deleteSelectedIssues 批量删除选中项并清空选择", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      { id: "i1", severity: "严重", title: "A", location: "a.ts:1", status: "open" },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "fixing" },
      { id: "i3", severity: "一般", title: "C", location: "c.ts:3", status: "fixed" },
    ],
    sessions: { review: null, fix: null },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  engine.selectMany(["i1", "i2"]);
  engine.deleteSelectedIssues();
  assert.equal(engine.getSnapshot().dialog.type, "delete");
  assert.deepEqual(engine.getSnapshot().dialog.issueIds, ["i1", "i2"]);

  await engine.confirmDialog();
  assert.deepEqual(
    engine.getSnapshot().state.issues.map((issue) => issue.id),
    ["i3"],
  );
  assert.deepEqual(engine.getSnapshot().selected, []);
  assert.equal(engine.getSnapshot().dialog, null);
  assert.equal(state.values.get("fixbench:v2:a").issues.length, 1);
  engine.unmount();
});

test("状态与关键词筛选变化会清空选择，全选取并集、反选只翻转当前结果", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      { id: "i1", severity: "严重", title: "空指针", location: "a.ts:1", impact: "启动崩溃", status: "open" },
      { id: "i2", severity: "一般", title: "并发写入", location: "b.ts:2", impact: "缓存击穿", status: "fixed" },
      { id: "i3", severity: "建议", title: "命名", location: "c.ts:3", impact: "可读性", status: "archived" },
    ],
    sessions: { review: null, fix: null },
  };
  const { api } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();

  let snapshot = engine.getSnapshot();
  assert.equal(snapshot.statusFilter, "all");
  assert.equal(snapshot.severityFilter, "all");
  assert.equal(snapshot.searchQuery, "");

  // 筛选条件变化会清空选择，避免对隐藏项执行修复或删除。
  engine.selectMany(["i2"]);
  engine.setStatusFilter("archived");
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.statusFilter, "archived");
  assert.deepEqual(snapshot.selected, []);
  engine.setStatusFilter("bogus");
  assert.equal(engine.getSnapshot().statusFilter, "all");

  engine.selectMany(["i1"]);
  engine.setSearchQuery("缓存");
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.searchQuery, "缓存");
  assert.deepEqual(snapshot.selected, []);

  // 反选只翻转传入的当前结果，结果之外的已选项保留。
  engine.selectMany(["i1"]);
  engine.invertSelection(["i1", "i2"]);
  assert.deepEqual(engine.getSnapshot().selected, ["i2"]);
  engine.invertSelection(["i2"]);
  assert.deepEqual(engine.getSnapshot().selected, []);
  engine.selectMany(["i1", "i3"]);
  engine.invertSelection(["i3"]);
  assert.deepEqual(engine.getSnapshot().selected, ["i1"]);

  // 建议级筛选可用，非法值回退到全部。
  engine.selectMany(["i1"]);
  engine.setSeverityFilter("建议");
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.severityFilter, "建议");
  assert.deepEqual(snapshot.selected, []);
  engine.setSeverityFilter("bogus");
  assert.equal(engine.getSnapshot().severityFilter, "all");

  // 先恢复到无筛选状态，再验证全选与已有选择取并集。
  engine.setSearchQuery("");
  engine.clearSelection();
  engine.selectMany(["i3"]);
  engine.selectMany(["i1", "i2"]);
  assert.deepEqual(engine.getSnapshot().selected, ["i3", "i1", "i2"]);
  // 空结果不改变选择；清空选择走 clearSelection。
  engine.selectMany([]);
  assert.deepEqual(engine.getSnapshot().selected, ["i3", "i1", "i2"]);

  // 重复设置同一筛选值不清空选择，值真正变化时仍然清空。
  engine.setStatusFilter("all");
  engine.setSeverityFilter("all");
  engine.setSearchQuery("");
  assert.deepEqual(engine.getSnapshot().selected, ["i3", "i1", "i2"]);
  engine.setStatusFilter("archived");
  assert.deepEqual(engine.getSnapshot().selected, []);
  engine.unmount();
});

test("startFix 按并行上限分批并只把首批写入提示词", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      { id: "i1", severity: "严重", title: "A", location: "a.ts:1", status: "open" },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
      { id: "i3", severity: "一般", title: "C", location: "c.ts:3", status: "open" },
      { id: "i4", severity: "一般", title: "D", location: "d.ts:4", status: "open" },
      { id: "i5", severity: "一般", title: "E", location: "e.ts:5", status: "open" },
    ],
    sessions: { review: null, fix: null },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.startFix(["i1", "i2", "i3", "i4", "i5"]);

  const fix = engine.getSnapshot().state.sessions.fix;
  assert.equal(fix.batchNumber, 1);
  assert.equal(fix.batchTotal, 2);
  assert.equal(fix.batchSize, 3);
  assert.deepEqual(fix.issueIds, ["i1", "i2", "i3"]);
  assert.deepEqual(fix.queue, ["i4", "i5"]);

  const createCall = state.writes.find(
    (item) => item.action === "conversations.create" && item.params.text.includes("snow-fix-results"),
  );
  assert.ok(createCall);
  assert.ok(createCall.params.title.includes("第 1/2 批"));
  const fenced = createCall.params.text.split("```json")[1].split("```")[0];
  const rows = JSON.parse(fenced);
  assert.deepEqual(
    rows.map((row) => row.issueId),
    ["i1", "i2", "i3"],
  );
  engine.unmount();
});

test("重开工作台后保留已停止跟踪的会话卡片，并可继续跟踪", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-detached",
        startedAt: 1,
        status: "detached",
        issueIds: [],
        batchNumber: 1,
        batchTotal: 1,
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  const activity = engine.getSnapshot().activity;
  assert.equal(activity.kind, "fix");
  assert.equal(activity.phase, "detached");
  assert.equal(engine.getSnapshot().state.sessions.fix.status, "detached");

  await engine.resumeActivityTracking();
  const resumed = engine.getSnapshot();
  assert.equal(resumed.activity.phase, "waiting");
  assert.equal(resumed.state.sessions.fix.status, "running");
  assert.equal(state.values.get("fixbench:v2:a").sessions.fix.status, "running");
  engine.unmount();
});

test("重开工作台后保留报错会话：超时与解析失败文案可恢复", async () => {
  const timeoutStored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-timeout",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const timeoutEngine = resolveEngine(createMockApi({ stored: timeoutStored }).api);
  await timeoutEngine.mount();
  const timeoutActivity = timeoutEngine.getSnapshot().activity;
  assert.equal(timeoutActivity.kind, "review");
  assert.equal(timeoutActivity.phase, "error");
  assert.equal(timeoutActivity.timedOut, true);
  assert.equal(timeoutActivity.error, "");
  timeoutEngine.unmount();

  const parseStored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-parse",
        startedAt: 1,
        status: "error",
        lastError: "parse-failed",
        issueIds: [],
        batchNumber: 1,
        batchTotal: 1,
      },
    },
  };
  const parseEngine = resolveEngine(createMockApi({ stored: parseStored }).api);
  await parseEngine.mount();
  const parseActivity = parseEngine.getSnapshot().activity;
  assert.equal(parseActivity.kind, "fix");
  assert.equal(parseActivity.phase, "error");
  assert.match(parseActivity.error, /未找到结构化修复结果/);
  parseEngine.unmount();
});

test("非空但无可用字段的审查结果标记 error 而不是未发现问题", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-review-no-fields",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  state.messages = [{ role: "assistant", content: '```snow-issues\n[{"severity":"严重"}]\n```' }];
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.sessions.review.status, "error");
  assert.equal(snapshot.state.sessions.review.lastError, "review-parse-failed");
  assert.equal(snapshot.activity.phase, "error");
  assert.match(snapshot.activity.error, /未能从审查结果中解析出 issue/);
  assert.match(snapshot.toast.text, /未能从审查结果中解析出 issue/);
  assert.equal(snapshot.state.lastReviewAt, 0);
  engine.unmount();
});

test("审查结果无法解析时标记 error 而不是未发现问题", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-review",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  state.messages = [{ role: "assistant", content: "审查完成，但没有结构化输出。" }];
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.sessions.review.status, "error");
  assert.equal(snapshot.state.sessions.review.lastError, "review-parse-failed");
  assert.equal(snapshot.activity.phase, "error");
  assert.match(snapshot.activity.error, /未能从审查结果中解析出 issue/);
  assert.match(snapshot.toast.text, /未能从审查结果中解析出 issue/);
  assert.equal(snapshot.state.lastReviewAt, 0);
  engine.unmount();
});

test("关闭运行中的修复卡片会释放修复中状态", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "running",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  assert.equal(engine.getSnapshot().state.issues[0].status, "fixing");
  await engine.dismissActivity();
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues[0].status, "open");
  assert.equal(snapshot.state.issues[0].fix, null);
  assert.equal(snapshot.state.sessions.fix.status, "dismissed");
  assert.equal(snapshot.activity, null);
  assert.equal(state.values.get("fixbench:v2:a").issues[0].status, "open");
  engine.unmount();
});

test("关闭运行中的修复卡片后再次修复同一批 issue 会被拒绝", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "running",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.dismissActivity();

  await engine.startFix(["i1"]);
  assert.equal(state.createCalls, 0);
  assert.equal(engine.getSnapshot().state.sessions.fix.status, "dismissed");
  assert.match(engine.getSnapshot().toast.text, /正在修复中/);

  engine.openFixDialog(["i1"]);
  assert.equal(engine.getSnapshot().dialog, null);
  assert.match(engine.getSnapshot().toast.text, /正在修复中/);

  engine.openCleanupDialog();
  assert.equal(engine.getSnapshot().dialog.sessions.fix, "keep");

  // 清理对话框仍保留显式出口：runtime 未知时确认已结束再归档，之后可以重新修复。
  await engine.applyCleanup({
    sessions: { fix: "archive" },
    issueAction: "archive",
    issueIds: [],
    riskAcknowledged: true,
  });
  assert.equal(engine.getSnapshot().state.sessions.fix, null);
  assert.ok(state.writes.some((item) => item.action === "conversations.archive"));
  engine.unmount();
});

test("关闭运行中的修复卡片后再次修复队列中的 issue 会被拒绝", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "running",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: ["i2"],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.dismissActivity();
  assert.equal(engine.getSnapshot().state.sessions.fix.status, "dismissed");

  // 关闭卡片只停止跟踪：旧会话仍可能继续处理队列中的批次。
  await engine.startFix(["i2"]);
  assert.equal(state.createCalls, 0);
  assert.equal(
    engine.getSnapshot().state.issues.find((issue) => issue.id === "i2").status,
    "open",
  );
  assert.match(engine.getSnapshot().toast.text, /正在修复中/);

  engine.openFixDialog(["i2"]);
  assert.equal(engine.getSnapshot().dialog, null);
  assert.match(engine.getSnapshot().toast.text, /正在修复中/);
  engine.unmount();
});

test("清理归档修复会话会释放修复中状态", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "detached",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.applyCleanup({ sessions: { fix: "archive" }, issueAction: "archive", issueIds: [] });
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues[0].status, "open");
  assert.equal(snapshot.state.sessions.fix, null);
  assert.ok(state.writes.some((item) => item.action === "conversations.archive"));
  engine.unmount();
});

test("清理时用户勾选归档优先于修复中状态释放", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "detached",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.applyCleanup({
    sessions: { fix: "delete" },
    issueAction: "archive",
    issueIds: ["i1"],
    riskAcknowledged: true,
  });
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues[0].status, "archived");
  assert.equal(snapshot.state.issues[0].archivedFrom, "open");
  assert.equal(snapshot.state.sessions.fix, null);
  engine.unmount();
});

test("清理历史修复会话会释放其修复中状态", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i-old",
        severity: "严重",
        title: "旧问题",
        location: "a.ts:10",
        status: "fixing",
        fix: { conversationId: "conv-old" },
      },
      {
        id: "i-new",
        severity: "一般",
        title: "新问题",
        location: "b.ts:20",
        status: "fixing",
        fix: { conversationId: "conv-new" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-new",
        startedAt: 2,
        status: "detached",
        issueIds: ["i-new"],
        batchNumber: 2,
        batchTotal: 2,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i-old", "i-new"],
        sessionIds: ["conv-old", "conv-new"],
      },
    },
    conversationLog: [
      { conversationId: "conv-old", kind: "fix", title: "第一批", createdAt: 1 },
      { conversationId: "conv-new", kind: "fix", title: "第二批", createdAt: 2 },
    ],
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.applyCleanup({ sessions: { fix: "archive" }, issueAction: "archive", issueIds: [] });

  const snapshot = engine.getSnapshot();
  const oldIssue = snapshot.state.issues.find((issue) => issue.id === "i-old");
  const newIssue = snapshot.state.issues.find((issue) => issue.id === "i-new");
  assert.equal(oldIssue.status, "open");
  assert.equal(oldIssue.fix, null);
  assert.equal(newIssue.status, "open");
  assert.equal(newIssue.fix, null);
  assert.equal(snapshot.state.sessions.fix, null);
  const archive = state.writes.find((item) => item.action === "conversations.archive");
  assert.deepEqual(archive.params.conversationIds.slice().sort(), ["conv-new", "conv-old"]);
  engine.unmount();
});

test("startFix 覆盖已结束旧修复会话前释放其残留锁定", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i-old",
        severity: "严重",
        title: "旧问题",
        location: "a.ts:10",
        status: "fixing",
        fix: { conversationId: "conv-old" },
      },
      { id: "i-new", severity: "一般", title: "新问题", location: "b.ts:20", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-old",
        startedAt: 1,
        status: "done",
        issueIds: ["i-old"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i-old"],
        sessionIds: ["conv-old"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.startFix(["i-new"]);

  const snapshot = engine.getSnapshot();
  const oldIssue = snapshot.state.issues.find((issue) => issue.id === "i-old");
  const newIssue = snapshot.state.issues.find((issue) => issue.id === "i-new");
  assert.equal(state.createCalls, 1);
  assert.equal(oldIssue.status, "open");
  assert.equal(oldIssue.fix, null);
  assert.equal(newIssue.status, "fixing");
  engine.unmount();
});

test("清理等待归档期间完成的审查结果不会被旧快照覆盖", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i-fix",
        severity: "一般",
        title: "B",
        location: "b.ts:2",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
    ],
    sessions: {
      review: {
        conversationId: "conv-review",
        startedAt: 1,
        status: "running",
        issueIds: [],
      },
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "detached",
        issueIds: ["i-fix"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i-fix"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const gate = createDeferred();
  const { api, state } = createMockApi({
    stored,
    writeGate: (action) => (action === "conversations.archive" ? gate : null),
  });
  const engine = resolveEngine(api);
  await engine.mount();
  const pending = engine.applyCleanup({
    sessions: { review: "keep", fix: "archive" },
    issueAction: "archive",
    issueIds: [],
    riskAcknowledged: true,
  });
  while (!state.writes.some((item) => item.action === "conversations.archive")) await tick();

  // 模拟另一个审查在归档等待期间完成：内存中已有新 issue 与会话完成状态。
  const live = engine.getSnapshot();
  engine.store.set({
    state: {
      ...live.state,
      issues: [
        ...live.state.issues,
        { id: "i-new", severity: "一般", title: "C", location: "c.ts:3", status: "open" },
      ],
      sessions: {
        ...live.state.sessions,
        review: { ...live.state.sessions.review, status: "done" },
      },
      lastReviewAt: 123,
    },
  });

  gate.resolve();
  await pending;

  const after = engine.getSnapshot();
  assert.ok(after.state.issues.some((issue) => issue.id === "i-new"));
  assert.equal(after.state.issues.find((issue) => issue.id === "i-fix").status, "open");
  assert.equal(after.state.sessions.review.status, "done");
  assert.equal(after.state.sessions.fix, null);
  assert.equal(after.state.lastReviewAt, 123);

  const persisted = state.values.get("fixbench:v2:a");
  assert.ok(persisted.issues.some((issue) => issue.id === "i-new"));
  assert.equal(persisted.sessions.review.status, "done");
  engine.unmount();
});

test("归档已修复 issue 后恢复保持已修复，刷新后来源状态仍在", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "一般",
        title: "A",
        location: "a.ts:1",
        status: "fixed",
        fix: { conversationId: "conv-fix", result: "fixed", summary: "ok" },
      },
    ],
    sessions: { review: null, fix: null },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.archiveIssue("i1");
  assert.equal(engine.getSnapshot().state.issues[0].status, "archived");
  const archived = state.values.get("fixbench:v2:a");
  assert.equal(archived.issues[0].archivedFrom, "fixed");

  // 重新挂载模拟刷新：normalizeIssue 必须保留 archivedFrom，恢复后才能还原为已修复。
  const reloadedApi = createMockApi({ stored: archived });
  const reloaded = resolveEngine(reloadedApi.api);
  await reloaded.mount();
  assert.equal(reloaded.getSnapshot().state.issues[0].archivedFrom, "fixed");
  await reloaded.restoreIssue("i1");
  const restored = reloaded.getSnapshot().state.issues[0];
  assert.equal(restored.status, "fixed");
  assert.equal(restored.archivedFrom, null);
  assert.equal(restored.fix.summary, "ok");
  reloaded.unmount();
  engine.unmount();
});

test("超时或跟踪异常的会话默认保留，清理会被拒绝", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-timeout",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  engine.openCleanupDialog();
  assert.equal(engine.getSnapshot().dialog.sessions.review, "keep");
  const error = await engine
    .applyCleanup({ sessions: { review: "archive" }, issueAction: "archive", issueIds: [] })
    .catch((err) => err);
  assert.ok(error instanceof Error);
  assert.match(error.message, /会话仍在运行/);
  assert.ok(!state.writes.some((item) => item.action === "conversations.archive"));
  assert.equal(engine.getSnapshot().state.sessions.review.status, "error");
  engine.unmount();
});

test("已确认结束的异常会话仍允许清理", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-parse",
        startedAt: 1,
        status: "error",
        lastError: "parse-failed",
        issueIds: [],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: [],
        sessionIds: ["conv-parse"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  engine.openCleanupDialog();
  assert.equal(engine.getSnapshot().dialog.sessions.fix, "archive");
  await engine.applyCleanup({ sessions: { fix: "archive" }, issueAction: "archive", issueIds: [] });
  assert.equal(engine.getSnapshot().state.sessions.fix, null);
  assert.ok(state.writes.some((item) => item.action === "conversations.archive"));
  engine.unmount();
});

test("已完成审查重新解析不会再次合并旧结论", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixed",
        fix: { conversationId: "conv-fix", result: "fixed", summary: "ok" },
      },
    ],
    sessions: {
      review: { conversationId: "conv-review", startedAt: 1, status: "done", issueIds: [] },
      fix: null,
    },
  };
  const { api, state } = createMockApi({ stored });
  state.messages = [
    {
      role: "assistant",
      content: '```snow-issues\n[{"severity":"严重","title":"A","location":"a.ts:1"}]\n```',
    },
  ];
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ autoFixAfterReview: true });
  engine.store.set({
    activity: {
      kind: "review",
      conversationId: "conv-review",
      startedAt: 1,
      phase: "done",
      message: "",
      error: "",
      issueIds: [],
    },
  });

  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.sessions.review.status, "done");
  assert.equal(snapshot.state.issues[0].status, "fixed");
  assert.equal(snapshot.state.issues[0].regression, null);
  assert.equal(snapshot.state.lastReviewAt, 0);
  assert.equal(state.createCalls, 0);
  engine.unmount();
});

test("审查显式空结果仍标记完成并提示未发现问题", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-empty",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  state.messages = [{ role: "assistant", content: "```snow-issues\n[]\n```" }];
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.sessions.review.status, "done");
  assert.equal(snapshot.state.sessions.review.lastError, "");
  assert.equal(snapshot.activity.phase, "done");
  assert.match(snapshot.toast.text, /未发现纳入修复范围的问题/);
  engine.unmount();
});

test("重开后审查解析失败显示对应文案", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-parse-review",
        startedAt: 1,
        status: "error",
        lastError: "review-parse-failed",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  const activity = engine.getSnapshot().activity;
  assert.equal(activity.phase, "error");
  assert.match(activity.error, /未能从审查结果中解析出 issue/);
  engine.unmount();
});

test("停止跟踪后再次修复同一批修复中 issue 会被拒绝", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-old" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-old",
        startedAt: 1,
        status: "detached",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-old"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();

  // 停止跟踪不中止旧会话：直接再次修复必须被拒绝，不能新建第二个会话。
  await engine.startFix(["i1"]);
  assert.equal(state.createCalls, 0);
  assert.equal(engine.getSnapshot().state.sessions.fix.conversationId, "conv-old");
  assert.equal(engine.getSnapshot().state.issues[0].status, "fixing");
  assert.match(engine.getSnapshot().toast.text, /正在修复中/);

  // 修复弹窗同样不能打开，避免用户确认后才被引擎拒绝。
  engine.openFixDialog(["i1"]);
  assert.equal(engine.getSnapshot().dialog, null);
  assert.match(engine.getSnapshot().toast.text, /正在修复中/);
  engine.unmount();
});

test("停止跟踪后再次修复队列中的 issue 会被拒绝", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-old" },
      },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-old",
        startedAt: 1,
        status: "detached",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: ["i2"],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-old"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();

  // 停止跟踪不中止旧会话：队列中的 issue 仍属于在途范围。
  await engine.startFix(["i2"]);
  assert.equal(state.createCalls, 0);
  assert.equal(engine.getSnapshot().state.sessions.fix.conversationId, "conv-old");
  assert.equal(
    engine.getSnapshot().state.issues.find((issue) => issue.id === "i2").status,
    "open",
  );
  assert.match(engine.getSnapshot().toast.text, /正在修复中/);

  engine.openFixDialog(["i2"]);
  assert.equal(engine.getSnapshot().dialog, null);
  assert.match(engine.getSnapshot().toast.text, /正在修复中/);
  engine.unmount();
});

test("超时后 issue 已释放但旧修复会话可能仍在运行时拒绝再次修复", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      { id: "i1", severity: "严重", title: "A", location: "a.ts:1", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-timeout",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-timeout"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();

  await engine.startFix(["i1"]);
  assert.equal(state.createCalls, 0);
  assert.equal(engine.getSnapshot().state.issues[0].status, "open");
  assert.match(engine.getSnapshot().toast.text, /正在修复中/);
  engine.unmount();
});

test("已结束的修复会话不阻止新的修复", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      { id: "i1", severity: "严重", title: "A", location: "a.ts:1", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-done",
        startedAt: 1,
        status: "done",
        issueIds: [],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: [],
        sessionIds: ["conv-done"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();

  await engine.startFix(["i1"]);
  assert.equal(state.createCalls, 1);
  const session = engine.getSnapshot().state.sessions.fix;
  assert.deepEqual(session.issueIds, ["i1"]);
  assert.equal(engine.getSnapshot().state.issues[0].status, "fixing");
  engine.unmount();
});

test("已结束的修复会话不阻止修复其残留队列中的 issue", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixed",
        fix: { conversationId: "conv-done" },
      },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-done",
        startedAt: 1,
        status: "done",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: ["i2"],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-done"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();

  // done 会话可能保留未续批的队列（如手动重新解析）：它已确认结束，不能误拦新修复。
  await engine.startFix(["i2"]);
  assert.equal(state.createCalls, 1);
  assert.equal(
    engine.getSnapshot().state.issues.find((issue) => issue.id === "i2").status,
    "fixing",
  );
  engine.unmount();
});

test("停止跟踪的修复会话会阻止修复同文件的新 issue", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i-old",
        severity: "严重",
        title: "旧问题",
        location: "a.ts:10",
        status: "fixing",
        fix: { conversationId: "conv-old" },
      },
      { id: "i-new", severity: "一般", title: "新问题", location: "a.ts:80", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-old",
        startedAt: 1,
        status: "detached",
        issueIds: ["i-old"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i-old"],
        sessionIds: ["conv-old"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();

  await engine.startFix(["i-new"]);
  assert.equal(state.createCalls, 0);
  assert.equal(
    engine.getSnapshot().state.issues.find((issue) => issue.id === "i-new").status,
    "open",
  );
  assert.match(engine.getSnapshot().toast.text, /正在修复中|冲突/);
  engine.unmount();
});

test("停止跟踪的修复会话不阻止修复不同文件的新 issue", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i-old",
        severity: "严重",
        title: "旧问题",
        location: "a.ts:10",
        status: "fixing",
        fix: { conversationId: "conv-old" },
      },
      { id: "i-new", severity: "一般", title: "新问题", location: "b.ts:80", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-old",
        startedAt: 1,
        status: "detached",
        issueIds: ["i-old"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i-old"],
        sessionIds: ["conv-old"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();

  await engine.startFix(["i-new"]);
  assert.equal(state.createCalls, 1);
  assert.equal(
    engine.getSnapshot().state.issues.find((issue) => issue.id === "i-new").status,
    "fixing",
  );
  // 旧会话可能仍在运行：不同文件可以并行，但旧 issue 继续保留锁定，交由清理释放。
  assert.equal(
    engine.getSnapshot().state.issues.find((issue) => issue.id === "i-old").status,
    "fixing",
  );
  engine.unmount();
});

test("已关闭卡片的修复会话仍会阻止修复同文件的新 issue", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      { id: "i-old", severity: "严重", title: "旧问题", location: "a.ts:10", status: "open" },
      { id: "i-new", severity: "一般", title: "新问题", location: "a.ts:80", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-old",
        startedAt: 1,
        status: "dismissed",
        issueIds: [],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i-old"],
        sessionIds: ["conv-old"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();

  await engine.startFix(["i-new"]);
  assert.equal(state.createCalls, 0);
  assert.equal(
    engine.getSnapshot().state.issues.find((issue) => issue.id === "i-new").status,
    "open",
  );
  engine.unmount();
});

test("删除已关闭修复卡片认领的 issue 后不再永久阻断其他文件修复", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      { id: "i1", severity: "严重", title: "A", location: "a.ts:1", status: "open" },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
      { id: "i3", severity: "一般", title: "C", location: "c.ts:3", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: ["i2"],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.dismissActivity();

  // 删除前把 b.ts 写入旧会话的认领快照，旧会话仍可能修改该文件。
  await engine.deleteIssue("i2");
  assert.deepEqual(engine.getSnapshot().state.sessions.fix.claimedIssueFiles.i2, ["b.ts"]);

  await engine.startFix(["i3"]);
  assert.equal(state.createCalls, 1);
  assert.equal(
    engine.getSnapshot().state.issues.find((issue) => issue.id === "i3").status,
    "fixing",
  );
  engine.unmount();
});

test("删除认领 issue 后修复同一文件仍会被拒绝", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      { id: "i1", severity: "严重", title: "A", location: "a.ts:1", status: "open" },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
      { id: "i3", severity: "一般", title: "C", location: "b.ts:80", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: ["i2"],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.dismissActivity();
  await engine.deleteIssue("i2");

  await engine.startFix(["i3"]);
  assert.equal(state.createCalls, 0);
  assert.equal(
    engine.getSnapshot().state.issues.find((issue) => issue.id === "i3").status,
    "open",
  );
  assert.match(engine.getSnapshot().toast.text, /正在修复中|冲突/);
  engine.unmount();
});

test("关闭运行中的修复卡片后删除认领 issue 仍能修复其他文件", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      { id: "i1", severity: "严重", title: "A", location: "a.ts:1", status: "fixing", fix: { conversationId: "conv-fix" } },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "running",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.dismissActivity();
  await engine.deleteIssue("i1");

  assert.deepEqual(engine.getSnapshot().state.sessions.fix.claimedIssueFiles.i1, ["a.ts"]);
  await engine.startFix(["i2"]);
  assert.equal(state.createCalls, 1);
  engine.unmount();
});

test("清理会话时归档分批修复的全部批次", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix-3",
        startedAt: 1,
        status: "done",
        issueIds: [],
        batchNumber: 3,
        batchTotal: 3,
        batchSize: 1,
        queue: [],
        allIssueIds: [],
        sessionIds: ["conv-fix-1", "conv-fix-2", "conv-fix-3"],
      },
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.applyCleanup({ sessions: { fix: "archive" }, issueAction: "archive", issueIds: [] });

  const archive = state.writes.find((item) => item.action === "conversations.archive");
  assert.ok(archive);
  assert.deepEqual(
    archive.params.conversationIds.slice().sort(),
    ["conv-fix-1", "conv-fix-2", "conv-fix-3"],
  );
  assert.equal(engine.getSnapshot().state.sessions.fix, null);
  assert.deepEqual(engine.getSnapshot().state.conversationLog, []);
  engine.unmount();
});

test("没有当前会话时仍能清理历史会话台账", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: { review: null, fix: null },
    conversationLog: [
      { conversationId: "conv-old-review", kind: "review", title: "旧审查", createdAt: 1 },
      { conversationId: "conv-old-fix", kind: "fix", title: "旧修复", createdAt: 2 },
    ],
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  engine.openCleanupDialog();
  const dialog = engine.getSnapshot().dialog;
  assert.equal(dialog.sessions.review, "archive");
  assert.equal(dialog.sessions.fix, "archive");

  await engine.applyCleanup({
    sessions: { review: "delete", fix: "archive" },
    issueAction: "archive",
    issueIds: [],
    riskAcknowledged: true,
  });
  const archive = state.writes.find((item) => item.action === "conversations.archive");
  assert.deepEqual(archive.params.conversationIds, ["conv-old-fix"]);
  const remove = state.writes.find((item) => item.action === "conversations.remove");
  assert.equal(remove.params.conversationId, "conv-old-review");
  assert.deepEqual(engine.getSnapshot().state.conversationLog, []);
  assert.match(engine.getSnapshot().toast.text, /2 个会话/);
  engine.unmount();
});

test("历史台账会话仍在运行时拒绝归档与删除", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: { review: null, fix: null },
    conversationLog: [
      { conversationId: "conv-old-fix", kind: "fix", title: "旧修复", createdAt: 1 },
    ],
  };
  const { api, state } = createMockApi({
    stored,
    runtime: {
      conversation: null,
      streamingSessions: [{ conversationId: "conv-old-fix", isStreaming: true }],
    },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  engine.openCleanupDialog();
  assert.equal(engine.getSnapshot().dialog.sessions.fix, "archive");

  await assert.rejects(
    engine.applyCleanup({ sessions: { fix: "archive" }, issueAction: "archive", issueIds: [] }),
    /会话仍在运行/,
  );
  await assert.rejects(
    engine.applyCleanup({ sessions: { fix: "delete" }, issueAction: "archive", issueIds: [] }),
    /会话仍在运行/,
  );

  assert.ok(!state.writes.some((item) => item.action === "conversations.archive"));
  assert.ok(!state.writes.some((item) => item.action === "conversations.remove"));
  assert.equal(engine.getSnapshot().state.conversationLog.length, 1);
  engine.unmount();
});

test("runtime 不可读时历史会话清理需要显式确认", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: { review: null, fix: null },
    conversationLog: [
      { conversationId: "conv-old-fix", kind: "fix", title: "旧修复", createdAt: 1 },
    ],
  };
  const { api, state } = createMockApi({ stored, runtime: null });
  const engine = resolveEngine(api);
  await engine.mount();

  await assert.rejects(
    engine.applyCleanup({ sessions: { fix: "archive" }, issueAction: "archive", issueIds: [] }),
    /无法确认/,
  );
  assert.ok(!state.writes.some((item) => item.action === "conversations.archive"));

  await engine.applyCleanup({
    sessions: { fix: "archive" },
    issueAction: "archive",
    issueIds: [],
    riskAcknowledged: true,
  });
  const archive = state.writes.find((item) => item.action === "conversations.archive");
  assert.deepEqual(archive.params.conversationIds, ["conv-old-fix"]);
  assert.deepEqual(engine.getSnapshot().state.conversationLog, []);
  engine.unmount();
});

test("runtime 不可读时 detached 当前会话删除需要显式确认", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "detached",
        issueIds: [],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: [],
        sessionIds: ["conv-fix"],
      },
    },
    conversationLog: [{ conversationId: "conv-fix", kind: "fix", title: "修复", createdAt: 1 }],
  };
  const { api, state } = createMockApi({ stored, runtime: null });
  const engine = resolveEngine(api);
  await engine.mount();

  await assert.rejects(
    engine.applyCleanup({ sessions: { fix: "delete" }, issueAction: "archive", issueIds: [] }),
    /无法确认/,
  );
  assert.ok(!state.writes.some((item) => item.action === "conversations.remove"));

  await engine.applyCleanup({
    sessions: { fix: "delete" },
    issueAction: "archive",
    issueIds: [],
    riskAcknowledged: true,
  });
  const remove = state.writes.find((item) => item.action === "conversations.remove");
  assert.equal(remove.params.conversationId, "conv-fix");
  engine.unmount();
});

test("runtime 不可读时已确认结束的当前会话无需风险确认", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "done",
        issueIds: [],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: [],
        sessionIds: ["conv-fix"],
      },
    },
    conversationLog: [{ conversationId: "conv-fix", kind: "fix", title: "修复", createdAt: 1 }],
  };
  const { api, state } = createMockApi({ stored, runtime: null });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.applyCleanup({ sessions: { fix: "delete" }, issueAction: "archive", issueIds: [] });

  const remove = state.writes.find((item) => item.action === "conversations.remove");
  assert.equal(remove.params.conversationId, "conv-fix");
  engine.unmount();
});

test("启动审查与修复时把新会话写入台账", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      { id: "i1", severity: "一般", title: "A", location: "a.ts:1", status: "open" },
    ],
    sessions: { review: null, fix: null },
  };
  const { api } = createMockApi({
    stored,
    gitStatus: { isRepo: true, currentBranch: "main", files: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  while (engine.getSnapshot().git.loading) await tick();
  await engine.startReview({ staged: [], unstaged: [], commits: [], note: "" });
  await engine.startFix(["i1"]);
  assert.deepEqual(
    engine.getSnapshot().state.conversationLog.map((entry) => `${entry.kind}:${entry.conversationId}`),
    ["review:conv-1", "fix:conv-2"],
  );
  engine.unmount();
});

test("新建审查与修复会话后自动切换到该会话", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      { id: "i1", severity: "一般", title: "A", location: "a.ts:1", status: "open" },
    ],
    sessions: { review: null, fix: null },
  };
  const { api, state } = createMockApi({
    stored,
    gitStatus: { isRepo: true, currentBranch: "main", files: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  while (engine.getSnapshot().git.loading) await tick();

  await engine.startReview({ staged: [], unstaged: [], commits: [], note: "" });
  await engine.startFix(["i1"]);

  assert.deepEqual(
    state.writes
      .filter((item) => item.action === "conversations.activate")
      .map((item) => item.params.conversationId),
    ["conv-1", "conv-2"],
  );
  engine.unmount();
});

test("归档 issue 可勾选批量删除，但不会进入修复", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "一般",
        title: "A",
        location: "a.ts:1",
        status: "archived",
        archivedFrom: "fixed",
      },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: { review: null, fix: null },
  };
  const { api } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();

  // 只选归档项时不能打开修复弹窗。
  engine.selectMany(["i1"]);
  engine.openFixDialog();
  assert.equal(engine.getSnapshot().dialog, null);
  assert.match(engine.getSnapshot().toast.text, /请先勾选 issue/);

  // 混合选中时只把未归档项带入修复弹窗。
  engine.selectMany(["i1", "i2"]);
  engine.openFixDialog();
  assert.deepEqual(engine.getSnapshot().dialog.issueIds, ["i2"]);
  engine.closeDialog();

  // 归档项可以直接批量删除。
  engine.clearSelection();
  engine.selectMany(["i1"]);
  engine.deleteSelectedIssues();
  assert.deepEqual(engine.getSnapshot().dialog.issueIds, ["i1"]);
  await engine.confirmDialog();
  assert.deepEqual(
    engine.getSnapshot().state.issues.map((issue) => issue.id),
    ["i2"],
  );
  engine.unmount();
});

test("全选不会把已修复与不存在条目带入修复", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "not_found",
        fix: {
          conversationId: "conv-old",
          result: "not_found",
          summary: "复核后不存在",
          files: [],
          verification: "rg",
          at: 1,
        },
      },
      {
        id: "i2",
        severity: "一般",
        title: "B",
        location: "b.ts:2",
        status: "fixed",
        fix: {
          conversationId: "conv-old",
          result: "fixed",
          summary: "已修复",
          files: [],
          verification: "npm test",
          at: 1,
        },
      },
      { id: "i3", severity: "一般", title: "C", location: "c.ts:3", status: "open" },
    ],
    sessions: { review: null, fix: null },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();

  // 全选已定论条目时不能打开修复弹窗。
  engine.selectMany(["i1", "i2"]);
  engine.openFixDialog();
  assert.equal(engine.getSnapshot().dialog, null);
  assert.match(engine.getSnapshot().toast.text, /请先勾选 issue/);

  // 混合选中时只把仍可修复的条目带入弹窗。
  engine.selectMany(["i1", "i2", "i3"]);
  engine.openFixDialog();
  assert.deepEqual(engine.getSnapshot().dialog.issueIds, ["i3"]);
  engine.closeDialog();

  // 直接调用 startFix 也不能把已定论条目卷进修复会话。
  await assert.rejects(() => engine.startFix(["i1", "i2"]), /请先勾选 issue/);
  assert.equal(state.createCalls, 0);

  await engine.startFix(["i3"]);
  assert.equal(state.createCalls, 1);
  const snapshot = engine.getSnapshot();
  const notFound = snapshot.state.issues.find((issue) => issue.id === "i1");
  assert.equal(notFound.status, "not_found");
  assert.equal(notFound.fix.summary, "复核后不存在");
  const fixed = snapshot.state.issues.find((issue) => issue.id === "i2");
  assert.equal(fixed.status, "fixed");
  assert.equal(fixed.fix.summary, "已修复");
  assert.deepEqual(snapshot.state.sessions.fix.issueIds, ["i3"]);
  engine.unmount();
});

test("关闭修复卡片时按快照恢复不存在的结论与取证", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
        fixingFrom: {
          status: "not_found",
          fix: {
            conversationId: "conv-old",
            result: "not_found",
            summary: "复核后不存在",
            files: [],
            verification: "rg",
            at: 1,
          },
        },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "detached",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  assert.equal(engine.getSnapshot().activity.phase, "detached");

  await engine.dismissActivity();

  const issue = engine.getSnapshot().state.issues.find((item) => item.id === "i1");
  assert.equal(issue.status, "not_found");
  assert.equal(issue.fix.result, "not_found");
  assert.equal(issue.fix.summary, "复核后不存在");
  assert.equal(issue.fixingFrom, null);
  engine.unmount();
});

function fixResultText(rows) {
  return "```snow-fix-results\n" + JSON.stringify(rows) + "\n```";
}

function verifyResultText(rows) {
  return "```snow-verify-results\n" + JSON.stringify(rows) + "\n```";
}

// 单批修复已超时、issue 仍停在 fixing：手动重新解析会走到批次收尾。
function storedFixRun(options = {}) {
  return {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
        autoCleanup: Boolean(options.autoCleanup),
        cleanupAction: "archive",
      },
    },
    conversationLog: [{ conversationId: "conv-fix", kind: "fix", title: "修复", createdAt: 1 }],
  };
}

// 修复已完成、复审会话超时：手动重新解析直接走复审结果回写。
function storedVerifyRun() {
  return {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixed",
        fix: { conversationId: "conv-fix", result: "fixed", summary: "ok" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "done",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
      verify: {
        conversationId: "conv-verify",
        startedAt: 2,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        fixConversationId: "conv-fix",
        fixSessionIds: ["conv-fix"],
        fixIssueIds: ["i1"],
      },
    },
    conversationLog: [
      { conversationId: "conv-fix", kind: "fix", title: "修复", createdAt: 1 },
      { conversationId: "conv-verify", kind: "verify", title: "复审", createdAt: 2 },
    ],
  };
}

test("修复结果只回写本批次白名单内的 issue", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: fixResultText([
          { issueId: "i1", status: "fixed", summary: "ok" },
          { issueId: "i2", status: "fixed", summary: "越界" },
        ]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues.find((issue) => issue.id === "i1").status, "fixed");
  const i2 = snapshot.state.issues.find((issue) => issue.id === "i2");
  assert.equal(i2.status, "open");
  assert.equal(i2.fix, null);
  assert.equal(state.createCalls, 0);
  engine.unmount();
});

test("停止跟踪的修复会话仍在运行时拒绝重新解析", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "detached",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: {
      conversation: null,
      streamingSessions: [{ conversationId: "conv-fix", isStreaming: true }],
    },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues[0].status, "fixing");
  assert.equal(snapshot.state.sessions.fix.status, "detached");
  assert.equal(snapshot.activity.phase, "detached");
  assert.equal(state.createCalls, 0);
  assert.ok(!state.writes.some((item) => item.action === "conversations.create"));
  assert.match(snapshot.toast.text, /可能仍在运行/);
  engine.unmount();
});

test("确认停止跟踪的修复会话已结束后解析但不自动续批", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "detached",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: ["i2"],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: {
      conversation: { conversationId: "conv-fix", isStreaming: false, pendingMessageCount: 0 },
      streamingSessions: [],
    },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues.find((issue) => issue.id === "i1").status, "fixed");
  assert.equal(snapshot.state.sessions.fix.status, "done");
  assert.deepEqual(snapshot.state.sessions.fix.queue, ["i2"]);
  assert.equal(state.createCalls, 0);
  assert.ok(!state.writes.some((item) => item.action === "conversations.create"));
  engine.unmount();
});

test("超时的修复会话重新解析后不自动续批", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: ["i2"],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues.find((issue) => issue.id === "i1").status, "fixed");
  assert.equal(snapshot.state.issues.find((issue) => issue.id === "i2").status, "open");
  assert.equal(snapshot.state.sessions.fix.status, "done");
  assert.deepEqual(snapshot.state.sessions.fix.queue, ["i2"]);
  assert.equal(snapshot.activity.phase, "done");
  assert.equal(state.createCalls, 0);
  assert.ok(!state.writes.some((item) => item.action === "conversations.create"));
  engine.unmount();
});

test("停止跟踪的修复会话解析失败时保留修复中状态", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "detached",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: {
      conversation: { conversationId: "conv-fix", isStreaming: false, pendingMessageCount: 0 },
      streamingSessions: [],
    },
    messages: [{ role: "assistant", content: "修复完成，但没有结构化输出。" }],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues[0].status, "fixing");
  assert.equal(snapshot.state.issues[0].fix.conversationId, "conv-fix");
  assert.equal(snapshot.state.sessions.fix.status, "detached");
  assert.equal(snapshot.activity.phase, "detached");
  const saved = state.values.get("fixbench:v2:a");
  assert.equal(saved.issues[0].status, "fixing");

  await engine.startFix(["i1"]);
  assert.equal(state.createCalls, 0);
  assert.match(engine.getSnapshot().toast.text, /正在修复中/);
  engine.unmount();
});

test("继续跟踪续批期间刷新项目不会用旧快照覆盖新状态", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: ["i2"],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const gate = createDeferred();
  const { api, state } = createMockApi({
    stored,
    createGate: gate,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  // 手动重新解析不会续批，因此用「继续跟踪」触发正常的批间续批路径。
  void engine.resumeActivityTracking();
  await waitFor(() => state.writes.some((item) => item.action === "conversations.create"));

  // 续批创建期间其他写者更新了持久化状态，并触发刷新（epoch 变化）。
  const saved = state.values.get("fixbench:v2:a");
  saved.issues.push({ id: "i9", severity: "一般", title: "并发新增", location: "c.ts:3", status: "open" });
  await engine.reload();
  gate.resolve();
  await waitFor(() =>
    state.writes.some(
      (item) => item.action === "conversations.remove" && item.params.conversationId === "conv-1",
    ),
  );

  const snapshot = engine.getSnapshot();
  assert.ok(snapshot.state.issues.some((issue) => issue.id === "i9"));
  assert.equal(snapshot.state.issues.find((issue) => issue.id === "i2").status, "open");
  assert.equal(snapshot.state.sessions.fix.conversationId, "conv-fix");
  assert.equal(snapshot.state.sessions.fix.status, "done");
  const remove = state.writes.find((item) => item.action === "conversations.remove");
  assert.ok(remove);
  assert.equal(remove.params.conversationId, "conv-1");
  engine.unmount();
});

test("激活审查会话期间切换项目时关闭会话且不污染项目状态", async () => {
  const storedA = {
    version: 2,
    projectId: "a",
    issues: [{ id: "iA", severity: "一般", title: "A", location: "a.ts:1", status: "open" }],
    sessions: { review: null, fix: null },
  };
  const storedB = {
    version: 2,
    projectId: "b",
    issues: [{ id: "iB", severity: "一般", title: "B", location: "b.ts:1", status: "open" }],
    sessions: { review: null, fix: null },
  };
  const gate = createDeferred();
  const { api, state, setActive } = createMockApi({
    stored: storedA,
    conversationId: "conv-activate-review",
    gitStatus: { isRepo: true, currentBranch: "main", files: [] },
    writeGate: (action) => (action === "conversations.activate" ? gate : null),
  });
  state.values.set("fixbench:v2:a", storedA);
  state.values.set("fixbench:v2:b", storedB);
  const engine = resolveEngine(api);
  await engine.mount();
  while (engine.getSnapshot().git.loading) await tick();

  const pending = engine.startReview({ staged: [], unstaged: [], commits: [], note: "" }).catch((error) => error);
  while (!state.writes.some((item) => item.action === "conversations.activate")) await tick();
  setActive("b");
  state.listener({ domains: { projects: state.projects } });
  while (engine.getSnapshot().project?.directoryId !== "b") await tick();
  gate.resolve();

  const error = await pending;
  assert.ok(error instanceof Error);
  assert.match(error.message, /项目已切换/);
  assert.ok(
    state.writes.some(
      (item) => item.action === "conversations.remove" && item.params.conversationId === "conv-activate-review",
    ),
  );
  assert.deepEqual(state.values.get("fixbench:v2:a").issues.map((issue) => issue.id), ["iA"]);
  assert.deepEqual(state.values.get("fixbench:v2:b").issues.map((issue) => issue.id), ["iB"]);
  assert.equal(engine.getSnapshot().state.sessions.review, null);
  assert.equal(engine.getSnapshot().project.directoryId, "b");
  engine.unmount();
});

test("startFix 在激活会话后基于最新状态构造并保留并发审查结果", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [{ id: "i1", severity: "一般", title: "A", location: "a.ts:1", status: "open" }],
    sessions: {
      review: { conversationId: "conv-review", startedAt: 1, status: "running", issueIds: [] },
      fix: null,
    },
  };
  const gate = createDeferred();
  const { api, state } = createMockApi({
    stored,
    writeGate: (action) => (action === "conversations.activate" ? gate : null),
  });
  const engine = resolveEngine(api);
  await engine.mount();

  const pending = engine.startFix(["i1"]);
  while (!state.writes.some((item) => item.action === "conversations.activate")) await tick();
  const live = engine.getSnapshot();
  engine.store.set({
    state: {
      ...live.state,
      issues: [
        ...live.state.issues,
        { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
      ],
      sessions: { ...live.state.sessions, review: { ...live.state.sessions.review, status: "done" } },
      lastReviewAt: 123,
    },
  });
  gate.resolve();
  await pending;

  const snapshot = engine.getSnapshot();
  assert.ok(snapshot.state.issues.some((issue) => issue.id === "i2"));
  assert.equal(snapshot.state.sessions.review.status, "done");
  assert.equal(snapshot.state.lastReviewAt, 123);
  assert.equal(snapshot.state.issues.find((issue) => issue.id === "i1").status, "fixing");
  assert.equal(snapshot.state.sessions.fix.status, "running");
  const persisted = state.values.get("fixbench:v2:a");
  assert.ok(persisted.issues.some((issue) => issue.id === "i2"));
  assert.equal(persisted.sessions.review.status, "done");
  engine.unmount();
});

test("超时的修复会话仍在运行时拒绝重新解析和续批", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: ["i2"],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: {
      conversation: null,
      streamingSessions: [{ conversationId: "conv-fix", isStreaming: true }],
    },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues.find((issue) => issue.id === "i1").status, "fixing");
  assert.equal(snapshot.state.issues.find((issue) => issue.id === "i2").status, "open");
  assert.equal(snapshot.state.sessions.fix.status, "error");
  assert.equal(snapshot.state.sessions.fix.lastError, "timeout");
  assert.equal(snapshot.activity.phase, "error");
  assert.equal(state.createCalls, 0);
  assert.ok(!state.writes.some((item) => item.action === "conversations.create"));
  assert.match(snapshot.toast.text, /可能仍在运行/);
  engine.unmount();
});

test("停止跟踪的审查会话仍在运行时拒绝合并结果", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-review",
        startedAt: 1,
        status: "detached",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: {
      conversation: null,
      streamingSessions: [{ conversationId: "conv-review", isStreaming: true }],
    },
    messages: [
      {
        role: "assistant",
        content:
          '```snow-issues\n[{"severity":"严重","title":"半截结果","location":"a.ts:1","impact":"x","suggestion":"y"}]\n```',
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues.length, 0);
  assert.equal(snapshot.state.sessions.review.status, "detached");
  assert.equal(snapshot.activity.phase, "detached");
  assert.equal(state.createCalls, 0);
  assert.match(snapshot.toast.text, /可能仍在运行/);
  engine.unmount();
});

test("自动清理归档失败时保留会话台账并可重试", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix", "conv-old"],
        autoCleanup: true,
        cleanupAction: "archive",
      },
    },
    conversationLog: [
      { conversationId: "conv-fix", kind: "fix", title: "修复", createdAt: 1 },
      { conversationId: "conv-old", kind: "fix", title: "旧修复", createdAt: 2 },
    ],
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
    ],
    writeFailures: { "conversations.archive": "archive failed" },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  let snapshot = engine.getSnapshot();
  // 会话清理失败不再阻断 issue：失败会话保留在台账里，issue 仍按本轮结论归档。
  assert.equal(snapshot.state.issues[0].status, "archived");
  assert.equal(snapshot.state.sessions.fix.status, "done");
  assert.deepEqual(snapshot.state.sessions.fix.sessionIds, ["conv-fix", "conv-old"]);
  assert.equal(snapshot.state.conversationLog.length, 2);
  assert.match(snapshot.toast.text, /自动清理未完全成功/);
  const failedArchive = state.writes.find((item) => item.action === "conversations.archive");
  assert.ok(failedArchive);

  // 失败后保留可重试入口：再次清理应处理同一批会话。
  delete state.writeFailures["conversations.archive"];
  await engine.applyCleanup({ sessions: { fix: "archive" }, issueAction: "archive", issueIds: ["i1"] });
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.sessions.fix, null);
  assert.deepEqual(snapshot.state.conversationLog, []);
  assert.equal(snapshot.state.issues[0].status, "archived");
  const archives = state.writes.filter((item) => item.action === "conversations.archive");
  // 上一轮自动清理是「一次批量 + 逐项回退两次」，本轮手动清理再批量一次。
  assert.equal(archives.length, 4);
  assert.deepEqual(
    archives[archives.length - 1].params.conversationIds.slice().sort(),
    ["conv-fix", "conv-old"],
  );
  engine.unmount();
});

test("statusLimitHit 透传并在提示词中声明审查范围不完整", async () => {
  const { api } = createMockApi({
    gitStatus: {
      isRepo: true,
      currentBranch: "main",
      statusLimitHit: true,
      files: [
        { path: "src/a.ts", oldPath: null, indexStatus: "M", workdirStatus: " ", status: "M" },
      ],
    },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  while (engine.getSnapshot().git.loading) await tick();

  const built = await engine.buildReviewRequest({
    staged: ["staged:src/a.ts"],
    unstaged: [],
    commits: [],
    note: "",
  });
  assert.equal(built.statusLimitHit, true);
  assert.equal(built.scopeTruncated, true);
  assert.match(built.prompt, /本次审查范围并不完整/);

  const current = await engine.buildReviewRequest({ staged: [], unstaged: [], commits: [], note: "" });
  assert.equal(current.statusLimitHit, true);
  assert.equal(current.scopeTruncated, false);
  assert.ok(!current.prompt.includes("本次审查范围并不完整"));
  engine.unmount();
});

test("单个 gitFileDiff 失败不阻断审查并降级为清单备注", async () => {
  const gitStatus = {
    isRepo: true,
    currentBranch: "main",
    files: [
      { path: "src/a.ts", oldPath: null, indexStatus: "M", workdirStatus: " ", status: "M" },
      { path: "src/b.ts", oldPath: null, indexStatus: "M", workdirStatus: " ", status: "M" },
    ],
  };
  const { api, state } = createMockApi({ gitStatus });
  const snow = {
    async gitStatus() {
      return gitStatus;
    },
    async gitLog() {
      return [];
    },
    async gitFileDiff(_root, file) {
      if (file === "src/b.ts") throw new Error("git diff failed: src/b.ts");
      return { content: "@@ -1 +1 @@\n-a\n+b", isBinary: false };
    },
  };
  await withWindowSnow(snow, async () => {
    const engine = resolveEngine(api);
    await engine.mount();
    while (engine.getSnapshot().git.loading) await tick();

    const dialog = {
      staged: ["staged:src/a.ts", "staged:src/b.ts"],
      unstaged: [],
      commits: [],
      note: "",
    };
    const built = await engine.buildReviewRequest(dialog);
    assert.equal(built.diffFailures, 1);
    assert.match(built.prompt, /src\/a\.ts/);
    assert.match(built.prompt, /src\/b\.ts/);
    assert.match(built.prompt, /差异读取失败/);
    assert.equal((built.prompt.match(/```diff/g) || []).length, 1);

    await engine.startReview(dialog);
    assert.ok(state.writes.some((item) => item.action === "conversations.create"));
    assert.equal(engine.getSnapshot().state.sessions.review.status, "running");
    engine.unmount();
  });
});

test("全部 gitFileDiff 失败时回退为文件清单审查", async () => {
  const gitStatus = {
    isRepo: true,
    currentBranch: "main",
    files: [
      { path: "src/a.ts", oldPath: null, indexStatus: "M", workdirStatus: " ", status: "M" },
      { path: "src/b.ts", oldPath: null, indexStatus: "M", workdirStatus: " ", status: "M" },
    ],
  };
  const { api, state } = createMockApi({ gitStatus });
  const snow = {
    async gitStatus() {
      return gitStatus;
    },
    async gitLog() {
      return [];
    },
    async gitFileDiff(_root, file) {
      throw new Error(`git diff failed: ${file}`);
    },
  };
  await withWindowSnow(snow, async () => {
    const engine = resolveEngine(api);
    await engine.mount();
    while (engine.getSnapshot().git.loading) await tick();

    const dialog = {
      staged: ["staged:src/a.ts", "staged:src/b.ts"],
      unstaged: [],
      commits: [],
      note: "",
    };
    const built = await engine.buildReviewRequest(dialog);
    assert.equal(built.diffFailures, 2);
    assert.equal(built.currentCode, false);
    assert.match(built.prompt, /本次审查范围/);
    assert.match(built.prompt, /已暂存变更: M src\/a\.ts/);
    assert.match(built.prompt, /已暂存变更: M src\/b\.ts/);
    assert.equal((built.prompt.match(/```diff/g) || []).length, 0);
    assert.match(built.prompt, /差异读取失败/);

    await engine.startReview(dialog);
    assert.ok(state.writes.some((item) => item.action === "conversations.create"));
    engine.unmount();
  });
});

test("宿主返回结构化 error 与提交 diff 失败时同样降级", async () => {
  const gitStatus = {
    isRepo: true,
    currentBranch: "main",
    files: [
      { path: "src/a.ts", oldPath: null, indexStatus: "M", workdirStatus: " ", status: "M" },
    ],
  };
  const commits = [
    {
      hash: "abcdef1234567890",
      shortHash: "abcdef1",
      date: "2026-10-18 10:00",
      message: "fix: x",
      author: "Alice",
    },
  ];
  const { api } = createMockApi({ gitStatus });
  const snow = {
    async gitStatus() {
      return gitStatus;
    },
    async gitLog() {
      return commits;
    },
    async gitFileDiff() {
      return { content: "", isBinary: false, error: "fatal: bad object" };
    },
    async gitCommitDiff() {
      throw new Error("commit diff failed");
    },
  };
  await withWindowSnow(snow, async () => {
    const engine = resolveEngine(api);
    await engine.mount();
    while (engine.getSnapshot().git.loading) await tick();

    const built = await engine.buildReviewRequest({
      staged: ["staged:src/a.ts"],
      unstaged: [],
      commits: ["commit:abcdef1234567890"],
      note: "",
    });
    assert.equal(built.diffFailures, 2);
    assert.match(built.prompt, /fatal: bad object/);
    assert.match(built.prompt, /commit diff failed/);
    assert.match(built.prompt, /abcdef1/);
    assert.ok(!built.prompt.includes("```diff\n\n```"));
    engine.unmount();
  });
});

test("自动清理等待归档期间重新打开的 issue 不会被旧快照归档", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixed",
        fix: { conversationId: "conv-fix", result: "fixed", summary: "ok" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
        autoCleanup: true,
        cleanupAction: "archive",
      },
    },
    conversationLog: [{ conversationId: "conv-fix", kind: "fix", title: "修复", createdAt: 1 }],
  };
  const gate = createDeferred();
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
    ],
    writeGate: (action) => (action === "conversations.archive" ? gate : null),
  });
  const engine = resolveEngine(api);
  await engine.mount();
  const pending = engine.retryParse();
  while (!state.writes.some((item) => item.action === "conversations.archive")) await tick();

  const during = engine.getSnapshot().state;
  engine.store.set({
    state: {
      ...during,
      issues: during.issues.map((issue) =>
        issue.id === "i1"
          ? { ...issue, status: "open", regression: { count: 1, detectedAt: 2 } }
          : issue,
      ),
    },
    activity: {
      kind: "review",
      conversationId: "conv-review",
      startedAt: 2,
      phase: "waiting",
      message: "",
      error: "",
      issueIds: [],
    },
  });
  gate.resolve();
  await pending;

  const snapshot = engine.getSnapshot();
  const issue = snapshot.state.issues.find((item) => item.id === "i1");
  assert.equal(issue.status, "open");
  assert.equal(issue.regression.count, 1);
  assert.equal(issue.archivedFrom || null, null);
  assert.equal(snapshot.activity.conversationId, "conv-review");
  assert.equal(snapshot.state.sessions.fix, null);
  engine.unmount();
});

test("关闭 error 活动卡片会持久化，重开工作台后不再出现", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [{ id: "i1", severity: "一般", title: "A", location: "a.ts:1", status: "open" }],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "parse-failed",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  assert.equal(engine.getSnapshot().activity.phase, "error");

  await engine.dismissActivity();
  assert.equal(engine.getSnapshot().activity, null);
  assert.equal(state.values.get("fixbench:v2:a").sessions.fix.activityDismissed, true);

  await engine.reload();
  assert.equal(engine.getSnapshot().activity, null);
  assert.equal(engine.getSnapshot().state.sessions.fix.status, "error");
  assert.equal(engine.getSnapshot().state.sessions.fix.activityDismissed, true);

  await engine.startFix(["i1"]);
  assert.equal(state.createCalls, 1);
  engine.unmount();
});

test("关闭超时的修复卡片会释放会话锁定并可再次修复", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      { id: "i1", severity: "严重", title: "A", location: "a.ts:1", status: "open" },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: ["i2"],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-fix"],
      },
    },
    conversationLog: [{ conversationId: "conv-fix", kind: "fix", title: "修复", createdAt: 1 }],
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  assert.equal(engine.getSnapshot().activity.phase, "error");
  assert.equal(engine.getSnapshot().activity.timedOut, true);

  await engine.dismissActivity();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.activity, null);
  assert.equal(snapshot.state.sessions.fix.status, "dismissed");
  assert.deepEqual(snapshot.state.sessions.fix.issueIds, []);
  assert.deepEqual(snapshot.state.sessions.fix.queue, []);
  assert.deepEqual(snapshot.state.sessions.fix.allIssueIds, ["i1", "i2"]);
  assert.deepEqual(snapshot.state.sessions.fix.sessionIds, ["conv-fix"]);
  assert.equal(snapshot.state.sessions.fix.activityDismissed, true);

  const saved = state.values.get("fixbench:v2:a");
  assert.equal(saved.sessions.fix.status, "dismissed");
  assert.deepEqual(saved.sessions.fix.queue, []);

  // 当前批次与队列中的 issue 都不再被旧会话占用。
  engine.openFixDialog(["i2"]);
  assert.equal(engine.getSnapshot().dialog.type, "fix");
  await engine.startFix(["i1"]);
  assert.equal(state.createCalls, 1);
  assert.equal(
    engine.getSnapshot().state.issues.find((issue) => issue.id === "i1").status,
    "fixing",
  );
  engine.unmount();
});

test("关闭停止跟踪的修复卡片会释放修复中状态", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "detached",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: ["i2"],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();
  assert.equal(engine.getSnapshot().activity.phase, "detached");

  await engine.dismissActivity();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.activity, null);
  assert.equal(snapshot.state.issues.find((issue) => issue.id === "i1").status, "open");
  assert.equal(snapshot.state.issues.find((issue) => issue.id === "i1").fix, null);
  assert.equal(snapshot.state.sessions.fix.status, "dismissed");
  assert.deepEqual(snapshot.state.sessions.fix.queue, []);

  await engine.startFix(["i1"]);
  assert.equal(state.createCalls, 1);
  engine.unmount();
});

test("旧版本关闭超时卡片留下的锁定会在加载时释放", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [{ id: "i1", severity: "严重", title: "A", location: "a.ts:1", status: "open" }],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        activityDismissed: true,
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({ stored });
  const engine = resolveEngine(api);
  await engine.mount();

  assert.equal(engine.getSnapshot().activity, null);
  assert.equal(engine.getSnapshot().state.sessions.fix.status, "dismissed");
  assert.deepEqual(engine.getSnapshot().state.sessions.fix.issueIds, []);

  await engine.startFix(["i1"]);
  assert.equal(state.createCalls, 1);
  engine.unmount();
});

test("runtime 不可读时连续相同快照不会提前收尾", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [{ id: "i1", severity: "严重", title: "A", location: "a.ts:1", status: "open" }],
    sessions: { review: null, fix: null },
  };
  const { api } = createMockApi({
    stored,
    runtime: null,
    messages: [
      {
        role: "assistant",
        status: "completed",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.startFix(["i1"]);
  assert.equal(engine.getSnapshot().state.sessions.fix.status, "running");

  // 旧实现约 4 秒就会把两次相同快照判定为完成；新实现应继续等待更长的稳定窗口。
  await new Promise((resolve) => setTimeout(resolve, 8000));
  assert.equal(engine.getSnapshot().state.sessions.fix.status, "running");
  assert.notEqual(engine.getSnapshot().activity?.phase, "done");

  await waitFor(() => engine.getSnapshot().state.sessions.fix?.status === "done", 20000);
  assert.equal(engine.getSnapshot().state.issues.find((issue) => issue.id === "i1").status, "fixed");
  engine.unmount();
});

test("会话中止且没有助手正文时停止跟踪并释放修复中状态", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [{ id: "i1", severity: "一般", title: "A", location: "a.ts:1", status: "open" }],
    sessions: { review: null, fix: null },
  };
  const { api, state } = createMockApi({
    stored,
    conversationId: "conv-fix",
    runtime: {
      conversation: { conversationId: "conv-fix", isStreaming: false, pendingMessageCount: 0 },
      streamingSessions: [],
    },
    messages: [
      { role: "user", content: "fix this" },
      { role: "assistant", status: "cancelled", content: "" },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.startFix(["i1"]);
  await waitFor(() => engine.getSnapshot().activity?.phase === "error");

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.activity.error, "会话已中止，且没有产生任何回复；已停止跟踪并释放修复中状态。");
  assert.equal(snapshot.state.sessions.fix.lastError, "session-interrupted");
  assert.equal(snapshot.state.issues[0].status, "open");
  assert.equal(snapshot.state.issues[0].fix, null);
  assert.equal(state.values.get("fixbench:v2:a").sessions.fix.lastError, "session-interrupted");

  engine.openFixDialog(["i1"]);
  assert.equal(engine.getSnapshot().dialog.type, "fix");
  engine.unmount();
});

test("弹窗内动作失败时保留内联错误", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [{ id: "i1", severity: "一般", title: "A", location: "a.ts:1", status: "open" }],
    sessions: { review: null, fix: null },
  };
  const { api } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    writeFailures: { "conversations.create": "boom" },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  engine.openFixDialog(["i1"]);
  await engine.confirmDialog();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.dialog.type, "fix");
  assert.match(snapshot.dialog.error, /修复启动失败/);
  assert.match(snapshot.toast.text, /修复启动失败/);
  engine.unmount();
});

test("显式关闭时审查完成不会自动启动修复", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-review",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  state.messages = [
    {
      role: "assistant",
      content:
        '```snow-issues\n[{"severity":"一般","title":"新问题","location":"new.ts:1"}]\n```',
    },
  ];
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ autoFixAfterReview: false });
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues.length, 1);
  assert.equal(snapshot.state.issues[0].status, "open");
  assert.equal(snapshot.state.sessions.fix, null);
  assert.equal(state.createCalls, 0);
  engine.unmount();
});

test("审查结果按设置的纳入修复范围入库", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-review",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  state.messages = [
    {
      role: "assistant",
      content:
        "```snow-issues\n" +
        JSON.stringify([
          { severity: "严重", title: "崩溃", location: "src/a.ts:1" },
          { severity: "建议", title: "命名", location: "src/c.ts:3" },
        ]) +
        "\n```",
    },
  ];
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ issueSeverities: ["建议"] });
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.deepEqual(
    snapshot.state.issues.map((issue) => issue.severity),
    ["建议"],
  );
  engine.unmount();
});

test("自动修复只处理本次新增或重开的 issue", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      { id: "i-old", severity: "严重", title: "历史问题", location: "old.ts:1", status: "open" },
      {
        id: "i-fixed",
        severity: "一般",
        title: "回归问题",
        location: "reg.ts:1",
        status: "fixed",
        fix: { conversationId: "conv-old", result: "fixed", summary: "ok" },
      },
    ],
    sessions: {
      review: {
        conversationId: "conv-review",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  state.messages = [
    {
      role: "assistant",
      content:
        '```snow-issues\n' +
        JSON.stringify([
          { severity: "严重", title: "历史问题", location: "old.ts:1" },
          { severity: "一般", title: "回归问题", location: "reg.ts:1" },
          { severity: "一般", title: "新问题", location: "new.ts:1" },
        ]) +
        '\n```',
    },
  ];
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ autoFixAfterReview: true });
  await engine.retryParse();
  await waitFor(() => engine.getSnapshot().state.sessions.fix?.status === "running");

  const snapshot = engine.getSnapshot();
  const fixSession = snapshot.state.sessions.fix;
  assert.equal(fixSession.issueIds.length, 2);
  assert.ok(fixSession.issueIds.includes("i-fixed"));
  assert.ok(!fixSession.issueIds.includes("i-old"));
  assert.equal(snapshot.state.issues.find((issue) => issue.id === "i-old").status, "open");

  const created = state.writes.find((item) => item.action === "conversations.create");
  assert.ok(created);
  assert.ok(created.params.text.includes("新问题"));
  assert.ok(created.params.text.includes("回归问题"));
  assert.ok(!created.params.text.includes("历史问题"));
  engine.unmount();
});

test("续批创建失败时活动卡片切到 error 并保留剩余队列", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: ["i2"],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
    ],
    createResults: [{ ok: false, action: "conversations.create", error: "boom" }],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  // 手动重新解析不会续批，改用继续跟踪触发正常续批路径，验证创建失败的卡片状态。
  void engine.resumeActivityTracking();
  await waitFor(
    () =>
      engine.getSnapshot().state.sessions.fix.status === "error" &&
      engine.getSnapshot().state.sessions.fix.lastError === "batch-create-failed",
  );

  const snapshot = engine.getSnapshot();
  assert.equal(state.createCalls, 1);
  assert.equal(snapshot.state.sessions.fix.status, "error");
  assert.equal(snapshot.state.sessions.fix.lastError, "batch-create-failed");
  assert.deepEqual(snapshot.state.sessions.fix.queue, ["i2"]);
  assert.equal(snapshot.activity.phase, "error");
  assert.match(snapshot.activity.error, /boom/);
  const saved = state.values.get("fixbench:v2:a");
  assert.equal(saved.sessions.fix.status, "error");
  assert.deepEqual(saved.sessions.fix.queue, ["i2"]);

  await engine.reload();
  assert.equal(engine.getSnapshot().state.sessions.fix.status, "error");
  assert.equal(engine.getSnapshot().activity.phase, "error");
  engine.unmount();
});

test("续批返回缺少会话 ID 时写入 error 并保留可恢复卡片", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixing",
        fix: { conversationId: "conv-fix" },
      },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 2,
        batchSize: 1,
        queue: ["i2"],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-fix"],
      },
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
    ],
    createResults: [{ ok: true, data: {} }],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  // 手动重新解析不会续批，改用继续跟踪触发正常续批路径，验证缺少会话 ID 的处理。
  void engine.resumeActivityTracking();
  await waitFor(
    () =>
      engine.getSnapshot().state.sessions.fix.status === "error" &&
      engine.getSnapshot().state.sessions.fix.lastError === "batch-create-failed",
  );

  const snapshot = engine.getSnapshot();
  assert.equal(state.createCalls, 1);
  assert.equal(snapshot.state.sessions.fix.status, "error");
  assert.equal(snapshot.state.sessions.fix.lastError, "batch-create-failed");
  assert.deepEqual(snapshot.state.sessions.fix.queue, ["i2"]);
  assert.equal(snapshot.activity.phase, "error");
  assert.match(snapshot.activity.error, /returned no id/);

  await engine.reload();
  assert.equal(engine.getSnapshot().state.sessions.fix.status, "error");
  assert.equal(engine.getSnapshot().activity.phase, "error");
  engine.unmount();
});

test("提交记录命令并发调用结束后不会卡在加载中", async () => {
  const hash = "abcdef1234567890abcdef1234567890abcdef12";
  const stdout = `${hash}\u001f${hash.slice(0, 7)}\u001fAlice\u001f2026-10-18 10:00\u001ffix: x\n`;
  const gate = createDeferred();
  let commandCalls = 0;
  const { api } = createMockApi({
    gitStatus: { isRepo: true, currentBranch: "main", files: [] },
    commitStdout: stdout,
    writeGate: (action) => {
      if (action !== "mcpTools.call") return null;
      commandCalls += 1;
      return commandCalls === 1 ? gate : null;
    },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  while (engine.getSnapshot().git.loading) await tick();

  const first = engine.loadCommitsViaCommand({ silent: true });
  await waitFor(() => engine.getSnapshot().git.commandLoading);

  // 在途命令返回前再次调用：必须被 commandLoading 拦截，且不能推进命令序号。
  await engine.loadCommitsViaCommand({ silent: true });
  assert.equal(engine.getSnapshot().git.commandLoading, true);

  gate.resolve();
  await first;
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.git.commandLoading, false);
  assert.equal(snapshot.git.commandError, "");
  assert.equal(snapshot.git.commits.length, 1);
  assert.equal(snapshot.git.panelOpen, true);

  // 锁已恢复，后续命令仍可执行。
  await engine.loadCommitsViaCommand({ silent: true });
  assert.equal(engine.getSnapshot().git.commandLoading, false);
  assert.equal(engine.getSnapshot().git.commits.length, 1);
  engine.unmount();
});

test("沙箱档刷新审查弹窗保留已勾选的提交记录", async () => {
  const hash = "abcdef1234567890abcdef1234567890abcdef12";
  const stdout = `${hash}\u001f${hash.slice(0, 7)}\u001fAlice\u001f2026-10-18 10:00\u001ffix: x\n`;
  let commandCalls = 0;
  const gate = createDeferred();
  const { api } = createMockApi({
    gitStatus: { isRepo: true, currentBranch: "main", files: [] },
    commitStdout: stdout,
    writeGate: (action) => {
      if (action !== "mcpTools.call") return null;
      commandCalls += 1;
      return commandCalls === 2 ? gate : null;
    },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  while (engine.getSnapshot().git.loading) await tick();

  engine.openReviewDialog();
  await waitFor(() => engine.getSnapshot().git.panelOpen);
  const key = `commit:${hash}`;
  engine.updateDialog({ commits: [key] });
  assert.deepEqual(engine.getSnapshot().dialog.commits, [key]);

  // 刷新时提交列表会短暂置空：勾选必须保留，等命令返回后再裁剪。
  engine.refresh();
  await waitFor(() => engine.getSnapshot().git.commandLoading);
  assert.deepEqual(engine.getSnapshot().dialog.commits, [key]);

  gate.resolve();
  await waitFor(() => !engine.getSnapshot().git.commandLoading && engine.getSnapshot().git.panelOpen);
  const dialog = engine.getSnapshot().dialog;
  assert.deepEqual(dialog.commits, [key]);
  assert.deepEqual(
    engine.buildScopeSelection(dialog).commits.map((commit) => commit.hash),
    [hash],
  );
  engine.unmount();
});

test("保存窗口内停止跟踪后不会再启动轮询", async () => {
  const { api, state } = createMockApi({
    conversationId: "conv-race",
    runtime: { conversation: null, streamingSessions: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();

  const gate = createDeferred();
  const originalSetJson = api.storage.setJson.bind(api.storage);
  let held = false;
  api.storage.setJson = async (key, value) => {
    if (!held) {
      held = true;
      await gate.promise;
    }
    return originalSetJson(key, value);
  };
  state.messages = [
    {
      role: "assistant",
      content:
        '```snow-issues\n[{"severity":"一般","title":"新问题","location":"new.ts:1"}]\n```',
    },
  ];

  const pending = engine.startReview({ staged: [], unstaged: [], commits: [], note: "" });
  await waitFor(() => engine.getSnapshot().state.sessions.review?.status === "running");
  const detaching = engine.detachTracking();
  await tick();
  assert.equal(engine.getSnapshot().state.sessions.review.status, "detached");
  assert.equal(engine.getSnapshot().activity.phase, "detached");

  gate.resolve();
  await pending;
  await detaching;
  // 若 track 在保存窗口后仍启动，首个轮询会把卡片改回 waiting/streaming。
  await new Promise((resolve) => setTimeout(resolve, 2300));

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.sessions.review.status, "detached");
  assert.equal(snapshot.activity.phase, "detached");
  assert.equal(snapshot.state.issues.length, 0);
  engine.unmount();
});

test("重开后恢复运行中的复审会话跟踪", async () => {
  const stored = storedVerifyRun();
  stored.sessions.verify.status = "running";
  stored.sessions.verify.lastError = "";
  const { api } = createMockApi({
    stored,
    runtime: {
      conversation: { conversationId: "conv-verify", isStreaming: true, pendingMessageCount: 0 },
      streamingSessions: [{ conversationId: "conv-verify", isStreaming: true }],
    },
    messages: [{ role: "assistant", content: "正在复核…" }],
  });
  const engine = resolveEngine(api);
  await engine.mount();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.sessions.verify.status, "running");
  // 复审会话必须保留本轮修复的关联，刷新后自动清理才能恢复到正确目标。
  assert.equal(snapshot.state.sessions.verify.fixConversationId, "conv-fix");
  assert.deepEqual(snapshot.state.sessions.verify.fixSessionIds, ["conv-fix"]);
  assert.equal(snapshot.activity.kind, "verify");
  assert.equal(snapshot.activity.phase, "waiting");
  engine.unmount();
});

test("开启复审后修复完成会自动新建只读复审会话并回写结论", async () => {
  const { api, state } = createMockApi({
    stored: storedFixRun(),
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
      {
        role: "assistant",
        content: verifyResultText([
          { issueId: "i1", status: "confirmed", summary: "复核通过", evidence: "a.ts:1" },
        ]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ verifyAfterFix: true });
  await engine.retryParse();
  await waitFor(() => engine.getSnapshot().state.sessions.verify?.status === "done", 20000);

  const snapshot = engine.getSnapshot();
  assert.equal(state.createCalls, 1);
  const created = state.writes.find((item) => item.action === "conversations.create");
  assert.ok(created);
  assert.ok(created.params.text.includes("snow-verify-results"));
  assert.ok(created.params.text.includes("i1"));
  assert.equal(snapshot.state.sessions.verify.conversationId, "conv-1");
  assert.equal(snapshot.state.sessions.verify.fixConversationId, "conv-fix");
  assert.deepEqual(snapshot.state.sessions.verify.fixSessionIds, ["conv-fix"]);
  assert.deepEqual(snapshot.state.sessions.verify.fixIssueIds, ["i1"]);
  assert.deepEqual(snapshot.state.sessions.verify.issueIds, ["i1"]);
  assert.equal(snapshot.state.issues[0].status, "fixed");
  assert.equal(snapshot.state.issues[0].verify.status, "confirmed");
  assert.equal(snapshot.state.issues[0].verify.summary, "复核通过");
  assert.equal(snapshot.state.conversationLog.filter((entry) => entry.kind === "verify").length, 1);
  assert.equal(snapshot.activity.kind, "verify");
  assert.equal(snapshot.activity.phase, "done");
  engine.unmount();
});

test("关闭复审时修复完成不会创建复审会话", async () => {
  const { api, state } = createMockApi({
    stored: storedFixRun(),
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues[0].status, "fixed");
  assert.equal(snapshot.state.sessions.verify, null);
  assert.equal(state.createCalls, 0);
  engine.unmount();
});

test("复审仍存在时退回待修复并保留复审结论", async () => {
  const { api, state } = createMockApi({
    stored: storedVerifyRun(),
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: verifyResultText([
          { issueId: "i1", status: "still_present", summary: "仍然复现", evidence: "a.ts:1" },
        ]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues[0].status, "open");
  assert.equal(snapshot.state.issues[0].verify.status, "still_present");
  assert.equal(snapshot.state.issues[0].verify.summary, "仍然复现");
  assert.equal(snapshot.state.sessions.verify.status, "done");
  assert.equal(snapshot.activity.kind, "verify");
  assert.equal(snapshot.activity.phase, "done");
  assert.equal(state.createCalls, 0);
  engine.unmount();
});

test("复审结果无法解析时保留已修复状态并标记会话错误", async () => {
  const { api } = createMockApi({
    stored: storedVerifyRun(),
    runtime: { conversation: null, streamingSessions: [] },
    messages: [{ role: "assistant", content: "复审完成，但没有结构化输出。" }],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues[0].status, "fixed");
  assert.equal(snapshot.state.issues[0].verify, null);
  assert.equal(snapshot.state.sessions.verify.status, "error");
  assert.equal(snapshot.state.sessions.verify.lastError, "verify-parse-failed");
  assert.equal(snapshot.activity.phase, "error");
  assert.match(snapshot.toast.text, /未能从复审结果中解析出结论/);
  engine.unmount();
});

test("清理弹窗默认包含复审会话且待确认项不预选", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "待确认",
        location: "a.ts:1",
        status: "fixed",
        fix: { conversationId: "conv-fix", result: "fixed" },
        verify: { status: "uncertain", summary: "无法确认" },
      },
      {
        id: "i2",
        severity: "一般",
        title: "已确认",
        location: "b.ts:2",
        status: "fixed",
        fix: { conversationId: "conv-fix", result: "fixed" },
        verify: { status: "confirmed", summary: "通过" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "done",
        issueIds: ["i1", "i2"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-fix"],
      },
      verify: {
        conversationId: "conv-verify",
        startedAt: 2,
        status: "error",
        lastError: "verify-parse-failed",
        issueIds: ["i1", "i2"],
        fixConversationId: "conv-fix",
        fixSessionIds: ["conv-fix"],
        fixIssueIds: ["i1", "i2"],
      },
    },
    conversationLog: [
      { conversationId: "conv-fix", kind: "fix", title: "修复", createdAt: 1 },
      { conversationId: "conv-verify", kind: "verify", title: "复审", createdAt: 2 },
    ],
  };
  const { api } = createMockApi({ stored, runtime: { conversation: null, streamingSessions: [] } });
  const engine = resolveEngine(api);
  await engine.mount();
  engine.openCleanupDialog();

  const dialog = engine.getSnapshot().dialog;
  assert.deepEqual(dialog.issueIds, ["i2"]);
  assert.equal(dialog.sessions.fix, "archive");
  assert.equal(dialog.sessions.verify, "archive");
  engine.unmount();
});

test("复审启动失败时不会自动清理未复核的修复结果", async () => {
  const { api, state } = createMockApi({
    stored: storedFixRun({ autoCleanup: true }),
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
    ],
    createResults: [{ ok: false, action: "conversations.create", error: "boom" }],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ verifyAfterFix: true });
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues[0].status, "fixed");
  assert.equal(snapshot.state.sessions.verify, null);
  assert.equal(snapshot.state.sessions.fix.status, "done");
  assert.ok(!state.writes.some((item) => item.action === "conversations.archive"));
  assert.match(snapshot.toast.text, /复审启动失败/);
  engine.unmount();
});

test("已有复审运行时不再创建复审并提示本轮未自动清理", async () => {
  const { api, state } = createMockApi({
    stored: storedFixRun({ autoCleanup: true }),
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i1", status: "fixed", summary: "ok" }]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ verifyAfterFix: true });
  const before = engine.getSnapshot();
  engine.store.set({
    state: {
      ...before.state,
      sessions: {
        ...before.state.sessions,
        verify: {
          conversationId: "conv-verify-old",
          startedAt: 2,
          status: "running",
          issueIds: ["i1"],
          fixConversationId: "conv-fix",
          fixSessionIds: ["conv-fix"],
          autoCleanup: true,
        },
      },
    },
  });

  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(state.createCalls, 0);
  assert.equal(snapshot.state.sessions.verify.conversationId, "conv-verify-old");
  assert.equal(snapshot.state.sessions.verify.status, "running");
  assert.equal(snapshot.state.sessions.fix.status, "done");
  assert.match(snapshot.toast.text, /已有复审任务正在运行/);
  assert.ok(!state.writes.some((item) => item.action === "conversations.archive"));
  engine.unmount();
});

test("复审待确认的已修复 issue 可以手动重新复审", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "待确认",
        location: "a.ts:1",
        status: "fixed",
        fix: { conversationId: "conv-fix", result: "fixed" },
        verify: { status: "uncertain", summary: "无法确认" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "done",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
      verify: null,
    },
    conversationLog: [{ conversationId: "conv-fix", kind: "fix", title: "修复", createdAt: 1 }],
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  // 手动复审是显式用户动作，不受 verifyAfterFix 开关限制。
  assert.equal(engine.getSnapshot().settings.verifyAfterFix, false);
  await engine.retryVerify(["i1"]);

  const snapshot = engine.getSnapshot();
  assert.equal(state.createCalls, 1);
  assert.equal(snapshot.state.sessions.verify.status, "running");
  assert.deepEqual(snapshot.state.sessions.verify.issueIds, ["i1"]);
  assert.deepEqual(snapshot.state.sessions.verify.fixSessionIds, ["conv-fix"]);
  assert.equal(snapshot.state.sessions.verify.autoCleanup, false);
  assert.equal(snapshot.state.sessions.verify.fixConversationId, "");
  assert.equal(snapshot.activity.kind, "verify");
  assert.match(snapshot.toast.text, /已重新发起复审/);
  engine.unmount();
});

test("复审结论全部不匹配时不标记完成并保留重解析入口", async () => {
  const stored = storedVerifyRun();
  stored.sessions.verify.autoCleanup = true;
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: verifyResultText([{ issueId: "x9", status: "confirmed" }]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues[0].status, "fixed");
  assert.equal(snapshot.state.issues[0].verify, null);
  assert.equal(snapshot.state.sessions.verify.status, "error");
  assert.equal(snapshot.state.sessions.verify.lastError, "verify-parse-failed");
  assert.equal(snapshot.activity.phase, "error");
  assert.match(snapshot.toast.text, /未能从复审结果中解析出结论/);
  assert.ok(!state.writes.some((item) => item.action === "conversations.archive"));
  engine.unmount();
});

test("复审结果缺少合法状态时按解析失败处理", async () => {
  const { api } = createMockApi({
    stored: storedVerifyRun(),
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: verifyResultText([{ issueId: "i1" }]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues[0].status, "fixed");
  assert.equal(snapshot.state.issues[0].verify, null);
  assert.equal(snapshot.state.sessions.verify.status, "error");
  assert.equal(snapshot.state.sessions.verify.lastError, "verify-parse-failed");
  engine.unmount();
});

test("过期复审结论不会回退新一轮修复", async () => {
  const stored = storedVerifyRun();
  stored.sessions.verify.autoCleanup = true;
  stored.issues[0].fix = { conversationId: "conv-fix-2", result: "fixed", summary: "again" };
  stored.sessions.fix.conversationId = "conv-fix-2";
  stored.sessions.fix.sessionIds = ["conv-fix-2"];
  stored.sessions.verify.fixSessionIds = ["conv-fix"];
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: verifyResultText([{ issueId: "i1", status: "still_present", summary: "上一轮结论" }]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues[0].status, "fixed");
  assert.equal(snapshot.state.issues[0].verify, null);
  // 全部结论属于过期轮次：不能标记完成，也不能提示 0 条成功。
  assert.equal(snapshot.state.sessions.verify.status, "error");
  assert.equal(snapshot.state.sessions.verify.lastError, "verify-expired");
  assert.equal(snapshot.activity.phase, "error");
  assert.match(snapshot.toast.text, /复审结果已过期/);
  assert.doesNotMatch(snapshot.toast.text, /复审完成：0 条/);
  // 过期复审不触发本轮自动清理。
  assert.ok(
    !state.writes.some(
      (item) => item.action === "conversations.archive" || item.action === "conversations.remove",
    ),
  );
  engine.unmount();
});

test("startReview 冻结本次审查使用的严重度范围", async () => {
  const { api, state } = createMockApi({
    gitStatus: { isRepo: true, currentBranch: "main", files: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  while (engine.getSnapshot().git.loading) await tick();
  await engine.setSettings({ issueSeverities: ["建议"] });
  await engine.startReview({ staged: [], unstaged: [], commits: [], note: "" });

  const snapshot = engine.getSnapshot();
  assert.deepEqual(snapshot.state.sessions.review.issueSeverities, ["建议"]);
  const persisted = state.values.get("fixbench:v2:a");
  assert.deepEqual(persisted.sessions.review.issueSeverities, ["建议"]);
  engine.unmount();
});

test("审查运行中缩小范围后仍按开始时的范围解析", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-review",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
        issueSeverities: ["严重", "一般"],
      },
      fix: null,
    },
  };
  const { api } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content:
          '```snow-issues\n[{"severity":"严重","title":"崩溃","location":"a.ts:1"},' +
          '{"severity":"一般","title":"空指针","location":"b.ts:2"}]\n```',
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  // 运行期间把范围缩小到「建议」：本次结论仍应按开始时的快照入库。
  await engine.setSettings({ issueSeverities: ["建议"] });
  await engine.retryParse();

  const snapshot = engine.getSnapshot();
  assert.deepEqual(snapshot.state.issues.map((issue) => issue.severity).sort(), ["一般", "严重"]);
  assert.equal(snapshot.state.sessions.review.status, "done");
  assert.doesNotMatch(snapshot.toast.text, /均不在/);
  engine.unmount();
});

test("设置读取失败时会话内关闭自动修复后不再弹确认框", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [],
    sessions: {
      review: {
        conversationId: "conv-review",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: [],
      },
      fix: null,
    },
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  const originalGetJson = api.storage.getJson;
  api.storage.getJson = async (key) => {
    if (key === "fixbench:v2:settings") throw new Error("settings unavailable");
    return originalGetJson(key);
  };
  state.messages = [
    {
      role: "assistant",
      content:
        '```snow-issues\n[{"severity":"一般","title":"新问题","location":"new.ts:1"}]\n```',
    },
  ];

  const engine = resolveEngine(api);
  await engine.mount();
  assert.equal(engine.getSnapshot().settingsLoadFailed, true);

  engine.openSettingsDialog();
  engine.updateDialog({ autoFixAfterReview: false });
  await engine.confirmDialog();
  let snapshot = engine.getSnapshot();
  assert.equal(snapshot.settings.autoFixAfterReview, false);
  assert.equal(snapshot.settingsLoadFailed, true);
  assert.match(snapshot.dialog.error, /当前会话/);
  engine.closeDialog();

  await engine.retryParse();
  snapshot = engine.getSnapshot();
  assert.equal(snapshot.state.issues.length, 1);
  assert.equal(snapshot.state.sessions.fix, null);
  assert.equal(snapshot.dialog, null);
  assert.equal(snapshot.pendingAutoFix, null);
  assert.equal(state.createCalls, 0);
  engine.unmount();
});

test("自动复审跳过已确认的 issue，遗漏结论不会降级 confirmed", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixed",
        fix: { conversationId: "conv-fix-1", result: "fixed", summary: "ok" },
        verify: {
          status: "confirmed",
          summary: "人工复核通过",
          evidence: "a.ts:1",
          conversationId: "conv-manual",
          at: 2,
        },
      },
      {
        id: "i2",
        severity: "一般",
        title: "B",
        location: "b.ts:2",
        status: "fixing",
        fix: { conversationId: "conv-fix-2" },
      },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix-2",
        startedAt: 1,
        status: "error",
        lastError: "timeout",
        issueIds: ["i2"],
        batchNumber: 2,
        batchTotal: 2,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1", "i2"],
        sessionIds: ["conv-fix-1", "conv-fix-2"],
        autoCleanup: false,
        cleanupAction: "archive",
      },
      verify: null,
    },
    conversationLog: [
      { conversationId: "conv-fix-1", kind: "fix", title: "修复1", createdAt: 1 },
      { conversationId: "conv-fix-2", kind: "fix", title: "修复2", createdAt: 2 },
    ],
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: fixResultText([{ issueId: "i2", status: "fixed", summary: "ok" }]),
      },
      {
        role: "assistant",
        content: verifyResultText([
          { issueId: "i2", status: "confirmed", summary: "复核通过", evidence: "b.ts:2" },
        ]),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ verifyAfterFix: true });
  await engine.retryParse();
  await waitFor(() => engine.getSnapshot().state.sessions.verify?.status === "done", 20000);

  const snapshot = engine.getSnapshot();
  assert.equal(state.createCalls, 1);
  const created = state.writes.find((item) => item.action === "conversations.create");
  assert.ok(created.params.text.includes('"issueId": "i2"'));
  assert.ok(!created.params.text.includes('"issueId": "i1"'));
  assert.deepEqual(snapshot.state.sessions.verify.issueIds, ["i2"]);
  const first = snapshot.state.issues.find((issue) => issue.id === "i1");
  assert.equal(first.verify.status, "confirmed");
  assert.equal(first.verify.summary, "人工复核通过");
  assert.equal(first.verify.conversationId, "conv-manual");
  engine.unmount();
});

test("修复运行中启动复审会被拒绝并提示", async () => {
  const stored = storedVerifyRun();
  stored.sessions.verify.status = "done";
  stored.sessions.verify.lastError = "";
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  const before = engine.getSnapshot();
  engine.store.set({
    state: {
      ...before.state,
      sessions: {
        ...before.state.sessions,
        fix: {
          conversationId: "conv-fix-running",
          startedAt: 1,
          status: "running",
          issueIds: ["i1"],
          batchNumber: 1,
          batchTotal: 1,
          batchSize: 1,
          queue: [],
          allIssueIds: ["i1"],
          sessionIds: ["conv-fix-running"],
        },
      },
    },
  });

  await engine.retryVerify(["i1"]);

  const snapshot = engine.getSnapshot();
  assert.equal(state.createCalls, 0);
  assert.equal(snapshot.state.sessions.verify.status, "done");
  assert.match(snapshot.toast.text, /修复会话仍在运行/);
  engine.unmount();
});

test("复审运行中启动修复会被拒绝并提示", async () => {
  const stored = {
    version: 2,
    projectId: "a",
    issues: [
      {
        id: "i1",
        severity: "严重",
        title: "A",
        location: "a.ts:1",
        status: "fixed",
        fix: { conversationId: "conv-fix", result: "fixed" },
        verify: { status: "uncertain", summary: "待确认" },
      },
      { id: "i2", severity: "一般", title: "B", location: "b.ts:2", status: "open" },
    ],
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "done",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: ["i1"],
        sessionIds: ["conv-fix"],
      },
      verify: null,
    },
    conversationLog: [{ conversationId: "conv-fix", kind: "fix", title: "修复", createdAt: 1 }],
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
  });
  const engine = resolveEngine(api);
  await engine.mount();
  const before = engine.getSnapshot();
  engine.store.set({
    state: {
      ...before.state,
      sessions: {
        ...before.state.sessions,
        verify: {
          conversationId: "conv-verify-running",
          startedAt: 2,
          status: "running",
          issueIds: ["i1"],
          fixSessionIds: ["conv-fix"],
          fixIssueIds: ["i1"],
        },
      },
    },
  });

  await engine.startFix(["i2"]);

  const snapshot = engine.getSnapshot();
  assert.equal(state.createCalls, 0);
  assert.equal(snapshot.state.sessions.fix.status, "done");
  assert.equal(snapshot.state.issues.find((issue) => issue.id === "i2").status, "open");
  assert.match(snapshot.toast.text, /复审会话仍在运行/);
  engine.unmount();
});

test("复审批次超过上限时自动拆分并在全部完成后收尾", async () => {
  const total = 21;
  const issues = Array.from({ length: total }, (_, index) => ({
    id: `i${index + 1}`,
    severity: "一般",
    title: `问题 ${index + 1}`,
    location: `src/f${index + 1}.ts:1`,
    status: "fixed",
    fix: {
      conversationId: "conv-fix",
      result: "fixed",
      summary: "ok",
      files: [`src/f${index + 1}.ts`],
      verification: "npm test",
    },
  }));
  const stored = {
    version: 2,
    projectId: "a",
    issues,
    sessions: {
      review: null,
      fix: {
        conversationId: "conv-fix",
        startedAt: 1,
        status: "done",
        issueIds: ["i1"],
        batchNumber: 1,
        batchTotal: 1,
        batchSize: 1,
        queue: [],
        allIssueIds: issues.map((issue) => issue.id),
        sessionIds: ["conv-fix"],
      },
      verify: null,
    },
    conversationLog: [{ conversationId: "conv-fix", kind: "fix", title: "修复", createdAt: 1 }],
  };
  const { api, state } = createMockApi({
    stored,
    runtime: { conversation: null, streamingSessions: [] },
    messages: [
      {
        role: "assistant",
        content: verifyResultText(
          issues.map((issue) => ({
            issueId: issue.id,
            status: "confirmed",
            summary: "ok",
            evidence: "src/x.ts:1",
          })),
        ),
      },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.retryVerify(issues.map((issue) => issue.id));
  await waitFor(
    () => engine.getSnapshot().state.sessions.verify?.status === "done",
    30000,
  );

  const snapshot = engine.getSnapshot();
  assert.equal(state.createCalls, 2);
  const creates = state.writes.filter((item) => item.action === "conversations.create");
  assert.match(creates[0].params.title, /第 1\/2 批/);
  assert.match(creates[1].params.title, /第 2\/2 批/);
  const firstRows = JSON.parse(creates[0].params.text.split("```json")[1].split("```")[0]);
  const secondRows = JSON.parse(creates[1].params.text.split("```json")[1].split("```")[0]);
  assert.equal(firstRows.length, 20);
  assert.equal(secondRows.length, 1);
  assert.equal(snapshot.state.sessions.verify.batchNumber, 2);
  assert.equal(snapshot.state.sessions.verify.batchTotal, 2);
  assert.deepEqual(snapshot.state.sessions.verify.queue, []);
  assert.equal(snapshot.state.sessions.verify.confirmedCount, total);
  assert.equal(snapshot.state.sessions.verify.sessionIds.length, 2);
  assert.equal(snapshot.state.issues.filter((issue) => issue.verify?.status === "confirmed").length, total);
  assert.equal(snapshot.state.conversationLog.filter((entry) => entry.kind === "verify").length, 2);
  assert.equal(snapshot.activity.phase, "done");
  engine.unmount();
});

// —— API 档案失效回退与失效缓存 ——

test("档案失效时创建会话回退为空档案并清空设置", async () => {
  const { api, state } = createMockApi({
    createResults: [{ ok: false, action: "conversations.create", error: "Unknown API profile: pro" }],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ apiProfile: "pro" });

  await engine.startReview({ staged: [], unstaged: [], commits: [], note: "" });

  const creates = state.writes.filter((item) => item.action === "conversations.create");
  assert.equal(creates.length, 2);
  assert.equal(creates[0].params.apiProfile, "pro");
  assert.equal(creates[1].params.apiProfile, "");
  // 回退成功后设置被清空，避免后续会话每次都先失败一次再重试。
  assert.equal(engine.getSnapshot().settings.apiProfile, "");
  assert.match(engine.getSnapshot().toast.text, /档案「pro」不可用/);
  assert.ok(!engine.getSnapshot().toast.text.includes("设置未能保存"));
  engine.unmount();
});

test("档案失效且回退创建也失败时不清理设置", async () => {
  const { api, state } = createMockApi({
    createResults: [
      { ok: false, action: "conversations.create", error: "Unknown API profile: pro" },
      { ok: false, action: "conversations.create", error: "Unknown API profile: pro" },
    ],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ apiProfile: "pro" });

  await assert.rejects(
    () => engine.startReview({ staged: [], unstaged: [], commits: [], note: "" }),
    /审查启动失败/,
  );
  assert.equal(state.createCalls, 2);
  assert.equal(engine.getSnapshot().settings.apiProfile, "pro");
  engine.unmount();
});

test("非档案类创建错误不触发回退", async () => {
  const { api, state } = createMockApi({
    createResults: [{ ok: false, action: "conversations.create", error: "boom" }],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ apiProfile: "pro" });

  await assert.rejects(
    () => engine.startReview({ staged: [], unstaged: [], commits: [], note: "" }),
    /审查启动失败/,
  );
  // 只尝试一次带绑定创建，不进行空档案回退。
  assert.equal(state.createCalls, 1);
  assert.equal(engine.getSnapshot().settings.apiProfile, "pro");
  engine.unmount();
});

test("清空设置写盘失败时记录失效缓存，后续创建命中缓存跳过绑定", async () => {
  const { api, state } = createMockApi({
    createResults: [{ ok: false, action: "conversations.create", error: "Unknown API profile: pro" }],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ apiProfile: "pro" });

  // 回退成功后清空设置写盘失败：设置回滚保留失效档案名，缓存记录该档案。
  const originalSetJson = api.storage.setJson.bind(api.storage);
  api.storage.setJson = async (key, value) => {
    if (key === "fixbench:v2:settings") throw new Error("disk full");
    return originalSetJson(key, value);
  };
  await engine.startReview({ staged: [], unstaged: [], commits: [], note: "" });
  assert.equal(engine.getSnapshot().settings.apiProfile, "pro");
  assert.match(engine.getSnapshot().toast.text, /设置未能保存/);

  // 恢复写盘并结束第一次审查的跟踪，允许再次创建会话。
  api.storage.setJson = originalSetJson;
  await engine.detachTracking();
  const before = state.createCalls;
  await engine.startReview({ staged: [], unstaged: [], commits: [], note: "" });
  const creates = state.writes.filter((item) => item.action === "conversations.create");
  assert.equal(state.createCalls - before, 1);
  assert.equal(creates[creates.length - 1].params.apiProfile, "");
  engine.unmount();
});

test("用户在等待期间改选档案时不再重复清理新选择", async () => {
  const gate = createDeferred();
  const { api, state } = createMockApi({
    createResults: [{ ok: false, action: "conversations.create", error: "Unknown API profile: pro" }],
    writeGate: (action, params) =>
      action === "conversations.create" && params.apiProfile === "" ? gate : null,
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ apiProfile: "pro" });

  const pending = engine
    .startReview({ staged: [], unstaged: [], commits: [], note: "" })
    .catch((error) => error);
  // writeGate 在 createCalls 自增之前挂起，用已入队的创建调用数判断回退创建已挂起。
  await waitFor(
    () => state.writes.filter((item) => item.action === "conversations.create").length >= 2,
  );
  // 回退创建挂起期间用户改选其它档案。
  await engine.setSettings({ apiProfile: "other" });
  gate.resolve();
  await pending;

  // 新选择不能被回退逻辑清空。
  assert.equal(engine.getSnapshot().settings.apiProfile, "other");
  assert.ok(!engine.getSnapshot().toast.text.includes("设置未能保存"));
  engine.unmount();
});

test("设置弹窗保存后失效缓存被清除，重新绑定同名档案生效", async () => {
  const { api, state } = createMockApi({
    createResults: [{ ok: false, action: "conversations.create", error: "Unknown API profile: pro" }],
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ apiProfile: "pro" });

  // 清空设置写盘失败 → 缓存记录失效档案 pro（设置残留失效名）。
  const originalSetJson = api.storage.setJson.bind(api.storage);
  api.storage.setJson = async (key, value) => {
    if (key === "fixbench:v2:settings") throw new Error("disk full");
    return originalSetJson(key, value);
  };
  await engine.startReview({ staged: [], unstaged: [], commits: [], note: "" });
  assert.equal(engine.getSnapshot().settings.apiProfile, "pro");

  // 恢复写盘：用户重建同名档案后，打开设置弹窗重新选中 pro 并保存。
  // 弹窗选择与基线相同，不生成 patch，但保存动作必须清除失效缓存。
  api.storage.setJson = originalSetJson;
  engine.openSettingsDialog();
  assert.equal(engine.getSnapshot().dialog.apiProfile, "pro");
  await engine.confirmDialog();
  assert.equal(engine.getSnapshot().dialog, null);

  // 结束第一次审查的跟踪，允许再次创建会话验证缓存已清除。
  await engine.detachTracking();
  await engine.startReview({ staged: [], unstaged: [], commits: [], note: "" });
  const creates = state.writes.filter((item) => item.action === "conversations.create");
  assert.equal(creates.length, 3);
  assert.equal(creates[2].params.apiProfile, "pro");
  engine.unmount();
});

test("档案失效回退成功时同步清空设置弹窗中的失效选择", async () => {
  const gate = createDeferred();
  const { api, state } = createMockApi({
    createResults: [{ ok: false, action: "conversations.create", error: "Unknown API profile: pro" }],
    writeGate: (action) => (action === "conversations.activate" ? gate : null),
  });
  const engine = resolveEngine(api);
  await engine.mount();
  await engine.setSettings({ apiProfile: "pro" });
  engine.openSettingsDialog();
  assert.equal(engine.getSnapshot().dialog.apiProfile, "pro");

  // 创建会话期间回退清空设置：弹窗中的失效选择必须同步清空，避免保存时写回。
  const pending = engine
    .startReview({ staged: [], unstaged: [], commits: [], note: "" })
    .catch((error) => error);
  await waitFor(() => engine.getSnapshot().dialog?.apiProfile === "");
  const dialog = engine.getSnapshot().dialog;
  assert.equal(dialog.baseline.apiProfile, "");
  gate.resolve();
  await pending;
  engine.unmount();
});
