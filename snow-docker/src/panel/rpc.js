// 面板到本机后台的 RPC 通道。
// 约定：
// - 后台把「实际监听端口 + 随机令牌」写入插件私有存储，面板只按这条记录连接，不扫描端口；
// - 所有请求都带 x-snow-docker-channel 头与后台写入的令牌，经 api.net.fetch（主进程网络栈）发出；
// - 面板的插件存储是打开面板时的快照：后台重启后要重新打开面板才能读到新记录；
// - 错误统一归一成 PanelError：code 供界面分支，message 直接展示；
// - POST 不自动重放，避免重复启动任务。
import {
  CHANNEL_ENDPOINT_STORAGE_KEY,
  CHANNEL_HEADER,
  CHANNEL_HEADER_VALUE,
  CHANNEL_TOKEN_HEADER,
  PORT_FIRST,
  PORT_LAST,
  ROUTES,
} from "../shared/contract.js";

export class PanelError extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = "PanelError";
    this.code = String(code || "UNKNOWN");
    this.status = Number.isFinite(options.status) ? options.status : 0;
  }
}

const isConnectionError = (text) =>
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|EPIPE|connection refused|connection reset|failed to fetch|net::ERR|socket hang up|fetch failed/i.test(
    text
  );

const isTimeoutError = (text) => /timeout|timed out|ETIMEDOUT|超时/i.test(text);

const buildQuery = (query) => {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
};

const CHANNEL_TOKEN_PATTERN = /^[A-Za-z0-9]{32,128}$/;

/**
 * 创建面板侧 RPC 客户端。
 * @param {object} api 宿主注入的面板 API
 * @param {{ log?: (...args: unknown[]) => void }} [options]
 */
export function createRpc(api, { log = () => {} } = {}) {
  /** 后台发布的连接记录 { port, token }；读不到时保持 null。 */
  let endpoint = null;
  let endpointLoaded = false;
  let endpointLoading = null;

  const readEndpoint = async () => {
    if (!api?.storage) return null;
    try {
      // 旧宿主没有 getJson 时退回 get + JSON.parse，避免整个面板因缺少一个便捷方法而起不来。
      const saved =
        typeof api.storage.getJson === "function"
          ? await api.storage.getJson(CHANNEL_ENDPOINT_STORAGE_KEY, null)
          : typeof api.storage.get === "function"
            ? JSON.parse((await api.storage.get(CHANNEL_ENDPOINT_STORAGE_KEY)) || "null")
            : null;
      const port = Number(saved?.port);
      const token = typeof saved?.token === "string" ? saved.token : "";
      if (!Number.isInteger(port) || port < PORT_FIRST || port > PORT_LAST) return null;
      // 令牌格式不对说明记录被改写或来自旧版本：按「未发布」处理，绝不把畸形值当凭据发出去。
      if (!CHANNEL_TOKEN_PATTERN.test(token)) return null;
      return { port, token };
    } catch (error) {
      log(`[rpc] 读取通道记录失败：${error?.message || error}`);
      return null;
    }
  };

  const ensureEndpoint = async () => {
    if (endpointLoaded) return endpoint;
    endpointLoading ??= (async () => {
      try {
        endpoint = await readEndpoint();
        // 读不到时不留缓存：下一次请求可以重读，避免一次竞态之后整块面板都停在「未发布」。
        endpointLoaded = Boolean(endpoint);
        return endpoint;
      } finally {
        endpointLoading = null;
      }
    })();
    return endpointLoading;
  };

  const rawRequest = async (target, pathname, { method = "GET", body, query, timeoutMs = 20000 } = {}) => {
    if (!api?.net || typeof api.net.fetch !== "function") {
      throw new PanelError("NET_UNAVAILABLE", "api.net.fetch 不可用（请在 plugin.json 声明 network 隐私域）");
    }
    const url = `http://127.0.0.1:${target.port}${pathname}${buildQuery(query)}`;
    let response;
    try {
      response = await api.net.fetch(url, {
        method,
        headers: {
          [CHANNEL_HEADER]: CHANNEL_HEADER_VALUE,
          ...(target.token ? { [CHANNEL_TOKEN_HEADER]: target.token } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        responseType: "text",
        timeoutMs,
      });
    } catch (error) {
      const text = String(error?.message || error);
      throw new PanelError(isConnectionError(text) ? "BACKGROUND_UNAVAILABLE" : "TRANSPORT", text);
    }

    if (!response || response.error) {
      const failure = String(response?.error || "网络请求失败");
      if (isConnectionError(failure)) throw new PanelError("BACKGROUND_UNAVAILABLE", failure);
      if (isTimeoutError(failure)) throw new PanelError("TIMEOUT", failure);
      throw new PanelError("TRANSPORT", failure);
    }

    const text = typeof response.body === "string" ? response.body : "";
    let payload = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new PanelError("PROTOCOL", `后台响应不是 JSON：${error?.message ?? error}`);
      }
    }

    if (response.ok !== true || (payload && payload.error)) {
      const detail = payload?.error || null;
      const code = typeof detail?.code === "string" && detail.code ? detail.code : `HTTP_${response.status ?? 0}`;
      const message = (typeof detail?.message === "string" && detail.message) || response.statusText || `HTTP ${response.status ?? 0}`;
      // 后台进程还没加载到最新代码时会返回「未知接口」：换成能指导操作的提示。
      if (/未知接口/.test(message)) {
        throw new PanelError("BACKGROUND_OUTDATED", "后台还在运行旧版本（缺少新接口），请重启一次 App 后重试", {
          status: response.status,
        });
      }
      throw new PanelError(code, message, { status: response.status });
    }

    return payload;
  };

  /**
   * 端口来自后台发布的连接记录：不扫描端口，也就不存在「重扫」。
   * 连接失败时只重试同一端口；记录读不到时提示重新打开面板，因为面板存储是打开时的快照。
   */
  const request = async (pathname, options = {}) => {
    const retryable = (options.method || "GET").toUpperCase() === "GET";
    const send = async () => {
      const target = await ensureEndpoint();
      if (!target) {
        throw new PanelError("BACKGROUND_PENDING", "后台尚未发布连接记录：请关闭并重新打开插件面板");
      }
      return rawRequest(target, pathname, options);
    };
    try {
      return await send();
    } catch (error) {
      if (error?.code !== "BACKGROUND_UNAVAILABLE") throw error;
      if (!retryable) {
        throw new PanelError(
          "BACKGROUND_UNAVAILABLE",
          `${String(error?.message || error)}（请求可能已被后台受理，请先确认任务列表再重试）`
        );
      }
      try {
        return await send();
      } catch (again) {
        if (again?.code !== "BACKGROUND_UNAVAILABLE") throw again;
        throw new PanelError(
          "BACKGROUND_UNAVAILABLE",
          `${String(again?.message || again)}（后台可能已重启：请关闭并重新打开插件面板）`
        );
      }
    }
  };

  return {
    resetPort() {
      endpoint = null;
      endpointLoaded = false;
      endpointLoading = null;
    },
    health: () => request(ROUTES.health, { timeoutMs: 4000 }),
    system: () => request(ROUTES.system, { timeoutMs: 60000 }),
    containers: ({ all = true } = {}) =>
      request(ROUTES.containers, { query: { all: all ? "1" : "0" }, timeoutMs: 20000 }),
    images: () => request(ROUTES.images, { timeoutMs: 20000 }),
    inspect: (id) => request(ROUTES.containerInspect, { query: { id }, timeoutMs: 20000 }),
    logsStream: (id, { tail, streamId, offset, reset } = {}) =>
      request(ROUTES.containerLogs, {
        query: { id, tail, streamId, offset, reset: reset ? "1" : "" },
        timeoutMs: 30000,
      }),
    stats: (id) => request(ROUTES.containerStats, { query: { id }, timeoutMs: 30000 }),
    containerAction: (id, action, force = false) =>
      request(ROUTES.containerAction, { method: "POST", body: { id, action, force }, timeoutMs: 70000 }),
    // 拉取在后台转成任务（/image/pull 立即返回 taskId），这里只要一次短请求；
    // 宿主对 api.net.fetch 的超时上限是 120 秒，长拉取不能再同步等待。
    pull: (reference) => request(ROUTES.imagePull, { method: "POST", body: { reference }, timeoutMs: 20000 }),
    removeImage: (reference, force = false) =>
      request(ROUTES.imageRemove, { method: "POST", body: { reference, force }, timeoutMs: 70000 }),
    settings: () => request(ROUTES.settings, { timeoutMs: 10000 }),
    saveSettings: (patch) => request(ROUTES.settings, { method: "POST", body: patch, timeoutMs: 15000 }),
    detect: () => request(ROUTES.detect, { timeoutMs: 30000 }),
    scanProject: (root) => request(ROUTES.projectScan, { method: "POST", body: { root }, timeoutMs: 40000 }),
    packageScripts: (path, dir) =>
      request(ROUTES.projectPackageScripts, { query: { path, dir }, timeoutMs: 15000 }),
    build: (payload) => request(ROUTES.projectBuild, { method: "POST", body: payload, timeoutMs: 120000 }),
    buildAndRun: (payload) =>
      request(ROUTES.projectBuildRun, { method: "POST", body: payload, timeoutMs: 120000 }),
    runImage: (image, config) => request(ROUTES.projectRun, { method: "POST", body: { image, config }, timeoutMs: 120000 }),
    saveProjectConfig: (dockerfile, config, register = false, root = "") =>
      request(ROUTES.projectConfig, {
        method: "POST",
        body: { dockerfile, config, register: register === true, root },
        timeoutMs: 15000,
      }),
    removeProjectConfig: (dockerfile) =>
      request(ROUTES.projectConfig, { method: "POST", body: { dockerfile, remove: true }, timeoutMs: 15000 }),
    composeServices: (file) => request(ROUTES.composeServices, { query: { file }, timeoutMs: 30000 }),
    composeAction: (file, action) =>
      request(ROUTES.composeAction, { method: "POST", body: { file, action }, timeoutMs: 20000 }),
    task: (id, offset) => request(ROUTES.task, { query: { id, offset }, timeoutMs: 20000 }),
    cancelTask: (id) => request(ROUTES.taskCancel, { method: "POST", body: { id }, timeoutMs: 10000 }),
    sshStatus: () => request(ROUTES.sshStatus, { timeoutMs: 15000 }),
    sshSave: (payload) => request(ROUTES.sshSave, { method: "POST", body: payload, timeoutMs: 15000 }),
    sshRemove: (id) => request(ROUTES.sshRemove, { method: "POST", body: { id }, timeoutMs: 15000 }),
    sshConnect: (id) => request(ROUTES.sshConnect, { method: "POST", body: { id }, timeoutMs: 90000 }),
    sshDisconnect: () => request(ROUTES.sshDisconnect, { method: "POST", body: {}, timeoutMs: 20000 }),
    sshTest: (payload) => request(ROUTES.sshTest, { method: "POST", body: payload || {}, timeoutMs: 60000 }),
    // 上传在后台可能先自动建连并探活 docker（与 sshConnect 同量级耗时）：超时给到一致，
    // 否则面板先报超时，后台却已切好目标并启动了上传任务。
    sshUpload: (image, serverId) =>
      request(ROUTES.sshUpload, { method: "POST", body: { image, serverId }, timeoutMs: 90000 }),
  };
}
