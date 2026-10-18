// 客户端脚本 API 适配：把宿主注入的 snow / GM_* 映射为引擎使用的接口。
// 完全权限档下 window.snow 是应用 IPC（文件树、Git diff），脚本作用域的 snow 是脚本 API。

export function hasScriptHost() {
  return (
    typeof snow !== "undefined" &&
    Boolean(snow.metadata) &&
    Boolean(snow.write) &&
    typeof GM_getValue === "function" &&
    typeof GM_setValue === "function" &&
    typeof GM_addStyle === "function"
  );
}

export class StorageError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.storageKey = options.key || "";
    this.raw = options.raw;
    this.cause = options.cause;
    this.backupError = options.backupError || null;
  }
}

function backupCorruptValue(key, raw) {
  try {
    GM_setValue(`${key}:corrupt`, JSON.stringify({ storedAt: Date.now(), raw }));
    return null;
  } catch (error) {
    // 只能捕获 GM_setValue 的同步异常；宿主内部 IPC / SQLite 失败无法从脚本侧观测。
    return error;
  }
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
      subscribe(domain, listener, options) {
        return snow.metadata.subscribe(domain, listener, options);
      },
    },
    write: {
      run(actionId, params) {
        return snow.write.run(actionId, params);
      },
    },
    storage: {
      async getJson(key) {
        let raw;
        try {
          raw = GM_getValue(key, "");
        } catch (error) {
          throw new StorageError("read", "读取本地数据失败", { key, cause: error });
        }
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch (error) {
          const backupError = backupCorruptValue(key, raw);
          throw new StorageError("parse", "本地数据格式损坏", { key, raw, cause: error, backupError });
        }
      },
      // 宿主的 GM_setValue 是同步函数：返回 undefined，内部异步 IPC 的错误被宿主吞掉
      // （snow-app preload 的 clientScriptHost.ts 中 GM_setValue 实现）。因此这里只能确认
      // “已提交给宿主”，不能确认真正落盘；GM_getValue 回读的也只是注入时的内存副本，
      // 不能作为持久化成功的证据。写入失败提示只能覆盖同步异常与副本不一致。
      setJson(key, value) {
        let raw;
        try {
          raw = JSON.stringify(value);
        } catch (error) {
          throw new StorageError("serialize", "序列化本地数据失败", { key, cause: error });
        }
        try {
          GM_setValue(key, raw);
        } catch (error) {
          throw new StorageError("write", "提交本地数据写入失败", { key, cause: error });
        }
        // 只校验宿主内存副本是否接受了该值；未命中说明宿主实现异常或写入被丢弃。
        let mirror;
        try {
          mirror = GM_getValue(key, null);
        } catch (error) {
          throw new StorageError("write", "写入后无法读取本地数据副本", { key, cause: error });
        }
        if (mirror !== raw) {
          throw new StorageError("write", "本地数据写入后副本不一致", { key });
        }
      },
    },
  };
}
