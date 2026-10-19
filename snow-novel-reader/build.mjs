// 构建入口：把 src/ 下的工程化源码打包成插件目录里的单文件 ESM 产物。
// 宿主只读取 plugin.json 的 entry 文件，相对 import 与裸模块名都无法解析，
// 因此发布用的 index.js 必须是 bundle 后的产物（见宿主文档「工程化源码与单文件打包」）。
import { build } from "esbuild";
import { access, readFile, rename, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(root, "plugin.json"), "utf8"));

if (!pkg.version) {
  console.error("构建失败：package.json 缺少 version 字段");
  process.exit(1);
}
// 清单版本与包版本必须一致：插件市场与宿主更新判断都读 plugin.json。
if (manifest.version !== pkg.version) {
  console.error(`构建失败：plugin.json version ${manifest.version} 与 package.json version ${pkg.version} 不一致`);
  process.exit(1);
}

const entry = join(root, "src", "main.js");
const outfile = join(root, manifest.entry || "index.js");
const tempfile = `${outfile}.tmp`;
const backupfile = `${outfile}.bak`;
const banner = "// 构建产物：由 build.mjs 从 src/ 打包生成，请勿直接编辑。";

try {
  await access(entry, fsConstants.R_OK);
} catch {
  console.error(`构建失败：入口源码缺失或不可读 ${entry}`);
  process.exit(1);
}

await rm(tempfile, { force: true });
let keepTemp = false;

try {
  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: tempfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    splitting: false,
    sourcemap: false,
    minify: false,
    // 宿主按 UTF-8 读取入口文本：保留中文字面量，避免产物全被转义成 \uXXXX。
    charset: "utf8",
    legalComments: "none",
    banner: { js: banner },
    logLevel: "info"
  });

  const built = await readFile(tempfile, "utf8");
  // 产物契约：宿主按 ES 模块加载，必须保留默认导出与 mount 命名导出；
  // bundle 后不应残留任何相对 import（否则宿主无法解析）。
  const hasDefaultExport = /export\s+default\b/.test(built) || /export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(built);
  const hasMountExport = /export\s*\{[^}]*\bmount\b[^}]*\}/.test(built) || /export\s+function\s+mount\b/.test(built);
  if (!hasDefaultExport || !hasMountExport) {
    throw new Error("产物缺少插件入口导出契约（default / mount）");
  }
  if (/(^|\n)\s*import\s[^;\n]*from\s+["']\.{1,2}\//.test(built)) {
    throw new Error("产物仍包含未打包的相对 import");
  }

  // 构建成功后才替换旧产物。目标被编辑器/杀软短暂占用时，先把旧入口改名为 .bak
  // 再放入新产物；第二次 rename 仍失败则回滚，保证任何失败路径都不会留下缺失的入口。
  try {
    await rename(tempfile, outfile);
    // 正常替换成功：上一次失败可能留下的备份已无用途。
    await rm(backupfile, { force: true }).catch(() => {});
  } catch (error) {
    if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code)) throw error;
    await rm(backupfile, { force: true }).catch(() => {});
    let backedUp = false;
    try {
      await rename(outfile, backupfile);
      backedUp = true;
    } catch (backupError) {
      // 目标不存在（首次构建）时没有可备份的旧入口，直接尝试放入新产物。
      if (backupError?.code !== "ENOENT") throw backupError;
    }
    try {
      await rename(tempfile, outfile);
    } catch (replaceError) {
      if (backedUp) {
        try {
          await rename(backupfile, outfile);
        } catch (rollbackError) {
          keepTemp = true;
          throw new Error(
            `替换入口失败且旧入口回滚失败：${replaceError?.message || replaceError}；` +
              `旧入口备份：${backupfile}；新产物：${tempfile}；` +
              `手动恢复：把备份文件改名为 ${outfile}`
          );
        }
      } else {
        // 没有旧入口可回滚：新产物是唯一可用副本，保留临时文件供手动恢复。
        keepTemp = true;
      }
      throw replaceError;
    }
    if (backedUp) {
      await rm(backupfile, { force: true }).catch((cleanupError) => {
        console.warn(`警告：临时备份清理失败，可手动删除 ${backupfile}：${cleanupError?.message || cleanupError}`);
      });
    }
  }
  console.log(`构建完成：${outfile}`);
} catch (error) {
  // 只有「新产物是唯一可用副本」时才保留临时文件，其余失败路径清理干净。
  if (!keepTemp) await rm(tempfile, { force: true }).catch(() => {});
  console.error("构建失败：", error?.message || error);
  console.error(`安装或打包前请确认入口文件存在：${outfile}`);
  process.exit(1);
}
