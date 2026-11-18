// 引擎调度：按设置顺序尝试（主引擎 → 免费兜底），统一分段、计时与结果缓存。
import { CACHE_LIMIT, CHUNK_LIMIT, FREE_ENGINES } from "../constants.js";
import { resolveAutoTarget } from "../languages.js";
import { splitText } from "./chunk.js";
import { translateBaidu } from "./baidu.js";
import { translateBing } from "./bing.js";
import { translateDeepL } from "./deepl.js";
import { translateError } from "./errors.js";
import { translateGoogle } from "./google.js";
import { translateOpenAI } from "./openai.js";

// chunkLimit 按引擎单次可接受的文本量设置：免费接口对超长文本不友好，大模型按 token 预算收紧。
const RUNNERS = {
  // 谷歌走 GET，文本在查询串里：3200 个中文 percent-encode 后 URL 近 30KB，会被代理或网关判 414。
  // 收到 1500 后中文约 13.5KB，可过 16KB 级网关；更严格的 8KB 级网关仍可能拒绝，此时按 414 给出可读原因。
  google: { run: translateGoogle, chunkLimit: 1500 },
  bing: { run: translateBing, chunkLimit: 2400 },
  // 百度单次 q 上限 6000 字节，中文按 3 字节算，1500 字符留足余量。
  baidu: { run: translateBaidu, chunkLimit: 1500 },
  deepl: { run: translateDeepL, chunkLimit: CHUNK_LIMIT },
  openai: { run: translateOpenAI, chunkLimit: 2400 },
};

function configFor(engine, settings) {
  if (engine === "baidu") return settings.baidu;
  if (engine === "deepl") return settings.deepl;
  if (engine === "openai") return settings.openai;
  return {};
}

export function createTranslator({ getSettings, getLocale, fetchImpl, now = () => Date.now() }) {
  const cache = new Map();

  // 目标语言选「自动检测」时按文本语种择向：中文译英文，其余译成界面语言。
  function resolveTarget(text, source, requested) {
    if (requested && requested !== "auto") return requested;
    const locale = typeof getLocale === "function" ? getLocale() : "zh-CN";
    return resolveAutoTarget(text, source, locale);
  }

  function remember(key, value) {
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, value);
  }

  async function runEngine(engine, { text, from, to }) {
    const entry = RUNNERS[engine];
    if (!entry) throw translateError("UNKNOWN", { engine, message: `未知引擎 ${engine}` });
    const settings = getSettings();
    const config = configFor(engine, settings);
    const startedAt = now();
    // 长文本按段落切分后串行请求：免费接口对单次长度敏感，串行也便于保持段落顺序。
    const chunks = splitText(text, entry.chunkLimit || CHUNK_LIMIT);
    const parts = [];
    let detected = "";
    for (const chunk of chunks) {
      const result = await entry.run({ text: chunk, from, to, fetchImpl, config });
      parts.push(result.text);
      if (!detected && result.detected) detected = result.detected;
    }
    return {
      // 分片边界原样拼接（splitText 的切分是无损的），只在这里对整体结果收一次首尾空白，
      // 这样段落之间的空行与换行不会被逐片 trim 掉。
      text: parts.join("").trim(),
      detected,
      engine,
      elapsedMs: Math.max(0, now() - startedAt),
    };
  }

  async function translate({ text, from, to }) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) throw translateError("EMPTY", {});

    const settings = getSettings();
    const source = from || settings.sourceLang || "auto";
    const target = resolveTarget(trimmed, source, to || settings.targetLang);
    const primary = RUNNERS[settings.engine] ? settings.engine : "google";
    const cacheKey = `${primary}|${source}|${target}|${trimmed}`;
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, fromCache: true };

    const attempts = [primary];
    if (settings.fallback) {
      for (const engine of FREE_ENGINES) {
        if (engine !== primary && !attempts.includes(engine)) attempts.push(engine);
      }
    }

    // 每个引擎的失败原因分开记：lastError 只是「最后一次」失败，不能拿去冒充主引擎的原因。
    const failures = new Map();
    let lastFailedEngine = "";
    let lastError = null;
    for (const engine of attempts) {
      try {
        const result = await runEngine(engine, { text: trimmed, from: source, to: target });
        const payload = {
          ok: true,
          // 原文快照：界面据此确认译文仍对应当前输入，避免把上一段文本的译文写回聊天输入框。
          sourceText: trimmed,
          text: result.text,
          detected: result.detected,
          engine: result.engine,
          elapsedMs: result.elapsedMs,
          targetLanguage: target,
          sourceLanguage: source,
          requestedEngine: primary,
        };
        // 回退成功时按引擎各自的失败原因组装：界面要明确告诉用户「这不是你设置的引擎」，
        // 并分别给出主引擎与兜底链最后一次失败的原因，避免把兜底引擎的错误算到主引擎头上。
        if (engine !== primary && failures.size) {
          const primaryError = failures.get(primary) || null;
          const lastFailure = failures.get(lastFailedEngine) || null;
          payload.fallback = {
            engine: primary,
            code: primaryError?.code || "",
            status: Number(primaryError?.status) || 0,
            reason: primaryError?.reason || "",
            apiCode: primaryError?.apiCode || "",
            lastEngine: lastFailedEngine,
            lastCode: lastFailure?.code || "",
            lastStatus: Number(lastFailure?.status) || 0,
            lastReason: lastFailure?.reason || "",
            lastApiCode: lastFailure?.apiCode || "",
          };
        }
        // 回退结果不入缓存：它是「当时主引擎失败」的快照，缓存下来会让界面一直显示回退，
        // 用户即使网络已恢复也仍在用免费引擎译文；不缓存则下一次请求会重新尝试主引擎。
        if (!payload.fallback) remember(cacheKey, payload);
        return payload;
      } catch (error) {
        // 认证 / 网络 / 限流都继续尝试下一个引擎：只要还有一个可用引擎就给出译文。
        failures.set(engine, error);
        lastFailedEngine = engine;
        lastError = error;
      }
    }
    // 全失败时以主引擎的失败为准：兜底引擎只是补充尝试，不能把它的失败原因冒充成主引擎的。
    // 兜底链的失败明细挂在 failures 上，界面据此同时呈现主引擎原因与各兜底引擎的失败原因。
    const primaryError = failures.get(primary) || lastError || translateError("UNKNOWN", {});
    const fallbackFailures = attempts
      .filter((engine) => engine !== primary && failures.has(engine))
      .map((engine) => {
        const failure = failures.get(engine);
        return {
          engine,
          code: failure?.code || "",
          status: Number(failure?.status) || 0,
          reason: failure?.reason || "",
          apiCode: failure?.apiCode || "",
        };
      });
    if (fallbackFailures.length) primaryError.failures = fallbackFailures;
    throw primaryError;
  }

  // 设置页的「测试连接」：只跑指定引擎，不走兜底与缓存，便于定位配置问题。
  async function test({ text, to, engine }) {
    const settings = getSettings();
    const sample = String(text || "Hello");
    const target = resolveTarget(sample, "auto", to || settings.targetLang);
    return runEngine(RUNNERS[engine] ? engine : settings.engine, {
      text: sample,
      from: "auto",
      to: target,
    });
  }

  function clearCache() {
    cache.clear();
  }

  return { translate, test, clearCache };
}
