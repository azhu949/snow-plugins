import { createHash } from "node:crypto";
import { HttpError } from "./errors.js";
import { createTtlCache } from "./util.js";

/** SDK 游标可能累计已展示 ID；回环地址仅传短标识，同一 scope/游标保持稳定。 */
export function createPageCursors() {
  const prefix = "hg1.";
  const cache = createTtlCache({ ttlMs: 30 * 60 * 1000, max: 200 });
  return {
    read(value, scope) {
      // 兼容更新前已加载页面中的短 SDK 游标。
      if (typeof value !== "string" || !value.startsWith(prefix)) return value;
      const entry = cache.get(value);
      if (!entry || entry.scope !== scope) {
        throw new HttpError(410, "CURSOR_EXPIRED", "分页已过期，请重试以重新加载列表");
      }
      return entry.cursor;
    },
    pageInfo(page, scope) {
      const raw = typeof page?.cursor === "string" ? page.cursor : "";
      if (page?.has_more !== true || !raw) return { cursor: null, hasMore: false };
      const cursor = prefix + createHash("sha256").update(`${scope}\0${raw}`).digest("base64url");
      cache.set(cursor, { scope, cursor: raw });
      return { cursor, hasMore: true };
    },
  };
}
