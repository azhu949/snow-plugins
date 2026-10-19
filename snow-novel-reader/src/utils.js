// 通用小工具：HTML 转义、数值收敛、体积格式化与模板插值。

export function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

export function clamp(value, min, max) {
  const n = Number(value);
  if (!isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "0 KB";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

// 返回最后一个 arr[i] <= value 的下标 + 1（即插入位置）
export function upperBound(arr, value) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function applyValues(text, values) {
  if (!values) return text;
  return String(text).replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return values[key] === undefined || values[key] === null ? match : String(values[key]);
  });
}
