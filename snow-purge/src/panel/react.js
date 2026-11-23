// 宿主注入的 React 实例登记处。
// 面板入口在渲染前调用 bindReact，其余组件模块统一从 getReact() 取同一份实例，
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

/**
 * JSX 片段（<>...</>）会被编译成 h(Fragment, ...)。
 * 这里必须是真正的组件：React 只接受字符串标签或函数 / 类组件，
 * 传 Symbol 会抛 "Element type is invalid"（React error #130，整个面板崩掉）。
 */
export const Fragment = (props) => {
  const React = getReact();
  return React.createElement(React.Fragment, null, props?.children ?? null);
};

/** 首次渲染前兜底绑定：宿主在挂载前已注入 window.SnowAppPlugin。 */
export function ensureReact(api) {
  if (bound) return bound.React;
  const fromGlobal = typeof window !== "undefined" ? window.SnowAppPlugin?.React : null;
  if (bindReact(fromGlobal)) return bound.React;
  if (bindReact(api?.ui?.React)) return bound.React;
  throw new Error("宿主没有提供 React 实例");
}
