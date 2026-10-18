// 脚本存储适配测试：GM_setValue 同步语义、错误包装与内存镜像校验。
import { strict as assert } from "node:assert";
import test from "node:test";

import { createScriptApi, StorageError } from "../src/script/api.js";

function withGm(getValue, setValue, run) {
  const hadGet = Object.prototype.hasOwnProperty.call(globalThis, "GM_getValue");
  const hadSet = Object.prototype.hasOwnProperty.call(globalThis, "GM_setValue");
  const previousGet = globalThis.GM_getValue;
  const previousSet = globalThis.GM_setValue;
  globalThis.GM_getValue = getValue;
  globalThis.GM_setValue = setValue;
  try {
    return run();
  } finally {
    if (hadGet) globalThis.GM_getValue = previousGet;
    else delete globalThis.GM_getValue;
    if (hadSet) globalThis.GM_setValue = previousSet;
    else delete globalThis.GM_setValue;
  }
}

test("setJson 同步提交并校验宿主内存副本", () => {
  const values = new Map();
  const calls = [];
  withGm(
    (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    (key, value) => {
      calls.push([key, value]);
      values.set(key, value);
    },
    () => {
      const api = createScriptApi();
      const result = api.storage.setJson("fixbench:test", { a: 1 });
      assert.equal(result, undefined);
      assert.deepEqual(calls, [["fixbench:test", '{"a":1}']]);
      assert.equal(values.get("fixbench:test"), '{"a":1}');
    },
  );
});

test("setJson 将同步写入异常包装为 StorageError", () => {
  withGm(
    () => null,
    () => {
      throw new Error("denied");
    },
    () => {
      const api = createScriptApi();
      assert.throws(
        () => api.storage.setJson("fixbench:test", { a: 1 }),
        (error) =>
          error instanceof StorageError && error.code === "write" && error.message.includes("提交"),
      );
    },
  );
});

test("setJson 发现宿主副本不一致时报告写入失败", () => {
  withGm(
    () => "stale",
    () => {},
    () => {
      const api = createScriptApi();
      assert.throws(
        () => api.storage.setJson("fixbench:test", { a: 1 }),
        (error) =>
          error instanceof StorageError && error.code === "write" && error.message.includes("副本不一致"),
      );
    },
  );
});

test("setJson 序列化失败仍报告 serialize", () => {
  const circular = {};
  circular.self = circular;
  withGm(
    () => null,
    () => {
      throw new Error("should not write");
    },
    () => {
      const api = createScriptApi();
      assert.throws(
        () => api.storage.setJson("fixbench:test", circular),
        (error) => error instanceof StorageError && error.code === "serialize",
      );
    },
  );
});
