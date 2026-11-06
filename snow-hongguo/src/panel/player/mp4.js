// 最小 MP4 / fMP4 解析：只做 WebCodecs 播放需要的那一部分。
//
// 宿主 CSP 没有 media-src，<video> 无法加载 blob:/data:/http 媒体，
// 因此播放必须绕开媒体元素：自己解封装，把样本交给 VideoDecoder / AudioDecoder。
// 这里只负责「字节 -> box 树 -> 轨道与样本」，不涉及解码与渲染，方便单测与复用。

const textAt = (bytes, at) =>
  String.fromCharCode(bytes[at] || 0, bytes[at + 1] || 0, bytes[at + 2] || 0, bytes[at + 3] || 0);

const u16 = (bytes, at) => ((bytes[at] << 8) | bytes[at + 1]) >>> 0;

const u32 = (bytes, at) =>
  (((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0);

const u64 = (bytes, at) => u32(bytes, at) * 2 ** 32 + u32(bytes, at + 4);

/**
 * 把 [start, end) 字节区间切成同级 box 列表。
 * size=1 走 64 位长度，size=0 表示延伸到区间末尾。
 */
export const readBoxes = (bytes, start = 0, end = bytes.length) => {
  const list = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = u32(bytes, offset);
    const type = textAt(bytes, offset + 4);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = u64(bytes, offset + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    list.push({
      type,
      start: offset,
      size,
      headerSize,
      bodyStart: offset + headerSize,
      bodyEnd: offset + size,
    });
    offset += size;
  }
  return list;
};

export const childOf = (list, type) => list.find((box) => box.type === type) || null;

export const childrenOf = (list, type) => list.filter((box) => box.type === type);

// sample entry 的固定前缀长度（box header 之后、子 box 之前）
const ENTRY_PREFIX = { avc1: 78, avc3: 78, hvc1: 78, hev1: 78, encv: 78, mp4a: 28, enca: 28 };

const readEntryCodec = (bytes, entry) => {
  const prefix = ENTRY_PREFIX[entry.type] ?? 0;
  const inner = readBoxes(bytes, entry.bodyStart + prefix, entry.bodyEnd);
  const config = childOf(inner, "hvcC") || childOf(inner, "avcC") || childOf(inner, "esds");
  if (!config) return { configType: "", description: null };
  return {
    configType: config.type,
    // WebCodecs 的 description 要的是配置 box 的内容（不含 8 字节 box 头）。
    description: bytes.subarray(config.bodyStart, config.bodyEnd),
  };
};

/** HEVCDecoderConfigurationRecord -> RFC 6381 的 codec 串，例如 hvc1.1.6.L186 */
const hevcCodecString = (bytes, description, sampleType) => {
  if (!description || description.length < 13) return sampleType;
  const profileSpace = ["", "A", "B", "C"][(description[1] >> 6) & 0x03];
  const tierFlag = (description[1] >> 5) & 0x01 ? "H" : "L";
  const profileIdc = description[1] & 0x1f;
  const compatFlags =
    ((description[2] << 24) | (description[3] << 16) | (description[4] << 8) | description[5]) >>> 0;
  // 兼容性标志按位反转后写成十六进制（规范要求倒序读）。
  let reversed = 0;
  for (let index = 0; index < 32; index += 1) reversed = (reversed << 1) | ((compatFlags >>> index) & 1);
  reversed >>>= 0;
  const levelIdc = description[12];
  return `${sampleType}.${profileSpace}${profileIdc}.${reversed.toString(16).toUpperCase()}.${tierFlag}${levelIdc}`;
};

/** AVCDecoderConfigurationRecord -> avc1.PPCCLL */
const avcCodecString = (bytes, description, sampleType) => {
  if (!description || description.length < 4) return sampleType;
  const hex = (value) => value.toString(16).padStart(2, "0");
  return `${sampleType}.${hex(description[1])}${hex(description[2])}${hex(description[3])}`;
};

/**
 * esds -> mp4a.OO.A    例如 mp4a.40.2（AAC-LC）。
 * AudioDecoder 不接受裸 "mp4a"，必须带上 objectTypeIndication 与 audioObjectType。
 */
const esdsCodecString = (bytes, description, sampleType) => {
  const data = description || new Uint8Array(0);
  let index = 4; // 跳过 version/flags
  let objectType = 0x40;
  let audioObjectType = 2;
  const readLength = () => {
    let length = 0;
    for (let count = 0; count < 4 && index < data.length; count += 1) {
      const value = data[index];
      index += 1;
      length = (length << 7) | (value & 0x7f);
      if (!(value & 0x80)) break;
    }
    return length;
  };
  while (index + 1 < data.length) {
    const tag = data[index];
    index += 1;
    const length = readLength();
    const end = Math.min(data.length, index + length);
    if (tag === 0x03) {
      // ES_Descriptor：ES_ID(2) + flags(1)，再按 flags 跳过可选字段
      const flags = data[index + 2] || 0;
      index += 3;
      if (flags & 0x80) index += 2;
      if (flags & 0x40) {
        const urlLength = data[index] || 0;
        index += 1 + urlLength;
      }
      if (flags & 0x20) index += 2;
      continue;
    }
    if (tag === 0x04) {
      objectType = data[index] || 0x40;
      index = end;
      continue;
    }
    if (tag === 0x05) {
      audioObjectType = (data[index] || 0x12) >> 3;
      break;
    }
    index = end;
  }
  return `${sampleType}.${objectType.toString(16)}.${audioObjectType}`;
};

const readSampleTable = (bytes, stbl) => {
  const stts = childOf(stbl, "stts");
  const stsc = childOf(stbl, "stsc");
  const stsz = childOf(stbl, "stsz");
  const stco = childOf(stbl, "stco") || childOf(stbl, "co64");
  const stss = childOf(stbl, "stss");
  if (!stts || !stsc || !stsz || !stco) return [];

  const sttsCount = u32(bytes, stts.bodyStart + 4);
  const deltas = [];
  for (let index = 0; index < sttsCount; index += 1) {
    const at = stts.bodyStart + 8 + index * 8;
    deltas.push({ count: u32(bytes, at), delta: u32(bytes, at + 4) });
  }

  const stscCount = u32(bytes, stsc.bodyStart + 4);
  const runs = [];
  for (let index = 0; index < stscCount; index += 1) {
    const at = stsc.bodyStart + 8 + index * 12;
    runs.push({
      firstChunk: u32(bytes, at),
      samplesPerChunk: u32(bytes, at + 4),
      sampleDescIndex: u32(bytes, at + 8),
    });
  }

  const uniformSize = u32(bytes, stsz.bodyStart + 4);
  const sampleCount = u32(bytes, stsz.bodyStart + 8);
  const sizes = [];
  for (let index = 0; index < sampleCount; index += 1) {
    sizes.push(uniformSize || u32(bytes, stsz.bodyStart + 12 + index * 4));
  }

  const chunkCount = u32(bytes, stco.bodyStart + 4);
  const chunkOffsets = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const at = stco.bodyStart + 8 + (stco.type === "co64" ? index * 8 : index * 4);
    chunkOffsets.push(stco.type === "co64" ? u64(bytes, at) : u32(bytes, at));
  }

  const syncSamples = new Set();
  if (stss) {
    const syncCount = u32(bytes, stss.bodyStart + 4);
    for (let index = 0; index < syncCount; index += 1) {
      syncSamples.add(u32(bytes, stss.bodyStart + 8 + index * 4));
    }
  }

  const samples = [];
  let sampleIndex = 0;
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    let perChunk = runs[0]?.samplesPerChunk || 1;
    for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
      if (chunk + 1 >= runs[runIndex].firstChunk) perChunk = runs[runIndex].samplesPerChunk;
    }
    let offset = chunkOffsets[chunk];
    for (let inner = 0; inner < perChunk && sampleIndex < sampleCount; inner += 1) {
      const size = sizes[sampleIndex] || 0;
      samples.push({
        index: sampleIndex,
        offset,
        size,
        // stss 缺省时全部样本都是同步样本。
        key: stss ? syncSamples.has(sampleIndex + 1) : true,
      });
      offset += size;
      sampleIndex += 1;
    }
  }

  // 按 stts 补齐时长与起始时间（单位：轨道 timescale）。
  let cursor = 0;
  let sampleAt = 0;
  for (const entry of deltas) {
    for (let index = 0; index < entry.count && sampleAt < samples.length; index += 1) {
      samples[sampleAt].time = cursor;
      samples[sampleAt].duration = entry.delta;
      cursor += entry.delta;
      sampleAt += 1;
    }
  }
  return samples;
};

const readTracks = (bytes, moov) => {
  const tracks = [];
  for (const trak of childrenOf(readBoxes(bytes, moov.bodyStart, moov.bodyEnd), "trak")) {
    const trakBoxes = readBoxes(bytes, trak.bodyStart, trak.bodyEnd);
    const mdia = childOf(trakBoxes, "mdia");
    if (!mdia) continue;
    const tkhd = childOf(trakBoxes, "tkhd");
    const edts = childOf(trakBoxes, "edts");
    let mediaTime = 0;
    if (edts) {
      const elst = childOf(readBoxes(bytes, edts.bodyStart, edts.bodyEnd), "elst");
      if (elst) {
        // elst 第一条编辑项的 media_time 表示「媒体内起点 -> 时间轴 0」，
        // 忽略它会让各轨固定错开（红果这两条轨都是 2048，视频 133ms / 音频 46ms）。
        // v0: entry 从 bodyStart+8 开始，segment_duration(4) + media_time(4)；
        // v1: segment_duration(8) + media_time(8)，取低 32 位。0xFFFFFFFF 表示空编辑，按 0 处理。
        const raw =
          bytes[elst.bodyStart] === 1
            ? u32(bytes, elst.bodyStart + 20)
            : u32(bytes, elst.bodyStart + 12);
        mediaTime = raw === 0xffffffff ? 0 : raw;
      }
    }
    const mdiaBoxes = readBoxes(bytes, mdia.bodyStart, mdia.bodyEnd);
    const mdhd = childOf(mdiaBoxes, "mdhd");
    const hdlr = childOf(mdiaBoxes, "hdlr");
    const minf = childOf(mdiaBoxes, "minf");
    if (!mdhd || !hdlr || !minf) continue;

    const version = bytes[mdhd.bodyStart];
    const timescale = version === 1 ? u32(bytes, mdhd.bodyStart + 20) : u32(bytes, mdhd.bodyStart + 12);
    // tkhd 的 track_ID 在 version/flags 与两个时间字段之后。
    let trackId = 0;
    if (tkhd) {
      trackId = bytes[tkhd.bodyStart] === 1 ? u32(bytes, tkhd.bodyStart + 20) : u32(bytes, tkhd.bodyStart + 12);
    }
    const handler = textAt(bytes, hdlr.bodyStart + 8);
    const minfBoxes = readBoxes(bytes, minf.bodyStart, minf.bodyEnd);
    const stbl = childOf(minfBoxes, "stbl");
    if (!stbl) continue;
    const stblBoxes = readBoxes(bytes, stbl.bodyStart, stbl.bodyEnd);
    const stsd = childOf(stblBoxes, "stsd");
    if (!stsd) continue;

    // stsd: version/flags(4) + entry_count(4)，随后是 sample entry
    const entries = readBoxes(bytes, stsd.bodyStart + 8, stsd.bodyEnd);
    const entry = entries[0];
    if (!entry) continue;
    const { configType, description } = readEntryCodec(bytes, entry);
    const sampleType = entry.type;
    let codec = sampleType;
    if (configType === "hvcC") codec = hevcCodecString(bytes, description, sampleType);
    else if (configType === "avcC") codec = avcCodecString(bytes, description, sampleType);
    else if (configType === "esds") codec = esdsCodecString(bytes, description, sampleType);

    const width = ENTRY_PREFIX[sampleType] ? u16(bytes, entry.bodyStart + 24) : 0;
    const height = ENTRY_PREFIX[sampleType] ? u16(bytes, entry.bodyStart + 26) : 0;
    // audio sample entry：channelcount 在 +16，samplerate 是 16.16 定点（取整数部分）。
    const channels = sampleType === "mp4a" || sampleType === "enca" ? u16(bytes, entry.bodyStart + 16) : 0;
    const sampleRate = sampleType === "mp4a" || sampleType === "enca" ? u16(bytes, entry.bodyStart + 24) : 0;

    tracks.push({
      id: trackId,
      handler,
      kind: handler === "vide" ? "video" : handler === "soun" ? "audio" : "other",
      timescale: timescale || 1,
      sampleType,
      configType,
      codec,
      description,
      width,
      height,
      channels,
      sampleRate,
      mediaTime,
      samples: readSampleTable(bytes, stblBoxes),
    });
  }
  return tracks;
};

/**
 * 解析完整 MP4（moov + mdat，或 init 段 + 连续分片）。
 * 返回 { tracks, video, audio }，样本已经是可直接喂给解码器的字节区间信息。
 */
export const parseMp4 = (bytes) => {
  const top = readBoxes(bytes);
  const moov = childOf(top, "moov");
  const tracks = moov ? readTracks(bytes, moov) : [];
  const withSamples = tracks.filter((track) => track.samples.length > 0);
  return {
    tracks,
    video: tracks.find((track) => track.kind === "video") || null,
    audio: tracks.find((track) => track.kind === "audio") || null,
    playable: withSamples,
    // 分片解析要用 trex 的默认样本参数。
    trex: moov ? readTrex(bytes, moov) : {},
  };
};

/** 取样本对应的字节（指向同一块缓冲区，不复制）。 */
export const sampleBytes = (bytes, sample) => bytes.subarray(sample.offset, sample.offset + sample.size);

/** 轨道 timescale 下的时长 -> 微秒（WebCodecs 的时间基）。 */
export const toMicros = (time, timescale) => Math.round((time * 1e6) / (timescale || 1));

/** 读 mvex/trex：分片里省略的默认样本时长/大小/标志来自这里。 */
const readTrex = (bytes, moov) => {
  const mvex = childOf(readBoxes(bytes, moov.bodyStart, moov.bodyEnd), "mvex");
  const table = {};
  if (!mvex) return table;
  for (const trex of childrenOf(readBoxes(bytes, mvex.bodyStart, mvex.bodyEnd), "trex")) {
    const at = trex.bodyStart + 4;
    table[u32(bytes, at)] = {
      duration: u32(bytes, at + 8),
      size: u32(bytes, at + 12),
      flags: u32(bytes, at + 16),
    };
  }
  return table;
};

const readTraf = (bytes, traf, context, buckets) => {
  const inner = readBoxes(bytes, traf.bodyStart, traf.bodyEnd);
  const tfhd = childOf(inner, "tfhd");
  if (!tfhd) return;
  const tfhdFlags = u32(bytes, tfhd.bodyStart) & 0xffffff;
  let at = tfhd.bodyStart + 4;
  const trackId = u32(bytes, at);
  at += 4;
  let baseDataOffset = 0;
  if (tfhdFlags & 0x000001) {
    baseDataOffset = u64(bytes, at);
    at += 8;
  }
  if (tfhdFlags & 0x000002) at += 4; // sample_description_index
  let defaultDuration = 0;
  if (tfhdFlags & 0x000008) {
    defaultDuration = u32(bytes, at);
    at += 4;
  }
  let defaultSize = 0;
  if (tfhdFlags & 0x000010) {
    defaultSize = u32(bytes, at);
    at += 4;
  }
  let defaultFlags = 0;
  if (tfhdFlags & 0x000020) {
    defaultFlags = u32(bytes, at);
    at += 4;
  }

  const defaults = context.trex[trackId] || {};
  if (!defaultDuration) defaultDuration = defaults.duration || 0;
  if (!defaultSize) defaultSize = defaults.size || 0;
  if (!defaultFlags) defaultFlags = defaults.flags || 0;

  const tfdt = childOf(inner, "tfdt");
  let decodeTime = 0;
  if (tfdt) {
    decodeTime =
      bytes[tfdt.bodyStart] === 1 ? u64(bytes, tfdt.bodyStart + 4) : u32(bytes, tfdt.bodyStart + 4);
  } else {
    const track = context.tracks.find((item) => item.id === trackId);
    decodeTime = track?.decodeTime || 0;
  }

  const base = baseDataOffset || context.moofStart;
  const list = buckets.get(trackId) || [];

  for (const trun of childrenOf(inner, "trun")) {
    const version = bytes[trun.bodyStart];
    const flags = u32(bytes, trun.bodyStart) & 0xffffff;
    const count = u32(bytes, trun.bodyStart + 4);
    let ptr = trun.bodyStart + 8;
    let dataOffset = 0;
    if (flags & 0x000001) {
      dataOffset = u32(bytes, ptr) | 0;
      ptr += 4;
    }
    let firstSampleFlags = 0;
    if (flags & 0x000004) {
      firstSampleFlags = u32(bytes, ptr);
      ptr += 4;
    }
    let offset = base + dataOffset;
    for (let index = 0; index < count; index += 1) {
      let duration = defaultDuration;
      let size = defaultSize;
      let sampleFlags = defaultFlags;
      let cts = 0;
      if (flags & 0x000100) {
        duration = u32(bytes, ptr);
        ptr += 4;
      }
      if (flags & 0x000200) {
        size = u32(bytes, ptr);
        ptr += 4;
      }
      if (flags & 0x000400) {
        sampleFlags = u32(bytes, ptr);
        ptr += 4;
      } else if (index === 0 && firstSampleFlags) {
        sampleFlags = firstSampleFlags;
      }
      if (flags & 0x000800) {
        cts = version === 1 ? u32(bytes, ptr) | 0 : u32(bytes, ptr);
        ptr += 4;
      }
      list.push({
        trackId,
        offset,
        size,
        duration,
        // 解码时间（DTS），组帧时再叠加 cts 偏移。
        time: decodeTime,
        cts,
        // sample_is_non_sync_sample 为 0 即关键帧。
        key: (sampleFlags & 0x00010000) === 0,
      });
      offset += size;
      decodeTime += duration;
    }
  }

  buckets.set(trackId, list);
  const track = context.tracks.find((item) => item.id === trackId);
  if (track) track.decodeTime = decodeTime;
};

/**
 * 解析一个媒体分片（可含多组 moof+mdat）。
 * init 段解析出的 tracks 会被用来补齐 trex 默认值并累积 decodeTime，
 * 因此同一集的连续分片必须按 seq 顺序调用。
 */
export const parseSegment = (bytes, tracks, trex = {}) => {
  const buckets = new Map();
  const context = { tracks, trex, moofStart: 0 };
  for (const box of readBoxes(bytes)) {
    if (box.type !== "moof") continue;
    context.moofStart = box.start;
    for (const traf of childrenOf(readBoxes(bytes, box.bodyStart, box.bodyEnd), "traf")) {
      readTraf(bytes, traf, context, buckets);
    }
  }
  return buckets;
};
