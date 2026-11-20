// 运行配置弹窗：左侧是项目里的 Dockerfile 列表，右侧按 IDEA 的 Docker 运行配置分组：
// 配置名称、服务器、构建（Dockerfile / 上下文文件夹 / 镜像标记）、运行（容器名称）。
// 列表型与路径型的值都放在二级弹窗里编辑，入口是每一行右侧的文件夹图标。
import { h, getReact } from "./react.js";
import { Btn } from "./ui.jsx";
import { DkSelect } from "./select.jsx";
import {
  BUILD_OPTION_IDS,
  NPM_COMMANDS,
  PRE_BUILD_DEFAULTS,
  PRE_BUILD_TOOLS,
  RUN_OPTION_IDS,
  draftFromConfig,
  draftToConfig,
  emptyDraft,
  emptyPreBuild,
  isAbsolutePath,
  toPosix,
} from "./runconfig.js";

const CONFIRM_MS = 4000;

const CloseIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const FolderIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M3 7.5A1.5 1.5 0 014.5 6h4l2 2h7a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0117.5 18h-13A1.5 1.5 0 013 16.5v-9z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

/** 重新读取 package.json 的 scripts。 */
const RefreshIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M20 12a8 8 0 10-2.6 5.9M20 5v5h-5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SCRIPT_CUSTOM_ID = "__custom__";

/** 二级弹窗里可编辑的列表字段：列定义与空行。 */
const LIST_FIELDS = {
  buildArgs: {
    columns: [
      { key: "key", placeholderKey: "project.keyName" },
      { key: "value", placeholderKey: "project.keyValue" },
    ],
    empty: () => ({ key: "", value: "" }),
  },
  ports: {
    columns: [
      { key: "host", placeholderKey: "project.portHost", width: "88px" },
      { key: "container", placeholderKey: "project.portContainer", width: "88px" },
    ],
    empty: () => ({ host: "", container: "", protocol: "tcp" }),
  },
  mounts: {
    columns: [
      { key: "host", placeholderKey: "project.mountHost" },
      { key: "container", placeholderKey: "project.mountTarget" },
      { key: "readOnly", type: "check", labelKey: "project.mountReadOnlyShort" },
    ],
    empty: () => ({ host: "", container: "", readOnly: false }),
  },
  env: {
    columns: [
      { key: "key", placeholderKey: "project.keyName" },
      { key: "value", placeholderKey: "project.keyValue" },
    ],
    empty: () => ({ key: "", value: "" }),
  },
};

/** 「修改」下拉：勾选后对应的行才显示，和 IDEA 的 Modify options 一致。 */
function OptionMenu({ t, ids, selected, onToggle }) {
  const React = getReact();
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState(null);
  const rootRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const ITEM_HEIGHT = 26;
  const MENU_MAX = 260;

  // 菜单用 fixed 定位：它所在的滚动容器会裁掉 absolute 子元素，
  // 那样向下展开时只能看到头两项。这里按按钮的实际坐标算位置，
  // 下方放不下就往上方展开。
  const place = React.useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const need = Math.min(MENU_MAX, ids.length * ITEM_HEIGHT + 14);
    const below = window.innerHeight - rect.bottom - 10;
    const above = rect.top - 10;
    const up = below < need && above > below;
    setCoords({
      position: "fixed",
      right: Math.max(8, window.innerWidth - rect.right),
      maxHeight: `${Math.max(120, Math.min(need, up ? above : below))}px`,
      ...(up ? { bottom: Math.max(8, window.innerHeight - rect.top + 4) } : { top: rect.bottom + 4 }),
    });
  }, [ids.length]);

  React.useEffect(() => {
    if (!open) return undefined;
    place();
    // 点击别处关闭；不用全屏遮罩，否则会挡住弹窗内容的滚动。
    const onDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    // 菜单按固定坐标画，容器滚动后位置会漂，直接关掉。
    const onScroll = (event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <div className="dk-option-anchor" ref={rootRef}>
      <Btn size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>
        {t("project.modify")}
      </Btn>
      {open && coords ? (
        <div className="dk-option-menu" ref={menuRef} style={coords} role="menu">
          {ids.map((id) => (
            <label className="dk-option-item" key={id}>
              <input type="checkbox" checked={selected.includes(id)} onChange={() => onToggle(id)} />
              <span>{t(`project.option.${id}`)}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const summarize = (rows, mapper) => {
  const parts = (rows || []).map(mapper).filter(Boolean);
  return parts.join(", ");
};

/**
 * files: [{ path, relative, name, depth, manual, missing }]
 * runConfigs: { [path]: config }
 * servers: [{ id, name, host, username }]
 * onSave(path, config, previousPath) / onRemove(path) / onAdd(path) 失败时抛错，由本组件展示
 */
export function ConfigDialog({
  t,
  files,
  runConfigs,
  servers,
  projectName,
  projectRoot,
  initialPath,
  onSave,
  onRemove,
  onAdd,
  onLoadScripts,
  onClose,
}) {
  const React = getReact();
  const [selected, setSelected] = React.useState("");
  const [drafts, setDrafts] = React.useState({});
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [add, setAdd] = React.useState({ open: false, path: "", error: "" });
  const [editor, setEditor] = React.useState(null);
  const [scripts, setScripts] = React.useState({ loading: false, list: [], missing: false, error: "", path: "" });
  const [scriptCustom, setScriptCustom] = React.useState(false);
  const maskRef = React.useRef(null);

  /**
   * 兜底：宿主某些主题会给面板祖先加上 transform / backdrop-filter / contain，
   * 这些值会为 fixed 后代创建包含块，弹窗就被困在面板里。这里在挂载后逐个清掉，
   * 并把面板提到最上层；卸载时原样还原。样式表里已有 :has 规则做同样的事。
   */
  React.useEffect(() => {
    const node = maskRef.current;
    if (!node) return undefined;
    const patched = [];
    let el = node.parentElement;
    while (el && el !== document.body) {
      const computed = window.getComputedStyle(el);
      const saved = {
        el,
        transform: el.style.transform,
        filter: el.style.filter,
        backdropFilter: el.style.backdropFilter,
        perspective: el.style.perspective,
        contain: el.style.contain,
        zIndex: el.style.zIndex,
      };
      let touched = false;
      if (computed.transform && computed.transform !== "none") {
        el.style.transform = "none";
        touched = true;
      }
      if (computed.filter && computed.filter !== "none") {
        el.style.filter = "none";
        touched = true;
      }
      if (computed.backdropFilter && computed.backdropFilter !== "none") {
        el.style.backdropFilter = "none";
        touched = true;
      }
      if (computed.perspective && computed.perspective !== "none") {
        el.style.perspective = "none";
        touched = true;
      }
      if (computed.contain && computed.contain !== "none" && /paint|layout|strict|content/.test(computed.contain)) {
        el.style.contain = "none";
        touched = true;
      }
      if (touched) {
        el.style.zIndex = "70";
        patched.push(saved);
      }
      el = el.parentElement;
    }
    return () => {
      for (const item of patched) {
        item.el.style.transform = item.transform;
        item.el.style.filter = item.filter;
        item.el.style.backdropFilter = item.backdropFilter;
        item.el.style.perspective = item.perspective;
        item.el.style.contain = item.contain;
        item.el.style.zIndex = item.zIndex;
      }
    };
  }, []);

  // 列表变化（重扫 / 新增 / 删除）时为每个文件补齐草稿，并清掉已消失的项。
  React.useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const file of files) {
        if (!next[file.path]) next[file.path] = draftFromConfig(file, runConfigs[file.path], projectName);
      }
      for (const key of Object.keys(next)) {
        if (!files.some((file) => file.path === key)) delete next[key];
      }
      return next;
    });
  }, [files, runConfigs, projectName]);

  // 选中项：优先用调用方指定的文件，它被删掉后回退到第一个。
  React.useEffect(() => {
    if (!files.length) {
      setSelected("");
      return;
    }
    setSelected((prev) => {
      if (prev && files.some((file) => file.path === prev)) return prev;
      if (initialPath && files.some((file) => file.path === initialPath)) return initialPath;
      return files[0].path;
    });
  }, [files, initialPath]);

  React.useEffect(() => {
    if (!confirmRemove) return undefined;
    const timer = setTimeout(() => setConfirmRemove(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmRemove]);

  const current = files.find((file) => file.path === selected) || null;
  const draft = (selected && drafts[selected]) || emptyDraft();
  const serverOptions = [
    ...(draft.serverId ? [] : [{ value: "", label: t("target.choose") }]),
    ...servers.map((item) => ({
      value: item.id,
      label: item.name || `${item.username || "root"}@${item.host || ""}`,
    })),
  ];
  const has = (id) => draft.options.includes(id);

  /** 构建前步骤的只读摘要：npm run build / Maven -B clean package。 */
  const preBuildSummary = (pre) => {
    if (!pre || !pre.tool) return "";
    if (pre.tool === "maven") return ["Maven", pre.goals].filter(Boolean).join(" ");
    const manager = pre.packageManager || "npm";
    const isRun = pre.command === "run" || pre.command === "run-script";
    const tail = isRun ? ["run", pre.script].filter(Boolean).join(" ") : pre.command;
    return [manager, tail].filter(Boolean).join(" ");
  };

  const preBuildToolOptions = [
    { value: "", label: t("project.toolNone") },
    { value: "npm", label: "npm" },
    { value: "maven", label: "Maven" },
  ];

  const packageManagerOptions = [
    { value: "npm", label: "npm" },
    { value: "yarn", label: "yarn" },
    { value: "pnpm", label: "pnpm" },
  ];

  const npmCommandOptions = NPM_COMMANDS.map((id) => ({ value: id, label: id }));

  /** 脚本下拉：package.json 里的 scripts + 当前值（旧值可能不在列表）+ 「自定义」。 */
  const scriptOptions = (() => {
    const list = [...scripts.list];
    const current = String(editor?.value?.script || "");
    if (current && !list.includes(current)) list.unshift(current);
    return [
      ...list.map((name) => ({ value: name, label: name })),
      { value: SCRIPT_CUSTOM_ID, label: t("project.scriptCustom") },
    ];
  })();

  const patch = (next) => {
    setDrafts((prev) => ({ ...prev, [selected]: { ...(prev[selected] || emptyDraft()), ...next } }));
  };

  const toggleOption = (id) => {
    if (has(id)) {
      // 取消勾选即清空该项的数据，避免下次打开时又按数据补勾回来。
      const cleared = {
        platform: { platform: "" },
        buildArgs: { buildArgs: [] },
        noCache: { noCache: false },
        pull: { pull: false },
        ports: { ports: [] },
        mounts: { mounts: [] },
        env: { env: [] },
        runOptions: { runOptions: "" },
      }[id] || {};
      patch({ ...cleared, options: draft.options.filter((item) => item !== id) });
      return;
    }
    patch({ options: [...draft.options, id] });
  };

  const selectFile = (path) => {
    setSelected(path);
    setError("");
    setConfirmRemove(false);
    setEditor(null);
  };

  const openTextEditor = (field, title, placeholder) => {
    setEditor({ kind: "text", field, title, value: String(draft[field] || ""), placeholder: placeholder || "" });
  };

  const openListEditor = (field, title) => {
    setEditor({ kind: "list", field, title, rows: (draft[field] || []).map((row) => ({ ...row })) });
  };

  /** 构建前步骤：一个弹窗里按 IDEA 的 npm / Maven 口径配完整参数。 */
  const openPreBuildEditor = () => {
    const value = { ...emptyPreBuild(), ...(draft.preBuild || {}) };
    value.env = (draft.preBuild?.env || []).map((item) => ({ ...item }));
    setScripts({ loading: false, list: [], missing: false, error: "", path: "" });
    setScriptCustom(false);
    setEditor({ kind: "form", field: "preBuild", title: t("project.preBuild"), value });
    if (value.tool === "npm") void loadScripts(value);
  };

  const patchEditorValue = (next) => {
    setEditor((prev) => (prev ? { ...prev, value: { ...prev.value, ...next } } : prev));
  };

  /**
   * package.json 的默认查找目录：工作目录 → 构建上下文 → 项目根 → Dockerfile 所在目录。
   * 项目根优先于 Dockerfile 目录，和 IDEA 的默认行为一致（前端项目常把 package.json 放在根）。
   */
  const scriptBaseDir = () => {
    const context = String(draft.context || "").trim();
    if (context) return context;
    const root = String(projectRoot || "").trim();
    if (root) return root;
    const file = toPosix(String(draft.dockerfile || ""));
    const index = file.lastIndexOf("/");
    return index > 0 ? file.slice(0, index) : "";
  };

  const loadScripts = async (value) => {
    if (!onLoadScripts) return;
    const target = String(value?.packageJson || "").trim();
    const dir = String(value?.cwd || "").trim() || scriptBaseDir();
    setScripts({ loading: true, list: [], missing: false, error: "", path: target });
    try {
      const data = await onLoadScripts(target, dir);
      setScripts({
        loading: false,
        list: Array.isArray(data?.scripts) ? data.scripts : [],
        missing: data?.exists === false,
        error: "",
        path: data?.path || target,
      });
    } catch (cause) {
      // 后台还是旧版本时这个接口不存在，提示用户重启而不是显示 HTTP 404。
      const text = cause?.code === "HTTP_404" ? t("project.scriptsNeedRestart") : String(cause?.message || cause);
      setScripts({ loading: false, list: [], missing: false, error: text, path: target });
    }
  };

  /** 换工具时补上常用默认值，用户可以直接改。 */
  const changePreBuildTool = (tool) => {
    if (!editor) return;
    const value = { ...editor.value, tool };
    if (tool === "npm") {
      value.packageManager = value.packageManager || PRE_BUILD_DEFAULTS.npm.packageManager;
      value.command = value.command || PRE_BUILD_DEFAULTS.npm.command;
      value.script = value.script || PRE_BUILD_DEFAULTS.npm.script;
    } else if (tool === "maven") {
      value.goals = value.goals || PRE_BUILD_DEFAULTS.maven.goals;
    }
    setEditor({ ...editor, value });
    if (tool === "npm") void loadScripts(value);
  };

  const patchPreBuildEnv = (index, next) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const env = (prev.value.env || []).map((row, at) => (at === index ? { ...row, ...next } : row));
      return { ...prev, value: { ...prev.value, env } };
    });
  };

  const addPreBuildEnv = () => {
    setEditor((prev) =>
      prev ? { ...prev, value: { ...prev.value, env: [...(prev.value.env || []), { key: "", value: "" }] } } : prev
    );
  };

  const removePreBuildEnv = (index) => {
    setEditor((prev) =>
      prev
        ? { ...prev, value: { ...prev.value, env: (prev.value.env || []).filter((_, at) => at !== index) } }
        : prev
    );
  };

  const applyEditor = () => {
    if (!editor) return;
    if (editor.kind === "text") patch({ [editor.field]: editor.value });
    else if (editor.kind === "list") patch({ [editor.field]: editor.rows });
    else patch({ [editor.field]: editor.value });
    setEditor(null);
  };

  const commit = async (mode) => {
    if (!selected) return;
    const converted = draftToConfig(draft);
    if (converted.error) {
      setError(t(converted.error));
      return;
    }
    setBusy(mode);
    setError("");
    try {
      const previousPath = selected;
      const nextPath = toPosix(draft.dockerfile.trim());
      await onSave(nextPath, converted.config, previousPath);
      // 路径改过：草稿键与选中项一起搬到新路径，否则左侧仍高亮旧项、再点「应用」会重复迁移。
      // onSave 内部已完成重扫，新路径此刻已经在 files 里。
      if (nextPath !== previousPath) {
        setDrafts((prev) => {
          const next = { ...prev };
          const moved = next[previousPath] || draft;
          delete next[previousPath];
          next[nextPath] = { ...moved, dockerfile: nextPath };
          return next;
        });
        setSelected(nextPath);
        setEditor(null);
      }
      if (mode === "save") onClose();
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setConfirmRemove(false);
    setBusy("remove");
    setError("");
    try {
      await onRemove(selected);
      // 删除成功后把当前草稿还原成「未配置」：否则再点应用 / 保存会把旧值重新写回成配置。
      const target = files.find((file) => file.path === selected);
      setDrafts((prev) => {
        const next = { ...prev };
        if (target) next[selected] = draftFromConfig(target, null, projectName);
        else delete next[selected];
        return next;
      });
      setEditor(null);
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };

  const submitAdd = async () => {
    const path = toPosix(add.path.trim());
    if (!isAbsolutePath(path)) {
      setAdd((prev) => ({ ...prev, error: t("project.addInvalid") }));
      return;
    }
    setBusy("add");
    setAdd((prev) => ({ ...prev, error: "" }));
    try {
      await onAdd(path);
      setAdd({ open: false, path: "", error: "" });
      setSelected(path);
    } catch (cause) {
      setAdd((prev) => ({ ...prev, error: String(cause?.message || cause) }));
    } finally {
      setBusy("");
    }
  };

  /** 一行「标签 + 值 + 文件夹图标」，值在二级弹窗里改。 */
  const valueRow = (label, summary, onEdit) => (
    <div className="dk-field">
      <span className="dk-meta">{label}</span>
      <span className="dk-value">
        <span className="dk-value-text" title={summary}>
          {summary || t("project.notSet")}
        </span>
        <button type="button" className="dk-icon-btn" title={t("project.editValue")} onClick={onEdit}>
          <FolderIcon />
        </button>
      </span>
    </div>
  );

  const listConfig = editor && editor.kind === "list" ? LIST_FIELDS[editor.field] : null;

  return (
    <div
      className="dk-modal-mask"
      ref={maskRef}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dk-modal" role="dialog" aria-modal="true" aria-label={t("project.runConfigs")}>
        <div className="dk-modal-head">
          <span className="dk-modal-title">{t("project.runConfigs")}</span>
          <button type="button" className="dk-icon-btn" title={t("project.configCancel")} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="dk-modal-body">
          <div className="dk-modal-side">
            <div className="dk-config-list">
              {files.map((file) => {
                const saved = runConfigs[file.path] || null;
                // 正在编辑的项优先显示草稿里的名字，改名时左侧列表立刻跟着变。
                const label = drafts[file.path]?.name || saved?.name || file.relative;
                return (
                  <button
                    key={file.path}
                    type="button"
                    className="dk-config-item"
                    data-active={file.path === selected ? "1" : "0"}
                    title={file.path}
                    onClick={() => selectFile(file.path)}
                  >
                    <span className="dk-config-item-name">{label}</span>
                    <span className="dk-config-item-path">
                      {file.missing ? `${t("project.missing")} · ` : ""}
                      {file.relative}
                    </span>
                  </button>
                );
              })}
              {files.length === 0 ? <div className="dk-meta">{t("project.empty")}</div> : null}
            </div>

            <div className="dk-config-add">
              {add.open ? (
                <div className="dk-form">
                  <input
                    className="dk-input"
                    value={add.path}
                    placeholder={t("project.addDockerfileHint")}
                    onChange={(event) => setAdd((prev) => ({ ...prev, path: event.target.value, error: "" }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submitAdd();
                    }}
                  />
                  <div className="dk-actionbar">
                    <Btn size="sm" variant="primary" disabled={busy === "add" || !add.path.trim()} onClick={() => void submitAdd()}>
                      {t("project.add")}
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setAdd({ open: false, path: "", error: "" })}>
                      {t("project.configCancel")}
                    </Btn>
                  </div>
                  {add.error ? <div className="dk-inline-error">{add.error}</div> : null}
                </div>
              ) : (
                <Btn size="sm" variant="ghost" onClick={() => setAdd({ open: true, path: "", error: "" })}>
                  {`+ ${t("project.addDockerfile")}`}
                </Btn>
              )}
            </div>
          </div>

          <div className="dk-modal-main">
            {current ? (
              <div className="dk-form">
                <label className="dk-field">
                  <span className="dk-meta">{t("project.configName")}</span>
                  <input
                    className="dk-input"
                    value={draft.name}
                    placeholder={current.relative}
                    onChange={(event) => patch({ name: event.target.value })}
                  />
                </label>

                <div className="dk-field dk-field-block">
                  <span className="dk-meta">{t("project.configServer")}</span>
                  <span className="dk-value dk-value-stack">
                    <DkSelect
                      value={draft.serverId}
                      options={serverOptions}
                      onChange={(value) => patch({ serverId: value })}
                      ariaLabel={t("project.configServer")}
                      size="sm"
                    />
                    <span className="dk-note">{t("project.serverHint")}</span>
                  </span>
                </div>

                <div className="dk-section">
                  <div className="dk-section-head">
                    <span>{t("project.sectionBuild")}</span>
                    <span className="dk-head-spacer" />
                    <OptionMenu t={t} ids={BUILD_OPTION_IDS} selected={draft.options} onToggle={toggleOption} />
                  </div>

                  {valueRow(t("project.configDockerfile"), draft.dockerfile, () =>
                    openTextEditor("dockerfile", t("project.configDockerfile"), current.path)
                  )}

                  {valueRow(t("project.configContextFolder"), draft.context, () =>
                    openTextEditor("context", t("project.configContextFolder"), t("project.configContextHint"))
                  )}

                  <label className="dk-field">
                    <span className="dk-meta">{t("project.configTag")}</span>
                    <input
                      className="dk-input"
                      value={draft.tag}
                      placeholder="app:latest"
                      onChange={(event) => patch({ tag: event.target.value })}
                    />
                  </label>

                  {has("platform")
                    ? valueRow(t("project.option.platform"), draft.platform, () =>
                        openTextEditor("platform", t("project.option.platform"), "linux/amd64")
                      )
                    : null}

                  {has("buildArgs")
                    ? valueRow(
                        t("project.option.buildArgs"),
                        summarize(draft.buildArgs, (arg) => (arg.key ? `${arg.key}=${arg.value}` : "")),
                        () => openListEditor("buildArgs", t("project.option.buildArgs"))
                      )
                    : null}

                  {has("noCache") || has("pull") ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.sectionSwitch")}</span>
                      <span className="dk-checks">
                        {has("noCache") ? (
                          <label>
                            <input
                              type="checkbox"
                              checked={draft.noCache}
                              onChange={(event) => patch({ noCache: event.target.checked })}
                            />
                            <span>{t("project.configNoCache")}</span>
                          </label>
                        ) : null}
                        {has("pull") ? (
                          <label>
                            <input type="checkbox" checked={draft.pull} onChange={(event) => patch({ pull: event.target.checked })} />
                            <span>{t("project.configPull")}</span>
                          </label>
                        ) : null}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="dk-section">
                  <div className="dk-section-head">
                    <span>{t("project.sectionRun")}</span>
                    <span className="dk-head-spacer" />
                    <OptionMenu t={t} ids={RUN_OPTION_IDS} selected={draft.options} onToggle={toggleOption} />
                  </div>

                  <label className="dk-field">
                    <span className="dk-meta">{t("project.configContainerName")}</span>
                    <input
                      className="dk-input"
                      value={draft.containerName}
                      placeholder={t("project.configContainerNameHint")}
                      onChange={(event) => patch({ containerName: event.target.value })}
                    />
                  </label>

                  {has("ports")
                    ? valueRow(
                        t("project.option.ports"),
                        summarize(draft.ports, (port) =>
                          port.host || port.container ? `${port.host || "?"}:${port.container || "?"}` : ""
                        ),
                        () => openListEditor("ports", t("project.option.ports"))
                      )
                    : null}

                  {has("mounts")
                    ? valueRow(
                        t("project.option.mounts"),
                        summarize(draft.mounts, (mount) =>
                          mount.host || mount.container
                            ? `${mount.host || "?"} -> ${mount.container || "?"}${mount.readOnly ? " (ro)" : ""}`
                            : ""
                        ),
                        () => openListEditor("mounts", t("project.option.mounts"))
                      )
                    : null}

                  {has("env")
                    ? valueRow(
                        t("project.option.env"),
                        summarize(draft.env, (item) => (item.key ? `${item.key}=${item.value}` : "")),
                        () => openListEditor("env", t("project.option.env"))
                      )
                    : null}

                  {has("runOptions")
                    ? valueRow(t("project.option.runOptions"), draft.runOptions, () =>
                        openTextEditor("runOptions", t("project.option.runOptions"), t("project.runOptionsHint"))
                      )
                    : null}
                </div>

                <div className="dk-section">
                  <div className="dk-section-head">
                    <span>{t("project.preBuild")}</span>
                    <span className="dk-head-spacer" />
                  </div>

                  {valueRow(
                    t("project.preBuildTool"),
                    // 未选工具时明确写「不执行」，避免看成没配置。
                    preBuildSummary(draft.preBuild) || t("project.toolNone"),
                    openPreBuildEditor
                  )}
                </div>

                {error ? <div className="dk-inline-error">{error}</div> : null}
              </div>
            ) : (
              <div className="dk-meta">{t("project.emptyHint")}</div>
            )}
          </div>
        </div>

        <div className="dk-modal-foot">
          <Btn size="sm" variant="danger" disabled={!current || Boolean(busy)} onClick={() => void remove()}>
            {confirmRemove ? t("project.configDeleteConfirm") : t("project.configDelete")}
          </Btn>
          <span className="dk-head-spacer" />
          <Btn size="sm" variant="ghost" onClick={onClose}>
            {t("project.configCancel")}
          </Btn>
          <Btn size="sm" disabled={!current || Boolean(busy)} onClick={() => void commit("apply")}>
            {t("project.configApply")}
          </Btn>
          <Btn size="sm" disabled={!current || Boolean(busy)} onClick={() => void commit("save")}>
            {t("project.configSave")}
          </Btn>
        </div>
      </div>

      {editor ? (
        <div
          className="dk-submask"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditor(null);
          }}
        >
          <div
            className="dk-subdialog"
            role="dialog"
            aria-modal="true"
            aria-label={editor.title}
            data-wide={editor.kind === "form" ? "1" : "0"}
          >
            <div className="dk-subdialog-head">
              <span className="dk-modal-title">{editor.title}</span>
              <button type="button" className="dk-icon-btn" title={t("project.configCancel")} onClick={() => setEditor(null)}>
                <CloseIcon />
              </button>
            </div>

            <div className="dk-subdialog-body">
              {editor.kind === "text" ? (
                <input
                  className="dk-input"
                  value={editor.value}
                  placeholder={editor.placeholder}
                  autoFocus
                  onChange={(event) => setEditor((prev) => ({ ...prev, value: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyEditor();
                  }}
                />
              ) : null}

              {editor.kind === "list" ? (
                <div className="dk-rows">
                  {editor.rows.map((row, index) => (
                    <div className="dk-row-inputs" key={`row-${index}`}>
                      {listConfig.columns.map((column) =>
                        column.type === "check" ? (
                          <label className="dk-inline-check" key={column.key} title={t(column.labelKey)}>
                            <input
                              type="checkbox"
                              checked={row[column.key] === true}
                              onChange={(event) =>
                                setEditor((prev) => ({
                                  ...prev,
                                  rows: prev.rows.map((item, at) =>
                                    at === index ? { ...item, [column.key]: event.target.checked } : item
                                  ),
                                }))
                              }
                            />
                            <span>{t(column.labelKey)}</span>
                          </label>
                        ) : (
                          <input
                            key={column.key}
                            className="dk-input"
                            style={column.width ? { flex: "none", width: column.width } : undefined}
                            value={row[column.key] || ""}
                            placeholder={t(column.placeholderKey)}
                            onChange={(event) =>
                              setEditor((prev) => ({
                                ...prev,
                                rows: prev.rows.map((item, at) =>
                                  at === index ? { ...item, [column.key]: event.target.value } : item
                                ),
                              }))
                            }
                          />
                        )
                      )}
                      <button
                        type="button"
                        className="dk-icon-btn"
                        title={t("project.removeRow")}
                        onClick={() =>
                          setEditor((prev) => ({ ...prev, rows: prev.rows.filter((_, at) => at !== index) }))
                        }
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  ))}
                  <div>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditor((prev) => ({ ...prev, rows: [...prev.rows, listConfig.empty()] }))}
                    >
                      {`+ ${t("project.addRow")}`}
                    </Btn>
                  </div>
                </div>
              ) : null}

              {editor.kind === "form" ? (
                <div className="dk-form">
                  <div className="dk-field">
                    <span className="dk-meta">{t("project.preBuildTool")}</span>
                    <span className="dk-value">
                      <DkSelect
                        value={editor.value.tool}
                        options={preBuildToolOptions}
                        size="sm"
                        ariaLabel={t("project.preBuildTool")}
                        onChange={changePreBuildTool}
                      />
                    </span>
                  </div>

                  {editor.value.tool === "npm" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.packageJson")}</span>
                      <span className="dk-value">
                        <input
                          className="dk-input"
                          value={editor.value.packageJson}
                          placeholder={t("project.packageJsonHint")}
                          onChange={(event) => patchEditorValue({ packageJson: event.target.value })}
                          onBlur={() => void loadScripts(editor.value)}
                        />
                        <button
                          type="button"
                          className="dk-icon-btn"
                          title={t("project.scriptsLoad")}
                          onClick={() => void loadScripts(editor.value)}
                        >
                          <RefreshIcon />
                        </button>
                      </span>
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.npmCommand")}</span>
                      <span className="dk-value">
                        <DkSelect
                          value={editor.value.command}
                          options={npmCommandOptions}
                          size="sm"
                          ariaLabel={t("project.npmCommand")}
                          onChange={(value) => patchEditorValue({ command: value })}
                        />
                      </span>
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" &&
                  (editor.value.command === "run" || editor.value.command === "run-script") ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.npmScript")}</span>
                      <span className="dk-value">
                        {scripts.list.length > 0 && !scriptCustom ? (
                          <DkSelect
                            value={editor.value.script}
                            options={scriptOptions}
                            size="sm"
                            ariaLabel={t("project.npmScript")}
                            onChange={(value) => {
                              // 选「自定义」时切成输入框，脚本名保留。
                              if (value === SCRIPT_CUSTOM_ID) setScriptCustom(true);
                              else patchEditorValue({ script: value });
                            }}
                          />
                        ) : (
                          <input
                            className="dk-input"
                            value={editor.value.script}
                            placeholder={t("project.npmScriptHint")}
                            onChange={(event) => patchEditorValue({ script: event.target.value })}
                          />
                        )}
                        <button
                          type="button"
                          className="dk-icon-btn"
                          title={t("project.scriptsLoad")}
                          onClick={() => {
                            setScriptCustom(false);
                            void loadScripts(editor.value);
                          }}
                        >
                          <RefreshIcon />
                        </button>
                      </span>
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" &&
                  (editor.value.command === "run" || editor.value.command === "run-script") &&
                  scripts.list.length > 0 ? (
                    <div className="dk-field">
                      <span className="dk-meta" />
                      <span className="dk-note">{t("project.scriptsFound", { count: scripts.list.length })}</span>
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" &&
                  (editor.value.command === "run" || editor.value.command === "run-script") &&
                  scripts.list.length === 0 ? (
                    <div className="dk-field">
                      <span className="dk-meta" />
                      <span className="dk-note">
                        {scripts.loading
                          ? t("project.scriptsLoading")
                          : scripts.error || (scripts.missing ? t("project.scriptsMissing") : t("project.scriptsEmpty"))}
                      </span>
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.npmArguments")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.arguments}
                        placeholder={t("project.argumentsHint")}
                        onChange={(event) => patchEditorValue({ arguments: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.nodePath")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.nodePath}
                        placeholder={t("project.nodePathHint")}
                        onChange={(event) => patchEditorValue({ nodePath: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.packageManager")}</span>
                      <span className="dk-value">
                        <DkSelect
                          value={editor.value.packageManager}
                          options={packageManagerOptions}
                          size="sm"
                          ariaLabel={t("project.packageManager")}
                          onChange={(value) => patchEditorValue({ packageManager: value })}
                        />
                      </span>
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.nodeOptions")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.nodeOptions}
                        placeholder={t("project.nodeOptionsHint")}
                        onChange={(event) => patchEditorValue({ nodeOptions: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool === "maven" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.mavenPath")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.mavenPath || ""}
                        placeholder={t("project.mavenPathHint")}
                        onChange={(event) => patchEditorValue({ mavenPath: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool === "maven" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.mavenGoals")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.goals}
                        placeholder={t("project.mavenGoalsHint")}
                        onChange={(event) => patchEditorValue({ goals: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool === "maven" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.mavenProfiles")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.profiles}
                        placeholder={t("project.mavenProfilesHint")}
                        onChange={(event) => patchEditorValue({ profiles: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool === "maven" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.mavenJvm")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.jvmOptions}
                        placeholder={t("project.mavenJvmHint")}
                        onChange={(event) => patchEditorValue({ jvmOptions: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool ? (
                    <div className="dk-field dk-field-block">
                      <span className="dk-meta">{t("project.preBuildEnv")}</span>
                      <div className="dk-rows">
                        {(editor.value.env || []).map((row, index) => (
                          <div className="dk-row-inputs" key={`env-${index}`}>
                            <input
                              className="dk-input"
                              value={row.key}
                              placeholder={t("project.keyName")}
                              onChange={(event) => patchPreBuildEnv(index, { key: event.target.value })}
                            />
                            <input
                              className="dk-input"
                              value={row.value}
                              placeholder={t("project.keyValue")}
                              onChange={(event) => patchPreBuildEnv(index, { value: event.target.value })}
                            />
                            <button
                              type="button"
                              className="dk-icon-btn"
                              title={t("project.removeRow")}
                              onClick={() => removePreBuildEnv(index)}
                            >
                              <CloseIcon />
                            </button>
                          </div>
                        ))}
                        <div>
                          <Btn size="sm" variant="ghost" onClick={addPreBuildEnv}>
                            {`+ ${t("project.addRow")}`}
                          </Btn>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {editor.value.tool ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.preBuildCwd")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.cwd}
                        placeholder={t("project.preBuildCwdHint")}
                        onChange={(event) => patchEditorValue({ cwd: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {!editor.value.tool ? <div className="dk-note">{t("project.preBuildHint")}</div> : null}
                </div>
              ) : null}
            </div>

            <div className="dk-subdialog-foot">
              <span className="dk-head-spacer" />
              <Btn size="sm" variant="ghost" onClick={() => setEditor(null)}>
                {t("project.configCancel")}
              </Btn>
              <Btn size="sm" variant="primary" onClick={applyEditor}>
                {t("project.configApply")}
              </Btn>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
