// USD → CNY 汇率：抓取公开汇率接口、TTL 缓存、失败保留旧值。
// 接口约定：GET 返回 { rates: { CNY: number } }（Frankfurter / open.er-api 都是这个结构）。
// 只发 GET，不携带任何本地数据。
import { FX_RATE, FX_RETRY_MS, FX_TTL_MS, FX_URL, STORAGE_KEYS } from "./constants.js";

const INFLIGHT = new WeakMap();

export class FxError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FxError";
    this.code = code;
    this.details = details;
  }
}

function readNow(now) {
  const value = typeof now === "function" ? now() : now;
  if (value instanceof Date) return value.getTime();
  const number = Number(value);
  return Number.isFinite(number) ? number : Date.now();
}

// 状态里展示的失败原因带上底层错误（网络 / 超时），否则只剩一句泛化提示。
function describeError(error, fallback) {
  const message = error?.message || fallback;
  const cause = error?.details?.cause;
  const causeMessage =
    typeof cause === "string" ? cause : cause && typeof cause === "object" ? cause.message : "";
  if (causeMessage && !message.includes(causeMessage)) return `${message}（${causeMessage}）`;
  return message;
}

// 汇率必须在设置允许的范围内，异常数值宁可报错也不用。
export function parseFxRate(payload) {
  const rates = payload && typeof payload === "object" ? payload.rates : null;
  const raw = rates && typeof rates === "object" ? rates.CNY : null;
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < FX_RATE.min || rate > FX_RATE.max) {
    throw new FxError("fx-parse-failed", "汇率响应缺少有效的 CNY 汇率");
  }
  return rate;
}

export async function fetchFxRate(fetchFn, url = FX_URL) {
  if (typeof fetchFn !== "function") {
    throw new FxError("fetch-unavailable", "当前宿主没有可用的 fetch");
  }
  let response;
  try {
    response = await fetchFn(url, { method: "GET", headers: { Accept: "application/json" } });
  } catch (error) {
    throw new FxError("fx-request-failed", "请求汇率接口失败", { cause: error });
  }
  if (response && response.ok === false) {
    throw new FxError("fx-http-error", `汇率请求失败（HTTP ${response.status ?? "?"}）`, {
      status: response.status,
    });
  }
  let payload;
  try {
    payload = typeof response?.json === "function" ? await response.json() : response?.body ?? response;
  } catch (error) {
    throw new FxError("fx-parse-failed", "汇率响应不是合法 JSON", { cause: error });
  }
  return {
    rate: parseFxRate(payload),
    date: String(payload?.date ?? ""),
  };
}

export async function loadFx(storage) {
  return coerceFxRecord(await readFxRecord(storage));
}

// 原始记录不校验汇率：失败冷却要能从记录里读到 failedAt，即使 rate 已失效。
async function readFxRecord(storage) {
  if (!storage || typeof storage.getJson !== "function") return null;
  let record;
  try {
    record = await storage.getJson(STORAGE_KEYS.fx);
  } catch {
    return null;
  }
  return record && typeof record === "object" ? record : null;
}

function coerceFxRecord(record) {
  if (!record || typeof record !== "object") return null;
  const rate = Number(record.rate);
  if (!Number.isFinite(rate) || rate < FX_RATE.min || rate > FX_RATE.max) return null;
  return {
    rate,
    fetchedAt: Number(record.fetchedAt) || 0,
    url: String(record.url ?? ""),
    source: String(record.source ?? "cache"),
    date: String(record.date ?? ""),
  };
}

export async function saveFx(storage, fx, meta = {}) {
  const record = {
    rate: Number(fx?.rate) || 0,
    fetchedAt: readNow(meta.fetchedAt),
    url: String(meta.url ?? ""),
    source: meta.source || "network",
    date: String(fx?.date ?? ""),
    // 成功即清掉失败状态：冷却只看失败时间，不能残留上一轮的失败原因。
    failedAt: 0,
    failedError: "",
  };
  if (storage && typeof storage.setJson === "function") {
    await storage.setJson(STORAGE_KEYS.fx, record);
  }
  return record;
}

// 失败只补两个字段，不经过 saveFx：fetchedAt 与 rate 必须保留上次成功的内容，
// 否则「汇率同步于」会被改写成失败时刻，有效汇率也会被清零。
async function rememberFxFailure(storage, record, meta) {
  if (!storage || typeof storage.setJson !== "function") return;
  const base = record && typeof record === "object" ? record : {};
  try {
    await storage.setJson(STORAGE_KEYS.fx, {
      ...base,
      failedAt: meta.failedAt,
      failedError: meta.failedError,
    });
  } catch {
    // 失败状态写不进去时最多多试一次，不影响本次返回值。
  }
}

// 带 TTL 的汇率保障：并发去重；失败时保留旧汇率并标记 stale / error。
export async function ensureFx(options = {}) {
  const {
    force = false,
    now,
    fetchFn,
    storage,
    url = FX_URL,
    ttlMs = FX_TTL_MS,
    retryMs = FX_RETRY_MS,
  } = options;
  const stamp = readNow(now);
  const rawRecord = await readFxRecord(storage);
  const cached = coerceFxRecord(rawRecord);
  const age = cached ? stamp - cached.fetchedAt : Number.POSITIVE_INFINITY;
  // 失败记录只补 failedAt / failedError、不改 fetchedAt：命中缓存时也要把最近一次失败带出去，
  // 否则下一轮自动刷新会把「本次刷新失败」显示成「已同步」。
  const failedAt = Number(rawRecord?.failedAt) || 0;
  const failedError = String(rawRecord?.failedError || "") || null;
  const lastAttemptFailed =
    failedAt > 0 && failedAt > (Number(rawRecord?.fetchedAt) || 0);
  if (cached && !force && age >= 0 && age < ttlMs) {
    return lastAttemptFailed
      ? { ...cached, stale: true, error: failedError }
      : { ...cached, stale: false, error: null };
  }

  // 失败冷却：上次同步失败后，重试窗口内直接复用当前汇率，避免每个自动刷新周期都重打接口。
  // force 表示用户主动刷新，必须绕过冷却。
  const failedAge = stamp - failedAt;
  if (!force && failedAt > 0 && failedAge >= 0 && failedAge < retryMs) {
    const message = String(rawRecord.failedError || "") || null;
    if (cached) return { ...cached, stale: true, error: message };
    return {
      rate: 0,
      fetchedAt: 0,
      url,
      source: "none",
      date: "",
      stale: true,
      error: message,
    };
  }

  const key = `${url}|${force ? "force" : "auto"}`;
  const existing = storage && typeof storage === "object" ? INFLIGHT.get(storage) : null;
  if (existing && existing.key === key) return existing.promise;

  const promise = (async () => {
    try {
      const fresh = await fetchFxRate(fetchFn, url);
      const record = await saveFx(storage, fresh, { fetchedAt: stamp, source: "network", url });
      return { ...record, stale: false, error: null };
    } catch (error) {
      const message = describeError(error, "汇率获取失败");
      await rememberFxFailure(storage, rawRecord, { failedAt: stamp, failedError: message });
      if (cached) return { ...cached, stale: true, error: message };
      return {
        rate: 0,
        fetchedAt: 0,
        url,
        source: "none",
        date: "",
        stale: true,
        error: message,
      };
    }
  })();

  if (storage && typeof storage === "object") {
    INFLIGHT.set(storage, { key, promise });
    promise
      .finally(() => {
        const current = INFLIGHT.get(storage);
        if (current && current.promise === promise) INFLIGHT.delete(storage);
      })
      .catch(() => {
        // 失败已在返回值里体现，这里只避免 finally 链产生未处理的拒绝。
      });
  }
  return promise;
}
