// 长任务执行器：docker build / compose up / 镜像上传这类会跑几十秒的命令放这里。
// 每条任务把输出按行累积在内存，面板用 offset 增量拉取，不用推送通道也能看到进度。
// 两类任务：start 走子进程（输出直接读 stdout/stderr），startCustom 走自定义流程（自己 push 行）。
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { killChildTree } from "./process.js";

const MAX_TASKS = 20;
const MAX_LINES = 2000;
const MAX_LINE_CHARS = 1000;

const tailText = (text, max) => (text.length > max ? text.slice(-max) : text);

/** 会把值带进命令行的参数：日志里只保留键名，避免环境变量与构建参数里的密钥落进任务日志。 */
const SECRET_VALUE_FLAGS = new Set(["-e", "--env", "--build-arg"]);

/** 内联写法：--env=KEY=VALUE、-e=KEY=VALUE、--build-arg=KEY=VALUE。 */
const SECRET_INLINE_FLAG = /^(--env|--build-arg|-e)=(.*)$/;

/** KEY=VALUE 只保留键名；没有等号（docker 的透传写法）时整段掩码。 */
const maskPair = (value) => {
  const text = String(value ?? "");
  const at = text.indexOf("=");
  return at > 0 ? `${text.slice(0, at)}=***` : "***";
};

export const maskCommandArgs = (args) => {
  const list = Array.isArray(args) ? args : [];
  const masked = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = String(list[index] ?? "");
    const inline = SECRET_INLINE_FLAG.exec(item);
    if (inline) {
      masked.push(`${inline[1]}=${maskPair(inline[2])}`);
      continue;
    }
    // 短选项紧跟值的写法：-eKEY=VALUE，pflag 接受，不能只认 -e 单独成项。
    if (item.length > 2 && item.startsWith("-e") && !item.startsWith("--")) {
      masked.push(`-e${maskPair(item.slice(2))}`);
      continue;
    }
    masked.push(item);
    if (!SECRET_VALUE_FLAGS.has(item)) continue;
    if (index + 1 >= list.length) continue;
    masked.push(maskPair(list[index + 1]));
    index += 1;
  }
  return masked;
};

export function createTaskRunner({ log = () => {}, getBin, getEnv } = {}) {
  const tasks = new Map();
  const order = [];
  let seq = 0;
  /** 插件停止后置为 true：之后注册的取消处理器要立刻执行，避免漏杀子进程。 */
  let disposed = false;

  const prune = () => {
    while (order.length > MAX_TASKS) {
      // 运行中的任务不清理，避免按钮还指着它；但不能因此挡住它后面已完成任务的淘汰，
      // 否则长构建排在最前时任务表会无限增长。
      const index = order.findIndex((id) => tasks.get(id)?.status !== "running");
      if (index < 0) break;
      const [stale] = order.splice(index, 1);
      const task = tasks.get(stale);
      if (task) task.cancelHandler = null;
      tasks.delete(stale);
    }
  };

  const pushLine = (task, text) => {
    const line = text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text;
    task.lineSeq += 1;
    task.lines.push(line);
    if (task.lines.length > MAX_LINES) {
      task.lines.shift();
      task.firstSeq += 1;
    }
  };

  const nextId = () => `t${Date.now().toString(36)}-${(seq++).toString(36)}`;

  const start = ({ kind, title, args, cwd }) => {
    const id = nextId();
    const task = {
      id,
      kind,
      title: String(title || kind),
      status: "running",
      lines: [],
      lineSeq: 0,
      firstSeq: 1,
      exitCode: null,
      error: null,
      startedAt: Date.now(),
      endedAt: null,
      child: null,
      cancelHandler: null,
      finished: false,
    };
    tasks.set(id, task);
    order.push(id);
    prune();

    const bin = typeof getBin === "function" ? getBin() : getBin || "docker";
    const env = typeof getEnv === "function" ? getEnv() : { ...process.env, DOCKER_CLI_HINTS: "false" };

    let child;
    try {
      child = spawn(bin, args, { windowsHide: true, cwd: cwd || undefined, env });
    } catch (error) {
      task.status = "failed";
      task.error = String(error?.message || error);
      task.endedAt = Date.now();
      return { id: task.id, task };
    }

    task.child = child;

    // stdout / stderr 各用一个解码器与缓冲：中文可能被 chunk 边界切开，共用解码器还会让
    // 两条流的半行拼到一起。
    const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
    const buffers = { stdout: "", stderr: "" };
    const appendText = (kind, text) => {
      buffers[kind] += text;
      let index = buffers[kind].search(/\r?\n/);
      while (index >= 0) {
        const line = buffers[kind].slice(0, index);
        buffers[kind] = buffers[kind].slice(index + (buffers[kind][index] === "\r" ? 2 : 1));
        pushLine(task, line);
        index = buffers[kind].search(/\r?\n/);
      }
    };
    const onData = (kind) => (raw) => appendText(kind, decoders[kind].write(raw));

    child.stdout?.on("data", onData("stdout"));
    child.stderr?.on("data", onData("stderr"));

    child.on("error", (error) => {
      task.status = "failed";
      task.error = String(error?.message || error);
      task.endedAt = Date.now();
      task.child = null;
      task.finished = true;
      log(`任务失败 ${task.id}：${task.error}`);
    });

    child.on("close", (code) => {
      // 先让解码器吐出残留字节，再切行；顺序反过来会丢掉末尾半个字符。
      for (const kind of ["stdout", "stderr"]) {
        appendText(kind, decoders[kind].end());
        if (buffers[kind]) {
          pushLine(task, buffers[kind]);
          buffers[kind] = "";
        }
      }
      task.exitCode = code;
      task.endedAt = Date.now();
      task.child = null;
      task.finished = true;
      // 已取消的任务保持 cancelled，不被退出码改回 failed。
      if (task.status === "running") task.status = code === 0 ? "succeeded" : "failed";
      log(`任务结束 ${task.id}（${task.kind}）exit=${code}`);
    });

    log(`任务开始 ${task.id}（${task.kind}）：docker ${maskCommandArgs(args).join(" ")}`);
    return { id: task.id, task };
  };

  /**
   * 自定义任务：不发子进程，由 run(controller) 自己往里推行。
   * controller = { push(line), setCancelHandler(fn) }；run 返回 { code } 或 { cancelled: true }。
   */
  const startCustom = ({ kind, title, run }) => {
    const id = nextId();
    const task = {
      id,
      kind,
      title: String(title || kind),
      status: "running",
      lines: [],
      lineSeq: 0,
      firstSeq: 1,
      exitCode: null,
      error: null,
      startedAt: Date.now(),
      endedAt: null,
      child: null,
      cancelHandler: null,
      finished: false,
    };
    tasks.set(id, task);
    order.push(id);
    prune();

    const settle = (patch) => {
      if (task.finished) return;
      task.finished = true;
      Object.assign(task, patch);
      task.endedAt = Date.now();
      task.cancelHandler = null;
      log(`任务结束 ${task.id}（${task.kind}）status=${task.status}${task.error ? `：${task.error}` : ""}`);
    };

    const controller = {
      push: (line) => {
        if (task.finished) return;
        pushLine(task, String(line ?? ""));
      },
      setCancelHandler: (handler) => {
        // 任务已被 dispose 取消时，晚注册的处理器要立刻执行，否则子进程会漏杀。
        if (disposed && task.status === "cancelled") {
          if (typeof handler === "function") {
            try {
              handler();
            } catch {
              // 忽略。
            }
          }
          return;
        }
        task.cancelHandler = typeof handler === "function" ? handler : null;
      },
    };

    Promise.resolve()
      .then(() => run(controller))
      .then((result) => {
        if (result?.cancelled === true) {
          settle({ status: "cancelled", exitCode: null });
          return;
        }
        const code = Number.isFinite(result?.code) ? result.code : 0;
        // 自定义任务也可能自带失败文案（例如 spawn 的 ENOENT / 环境块超限）：落到任务详情，
        // 面板不必只看一个 exit 码去猜原因。
        const error = code === 0 ? "" : String(result?.error || "").trim();
        settle({ status: code === 0 ? "succeeded" : "failed", exitCode: code, error: error || null });
      })
      .catch((error) => {
        settle({ status: "failed", error: String(error?.message || error) });
      });

    log(`任务开始 ${task.id}（${task.kind}）：${task.title}`);
    return { id: task.id, task };
  };

  /** 面板轮询：offset 是上一次拿到的 nextOffset，返回增量行。 */
  const get = (id, offset = 0) => {
    const task = tasks.get(String(id || ""));
    if (!task) return null;
    const asked = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
    const firstIndex = task.firstSeq;
    // asked 为 0 也代表「上次什么都没拿到」：此时缓冲区首行不是第 1 行就说明已经丢过行。
    const gap = firstIndex - 1 > asked;
    const from = Math.max(asked, firstIndex - 1);
    const slice = task.lines.slice(from - (firstIndex - 1));
    return {
      id: task.id,
      kind: task.kind,
      title: task.title,
      status: task.status,
      exitCode: task.exitCode,
      error: task.error,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
      lines: slice,
      nextOffset: task.lineSeq,
      truncated: gap,
    };
  };

  const cancel = (id) => {
    const task = tasks.get(String(id || ""));
    if (!task || task.finished) return false;
    if (typeof task.cancelHandler === "function") {
      try {
        task.cancelHandler();
      } catch {
        return false;
      }
      task.status = "cancelled";
      return true;
    }
    if (!task.child) return false;
    try {
      killChildTree(task.child, "SIGTERM");
    } catch {
      return false;
    }
    task.status = "cancelled";
    return true;
  };

  /**
   * 插件停止 / App 退出时调用：取消所有未结束的任务并杀掉仍在跑的子进程。
   * 只改状态不够：前置 npm / mvn 与 compose 子进程会脱离宿主继续运行。
   */
  const dispose = () => {
    disposed = true;
    for (const task of tasks.values()) {
      if (task.finished) continue;
      const handler = task.cancelHandler;
      const child = task.child;
      // 先落到终态，之后 run 里再推的日志与状态都不会覆盖「已取消」。
      task.finished = true;
      task.status = "cancelled";
      task.endedAt = Date.now();
      task.cancelHandler = null;
      task.child = null;
      try {
        if (typeof handler === "function") handler();
        else killChildTree(child, "SIGTERM");
      } catch {
        // 取消自身失败不影响退出流程。
      }
    }
  };

  return { start, startCustom, get, cancel, dispose, tailText };
}
