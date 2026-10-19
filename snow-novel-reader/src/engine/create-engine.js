// 引擎编排：业务状态、存储、悬浮阅读窗与 React 面板视图。
import { CHAPTER_CACHE_MAX, DOT_ID, IDB_FALLBACK_PREFIX, IDB_NAME, IDB_STORE, PANEL_ID, SEARCH_CONCURRENCY, SEGMENT_CHARS, SOURCES_KEY, STORE_CHAPTERS_PREFIX, STORE_STATE_KEY, TOC_PAGE_MAX, WIN_ID } from "../constants.js";
import { DEFAULT_KEY_BINDINGS, DEFAULT_SETTINGS, SETTINGS_SPEC, cloneKeyBindings, eventKeyId } from "../config.js";
import { FALLBACK } from "../i18n.js";
import { applyValues, clamp, escapeAttr, formatSize, upperBound } from "../utils.js";
import { FONT_STACKS, PANEL_TABS, THEMES, svgIcon } from "../ui/assets.js";
import { convertScript, createScriptTextCache, resolveScriptMode } from "../legado/zh-convert.js";
import { setPurifySkipLog } from "../legado/purify.js";
import { setPseudoSkipLog } from "../legado/dom.js";
import { setRegexGuardLog } from "../legado/regex-guard.js";
import { BOOK_INFO_RULE_KEYS, CONTENT_RULE_KEYS, SEARCH_RULE_KEYS, TOC_RULE_KEYS, mergeBookSources, normalizeRuleGroup, parseBookSourcePayload } from "../legado/source-model.js";
import { buildSourceRequest, resolveSourceUrl } from "../legado/source-request.js";
import { decodeBuffer, normalizeText, sourceFetch } from "../legado/decode.js";
import { buildSourceContext, parseContentResult, parseSearchResult, parseTocNextUrl, parseTocResult } from "../legado/source-actions.js";
import { ruleString } from "../legado/rule-eval.js";

// ---------------- 插件引擎 ----------------
// 面板走 React 组件模式（与官方「会话轨迹」插件一致），宿主注入
// api / locale / panelId / panel / pluginId / isActive / inputText。
// 引擎把「业务状态 + 悬浮阅读窗 + 全局监听」封装成一份长生命周期实例：
// 面板组件挂载时 start()，卸载时 stop()；同一 api 对象复用同一引擎，
// 这样切宿主 tab（isActive 变化、组件不卸载）不会打断悬浮阅读窗与阅读进度。
// 注意：宿主在 StrictMode 下会对挂载 effect 执行 setup -> cleanup -> setup，
// 因此 stop() 拆掉的窗口与监听必须由 start() 重新建起来（见 attachWindow / detachWindow）。
export function createEngine(api) {
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
  // 把日志通道交给模块层的净化防护，用于上报「正文超长、已跳过净化」。
  setPurifySkipLog(log);
  // 同一通道交给扩展伪类/属性正则护栏，用于上报超长输入与候选超限（各只报一次）。
  setPseudoSkipLog(log);
  // 第三方正则护栏：拒绝灾难性回溯 pattern 时上报一次，便于定位劣质书源。
  setRegexGuardLog(log);

  // ---------------- 字形转换（简繁） ----------------
  // 把「展示用文本」转到目标字形：auto 跟随宿主界面语言（英文等不处理）。
  // 存储里始终保留原文，转换只发生在渲染路径上，因此改设置能立刻切换、不影响已存数据。
  function scriptMode() {
    return resolveScriptMode(state.settings.scriptConvert, api && api.locale);
  }
  function conv(text) {
    const mode = scriptMode();
    if (mode !== "simplified" && mode !== "traditional") return text;
    return convertScript(text, mode);
  }
  // 整本正文的转换结果缓存实例：工厂在模块层，但状态实例只由本引擎持有，不进模块层，避免跨引擎串数据。
  // 键 = 书 id + 解析后的字形方向，因此 auto（zh-CN）与显式 simplified 命中同一份，切回字形也直接复用。
  const scriptTextCache = createScriptTextCache();

  // ---------------- 状态 ----------------
  const state = {
    // keyBindings 单独深拷贝，避免用户改动污染模块级默认值
    settings: Object.assign({}, DEFAULT_SETTINGS, { keyBindings: cloneKeyBindings(DEFAULT_KEY_BINDINGS) }),
    books: [],
    currentBookId: null,
    // 在线书源列表（持久化）与搜索态
    sources: []
  };
  const runtime = {
    current: null,
    segIndex: 0,
    lineOffsets: [],
    // 每行元素的实测顶端（相对内容顶部）。null = 无实测几何（窗口隐藏 / 尚未布局 / 空内容），
    // 此时所有定位与反算退回「行号 × 行高」估算。详见 measureLineTops。
    lineTops: null,
    segStart: 0,
    pendingLine: -1,
    sleeping: false,
    hover: false,
    dragging: false,
    lineHeightPx: 0
  };
  // 在线书源：搜索结果与章节正文缓存（章节缓存按 LRU 上限裁剪）
  const searchState = {
    keyword: "",
    running: false,
    done: 0,
    total: 0,
    error: "",
    items: [],
    searched: false,
    // 精确匹配：只显示书名与搜索词完全一致的结果（面板会话内开关，不写设置）
    exact: false
  };
  const chapterCache = new Map();
  // 书源导入弹窗的粘贴草稿：面板由 React 重绘，草稿必须另存才不会丢
  let sourceDraft = "";
  // 导入时覆盖同地址的已有书源（默认开启）：覆盖只换规则，保留原启用/停用状态与列表位置；
  // 关闭后与旧版行为一致，同地址一律跳过
  let importOverwrite = true;
  let disposed = false;
  // 读档是否已落地：loadState() 成功读取后置真。stop() 的写回以此为准，
  // 否则「挂起的读档 -> stop -> start」（StrictMode 双挂载）会在读档完成前把空 state 写回存储，
  // 覆盖用户的书架与阅读进度，第二轮 start 再读到空档。
  let stateLoaded = false;
  // 读档完成前的保存请求先挂起，读档完成后由 start() 合并写一次，
  // 避免面板已可交互而 loadState 尚未返回时用初始空 state 覆盖存档。
  let pendingSave = false;
  // 读档失败保护：主存档可能暂时读不出来，本次会话的修改先写恢复键，
  // 下次成功读档后按 book id 合并，避免用空 state 覆盖原存档。
  let recoveryMode = false;
  let recoveryMerged = false;
  // 恢复快照写入前读取的基线：失败会话的空 state 不能整体覆盖上一轮快照。
  let recoveryBase = null;
  let recoveryBaseReady = false;
  // 失败会话从旧快照补入内存的书：重试成功时主档同 id 的数据优先，
  // 除非本轮确实改过进度（recoveryTouched）。
  const recoveryAdopted = new Set();
  const recoveryTouched = new Set();
  // 恢复模式下的清空意图：普通合并无法删除主档旧书，快照带此标记时按清空结果整体替换。
  let stateCleared = false;
  let loadRetryTimer = 0;
  const removedBookIds = new Set();
  // 打开请求序号：自增即作废所有在途读取，保证只有最后一次 openBook 能落地
  let openToken = 0;
  // 搜索请求序号：自增即作废在途搜索，保证清空或重新搜索后旧结果不会回填
  let searchToken = 0;
  // 数据集代次：清空全部数据时自增。加入书架/导入这类会写书架的流程在每个 await 后
  // 比对代次，失效即丢弃结果，避免「已清空全部数据」之后书籍又被在途请求写回来。
  let dataEpoch = 0;
  // 启动代次：start() 自增即作废在途的上一轮启动。只判 disposed 不够——宿主在 StrictMode 下
  // 会 stop() 后立刻 start()，而 start() 入口会把 disposed 复位，上一轮挂起的 await 恢复后
  // 判定失效、收尾被重复执行（外观重应用、重复打开书籍、在线书多一次章节请求）。
  let startToken = 0;
  let panelTab = "books";
  let chapterQuery = "";
  let armedBookId = null;
  let armedSourceId = null;
  let armTimer = 0;
  let statusTimer = 0;
  const listeners = [];
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

  // ---------------- 悬浮阅读窗 DOM ----------------
  // 窗口节点与全局监听都是「可装卸资源」：start() 装、stop() 卸。
  // 宿主在 React StrictMode 下会对挂载 effect 执行 setup -> cleanup -> setup，
  // 第一次 cleanup 的 stop() 已经把窗口与监听拆掉，因此 start() 必须能把它们重新建起来。
  let winEl = null;
  let barEl = null;
  let titleEl = null;
  let percentEl = null;
  let actionsEl = null;
  let autoBtn = null;
  let bodyEl = null;
  let contentEl = null;
  let progressEl = null;
  let resizeEl = null;
  let dotEl = null;

  // 幂等：窗口仍在宿主文档里就直接返回，避免重复注册监听
  function attachWindow() {
    if (winEl && winEl.parentNode === document.body) return;

    winEl = document.createElement("div");
    winEl.id = WIN_ID;
    winEl.className = "snr-win";
    winEl.style.display = "none";
    winEl.innerHTML =
      '<div class="snr-bar">' +
      '<div class="snr-title"></div>' +
      '<div class="snr-percent"></div>' +
      '<div class="snr-actions">' +
      // 上一章 / 下一章：与快捷键（默认 Ctrl+ArrowLeft / Ctrl+ArrowRight）走同一条路径，
      // 没有快捷键入口时也能直接点。本地书或目录为空时点击给出提示，与快捷键行为一致。
      '<button class="snr-btn" type="button" data-act="prevChapter" title="' + escapeAttr(tr("keys.prevChapter")) + '">' + svgIcon("chevronLeft", 14) + "</button>" +
      '<button class="snr-btn" type="button" data-act="nextChapter" title="' + escapeAttr(tr("keys.nextChapter")) + '">' + svgIcon("chevronRight", 14) + "</button>" +
      // 分隔线：区分「章节导航」与「窗口操作」两组按钮
      '<span class="snr-sep"></span>' +
      '<button class="snr-btn" type="button" data-act="autoscroll" title="' + escapeAttr(tr("settings.autoScroll")) + '">' + svgIcon("play", 14) + "</button>" +
      '<button class="snr-btn" type="button" data-act="panel" title="' + escapeAttr(tr("tab.settings")) + '">' + svgIcon("panel", 14) + "</button>" +
      '<button class="snr-btn" type="button" data-act="close" title="' + escapeAttr(tr("win.hide")) + '">' + svgIcon("close", 14) + "</button>" +
      "</div>" +
      "</div>" +
      '<div class="snr-body"><div class="snr-content"></div></div>' +
      '<div class="snr-foot"><div class="snr-progress"></div></div>' +
      '<div class="snr-resize"></div>';
    barEl = winEl.querySelector(".snr-bar");
    titleEl = winEl.querySelector(".snr-title");
    percentEl = winEl.querySelector(".snr-percent");
    actionsEl = winEl.querySelector(".snr-actions");
    autoBtn = winEl.querySelector('button[data-act="autoscroll"]');
    bodyEl = winEl.querySelector(".snr-body");
    contentEl = winEl.querySelector(".snr-content");
    progressEl = winEl.querySelector(".snr-progress");
    resizeEl = winEl.querySelector(".snr-resize");

    dotEl = document.createElement("div");
    dotEl.id = DOT_ID;
    dotEl.className = "snr-dot";
    dotEl.hidden = true;
    dotEl.title = tr("win.show");
    dotEl.innerHTML = svgIcon("book", 16);

    document.body.appendChild(winEl);
    document.body.appendChild(dotEl);

    installDrag();

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
      else if (act === "prevChapter") prevSegment();
      else if (act === "nextChapter") nextSegment();
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
    // 面板内的交互全部由 React 组件自行处理（onClick / onChange），
    // 这里只保留「命令式能力触发面板重绘」的桥：宿主切回本面板时同步一次。
    listen(document, "visibilitychange", () => {
      if (!disposed && document.visibilityState === "visible") panelStore.notify();
    });
  }

  // 停止时把窗口与全局监听一并卸下并清空引用；下一次 start() 会重新 attachWindow()
  function detachWindow() {
    releaseListeners();
    try {
      if (winEl) winEl.remove();
    } catch (err) {
      /* ignore */
    }
    try {
      if (dotEl) dotEl.remove();
    } catch (err) {
      /* ignore */
    }
    winEl = null;
    barEl = null;
    titleEl = null;
    percentEl = null;
    actionsEl = null;
    autoBtn = null;
    bodyEl = null;
    contentEl = null;
    progressEl = null;
    resizeEl = null;
    dotEl = null;
  }

  // 面板状态仓库：按数据域记录版本号，notify(scope) 只推进对应域。
  // 不传 scope 时按 "all" 处理，任何未标注的通知仍让全部视图失效（保持原有安全语义）；
  // 高频且只影响局部界面的更新（状态提示 / 搜索进度 / 纯视觉设置）走各自域，
  // 目录这类长列表据此复用上一次的元素树，不再为每章重建 React 元素。
  const panelStore = {
    version: 0,
    scopes: Object.create(null),
    listeners: new Set(),
    subscribe(listener) {
      panelStore.listeners.add(listener);
      return function () {
        panelStore.listeners.delete(listener);
      };
    },
    notify(scope) {
      const key = scope || "all";
      panelStore.scopes[key] = (panelStore.scopes[key] || 0) + 1;
      panelStore.version += 1;
      for (const listener of Array.from(panelStore.listeners)) {
        try {
          listener();
        } catch (err) {
          log("panel listener failed", err);
        }
      }
    }
  };
  // 面板头副标题走独立通道：滚动阅读窗时只有头部薄组件订阅它，
  // 避免每帧进度更新经 panelStore 触发 PanelView 整树重渲染。
  const headStore = {
    version: 0,
    listeners: new Set(),
    subscribe(listener) {
      headStore.listeners.add(listener);
      return function () {
        headStore.listeners.delete(listener);
      };
    },
    notify() {
      headStore.version += 1;
      for (const listener of Array.from(headStore.listeners)) {
        try {
          listener();
        } catch (err) {
          log("head listener failed", err);
        }
      }
    }
  };
  // 状态提示：原先是 DOM 文本，现在由 React 渲染，这里只保存文本与分级
  let statusText = "";
  // 分级（info / success / error / loading）：error 与 loading 常驻，需手动关闭或被下次提示覆盖，
  // 避免「失败一闪而过」与「加载中突然消失」两类误读
  let statusLevel = "info";
  // loading 级提示的归属（打开请求 token + 书 id）：loading 不会自动消失，
  // 只有设置它的请求，或删除这本书的操作，才能收掉这条提示。
  let statusLoadingToken = 0;
  let statusLoadingBookId = null;
  // 书源导入弹窗的开关（草稿见 sourceDraft）
  let modalOpen = false;

  // ---------------- 存储 ----------------
  // 阅读进度保存很频繁（滚动停止即触发），而在线书的 chapters 数组可能很大：
  // reader-state 只存书架元数据与进度，目录按书拆到 book-chapters:<bookId>，
  // 且只有目录真正变化（新增/刷新/迁移）时才写对应键。
  const chaptersDirty = new Set();
  const chaptersDeletes = new Set();
  // 读档失败时的恢复快照键：主存档读不出来时，新数据写这里，绝不动 reader-state。
  const RECOVERY_KEY = STORE_STATE_KEY + ".recovery";
  // 目录键写入失败后的退避重试：同一本书连续失败时逐步拉长间隔，
  // 避免每次滚动防抖保存都先撞同一个坏键；目录再次变化时立即重置。
  const CHAPTER_SAVE_BACKOFF_MS = [2000, 5000, 15000, 60000];
  const chapterRetry = new Map();
  let saveRunning = false;
  let saveQueued = false;
  let saveFailedNotified = false;

  function chaptersKey(bookId) {
    return STORE_CHAPTERS_PREFIX + bookId;
  }
  function markChaptersDirty(bookId) {
    if (typeof bookId === "string" && bookId) {
      chaptersDirty.add(bookId);
      chapterRetry.delete(bookId);
    }
  }
  function normalizeChapterList(list) {
    const out = [];
    if (!Array.isArray(list)) return out;
    for (const item of list) {
      if (!item || typeof item.url !== "string") continue;
      out.push({ title: typeof item.title === "string" ? item.title : item.url, url: item.url });
    }
    return out;
  }
  // 存储里的书对象 -> 内存书对象。inline 表示目录来自旧格式内嵌（需要迁移到独立键）。
  function buildStoredBook(rawBook) {
    if (!rawBook || typeof rawBook.id !== "string" || typeof rawBook.name !== "string") return null;
    const meta = {
      id: rawBook.id,
      name: rawBook.name,
      size: Number(rawBook.size) || 0,
      addedAt: Number(rawBook.addedAt) || Date.now(),
      lastOpenedAt: Number(rawBook.lastOpenedAt) || Date.now(),
      progress:
        rawBook.progress && typeof rawBook.progress === "object" ? rawBook.progress : { offset: 0, percent: 0 }
    };
    let inline = false;
    if (typeof rawBook.sourceId === "string") {
      meta.sourceId = rawBook.sourceId;
      meta.sourceName = typeof rawBook.sourceName === "string" ? rawBook.sourceName : "";
      meta.bookUrl = typeof rawBook.bookUrl === "string" ? rawBook.bookUrl : "";
      meta.author = typeof rawBook.author === "string" ? rawBook.author : "";
      meta.coverUrl = typeof rawBook.coverUrl === "string" ? rawBook.coverUrl : "";
      meta.intro = typeof rawBook.intro === "string" ? rawBook.intro : "";
      if (Array.isArray(rawBook.chapters)) {
        meta.chapters = normalizeChapterList(rawBook.chapters);
        inline = true;
      } else {
        meta.chapters = [];
      }
      meta.chapterIndex = clamp(Number(rawBook.chapterIndex) || 0, 0, Math.max(0, meta.chapters.length - 1));
      meta.encodingRisk = typeof rawBook.encodingRisk === "string" ? rawBook.encodingRisk : "";
    }
    return { meta: meta, inline: inline };
  }
  // 目录水合：只填空目录，避免覆盖用户在这期间刷新出来的新目录。
  function applyStoredChapters(meta, stored) {
    if (!meta || !stored || !Array.isArray(stored.chapters)) return;
    if (Array.isArray(meta.chapters) && meta.chapters.length) return;
    meta.chapters = normalizeChapterList(stored.chapters);
    meta.chapterIndex = clamp(Number(meta.chapterIndex) || 0, 0, Math.max(0, meta.chapters.length - 1));
  }
  // embedChapterIds 为 true 时内嵌全部目录（恢复快照），为 Set 时只内嵌集合内书籍的目录。
  // 目录键没写成功的书必须把目录随主状态一起落盘，否则重启后会出现「书在、目录没了」。
  function buildStatePayload(embedChapterIds) {
    const embedAll = embedChapterIds === true;
    const books = [];
    for (const book of state.books) {
      const meta = {};
      for (const key of Object.keys(book)) {
        // 章节表默认走独立键；只有独立键写入失败（或恢复快照）时才内嵌。
        if (key === "chapters" && !embedAll && !(embedChapterIds && embedChapterIds.has(book.id))) continue;
        meta[key] = book[key];
      }
      books.push(meta);
    }
    return { v: 1, settings: state.settings, books: books, currentBookId: state.currentBookId };
  }
  // 恢复快照基线缓存：写入前读取现有快照并按 book id 合并，避免失败会话把上一轮
  // 新增的书与进度整体覆盖成空记录。读取失败时抛错，调用方跳过本次写入而不是盲写。
  function resetRecoveryBase() {
    recoveryBase = null;
    recoveryBaseReady = false;
  }
  async function readRecoveryBase() {
    if (recoveryBaseReady) return recoveryBase;
    const raw = await api.storage.getJson(RECOVERY_KEY, null);
    recoveryBase = raw && typeof raw === "object" ? raw : null;
    recoveryBaseReady = true;
    return recoveryBase;
  }
  // 当前 state 优先；旧快照只补当前不存在的书。cleared 一旦置真就保持（清空意图不能
  // 被新的失败会话改回 false），此时不合并旧书。设置只回填旧快照里的非默认项。
  function buildRecoveryPayload(base) {
    const current = buildStatePayload(true);
    const cleared = stateCleared || (base && base.cleared === true);
    const books = current.books.slice();
    if (!cleared && base && base.state && Array.isArray(base.state.books)) {
      const known = new Set(books.map((book) => book && book.id));
      for (const item of base.state.books) {
        const built = buildStoredBook(item);
        if (!built || known.has(built.meta.id) || removedBookIds.has(built.meta.id)) continue;
        books.push(built.meta);
        known.add(built.meta.id);
      }
    }
    const settings = Object.assign({}, current.settings);
    if (base && base.state && base.state.settings && typeof base.state.settings === "object") {
      const saved = sanitizeSettings(base.state.settings);
      for (const key of Object.keys(saved)) {
        if (
          JSON.stringify(saved[key]) !== JSON.stringify(DEFAULT_SETTINGS[key]) &&
          JSON.stringify(settings[key]) === JSON.stringify(DEFAULT_SETTINGS[key])
        ) {
          settings[key] = saved[key];
        }
      }
      const bindings = sanitizeKeyBindings(base.state.settings.keyBindings);
      if (
        JSON.stringify(bindings) !== JSON.stringify(DEFAULT_KEY_BINDINGS) &&
        JSON.stringify(settings.keyBindings) === JSON.stringify(DEFAULT_KEY_BINDINGS)
      ) {
        settings.keyBindings = bindings;
      }
    }
    let currentBookId = current.currentBookId;
    if (
      !currentBookId &&
      !cleared &&
      base &&
      base.state &&
      typeof base.state.currentBookId === "string" &&
      base.state.currentBookId
    ) {
      currentBookId = base.state.currentBookId;
    }
    const deletes = new Set(chaptersDeletes);
    if (base && Array.isArray(base.deletes)) {
      for (const bookId of base.deletes) {
        if (typeof bookId === "string" && bookId) deletes.add(bookId);
      }
    }
    return {
      v: 1,
      savedAt: Date.now(),
      cleared: cleared,
      deletes: Array.from(deletes),
      state: { v: 1, settings: settings, books: books, currentBookId: currentBookId }
    };
  }
  // 保存失败只提示一次（error 级常驻，用户能看到）；恢复成功后复位。
  function notifySaveFailure(err) {
    log("save state failed", err);
    if (saveFailedNotified) return;
    saveFailedNotified = true;
    setStatus(tr("status.saveFailed"), "error");
  }
  function notifySaveSuccess() {
    if (!saveFailedNotified) return;
    saveFailedNotified = false;
    log("save state recovered");
  }
  async function runSave() {
    // 主存档读不出来时只写恢复快照：包含全部目录与待删除目录键，绝不动 reader-state。
    if (recoveryMode) {
      // 先读旧快照再合并写入：本次 state.books 可能为空（主档读失败的首个会话），
      // 直接整体覆盖会把上一轮失败会话的书与进度清掉。
      let base;
      try {
        base = await readRecoveryBase();
      } catch (err) {
        notifySaveFailure(err);
        return;
      }
      const payload = buildRecoveryPayload(base);
      try {
        await api.storage.setJson(RECOVERY_KEY, payload);
        recoveryBase = payload;
        recoveryBaseReady = true;
      } catch (err) {
        notifySaveFailure(err);
      }
      return;
    }
    // 写序：先目录键，再 reader-state，最后删除已移除书籍的目录键。
    // 目录键失败与本次保存隔离：坏键保留脏标记并按退避重试，但不再中断 reader-state，
    // 否则一个目录键持续失败会让书架、进度与设置全部停止落盘。
    const pendingChapters = new Set();
    for (const bookId of Array.from(chaptersDirty)) {
      const book = state.books.find((item) => item.id === bookId);
      if (!book) {
        chaptersDirty.delete(bookId);
        chapterRetry.delete(bookId);
        continue;
      }
      const retry = chapterRetry.get(bookId);
      if (retry && Date.now() < retry.nextAt) {
        pendingChapters.add(bookId);
        continue;
      }
      try {
        await api.storage.setJson(chaptersKey(bookId), { v: 1, chapters: book.chapters || [] });
      } catch (err) {
        notifySaveFailure(err);
        const attempts = (retry ? retry.attempts : 0) + 1;
        const delay = CHAPTER_SAVE_BACKOFF_MS[Math.min(attempts - 1, CHAPTER_SAVE_BACKOFF_MS.length - 1)];
        chapterRetry.set(bookId, { attempts: attempts, nextAt: Date.now() + delay });
        pendingChapters.add(bookId);
        continue;
      }
      chaptersDirty.delete(bookId);
      chapterRetry.delete(bookId);
    }
    try {
      await api.storage.setJson(STORE_STATE_KEY, buildStatePayload(pendingChapters));
    } catch (err) {
      notifySaveFailure(err);
      return;
    }
    // 主状态已经落盘：清空意图已生效；合并过的恢复快照也完成使命，可以删除。
    stateCleared = false;
    if (recoveryMerged) {
      try {
        await api.storage.remove(RECOVERY_KEY);
        recoveryMerged = false;
        resetRecoveryBase();
      } catch (err) {
        log("remove recovery failed", err);
      }
    }
    for (const bookId of Array.from(chaptersDeletes)) {
      try {
        await api.storage.remove(chaptersKey(bookId));
      } catch (err) {
        notifySaveFailure(err);
        // 单个目录键删除失败同样隔离，保留待删标记等下次保存重试。
        continue;
      }
      chaptersDeletes.delete(bookId);
    }
    if (chaptersDirty.size === 0 && chaptersDeletes.size === 0) notifySaveSuccess();
    else if (saveFailedNotified) log("save state deferred", chaptersDirty.size, chaptersDeletes.size);
  }
  function saveStateSoon() {
    if (timers.save) clearTimeout(timers.save);
    timers.save = setTimeout(() => {
      timers.save = 0;
      saveStateNow();
    }, 600);
  }
  function saveStateNow() {
    // 读档完成前内存里还是初始空 state：直接写回会覆盖用户书架，先挂起，
    // 由 start() 在读档与代次校验通过后统一 flush。
    if (!stateLoaded) {
      pendingSave = true;
      return;
    }
    if (saveRunning) {
      // 已有写链在跑：只置脏，等它结束后再合并写一次。
      saveQueued = true;
      return;
    }
    saveRunning = true;
    runSave()
      .catch((err) => notifySaveFailure(err))
      .then(() => {
        saveRunning = false;
        if (saveQueued) {
          saveQueued = false;
          saveStateNow();
        }
      });
  }
  async function loadState(token) {
    const epoch = dataEpoch;
    // 读档前的设置深拷贝：读档期间用户可能改动其中任意键（updateSettings 之外
    // 还有键位录制、窗口拖拽等直接写入），套用存档时按键比对，只跳过被改动的键。
    const settingsBefore = JSON.parse(JSON.stringify(state.settings));
    let raw;
    try {
      raw = await api.storage.getJson(STORE_STATE_KEY, null);
    } catch (err) {
      log("load state failed", err);
      return { ok: false, error: err };
    }
    if (disposed || token !== startToken) return { ok: false, canceled: true };
    if (!raw || typeof raw !== "object") return { ok: true };
    try {
      // 先构造局部快照，全部解析成功后再一次性应用，避免半应用状态。
      let nextSettings = null;
      let nextBindings = null;
      if (raw.settings && typeof raw.settings === "object") {
        // 读档期间用户可能改过个别设置：按设置键做差集，只跳过被改动的键，
        // 其余键仍从存档恢复；整体比较会让一处改动导致整份设置回退默认值。
        const saved = sanitizeSettings(raw.settings);
        nextSettings = {};
        for (const key of Object.keys(saved)) {
          if (JSON.stringify(state.settings[key]) !== JSON.stringify(settingsBefore[key])) continue;
          nextSettings[key] = saved[key];
        }
        // keyBindings 不在 SETTINGS_SPEC 内，单独比对；快照是深拷贝，
        // 因为键位录制会原地修改嵌套数组。
        if (JSON.stringify(state.settings.keyBindings) === JSON.stringify(settingsBefore.keyBindings)) {
          nextBindings = sanitizeKeyBindings(raw.settings.keyBindings);
        }
      }
      const loaded = [];
      if (Array.isArray(raw.books)) {
        // 在线书（sourceId + chapters）与本地 TXT 共用同一书架数组。
        // 旧格式内嵌 chapters 的记录在这里标记迁移；新格式目录在书架落地后限流并行水合。
        for (const item of raw.books) {
          const built = buildStoredBook(item);
          if (!built) continue;
          if (built.inline) markChaptersDirty(built.meta.id);
          loaded.push(built.meta);
        }
      }
      // 读档期间数据被清空：以清空结果为准，不把书架读回来。
      if (epoch !== dataEpoch) {
        refreshPanel();
        return { ok: true, discarded: true };
      }
      if (nextSettings) {
        for (const key of Object.keys(nextSettings)) state.settings[key] = nextSettings[key];
        // nextBindings 为空表示读档期间键位被改过，此时保留用户当前键位。
        if (nextBindings) state.settings.keyBindings = nextBindings;
      }
      // 不整体覆盖 state.books：读档期间导入的书保留，用户显式删除的书不复活。
      if (state.books.length === 0) {
        // 恢复模式下用户逐本删空书架后重试读档：主档旧书仍须受墓碑约束，
        // 不能把已删除的书连同旧进度赋回来。
        state.books = loaded.filter((book) => !removedBookIds.has(book.id));
      } else {
        const known = new Set(state.books.map((book) => book.id));
        for (const book of loaded) {
          if (removedBookIds.has(book.id)) continue;
          if (!known.has(book.id)) {
            state.books.push(book);
            known.add(book.id);
            continue;
          }
          // 失败会话从旧快照补入的书：主档同 id 的数据优先，除非本轮真正改过进度，
          // 避免旧快照进度覆盖主档较新的进度（读档在途导入的书仍按原逻辑保留）。
          if (recoveryAdopted.has(book.id) && !recoveryTouched.has(book.id)) {
            const index = state.books.findIndex((item) => item.id === book.id);
            if (index !== -1) state.books[index] = book;
          }
        }
      }
      if (typeof raw.currentBookId === "string" && !state.currentBookId) state.currentBookId = raw.currentBookId;
      // 先让书架可见，再按书限流并行水合目录，不再串行等完所有目录才渲染。
      refreshPanel();
      const pending = [];
      for (const book of state.books) {
        if (!book.sourceId) continue;
        if (Array.isArray(book.chapters) && book.chapters.length) continue;
        pending.push(book.id);
      }
      await hydrateStoredChapters(token, pending);
      if (disposed || token !== startToken) return { ok: false, canceled: true };
      // 本轮对账完成：后续读档不再需要用快照采纳记录做同 id 替换。
      recoveryAdopted.clear();
      recoveryTouched.clear();
      return { ok: true };
    } catch (err) {
      log("load state failed", err);
      return { ok: false, error: err };
    }
  }

  // 单本目录按需加载：书架先可见后，用户可能立刻点开目录尚未水合的书。
  async function loadBookChapters(meta) {
    if (!meta || !meta.sourceId) return;
    if (Array.isArray(meta.chapters) && meta.chapters.length) return;
    try {
      const stored = await api.storage.getJson(chaptersKey(meta.id), null);
      applyStoredChapters(meta, stored);
    } catch (err) {
      log("load chapters failed", meta.id, err);
    }
  }

  // 目录水合：最多 4 个并发；每个 await 后校验启动代次，书架不等待全部目录。
  async function hydrateStoredChapters(token, ids) {
    if (!ids.length) return;
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next];
        next += 1;
        if (disposed || token !== startToken) return;
        const meta = state.books.find((book) => book.id === id);
        if (!meta || (Array.isArray(meta.chapters) && meta.chapters.length)) continue;
        try {
          const stored = await api.storage.getJson(chaptersKey(id), null);
          if (disposed || token !== startToken) return;
          const current = state.books.find((book) => book.id === id);
          if (!current) continue;
          applyStoredChapters(current, stored);
          panelStore.notify("books");
        } catch (err) {
          log("load chapters failed", id, err);
        }
      }
    };
    const workers = [];
    const concurrency = Math.min(4, ids.length);
    for (let i = 0; i < concurrency; i += 1) workers.push(worker());
    await Promise.all(workers);
  }

  // 读档成功后合并失败期间的保护快照：默认只补主档没有的书记录，绝不删除主档数据。
  // 快照带 cleared 标记时按「清空优先」用快照书架整体替换主档，避免旧书复活。
  async function mergeRecovery(token) {
    let raw;
    try {
      raw = await api.storage.getJson(RECOVERY_KEY, null);
    } catch (err) {
      log("load recovery failed", err);
      return;
    }
    if (disposed || token !== startToken) return;
    if (!raw || !raw.state || typeof raw.state !== "object") return;
    const recovered = raw.state;
    const cleared = raw.cleared === true;
    const recoveredBooks = [];
    if (Array.isArray(recovered.books)) {
      for (const item of recovered.books) {
        const built = buildStoredBook(item);
        if (!built || removedBookIds.has(built.meta.id)) continue;
        recoveredBooks.push(built.meta);
        if (built.meta.sourceId && built.meta.chapters.length) markChaptersDirty(built.meta.id);
      }
    }
    if (cleared) {
      state.books = recoveredBooks;
      state.currentBookId = typeof recovered.currentBookId === "string" ? recovered.currentBookId : null;
    } else if (recoveredBooks.length) {
      const known = new Set(state.books.map((book) => book.id));
      for (const book of recoveredBooks) {
        if (known.has(book.id)) continue;
        state.books.push(book);
        known.add(book.id);
      }
    }
    // 设置只回填非默认项：默认值可能只是失败会话的初始 state，不能覆盖主档设置。
    if (recovered.settings && typeof recovered.settings === "object") {
      const saved = sanitizeSettings(recovered.settings);
      for (const key of Object.keys(saved)) {
        if (JSON.stringify(saved[key]) !== JSON.stringify(DEFAULT_SETTINGS[key])) state.settings[key] = saved[key];
      }
      const bindings = sanitizeKeyBindings(recovered.settings.keyBindings);
      if (JSON.stringify(bindings) !== JSON.stringify(DEFAULT_KEY_BINDINGS)) state.settings.keyBindings = bindings;
    }
    if (!cleared && typeof recovered.currentBookId === "string" && !state.currentBookId) {
      state.currentBookId = recovered.currentBookId;
    }
    if (Array.isArray(raw.deletes)) {
      for (const bookId of raw.deletes) {
        if (typeof bookId === "string" && bookId) chaptersDeletes.add(bookId);
      }
    }
    recoveryMerged = true;
    refreshPanel();
  }

  // 主档读取失败时把旧恢复快照读入内存用于展示（只读）：用户至少能看到上一轮
  // 失败会话的书与进度。不恢复 currentBookId，避免自动打开正文可能不可用的旧书。
  async function adoptRecoverySnapshot(token) {
    let raw;
    try {
      raw = await readRecoveryBase();
    } catch (err) {
      log("load recovery failed", err);
      return;
    }
    if (disposed || token !== startToken) return;
    if (!raw || !raw.state || typeof raw.state !== "object" || raw.cleared === true) return;
    if (!Array.isArray(raw.state.books)) return;
    const known = new Set(state.books.map((book) => book.id));
    let added = 0;
    for (const item of raw.state.books) {
      const built = buildStoredBook(item);
      if (!built || known.has(built.meta.id) || removedBookIds.has(built.meta.id)) continue;
      state.books.push(built.meta);
      known.add(built.meta.id);
      recoveryAdopted.add(built.meta.id);
      // 快照内嵌了目录；重试成功后主档写链会把它们迁到独立目录键。
      if (built.meta.sourceId && built.meta.chapters.length) markChaptersDirty(built.meta.id);
      added += 1;
    }
    if (added) refreshPanel();
  }

  function scheduleLoadRetry(token) {
    if (loadRetryTimer) return;
    loadRetryTimer = setTimeout(() => {
      loadRetryTimer = 0;
      if (disposed || token !== startToken) return;
      retryLoadState(token);
    }, 800);
  }

  async function retryLoadState(token) {
    // 清空发生在读档失败之后：main 档仍是旧书架，loadState 读到的书不能覆盖
    // 清空后新导入的书。先记住当前内存（清空后的唯一权威），读档后恢复。
    const keptBooks = stateCleared ? state.books.slice() : null;
    const keptCurrentBookId = state.currentBookId;
    const scriptModeBeforeLoad = scriptMode();
    const result = await loadState(token);
    if (disposed || token !== startToken || (result && result.canceled)) return;
    if (!result || !result.ok) {
      // 首次失败时快照可能因存储瞬断没读进来，重试失败时再补一次展示。
      await adoptRecoverySnapshot(token);
      if (disposed || token !== startToken) return;
      recoveryMode = true;
      stateLoaded = true;
      return;
    }
    if (stateCleared) {
      state.books = keptBooks;
      state.currentBookId = keptCurrentBookId;
      // 清空优先：旧恢复快照只安排清理，不把其中的旧书合并回来。
      recoveryMerged = true;
    } else {
      await mergeRecovery(token);
    }
    if (disposed || token !== startToken) return;
    recoveryMode = false;
    stateLoaded = true;
    if (statusText === tr("status.loadFailed")) clearStatus();
    pendingSave = true;
    saveStateNow();
    // 与 start() 的收尾顺序一致：设置与几何必须在 openBook 渲染前应用，
    // showWindow 必须在 openBook 之后（隐藏期写 pendingLine，显示时负责落位）。
    applyAll();
    refreshPanel();
    // 首次启动失败时跳过了恢复阅读位置，重试成功后补上。
    if (state.currentBookId) {
      const exists = state.books.some((book) => book.id === state.currentBookId);
      if (exists) {
        // openBook 对同一本书会短路；字形转换设置变了时必须清空当前正文，
        // 否则重试后仍显示失败会话按默认字形渲染的旧正文。
        if (runtime.current && runtime.current.id === state.currentBookId && scriptMode() !== scriptModeBeforeLoad) {
          runtime.current = null;
        }
        await openBook(state.currentBookId);
      } else state.currentBookId = null;
    }
    if (disposed || token !== startToken) return;
    if (state.settings.winVisible) showWindow();
    else if (winEl && winEl.style.display !== "none") hideWindow(true);
    if (state.settings.autoScroll) startAutoScroll();
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

  // 文本解码（readableScore / utf16UnitStats / decodeUtf16Candidate / decodeBuffer /
  // base64ToBytes / normalizeText）已提升为模块级函数：在线书源响应解码与本地 TXT 导入共用。

  // ---------------- 在线书源：状态与业务 ----------------
  // 书源列表持久化在插件私有存储；在线书籍复用书架，用 source 字段区分本地 TXT / 在线书。
  async function loadSources() {
    try {
      const raw = await api.storage.getJson(SOURCES_KEY, null);
      if (Array.isArray(raw)) {
        // 载入即归一化（与 loadState 对书籍元数据的处理同一约定）。规则分组缺失或不是对象时，
        // 解析处读取 source.ruleToc.chapterList 会抛类型错误，而整条在线阅读链没有兜底，
        // 状态栏会永久停在加载级文案；这里是数据入口的最后一道防线。
        state.sources = raw
          .filter((item) => item && typeof item.id === "string" && typeof item.url === "string")
          .map((item) => ({
            id: item.id,
            url: item.url,
            name: typeof item.name === "string" ? item.name : item.id,
            group: typeof item.group === "string" ? item.group : "",
            header: item.header && typeof item.header === "object" ? item.header : null,
            searchUrl: typeof item.searchUrl === "string" ? item.searchUrl : "",
            ruleSearch: normalizeRuleGroup(item.ruleSearch, SEARCH_RULE_KEYS),
            ruleBookInfo: normalizeRuleGroup(item.ruleBookInfo, BOOK_INFO_RULE_KEYS),
            ruleToc: normalizeRuleGroup(item.ruleToc, TOC_RULE_KEYS),
            ruleContent: normalizeRuleGroup(item.ruleContent, CONTENT_RULE_KEYS),
            enabled: item.enabled !== false,
            warnings: Array.isArray(item.warnings) ? item.warnings : [],
            order: Number(item.order) || 0
          }));
      }
    } catch (err) {
      log("load sources failed", err);
    }
  }
  function saveSources() {
    try {
      const p = api.storage.setJson(SOURCES_KEY, state.sources);
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (err) {
      log("save sources failed", err);
    }
  }
  function enabledSources() {
    return state.sources.filter((item) => item.enabled !== false);
  }

  // 可参与搜索的书源：启用 + 具备搜索地址与列表规则；搜索页与搜索动作共用同一判定
  function searchableSources() {
    return enabledSources().filter((item) => item.searchUrl && item.ruleSearch && item.ruleSearch.bookList);
  }

  // 导入书源文本：解析 -> 按 bookSourceUrl 去重合并（importOverwrite 开启时覆盖同地址旧源）
  function importSourceText(text) {
    const parsed = parseBookSourcePayload(text);
    if (parsed.error === "parse") return { added: 0, updated: 0, skipped: 0, error: tr("source.importParseError") };
    if (!parsed.sources.length) return { added: 0, updated: 0, skipped: 0, error: tr("source.importEmpty") };
    const result = mergeBookSources(state.sources, parsed.sources, importOverwrite);
    if (result.added || result.updated) saveSources();
    return { added: result.added, updated: result.updated, skipped: result.skipped, error: "" };
  }

  function removeSource(sourceId) {
    const next = state.sources.filter((item) => item.id !== sourceId);
    if (next.length === state.sources.length) return;
    state.sources = next;
    saveSources();
    // 该源已删除，其章节正文不可能再被正常打开，缓存一并清理（键为「源标识 + NUL + 章节 URL」）
    const prefix = sourceId + "\u0000";
    for (const key of Array.from(chapterCache.keys())) {
      if (key.indexOf(prefix) === 0) chapterCache.delete(key);
    }
  }

  function toggleSource(sourceId) {
    for (const item of state.sources) {
      if (item.id === sourceId) item.enabled = item.enabled === false;
    }
    saveSources();
  }

  // 精确匹配：文本与搜索词完全一致才算命中（忽略首尾空白与大小写）。
  // 书源搜索接口只做模糊匹配，请求侧收窄不了，只能在聚合出的结果里过滤：
  // 搜「某本书」时站点常常回一堆「某本书之XX」「某本书 番外」之类的相近结果。
  function exactNameMatch(name, keyword) {
    const target = String(keyword == null ? "" : keyword).trim().toLowerCase();
    const candidate = String(name == null ? "" : name).trim().toLowerCase();
    return !!target && candidate === target;
  }

  // 「精确匹配」的命中判定：书名与搜索词完全一致，或作者与搜索词完全一致。
  // 搜索框本来就同时接受书名和作者（见 source.searchPlaceholder），只看书名会让
  // 「搜作者」在精确模式下永远搜不到东西。
  function exactItemMatch(item, keyword) {
    if (!item) return false;
    return exactNameMatch(item.name, keyword) || exactNameMatch(item.author, keyword);
  }

  // 并发搜索：按 SEARCH_CONCURRENCY 限流的并发 worker，单源失败不影响其它源。
  // hooks.onItems 在每个书源解析完成后立刻回调该源新增的条目：调用方据此「搜到一个就显示一个」，
  // 不必等全部书源跑完。返回值仍是完整结果，供调用方做收尾判定。
  // token 由调用方传入：清空数据或发起新搜索后旧搜索的 token 立即失效，
  // 旧搜索不得再写共享的 searchState（done/total/running）或触发面板刷新。
  async function searchAllSources(keyword, hooks, token) {
    const onItems = hooks && typeof hooks.onItems === "function" ? hooks.onItems : null;
    const sources = searchableSources();
    if (!sources.length) return { items: [], total: 0, failed: 0, skipped: state.sources.length };
    if (token !== searchToken) return { items: [], total: 0, failed: 0, skipped: 0 };
    searchState.running = true;
    searchState.done = 0;
    searchState.total = sources.length;
    searchState.error = "";
    updateSearchProgress();
    const results = [];
    let failed = 0;
    // 固定 SEARCH_CONCURRENCY 个 worker 从共享游标取源（取完一个再取下标的 +N 个），
    // 避免一次性对所有书源发起请求触发站点风控。单源失败只计入 failed，不影响其它源。
    const workerCount = Math.max(1, Math.min(SEARCH_CONCURRENCY, sources.length));
    let cursor = 0;
    const runWorker = async () => {
      // token 失效（清空数据或重新搜索）后不再取下一个源，避免旧搜索继续发新请求
      while (cursor < sources.length && !disposed && token === searchToken) {
        const source = sources[cursor];
        cursor += 1;
        try {
          const request = buildSourceRequest(source, source.searchUrl, { key: keyword, page: 1 });
          const response = await sourceFetch(api, source, request);
          if (disposed || token !== searchToken) return;
          if (!response.ok) {
            failed += 1;
            log("source search failed", source.name, response.error);
            continue;
          }
          const context = buildSourceContext(response.text, response.headers["content-type"], request.url);
          const items = parseSearchResult(source, context, request.url);
          for (const item of items) {
            item.sourceId = source.id;
            item.sourceName = source.name;
            item.encodingRisk = response.encodingRisk;
            results.push(item);
          }
          // 这个源已经跑完：命中的条目立刻交给调用方显示（流式回填）
          if (items.length && onItems) onItems(items);
        } catch (err) {
          failed += 1;
          log("source search error", source.name, err);
        } finally {
          // 旧搜索晚到的收尾不得累加或刷新当前搜索的进度
          if (token === searchToken) {
            searchState.done += 1;
            if (!disposed) updateSearchProgress();
          }
        }
      }
    };
    const workers = [];
    for (let i = 0; i < workerCount; i += 1) workers.push(runWorker());
    await Promise.all(workers);
    // 只有仍是当前搜索时才能解禁 running，否则旧搜索会提前放开新搜索的搜索按钮
    if (token === searchToken) searchState.running = false;
    if (disposed) return { items: [], total: sources.length, failed: failed, skipped: 0 };
    return { items: results, total: sources.length, failed: failed, skipped: state.sources.length - sources.length };
  }

  // 章节缓存键：书源标识 + 章节 URL。同一书源被重复导入（地址相同、规则不同）时章节绝对
  // 地址可能完全一致，只用 URL 作键会让两个源共用同一份正文。
  function chapterCacheKey(book, chapter) {
    const sourceId = book && typeof book.sourceId === "string" ? book.sourceId : "";
    const url = chapter && typeof chapter.url === "string" ? chapter.url : "";
    return sourceId + "\u0000" + url;
  }

  // 章节正文抓取：带缓存（按最近使用淘汰）
  async function fetchChapterContent(book, chapter) {
    const cacheKey = chapterCacheKey(book, chapter);
    const cached = chapterCache.get(cacheKey);
    if (typeof cached === "string") {
      // 命中即提到队尾：Map 的迭代顺序就是插入顺序，先删后插才构成 LRU，
      // 否则命中不调序，实际退化成先进先出、热点章节会被误淘汰。
      chapterCache.delete(cacheKey);
      chapterCache.set(cacheKey, cached);
      return { ok: true, text: cached, error: "" };
    }
    const source = state.sources.find((item) => item.id === book.sourceId);
    if (!source) return { ok: false, text: "", error: "source-missing" };
    const request = buildSourceRequest(source, chapter.url, {});
    const response = await sourceFetch(api, source, request);
    if (disposed) return { ok: false, text: "", error: "disposed" };
    if (!response.ok) return { ok: false, text: "", error: response.error, encodingRisk: response.encodingRisk };
    const context = buildSourceContext(response.text, response.headers["content-type"], request.url);
    const text = parseContentResult(source, context);
    if (text) {
      chapterCache.set(cacheKey, text);
      while (chapterCache.size > CHAPTER_CACHE_MAX) {
        const oldest = chapterCache.keys().next();
        if (oldest.done) break;
        chapterCache.delete(oldest.value);
      }
    }
    return { ok: true, text: text, error: "", encodingRisk: response.encodingRisk };
  }

  // 把在线书加入书架：先抓目录，再以「目录 + 章节正文」的形态写入书架
  async function addOnlineBook(result) {
    // 本轮数据代次：清空全部数据后，在途的目录抓取不得再把书写回书架
    const epoch = dataEpoch;
    const source = state.sources.find((item) => item.id === result.sourceId);
    if (!source) return { ok: false, error: tr("source.addFailed", { error: sourceErrorText("source-missing") }) };
    const bookUrl = result.bookUrl;
    if (!bookUrl) return { ok: false, error: tr("source.addFailed", { error: sourceErrorText("no-book-url") }) };
    // 抓取开始前记录该书在书架上的条目 id：目录抓取期间用户可能删掉它。
    // 结束时若查不到同地址条目、原 id 又已进墓碑，说明书是被删掉的，不能以新 id 重建。
    const shelfBook = state.books.find((item) => item.sourceId === source.id && item.bookUrl === bookUrl);
    const shelfBookId = shelfBook ? shelfBook.id : "";
    // 详情页：补全书名/作者，封面与简介同样「详情页优先、搜索结果兜底」
    let detailHtml = "";
    const detailRequest = buildSourceRequest(source, bookUrl, {});
    const detailResponse = await sourceFetch(api, source, detailRequest);
    if (disposed) return { ok: false, error: "disposed" };
    if (epoch !== dataEpoch) return { ok: false, error: "stale" };
    if (detailResponse.ok) detailHtml = detailResponse.text;
    const detailContext = buildSourceContext(detailHtml, detailResponse.headers["content-type"], bookUrl);
    const detailRule = source.ruleBookInfo || {};
    // 详情页取值：规则为空或没取到时回退到搜索结果（与 name / author 同一范式，避免逐字段重复判断）
    const detailValue = (key, fallback) => {
      const rule = detailRule[key];
      const value = rule ? ruleString(rule, detailContext) : "";
      return value || fallback || "";
    };
    const infoName = detailValue("name", "");
    const infoAuthor = detailValue("author", "");
    const name = infoName || result.name || bookUrl;
    const author = infoAuthor || result.author || "";
    // 封面可能是相对地址或 @src 属性，统一转成绝对地址
    const coverUrl = resolveSourceUrl(bookUrl, detailValue("coverUrl", result.coverUrl || ""));
    const intro = detailValue("intro", result.intro || "");
    // 目录：书源带 nextTocUrl 时分页抓取（一页只给一部分章节）
    let tocUrl = detailValue("tocUrl", "");
    tocUrl = tocUrl ? resolveSourceUrl(bookUrl, tocUrl) : bookUrl;
    const chapters = [];
    const seenToc = {};
    let nextTocUrl = tocUrl;
    let tocRisk = "";
    for (let page = 0; page < TOC_PAGE_MAX && nextTocUrl; page += 1) {
      if (seenToc[nextTocUrl]) break;
      seenToc[nextTocUrl] = true;
      const tocRequest = buildSourceRequest(source, nextTocUrl, {});
      const tocResponse = await sourceFetch(api, source, tocRequest);
      if (disposed) return { ok: false, error: "disposed" };
      if (epoch !== dataEpoch) return { ok: false, error: "stale" };
      if (!tocResponse.ok) {
        if (!chapters.length) return { ok: false, error: tr("source.tocFailed", { error: sourceErrorText(tocResponse.error) }) };
        break;
      }
      tocRisk = tocResponse.encodingRisk || tocRisk;
      const tocContext = buildSourceContext(tocResponse.text, tocResponse.headers["content-type"], tocRequest.url);
      for (const chapter of parseTocResult(source, tocContext, tocRequest.url)) chapters.push(chapter);
      nextTocUrl = resolveSourceUrl(tocRequest.url, parseTocNextUrl(source, tocContext));
    }
    if (!chapters.length) return { ok: false, error: tr("source.tocFailed", { error: sourceErrorText("empty-toc") }) };
    // 复用已有条目，避免重复添加
    let existing = false;
    let meta = state.books.find((item) => item.sourceId === source.id && item.bookUrl === bookUrl);
    if (!meta && shelfBookId && removedBookIds.has(shelfBookId)) {
      // 抓取期间这本书被删除：放弃本次加入，避免以新 id / 零进度重新加回书架。
      return { ok: false, error: "removed" };
    }
    if (!meta) {
      const id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      meta = {
        id: id,
        name: name,
        size: 0,
        addedAt: Date.now(),
        lastOpenedAt: Date.now(),
        progress: { offset: 0, percent: 0 },
        sourceId: source.id,
        sourceName: source.name,
        bookUrl: bookUrl,
        author: author,
        coverUrl: coverUrl,
        intro: intro,
        chapters: chapters,
        chapterIndex: 0,
        encodingRisk: tocRisk || ""
      };
      state.books.unshift(meta);
    } else {
      // 已在书架：只刷新目录，chapterIndex / progress 一律保留，避免阅读进度被拉回第一章
      existing = true;
      meta.chapters = chapters;
    }
    // 目录发生变化：标记后由保存写链先落 book-chapters:<id>，再落不含 chapters 的 reader-state。
    markChaptersDirty(meta.id);
    saveStateNow();
    refreshPanel();
    return { ok: true, bookId: meta.id, error: "", chapters: chapters.length, existing: existing };
  }

  // 在线阅读：按章抓正文，写入 runtime.current 供阅读窗渲染
  async function openOnlineChapter(bookId, chapterIndex, anchorOffset, atEnd) {
    const meta = state.books.find((item) => item.id === bookId);
    if (!meta || !meta.chapters || !meta.chapters.length) return;
    const index = clamp(chapterIndex, 0, meta.chapters.length - 1);
    const chapter = meta.chapters[index];
    const token = ++openToken;
    statusLoadingToken = token;
    statusLoadingBookId = bookId;
    setStatus(tr("source.loadingContent"), "loading");
    let result;
    try {
      result = await fetchChapterContent(meta, chapter);
    } catch (err) {
      failStatus("source.contentFailed", err);
      return;
    }
    if (disposed) return;
    if (token !== openToken) {
      // 请求已作废（删书/清空/切章）：loading 不会自动消失，由本请求收掉自己设置的那条
      endOpenLoading(token, tr("source.loadingContent"));
      return;
    }
    if (!result.ok) {
      setStatus(tr("source.contentFailed", { error: sourceErrorText(result.error) }), "error");
      return;
    }
    if (!result.text) {
      setStatus(tr("source.contentEmpty"), "error");
      return;
    }
    meta.chapterIndex = index;
    state.currentBookId = bookId;
    meta.lastOpenedAt = Date.now();
    if (result.encodingRisk) meta.encodingRisk = result.encodingRisk;
    const text = conv(normalizeText(result.text));
    runtime.current = {
      id: bookId,
      name: conv(meta.name),
      text: text,
      blocks: buildBlocks(text),
      online: true,
      chapterIndex: index,
      chapterTitle: conv(chapter.title)
    };
    const offset = typeof anchorOffset === "number" ? anchorOffset : 0;
    // atEnd：向上翻页跨到上一章时定位到本章末尾（末段末行），章首进入时按 offset 定位
    const blockIndex = atEnd ? runtime.current.blocks.length - 1 : findBlockIndex(runtime.current.blocks, offset);
    renderSegment(blockIndex, atEnd ? runtime.current.blocks[blockIndex].end : offset);
    // 本次切章/打开的实际落点：窗口隐藏时 scrollTop 读回恒为 0，persistProgress 会直接返回。
    // 这里用 renderSegment 记下的 pendingLine 显式计算章内 offset，避免 chapterIndex 已换章
    // 而 progress.offset 仍指向上一章；窗口可见时取反算值，与 persistProgress 口径一致。
    const landedLine = winVisible()
      ? lineIndexAt(bodyEl.scrollTop)
      : runtime.pendingLine >= 0
        ? runtime.pendingLine
        : 0;
    const landedOffset = runtime.segStart + (runtime.lineOffsets[landedLine] || 0);
    const chapterRatio = clamp(landedOffset / (text.length || 1), 0, 1);
    if (!meta.progress) meta.progress = { offset: 0, percent: 0 };
    meta.progress.offset = landedOffset;
    meta.progress.percent = Math.round(clamp((index + chapterRatio) / meta.chapters.length, 0, 1) * 1000) / 10;
    if (recoveryAdopted.has(bookId)) recoveryTouched.add(bookId);
    // 正文已经渲染进阅读窗，必须收掉 loading：loading 级不会自动消失，
    // 否则状态栏会永久停在「正在加载正文…」（正文其实早就出来了）。
    endOpenLoading(token, tr("source.loadingContent"));
    saveStateSoon();
    refreshPanel();
  }

  // 搜索进度：并发搜索期间每完成一个源刷新一次面板（搜索页显示 done/total）
  function updateSearchProgress() {
    if (disposed) return;
    // 只推进搜索域：目录等大列表不需要跟着每个书源返回重建
    panelStore.notify("search");
  }

  // ---------------- 书源：搜索与加入书架（面板动作） ----------------
  // 这两个函数在面板层迁移到 React 时被误删，导致搜索与「加入书架」点击后抛 ReferenceError；
  // 恢复时按新的 setStatus(text, level) 分级签名接入，并把技术错误码交给 sourceErrorText 转换。
  async function runSourceSearch() {
    const keyword = searchState.keyword;
    if (!keyword || searchState.running) return;
    if (!searchableSources().length) {
      setStatus(tr("source.searchNoSource"), "error");
      return;
    }
    searchState.searched = true;
    searchState.items = [];
    searchState.error = "";
    setStatus(tr("source.searching", { count: searchableSources().length }), "loading");
    renderView();
    const token = ++searchToken;
    // 流式回填：每个书源一返回就把它命中的条目追加进列表，搜到一个就显示一个。
    // 列表只追加、不重排，条目点击时按原始下标回查 searchState.items 的契约保持不变。
    // token 校验与收尾一致：清空数据或重新搜索后，旧搜索的增量结果不得再写回。
    const result = await searchAllSources(
      keyword,
      {
        onItems: (items) => {
          if (disposed || token !== searchToken) return;
          for (const item of items) searchState.items.push(item);
        }
      },
      token
    );
    if (disposed || token !== searchToken) return;
    searchState.items = result.items;
    searchState.running = false;
    if (!result.total) {
      setStatus(tr("source.searchEmpty"), "error");
    } else if (result.failed === result.total) {
      setStatus(tr("source.searchFailed", { error: sourceErrorText("all-failed") }), "error");
    } else if (!result.items.length) {
      setStatus(tr("source.searchEmpty"), "error");
    } else {
      let message = tr("source.searchDone", { count: result.items.length });
      if (result.failed) message += tr("source.searchPartial", { failed: result.failed });
      setStatus(message, "success");
    }
    renderView();
  }

  async function handleAddOnlineBook(index) {
    const result = searchState.items[index];
    if (!result) return;
    const epoch = dataEpoch;
    setStatus(tr("source.loadingToc"), "loading");
    let added;
    try {
      added = await addOnlineBook(result);
    } catch (err) {
      failStatus("source.addFailed", err);
      return;
    }
    if (disposed || epoch !== dataEpoch) return;
    if (!added.ok) {
      // 清空数据导致的失效不是错误：clearAllData 已经给出「已清空」提示
      if (added.error === "stale") return;
      if (added.error === "removed") {
        // 抓取期间这本书被删除：加入已取消，只收掉本次操作自己的加载提示。
        if (statusLevel === "loading" && statusText === tr("source.loadingToc")) clearStatus();
        return;
      }
      setStatus(added.error, "error");
      return;
    }
    try {
      // 新书从第一章开始；已在书架的书按存档的 chapterIndex / progress 恢复
      if (added.existing) await openBook(added.bookId);
      else await openOnlineChapter(added.bookId, 0);
    } catch (err) {
      failStatus("source.contentFailed", err);
      return;
    }
    if (disposed || epoch !== dataEpoch) return;
    // 成功提示必须放在正文加载之后：openOnlineChapter 第一步就把状态置为加载级，
    // 先设的成功级提示会在同一个同步块里被覆盖，用户永远看不到。首章失败时上面已给出错误级提示。
    if (statusLevel !== "error") setStatus(tr("source.added"), "success");
    showWindow();
    renderView();
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

  // 真实可滚动上限：滚到底就是末屏文字正好填满视口
  function maxScrollTop() {
    return Math.max(0, bodyEl.scrollHeight - bodyEl.clientHeight);
  }

  // 行网格上限：无折行时 scrollHeight 是行高的整数倍，取整后停位落在行边界；
  // 折行内容的每行高不是行高整数倍，取整会切掉末行，此时应改用 maxScrollTop。
  function gridMaxScrollTop() {
    return Math.floor(maxScrollTop() / lineHeightPx()) * lineHeightPx();
  }

  // 重新测量视口并应用行高；keepAnchor 时把滚动位置吸附到行边界
  function applyLineMetrics(keepAnchor) {
    refreshBodyMetrics();
    const lh = lineHeightPx();
    const cssLh = String(lh) + "px";
    contentEl.style.lineHeight = cssLh;
    contentEl.style.setProperty("--snr-lh-px", cssLh);
    // 行高与视口高度决定折行结果，改动后实测行顶端必须重测（隐藏时取不到布局盒，会被清空）
    refreshLineTops();
    if (keepAnchor) {
      if (runtime.lineTops) {
        // 有实测几何时滚动位置本身就落在行顶端，按行高取整只会把它推离真实行顶
        bodyEl.scrollTop = clamp(bodyEl.scrollTop, 0, maxScrollTop());
      } else {
        const line = Math.round(bodyEl.scrollTop / lh);
        bodyEl.scrollTop = line * lh;
      }
    }
  }

  // ---------------- 阅读窗口：行几何测量 ----------------
  // .snr-line 是 white-space: pre-wrap，超长段落会被折成多行显示，逻辑行数并不等于视觉行数。
  // 「行号 × 行高」于是严重低估真实内容高度：十几屏长的章节里它只覆盖到内容的一小部分，
  // 表现为向上翻页只回到上一章的半途、进度条同时停在半路（本地书与在线书同样受影响）。
  // 这里在渲染后直接测量每个行元素的真实顶端，作为定位与进度反算的唯一基准。
  function measureLineTops() {
    const count = contentEl.childElementCount;
    // 窗口隐藏（display: none）时元素不生成布局盒，clientHeight 与 rect 全为 0，测不出东西
    if (count <= 0 || bodyEl.clientHeight <= 0) return null;
    const base = contentEl.getBoundingClientRect().top;
    const tops = new Array(count);
    for (let i = 0; i < count; i += 1) {
      tops[i] = Math.round(contentEl.children[i].getBoundingClientRect().top - base);
    }
    // 未布局时所有 rect 都是 0，据此定位会把正文压回段首，退回行高估算更稳妥
    if (count > 1 && tops[count - 1] <= 0) return null;
    return tops;
  }

  // 刷新实测行顶端；拿不到布局盒的场景（隐藏期 / 空内容）返回 null，调用方退回行高估算
  function refreshLineTops() {
    runtime.lineTops = measureLineTops();
    return runtime.lineTops;
  }

  // 第 index 行的顶端像素：有实测值用实测值，否则用「行号 × 行高」估算
  function lineTopAt(index) {
    const tops = runtime.lineTops;
    if (tops && tops.length) return tops[clamp(index, 0, tops.length - 1)];
    const count = Math.max(1, runtime.lineOffsets ? runtime.lineOffsets.length : 1);
    return clamp(index, 0, count - 1) * lineHeightPx();
  }

  // 视口顶行对应的行号（进度反算与「隐藏前记录阅读行」都用它）
  function lineIndexAt(scrollTop) {
    const tops = runtime.lineTops;
    if (tops && tops.length) {
      let lo = 0;
      let hi = tops.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (tops[mid] <= scrollTop + 1) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }
    const count = Math.max(1, runtime.lineOffsets ? runtime.lineOffsets.length : 1);
    return clamp(Math.round(scrollTop / lineHeightPx()), 0, count - 1);
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
    if (!dotEl) return;
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    const r = rect || currentRect();
    const left = clamp(r.x, 4, Math.max(4, vw - 34));
    const top = clamp(r.y, 4, Math.max(4, vh - 34));
    dotEl.style.left = left + "px";
    dotEl.style.top = top + "px";
  }

  function applyPosition() {
    // 窗口可能已被 stop()/detachWindow() 卸下（拖拽中的 mousemove 等晚到回调），
    // 这里统一判空，避免访问 null.style。
    if (!winEl) return;
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
  // 纯视觉/纯状态设置：只改 CSS 变量、class 或按钮外观，不参与正文折行与行顶端测量。
  // 未登记在此的键（含未来新增项）默认走全量应用，避免漏掉布局影响。
  const VISUAL_ONLY_SETTING_KEYS = [
    "opacity",
    "sleepOpacity",
    "sleepMode",
    "sleepDelay",
    "theme",
    "hotkeys",
    "wheelPaging",
    "autoScrollSpeed",
    "autoScroll",
    "winVisible",
    "scriptConvert"
  ];

  // 纯视觉应用：不读布局、不动滚动位置。透明度 / 主题 / 休眠等高频调整走这里，
  // 避免每次样式变更都触发 measureLineTops 对每个 .snr-line 的 getBoundingClientRect。
  function applyVisual() {
    // 面板卸载/重挂载的时序里 winEl 与内部节点可能尚未重建，先判空避免访问 null.style。
    if (!winEl || !contentEl || !autoBtn) return;
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
    // 缩进改变首行可用宽度与折行：必须在全量应用测量行顶端之前切换
    contentEl.classList.toggle("indent", !!settings.indent);
    autoBtn.innerHTML = svgIcon(settings.autoScroll ? "pause" : "play", 14);
    autoBtn.classList.toggle("active", !!settings.autoScroll);
    syncSleepClasses();
  }

  // 全量应用：视觉 + 位置尺寸 + 字号行高与行顶端测量。
  // 只在启动与影响折行/视口几何的设置变化时调用。
  function applyAll() {
    // 面板卸载/重挂载的时序里 winEl 与内部节点可能尚未重建，先判空避免首帧渲染或
    // 晚到的异步收尾访问 null.style。
    if (!winEl || !bodyEl || !contentEl || !autoBtn) return;
    const settings = state.settings;
    applyVisual();
    // 先确定窗口尺寸（决定阅读区高度），再按视口高度取整齐行高
    applyPosition();
    // 行高随字号 / 视口变化，旧像素值不再对应同一行：先按旧行高记录阅读行，重算后按新行高回位
    const keepLine = runtime.lineHeightPx > 0 ? bodyEl.scrollTop / runtime.lineHeightPx : 0;
    contentEl.style.fontSize = settings.fontSize + "px";
    applyLineMetrics(true);
    if (keepLine > 0) bodyEl.scrollTop = Math.round(keepLine) * lineHeightPx();
  }

  // ---------------- 阅读窗口：休眠与显示 ----------------
  function winVisible() {
    // winEl 在 stop()/detachWindow() 后为 null，而 state.settings.winVisible 可能仍为 true
    // （悬浮窗显示状态下关闭面板或卸载插件）：面板重挂载的首帧渲染早于 start()，
    // 这里必须判空；无窗口节点时按「不可见」处理，避免后续调用方继续访问 bodyEl。
    return !!winEl && state.settings.winVisible === true && winEl.style.display !== "none";
  }
  function syncSleepClasses() {
    if (!winEl) return;
    const mode = state.settings.sleepMode;
    const sleeping = runtime.sleeping && winVisible();
    winEl.classList.toggle("is-sleeping", sleeping);
    winEl.classList.toggle("mode-fade", mode === "fade");
    winEl.classList.toggle("mode-hide", mode === "hide");
    if (dotEl) dotEl.hidden = !(sleeping && mode === "hide");
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
    // start() 之前或 stop() 之后窗口节点可能不存在：此时只记录期望可见状态，
    // 由随后的 start()/attachWindow() 负责真正显示。
    if (!winEl || !bodyEl || !contentEl) return;
    winEl.style.display = "flex";
    runtime.sleeping = false;
    applyPosition();
    applyLineMetrics(true);
    // 隐藏期间渲染的段落此时才拿到布局盒（applyLineMetrics 已按当前尺寸重测行顶端），
    // 用实测行顶端把待落位行换算成真实像素位置并写回进度：折行内容用「行号 × 行高」
    // 会落到段首附近，落位前还要收敛到可滚动上限，避免被浏览器截断到段尾
    if (runtime.pendingLine >= 0) {
      bodyEl.scrollTop = clamp(lineTopAt(runtime.pendingLine), 0, maxScrollTop());
      runtime.pendingLine = -1;
      updateProgressUI();
    }
    syncSleepClasses();
    if (runtime.hover) wake();
    else scheduleSleep();
    saveStateSoon();
    panelStore.notify("shell");
  }
  function hideWindow(silent) {
    // display:none 会让滚动容器丢失布局盒并把滚动位置归零，隐藏前把当前阅读行记入
    // pendingLine，由 showWindow 统一落位，与「隐藏期间重新渲染」共用同一恢复路径。
    // 仅在窗口确实可见时记录：boot 以隐藏状态启动时，openBook 已按存档进度写入有效
    // pendingLine，此时 scrollTop 读回为 0，若照写会覆盖成 0 并丢掉该恢复点。
    // 用实测几何反算阅读行号：折行内容里 scrollTop / 行高 会算出远大于真实行号的值
    if (runtime.current && winVisible()) runtime.pendingLine = lineIndexAt(bodyEl.scrollTop);
    state.settings.winVisible = false;
    if (!winEl) return;
    winEl.style.display = "none";
    runtime.sleeping = false;
    if (dotEl) dotEl.hidden = true;
    if (!silent) {
      saveStateNow();
      panelStore.notify("shell");
    }
  }

  // ---------------- 阅读窗口：内容渲染 ----------------
  function blockDisplayTitle(index) {
    const cur = runtime.current;
    if (!cur) return "";
    const block = cur.blocks[index];
    if (!block) return "";
    if (block.title) return block.title;
    // 在线书：一章正文通常整块渲染（块自身没有标题行），此时用抓取时记下的当前章节名，
    // 否则顶部只剩书名、看不到「正在读哪一章」。本地书的块标题来自正文里的章节行，逻辑不变。
    if (cur.online && cur.chapterTitle) return cur.chapterTitle;
    if (cur.blocks.length <= 1) return "";
    return tr("seg.fallback", { n: index + 1 });
  }

  function renderEmpty(message) {
    // 先收敛与 DOM 无关的运行时状态：面板卸载后位置信息仍需归零。
    runtime.lineOffsets = [];
    runtime.lineTops = null;
    runtime.pendingLine = -1;
    // stop() 会把窗口元素引用置空：异步收尾在卸载后到达时只更新状态，不再碰 DOM。
    if (!contentEl) return;
    contentEl.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "snr-empty";
    empty.textContent = message || (runtime.current ? tr("empty.book") : tr("empty.reader"));
    contentEl.appendChild(empty);
    if (progressEl) progressEl.style.width = "0%";
    if (percentEl) percentEl.textContent = "";
    updateHeader();
  }

  function updateHeader() {
    if (!titleEl) return;
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
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      offsets[i] = acc;
      acc += line.length + 1;
      const div = document.createElement("div");
      div.className = "snr-line";
      // 每个非空行都可能是一个独立段落：在线书源正文按块级标签转成单换行、
      // 本地 TXT 也是一段一行、段间常无空行。缩进若只在「空行之后」补，整章
      // 就只有第一行缩进。改为按行判定：空白行走空行盒；行首已带全角/半角
      // 空白的段落保留原文自带缩进，不再叠加 text-indent 造成双重空白。
      if (line.trim().length === 0) {
        div.classList.add("snr-line-empty");
      } else if (state.settings.indent && !/^\s/.test(line)) {
        div.classList.add("snr-indent");
      }
      div.textContent = line;
      fragment.appendChild(div);
    }
    contentEl.replaceChildren(fragment);
    runtime.lineOffsets = offsets;
    runtime.segStart = block.start;
    let lineIndex = 0;
    if (typeof anchorOffset === "number" && anchorOffset > block.start && offsets.length > 0) {
      const local = clamp(anchorOffset - block.start, 0, Math.max(0, segText.length));
      lineIndex = Math.max(0, upperBound(offsets, local) - 1);
    }
    // 触发布局后测量真实行顶端：折行内容里「行号 × 行高」会严重低估目标位置
    void contentEl.offsetHeight;
    refreshLineTops();
    const lineTop = lineTopAt(lineIndex);
    // 目标行落在内容末端时按可滚动上限收敛：向上翻页要停在上一段的「末尾」（末屏文字填满视口），
    // 而不是把最后一行顶到视口顶部、下面留一大片空白。
    bodyEl.scrollTop = winVisible() ? clamp(lineTop, 0, maxScrollTop()) : lineTop;
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
    // 视口顶行由实测几何反算：折行内容用 scrollTop / 行高 会落到远在后面的行上（进度被高估）
    const idx = lineIndexAt(bodyEl.scrollTop);
    return runtime.segStart + runtime.lineOffsets[idx];
  }

  // 阅读进度比例（0~1）：本地书是「书内偏移 / 全书长度」；
  // 在线书一章只有本章正文，直接按章内比例画进度条会「读完一章又从 0% 开始」，
  // 因此按「已读章节数 + 本章内比例」折算到整本书。
  function progressRatio() {
    const cur = runtime.current;
    if (!cur) return 0;
    const chapterRatio = clamp(currentOffset() / (cur.text.length || 1), 0, 1);
    const meta = state.books.find((b) => b.id === cur.id);
    const chapters = meta && Array.isArray(meta.chapters) ? meta.chapters : [];
    if (!cur.online || !chapters.length) return chapterRatio;
    const index = clamp(typeof cur.chapterIndex === "number" ? cur.chapterIndex : 0, 0, chapters.length - 1);
    return clamp((index + chapterRatio) / chapters.length, 0, 1);
  }

  function persistProgress() {
    const cur = runtime.current;
    const meta = state.books.find((b) => b.id === state.currentBookId);
    if (!cur || !meta) return;
    // 窗口未生成布局盒时 scrollTop 恒为 0，据此反算会污染已保存进度。
    // 隐藏期的进度变化已由 renderSegment 记入 runtime.pendingLine，并由 showWindow 落位后统一落盘；
    // 调用方不得绕过 renderSegment 直接改写 meta.progress，也不要依赖本函数在隐藏期落盘。
    if (!winVisible()) return;
    if (!meta.progress) meta.progress = { offset: 0, percent: 0 };
    // offset 保持「本章内的字符偏移」（下次打开该书时用它定位），percent 是整本书的百分比（界面展示用）
    meta.progress.offset = currentOffset();
    meta.progress.percent = Math.round(progressRatio() * 1000) / 10;
    if (recoveryAdopted.has(meta.id)) recoveryTouched.add(meta.id);
    saveStateSoon();
  }

  // 面板头副标题文案：React 侧与「值变化才通知」的脏标记共用同一取值函数
  function headSubText() {
    const cur = runtime.current;
    const currentMeta = state.books.find((b) => b.id === state.currentBookId);
    return cur
      ? cur.name +
          "  ·  " +
          tr("books.progress", {
            percent:
              currentMeta && currentMeta.progress && typeof currentMeta.progress.percent === "number"
                ? Math.round(currentMeta.progress.percent)
                : 0
          })
      : tr("empty.reader");
  }

  // 进度条 / 百分比文本 / 面板头文案的同值短路缓存：滚动期每帧都会走到 updateProgressUI，
  // 值没变就不写 DOM、不发通知，把 60 次/秒的 notify 降到「每变化 1% 一次」量级。
  // 进度元素记「元素 + 上次值」：阅读窗重新挂载后元素是新的，缓存自动失效。
  let lastProgressEl = null;
  let lastProgressWidth = null;
  let lastPercentEl = null;
  let lastPercentText = null;
  let lastHeadSubText = null;
  function updateProgressUI() {
    const cur = runtime.current;
    const ratio = cur ? progressRatio() : 0;
    const width = (ratio * 100).toFixed(2) + "%";
    const percent = Math.round(ratio * 100) + "%";
    if (progressEl && (progressEl !== lastProgressEl || width !== lastProgressWidth)) {
      progressEl.style.width = width;
      lastProgressEl = progressEl;
      lastProgressWidth = width;
    }
    if (percentEl && (percentEl !== lastPercentEl || percent !== lastPercentText)) {
      percentEl.textContent = percent;
      lastPercentEl = percentEl;
      lastPercentText = percent;
    }
    if (cur) persistProgress();
    const headText = headSubText();
    if (headText !== lastHeadSubText) {
      lastHeadSubText = headText;
      updatePanelHeadSub();
    }
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
    // 实测几何可用时滚动位置本身就落在行顶端，按行高取整只会把它推离真实行顶，直接锁定当前值
    segmentAnchorTop = runtime.lineTops
      ? bodyEl.scrollTop
      : Math.round(bodyEl.scrollTop / lineHeightPx()) * lineHeightPx();
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
    // 折行内容用真实上限收敛，否则末行会被行网格切掉
    const target = clamp(segmentAnchorTop, 0, runtime.lineTops ? maxScrollTop() : gridMaxScrollTop());
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
    const tops = runtime.lineTops;
    if (tops && tops.length) {
      const limit = maxScrollTop();
      // 已经到底：向上吸附会把末屏内容推出视口，也会让「再按一次就翻页」的判定失效（回弹的根源）
      if (bodyEl.scrollTop >= limit - lh) return;
      // 实测几何：吸附到视口顶行自身的真实顶端。偏移超过一行说明用户正停在长段落内部
      // （折行的段落可以高过好几屏），那不是「半截行」而是真实阅读位置，保持不动。
      const index = lineIndexAt(bodyEl.scrollTop);
      if (Math.abs(bodyEl.scrollTop - tops[index]) > lh) return;
      animateScrollTo(clamp(tops[index], 0, limit));
      return;
    }
    const target = clamp(Math.round(bodyEl.scrollTop / lh) * lh, 0, gridMaxScrollTop());
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
    // 吸附动画可能已经起步：它每帧按旧目标回写 scrollTop，会把这次翻页整个吞掉（表现为回弹）
    cancelSnapAnim();
    wake();
    const lh = lineHeightPx();
    const step = pageStepLines() * lh;
    const limit = maxScrollTop();
    const alignedMax = Math.floor(limit / lh) * lh;
    // 有实测几何（内容折行）时用真实位置判底、按真实上限步进：折行内容的行顶端并不落在行高网格上，
    // 两个基准混用会让「翻到章末」的那一次按键只挪不到一行，随后又被吸附拉回 —— 回弹且翻不了页。
    // 无实测几何（无折行）时保持原判定：scrollHeight / clientHeight 被浏览器取整为整数像素，而行高是
    // 「视口高度 / 整数行」得到的小数，max 通常不是行高的整数倍，余数可能大于半个行高；只比较
    // max - bottom < lh/2 会在这种窗口尺寸下永远不成立，表现为翻到章末后按翻页键毫无反应。
    const measured = !!runtime.lineTops;
    const from = measured ? bodyEl.scrollTop : Math.round(bodyEl.scrollTop / lh) * lh;
    const end = measured ? limit : alignedMax;
    // 距底不足一行即视为已到底：末屏余量本来就只有小半行，此时再步进只会挪不到一行（用户看不到
    // 任何变化，只觉得按了没反应），必须直接翻段 / 翻章 —— 阈值留半行会让「再按一次才翻页」重现。
    if (from >= end - 1 || limit - from < lh) {
      nextSegment();
      return;
    }
    bodyEl.scrollTop = Math.min(from + step, end);
  }
  function pageUp() {
    if (!runtime.current) return;
    cancelSegmentAnchor();
    cancelSnapAnim();
    wake();
    const lh = lineHeightPx();
    const step = pageStepLines() * lh;
    // 判顶同理：有实测几何时用真实位置，距顶不足一行即视为已到顶（否则第一屏会「按了没反应」）
    const top = runtime.lineTops ? bodyEl.scrollTop : Math.round(bodyEl.scrollTop / lh) * lh;
    if (top <= lh) {
      prevSegment();
      return;
    }
    bodyEl.scrollTop = Math.max(0, top - step);
  }
  // ---------------- 在线书跨章 ----------------
  // 在线书的一章正文交给 buildBlocks 分块（单章通常 1 块，站点把多章塞进一页时才多块）。
  // 翻到本章最后一块后再前进，原先直接 return，表现为「按下一章毫无反应」。
  // 这里在到达块边界时把相邻章节抓下来并从章首渲染；本地 TXT 书没有章节元数据，
  // 保持原有「到边界即停」的行为，但同样给一条提示：静默无反应会被当成卡死。
  let chapterStepPending = -1;
  function stepOnlineChapter(delta) {
    const cur = runtime.current;
    if (!cur) return;
    const edgeText = delta > 0 ? "win.lastChapter" : "win.firstChapter";
    const meta = state.books.find((b) => b.id === cur.id);
    const chapters = meta && Array.isArray(meta.chapters) ? meta.chapters : [];
    if (!cur.online || !chapters.length) {
      // 本地书没有章节表；在线书的目录若为空也无法跨章。两者都只能停在原处，给出提示。
      log("chapter step unavailable", cur.online ? "empty-chapters" : "local-book", cur.id);
      setStatus(tr(edgeText), "info");
      return;
    }
    const from =
      typeof cur.chapterIndex === "number"
        ? cur.chapterIndex
        : typeof meta.chapterIndex === "number"
          ? meta.chapterIndex
          : 0;
    const target = from + delta;
    if (target < 0 || target > chapters.length - 1) {
      log("chapter step out of range", from, String(delta), chapters.length);
      setStatus(tr(edgeText), "info");
      return;
    }
    // 抓取在途时用户会连按翻页键，重复请求同一章只会浪费一次往返：同一目标只发起一次
    if (target === chapterStepPending) return;
    chapterStepPending = target;
    log("chapter step", cur.id, from, "->", target);
    wake();
    const done = () => {
      if (chapterStepPending === target) chapterStepPending = -1;
    };
    const task = openOnlineChapter(cur.id, target, 0, delta < 0);
    if (task && typeof task.then === "function") task.then(done, done);
    else done();
  }

  function nextSegment() {
    const cur = runtime.current;
    if (!cur) return;
    if (runtime.segIndex >= cur.blocks.length - 1) {
      stepOnlineChapter(1);
      return;
    }
    const next = runtime.segIndex + 1;
    renderSegment(next, cur.blocks[next].start);
    lockSegmentAnchor();
    wake();
  }
  function prevSegment() {
    const cur = runtime.current;
    if (!cur) return;
    if (runtime.segIndex <= 0) {
      stepOnlineChapter(-1);
      return;
    }
    const prev = runtime.segIndex - 1;
    const block = cur.blocks[prev];
    // 向上翻页是「接着读」：落到上一段的末尾，而不是回到它的开头
    renderSegment(prev, block.end);
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
    // 在线书：按章拉取，走独立路径
    if (meta.sourceId) {
      // 书架先可见后目录仍在限流水合：用户此刻点开书时按需补读目录。
      if (!Array.isArray(meta.chapters) || !meta.chapters.length) await loadBookChapters(meta);
      if (disposed) return;
      const index = typeof meta.chapterIndex === "number" ? meta.chapterIndex : 0;
      // 章内偏移的语义与本地书一致（本章正文的字符下标，UTF-16 code unit）。
      // 只在打开书籍这条路径回退到存档进度：目录点击与跨章翻页都显式要求章首，不得在此之外补回退。
      const offset =
        typeof anchorOffset === "number"
          ? anchorOffset
          : meta.progress && typeof meta.progress.offset === "number"
            ? meta.progress.offset
            : 0;
      await openOnlineChapter(bookId, index, offset);
      return;
    }
    const token = ++openToken;
    // 本次调用是否展示过「正在读取书籍…」：loading 级不自动消失，读完必须自己收掉
    let loadingShown = false;
    if (!runtime.current || runtime.current.id !== bookId) {
      // 换书时重置目录搜索词，避免沿用上一本书的关键字
      chapterQuery = "";
      statusLoadingToken = token;
      statusLoadingBookId = bookId;
      setStatus(tr("status.loadingBook"), "loading");
      loadingShown = true;
      const rawText = await textStore.get(bookId);
      if (disposed) return;
      if (token !== openToken) {
        endOpenLoading(token, tr("status.loadingBook"));
        return;
      }
      if (typeof rawText !== "string" || rawText.length === 0) {
        setStatus(tr("empty.book"), "error");
        return;
      }
      // 命中原字形缓存时直接复用正文与段落，跳过转换与 buildBlocks（多 MB 大书能省下整段同步耗时）；
      // 未命中才转换，并把结果写回容量 1 的缓存。
      // 于是真正会重转的只有两种情况：首次打开这本书、以及把它换成另一个字形方向。
      const cached = scriptTextCache.read(bookId, scriptMode());
      const text = cached ? cached.text : conv(rawText);
      const blocks = cached ? cached.blocks : buildBlocks(text);
      runtime.current = {
        id: bookId,
        name: conv(meta.name),
        text: text,
        blocks: blocks
      };
      if (!cached) scriptTextCache.write(bookId, scriptMode(), text, blocks);
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
    // 正文已渲染，收掉 loading；只清自己那条，避免误清掉期间产生的其它提示
    if (loadingShown) endOpenLoading(token, tr("status.loadingBook"));
    saveStateSoon();
    refreshPanel();
  }

  async function removeBook(bookId) {
    armedBookId = null;
    // 作废在途打开请求，避免被删除的书在读取完成后又被打开
    openToken += 1;
    // 删除的正是加载中的书：立即收掉 loading，别让状态栏停到请求返回为止
    if (statusLoadingBookId === bookId && statusLevel === "loading") {
      statusLoadingToken = 0;
      statusLoadingBookId = null;
      clearStatus();
    }
    const meta = state.books.find((b) => b.id === bookId);
    if (!meta) return;
    // 删除即加入墓碑：读档合并与恢复快照合并都不得把这本书复活。
    removedBookIds.add(bookId);
    // 记下本轮窗口：await 之后若已卸载（stop 把 winEl 置空）或已重新挂载（winEl 换新），
    // 只完成内存与落盘，不再操作旧 DOM。
    const viewWin = winEl;
    await textStore.remove(bookId);
    // 正文已删除，转换缓存里属于这本书的那份也一并丢弃，避免以后复用同 id 时拿到旧正文
    scriptTextCache.drop(bookId);
    state.books = state.books.filter((b) => b.id !== bookId);
    // 目录随书删除：写链在 reader-state 落盘成功后再删除目录键，避免半删。
    chaptersDirty.delete(bookId);
    chapterRetry.delete(bookId);
    chaptersDeletes.add(bookId);
    const wasCurrent = state.currentBookId === bookId;
    if (wasCurrent) {
      state.currentBookId = null;
      runtime.current = null;
    }
    // 先落盘删除结果，再做界面收尾：DOM 操作在卸载后可能无法执行，不能让它挡住保存。
    saveStateNow();
    if (!disposed && winEl && winEl === viewWin && wasCurrent) renderEmpty();
    refreshPanel();
  }

  // 清空全部数据：书籍正文、书架元数据、书源、章节缓存、导入草稿与搜索态一起清，
  // 避免「清空后书源还在」这类半清空状态；同时作废在途请求与二次确认态。
  async function clearAllData() {
    const viewWin = winEl;
    // 作废在途打开请求，避免清空后又被旧读取结果填回
    openToken += 1;
    // 恢复模式下，清空意图要随快照一起落盘，读取成功后才能整体替换主档。
    stateCleared = true;
    // 数据代次自增：在途的加入书架/导入在下一个 await 后即失效，不得再写回书架
    dataEpoch += 1;
    statusLoadingToken = 0;
    statusLoadingBookId = null;
    // 作废在途搜索：自增代号后，清空后回来的结果不会写回列表
    searchToken += 1;
    searchState.running = false;
    await textStore.clear();
    if (!recoveryMode) {
      // 清空优先：正常模式下的旧恢复快照已失效，删除它，避免下次启动把旧书合并回来。
      recoveryMerged = false;
      try {
        await api.storage.remove(RECOVERY_KEY);
        resetRecoveryBase();
      } catch (err) {
        log("remove recovery failed", err);
      }
    }
    // 清空书架前登记所有目录键：写链在空 reader-state 落盘后再逐本删除。
    for (const book of state.books) {
      chaptersDirty.delete(book.id);
      chaptersDeletes.add(book.id);
      removedBookIds.add(book.id);
    }
    chapterRetry.clear();
    state.books = [];
    state.currentBookId = null;
    runtime.current = null;
    runtime.lineOffsets = [];
    runtime.lineTops = null;
    runtime.pendingLine = -1;
    runtime.segIndex = 0;
    runtime.segStart = 0;
    // 书源与缓存（原先漏清，用户可见「清了但书源还在」）
    state.sources = [];
    saveSources();
    chapterCache.clear();
    scriptTextCache.drop("");
    sourceDraft = "";
    modalOpen = false;
    importOverwrite = true;
    searchState.keyword = "";
    searchState.items = [];
    searchState.searched = false;
    searchState.done = 0;
    searchState.total = 0;
    searchState.error = "";
    searchState.exact = false;
    chapterQuery = "";
    disarmAll();
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = 0;
    }
    statusText = "";
    statusLevel = "info";
    saveStateNow();
    // 清空结果先落盘；面板已卸载或已换一轮挂载时不再写旧 DOM。
    if (!disposed && winEl && winEl === viewWin) renderEmpty();
    setStatus(tr("status.clearedAll"), "success");
    refreshPanel();
  }

  // ---------------- 导入 ----------------
  async function importFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const epoch = dataEpoch;
    setStatus(tr("status.importing"), "loading");
    let lastId = null;
    let imported = 0;
    let failed = 0;
    for (const file of files) {
      try {
        const buffer = await file.arrayBuffer();
        if (disposed || epoch !== dataEpoch) return;
        const text = normalizeText(decodeBuffer(buffer));
        if (!text.trim()) continue;
        const id = "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const ok = await textStore.put(id, text);
        if (disposed || epoch !== dataEpoch) {
          // 写入期间数据被清空：把刚写进去的正文删掉，避免留下孤儿数据
          try {
            await textStore.remove(id);
          } catch (err) {
            /* 已经清空，删除失败不影响用户可见结果 */
          }
          return;
        }
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
        failed += 1;
        log("import failed", err);
        setStatus(tr("status.importFailed", { error: (err && err.message) || String(err) }), "error");
      }
    }
    if (disposed || epoch !== dataEpoch) return;
    saveStateNow();
    // 选了文件却一条都没进来（例如纯空白文件）：不能停在「正在导入…」；
    // 若上面已经给出失败提示则保留失败提示。
    if (!lastId && !imported && !failed) clearStatus();
    if (lastId) {
      setStatus(tr("status.imported", { count: imported }), "success");
      await openBook(lastId);
      if (disposed || epoch !== dataEpoch) return;
      showWindow();
    }
    refreshPanel();
  }

  // ---------------- 状态提示 ----------------
  // 分级提示：info / success 自动消失；error / loading 常驻（用户关闭或被下次提示覆盖），
  // 避免「失败一闪而过」和「加载中突然消失」两类误读。文本与分级都由 React 渲染。
  const STATUS_AUTO_DISMISS_MS = { info: 4200, success: 4200 };
  function normalizeStatusLevel(level) {
    return level === "success" || level === "error" || level === "loading" ? level : "info";
  }
  function setStatus(text, level) {
    statusText = text || "";
    statusLevel = normalizeStatusLevel(level);
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = 0;
    if (statusText && STATUS_AUTO_DISMISS_MS[statusLevel]) {
      statusTimer = setTimeout(() => {
        statusTimer = 0;
        statusText = "";
        statusLevel = "info";
        panelStore.notify("status");
      }, STATUS_AUTO_DISMISS_MS[statusLevel]);
    }
    panelStore.notify("status");
  }
  function clearStatus() {
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = 0;
    statusText = "";
    statusLevel = "info";
    panelStore.notify("status");
  }
  // 收尾本次打开请求设置的 loading：只有当前 loading 仍归它所有、且文案未被覆盖时才清，
  // 避免旧请求把新请求刚设置的「正在加载…」误清掉。
  function endOpenLoading(token, text) {
    if (statusLoadingToken !== token) return;
    statusLoadingToken = 0;
    statusLoadingBookId = null;
    if (statusText === text) clearStatus();
  }
  // 在线书链路的统一失败收尾：loading 级不会自动消失，异常必须转成 error 级提示，
  // 否则状态栏会永久停在「正在加载…」而用户无法自救（只能清空数据或重开面板）。
  function failStatus(errorKey, err) {
    log("online book failed", errorKey, err);
    if (disposed) return;
    const raw = (err && err.message) || String(err || "");
    setStatus(tr(errorKey, { error: sourceErrorText(raw) }), "error");
  }

  // 书源请求错误码 -> 用户可读文案：内部错误码（net-unavailable / invalid-response / http-404 /
  // source-missing / no-book-url / empty-toc / all-failed）不允许出现在界面上，这里统一转成自然语言；
  // 宿主偶发返回的中文提示（如「请求超时」）本身可读，原样保留；其余技术串一律兜底为通用提示。
  function sourceErrorText(code) {
    const raw = String(code == null ? "" : code).trim();
    if (!raw) return tr("err.unknown");
    if (raw === "net-unavailable") return tr("err.netUnavailable");
    if (raw === "invalid-response") return tr("err.invalidResponse");
    if (raw === "source-missing") return tr("err.sourceMissing");
    if (raw === "no-book-url") return tr("err.noBookUrl");
    if (raw === "empty-toc") return tr("err.emptyToc");
    if (raw === "all-failed") return tr("err.allFailed");
    if (raw === "disposed") return tr("err.aborted");
    if (/^http-\d+$/.test(raw)) return tr("err.http", { status: raw.slice(5) });
    if (/[\u4e00-\u9fff]/.test(raw) && raw.length <= 60) return raw;
    if (/timeout|timed out|ETIMEDOUT/i.test(raw)) return tr("err.timeout");
    if (/abort|cancel/i.test(raw)) return tr("err.aborted");
    if (/network|fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|socket/i.test(raw)) {
      return tr("err.network");
    }
    return tr("err.unknown");
  }

  // ---------------- 面板：React 视图 ----------------
  // 面板改由 React 组件渲染（与官方「会话轨迹」插件同模式）：图标直接取宿主的 lucide 组件，
  // 不需要在插件内维护图标几何，宿主升级图标库也不会与本插件脱节。
  // 组件定义在 mount 闭包内，直接读写下方的命令式状态；任何变更后调用 panelStore.notify()
  // 触发重绘。悬浮阅读窗、键盘、滚轮等仍是命令式实现，与面板渲染互不干扰。
  function makeIcon(h, name, size) {
    if (!api || !api.ui || typeof api.ui.icon !== "function") return null;
    let component = null;
    try {
      component = api.ui.icon(name);
    } catch (err) {
      component = null;
    }
    if (!component) return null;
    return h(component, { size: size || 14, strokeWidth: 1.8, "aria-hidden": "true" });
  }

  function PanelView(props) {
    const R = props && props.api && props.api.ui ? props.api.ui.React : null;
    if (!R) return null;
    // h 包装：React 要求「数组里的子元素」都带 key，这里统一补齐（已有显式 key 保留，并兼容一层数组子元素），
    // 省得每个视图手写 key；除补 key 外与 React.createElement 行为一致。
    const create = R.createElement;
    const h = (type, hprops, ...children) => {
      const flat = [];
      for (const child of children) {
        if (Array.isArray(child)) {
          for (const inner of child) flat.push(inner);
        } else {
          flat.push(child);
        }
      }
      return create(
        type,
        hprops,
        ...flat.map((child, index) =>
          child && typeof child === "object" && child.$$typeof
            ? R.cloneElement(child, { key: child.key == null ? "k" + index : child.key })
            : child
        )
      );
    };
    const icon = (name, size) => makeIcon(h, name, size);

    // 订阅仓库：任何命令式状态变更都会让面板重绘
    const [, bump] = R.useState(0);
    R.useEffect(
      () =>
        panelStore.subscribe(() => {
          bump((n) => n + 1);
        }),
      []
    );
    const txtInputRef = R.useRef(null);
    const srcInputRef = R.useRef(null);

    // 目录行做成 memo 组件，并复用同一个选择回调：章节切换时只有高亮变化的两行需要重渲染。
    // props 必须保持稳定（数字 / 布尔 / 字符串 / 稳定回调），否则 memo 直接失效。
    const selectChapter = R.useMemo(
      () => (index) => {
        const meta = state.books.find((b) => b.id === state.currentBookId);
        if (meta && meta.sourceId) {
          const bookId = state.currentBookId;
          openOnlineChapter(bookId, index)
            .then(() => {
              if (!disposed) showWindow();
            })
            .catch((err) => failStatus("source.contentFailed", err));
          return;
        }
        jumpToChapter(index);
      },
      []
    );
    const ChapterRow = R.useMemo(() => {
      const memo = typeof R.memo === "function" ? R.memo : (component) => component;
      return memo(function NrChapterRow(rowProps) {
        return h(
          "div",
          {
            className: "nr-item" + (rowProps.active ? " active" : ""),
            onClick: () => rowProps.onSelect(rowProps.index)
          },
          h("div", { className: "nr-item-main" }, h("div", { className: "nr-item-name" }, rowProps.title)),
          rowProps.active ? h("div", { className: "nr-item-badge" }, tr("chapter.current")) : null
        );
      });
    }, []);

    // 目录是唯一可能上千行的视图：按域版本缓存它的元素树。
    // 状态提示 / 搜索进度 / 纯视觉设置只推进各自域，目录元素整批复用，
    // React 协调时可直接跳过引用相同的子树，不再为每章重建 React 元素。
    // 定义必须放在 selectChapter / ChapterRow 之后：首次渲染时 useMemo 回调会立即执行 chaptersView。
    const chapterScope = panelStore.scopes.chapters || 0;
    const allScope = panelStore.scopes.all || 0;
    const chaptersBody = R.useMemo(
      () => (panelTab === "chapters" ? chaptersView() : null),
      [panelTab, chapterScope, allScope]
    );

    const goTab = (next) => {
      panelTab = next;
      // 离开快捷键页时结束录制，避免按键被静默吞掉
      if (panelTab !== "keys") recordingKey = null;
      panelStore.notify();
    };

    // ---- 通用小控件（与原命令式工厂保持同一 DOM 结构与类名）----
    // sec / row 都可能被放进数组里渲染，因此第二个参数起统一接受一个可选的 key 字符串
    // （React 要求数组子元素带 key，缺 key 会在控制台刷警告）。
    const withKey = (props, key) => (key ? Object.assign({ key: key }, props) : props);
    const sec = (title, children, key) =>
      h(
        "div",
        withKey({ className: "nr-sec" }, key),
        h("div", { className: "nr-sec-title" }, title),
        children
      );
    const row = (label, ...controls) =>
      h(
        "div",
        { className: "nr-row" },
        h("div", { className: "nr-row-label" }, label),
        h("div", { className: "nr-row-ctl" }, controls)
      );
    const slider = (label, options) => {
      const value = options.get();
      const format = options.format || ((v) => String(v));
      return row(
        label,
        h("input", {
          type: "range",
          className: "nr-range",
          min: String(options.min),
          max: String(options.max),
          step: String(options.step),
          value: String(value),
          onChange: (e) => options.onChange(Number(e.target.value))
        }),
        h("div", { className: "nr-val" }, format(value))
      );
    };
    const selectRow = (label, options, get, onChange) =>
      row(
        label,
        h(
          "select",
          { className: "nr-select", value: String(get()), onChange: (e) => onChange(e.target.value) },
          options.map((item) => h("option", { key: item.value, value: item.value }, item.label))
        )
      );
    const segRow = (label, options, get, onChange) => {
      const current = String(get());
      return h(
        "div",
        { className: "nr-row" },
        h("div", { className: "nr-row-label" }, label),
        h(
          "div",
          { className: "nr-row-ctl" },
          h(
            "div",
            { className: "nr-seg" },
            options.map((item) =>
              h(
                "button",
                {
                  key: item.value,
                  type: "button",
                  className: item.value === current ? "active" : "",
                  onClick: () => onChange(item.value)
                },
                item.label
              )
            )
          )
        )
      );
    };
    const checkRow = (label, get, onChange) =>
      h(
        "div",
        { className: "nr-row" },
        h("div", { className: "nr-row-label" }, ""),
        h(
          "div",
          { className: "nr-row-ctl" },
          h(
            "label",
            { className: "nr-check" },
            h("input", { type: "checkbox", checked: !!get(), onChange: (e) => onChange(!!e.target.checked) }),
            h("span", null, label)
          )
        )
      );
    const iconBtn = (name, options) => {
      const opts = options || {};
      return h(
        "button",
        {
          type: "button",
          className: "nr-icon-btn" + (opts.className ? " " + opts.className : ""),
          title: opts.title,
          onClick: opts.onClick
        },
        icon(name, 14)
      );
    };
    const labeledBtn = (name, text, options) => {
      const opts = options || {};
      return h(
        "button",
        {
          type: "button",
          className: "nr-btn" + (opts.className ? " " + opts.className : ""),
          disabled: !!opts.disabled,
          onClick: opts.onClick
        },
        icon(name, 14),
        h("span", null, text)
      );
    };

    // ---- 书架 ----
    function booksView() {
      if (!state.books.length) return h("div", { className: "nr-empty" }, tr("empty.books"));
      const items = state.books.map((book) => {
        const isCurrent = book.id === state.currentBookId;
        const percent =
          book.progress && typeof book.progress.percent === "number" ? Math.round(book.progress.percent) : 0;
        const subtitle =
          armedBookId === book.id
            ? tr("settings.deleteConfirm")
            : book.sourceId
              ? tr("source.offlineBook") +
                "  ·  " +
                (book.sourceName || "") +
                "  ·  " +
                tr("source.chapterCount", { count: (book.chapters || []).length })
              : tr("books.progress", { percent: percent }) + "  ·  " + formatSize(book.size);
        const children = [
          h("div", { className: "nr-item-main", key: "main" }, [
            h("div", { className: "nr-item-name", key: "name" }, conv(book.name)),
            h("div", { className: "nr-item-sub", key: "sub" }, subtitle)
          ])
        ];
        if (book.sourceId && book.chapters && book.chapters.length) {
          const idx = typeof book.chapterIndex === "number" ? book.chapterIndex : 0;
          const chapter = book.chapters[idx];
          if (chapter && chapter.title) {
            children[0] = h("div", { className: "nr-item-main", key: "main" }, [
              h("div", { className: "nr-item-name", key: "name" }, conv(book.name)),
              h("div", { className: "nr-item-sub", key: "sub" }, subtitle),
              h("div", { className: "nr-item-sub", key: "chapter" }, conv(chapter.title))
            ]);
          }
        }
        if (isCurrent) children.push(h("div", { className: "nr-item-badge", key: "badge" }, tr("chapter.current")));
        children.push(
          iconBtn("Trash2", {
            key: "del",
            className: "danger" + (armedBookId === book.id ? " active" : ""),
            title: tr("action.delete"),
            onClick: (e) => {
              e.stopPropagation();
              armDeleteBook(book.id);
            }
          })
        );
        return h(
          "div",
          {
            key: book.id,
            className: "nr-item" + (isCurrent ? " active" : ""),
            onClick: () => {
              openBook(book.id)
                .then(() => {
                  if (!disposed) showWindow();
                })
                .catch((err) => failStatus("source.contentFailed", err));
            }
          },
          children
        );
      });
      return h(
        "div",
        { className: "nr-view-body" },
        h("div", { className: "nr-hint" }, tr("books.count", { count: state.books.length })),
        h("div", { className: "nr-list" }, items)
      );
    }

    // ---- 目录 ----
    function chaptersView() {
      const meta = state.books.find((b) => b.id === state.currentBookId);
      const query = chapterQuery.trim().toLowerCase();
      const searchBox = h(
        "div",
        { className: "nr-search" },
        h("input", {
          className: "nr-input",
          type: "text",
          placeholder: tr("search.placeholder"),
          value: chapterQuery,
          onChange: (e) => {
            chapterQuery = e.target.value;
            // 目录过滤结果需要重建，只推进目录域
            panelStore.notify("chapters");
          },
          onKeyDown: (e) => {
            if (e.key !== "Escape" || !chapterQuery) return;
            chapterQuery = "";
            panelStore.notify("chapters");
            e.stopPropagation();
          }
        })
      );

      // 在线书：目录来自书源章节列表，点击即按章加载
      if (meta && meta.sourceId && meta.chapters && meta.chapters.length) {
        const chapters = meta.chapters;
        const currentIndex = typeof meta.chapterIndex === "number" ? meta.chapterIndex : 0;
        const items = [];
        for (let i = 0; i < chapters.length; i += 1) {
          const title = conv(chapters[i].title) || tr("seg.fallback", { n: i + 1 });
          if (query && title.toLowerCase().indexOf(query) === -1) continue;
          items.push(
            h(ChapterRow, {
              key: String(i),
              index: i,
              active: i === currentIndex,
              title: title,
              onSelect: selectChapter
            })
          );
        }
        if (query && !items.length) items.push(h("div", { className: "nr-empty", key: "empty" }, tr("search.empty")));
        return h(
          "div",
          { className: "nr-view-body" },
          h("div", { className: "nr-hint" }, conv(meta.name) + "  ·  " + tr("source.chapterCount", { count: chapters.length })),
          searchBox,
          h("div", { className: "nr-list" }, items)
        );
      }

      const cur = runtime.current;
      if (!cur) return h("div", { className: "nr-empty" }, tr("empty.reader"));
      const hasChapters = cur.blocks.some((b) => !!b.title);
      const items = [];
      for (let i = 0; i < cur.blocks.length; i += 1) {
        const title = blockDisplayTitle(i) || tr("seg.fallback", { n: i + 1 });
        if (query && title.toLowerCase().indexOf(query) === -1) continue;
        items.push(
          h(ChapterRow, {
            key: String(i),
            index: i,
            active: i === runtime.segIndex,
            title: title,
            onSelect: selectChapter
          })
        );
      }
      if (query && !items.length) items.push(h("div", { className: "nr-empty", key: "empty" }, tr("search.empty")));
      return h(
        "div",
        { className: "nr-view-body" },
        hasChapters ? null : h("div", { className: "nr-hint" }, tr("empty.chapters")),
        searchBox,
        h("div", { className: "nr-list" }, items)
      );
    }

    // ---- 搜索（独立 tab）----
    function searchView() {
      const usable = searchableSources();
      // 精确匹配：只保留「书名或作者与搜索词完全一致」的条目。这里必须带着条目在
      // searchState.items 里的原始下标（点击「加入书架」按下标取数），过滤后不能用
      // 过滤后的下标回查 —— 否则会打开另一本书。
      const entries = searchState.items
        .map((item, index) => ({ item: item, index: index }))
        .filter((entry) => !searchState.exact || exactItemMatch(entry.item, searchState.keyword));
      // 搜索进行中：显示已经搜到的条数与已完成的书源数，结果随每个书源返回实时增长
      const progressText = searchState.running
        ? tr("source.searchStreaming", {
            found: entries.length,
            done: searchState.done,
            total: searchState.total
          })
        : entries.length
          ? tr("source.searchDone", { count: entries.length })
          : "";
      const children = [
        sec(
          tr("source.search"),
          [
            h(
              "div",
              { className: "nr-row", key: "input" },
              h("input", {
                className: "nr-input",
                type: "text",
                placeholder: tr("source.searchPlaceholder"),
                value: searchState.keyword,
                onChange: (e) => {
                  searchState.keyword = e.target.value;
                  panelStore.notify();
                },
                onKeyDown: (e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  searchState.keyword = e.target.value.trim();
                  runSourceSearch();
                }
              })
            ),
            // 不用设置页的 checkRow：那一行左侧固定留了 104px 的标签列，放在搜索页会把复选框
            // 推到中间，与全宽的输入框、按钮对不齐（看起来像悬空）。这里直接左对齐，保持一致。
            h(
              "div",
              { className: "nr-row", key: "exact" },
              h(
                "label",
                { className: "nr-check" },
                h("input", {
                  type: "checkbox",
                  checked: !!searchState.exact,
                  onChange: (e) => {
                    searchState.exact = !!e.target.checked;
                    panelStore.notify();
                  }
                }),
                h("span", null, tr("source.exact"))
              )
            ),
            h("div", { className: "nr-hint", key: "exactHint" }, tr("source.exactHint")),
            // 搜索按钮与输入框同宽同左边缘：原来套着空的标签列（104px）会被推向右半边
            h(
              "div",
              { className: "nr-row", key: "action" },
              h(
                "button",
                {
                  type: "button",
                  className: "nr-btn primary",
                  disabled: searchState.running,
                  onClick: () => {
                    searchState.keyword = searchState.keyword.trim();
                    runSourceSearch();
                  }
                },
                icon(searchState.running ? "LoaderCircle" : "Search", 14),
                h("span", null, searchState.running ? tr("source.searching", { count: searchState.total }) : tr("source.search"))
              )
            )
          ]
        )
      ];
      if (!usable.length) {
        children.push(h("div", { className: "nr-empty", key: "nosource" }, tr("source.searchNoSource")));
        return h("div", { className: "nr-view-body" }, children);
      }
      children.push(h("div", { className: "nr-hint", key: "progress" }, progressText));
      if (!searchState.running && searchState.searched && !entries.length) {
        // 精确匹配把结果全滤掉时给专门提示：否则用户会以为书源里根本没有这本书
        const emptyKey =
          searchState.exact && searchState.items.length ? "source.exactEmpty" : "source.searchEmpty";
        children.push(h("div", { className: "nr-empty", key: "empty" }, tr(emptyKey)));
      } else if (entries.length) {
        const items = entries.map((entry) => {
          const item = entry.item;
          const parts = [];
          if (item.author) parts.push(conv(item.author));
          if (item.sourceName) parts.push(item.sourceName);
          if (item.lastChapter) parts.push(conv(item.lastChapter));
          const mainChildren = [
            h("div", { className: "nr-item-name", key: "name" }, conv(item.name) || item.bookUrl),
            h("div", { className: "nr-item-sub", key: "sub" }, parts.join("  ·  ") || item.bookUrl)
          ];
          if (item.encodingRisk) {
            mainChildren.push(
              h(
                "div",
                { className: "nr-item-sub nr-warn", key: "risk" },
                tr("source.encodingWarn", { charset: item.encodingRisk })
              )
            );
          }
          return h(
            "div",
            {
              key: item.bookUrl + "#" + entry.index,
              className: "nr-item",
              onClick: () => handleAddOnlineBook(entry.index)
            },
            h("div", { className: "nr-item-main" }, mainChildren),
            iconBtn("Plus", {
              title: tr("source.addToShelf"),
              onClick: (e) => {
                e.stopPropagation();
                handleAddOnlineBook(entry.index);
              }
            })
          );
        });
        children.push(h("div", { className: "nr-list", key: "list" }, items));
      }
      return h("div", { className: "nr-view-body" }, children);
    }

    // ---- 书源：导入入口 + 清单（搜索不在此页）----
    function sourcesView() {
      const children = [
        sec(
          tr("source.import"),
          [
            row(
              "",
              labeledBtn("Download", tr("source.importOpen"), {
                className: "primary",
                onClick: () => {
                  modalOpen = true;
                  panelStore.notify();
                }
              })
            ),
            h("div", { className: "nr-hint", key: "hint" }, tr("source.importHint"))
          ]
        )
      ];
      const listChildren = [];
      if (!state.sources.length) {
        listChildren.push(h("div", { className: "nr-empty", key: "empty" }, tr("source.empty")));
      } else {
        listChildren.push(
          h(
            "div",
            { className: "nr-hint", key: "count" },
            tr("source.count", { count: state.sources.length }) +
              "  ·  " +
              tr("source.enabledCount", { count: enabledSources().length })
          )
        );
        listChildren.push(
          h(
            "div",
            { className: "nr-list", key: "list" },
            state.sources.map((source) => {
              const sub = [];
              if (source.group) sub.push(source.group);
              sub.push(source.url);
              const mainChildren = [
                h("div", { className: "nr-item-name", key: "name" }, source.name),
                h("div", { className: "nr-item-sub", key: "sub" }, sub.join("  ·  "))
              ];
              if (source.warnings && source.warnings.length) {
                mainChildren.push(
                  h(
                    "div",
                    { className: "nr-item-sub nr-warn", key: "warn" },
                    tr("source.warn.title") + source.warnings.map((key) => tr(key)).join("；")
                  )
                );
              }
              // 二次确认时说明这次点击会移除该源（原先只有删除按钮变色，没有任何文字说明）
              if (armedSourceId === source.id) {
                mainChildren.push(
                  h("div", { className: "nr-item-sub nr-warn", key: "confirm" }, tr("source.deleteConfirm"))
                );
              }
              const children = [h("div", { className: "nr-item-main", key: "main" }, mainChildren)];
              if (source.enabled === false) {
                children.push(h("div", { className: "nr-item-badge", key: "badge" }, tr("source.disable")));
              }
              children.push(
                iconBtn("Power", {
                  key: "toggle",
                  className: source.enabled === false ? "" : "on",
                  title: source.enabled === false ? tr("source.enable") : tr("source.disable"),
                  onClick: () => {
                    toggleSource(source.id);
                    panelStore.notify();
                  }
                })
              );
              children.push(
                iconBtn("Trash2", {
                  key: "del",
                  className: "danger" + (armedSourceId === source.id ? " active" : ""),
                  title: tr("action.delete"),
                  onClick: () => armDeleteSource(source.id)
                })
              );
              return h("div", { key: source.id, className: "nr-item" }, children);
            })
          )
        );
      }
      children.push(sec(tr("source.title"), listChildren));
      return h("div", { className: "nr-view-body" }, children);
    }

    // ---- 设置 ----
    function settingsView() {
      const settings = state.settings;
      return h(
        "div",
        { className: "nr-view-body" },
        sec(tr("settings.window"), [
          slider(tr("settings.opacity"), {
            min: 5,
            max: 100,
            step: 1,
            get: () => Math.round(settings.opacity * 100),
            format: (v) => v + "%",
            onChange: (v) => updateSettings({ opacity: v / 100 })
          }),
          segRow(
            tr("settings.sleepOnLeave"),
            [
              { value: "always", label: tr("settings.sleep.always") },
              { value: "fade", label: tr("settings.sleep.fade") },
              { value: "hide", label: tr("settings.sleep.hide") }
            ],
            () => settings.sleepMode,
            (v) => updateSettings({ sleepMode: v })
          ),
          slider(tr("settings.sleepOpacity"), {
            min: 1,
            max: 100,
            step: 1,
            get: () => Math.round(settings.sleepOpacity * 100),
            format: (v) => v + "%",
            onChange: (v) => updateSettings({ sleepOpacity: v / 100 })
          }),
          slider(tr("settings.sleepDelay"), {
            min: SETTINGS_SPEC.sleepDelay.min,
            max: SETTINGS_SPEC.sleepDelay.max,
            step: 100,
            get: () => settings.sleepDelay,
            format: (v) => v + " ms",
            onChange: (v) => updateSettings({ sleepDelay: v })
          }),
          slider(tr("settings.width"), {
            min: 220,
            max: 1400,
            step: 10,
            get: () => Math.round(settings.width),
            format: (v) => v + " px",
            onChange: (v) => updateSettings({ width: v })
          }),
          slider(tr("settings.height"), {
            min: 140,
            max: 1200,
            step: 10,
            get: () => Math.round(settings.height),
            format: (v) => v + " px",
            onChange: (v) => updateSettings({ height: v })
          }),
          h("div", { className: "nr-hint", key: "hint" }, tr("win.hint"))
        ]),
        sec(tr("settings.appearance"), [
          selectRow(
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
          ),
          slider(tr("settings.fontSize"), {
            min: 11,
            max: 36,
            step: 1,
            get: () => settings.fontSize,
            format: (v) => v + " px",
            onChange: (v) => updateSettings({ fontSize: v })
          }),
          slider(tr("settings.lineHeight"), {
            min: 12,
            max: 30,
            step: 1,
            get: () => Math.round(settings.lineHeight * 10),
            format: (v) => (v / 10).toFixed(1),
            onChange: (v) => updateSettings({ lineHeight: v / 10 })
          }),
          selectRow(
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
          ),
          checkRow(
            tr("settings.indent"),
            () => settings.indent,
            (v) => updateSettings({ indent: v })
          )
        ]),
        sec(tr("settings.script"), [
          segRow(
            tr("settings.script.mode"),
            [
              { value: "auto", label: tr("settings.script.auto") },
              { value: "simplified", label: tr("settings.script.simplified") },
              { value: "traditional", label: tr("settings.script.traditional") },
              { value: "none", label: tr("settings.script.none") }
            ],
            () => settings.scriptConvert,
            (v) => updateSettings({ scriptConvert: v })
          ),
          h("div", { className: "nr-hint", key: "scriptHint" }, tr("settings.script.hint"))
        ])
      );
    }

    // ---- 快捷键 ----
    function keysView() {
      const settings = state.settings;
      const bindingRows = KEY_ACTIONS.map((action) => {
        const list =
          settings.keyBindings && Array.isArray(settings.keyBindings[action.id]) ? settings.keyBindings[action.id] : [];
        const recording = recordingKey === action.id;
        const text = recording ? tr("keys.record") : list.length ? list.map(formatKeyId).join(" / ") : tr("keys.empty");
        return h(
          "div",
          { key: action.id, className: "nr-row" },
          h("div", { className: "nr-row-label" }, tr(action.labelKey)),
          h(
            "div",
            { className: "nr-row-ctl" },
            h(
              "button",
              {
                type: "button",
                // data-action 与 onDocumentMouseDown 的「再点同一按钮停止录制」判据成对存在，迁移时勿丢
                "data-action": action.id,
                className: "nr-keybtn" + (recording ? " recording" : ""),
                onClick: (e) => {
                  // 忽略键盘激活（Enter / Space）产生的 click，避免录制完成后的按键再次进入录制
                  if (e.detail === 0) return;
                  recordingKey = recordingKey === action.id ? null : action.id;
                  panelStore.notify();
                }
              },
              text
            )
          )
        );
      });
      return h(
        "div",
        { className: "nr-view-body" },
        sec(tr("settings.interaction"), [
          segRow(
            tr("settings.hotkeys"),
            [
              { value: "hover", label: tr("settings.hotkeys.hover") },
              { value: "global", label: tr("settings.hotkeys.global") },
              { value: "off", label: tr("settings.hotkeys.off") }
            ],
            () => settings.hotkeys,
            (v) => updateSettings({ hotkeys: v })
          ),
          checkRow(
            tr("settings.wheel"),
            () => settings.wheelPaging,
            (v) => updateSettings({ wheelPaging: v })
          ),
          checkRow(
            tr("settings.autoScroll"),
            () => settings.autoScroll,
            (v) => setAutoScroll(v)
          ),
          slider(tr("settings.autoSpeed"), {
            min: SETTINGS_SPEC.autoScrollSpeed.min,
            max: SETTINGS_SPEC.autoScrollSpeed.max,
            step: 5,
            get: () => settings.autoScrollSpeed,
            format: (v) => v + " px/s",
            onChange: (v) => updateSettings({ autoScrollSpeed: v })
          }),
          h("div", { className: "nr-hint", key: "tip1" }, tr("settings.tipKeys")),
          h("div", { className: "nr-hint", key: "tip2" }, tr("settings.tipAltWheel"))
        ]),
        sec(tr("keys.bindings"), [
          ...bindingRows,
          row(
            "",
            h(
              "button",
              {
                type: "button",
                className: "nr-btn",
                onClick: () => {
                  recordingKey = null;
                  state.settings.keyBindings = cloneKeyBindings(DEFAULT_KEY_BINDINGS);
                  saveStateSoon();
                  panelStore.notify();
                  setStatus(tr("keys.resetDone"), "success");
                }
              },
              tr("keys.reset")
            )
          ),
          h("div", { className: "nr-hint", key: "hint" }, tr("keys.hint"))
        ])
      );
    }

    // ---- 数据 ----
    function dataView() {
      const totalSize = state.books.reduce((sum, book) => sum + (Number(book.size) || 0), 0);
      const currentMeta = state.books.find((b) => b.id === state.currentBookId);
      let currentText = tr("empty.reader");
      if (currentMeta) {
        const percent =
          currentMeta.progress && typeof currentMeta.progress.percent === "number"
            ? Math.round(currentMeta.progress.percent)
            : 0;
        currentText = conv(currentMeta.name) + "  ·  " + tr("books.progress", { percent: percent });
      }
      return h(
        "div",
        { className: "nr-view-body" },
        sec(tr("settings.data"), [
          row(tr("data.books"), h("div", { className: "nr-data-value" }, tr("books.count", { count: state.books.length }))),
          row(tr("data.size"), h("div", { className: "nr-data-value" }, formatSize(totalSize))),
          row(
            tr("data.sources"),
            h(
              "div",
              { className: "nr-data-value" },
              tr("source.count", { count: state.sources.length }) +
                "  ·  " +
                tr("source.enabledCount", { count: enabledSources().length })
            )
          ),
          row(
            tr("data.cache"),
            h(
              "div",
              { className: "nr-data-value" },
              tr("source.chapterCount", { count: chapterCache.size })
            )
          ),
          row(tr("data.current"), h("div", { className: "nr-data-value", title: currentText }, currentText)),
          h("div", { className: "nr-hint", key: "cacheHint" }, tr("data.cacheHint", { max: CHAPTER_CACHE_MAX })),
          h("div", { className: "nr-hint", key: "storage" }, tr("data.storage")),
          // 二次确认时把清除范围写清楚（原先只有按钮变成「确认」，用户看不到会连带删掉书源与缓存）
          armedBookId === "__all__"
            ? h("div", { className: "nr-hint nr-warn", key: "clearConfirm" }, tr("settings.clearConfirm"))
            : null
        ]),
        row(
          "",
          h(
            "button",
            {
              type: "button",
              className: "nr-btn danger",
              onClick: () => armClearAll()
            },
            armedBookId === "__all__" ? tr("action.confirm") : tr("settings.clearAll")
          )
        )
      );
    }

    // ---- 书源导入弹窗 ----
    function importModal() {
      if (!modalOpen) return null;
      const card = h(
        "div",
        { className: "nr-modal-card", role: "dialog", "aria-modal": "true" },
        h(
          "div",
          { className: "nr-modal-head" },
          h("div", { className: "nr-modal-title" }, tr("source.import")),
          iconBtn("X", {
            title: tr("action.close"),
            onClick: () => {
              modalOpen = false;
              panelStore.notify();
            }
          })
        ),
        h(
          "div",
          { className: "nr-modal-body" },
          h("textarea", {
            className: "nr-textarea",
            rows: 8,
            placeholder: tr("source.pastePlaceholder"),
            value: sourceDraft,
            onChange: (e) => {
              sourceDraft = e.target.value;
              panelStore.notify();
            }
          }),
          h(
            "div",
            { className: "nr-row", key: "overwrite" },
            h(
              "label",
              { className: "nr-check" },
              h("input", {
                type: "checkbox",
                checked: importOverwrite,
                onChange: (e) => {
                  importOverwrite = !!e.target.checked;
                  panelStore.notify();
                }
              }),
              h("span", null, tr("source.importOverwrite"))
            )
          ),
          h(
            "div",
            { className: "nr-modal-actions" },
            labeledBtn("FolderOpen", tr("source.importFromFile"), {
              onClick: () => {
                if (srcInputRef.current) srcInputRef.current.click();
              }
            }),
            labeledBtn("ClipboardPaste", tr("source.importFromText"), {
              className: "primary",
              onClick: () => {
                const text = sourceDraft;
                if (!text.trim()) {
                  setStatus(tr("source.importEmpty"), "error");
                  return;
                }
                const result = importSourceText(text);
                if (result.error) {
                  setStatus(result.error, "error");
                } else {
                  let message = tr("source.importOk", { count: result.added });
                  if (result.updated) message += tr("source.importUpdated", { count: result.updated });
                  if (result.skipped) message += tr("source.importDup", { count: result.skipped });
                  setStatus(message, "success");
                  sourceDraft = "";
                  modalOpen = false;
                }
                panelStore.notify();
              }
            })
          ),
          h("div", { className: "nr-hint" }, tr("source.importModalHint"))
        )
      );
      return h(
        "div",
        { className: "nr-modal" },
        h("div", {
          className: "nr-modal-mask",
          onClick: () => {
            modalOpen = false;
            panelStore.notify();
          }
        }),
        card
      );
    }

    // 状态栏：按分级（info / success / error / loading）给出配色与图标；
    // error / loading 常驻并显示关闭按钮（自动消失的两类不显示，避免闪一下按钮）。
    const STATUS_ICONS = { info: "Info", success: "CircleCheck", error: "CircleAlert", loading: "LoaderCircle" };
    function statusBar() {
      if (!statusText) return h("div", { className: "nr-status" });
      const level = normalizeStatusLevel(statusLevel);
      const children = [
        h("span", { className: "nr-status-icon", key: "icon" }, icon(STATUS_ICONS[level], 13)),
        h("span", { className: "nr-status-text", key: "text", title: statusText }, statusText)
      ];
      if (level === "error" || level === "loading") {
        children.push(
          iconBtn("X", {
            key: "close",
            className: "nr-status-close",
            title: tr("action.close"),
            onClick: () => clearStatus()
          })
        );
      }
      return h("div", { className: "nr-status nr-status-" + level, role: "status" }, children);
    }

    // ---- 骨架 ----
    // 面板头副标题拆成独立订阅的薄组件：滚动期 headStore 只让它自己重渲染，
    // PanelView 不再整体重绘（目录 / 搜索结果列表因此不再每帧重建）。
    // 同时订阅 panelStore，书源切换 / 语言包等低频变更也能刷新头部文案。
    const HeadSub = R.useMemo(() => {
      const memo = typeof R.memo === "function" ? R.memo : (component) => component;
      return memo(function NrHeadSub() {
        const [, bumpHead] = R.useState(0);
        R.useEffect(() => {
          const unsubscribeHead = headStore.subscribe(() => bumpHead((n) => n + 1));
          const unsubscribePanel = panelStore.subscribe(() => bumpHead((n) => n + 1));
          return function () {
            unsubscribeHead();
            unsubscribePanel();
          };
        }, []);
        return h("div", { className: "nr-head-sub" }, headSubText());
      });
    }, []);

    let body = null;
    if (panelTab === "books") body = booksView();
    // 目录使用按域版本缓存的元素树，通知来自状态栏 / 搜索进度时不再整表重建
    else if (panelTab === "chapters") body = chaptersBody;
    else if (panelTab === "search") body = searchView();
    else if (panelTab === "sources") body = sourcesView();
    else if (panelTab === "keys") body = keysView();
    else if (panelTab === "data") body = dataView();
    else body = settingsView();

    return h(
      "div",
      { className: "nr-panel" },
      h(
        "div",
        { className: "nr-head" },
        h("div", { className: "nr-head-title" }, tr("plugin.name")),
        h(HeadSub, { key: "sub" })
      ),
      h(
        "div",
        { className: "nr-toolbar" },
        labeledBtn("Plus", tr("action.import"), {
          className: "primary",
          onClick: () => {
            if (txtInputRef.current) txtInputRef.current.click();
          }
        }),
        h(
          "button",
          {
            type: "button",
            className: "nr-btn",
            onClick: () => {
              if (winVisible()) hideWindow();
              else showWindow();
            }
          },
          h("span", null, winVisible() ? tr("win.hide") : tr("win.show"))
        )
      ),
      statusBar(),
      h(
        "div",
        { className: "nr-tabs" },
        PANEL_TABS.map((tab) =>
          h(
            "button",
            {
              key: tab.id,
              type: "button",
              className: "nr-tab" + (panelTab === tab.id ? " active" : ""),
              title: tr(tab.labelKey),
              onClick: () => goTab(tab.id)
            },
            icon(tab.icon, 14),
            h("span", { className: "nr-tab-text" }, tr(tab.labelKey))
          )
        )
      ),
      // 直接 createElement：缓存元素作为单个子节点原样传入，引用不变时 React 可整棵跳过协调；
      // 走 h() 会给它重新补 key 并 clone，虽然子节点仍可复用，但多了一层不必要的协调。
      create("div", { className: "nr-view" }, body),
      importModal(),
      h("input", {
        className: "nr-file",
        type: "file",
        accept: ".txt,text/plain",
        multiple: true,
        ref: txtInputRef,
        onChange: (e) => {
          // 先把选择结果快照成数组再清空：清空 value 会就地清空同一个 FileList
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          importFiles(files);
        }
      }),
      h("input", {
        className: "nr-file",
        type: "file",
        accept: ".json,application/json",
        ref: srcInputRef,
        onChange: async (e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          if (!files.length) return;
          try {
            // 书源文件与 TXT 一样可能是 GBK / GB18030 / UTF-16 或带 BOM：
            // 必须走原始字节通道解码，File.text() 固定按 UTF-8 解码会把中文规则变成替换字符。
            const buffer = await files[0].arrayBuffer();
            const text = normalizeText(decodeBuffer(buffer));
            const result = importSourceText(text);
            if (result.error) {
              setStatus(result.error, "error");
            } else {
              let message = tr("source.importOk", { count: result.added });
              if (result.updated) message += tr("source.importUpdated", { count: result.updated });
              if (result.skipped) message += tr("source.importDup", { count: result.skipped });
              setStatus(message, "success");
              sourceDraft = "";
              modalOpen = false;
            }
          } catch (err) {
            setStatus(tr("source.importFail", { error: (err && err.message) || String(err) }), "error");
          }
          if (!disposed) panelStore.notify();
        }
      })
    );
  }

  // 二次确认（删除书籍 / 删除书源 / 清空全部数据）：5 秒内再次点击才执行
  // 两个 armed 变量共用一个计时器，任何时刻只允许一个目标处于确认态；进入新的确认、
  // 超时、执行破坏性操作与面板卸载都必须走这里统一复位，避免旧目标永久停在确认态。
  function disarmAll() {
    if (armTimer) {
      clearTimeout(armTimer);
      armTimer = 0;
    }
    armedBookId = null;
    armedSourceId = null;
  }

  function armWith(assign, clear) {
    disarmAll();
    assign();
    armTimer = setTimeout(() => {
      armTimer = 0;
      clear();
      armedBookId = null;
      armedSourceId = null;
      panelStore.notify();
    }, 5000);
    panelStore.notify();
  }
  function armDeleteBook(bookId) {
    if (armedBookId !== bookId) {
      armWith(
        () => {
          armedBookId = bookId;
        },
        () => {
          armedBookId = null;
        }
      );
      return;
    }
    disarmAll();
    removeBook(bookId);
  }
  function armDeleteSource(sourceId) {
    if (armedSourceId !== sourceId) {
      armWith(
        () => {
          armedSourceId = sourceId;
        },
        () => {
          armedSourceId = null;
        }
      );
      return;
    }
    disarmAll();
    removeSource(sourceId);
    setStatus(tr("status.cleared"), "success");
    panelStore.notify();
  }
  function armClearAll() {
    if (armedBookId !== "__all__") {
      armWith(
        () => {
          armedBookId = "__all__";
        },
        () => {
          armedBookId = null;
        }
      );
      return;
    }
    disarmAll();
    clearAllData();
  }

  // 面板重绘入口：命令式代码通过这几个函数请求 React 重绘（保留原名，调用点无需改动）
  function renderView() {
    panelStore.notify();
  }
  function updatePanelHeadSub() {
    // 只通知面板头通道：滚动期不触发 PanelView 整树重渲染
    headStore.notify();
  }
  function refreshPanel() {
    panelStore.notify();
  }
  function syncControls() {
    panelStore.notify();
  }

  function updateSettings(patch) {
    Object.assign(state.settings, patch);
    // 纯视觉/纯状态设置只应用 CSS 变量与按钮外观；只有可能改变折行或视口几何的设置
    // 才重新测量行高与行顶端（避免 Alt+滚轮调透明度时遍历整段行元素）。
    const visualOnly = Object.keys(patch).every((key) => VISUAL_ONLY_SETTING_KEYS.indexOf(key) !== -1);
    if (visualOnly) applyVisual();
    else applyAll();
    if (Object.prototype.hasOwnProperty.call(patch, "winVisible")) {
      if (patch.winVisible) showWindow();
      else hideWindow(true);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "scriptConvert")) reopenForScriptChange();
    saveStateSoon();
    // 纯视觉设置（例如 Alt+滚轮调透明度）不改目录内容：只推进 shell 域，目录元素树继续复用。
    // 设置页滑块需要即时回显，字形转换会改变目录标题，非纯视觉项可能影响布局，这些仍整面板重绘。
    const needsFullRefresh =
      !visualOnly ||
      panelTab === "settings" ||
      Object.prototype.hasOwnProperty.call(patch, "scriptConvert");
    panelStore.notify(needsFullRefresh ? "all" : "shell");
  }

  // 字形转换改变后，已打开的书要按新字形重建正文（存储里仍是原文，重新渲染即可）
  function reopenForScriptChange() {
    const cur = runtime.current;
    if (!cur || !cur.id || disposed) return;
    const meta = state.books.find((b) => b.id === cur.id);
    if (!meta) return;
    if (meta.sourceId) {
      const index = typeof meta.chapterIndex === "number" ? meta.chapterIndex : 0;
      const offset = meta.progress && typeof meta.progress.offset === "number" ? meta.progress.offset : 0;
      openOnlineChapter(meta.id, index, offset);
      return;
    }
    // 本地书：清掉当前正文，让 openBook 重新从存储读取并按新字形转换
    runtime.current = null;
    openBook(meta.id);
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
    if (conflictName) setStatus(tr("keys.conflict", { action: conflictName }), "error");
    else if (keyIds.length) setStatus(tr("keys.saved", { keys: keyIds.map(formatKeyId).join(" / ") }), "success");
    else setStatus(tr("keys.cleared"), "success");
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
    // 键位按钮必须带 data-action（由 keysView 写入），此判据才成立；缺失时这里恒为假，
    // 捕获阶段会先取消录制、随后 click 又把同一动作设回录制，表现为「点同一按钮停不下来」。
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

  function openPluginPanel() {
    try {
      if (!api.write || typeof api.write.run !== "function") {
        log("open plugin panel skipped: api.write.run unavailable");
        setStatus(tr("status.panelUnavailable"), "error");
        return;
      }
      const request = api.write.run("pluginsSelf.openPanel", { panelId: PANEL_ID });
      // 宿主失败时以 resolve 返回 { ok: false, error }，catch 不会触发，必须读返回值判定
      if (request && typeof request.then === "function") {
        request
          .then((result) => {
            if (result && result.ok === false) {
              log("open plugin panel failed", result.error);
              setStatus(tr("status.panelFailed", { error: result.error || "" }), "error");
            }
          })
          .catch((err) => {
            log("open plugin panel failed", err);
            setStatus(tr("status.panelFailed", { error: (err && err.message) || String(err) }), "error");
          });
      }
    } catch (err) {
      log("open plugin panel failed", err);
    }
  }

  // ---------------- 清理 ----------------
  function stop() {
    if (disposed) return;
    disposed = true;
    if (timers.save) clearTimeout(timers.save);
    if (timers.scrollRaf) clearTimeout(timers.scrollRaf);
    if (timers.sleep) clearTimeout(timers.sleep);
    if (timers.snap) clearTimeout(timers.snap);
    cancelSnapAnim();
    cancelSegmentAnchor();
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = 0;
    // 卸载后不再做读档重试：即使回调抢跑，startToken 已自增也会让它失效。
    if (loadRetryTimer) {
      clearTimeout(loadRetryTimer);
      loadRetryTimer = 0;
    }
    stopAutoScroll();
    // 二次确认态、键位录制与指针交互状态不能跨 stop/start 保留：计时器被清掉后，
    // 残留的 armedBookId/armedSourceId 会让重开后的第一次点击直接执行删除或清空。
    disarmAll();
    recordingKey = null;
    runtime.hover = false;
    runtime.dragging = false;
    // 只在读档完成后写回：读档尚未完成时内存里还是初始空 state，写回会把存储里的
    // 书架与阅读进度清空（StrictMode 的 stop -> start 序列正好踩在这个窗口）。
    if (stateLoaded) saveStateNow();
    panelStore.listeners.clear();
    headStore.listeners.clear();
    // 窗口与全局监听一并卸下；下一次 start() 会通过 attachWindow() 重新建起来
    detachWindow();
    // 停止后 disposed 会被下一次 start() 复位（重新武装在途读取的检查），
    // 这里自增 openToken 作废上一轮读取，避免旧请求落到重启后的引擎里
    openToken += 1;
    // 同一轮启动的收尾也要作废：本次卸载之后，在途 start() 的后续步骤不得再执行
    startToken += 1;
  }

  // 启动：重新武装 -> 挂载窗口与监听 -> 读取存档 -> 恢复书源 -> 应用外观 -> 还原上次阅读位置
  // disposed 必须在这里复位：宿主在 StrictMode 下对挂载 effect 执行 setup -> cleanup -> setup，
  // 第一次 cleanup 的 stop() 已把 disposed 置真，不复位则 openBook / 搜索 / 导入会被全部拦下。
  async function start() {
    disposed = false;
    const token = ++startToken;
    if (loadRetryTimer) {
      clearTimeout(loadRetryTimer);
      loadRetryTimer = 0;
    }
    attachWindow();
    // 每轮启动统一复位：读档失败时不能沿用上一轮的已落地状态，
    // 也不能让上一轮迟到的读档结果被当成可写依据。
    stateLoaded = false;
    recoveryMode = false;
    const result = await loadState(token);
    // 异步读档期间可能被 stop() 打断（真实卸载）；此时窗口已拆除，后续收尾必须停止。
    // 同时校验本次代次：stop() 之后又被 start() 重新武装时，上一轮挂起的读档恢复后
    // 不能再继续执行收尾，否则同一份引擎会重复应用外观与打开书籍。
    if (disposed || token !== startToken || (result && result.canceled)) return;
    if (result && result.ok) {
      // 合并失败期间的保护快照；合并完成前 stateLoaded 保持 false，
      // 避免并发保存用半合并的 state 覆盖主档。本次会话已清空时只清理旧快照，不合并旧书。
      if (stateCleared) recoveryMerged = true;
      else await mergeRecovery(token);
      if (disposed || token !== startToken) return;
      stateLoaded = true;
      // 读档完成前的保存请求（以及旧格式目录迁移、恢复快照清理）在这里合并写一次；
      // 必须放在代次校验之后，避免 StrictMode 第一轮已作废的 start 抢先落盘。
      if (pendingSave || chaptersDirty.size || chaptersDeletes.size || recoveryMerged) {
        pendingSave = false;
        saveStateNow();
      }
    } else {
      // 主存档读不出来：先把旧恢复快照读入内存展示（只读），再改为写恢复快照。
      // 快照不会被本次空 state 覆盖：runSave 的恢复分支会先读基线再按 book id 合并。
      await adoptRecoverySnapshot(token);
      if (disposed || token !== startToken) return;
      stateLoaded = true;
      recoveryMode = true;
      setStatus(tr("status.loadFailed"), "error");
      if (pendingSave || chaptersDirty.size || chaptersDeletes.size) {
        pendingSave = false;
        saveStateNow();
      }
      scheduleLoadRetry(token);
    }
    await loadSources();
    if (disposed || token !== startToken) return;
    applyAll();
    refreshPanel();
    if (state.currentBookId) {
      const exists = state.books.some((b) => b.id === state.currentBookId);
      if (exists) await openBook(state.currentBookId);
      else state.currentBookId = null;
    } else {
      renderEmpty();
    }
    if (disposed || token !== startToken) return;
    if (state.settings.winVisible) showWindow();
    // winVisible 为假时无需显式隐藏：winEl 创建即 display:none，且 winVisible 与 display
    // 在 showWindow / hideWindow 中成对变更；此处原先的 hideWindow(true) 为幂等 no-op，
    // 删除不改变任何可观察行为。
    if (state.settings.autoScroll) startAutoScroll();
  }

  return {
    start: start,
    stop: stop,
    PanelView: PanelView,
    openPluginPanel: openPluginPanel,
    isDisposed: function () {
      return disposed;
    }
  };
}
