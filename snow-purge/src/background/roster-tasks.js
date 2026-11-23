// 编队任务：把一条具体任务派给某个红队角色。
// 做法是新建一个主会话并把任务文本作为首条用户消息投递（autoReply 触发一个回合），
// 由主代理按 subAgents 选择规则把任务交给对应角色子代理；插件不直接启动子代理，也不替用户批准工具。
import { PRIOR_MAX, buildTaskPrompt, findRosterRole } from "../shared/redteam-roster.js";
import { ROSTER_BATCH_MAX } from "../shared/contract.js";
import { TURN_TIMEOUT_MINUTES, TURN_TIMEOUT_MS, readSessionOutcome } from "../shared/roster-session.js";
import { PurgeError } from "./errors.js";
import { createIndexFile } from "./index-file.js";

const MAX_TASKS = 40;
/** 任务记录的归档上限：被上限挤出的记录先归档，不再直接丢弃。 */
const ARCHIVE_MAX = 200;
/** 当前项目的短 TTL：面板每 8 秒轮询一次，保持会话状态灵敏。 */
const LIVE_TTL_MS = 5000;
/** 历史项目的长 TTL：列表不必为每个历史项目每轮各发起两次跨进程读取。 */
const HISTORY_TTL_MS = 60000;
const ID_PATTERN = /^task-[a-z0-9]{6,24}$/;
const TARGET_MAX = 200;
const TEMPLATE_MAX = 300;
const NOTE_MAX = 600;

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const stamp = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const clean = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

const newTaskId = () =>
  `task-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase();

export function createRosterTaskManager({ indexFile, write, metadata, log = () => {} }) {
  const callWrite = async (action, params) => {
    const result = await write.run(action, params);
    if (result?.ok) return result.data;
    const reason = result?.denied?.reason
      ? `（${result.denied.reason}${result.denied.scope ? `: ${result.denied.scope}` : ""}）`
      : "";
    throw new PurgeError("WRITE_FAILED", `${action} 失败：${result?.error || "未知原因"}${reason}`);
  };

  /**
   * 索引文件：写入走「临时文件 + rename」，解析失败与结构不符一律报错并保留原文件。
   * 把解析失败当成空表，下一次派发就会用空表覆盖掉全部任务记录。
   */
  const indexStore = createIndexFile({
    filePath: indexFile,
    label: "任务索引",
    empty: () => ({ version: 1, tasks: [] }),
    normalize: (parsed) => {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      if (parsed.tasks !== undefined && !Array.isArray(parsed.tasks)) return null;
      const tasks = Array.isArray(parsed.tasks)
        ? parsed.tasks.filter((item) => item && typeof item === "object")
        : [];
      return { version: 1, tasks };
    },
    log,
  });

  const readIndex = indexStore.read;
  const writeIndex = indexStore.write;

  /**
   * 归档文件与任务索引同目录：记录里的 id 与 conversationId 都保留，
   * 撤回、打开会话与项目回填仍可追溯被上限挤出的旧记录。
   */
  const archivePath = /\.json$/i.test(indexFile)
    ? indexFile.replace(/\.json$/i, "-archive.json")
    : `${indexFile}-archive.json`;
  const archiveStore = createIndexFile({
    filePath: archivePath,
    label: "任务归档",
    empty: () => ({ version: 1, tasks: [] }),
    normalize: (parsed) => {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      if (parsed.tasks !== undefined && !Array.isArray(parsed.tasks)) return null;
      const tasks = Array.isArray(parsed.tasks)
        ? parsed.tasks.filter((item) => item && typeof item === "object")
        : [];
      return { version: 1, tasks };
    },
    log,
  });
  const readArchive = archiveStore.read;
  const writeArchive = archiveStore.write;

  /**
   * 索引读写的串行队列：面板每 8 秒轮询一次，与派发/删除并发时，
   * 读到的旧快照会把刚写入的任务整表覆盖掉（记录连同 conversationId 一起丢失）。
   * 锁内只做本地文件读写与内存合并，跨进程调用一律留在锁外。
   */
  let indexQueue = Promise.resolve();
  const withIndexLock = (run) => {
    const next = indexQueue.then(() => run());
    indexQueue = next.then(
      () => {},
      () => {}
    );
    return next;
  };

  /**
   * 读会话与运行态：任务状态按统一会话判定推断（是否在跑 + 消息数 + 最近一次回复）。
   * 宿主没有给插件按主会话查询运行终态的接口，这里不编造完成百分比。
   * conversations 域按项目过滤：必须带上任务派发时记录的项目，否则用户切到别的项目后
   * 读回的是另一个项目的列表，所有历史任务都会被判成「会话已不在」。
   */
  const readLive = async (directoryId = "") => {
    const convOptions = directoryId ? { params: { directoryId } } : undefined;
    const [convResult, runtimeResult] = await Promise.allSettled([
      metadata.get("conversations", convOptions),
      metadata.get("runtime"),
    ]);
    const conv = convResult.status === "fulfilled" ? convResult.value?.domains?.conversations || null : null;
    const runtime = runtimeResult.status === "fulfilled" ? runtimeResult.value?.domains?.runtime || null : null;
    if (convResult.status === "rejected") {
      log(`读取会话列表失败：${convResult.reason?.message || convResult.reason}`);
    }
    const denied = convResult.status === "fulfilled" ? convResult.value?.denied?.conversations || null : null;
    const items = Array.isArray(conv?.items) ? conv.items : null;
    // 读取失败、权限被拒、没有活动项目都会给不出列表：这几种情况不能当作「会话已不在」。
    const available = Array.isArray(items);
    if (!available) log(`会话列表不可用：${denied?.reason || "宿主未返回 items"}`);
    const byId = new Map();
    if (items) {
      for (const item of items) {
        const key = typeof item?.conversationId === "string" ? item.conversationId : "";
        if (key) byId.set(key, item);
      }
    }
    const streaming = new Map();
    if (Array.isArray(runtime?.streamingSessions)) {
      for (const item of runtime.streamingSessions) {
        const key = typeof item?.conversationId === "string" ? item.conversationId : "";
        if (key) streaming.set(key, item);
      }
    }
    const activeDirectoryId =
      typeof runtime?.activeDirectory?.directoryId === "string" ? runtime.activeDirectory.directoryId : "";
    const runtimeAvailable = runtimeResult.status === "fulfilled" && Boolean(runtime);
    const attention = new Set();
    if (Array.isArray(runtime?.conversation?.attentionRequiredConversationIds)) {
      for (const id of runtime.conversation.attentionRequiredConversationIds) {
        if (typeof id === "string" && id) attention.add(id);
      }
    }
    return {
      available,
      runtimeAvailable,
      byId,
      streaming,
      attention,
      activeDirectoryId,
      directoryId:
        (typeof conv?.directoryId === "string" && conv.directoryId) || directoryId || activeDirectoryId,
      denied,
    };
  };

  const liveCache = new Map();
  /**
   * 当前项目用短 TTL，历史项目用长 TTL：项目越多，逐个项目读会话的开销越集中在
   * 用户正在看的项目上，其它项目只按较慢的节奏刷新标题与消息数。
   */
  const readLiveCached = async (directoryId = "", ttlMs = LIVE_TTL_MS) => {
    const key = directoryId || "";
    const hit = liveCache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.live;
    const live = await readLive(key);
    liveCache.set(key, { at: Date.now(), live });
    return live;
  };

  const refresh = (task, live) => {
    const conversationId = typeof task.conversationId === "string" ? task.conversationId : "";
    const record = conversationId ? live.byId.get(conversationId) || null : null;
    const runningSession = conversationId ? live.streaming.get(conversationId) || null : null;
    const directoryKnown = typeof task.directoryId === "string" && task.directoryId !== "";
    let status = "queued";
    // 会话列表读不到时沿用上一次写下的原因：状态本身也回落到磁盘记录。
    let statusReason = typeof task.statusReason === "string" ? task.statusReason : "";
    if (runningSession) {
      status = "running";
      statusReason = "";
    } else if (!live.available) {
      status = task.status || "queued";
    } else if (!record && conversationId) {
      // 刚派发的会话可能还没出现在宿主列表快照里；没记录项目的旧任务也无从判断它是否还在，
      // 这两种情况都不能报「会话已不在」。
      status = directoryKnown && Date.now() - num(task.createdAt) >= 15000 ? "missing" : "queued";
      if (status === "missing") statusReason = "会话已不在会话列表里，可能是会话被删除或归档";
    }
    else if (record) {
      // 读不到运行态时不能把已落库的回复当成完成：等待授权或回答期间同样有消息与预览。
      if (live.runtimeAvailable === false) {
        status = task.status || "queued";
        statusReason = "读不到运行态，无法确认这一回合是否已结束";
      } else {
        // 与链路、活动卡共用同一判定：只有用户消息的会话不算完成；等待授权或回答同样不算完成。
        const waiting = live.attention?.has(conversationId) === true;
        const outcome = readSessionOutcome(record, { waiting });
        if (outcome.status === "failed") status = "failed";
        else if (outcome.status === "cancelled") status = "cancelled";
        else if (outcome.status === "completed") status = "completed";
        else if (outcome.waiting) {
          // 宿主公开了等待输入时如实提示：这不是失败，但也不会自己继续。
          status = "queued";
          statusReason = "会话在等待你的确认或回答，处理后会继续";
        } else {
          // 回合失败或被中断时消息数已经到位，但最近一次回复为空；没有完成事件，
          // 只能靠最近活动时间兜底，否则任务会永久停在排队中。
          const lastActivityAt = Math.max(num(task.createdAt), stamp(record.updatedAt));
          const stalled = Date.now() - lastActivityAt > TURN_TIMEOUT_MS;
          if (stalled && (outcome.emptyReply || outcome.messages < 2)) {
            status = "failed";
            statusReason = outcome.emptyReply
              ? `已有 ${outcome.messages} 条消息但最近一次回复为空，超过 ${TURN_TIMEOUT_MINUTES} 分钟没有进展，可能是回合失败、被中断，或仍在等待确认`
              : `派发后超过 ${TURN_TIMEOUT_MINUTES} 分钟没有产生回复，可能是回合失败、被中断，或仍在等待确认`;
          } else {
            status = "queued";
            statusReason = "";
          }
        }
      }
    }

    return {
      ...task,
      status,
      statusReason,
      title: typeof record?.title === "string" && record.title ? record.title : task.title,
      messageCount: num(record?.messageCount),
      tokens: num(record?.inputTokens) + num(record?.outputTokens),
      durationMs: num(record?.totalDurationMs),
      elapsedMs: runningSession ? num(runningSession.elapsedMs) : num(record?.lastRunDurationMs),
      preview: clean(record?.lastMessagePreview || record?.summary, 160),
      updatedAt: stamp(record?.updatedAt),
      checkedAt: Date.now(),
    };
  };

  const MAX_BATCH = ROSTER_BATCH_MAX;

  /**
   * 一个角色有多个任务模板，允许一次勾选多条。
   * 默认合并成一个会话按序执行：同一角色的模板是流水线，后一项要复用前一项的产出。
   * mode 为 split 时每条任务单独建会话（不同靶标、或想单独重跑某条时用）。
   * 某一条失败不影响其它条，失败原因随结果返回。
   */
  const dispatch = async ({ roleId, target, templates, template, note, prior, mode }) => {
    const role = findRosterRole(typeof roleId === "string" ? roleId.trim() : "");
    if (!role) throw new PurgeError("INVALID_PARAM", "请选择一个有效的编队角色");
    const targetText = clean(target, TARGET_MAX);
    if (!targetText) throw new PurgeError("INVALID_PARAM", "请填写靶标（域名、IP 或网段）");
    const noteText = clean(note, NOTE_MAX);

    const incoming = Array.isArray(templates) ? templates : [];
    const requested = incoming
      .map((item) => clean(item, TEMPLATE_MAX))
      .filter(Boolean)
      .filter((item, index, list) => list.indexOf(item) === index);
    const picked = requested.slice(0, MAX_BATCH);
    // 超出上限不静默吞掉：数量随结果返回，面板据此提示用户。
    const truncatedTemplates = Math.max(0, requested.length - picked.length);
    if (truncatedTemplates > 0) {
      log(`单次派发最多 ${MAX_BATCH} 条任务，已忽略 ${truncatedTemplates} 条`);
    }
    // 兼容单条调用：没传数组时按一条处理，空任务回落到角色职责描述。
    if (picked.length === 0) picked.push(clean(template, TEMPLATE_MAX) || role.description);

    // 上一环节的模型输出按不可信数据处理：独立预算，不占操作者填写的补充说明。
    const priorText =
      prior && typeof prior === "object"
        ? {
            roleName: clean(prior.roleName, 40),
            summary: clean(prior.summary, PRIOR_MAX),
            skipped: prior.skipped === true,
          }
        : null;

    // 先确认索引可读：文件损坏时在建会话之前失败，不会出现「会话已建、记录写不进」的中间态。
    await readIndex();

    const live = await readLive();
    const directoryId = live.directoryId || live.activeDirectoryId;
    if (!directoryId) {
      throw new PurgeError("NO_PROJECT", "当前没有打开的项目：先在 Snow App 里打开一个项目再派发任务");
    }

    const batches = mode === "split" ? picked.map((item) => [item]) : [picked];
    const created = [];
    const failed = [];
    for (const group of batches) {
      const { title, text } = buildTaskPrompt({
        role,
        target: targetText,
        template: group[0],
        templates: group,
        note: noteText,
        prior: priorText,
      });
      try {
        const result = await callWrite("conversations.create", {
          directoryId,
          title: title.slice(0, 80),
          text,
          autoReply: true,
        });
        const conversationId = typeof result?.conversationId === "string" ? result.conversationId : "";
        if (!conversationId) throw new PurgeError("WRITE_FAILED", "会话已请求创建，但宿主没有返回会话 id");
        created.push({
          id: newTaskId(),
          roleId: role.id,
          roleName: role.name,
          target: targetText,
          template: group[0],
          tasks: group.length > 1 ? group : undefined,
          note: noteText,
          title: title.slice(0, 80),
          conversationId,
          directoryId,
          apiProfile: typeof result?.apiProfile === "string" ? result.apiProfile : "",
          createdAt: Date.now(),
          status: "running",
          statusReason: "",
          checkedAt: 0,
        });
      } catch (error) {
        failed.push({ template: group[0], message: String(error?.message || error) });
      }
    }

    if (created.length === 0) {
      throw new PurgeError("WRITE_FAILED", failed[0]?.message || "任务没有派发出去");
    }

    let indexError = "";
    let archived = 0;
    let archiveError = "";
    let dropped = 0;
    try {
      await withIndexLock(async () => {
        const index = await readIndex();
        // 索引按「新的在前」存；返回值保持创建顺序，面板据此逐条提示。
        const next = [...[...created].reverse(), ...index.tasks];
        const overflow = next.slice(MAX_TASKS);
        let kept = next;
        if (overflow.length > 0) {
          try {
            const archive = await readArchive();
            archive.tasks = [...overflow, ...archive.tasks].slice(0, ARCHIVE_MAX);
            await writeArchive(archive);
            archived = overflow.length;
            // 归档成功才裁剪主索引：先裁后归档会让记录在归档失败时凭空消失。
            kept = next.slice(0, MAX_TASKS);
          } catch (error) {
            archiveError = String(error?.message || error);
            log(`任务记录归档失败：${archiveError}`);
            // 归档失败时保留溢出记录，下次派发会重新尝试归档；只有连续失败突破硬上限才裁剪。
            const hardMax = MAX_TASKS + ROSTER_BATCH_MAX;
            if (next.length > hardMax) {
              dropped = next.length - hardMax;
              kept = next.slice(0, hardMax);
            }
          }
        }
        index.tasks = kept;
        await writeIndex(index);
      });
    } catch (error) {
      // 会话已经建好：这里只汇报索引没写成，避免用户以为派发失败而重试出重复会话。
      indexError = String(error?.message || error);
      log(indexError);
    }
    // 新建的会话必须在下一次读取时可见：清掉缓存，避免列表继续用派发前的快照判状态。
    liveCache.clear();

    const delivered = created.reduce((total, task) => total + (Array.isArray(task.tasks) ? task.tasks.length : 1), 0);
    return {
      mode: mode === "split" ? "split" : "single",
      taskCount: delivered,
      requested: requested.length,
      truncatedTemplates,
      archived,
      archiveError,
      dropped,
      conversations: created.length,
      failed,
      tasks: created,
      task: created[0],
      conversationId: created[0]?.conversationId || "",
      indexError,
    };
  };

  const list = async () => {
    let index = { version: 1, tasks: [] };
    let indexBroken = false;
    let indexReason = "";
    try {
      index = await readIndex();
    } catch (error) {
      // 只读轮询接口不能因为索引损坏整页报错：降级为空表，把原因单独带给面板。
      indexBroken = true;
      indexReason = String(error?.message || error);
      log(indexReason);
    }
    if (index.tasks.length === 0) {
      return { tasks: [], available: true, reason: "", directoryId: "", indexBroken, indexReason, archived: 0 };
    }
    // 先读当前项目：既用于没有记录项目的历史任务，也给出 activeDirectoryId。
    const activeLive = await readLiveCached("");
    const activeDirectoryId = activeLive.directoryId || "";
    const directories = [];
    for (const task of index.tasks) {
      const directoryId =
        typeof task.directoryId === "string" && task.directoryId ? task.directoryId : activeDirectoryId;
      if (directoryId && directoryId !== activeDirectoryId && !directories.includes(directoryId)) {
        directories.push(directoryId);
      }
    }
    const lives = new Map([[activeDirectoryId, activeLive]]);
    for (const directoryId of directories) {
      // 历史项目不参与当前面板的实时判定：用长 TTL 换取更少的跨进程往返。
      const live = await readLiveCached(directoryId, HISTORY_TTL_MS);
      lives.set(directoryId, live);
      if (live.directoryId) lives.set(live.directoryId, live);
    }
    const tasks = index.tasks.map((task) => {
      const directoryId =
        typeof task.directoryId === "string" && task.directoryId ? task.directoryId : activeDirectoryId;
      return refresh(task, lives.get(directoryId) || activeLive);
    });
    const available = [...lives.values()].some((live) => live.available);

    // 状态与指标有变化才回写：避免每次打开弹窗都写一遍索引文件。
    const changed = tasks.some((task, offset) => {
      const before = index.tasks[offset];
      return (
        task.status !== before.status ||
        task.statusReason !== (typeof before.statusReason === "string" ? before.statusReason : "") ||
        task.messageCount !== num(before.messageCount) ||
        task.tokens !== num(before.tokens) ||
        task.title !== before.title
      );
    });
    let view = tasks;
    if (changed) {
      const observedAt = Date.now();
      let merged = null;
      try {
        merged = await withIndexLock(async () => {
          // 锁内重读：锁外这份快照可能已被 dispatch 追加新任务、或被 remove 删掉旧任务。
          const fresh = await readIndex();
          const observed = new Map();
          for (const task of tasks) {
            if (typeof task.id === "string" && task.id) observed.set(task.id, task);
          }
          // 以磁盘上的记录为骨干按 id 合并状态：不追加、不复活，避免整表覆盖。
          // 这里不能再按 MAX_TASKS 裁剪：归档失败时超出的记录本来就要留在主索引里，
          // 轮询回写再裁一次会在没有归档的情况下把它们静默丢掉。
          fresh.tasks = fresh.tasks.map((disk) => {
            const next = typeof disk.id === "string" ? observed.get(disk.id) : null;
            // 本轮没有观测到（并发新增），或磁盘上的观测更新：都不回退旧状态。
            if (!next || num(disk.checkedAt) > observedAt) return disk;
            return {
              ...disk,
              status: next.status,
              statusReason: typeof next.statusReason === "string" ? next.statusReason : "",
              messageCount: next.messageCount,
              tokens: next.tokens,
              title: next.title || disk.title,
              updatedAt: next.updatedAt || disk.updatedAt,
              durationMs: next.durationMs,
              checkedAt: observedAt,
            };
          });
          await writeIndex(fresh);
          return fresh.tasks;
        });
      } catch (error) {
        // 回写失败不影响本次展示：面板照常看到观测结果，索引问题单独报出。
        indexBroken = true;
        indexReason = String(error?.message || error);
        log(`回写任务索引失败：${indexReason}`);
      }
      if (merged) {
        const alive = new Set(merged.map((task) => task.id));
        // 已被并发 remove 的任务不再回给面板；它们只存在于锁外快照里。
        const kept = tasks.filter((task) => !task.id || alive.has(task.id));
        const observedIds = new Set(kept.map((task) => task.id));
        // 并发新增的任务本轮没有展示字段，按磁盘记录原样带上，面板不用等下一轮才看到。
        view = [...merged.filter((task) => !observedIds.has(task.id)), ...kept].slice(0, MAX_TASKS);
      }
    }

    return {
      tasks: view,
      available,
      reason: activeLive.denied?.reason || "",
      directoryId: activeDirectoryId,
      indexBroken,
      indexReason,
      archived: await readArchiveCount(),
    };
  };

  /**
   * 归档条数：只用于界面说明「旧记录已归档」，读不到按 0 处理，
   * 不影响任务列表本身。
   */
  const readArchiveCount = async () => {
    try {
      return (await readArchive()).tasks.length;
    } catch (error) {
      log(`读取任务归档失败：${error?.message || error}`);
      return 0;
    }
  };

  /** 供链路回填项目标识：按会话或任务 id 找回派发时记录的项目。 */
  const directoryOf = async ({ conversationId = "", taskId = "" } = {}) => {
    const key = typeof conversationId === "string" ? conversationId : "";
    const taskKey = typeof taskId === "string" ? taskId : "";
    if (!key && !taskKey) return "";
    try {
      const index = await readIndex();
      const find = (list) =>
        list.find((item) => (key && item.conversationId === key) || (taskKey && item.id === taskKey)) || null;
      // 记录超过上限后会进入归档：项目归属仍要能回溯，否则旧链路会被误判为「项目未知」。
      const task = find(index.tasks) || find((await readArchive()).tasks);
      return task && typeof task.directoryId === "string" ? task.directoryId : "";
    } catch (error) {
      // 索引损坏不能中断链路巡检：这一环只是拿不到项目归属，按既有逻辑暂停等待用户处理。
      log(`读取任务索引失败：${error?.message || error}`);
      return "";
    }
  };

  const remove = async (id) => {
    const key = typeof id === "string" ? id.trim() : "";
    if (!ID_PATTERN.test(key)) throw new PurgeError("INVALID_PARAM", "任务标识不合法");
    return withIndexLock(async () => {
      const index = await readIndex();
      const next = index.tasks.filter((task) => task.id !== key);
      const removed = next.length !== index.tasks.length;
      if (removed) {
        index.tasks = next;
        await writeIndex(index);
      }
      return { id: key, removed };
    });
  };

  const activate = async (id) => {
    const key = typeof id === "string" ? id.trim() : "";
    if (!ID_PATTERN.test(key)) throw new PurgeError("INVALID_PARAM", "任务标识不合法");
    // 只在锁内读索引：写动作是跨进程调用，留在锁外，避免拖长其它写操作的等待。
    const task = await withIndexLock(async () => {
      const index = await readIndex();
      return index.tasks.find((item) => item.id === key) || null;
    });
    if (!task?.conversationId) throw new PurgeError("NOT_FOUND", "没有找到这条任务对应的会话");
    await callWrite("conversations.activate", { conversationId: task.conversationId });
    return { id: key, conversationId: task.conversationId, activated: true };
  };

  return { dispatch, list, remove, activate, directoryOf };
}
