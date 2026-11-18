// 自定义下拉：外观对齐 Snow App「用量统计 → 日期范围」的触发按钮 + 浮层列表。
// 浮层用 fixed 定位，避免被面板的滚动容器裁剪。
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icons.js";

const GAP = 4;
const MENU_MAX_HEIGHT = 240;
const VIEWPORT_GAP = 8;
const MIN_WIDTH = 132;

export function StSelect({ value, options, onChange, ariaLabel, size = "md" }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  // 选中后短时间内忽略触发器上的额外点击（label 转发会补一次 click），
  // 但键盘触发的 click 仍要能正常开合。
  const suppressUntilRef = useRef(0);

  const selected = options.find((option) => option.value === value);

  function measure() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, MIN_WIDTH);
    const maxLeft = Math.max(VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP);
    const left = Math.min(Math.max(VIEWPORT_GAP, rect.left), maxLeft);
    const below = rect.bottom + GAP;
    const openUp = below + MENU_MAX_HEIGHT > window.innerHeight - VIEWPORT_GAP && rect.top > MENU_MAX_HEIGHT;
    const top = openUp
      ? Math.max(VIEWPORT_GAP, rect.top - MENU_MAX_HEIGHT - GAP)
      : below;
    setPosition({ left, top, width });
  }

  useEffect(() => {
    if (!open) return undefined;
    measure();

    const onPointerDown = (event) => {
      const target = event.target;
      if (rootRef.current && target instanceof Node && rootRef.current.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    // 面板或列表自身滚动会改变锚点位置，直接收起；但列表内部滚动要继续可用。
    const onViewportChange = (event) => {
      const target = event && event.target;
      if (rootRef.current && target instanceof Node && rootRef.current.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open]);

  return h(
    "div",
    { className: `st-dropdown${size === "sm" ? " is-sm" : ""}`, ref: rootRef },
    h(
      "button",
      {
        type: "button",
        ref: triggerRef,
        className: "st-dropdown-trigger",
        "aria-haspopup": "listbox",
        "aria-expanded": open ? "true" : "false",
        "aria-label": ariaLabel || undefined,
        title: selected ? selected.label : "",
        onClick: () => {
          if (Date.now() < suppressUntilRef.current) return;
          setOpen((current) => !current);
        },
      },
      h("span", { className: "st-dropdown-label" }, selected ? selected.label : String(value ?? "")),
      h(Icon, { name: "chevronDown", size: 14 }),
    ),
    open && position
      ? h(
          "div",
          {
            className: "st-dropdown-menu",
            role: "listbox",
            style: {
              left: `${Math.round(position.left)}px`,
              top: `${Math.round(position.top)}px`,
              width: `${Math.round(position.width)}px`,
              maxHeight: `${MENU_MAX_HEIGHT}px`,
            },
          },
          options.map((option) =>
            h(
              "button",
              {
                key: option.value,
                type: "button",
                role: "option",
                "aria-selected": option.value === value ? "true" : "false",
                className: `st-dropdown-item${option.value === value ? " is-selected" : ""}`,
                onClick: (event) => {
                  // 选项点击只由本组件处理：阻止冒泡到面板等外层点击逻辑。
                  event.preventDefault();
                  event.stopPropagation();
                  suppressUntilRef.current = Date.now() + 300;
                  setOpen(false);
                  onChange(option.value);
                },
              },
              option.label,
            ),
          ),
        )
      : null,
  );
}
