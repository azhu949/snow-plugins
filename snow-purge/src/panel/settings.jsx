// 设置页：托管开关、自动快照与能力边界说明。
import { getReact, h } from "./react.js";
import { Badge, Btn, SectionTitle, Toggle } from "./ui.jsx";

export function SettingsView({ t, rpc, notify, config, reload }) {
  const React = getReact();
  // 上一次服务端值：父级每 25 秒送来新的 config 对象，这里保存基线，用来判断草稿是否有未保存改动。
  const savedRef = React.useRef({
    enabled: config?.enabled !== false,
    autoSnapshot: config?.autoSnapshot !== false,
  });
  const [draft, setDraft] = React.useState(savedRef.current);
  const [busy, setBusy] = React.useState(false);
  const [repairing, setRepairing] = React.useState(false);
  // 配置不可用时后台会附带 settingsIssue：区分「内容损坏」与「读不到存储」，处置方式不同。
  const issue = config?.settingsIssue || null;
  const issueKind = issue?.kind === "read-failed" ? "read-failed" : "corrupt";

  React.useEffect(() => {
    const next = {
      enabled: config?.enabled !== false,
      autoSnapshot: config?.autoSnapshot !== false,
    };
    const prevSaved = savedRef.current;
    savedRef.current = next;
    // 草稿仍等于上一次服务端值 = 没有未保存改动，跟随新值；否则保留用户输入，不被轮询覆盖。
    setDraft((prev) =>
      prev.enabled !== prevSaved.enabled || prev.autoSnapshot !== prevSaved.autoSnapshot ? prev : next
    );
  }, [config]);

  const update = (patch) => setDraft((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await rpc.saveSettings({ enabled: draft.enabled, autoSnapshot: draft.autoSnapshot });
      const confirmed = {
        enabled: saved?.enabled !== false,
        autoSnapshot: saved?.autoSnapshot !== false,
      };
      // 以服务端回执清脏：此后轮询带来的变更可以正常同步。
      savedRef.current = confirmed;
      setDraft(confirmed);
      notify("ok", t("settings.saved"));
      await reload();
    } catch (error) {
      // 保存失败：保留草稿与差异，下一次轮询不会吞掉用户输入。
      notify("bad", String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const repair = async () => {
    if (repairing) return;
    if (!window.confirm(t("settings.repairConfirm"))) return;
    setRepairing(true);
    try {
      const result = await rpc.repairSettings();
      notify(
        "ok",
        result?.repaired
          ? t("settings.repaired", { file: result.file || "-" })
          : result?.reason || t("settings.repairNotNeeded")
      );
      await reload();
    } catch (error) {
      notify("bad", String(error?.message || error));
    } finally {
      setRepairing(false);
    }
  };

  return (
    <div className="pg-stack">
      <div className="pg-card">
        <SectionTitle extra={<Badge tone="off">com.snow.purge</Badge>}>{t("settings.title")}</SectionTitle>
        {issue ? (
          <div className="pg-inline-warn">
            <div>
              {issueKind === "read-failed"
                ? t("settings.readFailedHint")
                : issue.message || t("settings.corruptHint")}
            </div>
            {issueKind === "corrupt" ? (
              <div className="pg-row pg-row-end">
                <Btn size="sm" variant="danger" disabled={repairing} onClick={() => void repair()}>
                  {t("settings.repair")}
                </Btn>
              </div>
            ) : null}
          </div>
        ) : null}
        <Toggle
          checked={draft.enabled}
          onChange={(next) => update({ enabled: next })}
          label={t("settings.enabled")}
          hint={t("settings.enabledHint")}
        />
        <Toggle
          checked={draft.autoSnapshot}
          onChange={(next) => update({ autoSnapshot: next })}
          label={t("settings.autoSnapshot")}
          hint={t("settings.autoSnapshotHint")}
        />
        <div className="pg-row pg-row-end">
          <Btn size="sm" variant="primary" disabled={busy} onClick={() => void save()}>
            {t("action.save")}
          </Btn>
        </div>
      </div>

      <div className="pg-card">
        <SectionTitle>{t("settings.abilities")}</SectionTitle>
        <ul className="pg-list">
          <li>{t("settings.ability.selfcheck")}</li>
          <li>{t("settings.ability.prompt")}</li>
          <li>{t("settings.ability.role")}</li>
          <li>{t("settings.ability.proxy")}</li>
          <li>{t("settings.ability.approval")}</li>
          <li>{t("settings.ability.backup")}</li>
          <li>{t("settings.ability.audit")}</li>
        </ul>
      </div>

      <div className="pg-card">
        <SectionTitle>{t("settings.limits")}</SectionTitle>
        <ul className="pg-list">
          <li>{t("settings.limit.host")}</li>
          <li>{t("settings.limit.sensitive")}</li>
          <li>{t("settings.limit.sidebar")}</li>
          <li>{t("settings.limit.restart")}</li>
          <li>{t("settings.limit.updater")}</li>
        </ul>
      </div>
    </div>
  );
}
