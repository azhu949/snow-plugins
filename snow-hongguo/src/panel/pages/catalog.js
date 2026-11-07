import { getReact, h } from "../ui/runtime.js";
import { Cover, EmptyState, ErrorNotice, Icon, SkeletonCards, Spinner } from "../ui/common.js";
import { Select } from "../ui/select.js";
import { DiscoverPage } from "./discover.js";

const emptyList = () => ({ items: [], page: null, cursor: null, hasMore: false, status: "idle", error: null });
const mergeItems = (previous, incoming) => {
  const seen = new Set();
  return [...previous, ...(Array.isArray(incoming) ? incoming : [])].filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

/** 查询变化作废旧响应；后续分页始终沿用当前查询，失败时保留列表及游标供重试。 */
function useCatalogList(React, active, request) {
  const [state, setState] = React.useState(emptyList);
  const stateRef = React.useRef(state);
  const identity = React.useRef(null);
  const generation = React.useRef(0);
  const busy = React.useRef(false);
  const loaded = React.useRef(false);
  const alive = React.useRef(true);
  const seenCursors = React.useRef(new Set());
  const publish = (next) => { stateRef.current = next; setState(next); };

  React.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; generation.current += 1; };
  }, []);

  const load = React.useCallback(async (append = false) => {
    // 子组件的滚动监听可能早于查询重置 effect 执行，旧游标不能用于新查询。
    if (append && identity.current !== request) return;
    if (busy.current || (append && !stateRef.current.hasMore)) return;
    const seq = append ? generation.current : ++generation.current;
    const before = stateRef.current;
    const cursor = append ? before.cursor : null;
    if (!append) seenCursors.current.clear();
    if (cursor) seenCursors.current.add(cursor);
    busy.current = true;
    publish({ ...(append ? before : emptyList()), status: append ? "more" : "loading", error: null });
    try {
      const page = await request(cursor);
      if (!alive.current || seq !== generation.current) return;
      const nextCursor = page?.cursor || null;
      loaded.current = true;
      publish({
        items: mergeItems(append ? before.items : [], page?.items),
        page, cursor: nextCursor,
        hasMore: page?.hasMore === true && Boolean(nextCursor) && !seenCursors.current.has(nextCursor),
        status: "ready", error: null,
      });
    } catch (error) {
      if (!alive.current || seq !== generation.current) return;
      publish({ ...(append ? before : emptyList()), status: "error", error });
    } finally {
      if (seq === generation.current) busy.current = false;
    }
  }, [request]);

  React.useEffect(() => {
    if (identity.current !== request) {
      identity.current = request;
      generation.current += 1;
      busy.current = false;
      loaded.current = false;
      publish(emptyList());
    }
    if (active && !loaded.current && !busy.current) void load();
  }, [active, request, load]);

  return { ...state, load, busy: state.status === "loading" || state.status === "more" };
}

function CatalogItems({ ctx, list, active, scrollRef, ranked = false }) {
  const React = getReact();
  const t = ctx.t;
  const sentinelRef = React.useRef(null);

  // 与推荐页保持相同的触底距离；每页完成后重新测量，首屏不足时继续补页。
  React.useEffect(() => {
    if (!active || list.status !== "ready" || !list.hasMore) return undefined;
    const root = scrollRef.current;
    if (!root) return undefined;
    let disposed = false;
    const checkNearEnd = () => {
      if (disposed || root.clientHeight <= 0) return;
      if (root.scrollHeight - root.scrollTop - root.clientHeight < 240) void list.load(true);
    };
    const intersectionObserver = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(checkNearEnd, { root, rootMargin: "240px 0px" }) : null;
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(checkNearEnd) : null;
    if (sentinelRef.current) intersectionObserver?.observe(sentinelRef.current);
    resizeObserver?.observe(root);
    root.addEventListener("scroll", checkNearEnd, { passive: true });
    window.addEventListener("resize", checkNearEnd);
    checkNearEnd();
    return () => {
      disposed = true;
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      root.removeEventListener("scroll", checkNearEnd);
      window.removeEventListener("resize", checkNearEnd);
    };
  }, [active, scrollRef, list.load, list.status, list.hasMore, list.cursor]);

  return h("div", { className: "hg-catalog-results", "aria-busy": list.busy },
    list.error ? h(ErrorNotice, {
      ctx, error: list.error, compact: list.items.length > 0,
      onRetry: () => void list.load(list.hasMore && list.error.code !== "CURSOR_EXPIRED"),
    }) : null,
    list.status === "loading" ? h(SkeletonCards, { count: 4 }) : null,
    list.status === "ready" && list.items.length === 0 && !list.hasMore ? h(EmptyState, {
      ctx, icon: ranked ? "Trophy" : "ListFilter", title: t("catalog.empty"), hint: t("catalog.emptyHint"),
    }) : null,
    list.items.length ? h("div", { className: ranked ? "hg-rank-list" : "hg-grid" },
      list.items.map((item) => h("button", {
        key: item.id, type: "button", className: ranked ? "hg-rank-item" : "hg-card",
        title: item.title || t("unit.untitled"), onClick: () => ctx.openSeries(item),
      },
      ranked ? h("span", {
        className: `hg-rank-number${!item.promoted && item.position > 0 && item.position <= 3 ? " is-top" : ""}`,
        "aria-label": item.promoted ? t("catalog.promoted") : item.position ? t("catalog.rankNumber", { number: item.position }) : undefined,
      }, item.promoted ? "—" : item.position || "—") : null,
      h("div", { className: "hg-card-cover" },
        h(Cover, { ctx, path: item.cover }),
        !ranked && item.count != null ? h("span", { className: "hg-card-badge" }, t("unit.episodes", { count: item.count })) : null
      ),
      h("div", { className: ranked ? "hg-rank-info" : "hg-card-info" },
        h("div", { className: "hg-card-title" }, item.title || t("unit.untitled")),
        ranked && item.count != null ? h("div", { className: "hg-meta" }, t("unit.episodes", { count: item.count })) : null,
        ranked ? h("div", { className: "hg-rank-score" }, item.promoted ? t("catalog.promoted") : item.score) : null
      )))
    ) : null,
    list.items.length || list.hasMore ? h("div", { className: "hg-list-foot", ref: sentinelRef },
      list.status === "more" ? h(Spinner, { label: t("discover.loadingMore") })
        : list.hasMore ? (!list.error ? h("span", null, t("action.loadMore")) : null)
          : h("span", null, t("discover.end"))
    ) : null
  );
}

function RankPage({ ctx, active }) {
  const React = getReact();
  const t = ctx.t;
  const [query, setQuery] = React.useState({});
  const [directory, setDirectory] = React.useState([]);
  // 首次查询可能由上游选择默认子榜；翻页固定到该响应对应的内容/子榜。
  const request = React.useMemo(() => {
    let resolved = query;
    return async (cursor) => {
      const page = await ctx.rpc.getRank({ ...(cursor ? resolved : query), cursor });
      resolved = { content: page?.content || query.content, board: page?.board || query.board };
      return page;
    };
  }, [ctx.rpc, query]);
  const list = useCatalogList(React, active, request);
  const scroll = React.useRef(null);

  React.useEffect(() => {
    if (list.page?.contents?.length) setDirectory(list.page.contents);
  }, [list.page]);
  React.useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [query]);

  const content = list.page?.content || query.content || directory.find((item) => item.selected)?.id || directory[0]?.id || "";
  const boards = directory.find((item) => item.id === content)?.boards || [];
  const board = list.page?.board || query.board || boards.find((item) => item.selected)?.id || "";
  return h("div", { className: "hg-page hg-ranking" },
    h("div", { className: "hg-page-head" },
      h("div", { className: "hg-page-title" }, t("catalog.rank")),
      h("button", { type: "button", className: "hg-iconbtn", disabled: list.busy,
        title: t("action.refresh"), "aria-label": t("action.refresh"), onClick: () => void list.load() },
        h(Icon, { ctx, name: "RefreshCw", size: 15 }))
    ),
    h("div", { className: "hg-scroll", ref: scroll },
      directory.length ? h("div", { className: "hg-catalog-controls" },
        h("label", { className: "hg-catalog-field" }, h("span", null, t("catalog.content")),
          h(Select, { ariaLabel: t("catalog.content"), value: content, active,
            onChange: (value) => setQuery({ content: value }),
            options: directory.map((item) => ({ value: item.id, label: item.name })) })
        ),
        boards.length ? h("label", { className: "hg-catalog-field" }, h("span", null, t("catalog.board")),
          h(Select, { ariaLabel: t("catalog.board"), value: board, active,
            onChange: (value) => setQuery({ content, board: value }),
            options: [
              ...(!board ? [{ value: "", label: t("catalog.defaultBoard") }] : []),
              ...boards.map((item) => ({ value: item.id, label: item.name })),
            ] })
        ) : null
      ) : null,
      h(CatalogItems, { ctx, list, active, scrollRef: scroll, ranked: true })
    )
  );
}

function FilterPage({ ctx, active }) {
  const React = getReact();
  const t = ctx.t;
  const [selections, setSelections] = React.useState({});
  const [panel, setPanel] = React.useState({ genre: null, rows: [], status: "idle", error: null });
  const [reload, setReload] = React.useState(0);
  const panelSeq = React.useRef(0);
  const scroll = React.useRef(null);
  const genre = selections.genre?.[0] || "";
  const request = React.useCallback((cursor) => ctx.rpc.filterSeries(selections, cursor), [ctx.rpc, selections]);
  const list = useCatalogList(React, active && panel.status === "ready" && panel.genre === genre, request);

  React.useEffect(() => {
    // 从详情或其它页签返回时复用面板，避免移除结果导致滚动位置归零。
    if (!active || (panel.genre === genre && panel.status === "ready")) return undefined;
    let alive = true;
    const seq = ++panelSeq.current;
    setPanel((prev) => ({ ...prev, status: "loading", error: null }));
    ctx.rpc.getFilterPanel(genre).then((result) => {
      if (!alive || seq !== panelSeq.current) return;
      setPanel({ genre, rows: Array.isArray(result?.rows) ? result.rows : [], status: "ready", error: null });
    }).catch((error) => {
      if (alive && seq === panelSeq.current) setPanel((prev) => ({ ...prev, status: "error", error }));
    });
    return () => { alive = false; };
  }, [ctx.rpc, active, genre, reload]);
  React.useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [selections]);

  const choose = (key, value) => {
    // 新剧种可能有不同维度，旧题材/年代不能带入新剧种；值来自服务端，不硬编码。
    setSelections((previous) => {
      const next = key === "genre" ? {} : { ...previous };
      if (value) next[key] = [value];
      else delete next[key];
      return next;
    });
  };
  const currentPanel = panel.genre === genre;
  return h("div", { className: "hg-page hg-filter-page" },
    h("div", { className: "hg-page-head" },
      h("div", { className: "hg-page-title" }, t("catalog.filter")),
      h("button", { type: "button", className: "hg-linkbtn", disabled: !Object.keys(selections).length,
        onClick: () => setSelections({}) }, t("catalog.reset")),
      h("button", { type: "button", className: "hg-iconbtn", disabled: list.busy || panel.status !== "ready" || !currentPanel,
        title: t("action.refresh"), "aria-label": t("action.refresh"), onClick: () => void list.load() },
        h(Icon, { ctx, name: "RefreshCw", size: 15 }))
    ),
    h("div", { className: "hg-scroll", ref: scroll },
      panel.status === "loading" ? h("div", { className: "hg-loading-line" },
        h(Spinner, { label: t("catalog.filtersLoading") }), t("catalog.filtersLoading")) : null,
      panel.error ? h(ErrorNotice, { ctx, error: panel.error, onRetry: () => setReload((value) => value + 1) }) : null,
      currentPanel && panel.rows.length ? h("div", { className: "hg-catalog-controls hg-filter-controls" },
        panel.rows.map((row) => h("label", { key: row.key, className: "hg-catalog-field" },
          h("span", null, row.name),
          h(Select, {
            ariaLabel: row.name, filterKey: row.key, active,
            value: selections[row.key]?.[0] || "", disabled: panel.status !== "ready",
            onChange: (value) => choose(row.key, value),
            options: [
              ...(!row.options.some((option) => option.value === "") ? [{ value: "", label: t("catalog.any") }] : []),
              ...row.options.map((option) => ({ value: option.value, label: option.name })),
            ],
          })
        ))
      ) : null,
      currentPanel && panel.status === "ready" ? h(CatalogItems, { ctx, list, active, scrollRef: scroll }) : null
    )
  );
}

/** 推荐、排行和分类在同一发现页内切换；只在首次访问时挂载，返回时保留列表和选择。 */
export function DiscoveryPage({ ctx, active }) {
  const React = getReact();
  const [mode, setMode] = React.useState("recommend");
  const [visited, setVisited] = React.useState({ recommend: true });
  const pages = { recommend: DiscoverPage, rank: RankPage, filter: FilterPage };
  return h("div", { className: "hg-page hg-discovery" },
    h("div", { className: "hg-discovery-modes", role: "group", "aria-label": ctx.t("catalog.navigation") },
      Object.keys(pages).map((id) => h("button", {
        type: "button", key: id, className: `hg-discovery-mode${mode === id ? " is-active" : ""}`,
        "aria-pressed": mode === id,
        onClick: () => { setMode(id); setVisited((prev) => ({ ...prev, [id]: true })); },
      }, ctx.t(`catalog.${id}`)))
    ),
    Object.entries(pages).map(([id, Component]) => visited[id] ? h("div", {
      key: id, className: "hg-discovery-pane", hidden: mode !== id,
    }, h(Component, { ctx, active: active && mode === id })) : null)
  );
}
