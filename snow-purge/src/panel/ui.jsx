// 通用原子组件：按钮、徽标、加载、空状态、字段行、错误盒。
import { h } from "./react.js";

export function Btn({ children, onClick, disabled, variant, size, title, type = "button" }) {
  return (
    <button
      type={type}
      className="pg-btn"
      data-variant={variant}
      data-size={size}
      title={title}
      disabled={disabled === true}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const TONE = {
  ok: "ok",
  warn: "warn",
  fail: "bad",
  off: "muted",
};

export function Badge({ tone = "muted", children }) {
  return (
    <span className="pg-badge" data-tone={TONE[tone] || tone}>
      {children}
    </span>
  );
}

export function Spinner() {
  return <span className="pg-spinner" aria-hidden="true" />;
}

export function Loading({ text }) {
  return (
    <div className="pg-loading">
      <Spinner />
      <span>{text}</span>
    </div>
  );
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="pg-empty">
      {title ? <div className="pg-empty-title">{title}</div> : null}
      {hint ? <div className="pg-empty-hint">{hint}</div> : null}
      {action || null}
    </div>
  );
}

/** 只渲染有值的字段，避免详情里出现一片空行。 */
export function Field({ label, value }) {
  const hasValue = value !== null && value !== undefined && String(value).trim() !== "";
  if (!hasValue) return null;
  return [<span key="k" className="pg-kv-key">{label}</span>, <span key="v" className="pg-kv-value">{value}</span>];
}

export function ErrorBox({ title, message, action }) {
  return (
    <div className="pg-error">
      {title ? <div className="pg-error-title">{title}</div> : null}
      {message ? <div className="pg-error-body">{message}</div> : null}
      {action || null}
    </div>
  );
}

export function SectionTitle({ children, extra }) {
  return (
    <div className="pg-section-title">
      <span>{children}</span>
      {extra ? <span>{extra}</span> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className="pg-toggle" data-disabled={disabled === true ? "1" : "0"}>
      <input
        type="checkbox"
        checked={checked === true}
        disabled={disabled === true}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span className="pg-toggle-box" aria-hidden="true" />
      <span className="pg-toggle-text">
        <span>{label}</span>
        {hint ? <span className="pg-toggle-hint">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * 汇总应用结果的步骤：失败与「未建快照」都要让用户看见。
 * snapshot.skipped 只会在该层仍然应用成功时出现，所以单独提示，不当作失败处理。
 */
export const collectStepIssues = (steps) => {
  const list = Array.isArray(steps) ? steps : [];
  return {
    failed: list.filter((step) => !step.ok),
    unsnapshotted: list.filter((step) => step.ok && step.snapshot?.skipped),
  };
};

/**
 * 把后台 mode 映射成面板汇总口径：revert 是总开关关闭触发的撤回，
 * saved 是总开关关闭时单层保存（只写配置，未写宿主），noop 是没有任何托管层参与的应用。
 */
export const applyModeOf = (mode) =>
  mode === "revert"
    ? "revert-by-switch"
    : mode === "saved"
      ? "saved"
      : mode === "noop"
        ? "noop"
        : "apply";

/**
 * 汇总保存/应用结果：后台在总开关关闭时会把「应用」执行成撤回，
 * 面板必须按 mode 报「已撤回」，失败层的原因也要一起说清。
 * mode：apply | revert（用户主动撤回）| revert-by-switch（总开关关闭触发的撤回）| saved（只保存配置）| noop（未启用任何托管层）
 */
const summarizeBaseApplyOutcome = (steps, mode, t) => {
  const { failed, unsnapshotted } = collectStepIssues(steps);
  if (failed.length > 0) {
    const detail = failed.map((step) => `${step.step}: ${step.message}`).join("；");
    if (mode === "revert-by-switch") {
      return { tone: "warn", text: t("notice.revertPartialBySwitch", { steps: detail }) };
    }
    if (mode === "revert") return { tone: "warn", text: t("notice.revertPartial", { steps: detail }) };
    return { tone: "warn", text: t("notice.partial", { steps: detail }) };
  }
  if (mode === "saved") {
    return { tone: "warn", text: t("notice.savedWhileDisabled") };
  }
  if (mode === "noop") {
    return { tone: "warn", text: t("notice.noop") };
  }
  if (mode === "revert-by-switch") {
    const advisory = (Array.isArray(steps) ? steps : [])
      .filter((step) => step.ok && step.advisory)
      .map((step) => step.message);
    return { tone: "warn", text: [t("notice.revertedBySwitch"), ...advisory].join("；") };
  }
  if (mode === "revert") {
    const list = Array.isArray(steps) ? steps : [];
    const nothing = list.length === 1 && list[0]?.step === "revert";
    // 撤回成功但仍有需要人工核对的内容（如没有记账的免审批清单）：附在结论后面，不当作失败。
    const advisory = list.filter((step) => step.ok && step.advisory).map((step) => step.message);
    return { tone: "warn", text: [t(nothing ? "notice.revertEmpty" : "notice.reverted"), ...advisory].join("；") };
  }
  if (unsnapshotted.length > 0) {
    return {
      tone: "warn",
      text: t("notice.noSnapshot", { steps: unsnapshotted.map((step) => step.message).join("；") }),
    };
  }
  return { tone: "ok", text: t("notice.applied") };
};

/**
 * 对外汇总：记账写入失败时追加一句「已写入宿主、记账没保存」，避免把已落地的动作报成失败。
 * extra.appliedError 为空串时行为与改动前完全一致。
 */
export const summarizeApplyOutcome = (steps, mode, t, extra = {}) => {
  const base = summarizeBaseApplyOutcome(steps, mode, t);
  if (!extra?.appliedError) return base;
  const landed = (Array.isArray(steps) ? steps : []).some((step) => step.ok);
  const note =
    mode === "apply"
      ? landed
        ? t("notice.appliedRecordFailed", { reason: extra.appliedError })
        : t("notice.recordFailed", { reason: extra.appliedError })
      : mode === "noop"
        ? t("notice.recordFailed", { reason: extra.appliedError })
        : t("notice.revertRecordFailed", { reason: extra.appliedError });
  return { tone: "warn", text: `${base.text}；${note}` };
};
