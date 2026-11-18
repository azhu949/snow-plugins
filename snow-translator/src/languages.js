// 语言清单与各引擎语言码映射：内部统一使用 BCP-47 代码，引擎侧再做转换。
export const SOURCE_LANGUAGES = [
  "auto",
  "zh-CN",
  "zh-TW",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt",
  "ru",
  "it",
  "ar",
  "th",
  "vi",
  "tr",
  "id",
  "hi",
  "nl",
  "pl",
];

// 目标语言同样允许「自动检测」：按 detectLanguage 的结果择向（中文→英文，其它→界面语言）。
export const TARGET_LANGUAGES = [...SOURCE_LANGUAGES];

// 语言名称优先用 Intl.DisplayNames；简繁与它们的本语种名称单独覆盖。
const OVERRIDES = {
  "zh-CN": { "zh-CN": "简体中文", "zh-TW": "繁体中文" },
  "zh-TW": { "zh-CN": "簡體中文", "zh-TW": "繁體中文" },
  en: { "zh-CN": "Chinese (Simplified)", "zh-TW": "Chinese (Traditional)" },
};

const AUTO_LABEL = { "zh-CN": "自动检测", "zh-TW": "自動偵測", en: "Auto detect" };

function normalizeLocale(locale) {
  const value = String(locale || "zh-CN").replace("_", "-");
  if (/^zh-(tw|hk|mo)/i.test(value)) return "zh-TW";
  if (/^en/i.test(value)) return "en";
  return "zh-CN";
}

// Intl.DisplayNames 的构造要初始化 locale 数据，开销固定；每次渲染重建几十个实例会拖慢输入响应。
// 归一化后的 locale 只有三种取值，所以按 locale 复用实例、按 (locale, code) 缓存结果即可，不需要淘汰。
const DISPLAY_NAMES = new Map();
const LANGUAGE_NAMES = new Map();

function displayNamesFor(loc) {
  if (!DISPLAY_NAMES.has(loc)) {
    let display = null;
    try {
      display = new Intl.DisplayNames([loc], { type: "language" });
    } catch {
      // 宿主不支持时把 null 也缓存下来，后续直接走回退，避免每次渲染都抛一次异常。
      display = null;
    }
    DISPLAY_NAMES.set(loc, display);
  }
  return DISPLAY_NAMES.get(loc);
}

export function languageName(code, locale) {
  const loc = normalizeLocale(locale);
  if (!code) return "";
  if (code === "auto") return AUTO_LABEL[loc];
  const override = OVERRIDES[loc]?.[code];
  if (override) return override;
  const key = `${loc}|${code}`;
  if (LANGUAGE_NAMES.has(key)) return LANGUAGE_NAMES.get(key);
  let name = code;
  const display = displayNamesFor(loc);
  if (display) {
    try {
      const value = display.of(code);
      if (value && value !== code) name = value;
    } catch {
      // of() 对非法 code 抛 RangeError：同样回退为代码本身，并缓存这次回退。
    }
  }
  LANGUAGE_NAMES.set(key, name);
  return name;
}

// 微软翻译语言码。
const BING_CODES = { "zh-CN": "zh-Hans", "zh-TW": "zh-Hant" };

export function toBing(code) {
  return BING_CODES[code] || code;
}

export function fromBing(code) {
  const value = String(code || "");
  if (/^zh-hans/i.test(value) || /^zh-cn/i.test(value)) return "zh-CN";
  if (/^zh-hant/i.test(value) || /^zh-tw/i.test(value)) return "zh-TW";
  return value.split("-")[0].toLowerCase();
}

// 谷歌翻译语言码与内部代码一致。
export function toGoogle(code) {
  return code;
}

const DEEPL_CODES = {
  "zh-CN": "ZH",
  "zh-TW": "ZH-HANT",
  en: "EN-US",
  pt: "PT-PT",
  // DeepL 部分语种没有地区区分，直接用大写代码。
};

export function toDeepL(code) {
  return DEEPL_CODES[code] || String(code).toUpperCase();
}

// DeepL 的 source_lang 只接受基础语种码：EN-US / PT-PT / ZH-HANT 这类变体只能用于 target_lang。
const DEEPL_SOURCE_CODES = {
  "zh-CN": "ZH",
  "zh-TW": "ZH",
};

export function toDeepLSource(code) {
  return DEEPL_SOURCE_CODES[code] || String(code).split("-")[0].toUpperCase();
}

// DeepL 的 detected_source_language 用引擎侧代码（ZH / ZH-HANT / EN-US / PT-PT），
// 小写后不是内部码，必须按同一张映射表回到内部语言码，否则交换语言会写出下拉里不存在的目标语言。
const DEEPL_DETECTED = {
  ZH: "zh-CN",
  "ZH-HANT": "zh-TW",
  "EN-US": "en",
  "EN-GB": "en",
  "PT-PT": "pt",
  "PT-BR": "pt",
};

export function fromDeepL(code) {
  const value = String(code || "").toUpperCase();
  if (!value) return "";
  if (DEEPL_DETECTED[value]) return DEEPL_DETECTED[value];
  const base = value.split("-")[0].toLowerCase();
  return base === "zh" ? "zh-CN" : base;
}

// 百度翻译语言码：多数与内部代码一致，个别语种是专用写法（繁体 cht、日语 jp、韩语 kor）。
const BAIDU_CODES = {
  "zh-CN": "zh",
  "zh-TW": "cht",
  ja: "jp",
  ko: "kor",
  fr: "fra",
  es: "spa",
  ar: "ara",
  vi: "vie",
};

export function toBaidu(code) {
  return BAIDU_CODES[code] || code;
}

// 百度返回的语种码回落到内部代码，供「检测到 xx」展示使用。
const BAIDU_TO_INTERNAL = {
  zh: "zh-CN",
  cht: "zh-TW",
  jp: "ja",
  kor: "ko",
  fra: "fr",
  spa: "es",
  ara: "ar",
  vie: "vi",
};

export function fromBaidu(code) {
  const value = String(code || "").toLowerCase();
  return BAIDU_TO_INTERNAL[value] || value;
}

// 大模型提示词里用自然语言名称，比语言码可靠。
const PROMPT_NAMES = {
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  pt: "Portuguese",
  ru: "Russian",
  it: "Italian",
  ar: "Arabic",
  th: "Thai",
  vi: "Vietnamese",
  tr: "Turkish",
  id: "Indonesian",
  hi: "Hindi",
  nl: "Dutch",
  pl: "Polish",
};

export function toPromptName(code) {
  return PROMPT_NAMES[code] || code;
}

// 中英混排等场景下用于「交换语言」的兜底：自动检测无法作为目标语言。
export function otherLanguage(code, detected) {
  if (detected && detected !== code) return detected;
  return code === "zh-CN" ? "en" : "zh-CN";
}

// 本地语种判断：只区分翻译择向需要的大类，不发请求、不依赖外部服务。
// 顺序有讲究：日语大量使用汉字，必须先看假名；韩语同理。
export function detectLanguage(text) {
  const value = String(text || "");
  const total = [...value].filter((char) => /\S/.test(char)).length;
  if (!total) return "";

  const count = (pattern) => (value.match(pattern) || []).length;
  const kana = count(/[\u3040-\u30ff]/g);
  const hangul = count(/[\uac00-\ud7af\u1100-\u11ff]/g);
  const han = count(/[\u3400-\u4dbf\u4e00-\u9fff]/g);
  const cyrillic = count(/[\u0400-\u04ff]/g);
  const arabic = count(/[\u0600-\u06ff]/g);
  const thai = count(/[\u0e00-\u0eaf]/g);

  if (kana / total > 0.05) return "ja";
  if (hangul / total > 0.1) return "ko";
  if (han / total > 0.15) return "zh-CN";
  if (cyrillic / total > 0.3) return "ru";
  if (arabic / total > 0.3) return "ar";
  if (thai / total > 0.3) return "th";
  return "en";
}

// 目标语言为「自动检测」时决定实际目标：中文译成英文，其余译成界面语言（简体 / 繁体中文 / 英文）。
export function resolveAutoTarget(text, source, locale) {
  const detected = source && source !== "auto" ? source : detectLanguage(text);
  if (/^zh/i.test(detected)) return "en";
  return normalizeLocale(locale);
}
