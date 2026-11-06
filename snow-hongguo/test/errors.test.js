import test from "node:test";
import assert from "node:assert/strict";
import {
  ERROR_MESSAGES,
  HttpError,
  isDeviceRecoveryCode,
  mapSdkError,
  statusForCode,
  toErrorResponse,
} from "../src/background/errors.js";

test("六种关键错误码翻成中文并给出合适状态码", () => {
  const cases = [
    ["RATE_LIMITED", "请求太频繁", 429],
    ["ANONYMOUS_LIMITED", "匿名设备被限制", 429],
    ["DEVICE_REJECTED", "设备被拒", 502],
    ["CONTENT_UNAVAILABLE", "内容不可用", 502],
    ["AUTHENTICATION_REQUIRED", "需要登录", 502],
    ["CHALLENGE_REQUIRED", "服务端要求验证", 502],
  ];
  for (const [code, message, status] of cases) {
    assert.equal(ERROR_MESSAGES[code], message);
    assert.equal(mapSdkError({ code }).message, message);
    assert.equal(statusForCode(code), status);
  }
});

test("参数类错误映射 400，本地故障 500，未知错误码 500", () => {
  assert.equal(statusForCode("INVALID_OPTIONS"), 400);
  assert.equal(statusForCode("PARAM_INVALID"), 400);
  assert.equal(statusForCode("PROFILE_NOT_FOUND"), 500);
  assert.equal(statusForCode("SIGNER_UNAVAILABLE"), 500);
  assert.equal(statusForCode("SOMETHING_NEW"), 500);
});

test("未知错误码保留原始 code，提示回退为未知错误", () => {
  const mapped = mapSdkError({ code: "SOMETHING_NEW", message: "upstream detail" });
  assert.equal(mapped.code, "SOMETHING_NEW");
  assert.equal(mapped.message, "未知错误");
  assert.equal(mapped.rawMessage, "upstream detail");
});

test("原始 code 与重试提示保留在响应里", () => {
  const response = toErrorResponse({
    code: "RATE_LIMITED",
    message: "429 too many",
    retryable: true,
    retryAfterMs: 1500,
  });
  assert.equal(response.status, 429);
  assert.deepEqual(response.payload.error, {
    code: "RATE_LIMITED",
    message: "请求太频繁",
    retryable: true,
    retryAfterMs: 1500,
  });
});

test("HttpError 原样转成错误信封", () => {
  const response = toErrorResponse(new HttpError(400, "INVALID_PARAM", "缺少参数 q"));
  assert.deepEqual(response, {
    status: 400,
    payload: { error: { code: "INVALID_PARAM", message: "缺少参数 q" } },
  });
});

test("非 SDK 异常不泄露内部信息", () => {
  const response = toErrorResponse(new Error("EACCES: C:\\secret\\path"));
  assert.equal(response.status, 500);
  assert.deepEqual(response.payload, { error: { code: "INTERNAL", message: "后台内部错误" } });
});

test("设备自愈只认 DEVICE_REJECTED 与 ANONYMOUS_LIMITED", () => {
  assert.equal(isDeviceRecoveryCode("DEVICE_REJECTED"), true);
  assert.equal(isDeviceRecoveryCode("ANONYMOUS_LIMITED"), true);
  assert.equal(isDeviceRecoveryCode("RATE_LIMITED"), false);
});
