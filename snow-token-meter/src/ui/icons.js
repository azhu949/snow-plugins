// 内置 SVG 图标：手写 path，不引外部图标库、CDN 或字体资源。
// 图标既可以作为 Preact 组件使用，也可以生成字符串供原生 DOM（顶栏徽标）使用。
import { h } from "preact";

const ICON_PATHS = {
  Coins: [
    "M3 7c0-1.66 4.03-3 9-3s9 1.34 9 3-4.03 3-9 3-9-1.34-9-3Z",
    "M3 7v5c0 1.66 4.03 3 9 3s9-1.34 9-3V7",
    "M3 12v5c0 1.66 4.03 3 9 3s9-1.34 9-3v-5",
  ],
  Activity: ["M3 12h4l3-8 4 16 3-8h4"],
  RefreshCw: [
    "M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
    "M3 3v5h5",
    "M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16",
    "M16 16h5v5",
  ],
  Settings: [
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  ],
  Pin: [
    "M12 17v5",
    "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z",
  ],
  PinOff: [
    "M12 17v5",
    "M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89",
    "m2 2 20 20",
    "M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11",
  ],
  X: ["M18 6 6 18", "M6 6l12 12"],
  ChevronDown: ["m6 9 6 6 6-6"],
  ChevronLeft: ["m15 18-6-6 6-6"],
  Search: ["M3 11a8 8 0 1 1 16 0 8 8 0 0 1-16 0Z", "m21 21-4.35-4.35"],
  Check: ["M20 6 9 17l-5-5"],
  AlertTriangle: [
    "m10.29 3.86-8.47 14.14A2 2 0 0 0 3.53 21h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z",
    "M12 9v4",
    "M12 17h.01",
  ],
  ArrowDownToLine: ["M12 17V3", "m6 11 6 6 6-6", "M19 21H5"],
  // 擦除：清空可再生缓存（目录缓存）用，语义是「擦掉重拉」而不是删除用户数据。
  Eraser: [
    "m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21",
    "M22 21H7",
    "m5 11 9 9",
  ],
  // 垃圾桶：删除用户自己写下的数据（自定义价）。
  Trash2: [
    "M3 6h18",
    "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
    "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    "M10 11v6",
    "M14 11v6",
  ],
  Gauge: ["m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0"],
  Move: [
    "M12 2v20",
    "m15 19-3 3-3-3",
    "m19 9 3 3-3 3",
    "M2 12h20",
    "m5 9-3 3 3 3",
    "m9 5 3-3 3 3",
  ],
};

const ICON_NAMES = Object.freeze(Object.keys(ICON_PATHS));

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
      class: className,
      "aria-hidden": "true",
      focusable: "false",
    },
    paths.map((d, index) => h("path", { d, key: index })),
  );
}

function escapeAttribute(value) {
  return String(value ?? "").replace(
    /[&<>"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
  );
}

// 原生 DOM 场景（顶栏徽标、悬浮胶囊）用字符串拼 SVG，避免为单个图标挂 Preact 根。
function iconMarkup(name, size = 14, strokeWidth = 1.9, className = "") {
  const paths = ICON_PATHS[name] || [];
  const body = paths.map((d) => `<path d="${escapeAttribute(d)}"></path>`).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${escapeAttribute(className)}" aria-hidden="true" focusable="false">${body}</svg>`;
}

export { ICON_PATHS, ICON_NAMES, Icon, iconMarkup };
