// 免确认页：全局与项目免审批工具清单；敏感命令规则只读展示。
import { getReact, h } from "./react.js";
import { Badge, Btn, ErrorBox, Loading, SectionTitle } from "./ui.jsx";

export function ApprovalView({ t, rpc, notify, config, reload }) {
  const React = getReact();
  const [projectId, setProjectId] = React.useState(config?.approval?.projectId || "");
  /** 已读取清单所属的项目：写入目标只认它，避免把为 A 准备的名字投到 B。 */
  const [loadedProjectId, setLoadedProjectId] = React.useState("");
  const [state, setState] = React.useState({ status: "loading", error: "", data: null });
  const [globalTools, setGlobalTools] = React.useState([]);
  const [newTool, setNewTool] = React.useState("");
  const [projectTools, setProjectTools] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [projectLoading, setProjectLoading] = React.useState(false);
  // 宿主逐字段吞掉采集异常时清单字段为 null：此时不是「清单为空」，而是「读不到」，不能保存。
  const unreadable = Boolean(state.data?.denied || state.data?.unknown);
  // 项目清单同样存在「读不到」：不能当成空清单，更不能拿着上一个项目的输入去写。
  const projectKnown = Boolean(state.data?.projectKnown);
  const projectUnreadable = Boolean(loadedProjectId) && !projectKnown;
  const projectMismatch = Boolean(loadedProjectId) && projectId.trim() !== loadedProjectId;
  const readNames = () =>
    projectTools
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  // 与后台 readToolNames 的去重口径一致：界面上报的数量必须等于实际写入的数量。
  const pendingCount = new Set(readNames()).size;
  const globalBaseline = Array.isArray(state.data?.globalTools) ? state.data.globalTools : [];
  const globalAdded = globalTools.filter((tool) => !globalBaseline.includes(tool)).length;
  const globalRemoved = globalBaseline.filter((tool) => !globalTools.includes(tool)).length;

  const load = React.useCallback(
    async (id) => {
      const target = String(id || "").trim();
      setProjectLoading(true);
      try {
        const data = await rpc.approval(target);
        setState({ status: "ready", error: "", data });
        setGlobalTools(data?.globalTools || []);
        // 清单区展示的永远是该项目的既有清单：读取成功后清空待写入文本，避免上一个项目的残留。
        setProjectTools("");
        setLoadedProjectId(target);
      } catch (error) {
        setState({ status: "error", error: String(error?.message || error), data: null });
        setLoadedProjectId("");
      } finally {
        setProjectLoading(false);
      }
    },
    [rpc]
  );

  React.useEffect(() => {
    void load(config?.approval?.projectId || "");
    // 只在首次挂载加载；项目变更由输入框的刷新按钮触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc]);

  const addTool = () => {
    if (unreadable) {
      notify("bad", t("approval.unreadableNotSavable"));
      return;
    }
    const tool = newTool.trim();
    if (!tool) return;
    if (!/^[A-Za-z0-9_.:\-/]{1,160}$/.test(tool)) {
      notify("warn", t("approval.invalidTool"));
      return;
    }
    setGlobalTools((list) => (list.includes(tool) ? list : [...list, tool]));
    setNewTool("");
  };

  const saveGlobal = async () => {
    if (busy) return;
    if (unreadable) {
      notify("bad", t("approval.unreadableNotSavable"));
      return;
    }
    if (globalTools.length === 0) {
      notify("warn", t("approval.emptyNotSavable"));
      return;
    }
    setBusy("global");
    try {
      // 保存前重读一次清单：页面打开后宿主设置页或另一个窗口可能新增了授权，整表覆盖会静默抹掉。
      const latest = await rpc.approval(projectId);
      if (latest?.denied || latest?.unknown) {
        setState({ status: "ready", error: "", data: latest });
        notify("bad", t("approval.unreadableNotSavable"));
        return;
      }
      const latestHash = latest?.globalToolsHash || "";
      if (state.data?.globalToolsHash && latestHash !== state.data.globalToolsHash) {
        // 先刷新基线并保留用户的编辑内容：再次点击保存等于确认用当前编辑覆盖外部变化。
        setState({ status: "ready", error: "", data: latest });
        notify("warn", t("approval.staleList"));
        return;
      }
      const result = await rpc.setGlobalTools(globalTools, latestHash);
      // 只有确实读到清单时才回填：读不到时保留用户正在编辑的内容，别把界面清成空。
      if (result?.current && !result.current.unknown && !result.current.denied) {
        setGlobalTools(result.current.globalTools || globalTools);
      }
      notify("ok", t("approval.globalSaved"));
      await load(projectId);
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };

  const applyProject = async (approved) => {
    if (busy) return;
    const names = [...new Set(readNames())];
    if (!loadedProjectId) {
      notify("warn", t("approval.projectLoadRequired"));
      return;
    }
    if (projectId.trim() !== loadedProjectId) {
      notify("warn", t("approval.projectReloadRequired"));
      return;
    }
    if (!projectKnown) {
      notify("bad", t("approval.projectUnreadable"));
      return;
    }
    if (names.length === 0) {
      notify("warn", t("approval.toolRequired"));
      return;
    }
    setBusy("project");
    try {
      const result = await rpc.setProjectTools(loadedProjectId, names, approved);
      // 授权已写入宿主但记账没落下时不能报「已授权」了事：撤回会撤不到它。
      if (approved && result?.limitReached) {
        notify("warn", t("approval.projectLimitReached"));
      } else {
        notify("ok", approved ? t("approval.projectGranted") : t("approval.projectRevoked"));
      }
      await load(loadedProjectId);
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };

  if (state.status === "loading") return <Loading text={t("common.loading")} />;
  if (state.status === "error") {
    return (
      <ErrorBox
        title={t("error.title")}
        message={state.error}
        action={<Btn size="sm" onClick={() => void load(projectId)}>{t("action.retry")}</Btn>}
      />
    );
  }

  const data = state.data || {};
  const sensitive = Array.isArray(data.sensitiveCommands) ? data.sensitiveCommands : [];

  return (
    <div className="pg-stack">
      <div className="pg-card">
        <SectionTitle extra={<Badge tone="warn">{t("approval.replaceWarn")}</Badge>}>
          {t("approval.globalTitle")}
        </SectionTitle>
        <div className="pg-note">{t("approval.globalHint")}</div>
        {unreadable ? (
          <div className="pg-inline-warn">
            {`${t("approval.unreadableTitle")}：${data.denied?.reason || t("approval.unreadableHint")}`}
          </div>
        ) : null}
        {!unreadable ? (
          <div className="pg-meta">
            {t("approval.globalDiff", {
              total: globalTools.length,
              added: globalAdded,
              removed: globalRemoved,
            })}
          </div>
        ) : null}
        <div className="pg-chips">
          {globalTools.length === 0 ? <span className="pg-meta">{t("approval.empty")}</span> : null}
          {globalTools.map((tool) => (
            <span className="pg-chip" key={tool}>
              <span>{tool}</span>
              <button
                type="button"
                className="pg-chip-x"
                title={t("action.remove")}
                onClick={() => setGlobalTools((list) => list.filter((item) => item !== tool))}
              >
                x
              </button>
            </span>
          ))}
        </div>
        <div className="pg-row">
          <input
            className="pg-input"
            value={newTool}
            placeholder={t("approval.toolPlaceholder")}
            disabled={unreadable}
            onChange={(event) => setNewTool(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addTool();
            }}
          />
          <Btn size="sm" disabled={unreadable} onClick={addTool}>
            {t("action.add")}
          </Btn>
          <Btn
            size="sm"
            variant="primary"
            disabled={busy !== "" || unreadable || globalTools.length === 0}
            onClick={() => void saveGlobal()}
          >
            {t("approval.saveGlobal")}
          </Btn>
        </div>
      </div>

      <div className="pg-card">
        <SectionTitle>{t("approval.projectTitle")}</SectionTitle>
        <div className="pg-note">{t("approval.projectHint")}</div>
        <div className="pg-row">
          <input
            className="pg-input"
            value={projectId}
            placeholder={t("approval.projectPlaceholder")}
            onChange={(event) => setProjectId(event.target.value)}
          />
          <Btn
            size="sm"
            variant="ghost"
            disabled={projectLoading || busy !== ""}
            onClick={() => void load(projectId.trim())}
          >
            {t("action.load")}
          </Btn>
        </div>
        {projectUnreadable ? (
          <div className="pg-inline-warn">{t("approval.projectUnreadable")}</div>
        ) : null}
        {projectMismatch ? (
          <div className="pg-inline-warn">{t("approval.projectReloadRequired")}</div>
        ) : null}
        {projectKnown && Array.isArray(data.projectTools) && data.projectTools.length ? (
          <div className="pg-chips">
            {data.projectTools.map((tool) => (
              <span className="pg-chip" data-tone="ok" key={tool}>
                {tool}
              </span>
            ))}
          </div>
        ) : projectKnown ? (
          <div className="pg-meta">{t("approval.projectEmpty")}</div>
        ) : (
          <div className="pg-meta">{t("approval.projectLoadFirst")}</div>
        )}
        <textarea
          className="pg-textarea"
          rows={4}
          value={projectTools}
          placeholder={t("approval.projectToolsPlaceholder")}
          onChange={(event) => setProjectTools(event.target.value)}
        />
        <div className="pg-meta">
          {loadedProjectId
            ? `${t("approval.projectTarget", { projectId: loadedProjectId })} · ${t("approval.projectCount", {
                count: pendingCount,
              })}`
            : t("approval.projectLoadFirst")}
        </div>
        <div className="pg-row pg-row-end">
          <Btn
            size="sm"
            variant="ghost"
            disabled={busy !== "" || projectMismatch || projectUnreadable || !loadedProjectId}
            onClick={() => void applyProject(false)}
          >
            {t("approval.revoke")}
          </Btn>
          <Btn
            size="sm"
            variant="primary"
            disabled={busy !== "" || projectMismatch || projectUnreadable || !loadedProjectId}
            onClick={() => void applyProject(true)}
          >
            {t("approval.grant")}
          </Btn>
        </div>
      </div>

      <div className="pg-card">
        <SectionTitle extra={<Badge tone="off">{sensitive.length}</Badge>}>{t("approval.sensitiveTitle")}</SectionTitle>
        <div className="pg-note">{t("approval.sensitiveHint")}</div>
        {sensitive.length === 0 ? (
          <div className="pg-meta">{t("approval.sensitiveEmpty")}</div>
        ) : (
          <div className="pg-table pg-table-3">
            <div className="pg-table-head">
              <span>{t("approval.ruleId")}</span>
              <span>{t("approval.pattern")}</span>
              <span>{t("common.state")}</span>
            </div>
            {sensitive.map((rule) => (
              <div className="pg-table-row" key={rule.commandId || rule.id || rule.pattern}>
                <span>{rule.commandId || rule.id || "-"}</span>
                <span className="pg-mono">{rule.pattern || "-"}</span>
                <span>{rule.enabled === false ? t("common.off") : t("common.on")}</span>
              </div>
            ))}
          </div>
        )}
        <div className="pg-note">{t("approval.sensitiveBoundary")}</div>
      </div>
    </div>
  );
}
