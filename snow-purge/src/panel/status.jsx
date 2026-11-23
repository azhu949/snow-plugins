// 状态页：分层自检逐条展示证据，并提供应用 / 撤回入口。
import { Fragment, h } from "./react.js";
import { Badge, Btn, SectionTitle } from "./ui.jsx";

const TONE = { ok: "ok", warn: "warn", fail: "bad", off: "off" };

const STATUS_KEY = {
  ok: "status.ok",
  warn: "status.warn",
  fail: "status.fail",
  off: "status.off",
};

export function StatusView({ t, data, busy, onApply, onRevert, onRefresh }) {
  const selfcheck = data?.selfcheck || { items: [], counts: {} };
  const config = data?.config || {};
  const applied = config.applied || null;
  // 免审批清单由面板直接写入宿主，是否“已托管”以撤回记账为准；托管开关本身没有面板入口。
  const approvalTracked =
    (Array.isArray(applied?.globalTools) ? applied.globalTools.length : 0) +
    Object.values(applied?.projectApprovals || {}).reduce(
      (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
      0
    );

  return (
    <div className="pg-stack">
      <div className="pg-card">
        <SectionTitle extra={<Badge tone={selfcheck.counts?.fail ? "bad" : selfcheck.counts?.warn ? "warn" : "ok"}>{t("status.summary")}</Badge>}>
          {t("status.layers")}
        </SectionTitle>
        <div className="pg-checklist">
          {selfcheck.items.map((item) => (
            <div className="pg-check" key={item.id} data-tone={TONE[item.status] || "muted"}>
              <span className="pg-check-dot" aria-hidden="true" />
              <div className="pg-check-main">
                <div className="pg-check-line">
                  <span className="pg-check-title">{item.title}</span>
                  <span className="pg-check-state">{t(STATUS_KEY[item.status] || "status.off")}</span>
                </div>
                <div className="pg-check-detail">{item.detail}</div>
                {item.evidence ? <div className="pg-check-evidence">{item.evidence}</div> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="pg-row pg-row-end">
          <Btn size="sm" variant="primary" disabled={busy !== ""} onClick={onApply}>
            {t("action.apply")}
          </Btn>
          <Btn size="sm" variant="ghost" disabled={busy !== ""} onClick={onRevert}>
            {t("action.revert")}
          </Btn>
          <Btn size="sm" variant="ghost" disabled={busy !== ""} onClick={onRefresh}>
            {t("action.recheck")}
          </Btn>
        </div>
      </div>

      <div className="pg-card">
        <SectionTitle>{t("status.managed")}</SectionTitle>
        <div className="pg-kv">
          <span className="pg-kv-key">{t("status.enabled")}</span>
          <span className="pg-kv-value">{config.enabled ? t("common.on") : t("common.off")}</span>
          <span className="pg-kv-key">{t("status.prompt")}</span>
          <span className="pg-kv-value">{config.prompt?.enabled ? t("common.on") : t("common.off")}</span>
          <span className="pg-kv-key">{t("status.role")}</span>
          <span className="pg-kv-value">{config.role?.enabled ? t("common.on") : t("common.off")}</span>
          <span className="pg-kv-key">{t("status.proxy")}</span>
          <span className="pg-kv-value">{config.proxy?.enabled ? t("common.on") : t("common.off")}</span>
          <span className="pg-kv-key">{t("status.approval")}</span>
          <span className="pg-kv-value">
            {approvalTracked > 0
              ? t("status.approvalTracked", { count: approvalTracked })
              : applied
                ? t("status.approvalNone")
                : t("status.approvalUnknown")}
          </span>
          {applied?.at ? (
            <Fragment>
              <span className="pg-kv-key">{t("status.lastApplied")}</span>
              <span className="pg-kv-value">{new Date(applied.at).toLocaleString()}</span>
            </Fragment>
          ) : null}
        </div>
        {!applied ? <div className="pg-note">{t("status.neverApplied")}</div> : null}
        {applied ? <div className="pg-note">{t("status.uninstallHint")}</div> : null}
      </div>

      <div className="pg-card">
        <SectionTitle>{t("status.boundaries")}</SectionTitle>
        <ul className="pg-list">
          <li>{t("status.boundary.host")}</li>
          <li>{t("status.boundary.sensitive")}</li>
          <li>{t("status.boundary.sidebar")}</li>
          <li>{t("status.boundary.proxy")}</li>
        </ul>
      </div>
    </div>
  );
}
