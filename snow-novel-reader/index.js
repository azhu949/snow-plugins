// 小说阅读器（Novel Reader）- Snow App 插件入口
// 面板：书架 / 目录 / 基础设置 / 快捷键 / 数据；悬浮阅读窗：可调透明度与位置、滚轮与快捷键翻页（键位可自定义）、鼠标移入显示移出隐藏。
// 入口契约：export function mount(container, api) 返回清理函数（ESM）。

const STORE_STATE_KEY = "reader-state";
const IDB_NAME = "snow-novel-reader";
const IDB_STORE = "books";
const IDB_FALLBACK_PREFIX = "book-text-";
const WIN_ID = "snow-novel-reader-window";
const DOT_ID = "snow-novel-reader-dot";
const SEGMENT_CHARS = 40000;
// 面板 id 必须与 plugin.json 的 panels[0].id 保持一致（pluginsSelf.openPanel 的必填参数）
const PANEL_ID = "reader";

const DEFAULT_SETTINGS = {
  winVisible: false,
  opacity: 0.92,
  sleepMode: "fade",
  sleepOpacity: 0.06,
  sleepDelay: 500,
  x: null,
  y: null,
  width: 460,
  height: 380,
  theme: "auto",
  fontSize: 15,
  lineHeight: 1.9,
  font: "default",
  indent: false,
  wheelPaging: true,
  hotkeys: "hover",
  autoScroll: false,
  autoScrollSpeed: 40
};

// 设置项收敛规则表：键必须与 DEFAULT_SETTINGS 一一对应，sanitizeSettings 逐键按此收敛，
// 并在末尾做双向差集校验；新增设置字段时忘记在此登记会被日志告警（而不是静默重置）。
// kind：bool 布尔；num 数字（min/max 收敛）；oneOf 候选集（values 延迟求值，避免依赖声明顺序）；
// nullableNum 数字或 null（如窗口坐标 x/y 的「未设置」语义）。
// num 型键的 min/max 同时是界面滑杆的取值范围（带单位换算的项按 scale 换算：opacity/sleepOpacity 乘 100、lineHeight 乘 10）；
// 滑杆必须直接引用本表，不得另写字面量。
const SETTINGS_SPEC = {
  winVisible: { kind: "bool" },
  opacity: { kind: "num", min: 0.05, max: 1 },
  sleepMode: { kind: "oneOf", values: () => ["always", "fade", "hide"] },
  sleepOpacity: { kind: "num", min: 0.01, max: 1 },
  sleepDelay: { kind: "num", min: 0, max: 10000 },
  x: { kind: "nullableNum" },
  y: { kind: "nullableNum" },
  width: { kind: "num", min: 220, max: 1400 },
  height: { kind: "num", min: 140, max: 1200 },
  theme: { kind: "oneOf", values: () => ["auto"].concat(Object.keys(THEMES)) },
  fontSize: { kind: "num", min: 11, max: 36 },
  lineHeight: { kind: "num", min: 1.2, max: 3 },
  font: { kind: "oneOf", values: () => Object.keys(FONT_STACKS) },
  indent: { kind: "bool" },
  wheelPaging: { kind: "bool" },
  hotkeys: { kind: "oneOf", values: () => ["hover", "global", "off"] },
  autoScroll: { kind: "bool" },
  autoScrollSpeed: { kind: "num", min: 5, max: 400 }
};

// 可自定义键位的默认绑定：动作 id -> 键位标识数组（如 "Ctrl+ArrowRight"）
const DEFAULT_KEY_BINDINGS = {
  pageDown: ["PageDown", "ArrowDown", "ArrowRight", "Space", "KeyJ"],
  pageUp: ["PageUp", "ArrowUp", "ArrowLeft", "KeyK"],
  nextChapter: ["Ctrl+ArrowRight", "Ctrl+PageDown"],
  prevChapter: ["Ctrl+ArrowLeft", "Ctrl+PageUp"],
  top: ["Home"],
  bottom: ["End"]
};

function cloneKeyBindings(map) {
  const result = {};
  for (const key of Object.keys(map || {})) result[key] = map[key].slice();
  return result;
}

// 修饰键与无意义按键：录制与匹配时忽略
const MODIFIER_CODE_RE = /^(Control|Shift|Alt|Meta|OS|Hyper|Super)(Left|Right)?$/;
const DEAD_KEY_CODE_RE = /^(CapsLock|NumLock|ScrollLock|ContextMenu|Dead|Unidentified|Process|Compose|Convert|NonConvert|KanaMode|Lang[0-9]?)$/;
const NAMED_KEY_ALIASES = { " ": "Space", Spacebar: "Space", Esc: "Escape", Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight" };

// 把键盘事件归一化为键位标识（如 "Ctrl+ArrowRight"）；只按下修饰键时返回 null
function eventKeyId(e) {
  if (!e || e.isComposing) return null;
  const code = typeof e.code === "string" ? e.code : "";
  const key = typeof e.key === "string" ? e.key : "";
  let base = "";
  if (code && !MODIFIER_CODE_RE.test(code) && !DEAD_KEY_CODE_RE.test(code)) {
    base = code;
  } else if (key && key.length === 1) {
    if (key === " ") base = "Space";
    else if (/[a-z]/i.test(key)) base = "Key" + key.toUpperCase();
    else if (/[0-9]/.test(key)) base = "Digit" + key;
    else base = "Char:" + key;
  } else if (key && !MODIFIER_CODE_RE.test(key) && !DEAD_KEY_CODE_RE.test(key)) {
    base = NAMED_KEY_ALIASES[key] || key;
  }
  if (!base) return null;
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.metaKey) parts.push("Meta");
  parts.push(base);
  return parts.join("+");
}

// 语言包缺失时的内置兜底文案（中文）
const FALLBACK = {
  "plugin.name": "小说阅读器",
  "tab.books": "书架",
  "tab.chapters": "目录",
  "tab.settings": "基础设置",
  "tab.keys": "快捷键",
  "tab.data": "数据",
  "action.import": "导入 TXT",
  "action.delete": "删除",
  "action.cancel": "取消",
  "action.confirm": "确认",
  "action.open": "打开",
  "action.jump": "跳转",
  "status.importing": "正在导入…",
  "status.imported": "已导入 {{count}} 本",
  "status.importFailed": "导入失败：{{error}}",
  "status.loadingBook": "正在读取书籍…",
  "status.cleared": "已清空",
  "status.panelFailed": "面板打开失败：{{error}}",
  "status.panelUnavailable": "当前宿主版本不支持打开插件面板",
  "empty.books": "还没有书籍，点击「导入 TXT」开始。",
  "empty.chapters": "未识别到章节，已按固定长度分段。",
  "empty.book": "这本书没有文字内容。",
  "empty.reader": "还没有打开任何书籍",
  "books.count": "共 {{count}} 本",
  "books.progress": "进度 {{percent}}%",
  "win.show": "显示阅读窗口",
  "win.hide": "隐藏阅读窗口",
  "win.hint": "阅读窗口仅在插件面板打开期间显示，拖动顶部栏可移动位置。",
  "chapter.current": "当前",
  "search.placeholder": "搜索章节标题…",
  "search.empty": "没有匹配的章节",
  "settings.window": "窗口",
  "settings.appearance": "外观",
  "settings.interaction": "快捷键与滚动",
  "settings.data": "数据",
  "settings.opacity": "不透明度",
  "settings.sleepOnLeave": "鼠标移出时",
  "settings.sleep.always": "保持显示",
  "settings.sleep.fade": "淡化",
  "settings.sleep.hide": "完全隐藏",
  "settings.sleepOpacity": "淡化不透明度",
  "settings.sleepDelay": "隐藏延迟（毫秒）",
  "settings.width": "宽度",
  "settings.height": "高度",
  "settings.theme": "阅读主题",
  "settings.theme.auto": "跟随应用",
  "settings.theme.light": "浅色",
  "settings.theme.dark": "深色",
  "settings.theme.sepia": "羊皮纸",
  "settings.theme.green": "护眼",
  "settings.fontSize": "字号",
  "settings.lineHeight": "行高",
  "settings.font": "字体",
  "settings.font.default": "系统默认",
  "settings.font.serif": "宋体",
  "settings.font.yahei": "微软雅黑",
  "settings.font.kai": "楷体",
  "settings.font.mono": "等宽",
  "settings.indent": "首行缩进",
  "settings.hotkeys": "快捷键翻页",
  "settings.hotkeys.hover": "仅鼠标在窗口时",
  "settings.hotkeys.global": "全局",
  "settings.hotkeys.off": "关闭",
  "settings.wheel": "滚轮翻页",
  "settings.autoScroll": "自动滚动",
  "settings.autoSpeed": "滚动速度",
  "settings.tipKeys": "键位可在下方「按键绑定」中自定义；翻页范围由上方选项控制。",
  "settings.tipAltWheel": "在阅读窗口上按住 Alt 滚动滚轮可快速调整不透明度。",
  "keys.bindings": "按键绑定",
  "keys.pageDown": "下一页",
  "keys.pageUp": "上一页",
  "keys.nextChapter": "下一章",
  "keys.prevChapter": "上一章",
  "keys.top": "回到顶部",
  "keys.bottom": "跳到底部",
  "keys.record": "按下新的键位…",
  "keys.empty": "未绑定",
  "keys.reset": "恢复默认键位",
  "keys.resetDone": "已恢复默认键位",
  "keys.saved": "已绑定：{{keys}}",
  "keys.cleared": "已清除键位绑定",
  "keys.conflict": "已从「{{action}}」移除重复键位",
  "keys.space": "空格",
  "keys.hint": "点击键位按钮后按下组合键完成绑定；按 Esc 取消，按 Backspace / Delete 清除该键位。",
  "settings.clearAll": "清空全部数据",
  "settings.clearConfirm": "将删除全部书籍与阅读进度（阅读设置与快捷键保留），且无法恢复。确定继续？",
  "settings.deleteConfirm": "再次点击「删除」确认移除",
  "data.books": "书籍数量",
  "data.size": "占用空间",
  "data.current": "当前阅读",
  "data.storage": "书籍正文保存在本机 IndexedDB（不可用时回退插件私有存储）；阅读进度与设置保存在插件私有存储，不会上传。占用空间按导入文件大小估算。",
  "seg.fallback": "第 {{n}} 段"
};

const FONT_STACKS = {
  default: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
  serif: '"SimSun", "Songti SC", "Noto Serif SC", serif',
  yahei: '"Microsoft YaHei", "PingFang SC", sans-serif',
  kai: '"KaiTi", "STKaiti", "Kaiti SC", serif',
  mono: 'Consolas, "Cascadia Mono", "Courier New", monospace'
};

const THEMES = {
  light: { bg: "#ffffff", text: "#23262b", sub: "#7a8290", border: "rgba(0,0,0,.14)", accent: "#4f8cff" },
  dark: { bg: "#1b1d21", text: "#d6d9de", sub: "#8b929c", border: "rgba(255,255,255,.16)", accent: "#6f9bf0" },
  sepia: { bg: "#f6ecd8", text: "#4b3f2c", sub: "#8a7a5f", border: "rgba(75,63,44,.22)", accent: "#a97e3f" },
  green: { bg: "#c9e8cb", text: "#20321f", sub: "#5d7358", border: "rgba(32,50,31,.2)", accent: "#3f7d4a" }
};

const ICONS = {
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M10 5V3h4v2"/><path d="M19 6l-1 14H6L5 6"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  pause: '<path d="M8 5v14"/><path d="M16 5v14"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>'
};

function svgIcon(name, size) {
  const body = ICONS[name] || "";
  const s = size || 14;
  return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "0 KB";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

// 返回最后一个 arr[i] <= value 的下标 + 1（即插入位置）
function upperBound(arr, value) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function applyValues(text, values) {
  if (!values) return text;
  return String(text).replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return values[key] === undefined || values[key] === null ? match : String(values[key]);
  });
}

export function mount(container, api) {
  const tr = (key, values) => {
    const fallback = Object.prototype.hasOwnProperty.call(FALLBACK, key) ? FALLBACK[key] : key;
    try {
      if (api && typeof api.t === "function") {
        const text = api.t(key, { defaultValue: fallback, values });
        if (typeof text === "string" && text.length > 0) return text;
      }
    } catch (err) {
      /* 语言包不可用时使用内置文案 */
    }
    return applyValues(fallback, values);
  };
  const log = (...args) => {
    try {
      if (api && typeof api.log === "function") api.log(...args);
    } catch (err) {
      /* ignore */
    }
  };

  // ---------------- 状态 ----------------
  const state = {
    // keyBindings 单独深拷贝，避免用户改动污染模块级默认值
    settings: Object.assign({}, DEFAULT_SETTINGS, { keyBindings: cloneKeyBindings(DEFAULT_KEY_BINDINGS) }),
    books: [],
    currentBookId: null
  };
  const runtime = {
    current: null,
    segIndex: 0,
    lineOffsets: [],
    segStart: 0,
    pendingLine: -1,
    sleeping: false,
    hover: false,
    dragging: false,
    lineHeightPx: 0
  };
  let disposed = false;
  // 打开请求序号：自增即作废所有在途读取，保证只有最后一次 openBook 能落地
  let openToken = 0;
  let panelTab = "books";
  let chapterQuery = "";
  let armedBookId = null;
  let armTimer = 0;
  let statusTimer = 0;
  const listeners = [];
  const controlUpdaters = [];
  const timers = { save: 0, scrollRaf: 0, sleep: 0, autoRaf: 0, snap: 0 };

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push({ target, type, handler, options });
  }
  function releaseListeners() {
    for (const item of listeners) {
      try {
        item.target.removeEventListener(item.type, item.handler, item.options);
      } catch (err) {
        /* ignore */
      }
    }
    listeners.length = 0;
  }
  function registerControl(fn) {
    controlUpdaters.push(fn);
  }
  function syncControls() {
    for (const fn of controlUpdaters) {
      try {
        fn();
      } catch (err) {
        /* ignore */
      }
    }
  }

  // ---------------- 悬浮阅读窗 DOM ----------------
  const winEl = document.createElement("div");
  winEl.id = WIN_ID;
  winEl.className = "snr-win";
  winEl.style.display = "none";
  winEl.innerHTML =
    '<div class="snr-bar">' +
    '<div class="snr-title"></div>' +
    '<div class="snr-percent"></div>' +
    '<div class="snr-actions">' +
    '<button class="snr-btn" type="button" data-act="autoscroll" title="' + escapeAttr(tr("settings.autoScroll")) + '">' + svgIcon("play", 14) + "</button>" +
    '<button class="snr-btn" type="button" data-act="panel" title="' + escapeAttr(tr("tab.settings")) + '">' + svgIcon("panel", 14) + "</button>" +
    '<button class="snr-btn" type="button" data-act="close" title="' + escapeAttr(tr("win.hide")) + '">' + svgIcon("close", 14) + "</button>" +
    "</div>" +
    "</div>" +
    '<div class="snr-body"><div class="snr-content"></div></div>' +
    '<div class="snr-foot"><div class="snr-progress"></div></div>' +
    '<div class="snr-resize"></div>';
  const barEl = winEl.querySelector(".snr-bar");
  const titleEl = winEl.querySelector(".snr-title");
  const percentEl = winEl.querySelector(".snr-percent");
  const actionsEl = winEl.querySelector(".snr-actions");
  const autoBtn = winEl.querySelector('button[data-act="autoscroll"]');
  const bodyEl = winEl.querySelector(".snr-body");
  const contentEl = winEl.querySelector(".snr-content");
  const progressEl = winEl.querySelector(".snr-progress");
  const resizeEl = winEl.querySelector(".snr-resize");

  const dotEl = document.createElement("div");
  dotEl.id = DOT_ID;
  dotEl.className = "snr-dot";
  dotEl.hidden = true;
  dotEl.title = tr("win.show");
  dotEl.innerHTML = svgIcon("book", 16);

  if (winEl.parentNode !== document.body) document.body.appendChild(winEl);
  if (dotEl.parentNode !== document.body) document.body.appendChild(dotEl);

  // ---------------- 面板 DOM ----------------
  const panelEl = document.createElement("div");
  panelEl.className = "nr-panel";
  panelEl.innerHTML =
    '<div class="nr-head">' +
    '<div class="nr-head-title"></div>' +
    '<div class="nr-head-sub"></div>' +
    "</div>" +
    '<div class="nr-toolbar">' +
    '<button class="nr-btn primary" type="button" data-act="import">' + svgIcon("plus", 13) + "<span></span></button>" +
    '<button class="nr-btn" type="button" data-act="toggleWin"><span></span></button>' +
    "</div>" +
    '<div class="nr-status"></div>' +
    '<div class="nr-tabs">' +
    '<button class="nr-tab" type="button" data-tab="books"></button>' +
    '<button class="nr-tab" type="button" data-tab="chapters"></button>' +
    '<button class="nr-tab" type="button" data-tab="settings"></button>' +
    '<button class="nr-tab" type="button" data-tab="keys"></button>' +
    '<button class="nr-tab" type="button" data-tab="data"></button>' +
    "</div>" +
    '<div class="nr-view"></div>' +
    '<input class="nr-file" type="file" accept=".txt,text/plain" multiple>';
  const headTitleEl = panelEl.querySelector(".nr-head-title");
  const headSubEl = panelEl.querySelector(".nr-head-sub");
  const importBtn = panelEl.querySelector('button[data-act="import"]');
  const toggleWinBtn = panelEl.querySelector('button[data-act="toggleWin"]');
  const statusEl = panelEl.querySelector(".nr-status");
  const tabsEl = panelEl.querySelector(".nr-tabs");
  const viewEl = panelEl.querySelector(".nr-view");
  const fileInput = panelEl.querySelector(".nr-file");
  headTitleEl.textContent = tr("plugin.name");
  importBtn.querySelector("span").textContent = tr("action.import");
  const tabButtons = Array.from(tabsEl.querySelectorAll(".nr-tab"));
  tabButtons[0].textContent = tr("tab.books");
  tabButtons[1].textContent = tr("tab.chapters");
  tabButtons[2].textContent = tr("tab.settings");
  tabButtons[3].textContent = tr("tab.keys");
  tabButtons[4].textContent = tr("tab.data");

  container.replaceChildren(panelEl);

  // ---------------- 存储 ----------------
  function saveStateSoon() {
    if (timers.save) clearTimeout(timers.save);
    timers.save = setTimeout(() => {
      timers.save = 0;
      saveStateNow();
    }, 600);
  }
  function saveStateNow() {
    try {
      const payload = {
        v: 1,
        settings: state.settings,
        books: state.books,
        currentBookId: state.currentBookId
      };
      const p = api.storage.setJson(STORE_STATE_KEY, payload);
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (err) {
      log("save state failed", err);
    }
  }
  async function loadState() {
    try {
      const raw = await api.storage.getJson(STORE_STATE_KEY, null);
      if (!raw || typeof raw !== "object") return;
      if (raw.settings && typeof raw.settings === "object") {
        const saved = sanitizeSettings(raw.settings);
        for (const key of Object.keys(saved)) state.settings[key] = saved[key];
        state.settings.keyBindings = sanitizeKeyBindings(raw.settings.keyBindings);
      }
      if (Array.isArray(raw.books)) {
        state.books = raw.books.filter((b) => b && typeof b.id === "string" && typeof b.name === "string");
      }
      if (typeof raw.currentBookId === "string") state.currentBookId = raw.currentBookId;
    } catch (err) {
      log("load state failed", err);
    }
  }

  // 书籍正文存储：优先 IndexedDB，失败时回退插件私有存储
  function openDb() {
    if (runtime.db) return runtime.db;
    runtime.db = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("indexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("indexedDB open failed"));
    }).catch((err) => {
      runtime.db = null;
      throw err;
    });
    return runtime.db;
  }
  async function idbRun(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const store = tx.objectStore(IDB_STORE);
      let result = null;
      try {
        result = fn(store);
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const textStore = {
    async put(id, text) {
      try {
        await idbRun("readwrite", (store) => store.put(text, id));
        return true;
      } catch (err) {
        log("idb put failed, fallback to storage", err);
      }
      try {
        await api.storage.set(IDB_FALLBACK_PREFIX + id, text);
        return true;
      } catch (err) {
        log("text fallback save failed", err);
        return false;
      }
    },
    async get(id) {
      try {
        const value = await idbRun("readonly", (store) => store.get(id));
        if (typeof value === "string") return value;
      } catch (err) {
        /* try fallback */
      }
      try {
        const value = await api.storage.get(IDB_FALLBACK_PREFIX + id, null);
        return typeof value === "string" ? value : null;
      } catch (err) {
        return null;
      }
    },
    async remove(id) {
      try {
        await idbRun("readwrite", (store) => store.delete(id));
      } catch (err) {
        /* ignore */
      }
      try {
        await api.storage.remove(IDB_FALLBACK_PREFIX + id);
      } catch (err) {
        /* ignore */
      }
    },
    async clear() {
      try {
        await idbRun("readwrite", (store) => store.clear());
      } catch (err) {
        /* ignore */
      }
      try {
        const all = await api.storage.all();
        if (all && typeof all === "object") {
          // 受限并发删除回退键：减少清空时的串行等待，同时避免一次涌入过多 IPC
          const keys = Object.keys(all).filter((key) => key.indexOf(IDB_FALLBACK_PREFIX) === 0);
          const batchSize = 5;
          for (let i = 0; i < keys.length; i += batchSize) {
            await Promise.all(keys.slice(i, i + batchSize).map((key) => api.storage.remove(key)));
          }
        }
      } catch (err) {
        /* ignore */
      }
    }
  };

  // ---------------- 文本处理 ----------------
  // 粗略可读性评分：CJK 与全角标点、可打印 ASCII 加分，零字节、替换字符与控制字符扣分；
  // 返回前 300 字符的每码点平均分，避免候选与对照文本长度不同时总分不可比
  function readableScore(text) {
    let value = 0;
    const probe = String(text == null ? "" : text).slice(0, 300);
    for (const ch of probe) {
      const code = ch.codePointAt(0);
      if (code === 0 || code === 0xfffd) value -= 4;
      else if (code < 32 && code !== 9 && code !== 10 && code !== 13) value -= 4;
      else if (code >= 0x4e00 && code <= 0x9fff) value += 2;
      else if (code >= 0x20 && code <= 0x7e) value += 1;
      else if (code >= 0x3000 && code <= 0x303f) value += 1;
      else if (code >= 0xff00 && code <= 0xffef) value += 1;
      else if (code >= 0x2000 && code <= 0x206f) value += 0;
      else value -= 1;
    }
    // 分母按码点计数，与 for-of 的迭代口径一致（代理对只算一个字符）
    const units = Array.from(probe).length;
    return units ? value / units : 0;
  }

  // 按 16 位单元统计结构特征：CJK 及中文标点命中数、两侧字节同为可打印 ASCII 的单元数。
  // 真 UTF-16 中文以汉字为主（CJK 命中率高、ASCII 配对率低）；Latin-1 等单字节西文被
  // 误当作 UTF-16 时字母会两两配成 ASCII 单元（ASCII 配对率显著偏高）。
  function utf16UnitStats(u8, littleEndian) {
    const limit = Math.min(u8.length, 4096);
    let units = 0;
    let cjk = 0;
    let bothAscii = 0;
    for (let i = 0; i + 1 < limit; i += 2) {
      const lo = littleEndian ? u8[i] : u8[i + 1];
      const hi = littleEndian ? u8[i + 1] : u8[i];
      const code = lo | (hi << 8);
      units += 1;
      if (code >= 0x4e00 && code <= 0x9fff) cjk += 1;
      else if (code >= 0x3000 && code <= 0x303f) cjk += 1;
      else if (code >= 0xff00 && code <= 0xffef) cjk += 1;
      else if (code >= 0x2000 && code <= 0x206f) cjk += 1;
      if (lo >= 0x20 && lo <= 0x7e && hi >= 0x20 && hi <= 0x7e) bothAscii += 1;
    }
    return { units: units, cjk: cjk, bothAscii: bothAscii };
  }

  // 纯中文的 UTF-16 正文几乎没有零字节，零字节探测不会触发；按两种字节序试解码，
  // 只有结构特征可信（CJK 命中率 >= 0.5 且 ASCII 配对率 <= 0.6）时才返回候选，
  // 否则返回 null 继续原有 GB18030 -> GBK -> UTF-8 回退链，避免把单字节西文误判为 UTF-16。
  function decodeUtf16Candidate(u8) {
    const le = utf16UnitStats(u8, true);
    const be = utf16UnitStats(u8, false);
    const trusted = (stats) =>
      stats.units > 0 && stats.cjk / stats.units >= 0.5 && stats.bothAscii / stats.units <= 0.6;
    const leOk = trusted(le);
    const beOk = trusted(be);
    if (!leOk && !beOk) return null;
    const useLe = leOk && (!beOk || le.cjk >= be.cjk);
    return useLe ? new TextDecoder("utf-16le").decode(u8) : new TextDecoder("utf-16be").decode(u8);
  }

  function decodeBuffer(buffer) {
    const u8 = new Uint8Array(buffer);
    if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
      return new TextDecoder("utf-8").decode(u8.subarray(3));
    }
    if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
      return new TextDecoder("utf-16le").decode(u8.subarray(2));
    }
    if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
      return new TextDecoder("utf-16be").decode(u8.subarray(2));
    }
    // 无 BOM 的 UTF-16 探测（大量零字节）：UTF-16LE 下 ASCII 的零字节落在奇数索引，
    // 故 oddZeros 更高时是 utf-16le，evenZeros 更高时是 utf-16be。
    const sample = Math.min(u8.length, 4096);
    if (sample >= 16) {
      let evenZeros = 0;
      let oddZeros = 0;
      for (let i = 0; i + 1 < sample; i += 2) {
        if (u8[i] === 0) evenZeros += 1;
        if (u8[i + 1] === 0) oddZeros += 1;
      }
      const half = sample / 2 / 8;
      if (evenZeros > half || oddZeros > half) {
        return oddZeros > evenZeros
          ? new TextDecoder("utf-16le").decode(u8)
          : new TextDecoder("utf-16be").decode(u8);
      }
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(u8);
    } catch (err) {
      /* 不是合法 UTF-8 */
    }
    // 不是合法 UTF-8：可能是 GB18030/GBK 文本，也可能是零字节过少、探测未触发的无 BOM UTF-16 正文
    let gbText = null;
    try {
      gbText = new TextDecoder("gb18030", { fatal: true }).decode(u8);
    } catch (err) {
      /* 不是合法 GB18030 */
    }
    const utf16Text = decodeUtf16Candidate(u8);
    const useUtf16 = utf16Text !== null && (gbText === null || readableScore(utf16Text) > readableScore(gbText));
    if (useUtf16) return utf16Text;
    if (gbText !== null) return gbText;
    try {
      return new TextDecoder("gbk").decode(u8);
    } catch (err) {
      return new TextDecoder("utf-8").decode(u8);
    }
  }

  function normalizeText(text) {
    return String(text == null ? "" : text)
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n");
  }

  const CHAPTER_RE = /^[\s\u3000]*(?:第\s*[0-9０-９零一二三四五六七八九十百千万两]{1,10}\s*[章回节節卷部集篇幕]|(?:序章|楔子|引子|前言|后记|後記|尾声|尾聲|番外)|(?:Chapter|CHAPTER)\s+[0-9IVXLCivxlc]{1,6}|[0-9]{1,4}[、.．]\s*\S)/;

  function isChapterTitle(line) {
    const s = String(line || "").trim();
    if (!s || s.length > 40) return false;
    return CHAPTER_RE.test(s);
  }

  function buildBlocks(text) {
    const lines = text.split("\n");
    const starts = [];
    let acc = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (isChapterTitle(line)) starts.push({ char: acc, title: line.trim() });
      acc += line.length + 1;
    }
    const blocks = [];
    if (starts.length >= 2) {
      if (starts[0].char > 0) blocks.push({ title: "", start: 0, end: starts[0].char });
      for (let i = 0; i < starts.length; i += 1) {
        const start = starts[i];
        const end = i + 1 < starts.length ? starts[i + 1].char : text.length;
        blocks.push({ title: start.title, start: start.char, end: end });
      }
    } else {
      const count = Math.max(1, Math.ceil(text.length / SEGMENT_CHARS));
      for (let i = 0; i < count; i += 1) {
        blocks.push({ title: "", start: i * SEGMENT_CHARS, end: Math.min(text.length, (i + 1) * SEGMENT_CHARS) });
      }
    }
    return blocks;
  }

  function findBlockIndex(blocks, offset) {
    const target = Math.max(0, Number(offset) || 0);
    let lo = 0;
    let hi = blocks.length - 1;
    let found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid].start <= target) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  // ---------------- 阅读窗口：主题与外观 ----------------
  // 固定阅读主题返回对应调色板；跟随应用（auto）时返回 null，
  // 由 .snr-win 上的 --snr-* 默认值直接取宿主主题 token。
  function resolveTheme() {
    const key = state.settings.theme;
    if (key === "auto") return null;
    return THEMES[key] || THEMES.light;
  }

  // 基础行高：非法设置回退默认字号乘行高，避免 NaN 传播到所有滚动计算
  function baseLineHeightPx() {
    const size = Number(state.settings.fontSize);
    const ratio = Number(state.settings.lineHeight);
    const fallback = DEFAULT_SETTINGS.fontSize * DEFAULT_SETTINGS.lineHeight;
    const base = isFinite(size) && isFinite(ratio) && size > 0 && ratio > 0 ? size * ratio : fallback;
    return Math.max(8, base);
  }

  // 实际行高：由 refreshBodyMetrics 调整为「视口高度 / 整数行数」，
  // 让每屏恰好容纳整数行，翻页永远停在行边界；未测量时退回设置值。
  function lineHeightPx() {
    const lh = runtime.lineHeightPx;
    if (typeof lh === "number" && lh > 0) return lh;
    return baseLineHeightPx();
  }

  function refreshBodyMetrics() {
    const base = baseLineHeightPx();
    const view = bodyEl.clientHeight;
    if (view > 0) {
      const rows = Math.max(1, Math.floor(view / base));
      runtime.lineHeightPx = view / rows;
    } else {
      runtime.lineHeightPx = base;
    }
  }

  // 可滚动上限并按行高向下取整：scrollHeight 是行高的整数倍，取整后停位始终落在行边界
  function gridMaxScrollTop() {
    const lh = lineHeightPx();
    const max = Math.max(0, bodyEl.scrollHeight - bodyEl.clientHeight);
    return Math.floor(max / lh) * lh;
  }

  // 重新测量视口并应用行高；keepAnchor 时把滚动位置吸附到行边界
  function applyLineMetrics(keepAnchor) {
    refreshBodyMetrics();
    const lh = lineHeightPx();
    const cssLh = String(lh) + "px";
    contentEl.style.lineHeight = cssLh;
    contentEl.style.setProperty("--snr-lh-px", cssLh);
    if (keepAnchor) {
      const line = Math.round(bodyEl.scrollTop / lh);
      bodyEl.scrollTop = line * lh;
    }
  }

  // ---------------- 阅读窗口：位置与尺寸 ----------------
  function currentRect() {
    const settings = state.settings;
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    const w = clamp(settings.width, 220, Math.max(240, vw - 8));
    const h = clamp(settings.height, 140, Math.max(160, vh - 8));
    let x = typeof settings.x === "number" ? settings.x : vw - w - 28;
    let y = typeof settings.y === "number" ? settings.y : 64;
    x = clamp(x, 4, Math.max(4, vw - 60));
    y = clamp(y, 4, Math.max(4, vh - 40));
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  function positionDot(rect) {
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    const r = rect || currentRect();
    const left = clamp(r.x, 4, Math.max(4, vw - 34));
    const top = clamp(r.y, 4, Math.max(4, vh - 34));
    dotEl.style.left = left + "px";
    dotEl.style.top = top + "px";
  }

  function applyPosition() {
    const rect = currentRect();
    winEl.style.left = rect.x + "px";
    winEl.style.top = rect.y + "px";
    winEl.style.width = rect.w + "px";
    winEl.style.height = rect.h + "px";
    positionDot(rect);
  }

  function setWinPos(x, y) {
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    state.settings.x = Math.round(clamp(x, 4, Math.max(4, vw - 60)));
    state.settings.y = Math.round(clamp(y, 4, Math.max(4, vh - 40)));
    applyPosition();
  }
  function setWinSize(w, h) {
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    state.settings.width = Math.round(clamp(w, 220, Math.max(240, vw - 8)));
    state.settings.height = Math.round(clamp(h, 140, Math.max(160, vh - 8)));
    applyPosition();
  }

  // ---------------- 阅读窗口：外观应用 ----------------
  function applyAll() {
    const settings = state.settings;
    const colors = resolveTheme();
    if (colors) {
      winEl.style.setProperty("--snr-bg", colors.bg);
      winEl.style.setProperty("--snr-text", colors.text);
      winEl.style.setProperty("--snr-sub", colors.sub);
      winEl.style.setProperty("--snr-border", colors.border);
      winEl.style.setProperty("--snr-accent", colors.accent);
    } else {
      // 跟随应用主题（auto）：移除内联覆盖，让 CSS 默认值取宿主主题 token
      winEl.style.removeProperty("--snr-bg");
      winEl.style.removeProperty("--snr-text");
      winEl.style.removeProperty("--snr-sub");
      winEl.style.removeProperty("--snr-border");
      winEl.style.removeProperty("--snr-accent");
    }
    winEl.style.setProperty("--snr-opacity", String(clamp(settings.opacity, 0.05, 1)));
    winEl.style.setProperty("--snr-sleep-opacity", String(clamp(settings.sleepOpacity, 0.01, 1)));
    winEl.style.setProperty("--snr-font", FONT_STACKS[settings.font] || FONT_STACKS.default);
    // 先确定窗口尺寸（决定阅读区高度），再按视口高度取整齐行高
    applyPosition();
    // 行高随字号 / 视口变化，旧像素值不再对应同一行：先按旧行高记录阅读行，重算后按新行高回位
    const keepLine = runtime.lineHeightPx > 0 ? bodyEl.scrollTop / runtime.lineHeightPx : 0;
    contentEl.style.fontSize = settings.fontSize + "px";
    applyLineMetrics(true);
    if (keepLine > 0) bodyEl.scrollTop = Math.round(keepLine) * lineHeightPx();
    contentEl.classList.toggle("indent", !!settings.indent);
    autoBtn.innerHTML = svgIcon(settings.autoScroll ? "pause" : "play", 14);
    autoBtn.classList.toggle("active", !!settings.autoScroll);
    syncSleepClasses();
  }

  // ---------------- 阅读窗口：休眠与显示 ----------------
  function winVisible() {
    return state.settings.winVisible && winEl.style.display !== "none";
  }
  function syncSleepClasses() {
    const mode = state.settings.sleepMode;
    const sleeping = runtime.sleeping && winVisible();
    winEl.classList.toggle("is-sleeping", sleeping);
    winEl.classList.toggle("mode-fade", mode === "fade");
    winEl.classList.toggle("mode-hide", mode === "hide");
    dotEl.hidden = !(sleeping && mode === "hide");
  }
  function wake() {
    if (timers.sleep) {
      clearTimeout(timers.sleep);
      timers.sleep = 0;
    }
    if (runtime.sleeping) {
      runtime.sleeping = false;
      syncSleepClasses();
    }
  }
  function scheduleSleep() {
    if (timers.sleep) {
      clearTimeout(timers.sleep);
      timers.sleep = 0;
    }
    if (state.settings.sleepMode === "always") return;
    if (runtime.dragging || runtime.hover) return;
    if (!winVisible()) return;
    const delay = clamp(state.settings.sleepDelay, 0, 10000);
    timers.sleep = setTimeout(() => {
      timers.sleep = 0;
      if (runtime.hover || runtime.dragging || !winVisible()) return;
      runtime.sleeping = true;
      syncSleepClasses();
    }, delay);
  }
  function showWindow() {
    state.settings.winVisible = true;
    winEl.style.display = "flex";
    runtime.sleeping = false;
    applyPosition();
    applyLineMetrics(true);
    // 隐藏期间渲染的段落此时才拿到布局盒，按待落位行重新定位并写回进度；
    // 隐藏期间视口高度可能变化导致行高改变，落位前收敛到可滚动上限，避免被浏览器截断到段尾
    if (runtime.pendingLine >= 0) {
      bodyEl.scrollTop = clamp(runtime.pendingLine * lineHeightPx(), 0, gridMaxScrollTop());
      runtime.pendingLine = -1;
      updateProgressUI();
    }
    syncSleepClasses();
    if (runtime.hover) wake();
    else scheduleSleep();
    saveStateSoon();
    refreshPanel();
  }
  function hideWindow(silent) {
    // display:none 会让滚动容器丢失布局盒并把滚动位置归零，隐藏前把当前阅读行记入
    // pendingLine，由 showWindow 统一落位，与「隐藏期间重新渲染」共用同一恢复路径。
    // 仅在窗口确实可见时记录：boot 以隐藏状态启动时，openBook 已按存档进度写入有效
    // pendingLine，此时 scrollTop 读回为 0，若照写会覆盖成 0 并丢掉该恢复点。
    if (runtime.current && winVisible()) runtime.pendingLine = Math.round(bodyEl.scrollTop / lineHeightPx());
    state.settings.winVisible = false;
    winEl.style.display = "none";
    runtime.sleeping = false;
    dotEl.hidden = true;
    if (!silent) {
      saveStateNow();
      refreshPanel();
    }
  }

  // ---------------- 阅读窗口：内容渲染 ----------------
  function blockDisplayTitle(index) {
    const cur = runtime.current;
    if (!cur) return "";
    const block = cur.blocks[index];
    if (!block) return "";
    if (block.title) return block.title;
    if (cur.blocks.length <= 1) return "";
    return tr("seg.fallback", { n: index + 1 });
  }

  function renderEmpty(message) {
    contentEl.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "snr-empty";
    empty.textContent = message || (runtime.current ? tr("empty.book") : tr("empty.reader"));
    contentEl.appendChild(empty);
    runtime.lineOffsets = [];
    runtime.pendingLine = -1;
    progressEl.style.width = "0%";
    percentEl.textContent = "";
    updateHeader();
  }

  function updateHeader() {
    const cur = runtime.current;
    if (!cur) {
      titleEl.textContent = tr("empty.reader");
      return;
    }
    const seg = blockDisplayTitle(runtime.segIndex);
    titleEl.textContent = seg ? cur.name + "  ·  " + seg : cur.name;
  }

  function renderSegment(index, anchorOffset) {
    const cur = runtime.current;
    if (!cur) {
      renderEmpty();
      return;
    }
    const target = clamp(index, 0, cur.blocks.length - 1);
    runtime.segIndex = target;
    const block = cur.blocks[target];
    const segText = cur.text.slice(block.start, block.end);
    const lines = segText.split("\n");
    const fragment = document.createDocumentFragment();
    const offsets = new Array(lines.length);
    let acc = 0;
    let prevEmpty = true;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      offsets[i] = acc;
      acc += line.length + 1;
      const div = document.createElement("div");
      div.className = "snr-line";
      if (line.length === 0) {
        div.classList.add("snr-line-empty");
      } else if (state.settings.indent && prevEmpty) {
        div.classList.add("snr-indent");
      }
      div.textContent = line;
      fragment.appendChild(div);
      prevEmpty = line.trim().length === 0;
    }
    contentEl.replaceChildren(fragment);
    runtime.lineOffsets = offsets;
    runtime.segStart = block.start;
    let lineIndex = 0;
    if (typeof anchorOffset === "number" && anchorOffset > block.start && offsets.length > 0) {
      const local = clamp(anchorOffset - block.start, 0, Math.max(0, segText.length));
      lineIndex = Math.max(0, upperBound(offsets, local) - 1);
    }
    // 触发布局后定位
    void contentEl.offsetHeight;
    bodyEl.scrollTop = lineIndex * lineHeightPx();
    bodyEl.scrollLeft = 0;
    // 窗口隐藏（display: none）时元素不生成布局盒，scrollTop 赋值无效且读回恒为 0，
    // 记下目标行待窗口可见后由 showWindow 落位，避免进度被反算成段落开头。
    runtime.pendingLine = winVisible() ? -1 : lineIndex;
    updateHeader();
    updateProgressUI();
  }

  function currentOffset() {
    const cur = runtime.current;
    if (!cur || !runtime.lineOffsets || runtime.lineOffsets.length === 0) return 0;
    const lh = lineHeightPx();
    const idx = clamp(Math.round(bodyEl.scrollTop / lh), 0, runtime.lineOffsets.length - 1);
    return runtime.segStart + runtime.lineOffsets[idx];
  }

  function persistProgress() {
    const cur = runtime.current;
    const meta = state.books.find((b) => b.id === state.currentBookId);
    if (!cur || !meta) return;
    // 窗口未生成布局盒时 scrollTop 恒为 0，据此反算会污染已保存进度。
    // 隐藏期的进度变化已由 renderSegment 记入 runtime.pendingLine，并由 showWindow 落位后统一落盘；
    // 调用方不得绕过 renderSegment 直接改写 meta.progress，也不要依赖本函数在隐藏期落盘。
    if (!winVisible()) return;
    const offset = currentOffset();
    const total = cur.text.length || 1;
    const percent = Math.round((offset / total) * 1000) / 10;
    if (!meta.progress) meta.progress = { offset: 0, percent: 0 };
    meta.progress.offset = offset;
    meta.progress.percent = percent;
    saveStateSoon();
  }

  function updateProgressUI() {
    const cur = runtime.current;
    const total = cur ? cur.text.length || 1 : 1;
    const percent = cur ? clamp(currentOffset() / total, 0, 1) : 0;
    progressEl.style.width = (percent * 100).toFixed(2) + "%";
    percentEl.textContent = Math.round(percent * 100) + "%";
    if (cur) persistProgress();
    updatePanelHeadSub();
  }

  let scrollRafPending = false;
  let snapAnimRaf = 0;
  let snapAnimating = false;
  let lastWheelStepAt = 0;
  let segmentAnchorTop = 0;
  let segmentAnchorUntil = 0;
  let segmentAnchorRaf = 0;
  function onBodyScroll() {
    if (scrollRafPending) return;
    scrollRafPending = true;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    raf(() => {
      scrollRafPending = false;
      if (disposed) return;
      updateProgressUI();
      // 吸附动画自身的滚动不再重复调度，避免互相打断
      if (!snapAnimating) scheduleScrollSnap();
    });
  }

  function cancelSnapAnim() {
    if (snapAnimRaf) {
      cancelAnimationFrame(snapAnimRaf);
      snapAnimRaf = 0;
    }
    snapAnimating = false;
  }

  // ---------------- 翻段视口锁定 ----------------
  // 翻段时内容被整体替换，浏览器可能在随后的布局中自动调整滚动位置
  // （滚动锚定 / 异步尺寸校正），表现为「新段开头又出现上一段末尾的文字」。
  // 这里在翻段后短暂把视口锁回段首，任何用户滚动输入都会立即释放。
  function lockSegmentAnchor() {
    cancelSnapAnim();
    // 清除已排队但未触发的吸附，避免与锁定期的逐帧回写互相打架
    if (timers.snap) clearTimeout(timers.snap);
    timers.snap = 0;
    const lh = lineHeightPx();
    segmentAnchorTop = Math.round(bodyEl.scrollTop / lh) * lh;
    segmentAnchorUntil = Date.now() + 400;
    if (!segmentAnchorRaf && typeof requestAnimationFrame === "function") {
      segmentAnchorRaf = requestAnimationFrame(enforceSegmentAnchor);
    }
  }
  function cancelSegmentAnchor() {
    segmentAnchorUntil = 0;
    if (segmentAnchorRaf) {
      cancelAnimationFrame(segmentAnchorRaf);
      segmentAnchorRaf = 0;
    }
  }
  function enforceSegmentAnchor() {
    segmentAnchorRaf = 0;
    if (disposed || !segmentAnchorUntil || Date.now() > segmentAnchorUntil) {
      const ended = !disposed && !!segmentAnchorUntil;
      segmentAnchorUntil = 0;
      // 锁定结束时对齐一次，避免停在非行边界位置
      if (ended) snapScrollToGrid();
      return;
    }
    const target = clamp(segmentAnchorTop, 0, gridMaxScrollTop());
    if (Math.abs(bodyEl.scrollTop - target) > 1) bodyEl.scrollTop = target;
    segmentAnchorRaf = requestAnimationFrame(enforceSegmentAnchor);
  }
  // 平滑滑到目标位置：吸附是「滑一下」而不是「跳一下」，避免视觉抖动
  function animateScrollTo(target) {
    cancelSnapAnim();
    const start = bodyEl.scrollTop;
    const delta = target - start;
    if (Math.abs(delta) < 0.5) return;
    if (typeof requestAnimationFrame !== "function") {
      bodyEl.scrollTop = target;
      return;
    }
    const t0 = performance.now();
    snapAnimating = true;
    const step = (now) => {
      const progress = Math.min(1, (now - t0) / 130);
      const eased = 1 - Math.pow(1 - progress, 3);
      bodyEl.scrollTop = start + delta * eased;
      if (progress < 1) {
        snapAnimRaf = requestAnimationFrame(step);
      } else {
        snapAnimRaf = 0;
        snapAnimating = false;
      }
    };
    snapAnimRaf = requestAnimationFrame(step);
  }
  // 滚动（触控板 / 滚动条）停止后把位置滑回行边界，避免顶行或底行只剩半截
  function snapScrollToGrid() {
    if (!runtime.current || state.settings.autoScroll) return;
    // 翻段锁定期间由 enforceSegmentAnchor 独占滚动位置
    if (segmentAnchorUntil && Date.now() <= segmentAnchorUntil) return;
    const lh = lineHeightPx();
    const max = Math.max(0, bodyEl.scrollHeight - bodyEl.clientHeight);
    const alignedMax = Math.floor(max / lh) * lh;
    const target = clamp(Math.round(bodyEl.scrollTop / lh) * lh, 0, alignedMax);
    animateScrollTo(target);
  }
  function scheduleScrollSnap() {
    if (state.settings.autoScroll) return;
    // 翻段锁定期间不安排吸附，锁定结束由 enforceSegmentAnchor 收尾对齐
    if (segmentAnchorUntil && Date.now() <= segmentAnchorUntil) return;
    if (timers.snap) clearTimeout(timers.snap);
    timers.snap = setTimeout(() => {
      timers.snap = 0;
      snapScrollToGrid();
    }, 180);
  }

  // 每屏可见行数：视口高度已取整行，按整屏步进既无重复也无遗漏
  function pageStepLines() {
    const lh = lineHeightPx();
    return Math.max(1, Math.round(bodyEl.clientHeight / lh));
  }
  function pageDown() {
    if (!runtime.current) return;
    cancelSegmentAnchor();
    wake();
    const lh = lineHeightPx();
    const max = Math.max(0, bodyEl.scrollHeight - bodyEl.clientHeight);
    const bottom = Math.round(bodyEl.scrollTop / lh) * lh;
    if (max - bottom < lh / 2) {
      nextSegment();
      return;
    }
    const alignedMax = Math.floor(max / lh) * lh;
    bodyEl.scrollTop = Math.min(bottom + pageStepLines() * lh, alignedMax);
  }
  function pageUp() {
    if (!runtime.current) return;
    cancelSegmentAnchor();
    wake();
    const lh = lineHeightPx();
    const top = Math.round(bodyEl.scrollTop / lh) * lh;
    if (top <= lh / 2) {
      prevSegment();
      return;
    }
    bodyEl.scrollTop = Math.max(0, top - pageStepLines() * lh);
  }
  function nextSegment() {
    const cur = runtime.current;
    if (!cur || runtime.segIndex >= cur.blocks.length - 1) return;
    const next = runtime.segIndex + 1;
    renderSegment(next, cur.blocks[next].start);
    lockSegmentAnchor();
    wake();
  }
  function prevSegment() {
    const cur = runtime.current;
    if (!cur || runtime.segIndex <= 0) return;
    const prev = runtime.segIndex - 1;
    renderSegment(prev, cur.blocks[prev].start);
    lockSegmentAnchor();
    wake();
  }

  // ---------------- 自动滚动 ----------------
  function setAutoScroll(on) {
    state.settings.autoScroll = !!on;
    if (on) startAutoScroll();
    else {
      stopAutoScroll();
      // 停止自动滚动后对齐一次，避免停在半行
      snapScrollToGrid();
    }
    autoBtn.innerHTML = svgIcon(on ? "pause" : "play", 14);
    autoBtn.classList.toggle("active", !!on);
    saveStateSoon();
    syncControls();
  }
  function startAutoScroll() {
    stopAutoScroll();
    if (typeof requestAnimationFrame !== "function") return;
    let last = 0;
    const step = (ts) => {
      if (disposed || !state.settings.autoScroll) {
        timers.autoRaf = 0;
        return;
      }
      // 窗口隐藏（display: none）时滚动容器不生成布局盒，scrollHeight 与 clientHeight 均为 0，
      // 「已到底」判定会每帧成立，导致逐段推进到末段并静默关闭开关；
      // 隐藏期只续排下一帧，保留开关状态与计时基准，窗口恢复后继续推进。
      if (!winVisible()) {
        last = 0;
        timers.autoRaf = requestAnimationFrame(step);
        return;
      }
      if (!last) last = ts;
      const dt = Math.min(80, ts - last);
      last = ts;
      const speed = clamp(state.settings.autoScrollSpeed, 5, 400);
      bodyEl.scrollTop += (speed * dt) / 1000;
      const max = bodyEl.scrollHeight - bodyEl.clientHeight;
      if (bodyEl.scrollTop >= max - 0.5) {
        const cur = runtime.current;
        if (cur && runtime.segIndex < cur.blocks.length - 1) {
          const next = runtime.segIndex + 1;
          renderSegment(next, cur.blocks[next].start);
          last = 0;
        } else {
          setAutoScroll(false);
          return;
        }
      }
      timers.autoRaf = requestAnimationFrame(step);
    };
    timers.autoRaf = requestAnimationFrame(step);
  }
  function stopAutoScroll() {
    if (timers.autoRaf) {
      cancelAnimationFrame(timers.autoRaf);
      timers.autoRaf = 0;
    }
  }

  function jumpToChapter(index) {
    if (!runtime.current) return;
    const cur = runtime.current;
    const target = clamp(index, 0, cur.blocks.length - 1);
    renderSegment(target, cur.blocks[target].start);
    showWindow();
    renderView();
  }

  // ---------------- 打开书籍 ----------------
  async function openBook(bookId, anchorOffset) {
    if (disposed || !bookId) return;
    const meta = state.books.find((b) => b.id === bookId);
    if (!meta) return;
    const token = ++openToken;
    if (!runtime.current || runtime.current.id !== bookId) {
      // 换书时重置目录搜索词，避免沿用上一本书的关键字
      chapterQuery = "";
      setStatus(tr("status.loadingBook"));
      const text = await textStore.get(bookId);
      if (disposed || token !== openToken) return;
      if (typeof text !== "string" || text.length === 0) {
        setStatus(tr("empty.book"));
        return;
      }
      runtime.current = {
        id: bookId,
        name: meta.name,
        text: text,
        blocks: buildBlocks(text)
      };
    }
    state.currentBookId = bookId;
    meta.lastOpenedAt = Date.now();
    const offset =
      typeof anchorOffset === "number"
        ? anchorOffset
        : meta.progress && typeof meta.progress.offset === "number"
          ? meta.progress.offset
          : 0;
    const index = findBlockIndex(runtime.current.blocks, offset);
    renderSegment(index, offset);
    saveStateSoon();
    refreshPanel();
  }

  async function removeBook(bookId) {
    armedBookId = null;
    // 作废在途打开请求，避免被删除的书在读取完成后又被打开
    openToken += 1;
    const meta = state.books.find((b) => b.id === bookId);
    if (!meta) return;
    await textStore.remove(bookId);
    state.books = state.books.filter((b) => b.id !== bookId);
    if (state.currentBookId === bookId) {
      state.currentBookId = null;
      runtime.current = null;
      renderEmpty();
    }
    saveStateNow();
    refreshPanel();
  }

  async function clearAllData() {
    // 作废在途打开请求，避免清空后又被旧读取结果填回
    openToken += 1;
    await textStore.clear();
    state.books = [];
    state.currentBookId = null;
    runtime.current = null;
    runtime.lineOffsets = [];
    saveStateNow();
    renderEmpty();
    setStatus(tr("status.cleared"));
    refreshPanel();
  }

  // ---------------- 导入 ----------------
  async function importFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setStatus(tr("status.importing"));
    let lastId = null;
    let imported = 0;
    for (const file of files) {
      try {
        const buffer = await file.arrayBuffer();
        const text = normalizeText(decodeBuffer(buffer));
        if (!text.trim()) continue;
        const id = "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const ok = await textStore.put(id, text);
        if (!ok) throw new Error("storage unavailable");
        state.books.unshift({
          id: id,
          name: String(file.name || "").replace(/\.[^.]+$/, "") || String(file.name || id),
          size: file.size || 0,
          addedAt: Date.now(),
          lastOpenedAt: Date.now(),
          progress: { offset: 0, percent: 0 }
        });
        lastId = id;
        imported += 1;
      } catch (err) {
        log("import failed", err);
        setStatus(tr("status.importFailed", { error: (err && err.message) || String(err) }));
      }
    }
    saveStateNow();
    if (lastId) {
      setStatus(tr("status.imported", { count: imported }));
      await openBook(lastId);
      showWindow();
    }
    refreshPanel();
  }

  // ---------------- 状态提示 ----------------
  function setStatus(text) {
    statusEl.textContent = text || "";
    if (statusTimer) clearTimeout(statusTimer);
    if (text) {
      statusTimer = setTimeout(() => {
        statusTimer = 0;
        statusEl.textContent = "";
      }, 4200);
    }
  }

  // ---------------- 面板：控件工厂 ----------------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function rowLabel(text) {
    return el("div", "nr-row-label", text);
  }
  function makeRow(label, controls) {
    const row = el("div", "nr-row");
    row.appendChild(rowLabel(label));
    const ctl = el("div", "nr-row-ctl");
    for (const node of controls) ctl.appendChild(node);
    row.appendChild(ctl);
    return row;
  }
  function makeSlider(label, options) {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "nr-range";
    input.min = String(options.min);
    input.max = String(options.max);
    input.step = String(options.step);
    // 出生即同步当前值：否则首次交互触发 syncControls 时手柄跳变（表现为“抖一下”）
    // lastWritten 记录本控件上次写入 input.value 的字符串，避免「写入后浏览器按 min/max/step 量化、读回不等、再次写入」的无效循环
    let lastWritten = String(options.get());
    input.value = lastWritten;
    const format = options.format || ((v) => String(v));
    const val = el("div", "nr-val", format(options.get()));
    input.addEventListener("input", () => {
      const value = Number(input.value);
      lastWritten = input.value;
      val.textContent = format(value);
      options.onChange(value);
    });
    registerControl(() => {
      const current = options.get();
      const next = String(current);
      if (lastWritten !== next) {
        input.value = next;
        lastWritten = next;
      }
      val.textContent = format(current);
    });
    return makeRow(label, [input, val]);
  }
  function makeNumber(label, options) {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "nr-input";
    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    if (options.step !== undefined) input.step = String(options.step);
    input.value = String(options.get());
    const commit = () => {
      const value = clamp(Number(input.value), options.min !== undefined ? options.min : -1e9, options.max !== undefined ? options.max : 1e9);
      options.onChange(value);
    };
    input.addEventListener("change", commit);
    registerControl(() => {
      const current = options.get();
      if (document.activeElement !== input && Number(input.value) !== current) input.value = String(current);
    });
    return makeRow(label, [input]);
  }
  function makeSelect(label, options, get, onChange) {
    const select = document.createElement("select");
    select.className = "nr-select";
    for (const item of options) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    }
    select.value = get();
    select.addEventListener("change", () => onChange(select.value));
    registerControl(() => {
      const current = get();
      if (select.value !== String(current)) select.value = String(current);
    });
    return makeRow(label, [select]);
  }
  function makeSeg(label, options, get, onChange) {
    const wrap = el("div", "nr-seg");
    const buttons = [];
    for (const item of options) {
      const button = el("button", "", item.label);
      button.type = "button";
      button.dataset.value = item.value;
      button.addEventListener("click", () => onChange(item.value));
      wrap.appendChild(button);
      buttons.push(button);
    }
    const sync = () => {
      const current = String(get());
      for (const button of buttons) button.classList.toggle("active", button.dataset.value === current);
    };
    sync();
    registerControl(sync);
    return makeRow(label, [wrap]);
  }
  function makeCheck(label, get, onChange) {
    const wrap = el("label", "nr-check");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!get();
    input.addEventListener("change", () => onChange(!!input.checked));
    wrap.appendChild(input);
    wrap.appendChild(el("span", "", label));
    registerControl(() => {
      if (input.checked !== !!get()) input.checked = !!get();
    });
    const row = el("div", "nr-row");
    row.appendChild(el("div", "nr-row-label", ""));
    const ctl = el("div", "nr-row-ctl");
    ctl.appendChild(wrap);
    row.appendChild(ctl);
    return row;
  }
  function makeKeyBindingRow(action) {
    const row = el("div", "nr-row");
    row.appendChild(rowLabel(tr(action.labelKey)));
    const ctl = el("div", "nr-row-ctl");
    const button = el("button", "nr-keybtn");
    button.type = "button";
    button.dataset.action = action.id;
    button.addEventListener("click", (e) => {
      // 忽略键盘激活（Enter / Space）产生的 click，避免录制完成后的按键再次进入录制
      if (e.detail === 0) return;
      recordingKey = recordingKey === action.id ? null : action.id;
      syncControls();
    });
    const sync = () => {
      const list = state.settings.keyBindings && Array.isArray(state.settings.keyBindings[action.id]) ? state.settings.keyBindings[action.id] : [];
      const recording = recordingKey === action.id;
      button.classList.toggle("recording", recording);
      button.textContent = recording ? tr("keys.record") : list.length ? list.map(formatKeyId).join(" / ") : tr("keys.empty");
    };
    sync();
    registerControl(sync);
    ctl.appendChild(button);
    row.appendChild(ctl);
    return row;
  }

  // ---------------- 面板：视图 ----------------
  function renderBooksView() {
    const wrap = document.createDocumentFragment();
    if (!state.books.length) {
      wrap.appendChild(el("div", "nr-empty", tr("empty.books")));
      return wrap;
    }
    wrap.appendChild(el("div", "nr-hint", tr("books.count", { count: state.books.length })));
    const list = el("div", "nr-list");
    for (const book of state.books) {
      const isCurrent = book.id === state.currentBookId;
      const item = el("div", "nr-item" + (isCurrent ? " active" : ""));
      item.dataset.act = "openBook";
      item.dataset.bookId = book.id;
      const main = el("div", "nr-item-main");
      main.appendChild(el("div", "nr-item-name", book.name));
      const percent = book.progress && typeof book.progress.percent === "number" ? Math.round(book.progress.percent) : 0;
      const subtitle = armedBookId === book.id
        ? tr("settings.deleteConfirm")
        : tr("books.progress", { percent: percent }) + "  ·  " + formatSize(book.size);
      main.appendChild(el("div", "nr-item-sub", subtitle));
      item.appendChild(main);
      if (isCurrent) item.appendChild(el("div", "nr-item-badge", tr("chapter.current")));
      const del = el("button", "nr-icon-btn danger" + (armedBookId === book.id ? " active" : ""));
      del.type = "button";
      del.dataset.act = "delBook";
      del.dataset.bookId = book.id;
      del.title = tr("action.delete");
      del.innerHTML = svgIcon("trash", 14);
      item.appendChild(del);
      list.appendChild(item);
    }
    wrap.appendChild(list);
    return wrap;
  }

  function renderChaptersView() {
    const wrap = document.createDocumentFragment();
    const cur = runtime.current;
    if (!cur) {
      wrap.appendChild(el("div", "nr-empty", tr("empty.reader")));
      return wrap;
    }
    const hasChapters = cur.blocks.some((b) => !!b.title);
    if (!hasChapters) wrap.appendChild(el("div", "nr-hint", tr("empty.chapters")));

    // 章节搜索：按标题过滤；输入时只重建列表，输入框保持焦点
    const searchBox = el("div", "nr-search");
    const searchInput = document.createElement("input");
    searchInput.className = "nr-input";
    searchInput.type = "text";
    searchInput.placeholder = tr("search.placeholder");
    searchInput.value = chapterQuery;
    searchBox.appendChild(searchInput);
    wrap.appendChild(searchBox);

    const list = el("div", "nr-list");
    const rebuildList = () => {
      list.replaceChildren();
      const query = chapterQuery.trim().toLowerCase();
      let shown = 0;
      for (let i = 0; i < cur.blocks.length; i += 1) {
        const title = blockDisplayTitle(i) || tr("seg.fallback", { n: i + 1 });
        if (query && title.toLowerCase().indexOf(query) === -1) continue;
        shown += 1;
        const item = el("div", "nr-item" + (i === runtime.segIndex ? " active" : ""));
        item.dataset.act = "jumpChapter";
        item.dataset.index = String(i);
        const main = el("div", "nr-item-main");
        main.appendChild(el("div", "nr-item-name", title));
        item.appendChild(main);
        if (i === runtime.segIndex) item.appendChild(el("div", "nr-item-badge", tr("chapter.current")));
        list.appendChild(item);
      }
      if (query && shown === 0) list.appendChild(el("div", "nr-empty", tr("search.empty")));
    };
    rebuildList();
    searchInput.addEventListener("input", () => {
      chapterQuery = searchInput.value;
      rebuildList();
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !searchInput.value) return;
      searchInput.value = "";
      chapterQuery = "";
      rebuildList();
      e.stopPropagation();
    });
    wrap.appendChild(list);
    return wrap;
  }

  function renderSettingsView() {
    const wrap = document.createDocumentFragment();
    const settings = state.settings;

    // 窗口
    const winSec = el("div", "nr-sec");
    winSec.appendChild(el("div", "nr-sec-title", tr("settings.window")));
    winSec.appendChild(
      makeSlider(tr("settings.opacity"), {
        min: 5,
        max: 100,
        step: 1,
        get: () => Math.round(settings.opacity * 100),
        format: (v) => v + "%",
        onChange: (v) => updateSettings({ opacity: v / 100 })
      })
    );
    winSec.appendChild(
      makeSeg(
        tr("settings.sleepOnLeave"),
        [
          { value: "always", label: tr("settings.sleep.always") },
          { value: "fade", label: tr("settings.sleep.fade") },
          { value: "hide", label: tr("settings.sleep.hide") }
        ],
        () => settings.sleepMode,
        (v) => updateSettings({ sleepMode: v })
      )
    );
    winSec.appendChild(
      makeSlider(tr("settings.sleepOpacity"), {
        min: 1,
        max: 100,
        step: 1,
        get: () => Math.round(settings.sleepOpacity * 100),
        format: (v) => v + "%",
        onChange: (v) => updateSettings({ sleepOpacity: v / 100 })
      })
    );
    winSec.appendChild(
      makeSlider(tr("settings.sleepDelay"), {
        min: SETTINGS_SPEC.sleepDelay.min,
        max: SETTINGS_SPEC.sleepDelay.max,
        step: 100,
        get: () => settings.sleepDelay,
        format: (v) => v + " ms",
        onChange: (v) => updateSettings({ sleepDelay: v })
      })
    );
    winSec.appendChild(
      makeSlider(tr("settings.width"), {
        min: 220,
        max: 1400,
        step: 10,
        get: () => Math.round(settings.width),
        format: (v) => v + " px",
        onChange: (v) => updateSettings({ width: v })
      })
    );
    winSec.appendChild(
      makeSlider(tr("settings.height"), {
        min: 140,
        max: 1200,
        step: 10,
        get: () => Math.round(settings.height),
        format: (v) => v + " px",
        onChange: (v) => updateSettings({ height: v })
      })
    );
    winSec.appendChild(el("div", "nr-hint", tr("win.hint")));
    wrap.appendChild(winSec);

    // 外观
    const lookSec = el("div", "nr-sec");
    lookSec.appendChild(el("div", "nr-sec-title", tr("settings.appearance")));
    lookSec.appendChild(
      makeSelect(
        tr("settings.theme"),
        [
          { value: "auto", label: tr("settings.theme.auto") },
          { value: "light", label: tr("settings.theme.light") },
          { value: "dark", label: tr("settings.theme.dark") },
          { value: "sepia", label: tr("settings.theme.sepia") },
          { value: "green", label: tr("settings.theme.green") }
        ],
        () => settings.theme,
        (v) => updateSettings({ theme: v })
      )
    );
    lookSec.appendChild(
      makeSlider(tr("settings.fontSize"), {
        min: 11,
        max: 36,
        step: 1,
        get: () => settings.fontSize,
        format: (v) => v + " px",
        onChange: (v) => updateSettings({ fontSize: v })
      })
    );
    lookSec.appendChild(
      makeSlider(tr("settings.lineHeight"), {
        min: 12,
        max: 30,
        step: 1,
        get: () => Math.round(settings.lineHeight * 10),
        format: (v) => (v / 10).toFixed(1),
        onChange: (v) => updateSettings({ lineHeight: v / 10 })
      })
    );
    lookSec.appendChild(
      makeSelect(
        tr("settings.font"),
        [
          { value: "default", label: tr("settings.font.default") },
          { value: "serif", label: tr("settings.font.serif") },
          { value: "yahei", label: tr("settings.font.yahei") },
          { value: "kai", label: tr("settings.font.kai") },
          { value: "mono", label: tr("settings.font.mono") }
        ],
        () => settings.font,
        (v) => updateSettings({ font: v })
      )
    );
    lookSec.appendChild(makeCheck(tr("settings.indent"), () => settings.indent, (v) => updateSettings({ indent: v })));
    wrap.appendChild(lookSec);

    return wrap;
  }

  function renderKeysView() {
    const wrap = document.createDocumentFragment();
    const settings = state.settings;
    const actSec = el("div", "nr-sec");
    actSec.appendChild(el("div", "nr-sec-title", tr("settings.interaction")));
    actSec.appendChild(
      makeSeg(
        tr("settings.hotkeys"),
        [
          { value: "hover", label: tr("settings.hotkeys.hover") },
          { value: "global", label: tr("settings.hotkeys.global") },
          { value: "off", label: tr("settings.hotkeys.off") }
        ],
        () => settings.hotkeys,
        (v) => updateSettings({ hotkeys: v })
      )
    );
    actSec.appendChild(makeCheck(tr("settings.wheel"), () => settings.wheelPaging, (v) => updateSettings({ wheelPaging: v })));
    actSec.appendChild(makeCheck(tr("settings.autoScroll"), () => settings.autoScroll, (v) => setAutoScroll(v)));
    actSec.appendChild(
      makeSlider(tr("settings.autoSpeed"), {
        min: SETTINGS_SPEC.autoScrollSpeed.min,
        max: SETTINGS_SPEC.autoScrollSpeed.max,
        step: 5,
        get: () => settings.autoScrollSpeed,
        format: (v) => v + " px/s",
        onChange: (v) => updateSettings({ autoScrollSpeed: v })
      })
    );
    actSec.appendChild(el("div", "nr-hint", tr("settings.tipKeys")));
    actSec.appendChild(el("div", "nr-hint", tr("settings.tipAltWheel")));
    wrap.appendChild(actSec);

    // 按键绑定：逐个动作录制键位，不与上方生效范围耦合
    const keySec = el("div", "nr-sec");
    keySec.appendChild(el("div", "nr-sec-title", tr("keys.bindings")));
    for (const action of KEY_ACTIONS) keySec.appendChild(makeKeyBindingRow(action));
    const resetBtn = el("button", "nr-btn", tr("keys.reset"));
    resetBtn.type = "button";
    resetBtn.addEventListener("click", () => {
      recordingKey = null;
      state.settings.keyBindings = cloneKeyBindings(DEFAULT_KEY_BINDINGS);
      saveStateSoon();
      syncControls();
      setStatus(tr("keys.resetDone"));
    });
    const resetRow = el("div", "nr-row");
    resetRow.appendChild(el("div", "nr-row-label", ""));
    const resetCtl = el("div", "nr-row-ctl");
    resetCtl.appendChild(resetBtn);
    resetRow.appendChild(resetCtl);
    keySec.appendChild(resetRow);
    keySec.appendChild(el("div", "nr-hint", tr("keys.hint")));
    wrap.appendChild(keySec);
    return wrap;
  }

  function renderDataView() {
    const wrap = document.createDocumentFragment();
    const dataSec = el("div", "nr-sec");
    dataSec.appendChild(el("div", "nr-sec-title", tr("settings.data")));

    // 数据概览：让「清空全部数据」作用的对象可见
    const totalSize = state.books.reduce((sum, book) => sum + (Number(book.size) || 0), 0);
    dataSec.appendChild(makeRow(tr("data.books"), [el("div", "nr-data-value", tr("books.count", { count: state.books.length }))]));
    dataSec.appendChild(makeRow(tr("data.size"), [el("div", "nr-data-value", formatSize(totalSize))]));
    const currentMeta = state.books.find((b) => b.id === state.currentBookId);
    let currentText = tr("empty.reader");
    if (currentMeta) {
      const percent = currentMeta.progress && typeof currentMeta.progress.percent === "number" ? Math.round(currentMeta.progress.percent) : 0;
      currentText = currentMeta.name + "  ·  " + tr("books.progress", { percent: percent });
    }
    const currentValue = el("div", "nr-data-value", currentText);
    currentValue.title = currentText;
    dataSec.appendChild(makeRow(tr("data.current"), [currentValue]));
    dataSec.appendChild(el("div", "nr-hint", tr("data.storage")));
    wrap.appendChild(dataSec);

    // 清空按钮：危险操作置底，二次点击确认
    const clearBtn = el("button", "nr-btn danger", tr("settings.clearAll"));
    clearBtn.type = "button";
    clearBtn.dataset.act = "clearAll";
    if (armedBookId === "__all__") clearBtn.textContent = tr("action.confirm");
    const dataRow = el("div", "nr-row");
    dataRow.appendChild(el("div", "nr-row-label", ""));
    const dataCtl = el("div", "nr-row-ctl");
    dataCtl.appendChild(clearBtn);
    dataRow.appendChild(dataCtl);
    wrap.appendChild(dataRow);
    return wrap;
  }

  function renderView() {
    // 视图切换是控件登记的唯一生命周期边界：先清空旧闭包，再重建 DOM
    controlUpdaters.length = 0;
    viewEl.replaceChildren();
    // 离开快捷键页时结束录制，避免按键被静默吞掉
    if (panelTab !== "keys") recordingKey = null;
    let content = null;
    if (panelTab === "books") content = renderBooksView();
    else if (panelTab === "chapters") content = renderChaptersView();
    else if (panelTab === "keys") content = renderKeysView();
    else if (panelTab === "data") content = renderDataView();
    else content = renderSettingsView();
    viewEl.appendChild(content);
  }

  function updatePanelHeadSub() {
    const cur = runtime.current;
    if (!cur) {
      headSubEl.textContent = tr("empty.reader");
      return;
    }
    const meta = state.books.find((b) => b.id === state.currentBookId);
    const percent = meta && meta.progress && typeof meta.progress.percent === "number" ? Math.round(meta.progress.percent) : 0;
    headSubEl.textContent = cur.name + "  ·  " + tr("books.progress", { percent: percent });
  }

  function refreshPanel() {
    toggleWinBtn.querySelector("span").textContent = winVisible() ? tr("win.hide") : tr("win.show");
    for (const button of tabButtons) {
      button.classList.toggle("active", button.dataset.tab === panelTab);
      if (!button.dataset.bound) {
        button.dataset.bound = "1";
      }
    }
    updatePanelHeadSub();
    renderView();
  }

  function updateSettings(patch) {
    Object.assign(state.settings, patch);
    applyAll();
    if (Object.prototype.hasOwnProperty.call(patch, "winVisible")) {
      if (patch.winVisible) showWindow();
      else hideWindow(true);
    }
    saveStateSoon();
    syncControls();
  }

  // ---------------- 拖拽与缩放 ----------------
  function installDrag() {
    barEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest("button")) return;
      const rect = winEl.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const originX = rect.left;
      const originY = rect.top;
      runtime.dragging = true;
      wake();
      const onMove = (ev) => {
        setWinPos(originX + ev.clientX - startX, originY + ev.clientY - startY);
      };
      const onUp = () => {
        runtime.dragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        saveStateSoon();
        scheduleSleep();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      e.preventDefault();
    });
    resizeEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const rect = winEl.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const originW = rect.width;
      const originH = rect.height;
      runtime.dragging = true;
      wake();
      const onMove = (ev) => {
        setWinSize(originW + ev.clientX - startX, originH + ev.clientY - startY);
      };
      const onUp = () => {
        runtime.dragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        saveStateSoon();
        scheduleSleep();
        applyLineMetrics(true);
        syncControls();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      e.preventDefault();
    });
  }

  // ---------------- 键盘：可自定义键位 ----------------
  // 动作表：id 对应 settings.keyBindings 中的一个键位数组
  const KEY_ACTIONS = [
    { id: "pageDown", labelKey: "keys.pageDown" },
    { id: "pageUp", labelKey: "keys.pageUp" },
    { id: "nextChapter", labelKey: "keys.nextChapter" },
    { id: "prevChapter", labelKey: "keys.prevChapter" },
    { id: "top", labelKey: "keys.top" },
    { id: "bottom", labelKey: "keys.bottom" }
  ];
  const KEY_FACE_LABELS = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    PageUp: "PgUp",
    PageDown: "PgDn",
    Escape: "Esc",
    Backspace: "Backspace",
    Delete: "Del",
    Insert: "Ins",
    Tab: "Tab",
    Enter: "Enter",
    Home: "Home",
    End: "End"
  };

  function formatKeyId(id) {
    const labels = [];
    for (const part of String(id).split("+")) {
      if (part === "Space") labels.push(tr("keys.space"));
      else if (KEY_FACE_LABELS[part]) labels.push(KEY_FACE_LABELS[part]);
      else if (/^Key[A-Z]$/.test(part)) labels.push(part.slice(3));
      else if (/^Digit[0-9]$/.test(part)) labels.push(part.slice(5));
      else if (/^Numpad/.test(part)) labels.push("Num " + part.slice(6));
      else if (part.indexOf("Char:") === 0) labels.push(part.slice(5));
      else labels.push(part);
    }
    return labels.join(" + ");
  }

  // 载入存储时收敛为已知动作 + 字符串数组，未知项回退默认键位
  function sanitizeKeyBindings(raw) {
    const result = cloneKeyBindings(DEFAULT_KEY_BINDINGS);
    if (!raw || typeof raw !== "object") return result;
    for (const action of KEY_ACTIONS) {
      if (!Object.prototype.hasOwnProperty.call(raw, action.id)) continue;
      const list = raw[action.id];
      if (!Array.isArray(list)) continue;
      result[action.id] = list.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 40).slice(0, 6);
    }
    return result;
  }

  // 载入存储时按 SETTINGS_SPEC 逐键收敛类型与范围，非法值回退默认设置（与 sanitizeKeyBindings 对称）；
  // 收敛规则与默认值同源（规则表 + DEFAULT_SETTINGS），新增设置字段只需登记一次。
  // 双向差集校验：任一侧多出/缺少键都会告警，避免新增字段被静默重置且无迹可查。
  function sanitizeSettings(raw) {
    const result = Object.assign({}, DEFAULT_SETTINGS);
    const defaults = Object.keys(DEFAULT_SETTINGS);
    for (const key of defaults) {
      if (!Object.prototype.hasOwnProperty.call(SETTINGS_SPEC, key)) log("settings spec missing key", key);
    }
    for (const key of Object.keys(SETTINGS_SPEC)) {
      if (defaults.indexOf(key) === -1) log("settings spec unknown key", key);
    }
    // 默认值必须落在收敛区间内，否则载入时会被夹回边界，表现为设置改不动且重启回退；这里只告警不修正
    for (const key of Object.keys(SETTINGS_SPEC)) {
      const spec = SETTINGS_SPEC[key];
      if (spec.kind !== "num") continue;
      const def = DEFAULT_SETTINGS[key];
      if (def < spec.min || def > spec.max) log("settings default out of range", key, def, spec.min, spec.max);
    }
    if (!raw || typeof raw !== "object") return result;
    const num = (value, fallback, min, max) => {
      // 只接受数字与非空数字字符串（隐式转换原本可用），null / 布尔 / 空串 / 对象等一律回退默认
      const isNumeric = typeof value === "number" || (typeof value === "string" && value.trim() !== "");
      const n = isNumeric ? Number(value) : NaN;
      if (!isFinite(n)) return fallback;
      return Math.min(Math.max(n, min), max);
    };
    const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);
    const oneOf = (value, allowed, fallback) => (allowed.indexOf(value) === -1 ? fallback : value);
    for (const key of Object.keys(SETTINGS_SPEC)) {
      const spec = SETTINGS_SPEC[key];
      const fallback = DEFAULT_SETTINGS[key];
      const value = raw[key];
      if (spec.kind === "bool") result[key] = bool(value, fallback);
      else if (spec.kind === "num") result[key] = num(value, fallback, spec.min, spec.max);
      else if (spec.kind === "oneOf") result[key] = oneOf(value, spec.values(), fallback);
      else if (spec.kind === "nullableNum") result[key] = typeof value === "number" && isFinite(value) ? value : null;
    }
    return result;
  }

  function actionForKeyId(keyId) {
    const map = state.settings.keyBindings || {};
    for (const action of KEY_ACTIONS) {
      const list = map[action.id];
      if (Array.isArray(list) && list.indexOf(keyId) !== -1) return action.id;
    }
    return null;
  }

  function runKeyAction(actionId) {
    if (actionId === "pageDown") pageDown();
    else if (actionId === "pageUp") pageUp();
    else if (actionId === "nextChapter") nextSegment();
    else if (actionId === "prevChapter") prevSegment();
    else if (actionId === "top") bodyEl.scrollTop = 0;
    else if (actionId === "bottom") bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  // 写入某动作的键位；重复键位自动从其它动作移除，保证一键只触发一个动作
  function setKeyBinding(actionId, keyIds) {
    const map = state.settings.keyBindings;
    map[actionId] = keyIds.slice();
    let conflictName = "";
    if (keyIds.length) {
      for (const action of KEY_ACTIONS) {
        if (action.id === actionId) continue;
        const list = Array.isArray(map[action.id]) ? map[action.id] : [];
        const kept = list.filter((id) => keyIds.indexOf(id) === -1);
        if (kept.length !== list.length) {
          map[action.id] = kept;
          conflictName = tr(action.labelKey);
        }
      }
    }
    saveStateSoon();
    syncControls();
    if (conflictName) setStatus(tr("keys.conflict", { action: conflictName }));
    else if (keyIds.length) setStatus(tr("keys.saved", { keys: keyIds.map(formatKeyId).join(" / ") }));
    else setStatus(tr("keys.cleared"));
  }

  // 键位录制：点击键位按钮后按下任意组合键完成绑定
  let recordingKey = null;
  function cancelKeyRecording() {
    if (!recordingKey) return;
    recordingKey = null;
    syncControls();
  }
  function onRecordKeyDown(e) {
    if (!recordingKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      cancelKeyRecording();
      return;
    }
    const actionId = recordingKey;
    if (e.key === "Backspace" || e.key === "Delete") {
      recordingKey = null;
      setKeyBinding(actionId, []);
      return;
    }
    const keyId = eventKeyId(e);
    // 只按下修饰键时继续等待真正的按键
    if (!keyId) return;
    recordingKey = null;
    setKeyBinding(actionId, [keyId]);
  }
  function onDocumentMouseDown(e) {
    if (!recordingKey) return;
    const target = e.target;
    const button = target && target.closest ? target.closest(".nr-keybtn") : null;
    if (button && button.dataset.action === recordingKey) return;
    cancelKeyRecording();
  }

  function isEditableTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest('input, textarea, select, [contenteditable="true"]');
  }
  function onKeyDown(e) {
    if (recordingKey) return;
    const settings = state.settings;
    if (!winVisible() || !runtime.current) return;
    if (settings.hotkeys === "off") return;
    // 输入控件内（面板搜索框等）不触发翻页，避免吞掉正常输入
    if (isEditableTarget(e.target)) return;
    if (settings.hotkeys === "hover" && !runtime.hover) return;
    const keyId = eventKeyId(e);
    if (!keyId) return;
    const actionId = actionForKeyId(keyId);
    if (!actionId) return;
    e.preventDefault();
    e.stopPropagation();
    runKeyAction(actionId);
  }

  // ---------------- 滚轮 ----------------
  // 阅读窗口内的纵向滚动一律按「整屏翻页」处理：与快捷键翻页完全一致，
  // 一格前进 / 后退一屏，新一屏不会重复上一屏末尾的内容。
  // 关键点：只要本次手势按翻页处理，就先 preventDefault —— 即使该事件被
  // 节流丢弃也不允许原生细粒度位移混入，否则会出现「翻一屏 + 原生残余几行」
  // 的混合滚动，新一屏顶部就会重复上一屏末尾的内容。
  // 触控板 / 平滑滚轮一格拆出的多个小位移事件由节流合并为整屏步进。
  function onWheel(e) {
    if (e.altKey) {
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      updateSettings({ opacity: clamp(state.settings.opacity + delta, 0.05, 1) });
      e.preventDefault();
      return;
    }
    if (!runtime.current) return;
    // 用户开始滚动时中断吸附动画与翻段锁定，滚动操作优先
    cancelSnapAnim();
    cancelSegmentAnchor();
    // Ctrl / Shift / Meta 组合交给原生（宿主缩放、横向滚动等）
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    // 未开启「滚轮翻页」时保持原生细粒度滚动
    if (state.settings.wheelPaging === false) return;
    // 以横向为主的手势（触控板横向滑动）交给原生
    if (!e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    // 先吃掉原生滚动，被节流时也不允许细粒度位移混入
    e.preventDefault();
    const now = Date.now();
    // 节流：同一手势拆出的高频事件合并，最多每 120ms 翻一屏
    if (now - lastWheelStepAt < 120) return;
    lastWheelStepAt = now;
    if (e.deltaY > 0) pageDown();
    else pageUp();
  }

  // ---------------- 事件绑定 ----------------
  listen(winEl, "mouseenter", () => {
    runtime.hover = true;
    wake();
  });
  listen(winEl, "mouseleave", () => {
    runtime.hover = false;
    scheduleSleep();
  });
  listen(dotEl, "mouseenter", () => {
    wake();
  });
  listen(dotEl, "click", () => {
    wake();
  });
  listen(actionsEl, "click", (e) => {
    const button = e.target && e.target.closest ? e.target.closest("button[data-act]") : null;
    if (!button) return;
    const act = button.dataset.act;
    if (act === "autoscroll") setAutoScroll(!state.settings.autoScroll);
    else if (act === "panel") openPluginPanel();
    else if (act === "close") hideWindow();
  });
  listen(bodyEl, "scroll", onBodyScroll, { passive: true });
  listen(bodyEl, "wheel", onWheel, { passive: false });
  listen(document, "keydown", onKeyDown);
  // 录制监听走捕获阶段：先于翻页处理与宿主快捷键执行
  listen(document, "keydown", onRecordKeyDown, true);
  listen(document, "mousedown", onDocumentMouseDown, true);
  listen(window, "resize", () => {
    applyPosition();
    applyLineMetrics(true);
  });
  listen(panelEl, "click", (e) => {
    const target = e.target;
    if (!target || !target.closest) return;
    const tabButton = target.closest(".nr-tab");
    if (tabButton && tabButton.dataset.tab) {
      panelTab = tabButton.dataset.tab;
      refreshPanel();
      return;
    }
    const actEl = target.closest("[data-act]");
    if (!actEl) return;
    const act = actEl.dataset.act;
    if (act === "import") {
      fileInput.click();
    } else if (act === "toggleWin") {
      if (winVisible()) hideWindow();
      else showWindow();
    } else if (act === "openBook") {
      openBook(actEl.dataset.bookId).then(() => {
        showWindow();
      });
    } else if (act === "delBook") {
      const bookId = actEl.dataset.bookId;
      if (armedBookId !== bookId) {
        armedBookId = bookId;
        if (armTimer) clearTimeout(armTimer);
        armTimer = setTimeout(() => {
          armTimer = 0;
          armedBookId = null;
          renderView();
        }, 5000);
        renderView();
        return;
      }
      removeBook(bookId);
    } else if (act === "jumpChapter") {
      jumpToChapter(Number(actEl.dataset.index) || 0);
    } else if (act === "clearAll") {
      if (armedBookId !== "__all__") {
        armedBookId = "__all__";
        if (armTimer) clearTimeout(armTimer);
        armTimer = setTimeout(() => {
          armTimer = 0;
          armedBookId = null;
          renderView();
        }, 5000);
        renderView();
        return;
      }
      armedBookId = null;
      clearAllData();
    }
  });
  listen(fileInput, "change", () => {
    // 先把选择结果快照成数组再清空：fileInput.value = "" 会就地清空同一个 FileList，
    // 若先清空再传引用，importFiles 会拿到空列表并静默返回，表现为导入无反应。
    const files = Array.from(fileInput.files || []);
    fileInput.value = "";
    importFiles(files);
  });

  function openPluginPanel() {
    try {
      if (!api.write || typeof api.write.run !== "function") {
        log("open plugin panel skipped: api.write.run unavailable");
        setStatus(tr("status.panelUnavailable"));
        return;
      }
      const request = api.write.run("pluginsSelf.openPanel", { panelId: PANEL_ID });
      // 宿主失败时以 resolve 返回 { ok: false, error }，catch 不会触发，必须读返回值判定
      if (request && typeof request.then === "function") {
        request
          .then((result) => {
            if (result && result.ok === false) {
              log("open plugin panel failed", result.error);
              setStatus(tr("status.panelFailed", { error: result.error || "" }));
            }
          })
          .catch((err) => {
            log("open plugin panel failed", err);
            setStatus(tr("status.panelFailed", { error: (err && err.message) || String(err) }));
          });
      }
    } catch (err) {
      log("open plugin panel failed", err);
    }
  }

  installDrag();

  // ---------------- 启动 ----------------
  async function boot() {
    await loadState();
    applyAll();
    refreshPanel();
    if (state.currentBookId) {
      const exists = state.books.some((b) => b.id === state.currentBookId);
      if (exists) await openBook(state.currentBookId);
      else state.currentBookId = null;
    } else {
      renderEmpty();
    }
    if (state.settings.winVisible) showWindow();
    // winVisible 为假时无需显式隐藏：winEl 创建即 display:none，且 winVisible 与 display
    // 在 showWindow / hideWindow 中成对变更；此处原先的 hideWindow(true) 为幂等 no-op，
    // 删除不改变任何可观察行为。
    if (state.settings.autoScroll) startAutoScroll();
  }
  boot().catch((err) => {
    log("boot failed", err);
  });

  // ---------------- 清理 ----------------
  return function cleanup() {
    disposed = true;
    if (timers.save) clearTimeout(timers.save);
    if (timers.scrollRaf) clearTimeout(timers.scrollRaf);
    if (timers.sleep) clearTimeout(timers.sleep);
    if (timers.snap) clearTimeout(timers.snap);
    cancelSnapAnim();
    cancelSegmentAnchor();
    if (armTimer) clearTimeout(armTimer);
    if (statusTimer) clearTimeout(statusTimer);
    stopAutoScroll();
    saveStateNow();
    releaseListeners();
    try {
      winEl.remove();
    } catch (err) {
      /* ignore */
    }
    try {
      dotEl.remove();
    } catch (err) {
      /* ignore */
    }
    try {
      container.replaceChildren();
    } catch (err) {
      /* ignore */
    }
  };
}

export default { mount };
