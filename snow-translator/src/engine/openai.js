// OpenAI 兼容接口：DeepSeek / 通义 / 本地网关等凡支持 /chat/completions 的服务都能用。
import { toPromptName } from "../languages.js";
import { assertOk, readJson, translateError, withNetworkGuard } from "./errors.js";

const DEFAULT_PROMPT =
  "You are a professional translator. Translate the user message into {{target}}. " +
  "Preserve markdown structure, code blocks, inline code, URLs and numbers exactly. " +
  "Output only the translation, without explanations, quotes or language labels.";

function endpointOf(baseUrl) {
  const value = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  if (/\/chat\/completions$/i.test(value)) return value;
  return `${value}/chat/completions`;
}

export function translateOpenAI(options) {
  const { text, from, to, fetchImpl, config } = options;
  return withNetworkGuard("openai", async () => {
    const url = endpointOf(config?.baseUrl);
    const key = String(config?.key || "").trim();
    if (!url) throw translateError("AUTH", { engine: "openai", message: "缺少接口地址" });
    if (!key) throw translateError("AUTH", { engine: "openai", message: "缺少 API Key" });

    const template = String(config?.prompt || "").trim() || DEFAULT_PROMPT;
    const system = template.replace(/\{\{\s*target\s*\}\}/g, toPromptName(to));
    const hint =
      from && from !== "auto" ? `The source language is ${toPromptName(from)}.\n\n` : "";

    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: String(config?.model || "").trim() || "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${hint}${text}` },
        ],
      }),
    });
    assertOk(response, "openai");

    const data = await readJson(response, "openai");
    let content = data?.choices?.[0]?.message?.content;
    if (Array.isArray(content)) {
      content = content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
    }
    if (typeof content !== "string" || !content.trim()) {
      throw translateError("UNKNOWN", { engine: "openai", message: "响应缺少译文" });
    }
    // 不做 trim：分片结果按原样拼接，段落之间的换行与空行才不会被吃掉。
    // 整体首尾空白由调用方在最终结果上收一次。
    return { text: content, detected: "" };
  });
}
