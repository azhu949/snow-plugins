// 连接设置：本机 docker 目标（CLI 路径 / DOCKER_HOST / context）+ 若干台远程 SSH 服务器。
// 服务器清单存插件私有存储；每台服务器的 SSH 密码按 id 存宿主安全存储（ctx.secrets），不进 storage。
// 另外在插件目录留一份不含密码的 JSON 备份：宿主的插件存储在重装/重载时可能被重置，有备份就能自动恢复。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DOCKER_PATH_PATTERN,
  ENV_TOTAL_MAX,
  ENV_VALUE_MAX,
  PRE_BUILD_ENV_TOTAL_MAX,
  PRE_BUILD_ENV_VALUE_MAX,
  normalizeEnvValue,
  utf8Bytes,
} from "../shared/contract.js";

const STORAGE_KEY = "connection";
const SSH_PASSWORD_PREFIX = "sshPassword_";
/** 旧版本把唯一那台服务器的密码存在固定键里，加载时迁移到按 id 的键。 */
const LEGACY_SSH_PASSWORD_KEY = "sshPassword";
const DEFAULT_DOCKER_PATH = "docker";
const MAX_SERVERS = 20;

const DEFAULTS = {
  cliPath: "",
  dockerHost: "",
  context: "",
  ssh: { currentId: "", servers: [] },
  /** 按 Dockerfile 绝对路径保存的构建运行配置（镜像标签、上下文、build-args 等）。 */
  runConfigs: {},
};

/** 服务器标识只用于本地索引与安全存储的键名，字符集必须收敛。 */
export const SSH_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/** 主机指纹用 OpenSSH 的 SHA256 形式（base64 无填充），首次连接时记录。 */
export const SSH_HOST_KEY_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;
const SSH_HOST_PATTERN = /^[A-Za-z0-9._:-]{1,255}$/;
const SSH_USER_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export const MAX_RUN_CONFIGS = 200;
const MAX_BUILD_ARGS = 32;
const RUN_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const PLATFORM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
const BUILD_ARG_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const ABSOLUTE_PATH_PATTERN = /^([A-Za-z]:[\\/]|\/)/;
/**
 * 绑定挂载源必须是服务器上的 POSIX 绝对路径。
 * 运行配置只在远程服务器上执行，Windows 盘符路径发过去会被 docker 判为非法卷。
 */
const MOUNT_HOST_PATTERN = /^\/[^\0]*$/;

/** 运行阶段的输入上限与白名单。 */
const MAX_PORTS = 32;
const MAX_MOUNTS = 32;
const MAX_ENV = 64;
const RUN_OPTIONS_MAX = 512;
const CONTAINER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const PORT_TEXT_PATTERN = /^\d{1,5}$/;
/**
 * 「修改」里可勾选的附加项，勾上才在面板显示对应输入区。
 * 构建四项在前、运行四项在后，和后端归一化时的白名单共用。
 */
export const RUN_OPTION_IDS = ["platform", "buildArgs", "noCache", "pull", "ports", "mounts", "env", "runOptions"];
const OPTION_IDS = RUN_OPTION_IDS;

/**
 * 构建前置步骤只接 npm（含 yarn / pnpm）与 Maven：先在本机打包，再执行 docker build。
 * 字段对齐 IDEA 的 npm 运行配置：package.json、包管理器、命令、脚本、参数、Node 解释器与参数、
 * 环境变量、工作目录；Maven 侧是 goals、profiles、JVM 选项。空字符串表示不执行。
 */
const PRE_BUILD_TOOLS = ["", "npm", "maven"];
const PACKAGE_MANAGERS = ["npm", "yarn", "pnpm"];
const NPM_COMMANDS = ["run", "run-script", "install", "ci", "test", "start", "stop", "restart", "exec", "publish", "pack"];
const PRE_BUILD_TEXT_MAX = 512;
const PRE_BUILD_SHORT_MAX = 256;
const MAX_PRE_BUILD_ENV = 32;

/** 早期版本把「工具后面的参数」整体存在 command 里，这里按新结构拆开。 */
const splitLegacyPreBuild = (tool, legacy) => {
  const parts = String(legacy || "").split(/\s+/).filter(Boolean);
  if (tool === "maven") return { goals: parts.join(" ") };
  if (!parts.length) return {};
  if (NPM_COMMANDS.includes(parts[0])) {
    return { command: parts[0], script: parts[1] || "", args: parts.slice(2).join(" ") };
  }
  return { command: "run", script: parts[0], args: parts.slice(1).join(" ") };
};

/** 单条运行配置里的前置构建步骤归一化。 */
const normalizePreBuild = (raw) => {
  const tool = cleanText(raw?.tool, 16).toLowerCase();
  const safeTool = PRE_BUILD_TOOLS.includes(tool) ? tool : "";

  // 新版总是写入 script / goals / arguments，用它们判断是否为旧结构。
  const isNewShape =
    typeof raw?.script === "string" ||
    typeof raw?.goals === "string" ||
    typeof raw?.arguments === "string" ||
    typeof raw?.packageManager === "string";
  const legacy = isNewShape ? {} : splitLegacyPreBuild(safeTool, cleanText(raw?.command, PRE_BUILD_TEXT_MAX));

  const rawCommand = cleanText(raw?.command, 32);
  const command = NPM_COMMANDS.includes(rawCommand) ? rawCommand : legacy.command || "run";
  const script = (cleanText(raw?.script, 128) || legacy.script || "").replace(/\s+/g, "");
  const argsText = typeof raw?.arguments === "string" ? cleanText(raw.arguments, PRE_BUILD_TEXT_MAX) : legacy.args || "";
  const goals = cleanText(raw?.goals, PRE_BUILD_TEXT_MAX) || legacy.goals || "";

  const manager = cleanText(raw?.packageManager, 16).toLowerCase();
  const env = [];
  for (const item of Array.isArray(raw?.env) ? raw.env : []) {
    const key = cleanText(item?.key, 128);
    if (!ENV_KEY_PATTERN.test(key)) continue;
    // 超长值原样保留：截断会让 PEM 变成半截而不报错，长度问题统一交给 validatePreBuildEnv。
    const value = normalizeEnvValue(item?.value);
    env.push({ key, value });
    if (env.length >= MAX_PRE_BUILD_ENV) break;
  }

  return {
    tool: safeTool,
    cwd: cleanText(raw?.cwd, 512),
    packageJson: cleanText(raw?.packageJson, 512),
    packageManager: PACKAGE_MANAGERS.includes(manager) ? manager : "npm",
    command,
    script,
    arguments: argsText.replace(/[\r\n]+/g, " "),
    nodePath: cleanText(raw?.nodePath, 512),
    nodeOptions: cleanText(raw?.nodeOptions, PRE_BUILD_TEXT_MAX).replace(/[\r\n]+/g, " "),
    mavenPath: cleanText(raw?.mavenPath, 512),
    env,
    goals: goals.replace(/[\r\n]+/g, " "),
    profiles: cleanText(raw?.profiles, PRE_BUILD_SHORT_MAX).replace(/[\r\n]+/g, " "),
    jvmOptions: cleanText(raw?.jvmOptions, PRE_BUILD_TEXT_MAX).replace(/[\r\n]+/g, " "),
  };
};

const isPortNumber = (text) => {
  const value = Number(text);
  return Number.isInteger(value) && value > 0 && value <= 65535;
};

const cleanText = (value, maxLength) => {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

/** DOCKER_HOST 只允许 docker CLI 支持的协议；空值表示沿用系统默认。 */
const HOST_PATTERN = /^(npipe:\/\/|unix:\/\/|tcp:\/\/|ssh:\/\/)/i;

/** 单台服务器归一化：缺 id 时留空，由保存流程补一个；名称默认取 user@host。 */
export const normalizeSshServer = (raw) => {
  const port = Number(raw?.port);
  const id = cleanText(raw?.id, 32);
  const host = cleanText(raw?.host, 255);
  const username = cleanText(raw?.username, 128);
  const name = cleanText(raw?.name, 64);
  const hostKey = cleanText(raw?.hostKey, 128);
  const dockerPath = cleanText(raw?.dockerPath, 255);
  return {
    id: SSH_ID_PATTERN.test(id) ? id : "",
    name: name || (host ? `${username || "root"}@${host}` : ""),
    host,
    port: Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : 22,
    username,
    // dockerPath 会被拼进远程 shell 命令：存储或备份里被写入非白名单值时一律回退 docker，
    // 恢复旧数据不会经过 validateSshServer，所以兜底必须放在归一化里。
    dockerPath: DOCKER_PATH_PATTERN.test(dockerPath) ? dockerPath : DEFAULT_DOCKER_PATH,
    hostKey: SSH_HOST_KEY_PATTERN.test(hostKey) ? hostKey : "",
  };
};

/** 校验单台服务器，返回错误文案（空字符串表示通过）。 */
export const validateSshServer = (server) => {
  if (server.id && !SSH_ID_PATTERN.test(server.id)) return "SSH 服务器标识不合法";
  if (!server.host) return "请填写 SSH 主机";
  if (!SSH_HOST_PATTERN.test(server.host)) return "SSH 主机只能是主机名或 IP";
  if (!server.username) return "请填写 SSH 用户名";
  if (!SSH_USER_PATTERN.test(server.username)) return "SSH 用户名只能包含字母、数字、点、横线与下划线";
  if (!DOCKER_PATH_PATTERN.test(server.dockerPath)) {
    return "远程 docker 路径只能是 docker 或绝对路径，如 /usr/bin/docker";
  }
  return "";
};

const normalizeSsh = (raw) => {
  const list = Array.isArray(raw?.servers) ? raw.servers : [];
  const servers = [];
  const seen = new Set();
  for (const item of list.slice(0, MAX_SERVERS)) {
    const server = normalizeSshServer(item);
    if (!server.id || seen.has(server.id)) continue;
    seen.add(server.id);
    servers.push(server);
  }

  // 兼容旧版本的单服务器结构：{ host, port, username, dockerPath }。
  if (servers.length === 0 && typeof raw?.host === "string" && raw.host.trim()) {
    const legacy = normalizeSshServer({ ...raw, id: "s0" });
    if (legacy.host) servers.push(legacy);
  }

  const currentId = cleanText(raw?.currentId, 32);
  return {
    currentId: servers.some((item) => item.id === currentId) ? currentId : servers[0]?.id || "",
    servers,
  };
};

/** 单条运行配置归一化：字段缺省即留空，由面板按默认值展示。 */
export const normalizeRunConfig = (raw) => {
  const buildArgs = [];
  for (const item of Array.isArray(raw?.buildArgs) ? raw.buildArgs : []) {
    const key = cleanText(item?.key, 64);
    if (!BUILD_ARG_KEY_PATTERN.test(key)) continue;
    const value = typeof item?.value === "string" ? item.value.trim() : "";
    buildArgs.push({ key, value: value.slice(0, 512) });
    if (buildArgs.length >= MAX_BUILD_ARGS) break;
  }

  const ports = [];
  for (const item of Array.isArray(raw?.ports) ? raw.ports : []) {
    ports.push({
      host: cleanText(item?.host, 8),
      container: cleanText(item?.container, 8),
      protocol: cleanText(item?.protocol, 4).toLowerCase() === "udp" ? "udp" : "tcp",
    });
    if (ports.length >= MAX_PORTS) break;
  }

  const mounts = [];
  for (const item of Array.isArray(raw?.mounts) ? raw.mounts : []) {
    mounts.push({
      host: cleanText(item?.host, 512),
      container: cleanText(item?.container, 512),
      readOnly: item?.readOnly === true,
    });
    if (mounts.length >= MAX_MOUNTS) break;
  }

  const env = [];
  for (const item of Array.isArray(raw?.env) ? raw.env : []) {
    const key = cleanText(item?.key, 128);
    if (!ENV_KEY_PATTERN.test(key)) continue;
    // 同前置构建：不在这里截断，长度与总量由 validateRunConfig 明确报错。
    const value = normalizeEnvValue(item?.value);
    env.push({ key, value });
    if (env.length >= MAX_ENV) break;
  }

  const options = [];
  for (const item of Array.isArray(raw?.options) ? raw.options : []) {
    const id = cleanText(item, 32);
    if (OPTION_IDS.includes(id) && !options.includes(id)) options.push(id);
  }

  const platform = cleanText(raw?.platform, 64);
  const serverId = cleanText(raw?.serverId ?? raw?.sshId, 32);
  const containerName = cleanText(raw?.containerName, 64);
  return {
    name: cleanText(raw?.name, 64),
    serverId: SSH_ID_PATTERN.test(serverId) ? serverId : "",
    tag: cleanText(raw?.tag, 200),
    context: cleanText(raw?.context, 512),
    // 非法值保留原样，交给 validateRunConfig 报错；在这里置空会让校验永远通过。
    platform,
    noCache: raw?.noCache === true,
    pull: raw?.pull === true,
    buildArgs,
    containerName: CONTAINER_NAME_PATTERN.test(containerName) ? containerName : "",
    ports,
    mounts,
    env,
    runOptions: cleanText(raw?.runOptions, RUN_OPTIONS_MAX).replace(/[\r\n]/g, ""),
    preBuild: normalizePreBuild(raw?.preBuild),
    options,
  };
};

/**
 * 前置构建的环境变量单独校验：它不进 SSH 命令，而是整份塞进本机子进程的环境块。
 * 单值上限比运行环境更严（见 PRE_BUILD_ENV_VALUE_MAX），且必须小于合计上限：
 * 否则单值填满时先撞上合计检查，错误会归因到「合计超限」上。
 */
export const validatePreBuildEnv = (env) => {
  let total = 0;
  for (const item of env || []) {
    if (!ENV_KEY_PATTERN.test(item.key)) return `环境变量名不合法：${item.key}`;
    if (item.value.includes("\0")) return `环境变量 ${item.key} 的值不能包含 NUL 字符`;
    if (item.value.length > PRE_BUILD_ENV_VALUE_MAX) {
      return `前置构建环境变量 ${item.key} 的值有 ${item.value.length} 个字符，超过单值上限 ${PRE_BUILD_ENV_VALUE_MAX}；请精简内容，或改用文件挂载传入`;
    }
    // +1 是环境块里 NAME=VALUE 之后的 NUL 分隔符。
    total += item.key.length + item.value.length + 1;
  }
  if (total > PRE_BUILD_ENV_TOTAL_MAX) {
    return `前置构建环境变量的合计长度 ${total} 个字符（含变量名与分隔符），超过合计上限 ${PRE_BUILD_ENV_TOTAL_MAX}；请精简变量，或改用文件挂载传入`;
  }
  return "";
};

/**
 * 校验单条运行配置，返回错误文案（空字符串表示通过）。
 * requireServer 仅在「手动登记 Dockerfile」时为 false：登记项先只占一个路径，
 * 真正构建 / 运行时路由仍会强制 serverId。
 */
export const validateRunConfig = (config, { requireServer = true } = {}) => {
  if (config.tag && !RUN_TAG_PATTERN.test(config.tag)) return "镜像标记不合法，例如 my-app:latest";
  if (requireServer && !config.serverId) return "运行配置需要选择一台远程服务器：本插件只通过 SSH 操作远程 Docker";
  if (config.context && !ABSOLUTE_PATH_PATTERN.test(config.context)) return "上下文文件夹必须是绝对路径";
  if (config.platform && !PLATFORM_PATTERN.test(config.platform)) return "平台格式不合法，例如 linux/amd64";
  for (const arg of config.buildArgs || []) {
    if (!BUILD_ARG_KEY_PATTERN.test(arg.key)) return `构建参数名不合法：${arg.key}`;
    if (/[\r\n]/.test(arg.value)) return `构建参数 ${arg.key} 的值不能包含换行`;
  }
  if (config.containerName && !CONTAINER_NAME_PATTERN.test(config.containerName)) {
    return "容器名称只能包含字母、数字、点、横线与下划线，且以字母或数字开头";
  }
  for (const port of config.ports || []) {
    if (!PORT_TEXT_PATTERN.test(port.host) || !isPortNumber(port.host)) return `主机端口不合法：${port.host || "(空)"}`;
    if (!PORT_TEXT_PATTERN.test(port.container) || !isPortNumber(port.container)) {
      return `容器端口不合法：${port.container || "(空)"}`;
    }
  }
  for (const mount of config.mounts || []) {
    if (!mount.host || !MOUNT_HOST_PATTERN.test(mount.host)) {
      return "绑定挂载的主机路径必须是服务器上的绝对路径（以 / 开头），例如 /data/app";
    }
    if (!mount.container || !mount.container.startsWith("/")) return "绑定挂载的容器路径必须以 / 开头";
  }
  let envBytes = 0;
  for (const item of config.env || []) {
    if (!ENV_KEY_PATTERN.test(item.key)) return `环境变量名不合法：${item.key}`;
    // 值允许换行（PEM 私钥、证书都是多行文本），只拦 NUL：它无法出现在进程环境里。
    if (item.value.includes("\0")) return `环境变量 ${item.key} 的值不能包含 NUL 字符`;
    if (item.value.length > ENV_VALUE_MAX) {
      return `环境变量 ${item.key} 的值有 ${item.value.length} 个字符，超过单值上限 ${ENV_VALUE_MAX}；请精简内容或改用文件挂载`;
    }
    envBytes += utf8Bytes(item.key) + utf8Bytes(item.value);
  }
  // 这些值会拼进一条 SSH exec 命令：总量过大时服务端会按单包上限直接断开连接。
  if (envBytes > ENV_TOTAL_MAX) {
    return `环境变量的总值约 ${Math.ceil(envBytes / 1024)} KB，超过单份配置上限 ${
      ENV_TOTAL_MAX / 1024
    } KB；请精简变量，或把大段内容放到服务器上的文件里`;
  }
  if (/[\r\n]/.test(config.runOptions || "")) return "运行选项不能包含换行";
  const preBuild = config.preBuild || {};
  if (preBuild.tool) {
    const invalidEnv = validatePreBuildEnv(preBuild.env);
    if (invalidEnv) return invalidEnv;
    if (preBuild.cwd && !ABSOLUTE_PATH_PATTERN.test(preBuild.cwd)) {
      return "构建前步骤的工作目录必须是绝对路径";
    }
    if (preBuild.packageJson && !ABSOLUTE_PATH_PATTERN.test(preBuild.packageJson)) {
      return "package.json 必须是绝对路径";
    }
    if (preBuild.nodePath && !ABSOLUTE_PATH_PATTERN.test(preBuild.nodePath) && !/^[A-Za-z0-9._-]+$/.test(preBuild.nodePath)) {
      return "Node 解释器要么是 node 这样的名字，要么是绝对路径";
    }
    if (preBuild.mavenPath && !ABSOLUTE_PATH_PATTERN.test(preBuild.mavenPath) && !/^[A-Za-z0-9._-]+$/.test(preBuild.mavenPath)) {
      return "Maven 可执行文件要么是 mvn 这样的名字，要么是绝对路径";
    }
    if (preBuild.tool === "maven") {
      if (!preBuild.goals) return "请填写 Maven 的 goals";
    } else if (!preBuild.script && (preBuild.command === "run" || preBuild.command === "run-script")) {
      return "请填写 npm 的脚本名";
    }
  }
  return "";
};

const isBlankRunConfig = (config) =>
  !config.name &&
  !config.tag &&
  !config.context &&
  !config.platform &&
  !config.serverId &&
  !config.noCache &&
  !config.pull &&
  !config.containerName &&
  !config.runOptions &&
  // preBuild 的其余字段都有默认值，只有 tool 决定这一项是否真的启用。
  !config.preBuild?.tool &&
  config.buildArgs.length === 0 &&
  config.ports.length === 0 &&
  config.mounts.length === 0 &&
  config.env.length === 0 &&
  config.options.length === 0;

/** 运行配置表：键是 Dockerfile 绝对路径；全空的条目直接丢弃，避免界面上出现无法删除的空壳。 */
const normalizeRunConfigs = (raw) => {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= MAX_RUN_CONFIGS) break;
    const path = cleanText(key, 512);
    if (!path || !ABSOLUTE_PATH_PATTERN.test(path)) continue;
    const config = normalizeRunConfig(value);
    if (isBlankRunConfig(config)) continue;
    out[path] = config;
    count += 1;
  }
  return out;
};

/**
 * 列表与扫描只回摘要：env 值、绑定挂载与运行选项留在配置里，编辑或构建时按路径单独读取。
 * 面板的卡片与配置列表只需要名称、标记、服务器与已填项标识。
 */
export const summarizeRunConfig = (config) => {
  if (!config) return null;
  return {
    name: config.name || "",
    tag: config.tag || "",
    platform: config.platform || "",
    serverId: config.serverId || "",
    containerName: config.containerName || "",
    options: Array.isArray(config.options) ? [...config.options] : [],
    preBuildTool: config.preBuild?.tool || "",
    envKeys: (config.env || []).map((item) => item.key),
    counts: {
      buildArgs: (config.buildArgs || []).length,
      ports: (config.ports || []).length,
      mounts: (config.mounts || []).length,
      env: (config.env || []).length,
      preBuildEnv: (config.preBuild?.env || []).length,
    },
  };
};

/** 整表摘要：键仍是 Dockerfile 绝对路径。 */
export const summarizeRunConfigs = (configs) => {
  const out = {};
  for (const [path, config] of Object.entries(configs || {})) out[path] = summarizeRunConfig(config);
  return out;
};

export const normalizeSettings = (raw) => ({
  cliPath: cleanText(raw?.cliPath, 512),
  dockerHost: cleanText(raw?.dockerHost, 512),
  context: cleanText(raw?.context, 128),
  ssh: normalizeSsh(raw?.ssh),
  runConfigs: normalizeRunConfigs(raw?.runConfigs),
});

export const validateSettings = (next) => {
  if (next.dockerHost && !HOST_PATTERN.test(next.dockerHost)) {
    return "DOCKER_HOST 需要以 npipe:// / unix:// / tcp:// / ssh:// 开头";
  }
  if (next.context && !/^[A-Za-z0-9_.-]{1,128}$/.test(next.context)) {
    return "context 名称只能包含字母、数字、点、横线与下划线";
  }
  for (const server of next.ssh?.servers || []) {
    const invalid = validateSshServer(server);
    if (invalid) return invalid;
  }
  return "";
};

/** 把设置翻译成子进程环境变量：未填写的项不覆盖系统默认。 */
export const toDockerEnv = (settings) => {
  const env = { ...process.env, DOCKER_CLI_HINTS: "false" };
  if (settings.dockerHost) env.DOCKER_HOST = settings.dockerHost;
  // 填了 context 时不能同时带 DOCKER_HOST，否则 CLI 会报冲突。
  if (settings.context && !settings.dockerHost) env.DOCKER_CONTEXT = settings.context;
  return env;
};

export function createSettings({ storage, secrets, backupPath = "", log = () => {}, onChange } = {}) {
  let current = normalizeSettings(DEFAULTS);
  let loaded = null;
  /** 存储连续读取失败：此时 current 只是空兜底，任何写回都会覆盖真实配置。 */
  let storageReadFailed = false;
  /** 本次进程是否从备份恢复过、有哪些值需要重填：仅内存，随 get() 返回给面板。 */
  let recovery = null;

  const passwordKey = (id) => `${SSH_PASSWORD_PREFIX}${id}`;

  const isEmptySettings = (settings) =>
    !settings.cliPath &&
    !settings.dockerHost &&
    !settings.context &&
    (!settings.ssh?.servers || settings.ssh.servers.length === 0) &&
    // 只有运行配置的真实数据不能算空，否则备份不会刷新、恢复时也会被跳过。
    Object.keys(settings.runConfigs || {}).length === 0;

  const readBackup = async () => {
    if (!backupPath) return null;
    try {
      const text = await readFile(backupPath, "utf8");
      return normalizeSettings(JSON.parse(text));
    } catch {
      return null;
    }
  };

  /**
   * DOCKER_HOST 允许携带 user:password@ 形式的账号口令，而备份文件会落到本机磁盘，
   * 落盘前必须去掉这段 userinfo；恢复后需要重新填写凭据。
   */
  const stripHostUserInfo = (value) => {
    const text = String(value || "");
    const match = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/]*@)?(.*)$/.exec(text);
    return match && match[2] ? `${match[1]}${match[3]}` : text;
  };

  /**
   * 备份只留结构，不留凭据值：备份文件会落到本机磁盘，不能让环境变量、构建参数、
   * Node / JVM 选项与脚本参数里的 token / 口令以明文落盘。恢复后这些值需要重新填写，
   * 服务器清单与其余配置都能找回来。
   */
  const forBackup = (settings) => {
    const runConfigs = {};
    for (const [path, config] of Object.entries(settings.runConfigs || {})) {
      runConfigs[path] = {
        ...config,
        // 构建参数的值常用来传 npm token 一类凭据：保留键名，值清空。
        buildArgs: (config.buildArgs || []).map((item) => ({ key: item.key, value: "" })),
        // 运行选项是自由文本，-e TOKEN= / --env-file 都可能带凭据，无法可靠掩码，整段清空。
        runOptions: "",
        env: (config.env || []).map((item) => ({ key: item.key, value: "" })),
        preBuild: config.preBuild
          ? {
              ...config.preBuild,
              env: (config.preBuild.env || []).map((item) => ({ key: item.key, value: "" })),
              // Node / JVM 选项与脚本参数常被用来传私服凭据，备份里同样只留结构不留值。
              nodeOptions: "",
              jvmOptions: "",
              arguments: "",
            }
          : config.preBuild,
      };
    }
    return { ...settings, dockerHost: stripHostUserInfo(settings.dockerHost), runConfigs };
  };

  const writeBackup = async (settings, { allowEmpty = false } = {}) => {
    if (!backupPath) return;
    // 启动路径不写空结构：存储读失败时 current 是空兜底，写下去会冲掉唯一一份好备份。
    // 运行期由 persist 传 allowEmpty：用户把配置清空时备份必须跟着清空，
    // 否则宿主重置存储时会把已删除的服务器从旧备份里恢复出来。
    if (!allowEmpty && isEmptySettings(settings)) return;
    try {
      await mkdir(dirname(backupPath), { recursive: true });
      // 只写非敏感字段：密码仍在宿主安全存储里，环境变量值、构建参数值、运行选项
      // 与 Node / JVM 选项、脚本参数已在 forBackup 里清空。
      await writeFile(backupPath, `${JSON.stringify(forBackup(settings), null, 2)}\n`, "utf8");
    } catch (error) {
      log(`写入配置备份失败：${error?.message || error}`);
    }
  };

  const readSecret = async (key) => {
    if (!secrets || !key) return "";
    try {
      return (await secrets.get(key)) || "";
    } catch (error) {
      log(`读取 SSH 密码失败：${error?.message || error}`);
      return "";
    }
  };

  const writeSecret = async (key, value) => {
    if (!secrets || !key) return false;
    try {
      // 密码不做 trim：前后空格也可能是密码的一部分。
      if (value) await secrets.set(key, String(value).slice(0, 256));
      else await secrets.remove(key);
      return true;
    } catch (error) {
      log(`保存 SSH 密码失败：${error?.message || error}`);
      return false;
    }
  };

  /**
   * 备份里被清空的敏感字段摘要：只统计仍有结构残留的项（键名还在说明用户确实配置过），
   * 用于面板提示「已从备份恢复，这些值需要重填」。
   */
  const describeRecovery = (settings) => {
    const fields = new Set();
    let runConfigCount = 0;
    for (const config of Object.values(settings.runConfigs || {})) {
      const hit = [];
      if ((config.buildArgs || []).some((item) => item.key)) hit.push("buildArgs");
      if ((config.env || []).some((item) => item.key)) hit.push("env");
      if ((config.options || []).includes("runOptions")) hit.push("runOptions");
      if (config.preBuild?.tool && (config.preBuild.env || []).some((item) => item.key)) hit.push("preBuildEnv");
      if (!hit.length) continue;
      runConfigCount += 1;
      for (const id of hit) fields.add(id);
    }
    return runConfigCount ? { restoredFromBackup: true, runConfigCount, fields: [...fields] } : null;
  };

  const ensure = async () => {
    if (loaded) return loaded;
    loaded = (async () => {
      let normalized = normalizeSettings(null);
      let raw = null;
      let readFailed = false;
      // 读取偶发失败与「存储确实为空」必须分开：失败时先重试一次，仍失败只做内存兜底。
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          raw = await storage.getJson(STORAGE_KEY, null);
          normalized = normalizeSettings(raw);
          readFailed = false;
          break;
        } catch (error) {
          readFailed = true;
          log(`读取连接设置失败：${error?.message || error}`);
        }
      }
      // 失败状态留给 persist：写入路径据此拒绝覆盖真实存储与备份。
      storageReadFailed = readFailed;

      // 只有「存储里确实没有内容」时才用备份恢复。
      // 本机三项（cliPath / dockerHost / context）为空是常态：只用远程服务器的用户从来不会填它们，
      // 早先把这种状态当成「空存储」，每次启动都用备份整体覆盖存储，连带把运行配置一起回退。
      // 读失败时不进入恢复分支：否则备份里已被清空的凭据字段会被写到真实配置上。
      const restoredFromBackup = !readFailed && (raw === null || raw === undefined);
      if (restoredFromBackup) {
        const fromBackup = await readBackup();
        if (fromBackup && !isEmptySettings(fromBackup)) {
          normalized = fromBackup;
          // 备份里的敏感值已被清空：把需要重填的字段记下来，由面板顶部提示，而不是只留一行宿主日志。
          recovery = describeRecovery(normalized);
          // 备份只用于本次内存兜底，不回写存储：备份里的 env / buildArgs / 运行选项都是空值，
          // 写回会把用户真实配置永久清空，而且旧清单可能覆盖较新的数据。
          log("插件存储为空，已从配置备份恢复到内存（不回写存储）");
        }
      }

      current = normalized;

      // 旧密码迁移：单台服务器的固定键 -> 按 id 的键。
      const first = current.ssh.servers[0];
      if (first) {
        const legacy = await readSecret(LEGACY_SSH_PASSWORD_KEY);
        if (legacy && !(await readSecret(passwordKey(first.id)))) {
          const migrated = await writeSecret(passwordKey(first.id), legacy);
          // 写入失败时保留旧键：否则唯一的密码来源被删掉，下次启动就没得重试了。
          if (migrated) await writeSecret(LEGACY_SSH_PASSWORD_KEY, "");
        }
      }

      // 迁移出来的结构（旧单服务器 -> servers[]）要立刻回写，避免只存在内存里；
      // 读失败或数据来自备份时不回写，避免把兜底内容覆盖到真实存储。
      if (!readFailed && !restoredFromBackup) {
        try {
          await storage.setJson(STORAGE_KEY, current);
        } catch (error) {
          log(`回写连接设置失败：${error?.message || error}`);
        }
      }
      // 只有读到了真实配置才刷新备份：启动时若存储为空，绝不能把好备份覆盖成空。
      if (!isEmptySettings(current)) await writeBackup(current);
      return current;
    })();
    return loaded;
  };

  const persist = async (next) => {
    const invalid = validateSettings(next);
    if (invalid) throw new Error(invalid);
    // 读失败时 current 是空兜底：此时写回会把空服务器 / 空运行配置落成真实存储，
    // 并让 writeBackup 覆盖掉唯一一份好备份，因此直接拒绝并提示重启后台。
    if (storageReadFailed) {
      const error = new Error("读取连接设置失败，为避免覆盖已有服务器与运行配置，本次保存已取消：请重启 Snow App 后重试");
      error.code = "SETTINGS_UNAVAILABLE";
      throw error;
    }
    await storage.setJson(STORAGE_KEY, next);
    current = next;
    // 运行期以存储为准：用户清空配置时备份也要清空，避免重现「已删除的服务器」。
    await writeBackup(next, { allowEmpty: true });
    try {
      onChange?.(next);
    } catch (error) {
      log(`应用连接设置失败：${error?.message || error}`);
    }
    return next;
  };

  /** 服务器列表 + 每台是否有已保存的密码。 */
  const listSshServers = async () => {
    await ensure();
    const servers = [];
    for (const item of current.ssh.servers) {
      servers.push({ ...item, hasPassword: Boolean(await readSecret(passwordKey(item.id))) });
    }
    return { currentId: current.ssh.currentId, servers };
  };

  return {
    async get() {
      await ensure();
      return {
        ...current,
        ssh: { currentId: current.ssh.currentId, servers: current.ssh.servers.map((item) => ({ ...item })) },
        // 仅本次进程的恢复摘要：normalizeSettings 不认识该键，不会被写回存储或备份。
        ...(recovery ? { recovery } : {}),
      };
    },

    /** 只更新本机连接三项；SSH 服务器走下面的专用方法。 */
    async save(patch) {
      await ensure();
      const next = normalizeSettings({
        ...current,
        cliPath: patch?.cliPath ?? current.cliPath,
        dockerHost: patch?.dockerHost ?? current.dockerHost,
        context: patch?.context ?? current.context,
      });
      await persist(next);
      log(
        `连接设置已保存：cliPath=${next.cliPath || "(默认)"} dockerHost=${next.dockerHost || "(默认)"} context=${next.context || "(默认)"}`
      );
      return {
        ...next,
        ssh: { currentId: next.ssh.currentId, servers: next.ssh.servers.map((item) => ({ ...item })) },
      };
    },

    listSshServers,

    /** 新增或更新一台服务器；传了 password 就同时更新它的密码。clearPassword 用于清除已保存的密码，clearHostKey 用于指纹变化后重新信任。 */
    async saveSshServer({ server, password, clearHostKey = false, clearPassword = false } = {}) {
      await ensure();
      const incoming = server || {};
      const id = SSH_ID_PATTERN.test(String(incoming.id || "")) ? String(incoming.id) : `s${Date.now().toString(36)}`;
      const draft = normalizeSshServer({ ...incoming, id });
      const invalid = validateSshServer(draft);
      if (invalid) throw new Error(invalid);

      const previous = current.ssh.servers.find((item) => item.id === id) || null;
      const targetChanged = Boolean(previous && (previous.host !== draft.host || previous.port !== draft.port));
      // 指纹只由连接成功后写入；改主机 / 端口视为新目标，旧指纹立即失效，
      // 避免拿另一台机器的指纹去比对而永久阻断连接。
      const normalized = { ...draft, hostKey: clearHostKey || targetChanged ? "" : previous?.hostKey || "" };

      const exists = Boolean(previous);
      if (!exists && current.ssh.servers.length >= MAX_SERVERS) {
        throw new Error(`最多保存 ${MAX_SERVERS} 台 SSH 服务器`);
      }

      const servers = exists
        ? current.ssh.servers.map((item) => (item.id === id ? normalized : item))
        : [...current.ssh.servers, normalized];

      const next = normalizeSettings({
        ...current,
        ssh: { currentId: current.ssh.currentId || id, servers },
      });
      await persist(next);
      const wantsPassword = typeof password === "string" && Boolean(password);
      // 密码写入失败不再静默：返回 passwordSaved=false，由面板提示「配置已保存但密码未写入」。
      const passwordSaved = wantsPassword ? await writeSecret(passwordKey(id), password) : true;
      // 显式清除只对已存在的服务器生效；本次填了新密码时以密码为准，不删除刚输入的值。
      const shouldClearPassword = !wantsPassword && clearPassword === true && exists;
      const passwordCleared = shouldClearPassword ? await writeSecret(passwordKey(id), "") : false;
      log(`SSH 服务器已保存：${normalized.name}（${normalized.username}@${normalized.host}:${normalized.port}）`);
      if (!passwordSaved) log(`SSH 密码未写入安全存储：${normalized.name}`);
      if (shouldClearPassword) {
        log(passwordCleared ? `SSH 密码已清除：${normalized.name}` : `SSH 密码清除失败：${normalized.name}`);
      }
      return {
        savedId: id,
        passwordSaved,
        ...(shouldClearPassword ? { passwordCleared } : {}),
        ...(passwordSaved ? {} : { warning: "SSH_PASSWORD_NOT_SAVED" }),
        ...(shouldClearPassword && !passwordCleared ? { warning: "SSH_PASSWORD_NOT_CLEARED" } : {}),
        ...(await listSshServers()),
      };
    },

    async removeSshServer(id) {
      await ensure();
      const targetId = String(id || "");
      if (!current.ssh.servers.some((item) => item.id === targetId)) {
        return { removed: false, ...(await listSshServers()) };
      }
      const servers = current.ssh.servers.filter((item) => item.id !== targetId);
      const next = normalizeSettings({
        ...current,
        ssh: {
          currentId: current.ssh.currentId === targetId ? servers[0]?.id || "" : current.ssh.currentId,
          servers,
        },
      });
      await persist(next);
      await writeSecret(passwordKey(targetId), "");
      log(`SSH 服务器已删除：${targetId}`);
      return { removed: true, ...(await listSshServers()) };
    },

    async setCurrentSshServer(id) {
      await ensure();
      const targetId = String(id || "");
      if (!current.ssh.servers.some((item) => item.id === targetId)) return current.ssh.currentId;
      if (current.ssh.currentId === targetId) return targetId;
      await persist(normalizeSettings({ ...current, ssh: { ...current.ssh, currentId: targetId } }));
      return targetId;
    },

    getSshPassword: async (id) => {
      await ensure();
      return readSecret(passwordKey(String(id || "")));
    },

    /**
     * 首次连接成功后记录服务器主机指纹（TOFU）。
     * 已有不同指纹时不覆盖：必须由用户显式重置后再重新信任，避免被静默换钥。
     */
    async setSshHostKey(id, hostKey) {
      await ensure();
      const targetId = String(id || "");
      const value = String(hostKey || "");
      if (!SSH_HOST_KEY_PATTERN.test(value)) return false;
      const target = current.ssh.servers.find((item) => item.id === targetId);
      if (!target) return false;
      if (target.hostKey === value) return true;
      if (target.hostKey) return false;
      const servers = current.ssh.servers.map((item) => (item.id === targetId ? { ...item, hostKey: value } : item));
      await persist(normalizeSettings({ ...current, ssh: { ...current.ssh, servers } }));
      log(`已记录 SSH 主机指纹：${targetId}`);
      return true;
    },

    /** 全部运行配置（键是 Dockerfile 绝对路径）。仅供后台内部使用，不进接口响应。 */
    getRunConfigs: async () => {
      await ensure();
      return { ...current.runConfigs };
    },

    /** 单条运行配置的完整内容：列表只回摘要，编辑与构建时按路径单独取。 */
    async getRunConfig(dockerfile) {
      await ensure();
      const path = cleanText(dockerfile, 512);
      if (!path) return null;
      return current.runConfigs[path] ? { ...current.runConfigs[path] } : null;
    },

    /** 保存某个 Dockerfile 的运行配置；键就是 Dockerfile 的绝对路径。 */
    async saveRunConfig({ dockerfile, config, requireServer = true } = {}) {
      await ensure();
      const path = cleanText(dockerfile, 512);
      if (!path || !ABSOLUTE_PATH_PATTERN.test(path)) throw new Error("Dockerfile 路径必须是绝对路径");
      const normalized = normalizeRunConfig(config);
      const invalid = validateRunConfig(normalized, { requireServer });
      if (invalid) throw new Error(invalid);

      const next = normalizeSettings({ ...current, runConfigs: { ...current.runConfigs, [path]: normalized } });
      await persist(next);
      log(`运行配置已保存：${normalized.name || path}`);
      // 只回单条配置与摘要：整表（可能含多份 env 明文）不再随保存响应下发。
      return {
        dockerfile: path,
        config: next.runConfigs[path],
        summary: summarizeRunConfig(next.runConfigs[path]),
      };
    },

    async removeRunConfig(dockerfile) {
      await ensure();
      const path = cleanText(dockerfile, 512);
      if (!current.runConfigs[path]) return { removed: false };
      const runConfigs = { ...current.runConfigs };
      delete runConfigs[path];
      const next = normalizeSettings({ ...current, runConfigs });
      await persist(next);
      log(`运行配置已删除：${path}`);
      return { removed: true };
    },
  };
}
