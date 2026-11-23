// 构建入口：
// - src/panel/main.jsx      -> index.js       （渲染层 ESM，React 由宿主注入，不打进包）
// - src/background/main.js  -> background.mjs （Electron 主进程 ESM，Node 全权限）
import { build } from "esbuild";
import { access, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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

const panelEntry = join(root, "src", "panel", "main.jsx");
const panelOut = join(root, manifest.entry || "index.js");
const backgroundEntry = join(root, "src", "background", "main.js");
const backgroundOut = join(root, "background.mjs");

const PANEL_BANNER = "// 构建产物：由 build.mjs 从 src/panel 打包生成，请勿直接编辑。";
// 后台产物需要 CJS 上下文：某些依赖会读取 __dirname / require。
const BACKGROUND_BANNER = [
  "// 构建产物：由 build.mjs 从 src/background 打包生成，请勿直接编辑。",
  'import { createRequire as __snowCreateRequire } from "node:module";',
  'import { fileURLToPath as __snowFileURLToPath } from "node:url";',
  'import { dirname as __snowDirname } from "node:path";',
  "const __filename = __snowFileURLToPath(import.meta.url);",
  "const __dirname = __snowDirname(__filename);",
  // 只在本次 bundle 的模块作用域补 require：改全局对象会污染宿主主进程与其它插件。
  "const require = __snowCreateRequire(import.meta.url);",
].join("\n");

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

/**
 * 护栏：JSX 片段（<>...</>）会被编译成裸 Fragment 调用。
 * 文件里必须自己从 ./react.js 导入 Fragment，否则构建能过、运行时才报
 * "Fragment is not defined"（宿主整个面板白屏）。
 */
const assertFragmentsImported = async () => {
  // Fragment 必须是真组件：写成 Symbol 时 React 会抛 error #130（Element type is invalid）。
  const reactSource = await readFile(join(root, "src", "panel", "react.js"), "utf8");
  if (/Fragment\s*=\s*Symbol\.for\(/.test(reactSource)) {
    throw new Error("react.js 的 Fragment 不能是 Symbol：React 只接受组件或标签，Symbol 会抛 error #130");
  }

  const dir = join(root, "src", "panel");
  const names = (await readdir(dir)).filter((name) => name.endsWith(".jsx"));
  for (const name of names) {
    const text = await readFile(join(dir, name), "utf8");
    if (!/<>|<\/>/.test(text)) continue;
    const imported = /import\s*\{[^}]*\bFragment\b[^}]*\}\s*from\s*["']\.\/react\.js["']/.test(text);
    if (!imported) {
      throw new Error(
        `${name} 使用了 JSX 片段但没有从 ./react.js 导入 Fragment（运行时会报 Fragment is not defined）`
      );
    }
  }
};

await assertFragmentsImported();

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
    // React 由宿主注入，不能打进插件包，否则会出现第二份 React。
    // JSX 统一编译成 h(...)，h 来自 src/panel/react.js 里绑定的宿主 React 实例。
    extra: {
      external: ["react", "react-dom"],
      jsx: "transform",
      jsxFactory: "h",
      jsxFragment: "Fragment",
    },
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
    // electron 由宿主提供。
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

  console.log(`构建完成：${panelOut}（${panelBuilt.length} 字节）`);
  console.log(`构建完成：${backgroundOut}（${backgroundBuilt.length} 字节）`);
} catch (error) {
  console.error("构建失败：", error?.message || error);
  console.error("安装或打包前请确认入口文件存在：index.js / background.mjs");
  process.exit(1);
}
