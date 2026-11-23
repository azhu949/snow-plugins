// 提示词页：托管系统提示词条目、全局角色规则与内置/自定义预设。
import { getReact, h } from "./react.js";
import { applyModeOf, Badge, Btn, EmptyState, ErrorBox, Loading, SectionTitle, Toggle, summarizeApplyOutcome } from "./ui.jsx";

const pickLocalized = (value, locale) => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return value[locale] || value.default || value["zh-CN"] || "";
};

/** 危险动作的二次确认窗口：与编队弹窗的确认时长保持一致。 */
const PRESET_CONFIRM_MS = 3500;

/** 与后台配置归一化同口径：先统一换行再去首尾空白，避免尾部空白被误判成未保存改动。 */
const normText = (value) => String(value || "").replace(/\r\n/g, "\n").trim();

export function PromptsView({ t, rpc, notify, config, reload, locale = "zh-CN" }) {
  const React = getReact();
  const [state, setState] = React.useState({ status: "loading", error: "", data: null });
  const [presets, setPresets] = React.useState({ builtin: [], custom: [] });
  const [draft, setDraft] = React.useState({ content: "", isActive: true, name: "" });
  const [roleDraft, setRoleDraft] = React.useState("");
  const [roleEnabled, setRoleEnabled] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [presetName, setPresetName] = React.useState("");
  // 删除与「载入覆盖草稿」都要点两次：同一个键在 3.5 秒内点第二次才真正执行。
  const [presetConfirm, setPresetConfirm] = React.useState("");
  // 最近一次删除的预设：保留副本，误点时可以在本页直接撤销。
  const [recycle, setRecycle] = React.useState(null);
  // 载入前的基线：用于判断编辑框里是否有未保存的改动。
  const baselineRef = React.useRef({ content: "", name: "", role: "" });

  const load = React.useCallback(async () => {
    try {
      const [data, presetData] = await Promise.all([rpc.prompts(), rpc.presets()]);
      setState({ status: "ready", error: "", data });
      setPresets({ builtin: presetData?.builtin || [], custom: presetData?.custom || [] });
      setDraft({
        content: data?.config?.prompt?.content || "",
        isActive: data?.config?.prompt?.isActive !== false,
        name: data?.config?.prompt?.name || "",
      });
      setRoleDraft(data?.config?.role?.content || "");
      setRoleEnabled(data?.config?.role?.enabled === true);
      baselineRef.current = {
        content: data?.config?.prompt?.content || "",
        name: data?.config?.prompt?.name || "",
        role: data?.config?.role?.content || "",
      };
    } catch (error) {
      setState({ status: "error", error: String(error?.message || error), data: null });
    }
  }, [rpc]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!presetConfirm) return undefined;
    const timer = setTimeout(() => setPresetConfirm(""), PRESET_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [presetConfirm]);

  /** 编辑框里是否有未保存的改动：载入预设会整体覆盖它，必须先问一次。 */
  const isDirty = () =>
    normText(draft.content) !== normText(baselineRef.current.content) ||
    normText(draft.name) !== normText(baselineRef.current.name) ||
    normText(roleDraft) !== normText(baselineRef.current.role);

  const savePrompt = async () => {
    if (busy) return;
    setBusy("prompt");
    try {
      const result = await rpc.applyPrompt({
        content: draft.content,
        isActive: draft.isActive,
        name: draft.name || undefined,
      });
      const summary = summarizeApplyOutcome(result?.steps, applyModeOf(result?.mode), t, {
        appliedError: result?.appliedError,
      });
      notify(summary.tone, summary.text);
      await load();
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };

  const removePrompt = async () => {
    if (busy) return;
    setBusy("prompt");
    try {
      await rpc.removePrompt();
      notify("ok", t("prompts.removed"));
      await load();
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };

  // 删除会直接抹掉宿主提示词库里的托管条目，本地不留副本：第一次点击只进入确认态，再点一次才真正删除。
  const requestRemovePrompt = () => {
    const key = "prompt-remove";
    if (presetConfirm !== key) {
      setPresetConfirm(key);
      notify("warn", t("prompts.removeConfirm"));
      return;
    }
    setPresetConfirm("");
    void removePrompt();
  };

  const saveRole = async () => {
    if (busy) return;
    setBusy("role");
    try {
      const result = await rpc.applyRole(roleDraft);
      const summary = summarizeApplyOutcome(result?.steps, applyModeOf(result?.mode), t, {
        appliedError: result?.appliedError,
      });
      notify(summary.tone, summary.text);
      await load();
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };

  const doRestoreRole = async () => {
    if (busy) return;
    setBusy("role");
    try {
      const result = await rpc.restoreRole();
      notify("ok", result?.message || t("prompts.roleRestored"));
      await load();
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };

  // 移除托管段会同时清空编辑草稿：第一次点击先说明后果，再点一次才执行。
  const requestRestoreRole = () => {
    const key = "role-restore";
    if (presetConfirm !== key) {
      setPresetConfirm(key);
      notify("warn", t("prompts.roleRestoreConfirm"));
      return;
    }
    setPresetConfirm("");
    void doRestoreRole();
  };

  const applyPreset = (preset) => {
    setDraft({
      content: preset.directive || "",
      isActive: true,
      name: pickLocalized(preset.name, locale),
    });
    setRoleDraft(preset.role || "");
    setRoleEnabled(Boolean(preset.role));
    setPresetConfirm("");
    notify("info", t("prompts.presetLoaded", { name: pickLocalized(preset.name, locale) }));
  };

  // 载入会整体替换草稿：有未保存改动时先提示，再点一次才覆盖。
  const usePreset = (preset) => {
    const name = pickLocalized(preset.name, locale);
    if (!isDirty()) {
      applyPreset(preset);
      return;
    }
    const key = `load-${preset.id}`;
    if (presetConfirm !== key) {
      setPresetConfirm(key);
      notify("warn", t("prompts.presetOverwriteConfirm", { name }));
      return;
    }
    applyPreset(preset);
  };

  const savePreset = async () => {
    if (busy) return;
    const name = presetName.trim();
    if (!name) {
      notify("warn", t("prompts.presetNameRequired"));
      return;
    }
    setBusy("preset");
    try {
      await rpc.savePreset({
        id: `p${Date.now().toString(36)}`,
        name,
        directive: draft.content,
        role: roleDraft,
        boost: true,
      });
      setPresetName("");
      const presetData = await rpc.presets();
      setPresets({ builtin: presetData?.builtin || [], custom: presetData?.custom || [] });
      notify("ok", t("prompts.presetSaved"));
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };

  const removePreset = async (preset) => {
    if (busy) return;
    setBusy("preset");
    try {
      await rpc.removePreset(preset.id);
      const presetData = await rpc.presets();
      setPresets({ builtin: presetData?.builtin || [], custom: presetData?.custom || [] });
      // 保留回收副本：误点时可以在本页直接恢复，不必重新输入内容。
      setRecycle({ preset });
      notify("ok", t("prompts.presetDeleted", { name: preset.name }));
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };

  // 删除是不可逆动作：第一次点击只进入确认态，再点一次才真正删除。
  const requestRemovePreset = (preset) => {
    const key = `trash-${preset.id}`;
    if (presetConfirm !== key) {
      setPresetConfirm(key);
      notify("warn", t("prompts.presetDeleteConfirm", { name: preset.name }));
      return;
    }
    setPresetConfirm("");
    void removePreset(preset);
  };

  const restoreRecycle = async () => {
    const preset = recycle?.preset;
    if (!preset || busy) return;
    setBusy("preset");
    try {
      await rpc.savePreset({
        id: preset.id,
        name: preset.name,
        directive: preset.directive || "",
        role: preset.role || "",
        boost: preset.boost !== false,
        providers: preset.providers,
      });
      const presetData = await rpc.presets();
      setPresets({ builtin: presetData?.builtin || [], custom: presetData?.custom || [] });
      setRecycle(null);
      notify("ok", t("prompts.presetRestored", { name: preset.name }));
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
        action={<Btn size="sm" onClick={() => void load()}>{t("action.retry")}</Btn>}
      />
    );
  }

  const promptsList = state.data?.prompts;
  // 列表不是数组说明这一层读不到（权限被拒时 denied 带原因，采集失败时只有 null）：
  // 此时不能当成「库里没有这条」，否则会显示成未写入，并允许一次注定失败的保存。
  const promptsUnreadable = !Array.isArray(promptsList);
  const prompts = Array.isArray(promptsList) ? promptsList : [];
  const managed = prompts.find((entry) => entry?.promptId === state.data?.managedPromptId);
  const promptBadge = managed ? (
    <Badge tone="ok">{t("prompts.managedBadge")}</Badge>
  ) : promptsUnreadable ? (
    <Badge tone="warn">{t("prompts.unreadableBadge")}</Badge>
  ) : (
    <Badge tone="off">{t("prompts.notApplied")}</Badge>
  );
  const custom = presets.custom || [];

  return (
    <div className="pg-stack">
      <div className="pg-card">
        <SectionTitle extra={promptBadge}>
          {t("prompts.systemTitle")}
        </SectionTitle>
        <div className="pg-note">{t("prompts.systemHint")}</div>
        {promptsUnreadable ? (
          <div className="pg-inline-warn">
            {`${t("prompts.unreadableTitle")}：${state.data?.denied?.reason || t("prompts.unreadableHint")}`}
          </div>
        ) : null}
        <label className="pg-label">{t("prompts.name")}</label>
        <input
          className="pg-input"
          value={draft.name}
          placeholder={t("prompts.namePlaceholder")}
          onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
        />
        <label className="pg-label">{t("prompts.content")}</label>
        <textarea
          className="pg-textarea"
          rows={8}
          value={draft.content}
          onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
        />
        <div className="pg-row">
          <Toggle
            checked={draft.isActive}
            onChange={(next) => setDraft((prev) => ({ ...prev, isActive: next }))}
            label={t("prompts.active")}
          />
        </div>
        <div className="pg-row pg-row-end">
          {managed ? (
            <Btn
              size="sm"
              variant={presetConfirm === "prompt-remove" ? "danger" : "ghost"}
              disabled={busy !== ""}
              onClick={() => void requestRemovePrompt()}
            >
              {presetConfirm === "prompt-remove" ? t("prompts.removeArmed") : t("prompts.remove")}
            </Btn>
          ) : null}
          <Btn
            size="sm"
            variant="primary"
            disabled={busy !== "" || promptsUnreadable || !draft.content.trim()}
            onClick={() => void savePrompt()}
          >
            {t("prompts.saveApply")}
          </Btn>
        </div>
        {!managed && !promptsUnreadable ? <div className="pg-note">{t("prompts.notInLibrary")}</div> : null}
      </div>

      <div className="pg-card">
        <SectionTitle extra={<Badge tone={state.data?.role?.denied ? "bad" : "off"}>{state.data?.role?.filePath || t("prompts.roleFile")}</Badge>}>
          {t("prompts.roleTitle")}
        </SectionTitle>
        <div className="pg-note">{t("prompts.roleHint")}</div>
        <textarea
          className="pg-textarea"
          rows={6}
          value={roleDraft}
          onChange={(event) => setRoleDraft(event.target.value)}
        />
        <div className="pg-row">
          <Toggle checked={roleEnabled} onChange={setRoleEnabled} label={t("prompts.roleEnable")} disabled />
        </div>
        <div className="pg-row pg-row-end">
          <Btn
            size="sm"
            variant={presetConfirm === "role-restore" ? "danger" : "ghost"}
            disabled={busy !== ""}
            onClick={() => void requestRestoreRole()}
          >
            {presetConfirm === "role-restore" ? t("prompts.roleRestoreArmed") : t("prompts.roleRestore")}
          </Btn>
          <Btn size="sm" variant="primary" disabled={busy !== "" || !roleDraft.trim()} onClick={() => void saveRole()}>
            {t("prompts.roleSave")}
          </Btn>
        </div>
      </div>

      <div className="pg-card">
        <SectionTitle>{t("prompts.presets")}</SectionTitle>
        <div className="pg-note">{t("prompts.presetsHint")}</div>
        <div className="pg-preset-list">
          {presets.builtin.map((preset) => (
            <div className="pg-preset" key={preset.id}>
              <div className="pg-preset-main">
                <div className="pg-preset-name">{pickLocalized(preset.name, locale)}</div>
                <div className="pg-preset-summary">{pickLocalized(preset.summary, locale)}</div>
              </div>
              <Btn size="sm" variant="ghost" onClick={() => usePreset(preset)}>
                {t("prompts.usePreset")}
              </Btn>
            </div>
          ))}
          {custom.length === 0 ? (
            <EmptyState hint={t("prompts.noCustom")} />
          ) : (
            custom.map((preset) => (
              <div className="pg-preset" key={preset.id}>
                <div className="pg-preset-main">
                  <div className="pg-preset-name">{preset.name}</div>
                  <div className="pg-preset-summary">{preset.directive}</div>
                </div>
                <Btn
                  size="sm"
                  variant={presetConfirm === `load-${preset.id}` ? "primary" : "ghost"}
                  onClick={() => usePreset(preset)}
                >
                  {presetConfirm === `load-${preset.id}` ? t("prompts.presetOverwriteArmed") : t("prompts.usePreset")}
                </Btn>
                <Btn
                  size="sm"
                  variant={presetConfirm === `trash-${preset.id}` ? "danger" : "ghost"}
                  disabled={busy !== ""}
                  onClick={() => requestRemovePreset(preset)}
                >
                  {presetConfirm === `trash-${preset.id}` ? t("prompts.presetDeleteArmed") : t("action.delete")}
                </Btn>
              </div>
            ))
          )}
        </div>
        {recycle?.preset ? (
          <div className="pg-row pg-row-end">
            <span className="pg-meta">{t("prompts.presetRecycleHint", { name: recycle.preset.name })}</span>
            <Btn size="sm" variant="ghost" disabled={busy !== ""} onClick={() => void restoreRecycle()}>
              {t("prompts.presetUndo")}
            </Btn>
          </div>
        ) : null}
        <div className="pg-row">
          <input
            className="pg-input"
            value={presetName}
            placeholder={t("prompts.presetNamePlaceholder")}
            onChange={(event) => setPresetName(event.target.value)}
          />
          <Btn size="sm" disabled={busy !== "" || !presetName.trim()} onClick={() => void savePreset()}>
            {t("prompts.savePreset")}
          </Btn>
        </div>
      </div>

      {config?.proxy?.enabled ? <div className="pg-note">{t("prompts.proxyHint")}</div> : null}
    </div>
  );
}
