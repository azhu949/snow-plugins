// 索引文件读写：临时文件 + rename 保证读者看不到半截 JSON；损坏文件改名保留并向上报错。
// 任务与链路索引共用这一实现，避免两处口径漂移。
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PurgeError } from "./errors.js";

/** 同目录唯一临时名：多个索引与多个并发写不能共用同一个临时文件。 */
const tempPathOf = (filePath) =>
  `${filePath}.${process.pid}.${Date.now().toString(36)}.${randomBytes(4).toString("hex")}.snow-purge.tmp`;

/**
 * 原子写：同目录临时文件 + rename，读者看不到半截 JSON。
 * 索引类文件共用这一实现：编队、技能、任务、链路的口径不能各自漂移。
 */
export async function writeJsonAtomic(filePath, value, label = "索引") {
  const temp = tempPathOf(filePath);
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
    await rename(temp, filePath);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw new PurgeError("INDEX_WRITE_FAILED", `写入${label}失败：${error?.message || error}`);
  }
}

export function createIndexFile({ filePath, label, empty, normalize, log = () => {} }) {
  /** 损坏文件改名保留：既留下排查线索，也让下一次读取按「不存在」恢复成空表。 */
  const quarantine = async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = `${filePath}.corrupt-${stamp}-${randomBytes(2).toString("hex")}`;
    try {
      await rename(filePath, target);
      return target;
    } catch (error) {
      log(`${label}的损坏文件备份失败：${error?.message || error}`);
      return "";
    }
  };

  /**
   * 读取：只有「文件不存在」算空表；解析失败、结构不符、无权限都抛错。
   * 把读不到当成空表，下一次写入就会用空表覆盖用户已有的记录。
   */
  const read = async () => {
    let text = "";
    try {
      text = await readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return empty();
      throw new PurgeError("INDEX_READ_FAILED", `读取${label}失败：${error?.message || error}`);
    }
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const backup = await quarantine();
      throw new PurgeError(
        "INDEX_CORRUPT",
        `${label}内容已损坏（${error?.message || error}）${backup ? `，原文件已备份为 ${backup}` : "，原文件保留未动"}`
      );
    }
    const value = normalize(parsed);
    if (!value) {
      const backup = await quarantine();
      throw new PurgeError(
        "INDEX_CORRUPT",
        `${label}结构与预期不符${backup ? `，原文件已备份为 ${backup}` : "，原文件保留未动"}`
      );
    }
    return value;
  };

  /** 写失败必须抛给调用方：只打日志会让面板显示「已完成」而后台什么都没留下。 */
  const write = async (index) => writeJsonAtomic(filePath, index, label);

  return { read, write };
}
