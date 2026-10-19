// 繁简字形转换：按字表与词表转换展示文本，并提供整本转换缓存。
import {
  ZH_PHRASE_SEP,
  ZH_S2T_CHARS,
  ZH_S2T_CHARS_S,
  ZH_S2T_PHRASES,
  ZH_T2S_CHARS,
  ZH_T2S_CHARS_S,
  ZH_T2S_PHRASES
} from "./zh-data.js";

export let zhTableCache = null;

// 惰性构建映射表：只在第一次真正需要转换时解析，避免影响启动
export function zhTables() {
  if (zhTableCache) return zhTableCache;
  const charPairs = (keys, values) => {
    const map = new Map();
    const len = Math.min(keys.length, values.length);
    for (let i = 0; i < len; i += 1) map.set(keys.charAt(i), values.charAt(i));
    return map;
  };
  // 短语条目按码元长度对称过滤：个别条目的右串含代理对（如 二噁英 -> 二𫫇英 会多出 1 码元），
  // 会让「1 码元换 1 码元」的偏移不变式失效，切换字形后同一 offset 就落到别处（进度定位漂移）。
  // 生成器 .snow/gen-zh-dict.js 已同步过滤，这里再兜一层：手改或未重生成的数据也守得住该不变式。
  const phrasePairs = (packed) => {
    const map = new Map();
    let maxLen = 0;
    if (packed) {
      const parts = packed.split(ZH_PHRASE_SEP);
      for (let i = 0; i + 1 < parts.length; i += 2) {
        if (parts[i].length !== parts[i + 1].length) continue;
        map.set(parts[i], parts[i + 1]);
        if (parts[i].length > maxLen) maxLen = parts[i].length;
      }
    }
    return { map: map, maxLen: maxLen };
  };
  // 预检触发集：只有两类字可能让正文发生变化——
  // 1) 单字表里 value !== key 的字（本身就会被改写）；
  // 2) 所有「键值不同」的短语键里出现的每一个字（成词替换时这些位置才会被改写）。
  // 第 2 条必须收整串字符而不是只收首字：像「一坏 -> 一坯」这类短语的首字「一」自身没有映射，
  // 只收首字就会漏掉正文明明需要转换的情况，预检也就不精确了。
  const triggerChars = (charMap, phraseTable) => {
    const set = new Set();
    charMap.forEach((value, key) => {
      if (value !== key) set.add(key);
    });
    phraseTable.map.forEach((value, key) => {
      if (value === key) return;
      for (let i = 0; i < key.length; i += 1) set.add(key.charAt(i));
    });
    return set;
  };
  const t2sChars = charPairs(ZH_T2S_CHARS, ZH_T2S_CHARS_S);
  const t2sPhrases = phrasePairs(ZH_T2S_PHRASES);
  const s2tChars = charPairs(ZH_S2T_CHARS, ZH_S2T_CHARS_S);
  const s2tPhrases = phrasePairs(ZH_S2T_PHRASES);
  const t2sTriggers = triggerChars(t2sChars, t2sPhrases);
  const s2tTriggers = triggerChars(s2tChars, s2tPhrases);
  // 触发集同时挂在短语表对象上，convertByTable 不用改签名就能取到
  t2sPhrases.triggers = t2sTriggers;
  s2tPhrases.triggers = s2tTriggers;
  zhTableCache = {
    t2sChars: t2sChars,
    t2sPhrases: t2sPhrases,
    s2tChars: s2tChars,
    s2tPhrases: s2tPhrases,
    t2sTriggers: t2sTriggers,
    s2tTriggers: s2tTriggers
  };
  return zhTableCache;
}

// 整段转换：先按最长短语匹配（命中即跳过对应长度），未命中再查单字表，都不命中保持原样
// 开头是一次精确预检：正文里没有任何「候选字符」时，逐字与短语都不可能命中，直接返回原文，
// 省掉多 MB 文本的空转（简体界面读简体书这种常见场景）；一旦命中候选就照常走完整转换，
// 因此结果与预检前逐码元一致，只是把「整段都不会变化」的情况提前短路。
export function convertByTable(text, charMap, phraseTable) {
  const src = String(text == null ? "" : text);
  if (!src) return "";
  const triggers = phraseTable.triggers;
  if (triggers) {
    let candidate = false;
    for (let i = 0; i < src.length; i += 1) {
      if (triggers.has(src.charAt(i))) {
        candidate = true;
        break;
      }
    }
    if (!candidate) return src;
  }
  const phraseMap = phraseTable.map;
  const maxLen = phraseTable.maxLen;
  let out = "";
  let i = 0;
  while (i < src.length) {
    let step = 0;
    if (maxLen > 1) {
      const limit = Math.min(maxLen, src.length - i);
      for (let len = limit; len >= 2; len -= 1) {
        const hit = phraseMap.get(src.slice(i, i + len));
        if (hit !== undefined) {
          out += hit;
          step = len;
          break;
        }
      }
    }
    if (!step) {
      const ch = src.charAt(i);
      const hit = charMap.get(ch);
      out += hit === undefined ? ch : hit;
      step = 1;
    }
    i += step;
  }
  return out;
}

// mode: simplified（转简体）/ traditional（转繁体）；其余值（含 auto / none）原样返回
export function convertScript(text, mode) {
  if (mode !== "simplified" && mode !== "traditional") return String(text == null ? "" : text);
  const tables = zhTables();
  return mode === "simplified"
    ? convertByTable(text, tables.t2sChars, tables.t2sPhrases)
    : convertByTable(text, tables.s2tChars, tables.s2tPhrases);
}

// 整本正文的转换结果缓存（容量 1）：键 = 书 id + 解析后的字形方向，值 = { text, blocks }。
// 做成工厂是为了让「状态实例」由 createEngine 独占，模块层不留任何缓存状态，避免跨引擎实例串数据。
// 键用「解析后的方向」而不是原始设置值：auto 在 zh-CN 下就解析为 simplified，与显式 simplified 命中同一份，
// 于是切回字形、切走再切回同一本书都不必重跑转换与 buildBlocks，只有首次打开与真正换方向才重转。
// 容量只留最近一条：多本数 MB 正文常驻内存不值得。
// 失效点只有两处：删除单本（removeBook）与清空全部数据（clearAllData）。
// 导入路径每次都生成新 id、从不覆写同 id 正文，因此导入处无需失效。
export function createScriptTextCache() {
  const slot = { key: "", text: "", blocks: null };
  const keyOf = (bookId, mode) =>
    mode === "simplified" || mode === "traditional" ? String(bookId) + "|" + mode : "";
  return {
    keyOf: keyOf,
    // 命中返回 { text, blocks }（blocks 是同一个数组引用，调用方可直接复用），未命中返回 null
    read(bookId, mode) {
      const key = keyOf(bookId, mode);
      if (!key || slot.key !== key || typeof slot.text !== "string" || !slot.blocks) return null;
      return { text: slot.text, blocks: slot.blocks };
    },
    write(bookId, mode, text, blocks) {
      const key = keyOf(bookId, mode);
      if (!key) return;
      slot.key = key;
      slot.text = text;
      slot.blocks = blocks;
    },
    // 丢弃某本书的缓存；bookId 为空时整体丢弃（清空全部数据用）
    drop(bookId) {
      if (bookId && slot.key.indexOf(String(bookId) + "|") !== 0) return;
      slot.key = "";
      slot.text = "";
      slot.blocks = null;
    }
  };
}

// 设置值 -> 实际转换方向。auto 时跟随宿主界面语言：
// zh-CN 之类转简体、zh-TW / zh-HK / zh-Hant 转繁体、其它语言（如英文）不处理。
export function resolveScriptMode(setting, locale) {
  if (setting === "simplified" || setting === "traditional" || setting === "none") return setting;
  const tag = String(locale == null ? "" : locale).toLowerCase().replace(/_/g, "-");
  if (tag.indexOf("zh") !== 0) return "none";
  if (
    tag.indexOf("tw") !== -1 ||
    tag.indexOf("hk") !== -1 ||
    tag.indexOf("mo") !== -1 ||
    tag.indexOf("hant") !== -1
  ) {
    return "traditional";
  }
  return "simplified";
}

