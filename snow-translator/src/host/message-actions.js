// AI 回复操作栏里的翻译按钮：挂到宿主官方插槽 chat.message.actions。
// 消息列表有虚拟化与流式重渲染，节点会被重建，用 MutationObserver 补挂。
import { findAnchor, findSlot, messageText } from "./dom.js";
import { iconMarkup } from "../ui/icons.js";

const BUTTON_CLASS = "st-msg-btn";
const RENDER_DEBOUNCE_MS = 120;

export function createMessageActions({ getLabel, enabled, onTranslate }) {
  let observer = null;
  let observedAnchor = null;
  let timer = 0;
  let scheduled = false;

  function syncButton(button) {
    const label = getLabel();
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  function createButton(message) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.innerHTML = iconMarkup("languages", 15);
    syncButton(button);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = messageText(message);
      if (!text) return;
      onTranslate({
        text,
        getAnchorRect: () => (button.isConnected ? button.getBoundingClientRect() : null),
      });
    });
    return button;
  }

  function decorate() {
    scheduled = false;
    if (!enabled()) return;
    const messages = document.querySelectorAll('[data-snow-anchor="chat.message"]');
    for (const message of messages) {
      if (message.dataset.snowMessageRole !== "assistant") continue;
      const slot = message.querySelector('[data-snow-slot="chat.message.actions"]');
      if (!slot) continue;
      const existing = slot.querySelector(`.${BUTTON_CLASS}`);
      if (existing) {
        syncButton(existing);
        continue;
      }
      slot.append(createButton(message));
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    timer = setTimeout(decorate, RENDER_DEBOUNCE_MS);
  }

  function retargetObserver() {
    const anchor = findAnchor("chat.messages");
    if (!anchor) {
      if (observer && observedAnchor) {
        observer.disconnect();
        observedAnchor = null;
      }
      return;
    }
    if (anchor === observedAnchor) return;
    observedAnchor = anchor;
    if (!observer) observer = new MutationObserver(() => schedule());
    observer.disconnect();
    observer.observe(anchor, { childList: true, subtree: true });
    schedule();
  }

  function removeButtons() {
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((node) => node.remove());
  }

  return {
    start() {
      retargetObserver();
      decorate();
    },
    refresh() {
      retargetObserver();
      // 设置里关掉功能时立即撤掉已挂的按钮，不必等下一次重渲染。
      if (!enabled()) removeButtons();
      schedule();
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = 0;
      scheduled = false;
      if (observer) observer.disconnect();
      observer = null;
      observedAnchor = null;
      removeButtons();
    },
  };
}
