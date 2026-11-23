// 动作流水：只存在插件私有存储里，环形保留最近 N 条。
// 用于「审计」页把插件动作与宿主日志对照，不对外发送。
import { LIMITS } from "../shared/contract.js";

const STORAGE_KEY = "audit";

export function createAudit({ storage, log = () => {} }) {
  let cache = null;

  const read = async () => {
    if (cache) return cache;
    try {
      const raw = await storage.getJson(STORAGE_KEY, []);
      cache = Array.isArray(raw) ? raw.filter((item) => item && typeof item === "object") : [];
    } catch (error) {
      log(`读取审计流水失败：${error?.message || error}`);
      cache = [];
    }
    return cache;
  };

  const record = async (entry) => {
    const list = await read();
    const item = {
      at: Date.now(),
      action: String(entry?.action || "unknown").slice(0, 64),
      ok: entry?.ok !== false,
      detail: String(entry?.detail || "").slice(0, 500),
    };
    const next = [item, ...list].slice(0, LIMITS.auditMax);
    cache = next;
    try {
      await storage.setJson(STORAGE_KEY, next);
    } catch (error) {
      log(`写入审计流水失败：${error?.message || error}`);
    }
    return item;
  };

  return {
    record,
    async list(limit = 50) {
      const list = await read();
      const size = Math.min(Math.max(Number(limit) || 50, 1), LIMITS.auditMax);
      return list.slice(0, size);
    },
    async clear() {
      cache = [];
      await storage.setJson(STORAGE_KEY, []);
    },
  };
}
