// 客户端脚本入口：注入样式、挂载聊天输入框入口与浮层工作台。
// 脚本插件没有面板容器，界面由脚本自建并挂在 body 上，关闭时仅隐藏不卸载。
import { h, render } from "preact";
import FixBenchPanel from "../ui/panel.js";
import { resolveEngine } from "../engine.js";
import { createT } from "../i18n.js";
import { createScriptApi, hasScriptHost } from "./api.js";
import styles from "../../style.css";

const ROOT_CLASS = "fx-overlay";
const CHAT_LAUNCHER_CLASS = "fx-chat-launcher";
const VISIBLE_KEY = "fixbench:ui:open";
const POSITION_KEY = "fixbench:ui:pos";
const NARROW_QUERY = "(max-width: 760px)";
// 与 style.css 中 .fx-overlay 的 width: min(980px, calc(100vw - 32px)) 保持一致。
const OVERLAY_MAX_WIDTH = 980;
const OVERLAY_VIEWPORT_GUTTER = 32;

function readVisible() {
  try {
    const raw = GM_getValue(VISIBLE_KEY, "1");
    return raw !== "0" && raw !== 0 && raw !== false;
  } catch {
    return true;
  }
}

function writeVisible(visible) {
  try {
    GM_setValue(VISIBLE_KEY, visible ? "1" : "0");
  } catch {
    // 忽略存储失败，界面仍可继续使用。
  }
}

function readPosition() {
  try {
    const raw = GM_getValue(POSITION_KEY, "");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
}

function writePosition(position) {
  try {
    GM_setValue(POSITION_KEY, position ? JSON.stringify(position) : "");
  } catch {
    // 忽略存储失败，界面仍可继续使用。
  }
}

function currentLocale() {
  try {
    return String((snow.context && snow.context.locale) || "zh-CN");
  } catch {
    return "zh-CN";
  }
}

function launcherLabel() {
  return createT(() => currentLocale())("fx.launcher");
}

// 聊天输入框入口用的扳手图标。
function wrenchIcon(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
}

const CHAT_LAUNCHER_ICON = wrenchIcon(14);

function mount() {
  if (!hasScriptHost()) {
    console.warn("[修复工作台] 当前宿主缺少 snow.metadata / snow.write 能力，脚本未启动。");
    return;
  }

  GM_addStyle(styles);

  const api = createScriptApi();
  const engine = resolveEngine(api);
  let visible = readVisible();

  const root = document.createElement("div");
  root.id = "snow-fix-bench-root";
  root.className = `${ROOT_CLASS}${visible ? "" : " is-hidden"}`;
  document.body.append(root);

  let chatLauncherButton = null;
  let lastAttachAt = 0;
  let attachBurst = 0;
  let lastYoloPresent = null;

  const isNarrow = () => window.matchMedia(NARROW_QUERY).matches;

  function clearInlinePosition() {
    root.style.left = "";
    root.style.top = "";
    root.style.right = "";
    root.style.bottom = "";
    root.style.marginLeft = "";
    root.style.marginRight = "";
  }

  // 浮层默认用左右 auto margin 居中；拖动后改为显式 left/top 并取消居中 margin。
  function pinTo(left, top) {
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.style.marginLeft = "0";
    root.style.marginRight = "0";
  }

  // 隐藏时元素没有布局盒，getBoundingClientRect / offsetWidth 的宽度都是 0：
  // 按 CSS 宽度公式兜底，避免把浮层位置夹到屏幕外。
  function overlayWidth() {
    const width = root.getBoundingClientRect().width;
    if (width > 0) return width;
    return Math.max(0, Math.min(OVERLAY_MAX_WIDTH, window.innerWidth - OVERLAY_VIEWPORT_GUTTER));
  }

  function applyPosition(position) {
    if (isNarrow()) {
      clearInlinePosition();
      return;
    }
    if (!position) return;
    const maxLeft = Math.max(8, window.innerWidth - overlayWidth() - 8);
    const maxTop = Math.max(8, window.innerHeight - 80);
    pinTo(
      Math.min(Math.max(8, position.left), maxLeft),
      Math.min(Math.max(8, position.top), maxTop),
    );
  }

  let drag = null;

  function onPointerMove(event) {
    if (!drag) return;
    const maxLeft = Math.max(8, window.innerWidth - drag.width - 8);
    const maxTop = Math.max(8, window.innerHeight - 80);
    const left = Math.min(Math.max(8, drag.left + event.clientX - drag.startX), maxLeft);
    const top = Math.min(Math.max(8, drag.top + event.clientY - drag.startY), maxTop);
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  }

  function onPointerUp() {
    if (!drag) return;
    drag = null;
    root.classList.remove("is-dragging");
    document.body.classList.remove("fx-dragging");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("blur", onPointerUp);
    const rect = root.getBoundingClientRect();
    writePosition({ left: Math.round(rect.left), top: Math.round(rect.top) });
  }

  function onPointerDown(event) {
    if (event.button !== 0 || isNarrow()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const header = target.closest(".fx-head");
    if (!header || !root.contains(header)) return;
    if (target.closest("button, input, textarea, select, a, [data-no-drag]")) return;
    const rect = root.getBoundingClientRect();
    drag = {
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    };
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.style.marginLeft = "0";
    root.style.marginRight = "0";
    root.classList.add("is-dragging");
    document.body.classList.add("fx-dragging");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("blur", onPointerUp);
    event.preventDefault();
  }

  function onDoubleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !target.closest(".fx-head")) return;
    if (target.closest("button, input, textarea, select, a")) return;
    writePosition(null);
    clearInlinePosition();
  }

  function onResize() {
    // 隐藏时没有布局盒，位置留到重新显示后再夹取。
    if (!visible) return;
    applyPosition(readPosition());
  }

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("dblclick", onDoubleClick);
  window.addEventListener("resize", onResize);
  applyPosition(readPosition());

  function setVisible(next) {
    visible = next;
    writeVisible(visible);
    root.classList.toggle("is-hidden", !visible);
    syncLauncherState();
    if (visible) {
      // 隐藏期间的窗口缩放没有夹取位置：显示后按真实宽度重新夹取。
      applyPosition(readPosition());
      engine.refresh();
    } else {
      // 审查弹窗通过 Portal 挂在 body 上，浮层隐藏时必须一并关闭，避免残留遮罩。
      engine.closeDialog();
      // toast 也已 Portal 到 body，隐藏浮层时一并清掉，避免下次打开看到过期提示。
      engine.clearToast();
    }
  }

  function syncLauncherState() {
    if (!chatLauncherButton) return;
    chatLauncherButton.classList.toggle("is-active", visible);
    chatLauncherButton.setAttribute("aria-pressed", visible ? "true" : "false");
  }

  // 首选工具栏左组里 yolo 徽章右侧（未开启 yolo 时放左组末尾）。
  // 动作插槽 chat.input.actions 位于输入框上方，图标会偏离工具栏，只在工具栏不渲染时兜底。
  // 工具栏由宿主 React 管理，反复「校正兄弟顺序」会和它的重排互相推挤，
  // 表现为图标闪烁；所以只在按钮丢出容器、或 yolo 徽章出现 / 消失时补插一次。
  function findLauncherSlot() {
    try {
      if (typeof snow !== "undefined" && typeof snow.slot === "function") {
        const slot = snow.slot("chat.input.actions");
        if (slot && typeof slot.append === "function") return slot;
      }
    } catch {
      // 宿主不支持插槽 API 时走 DOM 回退。
    }
    return document.querySelector('[data-snow-slot="chat.input.actions"]');
  }

  function ensureLauncherButton() {
    if (chatLauncherButton) return chatLauncherButton;
    const button = document.createElement("button");
    button.type = "button";
    button.className = CHAT_LAUNCHER_CLASS;
    button.innerHTML = CHAT_LAUNCHER_ICON;
    chatLauncherButton = button;
    return button;
  }

  function placeChatLauncher() {
    const button = ensureLauncherButton();
    const label = launcherLabel();
    const left = document.querySelector(".input-toolbar .toolbar-left");
    if (left) {
      const yolo = left.querySelector(".yolo-mode-badge");
      const yoloPresent = Boolean(yolo);
      const detached = button.parentElement !== left;
      // yolo 徽章切换后，按钮可能留在旧锚点（例如排在 lite 徽章之后）。
      // 只在徽章出现 / 消失的那一轮校正一次，其余轮次不动，避免与 React 推挤闪烁。
      const misplaced = Boolean(
        !detached && yolo && yolo.nextElementSibling !== button && lastYoloPresent !== true,
      );
      if (detached || misplaced) {
        // 连续快速丢失时退避一轮，避免与宿主渲染形成抖动循环。
        const now = Date.now();
        attachBurst = now - lastAttachAt < 400 ? attachBurst + 1 : 0;
        lastAttachAt = now;
        if (attachBurst < 4) {
          left.insertBefore(button, yolo ? yolo.nextSibling : null);
          lastYoloPresent = yoloPresent;
        }
      } else {
        lastYoloPresent = yoloPresent;
      }
      button.title = label;
      button.setAttribute("aria-label", label);
      syncLauncherState();
      return;
    }
    const slot = findLauncherSlot();
    if (!slot) return;
    if (button.parentElement !== slot) slot.append(button);
    button.title = label;
    button.setAttribute("aria-label", label);
    syncLauncherState();
  }

  // 点击走 document 捕获委托：宿主重渲染可能在 pointerup 前移走按钮，
  // 绑在按钮上的 click 会因此丢失，委托能保证按下即生效。
  function onDocumentPointerDown(event) {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest(`.${CHAT_LAUNCHER_CLASS}`)) {
      event.preventDefault();
      event.stopPropagation();
      setVisible(!visible);
      return;
    }
    // 点击浮层外部关闭工作台：浮动面板的惯用交互，也避免遮挡聊天区。
    // 浮层内部（含拖动标题栏）不关闭；工作台弹窗打开时交给弹窗自己处理，
    // 避免一次点击同时关掉弹窗和工作台。
    if (!visible || root.contains(target)) return;
    if (document.querySelector(".fx-review-overlay")) return;
    setVisible(false);
  }

  function onDocumentKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !target.closest(`.${CHAT_LAUNCHER_CLASS}`)) return;
    event.preventDefault();
    setVisible(!visible);
  }

  render(h(FixBenchPanel, { api, onClose: () => setVisible(false) }), root);
  placeChatLauncher();
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeyDown, true);

  let launcherScheduled = false;
  let launcherTimer = 0;
  function scheduleLauncher() {
    if (launcherScheduled) return;
    launcherScheduled = true;
    launcherTimer = setTimeout(() => {
      launcherScheduled = false;
      launcherTimer = 0;
      placeChatLauncher();
    }, 60);
  }

  let lastLocale = currentLocale();

  // 入口按钮位于聊天输入区：只观察该锚点子树，宿主重建工具栏时补挂按钮。
  // 不再观察整棵 body 子树，避免聊天流式输出与浮层自身渲染持续触发回调。
  const launcherObserver = new MutationObserver(() => scheduleLauncher());
  let launcherAnchor = null;
  function retargetLauncherObserver() {
    let anchor = null;
    try {
      if (typeof snow !== "undefined" && typeof snow.anchor === "function") {
        anchor = snow.anchor("chat.input");
      }
    } catch {
      // 宿主不支持 anchor 时走选择器回退。
    }
    if (!anchor) anchor = document.querySelector('[data-snow-anchor="chat.input"]');
    if (!anchor) {
      if (launcherAnchor) {
        launcherObserver.disconnect();
        launcherAnchor = null;
      }
      return;
    }
    if (anchor === launcherAnchor) return;
    launcherAnchor = anchor;
    launcherObserver.disconnect();
    launcherObserver.observe(anchor, { childList: true, subtree: true });
    scheduleLauncher();
  }

  function onContext() {
    if (currentLocale() !== lastLocale) {
      lastLocale = currentLocale();
      engine.store.set({});
    }
    // 视图或会话切换后重新定位聊天输入区，聊天视图外不保留观察目标。
    retargetLauncherObserver();
    scheduleLauncher();
  }
  snow.on("context", onContext);

  // 浮层 root 是 body 直接子节点：只观察直系子节点，用于被移除后补挂。
  const rootObserver = new MutationObserver(() => {
    if (!document.body.contains(root)) document.body.append(root);
  });
  rootObserver.observe(document.body, { childList: true });

  retargetLauncherObserver();

  snow.onCleanup(() => {
    launcherObserver.disconnect();
    rootObserver.disconnect();
    launcherAnchor = null;
    if (launcherTimer) clearTimeout(launcherTimer);
    launcherTimer = 0;
    launcherScheduled = false;
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("dblclick", onDoubleClick);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("blur", onPointerUp);
    document.body.classList.remove("fx-dragging");
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown, true);
    render(null, root);
    root.remove();
    if (chatLauncherButton) chatLauncherButton.remove();
    chatLauncherButton = null;
  });
}

mount();
