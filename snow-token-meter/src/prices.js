// 自定义价：为单个模型覆盖四项 token 单价（USD / 1M token），并带一个该记录自己的倍率。
// 单位约定：
//   记录与界面：token 价一律 USD / 1M token。
//   内部单价：  USD / token；换算只在本文件的 PRICE_UNIT 一处发生。
// 三态：null / 缺失 = 继承匹配到的目录条目；0 = 显式免费；正数 = 绝对价。
// 优先级：__ignore__ > 自定义价（status="custom"）> 手工映射 > 自动匹配。
import { PRICE_MULTIPLIER } from "./constants.js";
import { mappingKey, matchModel } from "./match.js";
import { clamp } from "./util.js";

// 自定义价存储版本位（与 CATALOG_SCHEMA 同样的记录级版本）。
export const PRICE_SCHEMA = 1;
// USD/1M token → USD/token 的除数；全仓唯一的换算点。
export const PRICE_UNIT = 1e6;

// 与 settings.js 的 MAX_MODEL_NAME 同值：模型键（小写）长度上限。
const MAX_PRICE_KEY = 200;
const MAX_NOTE = 200;
// 模型名来自宿主用量数据：拒绝会改写原型链的键，避免污染普通对象。
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// 倍率保留 4 位小数，USD/1M 保留 6 位（避免 3e-6 × 1e6 这类浮点尾差）。
const MULTIPLIER_SCALE = 1e4;
const PRICE_SCALE = 1e6;

// 非法标记：价字段出现负数 / 非数字时返回它，调用方据此整条丢弃记录。
const INVALID = Symbol("invalid");

// 记录里的四个 token 价字段；1 小时缓存价与按次费只能继承目录。
const PRICE_FIELDS = Object.freeze(["input", "output", "cacheRead", "cacheWrite"]);
// 记录字段 → 条目字段（只有 prompt / completion 换了名字）。
const ENTRY_FIELD = Object.freeze({
  input: "prompt",
  output: "completion",
  cacheRead: "cacheRead",
  cacheWrite: "cacheWrite",
});

export function priceKeyOf(model) {
  return mappingKey(model);
}

// 倍率归一化：缺省 / 非数 → 1，越界夹取，保留 4 位小数。
export function priceMultiplierOf(value) {
  if (value === null || value === undefined || value === "") return 1;
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return (
    Math.round(clamp(number, PRICE_MULTIPLIER.min, PRICE_MULTIPLIER.max) * MULTIPLIER_SCALE) /
    MULTIPLIER_SCALE
  );
}

function roundPrice(value) {
  return Math.round(value * PRICE_SCALE) / PRICE_SCALE;
}

// 单个价：null / 缺失 = 继承 → null；0 保留；负数或非数字 → INVALID。
function priceOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return INVALID;
  return number;
}

// 只跳过 null / undefined：0 必须原样返回（显式免费）。
function firstDefined(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

// 单条记录归一化：任一价字段非法即整条丢弃，不做半条价生效。
// 返回 { record, clamped } 或 { reason }。
function readRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { reason: "price-invalid" };
  const record = {};
  let priced = false;
  for (const field of PRICE_FIELDS) {
    const value = priceOrNull(raw[field]);
    if (value === INVALID) return { reason: "price-invalid" };
    record[field] = value === null ? null : roundPrice(value);
    if (value !== null) priced = true;
  }
  // 四项全空：无法计价（与 pricing.js「两个 token 价都没有 → 丢弃」同一护栏）。
  if (!priced) return { reason: "price-empty" };

  let multiplier = 1;
  let clamped = false;
  const rawMultiplier = raw.multiplier;
  if (rawMultiplier !== undefined && rawMultiplier !== null && rawMultiplier !== "") {
    const number = Number(rawMultiplier);
    if (!Number.isFinite(number)) return { reason: "multiplier-invalid" };
    multiplier = priceMultiplierOf(number);
    clamped = number < PRICE_MULTIPLIER.min || number > PRICE_MULTIPLIER.max;
  }
  record.multiplier = multiplier;
  record.note = typeof raw.note === "string" ? raw.note.trim().slice(0, MAX_NOTE) : "";
  record.updatedAt = Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0;
  return { record, clamped };
}

// 存储格式：{ schema, models: { 模型名小写: PriceRecord } }；也接受裸映射（模型名 → 记录）。
export function normalizePrices(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const models =
    source.models && typeof source.models === "object" && !Array.isArray(source.models)
      ? source.models
      : source;
  const prices = {};
  for (const [rawKey, value] of Object.entries(models)) {
    const key = priceKeyOf(rawKey);
    if (!key || key.length > MAX_PRICE_KEY || RESERVED_KEYS.has(key)) continue;
    const parsed = readRecord(value);
    if (!parsed.record) continue;
    prices[key] = parsed.record;
  }
  return prices;
}

export function priceRecordOf(prices, model) {
  if (!prices || typeof prices !== "object") return null;
  const key = priceKeyOf(model);
  if (!key) return null;
  const take = (value) => (value && typeof value === "object" ? value : null);
  if (Object.prototype.hasOwnProperty.call(prices, key)) return take(prices[key]);
  for (const rawKey of Object.keys(prices)) {
    if (priceKeyOf(rawKey) === key) return take(prices[rawKey]);
  }
  return null;
}

// 记录 + 匹配到的目录条目 → 生效条目（USD/token）。
// 回退链（唯一实现，cost.js 不再二次猜测）：
//   prompt       = custom.input      ?? catalog.prompt      ?? 0
//   completion   = custom.output     ?? catalog.completion  ?? 0
//   cacheRead    = custom.cacheRead  ?? catalog.cacheRead   ?? prompt
//   cacheWrite   = custom.cacheWrite ?? catalog.cacheWrite  ?? prompt
//   cacheWrite1h = catalog.cacheWrite1h ?? null（不覆盖，绝不回退成 5m 价）
//   request      = catalog.request  ?? 0（USD/次，不覆盖、不乘倍率）
// 记录自带倍率只乘「记录里写出的」四项 token 价；继承来的目录价保持挂牌价。
// 自定义价是扁平价：不继承目录的长上下文档位。
function buildCustomEntry(record, baseEntry, entryId, model) {
  const base = baseEntry || null;
  const multiplier = priceMultiplierOf(record.multiplier);
  const own = (value) => {
    if (value === null || value === undefined) return null;
    return (value / PRICE_UNIT) * multiplier;
  };
  const prompt = firstDefined(own(record.input), base?.prompt, 0);
  const completion = firstDefined(own(record.output), base?.completion, 0);
  const cacheRead = firstDefined(own(record.cacheRead), base?.cacheRead, prompt);
  const cacheWrite = firstDefined(own(record.cacheWrite), base?.cacheWrite, prompt);
  return {
    id: entryId,
    // 自定义价不隶属任何目录渠道，provider 留空，避免被当成挂牌价条目。
    provider: "",
    slug: entryId,
    name: record.note || base?.name || String(model ?? "").trim(),
    prompt,
    completion,
    cacheRead,
    cacheWrite,
    cacheWrite1h: base?.cacheWrite1h ?? null,
    request: base?.request ?? 0,
    tiers: [],
    tierInclusive: true,
    canonical: "",
    context: Number(base?.context) || 0,
    custom: true,
  };
}

// 取价分派：忽略 → 自定义价 → 匹配结果（目录价不做任何缩放）。
// 返回值与 matchModel 同构，额外带 custom（是否来自自定义价）。
export function resolvePrice(model, entries, mappings, customPrices) {
  const list = Array.isArray(entries)
    ? entries
    : Array.isArray(entries?.models)
      ? entries.models
      : [];
  const match = matchModel(model, list, mappings);
  // 用户显式忽略的模型不计成本、也不进覆盖率分母：忽略优先于自定义价。
  if (match.status === "ignored") return { ...match, custom: false };
  const record = priceRecordOf(customPrices, model);
  if (record) {
    const entryId = `custom:${priceKeyOf(model)}`;
    return {
      status: "custom",
      entryId,
      entry: buildCustomEntry(record, match.entry, entryId, model),
      confidence: 1,
      candidates: [],
      reason: "",
      matchedBy: "custom",
      custom: true,
    };
  }
  return { ...match, custom: false };
}
