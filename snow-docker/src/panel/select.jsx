// 自研下拉：原生 <select> 在面板里无法跟随主题定制弹出层，这里用按钮 + fixed 浮层替代。
// 参考 snow-translator 的 StSelect：浮层固定定位，避免被面板滚动容器裁剪。
// searchable 打开时在浮层顶部固定一个搜索框，按 label 过滤；上下键移动、Enter 选中。
import { h, getReact } from "./react.js";

const GAP = 4;
const MENU_MAX_HEIGHT = 240;
const SEARCH_BAR_HEIGHT = 38;
const VIEWPORT_GAP = 8;
const MIN_WIDTH = 132;
const SUPPRESS_MS = 300;

export function DkSelect({
  value,
  options,
  onChange,
  ariaLabel,
  size,
  disabled,
  searchable,
  searchPlaceholder,
  emptyText,
}) {
  const React = getReact();
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState(null);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const rootRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const suppressUntilRef = React.useRef(0);

  const selected = options.find((option) => option.value === value);

  const visible = React.useMemo(() => {
    if (!searchable) return options;
    const keyword = query.trim().toLowerCase();
    if (!keyword) return options;
    return options.filter((option) => String(option.label ?? "").toLowerCase().includes(keyword));
  }, [options, searchable, query]);

  const measure = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, MIN_WIDTH);
    const maxLeft = Math.max(VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP);
    const left = Math.min(Math.max(VIEWPORT_GAP, rect.left), maxLeft);
    const below = rect.bottom + GAP;
    const menuHeight = MENU_MAX_HEIGHT + (searchable ? SEARCH_BAR_HEIGHT : 0);
    const openUp = below + menuHeight > window.innerHeight - VIEWPORT_GAP && rect.top > menuHeight;
    const top = openUp ? Math.max(VIEWPORT_GAP, rect.top - menuHeight - GAP) : below;
    setPosition({ left, top, width });
  }, [searchable]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(-1);
      return undefined;
    }
    measure();

    const onPointerDown = (event) => {
      const target = event.target;
      if (rootRef.current && target instanceof Node && rootRef.current.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    // 面板或列表自身滚动会移动锚点，直接收起；浮层内部滚动仍可用。
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
  }, [open, measure]);

  // 浮层挂载并定位后再聚焦搜索框，否则 ref 还是空的。
  React.useEffect(() => {
    if (!open || !searchable || !position) return;
    if (inputRef.current) inputRef.current.focus();
  }, [open, position, searchable]);

  // 过滤后条目变少时把高亮索引收回范围内。
  React.useEffect(() => {
    setActiveIndex((current) => (current >= visible.length ? -1 : current));
  }, [visible.length]);

  // 键盘移动高亮后，让选中项滚进浮层可见区域。
  React.useEffect(() => {
    if (activeIndex < 0) return;
    const menu = menuRef.current;
    if (!menu) return;
    const node = menu.querySelector(`[data-index="${activeIndex}"]`);
    if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const pick = (option) => {
    // 选中后短时间内忽略触发按钮的点击，避免一次操作被当成两次开关。
    suppressUntilRef.current = Date.now() + SUPPRESS_MS;
    setOpen(false);
    onChange(option.value);
  };

  const onSearchKeyDown = (event) => {
    if (event.nativeEvent && event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (visible.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const next = current + step;
        if (next < 0) return visible.length - 1;
        if (next >= visible.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = visible[activeIndex];
      if (option) pick(option);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className={`dk-select${size === "sm" ? " is-sm" : ""}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="dk-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
        aria-label={ariaLabel || undefined}
        title={selected ? selected.label : ""}
        disabled={disabled === true}
        onClick={() => {
          if (Date.now() < suppressUntilRef.current) return;
          setOpen((current) => !current);
        }}
      >
        <span className="dk-select-label">{selected ? selected.label : String(value ?? "")}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && position ? (
        <div
          className="dk-select-menu"
          role="listbox"
          ref={menuRef}
          style={{
            left: `${Math.round(position.left)}px`,
            top: `${Math.round(position.top)}px`,
            width: `${Math.round(position.width)}px`,
            maxHeight: `${MENU_MAX_HEIGHT}px`,
          }}
        >
          {searchable ? (
            <div className="dk-select-search">
              <input
                ref={inputRef}
                type="text"
                value={query}
                placeholder={searchPlaceholder || ""}
                spellCheck={false}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onSearchKeyDown}
              />
            </div>
          ) : null}

          {visible.length === 0 ? (
            <div className="dk-select-empty">{emptyText || ""}</div>
          ) : (
            visible.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                data-index={index}
                aria-selected={option.value === value ? "true" : "false"}
                className={`dk-select-item${option.value === value ? " is-selected" : ""}${
                  index === activeIndex ? " is-active" : ""
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={(event) => {
                  // 选项点击只由本组件处理，避免冒泡到面板的外层点击逻辑。
                  event.preventDefault();
                  event.stopPropagation();
                  pick(option);
                }}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
