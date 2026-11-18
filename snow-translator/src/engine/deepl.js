// DeepL：需要用户在设置里填写 API Key，免费版与专业版使用不同域名。
import { fromDeepL, toDeepL, toDeepLSource } from "../languages.js";
import { assertOk, readJson, translateError, withNetworkGuard } from "./errors.js";

const FREE_BASE = "https://api-free.deepl.com";
const PRO_BASE = "https://api.deepl.com";

export function translateDeepL(options) {
  const { text, from, to, fetchImpl, config } = options;
  return withNetworkGuard("deepl", async () => {
    const key = String(config?.key || "").trim();
    if (!key) throw translateError("AUTH", { engine: "deepl", message: "缺少 API Key" });
    const base = config?.plan === "pro" ? PRO_BASE : FREE_BASE;
    const body = { text: [text], target_lang: toDeepL(to) };
    if (from && from !== "auto") body.source_lang = toDeepLSource(from);

    const response = await fetchImpl(`${base}/v2/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `DeepL-Auth-Key ${key}`,
      },
      body: JSON.stringify(body),
    });
    assertOk(response, "deepl");

    const data = await readJson(response, "deepl");
    const item = data?.translations?.[0];
    if (!item || typeof item.text !== "string") {
      throw translateError("UNKNOWN", { engine: "deepl", message: "响应缺少译文" });
    }
    return {
      text: item.text,
      detected: fromDeepL(item.detected_source_language),
    };
  });
}
