// 插件入口：导出 React 面板组件与兼容的 mount 挂载函数。
import { createEngine } from "./engine/create-engine.js";

// 引擎缓存：同一个 api 对象复用同一份引擎实例。
// 宿主在 StrictMode 下会对挂载 effect 执行 setup -> cleanup -> setup（同一实例被 stop 后立刻 start），
// 因此 stop() 拆掉的窗口与监听必须由 start() 重建，而不是指望卸载重挂时换一份新引擎。
export const ENGINE_CACHE = new WeakMap();
export function resolveEngine(api) {
  if (!api || typeof api !== "object") return null;
  let engine = ENGINE_CACHE.get(api);
  if (!engine) {
    engine = createEngine(api);
    ENGINE_CACHE.set(api, engine);
  }
  return engine;
}

// 兼容挂载模式：宿主没有默认导出时仍可用 mount(container, api)。
export function mount(container, api) {
  const engine = resolveEngine(api);
  if (!engine) return null;
  engine.start();
  return function () {
    engine.stop();
    try {
      container.replaceChildren();
    } catch (err) {
      /* ignore */
    }
  };
}

/** 面板组件：宿主注入 props，内部转发到引擎里的 PanelView。 */
export default function SnowNovelReaderPanel(props) {
  const api = props ? props.api : null;
  const engine = resolveEngine(api);
  const R = api && api.ui && api.ui.React ? api.ui.React : null;
  if (!engine || !R) return null;
  R.useEffect(function () {
    engine.start();
    return function () {
      engine.stop();
    };
  }, []);
  return R.createElement(engine.PanelView, props);
}
