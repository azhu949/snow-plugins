// 面板共享 UI 组件与格式化工具。所有选择器都以 hg- 前缀命名，样式在 style.css。
import { getReact, h } from "./runtime.js";

/** 宿主 lucide 图标；取不到组件时返回 null，不阻塞布局。 */
export function Icon({ ctx, name, size = 14 }) {
  const api = ctx?.api;
  if (!api?.ui || typeof api.ui.icon !== "function") return null;
  let Component = null;
  try {
    Component = api.ui.icon(name);
  } catch {
    Component = null;
  }
  if (!Component) return null;
  return h(Component, { size, strokeWidth: 1.8, "aria-hidden": "true" });
}

export function Spinner({ label }) {
  return h("span", {
    className: "hg-spinner",
    role: "status",
    "aria-label": label || "loading",
  });
}

/** 封面：先取 object URL；HEIC 解码失败或请求失败时显示占位块。 */
export function Cover({ ctx, path, className }) {
  const React = getReact();
  const [src, setSrc] = React.useState(null);
  const [failed, setFailed] = React.useState(!path);

  React.useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(!path);
    if (!path || !ctx?.cover) return undefined;
    ctx.cover.load(path).then((url) => {
      if (!alive) return;
      if (url) setSrc(url);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [path, ctx?.cover]);

  return h(
    "div",
    { className: `hg-cover${className ? ` ${className}` : ""}${src && !failed ? " has-image" : ""}` },
    src && !failed
      ? h("img", {
          src,
          alt: "",
          loading: "lazy",
          draggable: false,
          onError: () => setFailed(true),
        })
      : h("div", { className: "hg-cover-fallback" }, h(Icon, { ctx, name: "Film", size: 18 }))
  );
}

/** 把后台错误码翻译成界面文案；rateLimited 时附带倒计时秒数。 */
export function describeError(t, error) {
  const code = String(error?.code || "UNKNOWN");
  const retrySeconds =
    Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0
      ? Math.ceil(error.retryAfterMs / 1000)
      : 0;

  let title = t("error.title");
  let message = "";
  switch (code) {
    case "BACKGROUND_UNAVAILABLE":
    case "NET_UNAVAILABLE":
      message = t("error.backgroundUnavailable");
      break;
    case "RATE_LIMITED":
      message = t("error.rateLimited");
      break;
    case "ANONYMOUS_LIMITED":
      message = t("error.rateLimitedAnonymous");
      break;
    case "TIMEOUT":
      message = t("error.timeout");
      break;
    case "TRANSPORT":
      message = t("error.transport");
      break;
    case "CONTENT_UNAVAILABLE":
    case "ALBUM_UNAVAILABLE":
    case "NOT_PROTECTED":
    case "DRM_PROTECTED":
      message = t("error.contentUnavailable");
      break;
    case "NOT_FOUND":
      message = t("error.notFound");
      break;
    case "PROTOCOL":
      message = t("error.protocol");
      break;
    case "CURSOR_EXPIRED":
      message = t("catalog.cursorExpired");
      break;
    case "INVALID_PARAM":
    case "PARAM_INVALID":
    case "INVALID_OPTIONS":
      message = t("error.invalidParam");
      break;
    default:
      message = error?.message || t("error.unknown");
  }

  return {
    code,
    title,
    message,
    rateLimited: code === "RATE_LIMITED" || code === "ANONYMOUS_LIMITED",
    retrySeconds,
    hint: code === "BACKGROUND_UNAVAILABLE" ? t("error.backgroundHint") : "",
    raw: error?.message || "",
  };
}

/** 错误 / 限流提示：自带倒计时与重试按钮。 */
export function ErrorNotice({ ctx, error, onRetry, compact }) {
  const React = getReact();
  const t = ctx.t;
  const info = describeError(t, error);
  const [remaining, setRemaining] = React.useState(info.retrySeconds);

  React.useEffect(() => {
    setRemaining(info.retrySeconds);
    if (!info.retrySeconds) return undefined;
    const timer = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          clearInterval(timer);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [error, info.retrySeconds]);

  return h(
    "div",
    { className: `hg-state hg-state-error${compact ? " is-compact" : ""}` },
    h("div", { className: "hg-state-icon" }, h(Icon, { ctx, name: "TriangleAlert", size: 18 })),
    h("div", { className: "hg-state-body" },
      h("div", { className: "hg-state-title" }, info.title),
      h("div", { className: "hg-state-text" }, info.message),
      info.hint ? h("div", { className: "hg-state-hint" }, info.hint) : null,
      info.rateLimited && remaining > 0
        ? h("div", { className: "hg-state-wait" }, t("error.rateLimitedWait", { seconds: remaining }))
        : null,
      onRetry
        ? h(
            "button",
            {
              type: "button",
              className: "hg-btn",
              disabled: remaining > 0,
              onClick: onRetry,
            },
            t("action.retry")
          )
        : null
    )
  );
}

/** 空态：图标 + 标题 + 说明 + 可选动作按钮。 */
export function EmptyState({ ctx, icon = "Inbox", title, hint, action }) {
  return h(
    "div",
    { className: "hg-state hg-state-empty" },
    h("div", { className: "hg-state-icon" }, h(Icon, { ctx, name: icon, size: 22 })),
    h("div", { className: "hg-state-body" },
      h("div", { className: "hg-state-title" }, title),
      hint ? h("div", { className: "hg-state-text" }, hint) : null,
      action || null
    )
  );
}

/** 骨架占位：加载列表时保持布局稳定。 */
export function SkeletonCards({ count = 4 }) {
  return h(
    "div",
    { className: "hg-grid", "aria-hidden": "true" },
    Array.from({ length: count }, (_, index) =>
      h(
        "div",
        { key: `skeleton-${index}`, className: "hg-card hg-card-skeleton" },
        h("div", { className: "hg-skeleton hg-skeleton-cover" }),
        h("div", { className: "hg-skeleton hg-skeleton-line" }),
        h("div", { className: "hg-skeleton hg-skeleton-line short" })
      )
    )
  );
}

const pad2 = (value) => String(value).padStart(2, "0");

/** 毫秒 -> mm:ss（超过 1 小时为 h:mm:ss）。 */
export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`;
}

/** 运行时长：保留天 + hh:mm:ss。 */
export function formatUptime(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

/** 历史时间：按面板语言本地化，失败时退回原生字符串。 */
export function formatDateTime(value, locale) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp);
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}
