// 文本长度护栏：面板输入、读入输入框、卡片翻译共用同一份上限与截断语义。
// 卡片路径曾经绕过这层护栏，把整段 AI 回复直接送进引擎，按段落切片后会串行发几十个请求。
import { MAX_SOURCE_CHARS } from "./constants.js";

// 返回截断后的文本与是否发生了截断，调用方据此决定是否提示上限。
export function clampSource(text) {
  const value = String(text ?? "");
  if (value.length <= MAX_SOURCE_CHARS) return { text: value, truncated: false };
  return { text: value.slice(0, MAX_SOURCE_CHARS), truncated: true };
}

// 译文是否仍对应当前输入：与翻译前、回填前的归一化口径保持一致（clamp 后 trim）。
// 快照缺失（升级前留下的旧结果）按「仍对应」处理，不阻断既有交互。
export function resultOutdated(result, text) {
  if (!result || typeof result.sourceText !== "string") return false;
  return clampSource(text).text.trim() !== result.sourceText;
}
