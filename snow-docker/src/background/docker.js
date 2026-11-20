// Docker CLI 执行层：所有 docker 调用集中在这里，路由层不拼接命令行。
// 运行环境是 Electron 主进程（Node 全权限），因此可以直接 spawn 本机 docker CLI。
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const BIN = (process.env.SNOW_DOCKER_BIN || "docker").trim() || "docker";

/**
 * 当前连接配置（CLI 路径 / 额外环境变量）。
 * 由 createDocker 依据插件设置注入，模块级共享，避免每个调用点都加参数。
 */
let runtime = { bin: BIN, env: null };

export function setDockerRuntime(next) {
  runtime = {
    bin: String(next?.bin || BIN).trim() || BIN,
    env: next?.env || null,
  };
}

export function getDockerRuntime() {
  return runtime;
}

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;

/** 统一的 Docker 调用错误：code 给面板分支，message 直接展示。 */
export class DockerError extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = "DockerError";
    this.code = code;
    this.detail = options.detail ?? null;
  }
}

const DAEMON_PATTERNS =
  /cannot connect to the docker daemon|failed to connect to the docker api|is the docker daemon running|error during connect|dockerDesktopLinuxEngine|open \/\/\.\/pipe\/docker_engine/i;

export const classifyFailure = (text) => {
  if (DAEMON_PATTERNS.test(text)) return "DAEMON_UNAVAILABLE";
  if (/permission denied|access is denied|are you trying to connect to a tls-enabled daemon/i.test(text)) {
    return "PERMISSION_DENIED";
  }
  if (/no such container/i.test(text)) return "CONTAINER_NOT_FOUND";
  if (/no such image|no such object/i.test(text)) return "IMAGE_NOT_FOUND";
  return "DOCKER_FAILED";
};

const tailText = (text, maxChars) => (text.length > maxChars ? text.slice(-maxChars) : text);

/**
 * 执行一次 docker 子命令。
 * - 分别收集 stdout / stderr，超出各自上限即停止累积并标记 truncated，不让一次刷屏把主进程内存吃满；
 * - 非零退出码统一抛 DockerError，绝不把原始命令拼进错误给前端。
 */
const runOnce = (
  args,
  { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, tolerateExit = false } = {}
) =>
  new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(runtime.bin, args, {
        windowsHide: true,
        env: runtime.env || { ...process.env, DOCKER_CLI_HINTS: "false" },
      });
    } catch (error) {
      reject(new DockerError("DOCKER_START_FAILED", String(error?.message || error)));
      return;
    }

    const outParts = [];
    const errParts = [];
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let settled = false;
    // docker 输出可能把一个汉字切成两个 chunk：用解码器保留跨包状态。
    const outDecoder = new StringDecoder("utf8");
    const errDecoder = new StringDecoder("utf8");

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // 进程可能已退出，忽略。
      }
      reject(new DockerError("DOCKER_TIMEOUT", `docker ${args[0]} 超时（${Math.round(timeoutMs / 1000)} 秒）`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (buf) => {
      // 上限判断放在解码与入队之前：超限后不再累积字符串，长输出不会把主进程内存吃满。
      if (outBytes >= maxBytes) {
        truncated = true;
        return;
      }
      outBytes += buf.length;
      outParts.push(outDecoder.write(buf));
    });

    child.stderr?.on("data", (buf) => {
      if (errBytes >= MAX_STDERR_BYTES) return;
      errBytes += buf.length;
      errParts.push(errDecoder.write(buf));
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const code = error?.code === "ENOENT" ? "DOCKER_NOT_FOUND" : "DOCKER_START_FAILED";
      reject(new DockerError(code, error?.message || String(error)));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = outParts.join("") + outDecoder.end();
      const stderr = errParts.join("") + errDecoder.end();
      if (code !== 0 && !tolerateExit) {
        const text = (stderr || stdout).trim() || `docker ${args[0]} 退出码 ${code}`;
        reject(new DockerError(classifyFailure(text), tailText(text, 1200)));
        return;
      }
      resolve({ stdout, stderr, truncated, code });
    });
  });

export const parseJsonLines = (text) => {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // 非 JSON 行（警告、进度）直接忽略。
    }
  }
  return rows;
};

export const parseJson = (text) => {
  try {
    return JSON.parse(String(text || "").trim());
  } catch {
    return null;
  }
};

/** 解析 docker --format 里的 Labels 串（形如 a=1,b=2）。 */
const parseLabels = (text) => {
  const labels = {};
  for (const part of String(text || "").split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    labels[part.slice(0, index)] = part.slice(index + 1);
  }
  return labels;
};

const STATE_MAP = {
  running: "running",
  exited: "exited",
  paused: "paused",
  created: "created",
  restarting: "restarting",
  removing: "removing",
  dead: "dead",
};

const normalizeState = (raw) => STATE_MAP[String(raw || "").toLowerCase()] || "unknown";

/** inspect 里的环境变量按敏感键名脱敏，避免面板顺手把密钥显示出来。 */
const SENSITIVE_ENV = /(pass(word|wd)?|secret|token|key|credential|auth)/i;

export const toContainerSummary = (row) => {
  const id = String(row.ID ?? "");
  return {
    id,
    shortId: id.slice(0, 12),
    name: String(row.Names ?? "").split(",")[0] || id.slice(0, 12),
    image: String(row.Image ?? ""),
    command: String(row.Command ?? ""),
    createdAt: String(row.CreatedAt ?? ""),
    runningFor: String(row.RunningFor ?? ""),
    ports: String(row.Ports ?? ""),
    state: normalizeState(row.State),
    status: String(row.Status ?? ""),
    size: String(row.Size ?? ""),
    networks: String(row.Networks ?? ""),
    mounts: String(row.Mounts ?? ""),
    labels: parseLabels(row.Labels),
  };
};

export const toImageSummary = (row) => ({
  id: String(row.ID ?? ""),
  repository: String(row.Repository ?? ""),
  tag: String(row.Tag ?? ""),
  digest: String(row.Digest ?? ""),
  createdAt: String(row.CreatedAt ?? ""),
  createdSince: String(row.CreatedSince ?? ""),
  size: String(row.Size ?? ""),
  containers: String(row.Containers ?? ""),
});

/** inspect 输出压成面板要用的结构；远程 daemon 复用同一套字段。 */
export const summarizeInspect = (item) => {
  const config = item.Config || {};
  const state = item.State || {};
  const ports = item.NetworkSettings?.Ports || {};
  const env = Array.isArray(config.Env) ? config.Env : [];
  return {
    id: String(item.Id ?? ""),
    name: String(item.Name ?? "").replace(/^\//, ""),
    created: String(item.Created ?? ""),
    image: String(config.Image ?? ""),
    command: Array.isArray(config.Cmd) ? config.Cmd.join(" ") : String(config.Cmd ?? ""),
    entrypoint: Array.isArray(config.Entrypoint) ? config.Entrypoint.join(" ") : String(config.Entrypoint ?? ""),
    state: {
      status: String(state.Status ?? ""),
      running: state.Running === true,
      paused: state.Paused === true,
      restarting: state.Restarting === true,
      exitCode: Number.isFinite(state.ExitCode) ? state.ExitCode : null,
      startedAt: String(state.StartedAt ?? ""),
      finishedAt: String(state.FinishedAt ?? ""),
      error: String(state.Error ?? ""),
    },
    ports: Object.entries(ports).map(([containerPort, bindings]) => ({
      containerPort,
      host: Array.isArray(bindings)
        ? bindings.map((item) => `${item.HostIp || "0.0.0.0"}:${item.HostPort || ""}`).join(", ")
        : "",
    })),
    mounts: (Array.isArray(item.Mounts) ? item.Mounts : []).map((mount) => ({
      type: String(mount.Type ?? ""),
      source: String(mount.Source ?? ""),
      destination: String(mount.Destination ?? ""),
      mode: String(mount.Mode ?? ""),
      readOnly: mount.RW === false,
    })),
    env: env.map((entry) => {
      const index = entry.indexOf("=");
      if (index <= 0) return entry;
      const key = entry.slice(0, index);
      return SENSITIVE_ENV.test(key) ? `${key}=***` : entry;
    }),
    restartPolicy: String(item.HostConfig?.RestartPolicy?.Name ?? ""),
    networks: Object.keys(item.NetworkSettings?.Networks || {}),
    platform: String(item.Platform ?? ""),
    labels: config.Labels && typeof config.Labels === "object" ? config.Labels : {},
  };
};

/** 容器 ID / 名称白名单：只允许 docker 自己会接受的字符，杜绝参数注入。 */
export const CONTAINER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** 镜像引用白名单：仓库/标签/摘要都覆盖，但不允许空格与 shell 元字符。 */
export const IMAGE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/;

const WRITE_ACTIONS = new Set(["start", "stop", "restart", "pause", "unpause"]);

export function createDocker({ log = () => {} } = {}) {
  // 列表短期缓存按参数分组：all=true / all=false 不能共用同一份结果。
  const withCache = (ttlMs, loader) => {
    const entries = new Map();
    return async (options = {}) => {
      const key = JSON.stringify(options);
      const cached = entries.get(key);
      if (cached && Date.now() - cached.at < ttlMs) return cached.value;
      const value = await loader(options);
      entries.set(key, { at: Date.now(), value });
      return value;
    };
  };

  const rawListContainers = async ({ all = true } = {}) => {
    const args = ["ps", ...(all ? ["--all"] : []), "--no-trunc", "--format", "{{json .}}"];
    const result = await runOnce(args, { timeoutMs: 15000 });
    return {
      containers: parseJsonLines(result.stdout).map(toContainerSummary),
      truncated: result.truncated,
    };
  };

  const rawListImages = async () => {
    const result = await runOnce(["images", "--format", "{{json .}}"], { timeoutMs: 15000 });
    return { images: parseJsonLines(result.stdout).map(toImageSummary), truncated: result.truncated };
  };

  return {
    /**
     * daemon 探活：只读判断引擎是否可达。
     * 构建前先问一次，免得 npm / Maven 已经打包完才发现 dockerd 没起来，白跑一趟。
     */
    async ping() {
      const hint =
        "Docker 引擎没有运行。请先启动 Docker Desktop，等它就绪（约 30 秒）后重试；" +
        "如果 Docker Desktop 已经在运行仍报错，请确认本机 docker context 为 desktop-linux";
      const fail = (code) => {
        if (code === "DOCKER_NOT_FOUND") {
          return {
            ok: false,
            code,
            message:
              "没有找到 docker 命令：请安装 Docker Desktop，或把 docker 加入 PATH；" +
              "也可以到「项目」页的本机 Docker 设置里填写 CLI 的绝对路径",
          };
        }
        if (code === "DOCKER_TIMEOUT") {
          return {
            ok: false,
            code,
            message: "docker 命令 6 秒内没有响应：请检查本机 docker CLI 路径是否正确",
          };
        }
        return { ok: false, code: "DAEMON_UNAVAILABLE", message: hint };
      };
      try {
        const result = await runOnce(["version", "--format", "{{json .Server}}"], {
          timeoutMs: 6000,
          tolerateExit: true,
        });
        const server = parseJson(result.stdout);
        if (server && (server.Version || server.Os)) return { ok: true, code: "", message: "" };
        const text = (result.stderr || result.stdout || "").trim();
        const code = classifyFailure(text);
        return fail(code === "DOCKER_FAILED" ? "DAEMON_UNAVAILABLE" : code);
      } catch (error) {
        // runOnce 已把 ENOENT 归一成 DOCKER_NOT_FOUND：这里必须沿用错误码，
        // 否则「没装 docker / 不在 PATH」会被误报成「引擎没有启动」。
        return fail(String(error?.code || ""));
      }
    },

    /** 引擎与 CLI 状态：CLI 未安装、daemon 未启动都通过结构化字段返回，不抛给面板。 */
    async system() {
      let versionDoc = null;
      let versionError = null;
      try {
        // daemon 不可用时 docker version 仍会把 Client JSON 打到 stdout，但退出码非零，
        // 因此这里容忍非零退出，靠解析结果判断 CLI 是否可用。
        const result = await runOnce(["version", "--format", "{{json .}}"], {
          timeoutMs: 8000,
          tolerateExit: true,
        });
        versionDoc = parseJson(result.stdout);
        if (result.code !== 0) {
          versionError = new DockerError("DAEMON_UNAVAILABLE", (result.stderr || "").trim());
        }
      } catch (error) {
        versionError = error;
      }

      if (!versionDoc && versionError?.code === "DOCKER_NOT_FOUND") throw versionError;

      const client = versionDoc?.Client || null;
      const server = versionDoc?.Server || null;

      let info = null;
      let infoError = null;
      if (server) {
        try {
          info = parseJson((await runOnce(["info", "--format", "{{json .}}"], { timeoutMs: 12000 })).stdout);
        } catch (error) {
          infoError = error;
        }
      }

      let disk = [];
      if (info) {
        try {
          const result = await runOnce(["system", "df", "--format", "{{json .}}"], { timeoutMs: 12000 });
          disk = parseJsonLines(result.stdout);
        } catch {
          disk = [];
        }
      }

      let compose = [];
      if (info) {
        try {
          const result = await runOnce(["compose", "ls", "--format", "json"], { timeoutMs: 12000 });
          const parsed = parseJson(result.stdout);
          compose = Array.isArray(parsed) ? parsed : parseJsonLines(result.stdout);
        } catch {
          compose = [];
        }
      }

      return {
        checkedAt: Date.now(),
        cli: {
          available: Boolean(client),
          version: client?.Version ?? null,
          apiVersion: client?.ApiVersion ?? null,
          os: client?.Os ?? null,
          arch: client?.Arch ?? null,
          // CLI 拿得到版本时不再回传错误文本：daemon 连不上的信息归 daemon 卡片。
          error: client
            ? null
            : versionError
              ? tailText(String(versionError.message || versionError), 400)
              : null,
        },
        daemon: {
          online: Boolean(server && info),
          version: info?.ServerVersion ?? server?.Version ?? null,
          apiVersion: server?.ApiVersion ?? null,
          operatingSystem: info?.OperatingSystem ?? server?.Os ?? null,
          osType: info?.OSType ?? null,
          architecture: info?.Architecture ?? server?.Arch ?? null,
          kernelVersion: info?.KernelVersion ?? server?.KernelVersion ?? null,
          driver: info?.Driver ?? null,
          name: info?.Name ?? null,
          cpus: Number.isFinite(info?.NCPU) ? info.NCPU : null,
          memoryBytes: Number.isFinite(info?.MemTotal) ? info.MemTotal : null,
          containers: {
            total: Number.isFinite(info?.Containers) ? info.Containers : null,
            running: Number.isFinite(info?.ContainersRunning) ? info.ContainersRunning : null,
            paused: Number.isFinite(info?.ContainersPaused) ? info.ContainersPaused : null,
            stopped: Number.isFinite(info?.ContainersStopped) ? info.ContainersStopped : null,
          },
          images: Number.isFinite(info?.Images) ? info.Images : null,
          rootDir: info?.DockerRootDir ?? null,
          // daemon 离线时把连接错误挂在这里，概览的引擎卡片直接展示原因。
          error: infoError
            ? tailText(String(infoError.message || infoError), 400)
            : server
              ? null
              : versionError
                ? tailText(String(versionError.message || versionError), 400)
                : null,
        },
        disk,
        compose,
      };
    },

    /** 连接自动检测：CLI 是否可用、版本、已有 context 列表，供概览的连接卡片展示。 */
    async detect() {
      const cli = { bin: runtime.bin, found: false, version: null, error: null };
      try {
        const result = await runOnce(["version", "--format", "{{json .Client}}"], {
          timeoutMs: 8000,
          tolerateExit: true,
        });
        const doc = parseJson(result.stdout);
        if (doc) {
          cli.found = true;
          cli.version = doc.Version ?? null;
        } else {
          cli.error = tailText((result.stderr || "").trim(), 400);
        }
      } catch (error) {
        cli.error = tailText(String(error?.message || error), 400);
      }

      let contexts = [];
      if (cli.found) {
        try {
          const result = await runOnce(["context", "ls", "--format", "{{json .}}"], {
            timeoutMs: 8000,
            tolerateExit: true,
          });
          contexts = parseJsonLines(result.stdout).map((row) => ({
            name: String(row.Name ?? ""),
            current: row.Current === true,
            description: String(row.Description ?? ""),
            dockerEndpoint: String(row.DockerEndpoint ?? ""),
          }));
        } catch {
          contexts = [];
        }
      }

      return {
        checkedAt: Date.now(),
        cli,
        contexts,
        env: {
          dockerHost: runtime.env?.DOCKER_HOST ?? process.env.DOCKER_HOST ?? null,
          dockerContext: runtime.env?.DOCKER_CONTEXT ?? process.env.DOCKER_CONTEXT ?? null,
        },
      };
    },

    listContainers: withCache(800, rawListContainers),
    listImages: withCache(800, rawListImages),

    /**
     * 流式执行：docker build 这类输出很长、要实时看进度的命令用。
     * 返回 { done: Promise<{ code }>, cancel() }，与 SSH 上传接口保持一致的形状。
     */
    stream(args, { cwd, onLine } = {}) {
      let child;
      try {
        child = spawn(runtime.bin, args, {
          windowsHide: true,
          cwd: cwd || undefined,
          env: runtime.env || { ...process.env, DOCKER_CLI_HINTS: "false" },
        });
      } catch (error) {
        onLine?.(`启动失败：${String(error?.message || error)}`);
        return { done: Promise.resolve({ code: -1 }), cancel: () => {} };
      }

      let buffer = "";
      // build / compose 的中文提示同样可能跨包，stdout / stderr 各用一个解码器。
      const outDecoder = new StringDecoder("utf8");
      const errDecoder = new StringDecoder("utf8");
      const emit = (raw) => {
        buffer += String(raw);
        let index = buffer.search(/\r?\n/);
        while (index >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + (buffer[index] === "\r" ? 2 : 1));
          if (line.trim()) onLine?.(line);
          index = buffer.search(/\r?\n/);
        }
      };

      child.stdout?.on("data", (chunk) => emit(outDecoder.write(chunk)));
      child.stderr?.on("data", (chunk) => emit(errDecoder.write(chunk)));

      const done = new Promise((resolve) => {
        let settled = false;
        const finish = (code) => {
          if (settled) return;
          settled = true;
          buffer += outDecoder.end() + errDecoder.end();
          if (buffer.trim()) onLine?.(buffer);
          buffer = "";
          resolve({ code });
        };
        child.on("error", (error) => {
          onLine?.(`执行失败：${String(error?.message || error)}`);
          finish(-1);
        });
        child.on("close", (code) => finish(Number.isFinite(code) ? code : -1));
      });

      return {
        done,
        cancel: () => {
          try {
            child.kill("SIGTERM");
          } catch {
            // 进程可能已退出，忽略。
          }
        },
      };
    },

    async inspectContainer(id) {
      const result = await runOnce(["inspect", "--type", "container", id], { timeoutMs: 15000 });
      const parsed = parseJson(result.stdout);
      const item = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!item) throw new DockerError("CONTAINER_NOT_FOUND", "容器不存在");
      return summarizeInspect(item);
    },

    /**
     * 打开一条常驻日志流（docker logs -f），返回 { close }。
     * 容器 stderr 在 docker CLI 里走 stderr，必须按行拆开再交给调用方，
     * 用 StringDecoder 顶住跨 chunk 的多字节字符，避免中文被切成乱码。
     */
    openLogStream(id, { tail = 300, onLine = () => {}, onStderr = () => {}, onEnd = () => {} } = {}) {
      let child;
      try {
        child = spawn(runtime.bin, ["logs", "--tail", String(tail), "--timestamps", "-f", id], {
          windowsHide: true,
          env: runtime.env || { ...process.env, DOCKER_CLI_HINTS: "false" },
        });
      } catch (error) {
        setTimeout(() => onEnd({ code: -1, error: `启动 docker logs 失败：${String(error?.message || error)}` }), 0);
        return { close: () => {} };
      }

      const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
      const buffers = { stdout: "", stderr: "" };
      const drain = (kind, stream) => {
        let index = buffers[kind].search(/\r?\n/);
        while (index >= 0) {
          const line = buffers[kind].slice(0, index);
          buffers[kind] = buffers[kind].slice(index + (buffers[kind][index] === "\r" ? 2 : 1));
          if (line.length > 0) stream(line);
          index = buffers[kind].search(/\r?\n/);
        }
      };
      const feed = (kind, chunk, stream) => {
        buffers[kind] += decoders[kind].write(chunk);
        drain(kind, stream);
      };
      const flushRest = (kind, stream) => {
        const text = buffers[kind];
        buffers[kind] = "";
        if (text.length > 0) stream(text);
      };

      child.stdout?.on("data", (chunk) => feed("stdout", chunk, onLine));
      child.stderr?.on("data", (chunk) => feed("stderr", chunk, onStderr));

      let settled = false;
      const finish = (code, error) => {
        if (settled) return;
        settled = true;
        buffers.stdout += decoders.stdout.end();
        buffers.stderr += decoders.stderr.end();
        drain("stdout", onLine);
        drain("stderr", onStderr);
        flushRest("stdout", onLine);
        flushRest("stderr", onStderr);
        onEnd({ code: Number.isFinite(code) ? code : -1, error: error || "" });
      };
      child.on("error", (error) => finish(-1, `启动 docker logs 失败：${String(error?.message || error)}`));
      child.on("close", (code) => finish(code, ""));

      return {
        close: () => {
          try {
            child.kill("SIGTERM");
          } catch {
            // 进程可能已退出。
          }
        },
      };
    },

    async containerStats(id) {
      const result = await runOnce(["stats", "--no-stream", "--format", "{{json .}}", id], { timeoutMs: 20000 });
      const rows = parseJsonLines(result.stdout);
      const row = rows[0] || null;
      if (!row) throw new DockerError("STATS_UNAVAILABLE", "拿不到该容器的资源占用");
      return {
        container: String(row.Container ?? ""),
        name: String(row.Name ?? ""),
        cpu: String(row.CPUPerc ?? ""),
        memoryUsage: String(row.MemUsage ?? ""),
        memoryPercent: String(row.MemPerc ?? ""),
        netIO: String(row.NetIO ?? ""),
        blockIO: String(row.BlockIO ?? ""),
        pids: String(row.PIDs ?? ""),
      };
    },

    /** action 走白名单；remove 单独支持 force，避免误删运行中容器。 */
    async containerAction(id, action, { force = false } = {}) {
      if (action === "remove") {
        await runOnce(["rm", ...(force ? ["--force"] : []), id], { timeoutMs: 60000 });
        return { action, id, removed: true };
      }
      if (!WRITE_ACTIONS.has(action)) throw new DockerError("INVALID_ACTION", `不支持的操作：${action}`);
      await runOnce([action, id], { timeoutMs: 60000 });
      log(`container ${action} ${id}`);
      return { action, id, ok: true };
    },

    async pullImage(reference) {
      const result = await runOnce(["pull", reference], { timeoutMs: 600 * 1000, maxBytes: 2 * 1024 * 1024 });
      const text = `${result.stdout}\n${result.stderr}`.trim();
      const lines = text.split(/\r?\n/).filter(Boolean).slice(-12);
      log(`image pull ${reference}`);
      return { reference, output: lines };
    },

    async removeImage(reference, { force = false } = {}) {
      const result = await runOnce(["rmi", ...(force ? ["--force"] : []), reference], { timeoutMs: 60000 });
      log(`image remove ${reference}`);
      return { reference, output: result.stdout.trim().split(/\r?\n/).filter(Boolean).slice(-6) };
    },

    /** compose 服务清单：config --services 不需要 daemon，先拿名字再做状态查询。 */
    async composeServiceNames(file) {
      const result = await runOnce(["compose", "-f", file, "config", "--services"], {
        timeoutMs: 20000,
        tolerateExit: true,
      });
      if (result.code !== 0) return [];
      return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    },

    /** compose 服务运行状态：依赖 daemon，连不上时把原因回传给面板。 */
    async composeServices(file) {
      const result = await runOnce(["compose", "-f", file, "ps", "--format", "json"], {
        timeoutMs: 20000,
        tolerateExit: true,
      });
      if (result.code !== 0) {
        return { services: [], error: tailText((result.stderr || "").trim(), 400) || null };
      }
      const parsed = parseJson(result.stdout);
      const rows = Array.isArray(parsed) ? parsed : parseJsonLines(result.stdout);
      return {
        services: rows.map((row) => ({
          name: String(row.Name ?? ""),
          service: String(row.Service ?? ""),
          state: String(row.State ?? ""),
          health: String(row.Health ?? ""),
          exitCode: Number.isFinite(row.ExitCode) ? row.ExitCode : null,
          publishers: Array.isArray(row.Publishers)
            ? row.Publishers.map((item) => `${item.URL || "0.0.0.0"}:${item.PublishedPort || ""}->${item.TargetPort || ""}`)
            : [],
        })),
        error: null,
      };
    },
  };
}
