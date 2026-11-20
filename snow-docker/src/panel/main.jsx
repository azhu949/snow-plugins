// 面板入口：头部连接状态 + 容器 / 日志 / 镜像 / 项目 / 远程 / 概览六个视图。
// 宿主注入 props：api / locale / panelId / panel / pluginId / isActive / inputText。
import { bindReact, ensureReact, h } from "./react.js";
import { createTranslator } from "./i18n.js";
import { createRpc } from "./rpc.js";
import { Btn, EmptyState, ErrorBox, Loading } from "./ui.jsx";
import { DkSelect } from "./select.jsx";
import { ContainersView } from "./containers.jsx";
import { LogsView } from "./logs.jsx";
import { ImagesView } from "./images.jsx";
import { ProjectView } from "./project.jsx";
import { SshView } from "./ssh.jsx";
import { OverviewView } from "./overview.jsx";

// 宿主在挂载前已注入 window.SnowAppPlugin，先在这里兜底绑定，避免子模块取不到 React。
if (typeof window !== "undefined" && window.SnowAppPlugin && window.SnowAppPlugin.React) {
  bindReact(window.SnowAppPlugin.React);
}

const TAB_IDS = ["containers", "logs", "images", "project", "ssh", "overview"];
const TAB_LABEL = {
  containers: "tab.containers",
  logs: "tab.logs",
  images: "tab.images",
  project: "tab.project",
  ssh: "tab.ssh",
  overview: "tab.overview",
};

/**
 * 标签页图标：内联 lucide 路径，不把图标库打进包。
 * 面板变窄时标签栏换行，图标与文字一起换到下一排。
 */
const TAB_ICONS = {
  containers: (
    <g>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </g>
  ),
  logs: (
    <g>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </g>
  ),
  images: (
    <g>
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </g>
  ),
  project: (
    <g>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </g>
  ),
  ssh: (
    <g>
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <path d="M6 6h.01" />
      <path d="M6 18h.01" />
    </g>
  ),
  overview: (
    <g>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </g>
  ),
};
const ACTIVE_REFRESH_MS = 5000;
const OVERVIEW_REFRESH_MS = 15000;
const RETRY_REFRESH_MS = 6000;
/** system 要在远程目标上跑 version / info / df / compose 四条命令：单独低频探测。 */
const SYSTEM_REFRESH_MS = 30000;
const SSH_REFRESH_MS = 15000;
const NOTICE_MS = 3600;

export default function DockerPanel({ api, locale, isActive }) {
  const React = ensureReact(api);
  const translator = React.useMemo(() => createTranslator(api, locale), [api, locale]);
  const t = translator.t;

  const log = React.useCallback(
    (...args) => {
      try {
        api?.log?.(...args);
      } catch {
        // 日志失败不影响界面。
      }
    },
    [api]
  );

  const rpc = React.useMemo(() => createRpc(api, { log }), [api, log]);

  const [boot, setBoot] = React.useState({ status: "loading", error: "", code: "" });
  const [system, setSystem] = React.useState(null);
  const [containers, setContainers] = React.useState([]);
  const [images, setImages] = React.useState([]);
  const [listLoading, setListLoading] = React.useState(false);
  /** 列表自身已有可用结果：首屏不等 system 的四条探测命令，列表回来就先渲染。 */
  const [listReady, setListReady] = React.useState(false);
  const [containersError, setContainersError] = React.useState("");
  const [imagesError, setImagesError] = React.useState("");
  const [tab, setTab] = React.useState("containers");
  const [filter, setFilter] = React.useState("");
  const [imageFilter, setImageFilter] = React.useState("");
  const [onlyRunning, setOnlyRunning] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState("");
  const [notices, setNotices] = React.useState([]);
  const [project, setProject] = React.useState({ path: "", name: "", kind: "", pathState: "" });
  /** 目标 daemon：连着服务器就看服务器，没连接就看本机。 */
  const [ssh, setSsh] = React.useState({ status: "idle", id: "", host: "", username: "", servers: [] });
  const [targetBusy, setTargetBusy] = React.useState(false);
  /** system 探测失败但还有旧数据时，只提示可能过期，不把整页切成错误态。 */
  const [systemStale, setSystemStale] = React.useState("");
  /** 后台令牌没写进存储时会退化为固定请求头校验：顶部常驻提示，不能只留在宿主日志里。 */
  const [tokenWarn, setTokenWarn] = React.useState(false);
  /** 从备份恢复后需要重填的敏感值摘要：只来自后台本次进程的内存状态。 */
  const [recoveryInfo, setRecoveryInfo] = React.useState(null);

  const aliveRef = React.useRef(true);
  const noticeTimersRef = React.useRef(new Map());
  const refreshInFlightRef = React.useRef(null);
  const listInFlightRef = React.useRef(null);
  /** system 探测在途标记：列表刷新不再等它，仍要避免几条命令叠在同一条 SSH 通道上。 */
  const systemInFlightRef = React.useRef(null);
  const systemSeenRef = React.useRef(false);
  /** 目标代际：切换服务器时递增，用来丢弃切机前发出、切机后才返回的列表结果。 */
  const targetGenRef = React.useRef(0);
  /** ssh 状态镜像：结果回写时按它判断数据是否属于当前目标，避免把 ssh 塞进定时器依赖。 */
  const sshRef = React.useRef({ id: "" });
  const refreshSshRef = React.useRef(null);
  /** 目标漂移时的重同步节流：同一次切机可能连续丢弃多批结果。 */
  const targetResyncRef = React.useRef({ at: 0, promise: null });

  React.useEffect(() => {
    aliveRef.current = true;
    const timers = noticeTimersRef.current;
    return () => {
      aliveRef.current = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const notify = React.useCallback((tone, text) => {
    if (!aliveRef.current) return;
    const id = `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setNotices((list) => [...list.slice(-2), { id, tone: tone || "info", text: String(text || "") }]);
    const timer = setTimeout(() => {
      noticeTimersRef.current.delete(id);
      if (!aliveRef.current) return;
      setNotices((list) => list.filter((item) => item.id !== id));
    }, NOTICE_MS);
    noticeTimersRef.current.set(id, timer);
  }, []);

  /** 错误码到可执行提示：安装 Docker、启动 daemon、启用插件分别给出下一步。 */
  const describeError = React.useCallback(
    (error) => {
      const code = String(error?.code || "");
      if (code === "DOCKER_NOT_FOUND") return t("error.dockerNotFound");
      if (code === "DAEMON_UNAVAILABLE") return t("error.daemonUnavailable");
      if (code === "PERMISSION_DENIED") return t("error.permissionDenied");
      if (code === "DOCKER_TIMEOUT" || code === "TIMEOUT") return t("error.timeout");
      if (code === "BACKGROUND_UNAVAILABLE") return t("error.backgroundUnavailable");
      if (code === "NET_UNAVAILABLE") return t("error.backgroundUnavailable");
      return t("error.generic", { message: String(error?.message || error) });
    },
    [t]
  );

  /**
   * 目标被别处切换（远程页、镜像页、上传时自动建连）后的重同步：
   * 丢弃这批不属于当前目标的数据，并立刻重读会话状态，不等 15 秒轮询。
   */
  const noteTargetDrift = React.useCallback(() => {
    const now = Date.now();
    if (targetResyncRef.current.promise || now - targetResyncRef.current.at < 2000) return;
    targetResyncRef.current.at = now;
    const job = Promise.resolve(refreshSshRef.current?.()).finally(() => {
      if (targetResyncRef.current.promise === job) targetResyncRef.current.promise = null;
    });
    targetResyncRef.current.promise = job;
  }, []);

  /** 列表结果统一落到 state：容器与镜像各管各的，任一个失败不影响另一个。 */
  const applyListResults = React.useCallback(
    ({ gen, containersResult, imagesResult }) => {
      if (!aliveRef.current) return;
      // 切机前发出的请求可能在切机后才返回：代际不匹配就丢弃，别把上一台的列表写回来。
      if (gen !== targetGenRef.current) return;
      const containersTarget = containersResult.ok ? String(containersResult.data?.target?.id || "") : "";
      const imagesTarget = imagesResult.ok ? String(imagesResult.data?.target?.id || "") : "";
      // 两个请求可能正好跨在切机前后：来源不一致就不能拼成一份列表。
      if (containersTarget && imagesTarget && containersTarget !== imagesTarget) {
        noteTargetDrift();
        return;
      }
      const seenTarget = containersTarget || imagesTarget;
      const knownTarget = String(sshRef.current?.id || "");
      // 首屏 sshStatus 还没回来时 knownTarget 为空，此时不做判定，避免误丢弃第一批数据。
      if (seenTarget && knownTarget && seenTarget !== knownTarget) {
        noteTargetDrift();
        return;
      }
      if (containersResult.ok) {
        setContainers(Array.isArray(containersResult.data?.containers) ? containersResult.data.containers : []);
        setContainersError("");
      } else {
        setContainers([]);
        setContainersError(describeError(containersResult.error));
      }
      if (imagesResult.ok) {
        setImages(Array.isArray(imagesResult.data?.images) ? imagesResult.data.images : []);
        setImagesError("");
      } else {
        setImages([]);
        setImagesError(describeError(imagesResult.error));
      }
      // 任一列表成功就说明这台的列表已经可用：不用等 system 判定整页可渲染。
      if (containersResult.ok || imagesResult.ok) setListReady(true);
    },
    [describeError, noteTargetDrift]
  );

  const loadListResults = React.useCallback(() => {
    // 记录发起时的目标代际，供 applyListResults 判断结果是否已经过期。
    const gen = targetGenRef.current;
    return Promise.all([
      rpc
        .containers({ all: true })
        .then((data) => ({ ok: true, data }))
        .catch((error) => ({ ok: false, error })),
      rpc
        .images()
        .then((data) => ({ ok: true, data }))
        .catch((error) => ({ ok: false, error })),
    ]).then(([containersResult, imagesResult]) => ({ gen, containersResult, imagesResult }));
  }, [rpc]);

  /**
   * system 结果统一落到 boot 状态：引擎真的不可用时整页报错；只是这一轮超时或网络抖动时
   * 保留已有数据并提示可能过期。
   */
  const applySystemResult = React.useCallback(
    (systemResult) => {
      if (!aliveRef.current) return;
      if (systemResult.ok) {
        const seenTarget = String(systemResult.data?.target?.id || "");
        const knownTarget = String(sshRef.current?.id || "");
        // 概览用 system 渲染计数与磁盘：目标已换但标签还没跟上时，先丢弃这一批并重同步。
        if (seenTarget && knownTarget && seenTarget !== knownTarget) {
          noteTargetDrift();
          return;
        }
        systemSeenRef.current = true;
        setSystem(systemResult.data);
        setSystemStale("");
        setBoot({ status: "ready", error: "", code: "" });
        return;
      }
      const code = String(systemResult.error?.code || "");
      const engineDown =
        code === "DOCKER_NOT_FOUND" || code === "DAEMON_UNAVAILABLE" || code === "PERMISSION_DENIED";
      if (code === "SSH_NOT_CONNECTED") {
        // 只支持远程：没连服务器时给引导，而不是把整页标成错误。
        systemSeenRef.current = false;
        setSystem(null);
        setSystemStale("");
        setBoot({ status: "offline", error: "", code });
      } else if (!systemSeenRef.current || engineDown) {
        // 引擎真的不可用才整页报错；只是这一轮超时或网络抖动时保留已有数据继续用。
        setBoot({ status: "error", error: describeError(systemResult.error), code });
      } else {
        setSystemStale(describeError(systemResult.error));
      }
    },
    [describeError, noteTargetDrift]
  );

  /**
   * 全量刷新：system / containers / images 同时发出，但各自收敛。
   * 远程 system 要跑 version + info + df + compose 四条命令，列表不能等它：
   * listLoading 只跟随列表请求，返回的 promise 也只等列表。
   * 只用于首屏、手动刷新与切换目标：定时轮询走 refreshLists / refreshSystem。
   */
  const refreshData = React.useCallback(
    ({ silent = false } = {}) => {
      // 定时轮询、手动刷新、任务结束后的刷新可能撞在一起：同一次刷新只跑一份，
      // 否则远程目标下几个请求同时挤一条 SSH 通道，很容易一起撞上超时。
      if (refreshInFlightRef.current) return refreshInFlightRef.current;
      const gen = targetGenRef.current;
      const listTask = (async () => {
        if (aliveRef.current && !silent) setListLoading(true);
        try {
          const listResult = await loadListResults();
          if (aliveRef.current) applyListResults(listResult);
        } finally {
          // listLoading 只跟随列表请求收敛，不等 system 探测。
          if (aliveRef.current) setListLoading(false);
        }
      })();
      // system 独立飞行：不参与 listLoading，也不拖住 refreshData 的返回；
      // 同一时刻只保留一份，切机后回来的旧结果按目标代际丢弃。
      if (!systemInFlightRef.current) {
        const systemTask = rpc
          .system()
          .then((data) => ({ ok: true, data }))
          .catch((error) => ({ ok: false, error }))
          .then((systemResult) => {
            if (aliveRef.current && gen === targetGenRef.current) applySystemResult(systemResult);
          })
          .finally(() => {
            if (systemInFlightRef.current === systemTask) systemInFlightRef.current = null;
          });
        systemInFlightRef.current = systemTask;
      }
      refreshInFlightRef.current = listTask;
      listTask.finally(() => {
        if (refreshInFlightRef.current === listTask) refreshInFlightRef.current = null;
      });
      return listTask;
    },
    [rpc, applySystemResult, loadListResults, applyListResults]
  );

  /** 只探测 system：远程目标下要跑四条 SSH 命令，走独立低频循环，不与列表刷新绑定。 */
  const refreshSystem = React.useCallback(async () => {
    const systemResult = await rpc
      .system()
      .then((data) => ({ ok: true, data }))
      .catch((error) => ({ ok: false, error }));
    applySystemResult(systemResult);
  }, [rpc, applySystemResult]);

  /** 只刷新列表：删除镜像、启停容器、上传完成这类局部操作只关心列表，不跟着 system 一起等。 */
  const refreshLists = React.useCallback(() => {
    // 5 秒轮询与按钮触发的刷新可能重叠：同一次列表刷新只跑一份。
    if (listInFlightRef.current) return listInFlightRef.current;
    const run = (async () => {
      const listResult = await loadListResults();
      applyListResults(listResult);
    })();
    listInFlightRef.current = run;
    run.finally(() => {
      if (listInFlightRef.current === run) listInFlightRef.current = null;
    });
    return run;
  }, [loadListResults, applyListResults]);

  const refreshSsh = React.useCallback(async () => {
    try {
      const data = await rpc.sshStatus();
      if (!aliveRef.current) return;
      setSsh({
        status: String(data?.status || "idle"),
        id: String(data?.id || ""),
        host: String(data?.host || ""),
        username: String(data?.username || ""),
        servers: Array.isArray(data?.servers) ? data.servers : [],
      });
    } catch {
      // 后台未就绪时忽略，等下一次轮询。
    }
  }, [rpc]);

  React.useEffect(() => {
    refreshSshRef.current = refreshSsh;
  }, [refreshSsh]);

  // 目标 id 变化时同步镜像 ref，供列表 / 系统结果回写时判断数据来源。
  React.useEffect(() => {
    sshRef.current = ssh;
  }, [ssh]);

  React.useEffect(() => {
    void refreshSsh();
  }, [refreshSsh]);

  // 令牌降级只在后台启动时决定：boot 状态变化后重新确认一次即可，不需要轮询。
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await rpc.health();
        if (alive) setTokenWarn(data?.tokenEnforced === false);
      } catch {
        // 后台未就绪时忽略，下一次 boot 状态变化再确认。
      }
    })();
    return () => {
      alive = false;
    };
  }, [rpc, boot.status]);

  // 备份恢复只在后台启动时发生：拿到恢复摘要后在顶部提示一次，值需要用户重填。
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await rpc.settings();
        if (!alive) return;
        const info = data?.recovery;
        setRecoveryInfo(info && info.restoredFromBackup && info.runConfigCount > 0 ? info : null);
      } catch {
        // 后台未就绪时忽略，下次 boot 状态变化再确认。
      }
    })();
    return () => {
      alive = false;
    };
  }, [rpc, boot.status]);

  React.useEffect(() => {
    if (isActive === false) return undefined;
    const timer = setInterval(() => void refreshSsh(), SSH_REFRESH_MS);
    return () => clearInterval(timer);
  }, [isActive, refreshSsh]);

  /** 切换目标 daemon：选服务器就连上它，选「本机」就断开当前会话。 */
  const switchTarget = React.useCallback(
    async (next) => {
      const current = ssh.status === "connected" ? ssh.id : "";
      if (!next) return;
      if (next === current || targetBusy) return;
      setTargetBusy(true);
      // 新目标连上之前，界面上的容器/镜像都属于上一台服务器：立即清空并进入加载态，
      // 避免把同名容器/镜像的停止、删除按钮点成对新服务器的操作。
      targetGenRef.current += 1;
      setContainers([]);
      setImages([]);
      setContainersError("");
      setImagesError("");
      setSelectedId("");
      setListLoading(true);
      // 新目标连上之前列表还没有结果：别让上一台的列表参与首屏渲染判断。
      setListReady(false);
      try {
        if (next) await rpc.sshConnect(next);
        else await rpc.sshDisconnect();
        // 换了目标就重新判定首屏状态，别把上一台机器的数据当成这台的。
        systemSeenRef.current = false;
        setSystemStale("");
        if (refreshInFlightRef.current) await refreshInFlightRef.current.catch(() => {});
        await refreshSsh();
        await refreshData();
      } catch (error) {
        notify("error", String(error?.message || error));
        setListLoading(false);
      } finally {
        setTargetBusy(false);
      }
    },
    [ssh.status, ssh.id, targetBusy, refreshSsh, refreshData, notify, rpc]
  );

  // 目标变化后数据源跟着变：首屏显示加载态，切换时静默刷新。
  React.useEffect(() => {
    void refreshData({ silent: ssh.status !== "idle" });
  }, [refreshData, ssh.status, ssh.id]);

  // 前台轮询只刷新容器 / 镜像列表：5 秒一次，概览页 15 秒。
  // system 探测拆成独立低频循环，避免远程目标每 5 秒跑四条 SSH 命令拖慢列表。
  // 宿主没传 isActive 时按「激活」处理，避免旧宿主下永远不刷新。
  React.useEffect(() => {
    if (isActive === false) return undefined;
    if (boot.status !== "ready") return undefined;
    const interval = tab === "overview" ? OVERVIEW_REFRESH_MS : ACTIVE_REFRESH_MS;
    const timer = setInterval(() => {
      void refreshLists();
    }, interval);
    return () => clearInterval(timer);
  }, [boot.status, isActive, tab, refreshLists]);

  // system 探测：正常 30 秒一次；离线 / 错误态保持 6 秒重试，连上服务器后能自动转回可用状态。
  React.useEffect(() => {
    if (isActive === false) return undefined;
    if (boot.status === "loading") return undefined;
    const interval = boot.status === "error" || boot.status === "offline" ? RETRY_REFRESH_MS : SYSTEM_REFRESH_MS;
    const timer = setInterval(() => {
      void refreshSystem();
    }, interval);
    return () => clearInterval(timer);
  }, [boot.status, isActive, refreshSystem]);

  // 当前项目来自 runtime 域：订阅后切换项目会自动更新，项目视图随之重扫。
  React.useEffect(() => {
    let alive = true;
    let subscription = null;
    const apply = (runtimeDomain) => {
      if (!alive) return;
      const dir = runtimeDomain?.activeDirectory || null;
      setProject({
        path: typeof dir?.path === "string" ? dir.path : "",
        name: typeof dir?.name === "string" ? dir.name : "",
        kind: typeof dir?.kind === "string" ? dir.kind : "",
        pathState: typeof dir?.pathState === "string" ? dir.pathState : "",
      });
    };
    (async () => {
      try {
        const initial = await api?.metadata?.get?.("runtime");
        apply(initial?.domains?.runtime);
      } catch (error) {
        log("[panel] 读取当前项目失败", String(error?.message || error));
      }
      try {
        const sub = await api?.metadata?.subscribe?.("runtime", (next) => apply(next?.domains?.runtime), {});
        if (alive) subscription = sub;
        else sub?.unsubscribe?.();
      } catch (error) {
        log("[panel] 订阅项目变化失败", String(error?.message || error));
      }
    })();
    return () => {
      alive = false;
      try {
        subscription?.unsubscribe?.();
      } catch {
        // 取消订阅失败可忽略。
      }
    };
  }, [api, log]);

  // 选中的容器被删除后收起详情，避免详情面板指向不存在的容器。
  React.useEffect(() => {
    if (!selectedId) return;
    if (!containers.some((item) => item.id === selectedId)) setSelectedId("");
  }, [containers, selectedId]);

  const openFile = React.useCallback(
    async (filePath) => {
      try {
        const result = await api?.write?.run?.("panels.openFile", { filePath });
        if (result && result.ok === false) notify("error", String(result.error || "打开文件失败"));
      } catch (error) {
        notify("error", String(error?.message || error));
      }
    },
    [api, notify]
  );

  const daemonOnline = system?.daemon?.online === true;
  const cliMissing = system ? system.cli?.available !== true : false;
  const connectedTarget =
    ssh.status === "connected" ? `${ssh.username || "root"}@${ssh.host || ""}` : "";
  const hasServers = ssh.servers.length > 0;
  const targetValue = ssh.status === "connected" ? ssh.id : "";
  // 只支持远程 daemon：下拉里不再有「本机」，未连接时给一个占位项。
  const targetOptions = [
    ...(targetValue ? [] : [{ value: "", label: t("target.choose") }]),
    ...ssh.servers.map((item) => ({
      value: item.id,
      label: item.name || `${item.username || "root"}@${item.host || ""}`,
    })),
  ];
  const statusTone =
    boot.status === "error" || boot.status === "offline" ? "bad" : daemonOnline ? "ok" : "warn";
  const statusText =
    boot.status === "loading"
      ? t("status.checking")
      : boot.status === "offline"
        ? t("target.offline")
        : boot.status === "error"
          ? boot.error
          : connectedTarget
            ? `${connectedTarget} · ${
                daemonOnline ? t("status.online") : cliMissing ? t("status.cliMissing") : t("status.daemonOffline")
              }`
            : t("target.offline");

  const runningCount = containers.filter((item) => item.state === "running").length;
  // 容器 / 日志 / 镜像 / 概览依赖远程 daemon；项目与远程两页不依赖，未连接时也要能进。
  const needsDaemon = tab === "containers" || tab === "logs" || tab === "images" || tab === "overview";
  const canOpenLocalTabs = boot.status !== "loading";
  // 列表类视图只看自己的结果：system 还在首屏探测时，列表先到就先渲染。
  // offline / error 仍由整页引导与错误块接管，两者不会同屏。
  const listVisible = boot.status === "ready" || (listReady && boot.status === "loading");

  return (
    <div className="dk-panel">
      <div className="dk-head">
        <div className="dk-title" title={statusText}>
          <span className="dk-dot" data-tone={statusTone} />
          <span className="dk-title-text">{t("app.title")}</span>
        </div>
        <div className="dk-head-sub" title={statusText}>
          {statusText}
        </div>
        {systemStale ? (
          <span className="dk-meta" title={systemStale}>
            {t("status.stale")}
          </span>
        ) : null}
        <div className="dk-head-spacer" />
        <Btn
          size="sm"
          disabled={listLoading || (boot.status === "loading" && !listVisible)}
          title={t("action.refresh")}
          onClick={() => {
            void refreshData();
          }}
        >
          {t("action.refresh")}
        </Btn>
      </div>

      {tokenWarn ? (
        <div className="dk-inline-warn" role="status">
          {t("security.tokenNotPersisted")}
        </div>
      ) : null}

      {recoveryInfo ? (
        <div className="dk-inline-warn" role="status">
          {t("settings.recovered.body", {
            configs: recoveryInfo.runConfigCount,
            fields: (recoveryInfo.fields || []).map((id) => t(`settings.recovered.field.${id}`)).join("、"),
          })}
          <Btn size="sm" variant="ghost" onClick={() => setRecoveryInfo(null)}>
            {t("settings.recovered.dismiss")}
          </Btn>
        </div>
      ) : null}

      <div className="dk-tabs">
        {TAB_IDS.map((id) => {
          const count = id === "containers" ? containers.length : id === "images" ? images.length : 0;
          const label = t(TAB_LABEL[id]);
          return (
            <button
              key={id}
              type="button"
              className="dk-tab"
              data-active={tab === id ? "1" : "0"}
              onClick={() => setTab(id)}
            >
              {TAB_ICONS[id] ? (
                <svg
                  className="dk-tab-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {TAB_ICONS[id]}
                </svg>
              ) : null}
              <span>{label}</span>
              {count > 0 ? <span className="dk-count">{count}</span> : null}
            </button>
          );
        })}
      </div>

      {/* 远程服务器：容器 / 日志 / 镜像 / 概览都读它；本插件不操作本机 Docker */}
      <div className="dk-toolbar dk-target-bar">
        <span className="dk-meta">{t("target.label")}</span>
        {hasServers ? (
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <DkSelect
              value={targetValue}
              options={targetOptions}
              onChange={(next) => void switchTarget(next)}
              ariaLabel={t("target.label")}
              size="sm"
              searchable
              searchPlaceholder={t("target.search")}
              emptyText={t("target.empty")}
              disabled={targetBusy}
            />
          </div>
        ) : (
          <span className="dk-meta" style={{ flex: "1 1 auto", minWidth: 0 }}>
            {t("target.none")}
          </span>
        )}
        <Btn size="sm" variant="ghost" onClick={() => setTab("ssh")}>
          {hasServers ? t("target.manage") : t("target.add")}
        </Btn>
        {targetBusy ? <span className="dk-meta">{t("target.connecting")}</span> : null}
      </div>

      {/* 概览页读的是 system 数据：system 未到之前仍用整页加载态，避免列表提前放行后留白。 */}
      {boot.status === "loading" && (!listVisible || (tab === "overview" && !system)) ? (
        <Loading text={t("status.checking")} />
      ) : null}

      {boot.status === "offline" && needsDaemon ? (
        <div style={{ paddingTop: "10px" }}>
          <EmptyState
            title={hasServers ? t("target.notConnected") : t("target.needServer")}
            hint={hasServers ? t("target.notConnectedHint") : t("target.needServerHint")}
            action={
              <Btn size="sm" variant="primary" onClick={() => setTab("ssh")}>
                {t("target.add")}
              </Btn>
            }
          />
        </div>
      ) : null}

      {boot.status === "error" && needsDaemon ? (
        <div style={{ paddingTop: "10px" }}>
          <ErrorBox
            title={t("error.title")}
            message={boot.error}
            action={
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Btn
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    rpc.resetPort();
                    setBoot({ status: "loading", error: "", code: "" });
                    void refreshData();
                  }}
                >
                  {t("action.retry")}
                </Btn>
                <span className="dk-meta">{t("conn.autoRetry")}</span>
              </div>
            }
          />
        </div>
      ) : null}

      {listVisible && tab === "containers" ? (
        <ContainersView
          t={t}
          rpc={rpc}
          containers={containers}
          loading={listLoading}
          error={containersError}
          filter={filter}
          setFilter={setFilter}
          onlyRunning={onlyRunning}
          setOnlyRunning={setOnlyRunning}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          notify={notify}
          onChanged={refreshLists}
          onOpenLogs={(id) => {
            setSelectedId(id);
            setTab("logs");
          }}
        />
      ) : null}

      {listVisible ? (
        <LogsView
          t={t}
          rpc={rpc}
          containers={containers}
          loading={listLoading}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          active={isActive !== false}
          visible={tab === "logs"}
        />
      ) : null}

      {/* 镜像页常驻挂载：切走标签页只隐藏，上传任务、日志与目标选择不随卸载丢失。 */}
      {listVisible ? (
        <div
          hidden={tab !== "images"}
          style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          <ImagesView
            t={t}
            rpc={rpc}
            images={images}
            containers={containers}
            loading={listLoading}
            error={imagesError}
            filter={imageFilter}
            setFilter={setImageFilter}
            notify={notify}
            onChanged={refreshLists}
            active={isActive !== false && tab === "images"}
          />
        </div>
      ) : null}

      {/* 项目页常驻挂载：构建任务与日志跟着面板走，切到别的标签页也不会丢。 */}
      {canOpenLocalTabs ? (
        <div
          hidden={tab !== "project"}
          style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          <ProjectView
            t={t}
            rpc={rpc}
            notify={notify}
            project={project}
            onOpenFile={openFile}
            active={isActive !== false && tab === "project"}
          />
        </div>
      ) : null}

      {canOpenLocalTabs && tab === "ssh" ? <SshView t={t} rpc={rpc} notify={notify} /> : null}

      {boot.status === "ready" && tab === "overview" ? (
        <OverviewView
          t={t}
          rpc={rpc}
          notify={notify}
          system={system}
          loading={listLoading}
          error=""
          targetKind="remote"
          onRetry={() => {
            void refreshData();
          }}
        />
      ) : null}

      {listVisible ? (
        <div
          className="dk-head"
          style={{ borderTop: "1px solid var(--dk-border)", borderBottom: 0, padding: "5px 10px" }}
        >
          <span className="dk-head-sub">
            {t("tab.containers")}: {runningCount} / {containers.length} · {t("tab.images")}: {images.length}
          </span>
        </div>
      ) : null}

      {notices.length ? (
        <div className="dk-notices">
          {notices.map((notice) => (
            <div className="dk-notice" data-tone={notice.tone} key={notice.id}>
              {notice.text}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
