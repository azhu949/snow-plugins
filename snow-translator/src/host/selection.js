// 划词翻译入口：聊天消息区选中文字后浮出。
// 宿主自己也有一枚「添加到输入框」浮层（[data-quote-popup]）：它在时把按钮并入同一个容器并排显示，
// 视觉上合为一组；宿主没有浮层时退回选区下方的小浮层，保证入口不丢。
import { elementOf, inChatMessages } from "./dom.js";
import { iconMarkup } from "../ui/icons.js";

const BUTTON_CLASS = "st-selection-btn";
const INLINE_CLASS = "is-inline";
const MAX_SELECTION_CHARS = 8000;
const ESTIMATED_WIDTH = 84;
const GAP = 8;
// 宿主划词后自己也会浮出「添加到输入框」按钮，用这个属性标记它的容器。
const HOST_POPUP_SELECTOR = "[data-quote-popup]";
// 并入宿主浮层时两个按钮之间的间距：要写进容器的内联样式才生效。
const INLINE_GAP = 6;
const VIEWPORT_MARGIN = 8;

export function createSelectionTrigger({ getLabel, enabled, onTranslate }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.hidden = true;
  button.innerHTML = `${iconMarkup("languages", 13)}<span class="st-selection-label"></span>`;

  let current = null;
  let scheduled = false;

  function syncLabel() {
    const label = getLabel();
    const span = button.querySelector(".st-selection-label");
    if (span) span.textContent = label;
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  // 宿主的「添加到输入框」浮层；不存在或还没渲染出尺寸时返回 null。
  function hostPopup() {
    const popup = document.querySelector(HOST_POPUP_SELECTOR);
    if (!(popup instanceof HTMLElement)) return null;
    const box = popup.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return popup;
  }

  function isInline() {
    return button.classList.contains(INLINE_CLASS);
  }

  // 并入宿主浮层：容器是 fixed + 收缩宽度，补一层 flex 让两枚按钮同高并排。
  function attachInline(popup) {
    if (button.parentElement !== popup) {
      popup.style.display = "flex";
      popup.style.alignItems = "center";
      popup.style.gap = `${INLINE_GAP}px`;
      button.classList.add(INLINE_CLASS);
      button.style.left = "";
      button.style.top = "";
      popup.append(button);
    }
    keepInViewport(popup);
  }

  // 退出宿主浮层：还原容器的内联样式，按钮摘下来回到游离状态。
  function detachInline() {
    const parent = button.parentElement;
    if (parent instanceof HTMLElement && parent.matches(HOST_POPUP_SELECTOR)) {
      parent.style.display = "";
      parent.style.alignItems = "";
      parent.style.gap = "";
      parent.style.transform = "";
      button.remove();
    }
    button.classList.remove(INLINE_CLASS);
  }

  // 并排后容器比宿主预估的 136px 更宽，右侧可能顶出屏幕：整体左移把它拉回来。
  function keepInViewport(popup) {
    popup.style.transform = "";
    const box = popup.getBoundingClientRect();
    if (!box.width) return;
    let shift = 0;
    if (box.right > window.innerWidth - VIEWPORT_MARGIN) {
      shift = window.innerWidth - VIEWPORT_MARGIN - box.right;
    }
    if (box.left + shift < VIEWPORT_MARGIN) shift = VIEWPORT_MARGIN - box.left;
    if (Math.abs(shift) >= 1) popup.style.transform = `translateX(${Math.round(shift)}px)`;
  }

  // 回退模式：贴在选区下方并水平居中，下方放不下时翻到上方。
  function place(rect) {
    const width = button.offsetWidth || ESTIMATED_WIDTH;
    const height = button.offsetHeight || 26;
    const left = Math.min(
      Math.max(GAP, rect.left + rect.width / 2 - width / 2),
      Math.max(GAP, window.innerWidth - width - GAP),
    );
    let top = rect.bottom + GAP;
    if (top + height > window.innerHeight - GAP) top = Math.max(GAP, rect.top - height - GAP);
    button.style.left = `${Math.round(left)}px`;
    button.style.top = `${Math.round(top)}px`;
  }

  function show(rect) {
    // 先解除隐藏再挂载：并排时容器的宽度要连我们的按钮一起算进去。
    button.hidden = false;
    const popup = hostPopup();
    if (popup) {
      attachInline(popup);
      return;
    }
    detachInline();
    if (button.parentElement !== document.body) document.body.append(button);
    place(rect);
  }

  function hide() {
    current = null;
    button.hidden = true;
    detachInline();
  }

  function evaluate() {
    scheduled = false;
    if (!enabled()) {
      hide();
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      hide();
      return;
    }
    const text = selection.toString().trim();
    if (!text || text.length > MAX_SELECTION_CHARS) {
      hide();
      return;
    }
    const range = selection.getRangeAt(0);
    const element = elementOf(range.commonAncestorContainer);
    if (!element) {
      hide();
      return;
    }
    // 输入框内选中不弹（剪贴板与编辑语义交给宿主）。
    if (element.closest('input, textarea, [contenteditable="true"], [data-snow-anchor="chat.input"]')) {
      hide();
      return;
    }
    if (!inChatMessages(element)) {
      hide();
      return;
    }
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hide();
      return;
    }
    current = { text, rect };
    syncLabel();
    show(rect);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(evaluate, 0);
  }

  // 宿主浮层由 React 渲染，可能比我们晚出现，也可能随后卸载：
  // 它 portal 到 body 的直接子节点，所以只看 body 这一层就够，
  // 不必观察整棵子树（聊天流式输出时子树变化极频繁）。
  const hostObserver = new MutationObserver(() => {
    if (!current) return;
    const popup = hostPopup();
    if (popup) {
      button.hidden = false;
      attachInline(popup);
      return;
    }
    // 浮层消失说明宿主已经清掉划词状态，翻译入口跟着收起。
    if (isInline()) hide();
  });
  hostObserver.observe(document.body, { childList: true });

  function onMouseUp(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest(`.${BUTTON_CLASS}`)) return;
    schedule();
  }

  function onKeyUp(event) {
    if (event.key === "Shift" || event.key === "ArrowLeft" || event.key === "ArrowRight") schedule();
  }

  function onPointerDown(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!current) return;
    if (target && target.closest(`.${BUTTON_CLASS}`)) return;
    hide();
  }

  function onScroll() {
    if (current) hide();
  }

  function onButtonPointerDown(event) {
    // 按下时不抢选区：松手后仍由 click 处理。
    event.preventDefault();
    event.stopPropagation();
  }

  button.addEventListener("pointerdown", onButtonPointerDown);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!current) return;
    const payload = { text: current.text, rect: current.rect };
    hide();
    onTranslate(payload);
  });

  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("scroll", onScroll, true);

  return {
    refresh() {
      syncLabel();
    },
    dispose() {
      hide();
      hostObserver.disconnect();
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      button.remove();
    },
  };
}
