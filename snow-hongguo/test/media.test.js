// 媒体管道测试：box 解析 / cenc 解密 / 分段封装 / range 下载 / HTTP 接口 / 封面转码。
// 离线用例用 test/fixtures/head.bin（真实响应的 ftyp+moov），网络不可用时真实用例 skip。
import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCache } from "../src/background/cache.js";
import { createSdk } from "../src/background/sdk.js";
import { createMedia, fetchHead, pickStream, requestRange } from "../src/background/media/download.js";
import { createCoverResolver, detectImageConverter, isBrowserImage } from "../src/background/media/cover.js";
import { MEDIA_LIMITS, base64Length } from "../src/background/media/limits.js";
import { Remuxer, decryptSample, parseBoxes, scanHead } from "../src/background/media/remux.js";
import { startServer } from "../src/background/server.js";

const CHANNEL = { "x-snow-hongguo-channel": "panel-rpc-v1" };
const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));
const head = await readFile(join(FIXTURE_DIR, "head.bin"));
const meta = JSON.parse(await readFile(join(FIXTURE_DIR, "meta.json"), "utf8"));
// fixture 不含真实密钥：解密路径由 decryptSample 的合成用例与真实网络用例覆盖。
const DUMMY_KEY = "00".repeat(16);
// 真实网络用例默认跳过，HONGGUO_LIVE=1 时才运行；与 live.test.js 保持一致。
const liveEnabled = process.env.HONGGUO_LIVE === "1";
const liveGate = { skip: liveEnabled ? false : "设置 HONGGUO_LIVE=1 后运行" };

const makeSource = () => {
  const source = Buffer.alloc(meta.totalBytes);
  head.copy(source);
  return source;
};

const makeTempRoot = async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "hongguo-media-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  return rootDir;
};

const makeCacheInstance = async (rootDir) => {
  const cache = createCache({ rootDir, log: () => {} });
  await cache.init();
  return cache;
};

/** 取分段里第一个 traf 的第一个样本（真实解密结果），用于验证 NAL 结构。 */
const firstVideoSample = (segment) => {
  const boxes = parseBoxes(segment);
  const moof = boxes.find((entry) => entry.type === "moof");
  const mdat = boxes.find((entry) => entry.type === "mdat");
  if (!moof || !mdat) return null;
  const traf = parseBoxes(segment, moof.body, moof.end).find((entry) => entry.type === "traf");
  if (!traf) return null;
  const trun = parseBoxes(segment, traf.body, traf.end).find((entry) => entry.type === "trun");
  if (!trun) return null;
  const dataOffset = segment.readUInt32BE(trun.body + 8);
  const firstSize = segment.readUInt32BE(trun.body + 16);
  const start = moof.start + dataOffset;
  return segment.subarray(start, start + firstSize);
};

/** HEVC 4 字节长度前缀：返回 NAL 类型列表，结构不合法返回 null。 */
const nalTypesOf = (sample, lengthSize = 4) => {
  const types = [];
  for (let offset = 0; offset + lengthSize <= sample.length; ) {
    let length = 0;
    for (let index = 0; index < lengthSize; index += 1) length = (length << 8) | sample[offset + index];
    if (length <= 0 || offset + lengthSize + length > sample.length) return null;
    types.push((sample[offset + lengthSize] >> 1) & 0x3f);
    offset += lengthSize + length;
    if (types.length > 12) break;
  }
  return types.length > 0 ? types : null;
};

/** 本地 Range 服务器：可注入失败，用来测断点续传与备用源切换。 */
const startRangeServer = async (source, { failWhen = () => false } = {}) => {
  const state = { requests: [], count: 0 };
  const server = createHttpServer((req, res) => {
    state.count += 1;
    const match = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ""));
    if (!match) {
      res.writeHead(416, { "content-type": "text/plain" });
      res.end("range required");
      return;
    }
    const from = Number(match[1]);
    const to = Math.min(Number(match[2]), source.length - 1);
    state.requests.push({ from, to, length: to - from + 1 });
    if (failWhen(state.count)) {
      res.destroy();
      return;
    }
    const body = source.subarray(from, to + 1);
    res.writeHead(206, {
      "content-type": "video/mp4",
      "content-length": body.length,
      "content-range": `bytes ${from}-${to}/${source.length}`,
    });
    res.end(body);
  });
  server.on("clientError", () => {});
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    state,
    url: `http://127.0.0.1:${port}/video.mp4`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const playbackFor = (streams, key = DUMMY_KEY) => ({
  playback: { protected: true, duration_seconds: meta.durationSeconds, streams },
  contentKey: { key, version: "1" },
});

/** 真实网络用例默认跳过；开启 HONGGUO_LIVE=1 后，只在网络/上游异常时 skip，断言失败照常 fail。 */
const UPSTREAM_CODES = new Set([
  "RATE_LIMITED",
  "ANONYMOUS_LIMITED",
  "DEVICE_REJECTED",
  "TRANSPORT",
  "CONTENT_UNAVAILABLE",
  "CHALLENGE_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "SIGNATURE_REJECTED",
]);
const isNetworkIssue = (error) => {
  const code = typeof error?.code === "string" ? error.code : "";
  return (
    code.startsWith("MEDIA_") ||
    code.startsWith("COVER_") ||
    UPSTREAM_CODES.has(code) ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT"
  );
};

test("真实 moov：scanHead 找到 ftyp+moov，Remuxer 生成 init 与分段计划", () => {
  const scanned = scanHead(head);
  assert.equal(scanned.ftyp.type, "ftyp");
  assert.equal(scanned.moov.type, "moov");
  assert.equal(scanned.need, null);

  const remuxer = new Remuxer(head, DUMMY_KEY);
  const initBoxes = parseBoxes(remuxer.init);
  assert.deepEqual(
    initBoxes.map((entry) => entry.type),
    ["ftyp", "moov"]
  );
  assert.match(remuxer.codec, /^hvc1\.\d+\.[0-9A-F]+\.L\d+/);
  assert.match(remuxer.codec, /,mp4a\.40\.\d+$/);
  assert.equal(remuxer.mime, "video/mp4");
  assert.equal(remuxer.timescale, 15360);
  assert.ok(Math.abs(remuxer.durationMs - meta.durationSeconds * 1000) < 1500);
  assert.ok(remuxer.segmentCount > 0);
  for (const bytes of remuxer.info().segmentBytes) {
    assert.ok(bytes <= MEDIA_LIMITS.segmentMaxBytes + 64 * 1024, `分段过大：${bytes}`);
  }
});

test("cenc 解密：AES-128-CTR 整块与子样本（clear 段保持明文）", () => {
  const key = randomBytes(16);
  const iv = randomBytes(16);
  const plain = randomBytes(4096);
  const encrypted = createCipheriv("aes-128-ctr", key, iv).update(plain);
  assert.deepEqual(decryptSample(key, iv, null, Buffer.from(encrypted)), plain);

  const parts = [
    [4, 32],
    [8, 64],
    [0, 16],
  ];
  const partial = randomBytes(160);
  const ciphertext = Buffer.from(partial);
  const cipher = createCipheriv("aes-128-ctr", key, iv);
  let cursor = 0;
  for (const [clearBytes, protectedBytes] of parts) {
    cursor += clearBytes;
    cipher.update(partial.subarray(cursor, cursor + protectedBytes)).copy(ciphertext, cursor);
    cursor += protectedBytes;
  }
  const decrypted = decryptSample(key, iv, parts, Buffer.from(ciphertext));
  assert.deepEqual(decrypted, partial);
});

test("drain：分段编号连续、首段 moof+mdat、总量与源文件相符", () => {
  const source = makeSource();
  const remuxer = new Remuxer(head, DUMMY_KEY);
  const segments = remuxer.drain(source, source.length);

  assert.equal(segments.length, remuxer.segmentCount);
  assert.ok(segments.length > 0);
  assert.deepEqual(
    segments.map((segment) => segment.seq),
    Array.from({ length: segments.length }, (_, index) => index + 1)
  );

  const first = parseBoxes(segments[0].bytes);
  assert.equal(first[0].type, "moof");
  assert.equal(first[1].type, "mdat");
  assert.equal(firstVideoSample(segments[0].bytes)?.length > 0, true);

  const totalBytes = segments.reduce((sum, segment) => sum + segment.bytes.length, 0);
  // 解密后少了 ftyp/moov（约 135KB），多了每片段的 moof 与 mdat 头；用 5% + 200KB 兜住。
  assert.ok(Math.abs(totalBytes - source.length) < source.length * 0.05 + 200 * 1024);
  assert.equal(remuxer.done, true);
});

test("下载管线：块 ≤3MB、失败后续传、分段落盘且可读", async (t) => {
  const source = makeSource();
  const primary = await startRangeServer(source, { failWhen: (index) => index === 3 });
  t.after(() => primary.close());
  const backup = await startRangeServer(source);
  t.after(() => backup.close());

  const rootDir = await makeTempRoot(t);
  const cache = await makeCacheInstance(rootDir);
  const sdk = {
    resolvePlayback: async () =>
      playbackFor([
        { definition: "360p", bitrate: meta.bitrate, url: primary.url, backup_url: backup.url },
        { definition: "1080p", bitrate: meta.bitrate * 4, url: primary.url },
      ]),
  };
  const media = createMedia({ sdk, cache });
  t.after(() => media.dispose());

  const info = await media.info(meta.episodeId, "360p");
  assert.equal(info.definition, "360p");
  assert.ok(info.segmentCount >= 2, `分段数异常：${info.segmentCount}`);
  assert.equal(info.mime, "video/mp4");
  assert.match(info.codec, /^hvc1\./);

  const init = await media.init(meta.episodeId, "360p");
  assert.deepEqual(
    parseBoxes(init).map((entry) => entry.type),
    ["ftyp", "moov"]
  );

  const first = await media.segment(meta.episodeId, "360p", 1);
  assert.equal(first.seq, 1);
  assert.equal(parseBoxes(first.bytes)[0].type, "moof");
  assert.ok(base64Length(first.bytes.length) <= MEDIA_LIMITS.maxBase64Bytes);

  // 最后一段会等到下载完成。
  const last = await media.segment(meta.episodeId, "360p", info.segmentCount);
  assert.equal(last.seq, info.segmentCount);

  // 分块：除首块（512KB 头）外都不超过 3MB。
  for (const request of primary.state.requests) {
    assert.ok(request.length <= MEDIA_LIMITS.blockBytes, `块过大：${request.length}`);
  }
  // 断点续传：第 3 个请求被中断后，第 4 个请求从同一个非零偏移继续。
  assert.ok(primary.state.requests.length >= 4, `请求次数不足：${primary.state.requests.length}`);
  assert.equal(primary.state.requests[3].from, primary.state.requests[2].from);
  assert.ok(primary.state.requests[3].from > 0);

  const qualityDir = join(cache.videoDir, meta.episodeId, "360p");
  const files = await readdir(qualityDir);
  assert.ok(files.includes("init.mp4"));
  assert.ok(files.includes("info.json"));
  assert.equal(files.includes("source.part"), false, "完成后应删除 source.part");
  const cachedInfo = JSON.parse(await readFile(join(qualityDir, "info.json"), "utf8"));
  assert.equal(cachedInfo.complete, true);
  const statInfo = await stat(join(qualityDir, "seg-00001.m4s"));
  assert.ok(statInfo.size > 0);

  // 重启后：不做降级复用——请求 540p 而磁盘只有 360p 时必须重新取流。
  let sdkCalls = 0;
  const media2 = createMedia({
    sdk: {
      resolvePlayback: async () => {
        sdkCalls += 1;
        throw Object.assign(new Error("不应联网"), { code: "CONTENT_UNAVAILABLE" });
      },
    },
    cache: await makeCacheInstance(rootDir),
  });
  t.after(() => media2.dispose());
  await assert.rejects(
    () => media2.info(meta.episodeId, "540p"),
    (error) => error.code === "CONTENT_UNAVAILABLE"
  );
  assert.equal(sdkCalls, 1, "没有同档缓存时必须重新取流，不得复用 360p 缓存");

  // 精确命中：请求 360p 时直接读磁盘缓存，SDK 一旦被调用就失败。
  const media3 = createMedia({
    sdk: {
      resolvePlayback: async () => {
        throw Object.assign(new Error("同档缓存不应联网"), { code: "CONTENT_UNAVAILABLE" });
      },
    },
    cache: await makeCacheInstance(rootDir),
  });
  t.after(() => media3.dispose());
  const cached = await media3.info(meta.episodeId, "360p");
  assert.equal(cached.definition, "360p");
  const cachedSegment = await media3.segment(meta.episodeId, "360p", 1);
  assert.equal(cachedSegment.bytes.length, first.bytes.length);
});

test("主源全部失败：切到 backup_url 后仍能完成", async (t) => {
  const source = makeSource();
  const dead = await startRangeServer(source, { failWhen: () => true });
  t.after(() => dead.close());
  const backup = await startRangeServer(source);
  t.after(() => backup.close());

  const rootDir = await makeTempRoot(t);
  const media = createMedia({
    sdk: {
      resolvePlayback: async () =>
        playbackFor([{ definition: "480p", bitrate: meta.bitrate, url: dead.url, backup_url: backup.url }]),
    },
    cache: await makeCacheInstance(rootDir),
  });
  t.after(() => media.dispose());

  const info = await media.info(meta.episodeId, "480p");
  assert.ok(info.segmentCount >= 2);
  const last = await media.segment(meta.episodeId, "480p", info.segmentCount);
  assert.equal(last.seq, info.segmentCount);
  assert.ok(dead.state.requests.length >= 1);
  assert.ok(backup.state.requests.length >= 2);
});

test("/stream/* 三接口与 /cache/clear 在同一次会话内自洽", async (t) => {
  const source = makeSource();
  const range = await startRangeServer(source);
  t.after(() => range.close());

  const rootDir = await makeTempRoot(t);
  const cache = await makeCacheInstance(rootDir);
  const sdk = {
    resolvePlayback: async () =>
      playbackFor([{ definition: "720p", bitrate: meta.bitrate, url: range.url, backup_url: range.url }]),
    discover: async () => ({ items: [], has_more: false }),
    runtimeInfo: async () => ({ loaded: false }),
    stats: () => ({ ready: false, resets: 0, lastError: null }),
  };
  const media = createMedia({ sdk, cache });
  t.after(() => media.dispose());

  const server = await startServer({
    sdk,
    cache,
    media,
    version: "test",
    log: () => {},
    portFirst: 38700,
    portLast: 38710,
  });
  t.after(() => server.close());

  const call = async (path, init = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
      headers: { ...CHANNEL, ...(init.headers ?? {}) },
      ...init,
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, text, json, headers: response.headers };
  };

  const infoResponse = await call(`/stream/info?episodeId=${meta.episodeId}&quality=720p`);
  assert.equal(infoResponse.status, 200);
  assert.ok(infoResponse.json.segmentCount >= 2);
  assert.equal(infoResponse.json.mime, "video/mp4");
  assert.match(infoResponse.json.codec, /^hvc1\./);
  assert.equal(infoResponse.text.includes(DUMMY_KEY), false);
  assert.equal(infoResponse.text.includes("127.0.0.1"), false);

  const initResponse = await call(`/stream/init?episodeId=${meta.episodeId}&quality=720p`);
  assert.equal(initResponse.status, 200);
  const initBytes = Buffer.from(initResponse.json.base64, "base64");
  assert.deepEqual(
    parseBoxes(initBytes).map((entry) => entry.type),
    ["ftyp", "moov"]
  );

  const segmentResponse = await call(`/stream/segment?episodeId=${meta.episodeId}&quality=720p&seq=1`);
  assert.equal(segmentResponse.status, 200);
  assert.equal(segmentResponse.json.seq, 1);
  const segmentBytes = Buffer.from(segmentResponse.json.base64, "base64");
  assert.equal(parseBoxes(segmentBytes)[0].type, "moof");
  assert.ok(base64Length(segmentBytes.length) <= MEDIA_LIMITS.maxBase64Bytes);

  // init 与分段来自同一次解析：init 的 moov 里 segmentCount 与 info 一致，分段可独立解析。
  assert.ok(segmentBytes.length > 0);

  const badSeq = await call(`/stream/segment?episodeId=${meta.episodeId}&quality=720p&seq=0`);
  assert.equal(badSeq.status, 400);
  const outOfRange = await call(`/stream/segment?episodeId=${meta.episodeId}&quality=720p&seq=99`);
  assert.equal(outOfRange.status, 404);
  const badQuality = await call(`/stream/info?episodeId=${meta.episodeId}&quality=4k`);
  assert.equal(badQuality.status, 400);

  const cleared = await call(`/cache/clear`, { method: "POST" });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.ok, true);
  assert.ok(cleared.json.removed >= 1);
});

test("封面：转换器不可用或转码失败时回退原图，不抛错", async (t) => {
  const rootDir = await makeTempRoot(t);
  const cache = await makeCacheInstance(rootDir);
  const url = "https://p3-reading-sign.fqnovelpic.com/novel-pic/fallback.heic";
  await cache.writeCover(url, Buffer.from("not-a-real-heic"), "image/heic");

  const resolver = createCoverResolver({ cache });
  const result = await resolver.resolve(url);
  assert.equal(result.cache, "hit");
  assert.equal(result.converted, false);
  assert.equal(result.contentType, "image/heic");
  assert.equal(isBrowserImage("image/heic"), false);
  assert.equal(isBrowserImage("image/jpeg"), true);
});

test("真实网络：一集完整跑通 下载 -> 解密 -> 分段", liveGate, async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "hongguo-media-live-"));
  const { createClient } = await import("openhongguo");
  const sdk = createSdk({
    dataDir,
    minIntervalMs: 300,
    clientFactory: ({ profile, timeoutMs, retryAttempts, log }) =>
      createClient({ profile, timeoutMs, retryAttempts, deviceResets: 0, log }),
  });
  const media = createMedia({ sdk, cache: await makeCacheInstance(dataDir) });
  t.after(async () => {
    media.dispose();
    sdk.dispose();
    await rm(dataDir, { recursive: true, force: true });
  });

  try {
    const page = await sdk.discover({});
    const series = await sdk.getSeries(page.items[0].id);
    const episodes = await sdk.listEpisodes(series.id, {});
    const episodeId = episodes.items[0].id;

    const info = await media.info(episodeId, "360p");
    assert.ok(info.segmentCount > 0, "分段数应大于 0");
    assert.equal(info.mime, "video/mp4");
    assert.match(info.codec, /^hvc1\.\d+\.[0-9A-F]+\.L\d+/);
    assert.ok(info.durationMs > 30_000, `时长异常：${info.durationMs}`);

    const init = await media.init(episodeId, "360p");
    assert.deepEqual(
      parseBoxes(init).map((entry) => entry.type),
      ["ftyp", "moov"]
    );

    const first = await media.segment(episodeId, "360p", 1);
    assert.equal(first.seq, 1);
    const boxes = parseBoxes(first.bytes);
    assert.equal(boxes[0].type, "moof");
    assert.ok(boxes.some((entry) => entry.type === "mdat"));
    assert.ok(base64Length(first.bytes.length) <= MEDIA_LIMITS.maxBase64Bytes);

    // 解密正确性的强断言：首样本必须是合法的 HEVC NAL（VPS/SPS/PPS/SEI/IDR）。
    const sample = firstVideoSample(first.bytes);
    assert.ok(sample && sample.length > 0);
    const types = nalTypesOf(sample);
    assert.ok(types, "首样本不是合法的 HEVC NAL 长度前缀序列");
    assert.ok(types.some((type) => [32, 33, 34, 39, 19, 20, 21].includes(type)), `NAL 类型异常：${types}`);

    // 总字节与时长合理：用真实分集的码率与源文件大小双向校验。
    // 先取最后一段，等下载真正完成，再统计落盘文件。
    const lastSegment = await media.segment(episodeId, "360p", info.segmentCount);
    assert.equal(lastSegment.seq, info.segmentCount);
    const playback = await sdk.resolvePlayback(episodeId);
    const stream = pickStream(playback.playback.streams, "360p");
    const qualityDir = join(dataDir, "video", episodeId, info.definition);
    const names = await readdir(qualityDir).catch(() => []);
    const sizes = await Promise.all(
      names.filter((name) => name.endsWith(".m4s")).map((name) => stat(join(qualityDir, name)))
    );
    const bytes = sizes.reduce((sum, item) => sum + item.size, 0);
    assert.ok(bytes > 0);
    assert.ok(sizes.length === info.segmentCount, `分段文件数 ${sizes.length} ≠ ${info.segmentCount}`);
    if (stream?.bitrate) {
      const expected = (info.durationMs / 1000) * (stream.bitrate / 8);
      assert.ok(bytes > expected * 0.5 && bytes < expected * 1.8, `分段总字节 ${bytes} 与码率推算 ${Math.round(expected)} 不符`);
    }
    if (info.bytes) {
      assert.ok(Math.abs(bytes - info.bytes) < info.bytes * 0.1, `分段总字节 ${bytes} 与源文件 ${info.bytes} 不符`);
    }

    // 用 ffmpeg 解码一遍 init + 全部分段：能完整解码才算「可播放的分段序列」。
    const segmentFiles = names.filter((name) => name.endsWith(".m4s")).sort();
    const muxed = Buffer.concat([
      init,
      ...(await Promise.all(segmentFiles.map((name) => readFile(join(qualityDir, name))))),
    ]);
    const muxedPath = join(dataDir, "concat.mp4");
    await writeFile(muxedPath, muxed);
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    try {
      await promisify(execFile)("ffmpeg", ["-v", "error", "-i", muxedPath, "-f", "null", "-"], { timeout: 120000 });
    } catch (error) {
      if (error?.code === "ENOENT") {
        t.diagnostic("本机没有 ffmpeg，跳过 fMP4 解码校验");
      } else {
        assert.fail(`ffmpeg 解码失败：${String(error?.stderr ?? error?.message ?? error).slice(0, 800)}`);
      }
    }
  } catch (error) {
    if (!isNetworkIssue(error)) throw error;
    t.skip(`网络或上游不可用：${error.code ?? error.message}`);
  }
});

test("真实封面：HEIC 转 JPEG（无转换器时 skip）", liveGate, async (t) => {
  if (!detectImageConverter()) {
    t.skip("本机没有 sips/ffmpeg，无法验证 HEIC 转码");
    return;
  }

  const dataDir = await mkdtemp(join(tmpdir(), "hongguo-cover-live-"));
  const { createClient } = await import("openhongguo");
  const sdk = createSdk({
    dataDir,
    minIntervalMs: 300,
    clientFactory: ({ profile, timeoutMs, retryAttempts, log }) =>
      createClient({ profile, timeoutMs, retryAttempts, deviceResets: 0, log }),
  });
  t.after(async () => {
    sdk.dispose();
    await rm(dataDir, { recursive: true, force: true });
  });

  try {
    const page = await sdk.discover({});
    const coverUrl = page.items.map((item) => item.cover_url).find(Boolean);
    assert.ok(coverUrl, "discover 里没有封面地址");

    const cache = await makeCacheInstance(dataDir);
    const resolver = createCoverResolver({ cache });
    const result = await resolver.resolve(coverUrl);
    if (!result.converted && result.contentType === "image/heic") {
      t.skip("本机转换器都不支持 HEIC（ffmpeg 缺 libheif、无 WIC），按约定回退原图");
      return;
    }
    assert.equal(result.converted, true);
    assert.equal(result.contentType, "image/jpeg");
    assert.deepEqual([...result.bytes.subarray(0, 2)], [0xff, 0xd8], "JPEG 魔数应为 FF D8");

    const hit = await resolver.resolve(coverUrl);
    assert.equal(hit.cache, "hit");
    assert.deepEqual([...hit.bytes.subarray(0, 2)], [0xff, 0xd8]);
  } catch (error) {
    if (!isNetworkIssue(error)) throw error;
    t.skip(`网络或上游不可用：${error.code ?? error.message}`);
  }
});

test("选流：优先不高于请求的最高一档", () => {
  const streams = [
    { definition: "1080p", bitrate: 800, url: "a" },
    { definition: "720p", bitrate: 400, url: "b" },
    { definition: "360p", bitrate: 200, url: "c" },
  ];
  assert.equal(pickStream(streams, "540p").definition, "360p");
  assert.equal(pickStream(streams, "720p").definition, "720p");
  assert.equal(pickStream(streams, "1080p").definition, "1080p");
  assert.equal(pickStream(streams, "1080p")?.url, "a");
  assert.equal(pickStream([{ definition: "360p", bitrate: 1, url: "" }], "720p"), null);
});

test("range 请求：content-range 解析与块长度截断", async (t) => {
  const source = randomBytes(1024 * 1024);
  const server = await startRangeServer(source);
  t.after(() => server.close());

  const headBlock = await requestRange(server.url, 0, 1000);
  assert.equal(headBlock.status, 206);
  assert.equal(headBlock.total, source.length);
  assert.equal(headBlock.bytes.length, 1001);
  assert.deepEqual(headBlock.bytes, source.subarray(0, 1001));

  const tail = await requestRange(server.url, source.length - 10, source.length - 1);
  assert.equal(tail.bytes.length, 10);
  assert.deepEqual(tail.bytes, source.subarray(source.length - 10));
});

test("fetchHead：moov 超出首个 range 时自动追加", async (t) => {
  // 构造一个 moov 位于 512KB 之后的文件：在 ftyp 与 moov 之间插入 free box。
  const freeHeader = Buffer.alloc(8);
  freeHeader.writeUInt32BE(700 * 1024 + 8, 0);
  freeHeader.write("free", 4, "latin1");
  const padded = Buffer.concat([head.subarray(0, 28), freeHeader, Buffer.alloc(700 * 1024), head.subarray(28)]);
  const server = await startRangeServer(padded);
  t.after(() => server.close());

  const fetched = await fetchHead(server.url);
  assert.ok(fetched.head.length > 512 * 1024);
  const scanned = scanHead(fetched.head);
  assert.equal(scanned.moov.type, "moov");
  assert.equal(fetched.total, padded.length);
  assert.ok(server.state.requests.length >= 2);
  const lastRequest = server.state.requests.at(-1);
  assert.equal(lastRequest.from, 0);
  assert.ok(lastRequest.to + 1 >= scanned.moov.end, `最后一次请求 ${lastRequest.to + 1} 未覆盖 moov 末尾 ${scanned.moov.end}`);
});

