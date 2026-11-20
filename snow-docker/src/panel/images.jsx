// 镜像视图：列表 + 拉取 + 删除（删除需二次点击确认）+ 上传到远程 SSH 服务器。
// 远程目标来自「远程」标签页保存的服务器；这里只选目标、连接/断开并发起上传。
import { h, getReact } from "./react.js";
import { Btn, EmptyState, ErrorBox, Loading } from "./ui.jsx";
import { DkSelect } from "./select.jsx";
import { TaskLog } from "./tasklog.jsx";

const MAX_LOG_LINES = 800;
const SSH_POLL_MS = 10000;

/**
 * 过滤：按列表上真正显示的名字匹配（`repo:tag`，无 tag 时是短 ID），
 * 这样输入镜像名或 ID 前缀都能命中。
 */
const matchesFilter = (item, filter) => {
  if (!filter) return true;
  const text = filter.trim().toLowerCase();
  if (!text) return true;
  return `${imageLabel(item)} ${item.id || ""}`.toLowerCase().includes(text);
};

const imageLabel = (item) =>
  item.repository && item.repository !== "<none>" ? `${item.repository}:${item.tag}` : String(item.id || "").slice(0, 12);

/**
 * 删除目标：有 tag 用 `repo:tag`；`repo` 有值但 tag 是 `<none>`（digest 拉取）时用 `repo@digest`，
 * 都没有才退回镜像 ID。`repo:<none>` 会被后台的镜像引用白名单拒绝。
 */
const imageTarget = (item) => {
  const repo = item.repository && item.repository !== "<none>" ? item.repository : "";
  const tag = item.tag && item.tag !== "<none>" ? item.tag : "";
  const digest = item.digest && item.digest !== "<none>" ? item.digest : "";
  if (repo && tag) return `${repo}:${tag}`;
  if (repo && digest) return `${repo}@${digest}`;
  return String(item.id || "");
};

/**
 * 列表 key 必须唯一：同一个镜像可以有多个 tag，`docker images` 会输出多行相同 ID。
 * 只用 id 当 key 时这些行会撞车，React 复用错节点，过滤和排序都会看起来失效。
 */
const imageKey = (item) => `${item.id}:${item.repository}:${item.tag}`;

/**
 * 该镜像被哪些容器使用：优先按 `repo:tag` 匹配，其次按镜像 ID 前缀匹配
 * （容器可能记录 `<none>` 或 `sha256:...`）。
 */
const containersUsingImage = (item, containers) => {
  const label = imageLabel(item);
  const imageId = String(item.id || "").replace(/^sha256:/, "");
  const list = [];
  for (const container of containers) {
    const ref = String(container.image || "");
    const refId = ref.replace(/^sha256:/, "");
    const byLabel = ref === label;
    const byId = Boolean(refId && imageId) && (refId.startsWith(imageId) || imageId.startsWith(refId));
    if (byLabel || byId) list.push(container);
  }
  return list;
};

const serverLabel = (item) => item.name || `${item.username || "root"}@${item.host || ""}`;

export function ImagesView({ t, rpc, images, containers, loading, error, filter, setFilter, notify, onChanged, active }) {
  const React = getReact();
  const [reference, setReference] = React.useState("");
  const [pulling, setPulling] = React.useState(false);
  const [busyId, setBusyId] = React.useState("");
  /** 正在提交上传的镜像 key：请求返回前按钮必须锁住，否则会并发执行多次上传。 */
  const [uploading, setUploading] = React.useState("");
  /** 跨服务器上传的确认态：列表来自远程，推送的却是本机同名镜像，必须先让用户确认来源差异。 */
  const [uploadConfirm, setUploadConfirm] = React.useState("");
  const [uploadWarning, setUploadWarning] = React.useState("");
  const [confirmId, setConfirmId] = React.useState("");
  const [actionError, setActionError] = React.useState("");

  const [ssh, setSsh] = React.useState({ status: "idle", id: "", host: "", username: "", servers: [], currentId: "" });
  const [targetId, setTargetId] = React.useState("");
  const [sshBusy, setSshBusy] = React.useState("");
  const [task, setTask] = React.useState(null);
  /** 删除成功后先隐藏该行，等后台列表刷新回来再交还真实数据，避免「提示已删除但行还在」。 */
  const [hidden, setHidden] = React.useState(() => new Set());
  /** 删除遮罩：从发出 rmi 到列表刷新完成都盖着，期间不许再操作。 */
  const [deleting, setDeleting] = React.useState({ active: false, label: "" });

  const taskCursor = React.useRef({ id: "", offset: 0 });
  const aliveRef = React.useRef(true);

  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (!confirmId) return undefined;
    const timer = setTimeout(() => setConfirmId(""), 4000);
    return () => clearTimeout(timer);
  }, [confirmId]);

  React.useEffect(() => {
    if (!uploadConfirm) return undefined;
    const timer = setTimeout(() => {
      setUploadConfirm("");
      setUploadWarning("");
    }, 6000);
    return () => clearTimeout(timer);
  }, [uploadConfirm]);

  // 切换上传目标或连接来源后，上一次的确认态不再适用。
  React.useEffect(() => {
    setUploadConfirm("");
    setUploadWarning("");
  }, [targetId, ssh.id]);

  const refreshSsh = React.useCallback(async () => {
    try {
      const data = await rpc.sshStatus();
      if (!aliveRef.current) return;
      const servers = Array.isArray(data?.servers) ? data.servers : [];
      setSsh({
        status: data?.status || "idle",
        id: String(data?.id || ""),
        host: String(data?.host || ""),
        username: String(data?.username || ""),
        servers,
        currentId: String(data?.currentId || ""),
      });
      setTargetId((prev) => {
        if (prev && servers.some((item) => item.id === prev)) return prev;
        const preferred = servers.find((item) => item.id === (data?.id || data?.currentId)) || servers[0];
        return preferred ? preferred.id : "";
      });
    } catch {
      // 后台未就绪时忽略，下一次轮询再试。
    }
  }, [rpc]);

  React.useEffect(() => {
    void refreshSsh();
  }, [refreshSsh]);

  // 连接状态变化（远端断开）要能自动反映到按钮上。
  React.useEffect(() => {
    if (active === false) return undefined;
    const timer = setInterval(() => void refreshSsh(), SSH_POLL_MS);
    return () => clearInterval(timer);
  }, [active, refreshSsh]);

  // 上传任务轮询：每秒拉一次增量行，结束后自动停止。
  React.useEffect(() => {
    if (!task?.id || task.status !== "running") return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await rpc.task(task.id, taskCursor.current.offset);
        if (cancelled || !data) return;
        taskCursor.current.offset = Number.isFinite(data.nextOffset) ? data.nextOffset : taskCursor.current.offset;
        setTask((prev) => {
          if (!prev || prev.id !== data.id) return prev;
          const merged = [...prev.lines, ...(Array.isArray(data.lines) ? data.lines : [])];
          return {
            ...prev,
            status: data.status,
            exitCode: data.exitCode ?? null,
            error: data.error || "",
            lines: merged.slice(-MAX_LOG_LINES),
            truncated: prev.truncated || data.truncated === true,
          };
        });
      } catch (cause) {
        if (!cancelled) {
          setTask((prev) => (prev ? { ...prev, status: "failed", error: String(cause?.message || cause) } : prev));
        }
      }
    };
    const timer = setInterval(() => void tick(), 1000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [task?.id, task?.status, rpc]);

  /**
   * 拉取任务结束：刷新列表并提示一次。进度与结果本身在 TaskLog 里，
   * 这里只在成功时补一条通知，并用 settledRef 防止重复触发。
   */
  const settledRef = React.useRef("");
  React.useEffect(() => {
    const current = task;
    if (!current?.id || current.status === "running") return;
    const key = `${current.id}:${current.status}`;
    if (settledRef.current === key) return;
    settledRef.current = key;
    if (current.kind !== "pull" || current.status !== "succeeded") return;
    void (async () => {
      try {
        await onChanged();
      } catch {
        // 列表刷新失败不影响任务结果提示。
      }
    })();
    notify("success", t("notice.pulled", { reference: current.title }));
  }, [task, onChanged, notify, t]);

  const connected = ssh.status === "connected";
  const currentServer = ssh.servers.find((item) => item.id === ssh.id) || null;
  const currentLabel = currentServer
    ? serverLabel(currentServer)
    : `${ssh.username || "root"}@${ssh.host || ""}`;
  const connectedHere = connected && Boolean(targetId) && ssh.id === targetId;
  const targetServer = ssh.servers.find((item) => item.id === targetId) || null;
  const targetLabel = targetServer ? serverLabel(targetServer) : t("image.target");

  const connectTarget = async () => {
    if (!targetId) return;
    setSshBusy("connect");
    setActionError("");
    try {
      await rpc.sshConnect(targetId);
      await refreshSsh();
      notify("success", t("ssh.connected"));
    } catch (cause) {
      setActionError(String(cause?.message || cause));
    } finally {
      setSshBusy("");
    }
  };

  const disconnectTarget = async () => {
    setSshBusy("disconnect");
    setActionError("");
    try {
      await rpc.sshDisconnect();
      await refreshSsh();
    } catch (cause) {
      setActionError(String(cause?.message || cause));
    } finally {
      setSshBusy("");
    }
  };

  const upload = async (item) => {
    // 后台返回 taskId 前可能先自动建连并探测 docker（最长 90 秒）：
    // 这里先占住状态，避免重复点击产生并发的 docker save 与远程 docker load。
    if (uploading) return;
    const label = imageLabel(item);
    const key = imageKey(item);
    // 列表跟随当前连接的服务器，上传发送的却是本机同名镜像：两次点击才真正发起，
    // 避免把本机的旧同名镜像静默覆盖到目标服务器上。
    if (ssh.status === "connected" && uploadConfirm !== key) {
      setUploadConfirm(key);
      setUploadWarning(
        t("image.uploadSourceWarning", { image: label, source: currentLabel, target: targetLabel })
      );
      return;
    }
    setUploadConfirm("");
    setUploadWarning("");
    setUploading(key);
    setActionError("");
    try {
      const payload = await rpc.sshUpload(label, targetId || undefined);
      taskCursor.current = { id: payload.taskId, offset: 0 };
      setTask({
        id: payload.taskId,
        kind: "upload",
        title: label,
        status: "running",
        lines: [],
        error: "",
        exitCode: null,
        truncated: false,
      });
      notify("info", t("image.uploadStarted", { image: label }));
      // 上传会自动连上目标服务器：之后列表就切到那台机器上的镜像。
      await refreshSsh();
      try {
        await onChanged();
      } catch {
        // 列表刷新失败不影响已经启动的上传任务。
      }
    } catch (cause) {
      setActionError(String(cause?.message || cause));
    } finally {
      setUploading("");
    }
  };

  const pull = async () => {
    const value = reference.trim();
    if (!value) return;
    setPulling(true);
    setActionError("");
    try {
      // 后台把 pull 当成任务跑：这里只拿 taskId，进度与结果都从 /task 轮询。
      const payload = await rpc.pull(value);
      setReference("");
      taskCursor.current = { id: payload.taskId, offset: 0 };
      setTask({
        id: payload.taskId,
        kind: "pull",
        title: value,
        status: "running",
        lines: [],
        error: "",
        exitCode: null,
        truncated: false,
      });
      notify("info", t("image.pullStarted", { reference: value }));
    } catch (cause) {
      setActionError(String(cause?.message || cause));
    } finally {
      setPulling(false);
    }
  };

  const remove = async (item) => {
    const target = imageTarget(item);
    // 确认态与忙碌态按行键控：同一个镜像 ID 可能对应多个 tag，按 id 会让其它行共享确认态。
    const key = imageKey(item);
    if (confirmId !== key) {
      setConfirmId(key);
      return;
    }
    setConfirmId("");
    setBusyId(key);
    setActionError("");
    setDeleting({ active: true, label: target });
    let removed = false;
    try {
      await rpc.removeImage(target, false);
      setHidden((prev) => new Set(prev).add(imageKey(item)));
      try {
        await onChanged();
      } finally {
        // 列表已是后台最新结果，把临时隐藏撤掉。
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(imageKey(item));
          return next;
        });
      }
      removed = true;
    } catch (cause) {
      setActionError(String(cause?.message || cause));
    } finally {
      setBusyId("");
      // 先撤遮罩：成功提示放到下一帧，避免「遮罩还没关就弹出已删除」。
      setDeleting({ active: false, label: "" });
    }
    if (removed) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      notify("success", t("notice.imageRemoved", { image: target }));
    }
  };

  /** 每行镜像的容器占用情况：镜像列表与容器列表本来就是一起刷新的，这里只做一次匹配。 */
  const usage = React.useMemo(() => {
    const map = new Map();
    for (const item of images) map.set(imageKey(item), containersUsingImage(item, containers || []));
    return map;
  }, [images, containers]);

  const visible = images
    .filter((item) => !hidden.has(imageKey(item)))
    .filter((item) => matchesFilter(item, filter));
  const hasServers = ssh.servers.length > 0;
  const targetOptions = ssh.servers.map((item) => ({
    value: item.id,
    label: `${serverLabel(item)}${connected && ssh.id === item.id ? ` (${t("ssh.statusConnected")})` : ""}`,
  }));

  return (
    <div className="dk-images">
      <div className="dk-body">
      <div className="dk-toolbar">
        <input
          className="dk-input"
          value={reference}
          placeholder={t("image.pullPlaceholder")}
          onChange={(event) => setReference(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void pull();
          }}
        />
        <Btn variant="primary" disabled={pulling || task?.status === "running" || !reference.trim()} onClick={pull}>
          {pulling ? t("image.pulling") : t("image.pull")}
        </Btn>
      </div>

      <div className="dk-toolbar" style={{ paddingTop: 0 }}>
        <input
          className="dk-input"
          value={filter}
          placeholder={t("filter.placeholder")}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>

      {hasServers ? (
        <div className="dk-toolbar" style={{ paddingTop: 0 }}>
          <span className="dk-meta">{t("image.target")}</span>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <DkSelect
              value={targetId}
              options={targetOptions}
              onChange={setTargetId}
              ariaLabel={t("image.target")}
              size="sm"
            />
          </div>
          {connectedHere ? (
            <Btn size="sm" disabled={Boolean(sshBusy)} onClick={() => void disconnectTarget()}>
              {t("image.disconnect")}
            </Btn>
          ) : (
            <Btn
              size="sm"
              variant="primary"
              disabled={Boolean(sshBusy) || !targetId}
              onClick={() => void connectTarget()}
            >
              {sshBusy === "connect" ? t("ssh.connecting") : t("image.connect")}
            </Btn>
          )}
        </div>
      ) : (
        <div className="dk-meta" style={{ padding: "0 10px 7px" }}>
          {t("image.noTarget")}
        </div>
      )}

      {connected ? (
        <div className="dk-meta" style={{ padding: "0 10px 7px" }}>
          {t("image.viewingRemote", { target: currentLabel })}
        </div>
      ) : null}

      {task ? (
        <div style={{ padding: "0 10px 8px" }}>
          <TaskLog
            t={t}
            task={task}
            maxHeight="150px"
            onCancel={() => {
              void rpc.cancelTask(task.id).catch(() => {});
            }}
            onClear={() => setTask(null)}
          />
        </div>
      ) : null}

      {actionError ? (
        <div className="dk-inline-error" style={{ padding: "0 10px 8px" }}>
          {actionError}
        </div>
      ) : null}
      {uploadWarning ? (
        <div className="dk-inline-error" style={{ padding: "0 10px 8px" }}>
          {uploadWarning}
        </div>
      ) : null}
      {error ? <ErrorBox title={t("error.title")} message={error} /> : null}
      {loading && images.length === 0 ? <Loading text={t("status.refreshing")} /> : null}
      {!loading && !error && visible.length === 0 ? (
        <EmptyState title={images.length ? t("list.noMatchImages") : t("list.emptyImages")} />
      ) : null}

      <div className="dk-list">
        {visible.map((item) => {
          const label = imageLabel(item);
          return (
            <div className="dk-row" key={imageKey(item)}>
              <div className="dk-row-head" style={{ cursor: "default" }}>
                <div className="dk-row-main">
                  <div className="dk-row-title">
                    <span className="dk-name" title={label}>
                      {label}
                    </span>
                    {(() => {
                      const using = usage.get(imageKey(item)) || [];
                      if (!using.length) return null;
                      const running = using.filter((container) => container.state === "running");
                      const names = using
                        .map((container) => container.name)
                        .filter(Boolean)
                        .slice(0, 4)
                        .join(", ");
                      return running.length ? (
                        <span
                          className="dk-badge"
                          data-tone="ok"
                          title={t("image.usedByRunningHint", { names: names || "-" })}
                        >
                          {t("image.usedByRunning", { count: running.length })}
                        </span>
                      ) : (
                        <span
                          className="dk-badge"
                          data-tone="muted"
                          title={t("image.usedByStoppedHint", { names: names || "-" })}
                        >
                          {t("image.usedByStopped")}
                        </span>
                      );
                    })()}
                  </div>
                  <span className="dk-meta">
                    {item.size} · {item.createdSince}
                  </span>
                  <span className="dk-ports">{item.id.slice(0, 12)}</span>
                  <span className="dk-badge" data-tone="muted" title={t("image.sourceLocalHint")}>
                    {t("image.sourceLocal")}
                  </span>
                </div>
                <div className="dk-row-actions">
                  {hasServers ? (
                    <Btn
                      size="sm"
                      disabled={!targetId || Boolean(sshBusy) || task?.status === "running" || Boolean(uploading)}
                      title={
                        !targetId
                          ? t("image.uploadNeedTarget")
                          : connectedHere
                            ? t("image.uploadSameTarget")
                            : t("image.uploadSwitchHint")
                      }
                      onClick={() => void upload(item)}
                    >
                      {uploading === imageKey(item)
                        ? t("image.uploading")
                        : uploadConfirm === imageKey(item)
                          ? t("image.uploadConfirm")
                          : t("image.upload")}
                    </Btn>
                  ) : null}
                  <Btn
                    size="sm"
                    variant="danger"
                    disabled={busyId === imageKey(item)}
                    onClick={() => void remove(item)}
                  >
                    {confirmId === imageKey(item) ? t("image.removeConfirm") : t("image.remove")}
                  </Btn>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div>

      {deleting.active ? (
        <div className="dk-busy-mask" role="status" aria-live="polite">
          <span className="dk-spinner" aria-hidden="true" />
          <span className="dk-busy-text">{t("image.deleting", { image: deleting.label })}</span>
        </div>
      ) : null}
    </div>
  );
}
