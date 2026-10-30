// 三语言文案：UI 与脚本入口共用同一份字典，缺失键回退简体中文。
// 占位符统一写作 {{key}}，与 snow-fix-bench 保持一致。
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

// getLocale 可以是 locale 字符串，也可以是返回最新 locale 的函数（跟随 snow.context）。
function createT(getLocale) {
  return (key, values) => {
    const locale = normalizeLocale(typeof getLocale === "function" ? getLocale() : getLocale);
    const dictionary = DICTIONARIES[locale] || DICTIONARIES["zh-CN"];
    // 缺失键先回退简体中文，仍缺失时原样返回 key，避免出现 undefined。
    const template = dictionary[key] ?? DICTIONARIES["zh-CN"][key] ?? key;
    return formatText(template, values);
  };
}

export { DICTIONARIES, normalizeLocale, formatText, createT };
