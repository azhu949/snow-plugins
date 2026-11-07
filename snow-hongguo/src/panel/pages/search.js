// 搜索页：中文输入防抖、联想、热搜、最近搜索与触底分页。
import { getReact, h } from "../ui/runtime.js";
import { Cover, EmptyState, ErrorNotice, Icon, Spinner } from "../ui/common.js";
import { useAutoLoadMore } from "../ui/auto-load.js";
import { clearRecentSearches, pushRecentSearch, readRecentSearches } from "../storage.js";
import { SearchExplore } from "./search-explore.js";

const normalize = (value) => String(value || "").trim().slice(0, 80);
const empty = () => ({ query: "", items: [], cursor: null, hasMore: false, status: "idle", error: null });
const merge = (previous, incoming) => {
  const seen = new Set();
  return [...previous, ...(Array.isArray(incoming) ? incoming : [])].filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

export function SearchPage({ ctx, active }) {
  const React = getReact();
  const { t, rpc, api } = ctx;
  const [text, setText] = React.useState("");
  const [list, setList] = React.useState(empty);
  const [recent, setRecent] = React.useState([]);
  const [suggestions, setSuggestions] = React.useState([]);
  const [selected, setSelected] = React.useState(-1);
  const [focused, setFocused] = React.useState(false);
  const [composing, setComposing] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const input = React.useRef(null);
  const scroll = React.useRef(null);
  const sentinel = React.useRef(null);
  const live = React.useRef(true);
  const enabled = React.useRef(active);
  enabled.current = active;
  const composition = React.useRef(false);
  const query = React.useRef("");
  const current = React.useRef(list);
  const generation = React.useRef(0);
  const suggestionSeq = React.useRef(0);
  const recentSeq = React.useRef(0);
  const busy = React.useRef(false);
  const timer = React.useRef(null);
  const cursors = React.useRef(new Set());
  const popupId = React.useId();
  const publish = (next) => { current.current = next; setList(next); };
  const cancelDebounce = () => { clearTimeout(timer.current); timer.current = null; };

  React.useEffect(() => {
    live.current = true;
    const seq = ++recentSeq.current;
    readRecentSearches(api).then((rows) => {
      if (live.current && seq === recentSeq.current) setRecent(rows);
    }).catch(() => {});
    return () => { live.current = false; generation.current += 1; suggestionSeq.current += 1; cancelDebounce(); };
  }, [api]);

  // 在输入事件中立即作废旧请求，不能等新一轮防抖结束才作废。
  const changeText = (value) => {
    cancelDebounce();
    setText(value);
    setDismissed(false);
    setSelected(-1);
    setSuggestions([]);
    suggestionSeq.current += 1;
    const q = normalize(value);
    if (q !== query.current) {
      query.current = q;
      generation.current += 1;
      busy.current = false;
      cursors.current.clear();
      publish(empty());
      if (scroll.current) scroll.current.scrollTop = 0;
    }
  };

  const load = React.useCallback(async (q, append = false) => {
    if (!q || !enabled.current || composition.current || q !== query.current || busy.current) return;
    const before = current.current;
    if (append && (!before.hasMore || !before.cursor || before.query !== q)) return;
    const seq = ++generation.current;
    const recentVersion = recentSeq.current;
    const cursor = append ? before.cursor : null;
    if (!append) cursors.current.clear();
    if (cursor) cursors.current.add(cursor);
    busy.current = true;
    publish({ ...(append ? before : empty()), query: q, status: append ? "more" : "loading", error: null });
    try {
      const page = await rpc.search(q, cursor);
      if (!live.current || seq !== generation.current) return;
      const nextCursor = page?.cursor || null;
      publish({ query: q, items: merge(append ? before.items : [], page?.items), cursor: nextCursor,
        hasMore: page?.hasMore === true && Boolean(nextCursor) && !cursors.current.has(nextCursor), status: "ready", error: null });
      if (!append && recentVersion === recentSeq.current) {
        const recordSeq = ++recentSeq.current;
        pushRecentSearch(api, q).then((rows) => {
          if (live.current && recordSeq === recentSeq.current) setRecent(rows);
        }).catch(() => {});
      }
    } catch (error) {
      if (live.current && seq === generation.current) publish({ ...(append ? before : empty()), query: q, status: "error", error });
    } finally {
      if (seq === generation.current) busy.current = false;
    }
  }, [rpc, api]);

  React.useEffect(() => {
    const q = normalize(text);
    if (!active || composing || !q || current.current.query === q) return undefined;
    timer.current = setTimeout(() => { timer.current = null; void load(q); }, 300);
    return cancelDebounce;
  }, [text, composing, active, load]);

  React.useEffect(() => {
    const seq = ++suggestionSeq.current;
    const q = normalize(text);
    if (!active || !focused || composing || !q || dismissed) return undefined;
    const timeout = setTimeout(() => {
      Promise.resolve().then(() => rpc.suggest(q)).then((page) => {
        if (live.current && seq === suggestionSeq.current) {
          setSuggestions(Array.isArray(page?.items) ? page.items.slice(0, 6) : []);
          setSelected(-1);
        }
      }).catch(() => {});
    }, 180);
    return () => { clearTimeout(timeout); suggestionSeq.current += 1; };
  }, [rpc, text, active, focused, composing, dismissed]);

  const submit = (value) => {
    const q = normalize(value);
    changeText(q);
    setDismissed(true);
    if (q) void load(q);
  };
  const clearRecent = () => {
    const seq = ++recentSeq.current;
    clearRecentSearches(api).then(() => {
      if (live.current && seq === recentSeq.current) setRecent([]);
    }).catch(() => {});
  };
  const loadMore = React.useCallback(() => { void load(query.current, true); }, [load]);
  useAutoLoadMore({ active, ready: list.status === "ready", hasMore: list.hasMore, cursor: list.cursor,
    scrollRef: scroll, sentinelRef: sentinel, load: loadMore });

  const showSuggestions = active && focused && !composing && !dismissed && suggestions.length > 0;
  const showLanding = !normalize(text);
  return h("div", { className: "hg-page hg-search" },
    h("div", { className: "hg-page-head" }, h("div", { className: "hg-page-title" }, t("tab.search"))),
    h("div", { className: "hg-search-entry" },
      h("div", { className: "hg-searchbar" },
        h("span", { className: "hg-searchbar-icon" }, h(Icon, { ctx, name: "Search", size: 15 })),
        h("input", {
          ref: input, className: "hg-input", type: "search", value: text, placeholder: t("search.placeholder"),
          "aria-label": t("search.placeholder"), maxLength: 80, spellCheck: false, autoComplete: "off",
          role: "combobox", "aria-autocomplete": "list", "aria-expanded": Boolean(showSuggestions),
          "aria-controls": showSuggestions ? popupId : undefined,
          "aria-activedescendant": showSuggestions && selected >= 0 ? `${popupId}-${selected}` : undefined,
          onChange: (event) => changeText(event.target.value),
          onFocus: () => { setFocused(true); setDismissed(false); }, onBlur: () => setFocused(false),
          onCompositionStart: () => { composition.current = true; setComposing(true); cancelDebounce(); suggestionSeq.current += 1; },
          onCompositionEnd: (event) => { composition.current = false; setComposing(false); changeText(event.target.value); },
          onKeyDown: (event) => {
            if (composition.current || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && showSuggestions) {
              event.preventDefault();
              setSelected((prev) => event.key === "ArrowDown" ? (prev + 1) % suggestions.length : (prev < 0 ? suggestions.length - 1 : (prev - 1 + suggestions.length) % suggestions.length));
            } else if (event.key === "Enter") {
              event.preventDefault();
              submit(showSuggestions && selected >= 0 ? suggestions[selected].query : text);
            } else if (event.key === "Escape") {
              event.preventDefault();
              if (showSuggestions) { setDismissed(true); setSelected(-1); }
              else changeText("");
            }
          },
        }),
        text ? h("button", { type: "button", className: "hg-iconbtn", title: t("search.clearInput"), "aria-label": t("search.clearInput"),
          onClick: () => { changeText(""); input.current?.focus(); } }, h(Icon, { ctx, name: "X", size: 14 })) : null
      ),
      showSuggestions ? h("div", { id: popupId, className: "hg-suggestions", role: "listbox", "aria-label": t("search.suggestions") },
        suggestions.map((item, index) => h("button", { key: item.query, id: `${popupId}-${index}`, type: "button", role: "option",
          "aria-selected": index === selected, tabIndex: -1, className: `hg-suggestion${index === selected ? " is-selected" : ""}`,
          onMouseDown: (event) => event.preventDefault(), onClick: () => submit(item.query), onMouseEnter: () => setSelected(index),
        }, h(Icon, { ctx, name: "Search", size: 13 }), h("span", null, item.text)))
      ) : null
    ),
    h("div", { className: "hg-scroll", ref: scroll },
      showLanding ? h("div", { className: "hg-recent" },
        h("div", { className: "hg-sec-head" }, h("span", null, t("search.recent")),
          recent.length ? h("button", { type: "button", className: "hg-linkbtn", onClick: clearRecent }, t("search.clearRecent")) : null),
        recent.length ? h("div", { className: "hg-chips" }, recent.map((q) => h("button", {
          key: q, type: "button", className: "hg-chip", onClick: () => submit(q),
        }, q))) : h("div", { className: "hg-muted" }, t("search.noRecent"))
      ) : null,
      h(SearchExplore, { ctx, active, visible: showLanding, onSearch: submit }),
      list.status === "loading" ? h("div", { className: "hg-loading-line" }, h(Spinner, { label: t("search.searching") }), t("search.searching")) : null,
      list.error ? h(ErrorNotice, { ctx, error: list.error, compact: list.items.length > 0,
        onRetry: () => void load(query.current, list.hasMore && list.error.code !== "CURSOR_EXPIRED") }) : null,
      list.status === "ready" && !list.items.length && !list.hasMore ? h(EmptyState, {
        ctx, icon: "SearchX", title: t("search.empty"), hint: t("search.emptyHint"),
      }) : null,
      list.items.length ? h("div", { className: "hg-result-count", role: "status" }, t("search.results", { count: list.items.length })) : null,
      list.items.length ? h("div", { className: "hg-results" }, list.items.map((item) => h("button", {
        key: item.id, type: "button", className: "hg-result", onClick: () => ctx.openSeries(item),
      }, h(Cover, { ctx, path: item.cover, className: "hg-result-cover" }),
      h("div", { className: "hg-result-main" }, h("div", { className: "hg-result-title" }, item.title || t("unit.untitled")),
        h("div", { className: "hg-result-meta" }, item.count != null ? t("unit.episodes", { count: item.count }) : ""),
        item.description ? h("div", { className: "hg-result-desc" }, item.description) : null)))) : null,
      list.items.length || list.hasMore ? h("div", { className: "hg-list-foot", ref: sentinel },
        list.status === "more" ? h(Spinner, { label: t("search.loadingMore") }) : list.hasMore
          ? (!list.error ? t("action.loadMore") : null) : t("discover.end")) : null
    )
  );
}
