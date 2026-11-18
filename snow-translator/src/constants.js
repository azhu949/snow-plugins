// 常量、存储键与兜底文案：文案以 zh-CN 字典为唯一来源，缺失键回落英文 key。
import zhCN from "../locales/zh-CN.json" with { type: "json" };

export const STORAGE_PREFIX = "translator:v1:";
export const SETTINGS_KEY = `${STORAGE_PREFIX}settings`;
// 个性化位置（用户拖过 / 关闭时记下的那次）。
export const LAYOUT_KEY = `${STORAGE_PREFIX}layout`;
// 默认位置基线：「恢复默认设置」回到这里，与个性化位置互不覆盖。
export const DEFAULT_LAYOUT_KEY = `${STORAGE_PREFIX}defaultLayout`;

// 单次请求的文本上限：免费接口对长度敏感，超长按段落切分后串行请求。
export const CHUNK_LIMIT = 3200;
// 面板输入上限：超过该长度按此值截断并提示一次，避免一次翻译耗时过长。
export const MAX_SOURCE_CHARS = 20000;
// 翻译结果的内存缓存条数（同一文本重复翻译不再走网络）。
export const CACHE_LIMIT = 120;

export const ENGINE_IDS = ["google", "bing", "baidu", "deepl", "openai"];
// 无需密钥的引擎：默认谷歌，主引擎失败时按此顺序兜底。
export const FREE_ENGINES = ["google", "bing"];

export const DEFAULT_SETTINGS = {
  engine: "google",
  fallback: true,
  sourceLang: "auto",
  targetLang: "auto",
  autoTranslate: true,
  selectionButton: true,
  messageButton: true,
  autoFillSelection: true,
  baidu: { appid: "", key: "" },
  deepl: { key: "", plan: "free" },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    key: "",
    prompt: "",
  },
};

export const FALLBACK = zhCN;
