// 三语言文案：UI 与引擎共用同一份字典，避免引擎直接读取简体兜底。
import { FALLBACK } from "./constants.js";
import zhCN from "../locales/zh-CN.json" with { type: "json" };
import zhTW from "../locales/zh-TW.json" with { type: "json" };
import en from "../locales/en.json" with { type: "json" };

const DICTIONARIES = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
};

function normalizeLocale(locale) {
  const value = String(locale || "zh-CN").replace("_", "-");
  if (/^zh-(tw|hk|mo)/i.test(value)) return "zh-TW";
  if (/^en/i.test(value)) return "en";
  return "zh-CN";
}

function formatText(template, values) {
  if (!values) return String(template);
  return String(template).replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

function createT(getLocale) {
  return (key, values) => {
    const locale = normalizeLocale(typeof getLocale === "function" ? getLocale() : getLocale);
    const dictionary = DICTIONARIES[locale] || DICTIONARIES["zh-CN"];
    const template = dictionary[key] ?? FALLBACK[key] ?? key;
    return formatText(template, values);
  };
}

export { DICTIONARIES, normalizeLocale, formatText, createT };
