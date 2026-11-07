// 媒体容器层：MP4 box 解析 + cenc-aes-ctr 解密 + 转分段 MP4（fMP4），纯 Node，不依赖 ffmpeg。
//
// 逻辑参考 J3n5en/enso-hongguo（Apache-2.0）：
//   https://github.com/J3n5en/enso-plugins/tree/main/packages/enso.hongguo
//   原文件 remux.mjs（Progressive MP4 (cenc-aes-ctr) -> decrypted fragmented MP4 for MSE）。
// 本文件在其基础上改写为 Snow App 插件产物：
//   1) 纯 ESM 导出，去掉 Enso 渲染层依赖；
//   2) moov 可能超出首个 range：新增 scanHead()，下载层据此按需追加；
//   3) 分段按 GOP 与播放时长聚合、限制字节数，segmentCount 在解析 moov 后即可确定；
//   4) 增加 codec 字符串（hvc1 / avc1 / mp4a）与 durationMs，供面板拼 MSE 类型；
//   5) 加密信息缺失时抛类型化错误，不再静默返回未解密样本。
import { createDecipheriv } from "node:crypto";
import { LIMITS } from "../../shared/contract.js";
import { parseEsds } from "../../shared/aac.js";

/** 单次随机读允许覆盖的区间上限：超过它说明样本在文件里零散分布，退回逐样本读取。 */
const MAX_RANDOM_READ_BYTES = 8 * 1024 * 1024;

/** 解析一段缓冲区里的同级 box；越界或损坏时只返回已完整的部分。 */
export function parseBoxes(buf, start = 0, end = buf.length) {
  const out = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(buf.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    out.push({
      type: buf.toString("latin1", offset + 4, offset + 8),
      start: offset,
      body: offset + header,
      end: offset + size,
    });
    offset += size;
  }
  return out;
}

export const u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
};

export const box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, "latin1"), body]);
};

export const fullBox = (type, version, flags, ...parts) =>
  box(type, u32(((version << 24) | flags) >>> 0), ...parts);

/**
 * 扫描文件头部的顶层 box，返回完整 moov 的位置；moov 还没到齐时给出还需要的字节数。
 * @returns {{ boxes: Array, ftyp: object|null, moov: object|null, need: number|null }}
 */
export function scanHead(buf) {
  const boxes = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    let size = buf.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > buf.length) return { boxes, ftyp: null, moov: null, need: offset + 16 };
      size = Number(buf.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      // 盒子声明延伸到文件末尾：头部扫描无法判断边界，只能认为不够。
      return { boxes, ftyp: null, moov: null, need: offset + 8 };
    }
    if (size < header) throw new Error("MP4 结构损坏：box 尺寸小于头部");
    const end = offset + size;
    if (end > buf.length) return { boxes, ftyp: null, moov: null, need: end };
    const entry = {
      type: buf.toString("latin1", offset + 4, offset + 8),
      start: offset,
      body: offset + header,
      end,
    };
    boxes.push(entry);
    if (entry.type === "moov") {
      return { boxes, ftyp: boxes.find((item) => item.type === "ftyp") ?? null, moov: entry, need: null };
    }
    offset = end;
  }
  return { boxes, ftyp: null, moov: null, need: offset + 8 };
}

/**
 * RFC 6381 要求把 general_profile_compatibility_flags 按位反转后写成十六进制：
 * 0x60000000（Main Profile）反转后是 0x6，于是 codec 字符串是 hvc1.1.6.…。
 */
const reverseBits32 = (value) => {
  let bits = value >>> 0;
  bits = ((bits & 0x55555555) << 1) | ((bits >>> 1) & 0x55555555);
  bits = ((bits & 0x33333333) << 2) | ((bits >>> 2) & 0x33333333);
  bits = ((bits & 0x0f0f0f0f) << 4) | ((bits >>> 4) & 0x0f0f0f0f);
  bits = ((bits & 0x00ff00ff) << 8) | ((bits >>> 8) & 0x00ff00ff);
  return ((bits << 16) | (bits >>> 16)) >>> 0;
};

/**
 * RFC 6381 的 HEVC codec 字符串，例如 hvc1.1.6.L93。
 * hvcC 布局：configVersion(1) profile_space/tier/idc(1) compat(4) constraint(6) level(1)…
 */
export function hevcCodecString(sampleEntryType, hvcC) {
  if (!hvcC || hvcC.length < 13) return sampleEntryType;
  const byte = hvcC[1];
  const profileSpace = (byte >> 6) & 3;
  const tierFlag = (byte >> 5) & 1;
  const profileIdc = byte & 0x1f;
  const compatibility = reverseBits32(hvcC.readUInt32BE(2));
  const level = hvcC[12];
  const space = profileSpace === 0 ? "" : "ABC"[profileSpace - 1] ?? "";
  let text = `${sampleEntryType}.${space}${profileIdc}.${compatibility.toString(16).toUpperCase()}.${tierFlag ? "H" : "L"}${level}`;
  // 约束字节按规范去掉尾部的 0，全 0 时不出现在 codec 字符串里。
  let last = 6;
  while (last > 0 && hvcC[6 + last - 1] === 0) last -= 1;
  for (let index = 0; index < last; index += 1) {
    text += `.${hvcC[6 + index].toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return text;
}

/** avcC: configurationVersion(1) profile(1) compat(1) level(1)。 */
export function avcCodecString(sampleEntryType, avcC) {
  if (!avcC || avcC.length < 4) return sampleEntryType;
  const hex = (value) => value.toString(16).toUpperCase().padStart(2, "0");
  return `${sampleEntryType}.${hex(avcC[1])}${hex(avcC[2])}${hex(avcC[3])}`;
}

/** esds 里取 AudioSpecificConfig 的 audioObjectType，拼成 mp4a.40.2 之类的字符串。 */
export function aacCodecString(sampleEntryType, esds) {
  try {
    return parseEsds(esds, sampleEntryType).codec;
  } catch {
    return `${sampleEntryType}.40.2`;
  }
}

const parseTenc = (moov, tenc) => {
  const body = tenc.body;
  const protectedFlag = moov[body + 6];
  if (protectedFlag !== 1) return null;
  const ivSize = moov[body + 7];
  const kid = moov.subarray(body + 8, body + 24);
  let constantIv = null;
  if (ivSize === 0) {
    const constantSize = moov[body + 24];
    if (constantSize > 0) constantIv = moov.subarray(body + 25, body + 25 + constantSize);
  }
  return { ivSize, kid, constantIv };
};

const readSampleIv = (moov, offset, ivSize, constantIv) => {
  const iv = Buffer.alloc(16);
  if (ivSize === 0) {
    if (constantIv) constantIv.copy(iv);
    return iv;
  }
  moov.copy(iv, 0, offset, offset + Math.min(ivSize, 16));
  return iv;
};

function parseTrack(moov, trak, key) {
  const kids = (item) => parseBoxes(moov, item.body, item.end);
  const get = (item, ...path) => {
    let current = item;
    for (const type of path) {
      current = kids(current).find((entry) => entry.type === type);
      if (!current) return null;
    }
    return current;
  };

  const tkhd = get(trak, "tkhd");
  const mdia = get(trak, "mdia");
  if (!tkhd || !mdia) return null;
  const minf = get(mdia, "minf");
  const stbl = minf ? get(minf, "stbl") : null;
  if (!stbl) return null;

  const trackId = moov.readUInt32BE(tkhd.body + (moov[tkhd.body] === 1 ? 20 : 12));
  const mdhd = get(mdia, "mdhd");
  const timescale = moov.readUInt32BE(mdhd.body + (moov[mdhd.body] === 1 ? 20 : 12));
  const hdlr = get(mdia, "hdlr");
  const handler = moov.toString("latin1", hdlr.body + 8, hdlr.body + 12);
  if (handler !== "vide" && handler !== "soun") return null;

  const table = (type) => {
    const entry = get(stbl, type);
    if (!entry) return null;
    const count = moov.readUInt32BE(entry.body + 4);
    return { entry, count, at: (index, width) => entry.body + 8 + index * width };
  };

  const stsz = get(stbl, "stsz");
  if (!stsz) return null;
  const fixedSize = moov.readUInt32BE(stsz.body + 4);
  const count = moov.readUInt32BE(stsz.body + 8);
  const sizes = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    sizes[index] = fixedSize || moov.readUInt32BE(stsz.body + 12 + index * 4);
  }

  const durations = new Uint32Array(count);
  const stts = table("stts");
  if (stts) {
    for (let index = 0, sample = 0; index < stts.count; index += 1) {
      const runs = moov.readUInt32BE(stts.at(index, 8));
      const delta = moov.readUInt32BE(stts.at(index, 8) + 4);
      for (let run = 0; run < runs && sample < count; run += 1) durations[sample++] = delta;
    }
  }
  // stts 没覆盖到的尾部样本按最后一档时长补齐，避免时间轴停在 0。
  let lastDelta = 0;
  for (let index = 0; index < count; index += 1) if (durations[index]) lastDelta = durations[index];
  for (let index = 0; index < count; index += 1) if (!durations[index]) durations[index] = lastDelta || 1;

  const ctts = table("ctts");
  const compositionOffsets = ctts ? new Int32Array(count) : null;
  if (ctts) {
    for (let index = 0, sample = 0; index < ctts.count; index += 1) {
      const runs = moov.readUInt32BE(ctts.at(index, 8));
      const delta = moov.readInt32BE(ctts.at(index, 8) + 4);
      for (let run = 0; run < runs && sample < count; run += 1) compositionOffsets[sample++] = delta;
    }
  }

  const stss = table("stss");
  const sync = stss ? new Uint8Array(count) : null;
  if (stss) {
    for (let index = 0; index < stss.count; index += 1) {
      const sample = moov.readUInt32BE(stss.at(index, 4)) - 1;
      if (sample >= 0 && sample < count) sync[sample] = 1;
    }
  }

  const chunkOffset = table("stco") ?? table("co64");
  if (!chunkOffset) return null;
  const wide = chunkOffset.entry.type === "co64";
  const chunkAt = (index) =>
    wide ? Number(moov.readBigUInt64BE(chunkOffset.at(index, 8))) : moov.readUInt32BE(chunkOffset.at(index, 4));
  const stsc = table("stsc");
  const offsets = new Float64Array(count);
  if (stsc) {
    for (let entry = 0, sample = 0; entry < stsc.count; entry += 1) {
      const firstChunk = moov.readUInt32BE(stsc.at(entry, 12)) - 1;
      const perChunk = moov.readUInt32BE(stsc.at(entry, 12) + 4);
      const nextFirst = entry + 1 < stsc.count ? moov.readUInt32BE(stsc.at(entry + 1, 12)) - 1 : chunkOffset.count;
      for (let chunk = firstChunk; chunk < nextFirst; chunk += 1) {
        let offset = chunkAt(chunk);
        for (let index = 0; index < perChunk && sample < count; index += 1) {
          offsets[sample] = offset;
          offset += sizes[sample];
          sample += 1;
        }
      }
    }
  }

  // 样本描述：把 encv/enca 还原成真实编码（frma），并丢掉 sinf。
  const stsd = get(stbl, "stsd");
  if (!stsd) return null;
  const entry = parseBoxes(moov, stsd.body + 8, stsd.end)[0];
  if (!entry) return null;
  const fixedLength = handler === "vide" ? 78 : 28;
  const inner = parseBoxes(moov, entry.body + fixedLength, entry.end);
  const sinf = inner.find((item) => item.type === "sinf");
  let format = entry.type;
  let encrypted = false;
  let ivs = null;
  let tencInfo = null;

  if (sinf) {
    encrypted = true;
    const sinfKids = parseBoxes(moov, sinf.body, sinf.end);
    const frma = sinfKids.find((item) => item.type === "frma");
    if (!frma) throw new Error("加密样本缺少 frma");
    format = moov.toString("latin1", frma.body, frma.body + 4);
    const schm = sinfKids.find((item) => item.type === "schm");
    const scheme = schm ? moov.toString("latin1", schm.body + 4, schm.body + 8) : "cenc";
    if (scheme !== "cenc") throw new Error(`不支持的加密方式 ${scheme}`);
    const schi = sinfKids.find((item) => item.type === "schi");
    const tenc = schi ? parseBoxes(moov, schi.body, schi.end).find((item) => item.type === "tenc") : null;
    if (!tenc) throw new Error("加密样本缺少 tenc");
    tencInfo = parseTenc(moov, tenc, count);
    if (!tencInfo) throw new Error("内容未按 cenc 加密");
    if (!key) throw new Error("缺少内容密钥");
    const senc = get(stbl, "senc");
    if (!senc) throw new Error("加密样本缺少 senc");
    const subsampleFlag = (moov.readUInt32BE(senc.body) & 2) !== 0;
    const ivCount = moov.readUInt32BE(senc.body + 4);
    ivs = new Array(ivCount);
    let cursor = senc.body + 8;
    for (let index = 0; index < ivCount; index += 1) {
      const iv = readSampleIv(moov, cursor, tencInfo.ivSize, tencInfo.constantIv);
      cursor += tencInfo.ivSize;
      let parts = null;
      if (subsampleFlag) {
        const subsampleCount = moov.readUInt16BE(cursor);
        cursor += 2;
        parts = [];
        for (let part = 0; part < subsampleCount; part += 1) {
          parts.push([moov.readUInt16BE(cursor), moov.readUInt32BE(cursor + 2)]);
          cursor += 6;
        }
      }
      ivs[index] = { iv, parts };
    }
  }

  const sampleEntry = box(
    format,
    moov.subarray(entry.body, entry.body + fixedLength),
    ...inner.filter((item) => item.type !== "sinf").map((item) => moov.subarray(item.start, item.end))
  );
  const stsdBox = fullBox("stsd", 0, 0, u32(1), sampleEntry);
  const emptyTables = [
    fullBox("stts", 0, 0, u32(0)),
    fullBox("stsc", 0, 0, u32(0)),
    fullBox("stsz", 0, 0, u32(0), u32(0)),
    fullBox("stco", 0, 0, u32(0)),
  ];
  const raw = (item) => moov.subarray(item.start, item.end);
  const trakBox = box(
    "trak",
    ...kids(trak)
      .filter((item) => item.type !== "mdia")
      .map(raw),
    box(
      "mdia",
      ...kids(mdia).map((item) =>
        item.type !== "minf"
          ? raw(item)
          : box(
              "minf",
              ...kids(minf).map((child) => (child.type === "stbl" ? box("stbl", stsdBox, ...emptyTables) : raw(child)))
            )
      )
    )
  );

  return {
    id: trackId,
    timescale,
    handler,
    format,
    encrypted,
    count,
    sizes,
    durations,
    compositionOffsets,
    sync,
    offsets,
    ivs,
    trakBox,
    sampleEntryChildren: inner,
  };
}

const codecOf = (track) => {
  const type = track.format;
  const find = (name) => track.sampleEntryChildren.find((item) => item.type === name);
  const bodyOf = (entry) => track.moov.subarray(entry.body, entry.end);
  if (track.handler === "vide") {
    const hvcC = find("hvcC");
    if (hvcC) return hevcCodecString(type, bodyOf(hvcC));
    const avcC = find("avcC");
    if (avcC) return avcCodecString(type, bodyOf(avcC));
    return type;
  }
  const esds = find("esds");
  return esds ? aacCodecString(type, bodyOf(esds)) : type;
};

/**
 * cenc 样本解密：无子样本时整块解密；有子样本时只解 protected 段（CTR 计数连续）。
 * @returns {Buffer} 就地解密后的同一块缓冲区
 */
export function decryptSample(key, iv, subsamples, data) {
  const decipher = createDecipheriv("aes-128-ctr", key, iv);
  if (!subsamples || subsamples.length === 0) return decipher.update(data);
  let cursor = 0;
  for (const [clearBytes, protectedBytes] of subsamples) {
    cursor += clearBytes;
    if (protectedBytes > 0 && cursor < data.length) {
      const end = Math.min(cursor + protectedBytes, data.length);
      decipher.update(data.subarray(cursor, end)).copy(data, cursor);
      cursor = end;
    }
  }
  return data;
}

/**
 * 把渐进式 MP4（ftyp + moov 在前）转成分段 MP4。
 * head 必须覆盖完整的 ftyp 与 moov；file 是完整源文件的字节视图（可以只下载了前缀，用 have 表示可用长度）。
 */
export class Remuxer {
  /**
   * @param {Buffer} head 文件头部（至少包含完整 moov）
   * @param {string|null} keyHex 内容密钥 hex（32 位）；无加密内容可传 null
   * @param {{ segmentTargetBytes?: number, segmentMaxBytes?: number, firstSegmentTargetBytes?: number, segmentTargetMs?: number }} [options]
   */
  constructor(head, keyHex, { segmentTargetBytes = 1536 * 1024, segmentMaxBytes = 2 * 1024 * 1024, firstSegmentTargetBytes = 256 * 1024, segmentTargetMs = 4000 } = {}) {
    const top = scanHead(head);
    if (!top.moov) throw new Error("moov 不完整，需要继续读取文件头");
    const ftyp = top.ftyp;
    // 复制 moov：head 可能远大于 moov，视图会把整块文件头钉在内存里。
    const moov = Buffer.from(head.subarray(top.moov.start, top.moov.end));
    const key = keyHex ? Buffer.from(keyHex, "hex") : null;
    if (key && key.length !== 16) throw new Error("内容密钥长度不是 16 字节");

    const inner = parseBoxes(moov, 8, moov.length);
    const mvhd = inner.find((item) => item.type === "mvhd");
    if (!mvhd) throw new Error("moov 缺少 mvhd");
    const movieTimescale = moov.readUInt32BE(mvhd.body + (moov[mvhd.body] === 1 ? 20 : 12));
    const movieDuration = moov[mvhd.body] === 1 ? Number(moov.readBigUInt64BE(mvhd.body + 24)) : moov.readUInt32BE(mvhd.body + 16);

    this.key = key;
    this.segmentTargetBytes = segmentTargetBytes;
    this.segmentMaxBytes = segmentMaxBytes;
    this.firstSegmentTargetBytes = Math.min(segmentTargetBytes, firstSegmentTargetBytes);
    this.segmentTargetMs = segmentTargetMs > 0 ? segmentTargetMs : 4000;
    this.tracks = inner
      .filter((item) => item.type === "trak")
      .map((trak) => parseTrack(moov, trak, key))
      .filter(Boolean);
    // codec 字符串需要样本描述里的 hvcC/avcC/esds，把 moov 挂到轨道上供 codecOf 切片。
    for (const track of this.tracks) track.moov = moov;
    this.video = this.tracks.find((track) => track.handler === "vide");
    this.audio = this.tracks.find((track) => track.handler === "soun");
    if (!this.video) throw new Error("没有视频轨");

    this.movieTimescale = movieTimescale;
    this.durationMs = movieDuration > 0 && movieTimescale > 0 ? Math.round((movieDuration / movieTimescale) * 1000) : 0;
    this.timescale = this.video.timescale;
    this.codec = [this.video, this.audio].filter(Boolean).map(codecOf).join(",");
    this.videoCodec = codecOf(this.video);
    this.audioCodec = this.audio ? codecOf(this.audio) : null;
    this.mime = "video/mp4";

    const trex = this.tracks.map((track) =>
      fullBox("trex", 0, 0, u32(track.id), u32(1), u32(0), u32(0), u32(0))
    );
    this.init = Buffer.concat([
      ftyp ? head.subarray(ftyp.start, ftyp.end) : box("ftyp", Buffer.from("isom\0\0\x02\0isomiso6mp41", "latin1")),
      box("moov", moov.subarray(mvhd.start, mvhd.end), ...this.tracks.map((track) => track.trakBox), box("mvex", ...trex)),
    ]);

    this.fragments = this._planFragments();
    this.segments = this._planSegments();
    if (this.segments.length > LIMITS.localSegmentsMax) {
      // 长集逐步放宽时间窗口；时间切片不能让原本可播放的分段数超过面板内存护栏。
      const byteOnly = this._planSegments(Infinity);
      if (byteOnly.length <= LIMITS.localSegmentsMax) {
        let targetMs = this.segmentTargetMs;
        for (let attempt = 0; attempt < 8 && this.segments.length > LIMITS.localSegmentsMax; attempt++) {
          targetMs *= 2;
          this.segments = this._planSegments(targetMs);
        }
      }
      if (this.segments.length > LIMITS.localSegmentsMax) this.segments = byteOnly;
    }
    this.segmentCount = this.segments.length;
    this.nextSegment = 0;
  }

  /** 按 GOP 切片段；单片段超过上限时按样本字节再切一刀，保证分段可控。 */
  _planFragments() {
    const video = this.video;
    const audio = this.audio;
    const videoTime = new Float64Array(video.count + 1);
    for (let index = 0; index < video.count; index += 1) videoTime[index + 1] = videoTime[index] + video.durations[index];
    const audioTime = audio ? new Float64Array(audio.count + 1) : null;
    if (audio) for (let index = 0; index < audio.count; index += 1) audioTime[index + 1] = audioTime[index] + audio.durations[index];

    const starts = [];
    if (video.sync) {
      for (let index = 0; index < video.count; index += 1) if (video.sync[index]) starts.push(index);
    }
    if (starts.length === 0 || starts[0] !== 0) starts.unshift(0);

    const fragments = [];
    let audioCursor = 0;
    let sequence = 1;
    for (let gopIndex = 0; gopIndex < starts.length; gopIndex += 1) {
      const gopStart = starts[gopIndex];
      const gopEnd = gopIndex + 1 < starts.length ? starts[gopIndex + 1] : video.count;
      let from = gopStart;
      while (from < gopEnd) {
        let to = from;
        let bytes = 0;
        while (to < gopEnd) {
          const size = video.sizes[to];
          if (to > from && bytes + size > this.segmentMaxBytes) break;
          bytes += size;
          to += 1;
        }
        const isLastFragment = gopIndex === starts.length - 1 && to >= gopEnd;
        const untilSeconds = isLastFragment ? Infinity : videoTime[to] / video.timescale;
        const audioFrom = audioCursor;
        if (audio) {
          const untilTicks = untilSeconds === Infinity ? Infinity : untilSeconds * audio.timescale;
          while (audioCursor < audio.count && audioTime[audioCursor] < untilTicks) audioCursor += 1;
        }
        const parts = [{ track: video, from, to, base: videoTime[from] }];
        if (audio && audioCursor > audioFrom) {
          parts.push({ track: audio, from: audioFrom, to: audioCursor, base: audioTime[audioFrom] });
        }
        fragments.push(this._measureFragment(parts, sequence));
        sequence += 1;
        from = to;
      }
    }
    return fragments;
  }

  _measureFragment(parts, sequence) {
    let payloadBytes = 0;
    let need = 0;
    let durationMs = 0;
    for (const part of parts) {
      for (let index = part.from; index < part.to; index += 1) {
        payloadBytes += part.track.sizes[index];
        if (part.track.handler === "vide") durationMs += part.track.durations[index] / part.track.timescale * 1000;
        need = Math.max(need, part.track.offsets[index] + part.track.sizes[index]);
      }
    }
    const moof = this._buildMoof(parts, parts.map(() => 0), sequence);
    return { parts, sequence, need, durationMs, payloadBytes, size: moof.length + 8 + payloadBytes, moofLength: moof.length };
  }

  /** 以约 4 秒为时间窗口，仍在 GOP 边界收口并遵守字节上限；避免小首段后接几十秒的大段。 */
  _planSegments(targetMs = this.segmentTargetMs) {
    const segments = [];
    let current = null;
    const close = () => {
      if (!current) return;
      current.need = Math.max(...current.fragments.map((fragment) => fragment.need));
      segments.push(current);
      current = null;
    };
    for (const fragment of this.fragments) {
      const target = segments.length === 0 ? this.firstSegmentTargetBytes : this.segmentTargetBytes;
      if (current && (current.bytes >= target || current.bytes + fragment.size > this.segmentMaxBytes
        || current.durationMs + fragment.durationMs > targetMs)) {
        close();
      }
      current ??= { fragments: [], bytes: 0, need: 0, durationMs: 0 };
      current.fragments.push(fragment);
      current.bytes += fragment.size;
      current.durationMs += fragment.durationMs;
    }
    close();
    return segments;
  }

  /** 一个 moof：mfhd + 每条轨道一个 traf（tfhd/tfdt/trun）。 */
  _buildMoof(parts, offsets, sequence) {
    const trafOf = (part, dataOffset) => {
      const { track } = part;
      const sampleCount = part.to - part.from;
      const flags = 0x001 | 0x100 | 0x200 | 0x400 | (track.compositionOffsets ? 0x800 : 0);
      const rows = [];
      for (let index = part.from; index < part.to; index += 1) {
        const keyframe = !track.sync || track.sync[index] === 1;
        rows.push(u32(track.durations[index]), u32(track.sizes[index]), u32(keyframe ? 0x02000000 : 0x01010000));
        if (track.compositionOffsets) rows.push(u32(track.compositionOffsets[index]));
      }
      const base = Buffer.alloc(8);
      base.writeBigUInt64BE(BigInt(part.base));
      return box(
        "traf",
        fullBox("tfhd", 0, 0x020000, u32(track.id)),
        fullBox("tfdt", 1, 0, base),
        fullBox("trun", track.compositionOffsets ? 1 : 0, flags, u32(sampleCount), u32(dataOffset), ...rows)
      );
    };
    return box("moof", fullBox("mfhd", 0, 0, u32(sequence)), ...parts.map((part, index) => trafOf(part, offsets[index])));
  }

  /** 取一个样本并解密（返回新缓冲区，避免污染源文件视图）。 */
  readSample(file, track, index) {
    const offset = track.offsets[index];
    const size = track.sizes[index];
    if (!Number.isFinite(offset) || offset + size > file.length) throw new Error("样本越界，源文件不完整");
    const data = Buffer.from(file.subarray(offset, offset + size));
    if (!track.encrypted) return data;
    const encrypted = track.ivs?.[index];
    if (!encrypted) throw new Error("加密样本缺少 IV");
    return decryptSample(this.key, encrypted.iv, encrypted.parts, data);
  }

  /** 把一段已读入的密文解密成样本；chunk 从该样本起点开始。 */
  decodeSample(chunk, track, index) {
    const data = Buffer.from(chunk);
    if (!track.encrypted) return data;
    const encrypted = track.ivs?.[index];
    if (!encrypted) throw new Error("加密样本缺少 IV");
    return decryptSample(this.key, encrypted.iv, encrypted.parts, data);
  }

  /**
   * 从随机读源读取一个样本。
   * @param {{ read: (from: number, to: number) => Promise<Buffer> }} source
   */
  async readSampleFrom(source, track, index) {
    const offset = track.offsets[index];
    const size = track.sizes[index];
    if (!Number.isFinite(offset) || !Number.isFinite(size)) throw new Error("样本越界，源文件不完整");
    const chunk = await source.read(offset, offset + size);
    if (chunk.length < size) throw new Error("样本越界，源文件不完整");
    return this.decodeSample(chunk, track, index);
  }

  /**
   * 组装一个片段（moof + mdat），样本从随机读源按需读取。
   * 样本偏移在合法 MP4 里递增，一次读覆盖整个 part；区间过大时退回逐样本读，避免单次分配失控。
   */
  async buildFragmentFrom(source, fragment) {
    const payloads = [];
    for (const part of fragment.parts) {
      let start = Number.POSITIVE_INFINITY;
      let end = 0;
      for (let index = part.from; index < part.to; index += 1) {
        const offset = part.track.offsets[index];
        const size = part.track.sizes[index];
        if (!Number.isFinite(offset) || !Number.isFinite(size)) throw new Error("样本越界，源文件不完整");
        start = Math.min(start, offset);
        end = Math.max(end, offset + size);
      }
      if (!(end > start)) throw new Error("样本越界，源文件不完整");
      const list = [];
      if (end - start <= MAX_RANDOM_READ_BYTES) {
        const chunk = await source.read(start, end);
        for (let index = part.from; index < part.to; index += 1) {
          const offset = part.track.offsets[index] - start;
          const size = part.track.sizes[index];
          if (offset < 0 || offset + size > chunk.length) throw new Error("样本越界，源文件不完整");
          list.push(this.decodeSample(chunk.subarray(offset, offset + size), part.track, index));
        }
      } else {
        for (let index = part.from; index < part.to; index += 1) {
          list.push(await this.readSampleFrom(source, part.track, index));
        }
      }
      payloads.push(list);
    }
    const lengths = payloads.map((list) => list.reduce((sum, buffer) => sum + buffer.length, 0));
    const offsets = [];
    for (let index = 0, cursor = fragment.moofLength + 8; index < fragment.parts.length; cursor += lengths[index], index += 1) {
      offsets.push(cursor);
    }
    const moof = this._buildMoof(fragment.parts, offsets, fragment.sequence);
    const mdat = Buffer.concat(payloads.flat());
    return Buffer.concat([moof, u32(mdat.length + 8), Buffer.from("mdat", "latin1"), mdat]);
  }

  /**
   * 流式版 drain：与 drain() 语义一致，但只按样本偏移读取，不要求整份文件常驻内存。
   * @param {{ read: (from: number, to: number) => Promise<Buffer> }} source
   * @param {number} have 已写入源文件的字节数
   */
  async drainFrom(source, have) {
    const out = [];
    while (this.nextSegment < this.segments.length && this.segments[this.nextSegment].need <= have) {
      const segment = this.segments[this.nextSegment];
      const fragments = [];
      for (const fragment of segment.fragments) fragments.push(await this.buildFragmentFrom(source, fragment));
      out.push({ seq: this.nextSegment + 1, bytes: Buffer.concat(fragments) });
      this.nextSegment += 1;
    }
    return out;
  }

  /** 组装一个片段（moof + mdat）。 */
  buildFragment(file, fragment) {
    const payloads = fragment.parts.map((part) => {
      const list = [];
      for (let index = part.from; index < part.to; index += 1) list.push(this.readSample(file, part.track, index));
      return list;
    });
    const lengths = payloads.map((list) => list.reduce((sum, buffer) => sum + buffer.length, 0));
    const offsets = [];
    for (let index = 0, cursor = fragment.moofLength + 8; index < fragment.parts.length; cursor += lengths[index], index += 1) {
      offsets.push(cursor);
    }
    const moof = this._buildMoof(fragment.parts, offsets, fragment.sequence);
    const mdat = Buffer.concat(payloads.flat());
    return Buffer.concat([moof, u32(mdat.length + 8), Buffer.from("mdat", "latin1"), mdat]);
  }

  /**
   * 产出所有「样本字节已全部就绪」的分段。
   * @param {Buffer} file 源文件字节（前缀有效即可）
   * @param {number} have 已就绪的字节数
   * @returns {Array<{ seq: number, bytes: Buffer }>} seq 从 1 开始
   */
  drain(file, have) {
    const out = [];
    while (this.nextSegment < this.segments.length && this.segments[this.nextSegment].need <= have) {
      const segment = this.segments[this.nextSegment];
      out.push({
        seq: this.nextSegment + 1,
        bytes: Buffer.concat(segment.fragments.map((fragment) => this.buildFragment(file, fragment))),
      });
      this.nextSegment += 1;
    }
    return out;
  }

  get done() {
    return this.nextSegment >= this.segments.length;
  }

  info() {
    return {
      codec: this.codec,
      durationMs: this.durationMs,
      segmentCount: this.segmentCount,
      timescale: this.timescale,
      mime: this.mime,
      videoCodec: this.videoCodec,
      audioCodec: this.audioCodec,
      encrypted: this.video.encrypted === true,
      segmentBytes: this.segments.map((segment) => segment.bytes),
      segmentNeeds: this.segments.map((segment) => segment.need),
    };
  }
}
