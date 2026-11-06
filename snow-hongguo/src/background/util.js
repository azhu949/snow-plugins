// 后台通用小工具：截断、并发映射、TTL 缓存、单飞合并、字节估算。

/** 按 Unicode 码点截断，不会把代理对切成半个字符；超长时不追加省略号。 */
export const truncateChars = (value, max) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
};

/** 有并发上限的 map；单项失败记为 undefined，不影响其他项。 */
export async function mapWithConcurrency(items, limit, fn) {
  const list = Array.from(items ?? []);
  if (list.length === 0) return [];
  const size = Math.max(1, Math.min(Number(limit) || 1, list.length));
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= list.length) return;
      try {
        results[index] = await fn(list[index], index);
      } catch {
        results[index] = undefined;
      }
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}

/** 极简 TTL + LRU 上限缓存，够用于剧集详情与封面补全结果。 */
export function createTtlCache({ ttlMs = 5 * 60 * 1000, max = 200, now = Date.now } = {}) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (hit.expiresAt <= now()) {
        map.delete(key);
        return null;
      }
      // 重新插入，维持最近使用顺序。
      map.delete(key);
      map.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { value, expiresAt: now() + ttlMs });
      while (map.size > max) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
    },
    delete(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}

/** 同一个 key 的并发请求合并成一次；结束后自动从 map 移除。 */
export function withSingleFlight(map, key, task) {
  const existing = map.get(key);
  if (existing) return existing;
  const promise = (async () => task())();
  map.set(key, promise);
  const clear = () => {
    if (map.get(key) === promise) map.delete(key);
  };
  promise.then(clear, clear);
  return promise;
}

/** 估算 JSON 序列化后的字节数，用来守 64 KB 之类的响应上限。 */
export const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

/** 只保留有值的字段，避免把 undefined / null / 空串传给 SDK。 */
export const compactOptions = (options = {}) =>
  Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined && value !== null && value !== ""));
