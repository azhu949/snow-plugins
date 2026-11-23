// 编队链路：按固定顺序把五个角色串起来，上一环结束后自动把结论交给下一环。
// 只做「排队、判定、推进」：真正执行仍由主代理按 subAgents 规则派给角色子代理，
// 插件不直接调用 sub-agents-activate，也不代为批准工具。
import { CHAIN_BRIEFS, CHAIN_ORDER, findRosterRole } from "../shared/redteam-roster.js";
import { ROSTER_BATCH_MAX, ROSTER_CHAIN_RUNNING_MAX } from "../shared/contract.js";
import { TURN_TIMEOUT_MINUTES, TURN_TIMEOUT_MS, readSessionOutcome } from "../shared/roster-session.js";
import { PurgeError } from "./errors.js";
import { createIndexFile } from "./index-file.js";

const MAX_CHAINS = 10;
const MAX_RUNNING = ROSTER_CHAIN_RUNNING_MAX;
/** 已结束的链路记录可以被新记录淘汰；进行中（含 blocked）的记录不能被静默丢弃。 */
const CHAIN_ENDED = new Set(["completed", "stopped"]);
const ID_PATTERN = /^chain-[a-z0-9]{6,24}$/;
const TARGET_MAX = 200;
const NOTE_MAX = 600;
const TEMPLATE_MAX = 300;
/** 单个环节最多自带几条任务：与 roster-tasks 的批处理上限共用同一常量。 */
const MAX_STEP_TASKS = ROSTER_BATCH_MAX;
/** 单步最多等这么久仍无结果就停下来等人处理：与任务页共用同一阈值，避免两处口径分裂。 */
const STEP_TIMEOUT_MS = TURN_TIMEOUT_MS;
/** 文案里的分钟数由常量推导，避免两处硬编码不一致。 */
const STEP_TIMEOUT_MINUTES = TURN_TIMEOUT_MINUTES;
/** 会话列表的短 TTL：巡检与面板刷新可能在同一时刻各读一次，避免重复跨进程查询。 */
const LIVE_TTL_MS = 5000;

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const clean = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

const newChainId = () =>
  `chain-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase();

export function createRosterChainManager({ indexFile, roster, tasks, metadata, write, log = () => {} }) {
  /** 未注入 roster（旧调用）时返回空数组：行为与改动前一致。 */
  const missingRoles = async (roleIds) => {
    if (typeof roster?.installedIds !== "function") return [];
    const installed = new Set(await roster.installedIds());
    return roleIds.filter((id) => !installed.has(id));
  };

  /**
   * 索引文件：写入走「临时文件 + rename」，解析失败与结构不符一律报错并保留原文件。
   * 把解析失败当成空表，下一次启动链路就会用空表覆盖掉全部记录。
   */
  const indexStore = createIndexFile({
    filePath: indexFile,
    label: "链路索引",
    empty: () => ({ version: 1, chains: [] }),
    normalize: (parsed) => {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      if (parsed.chains !== undefined && !Array.isArray(parsed.chains)) return null;
      const chains = Array.isArray(parsed.chains)
        ? parsed.chains.filter((item) => item && Array.isArray(item.steps))
        : [];
      return { version: 1, chains };
    },
    log,
  });

  const readIndex = indexStore.read;
  const writeIndex = indexStore.write;

  /**
   * 会话与运行态：链路推进一步都靠这两份数据判断「上一环到底停没停」。
   * conversations 域按项目过滤：必须带上该步骤派发时记录的项目，否则用户切到别的项目后
   * 读回的是另一个项目的列表，运行中的链路会被判成「会话已不在」并阻塞。
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
    // 只有真的拿到会话列表才算可用：读取失败、权限被拒、没有活动项目都会给不出列表，
    // 这几种情况不能当作「会话已不在」。
    const available = Array.isArray(items);
    if (!available) {
      log(`会话列表不可用：${denied?.reason || "宿主未返回 items"}`);
    }
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
    // 运行态与会话列表同样可能读不到：读不到时不能把「没有流式会话」当成「本环已经跑完」。
    const runtimeAvailable = runtimeResult.status === "fulfilled" && Boolean(runtime);
    // 等待授权集合由渲染进程的会话上下文发布：conversation 为空（渲染层未就绪或已重载）时无法判断。
    const attentionList = Array.isArray(runtime?.conversation?.attentionRequiredConversationIds)
      ? runtime.conversation.attentionRequiredConversationIds
      : null;
    const attention = new Set();
    for (const id of attentionList || []) {
      if (typeof id === "string" && id) attention.add(id);
    }
    return {
      available,
      runtimeAvailable,
      // 集合不可用与「确实没有会话在等待」不可区分：调用方不能据此把本环判成已完成。
      attentionAvailable: runtimeAvailable && attentionList !== null,
      byId,
      streaming,
      attention,
      denied,
      activeDirectoryId,
      directoryId:
        (typeof conv?.directoryId === "string" && conv.directoryId) || directoryId || activeDirectoryId,
    };
  };

  const liveCache = new Map();
  const liveFor = async (directoryId = "") => {
    const key = directoryId || "";
    const hit = liveCache.get(key);
    if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.live;
    const live = await readLive(key);
    liveCache.set(key, { at: Date.now(), live });
    return live;
  };

  const mustFind = (index, id) => {
    const key = typeof id === "string" ? id.trim() : "";
    if (!ID_PATTERN.test(key)) throw new PurgeError("INVALID_PARAM", "链路标识不合法");
    const chain = index.chains.find((item) => item.id === key) || null;
    if (!chain) throw new PurgeError("NOT_FOUND", "没有找到这条链路");
    return chain;
  };

  const dispatchStep = async (chain, index) => {
    const step = chain.steps[index];
    if (!step) return;
    const role = findRosterRole(step.roleId);
    if (!role) throw new PurgeError("INVALID_PARAM", `未知角色：${step.roleId}`);
    const missing = await missingRoles([step.roleId]);
    if (missing.length > 0) {
      const error = new PurgeError(
        "NOT_INSTALLED",
        `角色 ${role.name} 还没编入，链路已暂停：先到「编队」里编入，再点「继续」`
      );
      error.missingRoles = missing;
      throw error;
    }

    // 上一环节的产出是模型对目标内容的总结：作为不可信数据单独传给下游，
    // 不与操作者填写的补充说明拼成同一段自由文本。
    let prior = null;
    if (index > 0) {
      const previous = chain.steps[index - 1];
      prior = {
        roleName: findRosterRole(previous.roleId)?.name || previous.roleId,
        summary: previous.preview || "",
        skipped: previous.status === "skipped",
      };
    }

    // [合并]: 环节可以自带任务清单；没配就回落到内置任务书，旧链路记录因此无需迁移。
    const stepTasks =
      Array.isArray(step.tasks) && step.tasks.length > 0
        ? step.tasks
        : [CHAIN_BRIEFS[step.roleId] || step.brief || role.description];

    const result = await tasks.dispatch({
      roleId: step.roleId,
      target: chain.target,
      templates: stepTasks,
      note: chain.note || "",
      prior,
      mode: "single",
    });
    // 旧记录里可能仍有多于上限的任务：把被跳过的条数记到链路上，界面不再静默。
    const skippedTasks = Math.max(0, stepTasks.length - MAX_STEP_TASKS, num(result.truncatedTemplates));
    if (skippedTasks > 0) chain.truncated = num(chain.truncated) + skippedTasks;
    if (result.archived > 0) chain.archived = num(chain.archived) + num(result.archived);
    // 归档失败不影响本环派发，但旧记录会继续占用索引：把原因带到链路视图，面板已有 lastError 展示位。
    if (result.archiveError) chain.lastError = `旧任务记录归档失败：${result.archiveError}`;

    chain.steps[index] = {
      ...step,
      tasks: stepTasks,
      taskId: result.task?.id || "",
      conversationId: result.task?.conversationId || "",
      // 记下这一步在哪个项目里跑：之后巡检按项目读会话，切项目不会再判成会话已不在。
      directoryId: result.task?.directoryId || "",
      status: "running",
      startedAt: Date.now(),
      finishedAt: 0,
      preview: "",
    };
    chain.stepIndex = index;
    chain.directoryId = chain.directoryId || chain.steps[index].directoryId;
    chain.updatedAt = Date.now();
    // 新会话还没出现在缓存里：清掉，下一次巡检按真实列表判断这一环有没有跑完。
    liveCache.clear();
    try {
      await persistStep(chain, index);
    } catch (error) {
      // 会话已经创建：索引写不进去时必须中止它，否则会留下无法管理的运行中会话。
      const conversationId =
        typeof chain.steps[index]?.conversationId === "string" ? chain.steps[index].conversationId : "";
      if (conversationId) {
        const abort = await abortStepRun(chain.steps[index]);
        const tone = abort.aborted
          ? "已中止该会话"
          : `未能中止（${abort.reason || "未知原因"}），请到会话列表手动停止`;
        error.message = `${String(error?.message || error)}（会话 ${conversationId}，${tone}）`;
      }
      throw error;
    }
  };

  /**
   * 当前步骤属于哪个项目：新记录直接写在步骤上；旧记录没有，就按会话或任务 id 从任务索引回填一次
   * （派发时本来就记录了项目）。回填结果只写内存，调用方决定是否落盘。
   */
  const resolveDirectory = async (chain) => {
    const step = chain.steps[chain.stepIndex];
    if (!step) return "";
    if (step.directoryId) return step.directoryId;
    // 任务索引按会话记录项目：旧链路每一环可能落在不同项目里，按环回填比用链路级兜底更准。
    const fromTasks = await tasks.directoryOf?.({
      conversationId: step.conversationId,
      taskId: step.taskId,
    });
    if (fromTasks) {
      step.directoryId = fromTasks;
      chain.directoryId = chain.directoryId || fromTasks;
      return fromTasks;
    }
    if (chain.directoryId) {
      step.directoryId = chain.directoryId;
      return chain.directoryId;
    }
    return "";
  };

  /**
   * 推进一步。返回 true 表示这条链路的状态有变化（需要回写索引）。
   * 判定完成后必须留下结论摘要：它就是下一环的输入，也是用户判断要不要继续的依据。
   */
  const stepOnce = async (chain, live, now, directoryKnown) => {
    const step = chain.steps[chain.stepIndex];
    if (!step) {
      chain.status = "completed";
      return true;
    }

    // 会话列表读不到时不下结论；等待上限由 step() 统一裁决，这里只避免把状态判成缺失。
    if (!live.available) return false;
    // 运行态读不到时同样不能下结论：宿主按 fail-open 处理，没有流式记录不等于回合已经结束。
    if (!live.runtimeAvailable) return false;

    const record = step.conversationId ? live.byId.get(step.conversationId) || null : null;
    const streaming = step.conversationId ? live.streaming.get(step.conversationId) || null : null;

    // 还在跑：继续等。宿主没有完成事件，只能靠轮询。
    if (streaming) return false;

    if (!record) {
      // 不知道这条会话属于哪个项目就没法判断它是否还在：不能拿当前项目的列表下结论。
      if (!directoryKnown) {
        chain.status = "paused";
        chain.lastError = "读不到这条链路的项目归属，无法确认当前步骤的会话状态：请切回发起项目后点继续";
        chain.updatedAt = now;
        return true;
      }
      step.status = "missing";
      chain.status = "blocked";
      chain.lastError = "当前步骤的会话已不在会话列表里，链路已阻塞：点「继续」会重新派发本步，或点「跳过本步」";
      chain.updatedAt = now;
      return true;
    }

    const attention = step.conversationId ? live.attention?.has(step.conversationId) === true : false;
    const outcome = readSessionOutcome(record, { waiting: attention });
    if (outcome.status === "failed" || outcome.status === "cancelled") {
      step.status = "failed";
      step.preview = clean(outcome.error || outcome.displayPreview, 400);
      chain.status = "blocked";
      chain.lastError = `当前步骤${outcome.status === "failed" ? "执行失败" : "被取消"}，链路已暂停`;
      chain.updatedAt = now;
      return true;
    }

    const messages = outcome.messages;
    const preview = clean(outcome.preview, 400);
    // 根会话的 subAgentStatus 恒为空串，只能看运行态、消息数与最后一条回复。
    // 回复为空时多半是回合失败或被中断，不能当作完成把残缺结论交给下一环。
    let finished = outcome.status === "completed";
    // 「是否正在等待工具授权」只能来自宿主的实时会话状态。读不到时无法排除「正停在授权卡片上」：
    // 根会话落库的最后一条回复与正常收尾完全一样，不能把这一环判 completed 并提前拉起下一环。
    if (finished && !live.attentionAvailable) {
      finished = false;
      const note =
        "宿主没有提供实时会话状态（渲染层未就绪或已重载），无法确认当前步骤是否在等待工具授权：这不是该会话失败，自动推进已暂停，请确认该会话后再点「继续」或「跳过本步」";
      if (step.statusReason !== note) {
        step.statusReason = note;
        chain.updatedAt = now;
        // 先落盘提示，下一轮再走下面的超时兜底（复用同一计时起点，不新增计时器）。
        return true;
      }
    }
    if (!finished) {
      // 超时判定必须排在「等待确认」之前：等太久同样要停下来交给用户。
      const startedAt = num(step.startedAt) || now;
      if (now - startedAt > STEP_TIMEOUT_MS) {
        step.status = "timeout";
        chain.status = "blocked";
        chain.lastError =
          messages >= 2 && preview === ""
            ? `当前步骤已有 ${messages} 条消息但最近一次回复为空，已超过 ${STEP_TIMEOUT_MINUTES} 分钟没有恢复，链路已暂停：打开该会话确认是否失败，再点「继续」或「跳过本步」`
            : `当前步骤超过 ${STEP_TIMEOUT_MINUTES} 分钟没有结束，链路已暂停`;
        chain.updatedAt = now;
        return true;
      }
      if (outcome.waiting) {
        // 等待授权或回答时回合尚未结束：不能把上一段落库的回复当成完成交给下一环。
        const note = "当前步骤在等待工具授权或你的回答，处理后会继续";
        if (step.statusReason !== note) {
          step.statusReason = note;
          chain.updatedAt = now;
          return true;
        }
        return false;
      }
      if (messages >= 2 && preview === "") {
        const note = `当前步骤已有 ${messages} 条消息，但最近一次回复为空（可能失败或被中断），正在等待人工确认`;
        if (chain.lastError !== note) {
          chain.lastError = note;
          chain.updatedAt = now;
          return true;
        }
        return false;
      }
      return false;
    }

    // 完成判定要求连续两轮巡检的消息数与更新时间都不变：刚写入的回复可能只是中途落库。
    const observed = `${messages}:${String(record.updatedAt || "")}`;
    if (step.observed !== observed) {
      step.observed = observed;
      step.statusReason = "已收到回复，等待下一轮巡检确认本环收尾";
      chain.updatedAt = now;
      return true;
    }

    step.status = "completed";
    step.statusReason = "";
    step.observed = "";
    step.finishedAt = num(record.updatedAt) || now;
    step.preview = preview || clean(record.summary, 400);
    step.tokens = num(record.inputTokens) + num(record.outputTokens);
    step.durationMs = num(record.totalDurationMs);
    chain.updatedAt = now;
    // 本环已成功：上一环遗留的等待/失败提示到此结束。
    // 若下一环派发失败，外层 catch 会写入新的 lastError，原因不会被清空掩盖。
    chain.lastError = "";

    const next = chain.stepIndex + 1;
    if (next >= chain.steps.length) {
      chain.status = "completed";
      return true;
    }
    await dispatchStep(chain, next);
    return true;
  };

  /**
   * 索引读写的串行队列：只保护本地文件的读改写。
   * 跨进程调用一律在锁外，持锁时间从「一次宿主往返」降到「一次文件读写」。
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
   * 锁只保护索引的读写：宿主 RPC（metadata.get / conversations.create / conversations.abort）
   * 一律在锁外执行，否则一次 20 秒的宿主调用会把暂停、跳过、移除全部堵在队列里。
   * 跨进程结果回来后再用短锁落盘，并按 rev 校验期间用户有没有改过这条链路。
   */
  const cloneChain = (chain) => JSON.parse(JSON.stringify(chain));

  /** 短锁内读一条链路快照：返回副本，锁外判断不会与磁盘共享引用。 */
  const snapshotChain = async (id) =>
    withIndexLock(async () => {
      const index = await readIndex();
      return { chain: cloneChain(mustFind(index, id)), chains: index.chains };
    });

  /**
   * 按步骤合并内存与磁盘记录：巡检可能在用户操作期间刚把新会话写进磁盘，
   * 全量覆盖会丢掉 conversationId，留下无法管理的运行中会话。
   */
  const mergeSteps = (memorySteps, diskSteps) => {
    const memory = Array.isArray(memorySteps) ? memorySteps : [];
    const disk = Array.isArray(diskSteps) ? diskSteps : [];
    const length = Math.max(memory.length, disk.length);
    const merged = [];
    for (let index = 0; index < length; index += 1) {
      const next = { ...(disk[index] || {}), ...(memory[index] || {}) };
      const diskConversation =
        typeof disk[index]?.conversationId === "string" ? disk[index].conversationId : "";
      const memoryConversation =
        typeof memory[index]?.conversationId === "string" ? memory[index].conversationId : "";
      // 内存里没有会话标识（尚未派发或刚被重置）时，磁盘上更新的会话不能丢。
      if (diskConversation && !memoryConversation) next.conversationId = diskConversation;
      merged.push(next);
    }
    return merged;
  };

  /** 短锁内落盘用户动作：整条覆盖，并递增并发版本号。 */
  const commitChain = async (chain) =>
    withIndexLock(async () => {
      const index = await readIndex();
      const position = index.chains.findIndex((item) => item.id === chain.id);
      if (position < 0) throw new PurgeError("NOT_FOUND", "没有找到这条链路");
      const next = {
        ...chain,
        steps: mergeSteps(chain.steps, index.chains[position].steps),
        rev: num(index.chains[position].rev) + 1,
        updatedAt: Date.now(),
      };
      index.chains[position] = next;
      await writeIndex(index);
      return { chain: next, chains: index.chains };
    });

  /**
   * 会话创建成功后立刻把会话标识写进磁盘：链路索引写失败时不能让已建会话失去记录。
   * 只合并步骤字段，不改链路状态，因此不会覆盖用户在这期间做的暂停或停止。
   */
  const persistStep = async (chain, stepIndex) => {
    const step = chain.steps[stepIndex];
    if (!step) return;
    await withIndexLock(async () => {
      const index = await readIndex();
      const disk = index.chains.find((item) => item.id === chain.id);
      if (!disk) return;
      disk.steps[stepIndex] = { ...(disk.steps[stepIndex] || {}), ...step };
      disk.stepIndex = stepIndex;
      disk.directoryId = disk.directoryId || chain.directoryId;
      disk.updatedAt = Date.now();
      await writeIndex(index);
    });
  };

  let ticking = false;

  /** 巡检所有 running 链路：面板不开着也会推进，这就是「自动接力」的来源。 */
  const step = async () => {
    if (ticking) return { advanced: 0 };
    ticking = true;
    try {
      // 只借锁读一次快照：之后的宿主调用与判定全部在锁外，避免一次巡检把用户操作堵住几十秒。
      const snapshot = await withIndexLock(() => readIndex());
      const running = snapshot.chains.filter((chain) => chain.status === "running");
      if (running.length === 0) return { advanced: 0 };
      const baseRev = new Map(running.map((chain) => [chain.id, num(chain.rev)]));
      // 当前项目的会话列表：用于还回填不出项目的旧链路，也提供 activeDirectoryId。
      const activeLive = await liveFor("");
      const now = Date.now();
      let advanced = 0;
      for (const chain of running) {
        try {
          const directoryId = await resolveDirectory(chain);
          const live = directoryId ? await liveFor(directoryId) : activeLive;
          const current = chain.steps[chain.stepIndex];
          // 旧记录可能没有派发时刻：补写一次，否则 0 会被判成立即超时。
          if (current && !num(current.startedAt)) {
            current.startedAt = now;
            advanced += 1;
          }
          // 会话列表或运行态读不到时不下结论，但也不能无限等：等满上限就转 blocked，把名额让出来。
          if (!live.available || !live.runtimeAvailable) {
            const reason = !live.available
              ? "读不到会话列表（宿主没有返回会话数据）"
              : "读不到运行态（宿主没有返回流式会话数据）";
            const startedAt = num(current?.startedAt) || now;
            if (now - startedAt > STEP_TIMEOUT_MS) {
              chain.status = "blocked";
              chain.lastError = `${reason}，当前步骤已等待超过 ${STEP_TIMEOUT_MINUTES} 分钟，链路已暂停：打开或切回发起项目后点「继续」即可接着跑`;
              chain.updatedAt = now;
              advanced += 1;
            }
            continue;
          }
          if (await stepOnce(chain, live, now, Boolean(directoryId))) advanced += 1;
        } catch (error) {
          chain.status = "blocked";
          chain.lastError = String(error?.message || error);
          chain.updatedAt = now;
          advanced += 1;
          log(`链路 ${chain.id} 推进失败：${chain.lastError}`);
        }
      }
      if (advanced > 0) {
        await withIndexLock(async () => {
          const index = await readIndex();
          let changed = false;
          for (const chain of running) {
            const disk = index.chains.find((item) => item.id === chain.id);
            if (!disk) continue;
            // 巡检期间用户暂停、停止或重建了这条链路：以用户的操作为准，丢弃本轮判定。
            if (num(disk.rev) !== baseRev.get(chain.id)) continue;
            const nextRev = num(disk.rev) + 1;
            Object.assign(disk, chain, {
              rev: nextRev,
              updatedAt: Math.max(num(disk.updatedAt), num(chain.updatedAt)),
            });
            changed = true;
          }
          if (changed) await writeIndex(index);
        });
      }
      return { advanced };
    } finally {
      ticking = false;
    }
  };

  const start = async ({ target, note, roleIds, steps }) => {
    const targetText = clean(target, TARGET_MAX);
    if (!targetText) throw new PurgeError("INVALID_PARAM", "请填写靶标（域名、IP 或网段）");

    // [合并]: steps 携带每个环节自己的任务清单；也接受旧的 roleIds，缺失的任务回落到内置任务书。
    const requestedSteps = Array.isArray(steps)
      ? steps
          .filter((item) => item && typeof item === "object" && typeof item.roleId === "string")
          .map((item) => {
            const tasks = Array.isArray(item.tasks)
              ? item.tasks
                  .map((text) => clean(text, TEMPLATE_MAX))
                  .filter(Boolean)
                  .filter((text, index, list) => list.indexOf(text) === index)
              : [];
            // 超过上限直接拒绝：静默丢弃会让用户以为整份清单都派出去了。
            if (tasks.length > MAX_STEP_TASKS) {
              const roleId = item.roleId.trim();
              const roleName = findRosterRole(roleId)?.name || roleId;
              throw new PurgeError(
                "INVALID_PARAM",
                `「${roleName}」配了 ${tasks.length} 条任务，单步最多 ${MAX_STEP_TASKS} 条：请先删减再启动`
              );
            }
            return { roleId: item.roleId.trim(), tasks };
          })
      : [];
    const requested = requestedSteps.length
      ? requestedSteps.map((item) => item.roleId)
      : Array.isArray(roleIds)
        ? roleIds
        : [];
    const wanted = requested.length
      ? CHAIN_ORDER.filter((roleId) => requested.includes(roleId))
      : [...CHAIN_ORDER];
    if (wanted.length === 0) throw new PurgeError("INVALID_PARAM", "请至少选择一个角色");

    const missing = await missingRoles(wanted);
    if (missing.length > 0) {
      const names = missing.map((id) => findRosterRole(id)?.name || id).join("、");
      const error = new PurgeError("NOT_INSTALLED", `这些角色还没编入：${names}。先到「编队」里编入，再启动链路`);
      error.missingRoles = missing;
      throw error;
    }

    const taskMap = new Map(requestedSteps.map((item) => [item.roleId, item.tasks]));

    const chain = {
      id: newChainId(),
      target: targetText,
      note: clean(note, NOTE_MAX),
      // 链路在哪个项目里跑：dispatchStep 会按步骤深化，这里留空表示尚未确定。
      directoryId: "",
      steps: wanted.map((roleId) => ({
        roleId,
        tasks: taskMap.get(roleId) || [],
        status: "queued",
        taskId: "",
        conversationId: "",
        directoryId: "",
        startedAt: 0,
        finishedAt: 0,
        preview: "",
      })),
      stepIndex: 0,
      rev: 1,
      status: "queued",
      lastError: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 先落一条 queued 锚点再派发：索引写失败时不会创建会话；派发后写失败也能凭锚点找回会话。
    await withIndexLock(async () => {
      const index = await readIndex();
      // 名额统计按「未结束」算：blocked 链路的会话往往仍在执行，漏计会让并发动作数超过上限。
      const active = index.chains.filter((chain) => !CHAIN_ENDED.has(chain.status));
      if (active.length >= MAX_RUNNING) {
        throw new PurgeError(
          "LIMIT",
          `最多同时保留 ${MAX_RUNNING} 条未结束的链路（进行中或阻塞）：先停止或移除一条再启动`
        );
      }
      // 记录数已满时只允许淘汰已结束的链路：进行中的记录（含 blocked）不能被静默挤出列表。
      const overflow = index.chains.length + 1 - MAX_CHAINS;
      if (overflow > 0 && index.chains.filter((chain) => CHAIN_ENDED.has(chain.status)).length < overflow) {
        throw new PurgeError(
          "LIMIT",
          `最多保留 ${MAX_CHAINS} 条链路记录，其中没有可淘汰的已结束链路：先移除或停止一条再启动`
        );
      }
      index.chains = [chain, ...index.chains];
      // 从最旧的记录开始淘汰已结束的链路：进行中的链路（含 blocked）不能被静默丢弃。
      let need = index.chains.length - MAX_CHAINS;
      for (let i = index.chains.length - 1; i > 0 && need > 0; i -= 1) {
        if (!CHAIN_ENDED.has(index.chains[i].status)) continue;
        index.chains.splice(i, 1);
        need -= 1;
      }
      await writeIndex(index);
    });

    try {
      // 会话创建成功后 dispatchStep 会立即把会话标识写进磁盘；写不进去时会中止会话并抛错。
      await dispatchStep(chain, 0);
      chain.status = "running";
      chain.updatedAt = Date.now();
    } catch (error) {
      chain.status = "blocked";
      chain.lastError = String(error?.message || error);
      chain.updatedAt = Date.now();
      log(`链路 ${chain.id} 第一步没有派出去：${chain.lastError}`);
    }

    try {
      const saved = await commitChain(chain);
      return { chain: saved.chain, chains: saved.chains };
    } catch (error) {
      // 锚点已在磁盘上；这次写入失败只影响内存状态，把会话标识一并报出来便于手动处理。
      const conversationId =
        typeof chain.steps[0]?.conversationId === "string" ? chain.steps[0].conversationId : "";
      if (conversationId) {
        error.message = `${String(error?.message || error)}（会话 ${conversationId}，状态 ${chain.status}）`;
      }
      throw error;
    }
  };

  const list = async () => {
    let index = { version: 1, chains: [] };
    let indexBroken = false;
    let indexReason = "";
    try {
      index = await readIndex();
    } catch (error) {
      // 总览接口与任务列表一起取：这里不能抛，否则面板整页报错。
      indexBroken = true;
      indexReason = String(error?.message || error);
      log(indexReason);
    }
    if (index.chains.length === 0) return { chains: [], available: true, indexBroken, indexReason };
    const activeLive = await liveFor("");
    const chains = [];
    for (const chain of index.chains) {
      // 进行中的链路才需要回填项目：已结束的记录按它自己记下的项目读。
      const needsDirectory = ["running", "paused", "blocked"].includes(chain.status);
      const directoryId = needsDirectory
        ? await resolveDirectory(chain)
        : chain.directoryId || chain.steps[chain.stepIndex]?.directoryId || "";
      const live = directoryId ? await liveFor(directoryId) : activeLive;
      chains.push({
        ...chain,
        currentRoleId: chain.steps[chain.stepIndex]?.roleId || "",
        steps: chain.steps.map((step) => {
          const record = step.conversationId ? live.byId.get(step.conversationId) || null : null;
          const session = step.conversationId ? live.streaming.get(step.conversationId) || null : null;
          return {
            ...step,
            messageCount: num(record?.messageCount),
            tokens: num(record?.inputTokens) + num(record?.outputTokens),
            elapsedMs: session ? num(session.elapsedMs) : num(step.durationMs),
            liveStatus: session ? "running" : step.status,
          };
        }),
      });
    }
    return { chains, available: activeLive.available, indexBroken, indexReason };
  };

  const pause = async (id) =>
    withIndexLock(async () => {
      const index = await readIndex();
      const chain = mustFind(index, id);
      if (chain.status === "running") {
        // 暂停只停接力：当前环节的会话仍会继续跑，界面文案必须说清楚。
        chain.status = "paused";
        chain.rev = num(chain.rev) + 1;
        chain.updatedAt = Date.now();
        await writeIndex(index);
      }
      return { chain, chains: index.chains };
    });

  /**
   * 中止某一环正在跑的会话：停止接力与跳过本步共用。
   * 宿主只保证「中止请求已下发」，不保证回合立刻收尾，因此返回值只用于提示，
   * 没有会话、权限被拒、运行时未就绪一律按「没停成」处理，绝不阻断后续动作。
   */
  const abortStepRun = async (step) => {
    const conversationId = typeof step?.conversationId === "string" ? step.conversationId : "";
    if (!conversationId) return { conversationId: "", aborted: false, reason: "" };
    if (!write || typeof write.run !== "function") {
      return { conversationId, aborted: false, reason: "后台没有拿到宿主写接口" };
    }
    try {
      const result = await write.run("conversations.abort", { conversationId });
      if (!result?.ok) {
        const reason = result?.denied?.reason || result?.error || "未知原因";
        return { conversationId, aborted: false, reason: String(reason).slice(0, 200) };
      }
      const aborted = result.data?.aborted === true;
      return { conversationId, aborted, reason: aborted ? "" : "会话没有进行中的回合" };
    } catch (error) {
      // 宿主聊天运行时未就绪时直接抛错：按「没停成」处理，把原因带回面板。
      return { conversationId, aborted: false, reason: String(error?.message || error).slice(0, 200) };
    }
  };

  /** 正在重新派发的链路：挡住连点「继续」造成的重复会话。 */
  const resuming = new Set();

  /**
   * 重派发判定：missing / timeout / failed 的会话都不会自己重新跑起来，必须重建。
   * 返回原因而不是布尔值：面板要区分「旧会话仍在跑」「读不到会话列表」与「其实已经跑完」。
   */
  const canRedispatch = async (chain, step) => {
    if (!step) return { ok: false, reason: "nostep" };
    if (!["missing", "timeout", "failed"].includes(step.status)) return { ok: false, reason: "status" };
    if (!step.conversationId) return { ok: true, reason: "" };
    const live = await liveFor(step.directoryId || chain.directoryId || "");
    if (!live.available) return { ok: false, reason: "unavailable" };
    if (live.streaming.has(step.conversationId)) return { ok: false, reason: "streaming" };
    const record = live.byId.get(step.conversationId) || null;
    if (!record) return { ok: true, reason: "" };
    return readSessionOutcome(record).status === "completed"
      ? { ok: false, reason: "completed" }
      : { ok: true, reason: "" };
  };

  const resume = async (id) => {
    const { chain, chains } = await snapshotChain(id);
    if (chain.status !== "paused" && chain.status !== "blocked") {
      return { chain, chains };
    }
    if (resuming.has(chain.id)) return { chain, chains };
    const current = chain.steps[chain.stepIndex];
    const stepIndex = chain.stepIndex;
    // 没有会话（首次未派发成功），或停在 missing / timeout / failed：只改状态不会让会话重新跑起来，
    // 下一轮巡检又会判成缺失或失败。这里直接重派发。
    const redispatch = current
      ? current.conversationId
        ? await canRedispatch(chain, current)
        : { ok: true, reason: "" }
      : { ok: false, reason: "nostep" };
    const needsRedispatch = Boolean(current) && redispatch.ok;
    let redispatched = false;
    let redispatchBlocked = needsRedispatch ? "" : redispatch.reason;
    let aborted = false;
    let abortedConversationId = "";
    let abortReason = "";
    resuming.add(chain.id);
    try {
      if (needsRedispatch) {
        chain.lastError = "";
        // 旧会话可能仍在（超时，或宿主列表延迟造成的误判缺失）：先请求中止，
        // 避免重派发后两个会话同时对同一靶标动作；中止失败只记录，不阻断重试。
        if (current.conversationId) {
          const abort = await abortStepRun(current);
          current.aborted = abort.aborted;
          aborted = abort.aborted;
          abortedConversationId = abort.conversationId;
          abortReason = abort.reason;
        }
        // 复用重派发路径前清掉上一轮的标识与展示字段：面板不能继续显示旧会话、旧耗时与旧摘要。
        Object.assign(current, {
          status: "queued",
          taskId: "",
          conversationId: "",
          startedAt: 0,
          finishedAt: 0,
          preview: "",
          tokens: 0,
          durationMs: 0,
          statusReason: "",
          observed: "",
        });
        // 先把「准备重派发」的状态落盘，再创建会话：派发过程中进程退出也不会残留旧会话标识。
        await commitChain(chain);
        try {
          await dispatchStep(chain, stepIndex);
          if (!chain.steps[stepIndex]?.conversationId) {
            throw new PurgeError("WRITE_FAILED", "会话已创建，但宿主没有返回会话 id");
          }
          chain.status = "running";
          chain.updatedAt = Date.now();
          redispatched = true;
        } catch (error) {
          // 只回退运行态字段：已经创建的 taskId / conversationId 必须保留，
          // 下一次「继续」才能凭会话标识判断是否需要重新派发。
          Object.assign(chain.steps[stepIndex] || {}, {
            status: "queued",
            startedAt: 0,
            finishedAt: 0,
            statusReason: "",
            observed: "",
          });
          chain.status = "blocked";
          chain.lastError = `第 ${stepIndex + 1} 环重新派发失败：${String(error?.message || error)}`;
          redispatchBlocked = "dispatch-failed";
          chain.updatedAt = Date.now();
          log(`链路 ${chain.id} 重新派发失败：${chain.lastError}`);
        }
      } else {
        if (current && !["completed", "skipped", "failed"].includes(current.status)) {
          // 暂停或阻塞的时长不计入本步超时：继续时以当前时刻重新起算。
          current.status = "running";
          current.startedAt = Date.now();
        }
        chain.status = "running";
        chain.lastError = "";
        chain.updatedAt = Date.now();
      }
      const saved = await commitChain(chain);
      return {
        chain: saved.chain,
        chains: saved.chains,
        redispatched,
        redispatchBlocked,
        aborted,
        abortedConversationId,
        abortReason,
      };
    } finally {
      resuming.delete(chain.id);
    }
  };

  /** 跳过当前步骤：卡住时由用户决定「不等了，直接进下一环」。 */
  const skip = async (id) => {
    const { chain } = await snapshotChain(id);
    if (!["running", "paused", "blocked"].includes(chain.status)) {
      throw new PurgeError("INVALID_PARAM", "这条链路已经结束，不需要跳过");
    }
    const stepIndex = chain.stepIndex;
    const step = chain.steps[stepIndex];
    // 跳过不等于「不再等待」：旧会话仍在跑时会和下一环同时对同一靶标动作，
    // 因此先请求中止，再派发下一环；中止失败只记录原因，不阻断推进。
    const abort = step ? await abortStepRun(step) : { conversationId: "", aborted: false, reason: "" };
    if (step) {
      step.status = "skipped";
      step.aborted = abort.aborted;
      step.finishedAt = Date.now();
    }
    const next = stepIndex + 1;
    if (next >= chain.steps.length) {
      chain.status = "completed";
      chain.lastError = "";
      chain.updatedAt = Date.now();
      const saved = await commitChain(chain);
      return {
        chain: saved.chain,
        chains: saved.chains,
        skipped: true,
        aborted: abort.aborted,
        abortedConversationId: abort.conversationId,
        abortReason: abort.reason,
      };
    }

    // 先把「本步已跳过、下一环尚未派发」落盘，再创建会话：即使派发失败或进程退出，
    // 磁盘上也不会留下一个没有归属的会话标识。
    chain.stepIndex = next;
    chain.steps[next] = { ...(chain.steps[next] || {}), status: "queued" };
    chain.status = "running";
    chain.lastError = "";
    chain.updatedAt = Date.now();
    await commitChain(chain);

    try {
      await dispatchStep(chain, next);
      chain.status = "running";
      chain.lastError = "";
      chain.updatedAt = Date.now();
    } catch (error) {
      // 派发失败必须落盘：旧会话已被中止、新会话没建起来时，界面要给出原因。
      chain.status = "blocked";
      chain.lastError = String(error?.message || error);
      chain.updatedAt = Date.now();
      log(`链路 ${chain.id} 跳过本步后派发失败：${chain.lastError}`);
    }
    const saved = await commitChain(chain);
    return {
      chain: saved.chain,
      chains: saved.chains,
      skipped: true,
      aborted: abort.aborted,
      abortedConversationId: abort.conversationId,
      abortReason: abort.reason,
    };
  };

  const stop = async (id) => {
    const { chain } = await snapshotChain(id);
    const step = chain.steps[chain.stepIndex];
    const wasLive = ["running", "paused", "blocked"].includes(chain.status);
    // 停止接力不等于会话已停：当前环节可能仍在跑工具、仍在向靶标发包。
    // 先请求中止，再落链路状态；中止失败只回报原因，不让「停止」本身失败。
    const abort = wasLive && step
      ? await abortStepRun(step)
      : { conversationId: "", aborted: false, reason: "" };
    if (wasLive && step && !["completed", "skipped", "failed", "timeout"].includes(step.status)) {
      step.status = "stopped";
      step.finishedAt = step.finishedAt || Date.now();
    }
    chain.status = "stopped";
    chain.lastError = "";
    chain.updatedAt = Date.now();
    const saved = await commitChain(chain);
    return {
      chain: saved.chain,
      chains: saved.chains,
      aborted: abort.aborted,
      abortedConversationId: abort.conversationId,
      abortReason: abort.reason,
    };
  };

  /**
   * 某条任务记录被哪些链路引用：只读索引，不触达宿主。
   * 供任务移除前判断「删了会不会让运行中的链路失去项目归属」。
   */
  const taskRefs = async (taskId) => {
    const key = typeof taskId === "string" ? taskId.trim() : "";
    if (!key) return [];
    const index = await readIndex();
    const refs = [];
    for (const chain of index.chains) {
      const steps = Array.isArray(chain.steps) ? chain.steps : [];
      steps.forEach((step, stepIndex) => {
        if (step?.taskId !== key) return;
        refs.push({
          chainId: chain.id,
          status: chain.status,
          stepIndex,
          roleId: typeof step.roleId === "string" ? step.roleId : "",
          stepDirectoryId: typeof step.directoryId === "string" ? step.directoryId : "",
          directoryId: typeof chain.directoryId === "string" ? chain.directoryId : "",
        });
      });
    }
    return refs;
  };

  /**
   * 移除链路记录：未结束（running / paused / blocked）的当前环节会话先请求中止，再删索引。
   * 中止失败只回报原因，不阻断移除：记录必须能清掉，否则面板会永远挂着一条停不下来的链路。
   */
  const remove = async (id) => {
    const key = typeof id === "string" ? id.trim() : "";
    if (!ID_PATTERN.test(key)) throw new PurgeError("INVALID_PARAM", "链路标识不合法");
    // 快照在锁外读：abort 是一次宿主往返，不能占着索引锁把暂停、跳过一起堵住。
    const target = await withIndexLock(async () => {
      const index = await readIndex();
      const found = index.chains.find((item) => item.id === key) || null;
      return found ? cloneChain(found) : null;
    });
    const step = target?.steps?.[target.stepIndex] || null;
    const wasLive = Boolean(target) && ["running", "paused", "blocked"].includes(target.status);
    // 已结束的链路没有在跑的会话：不发无意义的中止请求。
    const abort =
      wasLive && step ? await abortStepRun(step) : { conversationId: "", aborted: false, reason: "" };
    return withIndexLock(async () => {
      const index = await readIndex();
      index.chains = index.chains.filter((chain) => chain.id !== key);
      await writeIndex(index);
      return {
        id: key,
        chains: index.chains,
        // 面板据此区分「本来就已结束」与「中止成功 / 中止失败」。
        wasLive,
        aborted: abort.aborted,
        abortedConversationId: abort.conversationId,
        abortReason: abort.reason,
      };
    });
  };

  const startLoop = (intervalMs = 15000) => {
    const timer = setInterval(() => {
      // step 内部自己用短锁读写索引：外层不能再包锁，否则又会把整轮巡检的宿主调用算进持锁时间。
      void step().catch((error) => log(`链路巡检失败：${error?.message || error}`));
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  };

  // 公开入口：跨进程调用已在各自函数内部移到锁外，这里不再用索引锁包住整个动作。
  return {
    start,
    list,
    step,
    pause,
    resume,
    skip,
    stop,
    remove,
    taskRefs,
    startLoop,
  };
}
