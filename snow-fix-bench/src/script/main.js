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
const SIZE_KEY = "fixbench:ui:size";
const NARROW_QUERY = "(max-width: 760px)";
// 与 style.css 中 .fx-overlay 的 width: min(980px, calc(100vw - 32px)) 保持一致。
const OVERLAY_MAX_WIDTH = 980;
const OVERLAY_VIEWPORT_GUTTER = 32;
// 拖拽缩放的下限与视口留白：低于 480px 会提前触发窄面板布局，280px 以下容纳不了头部与列表。
const RESIZE_MIN_WIDTH = 480;
const RESIZE_MIN_HEIGHT = 280;
const RESIZE_VIEWPORT_GAP = 8;
// 居中布局的默认顶部偏移，与 style.css 中 .fx-overlay 的 top: 72px 保持一致。
const OVERLAY_TOP_OFFSET = 72;
// 指针位移低于该阈值视为单击 / 抖动，不进入缩放，也不写入位置与尺寸。
const RESIZE_MOVE_THRESHOLD = 3;

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

function readSize() {
  try {
    const raw = GM_getValue(SIZE_KEY, "");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) return null;
    if (parsed.width <= 0 || parsed.height <= 0) return null;
    return { width: parsed.width, height: parsed.height };
  } catch {
    return null;
  }
}

function writeSize(size) {
  try {
    GM_setValue(SIZE_KEY, size ? JSON.stringify(size) : "");
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
  // 按已写入的内联宽度或 CSS 宽度公式兜底，避免把浮层位置夹到屏幕外。
  function overlayWidth() {
    const width = root.getBoundingClientRect().width;
    if (width > 0) return width;
    const inline = Number.parseFloat(root.style.width);
    if (Number.isFinite(inline) && inline > 0) return inline;
    return Math.max(0, Math.min(OVERLAY_MAX_WIDTH, window.innerWidth - OVERLAY_VIEWPORT_GUTTER));
  }

  function applyPosition(position, size) {
    if (isNarrow()) {
      clearInlinePosition();
      return;
    }
    if (!position) {
      // 居中布局：横向仍由 auto margin 决定，不写内联 left；只有视口过矮、
      // 默认 top 放不下当前高度时才上移，保证底部与右下角手柄不被推出视口。
      const height = size ? size.height : 0;
      const bottomLimit = window.innerHeight - RESIZE_VIEWPORT_GAP;
      root.style.top =
        height > 0 && OVERLAY_TOP_OFFSET + height > bottomLimit
          ? `${Math.max(RESIZE_VIEWPORT_GAP, bottomLimit - height)}px`
          : "";
      return;
    }
    // 位置夹取以已确定的尺寸为准：窗口缩小后优先移动浮层，保证它完整落在视口内。
    const width = size ? size.width : overlayWidth();
    const height = size ? size.height : 0;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, height > 0 ? window.innerHeight - height - 8 : window.innerHeight - 80);
    pinTo(
      Math.min(Math.max(8, position.left), maxLeft),
      Math.min(Math.max(8, position.top), maxTop),
    );
  }

  function clearInlineSize() {
    root.style.width = "";
    root.style.height = "";
  }

  // 恢复布局时的尺寸上限只由视口决定，不参考当前 rect / 残留 inline left：
  // 否则窗口缩小后可用宽度会随旧位置变小，把浮层越压越窄。
  // topOffset 用于居中布局：默认 top 由上向下占用视口高度，必须计入上限。
  function viewportSizeLimits(topOffset = 0) {
    return {
      maxWidth: Math.max(RESIZE_MIN_WIDTH, window.innerWidth - RESIZE_VIEWPORT_GAP * 2),
      maxHeight: Math.max(
        RESIZE_MIN_HEIGHT,
        window.innerHeight - topOffset - RESIZE_VIEWPORT_GAP * 2,
      ),
    };
  }

  function clampSizeToViewport(size, topOffset = 0) {
    const { maxWidth, maxHeight } = viewportSizeLimits(topOffset);
    return {
      width: Math.min(Math.max(RESIZE_MIN_WIDTH, size.width), maxWidth),
      height: Math.min(Math.max(RESIZE_MIN_HEIGHT, size.height), maxHeight),
    };
  }

  // 拖拽缩放期间的上限跟随当前左上角：向右 / 向下缩放时不允许把浮层推出视口。
  // 未拖动过（居中布局）时按视口整宽计算，缩放后仍由 auto margin 居中。
  function sizeLimits() {
    const rect = root.getBoundingClientRect();
    const hasBox = rect.width > 0 && rect.height > 0;
    const pinned = Boolean(root.style.left) || Boolean(root.style.top);
    const left = hasBox ? rect.left : Number.parseFloat(root.style.left);
    const top = hasBox ? rect.top : Number.parseFloat(root.style.top);
    const fallbackTop = OVERLAY_TOP_OFFSET;
    const effectiveTop = Number.isFinite(top) ? top : fallbackTop;
    return {
      maxWidth: Math.max(
        RESIZE_MIN_WIDTH,
        pinned && Number.isFinite(left)
          ? window.innerWidth - left - RESIZE_VIEWPORT_GAP
          : window.innerWidth - RESIZE_VIEWPORT_GAP * 2,
      ),
      maxHeight: Math.max(RESIZE_MIN_HEIGHT, window.innerHeight - effectiveTop - RESIZE_VIEWPORT_GAP),
    };
  }

  function applySize(size, topOffset = 0) {
    if (isNarrow()) {
      clearInlineSize();
      return null;
    }
    if (!size) {
      clearInlineSize();
      return null;
    }
    const next = clampSizeToViewport(size, topOffset);
    root.style.width = `${Math.round(next.width)}px`;
    root.style.height = `${Math.round(next.height)}px`;
    return next;
  }

  // 先按保存尺寸与视口独立确定尺寸，再用该尺寸夹取位置：
  // 窗口缩小时移动浮层而不是缩小浮层，避免尺寸被旧位置反复压小。
  function applyLayout() {
    const position = readPosition();
    // 无保存位置时沿用 CSS 的 top: 72px，高度上限要扣掉这段偏移；
    // 有保存位置时由 applyPosition 按实际 top 夹取，这里不再重复扣。
    const size = applySize(readSize(), position ? 0 : OVERLAY_TOP_OFFSET);
    applyPosition(position, size);
  }

  let drag = null;

  function onPointerMove(event) {
    if (!drag) return;
    const maxLeft = Math.max(8, window.innerWidth - drag.width - 8);
    // 与 applyPosition 一致：按面板实际高度夹取，避免调高后拖动把底部推出视口。
    const maxTop = Math.max(
      8,
      drag.height > 0 ? window.innerHeight - drag.height - 8 : window.innerHeight - 80,
    );
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
    // 拖动期间视口可能变化：释放时按当前尺寸再夹一次，只持久化视口内的位置。
    const rect = root.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(
      8,
      rect.height > 0 ? window.innerHeight - rect.height - 8 : window.innerHeight - 80,
    );
    const left = Math.min(Math.max(8, rect.left), maxLeft);
    const top = Math.min(Math.max(8, rect.top), maxTop);
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    writePosition({ left: Math.round(left), top: Math.round(top) });
  }

  let resize = null;

  function resizeCursor(mode) {
    if (mode === "e") return "ew-resize";
    if (mode === "s") return "ns-resize";
    return "nwse-resize";
  }

  function onResizePointerMove(event) {
    if (!resize) return;
    const dx = event.clientX - resize.startX;
    const dy = event.clientY - resize.startY;
    // 右边缘手柄贴着滚动条：指针未超过阈值时不进入缩放，单击不应把居中布局固定下来。
    if (!resize.moved) {
      const movedHorizontal = resize.horizontal && Math.abs(dx) >= RESIZE_MOVE_THRESHOLD;
      const movedVertical = resize.vertical && Math.abs(dy) >= RESIZE_MOVE_THRESHOLD;
      if (!movedHorizontal && !movedVertical) return;
      resize.moved = true;
      // 首次真正移动时才固定左上角：sizeLimits 依赖已写入的 left/top 计算右侧可用宽度。
      pinTo(resize.left, resize.top);
    }
    const { maxWidth, maxHeight } = sizeLimits();
    const width = Math.min(
      Math.max(RESIZE_MIN_WIDTH, resize.width + (resize.horizontal ? dx : 0)),
      maxWidth,
    );
    const height = Math.min(
      Math.max(RESIZE_MIN_HEIGHT, resize.height + (resize.vertical ? dy : 0)),
      maxHeight,
    );
    root.style.width = `${Math.round(width)}px`;
    root.style.height = `${Math.round(height)}px`;
  }

  function endResize() {
    if (!resize) return;
    const previousCursor = resize.previousCursor;
    const moved = resize.moved;
    resize = null;
    root.classList.remove("is-resizing");
    document.body.classList.remove("fx-resizing");
    document.body.style.cursor = previousCursor;
    window.removeEventListener("pointermove", onResizePointerMove);
    window.removeEventListener("pointerup", endResize);
    window.removeEventListener("pointercancel", endResize);
    window.removeEventListener("blur", endResize);
    // 只是点在手柄上、没有实际缩放时不写存储：否则居中布局会被固化为显式坐标。
    if (!moved) return;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    writeSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    writePosition({ left: Math.round(rect.left), top: Math.round(rect.top) });
  }

  function startResize(event, handle) {
    const mode = handle.getAttribute("data-fx-resize") || "se";
    const rect = root.getBoundingClientRect();
    // 缩放期间固定左上角：居中布局改为显式 left/top，右 / 下边缘才会跟随指针。
    // 若当前位置放不下最小尺寸，先左移 / 上移到能放下的位置；实际固定推迟到指针移动后。
    const left = Math.min(
      Math.max(RESIZE_VIEWPORT_GAP, rect.left),
      Math.max(RESIZE_VIEWPORT_GAP, window.innerWidth - RESIZE_MIN_WIDTH - RESIZE_VIEWPORT_GAP),
    );
    const top = Math.min(
      Math.max(RESIZE_VIEWPORT_GAP, rect.top),
      Math.max(RESIZE_VIEWPORT_GAP, window.innerHeight - RESIZE_MIN_HEIGHT - RESIZE_VIEWPORT_GAP),
    );
    resize = {
      startX: event.clientX,
      startY: event.clientY,
      left,
      top,
      width: rect.width,
      height: rect.height,
      horizontal: mode === "e" || mode === "se",
      vertical: mode === "s" || mode === "se",
      moved: false,
      previousCursor: document.body.style.cursor,
    };
    root.classList.add("is-resizing");
    document.body.classList.add("fx-resizing");
    document.body.style.cursor = resizeCursor(mode);
    window.addEventListener("pointermove", onResizePointerMove);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endResize);
    window.addEventListener("blur", endResize);
    event.preventDefault();
  }

  function onPointerDown(event) {
    if (event.button !== 0 || isNarrow()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const handle = target.closest("[data-fx-resize]");
    if (handle && root.contains(handle)) {
      startResize(event, handle);
      return;
    }
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
      height: rect.height,
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
    // 恢复居中后顶部回到 CSS 默认值，重新按视口夹取已保存的尺寸。
    applyLayout();
  }

  function onResize() {
    // 隐藏时没有布局盒，位置与尺寸留到重新显示后再夹取。
    if (!visible) return;
    applyLayout();
  }

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("dblclick", onDoubleClick);
  window.addEventListener("resize", onResize);
  applyLayout();

  function setVisible(next) {
    visible = next;
    writeVisible(visible);
    root.classList.toggle("is-hidden", !visible);
    syncLauncherState();
    if (visible) {
      // 隐藏期间的窗口缩放没有夹取位置与尺寸：显示后按真实视口重新夹取。
      applyLayout();
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

  render(h(FixBenchPanel, { api, onClose: () => setVisible(false), resizable: true }), root);
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
    window.removeEventListener("pointermove", onResizePointerMove);
    window.removeEventListener("pointerup", endResize);
    window.removeEventListener("pointercancel", endResize);
    window.removeEventListener("blur", endResize);
    if (resize) {
      document.body.style.cursor = resize.previousCursor;
      resize = null;
    }
    document.body.classList.remove("fx-dragging");
    document.body.classList.remove("fx-resizing");
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown, true);
    render(null, root);
    root.remove();
    if (chatLauncherButton) chatLauncherButton.remove();
    chatLauncherButton = null;
  });
}

mount();
