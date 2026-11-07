// 播放器挂载契约（详情页与对外构建产物的唯一接入点）。
//
// 组件契约：
//   <PlayerMount
//     ctx            // 面板上下文：{ api, rpc, t, locale, prefs, notify, log, updatePrefs }
//     series         // /series 详情对象：{ id, title, cover, count, ... }
//     episodes       // 归一化分集：[{ id, number, playable, title }]
//     episodeIndex   // 当前集在 episodes 里的下标（0 基）
//     positionMs     // 续播位置（毫秒）
//     onProgress     // ({ episodeIndex, positionMs, durationMs }) => void，建议 5 秒节流
//     onEnded        // ({ episodeIndex, durationMs }) => void
//     onSelectEpisode// (index) => void
//     onError        // (error) => void
//   />
//
// 命令式契约：
//   const handle = renderPlayer(slotElement, playerProps);
//   handle.update(nextProps);   // 集数 / 清晰度 / 进度变化时调用
//   handle.destroy();           // 卸载时调用，清掉定时器、媒体元素与 object URL
//
// 实现拆分：
//   ./player/engine.js      取流 + MediaSource + 串行 append + 状态机
//   ./player/controller.js  DOM / 控件 / 快捷键 / 覆盖层
//   ./player/icons.js       内联 SVG 图标
//   ./player/util.js        base64 / 时间 / 剪贴板等纯函数
import { getReact, h } from "./ui/runtime.js";
import { createPlayer } from "./player/controller.js";

export const PLAYER_SLOT_ID = "hg-player-slot";

/**
 * 在挂载点里创建真实播放器。初始化异常时退化为一段可读的错误文本，不白屏。
 * @returns {{ update: (next: object) => void, destroy: () => void }}
 */
export function renderPlayer(slot, initialProps) {
  if (!slot || typeof document === "undefined") {
    return { update: () => {}, destroy: () => {} };
  }
  try {
    return createPlayer(slot, initialProps);
  } catch (error) {
    const box = document.createElement("div");
    box.className = "hg-player-fatal";
    box.textContent = String(error?.message || error);
    slot.replaceChildren(box);
    return {
      update: () => {},
      destroy: () => {
        slot.replaceChildren();
      },
    };
  }
}

/** 详情页使用的挂载组件：把最新 props 转交给 renderPlayer。 */
export function PlayerMount(props) {
  const React = getReact();
  const slotRef = React.useRef(null);
  const handleRef = React.useRef(null);
  const handlersRef = React.useRef({});
  handlersRef.current = {
    onProgress: props.onProgress,
    onEnded: props.onEnded,
    onSelectEpisode: props.onSelectEpisode,
    onError: props.onError,
    onMiniChange: props.onMiniChange,
  };

  const buildProps = () => ({
    api: props.ctx.api,
    rpc: props.ctx.rpc,
    t: props.ctx.t,
    locale: props.ctx.locale,
    notify: props.ctx.notify,
    log: props.ctx.log,
    quality: props.ctx.prefs?.quality || "720p",
    playbackRate: props.ctx.prefs?.playbackRate,
    volume: props.ctx.prefs?.volume,
    muted: props.ctx.prefs?.muted,
    miniWindow: props.ctx.prefs?.miniWindow,
    series: props.series,
    episodes: props.episodes,
    episodeIndex: props.episodeIndex,
    episode: props.episodes?.[props.episodeIndex] || null,
    positionMs: props.positionMs,
    seekRequest: props.seekRequest,
    onQualityChange: (quality) => props.ctx.updatePrefs?.({ quality }),
    onMiniWindowChange: (miniWindow) => props.ctx.updatePrefs?.({ miniWindow }),
    onPlaybackPrefsChange: (patch) => props.ctx.updatePrefs?.(patch),
    onProgress: (state) => handlersRef.current.onProgress?.(state),
    onEnded: (state) => handlersRef.current.onEnded?.(state),
    onSelectEpisode: (index) => handlersRef.current.onSelectEpisode?.(index),
    onError: (error) => handlersRef.current.onError?.(error),
    onMiniChange: (active) => handlersRef.current.onMiniChange?.(active),
  });

  React.useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return undefined;
    handleRef.current = renderPlayer(slot, buildProps());
    return () => {
      const handle = handleRef.current;
      handleRef.current = null;
      // 先让播放器清理定时器 / 媒体元素 / object URL，再兜底清空挂载点。
      try {
        if (typeof handle === "function") handle();
        else handle?.destroy?.();
      } finally {
        slot.replaceChildren();
      }
    };
    // 只在挂载/换剧时重建；后续变化走 update。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.series?.id]);

  React.useEffect(() => {
    handleRef.current?.update?.(buildProps());
  });

  return h(
    "div",
    { className: "hg-player-stage" },
    h("div", {
      id: PLAYER_SLOT_ID,
      ref: slotRef,
      className: "hg-player-slot",
      "data-series-id": props.series?.id || "",
      "data-episode-id": props.episodes?.[props.episodeIndex]?.id || "",
    })
  );
}
