// 推荐页：卡片网格 + 触底分页 + 下拉刷新。
import { getReact, h } from "../ui/runtime.js";
import { Cover, EmptyState, ErrorNotice, Icon, SkeletonCards, Spinner } from "../ui/common.js";

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

export function DiscoverPage({ ctx, active }) {
  const React = getReact();
  const t = ctx.t;
  const rpc = ctx.rpc;
  const [items, setItems] = React.useState([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [status, setStatus] = React.useState("idle");
  const [error, setError] = React.useState(null);
  const [loaded, setLoaded] = React.useState(false);
  const [pull, setPull] = React.useState(0);

  const scrollRef = React.useRef(null);
  const sentinelRef = React.useRef(null);
  const itemsRef = React.useRef([]);
  const cursorRef = React.useRef(null);
  const hasMoreRef = React.useRef(false);
  const busyRef = React.useRef(false);
  const seqRef = React.useRef(0);
  const loadedRef = React.useRef(false);
  const scheduleNearEndCheckRef = React.useRef(null);
  const autoMorePausedRef = React.useRef(false);
  const suppressUntilRef = React.useRef(0);
  const pullRef = React.useRef({ active: false, startY: 0, moved: false, value: 0 });

  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const loadFirst = React.useCallback(
    async (refresh) => {
      const seq = seqRef.current + 1;
      seqRef.current = seq;
      busyRef.current = true;
      setStatus(refresh ? "refreshing" : "loading");
      setError(null);

      let succeeded = false;
      try {
        const page = await rpc.discover();
        if (seq !== seqRef.current) return;
        const list = dedupeById(Array.isArray(page?.items) ? page.items : []);
        itemsRef.current = list;
        setItems(list);
        cursorRef.current = page?.cursor ?? null;
        hasMoreRef.current = page?.hasMore === true;
        autoMorePausedRef.current = false;
        setHasMore(hasMoreRef.current);
        setStatus("idle");
        setLoaded(true);
        loadedRef.current = true;
        if (refresh && scrollRef.current && typeof scrollRef.current.scrollTo === "function") {
          scrollRef.current.scrollTo({ top: 0 });
        }
        succeeded = true;
      } catch (loadError) {
        if (seq !== seqRef.current) return;
        setError(loadError);
        setStatus("error");
      } finally {
        if (seq === seqRef.current) {
          busyRef.current = false;
          if (succeeded && hasMoreRef.current) scheduleNearEndCheckRef.current?.();
        }
      }
    },
    [rpc]
  );

  const loadMore = React.useCallback(async () => {
    if (busyRef.current || !hasMoreRef.current || !cursorRef.current) return;
    const seq = seqRef.current;
    const requestCursor = cursorRef.current;
    busyRef.current = true;
    setStatus("more");
    setError(null);

    let succeeded = false;
    try {
      const page = await rpc.discover(requestCursor);
      if (seq !== seqRef.current) return;
      const incoming = dedupeById(Array.isArray(page?.items) ? page.items : []);
      const merged = dedupeById([...itemsRef.current, ...incoming]);
      const nextCursor = page?.cursor ?? null;
      const nextHasMore = page?.hasMore === true && Boolean(nextCursor) && nextCursor !== requestCursor;
      itemsRef.current = merged;
      setItems(merged);
      cursorRef.current = nextCursor;
      hasMoreRef.current = nextHasMore;
      autoMorePausedRef.current = false;
      setHasMore(nextHasMore);
      setStatus("idle");
      succeeded = true;
    } catch (loadError) {
      if (seq !== seqRef.current) return;
      autoMorePausedRef.current = true;
      setError(loadError);
      setStatus("idle");
    } finally {
      if (seq === seqRef.current) {
        busyRef.current = false;
        if (succeeded && hasMoreRef.current) scheduleNearEndCheckRef.current?.();
      }
    }
  }, [rpc]);

  // 首次进入（或失败后重新切回页签）加载第一页。
  React.useEffect(() => {
    if (!active) return;
    if (loadedRef.current || busyRef.current) return;
    void loadFirst(false);
  }, [active, loadFirst]);

  // 触底加载：首屏和面板扩容后按真实剩余空间补页，直至出现足够的可滚动内容。
  React.useEffect(() => {
    if (!active) return undefined;
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!root) return undefined;

    let disposed = false;
    let frame = null;
    const checkNearEnd = () => {
      if (disposed) return;
      const nearEnd = root.scrollHeight - root.scrollTop - root.clientHeight < 240;
      if (!nearEnd) {
        autoMorePausedRef.current = false;
        return;
      }
      if (!autoMorePausedRef.current) void loadMore();
    };
    const scheduleNearEndCheck = () => {
      if (disposed || frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        checkNearEnd();
      });
    };
    scheduleNearEndCheckRef.current = scheduleNearEndCheck;

    const intersectionObserver =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            () => {
              checkNearEnd();
            },
            { root, rootMargin: "240px 0px" }
          )
        : null;
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(checkNearEnd) : null;
    if (sentinel) intersectionObserver?.observe(sentinel);
    resizeObserver?.observe(root);
    root.addEventListener("scroll", checkNearEnd, { passive: true });
    window.addEventListener("resize", checkNearEnd);
    checkNearEnd();

    return () => {
      disposed = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (scheduleNearEndCheckRef.current === scheduleNearEndCheck) scheduleNearEndCheckRef.current = null;
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      root.removeEventListener("scroll", checkNearEnd);
      window.removeEventListener("resize", checkNearEnd);
    };
  }, [active, hasMore, items.length, loadMore]);

  const endPull = () => {
    const state = pullRef.current;
    if (!state.active) return;
    state.active = false;
    const shouldRefresh = state.value >= 48;
    const moved = state.moved;
    state.value = 0;
    setPull(0);
    if (moved) suppressUntilRef.current = Date.now() + 250;
    if (shouldRefresh && !busyRef.current) void loadFirst(true);
  };

  const onPointerDown = (event) => {
    if (busyRef.current) return;
    const root = scrollRef.current;
    if (!root || root.scrollTop > 0) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pullRef.current = { active: true, startY: event.clientY, moved: false, value: 0 };
  };

  const onPointerMove = (event) => {
    const state = pullRef.current;
    if (!state.active) return;
    const root = scrollRef.current;
    const delta = event.clientY - state.startY;
    if (!root || root.scrollTop > 0 || delta <= 0) {
      if (state.value !== 0) {
        state.value = 0;
        setPull(0);
      }
      if (delta < -6) state.active = false;
      return;
    }
    if (delta > 8) state.moved = true;
    const value = Math.min(72, delta * 0.55);
    state.value = value;
    setPull(value);
  };

  const openItem = (item) => {
    if (Date.now() < suppressUntilRef.current) return;
    ctx.openSeries(item);
  };

  const busy = status === "loading" || status === "refreshing" || status === "more";
  const showEmpty = loaded && !busy && items.length === 0 && !error;

  return h(
    "div",
    { className: "hg-page hg-discover" },
    h(
      "div",
      { className: "hg-page-head" },
      h("div", { className: "hg-page-title" }, t("discover.heading")),
      h(
        "button",
        {
          type: "button",
          className: `hg-iconbtn${busy ? " is-busy" : ""}`,
          title: t("action.refresh"),
          "aria-label": t("action.refresh"),
          disabled: busy,
          onClick: () => void loadFirst(true),
        },
        h(Icon, { ctx, name: "RefreshCw", size: 15 })
      )
    ),
    h(
      "div",
      {
        className: "hg-scroll hg-pull",
        ref: scrollRef,
        onPointerDown,
        onPointerMove,
        onPointerUp: endPull,
        onPointerCancel: endPull,
        onPointerLeave: endPull,
      },
      h(
        "div",
        { className: "hg-pull-bar", style: { height: `${pull}px` } },
        pull > 0
          ? h(
              "span",
              { className: "hg-pull-text" },
              pull >= 48 ? t("discover.release") : t("discover.pull")
            )
          : null
      ),
      status === "refreshing"
        ? h(
            "div",
            { className: "hg-loading-line" },
            h(Spinner, { label: t("discover.refreshing") }),
            h("span", null, t("discover.refreshing"))
          )
        : null,
      error && items.length > 0
        ? h(ErrorNotice, { ctx, error, compact: true, onRetry: () => void loadFirst(true) })
        : null,
      items.length === 0 && (status === "loading" || status === "refreshing")
        ? h(SkeletonCards, { count: 4 })
        : null,
      items.length === 0 && status === "error" && error
        ? h(ErrorNotice, { ctx, error, onRetry: () => void loadFirst(false) })
        : null,
      showEmpty
        ? h(EmptyState, {
            ctx,
            icon: "Popcorn",
            title: t("discover.empty"),
            hint: t("discover.emptyHint"),
            action: h(
              "button",
              { type: "button", className: "hg-btn", onClick: () => void loadFirst(true) },
              t("action.refresh")
            ),
          })
        : null,
      items.length > 0
        ? h(
            "div",
            { className: "hg-grid" },
            items.map((item) =>
              h(
                "button",
                {
                  key: item.id,
                  type: "button",
                  className: "hg-card",
                  title: item.title || t("unit.untitled"),
                  onClick: () => openItem(item),
                },
                h(
                  "div",
                  { className: "hg-card-cover" },
                  h(Cover, { ctx, path: item.cover }),
                  item.count != null
                    ? h("span", { className: "hg-card-badge" }, t("unit.episodes", { count: item.count }))
                    : null
                ),
                h("div", { className: "hg-card-title" }, item.title || t("unit.untitled"))
              )
            )
          )
        : null,
      items.length > 0
        ? h(
            "div",
            { className: "hg-list-foot", ref: sentinelRef },
            status === "more"
              ? h(Spinner, { label: t("discover.loadingMore") })
              : hasMore
                ? h("span", null, t("action.loadMore"))
                : h("span", null, t("discover.end"))
          )
        : null
    )
  );
}

