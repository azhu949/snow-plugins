// 播放器通用工具：base64 解码、时间/文件名、剪贴板。保持无副作用，方便引擎与控件共用。
import { formatDuration } from "../ui/common.js";

export { formatDuration };

export const clamp = (value, min, max) => {
  const number = Number.isFinite(Number(value)) ? Number(value) : 0;
  if (number < min) return min;
  if (number > max) return max;
  return number;
};

/** 后台返回的 base64 -> Uint8Array；兼容换行/空白与空值。 */
export const decodeBase64 = (value) => {
  const text = typeof value === "string" ? value.replace(/\s+/g, "") : "";
  if (!text) return new Uint8Array(0);
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/** 毫秒 -> mm:ss；非法值按 0 处理。 */
export const formatClock = (ms) => formatDuration(Number.isFinite(Number(ms)) ? Number(ms) : 0);

/** 文件名清洗：去掉 Windows 不允许的字符，长度限制 80。 */
export const safeFileName = (name) => {
  const text = String(name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (text || "video").slice(0, 80);
};

/** 复制到剪贴板；navigator.clipboard 不可用时退回 textarea + execCommand。 */
export const copyText = async (text) => {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // 权限被拒时走兜底。
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
    area.remove();
    return ok;
  } catch {
    return false;
  }
};

/** 编码名 -> 面向用户的短标签；未知时回退到 codec 第一段。 */
export const codecLabel = (codec) => {
  const text = String(codec || "").toLowerCase();
  if (/hvc1|hev1|hevc/.test(text)) return "HEVC";
  if (/avc1|avc3|h264/.test(text)) return "H.264";
  if (/av01|av1/.test(text)) return "AV1";
  if (/vp09|vp9/.test(text)) return "VP9";
  const first = String(codec || "").split(",")[0].trim();
  return first || "unknown";
};
