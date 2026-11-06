// 封面加载：/cover 需要自定义请求头，不能直接给 <img src> 用。
// 这里走 api.net.fetch 的 arraybuffer 通道拿 Blob，再转 object URL 给 <img>；
// 失败或宿主无法解码 HEIC 时由 <Cover> 显示占位块。
const MAX_ENTRIES = 80;

export function createCoverStore(rpc, { max = MAX_ENTRIES, log = () => {} } = {}) {
  const entries = new Map();
  const order = [];

  const revoke = (record) => {
    if (record?.url) {
      try {
        URL.revokeObjectURL(record.url);
      } catch {
        // object URL 已被回收时忽略。
      }
    }
  };

  const trim = () => {
    while (entries.size > max) {
      const oldest = order.find((path) => {
        const record = entries.get(path);
        return record && !record.pending;
      });
      if (!oldest) break;
      const index = order.indexOf(oldest);
      if (index >= 0) order.splice(index, 1);
      const record = entries.get(oldest);
      revoke(record);
      entries.delete(oldest);
    }
  };

  const load = (path) => {
    if (!path) return Promise.resolve(null);
    const existing = entries.get(path);
    if (existing) {
      if (existing.url) return Promise.resolve(existing.url);
      if (existing.failed) return Promise.resolve(null);
      return existing.promise;
    }

    const record = { url: null, failed: false, pending: true, promise: null };
    record.promise = rpc
      .fetchCover(path)
      .then(({ blob }) => {
        if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
          throw new Error("object URL 不可用");
        }
        record.url = URL.createObjectURL(blob);
        return record.url;
      })
      .catch((error) => {
        record.failed = true;
        log(`[cover] 加载失败：${error?.code || ""} ${error?.message || error}`);
        return null;
      })
      .finally(() => {
        record.pending = false;
        record.promise = null;
      });

    entries.set(path, record);
    order.push(path);
    trim();
    return record.promise;
  };

  const dispose = () => {
    for (const record of entries.values()) revoke(record);
    entries.clear();
    order.length = 0;
  };

  return { load, dispose };
}
