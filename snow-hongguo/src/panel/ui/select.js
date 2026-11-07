// 视觉参照宿主 CustomSelect；面板和原生 DOM 播放器共用，菜单挂到 body 避免侧栏裁切。
// 宿主只注入 React 与图标，未公开 CustomSelect / ReactDOM，因此不引入第二份 React。
import { getReact, h } from "./runtime.js";

let nextId = 0;
const opened = new WeakMap();
const glyph = (doc, path) => {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "14", height: "14", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
  const line = doc.createElementNS(svg.namespaceURI, "path");
  line.setAttribute("d", path);
  svg.append(line);
  return svg;
};

/** options: [{ value, label, disabled? }]; update 接收受控值和文案，destroy 清理弹层与监听。 */
export function createSelect(initial, element = document.createElement("button")) {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  const contains = (parent, target) => target instanceof win.Node && parent?.contains(target);
  const menuId = `hg-select-menu-${++nextId}`;
  const label = doc.createElement("span");
  label.className = "hg-select-label";
  const arrow = glyph(doc, "m6 9 6 6 6-6");
  arrow.classList.add("hg-select-arrow");
  element.replaceChildren(label, arrow);
  element.type = "button";
  element.setAttribute("role", "combobox");
  element.setAttribute("aria-haspopup", "listbox");
  element.setAttribute("aria-expanded", "false");
  let props = {};
  let options = [];
  let menu = null;
  let rows = [];
  let active = -1;
  let disposed = false;
  let cleanup = () => {};
  let typed = "";
  let typedAt = 0;

  const close = (restoreFocus = false) => {
    if (!menu) return;
    cleanup();
    menu.remove();
    menu = null;
    rows = [];
    element.setAttribute("aria-expanded", "false");
    element.removeAttribute("aria-controls");
    element.removeAttribute("aria-activedescendant");
    if (opened.get(doc) === close) opened.delete(doc);
    if (restoreFocus && element.isConnected) element.focus({ preventScroll: true });
    props.onOpenChange?.(false);
  };

  const highlight = (index, scroll = false) => {
    active = index;
    rows.forEach((row, position) => row.classList.toggle("is-active", position === active));
    if (rows[active]) {
      element.setAttribute("aria-activedescendant", rows[active].id);
      if (scroll) rows[active].scrollIntoView?.({ block: "nearest" });
    } else element.removeAttribute("aria-activedescendant");
  };

  const syncValue = () => {
    const value = String(props.value ?? "");
    const selected = options.find((option) => option.value === value);
    label.textContent = selected?.label ?? value;
    label.title = label.textContent;
    element.value = value;
    element.title = props.title || label.textContent;
    element.setAttribute("aria-label", props.ariaLabel || label.textContent);
    rows.forEach((row, index) => {
      const chosen = options[index].value === value;
      row.setAttribute("aria-selected", String(chosen));
      row.lastChild.style.visibility = chosen ? "visible" : "hidden";
    });
  };

  const position = () => {
    if (!menu) return;
    if (!element.isConnected || element.disabled || element.closest('[hidden], [inert], [aria-hidden="true"]')) return close();
    const rect = element.getBoundingClientRect();
    for (let node = element; node && node !== doc.body; node = node.parentElement) {
      const style = win.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return close();
      if (node !== element) {
        const bounds = node.getBoundingClientRect();
        const clips = (overflow) => /^(auto|scroll|hidden|clip)$/.test(overflow);
        if (bounds.height > 0 && clips(style.overflowY) && (rect.bottom <= bounds.top || rect.top >= bounds.bottom)) return close();
        if (bounds.width > 0 && clips(style.overflowX) && (rect.right <= bounds.left || rect.left >= bounds.right)) return close();
      }
    }
    const viewportWidth = win.innerWidth;
    const viewportHeight = win.innerHeight;
    if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) return close();
    const width = Math.min(Math.max(rect.width, props.dropdownMinWidth || 128), Math.max(0, viewportWidth - 16));
    menu.style.width = `${width}px`;
    const desired = Math.min(240, menu.scrollHeight || options.length * 32 + 14);
    const below = Math.max(0, viewportHeight - rect.bottom - 12);
    const above = Math.max(0, rect.top - 12);
    const up = below < desired && above > below;
    const height = Math.min(desired, up ? above : below);
    menu.dataset.placement = up ? "top" : "bottom";
    menu.style.maxHeight = `${height}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`;
    menu.style.top = `${up ? Math.max(8, rect.top - height - 4) : rect.bottom + 4}px`;
  };

  const choose = (index) => {
    const option = options[index];
    if (!option || option.disabled || element.disabled) return;
    const changed = String(props.value ?? "") !== option.value;
    props = { ...props, value: option.value };
    syncValue();
    close(true);
    if (changed) props.onChange?.(option.value);
  };

  const renderOptions = () => {
    rows = options.map((option, index) => {
      const row = doc.createElement("button");
      row.type = "button";
      row.tabIndex = -1;
      row.id = `${menuId}-${index}`;
      row.className = "hg-select-option";
      row.setAttribute("role", "option");
      row.dataset.value = option.value;
      row.disabled = option.disabled;
      row.title = option.label;
      const text = doc.createElement("span");
      text.textContent = option.label;
      row.append(text, glyph(doc, "m20 6-11 11-5-5"));
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); choose(index); });
      row.addEventListener("pointermove", () => { if (!option.disabled) highlight(index); });
      return row;
    });
    menu.replaceChildren(...rows);
    syncValue();
    const selected = options.findIndex((option) => option.value === String(props.value ?? "") && !option.disabled);
    highlight(selected >= 0 ? selected : options.findIndex((option) => !option.disabled));
  };

  const open = () => {
    if (disposed || element.disabled || props.active === false || menu || !options.length) return;
    opened.get(doc)?.();
    menu = doc.createElement("div");
    menu.id = menuId;
    menu.className = "hg-select-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", props.ariaLabel || label.textContent);
    menu.addEventListener("keydown", onKeyDown);
    renderOptions();
    doc.body.append(menu);
    element.setAttribute("aria-expanded", "true");
    element.setAttribute("aria-controls", menuId);
    element.focus({ preventScroll: true });
    opened.set(doc, close);
    typed = "";
    const outside = (event) => {
      if (!contains(element, event.target) && !contains(menu, event.target)) close();
    };
    const scroll = (event) => { if (!contains(menu, event.target)) position(); };
    const resize = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(position) : null;
    resize?.observe(element);
    const observer = new win.MutationObserver(position);
    // 页签隐藏、详情覆盖、播放器换容器和卸载时同步收起菜单。
    for (let node = element; node; node = node.parentElement) {
      observer.observe(node, { childList: true, attributes: true, attributeFilter: ["hidden", "inert", "aria-hidden", "class", "style"] });
    }
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("focusin", outside);
    win.addEventListener("resize", position);
    win.addEventListener("scroll", scroll, true);
    cleanup = () => {
      observer.disconnect();
      resize?.disconnect();
      doc.removeEventListener("pointerdown", outside, true);
      doc.removeEventListener("focusin", outside);
      win.removeEventListener("resize", position);
      win.removeEventListener("scroll", scroll, true);
    };
    props.onOpenChange?.(true);
    position();
    if (menu) highlight(active, true);
  };

  const onClick = (event) => { event.stopPropagation(); menu ? close() : open(); };
  const onKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || element.disabled) return;
    const key = event.key;
    if (key === "Tab") { close(true); return; }
    if (key === "Escape") {
      if (!menu) return;
      close(true);
    } else if (key === "Enter" || key === " " || key === "Spacebar") {
      menu ? choose(active) : open();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
      const wasOpen = Boolean(menu);
      open();
      const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
      if (key === "Home") highlight(enabled[0] ?? -1, true);
      else if (key === "End") highlight(enabled.at(-1) ?? -1, true);
      else if (wasOpen && enabled.length) {
        const offset = key === "ArrowDown" ? 1 : -1;
        highlight(enabled[(enabled.indexOf(active) + offset + enabled.length) % enabled.length], true);
      }
    } else if (key.length === 1) {
      open();
      const now = Date.now();
      typed = now - typedAt > 700 ? key : typed + key;
      typedAt = now;
      const index = options.findIndex((option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase()));
      if (index >= 0) highlight(index, true);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  element.addEventListener("click", onClick);
  element.addEventListener("keydown", onKeyDown);

  const update = (next) => {
    if (disposed) return;
    const previousValue = props.value;
    props = { ...props, ...next };
    const normalized = (props.options || []).map((option) => ({ value: String(option.value), label: String(option.label), disabled: option.disabled === true }));
    const changed = JSON.stringify(options) !== JSON.stringify(normalized);
    options = normalized;
    element.className = `hg-select${props.className ? ` ${props.className}` : ""}`;
    element.disabled = props.disabled === true;
    if (props.id) element.id = props.id;
    if (props.filterKey) element.dataset.filter = props.filterKey;
    if (element.disabled || props.active === false) close();
    if (menu && changed) renderOptions();
    else {
      syncValue();
      if (menu && previousValue !== props.value) highlight(options.findIndex((option) => option.value === String(props.value)));
    }
    position();
  };
  update(initial);
  return {
    element, update, close,
    isOpen: () => Boolean(menu),
    destroy() {
      if (disposed) return;
      close();
      disposed = true;
      element.removeEventListener("click", onClick);
      element.removeEventListener("keydown", onKeyDown);
    },
  };
}

export function Select(props) {
  const React = getReact();
  const ref = React.useRef(null);
  const control = React.useRef(null);
  React.useLayoutEffect(() => {
    control.current = createSelect(props, ref.current);
    return () => { control.current.destroy(); control.current = null; };
  }, []);
  React.useLayoutEffect(() => { control.current?.update(props); });
  return h("button", { ref });
}
