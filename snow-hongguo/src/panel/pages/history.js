// 历史页：api.storage 的 history 数组，按 updatedAt 倒序；支持删除单条与清空。
import { getReact, h } from "../ui/runtime.js";
import { Cover, EmptyState, ErrorNotice, Icon, Spinner, describeError, formatDateTime, formatDuration } from "../ui/common.js";
import { clearHistory, readHistory, removeHistory } from "../storage.js";

export function HistoryPage({ ctx, active, historyVersion }) {
  const React = getReact();
  const t = ctx.t;
  const api = ctx.api;
  const [list, setList] = React.useState([]);
  const [status, setStatus] = React.useState("loading");
  const [error, setError] = React.useState(null);
  const [pendingDelete, setPendingDelete] = React.useState(null);
  const [confirmClear, setConfirmClear] = React.useState(false);

  const aliveRef = React.useRef(true);
  const deleteTimerRef = React.useRef(null);
  const clearTimerRef = React.useRef(null);

  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  const load = React.useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const next = await readHistory(api);
      if (!aliveRef.current) return;
      setList(next);
      setStatus("idle");
    } catch (loadError) {
      if (!aliveRef.current) return;
      setError(loadError);
      setStatus("error");
    }
  }, [api]);

  // 页签激活或历史版本变化（详情页写入 / 本页删除）时重新读取。
  React.useEffect(() => {
    if (!active) return;
    void load();
  }, [active, historyVersion, load]);

  const askDelete = (seriesId) => {
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    if (pendingDelete === seriesId) {
      setPendingDelete(null);
      removeHistory(api, seriesId)
        .then((next) => {
          if (!aliveRef.current) return;
          setList(next);
          ctx.bumpHistory();
          ctx.notify("success", t("history.removed"));
        })
        .catch((deleteError) => {
          if (!aliveRef.current) return;
          ctx.notify("error", describeError(t, deleteError).message);
        });
      return;
    }
    setPendingDelete(seriesId);
    deleteTimerRef.current = setTimeout(() => {
      deleteTimerRef.current = null;
      if (aliveRef.current) setPendingDelete(null);
    }, 3000);
  };

  const askClear = () => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null;
        if (aliveRef.current) setConfirmClear(false);
      }, 4000);
      return;
    }
    setConfirmClear(false);
    clearHistory(api)
      .then(() => {
        if (!aliveRef.current) return;
        setList([]);
        ctx.bumpHistory();
        ctx.notify("success", t("history.cleared"));
      })
      .catch((clearError) => {
        if (!aliveRef.current) return;
        ctx.notify("error", describeError(t, clearError).message);
      });
  };

  return h(
    "div",
    { className: "hg-page hg-history" },
    h(
      "div",
      { className: "hg-page-head" },
      h("div", { className: "hg-page-title" }, t("history.heading")),
      status === "loading" && list.length > 0 ? h(Spinner, { label: t("history.heading") }) : null,
      list.length > 0
        ? h(
            "button",
            {
              type: "button",
              className: `hg-linkbtn${confirmClear ? " is-danger" : ""}`,
              onClick: askClear,
            },
            confirmClear ? t("history.clearConfirm") : t("history.clear")
          )
        : null
    ),
    h(
      "div",
      { className: "hg-scroll" },
      status === "loading" && list.length === 0
        ? h(
            "div",
            { className: "hg-history-skeleton" },
            Array.from({ length: 3 }, (_, index) =>
              h(
                "div",
                { key: `history-skeleton-${index}`, className: "hg-skeleton-row" },
                h("div", { className: "hg-skeleton hg-skeleton-thumb" }),
                h(
                  "div",
                  { className: "hg-skeleton-row-main" },
                  h("div", { className: "hg-skeleton hg-skeleton-line" }),
                  h("div", { className: "hg-skeleton hg-skeleton-line short" })
                )
              )
            )
          )
        : null,
      status === "error" && error
        ? h(ErrorNotice, { ctx, error, onRetry: () => void load() })
        : null,
      status !== "error" && status !== "loading" && list.length === 0
        ? h(EmptyState, {
            ctx,
            icon: "History",
            title: t("history.empty"),
            hint: t("history.emptyHint"),
            action: h(
              "button",
              { type: "button", className: "hg-btn", onClick: () => ctx.openTab("discover") },
              t("action.browse")
            ),
          })
        : null,
      list.length > 0
        ? h(
            "div",
            { className: "hg-history-list" },
            list.map((entry) => {
              const confirming = pendingDelete === entry.seriesId;
              return h(
                "div",
                { className: "hg-history-row", key: entry.seriesId },
                h(
                  "button",
                  {
                    type: "button",
                    className: "hg-history-main",
                    onClick: () =>
                      ctx.openSeries({
                        id: entry.seriesId,
                        title: entry.title,
                        cover: entry.cover,
                      }),
                  },
                  h(Cover, { ctx, path: entry.cover, className: "hg-history-cover" }),
                  h(
                    "div",
                    { className: "hg-history-text" },
                    h("div", { className: "hg-history-title" }, entry.title || t("unit.untitled")),
                    h(
                      "div",
                      { className: "hg-history-meta" },
                      t("history.lastWatched", {
                        number: entry.episodeNumber,
                        time: formatDuration(entry.positionMs),
                      })
                    )
                  ),
                  h(
                    "div",
                    { className: "hg-history-time" },
                    formatDateTime(entry.updatedAt, ctx.locale)
                  )
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: `hg-iconbtn danger${confirming ? " is-confirming" : ""}`,
                    title: confirming ? t("history.confirmRemove") : t("history.remove"),
                    "aria-label": confirming ? t("history.confirmRemove") : t("history.remove"),
                    onClick: () => askDelete(entry.seriesId),
                  },
                  confirming
                    ? h("span", { className: "hg-confirm-text" }, t("history.confirmRemove"))
                    : h(Icon, { ctx, name: "Trash2", size: 14 })
                )
              );
            })
          )
        : null
    )
  );
}

