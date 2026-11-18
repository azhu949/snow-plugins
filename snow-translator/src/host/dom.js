// 宿主 DOM 契约：只依赖 data-snow-anchor / data-snow-slot 与输入框的既有类名。
export function findAnchor(name) {
  try {
    if (typeof snow !== "undefined" && typeof snow.anchor === "function") {
      const element = snow.anchor(name);
      if (element) return element;
    }
  } catch {
    // 宿主不支持锚点 API 时走选择器回退。
  }
  return document.querySelector(`[data-snow-anchor="${name}"]`);
}

export function findSlot(name) {
  try {
    if (typeof snow !== "undefined" && typeof snow.slot === "function") {
      const element = snow.slot(name);
      if (element) return element;
    }
  } catch {
    // 宿主不支持插槽 API 时走选择器回退。
  }
  return document.querySelector(`[data-snow-slot="${name}"]`);
}

export function elementOf(node) {
  if (!node) return null;
  if (node.nodeType === 1) return node;
  return node.parentElement || null;
}

export function inChatMessages(node) {
  const element = elementOf(node);
  return Boolean(element && element.closest('[data-snow-anchor="chat.messages"]'));
}

const INPUT_HOST_SELECTOR = '[data-snow-anchor="chat.input"]';

// 输入框：宿主既有类名只作首选匹配，失效时退到官方锚点内的可编辑节点。
// 脚本是常驻的，别的视图（例如定时任务面板）也有同名类名，所以查询必须收在 chat.input 锚点内。
export function inputField() {
  const host = document.querySelector(INPUT_HOST_SELECTOR);
  if (!host) return null;
  return host.querySelector(".input-field-editable") || host.querySelector('[contenteditable="true"]');
}

export function readInputText() {
  const field = inputField();
  if (!field) return "";
  return String(field.innerText || "")
    .replace(/\u00a0/g, " ")
    .trim();
}

// 输入框是 contenteditable：先用 execCommand 走浏览器的编辑管线（宿主按 input 事件把 DOM 同步回状态），
// 失败时退化为按 Range 整段替换并补派 input 事件。直接赋 textContent 会绕过编辑管线，不再使用。
export function writeInputText(text) {
  const field = inputField();
  if (!field) return false;
  const value = String(text ?? "");
  const selection = window.getSelection();
  if (!selection) return false;
  field.focus();

  let inserted = false;
  // 第一次失败通常是选区状态不干净：重新全选后再试一次，仍失败才走 Range 兜底。
  for (let attempt = 0; attempt < 2 && !inserted; attempt += 1) {
    selectAll(field, selection);
    try {
      inserted = document.execCommand("insertText", false, value);
    } catch {
      inserted = false;
    }
  }

  if (!inserted) {
    const range = document.createRange();
    range.selectNodeContents(field);
    range.deleteContents();
    const node = document.createTextNode(value);
    range.insertNode(node);
    // 光标落在写入内容末尾，与宿主自己的整体替换保持一致，避免选区悬空。
    range.setStart(node, node.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }

  // execCommand 返回 true 也不等于真的写进去了：写后核对，避免界面报成功而输入框没变。
  // 比对时把空白折叠成单个空格：多行文本经编辑管线会变成块级节点，textContent 会丢掉换行。
  return normalizeInputText(field.innerText) === normalizeInputText(value);
}

function normalizeInputText(input) {
  return String(input ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function selectAll(field, selection) {
  const range = document.createRange();
  range.selectNodeContents(field);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function messageText(element) {
  if (!element) return "";
  // 正文类名只是首选增强：宿主改名时退到锚点级的纯文本兜底。
  const body = element.querySelector(".ai-message-summary") || element.querySelector(".ai-message-content");
  const text = body ? String(body.innerText || "").trim() : "";
  if (text) return text;
  return plainTextOutsideSlots(element);
}

// 锚点级兜底：只取正文文本，跳过插件插槽与 aria-hidden 区域，
// 否则页脚时间戳、其它插件的页脚文案都会混进译文。
function plainTextOutsideSlots(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('[data-snow-slot], [aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
      return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const parts = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.nodeValue);
  return parts.join("\n").trim();
}

export async function copyText(text) {
  const value = String(text ?? "");
  try {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(value);
      return true;
    }
  } catch {
    // 剪贴板 API 不可用时回退 navigator.clipboard。
  }
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
