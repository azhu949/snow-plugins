// 客户端脚本宿主适配：能力探测、GM_* JSON 存储与 snow.metadata 读取。
// 默认沙箱档可直接使用 GM_* 与 snow.metadata，不需要 window.snow。

export function hasScriptHost() {
  return (
    typeof snow !== "undefined" &&
    Boolean(snow.metadata) &&
    typeof snow.metadata.get === "function" &&
    typeof GM_getValue === "function" &&
    typeof GM_setValue === "function"
  );
}

// 存储损坏时把原始值备份到 <key>:corrupt，并回退到默认值，避免脚本启动失败。
export function createScriptStorage() {
  const backup = (key, raw) => {
    try {
      GM_setValue(`${key}:corrupt`, JSON.stringify({ storedAt: Date.now(), raw }));
    } catch {
      // 备份失败不影响主流程。
    }
  };
  return {
    getJson(key) {
      let raw;
      try {
        raw = GM_getValue(key, "");
      } catch {
        return null;
      }
      if (raw === null || raw === undefined || raw === "") return null;
      if (typeof raw === "object") return raw;
      try {
        return JSON.parse(String(raw));
      } catch {
        backup(key, raw);
        return null;
      }
    },
    setJson(key, value) {
      try {
        GM_setValue(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    removeJson(key) {
      try {
        if (typeof GM_deleteValue === "function") GM_deleteValue(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function createScriptApi() {
  const readContext = () => (typeof snow !== "undefined" && snow.context) || {};
  return {
    get locale() {
      return readContext().locale || "zh-CN";
    },
    metadata: {
      get(domain, options) {
        return snow.metadata.get(domain, options);
      },
    },
  };
}
