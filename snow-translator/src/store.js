// 极简 store：命令式状态（翻译流程、设置、面板开关）与 Preact 之间的单向桥。
export function createStore(initial) {
  let state = initial;
  const listeners = new Set();

  function get() {
    return state;
  }

  function set(patch) {
    const next = typeof patch === "function" ? patch(state) : patch;
    if (!next || next === state) return state;
    state = typeof patch === "function" ? next : { ...state, ...next };
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        console.warn("[翻译助手] 状态订阅回调出错", error);
      }
    }
    return state;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return { get, set, subscribe };
}
