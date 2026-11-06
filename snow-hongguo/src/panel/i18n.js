// 文案：一律走 api.t(key, { defaultValue, values })，语言包放在 locales/*.json。
// 清单尚未声明 locales 时 api.t 会回退到 defaultValue，因此这里把语言包直接打包进面板，
// 既保证当前可用，也保证清单补上 locales 后自动切换成宿主加载的语言包。
import zhCN from "../../locales/zh-CN.json";
import zhTW from "../../locales/zh-TW.json";
import en from "../../locales/en.json";

const PACKS = { "zh-CN": zhCN, "zh-TW": zhTW, en };

const normalizeLocale = (locale) => {
  const raw = String(locale || "").toLowerCase();
  if (!raw) return "zh-CN";
  if (raw.startsWith("zh-tw") || raw.startsWith("zh-hk") || raw === "zh-hant") return "zh-TW";
  if (raw.startsWith("zh")) return "zh-CN";
  if (raw.startsWith("en")) return "en";
  return "zh-CN";
};

const interpolate = (template, values) => {
  if (!values) return template;
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
};

/**
 * 返回 { t, locale }。
 * t 始终把本地语言包文本作为 defaultValue 交给宿主：清单声明了 locales 时用宿主版本，
 * 没声明时也不会退化成键名。
 */
export function createTranslator(api, locale) {
  const resolved = normalizeLocale(locale || api?.locale);
  const pack = PACKS[resolved] || PACKS["zh-CN"];
  const fallbackPack = PACKS["zh-CN"];

  const t = (key, values) => {
    const fallback = pack[key] ?? fallbackPack[key] ?? key;
    try {
      if (api && typeof api.t === "function") {
        return api.t(key, { defaultValue: fallback, values });
      }
    } catch {
      // 宿主取词异常时退回本地语言包，界面不因文案失败而中断。
    }
    return interpolate(fallback, values);
  };

  return { t, locale: resolved };
}
