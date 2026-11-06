// 宿主注入的 React 实例登记处。
// 面板入口在渲染前调用 bindReact(api.ui.React)，其余组件模块统一从 getReact() 取同一份实例，
// 避免插件自带第二份 react / react-dom。
let bound = null;

export function bindReact(React) {
  if (!React || typeof React.createElement !== "function") return false;
  bound = { React, createElement: React.createElement };
  return true;
}

export function getReact() {
  if (!bound) throw new Error("宿主 React 尚未注入");
  return bound.React;
}

/** 与 React.createElement 等价；额外把子元素数组拍平一层，列表渲染少写一次展开。 */
export function h(type, props, ...children) {
  if (!bound) throw new Error("宿主 React 尚未注入");
  const flat = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      for (const item of child) flat.push(item);
    } else {
      flat.push(child);
    }
  }
  return bound.createElement(type, props, ...flat);
}
