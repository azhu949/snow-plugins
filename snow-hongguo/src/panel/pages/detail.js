// 详情页：封面 / 标题 / 简介 / 分集网格 / 继续观看 / 播放器挂载点。
import { getReact, h } from "../ui/runtime.js";
import {
  Cover,
  ErrorNotice,
  Icon,
  describeError,
  formatDuration,
} from "../ui/common.js";
import { PlayerMount } from "../player.js";
import { readHistory, upsertHistory } from "../storage.js";

const normalizeEpisodes = (page) => {
  const rows = Array.isArray(page?.items) ? page.items : [];
  const list = [];
  rows.forEach((row, index) => {
    if (!row || row[0] == null) return;
    const id = String(row[0]);
    if (!id) return;
    const number = Number.isFinite(Number(row[1])) ? Number(row[1]) : index + 1;
    list.push({
      id,
      number,
      playable: Number(row[2]) === 1,
      title: typeof row[3] === "string" ? row[3] : "",
    });
  });
  return list;
};

export function DetailPage({ ctx, seed, onBack }) {
  const React = getReact();
  const t = ctx.t;
  const rpc = ctx.rpc;
  const api = ctx.api;
  const seriesId = seed?.id ? String(seed.id) : "";

  const [state, setState] = React.useState({
    status: "loading",
    error: null,
    series: null,
    episodes: [],
    episodesError: null,
    truncated: false,
    total: 0,
  });
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [positionMs, setPositionMs] = React.useState(0);
  const [historyEntry, setHistoryEntry] = React.useState(null);
  const [expanded, setExpanded] = React.useState(false);

  const seqRef = React.useRef(0);
  const aliveRef = React.useRef(true);
  const seriesRef = React.useRef(null);
  const episodesRef = React.useRef([]);
  const selectedRef = React.useRef(0);
  const positionRef = React.useRef(0);
  const lastSaveRef = React.useRef(0);
  // 5 秒节流的尾随补写：暂停 / 关闭面板时把最后一次进度落盘。
  const pendingSaveRef = React.useRef(null);
  const flushTimerRef = React.useRef(0);
  const persistRef = React.useRef(null);

  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = 0;
      }
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending) void persistRef.current?.(pending.index, pending.position);
    };
  }, []);

  React.useEffect(() => {
    seriesRef.current = state.series;
    episodesRef.current = state.episodes;
  }, [state.series, state.episodes]);

  React.useEffect(() => {
    selectedRef.current = selectedIndex;
  }, [selectedIndex]);

  React.useEffect(() => {
    positionRef.current = positionMs;
  }, [positionMs]);

  const load = React.useCallback(async () => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setState((prev) => ({ ...prev, status: "loading", error: null }));

    if (!seriesId) {
      const error = new Error(t("detail.missingId"));
      error.code = "MISSING_ID";
      setState({
        status: "error",
        error,
        series: null,
        episodes: [],
        episodesError: null,
        truncated: false,
        total: 0,
      });
      return;
    }

    try {
      const [series, episodesResult, historyList] = await Promise.all([
        rpc.getSeries(seriesId),
        rpc
          .getEpisodes(seriesId)
          .then((page) => ({ ok: true, page }))
          .catch((error) => ({ ok: false, error })),
        readHistory(api).catch(() => []),
      ]);
      if (seq !== seqRef.current || !aliveRef.current) return;

      const episodes = episodesResult.ok ? normalizeEpisodes(episodesResult.page) : [];
      const entry = Array.isArray(historyList)
        ? historyList.find((item) => item.seriesId === seriesId) || null
        : null;
      const resumed =
        entry && Number.isInteger(entry.episodeIndex) && entry.episodeIndex < episodes.length
          ? entry.episodeIndex
          : 0;
      const position = entry && resumed === entry.episodeIndex ? entry.positionMs : 0;

      setState({
        status: "idle",
        error: null,
        series,
        episodes,
        episodesError: episodesResult.ok ? null : episodesResult.error,
        truncated: episodesResult.ok ? episodesResult.page?.truncated === true : false,
        total: episodesResult.ok ? Number(episodesResult.page?.total) || episodes.length : 0,
      });
      setSelectedIndex(resumed);
      setPositionMs(position);
      setHistoryEntry(entry);
    } catch (error) {
      if (seq !== seqRef.current || !aliveRef.current) return;
      setState({
        status: "error",
        error,
        series: null,
        episodes: [],
        episodesError: null,
        truncated: false,
        total: 0,
      });
    }
  }, [api, rpc, seriesId, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const persist = React.useCallback(
    async (index, position) => {
      const series = seriesRef.current;
      if (!series) return;
      try {
        const list = await upsertHistory(api, {
          seriesId: series.id,
          title: series.title,
          cover: series.cover,
          episodeIndex: index,
          positionMs: position,
        });
        if (!aliveRef.current) return;
        setHistoryEntry(list.find((item) => item.seriesId === series.id) || null);
        ctx.bumpHistory();
      } catch (error) {
        ctx.notify("error", t("detail.recordFailed"));
        ctx.log?.("[detail] 写历史失败", String(error?.message || error));
      }
    },
    [ctx, t]
  );

  persistRef.current = persist;

  const selectEpisode = React.useCallback(
    (index, position) => {
      const episodes = episodesRef.current;
      if (!Number.isInteger(index) || index < 0 || index >= episodes.length) return;
      if (!episodes[index].playable) {
        ctx.notify("info", t("detail.unplayable"));
        return;
      }
      const nextPosition = Number.isFinite(Number(position)) && Number(position) > 0 ? Math.floor(Number(position)) : 0;
      // 主动选集优先于播放器的 5 秒补写，避免旧集位置把刚选的集号覆盖掉。
      pendingSaveRef.current = null;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = 0;
      }
      selectedRef.current = index;
      positionRef.current = nextPosition;
      setSelectedIndex(index);
      setPositionMs(nextPosition);
      void persist(index, nextPosition);
    },
    [ctx, persist, t]
  );

  const handleProgress = React.useCallback(
    (payload) => {
      const episodes = episodesRef.current;
      const index = Number.isInteger(payload?.episodeIndex) ? payload.episodeIndex : selectedRef.current;
      if (index < 0 || index >= episodes.length) return;
      const position = Math.max(0, Math.floor(Number(payload?.positionMs) || 0));
      // 续播时播放器可能先报 0，再 seek 到目标位置；不要用这个 0 覆盖已保存的进度。
      if (position <= 0 && positionRef.current > 0 && index === selectedRef.current) return;

      const apply = (targetIndex, targetPosition) => {
        selectedRef.current = targetIndex;
        positionRef.current = targetPosition;
        setSelectedIndex(targetIndex);
        setPositionMs(targetPosition);
        void persistRef.current?.(targetIndex, targetPosition);
      };

      const now = Date.now();
      const elapsed = now - lastSaveRef.current;
      if (elapsed >= 5000) {
        lastSaveRef.current = now;
        pendingSaveRef.current = null;
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = 0;
        }
        apply(index, position);
        return;
      }

      // 节流窗口内的最后一次进度先记下，窗口结束时补写；暂停/关闭面板时也会落盘。
      pendingSaveRef.current = { index, position };
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = 0;
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        if (!pending || !aliveRef.current) return;
        lastSaveRef.current = Date.now();
        apply(pending.index, pending.position);
      }, 5000 - elapsed);
    },
    [persist]
  );

  const handleEnded = React.useCallback(
    (payload) => {
      const episodes = episodesRef.current;
      const index = Number.isInteger(payload?.episodeIndex) ? payload.episodeIndex : selectedRef.current;
      const duration = Number(payload?.durationMs);
      const next = index + 1;
      if (next >= 0 && next < episodes.length) {
        selectEpisode(next, 0);
      } else if (index >= 0 && index < episodes.length) {
        const endPosition =
          Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : positionRef.current;
        void persist(index, endPosition);
      }
    },
    [persist, selectEpisode]
  );

  const handlePlayerError = React.useCallback(
    (error) => {
      const info = describeError(t, error);
      ctx.notify("error", info.message);
    },
    [ctx, t]
  );

  const retryEpisodes = async () => {
    if (!seriesId) return;
    try {
      const page = await rpc.getEpisodes(seriesId);
      if (!aliveRef.current) return;
      const episodes = normalizeEpisodes(page);
      setState((prev) => ({
        ...prev,
        episodes,
        episodesError: null,
        truncated: page?.truncated === true,
        total: Number(page?.total) || episodes.length,
      }));
    } catch (error) {
      if (!aliveRef.current) return;
      setState((prev) => ({ ...prev, episodesError: error }));
    }
  };

  const series = state.series;
  const episodes = state.episodes;
  const description = series?.description || "";
  const canExpand = description.length > 140;

  const historyIndex =
    historyEntry && historyEntry.episodeIndex >= 0 && historyEntry.episodeIndex < episodes.length
      ? historyEntry.episodeIndex
      : -1;
  const historyEpisode = historyIndex >= 0 ? episodes[historyIndex] : null;
  const resumeIndex =
    historyEntry && historyEntry.episodeIndex >= 0 && historyEntry.episodeIndex < episodes.length
      ? historyEntry.episodeIndex
      : 0;
  const resumeNumber = historyEpisode?.number ?? (historyEntry ? historyEntry.episodeIndex + 1 : 1);

  const tags = Array.isArray(series?.tags) ? series.tags : [];
  const meta = [];
  if (series?.count != null) meta.push(t("unit.episodes", { count: series.count }));
  else if (episodes.length > 0) meta.push(t("unit.episodes", { count: episodes.length }));
  if (series?.category) meta.push(String(series.category));
  if (series?.rightText) meta.push(String(series.rightText));

  const topTitle = series?.title || seed?.title || t("detail.loading");

  return h(
    "div",
    { className: "hg-page hg-detail" },
    h(
      "div",
      { className: "hg-detail-bar" },
      h(
        "button",
        {
          type: "button",
          className: "hg-iconbtn",
          title: t("action.back"),
          "aria-label": t("action.back"),
          onClick: onBack,
        },
        h(Icon, { ctx, name: "ChevronLeft", size: 16 })
      ),
      h("div", { className: "hg-detail-bar-title", title: topTitle }, topTitle)
    ),
    h(
      "div",
      { className: "hg-scroll" },
      state.status === "loading"
        ? h(
            "div",
            { className: "hg-detail-loading" },
            h("div", { className: "hg-skeleton hg-skeleton-player" }),
            h("div", { className: "hg-skeleton hg-skeleton-line" }),
            h("div", { className: "hg-skeleton hg-skeleton-line short" }),
            h("div", { className: "hg-skeleton hg-skeleton-line" })
          )
        : null,
      state.status === "error" && state.error
        ? h(ErrorNotice, { ctx, error: state.error, onRetry: () => void load() })
        : null,
      state.status === "idle" && series
        ? h(
            "div",
            { className: "hg-detail-body" },
            episodes.length > 0
              ? h(PlayerMount, {
                  ctx,
                  series,
                  episodes,
                  episodeIndex: selectedIndex,
                  positionMs,
                  onProgress: handleProgress,
                  onEnded: handleEnded,
                  onSelectEpisode: (index) => selectEpisode(index, 0),
                  onError: handlePlayerError,
                  onMiniChange: ctx.onMiniChange,
                })
              : null,
            h(
              "div",
              { className: "hg-detail-head" },
              h(Cover, { ctx, path: series.cover, className: "hg-detail-cover" }),
              h(
                "div",
                { className: "hg-detail-info" },
                h("h2", { className: "hg-detail-title" }, series.title || t("unit.untitled")),
                meta.length > 0 ? h("div", { className: "hg-meta" }, meta.join(" · ")) : null,
                tags.length > 0
                  ? h(
                      "div",
                      { className: "hg-tags" },
                      tags.map((tag, index) =>
                        h("span", { key: `${tag}-${index}`, className: "hg-tag" }, tag)
                      )
                    )
                  : null
              )
            ),
            h(
              "button",
              {
                type: "button",
                className: "hg-btn primary hg-continue",
                disabled: episodes.length === 0,
                onClick: () =>
                  selectEpisode(
                    resumeIndex,
                    historyEntry && resumeIndex === historyEntry.episodeIndex ? historyEntry.positionMs : 0
                  ),
              },
              h(
                "span",
                { className: "hg-continue-main" },
                historyEntry ? t("detail.continue") : t("detail.start")
              ),
              historyEntry
                ? h(
                    "span",
                    { className: "hg-continue-meta" },
                    t("detail.continueAt", {
                      number: resumeNumber,
                      time: formatDuration(historyEntry.positionMs),
                    })
                  )
                : null
            ),
            h(
              "section",
              { className: "hg-section" },
              h("div", { className: "hg-sec-head" }, h("span", null, t("detail.description"))),
              description
                ? h(
                    "div",
                    { className: `hg-desc${canExpand && !expanded ? " is-clamped" : ""}` },
                    description
                  )
                : h("div", { className: "hg-muted" }, t("detail.noDescription")),
              canExpand
                ? h(
                    "button",
                    {
                      type: "button",
                      className: "hg-linkbtn",
                      onClick: () => setExpanded((value) => !value),
                    },
                    expanded ? t("detail.collapse") : t("detail.expand")
                  )
                : null
            ),
            h(
              "section",
              { className: "hg-section" },
              h(
                "div",
                { className: "hg-sec-head" },
                h("span", null, t("detail.episodes")),
                episodes.length > 0
                  ? h("span", { className: "hg-count" }, t("unit.episodes", { count: episodes.length }))
                  : null
              ),
              state.episodesError
                ? h(
                    "div",
                    { className: "hg-inline-error" },
                    h("span", null, t("detail.episodesFailed")),
                    h("button", { type: "button", className: "hg-linkbtn", onClick: () => void retryEpisodes() }, t("action.retry"))
                  )
                : null,
              state.truncated
                ? h("div", { className: "hg-hint" }, t("detail.truncated", { count: episodes.length }))
                : null,
              episodes.length > 0
                ? h(
                    "div",
                    { className: "hg-episodes" },
                    episodes.map((episode, index) => {
                      const watched = historyIndex >= 0 && index <= historyIndex;
                      const current = index === selectedIndex;
                      const label = episode.title || t("unit.episodeShort", { number: episode.number });
                      const titleText = [
                        label,
                        watched ? t("detail.watched") : "",
                        episode.playable ? "" : t("detail.unplayable"),
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return h(
                        "button",
                        {
                          key: episode.id || `${index}`,
                          type: "button",
                          className: `hg-ep${watched ? " is-watched" : ""}${current ? " is-current" : ""}`,
                          disabled: !episode.playable,
                          "aria-current": current ? "true" : undefined,
                          title: titleText,
                          onClick: () =>
                            selectEpisode(index, index === selectedRef.current ? positionRef.current : 0),
                        },
                        h("span", { className: "hg-ep-num" }, String(episode.number)),
                        episode.title ? h("span", { className: "hg-ep-name" }, episode.title) : null,
                        current ? h("span", { className: "hg-sr-only" }, t("detail.current")) : null
                      );
                    })
                  )
                : !state.episodesError
                  ? h("div", { className: "hg-muted" }, t("detail.noEpisodes"))
                  : null
            )
          )
        : null
    )
  );
}

