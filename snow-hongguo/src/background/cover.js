// 封面抓取：只允许已知图片 CDN 的 https 地址，拒绝内网/回环，限制大小与超时。
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { LIMITS } from "../shared/contract.js";
import { HttpError } from "./errors.js";

/** 红果封面实际落在 fqnovelpic.com；其余是同一 CDN 家族，留作兼容。 */
const ALLOWED_COVER_SUFFIXES = [
  "fqnovelpic.com",
  "fqnovel.com",
  "byteimg.com",
  "douyinpic.com",
  "snssdk.com",
  "pstatp.com",
  "ibytedtos.com",
  "bytecdntp.com",
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const REFERER = "https://www.hongguo.com/";

export const isAllowedCoverHost = (hostname) => {
  const host = String(hostname ?? "").toLowerCase();
  if (!host || isIP(host)) return false;
  return ALLOWED_COVER_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
};

export const isPrivateAddress = (address) => {
  const family = isIP(String(address ?? ""));
  if (family === 4) {
    const [a, b] = String(address)
      .split(".")
      .map((part) => Number(part));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (family === 6) {
    const lower = String(address).toLowerCase();
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80") ||
      lower.startsWith("::ffff:127.") ||
      lower.startsWith("::ffff:10.") ||
      lower.startsWith("::ffff:192.168.")
    );
  }
  return true;
};

/** 校验并返回 URL 对象；非法 https、带账号密码、非白名单域名一律拒绝。 */
export const assertCoverUrl = (rawUrl) => {
  const text = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!text || text.length > 2048) throw new HttpError(400, "INVALID_URL", "封面地址不合法");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new HttpError(400, "INVALID_URL", "封面地址不合法");
  }
  if (url.protocol !== "https:") throw new HttpError(400, "INVALID_URL", "封面地址必须是 https");
  if (url.username || url.password) throw new HttpError(403, "URL_FORBIDDEN", "封面地址不能带账号密码");
  if (!isAllowedCoverHost(url.hostname)) {
    throw new HttpError(403, "URL_FORBIDDEN", "封面域名不在允许列表内");
  }
  return url;
};

const requestOnce = (target, { timeoutMs, maxBytes, redirects }) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let req = null;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      try {
        req?.destroy();
      } catch {
        // 已经结束的连接忽略。
      }
      reject(error);
    };

    req = httpsRequest(
      target,
      {
        method: "GET",
        headers: { "user-agent": USER_AGENT, referer: REFERER, accept: "image/*,*/*;q=0.8" },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects <= 0) {
            fail(new HttpError(502, "COVER_FETCH_FAILED", "封面重定向次数过多"));
            return;
          }
          let next;
          try {
            next = assertCoverUrl(new URL(res.headers.location, target).href);
          } catch (error) {
            fail(error);
            return;
          }
          settled = true;
          resolve(requestOnce(next, { timeoutMs, maxBytes, redirects: redirects - 1 }));
          return;
        }

        if (status !== 200) {
          res.resume();
          fail(new HttpError(502, "COVER_FETCH_FAILED", `封面地址返回 HTTP ${status}`));
          return;
        }

        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.resume();
          fail(new HttpError(502, "COVER_TOO_LARGE", "封面图片过大"));
          return;
        }

        const contentType = String(res.headers["content-type"] ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        const chunks = [];
        let size = 0;

        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            fail(new HttpError(502, "COVER_TOO_LARGE", "封面图片过大"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({ bytes: Buffer.concat(chunks), contentType });
        });
        res.on("error", (error) => fail(error));
      }
    );

    req.on("timeout", () => fail(new HttpError(502, "COVER_TIMEOUT", "封面拉取超时")));
    req.on("error", (error) => fail(error));
    req.end();
  });

/** 抓取封面字节；DNS 解析到内网时直接拒绝。 */
export async function fetchCoverBytes(url, { timeoutMs = 10000, maxBytes = LIMITS.coverMaxBytes, redirects = 3 } = {}) {
  const target = url instanceof URL ? url : assertCoverUrl(url);
  let addresses = [];
  try {
    addresses = await lookup(target.hostname, { all: true });
  } catch {
    addresses = [];
  }
  if (addresses.length > 0 && addresses.every((item) => isPrivateAddress(item.address))) {
    throw new HttpError(403, "URL_FORBIDDEN", "封面地址解析到内网");
  }
  return requestOnce(target, { timeoutMs, maxBytes, redirects });
}
