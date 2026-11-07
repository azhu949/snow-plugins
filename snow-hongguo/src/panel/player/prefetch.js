/** 下一集只在稳定播放且接近片尾时预热；切集把租约交给正式请求，避免先取消后又下载。 */
export function createNextPrefetch({ getRpc, now = Date.now, makeToken = () => globalThis.crypto.randomUUID() }) {
  let lease = null;
  let disposed = false;
  let current = "";
  const attempts = new Map();
  const handoffs = new Set();
  const release = (entry) => {
    if (!entry || entry.released) return;
    entry.released = true;
    Promise.resolve().then(() => entry.rpc.cancelPrefetch(entry.token)).catch(() => {});
  };
  const cancel = () => { release(lease); lease = null; };
  return {
    cancel,
    activate(episodeId, quality) {
      const key = `${episodeId}:${quality}`;
      if (current !== key) { current = key; attempts.clear(); }
      const matching = lease?.key === key ? lease : null;
      if (matching) { lease = null; handoffs.add(matching); } else cancel();
      return () => { if (matching) { handoffs.delete(matching); release(matching); } };
    },
    update({ episodeId, next, quality, playing, buffering, timeMs, durationMs, playbackRate = 1, enabled = true }) {
      if (disposed) return;
      const eligible = enabled && playing && !buffering && next?.id && next.playable !== false && next.id !== episodeId
        && durationMs > 0 && timeMs >= 5000 && timeMs >= durationMs * 0.6
        && (durationMs - timeMs) / Math.max(0.5, playbackRate) <= 30000 && timeMs < durationMs;
      if (!eligible) { cancel(); return; }
      const key = `${next.id}:${quality}`;
      if (lease?.key === key) return;
      cancel();
      const attempt = attempts.get(key);
      if (attempt && (attempt.count >= 2 || now() - attempt.at < 5000)) return;
      const rpc = getRpc();
      if (!rpc?.prefetchStream || !rpc?.cancelPrefetch) return;
      const entry = { key, token: makeToken(), rpc, released: false };
      lease = entry;
      attempts.set(key, { count: (attempt?.count || 0) + 1, at: now() });
      Promise.resolve().then(() => entry.released ? null : rpc.prefetchStream(next.id, quality, entry.token)).then((result) => {
        if (result?.accepted !== true && lease === entry) cancel();
      }).catch(() => { if (lease === entry) cancel(); });
    },
    destroy() {
      disposed = true;
      cancel();
      for (const entry of handoffs) release(entry);
      handoffs.clear();
      attempts.clear();
    },
  };
}
