// 设置读写：全部落到 GM_setValue（按 scriptId 隔离），读取时逐字段校验后合并默认值。
import { DEFAULT_SETTINGS, ENGINE_IDS, SETTINGS_KEY } from "./constants.js";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from "./languages.js";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeSettings(input) {
  const raw = isObject(input) ? input : {};
  const baidu = isObject(raw.baidu) ? raw.baidu : {};
  const deepl = isObject(raw.deepl) ? raw.deepl : {};
  const openai = isObject(raw.openai) ? raw.openai : {};
  const target = TARGET_LANGUAGES.includes(raw.targetLang)
    ? raw.targetLang
    : DEFAULT_SETTINGS.targetLang;
  return {
    engine: ENGINE_IDS.includes(raw.engine) ? raw.engine : DEFAULT_SETTINGS.engine,
    fallback: bool(raw.fallback, DEFAULT_SETTINGS.fallback),
    sourceLang: SOURCE_LANGUAGES.includes(raw.sourceLang)
      ? raw.sourceLang
      : DEFAULT_SETTINGS.sourceLang,
    targetLang: target,
    autoTranslate: bool(raw.autoTranslate, DEFAULT_SETTINGS.autoTranslate),
    selectionButton: bool(raw.selectionButton, DEFAULT_SETTINGS.selectionButton),
    messageButton: bool(raw.messageButton, DEFAULT_SETTINGS.messageButton),
    autoFillSelection: bool(raw.autoFillSelection, DEFAULT_SETTINGS.autoFillSelection),
    baidu: {
      appid: text(baidu.appid),
      key: text(baidu.key),
    },
    deepl: {
      key: text(deepl.key),
      plan: deepl.plan === "pro" ? "pro" : "free",
    },
    openai: {
      baseUrl: text(openai.baseUrl, DEFAULT_SETTINGS.openai.baseUrl),
      model: text(openai.model, DEFAULT_SETTINGS.openai.model),
      key: text(openai.key),
      prompt: text(openai.prompt),
    },
  };
}

export function loadSettings() {
  try {
    const raw = GM_getValue(SETTINGS_KEY, "");
    if (!raw) return normalizeSettings(null);
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    console.warn("[翻译助手] 读取设置失败，已回退默认值", error);
    return normalizeSettings(null);
  }
}

export function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  try {
    GM_setValue(SETTINGS_KEY, JSON.stringify(normalized));
  } catch (error) {
    console.warn("[翻译助手] 保存设置失败", error);
  }
  return normalized;
}
