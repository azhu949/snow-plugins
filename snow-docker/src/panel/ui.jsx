// 通用原子组件：按钮、状态徽标、加载、空状态、字段行、错误盒。
import { h } from "./react.js";

export function Btn({ children, onClick, disabled, variant, size, title, type = "button", ...rest }) {
  // [UX优化]: 透传 aria-* / data-* 等属性，按钮才能声明展开态、忙碌态，读屏与样式都能跟上。
  return (
    <button
      {...rest}
      type={type}
      className="dk-btn"
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

const STATE_TONE = {
  running: "ok",
  paused: "warn",
  restarting: "warn",
  exited: "muted",
  created: "muted",
  removing: "warn",
  dead: "bad",
  unknown: "muted",
};

export function StateBadge({ state, t }) {
  const tone = STATE_TONE[state] || "muted";
  const key = `state.${Object.prototype.hasOwnProperty.call(STATE_TONE, state) ? state : "unknown"}`;
  return (
    <span className="dk-badge" data-tone={tone}>
      {t(key)}
    </span>
  );
}

export function Spinner() {
  return <span className="dk-spinner" aria-hidden="true" />;
}

export function Loading({ text }) {
  return (
    <div className="dk-loading">
      <Spinner />
      <span>{text}</span>
    </div>
  );
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="dk-emptystate">
      {title ? <div className="dk-emptystate-title">{title}</div> : null}
      {hint ? <div>{hint}</div> : null}
      {action || null}
    </div>
  );
}

/** 只渲染有值的字段，避免详情里出现一片空行。 */
export function Field({ label, value }) {
  const hasValue = value !== null && value !== undefined && String(value).trim() !== "";
  if (!hasValue) return null;
  return [
    <span key="k" className="dk-kv-key">
      {label}
    </span>,
    <span key="v" className="dk-kv-value">
      {value}
    </span>,
  ];
}

export function ErrorBox({ title, message, action }) {
  return (
    <div className="dk-errorbox">
      {title ? <div className="dk-errorbox-title">{title}</div> : null}
      {message ? <div>{message}</div> : null}
      {action || null}
    </div>
  );
}

export function SectionTitle({ children, extra }) {
  return (
    <div className="dk-section-title">
      <span>{children}</span>
      {extra ? <span>{extra}</span> : null}
    </div>
  );
}
