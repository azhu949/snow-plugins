import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCache } from "../src/background/cache.js";
import { LIMITS } from "../src/shared/contract.js";

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const makeRoot = async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "hongguo-cache-"));
  await mkdir(join(rootDir, "video"), { recursive: true });
  await mkdir(join(rootDir, "covers"), { recursive: true });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  return rootDir;
};

test("启动清理 *.part", async (t) => {
  const rootDir = await makeRoot(t);
  const parts = [
    join(rootDir, "root.part"),
    join(rootDir, "video", "episode.mp4.part"),
    join(rootDir, "covers", "cover.jpg.part"),
  ];
  for (const path of parts) await writeFile(path, "x");
  await writeFile(join(rootDir, "anonymous.json"), "{}");

  const cache = createCache({ rootDir, log: () => {} });
  const info = await cache.init();

  assert.equal(info.partials, 3);
  for (const path of parts) assert.equal(await exists(path), false);
  assert.equal(await exists(join(rootDir, "anonymous.json")), true);
});

test("prune 保留最近 6 集视频与 300 张封面", async (t) => {
  const rootDir = await makeRoot(t);
  const cache = createCache({ rootDir, log: () => {} });
  await cache.init();

  for (let index = 0; index < 10; index += 1) {
    const path = join(cache.videoDir, `ep-${index}.mp4`);
    await writeFile(path, "x");
    const time = new Date(Date.UTC(2024, 0, 1, 0, 0, index));
    await utimes(path, time, time);
  }
  for (let index = 0; index < 320; index += 1) {
    const path = join(cache.coversDir, `cover-${String(index).padStart(3, "0")}.jpg`);
    await writeFile(path, "x");
    const time = new Date(Date.UTC(2024, 0, 2, 0, 0, 0) + index * 1000);
    await utimes(path, time, time);
  }

  const result = await cache.prune();

  assert.equal(result.videos.removed, 4);
  assert.equal(result.covers.removed, 20);
  assert.deepEqual((await readdir(cache.videoDir)).sort(), [
    "ep-4.mp4",
    "ep-5.mp4",
    "ep-6.mp4",
    "ep-7.mp4",
    "ep-8.mp4",
    "ep-9.mp4",
  ]);
  assert.equal((await readdir(cache.coversDir)).length, LIMITS.coverKeep);
});

test("prune 不删除使用中的视频", async (t) => {
  const rootDir = await makeRoot(t);
  const cache = createCache({ rootDir, log: () => {} });
  await cache.init();

  for (let index = 0; index < 8; index += 1) {
    const path = join(cache.videoDir, `ep-${index}.mp4`);
    await writeFile(path, "x");
    const time = new Date(Date.UTC(2024, 0, 1, 0, 0, index));
    await utimes(path, time, time);
  }
  const held = join(cache.videoDir, "ep-0.mp4");
  cache.markInUse(held);

  const result = await cache.prune();

  assert.equal(result.videos.removed, 1);
  assert.equal(await exists(held), true);
  assert.equal((await readdir(cache.videoDir)).length, 7);
});

test("clear 保留使用中的路径", async (t) => {
  const rootDir = await makeRoot(t);
  const cache = createCache({ rootDir, log: () => {} });
  await cache.init();

  const keep = join(cache.videoDir, "keep.mp4");
  const drop = join(cache.videoDir, "drop.mp4");
  const cover = join(cache.coversDir, "drop.jpg");
  await writeFile(keep, "x");
  await writeFile(drop, "x");
  await writeFile(cover, "x");
  cache.markInUse(keep);

  const result = await cache.clear();

  assert.equal(result.kept, 1);
  assert.equal(await exists(keep), true);
  assert.equal(await exists(drop), false);
  assert.equal(await exists(cover), false);
  cache.release(keep);
});

test("封面缓存忽略签名查询串，且拒绝超大或非图片响应", async (t) => {
  const rootDir = await makeRoot(t);
  const cache = createCache({ rootDir, log: () => {} });
  await cache.init();

  const first = "https://p3-reading-sign.fqnovelpic.com/novel-pic/a.jpg?x-expires=1&x-signature=aaa";
  const second = "https://p3-reading-sign.fqnovelpic.com/novel-pic/a.jpg?x-expires=2&x-signature=bbb";

  const written = await cache.writeCover(first, Buffer.from("image-bytes"), "image/jpeg");
  assert.ok(written && written.path.endsWith(".jpg"));

  const hit = await cache.readCover(second);
  assert.equal(hit.contentType, "image/jpeg");
  assert.equal(hit.bytes.toString(), "image-bytes");

  const tooLarge = await cache.writeCover(first, Buffer.alloc(LIMITS.coverMaxBytes + 1), "image/jpeg");
  assert.equal(tooLarge, null);

  const notImage = await cache.writeCover(first, Buffer.from("x"), "text/plain");
  assert.equal(notImage, null);

  const heic = await cache.writeCover(
    "https://p3-reading-sign.fqnovelpic.com/novel-pic/b.heic?x-expires=3",
    Buffer.from("heic-bytes"),
    "image/heic"
  );
  assert.ok(heic && heic.path.endsWith(".heic"));
  const heicHit = await cache.readCover("https://p3-reading-sign.fqnovelpic.com/novel-pic/b.heic?x-expires=4");
  assert.equal(heicHit.contentType, "image/heic");
});
