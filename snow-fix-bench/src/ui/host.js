// 客户端脚本渲染层：内置 Preact、本地 SVG 图标与三语言文案。
// 脚本插件没有宿主面板容器，React 与图标都由脚本自身打包提供。
import { h } from "preact";
import { createPortal, memo } from "preact/compat";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import { SEVERITY } from "../constants.js";
import { createT } from "../i18n.js";

export { h, createPortal, memo, useCallback, useEffect, useId, useMemo, useRef, useState };

const STEP_KEYS = ["review", "extract", "fix", "cleanup"];

// source 可以是 locale 字符串，也可以是带动态 locale getter 的 api 对象。
function makeT(source) {
  return createT(() => (typeof source === "string" ? source : source?.locale));
}

// 仅保留工作台用到的图标，避免把图标库打进脚本。
const ICON_PATHS = {
  X: ["M18 6 6 18", "M6 6l12 12"],
  Check: ["M20 6 9 17l-5-5"],
  Info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 16v-4", "M12 8h.01"],
  CircleAlert: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z", "M12 8v4", "M12 16h.01"],
  ChevronDown: ["m6 9 6 6 6-6"],
  ChevronRight: ["m9 18 6-6-6-6"],
  File: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4"],
  FileText: [
    "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "M10 9H8",
    "M16 13H8",
    "M16 17H8",
  ],
  Folder: [
    "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  ],
  GitCommitHorizontal: ["M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z", "M3 12h6", "M15 12h6"],
  Library: ["m16 6 4 14", "M12 6v14", "M8 8v12", "M4 4v16"],
  ListChecks: ["m3 17 2 2 4-4", "m3 7 2 2 4-4", "M13 6h8", "M13 12h8", "M13 18h8"],
  Loader2: ["M21 12a9 9 0 1 1-6.219-8.56"],
  MapPin: [
    "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0",
    "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  ],
  RefreshCw: [
    "M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
    "M3 3v5h5",
    "M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16",
    "M16 16h5v5",
  ],
  ScanSearch: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z", "m21 21-4.34-4.34"],
  Server: [
    "M4 3h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z",
    "M4 15h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z",
    "M7 6h1",
    "M7 18h1",
  ],
  Settings: [
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  ],
  Wrench: [
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  ],
};

function Icon({ name, size = 14, strokeWidth = 1.9, className }) {
  const paths = ICON_PATHS[name] || [];
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": strokeWidth,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      className,
      "aria-hidden": "true",
      focusable: "false",
    },
    paths.map((d, index) => h("path", { d, key: index })),
  );
}

function iconEl(_api, name, size, strokeWidth, className) {
  return h(Icon, { name, size: size || 14, strokeWidth: strokeWidth || 1.9, className });
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(rest)}`;
  return `${minutes}:${pad2(rest)}`;
}

function formatDateTime(timestamp) {
  if (!timestamp) return "";
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return "";
  }
}

function statusLabel(t, status) {
  return t(`fx.status.${status}`);
}

function severityLabel(t, severity) {
  if (severity === SEVERITY.critical) return t("fx.sev.critical");
  if (severity === SEVERITY.major) return t("fx.sev.major");
  if (severity === SEVERITY.minor) return t("fx.sev.minor");
  return String(severity || "");
}

// 严重度标签样式：列表与各确认弹窗共用，避免弹窗固定显示为严重色。
// 未知值仍落到 is-major，保持既有显示。
function severityClass(severity) {
  if (severity === SEVERITY.critical) return "is-critical";
  if (severity === SEVERITY.major) return "is-major";
  if (severity === SEVERITY.minor) return "is-minor";
  return "is-major";
}

function useStore(engine) {
  const [snapshot, setSnapshot] = useState(() => engine.store.get());
  useEffect(() => engine.store.subscribe(setSnapshot), [engine]);
  return snapshot;
}

export { STEP_KEYS, makeT, iconEl, formatElapsed, formatDateTime, statusLabel, severityLabel, severityClass, useStore };
