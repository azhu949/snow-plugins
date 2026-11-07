import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createSelect } from "../src/panel/ui/select.js";

let dom;
let controls;
const options = [
  { value: "a", label: "Alpha" },
  { value: "disabled", label: "Disabled", disabled: true },
  { value: "b", label: "Beta" },
];
const mount = (props = {}, parent = dom.window.document.body) => {
  const control = createSelect({ value: "a", ariaLabel: "测试选择", options, ...props }, dom.window.document.createElement("button"));
  parent.append(control.element);
  controls.push(control);
  return control;
};
const key = (node, value) => {
  const event = new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  return event;
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const menu = () => dom.window.document.querySelector(".hg-select-menu");

beforeEach(() => {
  dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
  controls = [];
});
afterEach(() => {
  controls.forEach((control) => control.destroy());
  assert.equal(menu(), null);
  dom.window.close();
});

test("菜单位于 body，选中状态与可见标签同步，选择只回调一次且还原焦点", () => {
  const doc = dom.window.document;
  const container = doc.createElement("div");
  container.style.overflow = "hidden";
  doc.body.append(container);
  const changes = [];
  const control = mount({ onChange: (value) => changes.push(value) }, container);
  control.element.click();
  assert.equal(menu().parentElement, doc.body);
  assert.equal(control.element.getAttribute("aria-controls"), menu().id);
  assert.equal(menu().querySelector('[aria-selected="true"]').dataset.value, "a");
  menu().querySelector('[data-value="disabled"]').click();
  assert.deepEqual(changes, []);
  menu().querySelector('[data-value="b"]').click();
  assert.deepEqual(changes, ["b"]);
  assert.equal(control.element.value, "b");
  assert.equal(control.element.textContent, "Beta");
  assert.equal(doc.activeElement, control.element);
  assert.equal(menu(), null);
  control.element.click();
  menu().querySelector('[data-value="b"]').click();
  assert.deepEqual(changes, ["b"]);
});

test("键盘跳过禁用项，支持首尾、输入定位、确认与 Esc，Tab 不阻止焦点移动", () => {
  const changes = [];
  const control = mount({ onChange: (value) => changes.push(value) });
  const trigger = control.element;
  key(trigger, "ArrowDown");
  key(trigger, "ArrowDown");
  assert.equal(menu().querySelector(".is-active").dataset.value, "b");
  key(trigger, "Enter");
  assert.deepEqual(changes, ["b"]);
  key(trigger, "Home");
  assert.equal(menu().querySelector(".is-active").dataset.value, "a");
  key(trigger, "End");
  assert.equal(menu().querySelector(".is-active").dataset.value, "b");
  key(trigger, "a");
  assert.equal(menu().querySelector(".is-active").dataset.value, "a");
  let escaped = false;
  dom.window.document.addEventListener("keydown", () => { escaped = true; });
  key(trigger, "Escape");
  assert.equal(menu(), null);
  assert.equal(escaped, false, "Esc 只收起当前菜单，不退出播放器");
  assert.deepEqual(changes, ["b"]);
  trigger.click();
  assert.equal(key(trigger, "Tab").defaultPrevented, false);
  assert.equal(menu(), null);
});

test("只打开一个菜单，外部点击、失焦、禁用和销毁都会清理弹层", async () => {
  const first = mount();
  const second = mount();
  first.element.click();
  second.element.click();
  assert.equal(first.element.getAttribute("aria-expanded"), "false");
  assert.equal(dom.window.document.querySelectorAll(".hg-select-menu").length, 1);
  dom.window.document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
  assert.equal(menu(), null);
  first.element.click();
  second.element.focus();
  assert.equal(menu(), null);
  first.element.click();
  first.update({ disabled: true });
  assert.equal(menu(), null);
  first.element.click();
  assert.equal(menu(), null);
  first.update({ disabled: false });
  first.element.click();
  first.destroy();
  dom.window.dispatchEvent(new dom.window.Event("resize"));
  await flush();
  assert.equal(menu(), null);
});

test("菜单随窗口空间向上展开并限制宽度，滚动和尺寸变化后重定位", () => {
  const control = mount({ dropdownMinWidth: 180 });
  let rect = { left: 990, top: 700, bottom: 730, right: 1060, width: 70, height: 30 };
  control.element.getBoundingClientRect = () => rect;
  control.element.click();
  assert.equal(menu().dataset.placement, "top");
  assert.ok(Number.parseFloat(menu().style.top) < rect.top);
  assert.ok(Number.parseFloat(menu().style.left) + Number.parseFloat(menu().style.width) <= dom.window.innerWidth - 8);
  rect = { ...rect, left: 20, top: 50, bottom: 80, right: 90 };
  dom.window.dispatchEvent(new dom.window.Event("scroll"));
  assert.equal(menu().dataset.placement, "bottom");
  assert.equal(menu().style.top, "84px");
  Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 160 });
  dom.window.dispatchEvent(new dom.window.Event("resize"));
  assert.equal(menu().style.width, "144px");
  assert.equal(menu().style.left, "8px");
});

test("页面隐藏或移除时自动收起，更新选项和当前值不会遗留旧标签", async () => {
  const doc = dom.window.document;
  const panel = doc.createElement("section");
  doc.body.append(panel);
  const control = mount({}, panel);
  control.element.click();
  control.update({ value: "0", options: [{ value: "0", label: "不限" }, { value: "1", label: "完结" }] });
  assert.equal(control.element.textContent, "不限");
  assert.equal(menu().querySelector('[aria-selected="true"]').textContent, "不限");
  panel.setAttribute("aria-hidden", "true");
  await flush();
  assert.equal(menu(), null);
  panel.removeAttribute("aria-hidden");
  control.element.click();
  assert.ok(menu());
  panel.style.overflowY = "auto";
  panel.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 300, height: 400, width: 300 });
  control.element.getBoundingClientRect = () => ({ top: 550, bottom: 580, left: 10, right: 100, height: 30, width: 90 });
  panel.dispatchEvent(new dom.window.Event("scroll"));
  assert.equal(menu(), null, "触发器滚出侧栏可见范围后不能留下悬空菜单");
  panel.style.overflowY = "visible";
  control.element.click();
  assert.ok(menu());
  panel.remove();
  await flush();
  assert.equal(menu(), null);
});
