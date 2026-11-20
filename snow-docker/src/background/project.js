// 项目侧扫描：只读地找 Dockerfile 与 compose 文件，供面板的项目视图使用。
// 目录遍历有深度与条目上限，避免在大仓库里把主进程拖死。
// 除了自动扫描，还支持「手动登记」的 Dockerfile 路径（扫描规则覆盖不到的目录），
// 这些路径由面板保存进运行配置，扫描时一并回传。

import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

/**
 * Dockerfile / Dockerfile.dev / Dockerfile-amd64 / Dockerfile_jdk8 / app.dockerfile / Containerfile 都算；
 * compose.yml / docker-compose.yml / compose.override.yaml 也算。
 */
const DOCKERFILE_RE = /^(dockerfile([-_.][\w.-]+)?|[\w.-]+\.dockerfile|containerfile)$/i;
const COMPOSE_RE = /^((docker-)?compose(\.[\w-]+)?\.ya?ml)$/i;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".gradle",
  ".mvn",
  ".next",
  ".nuxt",
  "coverage",
  ".tox",
  ".cache",
  "bin",
  "obj",
]);

/** 多模块项目里 Dockerfile 经常在 5 层以上，这里放宽到 8 层。 */
const MAX_DEPTH = 8;
const MAX_ENTRIES = 20000;

const toPosix = (path) => path.split(sep).join("/");

const baseName = (path) => {
  const text = String(path || "");
  const index = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  return index >= 0 ? text.slice(index + 1) : text;
};

const toEntry = (root, absolutePath, name) => {
  const rel = toPosix(relative(root, absolutePath));
  return {
    path: toPosix(absolutePath),
    relative: rel,
    name,
    depth: rel.split("/").length - 1,
  };
};

const byDepthThenName = (a, b) => {
  if (a.depth !== b.depth) return a.depth - b.depth;
  return a.relative.localeCompare(b.relative);
};

/** 面板手工填的路径是否为 Dockerfile 命名，供路由层与扫描共用。 */
export const isDockerfilePath = (path) => DOCKERFILE_RE.test(baseName(path));

const PACKAGE_JSON_NAME = /^package\.json$/i;
const MAX_SCRIPTS = 200;

/**
 * 读 package.json 里的 scripts 名，给「构建前执行」的脚本候选下拉用。
 * path 为空时按 dir/package.json 找；文件不存在返回 exists:false，不抛错。
 */
export async function readPackageScripts({ path = "", dir = "" } = {}) {
  const target = String(path || "").trim();
  const base = String(dir || "").trim();
  const file = target || (base ? join(base, "package.json") : "");
  if (!file) throw new Error("请填写 package.json 的绝对路径或工作目录");
  if (!isAbsolute(file)) throw new Error("package.json 路径必须是绝对路径");
  if (!PACKAGE_JSON_NAME.test(baseName(file))) throw new Error("只支持读取 package.json");

  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { path: toPosix(file), exists: false, name: "", scripts: [] };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("package.json 不是合法的 JSON");
  }

  const table = parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
  const scripts = Object.keys(table)
    .filter((key) => key && key.length <= 128)
    .slice(0, MAX_SCRIPTS);
  return {
    path: toPosix(file),
    exists: true,
    name: typeof parsed?.name === "string" ? parsed.name.slice(0, 128) : "",
    scripts,
  };
}

/**
 * 合并手动登记的路径：位于 root 下、命名合规即列出；
 * 磁盘上已经不存在的也保留（标记 missing），面板才能把这条配置删掉。
 */
const collectExtra = async (root, extraPaths, dockerfiles, known) => {
  for (const candidate of extraPaths) {
    const text = typeof candidate === "string" ? candidate.trim() : "";
    if (!text || !isAbsolute(text)) continue;
    const normalized = toPosix(text);
    if (known.has(normalized)) continue;
    const name = baseName(normalized);
    if (!DOCKERFILE_RE.test(name)) continue;

    // 只收当前项目范围内的路径，避免把别的项目配置塞进来。
    const rel = relative(root, text);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;

    let exists = false;
    try {
      exists = (await stat(text)).isFile();
    } catch {
      exists = false;
    }

    const entry = toEntry(root, text, name);
    entry.manual = true;
    if (!exists) entry.missing = true;
    dockerfiles.push(entry);
    known.add(entry.path);
  }
};

export async function scanProject(root, { extraPaths = [] } = {}) {
  if (typeof root !== "string" || !root.trim()) throw new Error("缺少项目路径");
  const base = root.trim();
  if (!isAbsolute(base)) throw new Error("项目路径必须是绝对路径");

  const dockerfiles = [];
  const composeFiles = [];
  const known = new Set();
  let visited = 0;
  let truncated = false;

  const walk = async (dir, depth) => {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // 无权限或目录已删除：跳过该分支，不影响其它结果。
      return;
    }

    for (const entry of entries) {
      if (truncated) return;
      visited += 1;
      if (visited > MAX_ENTRIES) {
        truncated = true;
        return;
      }

      const name = entry.name;
      const absolutePath = join(dir, name);

      if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH) continue;
        // 隐藏目录照常遍历（.devcontainer、.docker 里常放 Dockerfile），
        // 版本库与构建产物目录按名字排除。
        if (SKIP_DIRS.has(name.toLowerCase())) continue;
        await walk(absolutePath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      if (DOCKERFILE_RE.test(name)) {
        const item = toEntry(base, absolutePath, name);
        dockerfiles.push(item);
        known.add(item.path);
      } else if (COMPOSE_RE.test(name)) {
        composeFiles.push(toEntry(base, absolutePath, name));
      }
    }
  };

  await walk(base, 0);
  await collectExtra(base, extraPaths, dockerfiles, known);

  dockerfiles.sort(byDepthThenName);
  composeFiles.sort(byDepthThenName);

  return {
    root: toPosix(base),
    scannedAt: Date.now(),
    truncated,
    dockerfiles,
    composeFiles,
  };
}
