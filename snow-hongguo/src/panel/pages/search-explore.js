import { getReact, h } from "../ui/runtime.js";
import { ErrorNotice, Spinner } from "../ui/common.js";

/** 热搜只在搜索首页首次可见时加载，输入/返回保留已有榜单。 */
export function SearchExplore({ ctx, active, visible, onSearch }) {
  const React = getReact();
  const [state, setState] = React.useState({ status: "idle", data: null, error: null });
  const [retry, setRetry] = React.useState(0);
  const loaded = React.useRef(false);
  React.useEffect(() => {
    if (!active || !visible || loaded.current) return undefined;
    let alive = true;
    setState((prev) => ({ ...prev, status: "loading", error: null }));
    Promise.resolve().then(() => ctx.rpc.hotSearch()).then((data) => {
      if (!alive) return;
      loaded.current = true;
      setState({ status: "ready", data, error: null });
    }).catch((error) => {
      if (alive) setState({ status: "error", data: null, error });
    });
    return () => { alive = false; };
  }, [ctx.rpc, active, visible, retry]);

  if (!visible) return null;
  const { t } = ctx;
  const guesses = state.data?.guesses || [];
  const boards = state.data?.boards || [];
  return h("div", { className: "hg-search-explore" },
    state.status === "loading" ? h("div", { className: "hg-loading-line" },
      h(Spinner, { label: t("search.hotLoading") }), t("search.hotLoading")) : null,
    state.error ? h(ErrorNotice, { ctx, error: state.error, compact: true, onRetry: () => setRetry((value) => value + 1) }) : null,
    guesses.length ? h("section", { className: "hg-search-section" },
      h("div", { className: "hg-sec-head" }, t("search.guesses")),
      h("div", { className: "hg-chips" }, guesses.map((item) => h("button", {
        key: item.id, type: "button", className: "hg-chip", title: item.title, onClick: () => ctx.openSeries(item),
      }, item.title)))
    ) : null,
    boards.map((board, index) => h("section", { key: `${index}:${board.name}`, className: "hg-search-section" },
      h("div", { className: "hg-sec-head" }, board.name),
      h("div", { className: "hg-hot-list" },
        (board.items || []).map((item, position) => h("button", {
          key: item.id, type: "button", className: "hg-hot-row", onClick: () => ctx.openSeries(item), title: item.title,
        },
        h("span", { className: `hg-hot-position${(item.position || position + 1) <= 3 ? " is-top" : ""}` }, item.position || position + 1),
        h("span", { className: "hg-hot-title" }, item.title),
        item.tag ? h("span", { className: "hg-hot-tag" }, item.tag) : null,
        item.score ? h("span", { className: "hg-hot-score" }, item.score) : null)),
        (board.topics || []).map((topic) => h("button", {
          key: `topic:${topic.query}`, type: "button", className: "hg-hot-row hg-hot-topic", onClick: () => onSearch(topic.query), title: topic.title,
        }, h("span", { className: "hg-hot-position", "aria-hidden": true }, "#"),
        h("span", { className: "hg-hot-title" }, topic.title),
        topic.heat ? h("span", { className: "hg-hot-score" }, topic.heat) : null))
      )
    ))
  );
}
