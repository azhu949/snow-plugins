// 开关：与 Snow App 通用设置里的 toggle 一致（隐藏 checkbox + 胶囊滑块 + 状态文字）。
import { h } from "preact";

export function StSwitch({ checked, onChange, onText, offText, disabled = false }) {
  return h(
    "label",
    { className: "st-toggle" },
    h("input", {
      type: "checkbox",
      checked: Boolean(checked),
      disabled,
      onChange: (event) => onChange(event.currentTarget.checked),
    }),
    h("span", { className: "st-toggle-slider", "aria-hidden": "true" }),
    h("span", { className: "st-toggle-text" }, checked ? onText : offText),
  );
}
