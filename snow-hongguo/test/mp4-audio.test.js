import test from "node:test";
import assert from "node:assert/strict";
import { box, fullBox, u32, aacCodecString } from "../src/background/media/remux.js";
import { parseMp4 } from "../src/panel/player/mp4.js";

// 仅保留音轨配置元数据，无音视频样本、播放地址或密钥。
const AAC_LC = Buffer.from("000000000380808022000200048080801440150000000000fae00000fa9e05808080021210068080800102", "hex");
const HE_AAC_V2 = Buffer.from("000000000380808024000200048080801640150000000000fb620000fa3f0580808004eb8a0800068080800102", "hex");
const audioInit = (esds) => {
  const tkhd = Buffer.alloc(20), mdhd = Buffer.alloc(20), hdlr = Buffer.alloc(20), entry = Buffer.alloc(28);
  tkhd.writeUInt32BE(2, 12);
  mdhd.writeUInt32BE(44100, 12);
  hdlr.write("soun", 8);
  entry.writeUInt16BE(2, 16);
  entry.writeUInt16BE(44100, 24);
  const stsd = fullBox("stsd", 0, 0, u32(1), box("mp4a", entry, box("esds", esds)));
  const mdia = box("mdia", box("mdhd", mdhd), box("hdlr", hdlr), box("minf", box("stbl", stsd)));
  return box("moov", box("trak", box("tkhd", tkhd), mdia));
};

test("真实 AAC-LC / HE-AAC v2 配置：前后台识别一致，WebCodecs description 只包含 ASC", () => {
  for (const [esds, codec, asc] of [[AAC_LC, "mp4a.40.2", "1210"], [HE_AAC_V2, "mp4a.40.29", "eb8a0800"]]) {
    const { audio } = parseMp4(audioInit(esds));
    assert.equal(audio.codec, codec);
    assert.equal(aacCodecString("mp4a", esds), codec);
    assert.equal(Buffer.from(audio.description).toString("hex"), asc, "不能把整个 esds 当作解码配置");
    assert.equal(audio.sampleRate, 44100);
    assert.equal(audio.channels, 2);
  }
});
