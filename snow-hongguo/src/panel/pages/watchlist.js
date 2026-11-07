import { getReact, h } from "../ui/runtime.js";
import { Cover, EmptyState, ErrorNotice, Icon, Spinner, formatDuration } from "../ui/common.js";
import { WATCH_STATUSES, readHistory, readWatchlist, saveWatchlistEntry, removeWatchlistEntry } from "../storage.js";

const seedOf = (entry) => ({ id: entry.seriesId, title: entry.title, cover: entry.cover });

const STATUS_ICONS = { planned: "Bookmark", watching: "Play", completed: "Check" };

function StatusBadges({ ctx, value, disabled, onChange, title }) {
  return h("div", {
    className: "hg-watch-statuses", role: "group", "aria-busy": Boolean(disabled),
    "aria-label": `${ctx.t("watchlist.status")} · ${title || ctx.t("unit.untitled")}`,
  }, WATCH_STATUSES.map((status) => h("button", {
    key: status, type: "button", disabled,
    className: `hg-watch-status-badge${value === status ? " is-active" : ""}`,
    "data-status": status, "aria-pressed": value === status,
    onClick: () => { if (!disabled && status !== value) onChange(status); },
  }, h(Icon, { ctx, name: STATUS_ICONS[status], size: 11 }), ctx.t(`watchlist.${status}`))));
}

/** 详情页收藏入口。收藏状态与观看历史分别保存，删除历史不会移除收藏。 */
export function WatchlistControls({ ctx, series, hasProgress }) {
  const React = getReact();
  const [entry, setEntry] = React.useState(null);
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [reload, setReload] = React.useState(0);
  const sequence = React.useRef(0);
  const busyRef = React.useRef(false);

  React.useEffect(() => {
    const seq = ++sequence.current;
    setBusy(true);
    readWatchlist(ctx.api).then((list) => {
      if (seq !== sequence.current) return;
      setEntry(list.find((item) => item.seriesId === series.id) || null);
      setError(null);
    }).catch((err) => {
      if (seq === sequence.current) setError(err);
    }).finally(() => {
      if (seq === sequence.current) setBusy(false);
    });
    return () => { sequence.current += 1; };
  }, [ctx.api, series.id, ctx.watchlistVersion, reload]);

  const change = async (status) => {
    if (busyRef.current || busy) return;
    busyRef.current = true;
    setBusy(true);
    const seq = ++sequence.current;
    try {
      const list = status === null
        ? await removeWatchlistEntry(ctx.api, series.id)
        : await saveWatchlistEntry(ctx.api, {
            seriesId: series.id, title: series.title, cover: series.cover, count: series.count, status,
          });
      if (seq === sequence.current) setEntry(list.find((item) => item.seriesId === series.id) || null);
      ctx.bumpWatchlist();
    } catch (err) {
      if (seq === sequence.current) ctx.notify("error", ctx.t("watchlist.saveFailed"));
      ctx.log?.("[watchlist] 保存失败", String(err?.message || err));
    } finally {
      busyRef.current = false;
      if (seq === sequence.current) setBusy(false);
    }
  };

  if (error) return h(ErrorNotice, { ctx, error, compact: true, onRetry: () => setReload((value) => value + 1) });
  return h("div", { className: "hg-watch-actions" },
    h("button", {
      type: "button",
      className: `hg-btn${entry ? " is-saved" : ""}`,
      disabled: busy,
      "aria-pressed": Boolean(entry),
      onClick: () => void change(entry ? null : hasProgress ? "watching" : "planned"),
    }, h(Icon, { ctx, name: entry ? "BookmarkCheck" : "Bookmark", size: 14 }),
    ctx.t(entry ? "watchlist.saved" : "watchlist.add")),
    entry ? h(StatusBadges, {
      ctx, title: series.title, value: entry.status, disabled: busy, onChange: (status) => void change(status),
    }) : null
  );
}

export function WatchlistPage({ ctx, active, historyVersion, watchlistVersion }) {
  const React = getReact();
  const t = ctx.t;
  const [list, setList] = React.useState([]);
  const [history, setHistory] = React.useState([]);
  const [filter, setFilter] = React.useState("all");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const sequence = React.useRef(0);
  const busyRef = React.useRef(false);

  React.useEffect(() => {
    if (!active) return undefined;
    const seq = ++sequence.current;
    setLoading(true);
    Promise.all([readWatchlist(ctx.api), readHistory(ctx.api)]).then(([saved, records]) => {
      if (seq !== sequence.current) return;
      setList(saved);
      setHistory(records);
      setError(null);
    }).catch((err) => {
      if (seq === sequence.current) setError(err);
    }).finally(() => {
      if (seq === sequence.current) setLoading(false);
    });
    return () => { sequence.current += 1; };
  }, [ctx.api, active, historyVersion, watchlistVersion, reload]);

  const change = async (entry, status) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const seq = ++sequence.current;
    try {
      const saved = status === null
        ? await removeWatchlistEntry(ctx.api, entry.seriesId)
        : await saveWatchlistEntry(ctx.api, { ...entry, status });
      if (seq === sequence.current) {
        setList(saved);
        setLoading(false);
        setError(null);
      }
      ctx.bumpWatchlist();
    } catch (err) {
      if (seq === sequence.current) ctx.notify("error", t("watchlist.saveFailed"));
      ctx.log?.("[watchlist] 保存失败", String(err?.message || err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const visible = list.filter((entry) => filter === "all" || entry.status === filter);
  return h("div", { className: "hg-page hg-watchlist" },
    h("div", { className: "hg-page-head" },
      h("div", { className: "hg-page-title" }, t("watchlist.heading")),
      loading ? h(Spinner, { label: t("watchlist.loading") }) : h("span", { className: "hg-count" }, String(list.length))
    ),
    h("div", { className: "hg-scroll" },
      error ? h(ErrorNotice, { ctx, error, onRetry: () => setReload((value) => value + 1) }) : null,
      h("div", { className: "hg-watch-filters", role: "group", "aria-label": t("watchlist.filter") },
        ["all", ...WATCH_STATUSES].map((status) => h("button", {
          key: status, type: "button", className: `hg-watch-filter${filter === status ? " is-active" : ""}`,
          "aria-pressed": filter === status, onClick: () => setFilter(status),
        }, t(`watchlist.${status}`), h("span", { className: "hg-count" }, String(
          status === "all" ? list.length : list.filter((entry) => entry.status === status).length
        ))))
      ),
      !loading && !error && visible.length === 0 ? h(EmptyState, {
        ctx, icon: "Bookmark", title: t(list.length ? "watchlist.filterEmpty" : "watchlist.empty"),
        hint: t("watchlist.emptyHint"),
        action: h("button", { type: "button", className: "hg-btn", onClick: () => ctx.openTab("discover") }, t("action.browse")),
      }) : null,
      h("div", { className: "hg-watch-list" }, visible.map((entry) => {
        const record = history.find((item) => item.seriesId === entry.seriesId);
        return h("article", { key: entry.seriesId, className: "hg-watch-card" },
          h("button", { type: "button", className: "hg-history-main", onClick: () => ctx.openSeries(seedOf(entry)) },
            h(Cover, { ctx, path: entry.cover, className: "hg-history-cover" }),
            h("span", { className: "hg-history-text" },
              h("span", { className: "hg-history-title" }, entry.title || t("unit.untitled")),
              h("span", { className: "hg-history-meta" }, record ? t("detail.continueAt", {
                number: record.episodeNumber, time: formatDuration(record.positionMs),
              }) : entry.count ? t("unit.episodes", { count: entry.count }) : t(`watchlist.${entry.status}`))
            )
          ),
          h("div", { className: "hg-watch-card-actions" },
            h(StatusBadges, { ctx, title: entry.title, value: entry.status, disabled: busy, onChange: (status) => void change(entry, status) }),
            h("button", {
              type: "button", className: "hg-linkbtn", disabled: busy,
              "aria-label": `${t("watchlist.remove")} · ${entry.title}`, onClick: () => void change(entry, null),
            }, t("watchlist.remove"))
          )
        );
      }))
    )
  );
}
