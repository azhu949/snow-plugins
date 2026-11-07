// 播放器控件层：自绘控件 + 本机解码 / MSE 引擎编排。不依赖任何第三方播放器库。
//
// 职责划分：
// - webcodecs-play.js 负责本机解码出画面（宿主 CSP 没有 media-src，<video> 加载不了任何媒体）；
// - engine.js 负责取流 / 建 MediaSource / 串行 append / 状态机，只在本机解码不可用时兜底；
// - 本文件负责 DOM、交互、快捷键、覆盖层、进度上报（detail 页负责落盘 history）。
import { describeError } from "../ui/common.js";
import { DEFAULT_QUALITY, QUALITY_OPTIONS, normalizeMiniWindow } from "../storage.js";
import { normalizePlaybackPrefs } from "../playback-prefs.js";
import { MSE_STATE, createMseEngine } from "./engine.js";
import { icon } from "./icons.js";
import { PLAYBACK_RATES, createWebCodecsPlayer } from "./webcodecs-play.js";
import { clamp, copyText, decodeBase64, formatClock, safeFileName } from "./util.js";

const HIDE_DELAY_MS = 2600;
const SEEK_STEP_SECONDS = 5;
const VOLUME_STEP = 0.05;
const RESUME_JUMP_TOLERANCE_MS = 2000;

// 清晰度高低：QUALITY_OPTIONS 由高到低排列，数值越大档位越高。
const qualityRank = (quality) => {
  const index = QUALITY_OPTIONS.indexOf(String(quality || ""));
  return index < 0 ? -1 : QUALITY_OPTIONS.length - index;
};

const make = (tag, className) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};

/**
 * 在挂载点里创建播放器。
 * @returns {{ update: (next: object) => void, destroy: () => void }}
 */
export function createPlayer(slot, initialProps) {
  const props = { ...(initialProps || {}) };
  const t = (key, values) => (typeof props.t === "function" ? props.t(key, values) : key);
  const notify = (kind, text) => {
    try {
      props.notify?.(kind, text);
    } catch {
      // 通知失败不影响播放。
    }
  };
  const log = (...args) => {
    try {
      props.log?.(...args);
    } catch {
      // 日志失败不影响播放。
    }
  };

  let disposed = false;
  let state = { state: MSE_STATE.IDLE, quality: "", info: null, appended: 0, segmentCount: 0 };

  let playing = false;
  let waiting = false;
  // autoPlayPending：本次载入是否要自动播放；userPaused：用户主动暂停后不再自动恢复。
  let autoPlayPending = false;
  let userPaused = false;
  // 目标档位取已保存的清晰度偏好；旧数据里的非法值退回默认档，避免下拉出现空值。
  let desiredQuality = QUALITY_OPTIONS.includes(props.quality) ? props.quality : DEFAULT_QUALITY;
  const savedPlayback = normalizePlaybackPrefs(props);
  // 从持久化偏好初始化，切集、切清晰度与引擎回退都沿用最新选择。
  let desiredPlaybackRate = savedPlayback.playbackRate;
  let overlayKind = "";
  let dragging = false;
  let fill = false;
  let fillMarker = null;
  let mini = false;
  let miniMarker = null;
  let miniWindow = normalizeMiniWindow(props.miniWindow);
  let miniInteraction = null;
  let miniSaveTimer = 0;
  let miniHideTimer = 0;
  let miniHidden = false;
  let miniResumePlayback = false;
  let idleTimer = 0;
  let lastReportAt = 0;
  let lastReportedMs = Math.max(0, Number(props.positionMs) || 0);
  // 最近上报过的位置：详情页 5 秒节流会把旧值写回 props，不能把它当成「跳转请求」。
  const recentReports = [];
  const rememberReport = (ms) => {
    const now = Date.now();
    recentReports.push({ ms, at: now });
    while (recentReports.length && now - recentReports[0].at > 15000) recentReports.shift();
    if (recentReports.length > 60) recentReports.shift();
  };
  const wasReportedRecently = (ms) =>
    recentReports.some((item) => Math.abs(item.ms - ms) <= 1500 && Date.now() - item.at <= 15000);
  let lastNoticeKey = "";
  let lastSeekAt = 0;
  let downloading = false;
  // 切集时旧会话的 pause 事件不要用新集号写历史。
  let suppressPauseReport = false;
  let pendingOverlayActions = null;
  let downloadActionNode = null;
  // 拉流看门狗：长时间停在 buffering 且没有任何新增分段时，给出可重试的错误界面。
  let lastActivityAt = Date.now();
  let stallReported = false;

  // ------------------------------------------------------------------ DOM

  const root = make("div", "hg-player");
  root.tabIndex = 0;
  root.setAttribute("role", "region");

  const miniBar = make("div", "hg-mini-bar");
  const miniTitle = make("span", "hg-mini-title");
  const miniAutoHide = make("label", "hg-mini-autohide");
  const miniAutoHideInput = document.createElement("input");
  miniAutoHideInput.type = "checkbox";
  miniAutoHideInput.className = "hg-toggle";
  miniAutoHideInput.setAttribute("role", "switch");
  miniAutoHideInput.checked = miniWindow.autoHide;
  miniAutoHideInput.addEventListener("change", () => {
    adoptMiniWindow({ ...miniWindow, autoHide: miniAutoHideInput.checked });
    props.onMiniWindowChange?.({ ...miniWindow });
  });
  const miniAutoHideText = make("span", "hg-mini-autohide-text");
  miniAutoHide.append(miniAutoHideInput, miniAutoHideText);
  const miniOpacityInput = document.createElement("input");
  miniOpacityInput.type = "range";
  miniOpacityInput.className = "hg-mini-opacity";
  miniOpacityInput.min = "0.05";
  miniOpacityInput.max = "1";
  miniOpacityInput.step = "0.01";
  miniOpacityInput.value = String(miniWindow.opacity);
  miniOpacityInput.addEventListener("input", () => setMiniOpacity(Number(miniOpacityInput.value)));
  const miniOpacityValue = make("span", "hg-mini-opacity-value");
  miniBar.append(miniTitle, miniAutoHide, miniOpacityInput, miniOpacityValue);

  const miniResize = make("div", "hg-mini-resize");
  miniResize.setAttribute("aria-hidden", "true");

  const miniRestore = make("button", "hg-mini-restore");
  miniRestore.type = "button";
  miniRestore.hidden = true;
  miniRestore.append(icon("mini", 16));

  const view = make("div", "hg-player-view");

  const video = document.createElement("video");
  video.className = "hg-player-video";
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.preload = "auto";
  video.volume = savedPlayback.volume;
  video.muted = savedPlayback.muted;
  video.defaultPlaybackRate = desiredPlaybackRate;
  video.playbackRate = desiredPlaybackRate;

  // WebCodecs 播放层：宿主 CSP 没有 media-src，<video> 连 blob: 都加载不了，
  // 唯一能出画面的通道是自己解码后画到 canvas，所以默认就走这条。
  let wvc = null;
  // 引擎播完只会停在 ended 相位，用一个标记避免重复触发连播。
  let endedReported = false;
  // 本机解码能力：两个解码器都在才算可用；缺一个就只能走兼容路径。
  const canDecodeLocally = () =>
    typeof VideoDecoder !== "undefined" && typeof AudioDecoder !== "undefined";
  // 本次会话里本机解码失败过就不再自动重试，避免每切一集都撞一次失败；
  // 用户在覆盖层点「直接播放」时清掉它，重新给一次机会。
  let wvcBlocked = false;
  // 本机解码的载入序号：连续切集时用它作废上一轮还没跑完的载入，避免两个解码器同时出声。
  let wvcSeq = 0;
  // 本机解码的当前清晰度（面板会话内保持）：进入面板 / 换剧时沿用设置里保存的清晰度偏好，
  // 手动切档后记服务器返回的真实档位，切集与连播沿用，不会被 loadEpisode 重置回偏好值。
  let wvcQuality = QUALITY_OPTIONS.includes(props.quality) ? props.quality : DEFAULT_QUALITY;
  const canvas = document.createElement("canvas");
  canvas.className = "hg-player-video";
  canvas.hidden = true;
  canvas.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!wvc) return;
    // 用户手势是恢复被自动播放策略挂起的 AudioContext 的唯一时机。
    wvc.resumeAudio?.();
    if (wvc.getState().phase === "playing") {
      userPaused = true;
      autoPlayPending = false;
      wvc.pause();
      playing = false;
      report(true);
    } else safePlay();
  });

  const loading = make("div", "hg-player-loading");
  loading.hidden = true;
  const loadingSpinner = make("span", "hg-player-spinner");
  const loadingText = make("span", "hg-player-loading-text");
  loading.append(loadingSpinner, loadingText);

  const bigPlay = make("button", "hg-player-bigplay");
  bigPlay.type = "button";
  bigPlay.hidden = true;
  bigPlay.append(icon("play", 22));

  const overlay = make("div", "hg-player-overlay");
  overlay.hidden = true;
  const card = make("div", "hg-player-card");
  const cardTitle = make("div", "hg-player-card-title");
  const cardText = make("div", "hg-player-card-text");
  const cardHint = make("div", "hg-player-card-hint");
  const cardActions = make("div", "hg-player-card-actions");
  card.append(cardTitle, cardText, cardHint, cardActions);
  overlay.append(card);
  // 覆盖层内的空白点击不要冒泡到画面（否则会误触发播放/暂停）。
  overlay.addEventListener("click", (event) => event.stopPropagation());

  // 失败提示层：平时隐藏，只在本机解码失败并回退时写两三行中文。
  // 样式沿用既有的 .hg-player-debug（含 [hidden] 隐藏规则），不新增样式。
  const noticePane = make("div", "hg-player-debug");
  noticePane.hidden = true;
  const showNotice = (lines) => {
    const text = (Array.isArray(lines) ? lines : [lines]).filter(Boolean).slice(0, 3).join("\n");
    noticePane.textContent = text;
    noticePane.hidden = !text;
  };
  const hideNotice = () => {
    noticePane.hidden = true;
    noticePane.textContent = "";
  };

  view.append(video, canvas, loading, bigPlay, overlay, noticePane);

  const controls = make("div", "hg-player-controls");

  const progress = make("div", "hg-player-progress");
  progress.setAttribute("role", "slider");
  progress.setAttribute("tabindex", "-1");
  const track = make("div", "hg-player-track");
  const buffered = make("div", "hg-player-buffered");
  const hoverFill = make("div", "hg-player-hover");
  const played = make("div", "hg-player-played");
  track.append(buffered, hoverFill, played);
  const thumb = make("div", "hg-player-thumb");
  const tip = make("div", "hg-player-tip");
  tip.hidden = true;
  progress.append(track, thumb, tip);

  const bar = make("div", "hg-player-bar");

  const button = (name, onClick, className) => {
    const node = make("button", className || "hg-player-btn");
    node.type = "button";
    node.append(icon(name, 16));
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
      showControls();
    });
    return node;
  };

  const playBtn = button("play", () => togglePlay());
  const nextBtn = button("next", () => nextEpisode());

  const timeLabel = make("span", "hg-player-time");
  const spacer = make("span", "hg-player-spacer");

  const muteBtn = button("volume", () => toggleMute());

  const volume = document.createElement("input");
  volume.type = "range";
  volume.className = "hg-player-volume";
  volume.min = "0";
  volume.max = "1";
  volume.step = "0.01";
  volume.value = "1";
  volume.addEventListener("input", () => setVolume(Number(volume.value)));
  volume.addEventListener("change", () => showControls());

  const qualitySelect = document.createElement("select");
  qualitySelect.className = "hg-player-select hg-player-quality";
  for (const quality of QUALITY_OPTIONS) {
    const option = document.createElement("option");
    option.value = quality;
    option.textContent = quality;
    qualitySelect.append(option);
  }
  qualitySelect.addEventListener("change", () => setQuality(qualitySelect.value, true));
  qualitySelect.addEventListener("click", (event) => event.stopPropagation());

  const speedSelect = document.createElement("select");
  speedSelect.className = "hg-player-select hg-player-speed";
  for (const speed of PLAYBACK_RATES) {
    const option = document.createElement("option");
    option.value = String(speed);
    option.textContent = `${speed}x`;
    speedSelect.append(option);
  }
  speedSelect.value = String(desiredPlaybackRate);
  speedSelect.addEventListener("change", () => setSpeed(speedSelect.value, true));
  speedSelect.addEventListener("click", (event) => event.stopPropagation());

  const pipBtn = button("pip", () => void togglePip());
  pipBtn.classList.add("hg-player-pip");
  const miniBtn = button("mini", () => toggleMini());
  miniBtn.classList.add("hg-player-mini-toggle");
  const fillBtn = button("expand", () => toggleFill());
  const miniExitBtn = button("restore", () => exitMini(), "hg-player-btn hg-mini-exit");
  miniBar.append(miniExitBtn);

  bar.append(playBtn, nextBtn, timeLabel, spacer, muteBtn, volume, qualitySelect, speedSelect, pipBtn, miniBtn, fillBtn);
  controls.append(progress, bar);
  root.append(miniBar, view, controls, miniResize);

  if (slot) slot.replaceChildren(root);

  // ------------------------------------------------------------------ 引擎

  const engine = createMseEngine({
    video,
    getRpc: () => props.rpc,
    log,
    onState: (snapshot) => handleEngineState(snapshot),
    onError: (error) => {
      try {
        props.onError?.(error);
      } catch {
        // 回调异常不影响播放器。
      }
    },
  });

  // ------------------------------------------------------------------ 工具

  // WebCodecs 直连播放时，时间轴全部由引擎提供；<video> 只是 MSE 路径的渲染器。
  const durationOf = () => {
    if (wvc) {
      const ms = Number(wvc.getState().durationMs) || 0;
      if (ms > 0) return ms / 1000;
    }
    const fromVideo = Number(video.duration);
    if (Number.isFinite(fromVideo) && fromVideo > 0) return fromVideo;
    const fromInfo = (state.info?.durationMs || 0) / 1000;
    return Number.isFinite(fromInfo) && fromInfo > 0 ? fromInfo : 0;
  };

  const currentMs = () => {
    if (wvc) return Math.round(Number(wvc.getState().timeMs) || 0);
    const value = Number(video.currentTime);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : 0;
  };

  // 当前生效的清晰度：本机解码看实际拉到的档位，兼容路径看引擎快照。
  const currentQuality = () => (wvc ? wvcQuality : state.quality || props.quality || DEFAULT_QUALITY);

  // 隐藏的媒体元素不代表本机解码速度，显示与快捷键都从当前引擎读取。
  const currentPlaybackRate = () => Number(wvc ? wvc.getState().playbackRate : video.playbackRate) || 1;

  const hasNext = () => {
    const list = Array.isArray(props.episodes) ? props.episodes : [];
    const next = list[props.episodeIndex + 1];
    return !!next && next.playable !== false;
  };

  const setButtonIcon = (node, name) => {
    node.replaceChildren(icon(name, 16));
  };

  const applyLabels = () => {
    root.setAttribute("aria-label", t("player.region"));
    playBtn.title = t("player.playPause");
    playBtn.setAttribute("aria-label", playing ? t("player.pause") : t("player.play"));
    nextBtn.title = hasNext() ? t("player.next") : t("player.lastEpisode");
    nextBtn.setAttribute("aria-label", t("player.next"));
    muteBtn.title = video.muted ? t("player.unmute") : t("player.mute");
    muteBtn.setAttribute("aria-label", muteBtn.title);
    volume.setAttribute("aria-label", t("player.volume"));
    qualitySelect.title = t("player.quality");
    qualitySelect.setAttribute("aria-label", t("player.quality"));
    // 倍速文案与实际档位由 syncSpeed 按当前播放通道统一处理。
    syncSpeed();
    pipBtn.title = t("player.pip");
    pipBtn.setAttribute("aria-label", t("player.pip"));
    fillBtn.title = fill ? t("player.exitFill") : t("player.fill");
    fillBtn.setAttribute("aria-label", fillBtn.title);
    syncMiniButton();
    syncMiniAppearance();
    progress.setAttribute("aria-label", t("player.seek"));
    bigPlay.title = t("player.play");
    bigPlay.setAttribute("aria-label", t("player.play"));
  };

  const setOverlay = (kind, { title, text, hint, actions }) => {
    // 覆盖层出现时收起失败提示，避免两层文字叠在一起。
    hideNotice();
    overlayKind = kind;
    overlay.hidden = false;
    cardTitle.textContent = title || "";
    cardText.textContent = text || "";
    cardHint.textContent = hint || "";
    cardHint.hidden = !hint;
    pendingOverlayActions = Array.isArray(actions) ? actions : [];
    renderOverlayActions();
    updateLoading();
    updateBigPlay();
    showControls();
  };

  const renderOverlayActions = () => {
    const actions = pendingOverlayActions || [];
    downloadActionNode = null;
    const nodes = actions.map((action) => {
      const node = make("button", `hg-player-action${action.primary ? " is-primary" : ""}`);
      node.type = "button";
      node.textContent = action.label;
      if (action.disabled) node.disabled = true;
      if (action.kind === "download") downloadActionNode = node;
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        try {
          action.onClick?.();
        } catch (error) {
          log("[player] 覆盖层动作失败", String(error?.message || error));
        }
      });
      return node;
    });
    cardActions.replaceChildren(...nodes);
    cardActions.hidden = nodes.length === 0;
  };

  const hideOverlay = () => {
    if (!overlayKind) return;
    overlayKind = "";
    overlay.hidden = true;
    pendingOverlayActions = null;
    updateLoading();
    updateBigPlay();
    showControls();
  };

  const describePlaybackError = (error) => {
    const code = String(error?.code || "");
    if (code === "PLAYBACK_STALL") {
      return { message: t("player.stalled"), hint: t("player.errorHint") };
    }
    if (code.startsWith("MEDIA_") || code === "PLAYER_ERROR" || code === "ABORTED") {
      return { message: t("player.segmentFailed"), hint: t("player.errorHint") };
    }
    const info = describeError(t, error);
    return { message: info.message, hint: info.hint || t("player.errorHint") };
  };

  // ------------------------------------------------------------------ 播放控制

  const report = (force) => {
    if (disposed) return;
    // 拉流中的占位时间、兼容路径未加载的 video 不能覆盖真实续播位置。
    if (wvc) {
      if (["idle", "loading", "error"].includes(wvc.getState().phase)) return;
    } else if (video.readyState < 1) return;
    const now = Date.now();
    if (!force && now - lastReportAt < 1000) return;
    lastReportAt = now;
    const positionMs = currentMs();
    lastReportedMs = positionMs;
    rememberReport(positionMs);
    try {
      props.onProgress?.({
        episodeIndex: props.episodeIndex,
        episodeId: props.episode?.id,
        positionMs,
        durationMs: Math.round(durationOf() * 1000),
        flush: force === true,
      });
    } catch (error) {
      log("[player] onProgress 回调异常", String(error?.message || error));
    }
  };

  const safePlay = () => {
    if (disposed) return;
    if (overlayKind === "degraded" || overlayKind === "error" || overlayKind === "notice") return;
    userPaused = false;
    if (wvc) {
      wvc.play();
      playing = wvc.getState().phase === "playing";
      syncPlayButton();
      updateBigPlay();
      return;
    }
    let promise = null;
    try {
      promise = video.play();
    } catch (error) {
      log("[player] play 调用失败", String(error?.message || error));
    }
    if (promise && typeof promise.catch === "function") {
      promise.catch((error) => {
        updateBigPlay();
        if (error?.name === "NotAllowedError") notify("info", t("player.autoplayBlocked"));
        else log("[player] play 被拒绝", String(error?.message || error));
      });
    }
  };

  const togglePlay = () => {
    if (overlayKind === "degraded" || overlayKind === "error" || overlayKind === "notice") return;
    if (wvc) {
      if (wvc.getState().phase === "playing") {
        userPaused = true;
        autoPlayPending = false;
        wvc.pause();
        playing = false;
        report(true);
      } else {
        safePlay();
        return;
      }
      syncPlayButton();
      updateBigPlay();
      return;
    }
    if (video.paused || video.ended) {
      safePlay();
    } else {
      userPaused = true;
      autoPlayPending = false;
      video.pause();
    }
  };

  const replay = () => {
    hideOverlay();
    userPaused = false;
    if (wvc) {
      wvc.seek(0);
      wvc.play();
      playing = true;
      syncPlayButton();
      updateBigPlay();
      return;
    }
    try {
      video.currentTime = 0;
    } catch {
      // 忽略。
    }
    safePlay();
  };

  function nextEpisode() {
    if (!hasNext()) {
      notify("info", t("player.lastEpisode"));
      return;
    }
    try {
      props.onSelectEpisode?.(props.episodeIndex + 1);
    } catch (error) {
      log("[player] 切集回调异常", String(error?.message || error));
    }
  }

  const seekTo = (seconds, options = {}) => {
    const duration = durationOf();
    if (!(duration > 0)) return;
    const target = clamp(seconds, 0, Math.max(0, duration - 0.05));
    if (wvc) {
      wvc.seek(Math.round(target * 1000));
      syncTime();
      syncProgressBar();
      if (!options.silent) report(true);
      return;
    }
    try {
      video.currentTime = target;
    } catch {
      return;
    }
    syncTime();
    syncProgressBar();
    if (!options.silent) report(true);
  };

  const seekBy = (delta) => seekTo(currentMs() / 1000 + delta);

  const setVolume = (value) => {
    const next = clamp(value, 0, 1);
    video.volume = next;
    video.muted = next <= 0.001;
    if (wvc) wvc.setVolume(next);
    syncVolume();
    props.onPlaybackPrefsChange?.({ volume: video.volume, muted: video.muted });
  };

  const toggleMute = () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume <= 0.001) video.volume = 0.5;
    if (wvc) wvc.setVolume(video.muted ? 0 : video.volume);
    syncVolume();
    props.onPlaybackPrefsChange?.({ volume: video.volume, muted: video.muted });
  };

  const applyVideoPlaybackRate = () => {
    // 兼容播放也显式保留原音调，不能让两条播放路径的听感相反。
    video.preservesPitch = true;
    // load() 会把当前速度恢复成默认速度；两者同步才能跨兼容路径重载保持倍速。
    if (video.defaultPlaybackRate !== desiredPlaybackRate) video.defaultPlaybackRate = desiredPlaybackRate;
    if (video.playbackRate !== desiredPlaybackRate) video.playbackRate = desiredPlaybackRate;
  };

  const setSpeed = (value, persist = false) => {
    if (disposed) return;
    const next = Number(value);
    if (!PLAYBACK_RATES.includes(next)) {
      syncSpeed();
      return;
    }
    desiredPlaybackRate = next;
    if (wvc) desiredPlaybackRate = wvc.setPlaybackRate(next);
    // 本机解码期间也同步兼容路径，回退时无需读取隐藏 video 的旧速度。
    applyVideoPlaybackRate();
    syncSpeed();
    showControls();
    if (persist) props.onPlaybackPrefsChange?.({ playbackRate: desiredPlaybackRate });
  };

  const cycleSpeed = (direction) => {
    const current = currentPlaybackRate();
    let index = 0;
    let best = Number.POSITIVE_INFINITY;
    PLAYBACK_RATES.forEach((speed, position) => {
      const distance = Math.abs(speed - current);
      if (distance < best) {
        best = distance;
        index = position;
      }
    });
    const next = PLAYBACK_RATES[clamp(index + direction, 0, PLAYBACK_RATES.length - 1)];
    setSpeed(next, true);
  };

  const setQuality = (quality, persist) => {
    const next = String(quality || "");
    if (!next) return;
    // 先记下目标档位再分支：详情页把 props.quality 回写过来时不会再触发一次切换。
    desiredQuality = next;
    if (persist) props.onQualityChange?.(next);
    if (canDecodeLocally() && !wvcBlocked) {
      // 本机解码只能整集重新拉流：记住当前播放位置（currentMs 是毫秒），按新档位重载后续播。
      // wvcSeq 会作废旧实例，载入中切档也不会出现两个解码器同时出声。
      const positionMs = Math.max(0, Math.round(currentMs()));
      wvcQuality = next;
      syncQualitySelect();
      userPaused = false;
      autoPlayPending = true;
      lastNoticeKey = "";
      // 高码率纯软解更容易掉帧，切档时先给一句可回退的提示。
      if (qualityRank(next) >= qualityRank("540p")) notify("info", t("player.qualityHeavy"));
      void playWebCodecs({ quality: next, resumeMs: positionMs });
      return;
    }
    if (next === state.quality) {
      if (state.state === MSE_STATE.DEGRADED || state.state === MSE_STATE.ERROR) retryPlayback();
      else syncQualitySelect();
      return;
    }
    userPaused = false;
    autoPlayPending = true;
    lastNoticeKey = "";
    void engine.switchQuality(next);
  };

  const retryPlayback = () => {
    userPaused = false;
    autoPlayPending = true;
    lastNoticeKey = "";
    void engine.retry();
  };

  const togglePip = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (typeof video.requestPictureInPicture === "function") {
        await video.requestPictureInPicture();
      }
    } catch (error) {
      notify("error", t("player.pipFailed"));
      log("[player] 画中画失败", String(error?.message || error));
    }
  };

  // ------------------------------------------------------------------ 悬浮小窗与铺满侧栏

  const miniStage = () => slot?.closest?.(".hg-player-stage") || null;

  const saveMiniWindowSoon = () => {
    if (miniSaveTimer) clearTimeout(miniSaveTimer);
    miniSaveTimer = setTimeout(() => {
      miniSaveTimer = 0;
      if (disposed) return;
      try {
        props.onMiniWindowChange?.({ ...miniWindow });
      } catch (error) {
        log("[player] 小窗偏好保存失败", String(error?.message || error));
      }
    }, 180);
  };

  const applyMiniGeometry = () => {
    if (!mini) return;
    const viewportWidth = window.innerWidth || 1200;
    const viewportHeight = window.innerHeight || 800;
    const width = clamp(miniWindow.width, 240, Math.max(240, viewportWidth - 16));
    const height = clamp(miniWindow.height, 360, Math.max(360, viewportHeight - 16));
    const fallbackX = Math.max(8, viewportWidth - width - 24);
    const fallbackY = 52;
    const x = clamp(Number.isFinite(miniWindow.x) ? miniWindow.x : fallbackX, 8, Math.max(8, viewportWidth - width - 8));
    const y = clamp(Number.isFinite(miniWindow.y) ? miniWindow.y : fallbackY, 8, Math.max(8, viewportHeight - height - 8));
    miniWindow = { ...miniWindow, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    root.style.left = `${Math.round(x)}px`;
    root.style.top = `${Math.round(y)}px`;
    root.style.width = `${Math.round(width)}px`;
    root.style.height = `${Math.round(height)}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
    miniRestore.style.left = `${Math.round(x)}px`;
    miniRestore.style.top = `${Math.round(y)}px`;
  };

  const syncMiniButton = () => {
    setButtonIcon(miniBtn, mini ? "restore" : "mini");
    miniBtn.classList.toggle("is-active", mini);
    miniBtn.title = mini ? t("player.exitMini") : t("player.mini");
    miniBtn.setAttribute("aria-label", miniBtn.title);
  };

  const syncMiniAppearance = () => {
    root.style.setProperty("--hg-mini-opacity", String(miniWindow.opacity));
    miniAutoHideInput.checked = miniWindow.autoHide;
    miniAutoHide.title = t("settings.miniAutoHide");
    miniAutoHideInput.setAttribute("aria-label", t("settings.miniAutoHide"));
    miniAutoHideText.textContent = t("player.autoHide");
    miniOpacityInput.value = String(miniWindow.opacity);
    miniOpacityValue.textContent = `${Math.round(miniWindow.opacity * 100)}%`;
    miniOpacityInput.title = `${t("player.opacity")} · ${t("player.opacityWheelTip")}`;
    miniOpacityInput.setAttribute("aria-label", t("player.opacity"));
    miniExitBtn.title = t("player.exitMini");
    miniExitBtn.setAttribute("aria-label", miniExitBtn.title);
    miniRestore.title = t("player.showMini");
    miniRestore.setAttribute("aria-label", miniRestore.title);
    const title = props.series?.title || t("player.mini");
    const number = props.episode?.number;
    miniTitle.textContent = number == null ? title : `${title} · ${t("unit.episodeShort", { number })}`;
    miniTitle.title = miniTitle.textContent;
    const stage = miniStage();
    if (mini && stage) stage.setAttribute("data-mini-label", t("player.miniActive"));
    applyMiniGeometry();
  };

  const setMiniOpacity = (value) => {
    const next = normalizeMiniWindow({ ...miniWindow, opacity: value });
    const changed = next.opacity !== miniWindow.opacity;
    miniWindow = next;
    syncMiniAppearance();
    if (changed) saveMiniWindowSoon();
  };

  const cancelMiniHide = () => {
    if (!miniHideTimer) return;
    clearTimeout(miniHideTimer);
    miniHideTimer = 0;
  };

  const showMiniWindow = () => {
    const shouldResume = miniResumePlayback && !userPaused && !disposed;
    const shouldRestoreFocus = miniHidden && document.activeElement === miniRestore;
    miniResumePlayback = false;
    cancelMiniHide();
    miniHidden = false;
    root.inert = false;
    root.classList.remove("is-mini-hidden");
    miniRestore.hidden = true;
    if (shouldRestoreFocus) {
      try {
        root.focus({ preventScroll: true });
      } catch {
        // 忽略。
      }
    }
    if (shouldResume) safePlay();
  };

  const hideMiniWindow = () => {
    if (!mini || miniHidden || !miniWindow.autoHide) return;
    cancelMiniHide();
    const shouldMoveFocus = root.contains(document.activeElement);
    miniHidden = true;
    const phase = wvc?.getState().phase || "";
    const activePlayback = wvc ? phase === "playing" : !video.paused && !video.ended;
    const pendingPlayback = autoPlayPending && (!wvc || phase === "idle" || phase === "loading" || phase === "ready");
    miniResumePlayback = Boolean(!userPaused && (activePlayback || pendingPlayback));
    // 保持播放器节点与 Canvas 尺寸不变，只暂停并透明；恢复时继续上一次的播放位置。
    root.classList.add("is-mini-hidden");
    root.inert = true;
    if (miniResumePlayback && wvc) {
      wvc.pause();
      playing = false;
      syncPlayButton();
      updateBigPlay();
      report(true);
    } else if (miniResumePlayback && !video.paused) {
      video.pause();
    }
    if (miniRestore.parentNode !== document.body) document.body.appendChild(miniRestore);
    applyMiniGeometry();
    miniRestore.hidden = false;
    if (shouldMoveFocus) {
      try {
        miniRestore.focus({ preventScroll: true });
      } catch {
        // 忽略。
      }
    }
  };

  const scheduleMiniHide = () => {
    cancelMiniHide();
    if (!mini || miniHidden || !miniWindow.autoHide) return;
    miniHideTimer = setTimeout(() => {
      miniHideTimer = 0;
      if (!mini || miniInteraction || dragging) return;
      hideMiniWindow();
    }, 0);
  };

  const adoptMiniWindow = (value) => {
    const next = normalizeMiniWindow(value);
    if (JSON.stringify(next) === JSON.stringify(miniWindow)) return;
    miniWindow = next;
    syncMiniAppearance();
    if (!next.autoHide) showMiniWindow();
  };

  const onMiniViewportResize = () => applyMiniGeometry();

  root.addEventListener("mouseenter", cancelMiniHide);
  root.addEventListener("mouseleave", scheduleMiniHide);
  miniRestore.addEventListener("mouseenter", showMiniWindow);
  miniRestore.addEventListener("click", () => {
    showMiniWindow();
    try {
      root.focus({ preventScroll: true });
    } catch {
      // 忽略。
    }
  });

  const startMiniInteraction = (kind, event) => {
    if (!mini || event.button !== 0) return;
    if (kind === "move" && event.target?.closest?.("button, input, select, label")) return;
    const rect = root.getBoundingClientRect();
    miniInteraction = {
      kind,
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 忽略。
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const moveMiniInteraction = (event) => {
    const interaction = miniInteraction;
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    const deltaX = event.clientX - interaction.startX;
    const deltaY = event.clientY - interaction.startY;
    if (interaction.kind === "move") {
      miniWindow = { ...miniWindow, x: interaction.x + deltaX, y: interaction.y + deltaY };
    } else {
      miniWindow = { ...miniWindow, width: interaction.width + deltaX, height: interaction.height + deltaY };
    }
    applyMiniGeometry();
    event.preventDefault();
  };

  const finishMiniInteraction = (event) => {
    const interaction = miniInteraction;
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    miniInteraction = null;
    try {
      interaction.target.releasePointerCapture(event.pointerId);
    } catch {
      // 忽略。
    }
    saveMiniWindowSoon();
  };

  miniBar.addEventListener("pointerdown", (event) => startMiniInteraction("move", event));
  miniResize.addEventListener("pointerdown", (event) => startMiniInteraction("resize", event));
  for (const target of [miniBar, miniResize]) {
    target.addEventListener("pointermove", moveMiniInteraction);
    target.addEventListener("pointerup", finishMiniInteraction);
    target.addEventListener("pointercancel", finishMiniInteraction);
  }
  root.addEventListener(
    "wheel",
    (event) => {
      if (!mini || !event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      setMiniOpacity(miniWindow.opacity + (event.deltaY < 0 ? 0.05 : -0.05));
    },
    { passive: false }
  );

  const onDocumentKey = (event) => {
    if (!fill && !mini) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (fill) exitFill();
      else exitMini();
    }
  };

  const enterMini = () => {
    if (mini || !root.parentNode) return;
    if (fill) exitFill();
    if (!root.parentNode) return;
    mini = true;
    showMiniWindow();
    miniMarker = document.createComment("hg-player-mini");
    root.parentNode.insertBefore(miniMarker, root);
    document.body.appendChild(root);
    document.body.appendChild(miniRestore);
    root.classList.add("is-mini");
    miniStage()?.classList.add("is-mini-active");
    document.addEventListener("keydown", onDocumentKey);
    window.addEventListener("resize", onMiniViewportResize);
    syncMiniButton();
    syncMiniAppearance();
    try {
      root.focus({ preventScroll: true });
    } catch {
      // 忽略。
    }
    props.onMiniChange?.(true);
  };

  const exitMini = () => {
    if (!mini) return;
    mini = false;
    showMiniWindow();
    miniRestore.remove();
    miniInteraction = null;
    document.removeEventListener("keydown", onDocumentKey);
    window.removeEventListener("resize", onMiniViewportResize);
    root.classList.remove("is-mini");
    for (const property of ["left", "top", "width", "height", "right", "bottom"]) root.style.removeProperty(property);
    const stage = miniStage();
    stage?.classList.remove("is-mini-active");
    stage?.removeAttribute("data-mini-label");
    if (miniMarker?.parentNode) miniMarker.parentNode.insertBefore(root, miniMarker);
    else if (slot && !slot.contains(root)) slot.appendChild(root);
    miniMarker?.remove();
    miniMarker = null;
    syncMiniButton();
    syncMiniAppearance();
    props.onMiniChange?.(false);
  };

  const toggleMini = () => {
    if (mini) exitMini();
    else enterMini();
  };

  const enterFill = () => {
    if (fill || !root.parentNode) return;
    if (mini) exitMini();
    if (!root.parentNode) return;
    fill = true;
    fillMarker = document.createComment("hg-player-fill");
    root.parentNode.insertBefore(fillMarker, root);
    document.body.appendChild(root);
    root.classList.add("is-fill");
    document.addEventListener("keydown", onDocumentKey);
    syncFillButton();
    try {
      root.focus({ preventScroll: true });
    } catch {
      // 忽略。
    }
  };

  const exitFill = () => {
    if (!fill) return;
    fill = false;
    document.removeEventListener("keydown", onDocumentKey);
    root.classList.remove("is-fill");
    if (fillMarker && fillMarker.parentNode) fillMarker.parentNode.insertBefore(root, fillMarker);
    else if (slot && !slot.contains(root)) slot.appendChild(root);
    if (fillMarker) fillMarker.remove();
    fillMarker = null;
    syncFillButton();
  };

  const toggleFill = () => {
    if (fill) exitFill();
    else enterFill();
  };

  const syncFillButton = () => {
    setButtonIcon(fillBtn, fill ? "collapse" : "expand");
    fillBtn.title = fill ? t("player.exitFill") : t("player.fill");
    fillBtn.setAttribute("aria-label", fillBtn.title);
  };

  // ------------------------------------------------------------------ 界面同步

  const syncPlayButton = () => {
    setButtonIcon(playBtn, playing ? "pause" : "play");
    playBtn.title = playing ? t("player.pause") : t("player.play");
    playBtn.setAttribute("aria-label", playBtn.title);
  };

  const syncTime = () => {
    const duration = durationOf();
    timeLabel.textContent = `${formatClock(currentMs())} / ${formatClock(duration * 1000)}`;
  };

  const syncBuffered = () => {
    if (wvc) {
      // 直连播放是整集预取，没有 MSE 的 buffered ranges，缓冲条留空。
      buffered.replaceChildren();
      return;
    }
    const duration = durationOf();
    const ranges = video.buffered;
    const nodes = [];
    if (duration > 0 && ranges) {
      for (let index = 0; index < ranges.length; index += 1) {
        const start = ranges.start(index);
        const end = ranges.end(index);
        const node = make("span", "hg-player-buffered-range");
        node.style.left = `${clamp((start / duration) * 100, 0, 100)}%`;
        node.style.width = `${clamp(((end - start) / duration) * 100, 0, 100)}%`;
        nodes.push(node);
      }
    }
    buffered.replaceChildren(...nodes);
  };

  const syncProgressBar = () => {
    const duration = durationOf();
    const time = clamp(currentMs() / 1000, 0, duration || 0);
    const percent = duration > 0 ? (time / duration) * 100 : 0;
    played.style.width = `${percent}%`;
    thumb.style.left = `${percent}%`;
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", String(Math.max(0, Math.round(duration))));
    progress.setAttribute("aria-valuenow", String(Math.round(time)));
    progress.setAttribute("aria-valuetext", `${formatClock(time * 1000)} / ${formatClock(duration * 1000)}`);
    syncTime();
    syncBuffered();
  };

  const syncVolume = () => {
    const muted = video.muted || video.volume <= 0.001;
    setButtonIcon(muteBtn, muted ? "mute" : "volume");
    muteBtn.title = muted ? t("player.unmute") : t("player.mute");
    muteBtn.setAttribute("aria-label", muteBtn.title);
    volume.value = muted ? "0" : String(video.volume);
  };

  const syncSpeed = () => {
    speedSelect.disabled = false;
    speedSelect.title = t("player.speed");
    speedSelect.setAttribute("aria-label", speedSelect.title);
    speedSelect.value = String(currentPlaybackRate());
  };

  const syncQualitySelect = () => {
    // 本机解码生效时以下拉显示真实播放档位为准；兼容路径沿用引擎快照。
    const candidate = wvc ? wvcQuality : state.quality || desiredQuality || DEFAULT_QUALITY;
    // 服务器档位不在选项表里时退回到目标档位，避免下拉变成空值。
    const quality = QUALITY_OPTIONS.includes(candidate) ? candidate : desiredQuality;
    if (qualitySelect.value !== quality) qualitySelect.value = quality;
  };

  const updateNextButton = () => {
    const enabled = hasNext();
    nextBtn.disabled = !enabled;
    nextBtn.title = enabled ? t("player.next") : t("player.lastEpisode");
  };

  const updateLoading = () => {
    if (disposed) return;
    let busy = false;
    let textKey = "player.loading";
    if (wvc) {
      // 本机解码：拉流与预热都不算「可播放」，首帧真正解出来之前一直给加载提示。
      const snapshot = wvc.getState();
      const phase = snapshot.phase;
      const fetching = phase === "idle" || phase === "loading";
      const firstFramePending = phase === "ready" || (phase === "playing" && !(Number(snapshot.output) > 0));
      const buffering = phase === "playing" && snapshot.buffering;
      busy = fetching || firstFramePending || buffering;
      textKey = fetching ? "player.loading" : "player.buffering";
    } else {
      const phase = state.state;
      const initial = phase === MSE_STATE.PROBING || phase === MSE_STATE.OPENING;
      const appending = phase === MSE_STATE.BUFFERING || phase === MSE_STATE.RECOVERING;
      const stalled = waiting && (phase === MSE_STATE.READY || phase === MSE_STATE.BUFFERING);
      busy = initial || (appending && (state.appended || 0) === 0) || stalled;
      textKey = initial ? "player.loading" : "player.buffering";
    }
    loading.hidden = !busy || Boolean(overlayKind);
    if (!busy) return;
    loadingText.textContent = t(textKey);
  };

  const updateBigPlay = () => {
    if (disposed) return;
    if (wvc) {
      // 只有暂停和播完才显示大播放按钮，载入与预热阶段让位给加载提示。
      const phase = wvc.getState().phase;
      const show = phase === "paused" || phase === "ended";
      bigPlay.hidden = Boolean(overlayKind) || !show;
      return;
    }
    const ready = (state.appended || 0) > 0 || state.state === MSE_STATE.ENDED;
    const show = !overlayKind && !waiting && ready && video.paused;
    bigPlay.hidden = !show;
  };

  const showControls = () => {
    if (disposed) return;
    root.classList.remove("is-idle");
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = 0;
    }
    if (!playing || overlayKind || dragging) return;
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      if (!disposed && playing && !dragging && !overlayKind) root.classList.add("is-idle");
    }, HIDE_DELAY_MS);
  };

  // ------------------------------------------------------------------ 引擎状态

  function handleEngineState(snapshot) {
    if (disposed) return;
    const previousAppended = state.appended || 0;
    const previousPhase = state.state;
    state = snapshot;
    if ((snapshot.appended || 0) !== previousAppended || snapshot.state !== previousPhase) {
      lastActivityAt = Date.now();
      stallReported = false;
    }
    syncQualitySelect();
    syncPlayButton();
    syncProgressBar();
    updateNextButton();

    if (snapshot.state === MSE_STATE.DEGRADED) {
      showDegraded(snapshot);
    } else if (snapshot.state === MSE_STATE.ERROR) {
      showError(snapshot.error);
    } else if (snapshot.state === MSE_STATE.READY) {
      hideNotice();
      if (overlayKind === "degraded" || overlayKind === "error" || overlayKind === "notice") hideOverlay();
      if (snapshot.reason === "quality") {
        const key = `quality:${snapshot.quality}`;
        if (lastNoticeKey !== key) {
          lastNoticeKey = key;
          if (snapshot.resumeClamped) notify("info", t("player.resumeClamped"));
          else notify("success", t("player.qualitySwitched", { quality: snapshot.quality }));
        }
      } else if (snapshot.resumeClamped && lastNoticeKey !== "resume-clamped") {
        lastNoticeKey = "resume-clamped";
        notify("info", t("player.resumeClamped"));
      }
      if (autoPlayPending && !userPaused && video.paused) {
        autoPlayPending = false;
        safePlay();
      }
    } else if (snapshot.state === MSE_STATE.ENDED) {
      // ended 由 video 事件统一处理（含自动下一集）。
    } else if (snapshot.state === MSE_STATE.PROBING) {
      // 转码模式保留覆盖层并显示进度，其余情况恢复画面。
      if (snapshot.mode === "local") showTranscoding(snapshot);
      else if (overlayKind === "degraded" || overlayKind === "error" || overlayKind === "notice") hideOverlay();
    } else if (snapshot.state === MSE_STATE.BUFFERING && snapshot.mode === "local") {
      showTranscoding(snapshot);
    }

    updateLoading();
    updateBigPlay();
    showControls();
  }

  const DEGRADE_REASONS = {
    "no-mse": "无 MSE",
    codec: "编码不被接受",
    "add-source-buffer": "SourceBuffer 被拒",
    "src-not-supported": "解码器拒绝该流",
    decode: "解码失败",
  };

  const showDegraded = (snapshot) => {
    const codec = snapshot.codecLabel || "HEVC";
    const reason = snapshot.degradedReason ? DEGRADE_REASONS[snapshot.degradedReason] || "" : "";
    // 所有清晰度都是同一编码，切换清晰度无效；真正可用的兜底是本机解码或下载后外部播放。
    const actions = [
      {
        label: t("player.playDirect"),
        kind: "direct",
        primary: true,
        // 用户主动重试：清掉本次会话的失败标记，重新走一遍本机解码。
        onClick: () => {
          wvcBlocked = false;
          void playWebCodecs();
        },
      },
      {
        label: t("player.transcode"),
        onClick: () => playTranscoded(snapshot),
      },
      { label: t("player.download"), kind: "download", onClick: () => void downloadEpisode() },
      { label: t("player.copyAddress"), onClick: () => void copyAddress() },
      { label: t("player.retry"), onClick: () => retryPlayback() },
    ];
    setOverlay("degraded", {
      title: t("player.unsupportedTitle"),
      text: t("player.unsupportedHint", { codec }),
      hint: [
        snapshot.info?.definition ? t("player.actualQuality", { quality: snapshot.info.definition }) : "",
        reason ? `降级原因：${reason}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      actions,
    });
  };

  /** 转码兜底：让后台把这一集转成 H.264，再用 Blob 播放。 */
  const playTranscoded = (snapshot) => {
    const episodeId = snapshot?.episodeId || state.episodeId;
    if (!episodeId) return;
    void engine.loadLocal({
      episodeId,
      quality: snapshot?.quality || state.quality || props.quality,
      resumeMs: snapshot?.resumeAppliedMs || 0,
      autoplay: true,
      reason: "transcode",
    });
  };

  const showTranscoding = (snapshot) => {
    const percent = Math.max(
      Number(snapshot.transcodeProgress) || 0,
      Number(snapshot.transcode?.progress) || 0
    );
    setOverlay("notice", {
      title: t("player.transcodingTitle"),
      text: t("player.transcodingHint", { percent: Math.round(percent) }),
      hint: snapshot.info?.definition ? t("player.actualQuality", { quality: snapshot.info.definition }) : "",
      actions: [],
    });
  };

  const showError = (error) => {
    const info = describePlaybackError(error);
    const current = currentQuality();
    const actions = [
      {
        label: t("player.playDirect"),
        kind: "direct",
        primary: true,
        // 用户主动重试：清掉本次会话的失败标记，重新走一遍本机解码。
        onClick: () => {
          wvcBlocked = false;
          void playWebCodecs();
        },
      },
      { label: t("player.retry"), onClick: () => retryPlayback() },
    ];
    for (const quality of ["360p", "480p"]) {
      if (quality === current) continue;
      actions.push({ label: t("player.switchTo", { quality }), onClick: () => setQuality(quality, true) });
    }
    setOverlay("error", {
      title: t("player.errorTitle"),
      text: info.message,
      hint: info.hint,
      actions,
    });
  };

  // ------------------------------------------------------------------ 降级兜底动作

  const copyAddress = async () => {
    const episode = props.episode;
    if (!episode?.id) {
      notify("error", t("player.addressUnavailable"));
      return;
    }
    const port = Number(props.rpc?.getState?.().port) || 0;
    if (!port) {
      notify("error", t("player.addressUnavailable"));
      return;
    }
    const quality = currentQuality();
    const address = `http://127.0.0.1:${port}/stream/info?episodeId=${encodeURIComponent(episode.id)}&quality=${encodeURIComponent(quality)}`;
    const ok = await copyText(address);
    notify(ok ? "success" : "error", ok ? t("player.copyDone") : t("player.copyFailed"));
  };

  const downloadEpisode = async () => {
    if (downloading || disposed) return;
    const episode = props.episode;
    const quality = currentQuality();
    const total = state.info?.segmentCount || 0;
    if (!episode?.id || !total) {
      notify("error", t("player.downloadFailed", { error: t("player.addressUnavailable") }));
      return;
    }
    downloading = true;
    if (downloadActionNode) {
      downloadActionNode.disabled = true;
      downloadActionNode.textContent = t("player.downloading", { done: 0, total });
    }
    notify("info", t("player.downloading", { done: 0, total }));
    try {
      const initPayload = await props.rpc.getStreamInit(episode.id, quality);
      const parts = [decodeBase64(initPayload?.base64)];
      for (let seq = 1; seq <= total; seq += 1) {
        if (disposed) return;
        const payload = await props.rpc.getStreamSegment(episode.id, quality, seq);
        parts.push(decodeBase64(payload?.base64));
        if (downloadActionNode) downloadActionNode.textContent = t("player.downloading", { done: seq, total });
      }
      const blob = new Blob(parts, { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeFileName(props.series?.title || "episode")}-${episode.number ?? props.episodeIndex + 1}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // 忽略。
        }
      }, 60000);
      notify("success", t("player.downloadDone"));
    } catch (error) {
      notify("error", t("player.downloadFailed", { error: String(error?.message || error) }));
      log("[player] 下载失败", String(error?.message || error));
    } finally {
      downloading = false;
      if (downloadActionNode) {
        downloadActionNode.disabled = false;
        downloadActionNode.textContent = t("player.download");
      }
    }
  };

  // ------------------------------------------------------------------ 进度条交互

  const timeFromClientX = (clientX) => {
    const rect = track.getBoundingClientRect();
    if (!(rect.width > 0)) return 0;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return ratio * durationOf();
  };

  const showHover = (seconds) => {
    const duration = durationOf();
    if (!(duration > 0)) return;
    const ratio = clamp(seconds / duration, 0, 1);
    hoverFill.style.width = `${ratio * 100}%`;
    tip.hidden = false;
    tip.textContent = formatClock(seconds * 1000);
    tip.style.left = `${clamp(ratio * 100, 4, 96)}%`;
  };

  const clearHover = () => {
    hoverFill.style.width = "0%";
    tip.hidden = true;
  };

  progress.addEventListener("pointerdown", (event) => {
    if (!(durationOf() > 0)) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    progress.classList.add("is-dragging");
    try {
      progress.setPointerCapture(event.pointerId);
    } catch {
      // 忽略。
    }
    try {
      root.focus({ preventScroll: true });
    } catch {
      // 忽略。
    }
    showControls();
    const seconds = timeFromClientX(event.clientX);
    showHover(seconds);
    seekTo(seconds, { silent: true });
  });

  progress.addEventListener("pointermove", (event) => {
    const seconds = timeFromClientX(event.clientX);
    showHover(seconds);
    if (!dragging) return;
    const now = Date.now();
    if (now - lastSeekAt < 120) return;
    lastSeekAt = now;
    seekTo(seconds, { silent: true });
  });

  const finishDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    progress.classList.remove("is-dragging");
    try {
      progress.releasePointerCapture(event.pointerId);
    } catch {
      // 忽略。
    }
    const seconds = timeFromClientX(event.clientX);
    seekTo(seconds);
    if (!playing) updateBigPlay();
    showControls();
  };

  progress.addEventListener("pointerup", finishDrag);
  progress.addEventListener("pointercancel", finishDrag);
  progress.addEventListener("pointerleave", () => {
    if (!dragging) clearHover();
  });

  // ------------------------------------------------------------------ 画面与快捷键

  let clickTimer = 0;
  const onViewClick = () => {
    if (clickTimer) return;
    clickTimer = setTimeout(() => {
      clickTimer = 0;
      togglePlay();
    }, 220);
  };
  const onViewDoubleClick = () => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = 0;
    }
    toggleFill();
  };

  view.addEventListener("click", onViewClick);
  view.addEventListener("dblclick", onViewDoubleClick);
  view.addEventListener("pointerdown", () => {
    if (document.activeElement !== root) {
      try {
        root.focus({ preventScroll: true });
      } catch {
        // 忽略。
      }
    }
  });

  bigPlay.addEventListener("click", (event) => {
    event.stopPropagation();
    safePlay();
  });

  const onKeyDown = (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    if (miniHidden) {
      if (key === " " || key === "Spacebar" || key === "Enter" || key === "k" || key === "K") event.preventDefault();
      return;
    }
    const target = event.target;
    const tagName = target && target.tagName ? String(target.tagName).toLowerCase() : "";
    if (tagName === "select" || tagName === "input" || tagName === "textarea") return;
    // 焦点在按钮上时，空格/回车交给按钮自身，避免一次按键触发两次。
    const onButton = target && typeof target.closest === "function" && target.closest("button");
    if (onButton && (key === " " || key === "Spacebar" || key === "Enter")) return;
    if (key === " " || key === "Spacebar" || key === "k" || key === "K") {
      event.preventDefault();
      togglePlay();
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      seekBy(-SEEK_STEP_SECONDS);
    } else if (key === "ArrowRight") {
      event.preventDefault();
      seekBy(SEEK_STEP_SECONDS);
    } else if (key === "ArrowUp") {
      event.preventDefault();
      setVolume((Number(video.volume) || 0) + VOLUME_STEP);
    } else if (key === "ArrowDown") {
      event.preventDefault();
      setVolume((Number(video.volume) || 0) - VOLUME_STEP);
    } else if (key === "m" || key === "M") {
      event.preventDefault();
      toggleMute();
    } else if (key === "f" || key === "F") {
      event.preventDefault();
      toggleFill();
    } else if (key === "Escape") {
      if (fill || mini) {
        event.preventDefault();
        if (fill) exitFill();
        else exitMini();
      }
    } else if (key === "n" || key === "N") {
      event.preventDefault();
      nextEpisode();
    } else if (key === "<" || key === ">") {
      event.preventDefault();
      cycleSpeed(key === "<" ? -1 : 1);
    } else {
      return;
    }
    showControls();
  };

  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("pointermove", () => showControls());
  root.addEventListener("pointerdown", () => {
    wvc?.resumeAudio?.();
    showControls();
  });
  root.addEventListener("mouseleave", () => {
    if (playing && !dragging && !overlayKind) root.classList.add("is-idle");
  });

  // ------------------------------------------------------------------ video 事件

  video.addEventListener("play", () => {
    playing = true;
    userPaused = false;
    autoPlayPending = false;
    suppressPauseReport = false;
    syncPlayButton();
    updateBigPlay();
    showControls();
  });

  video.addEventListener("playing", () => {
    playing = true;
    waiting = false;
    updateLoading();
    updateBigPlay();
    syncPlayButton();
    showControls();
  });

  video.addEventListener("pause", () => {
    playing = false;
    waiting = false;
    syncPlayButton();
    updateLoading();
    updateBigPlay();
    showControls();
    if (suppressPauseReport) suppressPauseReport = false;
    else report(true);
  });
  video.addEventListener("waiting", () => {
    waiting = true;
    updateLoading();
    showControls();
  });

  video.addEventListener("canplay", () => {
    waiting = false;
    updateLoading();
    updateBigPlay();
  });

  video.addEventListener("timeupdate", () => {
    syncProgressBar();
    report(false);
  });

  video.addEventListener("durationchange", () => {
    syncProgressBar();
  });

  video.addEventListener("progress", () => syncBuffered());
  video.addEventListener("seeked", () => {
    syncProgressBar();
    report(true);
    updateBigPlay();
  });
  video.addEventListener("volumechange", () => syncVolume());
  video.addEventListener("ratechange", () => {
    if (disposed || wvc) return;
    // 兼容路径重载造成的速度变化不能覆盖会话选择，也不能改写本机解码速度。
    applyVideoPlaybackRate();
    syncSpeed();
  });

  const handleEnded = () => {
    if (disposed) return;
    playing = false;
    waiting = false;
    syncPlayButton();
    updateLoading();
    updateBigPlay();
    report(true);
    const durationMs = Math.round(durationOf() * 1000);
    try {
      props.onEnded?.({ episodeIndex: props.episodeIndex, episodeId: props.episode?.id, durationMs });
    } catch (error) {
      log("[player] onEnded 回调异常", String(error?.message || error));
    }
    const actions = [{ label: t("player.replay"), primary: true, onClick: replay }];
    if (hasNext()) actions.push({ label: t("player.nextEpisode"), onClick: nextEpisode });
    setOverlay("ended", {
      title: t("player.ended"),
      text: hasNext() ? t("player.endedNext") : t("player.endedLast"),
      hint: "",
      actions,
    });
  };

  video.addEventListener("ended", handleEnded);

  // ------------------------------------------------------------------ WebCodecs 直连播放

  const stopWebCodecs = () => {
    // 让还在等拉流的上一轮载入作废。
    wvcSeq += 1;
    const hadPlayer = Boolean(wvc);
    if (wvc) {
      try {
        wvc.destroy();
      } catch {
        // 销毁失败不阻塞切集。
      }
      wvc = null;
    }
    if (canvas) {
      canvas.hidden = true;
      canvas.style.display = "";
    }
    video.style.visibility = "";
    // 离开本机解码后兼容路径沿用会话倍速，播放图标回到未播放状态。
    if (hadPlayer) {
      playing = false;
      applyVideoPlaybackRate();
      syncPlayButton();
      syncSpeed();
    }
    // 下拉回到兼容路径的档位，不要停在上一轮本机解码的档位上。
    syncQualitySelect();
  };

  /**
   * 本机解码失败后的唯一一次回退：标记本次会话不再自动重试，按原有载入逻辑交给兼容路径。
   * 画面上只留两行中文说明，不暴露技术细节。
   */
  const fallbackFromWebCodecs = () => {
    if (wvcBlocked) return;
    // 切换通道前补报一次，避免回退后按旧位置重播。
    report(true);
    // report 只通过回调异步回写父组件，此刻 props.positionMs 仍是上一次渲染的旧值；
    // 取刚上报的真实位置，0 时（载入尚未完成）再退回父组件给的位置。
    const reportedMs = Math.max(0, Number(lastReportedMs) || 0);
    wvcBlocked = true;
    const episodeId = props.episode?.id || state.episodeId || "";
    stopWebCodecs();
    showNotice([t("player.decodeFailed"), t("player.fallbackCompatible")]);
    if (disposed || !episodeId) return;
    const loadOptions = {
      episodeId,
      quality: props.quality || DEFAULT_QUALITY,
      resumeMs: reportedMs > 0 ? reportedMs : Math.max(0, Number(props.positionMs) || 0),
      autoplay: true,
      reason: "initial",
    };
    // 自动转码会被宿主 CSP 拦在媒体元素外，只保留 MSE 探测；转码改由用户在降级面板显式触发。
    void engine.load(loadOptions);
  };

  /**
   * 直接用 WebCodecs 解红果原始流：不转码、不走 <video>、不受 CSP 的 media-src 限制。
   * 这是面板默认的播放通道；画面上屏后由 canvas 自身的 click 切换播放/暂停。
   * options.quality 指定本次拉流档位，options.resumeMs 指定续播位置（切档重载用）。
   */
  const playWebCodecs = async (options) => {
    if (!canDecodeLocally()) {
      // 本机没有解码器时不再尝试，当前负载本来就走兼容路径。
      wvcBlocked = true;
      showNotice([t("player.decodeFailed")]);
      return;
    }
    let player = null;
    stopWebCodecs();
    // stopWebCodecs 已经把序号加过一，这里记下本轮的身份，后续每步都先核对。
    const seq = wvcSeq;
    endedReported = false;
    hideNotice();
    try {
      // 切集后 state 还是上一集的 MSE 快照，集号必须以 props 为准。
      const episodeId = props.episode?.id || state.episodeId || "";
      if (!episodeId) return;
      // 起播档位来自已保存的清晰度偏好（见 wvcQuality 初值），不再固定 480p；
      // 用户手动切过的档位同样记在 wvcQuality 里，切集与连播继续沿用。
      const quality = options?.quality || wvcQuality || DEFAULT_QUALITY;
      // 切档重载要把当前播放位置带过去；没有指定时沿用详情页给的位置。
      const resumeMs = Number.isFinite(options?.resumeMs)
        ? Math.max(0, options.resumeMs)
        : Math.max(0, Number(props.positionMs) || 0);
      let segmentCount = 0;
      let actualQuality = "";
      try {
        const info = await props.rpc?.getStreamInfo?.(episodeId, quality);
        segmentCount = Number(info?.segmentCount) || 0;
        actualQuality = String(info?.definition || "");
      } catch (error) {
        // 分段数量拿不到时按 1 段试，真正的失败由解码层抛出来。
        log("[wvc] 取流信息失败", String(error?.message || error));
      }
      // 期间又切了集或又换了档：本轮作废，别去抢画布。
      if (seq !== wvcSeq || disposed) return;
      // 源站不一定给到请求的档位（例如只有 720p），下拉按服务器实际档位显示。
      if (actualQuality) {
        wvcQuality = actualQuality;
        syncQualitySelect();
      }
      hideOverlay();
      // 首帧之前先亮加载提示，黑屏期间不能没有任何反馈。
      loading.hidden = false;
      loadingText.textContent = t("player.loading");
      try {
        video.pause();
      } catch {
        // 忽略。
      }
      video.style.visibility = "hidden";
      canvas.hidden = false;
      canvas.style.display = "block";
      canvas.width = 854;
      canvas.height = 480;
      player = createWebCodecsPlayer({
        canvas,
        getRpc: () => props.rpc,
        log,
        onState: (snapshot) => {
          // 已被切集替换掉的旧实例不要再改界面状态。
          if (wvc !== player) return;
          if (snapshot.phase === "error" && snapshot.error) {
            log("[wvc] 解码失败", snapshot.error);
            fallbackFromWebCodecs();
            return;
          }
          // <video> 此刻是停的，播放状态只能从引擎同步过来。
          const active = snapshot.phase === "playing";
          if (active) {
            autoPlayPending = false;
            endedReported = false;
          }
          if (playing !== active) {
            playing = active;
            syncPlayButton();
          }
          if (snapshot.phase === "ended" && !endedReported) {
            endedReported = true;
            handleEnded();
          }
          syncSpeed();
          updateBigPlay();
          updateLoading();
        },
      });
      wvc = player;
      // 取流信息等待期间可能改过速度或音量，新实例立即使用最新会话值。
      player.setVolume(video.muted ? 0 : video.volume);
      setSpeed(desiredPlaybackRate);
      syncQualitySelect();
      updateBigPlay();
      updateLoading();
      await player.load({
        episodeId,
        quality,
        segmentCount,
        resumeMs,
      });
      if (seq !== wvcSeq || wvc !== player) return;
      // 不捕获载入前的倍速，避免异步拉流期间的新选择被旧值覆盖。
      setSpeed(desiredPlaybackRate);
      if (miniHidden || userPaused) {
        player.pause();
        return;
      }
      player.play();
    } catch (error) {
      if (seq !== wvcSeq || wvc !== player) return;
      log("[wvc] 载入失败", String(error?.message || error));
      if (error?.code === "SEGMENT_LIMIT") {
        stopWebCodecs();
        setOverlay("notice", {
          title: t("player.errorTitle"),
          text: String(error.message || t("player.decodeFailed")),
          hint: "",
          actions: [],
        });
        return;
      }
      fallbackFromWebCodecs();
    }
  };

  // ------------------------------------------------------------------ 载入与更新

  const loadEpisode = () => {
    // 换集时先收掉 WebCodecs 播放层，避免旧集的解码器继续画在画面上。
    stopWebCodecs();
    if (disposed) return;
    hideOverlay();
    // 换集后上一集的失败提示不再适用。
    hideNotice();
    lastNoticeKey = "";
    lastReportedMs = Math.max(0, Number(props.positionMs) || 0);
    desiredQuality = props.quality || DEFAULT_QUALITY;
    const episode = props.episode;
    if (!episode?.id) {
      setOverlay("notice", { title: t("player.errorTitle"), text: t("player.noEpisode"), hint: "", actions: [] });
      return;
    }
    if (episode.playable === false) {
      setOverlay("notice", { title: t("player.errorTitle"), text: t("player.unplayable"), hint: "", actions: [] });
      return;
    }
    userPaused = false;
    autoPlayPending = true;
    updateNextButton();
    const loadOptions = {
      episodeId: episode.id,
      quality: props.quality || DEFAULT_QUALITY,
      resumeMs: Math.max(0, Number(props.positionMs) || 0),
      autoplay: true,
      reason: "initial",
    };
    // 本机解码是唯一能出画面的通道：有能力就直接走，不再先拿 MSE 撞一次墙。
    if (canDecodeLocally() && !wvcBlocked) {
      void playWebCodecs();
      return;
    }
    // 本机解码不可用时走 MSE 探测；转码只在降级面板里由用户显式触发。
    void engine.load(loadOptions);
  };

  const applyProps = (next) => {
    const prev = {
      episodeId: props.episode?.id || "",
      episodeIndex: props.episodeIndex,
      seriesTitle: props.series?.title || "",
      quality: props.quality || "",
      locale: props.locale || "",
      positionMs: Number(props.positionMs) || 0,
      playbackRate: props.playbackRate,
      volume: props.volume,
      muted: props.muted,
      seekRequest: props.seekRequest,
    };
    const episodeChanged = (next?.episode?.id || "") !== prev.episodeId;
    if (episodeChanged) {
      // teardown 会触发一次 pause；不要用新集号 + 旧位置写历史（详情页已按新集落盘）。
      suppressPauseReport = true;
      setTimeout(() => {
        suppressPauseReport = false;
      }, 1000);
    }

    Object.assign(props, next);

    const playback = normalizePlaybackPrefs(props);
    if (props.playbackRate !== prev.playbackRate && playback.playbackRate !== desiredPlaybackRate) {
      setSpeed(playback.playbackRate);
    }
    if (props.volume !== prev.volume || props.muted !== prev.muted) {
      video.volume = playback.volume;
      video.muted = playback.muted;
      if (wvc) wvc.setVolume(video.muted ? 0 : video.volume);
      syncVolume();
    }

    if (next.miniWindow) adoptMiniWindow(next.miniWindow);
    if ((next.locale || "") !== prev.locale) applyLabels();
    else if (episodeChanged || (props.series?.title || "") !== prev.seriesTitle) syncMiniAppearance();

    const nextEpisodeId = props.episode?.id || "";
    if (nextEpisodeId !== prev.episodeId) {
      loadEpisode();
      return;
    }

    if (props.episodeIndex !== prev.episodeIndex) updateNextButton();

    if (props.seekRequest !== prev.seekRequest && durationOf() > 0) {
      // 失败的取流信息也可能含时长；保留恢复入口，不能把 seek 当作重建播放器。
      if (["degraded", "error", "notice"].includes(overlayKind)) return;
      seekTo(Math.max(0, Number(props.positionMs) || 0) / 1000);
      hideOverlay();
      safePlay();
      return;
    }

    const nextQuality = props.quality || "";
    if (nextQuality && nextQuality !== prev.quality && nextQuality !== desiredQuality) {
      // 面板异步读到偏好后回写 props.quality：实际播放档位已经是这一档时只同步下拉，不整集重载。
      if (wvc && wvcQuality === nextQuality) {
        desiredQuality = nextQuality;
        syncQualitySelect();
      } else {
        setQuality(nextQuality, false);
      }
    }

    // 「继续观看」二次点击：位置变化明显、不是播放器最近上报的回写、且与当前播放点有明显差距时跳转。
    const nextPosition = Number(props.positionMs) || 0;
    if (
      nextPosition > 0 &&
      Math.abs(nextPosition - prev.positionMs) > RESUME_JUMP_TOLERANCE_MS &&
      Math.abs(nextPosition - lastReportedMs) > RESUME_JUMP_TOLERANCE_MS &&
      Math.abs(nextPosition - currentMs()) > RESUME_JUMP_TOLERANCE_MS &&
      !wasReportedRecently(nextPosition) &&
      durationOf() > 0
    ) {
      seekTo(nextPosition / 1000);
      notify("info", t("player.resumeJump", { time: formatClock(nextPosition) }));
    }
  };

  // 初始挂载
  applyLabels();
  syncQualitySelect();
  syncVolume();
  syncSpeed();
  updateNextButton();
  syncProgressBar();
  if (typeof video.requestPictureInPicture !== "function") pipBtn.hidden = true;
  loadEpisode();

  // 直连播放不走 <video> 事件，进度条、时间标签与进度上报都只能靠定时器拉动。
  const progressTimer = setInterval(() => {
    if (disposed || !wvc || dragging) return;
    syncProgressBar();
    // WebCodecs 通道没有 timeupdate：播放中由这里上报，report 内部已做 1 秒节流。
    if (wvc.getState().phase === "playing") report(false);
  }, 500);

  // 拉流看门狗：单段请求最坏要等几十秒，超过 45 秒没有任何新增分段就给可重试的错误界面。
  // 本机解码在用时不看 MSE 的旧快照，避免拿上一集的相位误报超时。
  const watchdog = setInterval(() => {
    if (disposed || stallReported || overlayKind || wvc) return;
    const phase = state.state;
    if (phase !== MSE_STATE.BUFFERING && phase !== MSE_STATE.RECOVERING) return;
    if (Date.now() - lastActivityAt < 45000) return;
    stallReported = true;
    log("[player] 拉流超时，停止等待并给出重试入口");
    showError({ code: "PLAYBACK_STALL" });
  }, 5000);

  return {
    update(next) {
      if (disposed || !next) return;
      applyProps(next);
    },
    destroy() {
      if (disposed) return;
      report(true);
      disposed = true;
      try {
        exitMini();
      } catch {
        // 忽略。
      }
      try {
        exitFill();
      } catch {
        // 忽略。
      }
      document.removeEventListener("keydown", onDocumentKey);
      window.removeEventListener("resize", onMiniViewportResize);
      if (miniSaveTimer) {
        clearTimeout(miniSaveTimer);
        miniSaveTimer = 0;
      }
      cancelMiniHide();
      miniRestore.remove();
      clearInterval(watchdog);
      clearInterval(progressTimer);
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = 0;
      }
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = 0;
      }
      try {
        engine.destroy();
      } catch (error) {
        log("[player] 引擎销毁失败", String(error?.message || error));
      }
      try {
        wvc?.destroy();
        wvc = null;
      } catch {
        // 忽略。
      }
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        // 忽略。
      }
      root.remove();
      if (slot) slot.replaceChildren();
    },
  };
}
