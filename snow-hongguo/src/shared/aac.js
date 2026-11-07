// MP4 esds 的描述符解析由前后台共用，避免 HE-AAC 被默认成 AAC-LC。
const readDescriptor = (bytes, offset, limit) => {
  if (offset >= limit) throw new Error("音频配置描述符缺失");
  const tag = bytes[offset++];
  let size = 0;
  for (let index = 0; index < 4; index++) {
    if (offset >= limit) break;
    const byte = bytes[offset++];
    size = size * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      const end = offset + size;
      if (end > limit) break;
      return { tag, start: offset, end };
    }
  }
  throw new Error("音频配置描述符长度无效");
};

const findDescriptor = (bytes, start, end, tag) => {
  for (let at = start; at < end;) {
    const descriptor = readDescriptor(bytes, at, end);
    if (descriptor.tag === tag) return descriptor;
    at = descriptor.end;
  }
  throw new Error("音频配置描述符缺失");
};

/**
 * esds FullBox 内容 -> codec 与 AudioSpecificConfig。
 * WebCodecs 的 AAC description 必须是 ASC；不传时按 ADTS 解释，不接受 MP4 的裸 AAC 帧。
 * https://www.w3.org/TR/webcodecs-aac-codec-registration/#audiodecoderconfig-description
 */
export function parseEsds(bytes, sampleType = "mp4a") {
  let descriptor = readDescriptor(bytes, 4, bytes.length);
  if (descriptor.tag === 0x03) {
    const limit = descriptor.end;
    if (descriptor.start + 3 > limit) throw new Error("ES 音频描述符不完整");
    const flags = bytes[descriptor.start + 2];
    let at = descriptor.start + 3;
    if (flags & 0x80) at += 2;
    if (flags & 0x40) {
      if (at >= limit) throw new Error("ES 音频描述符不完整");
      at += 1 + bytes[at];
    }
    if (flags & 0x20) at += 2;
    descriptor = findDescriptor(bytes, at, limit, 0x04);
  }
  if (descriptor.tag !== 0x04 || descriptor.start + 13 > descriptor.end) {
    throw new Error("音频缺少解码配置");
  }
  const objectType = bytes[descriptor.start];
  // DecoderSpecificInfo 是 DecoderConfigDescriptor 的子项，不能跳过整个 0x04。
  const specific = findDescriptor(bytes, descriptor.start + 13, descriptor.end, 0x05);
  const description = bytes.subarray(specific.start, specific.end);
  if (description.length < 2) throw new Error("AudioSpecificConfig 不完整");
  let audioObjectType = description[0] >> 3;
  if (audioObjectType === 31) audioObjectType = 32 + ((description[0] & 7) << 3 | description[1] >> 5);
  if (!audioObjectType) throw new Error("音频编码类型无效");
  return {
    codec: objectType === 0x40 ? `${sampleType}.40.${audioObjectType}` : `${sampleType}.${objectType.toString(16)}`,
    description,
  };
}
