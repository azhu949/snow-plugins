// 协议层：仅监听 127.0.0.1 的 JSON 服务，供本插件面板调用。
// 路由只做参数校验与结果转发；docker 调用与错误分类都在 docker.js。
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { killChildTree } from "./process.js";
import { existsSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative } from "node:path";
import {
  CHANNEL_HEADER,
  CHANNEL_HEADER_VALUE,
  CHANNEL_TOKEN_HEADER,
  LIMITS,
  PLUGIN_ID,
  PORT_FIRST,
  PORT_LAST,
  ROUTES,
} from "../shared/contract.js";
import { CONTAINER_ID_PATTERN, DockerError, IMAGE_REF_PATTERN, getDockerRuntime } from "./docker.js";
import { createRemoteDocker } from "./remote.js";
import { createLogStreamManager } from "./logstream.js";
import { maskCommandArgs } from "./tasks.js";
import { isDockerfilePath, readPackageScripts, scanProject } from "./project.js";
import {
  SSH_ID_PATTERN,
  MAX_RUN_CONFIGS,
  normalizeRunConfig,
  normalizeSettings,
  normalizeSshServer,
  summarizeRunConfigs,
  validatePreBuildEnv,
  validateRunConfig,
  validateSettings,
  validateSshServer,
} from "./settings.js";

const HOST = "127.0.0.1";

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
};

const sendError = (res, status, code, message) => sendJson(res, status, { error: { code, message } });

/**
 * 连接设置响应不含运行配置：运行配置按 Dockerfile 路径维护，只通过 /project/scan 的摘要
 * 与 /project/config 的单条读取下发。这里剔除整表，避免连接页顺带拿到所有 env 明文。
 */
const connectionPayload = (settings) => {
  const payload = { ...settings };
  delete payload.runConfigs;
  return payload;
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > LIMITS.requestMaxBytes) {
        rejected = true;
        // 先让调用方把 413 写回去：这里只停止继续读取，不销毁 socket，
        // 否则 catch 里的 sendError 会写到已销毁的响应上（错误无人接手）。
        try {
          req.pause();
        } catch {
          // 暂停失败不影响后续写回 413。
        }
        reject(new DockerError("REQUEST_TOO_LARGE", "请求体过大"));
        return;
      }
      parts.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      resolve(Buffer.concat(parts).toString("utf8"));
    });
    req.on("error", (error) => {
      if (rejected) return;
      rejected = true;
      reject(error);
    });
  });

const readJsonBody = async (req) => {
  const text = await readBody(req);
  if (!text.trim()) return {};
  const parsed = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DockerError("INVALID_BODY", "请求体必须是 JSON 对象");
  }
  return parsed;
};

const requireContainerId = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || !CONTAINER_ID_PATTERN.test(text)) {
    throw new DockerError("INVALID_PARAM", "容器 id 或名称不合法");
  }
  return text;
};

const requireImageRef = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || !IMAGE_REF_PATTERN.test(text)) {
    throw new DockerError("INVALID_PARAM", "镜像引用不合法");
  }
  return text;
};

const ABSOLUTE_PATH = /^([A-Za-z]:[\\/]|\/)/;
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,199}$/;
const COMPOSE_FILE_PATTERN = /((^|[\\/])(docker-)?compose(\.[\w-]+)?\.ya?ml)$/i;

const requireAbsolutePath = (value, label) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || !ABSOLUTE_PATH.test(text)) throw new DockerError("INVALID_PARAM", `${label}必须是绝对路径`);
  if (text.includes("\0")) throw new DockerError("INVALID_PARAM", `${label}不合法`);
  return text;
};

const requireTag = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || !TAG_PATTERN.test(text)) {
    throw new DockerError("INVALID_PARAM", "镜像标签不合法，例如 my-app:latest");
  }
  return text;
};

const requireComposeFile = (value) => {
  const text = requireAbsolutePath(value, "compose 文件");
  if (!COMPOSE_FILE_PATTERN.test(text)) {
    throw new DockerError("INVALID_PARAM", "不是 compose 文件");
  }
  return text;
};

const PLATFORM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
const BUILD_ARG_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_BUILD_ARGS = 32;

/** --platform 只接受 os/arch 这类短串，避免往命令行塞任意内容。 */
const requirePlatform = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (!PLATFORM_PATTERN.test(text)) throw new DockerError("INVALID_PARAM", "平台格式不合法，例如 linux/amd64");
  return text;
};

/** 构建参数：面板传 [{ key, value }]，这里逐个过白名单。 */
const requireBuildArgs = (value) => {
  if (!Array.isArray(value)) return [];
  const args = [];
  for (const item of value.slice(0, MAX_BUILD_ARGS)) {
    const key = typeof item?.key === "string" ? item.key.trim() : "";
    if (!key) continue;
    if (!BUILD_ARG_KEY_PATTERN.test(key)) throw new DockerError("INVALID_PARAM", `构建参数名不合法：${key}`);
    const raw = item?.value === undefined || item?.value === null ? "" : String(item.value);
    if (/[\r\n]/.test(raw)) throw new DockerError("INVALID_PARAM", `构建参数 ${key} 的值不能包含换行`);
    args.push({ key, value: raw.trim().slice(0, 512) });
  }
  return args;
};

const requireDockerfilePath = (value) => {
  const text = requireAbsolutePath(value, "Dockerfile");
  if (!isDockerfilePath(text)) throw new DockerError("INVALID_PARAM", "文件名不是 Dockerfile（如 Dockerfile、Dockerfile.dev、app.dockerfile）");
  return text;
};

/** 路径是否落在项目根内：与 project.js 的 collectExtra 使用同一套相对路径判定。 */
const isInsideProject = (dockerfile, root) => {
  const rel = relative(root, dockerfile);
  return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
};

const MAX_RUN_EXTRA_ARGS = 32;

/** 运行配置里的目标服务器：空表示本机，其余必须是已保存服务器的合法标识。 */
const requireServerId = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  return SSH_ID_PATTERN.test(text) ? text : "";
};

/**
 * 把 IDEA 式的运行选项字符串拆成参数数组：支持单双引号与反斜杠转义。
 * 引号没闭合时返回 null，交给路由报 400。
 */
const splitRunOptions = (text) => {
  const source = String(text || "");
  const args = [];
  let current = "";
  let quoteChar = "";
  let hasContent = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoteChar) {
      if (char === "\\" && index + 1 < source.length) {
        current += source[index + 1];
        index += 1;
        continue;
      }
      if (char === quoteChar) {
        quoteChar = "";
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quoteChar = char;
      hasContent = true;
      continue;
    }
    if (char === "\\" && index + 1 < source.length) {
      current += source[index + 1];
      index += 1;
      hasContent = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasContent) {
        args.push(current);
        current = "";
        hasContent = false;
      }
      continue;
    }
    current += char;
    hasContent = true;
  }

  if (quoteChar) return null;
  if (hasContent) args.push(current);
  return args;
};

/** 构建前置步骤支持的可执行文件：npm / yarn / pnpm 与 Maven，用户输入不会变成 shell 片段。 */
const PRE_BUILD_BINS = {
  npm: { win32: "npm.cmd", other: "npm" },
  yarn: { win32: "yarn.cmd", other: "yarn" },
  pnpm: { win32: "pnpm.cmd", other: "pnpm" },
  maven: { win32: "mvn.cmd", other: "mvn" },
};
const MAX_PRE_BUILD_ARGS = 32;

const pickBin = (name) => {
  const table = PRE_BUILD_BINS[name] || PRE_BUILD_BINS.npm;
  return process.platform === "win32" ? table.win32 : table.other;
};

/**
 * Maven 可执行文件的定位：PATH 里没有 mvn 时，配置里可以填 Maven 安装根目录、bin 目录，
 * 或 mvn / mvnw 的绝对路径。统一换算成要放进 PATH 的绝对目录；留空或只填名字返回空串。
 */
const resolveMavenBinDir = (input) => {
  const value = String(input || "").trim().replace(/[\\/]+$/, "");
  if (!value || !/^([A-Za-z]:[\\/]|\/)/.test(value)) return "";
  if (/(^|[\\/])bin$/i.test(value)) return value;
  if (/(^|[\\/])mvnw?(\.cmd|\.bat)?$/i.test(value)) return dirname(value);
  return join(value, "bin");
};

/**
 * cmd.exe 不认识 \" 这种转义：参数里带双引号会提前闭合引号，后面的 & | 会被当成命令分隔符。
 * 因此 Windows 下这些字符在拼命令行前就被拒绝，而不是指望转义；% 会在命令行阶段展开变量，同样拒绝。
 */
const CMD_UNSAFE = /["%&|<>^!()\r\n]/;
const assertCmdSafe = (args) => {
  if (process.platform !== "win32") return;
  for (const arg of args) {
    if (CMD_UNSAFE.test(String(arg))) {
      throw new DockerError(
        "INVALID_PARAM",
        `Windows 下构建前步骤的参数不能包含双引号、% 或 & | < > ^ ! ( ) 等 cmd 元字符：${arg}`
      );
    }
  }
};

/** 命令行里只放行常见的安全字符，其余整体加双引号；内部双引号按 cmd 语义双写（cmd 不认 \"）。 */
const quoteShellArg = (text) => {
  const value = String(text);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
};

/**
 * 跑一条构建工具命令，输出按行回调。
 * Windows 上 npm / mvn 都是 .cmd 包装脚本，必须经 cmd.exe 才能执行；
 * 参数已逐个加引号，等价于直接 spawn 数组，不会把用户输入当 shell 片段解释。
 */
const spawnStream = ({ bin, args, cwd, env, onLine }) => {
  const isWin = process.platform === "win32";
  const options = { windowsHide: true, cwd: cwd || undefined, env: env || process.env };
  const child = isWin
    ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", [bin, ...args].map(quoteShellArg).join(" ")], {
        ...options,
        // 让 Node 原样传递命令行：否则 libuv 会二次加引号，再叠加 cmd 的 /s 规则会把参数改形。
        windowsVerbatimArguments: true,
      })
    : spawn(bin, args, options);

  let cancelled = false;
  let buffer = "";
  // 前置构建（npm / mvn）的输出同样可能把中文切成两个 chunk：两条流各用一个解码器，
  // 否则一方的半个字符会和另一方拼成乱码。
  const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
  const pushText = (text) => {
    buffer += text;
    let index = buffer.search(/\r?\n/);
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + (buffer[index] === "\r" ? 2 : 1));
      onLine(line);
      index = buffer.search(/\r?\n/);
    }
  };

  const done = new Promise((resolve) => {
    // spawn 本身失败（例如环境块超过平台上限）时只有 error 事件带原因；close 里通常是 -1，
    // 这里把文案留住，close 结算时一并带回，调用点就能在任务日志里显示真实原因。
    let spawnError = "";
    child.stdout?.on("data", (chunk) => pushText(decoders.stdout.write(chunk)));
    child.stderr?.on("data", (chunk) => pushText(decoders.stderr.write(chunk)));
    child.on("error", (error) => {
      spawnError = String(error?.message || error);
      resolve({ code: -1, error: spawnError, cancelled: false });
    });
    child.on("close", (code) => {
      pushText(decoders.stdout.end());
      pushText(decoders.stderr.end());
      if (buffer) onLine(buffer);
      buffer = "";
      resolve({
        code: cancelled ? -1 : Number.isFinite(code) ? code : 1,
        error: spawnError,
        cancelled,
      });
    });
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
      try {
        // Windows 下这里只持有 cmd.exe：必须连 npm / mvn 派生的子进程一起结束。
        killChildTree(child);
      } catch {
        /* 进程已退出，忽略 */
      }
    },
  };
};

/**
 * 前置构建步骤：按 IDEA 的 npm / Maven 口径把配置拼成可执行命令。
 * 不执行时返回 null；cwd 留空就用构建上下文文件夹。
 * packageJson 只用于面板读取 scripts 候选，不参与 cwd 推导。
 */
const requirePreBuild = (raw, fallbackCwd) => {
  const preBuild = normalizeRunConfig({ preBuild: raw }).preBuild;
  if (!preBuild.tool) return null;
  // 这份 env 会整块进子进程环境：超限时 spawn 只会给一个 ERR_* ，先在校验层明确拒绝。
  const invalidEnv = validatePreBuildEnv(preBuild.env);
  if (invalidEnv) throw new DockerError("INVALID_PARAM", invalidEnv);

  const cwd = preBuild.cwd ? requireAbsolutePath(preBuild.cwd, "构建前步骤的工作目录") : fallbackCwd;
  const env = { ...process.env };
  for (const item of preBuild.env || []) env[item.key] = item.value;

  if (preBuild.tool === "maven") {
    const goals = splitRunOptions(preBuild.goals);
    if (!goals || !goals.length) throw new DockerError("INVALID_PARAM", "请填写 Maven 的 goals");
    const args = [...goals];
    if (preBuild.profiles) args.push("-P", preBuild.profiles);
    if (args.length > MAX_PRE_BUILD_ARGS) throw new DockerError("INVALID_PARAM", "构建前步骤的参数太多");
    assertCmdSafe(args);
    if (preBuild.jvmOptions) env.MAVEN_OPTS = [env.MAVEN_OPTS, preBuild.jvmOptions].filter(Boolean).join(" ");
    // PATH 里找不到 mvn 是很常见的失败（Windows 上只会报“不是内部或外部命令”）：
    // 配置里给了 Maven 位置就把它提到 PATH 最前面，mvn.cmd 内部再调 java 也不受影响。
    const mavenBinDir = resolveMavenBinDir(preBuild.mavenPath);
    if (mavenBinDir) {
      if (!existsSync(mavenBinDir)) {
        throw new DockerError(
          "INVALID_PARAM",
          `Maven 目录不存在：${mavenBinDir}；请检查运行配置里的「Maven 可执行文件」`
        );
      }
      env.PATH = [mavenBinDir, env.PATH || ""].filter(Boolean).join(delimiter);
    }
    return { tool: "Maven", bin: pickBin("maven"), args, cwd, env };
  }

  // npm / yarn / pnpm：命令 + 脚本 + 参数，和 IDEA 的 npm 配置拼法一致。
  const manager = PRE_BUILD_BINS[preBuild.packageManager] ? preBuild.packageManager : "npm";
  const isRun = preBuild.command === "run" || preBuild.command === "run-script";
  if (isRun && !preBuild.script) throw new DockerError("INVALID_PARAM", "请填写 npm 的脚本名");
  const extra = splitRunOptions(preBuild.arguments);
  if (!extra) throw new DockerError("INVALID_PARAM", "构建前步骤的参数里引号没有闭合");
  // 只有 run / run-script 才需要脚本名；install / ci / test 等把脚本名当成参数会生成错误命令。
  const args = isRun ? ["run", preBuild.script] : [preBuild.command];
  args.push(...extra);
  if (args.length > MAX_PRE_BUILD_ARGS) throw new DockerError("INVALID_PARAM", "构建前步骤的参数太多");
  assertCmdSafe(args);
  if (preBuild.nodeOptions) {
    env.NODE_OPTIONS = [env.NODE_OPTIONS, preBuild.nodeOptions].filter(Boolean).join(" ");
  }
  // 指定 node 解释器时把它所在目录放到 PATH 最前面，npm 脚本派生的 node 也会用它。
  if (preBuild.nodePath && (preBuild.nodePath.includes("/") || preBuild.nodePath.includes("\\"))) {
    env.PATH = [dirname(preBuild.nodePath), env.PATH || ""].filter(Boolean).join(delimiter);
  }
  return { tool: manager, bin: pickBin(manager), args, cwd, env };
};

/** 按运行配置拼 docker run 参数；返回 { args, error }。 */
const buildRunArgs = (config, image) => {
  const extra = splitRunOptions(config.runOptions);
  if (!extra) return { args: null, error: "运行选项里的引号没有闭合" };
  if (extra.length > MAX_RUN_EXTRA_ARGS) return { args: null, error: "运行选项太多" };
  if (extra.some((item) => item.includes("\0"))) return { args: null, error: "运行选项不合法" };

  const args = ["run", "-d"];
  if (config.containerName) args.push("--name", config.containerName);
  for (const port of config.ports) {
    args.push("-p", `${port.host}:${port.container}${port.protocol === "udp" ? "/udp" : ""}`);
  }
  for (const mount of config.mounts) {
    args.push("-v", `${mount.host}:${mount.container}${mount.readOnly ? ":ro" : ""}`);
  }
  for (const item of config.env) args.push("-e", `${item.key}=${item.value}`);
  args.push(...extra, image);
  return { args, error: "" };
};

const clampTail = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return LIMITS.logsTailDefault;
  return Math.min(Math.floor(parsed), LIMITS.logsTailMax);
};

const isTruthy = (value) => value === "1" || value === "true" || value === "yes";

const requireSshId = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!SSH_ID_PATTERN.test(text)) throw new DockerError("INVALID_PARAM", "SSH 服务器标识不合法");
  return text;
};

/**
 * 表单里刚填的 SSH 目标：先归一化再校验。
 * dockerPath 会被拼进远程 shell 命令，所以必须过白名单。
 */
const requireSshTarget = (body) => {
  const target = normalizeSshServer({
    host: body?.host,
    port: body?.port,
    username: body?.username,
    dockerPath: body?.dockerPath,
  });
  const invalid = validateSshServer(target);
  if (invalid) throw new DockerError("INVALID_PARAM", invalid);
  return target;
};

/** 上传进度按 MB 展示，面板一行一条，不会因为字节流太快刷屏。 */
const formatMegabytes = (bytes) => `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`;

const toPosixPath = (path) => String(path || "").split(/[\\/]/).join("/");

/** path 是否位于 dir 之内（大小写不敏感，兼容 Windows 盘符）。 */
const isInsideDir = (path, dir) => {
  const left = toPosixPath(path).replace(/\/+$/, "").toLowerCase();
  const right = toPosixPath(dir).replace(/\/+$/, "").toLowerCase();
  return Boolean(right) && (left === right || left.startsWith(`${right}/`));
};

/** 任务日志里展示远程目标的统一写法。 */
const remoteLabel = (session) => `${session?.username || ""}@${session?.host || ""}`;

/** 与 settings / ssh 模块一致的默认远程 docker 路径，仅用于会话目标比对。 */
const DEFAULT_REMOTE_DOCKER_PATH = "docker";

/**
 * 会话快照与服务器配置是否指向同一目标。
 * 只比 id 不够：同一台配置被改掉 host / port / username / dockerPath 后，
 * 旧连接仍在旧主机上，构建与 `docker rm -f` 会打到错误的目标。
 */
const isSameSshTarget = (session, server) =>
  Boolean(session && server) &&
  session.id === server.id &&
  session.host === server.host &&
  (Number(session.port) || 22) === (Number(server.port) || 22) &&
  session.username === server.username &&
  String(session.dockerPath || DEFAULT_REMOTE_DOCKER_PATH) ===
    String(server.dockerPath || DEFAULT_REMOTE_DOCKER_PATH);

/**
 * 目标服务器会话：已连接就直接用；没连就用已保存的密码自动连一次。
 * IDEA 的 Docker 工具点一下就能用，正是因为它背后自己把连接建起来，
 * 所以这里也不要求用户先跑到「远程」页手动点连接。
 */
const ensureRemoteSession = async ({ settings, ssh, id }) => {
  const wanted = requireServerId(id);
  if (!wanted) return null;

  const { servers } = await settings.listSshServers();
  const server = (servers || []).find((item) => item.id === wanted);
  if (!server) throw new DockerError("INVALID_PARAM", "运行配置里选的服务器已经不存在了，请重新选择服务器");

  // 只有目标字段全都一致才能复用：改过 host / port 后旧连接仍在旧主机上。
  const current = ssh.getStatus();
  if (current.status === "connected" && isSameSshTarget(current, server)) return current;

  const password = await settings.getSshPassword(wanted);
  if (!password) {
    throw new DockerError(
      "SSH_NOT_CONNECTED",
      `服务器 ${server.name || server.host} 还没有保存 SSH 密码：请到「远程」页填一次密码并保存，之后构建会自动连接`
    );
  }
  let observedHostKey = "";
  let session;
  try {
    // 连接是同步等结果：面板那边的超时给到 2 分钟，覆盖连接 + 远程 docker 探测。
    // 已保存过指纹就核对；首次连接记录到插件存储（TOFU），指纹变化直接阻断。
    session = await ssh.connect({
      ...server,
      id: wanted,
      password,
      hostKey: server.hostKey || "",
      onHostKey: (fingerprint) => {
        observedHostKey = fingerprint;
      },
    });
  } catch (error) {
    if (error?.code === "SSH_HOST_KEY_MISMATCH") throw error;
    throw new DockerError(
      "SSH_FAILED",
      `连不上服务器 ${server.name || server.host}：${String(error?.message || error)}`
    );
  }
  if (observedHostKey) {
    try {
      await settings.setSshHostKey(wanted, observedHostKey);
    } catch {
      // 指纹记录失败不影响本次连接，下次连接会重新记录。
    }
  }
  await settings.setCurrentSshServer(wanted);
  return session;
};

/**
 * 当前 daemon：只支持远程服务器。
 * 没连接时直接报错，面板据此引导用户去「远程」页添加或连接一台服务器。
 */
const activeDockerApi = ({ ssh }) => {
  if (!ssh.isConnected()) {
    throw new DockerError(
      "SSH_NOT_CONNECTED",
      "还没有连接远程服务器：请到「远程」页添加一台服务器并连接"
    );
  }
  return createRemoteDocker({ ssh, session: ssh.getStatus() });
};

/** 远程构建前的统一校验：目标机器上的 docker 得真能用，否则连上传都省了。 */
const requireRemoteDocker = (session) => {
  if (!session) return null;
  if (session.docker && session.docker.ok === false) {
    throw new DockerError(
      "DAEMON_UNAVAILABLE",
      `远程服务器 ${remoteLabel(session)} 上的 Docker 不可用：${session.docker.error || "请检查远程 docker 服务"}`
    );
  }
  return session;
};

/** 构建参数：本机与远程共用同一份，顺序固定。 */
const buildFlags = (body, platform, buildArgs) => {
  const flags = [];
  if (body.noCache === true) flags.push("--no-cache");
  if (body.pull === true) flags.push("--pull");
  if (platform) flags.push("--platform", platform);
  for (const item of buildArgs) flags.push("--build-arg", `${item.key}=${item.value}`);
  return flags;
};

/**
 * 远程构建时 Dockerfile 必须能在上下文目录里找到：
 * 位于上下文内就用相对路径，否则单独把这份 Dockerfile 传到 workspace 的隐藏目录里。
 */
const resolveRemoteDockerfile = async ({ ssh, workspace, dockerfile, context, push, sessionId = "" }) => {
  const root = toPosixPath(context).replace(/\/+$/, "");
  const file = toPosixPath(dockerfile);
  if (isInsideDir(file, root)) {
    const rel = file.slice(`${root}/`.length);
    if (rel && !rel.split("/").includes("..")) return rel;
  }
  const remoteName = `.snow-build/${basename(dockerfile)}`;
  push(`Dockerfile 不在构建上下文里，单独上传到 ${remoteName}`);
  return ssh.uploadFile({ localPath: dockerfile, remoteDir: workspace, name: remoteName, sessionId });
};

/**
 * 远程构建：建临时目录 → 上传上下文 → 在服务器上跑 docker build → 清理临时目录。
 * 本机完全不参与构建，因此不需要 Docker 引擎。
 * control 由任务入口创建：整个流程共用一个取消标记，按阶段替换 abort 指针。
 */
const performRemoteBuild = async ({ ssh, session, context, dockerfile, tag, flags, push, control }) => {
  // 会话快照来自任务创建时：后续每一步都带上它，切机后由 ssh 层拒绝执行。
  const sessionId = session?.id || "";
  // 上传阶段：取消只断开 SFTP，不动主 SSH 连接，保证 finally 的清理仍能执行。
  const upload = new AbortController();
  control.abort = () => upload.abort();
  if (control.cancelled) return { cancelled: true };

  push(`目标服务器：${remoteLabel(session)}（远程构建，本机不装 Docker）`);
  push("正在创建远程临时目录…");
  const workspace = await ssh.createWorkspace({ sessionId });
  try {
    if (control.cancelled) return { cancelled: true };
    push(`上传构建上下文：${context} -> ${workspace}`);
    let reported = 0;
    try {
      await ssh.uploadContext({
        root: context,
        remoteDir: workspace,
        onLine: push,
        signal: upload.signal,
        sessionId,
        onProgress: ({ done, files, bytes }) => {
          // 每 10% 报一行，小上下文也不会刷屏。
          const stride = Math.max(1, Math.ceil(files / 10));
          if (done !== files && done - reported < stride) return;
          reported = done;
          push(`已上传 ${done}/${files} 个文件（${formatMegabytes(bytes)}）`);
        },
      });
    } catch (error) {
      if (control.cancelled || error?.code === "UPLOAD_CANCELLED") return { cancelled: true };
      throw error;
    }
    if (control.cancelled) return { cancelled: true };

    const remoteDockerfile = await resolveRemoteDockerfile({ ssh, workspace, dockerfile, context, push, sessionId });
    if (control.cancelled) return { cancelled: true };
    push(`远程执行 docker build -f ${remoteDockerfile} -t ${tag} ${maskCommandArgs(flags).join(" ")}`.trim());
    const build = ssh.buildImage({ workspace, dockerfile: remoteDockerfile, tag, flags, onLine: push, sessionId });
    control.abort = build.cancel;
    if (control.cancelled) build.cancel();
    const built = await build.done;
    if (built.cancelled || control.cancelled) return { cancelled: true };
    if (built.code !== 0) {
      push(`远程构建失败（exit=${built.code}）`);
      return { code: built.code };
    }
    return { code: 0 };
  } finally {
    // 清理期间不再接受取消，避免把 removeWorkspace 的 SSH 通道关掉。
    control.abort = () => {};
    push("清理远程临时目录");
    // removeWorkspace 失败时只返回 false，必须显式提示：否则服务器上会静默残留完整构建上下文。
    let removed = false;
    try {
      removed = await ssh.removeWorkspace(workspace, { sessionId });
    } catch (error) {
      push(`清理远程临时目录失败：${error?.message || error}`);
    }
    if (!removed) {
      const switched = ssh.getStatus().id !== sessionId;
      push(
        switched
          ? `目标服务器已切换，无法自动删除远程临时目录：${workspace}；请在原服务器上手动执行 rm -rf ${workspace}`
          : `远程临时目录未能删除：${workspace}；请登录服务器手动执行 rm -rf ${workspace}`
      );
    }
  }
};

/**
 * 重跑同名容器：docker run 不允许两个同名容器，IDEA 的 Docker 运行配置同样会先替换旧容器。
 * 容器本来就不存在时 rm 会失败，这里忽略，只在真删掉时提示一行。
 */
const replaceNamedContainer = async ({ docker, ssh, remote, sessionId = "", name, push }) => {
  const containerName = String(name || "").trim();
  if (!containerName) return;
  push(`重跑前替换同名容器 ${containerName}`);
  const args = ["rm", "-f", containerName];
  let code = -1;
  if (remote) {
    // 目标在任务运行期间被切走时必须中止：绝不能在另一台主机上删同名容器。
    const result = await ssh.execDocker({ args, onLine: () => {}, sessionId }).done.catch((error) => {
      if (error?.code === "SSH_TARGET_CHANGED") throw error;
      return null;
    });
    code = result?.code ?? -1;
  } else {
    const result = await docker.stream(args, { onLine: () => {} }).done.catch(() => null);
    code = result?.code ?? -1;
  }
  if (code === 0) push(`已删除原有容器 ${containerName}`);
};

const toStatus = (error) => {
  switch (error?.code) {
    case "DOCKER_NOT_FOUND":
      return 503;
    case "DAEMON_UNAVAILABLE":
      return 503;
    case "DOCKER_TIMEOUT":
      return 504;
    case "CONTAINER_NOT_FOUND":
    case "IMAGE_NOT_FOUND":
    case "NOT_FOUND":
    case "TASK_NOT_FOUND":
      return 404;
    case "INVALID_PARAM":
    case "INVALID_BODY":
    case "INVALID_ACTION":
    case "RUN_CONFIG_LIMIT":
      return 400;
    case "REQUEST_TOO_LARGE":
      return 413;
    case "PERMISSION_DENIED":
      return 403;
    case "IMAGE_NOT_LOCAL":
      return 409;
    case "SSH_NOT_CONNECTED":
    case "SSH_HOST_KEY_MISMATCH":
    case "SSH_TARGET_CHANGED":
      return 409;
    case "SSH_FAILED":
      return 502;
    case "SETTINGS_UNAVAILABLE":
      return 503;
    default:
      return 502;
  }
};

/**
 * compose 相关命令只在本机执行（compose 文件是本机路径，远端没有同名文件）。
 * 面板据此在卡片上标注「本机执行」，并在本机 docker 不可用时禁用按钮。
 * 结果缓存十几秒，避免同一轮扫描对每个 compose 文件都探一次。
 */
let localDockerProbe = { at: 0, value: null };
const probeLocalDocker = async (docker) => {
  if (localDockerProbe.value && Date.now() - localDockerProbe.at < 15000) return localDockerProbe.value;
  let result;
  try {
    result = await docker.ping();
  } catch (error) {
    result = { ok: false, message: String(error?.message || error) };
  }
  const value = {
    available: result?.ok === true,
    error: result?.ok === true ? "" : String(result?.message || ""),
  };
  localDockerProbe = { at: Date.now(), value };
  return value;
};

/**
 * 处理一次面板请求。返回 { status, payload }，由外层统一写回。
 */
const handleRequest = async ({ docker, settings, tasks, ssh, logStreams, version, startedAt, tokenEnforced, req, pathname, query }) => {
  const method = (req.method || "GET").toUpperCase();

  if (pathname === ROUTES.health) {
    return {
      status: 200,
      payload: {
        ok: true,
        pluginId: PLUGIN_ID,
        version,
        pid: process.pid,
        startedAt,
        uptimeMs: Date.now() - startedAt,
        // 令牌始终生效（没有令牌时服务不会启动）；字段保留给面板判断通道是否降级。
        tokenEnforced,
      },
    };
  }

  if (pathname === ROUTES.system && method === "GET") {
    return { status: 200, payload: await activeDockerApi({ ssh }).system() };
  }

  if (pathname === ROUTES.containers && method === "GET") {
    const allParam = query.get("all");
    const all = allParam === null ? true : isTruthy(allParam);
    // target 取自执行这条命令的同一个 api 实例：面板据此判断这批数据属于哪台服务器。
    const api = activeDockerApi({ ssh });
    const payload = await api.listContainers({ all });
    return { status: 200, payload: { ...payload, target: api.target } };
  }

  if (pathname === ROUTES.settings) {
    if (method === "GET") return { status: 200, payload: connectionPayload(await settings.get()) };
    if (method === "POST") {
      const body = await readJsonBody(req);
      const currentSettings = await settings.get();
      // 只改本机 docker 目标三项；SSH 服务器与密码走 /ssh/save，避免两条写入路径。
      const merged = normalizeSettings({
        ...currentSettings,
        cliPath: body.cliPath ?? currentSettings.cliPath,
        dockerHost: body.dockerHost ?? currentSettings.dockerHost,
        context: body.context ?? currentSettings.context,
      });
      // 校验放在路由层：非法值要作为 400 返回，而不是落库后由 docker 报错。
      const invalid = validateSettings(merged);
      if (invalid) throw new DockerError("INVALID_PARAM", invalid);
      const saved = await settings.save({
        cliPath: merged.cliPath,
        dockerHost: merged.dockerHost,
        context: merged.context,
      });
      // 本机 CLI 目标变了：compose 的探活缓存立即失效，面板不用等 15 秒。
      localDockerProbe = { at: 0, value: null };
      return { status: 200, payload: connectionPayload(saved) };
    }
  }

  if (pathname === ROUTES.sshStatus && method === "GET") {
    // 会话状态 + 服务器清单一起返回：面板一次请求就能画出列表与连接状态。
    const list = await settings.listSshServers();
    return { status: 200, payload: { ...ssh.getStatus(), ...list } };
  }

  if (pathname === ROUTES.sshSave && method === "POST") {
    const body = await readJsonBody(req);
    const server = normalizeSshServer(body.server || {});
    const invalid = validateSshServer(server);
    if (invalid) throw new DockerError("INVALID_PARAM", invalid);
    const password = typeof body.password === "string" ? body.password : "";
    const saved = await settings.saveSshServer({
      server,
      password,
      clearHostKey: body.resetHostKey === true,
      clearPassword: body.clearPassword === true,
    });
    // 目标字段被改过就断开旧会话：容器 / 镜像等路由直接使用会话快照，
    // 不断开会造成「界面显示新目标、命令仍打到旧主机」。
    const live = ssh.getStatus();
    const savedServer = (saved.servers || []).find((item) => item.id === saved.savedId);
    if (savedServer && live.status === "connected" && live.id === saved.savedId && !isSameSshTarget(live, savedServer)) {
      await ssh.disconnect();
    }
    return { status: 200, payload: saved };
  }

  if (pathname === ROUTES.sshRemove && method === "POST") {
    const body = await readJsonBody(req);
    const id = requireSshId(body.id);
    // 删掉的正是当前连接：先断开，避免面板停在一个已不存在的目标上。
    if (ssh.getStatus().id === id) await ssh.disconnect();
    return { status: 200, payload: await settings.removeSshServer(id) };
  }

  if (pathname === ROUTES.sshConnect && method === "POST") {
    const body = await readJsonBody(req);
    const id = requireSshId(body.id);
    const { servers } = await settings.listSshServers();
    const server = servers.find((item) => item.id === id);
    if (!server) throw new DockerError("INVALID_PARAM", "SSH 服务器不存在，请先保存配置");
    const password = await settings.getSshPassword(id);
    if (!password) throw new DockerError("INVALID_PARAM", "请先填写并保存该服务器的 SSH 密码");
    let observedHostKey = "";
    const result = await ssh.connect({
      ...server,
      id,
      password,
      hostKey: server.hostKey || "",
      onHostKey: (fingerprint) => {
        observedHostKey = fingerprint;
      },
    });
    if (observedHostKey) {
      try {
        await settings.setSshHostKey(id, observedHostKey);
      } catch {
        // 指纹记录失败不影响本次连接，下次连接会重新记录。
      }
    }
    await settings.setCurrentSshServer(id);
    return { status: 200, payload: result };
  }

  if (pathname === ROUTES.sshDisconnect && method === "POST") {
    return { status: 200, payload: await ssh.disconnect() };
  }

  if (pathname === ROUTES.sshTest && method === "POST") {
    const body = await readJsonBody(req);
    const target = requireSshTarget(body);
    const id = typeof body.id === "string" && SSH_ID_PATTERN.test(body.id) ? body.id : "";
    // 表单里刚填的密码优先；没填就沿用该服务器已保存的那份。
    const password =
      typeof body.password === "string" && body.password ? body.password : id ? await settings.getSshPassword(id) : "";
    if (!password) throw new DockerError("INVALID_PARAM", "请先填写 SSH 密码");
    // 已保存过主机指纹就核对；测试连接只验证，不会写入新的信任记录。
    // 表单里的主机 / 端口改成了别的目标时不能拿旧指纹去比对，否则会误报指纹变化。
    const { servers } = await settings.listSshServers();
    const saved = servers.find((item) => item.id === id) || null;
    const sameTarget = Boolean(saved && saved.host === target.host && saved.port === target.port);
    return {
      status: 200,
      payload: await ssh.testConnection({
        ...target,
        password,
        hostKey: sameTarget ? saved.hostKey || "" : "",
      }),
    };
  }

  if (pathname === ROUTES.sshUpload && method === "POST") {
    const body = await readJsonBody(req);
    const image = requireImageRef(body.image);
    // 上传目标：没连接就按已保存的密码自动连一次，不让用户先去「远程」页点连接。
    const wanted = requireServerId(body.serverId ?? body.sshId);
    if (!wanted) throw new DockerError("INVALID_PARAM", "请选择要上传到的服务器");
    const session = requireRemoteDocker(await ensureRemoteSession({ settings, ssh, id: wanted }));
    // 界面上的镜像列表跟随当前连接的服务器，而上传只发送本机同名镜像：
    // 先确认本机真的有它，否则明确说明数据来源，而不是只抛一句 No such image。
    const runtime = getDockerRuntime();
    const local = await ssh.inspectLocalImage({
      image,
      localBin: runtime.bin || "docker",
      localEnv: runtime.env,
    });
    if (!local.found) {
      // 预检失败可能是「本机没有该镜像」，也可能是 daemon 卡住被超时终止：把原因一起给出。
      const detail = local.error ? `：${local.error}` : "";
      throw new DockerError(
        "IMAGE_NOT_LOCAL",
        `上传只发送本机同名镜像，本机没有 ${image}${detail}。镜像列表跟随当前连接的服务器：请在那台服务器上直接拉取，或先在本机构建该镜像后再上传。`
      );
    }
    // 上传走任务执行器：面板沿用 /task 轮询看进度，也能中途取消。
    const { id } = tasks.startCustom({
      kind: "upload",
      title: image,
      run: ({ push, setCancelHandler }) => {
        const runtime = getDockerRuntime();
        // 上传任务同样绑定发起时的服务器：期间切机就中止，不能把镜像 load 到别的主机。
        const sessionId = session?.id || wanted;
        push(`开始上传 ${image} -> ${session.username}@${session.host}`);
        const transfer = ssh.uploadImage({
          image,
          localBin: runtime.bin || "docker",
          localEnv: runtime.env,
          sessionId,
          onLine: push,
          onProgress: ({ bytes }) => push(`已传输 ${formatMegabytes(bytes)}`),
        });
        setCancelHandler(transfer.cancel);
        return transfer.done;
      },
    });
    return { status: 200, payload: { taskId: id, image, serverId: wanted } };
  }

  if (pathname === ROUTES.detect && method === "GET") {
    return { status: 200, payload: await docker.detect() };
  }

  if (pathname === ROUTES.projectScan && method === "POST") {
    const body = await readJsonBody(req);
    const root = requireAbsolutePath(body.root, "项目路径");
    // 运行配置里的 Dockerfile 路径一并参与扫描：扫描规则覆盖不到的目录靠它兜底。
    const runConfigs = await settings.getRunConfigs();
    const scanned = await scanProject(root, { extraPaths: Object.keys(runConfigs) });
    // 列表只回摘要：env 值与完整配置按路径单独读取，避免每次扫描把整表连私钥一起下发。
    return { status: 200, payload: { ...scanned, runConfigSummaries: summarizeRunConfigs(runConfigs) } };
  }

  // 单条读取走独立 GET：读取是幂等操作，不能挂在保存路由上。
  // 后台还是旧版本时这条路径不存在，会返回「未知接口」，面板据此提示重启 App；
  // 若复用 POST，旧后台会把读请求当成保存空配置，报出与读取无关的错误。
  if (pathname === ROUTES.projectConfigRead && method === "GET") {
    const dockerfile = requireDockerfilePath(query.get("dockerfile"));
    const config = await settings.getRunConfig(dockerfile);
    return { status: 200, payload: { dockerfile, config } };
  }

  if (pathname === ROUTES.projectConfig && method === "POST") {
    const body = await readJsonBody(req);
    const dockerfile = requireDockerfilePath(body.dockerfile);
    if (body.remove === true) {
      const removed = await settings.removeRunConfig(dockerfile);
      return { status: 200, payload: { dockerfile, ...removed } };
    }
    // 保存与手动登记只接受项目内的路径：扫描会跳过项目外路径，
    // 静默保存只会留下界面上看不到、也删不掉的配置项。
    const root = typeof body.root === "string" && body.root.trim() ? requireAbsolutePath(body.root, "项目路径") : "";
    if (root && !isInsideProject(dockerfile, root)) {
      throw new DockerError("INVALID_PARAM", `Dockerfile 必须位于当前项目目录内：${root}`);
    }
    const config = normalizeRunConfig(body.config || {});
    // 手动登记只需要一条占位配置：先把路径存下来，服务器留到真正构建 / 运行时再选。
    const requireServer = body.register !== true;
    const invalid = validateRunConfig(config, { requireServer });
    if (invalid) throw new DockerError("INVALID_PARAM", invalid);
    // 新增条目超过上限时明确拒绝，而不是让全表归一化把它静默丢掉；更新已有条目不受限制。
    const existing = await settings.getRunConfigs();
    if (!existing[dockerfile] && Object.keys(existing).length >= MAX_RUN_CONFIGS) {
      throw new DockerError(
        "RUN_CONFIG_LIMIT",
        `最多保存 ${MAX_RUN_CONFIGS} 条运行配置，请先删除不再使用的配置后再保存`
      );
    }
    return { status: 200, payload: await settings.saveRunConfig({ dockerfile, config, requireServer }) };
  }

  if (pathname === ROUTES.projectPackageScripts && method === "GET") {
    // 面板「构建前执行」的脚本候选：path 明确指定 package.json，dir 表示按目录找。
    const scripts = await readPackageScripts({
      path: query.get("path") || "",
      dir: query.get("dir") || "",
    });
    return { status: 200, payload: scripts };
  }

  if (pathname === ROUTES.projectBuild && method === "POST") {
    const body = await readJsonBody(req);
    const dockerfile = requireDockerfilePath(body.dockerfile);
    const tag = requireTag(body.tag);
    const context =
      typeof body.context === "string" && body.context.trim()
        ? requireAbsolutePath(body.context, "构建上下文")
        : dirname(dockerfile);
    const platform = requirePlatform(body.platform);
    const buildArgs = requireBuildArgs(body.buildArgs);
    const flags = buildFlags(body, platform, buildArgs);
    // 服务器沿用运行配置里的字段：旧配置里的 sshId 也认。
    const uploadId = requireServerId(body.serverId ?? body.sshId);
    if (!uploadId) {
      throw new DockerError("INVALID_PARAM", "请先在运行配置里选择一台远程服务器：本插件只通过 SSH 操作远程 Docker");
    }
    // 构建前置步骤：先打包再构建镜像，工作目录默认取构建上下文。
    const preBuild = requirePreBuild(body.preBuild, context);

    // 构建只在服务器上执行：没连接时会用已保存的密码自动连一次。
    const remote = requireRemoteDocker(await ensureRemoteSession({ settings, ssh, id: uploadId }));

    // 构建走自定义任务：日志实时推给面板，构建成功后可按配置接着上传到远程。
    const { id } = tasks.startCustom({
      kind: "build",
      title: tag,
      run: async ({ push, setCancelHandler }) => {
        const control = { cancelled: false, abort: () => {} };
        // 整条任务只注册一次：任何阶段点取消都真正生效，也不会命中已经结束的子进程。
        setCancelHandler(() => {
          control.cancelled = true;
          try {
            control.abort();
          } catch {
            // abort 自身失败不影响状态收敛。
          }
        });
        if (control.cancelled) return { cancelled: true };
        if (preBuild) {
          push(`前置构建（${preBuild.tool}）：${preBuild.bin} ${preBuild.args.join(" ")}`);
          push(`工作目录：${preBuild.cwd}`);
          if (remote && !isInsideDir(preBuild.cwd, context)) {
            push(`注意：前置构建的工作目录不在构建上下文 ${context} 里，产物不会随上下文上传`);
          }
          const step = spawnStream({
            bin: preBuild.bin,
            args: preBuild.args,
            cwd: preBuild.cwd,
            env: preBuild.env,
            onLine: push,
          });
          control.abort = step.cancel;
          if (control.cancelled) step.cancel();
          const stepResult = await step.done;
          if (stepResult.cancelled || control.cancelled) return { cancelled: true };
          if (stepResult.code !== 0) {
            push(
              `前置构建失败（exit=${stepResult.code}）${
                stepResult.error ? `：${stepResult.error}` : ""
              }，已中止 docker build`
            );
            return { code: stepResult.code, error: stepResult.error || "" };
          }
          push("前置构建完成，开始构建镜像");
        }

        const built = await performRemoteBuild({ ssh, session: remote, context, dockerfile, tag, flags, push, control });
        if (built.cancelled) return { cancelled: true };
        if (control.cancelled) return { cancelled: true };
        if ((built.code ?? 0) === 0) push(`镜像 ${tag} 已经建在 ${remoteLabel(remote)} 上`);
        return { code: built.code ?? 0 };
      },
    });
    return {
      status: 200,
      payload: { taskId: id, tag, dockerfile, context, serverId: uploadId, remote: Boolean(remote) },
    };
  }

  if (pathname === ROUTES.projectBuildRun && method === "POST") {
    const body = await readJsonBody(req);
    const dockerfile = requireDockerfilePath(body.dockerfile);
    const tag = requireTag(body.tag);
    const context =
      typeof body.context === "string" && body.context.trim()
        ? requireAbsolutePath(body.context, "构建上下文")
        : dirname(dockerfile);
    const platform = requirePlatform(body.platform);
    const buildArgs = requireBuildArgs(body.buildArgs);
    const flags = buildFlags(body, platform, buildArgs);
    const preBuild = requirePreBuild(body.preBuild, context);

    const config = normalizeRunConfig(body.config || {});
    const invalid = validateRunConfig(config);
    if (invalid) throw new DockerError("INVALID_PARAM", invalid);
    const runArgs = buildRunArgs(config, tag);
    if (!runArgs.args) throw new DockerError("INVALID_PARAM", runArgs.error);

    // 目标服务器：构建与运行都跟着它走；没连上时会用已保存的密码自动连一次。
    const uploadId = requireServerId(body.serverId ?? body.sshId) || config.serverId;
    if (!uploadId) {
      throw new DockerError("INVALID_PARAM", "请先在运行配置里选择一台远程服务器：本插件只通过 SSH 操作远程 Docker");
    }
    const remote = requireRemoteDocker(await ensureRemoteSession({ settings, ssh, id: uploadId }));

    // IDEA 的 Dockerfile 运行按钮就是这条链路：一次性「前置构建 → docker build → 运行」。
    const { id } = tasks.startCustom({
      kind: "build-run",
      title: config.containerName || tag,
      run: async ({ push, setCancelHandler }) => {
        const control = { cancelled: false, abort: () => {} };
        // 整条任务只注册一次：前置构建、上传、build、run 任一阶段取消都能真正生效。
        setCancelHandler(() => {
          control.cancelled = true;
          try {
            control.abort();
          } catch {
            // abort 自身失败不影响状态收敛。
          }
        });
        if (control.cancelled) return { cancelled: true };
        if (preBuild) {
          push(`前置构建（${preBuild.tool}）：${preBuild.bin} ${preBuild.args.join(" ")}`);
          push(`工作目录：${preBuild.cwd}`);
          if (remote && !isInsideDir(preBuild.cwd, context)) {
            push(`注意：前置构建的工作目录不在构建上下文 ${context} 里，产物不会随上下文上传`);
          }
          const step = spawnStream({
            bin: preBuild.bin,
            args: preBuild.args,
            cwd: preBuild.cwd,
            env: preBuild.env,
            onLine: push,
          });
          control.abort = step.cancel;
          if (control.cancelled) step.cancel();
          const stepResult = await step.done;
          if (stepResult.cancelled || control.cancelled) return { cancelled: true };
          if (stepResult.code !== 0) {
            push(
              `前置构建失败（exit=${stepResult.code}）${stepResult.error ? `：${stepResult.error}` : ""}，已中止`
            );
            return { code: stepResult.code, error: stepResult.error || "" };
          }
          push("前置构建完成，开始构建镜像");
        }

        const built = await performRemoteBuild({ ssh, session: remote, context, dockerfile, tag, flags, push, control });
        if (built.cancelled) return { cancelled: true };
        if ((built.code ?? 0) !== 0) return { code: built.code ?? 1 };
        if (control.cancelled) return { cancelled: true };

        const sessionId = remote?.id || uploadId;
        await replaceNamedContainer({ docker, ssh, remote: true, sessionId, name: config.containerName, push });
        if (control.cancelled) return { cancelled: true };
        push(`远程执行 docker ${maskCommandArgs(runArgs.args).join(" ")}`);
        const exec = ssh.execDocker({ args: runArgs.args, onLine: push, sessionId });
        control.abort = exec.cancel;
        if (control.cancelled) exec.cancel();
        const result = await exec.done;
        if (result?.cancelled === true || control.cancelled) return { cancelled: true };
        if (result?.code === 0) push(`容器已在 ${remoteLabel(remote)} 上启动`);
        return { code: result?.code ?? 0 };
      },
    });
    return {
      status: 200,
      payload: { taskId: id, tag, dockerfile, context, serverId: uploadId, remote: Boolean(remote) },
    };
  }

  if (pathname === ROUTES.projectRun && method === "POST") {
    const body = await readJsonBody(req);
    const image = requireImageRef(body.image);
    const config = normalizeRunConfig(body.config || {});
    const invalid = validateRunConfig(config);
    if (invalid) throw new DockerError("INVALID_PARAM", invalid);

    const { args, error } = buildRunArgs(config, image);
    if (!args) throw new DockerError("INVALID_PARAM", error);

    const title = config.containerName || image;
    // 只支持远程：没连接时会用已保存的密码自动连一次。
    const session = requireRemoteDocker(await ensureRemoteSession({ settings, ssh, id: config.serverId }));
    const { id } = tasks.startCustom({
      kind: "run",
      title,
      run: async ({ push, setCancelHandler }) => {
        const sessionId = session?.id || config.serverId;
        await replaceNamedContainer({ docker, ssh, remote: true, sessionId, name: config.containerName, push });
        push(`远程执行 docker ${maskCommandArgs(args).join(" ")}`);
        const exec = ssh.execDocker({ args, onLine: push, sessionId });
        setCancelHandler(exec.cancel);
        const result = await exec.done;
        if (result?.cancelled === true) return { cancelled: true };
        if (result?.code === 0) push(`容器已在 ${remoteLabel(session)} 上启动`);
        return { code: result?.code ?? 0 };
      },
    });
    // args 里可能带 -e KEY=VALUE：响应同样过掩码，面板不需要明文值。
    return { status: 200, payload: { taskId: id, image, args: maskCommandArgs(args), serverId: config.serverId } };
  }

  if (pathname === ROUTES.composeServices && method === "GET") {
    const file = requireComposeFile(query.get("file"));
    const [names, status, local] = await Promise.all([
      docker.composeServiceNames(file).catch(() => []),
      docker
        .composeServices(file)
        .catch((error) => ({ services: [], error: String(error?.message || error) })),
      probeLocalDocker(docker),
    ]);
    // mode 明确告诉面板：compose 走本机 docker，与顶部选中的服务器无关。
    return {
      status: 200,
      payload: { file, names, services: status.services, error: status.error, mode: "local", local },
    };
  }

  if (pathname === ROUTES.composeAction && method === "POST") {
    const body = await readJsonBody(req);
    const file = requireComposeFile(body.file);
    const action = typeof body.action === "string" ? body.action.trim() : "";
    const table = {
      up: ["compose", "-f", file, "up", "-d"],
      down: ["compose", "-f", file, "down"],
      stop: ["compose", "-f", file, "stop"],
      restart: ["compose", "-f", file, "restart"],
    };
    const args = table[action];
    if (!args) throw new DockerError("INVALID_ACTION", `不支持的 compose 操作：${action}`);
    // 本机 docker 不可用就直说，别让面板只看到一条 spawn 失败。
    const local = await probeLocalDocker(docker);
    if (!local.available) {
      throw new DockerError("DAEMON_UNAVAILABLE", local.error || "本机 docker 不可用，无法执行 compose 操作");
    }
    const { id } = tasks.start({
      kind: `compose-${action}`,
      title: `${basename(file)} ${action}`,
      args,
      cwd: dirname(file),
    });
    return { status: 200, payload: { taskId: id, file, action, mode: "local" } };
  }

  if (pathname === ROUTES.task && method === "GET") {
    const offset = Number(query.get("offset") || 0);
    const task = tasks.get(query.get("id"), Number.isFinite(offset) ? offset : 0);
    if (!task) throw new DockerError("TASK_NOT_FOUND", "任务不存在或已过期");
    return { status: 200, payload: task };
  }

  if (pathname === ROUTES.taskCancel && method === "POST") {
    const body = await readJsonBody(req);
    const cancelled = tasks.cancel(body.id);
    return { status: 200, payload: { id: String(body.id || ""), cancelled } };
  }

  if (pathname === ROUTES.images && method === "GET") {
    const api = activeDockerApi({ ssh });
    const payload = await api.listImages();
    return { status: 200, payload: { ...payload, target: api.target } };
  }

  if (pathname === ROUTES.containerInspect && method === "GET") {
    const id = requireContainerId(query.get("id"));
    return { status: 200, payload: await activeDockerApi({ ssh }).inspectContainer(id) };
  }

  if (pathname === ROUTES.containerLogs && method === "GET") {
    const id = requireContainerId(query.get("id"));
    const tail = clampTail(query.get("tail"));
    const offsetRaw = query.get("offset");
    const offset = offsetRaw === null || offsetRaw === "" ? null : Number(offsetRaw);
    const api = activeDockerApi({ ssh });
    const targetKey = api?.target?.kind === "remote" ? `remote:${api.target.id || ""}` : "local";
    return {
      status: 200,
      payload: await logStreams.read({
        api,
        targetKey,
        containerId: id,
        tail,
        streamId: String(query.get("streamId") || ""),
        offset,
        reset: isTruthy(query.get("reset")),
      }),
    };
  }

  if (pathname === ROUTES.containerStats && method === "GET") {
    const id = requireContainerId(query.get("id"));
    return { status: 200, payload: await activeDockerApi({ ssh }).containerStats(id) };
  }

  if (pathname === ROUTES.containerAction && method === "POST") {
    const body = await readJsonBody(req);
    const id = requireContainerId(body.id);
    const action = typeof body.action === "string" ? body.action.trim() : "";
    return {
      status: 200,
      payload: await activeDockerApi({ ssh }).containerAction(id, action, { force: body.force === true }),
    };
  }

  if (pathname === ROUTES.imagePull && method === "POST") {
    const body = await readJsonBody(req);
    const reference = requireImageRef(body.reference);
    // 拉取可能远超两分钟，而面板的 api.net.fetch 有 120 秒上限：改成任务化，
    // 由 /task 轮询进度，既能取消，也不会把仍在进行的拉取误报成失败。
    const api = activeDockerApi({ ssh });
    const sessionId = api?.target?.id || "";
    const { id } = tasks.startCustom({
      kind: "pull",
      title: reference,
      run: async ({ push, setCancelHandler }) => {
        push(`开始拉取 ${reference}`);
        const exec = ssh.execDocker({
          args: ["pull", reference],
          onLine: push,
          timeoutMs: LIMITS.pullTimeoutMs,
          sessionId,
        });
        setCancelHandler(exec.cancel);
        const result = await exec.done;
        if (result?.cancelled === true) return { cancelled: true };
        return { code: result?.code ?? 0 };
      },
    });
    return { status: 200, payload: { taskId: id, reference, serverId: sessionId } };
  }

  if (pathname === ROUTES.imageRemove && method === "POST") {
    const body = await readJsonBody(req);
    const reference = requireImageRef(body.reference);
    return { status: 200, payload: await activeDockerApi({ ssh }).removeImage(reference, { force: body.force === true }) };
  }

  throw new DockerError("NOT_FOUND", `未知接口：${pathname}`);
};

/**
 * 起服务：从 portFirst 逐个试到 portLast，取第一个能绑定的端口。
 * 端口与令牌由调用方发布到插件私有存储，面板按那条记录连接，不再扫描端口。
 */
export async function startServer({
  docker,
  settings,
  tasks,
  ssh,
  version,
  channelToken = "",
  log = () => {},
  portFirst = PORT_FIRST,
  portLast = PORT_LAST,
}) {
  const startedAt = Date.now();
  const token = String(channelToken || "");
  // 没有令牌等于任何本机进程都能调用写接口：宁可不启动，也不退化成只校验固定请求头。
  if (!token) throw new DockerError("CHANNEL_TOKEN_MISSING", "未配置通道令牌，拒绝启动本地服务");
  const logStreams = createLogStreamManager({ log });

  const handler = async (req, res) => {
    // 通道头挡掉网页跨站请求；令牌挡掉本机其它进程（固定头它们可以照抄）。
    const channelOk = String(req.headers[CHANNEL_HEADER] || "") === CHANNEL_HEADER_VALUE;
    const tokenOk = String(req.headers[CHANNEL_TOKEN_HEADER] || "") === token;
    if (!channelOk || !tokenOk) {
      sendError(res, 403, "FORBIDDEN", channelOk ? "通道令牌无效，请重新打开插件面板" : "缺少通道头");
      return;
    }

    let url;
    try {
      url = new URL(req.url || "/", `http://${HOST}`);
    } catch {
      sendError(res, 400, "INVALID_URL", "请求地址不合法");
      return;
    }

    try {
      const result = await handleRequest({
        docker,
        settings,
        tasks,
        ssh,
        logStreams,
        version,
        startedAt,
        // 令牌始终生效：没有令牌时服务不会启动，这里只把通道状态交给面板。
        tokenEnforced: Boolean(token),
        req,
        pathname: url.pathname,
        query: url.searchParams,
      });
      sendJson(res, result.status, result.payload);
    } catch (error) {
      const code = error instanceof DockerError ? error.code : "INTERNAL";
      const status = toStatus(error);
      if (code === "INTERNAL") log(`请求失败 ${url.pathname}: ${error?.message || error}`);
      if (code === "REQUEST_TOO_LARGE") {
        // 请求体还在发送：先把 413 写回去，再断开这条半截连接。
        res.once("finish", () => {
          try {
            req.destroy();
          } catch {
            // 连接可能已断开。
          }
        });
      }
      sendError(res, status, code, String(error?.message || error));
    }
  };

  const tryListen = (port) =>
    new Promise((resolve, reject) => {
      const server = createServer(handler);
      // bind 阶段失败：具名后才能在 listening 时按同一个引用摘掉，不能传 Promise 的 reject。
      const onListenError = (error) => {
        server.removeListener("listening", onListening);
        server.close(() => {});
        reject(error);
      };
      const onListening = () => {
        // 先摘掉失败处理器，再挂运行期处理器：运行期出错只记日志，绝不能清监听。
        server.removeListener("error", onListenError);
        server.on("error", (error) => {
          log(`本地服务错误：${error?.code ? `${error.code} ` : ""}${error?.message || error}`);
        });
        resolve(server);
      };
      server.once("error", onListenError);
      server.once("listening", onListening);
      server.listen(port, HOST);
    });

  let server = null;
  let port = 0;
  let lastError = null;
  for (let candidate = portFirst; candidate <= portLast; candidate += 1) {
    try {
      server = await tryListen(candidate);
      port = candidate;
      break;
    } catch (error) {
      lastError = error;
      if (error?.code !== "EADDRINUSE") break;
    }
  }

  if (!server) {
    throw new DockerError("BIND_FAILED", `无法在 ${portFirst}-${portLast} 内绑定端口：${lastError?.message || lastError}`);
  }

  log(`本地服务已监听 http://${HOST}:${port}`);

  return {
    port,
    url: `http://${HOST}:${port}`,
    close: () =>
      new Promise((resolve) => {
        logStreams.stop();
        server.close(() => resolve());
        // 长连接兜底：不给连接无限拖延关闭流程。
        setTimeout(() => resolve(), 1500).unref?.();
      }),
  };
}
