// 本机备份：只快照本插件会改动的东西（代理脚本原文、ROLE 原文、托管提示词原值、免审批清单）。
// 备份落在宿主数据目录 plugin-data/<pluginId>/backups 下，不随插件安装目录更新被删。
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LIMITS } from "../shared/contract.js";

const MAX_PAYLOAD_BYTES = 512 * 1024;
/** 元数据副本后缀：列表只读这份小文件，不再为四个字段解析整份快照。 */
const META_SUFFIX = ".meta.json";
const META_VERSION = 1;
/** 快照完整性格式版本：旧快照没有该字段，按 legacy 放行但会标记未校验。 */
const INTEGRITY_VERSION = 2;

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** 稳定序列化：对象键排序、数组保序，读回重算摘要时不受键序变化影响。 */
const stableStringify = (value) => {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
};

/** 摘要覆盖 kind 与 payload：只改说明文案不会被判成篡改，改写类型或内容则会被发现。 */
const snapshotHash = ({ kind, payload }) => sha256(stableStringify({ kind: String(kind || ""), payload }));

const safeId = (value) => /^[A-Za-z0-9_-]{1,64}$/.test(String(value || ""));

export function createBackupStore({ dir, log = () => {} }) {
  const ensureDir = async () => {
    await mkdir(dir, { recursive: true });
  };

  const pathOf = (id) => join(dir, `${id}.json`);
  const metaPathOf = (id) => join(dir, `${id}${META_SUFFIX}`);

  /**
   * 列表元数据：优先读元数据副本（小文件），副本缺失、解析失败或与快照大小不符时
   * 回落整份解析。旧备份没有副本也能正常列出。
   */
  const readMeta = async (file) => {
    const id = String(file).replace(/\.json$/, "");
    // id 会被用来拼删除路径：只接受安全字符，非法记录不进列表。
    if (!safeId(id)) return null;
    const path = pathOf(id);
    let info = null;
    try {
      info = await stat(path);
    } catch {
      return null;
    }
    let meta = null;
    try {
      meta = JSON.parse(await readFile(metaPathOf(id), "utf8"));
    } catch {
      meta = null;
    }
    // size 与快照实际大小一致才可信：快照被手工改过时回落整份解析。
    if (meta && meta.v === META_VERSION && Number(meta.size) === info.size) {
      return {
        id,
        at: Number(meta.at) || info.mtimeMs,
        kind: String(meta.kind || "config"),
        reason: String(meta.reason || ""),
        bytes: info.size,
      };
    }
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      return {
        id,
        at: Number(parsed.at) || info.mtimeMs,
        kind: String(parsed.kind || "config"),
        reason: String(parsed.reason || ""),
        bytes: info.size,
      };
    } catch {
      return null;
    }
  };

  const list = async () => {
    try {
      await ensureDir();
      // 元数据副本不是备份条目：不排除会把它当成一份空快照列出来。
      const files = (await readdir(dir)).filter(
        (name) => name.endsWith(".json") && !name.endsWith(META_SUFFIX)
      );
      const items = (await Promise.all(files.map(readMeta))).filter(Boolean);
      items.sort((a, b) => b.at - a.at);
      return items;
    } catch (error) {
      log(`列出备份失败：${error?.message || error}`);
      return [];
    }
  };

  /** 删除单个备份：id 先过 safeId，路径不会越出备份目录。 */
  const removeFile = async (id) => {
    if (!safeId(id)) return false;
    try {
      // 快照本体决定返回值；元数据副本删不掉只影响列表性能，不改变「已删除」的结论。
      await rm(pathOf(id), { force: true });
      await rm(metaPathOf(id), { force: true }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  };

  const prune = async () => {
    const items = await list();
    for (const item of items.slice(LIMITS.backupCountMax)) {
      if (!(await removeFile(item.id))) log(`淘汰备份失败：${item.id}`);
    }
  };

  return {
    dir,
    async create({ kind, reason, payload }) {
      await ensureDir();
      const at = Date.now();
      const hash = snapshotHash({ kind, payload });
      const body = JSON.stringify({ at, kind, reason: reason || "", payload, hv: INTEGRITY_VERSION, hash }, null, 2);
      const bytes = Buffer.byteLength(body);
      if (bytes > MAX_PAYLOAD_BYTES) {
        log(`备份过大已跳过：${kind} ${reason || ""}（${bytes} B > ${MAX_PAYLOAD_BYTES} B）`);
        // 返回明确状态而不是 null：调用方要能把「没建快照」提示给用户。
        return { id: "", skipped: "PAYLOAD_TOO_LARGE", bytes, limit: MAX_PAYLOAD_BYTES };
      }
      const id = `b${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      await writeFile(pathOf(id), `${body}\n`, "utf8");
      // 元数据副本：列表只读它。写失败只影响列表性能（会回落整份解析），不影响快照本身。
      try {
        const info = await stat(pathOf(id));
        await writeFile(
          metaPathOf(id),
          JSON.stringify(
            { v: META_VERSION, at: Date.now(), kind, reason: reason || "", size: info.size },
            null,
            2
          ),
          "utf8"
        );
      } catch (error) {
        log(`写入备份元数据失败：${error?.message || error}`);
      }
      await prune();
      log(`已创建备份 ${id}（${kind}）`);
      return { id, at: Date.now(), kind, reason: reason || "", bytes, skipped: "", limit: MAX_PAYLOAD_BYTES };
    },

    async read(id) {
      if (!safeId(id)) return null;
      try {
        const parsed = JSON.parse(await readFile(pathOf(id), "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        // 新快照带 hv + hash：重算一致才算完整；缺字段的是升级前的旧快照，按 legacy 放行但由调用方标注未校验。
        const integrity =
          parsed.hv === INTEGRITY_VERSION && typeof parsed.hash === "string"
            ? parsed.hash === snapshotHash({ kind: parsed.kind, payload: parsed.payload })
              ? "ok"
              : "mismatch"
            : "legacy";
        return { ...parsed, integrity };
      } catch {
        return null;
      }
    },

    remove: removeFile,

    list,

    /** 占用统计：传入列表结果时复用同一次扫描，避免重复读取。 */
    async usage(items = null) {
      const rows = Array.isArray(items) ? items : await list();
      return { count: rows.length, bytes: rows.reduce((sum, item) => sum + (item.bytes || 0), 0) };
    },
  };
}
