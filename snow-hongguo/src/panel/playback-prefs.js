export const PLAYBACK_RATES = Object.freeze([0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]);

export const normalizePlaybackPrefs = (raw) => ({
  playbackRate: PLAYBACK_RATES.includes(Number(raw?.playbackRate)) ? Number(raw.playbackRate) : 1,
  volume: raw?.volume != null && Number.isFinite(Number(raw.volume))
    ? Math.min(1, Math.max(0, Number(raw.volume)))
    : 1,
  muted: raw?.muted === true,
  autoNext: raw?.autoNext !== false,
});
