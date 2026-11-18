// 聊天输入工具栏入口按钮：默认排在修复工作台扳手图标右侧。
// 宿主由 React 管理工具栏，按钮被重建时靠 MutationObserver + 低频兜底重新挂回。
import { findSlot } from "./dom.js";
import { iconMarkup } from "../ui/icons.js";

const LAUNCHER_CLASS = "st-launcher";
const WATCH_INTERVAL_MS = 2000;
const PLACE_DEBOUNCE_MS = 60;
// 宿主官方锚点：入口与工具栏的查询都收在这里，避免命中其它视图里的同名容器。
const CHAT_INPUT_ANCHOR = '[data-snow-anchor="chat.input"]';
// 工具栏左组只用于「排序增强」：命中就排到已知邻居右侧，未命中不影响入口是否存在。
const TOOLBAR_SELECTOR = ".input-toolbar .toolbar-left";
// 修复工作台的入口类名：它由同仓库的 snow-fix-bench 注入，属于可选的排序参考。
const FIX_BENCH_SELECTOR = ".fx-chat-launcher";

export function createLauncher({ getLabel, onToggle }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = LAUNCHER_CLASS;
  button.innerHTML = iconMarkup("languages", 15);

  let scheduled = false;
  let timer = 0;
  let observer = null;
  let observedAnchor = null;

  function syncLabel() {
    const label = getLabel();
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  function place() {
    syncLabel();
    // 存在性交给官方插槽与锚点：宿主工具栏改版时入口仍然在，只是少了排序增强。
    const host = document.querySelector(CHAT_INPUT_ANCHOR);
    const left = host ? host.querySelector(TOOLBAR_SELECTOR) : null;
    if (!left) {
      // 工具栏未渲染（例如非聊天视图或宿主改版）：退回官方可写插槽，保证入口不会彻底消失。
      const slot = findSlot("chat.input.actions");
      if (slot && button.parentElement !== slot) slot.append(button);
      return;
    }
    const fixBench = left.querySelector(FIX_BENCH_SELECTOR);
    if (fixBench) {
      if (fixBench.nextElementSibling !== button) left.insertBefore(button, fixBench.nextSibling);
      return;
    }
    const yolo = left.querySelector(".yolo-mode-badge");
    if (yolo) {
      if (yolo.nextElementSibling !== button) left.insertBefore(button, yolo.nextSibling);
      return;
    }
    // 既没有修复工作台也没有模式徽章：只在按钮不在左组时才追加，避免和 React 的重排互相推挤。
    if (button.parentElement !== left) left.append(button);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    timer = setTimeout(() => {
      scheduled = false;
      timer = 0;
      place();
    }, PLACE_DEBOUNCE_MS);
  }

  function retargetObserver() {
    const anchor = document.querySelector(CHAT_INPUT_ANCHOR) || document.querySelector('[data-snow-anchor="main.view"]');
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

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  });

  const watchTimer = setInterval(() => {
    retargetObserver();
    place();
  }, WATCH_INTERVAL_MS);

  return {
    button,
    mount() {
      place();
      retargetObserver();
    },
    refresh() {
      retargetObserver();
      schedule();
    },
    setActive(active) {
      button.classList.toggle("is-active", Boolean(active));
      button.setAttribute("aria-pressed", active ? "true" : "false");
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = 0;
      scheduled = false;
      clearInterval(watchTimer);
      if (observer) observer.disconnect();
      observer = null;
      observedAnchor = null;
      button.remove();
    },
  };
}
