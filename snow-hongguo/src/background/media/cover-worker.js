// 后台 Node Worker：随包携带的 HEIC 解码器，不依赖系统 HEIF/HEVC 扩展。
import { parentPort } from "node:worker_threads";
import createLibheif from "libheif-js/libheif-wasm/libheif-bundle.js";
import encodeJpeg from "jpeg-js/lib/encoder.js";

const MAX_PIXELS = 16 * 1024 * 1024;
const MAX_SIDE = 320;

// 双线性缩小并把透明像素合成到白底，JPEG 不支持 alpha。
const thumbnail = ({ data, width, height }) => {
  const scale = Math.min(1, MAX_SIDE / width, MAX_SIDE / height);
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const output = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    const sy = Math.max(0, (y + 0.5) * height / outHeight - 0.5);
    const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, height - 1), fy = sy - y0;
    for (let x = 0; x < outWidth; x += 1) {
      const sx = Math.max(0, (x + 0.5) * width / outWidth - 0.5);
      const x0 = Math.floor(sx), x1 = Math.min(x0 + 1, width - 1), fx = sx - x0;
      const indices = [(y0 * width + x0) * 4, (y0 * width + x1) * 4,
        (y1 * width + x0) * 4, (y1 * width + x1) * 4];
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      const offset = (y * outWidth + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        let value = 0;
        for (let i = 0; i < 4; i += 1) {
          const alpha = data[indices[i] + 3] / 255;
          value += (data[indices[i] + c] * alpha + 255 * (1 - alpha)) * weights[i];
        }
        output[offset + c] = Math.round(value);
      }
      output[offset + 3] = 255;
    }
  }
  return { data: output, width: outWidth, height: outHeight };
};

parentPort.once("message", async (bytes) => {
  let images = [];
  let detail = "";
  const recordError = (...parts) => { detail = parts.map(String).join(" ").slice(0, 300); };
  // 上游 JS 包装层通过 console 报解析错误；本线程只处理一张图，把原因带回宿主日志。
  console.log = console.warn = console.error = recordError;
  try {
    const libheif = await createLibheif({ print: recordError, printErr: recordError });
    images = new libheif.HeifDecoder().decode(bytes);
    const image = images.find((item) => item.is_primary()) ?? images[0];
    if (!image) throw new Error(`HEIC 中没有可解码图片${detail ? `：${detail}` : ""}`);
    const width = image.get_width(), height = image.get_height();
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width <= 0 || height <= 0 || width * height > MAX_PIXELS) {
      throw new Error(`HEIC 尺寸超出限制：${width}x${height}`);
    }
    const rgba = await new Promise((resolve, reject) => {
      image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (result) => {
        if (result) resolve(result);
        else reject(new Error(`HEIC 像素解码失败${detail ? `：${detail}` : ""}`));
      });
    });
    const jpeg = Uint8Array.from(encodeJpeg(thumbnail(rgba), 60).data);
    parentPort.postMessage({ bytes: jpeg }, [jpeg.buffer]);
  } catch (error) {
    parentPort.postMessage({ error: String(error?.message ?? error).slice(0, 500) });
  } finally {
    for (const image of images) image.free();
    parentPort.close();
  }
});
