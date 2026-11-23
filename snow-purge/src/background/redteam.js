// 红队技能包：把上游 dsh-purge 的 skills/redteam/*.md 安装成 Snow App 技能。
// 只落盘 SKILL.md 文本：不下载任何工具、不安装任何二进制、也不代执行任何命令。
// 环境自检同样只读：查环境变量、查路径存在性，不运行外部程序。
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { PurgeError } from "./errors.js";
import { writeJsonAtomic } from "./index-file.js";

/** Snow App 技能目录名前缀：既标明归属，也避免和用户已装技能撞名。 */
export const REDTEAM_PREFIX = "snow-redteam-";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;

/** 只查存在性的工具名：不在 PATH 或工具箱里时只标缺失，绝不尝试安装。 */
const TOOL_CANDIDATES = [
  "fscan",
  "gogo",
  "nmap",
  "masscan",
  "nuclei",
  "ffuf",
  "httpx",
  "subfinder",
  "dnsx",
  "chisel",
  "frpc",
  "suo5",
];

const sha1 = (text) => createHash("sha1").update(String(text), "utf8").digest("hex").slice(0, 12);

/** frontmatter 边界：宿主按「首行 --- 且存在闭合 ---」判定技能是否可收录。 */
const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** 同目录唯一临时名：并发安装同一技能时不共用临时文件。 */
const tempPathOf = (filePath) =>
  `${filePath}.${process.pid}.${Date.now().toString(36)}.${randomBytes(4).toString("hex")}.snow-purge.tmp`;

/**
 * 原子写：先写同目录临时文件再 rename，中途失败不会留下半截 SKILL.md。
 * 临时文件与目标同目录（同一卷）rename 才是原子替换，跨目录会退化成复制。
 */
const writeFileAtomic = async (filePath, text) => {
  await mkdir(dirname(filePath), { recursive: true });
  const temp = tempPathOf(filePath);
  try {
    await writeFile(temp, text, "utf8");
    await rename(temp, filePath);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw new PurgeError("WRITE_FAILED", `写入 ${filePath} 失败：${error?.message || error}`);
  }
};

/** 读目标 SKILL.md 现有的 enable 值：文件不存在或没有该行时返回 null（宿主缺省视为启用）。 */
const readEnableFlag = async (filePath) => {
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const match = /^enable:\s*(true|false)\s*$/m.exec(raw);
  if (!match) return null;
  return match[1] === "true";
};

const assertName = (name) => {
  const value = typeof name === "string" ? name.trim() : "";
  if (!NAME_PATTERN.test(value)) throw new PurgeError("INVALID_PARAM", "技能标识不合法");
  return value;
};

/** 拆 frontmatter 与正文：只认简单的 key: value 行，够用且不会把正文里的冒号当字段。 */
const parseFrontmatter = (text) => {
  const source = String(text ?? "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { data: {}, body: source };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    let value = field[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[field[1]] = value;
  }
  return { data, body: source.slice(match[0].length) };
};

/** YAML 单值：含冒号、井号、引号或括号时加双引号，避免被解析成映射或注释。 */
const yamlScalar = (value) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return '""';
  if (/[:#"'{}\[\],]/.test(text) || text.startsWith("-")) {
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return text;
};

/**
 * 安装前言：上游文档按 dsh 环境编写，这里把路径与工具映射到 Snow App 的真实环境。
 * 放在 frontmatter 之后、正文之前；首行不能是 ---（宿主会把正文开头的 --- 当嵌套 frontmatter 剥掉）。
 */
const buildEnvPreamble = (snowHome) =>
  [
    "## 环境映射（Snow App）",
    "",
    "本节优先于下文：两者冲突时以本节为准。",
    "",
    "1. 本技能运行在 Snow App（Windows，PowerShell/CMD）上；下文的 bash 片段仅作参考，不要直接粘贴执行。",
    "2. 不存在 `$DSH_HOME`。等价路径是本机 `" + snowHome + "`；工具箱在其下的 `redteam\\toolkit\\<工具>\\`。",
    "3. 凭据文件是 `" + join(snowHome, ".env") + "`（不在 redteam 目录下）。没有 `source`：用 `Get-Content` 读取，或先设为环境变量。",
    "4. 不存在 `redteam_preflight`、`redteam_chain_add` 等 dsh 工具族：环境自检看插件面板的红队页；关键动作与回显摘要写进靶标目录 `runs\\` 下的记录文件。",
    "5. 不存在 `dsh web`：改完 `.env` 需要用户重启 Snow App 才生效，不要代为重启。",
    "6. 不存在 `run_in_background`：长任务用终端工具的后台执行（detach），或用 `Start-Process`。",
    "7. heredoc（`cat > 文件 <<'PY'`）在 PowerShell 下不可用：先把脚本内容写成文件，再执行 `python 脚本.py`。",
    "8. 路径分隔符用 `\\`；示例里以 `/` 开头的路径请按第 2 条换算。",
    "9. 不存在资产库，也没有 `redteam_asset_*`、`redteam_credential_add`、`redteam_access_add`、`redteam_tunnel_add`、`redteam_webshell_add`、`redteam_attack_file_add`、`redteam_vuln_*`、`redteam_score_hit`、`redteam_session_check` 等入库工具，更没有 fingerprint、asset、credential、access、tunnel、webshell、edge 这些表。下文凡出现「落库」「落库要求」「落库（强制）」「结果落库（必须做）」「写入 fingerprint 表」「写入 edge 表」「写进本机资产库」的小节，一律按本条执行：不调用任何 `redteam_*` 工具、不建库建表，也不要说「已落库」。做法是把本来要落库的同一批字段（provenance、tool、source、target、host、port、service、banner、title、product、version、evidence、privilege、session_ref、secret_ref、command 与回显摘要）逐条写进靶标目录下 `runs` 子目录的 Markdown：资产 `assets-<靶标>.md`、指纹 `fingerprint-<靶标>.md`、凭据 `creds-<靶标>.md`、访问会话 `access-<靶标>.md`、隧道 `tunnels-<靶标>.md`、WebShell `webshells-<靶标>.md`、漏洞与证据 `vulns-<靶标>.md`；每条一行、字段写成 `键=值`，已有文件就追加不覆盖，写完在结论里给出文件路径与条目数。",
    "",
  ].join("\n");

/**
 * 生成目标 SKILL.md：保留上游的 name / description / whenToUse / role，
 * 把上游的 enabled 统一写成宿主识别的 enable，正文原样保留（前面加环境映射前言）。
 * enabled 由调用方传入：覆盖安装时要沿用用户当前的启停状态，不能固定写回启用。
 */
const composeSkill = ({ name, raw, preamble = "", enabled = true }) => {
  const { data, body } = parseFrontmatter(raw);
  const lines = ["---", `name: ${yamlScalar(name)}`, `description: ${yamlScalar(data.description || "")}`];
  if (data.whenToUse) lines.push(`whenToUse: ${yamlScalar(data.whenToUse)}`);
  if (data.role) lines.push(`role: ${yamlScalar(data.role)}`);
  lines.push(`enable: ${enabled === false ? "false" : "true"}`, "---", "");
  const text = `${lines.join("\n")}\n${preamble}${body.replace(/^\s+/, "")}`;
  return text.endsWith("\n") ? text : `${text}\n`;
};

/**
 * 按宿主的判定口径自检生成的 SKILL.md：frontmatter 边界完整、每行都是 key: value、
 * name 与标识一致、description 非空且不是块标量、enable 开关存在。
 * 校验失败直接抛错：宁可不写，也不让宿主静默跳过或注册出无说明的技能。
 */
const assertSkillDocument = (text, expectedName) => {
  const source = String(text ?? "");
  const block = FRONTMATTER_BLOCK.exec(source);
  if (!block) {
    throw new PurgeError("SKILL_INVALID", `生成的 SKILL.md 缺少完整 frontmatter（${expectedName}）`);
  }
  const broken = block[1]
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !/^[A-Za-z_][\w-]*: /.test(line));
  if (broken.length > 0) {
    throw new PurgeError(
      "SKILL_INVALID",
      `生成的 frontmatter 含无法解析的行（${expectedName}）：${broken[0]}`
    );
  }
  const { data } = parseFrontmatter(source);
  if (data.name !== expectedName) {
    throw new PurgeError(
      "SKILL_INVALID",
      `frontmatter name 与标识不一致（${expectedName} → ${data.name || "空"}）`
    );
  }
  const description = String(data.description ?? "").trim();
  if (!description || /^[|>]/.test(description)) {
    throw new PurgeError(
      "SKILL_INVALID",
      `技能库 ${expectedName}.md 的 description 为空或为块标量，宿主会注册出无说明的技能`
    );
  }
  if (!/^enable:\s*(true|false)\s*$/m.test(source)) {
    throw new PurgeError("SKILL_INVALID", `生成的 SKILL.md 缺少 enable 开关（${expectedName}）`);
  }
  return source;
};

const readInstalled = async (skillsDir) => {
  const map = new Map();
  let dirs = [];
  try {
    dirs = (await readdir(skillsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(REDTEAM_PREFIX))
      .map((entry) => entry.name);
  } catch {
    return map;
  }
  for (const dir of dirs) {
    const name = dir.slice(REDTEAM_PREFIX.length);
    const file = join(skillsDir, dir, "SKILL.md");
    try {
      const raw = await readFile(file, "utf8");
      const { data } = parseFrontmatter(raw);
      // 与宿主同口径：frontmatter 不可解析时宿主跳过该技能；缺 enable 行时宿主按启用处理。
      const parseable = FRONTMATTER_BLOCK.test(raw);
      map.set(name, {
        installed: true,
        enabled: data.enable !== "false",
        broken: !parseable || !String(data.description || "").trim(),
        path: file,
        hash: sha1(raw),
      });
    } catch {
      map.set(name, { installed: true, enabled: false, broken: true, path: file, hash: "" });
    }
  }
  return map;
};

/** 环境自检实际使用的三个键：.env 里的其它内容不进入内存。 */
const DOTENV_KEYS = new Set(["FOFA_KEY", "REDTEAM_VPS_HOST", "REDTEAM_VPS_KEY"]);

/** 解析 $SNOW_HOME/.env：上游把 FOFA_KEY 与 VPS 信息都写在这里。 */
const readDotEnv = async (filePath) => {
  const result = {};
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return result;
  }
  for (const line of text.split(/\r?\n/)) {
    // 上游把 .env 当 shell 文件 source，允许 `export KEY=value` 写法；空行与注释行由下面的 match 过滤。
    const match = /^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    // 只取三个必需键：同文件里的其它 token/密码不解析、不驻留内存。
    if (!DOTENV_KEYS.has(match[1])) continue;
    let value = match[2].trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      // 引号内的 # 属于值本身：只取到配对引号为止，其后的内容按行尾注释丢弃。
      const end = value.indexOf(quote, 1);
      value = end > 0 ? value.slice(1, end) : value;
    } else {
      // 未加引号：只有位于行首或空白之后的 # 才算注释，避免截断值里的 #。
      const comment = /(^|\s)#/.exec(value);
      if (comment) value = value.slice(0, comment.index).trim();
    }
    result[match[1]] = value;
  }
  return result;
};

const findOnPath = (fileName, pathValue, platform = process.platform) => {
  const exts = platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of String(pathValue || "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, fileName + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "";
};

/** 工具箱是 <snowHome>/redteam/toolkit/<工具>/<可执行文件>，只列一层目录，不递归。 */
const scanToolkit = async (toolkitDir) => {
  const files = [];
  let entries = [];
  try {
    entries = await readdir(toolkitDir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(toolkitDir, entry.name);
    const inner = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const file of inner) if (file.isFile()) files.push(join(dir, file.name));
  }
  return files;
};

const matchesTool = (path, tool) => {
  const base = path.split(/[\\/]/).pop() || "";
  const name = base.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
  return name === tool || name.startsWith(`${tool}-`);
};

const buildEnvReport = async ({ snowHome }) => {
  const dotenv = await readDotEnv(join(snowHome, ".env"));
  const lookup = (key) => String(process.env[key] || dotenv[key] || "").trim();
  const redteamDir = join(snowHome, "redteam");
  const toolkitDir = join(redteamDir, "toolkit");
  /**
   * 面板要的是「路径是否存在」，不是本机完整路径：把主目录前缀缩成 ~，层级保持原样，
   * 避免响应、界面与截图带出用户名。
   */
  const homeRoot = dirname(snowHome);
  const shortPath = (value) => {
    const text = String(value || "");
    if (!text) return "";
    return text.toLowerCase().startsWith(homeRoot.toLowerCase()) ? `~${text.slice(homeRoot.length)}` : text;
  };

  const fofa = lookup("FOFA_KEY");
  const vpsHost = lookup("REDTEAM_VPS_HOST");
  const vpsKeyRaw = lookup("REDTEAM_VPS_KEY");
  const defaultKey = join(toolkitDir, "vps", "id_rsa");
  /**
   * REDTEAM_VPS_KEY 的语义是私钥路径。路径必须被证成：只有绝对路径、无控制字符、
   * 不含 PEM 头与整段 base64 特征、且本机确实存在时，才允许把值回显成路径。
   * 其余情况（单行 base64 私钥、口令、token）只回长度，避免面板与截图带出内容。
   */
  const vpsKeyConfigured = Boolean(vpsKeyRaw);
  const vpsKeyIsPath =
    vpsKeyConfigured &&
    vpsKeyRaw.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(vpsKeyRaw) &&
    !/-----BEGIN/.test(vpsKeyRaw) &&
    !/^[A-Za-z0-9+/=]{32,}$/.test(vpsKeyRaw) &&
    isAbsolute(vpsKeyRaw) &&
    existsSync(vpsKeyRaw);
  const vpsKeyDetail = vpsKeyIsPath
    ? shortPath(vpsKeyRaw)
    : vpsKeyConfigured
      ? `*** (${vpsKeyRaw.length})`
      : shortPath(defaultKey);

  const items = [];
  items.push({
    id: "fofa",
    status: fofa ? "ok" : "warn",
    // 只给「已配置 + 长度」：连前缀都不回显，避免面板与截图带出密钥片段。
    detail: fofa ? `*** (${fofa.length})` : shortPath(join(snowHome, ".env")),
  });
  items.push({
    id: "vpsHost",
    status: vpsHost && vpsHost !== "user@host" ? "ok" : "warn",
    // 主机地址同样按秘密处理：只回显长度，避免面板与截图带出 IP 或用户名。
    detail: vpsHost && vpsHost !== "user@host" ? `*** (${vpsHost.length})` : "REDTEAM_VPS_HOST",
  });
  items.push({
    id: "vpsKey",
    status: vpsKeyIsPath || (!vpsKeyConfigured && existsSync(defaultKey)) ? "ok" : "warn",
    detail: vpsKeyDetail,
  });
  items.push({
    id: "toolkit",
    status: existsSync(toolkitDir) ? "ok" : "off",
    detail: shortPath(toolkitDir),
  });
  items.push({
    id: "setupMarker",
    status: existsSync(join(redteamDir, ".setup-complete")) ? "ok" : "off",
    detail: shortPath(join(redteamDir, ".setup-complete")),
  });

  const toolkitFiles = await scanToolkit(toolkitDir);
  const pathValue = process.env.PATH || "";
  const tools = TOOL_CANDIDATES.map((tool) => {
    const onPath = findOnPath(tool, pathValue);
    if (onPath) return { name: tool, found: true, via: "path", path: onPath };
    const inToolkit = toolkitFiles.find((file) => matchesTool(file, tool)) || "";
    if (inToolkit) return { name: tool, found: true, via: "toolkit", path: inToolkit };
    return { name: tool, found: false, via: "", path: "" };
  });
  const found = tools.filter((tool) => tool.found).length;
  items.push({ id: "tools", status: found > 0 ? "ok" : "off", detail: `${found}/${tools.length}` });

  const counts = { ok: 0, warn: 0, off: 0 };
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
  // 面板不使用该字段；保留缩略路径便于排查，同时避免响应里带出完整用户名目录。
  return { items, tools, counts, dotenvPath: shortPath(join(snowHome, ".env")), toolkitDir };
};

/**
 * 技能库与安装状态都从磁盘现读，不做缓存：用户在外部改了 SKILL.md 也能立刻看到。
 * 环境探测要逐目录扫 PATH，代价高得多，因此单独按 ENV_TTL_MS 缓存，用户点「刷新」时失效。
 */
export function createRedteamManager({
  libraryDir,
  skillsDir,
  removedDir,
  indexFile,
  snowHome,
  log = () => {},
}) {
  /** 安装时追加的前言：上游文档按 dsh 环境写，这里映射到本机 Snow App 的路径与工具。 */
  const envPreamble = buildEnvPreamble(snowHome);

  /**
   * 环境探测要按 PATH 逐个目录同步 existsSync，代价远高于其它读取：
   * 结果按 TTL 复用，用户点「刷新」时强制重算，后台重启后自然清空。
   */
  const ENV_TTL_MS = 60 * 1000;
  let envCache = null;
  let envCachedAt = 0;
  let envInFlight = null;

  const getEnvReport = async ({ force = false } = {}) => {
    if (!force && envCache && Date.now() - envCachedAt < ENV_TTL_MS) return envCache;
    if (envInFlight) return envInFlight;
    envInFlight = buildEnvReport({ snowHome })
      .then((value) => {
        envCache = value;
        envCachedAt = Date.now();
        return value;
      })
      .finally(() => {
        envInFlight = null;
      });
    return envInFlight;
  };

  const readIndex = async () => {
    try {
      const parsed = JSON.parse(await readFile(indexFile, "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };

  /**
   * 写技能索引：成功返回空串，失败返回可展示原因。
   * SKILL.md 已经落盘时不能再抛错，否则调用方会把「已安装」记成失败并诱发重复安装。
   */
  const writeIndex = async (index) => {
    try {
      await writeJsonAtomic(indexFile, index, "技能索引");
      return "";
    } catch (error) {
      const message = String(error?.message || error);
      log(message);
      return message;
    }
  };

  const readLibrary = async () => {
    let names = [];
    try {
      names = (await readdir(libraryDir))
        .filter((name) => name.toLowerCase().endsWith(".md"))
        .map((name) => name.slice(0, -3));
    } catch {
      return [];
    }
    const items = [];
    for (const name of names.sort()) {
      try {
        const raw = await readFile(join(libraryDir, `${name}.md`), "utf8");
        const { data, body } = parseFrontmatter(raw);
        items.push({
          name,
          description: data.description || "",
          whenToUse: data.whenToUse || "",
          role: data.role || "",
          chars: body.trim().length,
          hash: sha1(raw),
        });
      } catch (error) {
        log(`读取技能失败 ${name}: ${error?.message || error}`);
      }
    }
    return items;
  };

  const install = async (name) => {
    const value = assertName(name);
    let raw = "";
    try {
      raw = await readFile(join(libraryDir, `${value}.md`), "utf8");
    } catch {
      throw new PurgeError("NOT_FOUND", `技能库里没有 ${value}`);
    }
    const targetDir = join(skillsDir, REDTEAM_PREFIX + value);
    const targetFile = join(targetDir, "SKILL.md");
    await mkdir(targetDir, { recursive: true });
    const action = existsSync(targetFile) ? "updated" : "installed";
    // 覆盖安装沿用用户当前的启停状态：宿主以 SKILL.md 的 enable 为唯一真源，写死 true 会撤销停用。
    const previous = action === "updated" ? await readEnableFlag(targetFile) : null;
    const enabled = previous === null ? true : previous;
    const text = assertSkillDocument(
      composeSkill({ name: value, raw, preamble: envPreamble, enabled }),
      value
    );
    await writeFileAtomic(targetFile, text);
    const written = await readFile(targetFile, "utf8").catch((error) => {
      throw new PurgeError("WRITE_FAILED", `${targetFile} 写入后无法回读：${error?.message || error}`);
    });
    if (written !== text) {
      throw new PurgeError("WRITE_FAILED", `${targetFile} 写入后内容不一致，请重试`);
    }
    const index = await readIndex();
    index[value] = { sourceHash: sha1(raw), installedAt: new Date().toISOString() };
    const indexError = await writeIndex(index);
    return {
      name: value,
      action,
      path: targetFile,
      enabled,
      enablePreserved: action === "updated" && !enabled,
      // 技能已写入、索引没记上：面板据此提示「安装时间与可更新判断可能不准」。
      indexError,
    };
  };

  const installAll = async () => {
    const library = await readLibrary();
    const results = [];
    for (const item of library) {
      try {
        results.push(await install(item.name));
      } catch (error) {
        results.push({ name: item.name, action: "failed", message: String(error?.message || error) });
      }
    }
    return results;
  };

  const setEnabled = async (name, enabled) => {
    const value = assertName(name);
    const file = join(skillsDir, REDTEAM_PREFIX + value, "SKILL.md");
    let raw = "";
    try {
      raw = await readFile(file, "utf8");
    } catch {
      throw new PurgeError("NOT_FOUND", `${value} 尚未安装`);
    }
    const flag = enabled === true ? "true" : "false";
    // 没有完整 frontmatter 时无法定位启停开关：原样写回会谎报成功，这里直接报错并引导重装。
    if (!FRONTMATTER_BLOCK.test(raw)) {
      throw new PurgeError(
        "SKILL_INVALID",
        `${value} 的 SKILL.md 缺少完整 frontmatter（文件可能被截断或以正文开头），无法切换启停；请重新安装该技能`
      );
    }
    const next = /^enable:\s*(true|false)\s*$/m.test(raw)
      ? raw.replace(/^enable:\s*(true|false)\s*$/m, `enable: ${flag}`)
      : raw.replace(/^---\r?\n/, `---\nenable: ${flag}\n`);
    if (!new RegExp(`^enable:\\s*${flag}\\s*$`, "m").test(next)) {
      throw new PurgeError("WRITE_FAILED", `${value} 的 enable 开关改写失败，请重新安装该技能`);
    }
    await writeFileAtomic(file, next);
    return { name: value, enabled: enabled === true };
  };

  /** 移除不直接删除：整个目录挪到 plugin-data 下的回收区，随时可以手工放回。 */
  const remove = async (name) => {
    const value = assertName(name);
    const dir = join(skillsDir, REDTEAM_PREFIX + value);
    if (!existsSync(dir)) return { name: value, removed: false, path: "", indexError: "" };
    await mkdir(removedDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = join(removedDir, `${REDTEAM_PREFIX}${value}-${stamp}`);
    await rename(dir, target);
    const index = await readIndex();
    delete index[value];
    const indexError = await writeIndex(index);
    return { name: value, removed: true, path: target, indexError };
  };

  const readSkill = async (name, limit = 20000) => {
    const value = assertName(name);
    let raw = "";
    try {
      raw = await readFile(join(libraryDir, `${value}.md`), "utf8");
    } catch {
      throw new PurgeError("NOT_FOUND", `技能库里没有 ${value}`);
    }
    return {
      name: value,
      content: raw.slice(0, limit),
      chars: raw.length,
      truncated: raw.length > limit,
    };
  };

  const describe = async ({ refreshEnv = false } = {}) => {
    const [library, installed, index, env] = await Promise.all([
      readLibrary(),
      readInstalled(skillsDir),
      readIndex(),
      getEnvReport({ force: refreshEnv }),
    ]);
    const items = library.map((item) => {
      const state = installed.get(item.name) || null;
      const record = index[item.name] || null;
      const updateAvailable = Boolean(state && record?.sourceHash && record.sourceHash !== item.hash);
      return {
        ...item,
        installed: Boolean(state?.installed),
        enabled: Boolean(state?.enabled),
        broken: Boolean(state?.broken),
        updateAvailable,
        installedAt: record?.installedAt || "",
        path: state?.path || "",
      };
    });
    const installedCount = items.filter((item) => item.installed).length;
    const enabledCount = items.filter((item) => item.installed && item.enabled).length;
    return {
      libraryDir,
      skillsDir,
      removedDir,
      env,
      items,
      counts: {
        total: items.length,
        installed: installedCount,
        enabled: enabledCount,
        updateAvailable: items.filter((item) => item.updateAvailable).length,
      },
    };
  };

  return { describe, install, installAll, setEnabled, remove, readSkill };
}
