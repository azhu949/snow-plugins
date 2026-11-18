// 百度翻译开放平台（通用文本翻译）：APP ID + 密钥，sign = MD5(appid + q + salt + 密钥)。
import { fromBaidu, toBaidu } from "../languages.js";
import { assertOk, readJson, translateError, withNetworkGuard } from "./errors.js";
import { md5 } from "./md5.js";

const ENGINE = "baidu";
const ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";

// 认证类错误码提示检查密钥，频率限制提示稍后再试，余额不足单独提示充值，其余按接口业务码上报。
const AUTH_CODES = new Set(["52003", "54001", "58000", "58001", "58002", "90107"]);
const BALANCE_CODES = new Set(["54004"]);
const RATE_CODES = new Set(["54003", "54005"]);

export function translateBaidu(options) {
  const { text, from, to, fetchImpl, config } = options;
  return withNetworkGuard(ENGINE, async () => {
    const appid = String(config?.appid || "").trim();
    const key = String(config?.key || "").trim();
    if (!appid || !key) {
      throw translateError("AUTH", { engine: ENGINE, message: "缺少 APP ID 或密钥" });
    }

    // 百度要求 sign = MD5(appid + q + salt + 密钥)，salt 用时间戳即可。
    const salt = String(Date.now());
    const sign = md5(`${appid}${text}${salt}${key}`);
    const params = new URLSearchParams({
      q: text,
      from: from && from !== "auto" ? toBaidu(from) : "auto",
      to: toBaidu(to),
      appid,
      salt,
      sign,
    });

    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    assertOk(response, ENGINE);

    // 百度即使 HTTP 200 也可能带 error_code，必须单独判断。
    const data = await readJson(response, ENGINE);
    if (data?.error_code) {
      const code = String(data.error_code);
      const kind = AUTH_CODES.has(code) || BALANCE_CODES.has(code) ? "AUTH" : RATE_CODES.has(code) ? "RATE" : "HTTP";
      // 百度即使 HTTP 200 也可能带 error_code：业务码放 apiCode / detail，status 只表示真实 HTTP 状态。
      const reason = BALANCE_CODES.has(code) ? "balance" : kind === "AUTH" ? "" : "api";
      throw translateError(kind, {
        engine: ENGINE,
        status: 0,
        apiCode: code,
        reason,
        message: String(data.error_msg || `error ${code}`),
        detail: `${ENGINE} ${code}`,
      });
    }

    // trans_result 按行返回，拼回原文的换行结构。
    const parts = Array.isArray(data?.trans_result)
      ? data.trans_result.map((item) => String(item?.dst ?? ""))
      : [];
    const translated = parts.join("\n");
    if (!translated.trim()) {
      throw translateError("UNKNOWN", { engine: ENGINE, message: "响应缺少译文" });
    }
    return { text: translated, detected: fromBaidu(data?.from) };
  });
}
