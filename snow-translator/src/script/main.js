// 客户端脚本入口：注入样式，挂载工具栏入口、翻译浮层、划词按钮与 AI 回复翻译按钮。
// 脚本插件没有面板容器，界面由脚本自建并挂在 body 上，关闭时仅隐藏不卸载。
import { h, render } from "preact";
import TranslatePanel from "../ui/panel.js";
import { createCard } from "../ui/card.js";
import { createTranslator } from "../engine/index.js";
import { createT } from "../i18n.js";
import { otherLanguage, TARGET_LANGUAGES } from "../languages.js";
import { loadSettings, normalizeSettings, saveSettings } from "../settings.js";
import { createStore } from "../store.js";
import { DEFAULT_LAYOUT_KEY, DEFAULT_SETTINGS, LAYOUT_KEY, MAX_SOURCE_CHARS } from "../constants.js";
// 长度护栏与卡片共用同一条实现：入口太多，不能各写一份截断逻辑。
import { clampSource, resultOutdated } from "../text-limit.js";
import { createLauncher } from "../host/launcher.js";
import { createSelectionTrigger } from "../host/selection.js";
import { createMessageActions } from "../host/message-actions.js";
import { copyText, inputField, readInputText, writeInputText } from "../host/dom.js";
import { errorDetail, toErrorPayload } from "../error-text.js";
import styles from "../../style.css";

const ROOT_ID = "snow-translator-root";
const NOTICE_MS = 2200;
const NOTICE_BAD_MS = 4200;
const MIN_DIMENSION = 8;
// 默认落点与输入框之间的距离，以及贴靠用的锚点。
const DEFAULT_GAP = 12;
const ANCHOR_SELECTOR = '[data-snow-anchor="chat.input"]';
// 聊天主视图 id：只有该视图渲染聊天输入栏。
const CHAT_VIEW = "chat";
// 输入停顿后自动翻译的防抖时长；过短会在连续输入时压满接口配额。
const AUTO_TRANSLATE_DELAY_MS = 700;
const AUTO_TRANSLATE_MIN_CHARS = 2;
// 自动翻译的长度上限：免费接口按 1500~3200 字符分片，长文会串行发出十余个请求并触发限流，
// 而且请求本身无法中断；超过该长度只保留手动翻译，由用户决定要不要等。
const AUTO_TRANSLATE_MAX_CHARS = 5000;
// 影响译文来源的设置键：这些键一变，已有翻译缓存就不再对应新配置。
const ENGINE_CONFIG_KEYS = ["engine", "fallback", "baidu", "deepl", "openai"];
// 设置落盘防抖：每次 GM_setValue 都是一次 IPC 加一次原生落库，输入较长的提示词时不能逐键写盘。
const SETTINGS_SAVE_DELAY_MS = 300;
// 恢复默认设置的待确认窗口：超时自动复位，避免误点后留下一个「已武装」的按钮。
const RESET_CONFIRM_MS = 5000;

function hasHost() {
  return (
    typeof snow !== "undefined" &&
    typeof snow.fetch === "function" &&
    typeof GM_getValue === "function" &&
    typeof GM_setValue === "function" &&
    typeof GM_addStyle === "function"
  );
}

function currentLocale() {
  try {
    return String((snow.context && snow.context.locale) || "zh-CN");
  } catch {
    return "zh-CN";
  }
}

// 宿主主视图 id：聊天视图才有聊天输入栏，浮层与入口按钮只在这个视图里成立。
function currentView() {
  try {
    return String((snow.context && snow.context.view) || "");
  } catch {
    return "";
  }
}

// 存储里的位置：窗口尺寸变了就按比例换算，避免换分辨率后跑偏。
function parseLayout(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null;
    const vw = Number(parsed.vw);
    const vh = Number(parsed.vh);
    if (Number.isFinite(vw) && Number.isFinite(vh) && vw > 0 && vh > 0) {
      const scaleX = window.innerWidth / vw;
      const scaleY = window.innerHeight / vh;
      if (Math.abs(scaleX - 1) > 0.02 || Math.abs(scaleY - 1) > 0.02) {
        return { left: parsed.left * scaleX, top: parsed.top * scaleY };
      }
    }
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
}

function storeLayout(key, layout) {
  try {
    if (!layout) {
      GM_setValue(key, "");
      return;
    }
    // 一并记下窗口尺寸，供下次按比例还原。
    GM_setValue(key, JSON.stringify({ ...layout, vw: window.innerWidth, vh: window.innerHeight }));
  } catch {
    // 忽略存储失败，界面仍可继续使用。
  }
}

function readLayout() {
  try {
    return parseLayout(GM_getValue(LAYOUT_KEY, ""));
  } catch {
    return null;
  }
}

function readDefaultLayout() {
  try {
    return parseLayout(GM_getValue(DEFAULT_LAYOUT_KEY, ""));
  } catch {
    return null;
  }
}

function writeLayout(layout) {
  storeLayout(LAYOUT_KEY, layout);
}

function writeDefaultLayout(layout) {
  storeLayout(DEFAULT_LAYOUT_KEY, layout);
}

// 设置合并且保留对应子对象：baidu / deepl / openai 的字段是逐项更新的。
function mergeSettings(base, patch) {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    const isNested =
      value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object";
    next[key] = isNested ? { ...base[key], ...value } : value;
  }
  return next;
}

function mount() {
  if (!hasHost()) {
    console.warn("[翻译助手] 当前宿主缺少 snow.fetch / GM_* 能力，脚本未启动。");
    return;
  }

  GM_addStyle(styles);

  const t = createT(currentLocale);
  const initialSettings = loadSettings();
  const store = createStore({
    locale: currentLocale(),
    open: false,
    view: "translate",
    settings: initialSettings,
    source: initialSettings.sourceLang,
    target: initialSettings.targetLang,
    text: "",
    loading: false,
    result: null,
    error: null,
    notice: "",
    noticeTone: "",
    testing: false,
    testResult: null,
    // 「恢复默认设置」的两步确认状态：第一次点击只置位，不写盘。
    confirmReset: false,
  });

  const translator = createTranslator({
    getSettings: () => store.get().settings,
    getLocale: currentLocale,
    fetchImpl: (input, init) => snow.fetch(input, init),
  });

  let noticeTimer = 0;
  // 设置落盘的防抖定时器：见 scheduleSaveSettings 与 flushSettings。
  let settingsSaveTimer = 0;
  // 「恢复默认设置」的待确认定时器。
  let resetConfirmTimer = 0;
  let drag = null;
  // 位置来源：false = 自动落点（跟随窗口重算），true = 用户拖过或存过（只做边界收敛）。
  let pinned = false;
  // 翻译页的位置记忆：设置页更高更矮都不参与，避免两种视图互相带偏落点。
  let translateLayout = null;
  // 默认位置基线：只认用户拖好的位置。
  // 启动时若已有临时位置而基线为空，就把这个位置升级为基线（一次性的初始认领）。
  let defaultLayout = readDefaultLayout();
  if (!defaultLayout) {
    const savedLayout = readLayout();
    if (savedLayout) {
      defaultLayout = savedLayout;
      writeDefaultLayout(savedLayout);
    }
  }

  // tone 决定提示语气：ok / bad 上色，失败提示停留更久（错误文案更长，2 秒读不完）。
  function notify(message, tone = "") {
    store.set({ notice: message, noticeTone: tone });
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      noticeTimer = 0;
      store.set({ notice: "", noticeTone: "" });
    }, tone === "bad" ? NOTICE_BAD_MS : NOTICE_MS);
  }

  // 超长输入被截断时提示一次：语气用 bad，提示停留时间更长，用户能看清上限值。
  function warnSourceTooLong() {
    notify(t("st.textTooLong", { max: MAX_SOURCE_CHARS }), "bad");
  }

  // from 只给卡片路径覆盖：面板要跟随用户选的源语言，卡片必须自己自动检测，
  // 否则面板里临时改过的源语言（会被持久化）会让划词与消息翻译一直以错误语种请求。
  async function translate(text, target, from) {
    return translator.translate({
      text: String(text ?? ""),
      from: from || store.get().source,
      to: target || store.get().target,
    });
  }

  // ---------------- 浮层宿主 ----------------

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.className = "st-root";
  root.hidden = !store.get().open;
  document.body.append(root);

  // 同步定位：只写内联样式，不动可见性。面板已经在屏幕上时一律走这里，
  // 先隐藏再定位会丢掉一帧，表现为「闪一下」。
  function applyPosition(left, top) {
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.right = "auto";
    root.style.marginLeft = "0";
    root.style.marginRight = "0";
  }

  function pin(left, top) {
    // 只给首次出现用：先藏起来再定位，避免首帧画在 CSS 兜底位置（顶部居中）后跳一下。
    root.style.visibility = "hidden";
    applyPosition(left, top);
    requestAnimationFrame(() => {
      clampIntoView();
      root.style.visibility = "";
    });
  }

  function clampIntoView() {
    if (root.hidden) return;
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const maxLeft = Math.max(MIN_DIMENSION, window.innerWidth - rect.width - MIN_DIMENSION);
    const maxTop = Math.max(MIN_DIMENSION, window.innerHeight - rect.height - MIN_DIMENSION);
    const left = Math.min(Math.max(MIN_DIMENSION, rect.left), maxLeft);
    const top = Math.min(Math.max(MIN_DIMENSION, rect.top), maxTop);
    if (Math.round(left) !== Math.round(rect.left)) root.style.left = `${Math.round(left)}px`;
    if (Math.round(top) !== Math.round(rect.top)) root.style.top = `${Math.round(top)}px`;
  }

  // 没有保存位置时的默认落点：贴着聊天输入框上方弹出（上方放不下就翻到下方），
  // 水平居中于输入框。拿不到输入框时退到窗口居中偏上，不再固定钉在 88px 顶部。
  // conceal 只在首帧需要：此时面板还没画出来，先遮住可以避免在兜底位置上被看到。
  function placeDefault(conceal = true) {
    if (root.hidden) return;
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const anchor = document.querySelector(ANCHOR_SELECTOR);
    const anchorRect = anchor instanceof Element ? anchor.getBoundingClientRect() : null;
    const maxLeft = Math.max(MIN_DIMENSION, window.innerWidth - rect.width - MIN_DIMENSION);
    const maxTop = Math.max(MIN_DIMENSION, window.innerHeight - rect.height - MIN_DIMENSION);

    let left = (window.innerWidth - rect.width) / 2;
    let top = window.innerHeight * 0.12;
    if (anchorRect && anchorRect.width > 0) {
      left = anchorRect.left + anchorRect.width / 2 - rect.width / 2;
      top = anchorRect.top - rect.height - DEFAULT_GAP;
      if (top < MIN_DIMENSION) top = anchorRect.bottom + DEFAULT_GAP;
    }
    const layout = {
      left: Math.round(Math.min(Math.max(MIN_DIMENSION, left), maxLeft)),
      top: Math.round(Math.min(Math.max(MIN_DIMENSION, top), maxTop)),
    };
    // 这里只是兜底落点，不写进默认位置：默认位置只认用户拖好的位置。
    if (conceal) pin(layout.left, layout.top);
    else applyPosition(layout.left, layout.top);
  }

  // 面板当前的左上角坐标：用于记录/恢复翻译页的位置。
  function currentLayout() {
    if (root.hidden) return null;
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { left: Math.round(rect.left), top: Math.round(rect.top) };
  }

  function relayout() {
    if (root.hidden) return;
    // 面板已经在屏幕上：只挪位置，不再走先隐藏的首次定位。
    if (pinned) clampIntoView();
    else placeDefault(false);
  }

  function applyLayout() {
    // 内存里已有翻译页的位置就不必再读盘、更不必重新算落点。
    if (translateLayout) {
      pinned = true;
      pin(translateLayout.left, translateLayout.top);
      return;
    }
    const layout = readLayout();
    pinned = Boolean(layout);
    if (layout) {
      translateLayout = layout;
      pin(layout.left, layout.top);
      return;
    }
    if (defaultLayout) {
      pinned = true;
      translateLayout = defaultLayout;
      pin(defaultLayout.left, defaultLayout.top);
      return;
    }
    // 先清空内联定位，让面板按 CSS 算出真实尺寸，再贴着输入框落位。
    // 落位前先隐藏，避免首帧画在 CSS 兜底位置上。
    root.style.visibility = "hidden";
    root.style.left = "";
    root.style.top = "";
    root.style.right = "";
    root.style.marginLeft = "";
    root.style.marginRight = "";
    requestAnimationFrame(() => placeDefault(true));
  }

  function setOpen(next) {
    const state = store.get();
    if (state.open === next) return;
    if (next) {
      // 打开浮层时收起划词卡片：同一时刻只保留一套界面。
      if (card.isOpen()) card.hide();
      const patch = { open: true, view: "translate" };
      // 打开时把选中的聊天文字带进来：从划词卡片跳转过来的场景已经填过，不覆盖。
      if (!state.text && state.settings.autoFillSelection) {
        const selection = window.getSelection();
        const selected = selection ? selection.toString().trim() : "";
        if (selected && selected.length <= 8000) {
          patch.text = selected;
          patch.result = null;
          patch.error = null;
        }
      }
      store.set(patch);
      root.hidden = false;
      applyLayout();
      requestAnimationFrame(() => {
        const textarea = root.querySelector(".st-textarea");
        if (textarea instanceof HTMLElement) textarea.focus();
      });
      if (String(store.get().text || "").trim().length >= AUTO_TRANSLATE_MIN_CHARS) {
        scheduleAutoTranslate(150);
      }
    } else {
      cancelAutoTranslate();
      // 关闭前补写：宿主的 GM_setValue 是异步 IPC 且失败会被静默吞掉，防抖窗口里的最后一次输入不能等。
      flushSettings();
      disarmReset();
      // 关闭前记住翻译页的当前位置：下次打开就回到这一处，不再重新算落点。
      // 设置页更高，不参与位置记忆，避免把翻译页的落点带偏。
      if (store.get().view === "translate") {
        const layout = currentLayout();
        if (layout) {
          translateLayout = layout;
          writeLayout(layout);
        }
      }
      store.set({ open: false, view: "translate", notice: "", noticeTone: "" });
      root.hidden = true;
    }
    launcher.setActive(next);
  }

  // ---------------- 面板动作 ----------------

  async function runPanelTranslate() {
    const state = store.get();
    // 最后一道闸：即便将来新增入口忘了收敛，也不会把超长文本送到网络层。
    const text = clampSource(state.text).text.trim();
    if (!text) {
      store.set({ loading: false, result: null, error: { code: "EMPTY", message: "" } });
      return;
    }
    // 发起时的快照：回填前必须确认文本与语言仍然是这一次的内容，
    // 否则改字或改语言之后，先前那次请求的译文会写到新内容下面。
    const snapshot = { text, source: state.source, target: state.target };
    store.set({ loading: true, error: null });
    const id = (runPanelTranslate.requestId += 1);
    try {
      // from 必须显式传快照：包装函数默认读 store，改过语言之后就不再同源。
      const result = await translate(snapshot.text, snapshot.target, snapshot.source);
      if (id !== runPanelTranslate.requestId) return;
      if (!stillCurrent(snapshot)) {
        // 只收起加载态：已有译文与错误保持原样，界面也不会停在「翻译中」。
        store.set({ loading: false });
        return;
      }
      store.set({ loading: false, result, error: null });
    } catch (error) {
      if (id !== runPanelTranslate.requestId) return;
      if (!stillCurrent(snapshot)) {
        store.set({ loading: false });
        return;
      }
      store.set({ loading: false, result: null, error: toErrorPayload(error) });
    }
  }
  runPanelTranslate.requestId = 0;

  // 面板里的内容是否仍是发起翻译时那一次：按同一条长度护栏归一化后比对，避免首尾空白误判。
  function stillCurrent(snapshot) {
    const state = store.get();
    return (
      clampSource(state.text).text.trim() === snapshot.text &&
      state.source === snapshot.source &&
      state.target === snapshot.target
    );
  }

  // 作废在途翻译：id 一变，上面两处 id 校验必然失败，旧响应不会再写回 store。
  // 旧响应也不会再收 loading，所以 loading 必须和本次内容一起写入，否则界面会一直停在「翻译中」。
  // 改文本 / 改语言时只传新值、不传 result，已有译文不会被清掉。
  function invalidateInflight(patch) {
    runPanelTranslate.requestId += 1;
    store.set({ loading: false, ...patch });
  }

  // ---------------- 自动翻译 ----------------

  let autoTimer = 0;
  let autoSignature = "";
  // 已提示过「长文不自动翻译」的签名：只在首次跨过阈值时提示，避免每次停顿都弹一次。
  let autoLongWarned = "";

  function cancelAutoTranslate() {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = 0;
  }

  // 输入停顿后自动翻译：文本与语言都没变化就不重复请求，正在翻译时顺延再试。
  function scheduleAutoTranslate(delay = AUTO_TRANSLATE_DELAY_MS) {
    cancelAutoTranslate();
    autoTimer = setTimeout(() => {
      autoTimer = 0;
      const state = store.get();
      if (!state.open || state.view !== "translate") return;
      if (!state.settings.autoTranslate) return;
      const text = String(state.text || "").trim();
      if (text.length < AUTO_TRANSLATE_MIN_CHARS) return;
      const signature = `${state.source}|${state.target}|${text}`;
      // 长文不自动翻译：粘贴一次就会按分片串行发出十余个请求，既容易触发限流，也没有中断手段。
      if (text.length > AUTO_TRANSLATE_MAX_CHARS) {
        // 记下签名，让同一段长文在后续输入停顿里不再重复提示。
        autoSignature = signature;
        if (signature !== autoLongWarned) {
          autoLongWarned = signature;
          notify(t("st.autoTranslateTooLong", { max: AUTO_TRANSLATE_MAX_CHARS }), "bad");
        }
        return;
      }
      if (state.loading) {
        scheduleAutoTranslate(300);
        return;
      }
      if (signature === autoSignature) return;
      autoSignature = signature;
      void runPanelTranslate();
    }, delay);
  }

  // 撤销「恢复默认设置」的待确认状态；没有待确认状态时什么都不做，避免多余的渲染。
  function disarmReset() {
    if (!resetConfirmTimer && !store.get().confirmReset) return;
    if (resetConfirmTimer) clearTimeout(resetConfirmTimer);
    resetConfirmTimer = 0;
    store.set({ confirmReset: false });
  }

  function cancelPendingSave() {
    if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
    settingsSaveTimer = 0;
  }

  // 立即落盘：读的是 store 当前值，不能用排期时的快照，否则会用旧配置覆盖后来的修改。
  function flushSettings() {
    cancelPendingSave();
    return saveSettings(store.get().settings);
  }

  // 输入过程只排期：store 仍逐键更新（受控输入不会回弹），写盘合并成一次。
  function scheduleSaveSettings() {
    cancelPendingSave();
    settingsSaveTimer = setTimeout(() => {
      settingsSaveTimer = 0;
      saveSettings(store.get().settings);
    }, SETTINGS_SAVE_DELAY_MS);
  }

  function persistLanguages(patch) {
    const settings = saveSettings(mergeSettings(store.get().settings, patch));
    // 这次写已经把防抖窗口里的输入一并带上，撤掉多余的那一次。
    cancelPendingSave();
    store.set({ settings });
  }

  const actions = {
    close() {
      setOpen(false);
    },
    toggleView() {
      // 切换视图即放弃待确认状态，避免离开设置页再回来时按钮还处于「已武装」。
      disarmReset();
      const state = store.get();
      if (state.view === "settings") {
        // 切回翻译页：面板变矮，位置沿用翻译页记住的落点。
        // 定位必须在改变视图之前同步完成，且不能走 pin（pin 会先隐藏一帧，
        // 切换时会被看成面板闪一下）；渲染后再收敛一次边界即可。
        const layout = translateLayout || defaultLayout;
        if (layout) {
          pinned = true;
          applyPosition(layout.left, layout.top);
        }
        store.set({ view: "translate" });
        if (layout) requestAnimationFrame(clampIntoView);
        else requestAnimationFrame(relayout);
        scheduleAutoTranslate(150);
        return;
      }
      // 切到设置页：先记住翻译页位置，再只做边界收敛（设置页更高，可能超出窗口）。
      translateLayout = currentLayout() || translateLayout;
      // 顺手落盘：即便之后从设置页关闭，翻译页的位置也不会丢。
      if (translateLayout) writeLayout(translateLayout);
      store.set({ view: "settings" });
      // 设置页更高，可能超出窗口：渲染是微任务，这里紧跟一次微任务收敛边界，
      // 就能在绘制之前挪好位置，不会先画出溢出的一帧；rAF 作为兜底。
      queueMicrotask(clampIntoView);
      requestAnimationFrame(clampIntoView);
      cancelAutoTranslate();
    },
    setText(text) {
      const next = clampSource(text);
      if (next.truncated) {
        // 文本已被改写：旧译文不再对应，在途请求的结果也必须丢弃（否则会写回到新文本上）。
        invalidateInflight({ text: next.text, result: null, error: null });
        warnSourceTooLong();
      } else {
        // 普通改字同样让旧请求作废：快照比对会拦住回填，这里再把等待一并收掉（译文先留着）。
        invalidateInflight({ text: next.text });
      }
      scheduleAutoTranslate();
    },
    setSource(source) {
      // 语言变了，在途请求所用的源语言就不再对应当前选择：作废它，已有译文先留着。
      invalidateInflight({ source });
      persistLanguages({ sourceLang: source });
      scheduleAutoTranslate(200);
    },
    setTarget(target) {
      // 目标语言变了同理：旧请求的译文不能落到新语言下面。
      invalidateInflight({ target });
      persistLanguages({ targetLang: target });
      scheduleAutoTranslate(200);
    },
    swap() {
      const state = store.get();
      const detected = state.result && state.result.detected;
      const wanted = state.source === "auto" ? otherLanguage(state.target, detected) : state.source;
      // 检测值未必是内部语言码（DeepL 的 ZH 小写后是 zh，谷歌 / 百度也可能给出清单外语种）：
      // 不在目标语言清单里就退回自动择向，否则下拉只能显示原始码，落盘时又被归一回 auto，内存与设置会分叉。
      const nextTarget = TARGET_LANGUAGES.includes(wanted) ? wanted : "auto";
      invalidateInflight({ source: state.target, target: nextTarget, error: null });
      persistLanguages({ sourceLang: state.target, targetLang: nextTarget });
      scheduleAutoTranslate(200);
    },
    clear() {
      cancelAutoTranslate();
      autoSignature = "";
      autoLongWarned = "";
      // 清空即放弃这次翻译：旧译文、旧错误与加载态一并收掉。
      invalidateInflight({ text: "", result: null, error: null });
    },
    translate() {
      // 手动触发后同步签名，避免紧接着的自动翻译重复请求同一段文本。
      const state = store.get();
      autoSignature = `${state.source}|${state.target}|${String(state.text || "").trim()}`;
      void runPanelTranslate();
    },
    readInput() {
      const next = clampSource(readInputText());
      if (!next.text) {
        notify(t("st.inputEmpty"), "bad");
        return;
      }
      // 整段换掉文本：旧请求不再对应新内容，截断与否都要作废。
      // 同时清掉自动翻译签名，读入同一段文本时才不会因签名相同被挡掉。
      autoSignature = "";
      invalidateInflight({ text: next.text, result: null, error: null });
      if (next.truncated) warnSourceTooLong();
      scheduleAutoTranslate(150);
    },
    warnSourceTooLong,
    writeInput() {
      const result = store.get().result;
      if (!result) return;
      // 译文来自上一段文本时不允许整段替换：否则会覆盖用户刚改好的草稿。
      if (resultOutdated(result, store.get().text)) {
        notify(t("st.resultStale"), "bad");
        return;
      }
      if (!inputField()) {
        notify(t("st.inputMissing"), "bad");
        return;
      }
      if (!writeInputText(result.text)) {
        notify(t("st.writeFail"), "bad");
        return;
      }
      notify(t("st.written"), "ok");
    },
    copy() {
      const result = store.get().result;
      if (!result) return;
      // 复制不会覆盖草稿，只提示译文已过期，不阻断用户的复制操作。
      if (resultOutdated(result, store.get().text)) notify(t("st.resultStale"), "bad");
      void copyText(result.text).then((ok) => notify(t(ok ? "st.copied" : "st.copyFail"), ok ? "ok" : "bad"));
    },
    updateSettings(patch) {
      // 有待确认的重置时，任何设置改动都视为放弃重置。
      disarmReset();
      // 只更新内存（normalize 与 saveSettings 内部一致），写盘交给防抖。
      const settings = normalizeSettings(mergeSettings(store.get().settings, patch));
      // 引擎或密钥变了，上一次的测试结论就不再对应当前配置，直接清掉。
      const next = { settings, testResult: null };
      // 密钥 / 模型 / 提示词 / 兜底开关都不进缓存键：改了就得丢掉旧译文，
      // 否则同一段文本会直接命中上一套配置的结果（连旧的回退标记一起被复用）。
      if (ENGINE_CONFIG_KEYS.some((key) => Object.prototype.hasOwnProperty.call(patch, key))) {
        translator.clearCache();
        // 与 resetSettings 一致：清掉自动翻译签名，回到翻译页才会真正重译。
        autoSignature = "";
      }
      if (Object.prototype.hasOwnProperty.call(patch, "sourceLang")) next.source = settings.sourceLang;
      if (Object.prototype.hasOwnProperty.call(patch, "targetLang")) next.target = settings.targetLang;
      store.set(next);
      scheduleSaveSettings();
      selectionTrigger.refresh();
      messageActions.refresh();
      scheduleAutoTranslate(150);
    },
    resetSettings() {
      // 清空已填写的 API Key 不可恢复：第一次点击只进入待确认状态，5 秒内再点一次才真正执行。
      if (!store.get().confirmReset) {
        store.set({ confirmReset: true });
        notify(t("st.settings.resetConfirm"), "bad");
        if (resetConfirmTimer) clearTimeout(resetConfirmTimer);
        resetConfirmTimer = setTimeout(() => {
          resetConfirmTimer = 0;
          store.set({ confirmReset: false });
        }, RESET_CONFIRM_MS);
        return;
      }
      if (resetConfirmTimer) clearTimeout(resetConfirmTimer);
      resetConfirmTimer = 0;
      store.set({ confirmReset: false });
      // 先撤掉挂起的防抖，避免重置后又把默认值多写一遍。
      cancelPendingSave();
      const settings = saveSettings(DEFAULT_SETTINGS);
      store.set({ settings, source: settings.sourceLang, target: settings.targetLang, testResult: null });
      // 设置整体回到默认（引擎与凭证全部复位）：旧译文一律不再可信。
      translator.clearCache();
      // 位置一起回到「默认位置」：默认位置就是你拖好的那处，不是首次打开的自动落点。
      const baseline = readDefaultLayout() || defaultLayout;
      if (baseline) {
        defaultLayout = baseline;
        translateLayout = baseline;
        pinned = true;
        // 同时写回当前位置，之后关闭 / 重开都不会漂回别处。
        writeLayout(baseline);
        // 面板已经在屏幕上：同步挪回基线，不再走会隐藏一帧的首次定位。
        if (!root.hidden) {
          applyPosition(baseline.left, baseline.top);
          requestAnimationFrame(clampIntoView);
        }
      } else {
        translateLayout = null;
        pinned = false;
        if (!root.hidden) relayout();
      }
      notify(t("st.settings.resetDone"), "ok");
      selectionTrigger.refresh();
      messageActions.refresh();
      autoSignature = "";
      scheduleAutoTranslate(150);
    },
    async testEngine() {
      // 先落盘：让「测试通过」对应的就是已保存的配置。
      flushSettings();
      const engine = store.get().settings.engine;
      const startedAt = Date.now();
      store.set({ testing: true, testResult: null });
      try {
        const result = await translator.test({ text: "Hello", to: store.get().target });
        store.set({
          testing: false,
          testResult: {
            ok: true,
            engine: result.engine || engine,
            elapsedMs: Math.max(0, Number(result.elapsedMs) || 0),
            text: String(result.text || ""),
            at: Date.now(),
          },
        });
      } catch (error) {
        // 失败时保留 code / reason / 原始错误：设置页据此给出具体原因与下一步建议。
        const payload = toErrorPayload(error);
        store.set({
          testing: false,
          testResult: {
            ok: false,
            engine: payload.engine || engine,
            code: payload.code,
            reason: payload.reason,
            status: payload.status,
            message: payload.message,
            detail: errorDetail(error),
            elapsedMs: Math.max(0, Date.now() - startedAt),
            at: Date.now(),
          },
        });
      }
    },
  };

  render(h(TranslatePanel, { store, t, actions }), root);

  // ---------------- 划词 / 消息翻译卡片 ----------------

  const card = createCard({
    t,
    getLocale: currentLocale,
    // 卡片固定自动检测源语言：面板的源语言会被持久化，不能让它静默决定卡片译文。
    translate: (text, target) => translate(text, target, "auto"),
    // 只回传复制结果：提示由卡片自己渲染（卡片场景下浮层是隐藏的，面板提示看不见）。
    copy: (text) => copyText(text),
    onOpenPanel: ({ text, result }) => {
      // 从卡片跳到浮层：关掉卡片，避免两套界面叠在一起。
      card.hide();
      setOpen(true);
      const next = clampSource(text);
      store.set({
        text: next.text,
        // 文本被截断时旧译文对应的是全文，不能再跟着显示。
        result: next.truncated ? null : result || null,
        error: null,
        loading: false,
        view: "translate",
      });
      if (next.truncated) warnSourceTooLong();
      // 卡片已带结果时不必再请求一次；只有缺结果或文本被截断时才走自动翻译。
      if (next.truncated || !result) {
        autoSignature = "";
        scheduleAutoTranslate(150);
      }
    },
  });

  // ---------------- 入口与消息按钮 ----------------

  const launcher = createLauncher({
    getLabel: () => t("st.launcher"),
    onToggle: () => setOpen(!store.get().open),
  });

  const selectionTrigger = createSelectionTrigger({
    getLabel: () => t("st.selectionLabel"),
    enabled: () => store.get().settings.selectionButton,
    onTranslate: ({ text, rect }) => {
      // 卡片与浮层不同时留着：划词时以卡片为主。
      if (store.get().open) setOpen(false);
      card.show({ text, target: store.get().target, rect });
    },
  });

  const messageActions = createMessageActions({
    getLabel: () => t("st.messageLabel"),
    enabled: () => store.get().settings.messageButton,
    onTranslate: ({ text, getAnchorRect }) => {
      if (store.get().open) setOpen(false);
      card.show({ text, target: store.get().target, getAnchorRect });
    },
  });

  launcher.mount();
  launcher.setActive(store.get().open);
  selectionTrigger.refresh();
  messageActions.start();

  // ---------------- 浮层拖动 ----------------

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !target.closest("[data-st-drag]")) return;
    if (target.closest("button, input, textarea, select, a, [data-no-drag]")) return;
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      finalLeft: rect.left,
      finalTop: rect.top,
      moved: false,
    };
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    root.style.right = "auto";
    root.style.marginLeft = "0";
    root.style.marginRight = "0";
    root.classList.add("is-dragging");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    drag.moved = true;
    const rect = root.getBoundingClientRect();
    const maxLeft = Math.max(MIN_DIMENSION, window.innerWidth - rect.width - MIN_DIMENSION);
    const maxTop = Math.max(MIN_DIMENSION, window.innerHeight - rect.height - MIN_DIMENSION);
    const left = Math.min(Math.max(MIN_DIMENSION, drag.left + dx), maxLeft);
    const top = Math.min(Math.max(MIN_DIMENSION, drag.top + dy), maxTop);
    drag.finalLeft = left;
    drag.finalTop = top;
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
  }

  function onPointerUp() {
    if (!drag) return;
    const moved = drag.moved;
    const left = drag.finalLeft;
    const top = drag.finalTop;
    drag = null;
    root.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    if (moved) {
      pinned = true;
      if (store.get().view === "translate") {
        const layout = { left: Math.round(left), top: Math.round(top) };
        translateLayout = layout;
        writeLayout(layout);
        // 只有还没有基线时才认领：默认位置取你拖好的那处，绝不取首次打开的自动落点；
        // 之后把面板挪到别处也不会悄悄改掉它，「恢复默认设置」才回得去。
        if (!defaultLayout) {
          defaultLayout = layout;
          writeDefaultLayout(layout);
        }
      }
    }
  }

  function onResize() {
    // 自动落点要跟着窗口重算；用户固定的位置只保证不越界。
    relayout();
  }

  function onKeyDown(event) {
    if (event.key !== "Escape") return;
    // 下拉展开时 Esc 只收起下拉，不关卡片与浮层（否则一次 Esc 连关两层）。
    if (document.querySelector(".st-card-host .st-dropdown-menu")) return;
    if (card.isOpen()) {
      card.hide();
      return;
    }
    if (!store.get().open) return;
    if (root.querySelector(".st-dropdown-menu")) return;
    const target = event.target instanceof Element ? event.target : null;
    // 焦点在聊天输入框时 Esc 归宿主（收大屏输入等），不抢。
    if (target && target.closest('[data-snow-anchor="chat.input"]')) return;
    if (target && !target.closest(`#${ROOT_ID}`) && target !== document.body) return;
    setOpen(false);
  }

  // 点击浮层之外的任何地方都收起面板；入口按钮与划词/消息按钮算「自己人」，
  // 否则点它们时会先把面板关掉，出现闪烁或面板顶掉卡片的观感。
  const CHROME_SELECTOR = ".st-launcher, .st-selection-btn, .st-msg-btn";

  function onDocumentPointerDown(event) {
    if (!store.get().open) return;
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (root.contains(target) || target.closest(CHROME_SELECTOR)) return;
    setOpen(false);
  }

  root.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", onResize);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);

  // ---------------- 宿主事件 ----------------

  let lastLocale = currentLocale();
  // 宿主主视图：离开聊天视图后入口按钮会随聊天输入栏一起卸载，浮层与卡片必须自己收起来。
  let lastView = currentView();

  snow.on("context", () => {
    const view = currentView();
    if (view !== lastView) {
      lastView = view;
      // 只在确定处于非聊天视图时收起：启动早期的空视图不误关。
      if (view && view !== CHAT_VIEW) {
        if (card.isOpen()) card.hide();
        setOpen(false);
      }
      // 回到聊天视图时消息列表是新建的节点，按钮要重新挂到新的插槽上。
      messageActions.refresh();
    }
    const locale = currentLocale();
    if (locale !== lastLocale) {
      lastLocale = locale;
      store.set({ locale });
      launcher.refresh();
      selectionTrigger.refresh();
      messageActions.refresh();
      card.hide();
    }
    launcher.refresh();
  });
  snow.on("conversation-change", () => messageActions.refresh());

  snow.onCleanup(() => {
    // 脚本卸载 / 重装前，把防抖窗口里还没落盘的设置写掉。
    flushSettings();
    cancelAutoTranslate();
    autoSignature = "";
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = 0;
    if (resetConfirmTimer) clearTimeout(resetConfirmTimer);
    resetConfirmTimer = 0;
    if (drag) {
      drag = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    }
    window.removeEventListener("resize", onResize);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    root.removeEventListener("pointerdown", onPointerDown);
    launcher.dispose();
    selectionTrigger.dispose();
    messageActions.dispose();
    card.dispose();
    render(null, root);
    root.remove();
  });
}

mount();
