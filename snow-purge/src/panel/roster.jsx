// 红队编队弹窗：顶部概览 + 三个工作区（编队 / 链路 / 任务）。
// 运行数据来自宿主 conversations / runtime 元数据（子代理会话状态、模型、token、耗时、最近一条回复）；
// 链路每一环都自带任务清单，单步执行就是只有一环的链路，不再单独提供派发入口。
import { Fragment, getReact, h } from "./react.js";
import { Badge, Btn, EmptyState, ErrorBox, Spinner } from "./ui.jsx";
import { SESSION_DONE_STATUSES } from "../shared/roster-session.js";
import { ROSTER_BATCH_MAX, ROSTER_CHAIN_RUNNING_MAX } from "../shared/contract.js";

const NET = { width: 600, height: 372, cx: 300, cy: 174, radius: 126 };
const NODE_RADIUS = 42;
const POLL_MS = 8000;
const HINT_MS = 3200;
const CONFIRM_MS = 3500;
/** 启动链路的确认要读完会话数与任务数，留出更长的时间窗。 */
const CHAIN_CONFIRM_MS = 8000;
const STEP_TEXT_MAX = 300;

/** 五个角色绕中心均匀分布，从正上方开始顺时针排。 */
const nodePosition = (index) => {
  const angle = (-90 + index * 72) * (Math.PI / 180);
  return { x: NET.cx + Math.cos(angle) * NET.radius, y: NET.cy + Math.sin(angle) * NET.radius };
};

const STATUS_TONE = {
  running: "ok",
  completed: "ok",
  failed: "bad",
  cancelled: "warn",
  idle: "muted",
  unavailable: "muted",
  pending: "off",
  queued: "muted",
  missing: "bad",
};

const STATUS_LABEL = {
  running: "roster.status.running",
  completed: "roster.status.completed",
  failed: "roster.status.failed",
  cancelled: "roster.status.cancelled",
  idle: "roster.status.idle",
  unavailable: "roster.status.unavailable",
  pending: "roster.status.pending",
  queued: "roster.status.queued",
  missing: "roster.status.missing",
};

const CHAIN_ROLES = ["redteam_recon", "redteam_assess", "redteam_vuln_scan", "redteam_exploit", "redteam_internal"];

/** 默认参与的环节：只勾只读环节，验证与横向必须由用户手动勾选。 */
const DEFAULT_CHAIN_ROLES = ["redteam_recon", "redteam_assess", "redteam_vuln_scan"];

/** 与后台共用同一上限：超过时面板直接拦住，后台也会拒绝，不再静默截断。 */
const MAX_STEP_TASKS = ROSTER_BATCH_MAX;

/** 与后台共用并发上限：blocked 链路也占名额，达到上限时启动按钮直接禁用。 */
const CHAIN_RUNNING_MAX = ROSTER_CHAIN_RUNNING_MAX;

/** 启动确认里要单独点名的角色：它们会对靶标产生实际动作。 */
const HIGH_IMPACT_ROLES = ["redteam_exploit", "redteam_internal"];

const CHAIN_CONFIRM_KEY = "chain-start";

const CHAIN_TONE = { running: "ok", paused: "warn", blocked: "bad", completed: "ok", stopped: "muted" };

const MEMBER_FILTERS = [
  ["all", "roster.filter.all"],
  ["running", "roster.filter.running"],
  ["done", "roster.filter.done"],
  ["pending", "roster.filter.pending"],
];

const TASK_FILTERS = [
  ["all", "roster.filter.all"],
  ["running", "roster.filter.running"],
  ["done", "roster.filter.done"],
];

const fmtTokens = (value) => {
  const count = Number(value) || 0;
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
};

const fmtDuration = (ms) => {
  const value = Number(ms) || 0;
  if (value <= 0) return "-";
  const total = Math.round(value / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
};

const fmtTime = (value) => {
  const stamp = Number(value) || 0;
  if (!stamp) return "-";
  try {
    return new Date(stamp).toLocaleString();
  } catch {
    return "-";
  }
};

const shortModel = (model) => {
  const text = String(model || "").trim();
  if (!text) return "-";
  return text.length > 18 ? `${text.slice(0, 17)}…` : text;
};

const activityOf = (role) => (role?.activity && typeof role.activity === "object" ? role.activity : null);

const statusOf = (role, activityAvailable = true) => {
  if (!role?.installed) return "pending";
  // 宿主没有提供子代理会话数据时，无法判断角色在跑还是空闲：显示「未提供」而不是「空闲」。
  if (!activityAvailable) return "unavailable";
  const activity = activityOf(role);
  return activity?.status || "idle";
};

const stateTone = (role) => {
  if (!role?.installed) return "off";
  // 仅索引：宿主没有返回全局行，无法确认这条记录是否仍在宿主侧。
  if (role.verification === "index-only") return "warn";
  if (role.updateAvailable) return "warn";
  return "ok";
};

const stateLabel = (role, t) => {
  if (!role?.installed) return t("roster.state.pending");
  if (role.verification === "index-only") return t("roster.state.indexOnly");
  return role.updateAvailable ? t("roster.state.stale") : t("roster.state.ready");
};

/** 搜索框防抖：输入时只更新输入框，过滤在停顿后才重算，避免每敲一个字都重渲染整棵树。 */
const useDebounced = (React, value, delay) => {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
};

/** 相对时间需要低频心跳，不必按秒重渲染。 */
const useNow = (React, enabled, step = 5000) => {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => setNow(Date.now()), step);
    return () => clearInterval(timer);
  }, [enabled, step]);
  return now;
};

const fmtAgo = (now, stamp, t) => {
  if (!stamp) return t("roster.updated.none");
  const diff = Math.max(0, now - stamp);
  if (diff < 3000) return t("roster.updated.just");
  const seconds = Math.round(diff / 1000);
  if (seconds < 60) return t("roster.updated.seconds", { count: seconds });
  return t("roster.updated.minutes", { count: Math.round(seconds / 60) });
};

const IconRefresh = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 5v6h-6" />
  </svg>
);

const IconClose = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

const IconTrash = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" />
  </svg>
);

const IconChevron = ({ open }) => (
  <svg className="pg-chevron" data-open={open ? "1" : "0"} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

/** 每步的初始状态：默认只勾只读环节，任务清单为空表示使用内置任务书。 */
const initialSteps = () =>
  CHAIN_ROLES.map((roleId) => ({ roleId, enabled: DEFAULT_CHAIN_ROLES.includes(roleId), tasks: [] }));

export function RosterModal({ t, rpc, notify, onClose }) {
  const React = getReact();

  /* ---------------- 状态 ---------------- */

  const [state, setState] = React.useState({ status: "loading", error: "", data: null });
  const [tab, setTab] = React.useState("roster");
  const [selectedId, setSelectedId] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [prompt, setPrompt] = React.useState(null);
  const [searchInput, setSearchInput] = React.useState("");
  const [memberFilter, setMemberFilter] = React.useState("all");
  const [taskFilter, setTaskFilter] = React.useState("all");
  // 链路：靶标 + 每环节自带的任务清单；单步执行就是把其它环节取消勾选。
  const [chainForm, setChainForm] = React.useState({ target: "", note: "" });
  const [chainSteps, setChainSteps] = React.useState(initialSteps);
  const [openStep, setOpenStep] = React.useState("");
  const [stepDraft, setStepDraft] = React.useState("");
  // null 表示跟随数据自动展开：有链路记录就展开，用户手动切换后以用户为准。
  const [chainOpen, setChainOpen] = React.useState(null);
  // 危险动作的二次确认：同一个键在 3.5 秒内点第二次才真正执行。
  const [confirmKey, setConfirmKey] = React.useState("");
  const [hint, setHint] = React.useState(null);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [toolsOpen, setToolsOpen] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [updatedAt, setUpdatedAt] = React.useState(0);

  const dialogRef = React.useRef(null);
  const targetRef = React.useRef(null);
  const busyRef = React.useRef(false);
  busyRef.current = busy !== "";

  const search = useDebounced(React, searchInput, 200);
  const now = useNow(React, updatedAt > 0);

  /* ---------------- 取数 ---------------- */

  const load = React.useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setRefreshing(true);
      try {
        const data = await rpc.roster();
        if (!data) return;
        setState({ status: "ready", error: "", data });
        setUpdatedAt(Date.now());
        // [UX优化]: 默认选中一个已编入的角色，编队页打开就能看到有效信息。
        const firstReady = (data.roles || []).find((role) => role.installed) || data.roles?.[0] || null;
        const firstId = firstReady?.id || "";
        setSelectedId((current) => current || firstId);
      } catch (error) {
        const message = String(error?.message || error);
        // [UX优化]: 已有数据时不清空界面，降级为「数据可能过期」提示，避免一次轮询失败整屏变空。
        setState((prev) =>
          prev.data ? { ...prev, status: "stale", error: message } : { status: "error", error: message, data: null }
        );
      } finally {
        if (!silent) setRefreshing(false);
      }
    },
    [rpc]
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  // 弹窗打开期间轮询：宿主不推送状态；页面不可见或正在写操作时跳过，减少无谓请求。
  React.useEffect(() => {
    const timer = setInterval(() => {
      if (busyRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load({ silent: true });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // 右面板的 backdrop-filter 会给 fixed 后代创建包含块：这里按实际偏移把遮罩挪回视口原点。
  React.useEffect(() => {
    const el = dialogRef.current?.parentElement;
    if (!el) return undefined;
    const fix = () => {
      el.style.left = "0px";
      el.style.top = "0px";
      const rect = el.getBoundingClientRect();
      if (rect.left || rect.top) {
        el.style.left = `${-rect.left}px`;
        el.style.top = `${-rect.top}px`;
      }
    };
    fix();
    window.addEventListener("resize", fix);
    return () => window.removeEventListener("resize", fix);
  }, []);

  // [UX优化]: Esc 关闭 + Tab 焦点锁在弹窗内，关闭后把焦点还给打开它的按钮。
  React.useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  React.useEffect(() => {
    const node = dialogRef.current;
    if (!node) return undefined;
    const previous = document.activeElement;
    const selector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const first = node.querySelector(selector);
    (first || node).focus?.();

    const onKey = (event) => {
      if (event.key !== "Tab") return;
      const items = Array.from(node.querySelectorAll(selector)).filter(
        (el) => el === document.activeElement || el.offsetParent !== null || el instanceof SVGElement
      );
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  React.useEffect(() => {
    if (!hint) return undefined;
    const timer = setTimeout(() => setHint(null), HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  React.useEffect(() => {
    if (!confirmKey) return undefined;
    const ttl = confirmKey === CHAIN_CONFIRM_KEY ? CHAIN_CONFIRM_MS : CONFIRM_MS;
    const timer = setTimeout(() => setConfirmKey(""), ttl);
    return () => clearTimeout(timer);
  }, [confirmKey]);

  // 切到链路页时把焦点放到靶标输入，键盘用户可以直接开始填写。
  React.useEffect(() => {
    if (tab !== "chain") return;
    const node = targetRef.current;
    if (node && !node.value) node.focus();
  }, [tab]);

  const showHint = (tone, text) => setHint({ tone, text, id: Date.now() });

  /* ---------------- 编排动作 ---------------- */

  // [UX优化]: 写动作返回的是局部视图（有的带 chains，有的只有 tasks），
  // 按字段合并而不是整块覆盖，避免一次派发把链路列表清空。
  const VIEW_FIELDS = [
    "roles",
    "counts",
    "activity",
    "tasks",
    "tasksAvailable",
    "chains",
    "denied",
    "indexBroken",
    "indexReason",
  ];

  const mergeView = (result) => {
    if (!result || typeof result !== "object") return;
    setState((prev) => {
      if (!prev.data) return prev;
      const next = { ...prev.data };
      for (const field of VIEW_FIELDS) {
        if (result[field] !== undefined) next[field] = result[field];
      }
      return { ...prev, data: next };
    });
    setUpdatedAt(Date.now());
  };

  const run = async (key, task) => {
    if (busy) return null;
    setBusy(key);
    try {
      const result = await task();
      if (result) mergeView(result);
      return result;
    } catch (error) {
      notify("bad", String(error?.message || error));
      return null;
    } finally {
      setBusy("");
    }
  };

  const installOne = (role) => {
    // 覆盖外部同名子代理需要二次确认：第一次只探测并提示，第二次才带 confirm 写入。
    const confirming = confirmKey === `conflict-${role.id}`;
    return run(role.id, async () => {
      const result = await rpc.installRoster({ agentId: role.id, confirm: confirming });
      const item = result?.results?.[0] || {};
      const name = t(`roster.role.${role.id}.name`);
      if (item.action === "conflict") {
        setConfirmKey(`conflict-${role.id}`);
        showHint("warn", t("roster.conflict.hint", { name }));
        return result;
      }
      setConfirmKey("");
      if (item.indexError) {
        // 宿主已写入，但插件没能记下编入索引：面板会显示成未编入，必须明确提示。
        notify("warn", t("roster.toast.indexFailed", { name, message: item.indexError }));
      } else if (item.unverified) {
        // 索引里没有记录、读不到宿主侧的全局行：既无法核对，也无法为可能被覆盖的记录备份。
        notify("warn", t("roster.toast.unverified", { name }));
      } else if (item.overwritten) {
        notify("warn", t("roster.toast.overwritten", { name, file: item.backup || "-" }));
      } else if (item.backedUp && !item.overwritten) {
        notify("ok", t("roster.toast.backupSaved", { name, file: item.backup || "-" }));
      } else if (item.projectConflict) {
        notify("ok", t("roster.toast.projectConflict", { name }));
      } else {
        notify("ok", item.action === "updated" ? t("roster.toast.updated") : t("roster.toast.installed"));
      }
      return result;
    });
  };

  const installAll = () => {
    const confirming = confirmKey === "conflict-all";
    return run("all", async () => {
      const result = await rpc.installRoster({ all: true, confirm: confirming });
      const results = result?.results || [];
      const conflicts = results.filter((item) => item.action === "conflict");
      const failed = results.filter((item) => item.action === "failed");
      const overwritten = results.filter((item) => item.overwritten).length;
      const unverified = results.filter((item) => item.unverified).length;
      const indexFailed = results.filter((item) => item.indexError);
      const reason = failed[0]?.message ? ` ${String(failed[0].message).slice(0, 200)}` : "";
      if (conflicts.length) {
        // 冲突角色本轮没有写入：先列名单，第二次点击才备份并覆盖，与单角色编入同口径。
        const names = conflicts.map((item) => t(`roster.role.${item.id}.name`)).join("、");
        setConfirmKey("conflict-all");
        showHint("warn", t("roster.conflict.allHint", { count: conflicts.length, names }));
        if (failed.length) {
          notify("warn", `${t("roster.toast.partial", { count: failed.length })}${reason}`);
        }
        return result;
      }
      setConfirmKey("");
      if (failed.length) {
        notify("warn", `${t("roster.toast.partial", { count: failed.length })}${reason}`);
      } else if (indexFailed.length > 0) {
        notify(
          "warn",
          t("roster.toast.indexFailedAll", {
            count: indexFailed.length,
            message: indexFailed[0].indexError,
          })
        );
      } else if (overwritten > 0) {
        notify("warn", t("roster.toast.overwrittenAll", { count: overwritten }));
      } else if (unverified > 0) {
        notify("warn", t("roster.toast.unverifiedAll", { count: unverified }));
      } else {
        notify("ok", t("roster.toast.allDone"));
      }
      return result;
    });
  };

  /** 危险动作统一走「点两次」：第一次只提示，第二次才真正执行。 */
  const guard = (key, message, action) => {
    if (confirmKey !== key) {
      setConfirmKey(key);
      showHint("warn", message);
      return;
    }
    setConfirmKey("");
    void action();
  };

  const removeOne = (role) => {
    const key = `role-${role.id}`;
    const name = t(`roster.role.${role.id}.name`);
    if (confirmKey !== key) {
      setConfirmKey(key);
      // 先探测记录来源：索引里没有、或签名不一致时必须明确提示这不是本插件写入的记录。
      void rpc
        .removeRoster(role.id, false)
        .then((result) => {
          if (result?.foreign) showHint("warn", t("roster.confirm.foreignHint", { name }));
          else if (result?.drift) showHint("warn", t("roster.confirm.driftHint", { name }));
          else if (result?.indexBroken) showHint("warn", t("roster.confirm.indexBrokenHint", { name }));
          else showHint("warn", t("roster.confirm.hint", { name }));
        })
        .catch(() => showHint("warn", t("roster.confirm.hint", { name })));
      return;
    }
    setConfirmKey("");
    void run(`remove-${role.id}`, async () => {
      const result = await rpc.removeRoster(role.id, true);
      if (result?.needsConfirm) {
        // 后端仍要求确认（例如索引在两次点击之间被改写）：不要显示「未安装」，让用户再点一次。
        notify("warn", t("roster.confirm.foreignHint", { name }));
      } else if (result?.foreignRemoved) {
        notify("warn", t("roster.toast.removedForeignName", { name }));
      } else if (!result?.removed) {
        if (result?.existed) notify("bad", t("roster.toast.removeBlockedName", { name }));
        else notify("ok", t("roster.toast.notInstalledName", { name }));
      } else if (result.projectRemaining > 0) {
        // 全局记录已删掉，项目作用域仍有同名记录：不代删，提示用户去宿主按项目处理。
        notify("warn", t("roster.toast.removedGlobalOnly", { name, count: result.projectRemaining }));
      } else if (Array.isArray(result.backups) && result.backups.length > 0) {
        // 编入时覆盖过外部同名子代理：被覆盖的原配置还在备份目录里，可以手工回滚。
        notify("warn", t("roster.toast.removedWithBackup", { name, file: result.backups[0] }));
      } else {
        notify("ok", t("roster.toast.removedName", { name }));
      }
      if (prompt?.id === role.id) setPrompt(null);
      return result;
    });
  };

  const viewPrompt = async (role) => {
    if (prompt?.id === role.id) {
      setPrompt(null);
      return;
    }
    try {
      const data = await rpc.rosterRole(role.id);
      setPrompt({ id: role.id, systemPrompt: data?.systemPrompt || "" });
    } catch (error) {
      notify("bad", String(error?.message || error));
    }
  };

  /* ---------------- 环节任务编辑 ---------------- */

  const updateStep = (roleId, patch) => {
    // 任何改变派发量的编辑都要让启动确认失效：数字变了，用户确认的就不是这一份。
    setConfirmKey("");
    setChainSteps((current) => current.map((item) => (item.roleId === roleId ? { ...item, ...patch } : item)));
  };

  // [合并]: 单步执行不再走独立派发接口，而是只留一个环节的链路。
  const toggleStep = (roleId) => {
    setConfirmKey("");
    setChainSteps((current) =>
      current.map((item) => (item.roleId === roleId ? { ...item, enabled: !item.enabled } : item))
    );
  };

  const toggleStepTask = (roleId, text) => {
    // chip 调整同样改变派发量：确认态必须失效，与 updateStep / toggleStep 同口径。
    setConfirmKey("");
    setChainSteps((current) =>
      current.map((item) => {
        if (item.roleId !== roleId) return item;
        const tasks = item.tasks.includes(text) ? item.tasks.filter((value) => value !== text) : [...item.tasks, text];
        return { ...item, tasks };
      })
    );
  };

  const addStepTask = (roleId) => {
    const text = stepDraft.trim().slice(0, STEP_TEXT_MAX);
    if (!text) return;
    const step = chainSteps.find((item) => item.roleId === roleId);
    if (step?.tasks.includes(text)) {
      showHint("warn", t("roster.dispatch.duplicate"));
      return;
    }
    // 超过上限直接拦住：后台也会拒绝，不会再把多出来的任务静默丢掉。
    if ((step?.tasks.length || 0) >= MAX_STEP_TASKS) {
      showHint("warn", t("roster.chain.stepLimit", { max: MAX_STEP_TASKS }));
      return;
    }
    updateStep(roleId, { tasks: [...(step?.tasks || []), text] });
    setStepDraft("");
  };

  const removeStepTask = (roleId, offset) => {
    const step = chainSteps.find((item) => item.roleId === roleId);
    if (!step) return;
    updateStep(roleId, { tasks: step.tasks.filter((_, index) => index !== offset) });
  };

  // [合并]: 单步执行不再走独立派发接口，而是只留一个环节的链路。
  const startSingleStep = (role) => {
    // 从编队页跳到链路页会重设环节：上一份启动确认对应的已经不是这次派发。
    setConfirmKey("");
    setSelectedId(role.id);
    setChainSteps((current) => current.map((item) => ({ ...item, enabled: item.roleId === role.id })));
    setOpenStep(role.id);
    setStepDraft("");
    setTab("chain");
  };

  const startChain = () =>
    run("chain-start", async () => {
      const result = await rpc.startRosterChain({
        target: chainForm.target,
        note: chainForm.note,
        steps: chainSteps.filter((item) => item.enabled).map((item) => ({ roleId: item.roleId, tasks: item.tasks })),
      });
      const chain = result?.chain || null;
      const ok = chain?.status === "running";
      const archived = Number(chain?.archived) || 0;
      const truncated = Number(chain?.truncated) || 0;
      const trimmed = archived + truncated > 0 ? ` ${t("roster.chain.trimmed", { archived, truncated })}` : "";
      const text = ok ? `${t("roster.chain.started")}${trimmed}` : chain?.lastError || t("roster.chain.failed");
      notify(ok && !trimmed ? "ok" : "warn", text);
      if (ok) setChainForm((current) => ({ ...current, target: "" }));
      return result;
    });

  const chainAction = (chain, key, call, doneKey, resolve) =>
    run(`${key}-${chain.id}`, async () => {
      const result = await call(chain.id);
      // 链路的写接口不回传链路列表，补一次全量拉取，让进度立刻可见。
      await load({ silent: true });
      const next = typeof resolve === "function" ? resolve(result) : null;
      notify(next?.tone || "ok", next?.text || t(doneKey));
      // 写接口的视图早于上面的全量拉取：不返回给 run，避免它用旧快照覆盖刚拉到的最新状态。
      return null;
    });

  /**
   * 跳过本步会先中止当前环节的会话：确认文案必须写明这一点，
   * 否则用户会以为跳过只是「不再等待」，实际却会丢掉正在跑的证据。
   */
  const skipChain = (chain) =>
    guard(`skip-${chain.id}`, t("roster.confirm.skipHint"), () =>
      chainAction(chain, "skip", rpc.skipRosterChain, "roster.chain.skipped", (result) =>
        result?.aborted
          ? { tone: "ok", text: t("roster.chain.skippedAborted") }
          : {
              tone: "warn",
              text: t("roster.chain.skippedIdle", {
                reason: result?.abortReason || t("roster.chain.abortUnknown"),
              }),
            }
      )
    );

  /**
   * 继续/重派发：failed 步骤会在后台重新建会话，旧会话先被中止。
   * 提示必须区分「已重派发」「旧会话仍在跑」「读不到会话列表」，不能一律报成功。
   */
  const resumeChain = (chain) =>
    chainAction(chain, "resume", rpc.resumeRosterChain, "roster.chain.resumed", (result) => {
      if (result?.redispatched) {
        return result.aborted
          ? { tone: "ok", text: t("roster.chain.resumedRedispatched") }
          : {
              tone: "warn",
              text: t("roster.chain.resumedRedispatchedIdle", {
                reason: result.abortReason || t("roster.chain.abortUnknown"),
              }),
            };
      }
      if (result?.redispatchBlocked === "streaming") {
        return { tone: "warn", text: t("roster.chain.resumedStillRunning") };
      }
      if (result?.redispatchBlocked === "unavailable") {
        return { tone: "warn", text: t("roster.chain.resumedUnknown") };
      }
      if (result?.redispatchBlocked === "completed") {
        return { tone: "ok", text: t("roster.chain.resumedCompleted") };
      }
      if (result?.redispatchBlocked === "dispatch-failed") {
        return {
          tone: "warn",
          text: t("roster.chain.redispatchFailed", {
            reason: result?.chain?.lastError || result?.abortReason || t("roster.chain.abortUnknown"),
          }),
        };
      }
      return null;
    });

  /**
   * 启动前二次确认：一次点击会连续建多个会话并派发任务，含高影响角色时必须让用户看清范围。
   */
  const startChainConfirmed = () =>
    guard(
      CHAIN_CONFIRM_KEY,
      highImpactNames.length
        ? `${t("roster.chain.confirm", {
            target: chainTargetBrief,
            sessions: chainSessions,
            tasks: chainDispatches,
          })} ${t("roster.chain.confirmImpact", { names: highImpactNames.join("、") })}`
        : t("roster.chain.confirm", {
            target: chainTargetBrief,
            sessions: chainSessions,
            tasks: chainDispatches,
          }),
      startChain
    );

  const activateTask = (task) =>
    run(`open-${task.id}`, async () => {
      await rpc.activateRosterTask(task.id);
      notify("ok", t("roster.task.opened"));
      return null;
    });

  const removeTask = (task) =>
    guard(`task-${task.id}`, t("roster.confirm.taskHint"), () =>
      run(`drop-${task.id}`, async () => {
        const result = await rpc.removeRosterTask(task.id);
        if (Array.isArray(result?.tasks)) {
          setState((prev) => (prev.data ? { ...prev, data: { ...prev.data, tasks: result.tasks } } : prev));
        }
        // 并发删除、或记录已被归档挤出索引时后端返回 removed:false：不能报「已移除」。
        if (result?.removed === false) notify("warn", t("roster.task.notFound"));
        else notify("ok", t("roster.task.removed"));
        return null;
      })
    );

  const removeChain = (chain) =>
    guard(`chain-${chain.id}`, t("roster.confirm.chainHint"), () =>
      chainAction(chain, "drop", rpc.removeRosterChain, "roster.chain.removed", (result) => {
        // 已结束的链路本来就没有在跑的会话：沿用原提示，不额外吓人。
        if (!result?.wasLive) return null;
        return result.aborted
          ? { tone: "ok", text: t("roster.chain.removedAborted") }
          : {
              tone: "warn",
              text: t("roster.chain.removedIdle", {
                reason: result?.abortReason || t("roster.chain.abortUnknown"),
              }),
            };
      })
    );

  /* ---------------- 派生数据 ---------------- */

  const roles = React.useMemo(() => (Array.isArray(state.data?.roles) ? state.data.roles : []), [state.data]);
  const tasks = React.useMemo(() => (Array.isArray(state.data?.tasks) ? state.data.tasks : []), [state.data]);
  const chains = React.useMemo(() => (Array.isArray(state.data?.chains) ? state.data.chains : []), [state.data]);
  const counts = state.data?.counts || {};
  const activityInfo = state.data?.activity || null;
  const activityReady = activityInfo?.available === true;
  // 索引读写失败时，编入状态可能显示为未编入：在弹窗顶部如实提示原因。
  const indexBroken = state.data?.indexBroken === true;
  const indexReason = state.data?.indexReason || "";
  const statusOfRole = (role) => statusOf(role, activityReady);

  const installedCount =
    typeof counts.installed === "number" ? counts.installed : roles.filter((role) => role.installed).length;
  const totalCount = Number(counts.total) || roles.length;

  const current = roles.find((role) => role.id === selectedId) || roles[0] || null;

  const keyword = search.trim().toLowerCase();

  const memberCounts = React.useMemo(
    () => ({
      all: roles.length,
      // 宿主没有提供子代理会话数据时，运行中/已结束的数量无法判定：显示占位而不是 0。
      running: activityReady ? roles.filter((role) => statusOfRole(role) === "running").length : "-",
      done: activityReady
        ? roles.filter((role) => ["completed", "failed", "cancelled"].includes(statusOfRole(role))).length
        : "-",
      pending: roles.filter((role) => !role.installed).length,
    }),
    [roles, activityReady]
  );

  const visibleRoles = React.useMemo(
    () =>
      roles.filter((role) => {
        if (keyword) {
          const haystack = `${t(`roster.role.${role.id}.name`)} ${t(`roster.role.${role.id}.desc`)} ${role.name || ""} ${role.id}`.toLowerCase();
          if (!haystack.includes(keyword)) return false;
        }
        if (memberFilter === "running") return activityReady && statusOfRole(role) === "running";
        if (memberFilter === "done")
          return activityReady && ["completed", "failed", "cancelled"].includes(statusOfRole(role));
        if (memberFilter === "pending") return !role.installed;
        return true;
      }),
    [roles, keyword, memberFilter, t, activityReady]
  );

  const taskCounts = React.useMemo(
    () => ({
      all: tasks.length,
      running: tasks.filter((task) => task.status === "running" || task.status === "queued").length,
      done: tasks.filter((task) => SESSION_DONE_STATUSES.includes(task.status)).length,
    }),
    [tasks]
  );

  const visibleTasks = React.useMemo(
    () =>
      tasks.filter((task) => {
        if (taskFilter === "running") return task.status === "running" || task.status === "queued";
        if (taskFilter === "done") return SESSION_DONE_STATUSES.includes(task.status);
        return true;
      }),
    [tasks, taskFilter]
  );

  const pendingRoles = roles.filter((role) => !role.installed);
  const chainExpanded = chainOpen === null ? chains.length > 0 : chainOpen;
  const activeChains = chains.filter((chain) => ["running", "paused", "blocked"].includes(chain.status)).length;
  const chainSlotsFull = activeChains >= CHAIN_RUNNING_MAX;
  const enabledSteps = chainSteps.filter((step) => step.enabled);
  // 按后台真实投递规则计数：每环至少 1 条任务（空清单回落内置任务书），最多 8 条。
  const chainSessions = enabledSteps.length;
  const chainDispatches = enabledSteps.reduce(
    (total, step) => total + Math.max(1, Math.min(step.tasks.length, MAX_STEP_TASKS)),
    0
  );
  const highImpactNames = enabledSteps
    .filter((step) => HIGH_IMPACT_ROLES.includes(step.roleId))
    .map((step) => t(`roster.role.${step.roleId}.name`));
  // 确认文案要显示靶标：与启动拦截同一口径取 trim 后的值，过长时截断展示。
  const chainTarget = chainForm.target.trim();
  const chainTargetBrief = chainTarget.length > 60 ? `${chainTarget.slice(0, 59)}…` : chainTarget;
  const chainConfirming = confirmKey === CHAIN_CONFIRM_KEY;

  // 所选环节里还没编入的角色：宿主找不到对应子代理时会白建会话，启动前就拦住。
  const installedRoleIds = new Set(roles.filter((role) => role.installed).map((role) => role.id));
  const missingRoles =
    roles.length === 0
      ? []
      : enabledSteps.filter((step) => !installedRoleIds.has(step.roleId)).map((step) => step.roleId);

  // [UX优化]: 启动按钮禁用时说明缺什么，用户不用靠猜。
  const overLimitStep = enabledSteps.find((step) => step.tasks.length > MAX_STEP_TASKS) || null;
  const chainBlock = !chainForm.target.trim()
    ? t("roster.chain.blocked.target")
    : enabledSteps.length === 0
      ? t("roster.chain.blocked.steps")
      : missingRoles.length > 0
        ? t("roster.chain.blocked.roles", {
            names: missingRoles.map((id) => t(`roster.role.${id}.name`)).join("、"),
          })
        : overLimitStep
          ? t("roster.chain.blocked.stepLimit", {
              name: t(`roster.role.${overLimitStep.roleId}.name`),
              count: overLimitStep.tasks.length,
              max: MAX_STEP_TASKS,
            })
          : chainSlotsFull
            ? t("roster.chain.blocked.active", { max: CHAIN_RUNNING_MAX })
            : "";

  const updatedLabel = fmtAgo(now, updatedAt, t);
  const summaryText =
    state.status === "loading"
      ? t("common.loading")
      : t("roster.summary", {
          installed: installedCount,
          total: totalCount,
          running: activityReady ? Number(counts.running) || memberCounts.running : "-",
          tasks: taskCounts.running,
        });

  const resetMemberFilter = () => {
    setSearchInput("");
    setMemberFilter("all");
  };

  const canClose = busy === "";

  /* ---------------- 渲染 ---------------- */

  return (
    <div
      className="pg-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && canClose) onClose();
      }}
    >
      <div
        className="pg-modal pg-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pg-roster-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="pg-modal-head">
          <div className="pg-modal-title">
            <span id="pg-roster-title">{t("roster.title")}</span>
            <span className="pg-modal-sum" aria-live="polite">
              {summaryText}
            </span>
          </div>
          <div className="pg-modal-actions">
            <span className="pg-updated">{updatedLabel}</span>
            <button
              type="button"
              className="pg-icon-btn"
              data-spinning={refreshing ? "1" : "0"}
              title={t("roster.refresh")}
              aria-label={t("roster.refresh")}
              disabled={refreshing || busy !== ""}
              onClick={() => void load({ silent: true })}
            >
              <IconRefresh />
            </button>
            {pendingRoles.length > 0 ? (
              <Btn
                size="sm"
                variant={confirmKey === "conflict-all" ? "danger" : "primary"}
                disabled={busy !== ""}
                title={t("roster.installAllHint")}
                onClick={() => void installAll()}
              >
                {busy === "all" ? (
                  <Fragment>
                    <Spinner />
                    <span>{t("roster.installingAll")}</span>
                  </Fragment>
                ) : confirmKey === "conflict-all" ? (
                  t("roster.installAllConfirm")
                ) : (
                  t("roster.installAllCount", { count: pendingRoles.length })
                )}
              </Btn>
            ) : null}
            <button type="button" className="pg-modal-x" title={t("roster.close")} aria-label={t("roster.close")} onClick={onClose}>
              <IconClose />
            </button>
          </div>
        </div>

        <div className="pg-modal-tabs">
          <div className="pg-modal-tablist" role="tablist" aria-label={t("roster.title")}>
            {[
              ["roster", "roster.tab.roster", memberCounts.all],
              ["chain", "roster.tab.chain", enabledSteps.length],
              ["tasks", "roster.tab.tasks", taskCounts.running],
            ].map(([id, label, num]) => (
              <button
                key={id}
                type="button"
                className="pg-modal-tab"
                role="tab"
                id={`pg-roster-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`pg-roster-panel-${id}`}
                data-active={tab === id ? "1" : "0"}
                onClick={() => setTab(id)}
              >
                <span>{t(label)}</span>
                {num > 0 ? <span className="pg-modal-tab-num">{num}</span> : null}
              </button>
            ))}
          </div>
          {activeChains > 0 ? (
            <span className="pg-modal-tab-note">{t("roster.tab.chains", { count: activeChains })}</span>
          ) : null}
        </div>

        {hint ? (
          <div className="pg-flash" data-tone={hint.tone} role="status">
            {hint.text}
          </div>
        ) : null}

        {state.status === "stale" ? (
          <div className="pg-modal-note pg-inline-warn">{t("roster.stale", { message: state.error })}</div>
        ) : null}

        {indexBroken ? (
          <div className="pg-modal-note pg-inline-warn">
            {t("roster.indexBroken.hint", { message: indexReason || "-" })}
          </div>
        ) : null}

        {state.status === "loading" ? (
          <div className="pg-modal-body" data-layout="split" aria-busy="true">
            <div className="pg-skel-col">
              <div className="pg-skel pg-skel-net" />
              <div className="pg-skel pg-skel-line" />
              <div className="pg-skel pg-skel-line pg-skel-line-short" />
            </div>
            <div className="pg-skel-col">
              {[0, 1, 2, 3].map((index) => (
                <div className="pg-skel pg-skel-card" key={index} />
              ))}
            </div>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="pg-modal-loading">
            <ErrorBox
              title={t("error.title")}
              message={state.error}
              action={
                <Btn size="sm" variant="primary" onClick={() => void load()}>
                  {t("action.retry")}
                </Btn>
              }
            />
          </div>
        ) : null}

        {state.status === "ready" || state.status === "stale" ? (
          <Fragment>
            {tab === "roster" ? (
              <div className="pg-modal-body" data-layout="split" role="tabpanel" id="pg-roster-panel-roster" aria-labelledby="pg-roster-tab-roster">
                <div className="pg-roster-left">
                  <div className="pg-roster-head">
                    <span>{t("roster.net.title")}</span>
                    <span className="pg-meta">
                      {activityInfo?.available
                        ? t("roster.net.totals", {
                            tokens: fmtTokens(activityInfo?.totals?.tokens || 0),
                            requests: activityInfo?.totals?.requests || 0,
                          })
                        : t("roster.net.unavailable")}
                    </span>
                  </div>

                  <svg className="pg-net" viewBox={`0 0 ${NET.width} ${NET.height}`} role="group" aria-label={t("roster.net.title")}>
                    {roles.map((role, index) => {
                      const pos = nodePosition(index);
                      const active = current?.id === role.id;
                      const activity = activityOf(role);
                      const status = statusOfRole(role);
                      const metric = activity
                        ? `${fmtTokens(activity.totalTokens)} · ${fmtDuration(
                            activity.status === "running" && activity.live ? activity.live.elapsedMs : activity.totalDurationMs
                          )}`
                        : t(activityReady ? "roster.activity.none" : "roster.activity.unavailable");
                      return (
                        <g
                          key={role.id}
                          className={`pg-net-node${role.installed ? " is-installed" : ""}${active ? " is-active" : ""}${
                            status === "running" ? " is-running" : ""
                          }`}
                          role="button"
                          tabIndex={0}
                          aria-pressed={active}
                          aria-label={`${t(`roster.role.${role.id}.name`)} · ${t(STATUS_LABEL[status] || "roster.status.idle")} · ${metric}`}
                          onClick={() => setSelectedId(role.id)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            setSelectedId(role.id);
                          }}
                        >
                          <line className="pg-net-link" x1={NET.cx} y1={NET.cy} x2={pos.x} y2={pos.y} />
                          {status === "running" ? <circle className="pg-net-ring" cx={pos.x} cy={pos.y} r={NODE_RADIUS + 8} /> : null}
                          <circle className="pg-net-dot" cx={pos.x} cy={pos.y} r={NODE_RADIUS} />
                          <text className="pg-net-label" x={pos.x} y={pos.y - 2} textAnchor="middle">
                            {t(`roster.role.${role.id}.name`)}
                          </text>
                          <text className="pg-net-sub" x={pos.x} y={pos.y + 15} textAnchor="middle">
                            {t(STATUS_LABEL[status] || "roster.status.idle")}
                          </text>
                          <text className="pg-net-meta" x={pos.x} y={pos.y + 58} textAnchor="middle">
                            {metric}
                          </text>
                        </g>
                      );
                    })}
                    <g className="pg-net-core">
                      <circle className="pg-net-dot" cx={NET.cx} cy={NET.cy} r={NODE_RADIUS + 8} />
                      <text className="pg-net-label" x={NET.cx} y={NET.cy - 4} textAnchor="middle">
                        {t("roster.core")}
                      </text>
                      <text className="pg-net-sub" x={NET.cx} y={NET.cy + 14} textAnchor="middle">
                        {t("roster.coreSub")}
                      </text>
                    </g>
                  </svg>

                  {/* [UX优化]: 窄屏下环形图缩到一半会看不清，改为同数据的紧凑列表。 */}
                  <div className="pg-net-list">
                    {roles.map((role) => {
                      const status = statusOfRole(role);
                      const activity = activityOf(role);
                      return (
                        <button
                          key={role.id}
                          type="button"
                          className="pg-net-row"
                          data-active={current?.id === role.id ? "1" : "0"}
                          onClick={() => setSelectedId(role.id)}
                        >
                          <span className="pg-net-row-main">
                            <span className="pg-roster-name">{t(`roster.role.${role.id}.name`)}</span>
                            <span className="pg-meta">{t(STATUS_LABEL[status] || "roster.status.idle")}</span>
                          </span>
                          <span className="pg-meta pg-mono">
                            {activity
                              ? `${fmtTokens(activity.totalTokens)} · ${fmtDuration(activity.totalDurationMs)}`
                              : t(activityReady ? "roster.activity.none" : "roster.activity.unavailable")}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="pg-net-caption">
                    <span>{t("roster.net.caption")}</span>
                    <button
                      type="button"
                      className="pg-link"
                      aria-expanded={helpOpen}
                      onClick={() => setHelpOpen((value) => !value)}
                    >
                      {helpOpen ? t("roster.helpHide") : t("roster.help")}
                    </button>
                  </div>
                  {helpOpen ? (
                    <div className="pg-help">
                      <p>{t("roster.netHint")}</p>
                      <p>{t("roster.boundary")}</p>
                    </div>
                  ) : null}

                  {current ? (
                    <section className="pg-role-detail" aria-label={t(`roster.role.${current.id}.name`)}>
                      <div className="pg-role-detail-head">
                        <span className="pg-role-detail-name">{t(`roster.role.${current.id}.name`)}</span>
                        <Badge tone={STATUS_TONE[statusOfRole(current)] || "muted"}>
                          {t(STATUS_LABEL[statusOfRole(current)] || "roster.status.idle")}
                        </Badge>
                        <Badge tone={stateTone(current)}>{stateLabel(current, t)}</Badge>
                        <span className="pg-meta pg-mono">{current.id}</span>
                      </div>
                      <p className="pg-role-detail-desc">{t(`roster.role.${current.id}.desc`)}</p>
                      <div className="pg-role-metrics">
                        <span title={activityOf(current)?.model || "-"}>
                          {`${t("roster.meta.model")} ${
                            activityOf(current) ? shortModel(activityOf(current).model) : t("roster.value.unavailable")
                          }`}
                        </span>
                        <span>{`${t("roster.meta.tokens")} ${
                          activityOf(current) ? fmtTokens(activityOf(current).totalTokens) : t("roster.value.unavailable")
                        }`}</span>
                        <span>{`${t("roster.meta.time")} ${
                          activityOf(current) ? fmtDuration(activityOf(current).totalDurationMs) : t("roster.value.unavailable")
                        }`}</span>
                        <span>{`${t("roster.meta.requests")} ${
                          activityOf(current) ? activityOf(current).requests || 0 : t("roster.value.unavailable")
                        }`}</span>
                      </div>
                      <div className="pg-role-block">
                        <div className="pg-role-block-head">{t("roster.detail.templates")}</div>
                        <ol className="pg-roster-tasks">
                          {[1, 2, 3].map((index) => (
                            <li className="pg-roster-task" key={index}>
                              <span className="pg-roster-task-no">{String(index).padStart(2, "0")}</span>
                              <span>{t(`roster.role.${current.id}.t${index}`)}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div className="pg-roster-actions">
                        <Btn size="sm" variant="ghost" onClick={() => void viewPrompt(current)}>
                          {prompt?.id === current.id ? t("roster.promptHide") : t("roster.prompt")}
                        </Btn>
                        <button
                          type="button"
                          className="pg-link"
                          aria-expanded={toolsOpen}
                          onClick={() => setToolsOpen((value) => !value)}
                        >
                          {t("roster.detail.tools", { count: (current.tools || []).length })}
                        </button>
                        {activityOf(current)?.conversationId ? (
                          <span className="pg-meta">{t("roster.detail.lastConversation")}</span>
                        ) : null}
                      </div>
                      {toolsOpen ? (
                        <div className="pg-chips">
                          {(current.tools || []).map((tool) => (
                            <span className="pg-chip pg-mono" key={tool}>
                              {tool}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {prompt?.id === current.id ? <pre className="pg-pre pg-pre-sm">{prompt.systemPrompt}</pre> : null}
                    </section>
                  ) : null}
                </div>

                <div className="pg-roster-right">
                  <div className="pg-roster-head">
                    <span>{t("roster.members")}</span>
                    <span className="pg-meta">{t("roster.membersHint")}</span>
                  </div>
                  {counts.indexOnly > 0 ? (
                    <div className="pg-note pg-inline-warn">
                      {t("roster.verify.hint", { count: counts.indexOnly })}
                    </div>
                  ) : null}
                  <div className="pg-roster-toolbar">
                    <div className="pg-search">
                      <input
                        className="pg-input"
                        value={searchInput}
                        placeholder={t("roster.search")}
                        aria-label={t("roster.search")}
                        onChange={(event) => setSearchInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape" || !searchInput) return;
                          // 输入框内的 Esc 先清空搜索，不关闭弹窗。
                          event.preventDefault();
                          event.stopPropagation();
                          setSearchInput("");
                        }}
                      />
                      {searchInput ? (
                        <button
                          type="button"
                          className="pg-icon-btn pg-search-clear"
                          title={t("roster.search.clear")}
                          aria-label={t("roster.search.clear")}
                          onClick={() => setSearchInput("")}
                        >
                          <IconClose />
                        </button>
                      ) : null}
                    </div>
                    <div className="pg-chips">
                      {MEMBER_FILTERS.map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className="pg-chip"
                          data-tone={memberFilter === id ? "ok" : undefined}
                          aria-pressed={memberFilter === id}
                          onClick={() => setMemberFilter(id)}
                        >
                          {`${t(label)} ${memberCounts[id] ?? 0}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pg-roster-list">
                    {visibleRoles.length === 0 ? (
                      <EmptyState
                        title={t("roster.empty.filtered.title")}
                        hint={t("roster.empty.filtered.hint")}
                        action={
                          <Btn size="sm" onClick={resetMemberFilter}>
                            {t("roster.empty.filtered.action")}
                          </Btn>
                        }
                      />
                    ) : null}
                    {visibleRoles.map((role, index) => {
                      const activity = activityOf(role);
                      const status = statusOfRole(role);
                      const active = current?.id === role.id;
                      const installing = busy === role.id;
                      const confirming = confirmKey === `role-${role.id}`;
                      return (
                        <article key={role.id} className={`pg-roster-card${active ? " is-active" : ""}`}>
                          <button
                            type="button"
                            className="pg-roster-card-head"
                            aria-pressed={active}
                            onClick={() => setSelectedId(role.id)}
                          >
                            <span className="pg-roster-no">{String(index + 1).padStart(2, "0")}</span>
                            <span className="pg-roster-name">{t(`roster.role.${role.id}.name`)}</span>
                            <Badge tone={STATUS_TONE[status] || "muted"}>
                              {t(STATUS_LABEL[status] || "roster.status.idle")}
                            </Badge>
                            <Badge tone={stateTone(role)}>{stateLabel(role, t)}</Badge>
                          </button>
                          <div className="pg-roster-desc" title={t(`roster.role.${role.id}.desc`)}>
                            {t(`roster.role.${role.id}.desc`)}
                          </div>
                          <div className="pg-roster-meta">
                            <span title={activity?.model || "-"}>{`${t("roster.meta.model")} ${
                              activity ? shortModel(activity.model) : t("roster.value.unavailable")
                            }`}</span>
                            <span>{`${t("roster.meta.tokens")} ${
                              activity ? fmtTokens(activity.totalTokens) : t("roster.value.unavailable")
                            }`}</span>
                            <span>{`${t("roster.meta.time")} ${
                              activity ? fmtDuration(activity.totalDurationMs) : t("roster.value.unavailable")
                            }`}</span>
                            <span>{`${t("roster.meta.requests")} ${
                              activity ? activity.requests || 0 : t("roster.value.unavailable")
                            }`}</span>
                          </div>
                          <div
                            className="pg-roster-preview"
                            data-tone={activity?.error ? "bad" : undefined}
                            title={activity?.error || activity?.preview || ""}
                          >
                            {activity?.error ||
                              activity?.preview ||
                              t(activityReady ? "roster.activity.none" : "roster.activity.unavailable")}
                          </div>
                          <div className="pg-roster-actions">
                            <Btn
                              size="sm"
                              variant={role.installed ? "ghost" : "primary"}
                              disabled={busy !== ""}
                              onClick={() => void installOne(role)}
                            >
                              {installing ? (
                                <Fragment>
                                  <Spinner />
                                  <span>{t("roster.installing")}</span>
                                </Fragment>
                              ) : !role.installed ? (
                                t("roster.install")
                              ) : role.updateAvailable ? (
                                t("roster.update")
                              ) : (
                                t("roster.reinstall")
                              )}
                            </Btn>
                            <Btn size="sm" variant="ghost" disabled={busy !== ""} onClick={() => startSingleStep(role)}>
                              {t("roster.chain.singleStep")}
                            </Btn>
                            <Btn
                              size="sm"
                              variant={confirming ? "danger" : "ghost"}
                              disabled={busy !== ""}
                              onClick={() => removeOne(role)}
                            >
                              {confirming ? t("roster.confirm.remove") : t("action.remove")}
                            </Btn>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {tab === "chain" ? (
              <div className="pg-modal-body" data-layout="single" role="tabpanel" id="pg-roster-panel-chain" aria-labelledby="pg-roster-tab-chain">
                <div className="pg-chain-page">
                  <div className="pg-roster-head">
                    <span>{t("roster.chain.title")}</span>
                    <span className="pg-meta">{t("roster.chain.hint")}</span>
                  </div>

                  <div className="pg-task-form">
                    <div className="pg-form-row">
                      <label className="pg-form-label" htmlFor="pg-chain-target">
                        {t("roster.chain.target")}
                      </label>
                      <input
                        id="pg-chain-target"
                        ref={targetRef}
                        className="pg-input"
                        value={chainForm.target}
                        placeholder={t("roster.dispatch.targetHint")}
                        aria-describedby="pg-chain-target-help"
                        onChange={(event) => {
                          // 靶标变了，上一份确认对应的已经不是这次派发。
                          setConfirmKey("");
                          setChainForm((value) => ({ ...value, target: event.target.value }));
                        }}
                      />
                    </div>
                    <div className="pg-field-help" id="pg-chain-target-help">
                      {t("roster.dispatch.targetHelp")}
                    </div>

                    <div className="pg-form-block">
                      <span className="pg-form-label">{t("roster.chain.steps")}</span>
                      <div className="pg-steps">
                        {CHAIN_ROLES.map((roleId, index) => {
                          const step = chainSteps.find((item) => item.roleId === roleId) || {
                            roleId,
                            enabled: false,
                            tasks: [],
                          };
                          const expanded = openStep === roleId;
                          const tasksLabel = step.tasks.length
                            ? step.tasks.length > MAX_STEP_TASKS
                              ? t("roster.chain.stepOver", { count: step.tasks.length, max: MAX_STEP_TASKS })
                              : t("roster.chain.stepTasks", { count: step.tasks.length })
                            : t("roster.chain.stepDefault");
                          return (
                            <div
                              className="pg-step"
                              key={roleId}
                              data-enabled={step.enabled ? "1" : "0"}
                              data-open={expanded ? "1" : "0"}
                            >
                              <div className="pg-step-head">
                                <input
                                  type="checkbox"
                                  className="pg-step-check"
                                  checked={step.enabled}
                                  aria-label={t("roster.chain.toggleStep", { name: t(`roster.role.${roleId}.name`) })}
                                  onChange={() => toggleStep(roleId)}
                                />
                                <span className="pg-step-no">{String(index + 1).padStart(2, "0")}</span>
                                <span className="pg-step-name">{t(`roster.role.${roleId}.name`)}</span>
                                <span className="pg-step-sub">{tasksLabel}</span>
                                <button
                                  type="button"
                                  className="pg-link"
                                  aria-expanded={expanded}
                                  aria-controls={`pg-step-${roleId}`}
                                  onClick={() => {
                                    setOpenStep(expanded ? "" : roleId);
                                    setStepDraft("");
                                  }}
                                >
                                  {expanded ? t("roster.chain.collapse") : t("roster.chain.edit")}
                                </button>
                              </div>
                              {expanded ? (
                                <div className="pg-step-body" id={`pg-step-${roleId}`}>
                                  <div className="pg-step-brief">{t(`roster.chain.brief.${roleId}`)}</div>
                                  <div className="pg-chips">
                                    {[1, 2, 3].map((number) => {
                                      const text = t(`roster.role.${roleId}.t${number}`);
                                      const selected = step.tasks.includes(text);
                                      return (
                                        <button
                                          type="button"
                                          key={number}
                                          className="pg-chip"
                                          data-tone={selected ? "ok" : undefined}
                                          aria-pressed={selected}
                                          onClick={() => toggleStepTask(roleId, text)}
                                        >
                                          {text}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div className="pg-inline-field">
                                    <input
                                      className="pg-input"
                                      value={stepDraft}
                                      maxLength={STEP_TEXT_MAX}
                                      disabled={step.tasks.length >= MAX_STEP_TASKS}
                                      title={
                                        step.tasks.length >= MAX_STEP_TASKS
                                          ? t("roster.chain.stepLimit", { max: MAX_STEP_TASKS })
                                          : undefined
                                      }
                                      placeholder={t("roster.chain.stepAddHint")}
                                      onChange={(event) => setStepDraft(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key !== "Enter") return;
                                        event.preventDefault();
                                        addStepTask(roleId);
                                      }}
                                    />
                                    <Btn
                                      size="sm"
                                      variant="ghost"
                                      disabled={!stepDraft.trim() || step.tasks.length >= MAX_STEP_TASKS}
                                      onClick={() => addStepTask(roleId)}
                                    >
                                      {t("roster.chain.stepAdd")}
                                    </Btn>
                                  </div>
                                  {step.tasks.length ? (
                                    <div className="pg-queue-list">
                                      {step.tasks.map((text, offset) => (
                                        <div className="pg-queue-item" key={`${roleId}-${offset}`}>
                                          <span className="pg-queue-no">{String(offset + 1).padStart(2, "0")}</span>
                                          <span className="pg-queue-text">{text}</span>
                                          <button
                                            type="button"
                                            className="pg-icon-btn"
                                            title={t("roster.chain.stepRemove")}
                                            aria-label={t("roster.chain.stepRemove")}
                                            onClick={() => removeStepTask(roleId, offset)}
                                          >
                                            <IconTrash />
                                          </button>
                                        </div>
                                      ))}
                                      <button type="button" className="pg-link" onClick={() => updateStep(roleId, { tasks: [] })}>
                                        {t("roster.chain.stepReset")}
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="pg-form-block">
                      <label className="pg-form-label" htmlFor="pg-chain-note">
                        {t("roster.dispatch.note")}
                      </label>
                      <textarea
                        id="pg-chain-note"
                        className="pg-textarea"
                        rows={2}
                        value={chainForm.note}
                        placeholder={t("roster.chain.noteHint")}
                        onChange={(event) => {
                          // 补充说明会进入派发文本，同样属于派发内容。
                          setConfirmKey("");
                          setChainForm((value) => ({ ...value, note: event.target.value }));
                        }}
                      />
                    </div>

                    <div className="pg-chain-submit">
                      <span className="pg-submit-note" aria-live="polite">
                        {chainBlock ||
                          (chainConfirming
                            ? t("roster.chain.confirm", {
                                target: chainTargetBrief,
                                sessions: chainSessions,
                                tasks: chainDispatches,
                              })
                            : t("roster.chain.review", {
                                target: chainTargetBrief,
                                count: chainSessions,
                                sessions: chainSessions,
                                tasks: chainDispatches,
                              }))}
                      </span>
                      <Btn
                        size="sm"
                        variant={chainConfirming ? "danger" : "primary"}
                        disabled={busy !== "" || Boolean(chainBlock)}
                        onClick={startChainConfirmed}
                      >
                        {busy === "chain-start" ? (
                          <Fragment>
                            <Spinner />
                            <span>{t("roster.chain.starting")}</span>
                          </Fragment>
                        ) : chainConfirming ? (
                          t("roster.chain.startConfirm", {
                            sessions: chainSessions,
                            tasks: chainDispatches,
                          })
                        ) : (
                          t("roster.chain.start")
                        )}
                      </Btn>
                    </div>
                  </div>

                  <section className="pg-chain-records" data-open={chainExpanded ? "1" : "0"}>
                    <button
                      type="button"
                      className="pg-chain-toggle"
                      aria-expanded={chainExpanded}
                      onClick={() => setChainOpen(!chainExpanded)}
                    >
                      <IconChevron open={chainExpanded} />
                      <span className="pg-chain-title">{t("roster.chain.records")}</span>
                      <span className="pg-meta">
                        {chains.length
                          ? t("roster.chain.summary", { count: chains.length, active: activeChains })
                          : t("roster.chain.empty")}
                      </span>
                    </button>

                    {chainExpanded ? (
                      chains.length === 0 ? (
                        <div className="pg-chain-body">
                          <div className="pg-note">{t("roster.chain.empty")}</div>
                        </div>
                      ) : (
                        <div className="pg-chain-body">
                          <div className="pg-chain-list">
                            {chains.map((chain) => {
                              const step = chain.steps[chain.stepIndex] || null;
                              const total = chain.steps.length;
                              const done = chain.steps.filter((item) => ["completed", "skipped"].includes(item.status)).length;
                              const confirming = confirmKey === `chain-${chain.id}`;
                              const skipping = confirmKey === `skip-${chain.id}`;
                              return (
                                <div className="pg-chain-item" key={chain.id}>
                                  <div className="pg-chain-head">
                                    <Badge tone={CHAIN_TONE[chain.status] || "muted"}>
                                      {t(`roster.chain.status.${chain.status}`)}
                                    </Badge>
                                    <span className="pg-task-target" title={chain.target}>
                                      {chain.target}
                                    </span>
                                    <span className="pg-meta">{t("roster.chain.progress", { done, total })}</span>
                                    <div className="pg-chain-actions">
                                      {chain.status === "running" ? (
                                        <Btn
                                          size="sm"
                                          variant="ghost"
                                          disabled={busy !== ""}
                                          onClick={() => void chainAction(chain, "pause", rpc.pauseRosterChain, "roster.chain.paused")}
                                        >
                                          {t("roster.chain.pause")}
                                        </Btn>
                                      ) : null}
                                      {chain.status === "paused" || chain.status === "blocked" ? (
                                        <Btn
                                          size="sm"
                                          variant="ghost"
                                          disabled={busy !== ""}
                                          onClick={() => void resumeChain(chain)}
                                        >
                                          {step?.status === "failed"
                                            ? t("roster.chain.redispatch")
                                            : t("roster.chain.resume")}
                                        </Btn>
                                      ) : null}
                                      {["running", "paused", "blocked"].includes(chain.status) ? (
                                        <Btn
                                          size="sm"
                                          variant={skipping ? "danger" : "ghost"}
                                          disabled={busy !== ""}
                                          onClick={() => skipChain(chain)}
                                        >
                                          {skipping ? t("roster.confirm.skip") : t("roster.chain.skip")}
                                        </Btn>
                                      ) : null}
                                      {["running", "paused", "blocked"].includes(chain.status) ? (
                                        <Btn
                                          size="sm"
                                          variant="ghost"
                                          disabled={busy !== ""}
                                          onClick={() =>
                                            void chainAction(
                                              chain,
                                              "stop",
                                              rpc.stopRosterChain,
                                              "roster.chain.stopped",
                                              (result) =>
                                                result?.aborted
                                                  ? { tone: "warn", text: t("roster.chain.stopAborted") }
                                                  : {
                                                      tone: "warn",
                                                      text: t("roster.chain.stopIdle", {
                                                        reason:
                                                          result?.abortReason || t("roster.chain.abortUnknown"),
                                                      }),
                                                    }
                                            )
                                          }
                                        >
                                          {t("roster.chain.stop")}
                                        </Btn>
                                      ) : null}
                                      <Btn
                                        size="sm"
                                        variant={confirming ? "danger" : "ghost"}
                                        disabled={busy !== ""}
                                        onClick={() => removeChain(chain)}
                                      >
                                        {confirming ? t("roster.confirm.remove") : t("roster.chain.remove")}
                                      </Btn>
                                    </div>
                                  </div>
                                  <div className="pg-chain-steps">
                                    {chain.steps.map((item, index) => {
                                      const stepTasks = Array.isArray(item.tasks) ? item.tasks : [];
                                      return (
                                        <span
                                          className="pg-chain-step"
                                          key={`${chain.id}-${item.roleId}`}
                                          data-state={item.liveStatus || item.status}
                                          data-current={
                                            index === chain.stepIndex && ["running", "paused", "blocked"].includes(chain.status)
                                              ? "1"
                                              : undefined
                                          }
                                          title={stepTasks.length ? stepTasks.join("\n") : t(`roster.chain.brief.${item.roleId}`)}
                                        >
                                          {`${index + 1}. ${t(`roster.role.${item.roleId}.name`)}${
                                            stepTasks.length > 1 ? `（${stepTasks.length}）` : ""
                                          }`}
                                        </span>
                                      );
                                    })}
                                  </div>
                                  {chain.lastError ? (
                                    <div className="pg-roster-preview" data-tone="bad" title={chain.lastError}>
                                      {chain.lastError}
                                    </div>
                                  ) : step?.statusReason ? (
                                    <div className="pg-note" title={step.statusReason}>
                                      {step.statusReason}
                                    </div>
                                  ) : step?.preview ? (
                                    <div className="pg-task-preview" title={step.preview}>
                                      {step.preview}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )
                    ) : null}
                  </section>
                </div>
              </div>
            ) : null}

            {tab === "tasks" ? (
              <div className="pg-modal-body" data-layout="single" role="tabpanel" id="pg-roster-panel-tasks" aria-labelledby="pg-roster-tab-tasks">
                <div className="pg-tasks">
                  <div className="pg-roster-head">
                    <span>{t("roster.tasks.title")}</span>
                    <span className="pg-meta">{t("roster.tasks.hint")}</span>
                  </div>
                  <div className="pg-chips">
                    {TASK_FILTERS.map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className="pg-chip"
                        data-tone={taskFilter === id ? "ok" : undefined}
                        aria-pressed={taskFilter === id}
                        onClick={() => setTaskFilter(id)}
                      >
                        {`${t(label)} ${taskCounts[id] ?? 0}`}
                      </button>
                    ))}
                  </div>
                  {Number(state.data?.tasksArchived) > 0 ? (
                    <div className="pg-note">
                      {t("roster.task.archived", { count: Number(state.data.tasksArchived) })}
                    </div>
                  ) : null}

                  {visibleTasks.length === 0 ? (
                    <EmptyState
                      title={t("roster.empty.tasks.title")}
                      hint={t("roster.empty.tasks.hint")}
                      action={
                        taskFilter === "all" ? (
                          <Btn size="sm" variant="primary" onClick={() => setTab("chain")}>
                            {t("roster.empty.tasks.action")}
                          </Btn>
                        ) : (
                          <Btn size="sm" onClick={() => setTaskFilter("all")}>
                            {t("roster.empty.filtered.action")}
                          </Btn>
                        )
                      }
                    />
                  ) : null}

                  <div className="pg-task-list">
                    {visibleTasks.map((task) => {
                      const confirming = confirmKey === `task-${task.id}`;
                      return (
                        <div className="pg-task-item" key={task.id}>
                          <Badge tone={STATUS_TONE[task.status] || "muted"}>
                            {t(STATUS_LABEL[task.status] || "roster.status.idle")}
                          </Badge>
                          <div className="pg-task-main">
                            <span className="pg-task-title">
                              {t(`roster.role.${task.roleId}.name`)}
                              <span className="pg-task-target" title={task.target}>
                                {task.target}
                              </span>
                            </span>
                            <span className="pg-task-sub" title={Array.isArray(task.tasks) ? task.tasks.join("\n") : task.template}>
                              {Array.isArray(task.tasks) && task.tasks.length > 1
                                ? t("roster.task.batch", { count: task.tasks.length, first: task.tasks[0] })
                                : task.template}
                            </span>
                            <span className="pg-task-meta">
                              {`${fmtTime(task.createdAt)} · ${fmtTokens(task.tokens || 0)} · ${fmtDuration(
                                task.status === "running" ? task.elapsedMs : task.durationMs
                              )} · ${t("roster.meta.messages", { count: task.messageCount || 0 })}`}
                            </span>
                            {task.preview ? (
                              <span className="pg-task-preview" title={task.preview}>
                                {task.preview}
                              </span>
                            ) : null}
                            {task.statusReason ? (
                              <span className="pg-task-preview" data-tone="bad" title={task.statusReason}>
                                {task.statusReason}
                              </span>
                            ) : null}
                          </div>
                          <div className="pg-task-actions">
                            <Btn size="sm" variant="ghost" disabled={busy !== ""} onClick={() => void activateTask(task)}>
                              {t("roster.task.open")}
                            </Btn>
                            <Btn
                              size="sm"
                              variant={confirming ? "danger" : "ghost"}
                              disabled={busy !== ""}
                              onClick={() => removeTask(task)}
                            >
                              {confirming ? t("roster.confirm.task") : t("roster.task.remove")}
                            </Btn>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </Fragment>
        ) : null}
      </div>
    </div>
  );
}
