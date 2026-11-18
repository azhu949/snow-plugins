// 谷歌翻译免费接口（gtx）：无需密钥，部分网络环境需要代理。
import { toGoogle } from "../languages.js";
import { assertOk, readJson, translateError, withNetworkGuard } from "./errors.js";

const API_URL = "https://translate.googleapis.com/translate_a/single";

export function translateGoogle(options) {
  const { text, from, to, fetchImpl } = options;
  return withNetworkGuard("google", async () => {
    const params = new URLSearchParams();
    params.set("client", "gtx");
    params.set("sl", from && from !== "auto" ? toGoogle(from) : "auto");
    params.set("tl", toGoogle(to));
    params.set("dt", "t");
    params.set("q", text);

    const response = await fetchImpl(`${API_URL}?${params.toString()}`, { method: "GET" });
    assertOk(response, "google");

    const data = await readJson(response, "google");
    const segments = Array.isArray(data?.[0]) ? data[0] : [];
    const joined = segments
      .map((segment) => (Array.isArray(segment) ? segment[0] : ""))
      .filter((part) => typeof part === "string" && part)
      .join("");
    if (!joined) throw translateError("UNKNOWN", { engine: "google", message: "响应缺少译文" });
    return { text: joined, detected: typeof data?.[2] === "string" ? data[2] : "" };
  });
}
