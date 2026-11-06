// 构建入口：双产物单文件打包。
// - src/panel/main.js      -> index.js       （渲染层 ESM，React 由宿主注入，不打进包）
// - src/background/main.js -> background.mjs （Electron 主进程 ESM，Node 全权限）
// openhongguo 的 wasm 无法内联，按官方包内部约定复制到 <插件目录>/dist/。
import { build } from "esbuild";
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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

const panelEntry = join(root, "src", "panel", "main.js");
const panelOut = join(root, manifest.entry || "index.js");
const backgroundOut = join(root, "background.mjs");
const backgroundEntry = join(root, "src", "background", "main.js");

const SDK_DIST = join(root, "node_modules", "openhongguo", "dist");
const WASM_ASSET = join(SDK_DIST, "openhongguo.wasm");
const WASM_EXEC_ASSET = join(SDK_DIST, "wasm_exec.js");
const OUT_DIST = join(root, "dist");

const PANEL_BANNER = "// 构建产物：由 build.mjs 从 src/panel 打包生成，请勿直接编辑。";
const BACKGROUND_BANNER = "// 构建产物：由 build.mjs 从 src/background 打包生成，请勿直接编辑。";

const requireReadable = async (path, hint) => {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    console.error(`构建失败：${path} 不可读${hint ? `（${hint}）` : ""}`);
    process.exit(1);
  }
};

await requireReadable(panelEntry);
await requireReadable(backgroundEntry);
// 官方包按 join(here,'dist','openhongguo.wasm') 与 require(join(here,'dist','wasm_exec.js')) 加载，
// 少一个文件后台会在首次调用 SDK 时才失败，所以构建期就检查。
await requireReadable(WASM_ASSET, "先在插件目录执行 npm install");
await requireReadable(WASM_EXEC_ASSET, "先在插件目录执行 npm install");

/** 产物先写临时文件，校验通过后再替换目标，避免失败路径留下半截入口。 */
const buildOne = async ({ entry, outfile, platform, target, banner, extra = {} }) => {
  const tempfile = `${outfile}.tmp`;
  await rm(tempfile, { force: true });
  try {
    await build({
      absWorkingDir: root,
      entryPoints: [entry],
      outfile: tempfile,
      bundle: true,
      format: "esm",
      platform,
      target,
      splitting: false,
      sourcemap: false,
      minify: false,
      // 宿主按 UTF-8 读取入口文本：保留中文字面量，避免产物全被转义成 \uXXXX。
      charset: "utf8",
      legalComments: "none",
      banner: { js: banner },
      logLevel: "info",
      ...extra,
    });
    const built = await readFile(tempfile, "utf8");
    // 宿主按 ES 模块加载，bundle 后不应残留任何相对 import（否则无法解析）。
    if (/(^|\n)\s*import\s[^;\n]*from\s+["']\.{1,2}\//.test(built)) {
      throw new Error(`产物仍包含未打包的相对 import：${outfile}`);
    }
    return built;
  } finally {
    await rm(tempfile, { force: true }).catch(() => {});
  }
};

try {
  const panelBuilt = await buildOne({
    entry: panelEntry,
    outfile: panelOut,
    platform: "browser",
    target: "es2020",
    banner: PANEL_BANNER,
    // React 由宿主 window.SnowAppPlugin 注入；即使源码误写 import React 也不能把副本打进包。
    extra: { external: ["react", "react-dom"] },
  });
  const hasDefaultExport =
    /export\s+default\b/.test(panelBuilt) || /export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(panelBuilt);
  if (!hasDefaultExport) {
    throw new Error("面板产物缺少默认导出（宿主需要 export default function Panel）");
  }

  const backgroundBuilt = await buildOne({
    entry: backgroundEntry,
    outfile: backgroundOut,
    platform: "node",
    target: "node22",
    banner: BACKGROUND_BANNER,
    extra: { external: ["electron"] },
  });
  const hasStartExport =
    /export\s+function\s+start\b/.test(backgroundBuilt) ||
    /export\s*\{[^}]*\bstart\b[^}]*\}/.test(backgroundBuilt) ||
    /export\s+default\s*\{[^}]*\bstart\b/.test(backgroundBuilt);
  if (!hasStartExport) {
    throw new Error("后台产物缺少 start 导出（宿主需要 export async function start(ctx)）");
  }

  // 真正落盘：写临时文件再 rename，保持「旧入口可用直到新入口就绪」。
  await writeFile(`${panelOut}.next`, panelBuilt, "utf8");
  await rename(`${panelOut}.next`, panelOut);
  await writeFile(`${backgroundOut}.next`, backgroundBuilt, "utf8");
  await rename(`${backgroundOut}.next`, backgroundOut);

  // wasm 资产：官方包内部按 dist/ 目录查找，位置不能改。
  await mkdir(OUT_DIST, { recursive: true });
  await copyFile(WASM_ASSET, join(OUT_DIST, "openhongguo.wasm"));
  await copyFile(WASM_EXEC_ASSET, join(OUT_DIST, "wasm_exec.js"));
  // dist/package.json 把该目录标记为 CommonJS：插件根 package.json 是 "type":"module"，
  // 若不加这个嵌套清单，Node 会把 wasm_exec.js 当 ESM 解析，createRequire 的 require() 将失败。
  await writeFile(join(OUT_DIST, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`, "utf8");

  const wasmSize = (await stat(join(OUT_DIST, "openhongguo.wasm"))).size;
  const wasmExecSize = (await stat(join(OUT_DIST, "wasm_exec.js"))).size;
  if (wasmSize < 6 * 1024 * 1024) {
    console.warn(`警告：openhongguo.wasm 只有 ${wasmSize} 字节，预期约 6-7 MB`);
  }

  console.log(`构建完成：${panelOut}`);
  console.log(`构建完成：${backgroundOut}`);
  console.log(`资源已复制：dist/openhongguo.wasm (${wasmSize} 字节)、dist/wasm_exec.js (${wasmExecSize} 字节)`);
} catch (error) {
  console.error("构建失败：", error?.message || error);
  console.error("安装或打包前请确认入口文件存在：index.js / background.mjs");
  process.exit(1);
}
