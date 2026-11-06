// 搜索页：输入防抖 300ms、结果列表、最近搜索词（api.storage）。
import { getReact, h } from "../ui/runtime.js";
import { Cover, EmptyState, ErrorNotice, Icon, Spinner } from "../ui/common.js";
import { clearRecentSearches, pushRecentSearch, readRecentSearches } from "../storage.js";

const DEBOUNCE_MS = 300;

const dedupeById = (list) => {
  const seen = new Set();
  const result = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
};

export function SearchPage({ ctx, active }) {
  const React = getReact();
  const t = ctx.t;
  const rpc = ctx.rpc;
  const api = ctx.api;
  const [text, setText] = React.useState("");
  const [submitted, setSubmitted] = React.useState("");
  const [items, setItems] = React.useState([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [status, setStatus] = React.useState("idle");
  const [error, setError] = React.useState(null);
  const [recent, setRecent] = React.useState([]);

  const inputRef = React.useRef(null);
  const seqRef = React.useRef(0);
  const submittedRef = React.useRef("");
  const cursorRef = React.useRef(null);
  const hasMoreRef = React.useRef(false);
  const busyRef = React.useRef(false);
  const debounceRef = React.useRef(null);

  React.useEffect(() => {
    let alive = true;
    readRecentSearches(api)
      .then((list) => {
        if (alive) setRecent(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api]);

  const runSearch = React.useCallback(
    async (query, append) => {
      const q = String(query || "").trim().slice(0, 80);
      if (!q) return;
      if (append && (!hasMoreRef.current || !cursorRef.current)) return;

      busyRef.current = true;
      const seq = seqRef.current + 1;
      seqRef.current = seq;
      if (!append) {
        submittedRef.current = q;
        setSubmitted(q);
        cursorRef.current = null;
        hasMoreRef.current = false;
        setItems([]);
        setHasMore(false);
      }
      setStatus(append ? "more" : "loading");
      setError(null);

      try {
        const page = await rpc.search(q, append ? cursorRef.current : null);
        if (seq !== seqRef.current) return;
        const list = dedupeById(Array.isArray(page?.items) ? page.items : []);
        setItems((prev) => (append ? dedupeById([...prev, ...list]) : list));
        cursorRef.current = page?.cursor ?? null;
        hasMoreRef.current = page?.hasMore === true;
        setHasMore(hasMoreRef.current);
        setStatus("idle");
        if (!append) {
          pushRecentSearch(api, q)
            .then((next) => setRecent(next))
            .catch(() => {});
        }
      } catch (searchError) {
        if (seq !== seqRef.current) return;
        setError(searchError);
        setStatus("error");
      } finally {
        if (seq === seqRef.current) busyRef.current = false;
      }
    },
    [api, rpc]
  );

  // 输入防抖：300ms 内继续输入会清掉上一次定时器；清空输入立即回到最近搜索。
  React.useEffect(() => {
    const q = text.trim();
    if (!q) {
      seqRef.current += 1;
      submittedRef.current = "";
      setSubmitted("");
      setItems([]);
      setHasMore(false);
      setError(null);
      setStatus("idle");
      cursorRef.current = null;
      hasMoreRef.current = false;
      return undefined;
    }
    if (q === submittedRef.current) return undefined;
    const timer = setTimeout(() => {
      debounceRef.current = null;
      void runSearch(q, false);
    }, DEBOUNCE_MS);
    debounceRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (debounceRef.current === timer) debounceRef.current = null;
    };
  }, [text, runSearch]);

  const submitNow = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const q = text.trim();
    if (q) void runSearch(q, false);
  };

  const applyRecent = (query) => {
    setText(query);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void runSearch(query, false);
    inputRef.current?.focus?.();
  };

  const clearRecent = () => {
    clearRecentSearches(api)
      .then(() => setRecent([]))
      .catch(() => setRecent([]));
  };

  const busy = status === "loading" || status === "more";
  const showEmpty = status === "idle" && !error && Boolean(submitted) && items.length === 0;

  return h(
    "div",
    { className: "hg-page hg-search" },
    h("div", { className: "hg-page-head" }, h("div", { className: "hg-page-title" }, t("tab.search"))),
    h(
      "div",
      { className: "hg-searchbar" },
      h("span", { className: "hg-searchbar-icon" }, h(Icon, { ctx, name: "Search", size: 15 })),
      h("input", {
        ref: inputRef,
        className: "hg-input",
        type: "search",
        value: text,
        placeholder: t("search.placeholder"),
        maxLength: 80,
        spellCheck: false,
        onChange: (event) => setText(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submitNow();
          }
          if (event.key === "Escape") setText("");
        },
      }),
      text
        ? h(
            "button",
            {
              type: "button",
              className: "hg-iconbtn",
              title: t("search.clearInput"),
              "aria-label": t("search.clearInput"),
              onClick: () => {
                setText("");
                inputRef.current?.focus?.();
              },
            },
            h(Icon, { ctx, name: "X", size: 14 })
          )
        : null
    ),
    h(
      "div",
      { className: "hg-scroll" },
      !submitted
        ? h(
            "div",
            { className: "hg-recent" },
            h(
              "div",
              { className: "hg-sec-head" },
              h("span", null, t("search.recent")),
              recent.length > 0
                ? h(
                    "button",
                    { type: "button", className: "hg-linkbtn", onClick: clearRecent },
                    t("search.clearRecent")
                  )
                : null
            ),
            recent.length > 0
              ? h(
                  "div",
                  { className: "hg-chips" },
                  recent.map((query) =>
                    h(
                      "button",
                      {
                        key: query,
                        type: "button",
                        className: "hg-chip",
                        onClick: () => applyRecent(query),
                      },
                      query
                    )
                  )
                )
              : h("div", { className: "hg-muted" }, t("search.noRecent")),
            h("div", { className: "hg-hint" }, t("search.hint"))
          )
        : null,
      submitted && status === "loading"
        ? h(
            "div",
            { className: "hg-loading-line" },
            h(Spinner, { label: t("search.searching") }),
            h("span", null, t("search.searching"))
          )
        : null,
      error && items.length > 0
        ? h(ErrorNotice, { ctx, error, compact: true, onRetry: () => void runSearch(submittedRef.current, false) })
        : null,
      error && items.length === 0
        ? h(ErrorNotice, { ctx, error, onRetry: () => void runSearch(submittedRef.current, false) })
        : null,
      showEmpty
        ? h(EmptyState, {
            ctx,
            icon: "SearchX",
            title: t("search.empty"),
            hint: t("search.emptyHint"),
          })
        : null,
      items.length > 0
        ? h("div", { className: "hg-result-count" }, t("search.results", { count: items.length }))
        : null,
      items.length > 0
        ? h(
            "div",
            { className: "hg-results" },
            items.map((item) =>
              h(
                "button",
                {
                  key: item.id,
                  type: "button",
                  className: "hg-result",
                  onClick: () => ctx.openSeries(item),
                },
                h(Cover, { ctx, path: item.cover, className: "hg-result-cover" }),
                h(
                  "div",
                  { className: "hg-result-main" },
                  h("div", { className: "hg-result-title" }, item.title || t("unit.untitled")),
                  h(
                    "div",
                    { className: "hg-result-meta" },
                    item.count != null ? t("unit.episodes", { count: item.count }) : ""
                  ),
                  item.description
                    ? h("div", { className: "hg-result-desc" }, item.description)
                    : null
                )
              )
            )
          )
        : null,
      items.length > 0 && hasMore
        ? h(
            "button",
            {
              type: "button",
              className: "hg-btn hg-loadmore",
              disabled: status === "more",
              onClick: () => void runSearch(submittedRef.current, true),
            },
            status === "more" ? h(Spinner, { label: t("search.loadingMore") }) : null,
            status === "more" ? t("search.loadingMore") : t("search.loadMore")
          )
        : null
    )
  );
}

