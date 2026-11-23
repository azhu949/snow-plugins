// 项目视图：扫描当前项目的 Dockerfile / compose 文件。
// 每个 Dockerfile 一行摘要，点「配置」在同名弹窗里编辑运行配置（参考 IDEA 的
// Run/Debug Configurations）；compose 文件提供启动 / 停止 / 重启等操作。
import { h, getReact } from "./react.js";
import { Btn, EmptyState, Loading } from "./ui.jsx";
import { TaskLog } from "./tasklog.jsx";
import { ConfigDialog } from "./configdialog.jsx";
import { ConnectionCard } from "./overview.jsx";
import { baseName, suggestTag, toPosix } from "./runconfig.js";

const MAX_LOG_LINES = 800;
const SSH_REFRESH_MS = 15000;
/** 危险操作的二次点击确认窗口，与容器 / 镜像 / 服务器删除保持一致。 */
const CONFIRM_MS = 4000;

const stateTone = (state) => {
  const text = String(state || "").toLowerCase();
  if (text.includes("running") || text === "up") return "ok";
  if (text.includes("exited") || text.includes("stop")) return "muted";
  if (text.includes("restarting") || text.includes("pending")) return "warn";
  if (text.includes("dead") || text.includes("error")) return "bad";
  return "muted";
};

export function ProjectView({ t, rpc, notify, project, onOpenFile, active }) {
  const React = getReact();
  const [scan, setScan] = React.useState({ status: "idle", data: null, error: "" });
  const [runConfigSummaries, setRunConfigSummaries] = React.useState({});
  const [servers, setServers] = React.useState([]);
  const [dialog, setDialog] = React.useState({ open: false, path: "" });
  const [compose, setCompose] = React.useState({});
  const [task, setTask] = React.useState(null);
  const [busy, setBusy] = React.useState("");
  /** compose down 的二次点击确认键（`${file.path}:down`），与 busy 键同构。 */
  const [confirmDown, setConfirmDown] = React.useState("");
  const taskCursor = React.useRef({ id: "", offset: 0 });

  const root = project?.path || "";
  const remote = project?.kind === "ssh";
  const canScan = Boolean(root) && !remote;
  const projectName = project?.name || "";

  const rescan = React.useCallback(async () => {
    if (!canScan) return;
    setScan((prev) => ({ status: "loading", data: prev.data, error: "" }));
    try {
      const data = await rpc.scanProject(root);
      setScan({ status: "ready", data, error: "" });
      // 扫描只回摘要：env 值与完整配置在这里不落 state，等编辑或构建时按路径取。
      setRunConfigSummaries(
        data?.runConfigSummaries && typeof data.runConfigSummaries === "object" ? data.runConfigSummaries : {}
      );
    } catch (error) {
      setScan({ status: "error", data: null, error: String(error?.message || error) });
    }
  }, [canScan, root, rpc]);

  /** 读取一条运行配置的完整内容：配置弹窗与「构建并运行」都按需取。 */
  const loadProjectConfig = React.useCallback((path) => rpc.readProjectConfig(path), [rpc]);

  const refreshServers = React.useCallback(async () => {
    try {
      const data = await rpc.sshStatus();
      setServers(Array.isArray(data?.servers) ? data.servers : []);
    } catch {
      // 后台未就绪时忽略，等下次轮询。
    }
  }, [rpc]);

  React.useEffect(() => {
    setDialog({ open: false, path: "" });
    setCompose({});
    setTask(null);
    setConfirmDown("");
    taskCursor.current = { id: "", offset: 0 };
    void rescan();
  }, [root, rescan]);

  // 确认态超时自动回落，避免按钮长时间停在「确认移除」。
  React.useEffect(() => {
    if (!confirmDown) return undefined;
    const timer = setTimeout(() => setConfirmDown(""), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmDown]);

  React.useEffect(() => {
    void refreshServers();
  }, [refreshServers]);

  React.useEffect(() => {
    if (active === false) return undefined;
    const timer = setInterval(() => void refreshServers(), SSH_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, refreshServers]);

  const loadCompose = React.useCallback(
    async (file) => {
      setCompose((prev) => ({ ...prev, [file]: { status: "loading", names: [], services: [], error: "" } }));
      try {
        const data = await rpc.composeServices(file);
        setCompose((prev) => ({
          ...prev,
          [file]: {
            status: "ready",
            names: Array.isArray(data?.names) ? data.names : [],
            services: Array.isArray(data?.services) ? data.services : [],
            error: data?.error || "",
            // compose 只在本机执行：本机 docker 不可用时禁用按钮并展示原因。
            local: {
              available: data?.local?.available !== false,
              error: data?.local?.available === false ? String(data.local.error || "") : "",
            },
          },
        }));
      } catch (error) {
        setCompose((prev) => ({
          ...prev,
          [file]: { status: "error", names: [], services: [], error: String(error?.message || error) },
        }));
      }
    },
    [rpc]
  );

  // 扫描出 compose 文件后自动读一次服务清单（config --services 不需要 daemon）。
  React.useEffect(() => {
    const files = scan.data?.composeFiles || [];
    for (const file of files.slice(0, 5)) {
      if (!compose[file.path]) void loadCompose(file.path);
    }
  }, [scan.data, compose, loadCompose]);

  const acceptTask = React.useCallback((payload, kind, title) => {
    taskCursor.current = { id: payload.taskId, offset: 0 };
    setTask({
      id: payload.taskId,
      kind,
      title,
      status: "running",
      lines: [],
      error: "",
      exitCode: null,
      truncated: false,
    });
  }, []);

  // 任务轮询：每秒拉一次增量行，结束后自动停。
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
      } catch (error) {
        // 任务已过期或后台重启：停止轮询，保留已有输出。
        if (!cancelled) setTask((prev) => (prev ? { ...prev, status: "failed", error: String(error?.message || error) } : prev));
      }
    };
    const timer = setInterval(() => void tick(), 1000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [task?.id, task?.status, rpc]);

  // 任务成功后刷新 compose 服务状态。
  React.useEffect(() => {
    if (!task || task.status !== "succeeded") return;
    if (!task.kind.startsWith("compose-")) return;
    const file = String(task.title || "").split(" ")[0];
    for (const item of scan.data?.composeFiles || []) {
      if (baseName(item.path) === file) void loadCompose(item.path);
    }
  }, [task, scan.data, loadCompose]);

  /** 一条龙：前置构建 → docker build → docker run，对应 IDEA Dockerfile 的运行按钮。 */
  const startBuildRun = async (file, config) => {
    // 列表只有摘要：构建前按路径取完整配置，env 等值不常驻面板 state。
    const saved = config || (await loadProjectConfig(file.path))?.config || {};
    const tag = String(saved.tag || "").trim() || suggestTag(projectName, file);
    const payload = await rpc.buildAndRun({
      dockerfile: file.path,
      tag,
      context: saved.context || "",
      platform: saved.platform || "",
      noCache: saved.noCache === true,
      pull: saved.pull === true,
      buildArgs: Array.isArray(saved.buildArgs) ? saved.buildArgs : [],
      serverId: saved.serverId || "",
      preBuild: saved.preBuild || null,
      config: saved,
    });
    acceptTask(payload, "build-run", saved.containerName || tag);
    notify("info", t("project.buildRunStarted", { tag }));
  };

  const buildRunFromCard = async (file) => {
    setBusy(`${file.path}:build-run`);
    try {
      await startBuildRun(file);
    } catch (error) {
      notify("error", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };

  const openDialog = (path) => {
    const files = scan.data?.dockerfiles || [];
    setDialog({ open: true, path: path || files[0]?.path || "" });
  };

  const saveConfig = async (path, config, previousPath) => {
    const result = await rpc.saveProjectConfig(path, config, false, root);
    if (result?.summary) {
      setRunConfigSummaries((prev) => ({ ...prev, [path]: result.summary }));
    }

    // 改过 Dockerfile 路径：旧键上的配置要一并删掉，避免留下孤儿条目。
    if (previousPath && previousPath !== path) {
      try {
        await rpc.removeProjectConfig(previousPath);
        setRunConfigSummaries((prev) => {
          const next = { ...prev };
          delete next[previousPath];
          return next;
        });
      } catch {
        // 旧条目删不掉不影响新配置。
      }
      // 路径变了就重扫：新路径靠扫描的 extraPaths 兜底成手动登记条目，
      // 不重扫的话弹窗列表里没有这一项，选中项也无处可落。
      await rescan();
    }
    notify("success", t("project.configSaved"));
  };

  const removeConfig = async (path) => {
    await rpc.removeProjectConfig(path);
    setRunConfigSummaries((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    notify("success", t("project.configDeleted"));
    // 手动登记的文件删掉配置后就不该继续出现在列表里。
    const target = (scan.data?.dockerfiles || []).find((file) => file.path === path);
    if (target?.manual) await rescan();
  };

  const addDockerfile = async (path) => {
    const name = baseName(path);
    const file = { path, relative: name, name, depth: 0 };
    // 只是登记路径：服务器在真正构建 / 运行时才必须选，登记阶段允许留空。
    await rpc.saveProjectConfig(toPosix(path), { name, tag: suggestTag(projectName, file) }, true, root);
    await rescan();
  };

  const runCompose = async (file, action) => {
    // down 会停止并删除容器与网络：沿用项目里其它删除操作的二次点击确认。
    if (action === "down") {
      const key = `${file}:down`;
      if (confirmDown !== key) {
        setConfirmDown(key);
        return;
      }
      setConfirmDown("");
    }
    setBusy(`${file}:${action}`);
    try {
      const payload = await rpc.composeAction(file, action);
      acceptTask(payload, `compose-${action}`, `${baseName(file)} ${action}`);
      notify("info", t("project.composeStarted", { action }));
    } catch (error) {
      notify("error", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };

  if (!root) {
    return (
      <div className="dk-body">
        <EmptyState title={t("project.noProject")} hint={t("project.noProjectHint")} />
      </div>
    );
  }

  if (remote) {
    return (
      <div className="dk-body">
        <EmptyState title={t("project.remoteUnsupported")} hint={root} />
      </div>
    );
  }

  const dockerfiles = scan.data?.dockerfiles || [];
  const composeFiles = scan.data?.composeFiles || [];

  return (
    <div className="dk-body">
      <div className="dk-toolbar" style={{ paddingBottom: "4px" }}>
        <span className="dk-meta" title={root} style={{ flex: "1 1 auto", minWidth: 0 }}>
          {projectName ? `${projectName} · ` : ""}
          {root}
        </span>
        <Btn size="sm" variant="ghost" disabled={scan.status === "loading"} onClick={() => openDialog("")}>
          {t("project.runConfigs")}
        </Btn>
        <Btn size="sm" disabled={scan.status === "loading"} onClick={() => void rescan()}>
          {t("project.rescan")}
        </Btn>
      </div>

      <div style={{ padding: "0 10px 8px" }}>
        <TaskLog
          t={t}
          task={task}
          onCancel={() => {
            void rpc.cancelTask(task.id).catch(() => {});
          }}
          onClear={() => setTask(null)}
        />
      </div>

      {/* Dockerfile 卡片放在最上面：项目页的主入口。 */}
      <div className="dk-list" style={{ paddingBottom: "8px" }}>
        {dockerfiles.length ? (
          <div className="dk-card">
            <div className="dk-card-title">
              <span>{t("project.dockerfiles")}</span>
              <span className="dk-pill">{dockerfiles.length}</span>
            </div>

            {dockerfiles.map((file) => {
              const config = runConfigSummaries[file.path] || null;
              const server = config?.serverId ? servers.find((item) => item.id === config.serverId) : null;
              const meta = [
                config?.tag || suggestTag(projectName, file),
                config?.platform || "",
                server ? `${t("project.configServer")} ${server.name || server.host}` : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={file.path} style={{ padding: "6px 0", borderTop: "1px solid var(--dk-border)" }}>
                  <div className="dk-row-title" style={{ flexWrap: "wrap", rowGap: "4px" }}>
                    <span className="dk-name" title={file.path}>
                      {config?.name || file.relative}
                    </span>
                    {file.manual ? (
                      <span className="dk-badge" data-tone="muted">
                        {t("project.manual")}
                      </span>
                    ) : null}
                    {file.missing ? (
                      <span className="dk-badge" data-tone="bad">
                        {t("project.missing")}
                      </span>
                    ) : null}
                    {config ? (
                      <span className="dk-badge" data-tone="ok" title={t("project.configuredHint")}>
                        {t("project.configured")}
                      </span>
                    ) : null}
                    <span className="dk-head-spacer" />
                    <Btn size="sm" variant="ghost" onClick={() => onOpenFile?.(file.path)}>
                      {t("project.openFile")}
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => openDialog(file.path)}>
                      {t("project.config")}
                    </Btn>
                    <Btn
                      size="sm"
                      variant="primary"
                      disabled={busy === `${file.path}:build-run` || file.missing || task?.status === "running"}
                      onClick={() => void buildRunFromCard(file)}
                    >
                      {busy === `${file.path}:build-run` ? t("project.building") : t("project.buildRun")}
                    </Btn>
                  </div>
                  <div className="dk-meta" title={file.relative} style={{ marginTop: "2px" }}>
                    {file.relative}
                    {` · ${meta}`}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* 本机 Docker 设置与 compose 文件无关：没有 compose 时也要能填 CLI 绝对路径（镜像上传也用它）。 */}
      <div style={{ padding: "0 10px 8px" }}>
        <ConnectionCard
          t={t}
          rpc={rpc}
          notify={notify}
          title={t("project.localDocker")}
          onSaved={() => setCompose({})}
        />
      </div>

      {scan.status === "loading" ? <Loading text={t("project.scanning")} /> : null}
      {scan.status === "error" ? <div className="dk-inline-error" style={{ padding: "0 10px 8px" }}>{scan.error}</div> : null}

      {scan.status === "ready" && dockerfiles.length === 0 && composeFiles.length === 0 ? (
        <EmptyState title={t("project.empty")} hint={t("project.emptyHint")} />
      ) : null}

      <div className="dk-list">
        {composeFiles.map((file) => {
          const info = compose[file.path];
          // compose 走本机 docker：本机 CLI 不可用时按钮禁用，避免点了才看到 spawn 失败。
          const localBlocked = info?.local?.available === false;
          return (
            <div className="dk-card" key={file.path}>
              <div className="dk-card-title">
                <span className="dk-name" title={file.path}>
                  {file.relative}
                </span>
                <span className="dk-badge" data-tone="muted" title={t("project.composeLocalHint")}>
                  {t("project.composeLocal")}
                </span>
                <span className="dk-pill">
                  <Btn size="sm" variant="ghost" onClick={() => onOpenFile?.(file.path)}>
                    {t("project.openFile")}
                  </Btn>
                </span>
              </div>

              <div className="dk-actionbar" style={{ marginBottom: "6px" }}>
                <Btn
                  size="sm"
                  variant="primary"
                  disabled={Boolean(busy) || task?.status === "running" || localBlocked}
                  onClick={() => void runCompose(file.path, "up")}
                >
                  {t("project.composeUp")}
                </Btn>
                <Btn
                  size="sm"
                  disabled={Boolean(busy) || task?.status === "running" || localBlocked}
                  onClick={() => void runCompose(file.path, "stop")}
                >
                  {t("project.composeStop")}
                </Btn>
                <Btn
                  size="sm"
                  disabled={Boolean(busy) || task?.status === "running" || localBlocked}
                  onClick={() => void runCompose(file.path, "restart")}
                >
                  {t("project.composeRestart")}
                </Btn>
                <Btn
                  size="sm"
                  variant="danger"
                  disabled={Boolean(busy) || task?.status === "running" || localBlocked}
                  onClick={() => void runCompose(file.path, "down")}
                >
                  {confirmDown === `${file.path}:down` ? t("project.composeDownConfirm") : t("project.composeDown")}
                </Btn>
              </div>

              {info?.status === "loading" ? <Loading text={t("project.loadingServices")} /> : null}
              {info?.error ? <div className="dk-inline-error">{info.error}</div> : null}
              {localBlocked ? (
                <div className="dk-inline-error">
                  {t("project.composeLocalUnavailable")}
                  {info?.local?.error ? ` · ${info.local.error}` : ""}
                </div>
              ) : null}

              {info?.services?.length ? (
                <div className="dk-kv">
                  {info.services.map((service) => (
                    <Field key={service.service || service.name} label={service.service || service.name} value={`${service.state}${service.health ? ` · ${service.health}` : ""}`} tone={stateTone(service.state)} />
                  ))}
                </div>
              ) : null}

              {info?.status === "ready" && !info.services.length && info.names.length ? (
                <div className="dk-chips">
                  {info.names.map((name) => (
                    <span className="dk-chip" key={name}>
                      {name}
                    </span>
                  ))}
                </div>
              ) : null}
              {info?.status === "ready" && !info.services.length && !info.names.length && !info.error ? (
                <div className="dk-meta">{t("project.noServices")}</div>
              ) : null}
            </div>
          );
        })}
      </div>

      {scan.data?.truncated ? <div className="dk-meta" style={{ padding: "0 10px 10px" }}>{t("project.truncated")}</div> : null}

      {dialog.open ? (
        <ConfigDialog
          t={t}
          files={dockerfiles}
          runConfigSummaries={runConfigSummaries}
          onLoadConfig={loadProjectConfig}
          servers={servers}
          projectName={projectName}
          projectRoot={scan.data?.root || ""}
          initialPath={dialog.path}
          onSave={saveConfig}
          onRemove={removeConfig}
          onAdd={addDockerfile}
          onLoadScripts={(path, dir) => rpc.packageScripts(path, dir)}
          onClose={() => setDialog({ open: false, path: "" })}
        />
      ) : null}
    </div>
  );
}

/** 带状态色的键值行：compose 服务状态用得上。 */
function Field({ label, value, tone }) {
  return [
    <span key="k" className="dk-kv-key">
      {label}
    </span>,
    <span key="v" className="dk-kv-value">
      {tone ? <span className="dk-badge" data-tone={tone} style={{ marginRight: "5px" }}>{value}</span> : value}
    </span>,
  ];
}
