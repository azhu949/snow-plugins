export function createStore(initial) {
  let current = initial;
  const listeners = new Set();
  return {
    get() {
      return current;
    },
    set(patch) {
      current = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
      for (const listener of listeners) {
        try {
          listener(current);
        } catch {
          // 单个订阅者异常不影响其他订阅者。
        }
      }
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}