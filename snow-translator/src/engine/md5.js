// 极简 MD5（UTF-8 输入，输出 32 位小写十六进制）。
// 百度翻译签名只需要这一个能力，自己实现可以避免打包器把 Node 内置模块替换成空壳后在浏览器里报错。
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(abs(sin(i + 1)) * 2^32)，改用常量表避免不同引擎的浮点差异。
const CONSTANTS = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

function utf8Bytes(text) {
  return Array.from(new TextEncoder().encode(text));
}

function pushLE32(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function hexLE(value) {
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

export function md5(input) {
  const bytes = utf8Bytes(String(input));
  const bitLength = bytes.length * 8;

  // 填充：先补 0x80，再补 0 到 56 (mod 64)，最后追加 64 位小端位长。
  const buffer = bytes.slice();
  buffer.push(0x80);
  while (buffer.length % 64 !== 56) buffer.push(0);
  pushLE32(buffer, bitLength >>> 0);
  pushLE32(buffer, Math.floor(bitLength / 4294967296) >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;

  const words = new Array(16);
  for (let offset = 0; offset < buffer.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const base = offset + i * 4;
      words[i] = buffer[base] | (buffer[base + 1] << 8) | (buffer[base + 2] << 16) | (buffer[base + 3] << 24);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;

    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + CONSTANTS[i] + words[g]) | 0;
      const rotated = (sum << SHIFTS[i]) | (sum >>> (32 - SHIFTS[i]));
      const next = (b + rotated) | 0;
      a = d;
      d = c;
      c = b;
      b = next;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
  }

  return [h0, h1, h2, h3].map(hexLE).join("");
}
