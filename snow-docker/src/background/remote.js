// 远程 daemon 适配层：接口形状与本机 createDocker 保持一致，面板无需区分目标。
// 命令全部通过已建立的 SSH 会话执行，解析复用 docker.js 里的同一套函数，
// 这样「容器 / 镜像 / 概览」三个视图在本机与远程看到的字段完全一致。
import {
  DockerError,
  parseJson,
  parseJsonLines,
  summarizeInspect,
  toContainerSummary,
  toImageSummary,
} from "./docker.js";

const LIST_TIMEOUT_MS = 20000;
const ACTION_TIMEOUT_MS = 60000;
const STATS_TIMEOUT_MS = 25000;
const PULL_TIMEOUT_MS = 600 * 1000;

const tailText = (text, max) => (text.length > max ? text.slice(-max) : text);

const WRITE_ACTIONS = new Set(["start", "stop", "restart", "pause", "unpause"]);

export function createRemoteDocker({ ssh, session } = {}) {
  const label = session ? `${session.username || ""}@${session.host || ""}` : "远程主机";
  // 会话快照里的 id 会随每次调用下发：用户切到别的服务器后，这里的命令不能被发到新主机。
  const sessionId = session?.id || "";
  const run = (args, options) => ssh.execCollect({ args, sessionId, ...options });

  /** 并行取多条 docker 命令的结果：单条失败只影响自己，不拖累其它字段。 */
  const settle = async (args) => {
    try {
      return { ok: true, result: await run(args, { timeoutMs: LIST_TIMEOUT_MS }) };
    } catch (error) {
      return { ok: false, error };
    }
  };

  const listContainers = async ({ all = true } = {}) => {
    const result = await run(
      ["ps", ...(all ? ["--all"] : []), "--no-trunc", "--format", "{{json .}}"],
      { timeoutMs: LIST_TIMEOUT_MS }
    );
    return { containers: parseJsonLines(result.stdout).map(toContainerSummary), truncated: result.truncated };
  };

  const listImages = async () => {
    const result = await run(["images", "--format", "{{json .}}"], { timeoutMs: LIST_TIMEOUT_MS });
    return { images: parseJsonLines(result.stdout).map(toImageSummary), truncated: result.truncated };
  };

  return {
    /** 面板用它标注当前数据来自哪台机器。 */
    target: { kind: "remote", id: session?.id || "", label },

    async system() {
      let versionDoc = null;
      let versionError = null;
      try {
        // daemon 离线时 docker version 退出码非零，但 Client JSON 仍在 stdout：
        // 容忍退出码，先解析结果再判断 CLI 是否可用，避免把「daemon 未启动」误报成「CLI 缺失」。
        const result = await run(["version", "--format", "{{json .}}"], {
          timeoutMs: LIST_TIMEOUT_MS,
          tolerateExit: true,
        });
        versionDoc = parseJson(result.stdout);
        if (result.code !== 0) {
          const reason = (result.stderr || "").trim();
          versionError = new DockerError(
            "DAEMON_UNAVAILABLE",
            reason || `docker version 退出码 ${result.code}`
          );
        }
      } catch (error) {
        versionError = error;
      }

      const client = versionDoc?.Client || null;
      const server = versionDoc?.Server || null;

      let info = null;
      let infoError = null;
      let disk = [];
      let compose = [];
      if (server) {
        // info / df / compose 互不依赖，并行跑：构建刚结束时 daemon 正在落盘镜像层，
        // 串行三条会叠加到面板的请求超时之上，看起来就像「流程结束后必报超时」。
        const [infoResult, diskResult, composeResult] = await Promise.all([
          settle(["info", "--format", "{{json .}}"]),
          settle(["system", "df", "--format", "{{json .}}"]),
          settle(["compose", "ls", "--format", "json"]),
        ]);
        if (infoResult.ok) {
          info = parseJson(infoResult.result.stdout);
        } else {
          infoError = infoResult.error;
        }
        if (diskResult.ok) disk = parseJsonLines(diskResult.result.stdout);
        if (composeResult.ok) {
          const parsed = parseJson(composeResult.result.stdout);
          compose = Array.isArray(parsed) ? parsed : parseJsonLines(composeResult.result.stdout);
        }
      }

      return {
        target: { kind: "remote", id: session?.id || "", label },
        checkedAt: Date.now(),
        cli: {
          available: Boolean(client),
          version: client?.Version ?? null,
          apiVersion: client?.ApiVersion ?? null,
          os: client?.Os ?? null,
          arch: client?.Arch ?? null,
          bin: session?.dockerPath || "docker",
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
        // 远程没有本机 context 的概念，概览的连接卡片在远程目标下不展示。
        contexts: [],
      };
    },

    listContainers,
    listImages,

    async inspectContainer(id) {
      const result = await run(["inspect", "--type", "container", id], { timeoutMs: LIST_TIMEOUT_MS });
      const parsed = parseJson(result.stdout);
      const item = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!item) throw new DockerError("CONTAINER_NOT_FOUND", "容器不存在");
      return summarizeInspect(item);
    },

    /**
     * 常驻远程日志流：一条 SSH 通道跑 docker logs -f，返回 { close }。
     * 没有超时与字节上限，读多少、留多少由后台的环形缓冲决定。
     */
    openLogStream(id, { tail = 300, onLine = () => {}, onStderr = () => {}, onEnd = () => {} } = {}) {
      const handle = ssh.execDocker({
        args: ["logs", "--tail", String(tail), "--timestamps", "-f", id],
        onLine,
        onStderr,
        timeoutMs: 0,
        maxBytes: 0,
        sessionId,
      });
      handle.done
        .then((result) => onEnd({ code: Number.isFinite(result?.code) ? result.code : -1, error: "" }))
        .catch((error) => onEnd({ code: -1, error: String(error?.message || error) }));
      return { close: () => handle.cancel() };
    },

    async containerStats(id) {
      const result = await run(["stats", "--no-stream", "--format", "{{json .}}", id], {
        timeoutMs: STATS_TIMEOUT_MS,
      });
      const row = parseJsonLines(result.stdout)[0] || null;
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

    async containerAction(id, action, { force = false } = {}) {
      if (action === "remove") {
        await run(["rm", ...(force ? ["--force"] : []), id], { timeoutMs: ACTION_TIMEOUT_MS });
        return { action, id, removed: true };
      }
      if (!WRITE_ACTIONS.has(action)) throw new DockerError("INVALID_ACTION", `不支持的操作：${action}`);
      await run([action, id], { timeoutMs: ACTION_TIMEOUT_MS });
      return { action, id, ok: true };
    },

    async pullImage(reference) {
      const result = await run(["pull", reference], { timeoutMs: PULL_TIMEOUT_MS, maxBytes: 2 * 1024 * 1024 });
      const text = `${result.stdout}\n${result.stderr}`.trim();
      return { reference, output: text.split(/\r?\n/).filter(Boolean).slice(-12) };
    },

    async removeImage(reference, { force = false } = {}) {
      const result = await run(["rmi", ...(force ? ["--force"] : []), reference], {
        timeoutMs: ACTION_TIMEOUT_MS,
      });
      return { reference, output: result.stdout.trim().split(/\r?\n/).filter(Boolean).slice(-6) };
    },
  };
}
