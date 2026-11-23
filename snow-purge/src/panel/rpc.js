// 面板到本机后台的 RPC 通道。
// - 后台把「实际监听端口 + 随机令牌」写入插件私有存储，面板只按这条记录连接；
// - 所有请求都带通道头与令牌，经 api.net.fetch（主进程网络栈）发出；
// - 面板的插件存储是打开面板时的快照：后台重启后要重新打开面板才能读到新记录；
// - 错误统一归一成 PanelError：code 供界面分支，message 直接展示；
// - POST 不自动重放，避免重复写入。
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

export function createRpc(api, { log = () => {} } = {}) {
  let endpoint = null;
  let endpointLoaded = false;
  let endpointLoading = null;

  const readEndpoint = async () => {
    if (!api?.storage) return null;
    try {
      const saved =
        typeof api.storage.getJson === "function"
          ? await api.storage.getJson(CHANNEL_ENDPOINT_STORAGE_KEY, null)
          : typeof api.storage.get === "function"
            ? JSON.parse((await api.storage.get(CHANNEL_ENDPOINT_STORAGE_KEY)) || "null")
            : null;
      const port = Number(saved?.port);
      const token = typeof saved?.token === "string" ? saved.token : "";
      if (!Number.isInteger(port) || port < PORT_FIRST || port > PORT_LAST) return null;
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
      const message =
        (typeof detail?.message === "string" && detail.message) || response.statusText || `HTTP ${response.status ?? 0}`;
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
   * 连接失败时只重试同一端口；记录读不到时提示重新打开面板。
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
          `${String(error?.message || error)}（请求可能已被后台受理，请先确认结果再重试）`
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
    overview: () => request(ROUTES.overview, { timeoutMs: 45000 }),
    selfcheck: () => request(ROUTES.selfcheck, { timeoutMs: 45000 }),
    apply: (forceProxy = false) =>
      request(ROUTES.apply, { method: "POST", body: { forceProxy }, timeoutMs: 90000 }),
    revert: () => request(ROUTES.revert, { method: "POST", body: {}, timeoutMs: 90000 }),
    prompts: () => request(ROUTES.prompts, { timeoutMs: 30000 }),
    applyPrompt: (payload) => request(ROUTES.promptApply, { method: "POST", body: payload, timeoutMs: 60000 }),
    removePrompt: () => request(ROUTES.promptRemove, { method: "POST", body: {}, timeoutMs: 30000 }),
    role: () => request(ROUTES.role, { timeoutMs: 20000 }),
    applyRole: (content) => request(ROUTES.roleApply, { method: "POST", body: { content }, timeoutMs: 60000 }),
    restoreRole: () => request(ROUTES.roleRestore, { method: "POST", body: {}, timeoutMs: 30000 }),
    approval: (projectId) => request(ROUTES.approval, { query: { projectId }, timeoutMs: 30000 }),
    setGlobalTools: (tools, baselineHash) =>
      request(ROUTES.approvalGlobal, { method: "POST", body: { tools, baselineHash }, timeoutMs: 30000 }),
    setProjectTools: (projectId, toolNames, approved) =>
      request(ROUTES.approvalProject, {
        method: "POST",
        body: { projectId, toolNames, approved },
        timeoutMs: 30000,
      }),
    proxy: () => request(ROUTES.proxy, { timeoutMs: 30000 }),
    applyProxy: (payload) => request(ROUTES.proxyApply, { method: "POST", body: payload, timeoutMs: 60000 }),
    restoreProxy: (force = false) => request(ROUTES.proxyRestore, { method: "POST", body: { force }, timeoutMs: 30000 }),
    probe: () => request(ROUTES.proxyProbe, { timeoutMs: 20000 }),
    presets: () => request(ROUTES.presets, { timeoutMs: 20000 }),
    savePreset: (preset) => request(ROUTES.presetSave, { method: "POST", body: { preset }, timeoutMs: 20000 }),
    removePreset: (id) => request(ROUTES.presetRemove, { method: "POST", body: { id }, timeoutMs: 20000 }),
    backups: () => request(ROUTES.backups, { timeoutMs: 30000 }),
    restoreBackup: (id, force = false) => request(ROUTES.backupRestore, { method: "POST", body: { id, force }, timeoutMs: 60000 }),
    removeBackup: (id) => request(ROUTES.backupRemove, { method: "POST", body: { id }, timeoutMs: 20000 }),
    audit: (limit = 50) => request(ROUTES.audit, { query: { limit }, timeoutMs: 20000 }),
    clearAudit: () => request(ROUTES.auditClear, { method: "POST", body: {}, timeoutMs: 30000 }),
    logs: (params = {}) => request(ROUTES.logs, { query: params, timeoutMs: 30000 }),
    clearLogs: () => request(ROUTES.logsClear, { method: "POST", body: {}, timeoutMs: 60000 }),
    redteam: (params) => request(ROUTES.redteam, { query: params, timeoutMs: 30000 }),
    installRedteam: (payload) =>
      request(ROUTES.redteamInstall, { method: "POST", body: payload, timeoutMs: 90000 }),
    toggleRedteam: (name, enabled) =>
      request(ROUTES.redteamToggle, { method: "POST", body: { name, enabled }, timeoutMs: 30000 }),
    removeRedteam: (name) =>
      request(ROUTES.redteamRemove, { method: "POST", body: { name }, timeoutMs: 30000 }),
    redteamSkill: (name) => request(ROUTES.redteamSkill, { query: { name }, timeoutMs: 20000 }),
    roster: () => request(ROUTES.roster, { timeoutMs: 30000 }),
    installRoster: (payload) => request(ROUTES.rosterInstall, { method: "POST", body: payload, timeoutMs: 60000 }),
    removeRoster: (agentId, confirm = false) =>
      request(ROUTES.rosterRemove, { method: "POST", body: { agentId, confirm }, timeoutMs: 30000 }),
    rosterRole: (agentId) => request(ROUTES.rosterRole, { query: { agentId }, timeoutMs: 20000 }),
    dispatchRosterTask: (payload) =>
      request(ROUTES.rosterDispatch, { method: "POST", body: payload, timeoutMs: 60000 }),
    activateRosterTask: (id) => request(ROUTES.rosterTaskActivate, { method: "POST", body: { id }, timeoutMs: 30000 }),
    removeRosterTask: (id) => request(ROUTES.rosterTaskRemove, { method: "POST", body: { id }, timeoutMs: 30000 }),
    startRosterChain: (payload) =>
      request(ROUTES.rosterChainStart, { method: "POST", body: payload, timeoutMs: 60000 }),
    pauseRosterChain: (id) => request(ROUTES.rosterChainPause, { method: "POST", body: { id }, timeoutMs: 30000 }),
    resumeRosterChain: (id) => request(ROUTES.rosterChainResume, { method: "POST", body: { id }, timeoutMs: 30000 }),
    skipRosterChain: (id) => request(ROUTES.rosterChainSkip, { method: "POST", body: { id }, timeoutMs: 60000 }),
    stopRosterChain: (id) => request(ROUTES.rosterChainStop, { method: "POST", body: { id }, timeoutMs: 30000 }),
    removeRosterChain: (id) => request(ROUTES.rosterChainRemove, { method: "POST", body: { id }, timeoutMs: 30000 }),
    settings: () => request(ROUTES.settings, { timeoutMs: 15000 }),
    saveSettings: (patch) => request(ROUTES.settings, { method: "POST", body: patch, timeoutMs: 30000 }),
    repairSettings: () =>
      request(ROUTES.settingsRepair, { method: "POST", body: { confirm: true }, timeoutMs: 30000 }),
  };
}
