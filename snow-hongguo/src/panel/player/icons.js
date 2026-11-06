// 播放器控件图标：内联 SVG（currentColor），不引入图标库。
// 只使用固定字符串，不拼接外部数据。
const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS = {
  play: '<path d="M8 5.2v13.6L19.4 12z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="6.4" y="5" width="4" height="14" rx="0.8" fill="currentColor" stroke="none"/>' +
    '<rect x="13.6" y="5" width="4" height="14" rx="0.8" fill="currentColor" stroke="none"/>',
  next:
    '<path d="M6 5.6v12.8L15.2 12z" fill="currentColor" stroke="none"/>' +
    '<rect x="16.6" y="5" width="2" height="14" rx="0.8" fill="currentColor" stroke="none"/>',
  volume:
    '<path d="M4 9.2h3.4L12 5.4v13.2L7.4 14.8H4z" fill="currentColor" stroke="none"/>' +
    '<path d="M15 9.2a4 4 0 0 1 0 5.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M17.6 6.8a7.4 7.4 0 0 1 0 10.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  mute:
    '<path d="M4 9.2h3.4L12 5.4v13.2L7.4 14.8H4z" fill="currentColor" stroke="none"/>' +
    '<path d="M16 9.6l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  pip:
    '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" stroke="none"/>',
  mini:
    '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" stroke="none"/>',
  restore:
    '<rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M9 12h6m-2.5-2.5L15 12l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  expand:
    '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  collapse:
    '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("hg-player-icon");
  svg.innerHTML = PATHS[name] || "";
  return svg;
}
