import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import jpeg from "jpeg-js";
import { createCache } from "../src/background/cache.js";
import { convertToJpeg, createCoverResolver, resetImageConverterCache } from "../src/background/media/cover.js";
import { convertWithBundledDecoder } from "../src/background/media/cover-wasm.js";

// 真实 CDN 响应：400x572、HEVC 编码的 HEIC；离线验证，不请求上游。
const heic = await readFile(new URL("./fixtures/cover.heic", import.meta.url));
const coverUrl = "https://p3-reading-sign.fqnovelpic.com/novel-pic/fixture.heic";
const assertThumbnail = (bytes) => {
  const decoded = jpeg.decode(bytes, { useTArray: true });
  assert.equal(decoded.width, 224);
  assert.equal(decoded.height, 320);
  // 真实像素而非只写 JPEG 文件头，图像不能全部是同一种颜色。
  assert.ok(new Set(decoded.data).size > 100);
};
const makeRoot = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hongguo-cover-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

test("没有任何系统转换器时，内置 HEIC 解码仍返回可解码的 JPEG", async () => {
  resetImageConverterCache();
  const original = Buffer.from(heic);
  assertThumbnail(await convertToJpeg(heic, { converters: [] }));
  assert.deepEqual(heic, original, "不能 transfer 或修改缓存原始字节");
});

test("系统转换失败时记录原因并使用内置解码器，后续优先复用成功方案", async () => {
  resetImageConverterCache();
  const logs = [];
  // Node 不能接受 ffmpeg 参数，稳定模拟转换器已存在但不能解码 HEIC。
  const options = { converters: [{ kind: "ffmpeg", path: process.execPath }], log: (line) => logs.push(line) };
  assertThumbnail(await convertToJpeg(heic, options));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /封面转换失败 \[ffmpeg\]/);
  logs.length = 0;
  assertThumbnail(await convertToJpeg(heic, options));
  assert.deepEqual(logs, [], "已成功的内置解码器应优先于失败的系统转换器");
});

test("已有 HEIC 缓存自动升级成 JPEG，第二次直接命中 JPEG", async (t) => {
  const cache = createCache({ rootDir: await makeRoot(t) });
  await cache.init();
  await cache.writeCover(coverUrl, heic, "image/heic");
  let conversions = 0;
  const resolver = createCoverResolver({
    cache,
    convert: (bytes, options) => {
      conversions += 1;
      return convertToJpeg(bytes, { ...options, converters: [] });
    },
  });
  const first = await resolver.resolve(coverUrl);
  assert.equal(first.contentType, "image/jpeg");
  assert.equal(first.converted, true);
  assert.equal(first.cache, "hit");
  assertThumbnail(first.bytes);
  const files = await readdir(cache.coversDir);
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith(".jpg"));
  const second = await resolver.resolve(coverUrl);
  assert.equal(second.contentType, "image/jpeg");
  assert.equal(second.converted, false);
  assert.equal(conversions, 1);
  assert.deepEqual(second.bytes, first.bytes);
});

test("损坏 HEIC 记录内置解码错误并回退原图，不影响列表接口", async () => {
  const invalid = Buffer.from("invalid-heic");
  const logs = [];
  const resolver = createCoverResolver({
    cache: { readCover: async () => ({ bytes: invalid, contentType: "image/heic" }) },
    log: (line) => logs.push(line),
    convert: (bytes, options) => convertToJpeg(bytes, { ...options, converters: [] }),
  });
  const result = await resolver.resolve(coverUrl);
  assert.equal(result.contentType, "image/heic");
  assert.equal(result.converted, false);
  assert.deepEqual(result.bytes, invalid);
  assert.ok(logs.some((line) => /\[bundled\]/.test(line)));
  assert.ok(logs.some((line) => /Could not parse HEIF file/.test(line)), "保留上游的具体解析原因");
  assert.ok(logs.some((line) => /回退原图/.test(line)));
});

test("浏览器已支持的格式不进入转码线程", async () => {
  const bytes = Buffer.from("existing-image");
  const resolver = createCoverResolver({
    cache: { readCover: async () => ({ bytes, contentType: "image/webp" }) },
    convert: () => { throw new Error("不应转码"); },
  });
  const result = await resolver.resolve(coverUrl);
  assert.equal(result.contentType, "image/webp");
  assert.equal(result.bytes, bytes);
});

test("线程超时、异常退出后释放并发名额，后续真实封面仍可解码", async () => {
  const stalled = new URL("data:text/javascript,setInterval(() => {}, 1000)");
  const exited = new URL("data:text/javascript,process.exit(0)");
  await Promise.all([
    assert.rejects(convertWithBundledDecoder(heic, { workerUrl: stalled, timeoutMs: 150 }), /超时/),
    assert.rejects(convertWithBundledDecoder(heic, { workerUrl: exited }), /提前退出/),
    convertWithBundledDecoder(heic).then(assertThumbnail),
  ]);
  assertThumbnail(await convertWithBundledDecoder(heic));
});

test("发布用 Worker 和内置资源复制到无 node_modules 的目录后仍可解码", async (t) => {
  const dir = await makeRoot(t);
  const thirdParty = join(dir, "third-party", "libheif");
  await mkdir(thirdParty, { recursive: true });
  await copyFile(new URL("../cover-worker.cjs", import.meta.url), join(dir, "cover-worker.cjs"));
  await copyFile(new URL("../third-party/libheif/libheif-bundle.cjs", import.meta.url), join(thirdParty, "libheif-bundle.cjs"));
  assertThumbnail(await convertWithBundledDecoder(heic, { workerUrl: pathToFileURL(join(dir, "cover-worker.cjs")) }));
});
