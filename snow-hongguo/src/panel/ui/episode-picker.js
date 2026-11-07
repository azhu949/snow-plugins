import { getReact, h } from "./runtime.js";
import { formatDuration } from "./common.js";
import { getEpisodeProgress } from "../storage.js";

const GROUP_SIZE = 30;

const revealActiveGroup = (strip) => {
  const active = strip?.querySelector('[aria-pressed="true"]');
  if (!active || !strip.clientWidth) return;
  // 只横向移动区间栏，避免 scrollIntoView 把整个详情页和播放器一起滚走。
  const left = active.offsetLeft;
  const right = left + active.offsetWidth;
  if (left < strip.scrollLeft) strip.scrollLeft = left;
  else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
};

export function EpisodePicker({ ctx, episodes, selectedIndex, historyEntry, onSelectEpisode }) {
  const React = getReact();
  const t = ctx.t;
  const groupCount = Math.ceil(episodes.length / GROUP_SIZE);
  const currentGroup = Math.max(0, Math.min(Math.floor(selectedIndex / GROUP_SIZE), groupCount - 1));
  const [groupIndex, setGroupIndex] = React.useState(currentGroup);
  const stripRef = React.useRef(null);
  const activeGroup = Math.max(0, Math.min(groupIndex, groupCount - 1));
  const startIndex = activeGroup * GROUP_SIZE;

  // 浏览区间独立于播放选择；进度回写不会把用户正在浏览的分组拉回去。
  React.useLayoutEffect(() => {
    setGroupIndex(currentGroup);
  }, [selectedIndex, currentGroup]);

  React.useLayoutEffect(() => {
    revealActiveGroup(stripRef.current);
  }, [activeGroup, groupCount]);

  return h(
    "div",
    { className: "hg-episode-picker" },
    groupCount > 1
      ? h(
          "div",
          { className: "hg-episode-nav" },
          h(
            "div",
            { className: "hg-episode-groups", ref: stripRef, role: "group", "aria-label": t("detail.episodeGroups") },
            Array.from({ length: groupCount }, (_, index) => {
              const start = episodes[index * GROUP_SIZE].number;
              const end = episodes[Math.min((index + 1) * GROUP_SIZE, episodes.length) - 1].number;
              return h(
                "button",
                {
                  key: index,
                  type: "button",
                  className: "hg-episode-group",
                  "aria-pressed": index === activeGroup,
                  "aria-label": start === end ? t("unit.episodeShort", { number: start }) : t("detail.episodeRange", { start, end }),
                  onClick: () => setGroupIndex(index),
                },
                start === end ? String(start) : `${start}–${end}`
              );
            })
          ),
          h(
            "button",
            {
              type: "button",
              className: "hg-linkbtn hg-episode-locate",
              onClick: () => {
                setGroupIndex(currentGroup);
                if (activeGroup === currentGroup) revealActiveGroup(stripRef.current);
              },
            },
            t("detail.backToCurrent")
          )
        )
      : null,
    h(
      "div",
      { className: "hg-episodes" },
      episodes.slice(startIndex, startIndex + GROUP_SIZE).map((episode, offset) => {
        const index = startIndex + offset;
        const record = getEpisodeProgress(historyEntry, episode, index);
        const watched = record?.completed === true;
        const partial = !watched && record?.positionMs > 0;
        const current = index === selectedIndex;
        const label = episode.title || t("unit.episodeShort", { number: episode.number });
        const titleText = [
          label,
          watched ? t("detail.watched") : "",
          partial ? t("detail.partialAt", { time: formatDuration(record.positionMs) }) : "",
          episode.playable ? "" : t("detail.unplayable"),
        ].filter(Boolean).join(" · ");
        return h(
          "button",
          {
            key: episode.id || `${index}`,
            type: "button",
            className: `hg-ep${watched ? " is-watched" : ""}${partial ? " is-partial" : ""}${current ? " is-current" : ""}`,
            disabled: !episode.playable,
            "aria-current": current ? "true" : undefined,
            title: titleText,
            onClick: () => onSelectEpisode(index),
          },
          h("span", { className: "hg-ep-num" }, String(episode.number)),
          episode.title ? h("span", { className: "hg-ep-name" }, episode.title) : null,
          watched || partial ? h("span", { className: "hg-ep-status" }, watched ? "✓" : formatDuration(record.positionMs)) : null,
          current ? h("span", { className: "hg-sr-only" }, t("detail.current")) : null
        );
      })
    )
  );
}
