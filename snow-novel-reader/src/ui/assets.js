// 面板与悬浮阅读窗共享的视觉资源：字体栈、阅读主题、内联图标与面板标签。

export const FONT_STACKS = {
  default: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
  serif: '"SimSun", "Songti SC", "Noto Serif SC", serif',
  yahei: '"Microsoft YaHei", "PingFang SC", sans-serif',
  kai: '"KaiTi", "STKaiti", "Kaiti SC", serif',
  mono: 'Consolas, "Cascadia Mono", "Courier New", monospace'
};

export const THEMES = {
  light: { bg: "#ffffff", text: "#23262b", sub: "#7a8290", border: "rgba(0,0,0,.14)", accent: "#4f8cff" },
  dark: { bg: "#1b1d21", text: "#d6d9de", sub: "#8b929c", border: "rgba(255,255,255,.16)", accent: "#6f9bf0" },
  sepia: { bg: "#f6ecd8", text: "#4b3f2c", sub: "#8a7a5f", border: "rgba(75,63,44,.22)", accent: "#a97e3f" },
  green: { bg: "#c9e8cb", text: "#20321f", sub: "#5d7358", border: "rgba(32,50,31,.2)", accent: "#3f7d4a" }
};

// 悬浮阅读窗是挂在 document.body 上的独立命令式 DOM（不经过 React），
// 无法渲染 api.ui.icon 返回的 React 组件，因此这里只内联它用到的图标几何。
// 数据取自 lucide-react 1.28.0（宿主 pnpm-lock.yaml 实际解析版本），与 api.ui.icon 同源。
export const WINDOW_ICONS = {
  play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  pause: '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
  // chevron-left / chevron-right：顶部栏的上一章 / 下一章入口
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>'
};

export function svgIcon(name, size) {
  const body = WINDOW_ICONS[name] || "";
  const s = size || 14;
  return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}

// 面板 tab 定义：顺序即展示顺序；icon 是 lucide 的 PascalCase 名称，交给 api.ui.icon 解析，
// 因此图标始终与宿主版本保持一致，宿主升级不需要改动本插件。
// labelKey 显式写全，便于完整性测试直接校验「tr() 的键都在语言包里」。
export const PANEL_TABS = [
  { id: "books", icon: "BookOpen", labelKey: "tab.books" },
  { id: "chapters", icon: "List", labelKey: "tab.chapters" },
  { id: "search", icon: "Search", labelKey: "tab.search" },
  { id: "sources", icon: "Library", labelKey: "tab.sources" },
  { id: "settings", icon: "SlidersHorizontal", labelKey: "tab.settings" },
  { id: "keys", icon: "Keyboard", labelKey: "tab.keys" },
  { id: "data", icon: "Database", labelKey: "tab.data" }
];
