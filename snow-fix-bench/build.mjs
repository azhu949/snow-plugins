// 构建入口：把工程化源码打包成单文件客户端脚本（Tampermonkey 兼容元数据头）。
// 脚本插件不是 ES 模块：产物必须是 IIFE，元数据头写在文件最前面。
// 所有路径都以本文件所在目录为基准，避免从仓库根执行时误删其它 dist 目录。
import { build } from "esbuild";
import { access, copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
// 版本号以 package.json 为单一来源，避免元数据头与包版本漂移。
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (!pkg.version) {
  console.error("构建失败：package.json 缺少 version 字段");
  process.exit(1);
}

const outdir = join(root, "dist");
const outfile = join(outdir, "snow-fix-bench.user.js");
const tempfile = `${outfile}.tmp`;
const entry = join(root, "src", "script", "main.js");

// 先校验入口：入口不存在时直接退出，旧产物与 dist 目录保持原样。
try {
  await access(entry, fsConstants.R_OK);
} catch {
  console.error(`构建失败：入口文件缺失或不可读 ${entry}`);
  process.exit(1);
}

const banner = `// ==UserScript==
// @name         修复工作台
// @name:en      Fix Bench
// @namespace    com.snow.fix-bench
// @version      ${pkg.version}
// @description  在一个浮层工作台内完成代码审查、issue 跟踪与批量修复
// @description:en Review, track, and batch-fix project issues in a floating workbench
// @author       Snow App
// @snow-target  client
// @snow-view    *
// @snow-scope   global
// @snow-privacy conversations, messages, git, mcpSecrets
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_log
// ==/UserScript==
// ---------------------------------------------------------------------------
// Bundled third-party software
// Preact 10.29.8 - MIT License
// Copyright (c) 2015-present Jason Miller
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// ---------------------------------------------------------------------------`;

await mkdir(outdir, { recursive: true });
// 只清理本次构建的临时文件，不删除 dist 目录内的其它产物。
await rm(tempfile, { force: true });

try {
  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: tempfile,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    splitting: false,
    sourcemap: false,
    minify: false,
    legalComments: "eof",
    loader: { ".css": "text" },
    banner: { js: banner },
    logLevel: "info",
  });
  // 分发物必须自带第三方许可声明：构建后校验，缺失时保留旧产物并失败。
  const built = await readFile(tempfile, "utf8");
  if (
    !built.startsWith("// ==UserScript==") ||
    !built.includes("Copyright (c) 2015-present Jason Miller") ||
    !built.includes("Permission is hereby granted")
  ) {
    throw new Error("构建产物缺少 UserScript 元数据或第三方许可声明");
  }
  // 构建成功后才替换旧产物：Windows 上 rename 可覆盖已存在文件，
  // 目标被编辑器或杀毒软件短暂占用时退回复制。
  try {
    await rename(tempfile, outfile);
  } catch (error) {
    if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code)) throw error;
    await copyFile(tempfile, outfile);
    await rm(tempfile, { force: true });
  }
  console.log(`构建完成：${outfile}`);
} catch (error) {
  // 构建失败时保留旧产物，只清理临时文件。
  await rm(tempfile, { force: true }).catch(() => {});
  console.error("构建失败：", error?.message || error);
  process.exit(1);
}
