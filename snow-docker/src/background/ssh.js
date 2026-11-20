// SSH 会话：账号密码登录远程主机，把本地镜像推到远程 Docker。
// 和「隧道」方案不同：不把远程 daemon 映射回本机端口，本机 CLI 只操作本机 daemon；
// 上传镜像时把 `docker save` 的字节流直接灌进远程 `docker load` 的 stdin，不落临时文件。
// 远程构建：把构建上下文用 SFTP 传到远程临时目录，在服务器上直接跑 docker build，
// 本机完全不装 Docker；构建完会删掉那个临时目录。
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Client } from "ssh2";
import { DockerError, classifyFailure, parseJson } from "./docker.js";
import { killChildTree } from "./process.js";
import { DOCKER_PATH_PATTERN } from "../shared/contract.js";

const CONNECT_TIMEOUT_MS = 20000;
const EXEC_TIMEOUT_MS = 20000;
const EXEC_MAX_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;
const MAX_STREAM_BYTES = 32 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 15000;
/** 本机镜像预检只查一次 inspect：daemon 无响应时必须快速失败，不能拖住上传入口。 */
const LOCAL_INSPECT_TIMEOUT_MS = 10000;
const PROGRESS_INTERVAL_MS = 1000;
/** 上传大镜像可能持续很久，这里只做整体兜底，避免会话挂死。 */
const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;
/**
 * 远程通道的 exit 与 close 通常只差一个事件循环：exit 先到后给 close 一点宽限期收尾剩余输出，
 * 超过宽限期仍没有 close 才按 exit 结算（少数通道只发 exit 不发 close）。
 */
const REMOTE_EXIT_GRACE_MS = 300;
/** 远程构建可能跑很久（拉基础镜像 + 多层构建），单独给一小时。 */
const BUILD_TIMEOUT_MS = 60 * 60 * 1000;
/** 上下文上传上限：超过就让用户补 .dockerignore 或换更小的上下文。 */
const MAX_CONTEXT_FILES = 20000;
const MAX_CONTEXT_BYTES = 1024 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 4;
const SFTP_MKDIR_MODE = 0o755;
const DEFAULT_DOCKER_PATH = "docker";
const DEFAULT_LOCAL_BIN = "docker";

/**
 * 远程 docker 可执行文件会被拼进远程 shell 命令，只允许白名单字符。
 * 存储或备份里出现非法值时一律回退 docker，而不是拼进命令。
 */
const resolveDockerPath = (value) => {
  const text = String(value || "").trim();
  return DOCKER_PATH_PATTERN.test(text) ? text : DEFAULT_DOCKER_PATH;
};

/** 远程临时目录前缀：删除时只认这个前缀，避免误删别的目录。 */
const WORKSPACE_PREFIX = "snow-docker-";
const WORKSPACE_PATH = /^\/[A-Za-z0-9._/-]+$/;
/**
 * 不进构建上下文的目录：仓库元数据、依赖缓存与本机 IDE 配置。
 * 注意 dist / target / build 不能忽略——它们往往正是 Dockerfile 要 COPY 的产物。
 */
const CONTEXT_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".idea",
  ".vscode",
  ".gradle",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".sass-cache",
]);
const CONTEXT_IGNORE_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

const tailText = (text, max) => (text.length > max ? text.slice(-max) : text);

/** OpenSSH 风格的 SHA256 主机指纹，与 `ssh-keygen -lf` 的输出一致。 */
const fingerprintHostKey = (key) => {
  const raw = Buffer.isBuffer(key) ? key : Buffer.from(String(key || ""), "utf8");
  return `SHA256:${createHash("sha256").update(raw).digest("base64").replace(/=+$/, "")}`;
};

const formatMegabytes = (bytes) => `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`;

const toPosixPath = (path) => String(path || "").split(sep).join("/");

const escapeRegExp = (text) => text.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/** .dockerignore 里的通配符转正则：** 跨目录、* 单层、? 单字符。 */
const globToRegExp = (pattern) => {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") index += 1;
        source += "(?:.*/)?";
        continue;
      }
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`);
};

/**
 * 读 .dockerignore：只实现常见语法（通配符、目录尾斜杠、# 注释、! 反选）。
 * 目的是别把 node_modules 这类目录传到服务器上，复杂规则交给远端 docker 自己处理。
 */
const compileIgnoreRules = (text) => {
  const rules = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    let pattern = raw;
    let negate = false;
    if (pattern.startsWith("!")) {
      negate = true;
      pattern = pattern.slice(1);
    }
    const dirOnly = pattern.endsWith("/");
    if (dirOnly) pattern = pattern.slice(0, -1);
    pattern = pattern.replace(/^\/+/, "");
    if (!pattern) continue;
    rules.push({
      regExp: globToRegExp(pattern),
      dirOnly,
      negate,
      // 不含斜杠的模式按文件名匹配任意层级，和 .dockerignore 的语义一致。
      matchBase: !pattern.includes("/"),
    });
    if (rules.length >= 200) break;
  }
  return rules;
};

const isIgnoredPath = (relPath, isDir, rules) => {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    const target = rule.matchBase ? relPath.slice(relPath.lastIndexOf("/") + 1) : relPath;
    if (!rule.regExp.test(target)) continue;
    ignored = !rule.negate;
  }
  return ignored;
};

/** 目录符号链接的最大跟随层数：防止链式链接把上传拖成无限展开。 */
const MAX_SYMLINK_DEPTH = 8;

/** 判断真实路径是否落在上下文真实根目录之内（大小写不敏感，兼容 Windows）。 */
const isInsideRealDir = (target, dir) => {
  const norm = (value) => String(value || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const left = norm(target);
  const right = norm(dir);
  return Boolean(right) && (left === right || left.startsWith(`${right}/`));
};

/** 收集要上传的文件清单；超限或取消直接抛错，避免传到一半才发现问题。 */
const collectContextFiles = async (
  root,
  { maxFiles = MAX_CONTEXT_FILES, maxBytes = MAX_CONTEXT_BYTES, signal = null } = {}
) => {
  let ignoreText = "";
  try {
    ignoreText = await readFile(join(root, ".dockerignore"), "utf8");
  } catch {
    // 没有 .dockerignore 就只用内置忽略表。
  }
  const rules = compileIgnoreRules(ignoreText);
  const files = [];
  const dirs = [];
  let bytes = 0;
  let links = 0;
  let skippedLinks = 0;
  const realRoot = await realpath(root).catch(() => root);

  /**
   * 与本机 docker build 保持一致：符号链接按目标内容上传（fastPut 读取链接路径即得目标内容）。
   * ancestors 记录当前递归链上的真实目录，链接指回上层时跳过，避免无限递归。
   */
  const walk = async (dir, { ancestors = new Set(), linkDepth = 0 } = {}) => {
    if (signal?.aborted) throw new DockerError("UPLOAD_CANCELLED", "构建上下文上传已取消");
    const realDir = await realpath(dir).catch(() => dir);
    if (ancestors.has(realDir)) {
      skippedLinks += 1;
      return;
    }
    const chain = new Set(ancestors);
    chain.add(realDir);
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (signal?.aborted) throw new DockerError("UPLOAD_CANCELLED", "构建上下文上传已取消");
      const absolute = join(dir, entry.name);
      const rel = toPosixPath(relative(root, absolute));
      const linked = entry.isSymbolicLink();
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      let size = -1;
      if (linked) {
        let target = null;
        try {
          target = await stat(absolute);
        } catch {
          // 断链或权限不足：跳过并计入提示，不影响其余文件上传。
          skippedLinks += 1;
          continue;
        }
        if (target.isDirectory()) {
          isDirectory = true;
          isFile = false;
        } else if (target.isFile()) {
          isDirectory = false;
          isFile = true;
          size = target.size;
        } else {
          continue;
        }
        // 指向上下文之外的链接不跟随，避免把仓库外的文件带进镜像。
        const realTarget = await realpath(absolute).catch(() => "");
        if (!realTarget || !isInsideRealDir(realTarget, realRoot)) {
          skippedLinks += 1;
          continue;
        }
        links += 1;
      }
      if (isDirectory) {
        if (CONTEXT_IGNORE_DIRS.has(entry.name) || isIgnoredPath(rel, true, rules)) continue;
        if (linked && linkDepth >= MAX_SYMLINK_DEPTH) {
          skippedLinks += 1;
          continue;
        }
        // 目录条目要单独上传：Dockerfile 里 COPY 空占位目录时，远端必须先有该目录。
        if (rel) {
          if (dirs.length >= maxFiles) {
            throw new DockerError(
              "CONTEXT_TOO_LARGE",
              `构建上下文目录太多（超过 ${maxFiles} 个）：请在项目里加 .dockerignore，或把构建上下文设成更小的目录`
            );
          }
          dirs.push(rel);
        }
        await walk(absolute, { ancestors: chain, linkDepth: linked ? linkDepth + 1 : linkDepth });
        continue;
      }
      if (!isFile) continue;
      if (CONTEXT_IGNORE_FILES.has(entry.name) || isIgnoredPath(rel, false, rules)) continue;
      if (files.length >= maxFiles) {
        throw new DockerError(
          "CONTEXT_TOO_LARGE",
          `构建上下文文件太多（超过 ${maxFiles} 个）：请在项目里加 .dockerignore，或把构建上下文设成更小的目录`
        );
      }
      if (size < 0) {
        try {
          size = (await stat(absolute)).size;
        } catch {
          continue;
        }
      }
      bytes += size;
      if (bytes > maxBytes) {
        throw new DockerError(
          "CONTEXT_TOO_LARGE",
          `构建上下文太大（超过 ${Math.round(maxBytes / 1048576)} MB）：请在项目里加 .dockerignore，或把构建上下文设成更小的目录`
        );
      }
      files.push({ absolute, relative: rel, size });
    }
  };
  await walk(root);
  return { files, dirs, bytes, links, skippedLinks };
};

/** 固定并发跑异步任务：SFTP 单个文件串行会把大上下文拖成几分钟。支持中途取消。 */
const runPool = async (items, limit, worker, { signal = null } = {}) => {
  let cursor = 0;
  let failure = null;
  const size = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      if (signal?.aborted || failure) return;
      const index = cursor;
      cursor += 1;
      try {
        await worker(items[index]);
      } catch (error) {
        // 取消后不再取新文件；第一个错误决定最终结果，其余 runner 安静收敛。
        failure = failure || error;
        return;
      }
    }
  });
  await Promise.all(runners);
  if (failure) throw failure;
};

/** 远程命令里的字符串参数统一加双引号，避免 {{json .}} 这类带空格的花括号被 shell 拆开。 */
const quote = (text) => `"${String(text).replace(/(["`$\\])/g, "\\$1")}"`;

const emptyState = () => ({
  status: "idle",
  /** 当前会话对应的服务器标识（面板用来判断连的是哪一台）。 */
  id: "",
  host: "",
  /** 建立连接时用的端口：与 host 一起参与会话目标比对。 */
  port: 22,
  username: "",
  dockerPath: DEFAULT_DOCKER_PATH,
  docker: { ok: false, version: null, error: null },
  error: null,
  connectedAt: null,
});

export function createSshSession({ log = () => {} } = {}) {
  let state = emptyState();
  let client = null;
  let pending = null;

  /**
   * 取当前连接与 docker 路径的快照，并核对任务绑定的服务器。
   * 长任务运行期间用户可能切到另一台服务器：这种情况下必须中止，
   * 否则 build / run / rm -f 会落到后来连接的主机上。
   */
  const requireConn = (sessionId = "") => {
    if (!client || state.status !== "connected") {
      throw new DockerError("SSH_NOT_CONNECTED", "请先连接远程主机");
    }
    if (sessionId && state.id !== sessionId) {
      throw new DockerError(
        "SSH_TARGET_CHANGED",
        `任务绑定的服务器已被切换为 ${state.id || "其他目标"}，为避免误操作已中止；请重新发起任务`
      );
    }
    return { conn: client, dockerPath: resolveDockerPath(state.dockerPath) };
  };

  const teardown = async () => {
    const current = client;
    client = null;
    if (!current) return;
    try {
      current.end();
    } catch {
      // 连接可能已经断开，忽略。
    }
  };

  const openClient = ({ host, port = 22, username, password, expectedHostKey = "", onHostKey = null }) =>
    new Promise((resolve, reject) => {
      const next = new Client();
      let settled = false;
      let hostKeyProblem = "";
      const fail = (error) => {
        if (settled) return;
        settled = true;
        try {
          next.end();
        } catch {
          // 忽略关闭异常。
        }
        const message = hostKeyProblem || String(error?.message || error);
        reject(new DockerError(hostKeyProblem ? "SSH_HOST_KEY_MISMATCH" : "SSH_FAILED", message));
      };
      next.on("ready", () => {
        if (settled) return;
        settled = true;
        resolve(next);
      });
      next.on("error", (error) => fail(error));
      next.on("close", () => {
        if (!settled) fail(new Error("SSH 连接已关闭"));
      });
      try {
        next.connect({
          host,
          port,
          username,
          password,
          readyTimeout: CONNECT_TIMEOUT_MS,
          keepaliveInterval: 20000,
          keepaliveCountMax: 3,
          // 主机密钥校验发生在发送密码之前：首次连接记录指纹，之后必须一致。
          hostVerifier: (key) => {
            const fingerprint = fingerprintHostKey(key);
            if (!expectedHostKey) {
              try {
                onHostKey?.(fingerprint);
              } catch {
                // 记录失败不阻断本次连接，下次会重新记录。
              }
              return true;
            }
            if (fingerprint === expectedHostKey) return true;
            hostKeyProblem =
              `远程主机 ${host} 的主机指纹与已保存的不一致（已保存 ${expectedHostKey}，本次 ${fingerprint}）：` +
              "已阻断连接以保护密码。确认服务器重装或更换密钥后，到「远程」页点「重置主机指纹」再连接";
            return false;
          },
        });
      } catch (error) {
        fail(error);
      }
    });

  /** 在指定连接上执行一次性命令，收集 stdout / stderr 与退出码。 */
  const execOn = (conn, command, { timeoutMs = EXEC_TIMEOUT_MS, maxBytes = EXEC_MAX_BYTES } = {}) =>
    new Promise((resolve, reject) => {
      let settled = false;
      let channel = null;
      const outParts = [];
      const errParts = [];
      let outBytes = 0;
      let errBytes = 0;
      let truncated = false;
      // SSH 可能把多字节字符切成两个 chunk：按流状态解码，避免中文变成替换字符。
      const outDecoder = new StringDecoder("utf8");
      const errDecoder = new StringDecoder("utf8");

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          channel?.close?.();
        } catch {
          // 通道可能已关闭。
        }
        reject(new DockerError("SSH_TIMEOUT", `远程命令超时（${Math.round(timeoutMs / 1000)} 秒）`));
      }, timeoutMs);
      timer.unref?.();

      try {
        conn.exec(command, (error, stream) => {
          if (settled) return;
          if (error) {
            settled = true;
            clearTimeout(timer);
            reject(new DockerError("SSH_FAILED", String(error?.message || error)));
            return;
          }
          channel = stream;

          stream.on("data", (buf) => {
            if (outBytes >= maxBytes) {
              truncated = true;
              return;
            }
            outBytes += buf.length;
            outParts.push(outDecoder.write(buf));
          });

          stream.stderr?.on("data", (buf) => {
            if (errBytes >= MAX_STDERR_BYTES) return;
            errBytes += buf.length;
            errParts.push(errDecoder.write(buf));
          });

          stream.on("error", (cause) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new DockerError("SSH_FAILED", String(cause?.message || cause)));
          });

          stream.on("close", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            outParts.push(outDecoder.end());
            errParts.push(errDecoder.end());
            resolve({
              code: Number.isFinite(code) ? code : null,
              stdout: outParts.join(""),
              stderr: tailText(errParts.join(""), MAX_STDERR_BYTES),
              truncated,
            });
          });
        });
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new DockerError("SSH_FAILED", String(error?.message || error)));
      }
    });

  /** 远程 docker 是否可用：daemon 离线时 docker version 退出码非零，但 Client JSON 仍在 stdout。 */
  const probeDocker = async (conn, dockerPath) => {
    try {
      const result = await execOn(conn, `${dockerPath} version --format ${quote("{{json .}}")}`, {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      const doc = parseJson(result.stdout);
      const server = doc?.Server || null;
      if (server) {
        return { ok: true, version: String(server.Version ?? doc?.Client?.Version ?? ""), error: null };
      }
      const reason = (result.stderr || "").trim();
      return {
        ok: false,
        version: null,
        error: tailText(reason || `docker version 退出码 ${result.code}`, 400),
      };
    } catch (error) {
      return { ok: false, version: null, error: tailText(String(error?.message || error), 400) };
    }
  };

  const connect = async ({
    id = "",
    host,
    port = 22,
    username,
    password,
    dockerPath = DEFAULT_DOCKER_PATH,
    hostKey = "",
    onHostKey = null,
  } = {}) => {
    // pending 必须记住目标：A 正在连接时请求 B，不能把 A 的会话当成 B 的结果返回。
    const targetKey = [id, host, port, username].join("\u0000");
    let waiting = pending;
    while (waiting && waiting.key !== targetKey) {
      await waiting.promise.catch(() => {});
      // 首个调用方在 finally 里清 pending；这里兜底，保证排队一定能往前推进。
      if (pending === waiting) pending = null;
      waiting = pending;
    }
    if (waiting && waiting.key === targetKey) return waiting.promise;

    const job = (async () => {
      await teardown();
      // dockerPath 会拼进远程命令：连接时再兜底一次，非法值按 docker 处理。
      const safeDockerPath = resolveDockerPath(dockerPath);
      const safePort = Number(port) || 22;
      state = { ...emptyState(), status: "connecting", id, host, port: safePort, username, dockerPath: safeDockerPath };

      let conn;
      try {
        conn = await openClient({ host, port, username, password, expectedHostKey: hostKey, onHostKey });
      } catch (error) {
        const message = String(error?.message || error);
        const code = error?.code === "SSH_HOST_KEY_MISMATCH" ? error.code : "SSH_FAILED";
        state = { ...emptyState(), status: "error", id, host, port: safePort, username, dockerPath: safeDockerPath, error: message };
        log(`SSH 连接失败：${message}`);
        throw new DockerError(code, message);
      }

      client = conn;
      conn.on("error", (error) => log(`SSH 连接错误：${error?.message || error}`));
      conn.on("close", () => {
        // 切换服务器后旧连接的 close 可能延迟到达：只有仍是当前连接才改会话状态。
        if (client !== conn) return;
        client = null;
        if (state.status === "connected") {
          state = { ...state, status: "closed", error: "SSH 连接已断开" };
          log("SSH 连接已断开");
        }
      });

      state = {
        status: "connected",
        id,
        host,
        port: safePort,
        username,
        dockerPath: safeDockerPath,
        docker: { ok: false, version: null, error: null },
        error: null,
        connectedAt: Date.now(),
      };

      const docker = await probeDocker(conn, safeDockerPath);
      state = { ...state, docker };
      log(`SSH 已连接 ${username}@${host}:${port}（远程 docker：${docker.ok ? docker.version : "不可用"}）`);
      // 会话是单例：返回前再核对一次目标，并发切换时不会把别的服务器当成结果。
      if (state.id !== id) throw new DockerError("SSH_FAILED", "连接目标已被其它请求替换，请重试");
      return { ...state, docker: { ...state.docker } };
    })();

    pending = { key: targetKey, promise: job };
    try {
      return await job;
    } finally {
      if (pending && pending.promise === job) pending = null;
    }
  };

  const disconnect = async () => {
    await teardown();
    state = emptyState();
    log("SSH 连接已断开");
    return { ...state, docker: { ...state.docker } };
  };

  /** 测试连接：用一次性连接跑 docker version，成功与否都立刻断开，不影响当前会话。 */
  const testConnection = async ({
    host,
    port = 22,
    username,
    password,
    dockerPath = DEFAULT_DOCKER_PATH,
    hostKey = "",
  } = {}) => {
    const safeDockerPath = resolveDockerPath(dockerPath);
    let conn;
    try {
      // 测试连接只核对已保存的指纹，不会写入新的信任记录。
      conn = await openClient({ host, port, username, password, expectedHostKey: hostKey });
    } catch (error) {
      const code = error?.code === "SSH_HOST_KEY_MISMATCH" ? error.code : "SSH_FAILED";
      throw new DockerError(code, String(error?.message || error));
    }
    try {
      const docker = await probeDocker(conn, safeDockerPath);
      return { host, username, dockerPath: safeDockerPath, docker };
    } finally {
      try {
        conn.end();
      } catch {
        // 忽略关闭异常。
      }
    }
  };

  /** 打开 SFTP 子系统（上传构建上下文用）。sessionId 用于确认目标服务器没有变。 */
  const openSftp = (sessionId = "") =>
    new Promise((resolve, reject) => {
      let conn;
      try {
        conn = requireConn(sessionId).conn;
      } catch (error) {
        reject(error);
        return;
      }
      conn.sftp((error, sftp) => {
        if (error) {
          reject(new DockerError("SSH_FAILED", `打开 SFTP 失败：${error?.message || error}`));
          return;
        }
        resolve(sftp);
      });
    });

  /**
   * 逐级建目录；目录已存在时 ssh2 会报 failure，这里按成功处理。
   * cache 记录本次已处理过的层级，避免每个文件都把上层目录重新 mkdir 一遍。
   */
  const ensureRemoteDir = async (sftp, remoteDir, cache, signal = null) => {
    const parts = String(remoteDir || "").split("/").filter(Boolean);
    const created = cache || new Set();
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      if (created.has(current)) continue;
      if (signal?.aborted) throw new DockerError("UPLOAD_CANCELLED", "构建上下文上传已取消");
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener?.("abort", finish);
          resolve();
        };
        // SFTP 会话被取消关闭时 mkdir 的回调可能永远不来，必须在 abort 时自行结算。
        signal?.addEventListener?.("abort", finish, { once: true });
        try {
          sftp.mkdir(current, { mode: SFTP_MKDIR_MODE }, finish);
        } catch {
          finish();
        }
      });
      created.add(current);
    }
  };

  const putFile = (sftp, localPath, remotePath, { signal = null } = {}) =>
    new Promise((resolve, reject) => {
      const cancelled = () => new DockerError("UPLOAD_CANCELLED", "构建上下文上传已取消");
      if (signal?.aborted) {
        reject(cancelled());
        return;
      }
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener?.("abort", onAbort);
        if (error) reject(signal?.aborted ? cancelled() : error);
        else resolve();
      };
      const onAbort = () => finish(cancelled());
      signal?.addEventListener?.("abort", onAbort, { once: true });
      try {
        sftp.fastPut(localPath, remotePath, { concurrency: 8, chunkSize: 32768 }, (error) => {
          finish(
            error
              ? new DockerError("SSH_FAILED", `上传 ${basename(localPath)} 失败：${error?.message || error}`)
              : null
          );
        });
      } catch (error) {
        finish(new DockerError("SSH_FAILED", `上传 ${basename(localPath)} 失败：${error?.message || error}`));
      }
    });

  /** 远程一次性 shell 命令：命令只由本模块拼装，不接受面板透传的片段。 */
  const runShell = async (command, { timeoutMs = EXEC_TIMEOUT_MS, sessionId = "" } = {}) => {
    const { conn } = requireConn(sessionId);
    return execOn(conn, command, { timeoutMs });
  };

  /** 建一个远程临时工作目录，返回绝对路径（形如 /tmp/snow-docker-XXXXXX）。 */
  const createWorkspace = async ({ sessionId = "" } = {}) => {
    const result = await runShell(`mktemp -d "\${TMPDIR:-/tmp}/${WORKSPACE_PREFIX}XXXXXX"`, { timeoutMs: 15000, sessionId });
    const lines = String(result.stdout || "").trim().split(/\r?\n/);
    const dir = (lines.pop() || "").trim();
    if (result.code !== 0 || !WORKSPACE_PATH.test(dir) || !dir.includes(WORKSPACE_PREFIX) || dir.includes("..")) {
      const reason = (result.stderr || result.stdout || "").trim();
      throw new DockerError("SSH_FAILED", `远程创建临时目录失败：${reason.slice(0, 300) || "未知原因"}`);
    }
    return dir;
  };

  /** 清理远程临时目录：只删带 snow-docker- 前缀的绝对路径；rm 失败时返回 false 交给调用方提示。 */
  const removeWorkspace = async (dir, { sessionId = "" } = {}) => {
    const text = String(dir || "").trim();
    if (!WORKSPACE_PATH.test(text) || !text.includes(WORKSPACE_PREFIX) || text.includes("..")) return false;
    try {
      const result = await runShell(`rm -rf ${quote(text)}`, { timeoutMs: 30000, sessionId });
      // 非零退出说明目录仍在服务器上：此时返回 true 会让调用方以为已清理干净。
      if (result.code === 0) return true;
      const reason = (result.stderr || "").trim().slice(0, 200);
      log(`清理远程临时目录失败（exit=${result.code}）：${reason || "无 stderr"}`);
      return false;
    } catch {
      return false;
    }
  };

  /**
   * 上传构建上下文到远程目录：内容直接落在 remoteDir 下，等价于 docker build 的 context 根。
   * 跳过 .dockerignore 与内置忽略表里的目录，并按文件数 / 总体积设上限。
   * signal 触发时只关闭当前 SFTP 会话，主 SSH 连接保持可用，调用方仍能清理远程目录。
   */
  const uploadContext = async ({
    root,
    remoteDir,
    onLine = () => {},
    onProgress = () => {},
    signal = null,
    sessionId = "",
  } = {}) => {
    const cancelled = () => new DockerError("UPLOAD_CANCELLED", "构建上下文上传已取消");
    const localRoot = String(root || "").trim();
    const targetDir = String(remoteDir || "").trim();
    if (!localRoot) throw new DockerError("INVALID_PARAM", "构建上下文不能为空");
    if (!WORKSPACE_PATH.test(targetDir) || !targetDir.includes(WORKSPACE_PREFIX)) {
      throw new DockerError("INVALID_PARAM", "远程构建目录不合法");
    }
    if (signal?.aborted) throw cancelled();

    let collected;
    try {
      collected = await collectContextFiles(localRoot, { signal });
    } catch (error) {
      if (error instanceof DockerError) throw error;
      throw new DockerError("INVALID_PARAM", `读取构建上下文失败（${localRoot}）：${error?.message || error}`);
    }
    const { files, dirs = [], bytes, links = 0, skippedLinks = 0 } = collected;
    if (!files.length && !dirs.length) {
      throw new DockerError("INVALID_PARAM", "构建上下文里没有可上传的文件或目录");
    }
    onLine(
      `构建上下文：${files.length} 个文件${dirs.length ? `、${dirs.length} 个目录` : ""}，共 ${formatMegabytes(bytes)}${links ? `（已跟随 ${links} 个符号链接）` : ""}`
    );
    if (skippedLinks) onLine(`已跳过 ${skippedLinks} 个符号链接（断链、目录环路、超出深度或指向上下文之外）`);
    if (signal?.aborted) throw cancelled();

    const sftp = await openSftp(sessionId);
    let closed = false;
    const closeSftp = () => {
      if (closed) return;
      closed = true;
      try {
        sftp.end();
      } catch {
        // 忽略关闭异常。
      }
    };
    // 取消时立刻断开 SFTP：在途 fastPut 会失败，putFile 也会按信号自行结算；
    // 这里不能断主 SSH 连接，否则 finally 里的 removeWorkspace 会失效。
    const onAbort = () => closeSftp();
    signal?.addEventListener?.("abort", onAbort, { once: true });
    try {
      // 先把所有子目录建好，再并发传文件，省掉每个文件一次 mkdir 往返。
      const created = new Set();
      const dirSet = new Set([targetDir]);
      // 收集阶段记录的目录（含空目录与只含忽略文件的目录）必须单独创建，否则 COPY 会失败。
      for (const rel of dirs) {
        if (rel) dirSet.add(`${targetDir}/${rel}`);
      }
      for (const file of files) {
        const index = file.relative.lastIndexOf("/");
        if (index > 0) dirSet.add(`${targetDir}/${file.relative.slice(0, index)}`);
      }
      for (const dir of Array.from(dirSet).sort()) {
        await ensureRemoteDir(sftp, dir, created, signal);
      }
      if (signal?.aborted) throw cancelled();

      let done = 0;
      let sent = 0;
      await runPool(
        files,
        UPLOAD_CONCURRENCY,
        async (file) => {
          if (signal?.aborted) throw cancelled();
          await putFile(sftp, file.absolute, `${targetDir}/${file.relative}`, { signal });
          done += 1;
          sent += file.size;
          onProgress({ done, files: files.length, bytes: sent, totalBytes: bytes });
        },
        { signal }
      );
    } catch (error) {
      if (signal?.aborted || error?.code === "UPLOAD_CANCELLED") throw cancelled();
      throw error;
    } finally {
      signal?.removeEventListener?.("abort", onAbort);
      closeSftp();
    }

    return { files: files.length, dirs: dirs.length, bytes, links, skippedLinks };
  };

  /** 单独上传一个文件（Dockerfile 不在上下文里时用）。返回相对 remoteDir 的路径。 */
  const uploadFile = async ({ localPath, remoteDir, name = "Dockerfile", sessionId = "" } = {}) => {
    const source = String(localPath || "").trim();
    const targetDir = String(remoteDir || "").trim();
    if (!source) throw new DockerError("INVALID_PARAM", "要上传的文件路径不能为空");
    if (!WORKSPACE_PATH.test(targetDir) || !targetDir.includes(WORKSPACE_PREFIX)) {
      throw new DockerError("INVALID_PARAM", "远程构建目录不合法");
    }
    const relativePath = String(name || "Dockerfile").replace(/^\/+/, "");
    const remotePath = `${targetDir}/${relativePath}`;
    const sftp = await openSftp(sessionId);
    try {
      await ensureRemoteDir(sftp, remotePath.slice(0, remotePath.lastIndexOf("/")));
      await putFile(sftp, source, remotePath);
    } finally {
      try {
        sftp.end();
      } catch {
        // 忽略关闭异常。
      }
    }
    return relativePath;
  };

  /**
   * 在远程主机上流式执行一条命令，按行回调输出，可中途取消。
   * 返回 { done, cancel }：done 解析成 { code, cancelled }。
   */
  const streamCommand = ({
    command,
    conn: providedConn = null,
    onLine = () => {},
    onStderr = null,
    timeoutMs = EXEC_TIMEOUT_MS,
    maxBytes = MAX_STREAM_BYTES,
  } = {}) => {
    const conn = providedConn || client;
    let channel = null;
    let settled = false;
    let resolveDone = () => {};
    let rejectDone = () => {};
    let buffer = "";
    let errBuffer = "";
    let emitted = 0;
    // 远程输出同样可能把中文切成两个 chunk，stdout / stderr 各自维护解码状态。
    const outDecoder = new StringDecoder("utf8");
    const errDecoder = new StringDecoder("utf8");

    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    if (!conn || state.status !== "connected") {
      return {
        done: Promise.reject(new DockerError("SSH_NOT_CONNECTED", "请先连接远程主机")),
        cancel: () => {},
      };
    }

    const emit = (line) => {
      if (!line.trim() || (maxBytes > 0 && emitted >= maxBytes)) return;
      if (maxBytes > 0) emitted += Buffer.byteLength(line);
      onLine(line);
    };
    const flush = () => {
      if (buffer.trim()) emit(buffer.trim());
      buffer = "";
    };
    // 日志流需要把容器 stderr 也当日志显示，并保留原文与分行顺序；
    // 其余命令沿用原有行为，把 stderr 合并成一行提示。
    const emitStderr = (text) => {
      if (typeof onStderr !== "function") {
        const trimmed = String(text || "").trim();
        if (trimmed) emit(trimmed);
        return;
      }
      errBuffer += String(text || "");
      let index = errBuffer.search(/\r?\n/);
      while (index >= 0) {
        const line = errBuffer.slice(0, index);
        errBuffer = errBuffer.slice(index + (errBuffer[index] === "\r" ? 2 : 1));
        if (line.length > 0) onStderr(line);
        index = errBuffer.search(/\r?\n/);
      }
    };
    const flushStderr = () => {
      if (typeof onStderr !== "function") return;
      const text = errBuffer;
      errBuffer = "";
      if (text.length > 0) onStderr(text);
    };
    // 通道结束时把解码器里剩余的不完整字符吐出来，避免最后一行丢字。
    const drainDecoders = () => {
      buffer += outDecoder.end();
      errBuffer += errDecoder.end();
    };

    try {
      conn.exec(command, (error, stream) => {
        if (error) {
          if (settled) return;
          settled = true;
          rejectDone(new DockerError("SSH_FAILED", `远程执行失败：${error?.message || error}`));
          return;
        }
        channel = stream;

        stream.on("data", (buf) => {
          buffer += outDecoder.write(buf);
          let index = buffer.search(/\r?\n/);
          while (index >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + (buffer[index] === "\r" ? 2 : 1));
            emit(line);
            index = buffer.search(/\r?\n/);
          }
        });

        stream.stderr?.on("data", (buf) => emitStderr(errDecoder.write(buf)));

        stream.on("error", (cause) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          rejectDone(new DockerError("SSH_FAILED", String(cause?.message || cause)));
        });

        stream.on("close", (code) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          drainDecoders();
          flush();
          flushStderr();
          resolveDone({ code: Number.isFinite(code) ? code : 0, cancelled: false });
        });

        stream.on("exit", (code) => {
          if (settled) return;
          // 部分 ssh 通道只发 exit 不发 close，这里兜一层。
          settled = true;
          if (timer) clearTimeout(timer);
          drainDecoders();
          flush();
          flushStderr();
          resolveDone({ code: Number.isFinite(code) ? code : 0, cancelled: false });
        });
      });
    } catch (cause) {
      settled = true;
      rejectDone(new DockerError("SSH_FAILED", String(cause?.message || cause)));
    }

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            try {
              channel?.close?.();
            } catch {
              // 通道可能已关闭。
            }
            rejectDone(new DockerError("SSH_TIMEOUT", `远程命令超时（${Math.round(timeoutMs / 1000)} 秒）`));
          }, timeoutMs)
        : null;
    timer?.unref?.();

    return {
      done,
      cancel: () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          channel?.close?.();
        } catch {
          // 忽略。
        }
        resolveDone({ code: null, cancelled: true });
      },
    };
  };

  /**
   * 远程构建镜像：先 cd 到已上传的上下文目录，再跑 docker build。
   * dockerfile 是相对上下文目录的路径（上下文之外的 Dockerfile 由 uploadFile 放进来）。
   */
  const buildImage = ({
    workspace,
    dockerfile,
    tag,
    flags = [],
    onLine = () => {},
    timeoutMs = BUILD_TIMEOUT_MS,
    sessionId = "",
  } = {}) => {
    const dir = String(workspace || "").trim();
    if (!WORKSPACE_PATH.test(dir) || !dir.includes(WORKSPACE_PREFIX) || dir.includes("..")) {
      throw new DockerError("INVALID_PARAM", "远程构建目录不合法");
    }
    const { conn, dockerPath } = requireConn(sessionId);
    const parts = [dockerPath, "build", "-f", quote(dockerfile), "-t", quote(tag)];
    for (const flag of flags) parts.push(quote(flag));
    parts.push(quote("."));
    return streamCommand({ conn, command: `cd ${quote(dir)} && ${parts.join(" ")}`, onLine, timeoutMs });
  };

  /**
   * 预检本机是否存在同名镜像。镜像列表可能来自远程服务器，上传却走本机 docker save，
   * 上传前先确认本机真有这个镜像，失败时才能说明数据来源，而不是只回一句 No such image。
   */
  const inspectLocalImage = ({ image, localBin = DEFAULT_LOCAL_BIN, localEnv = null }) =>
    new Promise((resolve) => {
      let child;
      try {
        child = spawn(localBin, ["image", "inspect", "--format", "{{.Id}}", image], {
          windowsHide: true,
          env: localEnv || { ...process.env, DOCKER_CLI_HINTS: "false" },
        });
      } catch (error) {
        resolve({ found: false, error: `本机没有可用的 docker 命令行：${error?.message || error}` });
        return;
      }
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer = null;
      const finish = (found, errorText) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({ found, error: errorText !== undefined ? errorText : tailText(stderr.trim(), 400) });
      };
      // daemon 无响应时 inspect 可能一直不退出：超时必须结算并终止子进程，
      // 否则 /ssh/upload 会一直悬挂，重试会叠加残留的 docker 进程。
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        timer = null;
        killChildTree(child);
        resolve({
          found: false,
          error: `本机 docker 预检超过 ${Math.round(LOCAL_INSPECT_TIMEOUT_MS / 1000)} 秒未响应，已终止本次预检`,
        });
      }, LOCAL_INSPECT_TIMEOUT_MS);
      timer.unref?.();
      child.stdout?.on("data", (buf) => {
        if (stdout.length < 4096) stdout += buf.toString("utf8");
      });
      child.stderr?.on("data", (buf) => {
        if (stderr.length < 4096) stderr += buf.toString("utf8");
      });
      child.on("error", (error) => {
        finish(false, `本机没有可用的 docker 命令行：${error?.message || error}`);
      });
      child.on("close", (code) => finish(code === 0 && Boolean(stdout.trim())));
    });

  /**
   * 上传镜像：本机 `docker save <image>` 的 stdout 直接 pipe 到远程 `<dockerPath> load` 的 stdin。
   * 返回 { done, cancel }：done 解析成 { code, bytes, cancelled }，取消时 code 为 null。
   */
  const uploadImage = ({
    image,
    localBin = DEFAULT_LOCAL_BIN,
    localEnv = null,
    onLine = () => {},
    onProgress = () => {},
    sessionId = "",
  }) => {
    let target;
    try {
      target = requireConn(sessionId);
    } catch (error) {
      return { done: Promise.reject(error), cancel: () => {} };
    }
    const { conn, dockerPath } = target;

    let child = null;
    let channel = null;
    let settled = false;
    let localDone = false;
    let remoteDone = false;
    let localExit = null;
    let remoteExit = null;
    let bytes = 0;
    let lastReported = 0;
    let remoteBuffer = "";
    // docker save / load 的提示文字也可能跨包：三条文本流各用一个解码器。
    const saveErrDecoder = new StringDecoder("utf8");
    const remoteOutDecoder = new StringDecoder("utf8");
    const remoteErrDecoder = new StringDecoder("utf8");
    let timer = null;
    let progressTimer = null;
    /** exit 之后等待 close 的宽限定时器：close 到达即清掉，不再按 exit 结算。 */
    let exitGraceTimer = null;
    let resolveDone = () => {};
    let rejectDone = () => {};

    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    const stopTimers = () => {
      if (timer) clearTimeout(timer);
      if (progressTimer) clearInterval(progressTimer);
      if (exitGraceTimer) clearTimeout(exitGraceTimer);
      timer = null;
      progressTimer = null;
      exitGraceTimer = null;
    };

    /**
     * 结算为失败：不做 settled 守卫。
     * settleDone 在判定远端退出码之前就已置 settled，复用带守卫的 abort 会把这次结算吞掉，
     * done 会永久 pending，任务卡片也就永远停在运行中。
     */
    const failWith = (error) => {
      stopTimers();
      try {
        child?.kill("SIGTERM");
      } catch {
        // 进程可能已退出。
      }
      try {
        channel?.destroy?.();
      } catch {
        // 通道可能已关闭。
      }
      rejectDone(error);
    };

    const settleDone = () => {
      if (settled || !localDone || !remoteDone) return;
      settled = true;
      stopTimers();
      remoteBuffer += remoteOutDecoder.end();
      const saveRest = saveErrDecoder.end();
      if (saveRest.trim()) onLine(saveRest.trim());
      const loadRest = remoteErrDecoder.end();
      if (loadRest.trim()) onLine(loadRest.trim());
      if (remoteBuffer.trim()) onLine(remoteBuffer.trim());
      remoteBuffer = "";
      // 远端没有返回退出码（通道被中断、对端只发 exit-signal、或未发 exit-status）：
      // 无法确认 docker load 是否执行完成，按失败结算，避免把未加载的镜像报成已上传。
      if (remoteExit === null) {
        onLine("远程 docker load 未返回退出码，无法确认镜像是否已在远端加载");
        failWith(new DockerError("SSH_FAILED", "远程 docker load 未返回退出码，无法确认镜像是否已在远端加载"));
        return;
      }
      // 远端 load 失败优先，其次是本地 save 的退出码。
      const code = remoteExit !== 0 ? remoteExit : localExit;
      resolveDone({ code: Number.isFinite(code) ? code : 0, bytes, cancelled: false });
    };

    /** 远程侧统一置位入口：重复调用无副作用，保证 settleDone 只结算一次。 */
    const markRemoteDone = (code) => {
      if (remoteDone) return;
      remoteExit = Number.isFinite(code) ? code : null;
      remoteDone = true;
      settleDone();
    };

    const abort = (error) => {
      if (settled) return;
      settled = true;
      failWith(error);
    };

    try {
      child = spawn(localBin, ["save", image], {
        windowsHide: true,
        env: localEnv || { ...process.env, DOCKER_CLI_HINTS: "false" },
      });
    } catch (error) {
      settled = true;
      rejectDone(new DockerError("DOCKER_START_FAILED", String(error?.message || error)));
      return { done, cancel: () => {} };
    }

    const cancel = () => {
      if (settled) return;
      settled = true;
      stopTimers();
      try {
        child?.kill("SIGTERM");
      } catch {
        // 忽略。
      }
      try {
        channel?.destroy?.();
      } catch {
        // 忽略。
      }
      resolveDone({ code: null, bytes, cancelled: true });
    };

    timer = setTimeout(() => abort(new DockerError("SSH_TIMEOUT", "上传超时，请检查网络或镜像大小")), UPLOAD_TIMEOUT_MS);
    timer.unref?.();

    progressTimer = setInterval(() => {
      if (settled || bytes === lastReported) return;
      lastReported = bytes;
      onProgress({ bytes });
    }, PROGRESS_INTERVAL_MS);
    progressTimer.unref?.();

    child.stderr?.on("data", (buf) => {
      const text = saveErrDecoder.write(buf).trim();
      if (text) onLine(text);
    });

    child.on("error", (error) => {
      const code = error?.code === "ENOENT" ? "DOCKER_NOT_FOUND" : "DOCKER_START_FAILED";
      abort(new DockerError(code, error?.message || String(error)));
    });

    child.on("close", (code) => {
      localExit = Number.isFinite(code) ? code : null;
      localDone = true;
      if (localExit !== null && localExit !== 0) onLine(`docker save 退出码 ${localExit}`);
      settleDone();
    });

    try {
      conn.exec(`${dockerPath} load`, (error, stream) => {
        if (error) {
          abort(new DockerError("SSH_FAILED", `远程执行 docker load 失败：${error?.message || error}`));
          return;
        }
        channel = stream;

        stream.on("data", (buf) => {
          remoteBuffer += remoteOutDecoder.write(buf);
          let index = remoteBuffer.search(/\r?\n/);
          while (index >= 0) {
            const line = remoteBuffer.slice(0, index);
            remoteBuffer = remoteBuffer.slice(index + (remoteBuffer[index] === "\r" ? 2 : 1));
            if (line.trim()) onLine(line);
            index = remoteBuffer.search(/\r?\n/);
          }
        });

        stream.stderr?.on("data", (buf) => {
          const text = remoteErrDecoder.write(buf).trim();
          if (text) onLine(text);
        });

        stream.on("error", (cause) => abort(new DockerError("SSH_FAILED", String(cause?.message || cause))));

        stream.on("close", (code) => {
          if (exitGraceTimer) clearTimeout(exitGraceTimer);
          exitGraceTimer = null;
          markRemoteDone(code);
        });

        // 少数 SSH 通道只发 exit 不发 close：不兜底时 remoteDone 永不置位，
        // done 会一直挂到 UPLOAD_TIMEOUT_MS（30 分钟）才由超时定时器结算。
        stream.on("exit", (code) => {
          if (remoteDone || exitGraceTimer) return;
          // close 通常紧随 exit 到达：先给它一个短宽限期收尾剩余输出，期间 close 到达就走正常路径。
          exitGraceTimer = setTimeout(() => {
            exitGraceTimer = null;
            markRemoteDone(code);
          }, REMOTE_EXIT_GRACE_MS);
          exitGraceTimer.unref?.();
        });

        // pipe 自带背压控制；stdout 结束时自动 end 远程通道的 stdin（发送 EOF）。
        child.stdout?.pipe(stream);
        // 字节统计必须等 pipe 建立后再挂：pipe 之前的 data 监听会让 stdout 提前进入 flowing，
        // 握手期间到达的 docker save 字节会被直接丢弃，远端 docker load 就会拿到损坏的 tar。
        child.stdout?.on("data", (buf) => {
          bytes += buf.length;
        });
      });
    } catch (error) {
      abort(new DockerError("SSH_FAILED", String(error?.message || error)));
    }

    return { done, cancel };
  };


  /**
   * 在远程执行一条 docker 命令并收集完整输出（列表 / inspect / 日志这类一次性读取）。
   * 非零退出码按本机同一套分类抛出，面板的错误提示不用为远程另写一份。
   */
  const execCollect = async ({
    args = [],
    timeoutMs = EXEC_TIMEOUT_MS,
    maxBytes = EXEC_MAX_BYTES,
    sessionId = "",
    tolerateExit = false,
  } = {}) => {
    const { conn, dockerPath } = requireConn(sessionId);
    const command = [dockerPath, ...args.map((item) => quote(item))].join(" ");
    const result = await execOn(conn, command, { timeoutMs, maxBytes });
    if (result.code !== 0 && !tolerateExit) {
      const text = (result.stderr || result.stdout || "").trim() || `docker ${args[0]} 退出码 ${result.code}`;
      throw new DockerError(classifyFailure(text), tailText(text, 1200));
    }
    return result;
  };

  /**
   * 在已连接的远程主机上执行一条 docker 命令（参数数组逐个加引号，不接受 shell 透传）。
   * 返回 { done, cancel }：done 解析成 { code, cancelled }。
   */
  const execDocker = ({
    args = [],
    onLine = () => {},
    onStderr = null,
    timeoutMs = EXEC_TIMEOUT_MS,
    maxBytes = MAX_STREAM_BYTES,
    sessionId = "",
  } = {}) => {
    let target;
    try {
      target = requireConn(sessionId);
    } catch (error) {
      return { done: Promise.reject(error), cancel: () => {} };
    }
    return streamCommand({
      conn: target.conn,
      command: [target.dockerPath, ...args.map((item) => quote(item))].join(" "),
      onLine,
      onStderr,
      timeoutMs,
      maxBytes,
    });
  };

  return {
    connect,
    disconnect,
    testConnection,
    inspectLocalImage,
    uploadImage,
    execDocker,
    execCollect,
    createWorkspace,
    removeWorkspace,
    uploadContext,
    uploadFile,
    buildImage,
    getStatus: () => ({ ...state, docker: { ...state.docker } }),
    isConnected: () => state.status === "connected" && Boolean(client),
  };
}
