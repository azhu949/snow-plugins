// 子进程终止：Windows 上 npm / mvn 是 .cmd 包装脚本，实际由 cmd.exe 解释执行并派生
// node / java；child.kill() 只结束最外层的 cmd.exe，残留的构建进程仍会继续写构建上下文。
// 这里统一按进程树结束。
import { spawn } from "node:child_process";

/**
 * 结束一个子进程及其派生的整棵进程树。
 * POSIX 侧现有调用都没有 detached（子进程不是进程组组长），负 pid 会命中宿主进程组，
 * 所以继续保持 child.kill(signal)，只有 Windows 走 taskkill /T。
 * 返回是否发出了终止动作；调用方不需要等待终止完成。
 */
export const killChildTree = (child, signal = "SIGTERM") => {
  if (!child || typeof child.kill !== "function") return false;
  // 已退出就不要再发终止：缩短 pid 被复用后误杀其它进程的窗口。
  if (typeof child.exitCode === "number" || Boolean(child.signalCode)) return false;

  if (process.platform === "win32" && Number.isInteger(child.pid) && child.pid > 0) {
    let killer = null;
    try {
      killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      killer = null;
    }
    if (killer) {
      // taskkill 不可用时不能留下未处理的 error 事件，退回只结束外层进程。
      killer.on("error", () => {
        try {
          child.kill(signal);
        } catch {
          // 进程可能已退出。
        }
      });
      killer.unref?.();
      return true;
    }
  }

  try {
    child.kill(signal);
    return true;
  } catch {
    return false;
  }
};
