// 远程视图（独立标签页）：只做 SSH 服务器配置与连接管理。
// 支持保存多台服务器，逐台连接；密码存宿主安全存储，不回显。镜像上传在「镜像」标签页里发起。
import { h, Fragment, getReact } from "./react.js";
import { Btn, EmptyState, Field, Loading } from "./ui.jsx";

const DEFAULT_DOCKER_PATH = "docker";
const STATUS_POLL_MS = 8000;
const CONFIRM_MS = 4000;

const STATUS_TONE = {
  idle: "muted",
  connecting: "warn",
  connected: "ok",
  closed: "warn",
  error: "bad",
};

const emptyForm = () => ({
  id: "",
  name: "",
  host: "",
  port: 22,
  username: "",
  password: "",
  dockerPath: DEFAULT_DOCKER_PATH,
  hostKey: "",
});

const formatClock = (value) => {
  const stamp = Number(value);
  if (!Number.isFinite(stamp) || stamp <= 0) return "";
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const serverLabel = (item) => item.name || `${item.username || "root"}@${item.host || ""}`;

export function SshView({ t, rpc, notify }) {
  const React = getReact();
  const [servers, setServers] = React.useState([]);
  const [currentId, setCurrentId] = React.useState("");
  const [session, setSession] = React.useState({ status: "idle", id: "", docker: null, error: null, connectedAt: null });
  const [form, setForm] = React.useState(emptyForm);
  const [hasPassword, setHasPassword] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [test, setTest] = React.useState({ status: "idle", message: "", error: "" });
  const [confirmId, setConfirmId] = React.useState("");
  const [hostKeyConfirm, setHostKeyConfirm] = React.useState(false);
  const [passwordConfirm, setPasswordConfirm] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  /** null = 只看列表；"new" = 新增；服务器 id = 编辑已有那台。表单只在有值时展开。 */
  const [editing, setEditing] = React.useState(null);

  const aliveRef = React.useRef(true);
  const formRef = React.useRef(null);

  const applyStatus = React.useCallback((payload) => {
    setServers(Array.isArray(payload?.servers) ? payload.servers : []);
    setCurrentId(String(payload?.currentId || ""));
    setSession({
      status: payload?.status || "idle",
      id: String(payload?.id || ""),
      docker: payload?.docker || null,
      error: payload?.error || null,
      connectedAt: payload?.connectedAt || null,
    });
  }, []);

  /**
   * 只更新服务器列表：/ssh/save 与 /ssh/remove 的返回没有会话字段，
   * 用 applyStatus 会把界面的连接状态误置为 idle。
   */
  const applyServers = React.useCallback((payload) => {
    setServers(Array.isArray(payload?.servers) ? payload.servers : []);
    setCurrentId(String(payload?.currentId || ""));
  }, []);

  const selectServer = React.useCallback((item) => {
    setForm({
      id: item.id || "",
      name: item.name || "",
      host: item.host || "",
      port: item.port || 22,
      username: item.username || "",
      password: "",
      dockerPath: item.dockerPath || DEFAULT_DOCKER_PATH,
      hostKey: item.hostKey || "",
    });
    setHasPassword(item.hasPassword === true);
    setTest({ status: "idle", message: "", error: "" });
    setError("");
    setHostKeyConfirm(false);
    setPasswordConfirm(false);
  }, []);

  /** 点列表行：载入该服务器并展开表单。 */
  const editServer = React.useCallback(
    (item) => {
      selectServer(item);
      setEditing(item.id || "new");
    },
    [selectServer]
  );

  const startNew = React.useCallback(() => {
    setForm(emptyForm());
    setHasPassword(false);
    setTest({ status: "idle", message: "", error: "" });
    setError("");
    setHostKeyConfirm(false);
    setPasswordConfirm(false);
    setEditing("new");
  }, []);

  const closeForm = React.useCallback(() => {
    setEditing(null);
    setForm(emptyForm());
    setHasPassword(false);
    setTest({ status: "idle", message: "", error: "" });
    setError("");
    setHostKeyConfirm(false);
    setPasswordConfirm(false);
  }, []);

  // 展开表单后滚到可见位置：面板不高时表单在列表下方，不滚动会以为没出现。
  React.useEffect(() => {
    if (!editing) return;
    const node = formRef.current;
    if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
  }, [editing]);

  React.useEffect(() => {
    aliveRef.current = true;
    (async () => {
      try {
        const data = await rpc.sshStatus();
        if (!aliveRef.current) return;
        applyStatus(data);
        setLoaded(true);
      } catch (cause) {
        if (aliveRef.current) {
          setError(String(cause?.message || cause));
          setLoaded(true);
        }
      }
    })();
    return () => {
      aliveRef.current = false;
    };
  }, [rpc, applyStatus]);

  // 只刷新列表与会话状态，不动正在编辑的表单。
  React.useEffect(() => {
    const tick = async () => {
      try {
        const data = await rpc.sshStatus();
        if (aliveRef.current) applyStatus(data);
      } catch {
        // 后台重启期间忽略。
      }
    };
    const timer = setInterval(() => void tick(), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [rpc, applyStatus]);

  React.useEffect(() => {
    if (!confirmId) return undefined;
    const timer = setTimeout(() => setConfirmId(""), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmId]);

  React.useEffect(() => {
    if (!hostKeyConfirm) return undefined;
    const timer = setTimeout(() => setHostKeyConfirm(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [hostKeyConfirm]);

  React.useEffect(() => {
    if (!passwordConfirm) return undefined;
    const timer = setTimeout(() => setPasswordConfirm(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [passwordConfirm]);

  const connected = session.status === "connected";
  const connectedHere = connected && session.id === form.id && Boolean(form.id);

  const buildServer = () => ({
    id: form.id || undefined,
    name: form.name.trim(),
    host: form.host.trim(),
    port: Number(form.port) || 22,
    username: form.username.trim(),
    dockerPath: form.dockerPath.trim() || DEFAULT_DOCKER_PATH,
  });

  const canSubmit = Boolean(form.host.trim() && form.username.trim());

  const save = async () => {
    const payload = { server: buildServer() };
    if (form.password) payload.password = form.password;
    const data = await rpc.sshSave(payload);
    applyServers(data);
    const savedId = data?.savedId || form.id;
    const item = (data?.servers || []).find((row) => row.id === savedId);
    if (item) selectServer(item);
    // 保存后保持表单展开并指向这一台，列表里同时出现新的一条。
    setEditing(savedId || "new");
    return { savedId, passwordSaved: data?.passwordSaved !== false };
  };

  const saveOnly = async () => {
    setBusy("save");
    setError("");
    try {
      const { passwordSaved } = await save();
      // 配置已经落库但密码没写进安全存储：如实提示，避免用户以为密码已保存。
      if (passwordSaved) notify("success", t("ssh.saved"));
      else notify("warn", t("ssh.passwordNotSaved"));
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };

  const connectServer = async (id) => {
    setBusy("connect");
    setError("");
    setTest({ status: "idle", message: "", error: "" });
    try {
      await rpc.sshConnect(id);
      const data = await rpc.sshStatus();
      if (aliveRef.current) {
        applyStatus(data);
        // 首次连接会当场记录主机指纹：把表单里的状态同步过来，不用重新点一次列表。
        const item = (data?.servers || []).find((row) => row.id === id);
        if (item) setForm((prev) => (prev.id === id ? { ...prev, hostKey: item.hostKey || "" } : prev));
      }
      notify("success", t("ssh.connected"));
    } catch (cause) {
      const message = String(cause?.message || cause);
      setError(message);
      setSession((prev) => ({ ...prev, status: "error", error: message }));
    } finally {
      setBusy("");
    }
  };

  const saveAndConnect = async () => {
    setBusy("connect");
    setError("");
    setTest({ status: "idle", message: "", error: "" });
    try {
      const { savedId, passwordSaved } = await save();
      if (!savedId) throw new Error(t("ssh.saveFirst"));
      // 密码没写进安全存储时连接必然失败：直接说明原因，省一次无意义的连接尝试。
      if (!passwordSaved) {
        setError(t("ssh.passwordNotSaved"));
        setBusy("");
        return;
      }
      await connectServer(savedId);
    } catch (cause) {
      setError(String(cause?.message || cause));
      setBusy("");
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    setError("");
    try {
      await rpc.sshDisconnect();
      const data = await rpc.sshStatus();
      if (aliveRef.current) applyStatus(data);
      notify("success", t("ssh.disconnected"));
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };

  const remove = async (item) => {
    if (confirmId !== item.id) {
      setConfirmId(item.id);
      return;
    }
    setConfirmId("");
    setBusy(`remove:${item.id}`);
    setError("");
    try {
      const data = await rpc.sshRemove(item.id);
      applyServers(data);
      if (editing === item.id || form.id === item.id) {
        const remaining = Array.isArray(data?.servers) ? data.servers : [];
        if (remaining.length) editServer(remaining[0]);
        else closeForm();
      }
      notify("success", t("ssh.removed"));
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };

  const runTest = async () => {
    setBusy("test");
    setError("");
    setTest({ status: "loading", message: "", error: "" });
    try {
      const payload = { ...buildServer() };
      if (!payload.id) delete payload.id;
      if (form.password) payload.password = form.password;
      const result = await rpc.sshTest(payload);
      const docker = result?.docker || {};
      if (docker.ok) {
        setTest({ status: "ok", message: t("ssh.testOk", { version: docker.version || "" }), error: "" });
      } else {
        setTest({ status: "error", message: "", error: docker.error || t("ssh.dockerUnavailable") });
      }
    } catch (cause) {
      setTest({ status: "error", message: "", error: String(cause?.message || cause) });
    } finally {
      setBusy("");
    }
  };

  /**
   * 指纹变化会阻断连接：确认服务器确实重装或更换密钥后，才允许清掉旧指纹。
   * 清掉后下次连接会重新记录（TOFU），期间不做任何自动信任。
   */
  const resetHostKey = async () => {
    if (!form.id) return;
    if (!hostKeyConfirm) {
      setHostKeyConfirm(true);
      return;
    }
    setHostKeyConfirm(false);
    setBusy("hostkey");
    setError("");
    try {
      const data = await rpc.sshSave({ server: buildServer(), resetHostKey: true });
      applyServers(data);
      const savedId = data?.savedId || form.id;
      const item = (data?.servers || []).find((row) => row.id === savedId);
      if (item) selectServer(item);
      notify("success", t("ssh.hostKeyResetDone"));
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };

  /**
   * 清除已保存的密码：密码框留空代表「不修改」，删除凭据必须有独立入口并二次确认。
   */
  const clearPassword = async () => {
    if (!form.id) return;
    if (!passwordConfirm) {
      setPasswordConfirm(true);
      return;
    }
    setPasswordConfirm(false);
    setBusy("password");
    setError("");
    try {
      const data = await rpc.sshSave({ server: buildServer(), clearPassword: true });
      applyServers(data);
      const savedId = data?.savedId || form.id;
      const item = (data?.servers || []).find((row) => row.id === savedId);
      if (item) selectServer(item);
      if (data?.passwordCleared === false) notify("warn", t("ssh.clearPasswordFailed"));
      else notify("success", t("ssh.clearPasswordDone"));
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };

  const statusTone = STATUS_TONE[session.status] || "muted";
  const statusText =
    session.status === "connecting"
      ? t("ssh.statusConnecting")
      : session.status === "connected"
        ? t("ssh.statusConnected")
        : session.status === "error"
          ? t("ssh.statusError")
          : session.status === "closed"
            ? t("ssh.statusClosed")
            : t("ssh.statusIdle");

  const connectedName = servers.find((item) => item.id === session.id);
  const lastUsedName = currentId && currentId !== form.id ? serverLabel(servers.find((item) => item.id === currentId) || {}) : "";

  return (
    <div className="dk-body">
      <div className="dk-overview">
        <div className="dk-card">
          <div className="dk-card-title">
            <span>{t("ssh.servers")}</span>
            <span className="dk-pill">
              <span className="dk-dot" data-tone={statusTone} />
              {connected ? `${statusText}${connectedName ? ` · ${serverLabel(connectedName)}` : ""}` : statusText}
            </span>
          </div>

          {!loaded ? <Loading text={t("status.checking")} /> : null}

          {loaded && servers.length === 0 ? (
            <EmptyState title={t("ssh.empty")} hint={t("ssh.emptyHint")} />
          ) : null}

          {servers.length ? (
            <div className="dk-ssh-rows">
              {servers.map((item) => {
                const active = editing === item.id;
                const live = connected && session.id === item.id;
                return (
                  <div
                    key={item.id}
                    className="dk-ssh-row"
                    data-active={active ? "1" : "0"}
                    role="button"
                    tabIndex={0}
                    onClick={() => editServer(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        editServer(item);
                      }
                    }}
                  >
                    <span className="dk-dot" data-tone={live ? "ok" : "muted"} />
                    <span className="dk-name" title={serverLabel(item)}>
                      {serverLabel(item)}
                    </span>
                    <span className="dk-meta">
                      {item.username}@{item.host}:{item.port}
                    </span>
                    <Btn
                      size="sm"
                      variant="danger"
                      disabled={Boolean(busy)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void remove(item);
                      }}
                    >
                      {confirmId === item.id ? t("ssh.removeConfirm") : t("ssh.remove")}
                    </Btn>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="dk-actionbar" style={{ marginTop: "8px" }}>
            <Btn size="sm" variant={editing === "new" ? undefined : "primary"} onClick={editing ? closeForm : startNew}>
              {editing ? t("ssh.cancel") : t("ssh.addServer")}
            </Btn>
            {lastUsedName ? <span className="dk-meta">{t("ssh.lastUsed", { name: lastUsedName })}</span> : null}
          </div>
        </div>

        {editing ? (
          <div className="dk-card" ref={formRef}>
            <div className="dk-card-title">
              <span>{editing === "new" ? t("ssh.newServer") : form.name || serverLabel(form)}</span>
              <span className="dk-pill">
                {connectedHere
                  ? h(
                      Fragment,
                      null,
                      h("span", { className: "dk-dot", "data-tone": "ok" }),
                      t("ssh.statusConnected")
                    )
                  : null}
              </span>
            </div>

          <div className="dk-form">
            <label className="dk-field">
              <span className="dk-meta">{t("ssh.name")}</span>
              <input
                className="dk-input"
                value={form.name}
                placeholder={t("ssh.namePlaceholder")}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </label>

            <div className="dk-form-row">
              <label className="dk-field dk-field-grow">
                <span className="dk-meta">{t("ssh.host")}</span>
                <input
                  className="dk-input"
                  value={form.host}
                  placeholder="192.168.1.10"
                  onChange={(event) => setForm((prev) => ({ ...prev, host: event.target.value }))}
                />
              </label>
              <label className="dk-field dk-field-port">
                <span className="dk-meta">{t("ssh.port")}</span>
                <input
                  className="dk-input"
                  value={form.port}
                  inputMode="numeric"
                  onChange={(event) => setForm((prev) => ({ ...prev, port: event.target.value }))}
                />
              </label>
            </div>

            <label className="dk-field">
              <span className="dk-meta">{t("ssh.username")}</span>
              <input
                className="dk-input"
                value={form.username}
                placeholder="root"
                autoComplete="off"
                onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
              />
            </label>

            <label className="dk-field">
              <span className="dk-meta">
                {t("ssh.password")}
                {hasPassword ? ` · ${t("ssh.passwordSaved")}` : ` · ${t("ssh.passwordEmpty")}`}
              </span>
              <input
                className="dk-input"
                type="password"
                value={form.password}
                placeholder={hasPassword ? "******" : ""}
                autoComplete="new-password"
                onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              />
            </label>

            {form.id && hasPassword ? (
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <Btn size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void clearPassword()}>
                  {passwordConfirm ? t("ssh.clearPasswordConfirm") : t("ssh.clearPassword")}
                </Btn>
              </div>
            ) : null}

            <label className="dk-field">
              <span className="dk-meta">{t("ssh.dockerPath")}</span>
              <input
                className="dk-input"
                value={form.dockerPath}
                placeholder="docker"
                onChange={(event) => setForm((prev) => ({ ...prev, dockerPath: event.target.value }))}
              />
            </label>

            {form.id ? (
              <div className="dk-field">
                <span className="dk-meta">{t("ssh.hostKey")}</span>
                <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                  <span
                    className="dk-meta"
                    style={{ flex: "1 1 100%", wordBreak: "break-all" }}
                    title={form.hostKey || t("ssh.hostKeyNone")}
                  >
                    {form.hostKey || t("ssh.hostKeyNone")}
                  </span>
                  {form.hostKey ? (
                    <Btn
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(busy)}
                      title={t("ssh.hostKeyHint")}
                      onClick={() => void resetHostKey()}
                    >
                      {hostKeyConfirm ? t("ssh.hostKeyResetConfirm") : t("ssh.hostKeyReset")}
                    </Btn>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="dk-actionbar" style={{ marginTop: "8px" }}>
            <Btn size="sm" variant="primary" disabled={Boolean(busy) || !canSubmit} onClick={() => void saveAndConnect()}>
              {busy === "connect" ? t("ssh.connecting") : t("ssh.connect")}
            </Btn>
            <Btn size="sm" disabled={Boolean(busy) || !canSubmit} onClick={() => void runTest()}>
              {busy === "test" ? t("ssh.testing") : t("ssh.test")}
            </Btn>
            <Btn size="sm" disabled={Boolean(busy) || !canSubmit} onClick={() => void saveOnly()}>
              {t("ssh.save")}
            </Btn>
            {connected ? (
              <Btn size="sm" disabled={Boolean(busy)} onClick={() => void disconnect()}>
                {t("ssh.disconnect")}
              </Btn>
            ) : null}
            <Btn size="sm" variant="ghost" disabled={Boolean(busy)} onClick={closeForm}>
              {t("ssh.cancel")}
            </Btn>
          </div>

          {connectedHere ? (
            <div className="dk-kv" style={{ marginTop: "8px" }}>
              <Field label={t("ssh.target")} value={session.host} />
              <Field label={t("ssh.dockerVersion")} value={session.docker?.version || t("ssh.unknown")} />
              <Field label={t("ssh.connectedAt")} value={formatClock(session.connectedAt)} />
            </div>
          ) : null}

          {connectedHere && session.docker && session.docker.ok === false && session.docker.error ? (
            <div className="dk-inline-error">{session.docker.error}</div>
          ) : null}
          {test.status === "loading" ? <div className="dk-meta">{t("ssh.testing")}</div> : null}
          {test.status === "ok" ? <div className="dk-ok-text">{test.message}</div> : null}
          {test.status === "error" ? <div className="dk-inline-error">{test.error}</div> : null}
          {session.status === "error" && session.error ? <div className="dk-inline-error">{session.error}</div> : null}
          {error ? <div className="dk-inline-error">{error}</div> : null}

          <div className="dk-meta" style={{ marginTop: "6px" }}>
            {t("ssh.onlyPassword")}
          </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
