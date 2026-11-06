// 封面解码：红果只给 HEIC，Chromium 不能解码。
// 封面转码的降级思路参考 J3n5en/enso-hongguo（Apache-2.0）：
//   https://github.com/J3n5en/enso-plugins/tree/main/packages/enso.hongguo
// 转换器按平台依次尝试：macOS 的 /usr/bin/sips -> PATH 里的 ffmpeg -> Windows 自带的 WPF/WIC。
// 全部失败时返回 null，接口降级为原图，让面板显示占位图，绝不让封面失败拖垮接口。
// 注意：本机 ffmpeg 6.1 没有 HEIF 解码（只能读 avif），所以 Windows 上真正兜底的是 WIC。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { assertCoverUrl, fetchCoverBytes } from "../cover.js";
import { LIMITS } from "../../shared/contract.js";
import { HttpError } from "../errors.js";
import { MEDIA_LIMITS } from "./limits.js";

const BROWSER_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

const normalizeType = (value) =>
  String(value ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

export const isBrowserImage = (contentType) => BROWSER_IMAGE_TYPES.has(normalizeType(contentType));

/** 只按 PATH 与常见目录找可执行文件，不做 shell 调用。 */
const which = (name) => {
  const directories = String(process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean);
  const extra =
    process.platform === "darwin"
      ? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
      : process.platform === "linux"
        ? ["/usr/local/bin", "/usr/bin"]
        : [];
  const names = process.platform === "win32" ? [`${name}.exe`, name] : [name];
  for (const directory of [...directories, ...extra]) {
    for (const candidate of names) {
      const full = join(directory, candidate);
      if (existsSync(full)) return full;
    }
  }
  return null;
};

const findPowerShell = () => {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const legacy = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (existsSync(legacy)) return legacy;
  return which("powershell") ?? which("pwsh");
};

/** WPF/WIC 解码 HEIC 的脚本；默认带 10 年 HEIF 扩展的 Windows 10/11 可用。 */
const WIC_SCRIPT = [
  "param([string]$InputPath, [string]$OutputPath)",
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName PresentationCore",
  "$decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create([Uri]$InputPath, 'None', 'OnLoad')",
  "$frame = $decoder.Frames[0]",
  "$scale = [Math]::Min(1.0, 320.0 / $frame.PixelWidth)",
  "if ($scale -lt 0.999) {",
  "  $bitmap = New-Object System.Windows.Media.Imaging.TransformedBitmap",
  "  $bitmap.BeginInit()",
  "  $bitmap.Source = $frame",
  "  $bitmap.Transform = New-Object System.Windows.Media.ScaleTransform($scale, $scale)",
  "  $bitmap.EndInit()",
  "  $bitmap.Freeze()",
  "} else { $bitmap = $frame }",
  "$encoder = New-Object System.Windows.Media.Imaging.JpegBitmapEncoder",
  "$encoder.QualityLevel = 60",
  "$encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))",
  "$stream = [System.IO.File]::Create($OutputPath)",
  "try { $encoder.Save($stream) } finally { $stream.Close() }",
].join("\r\n");

let converterCache;
let lastGoodKind = null;

/**
 * 按优先级列出本机可用的转换器。
 * @returns {Array<{ kind: "sips"|"ffmpeg"|"wic", path: string }>}
 */
export function listImageConverters({ refresh = false } = {}) {
  if (!refresh && converterCache !== undefined) return converterCache;
  const list = [];
  if (process.platform === "darwin" && existsSync("/usr/bin/sips")) {
    list.push({ kind: "sips", path: "/usr/bin/sips" });
  }
  const ffmpeg = which("ffmpeg");
  if (ffmpeg) list.push({ kind: "ffmpeg", path: ffmpeg });
  if (process.platform === "win32") {
    const powershell = findPowerShell();
    if (powershell) list.push({ kind: "wic", path: powershell });
  }
  converterCache = list;
  return list;
}

/** 供测试判断本机有没有任何可用转换器（不代表一定能解 HEIC）。 */
export function detectImageConverter(options) {
  const list = listImageConverters(options);
  return list.find((item) => item.kind === lastGoodKind) ?? list[0] ?? null;
}

/** 测试用：清掉探测结果，允许重新判断转换器。 */
export function resetImageConverterCache() {
  converterCache = undefined;
  lastGoodKind = null;
}

const run = (command, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // 进程可能已退出。
      }
      finish(new Error("封面转码超时"));
    }, timeoutMs);
    timer.unref?.();
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => (code === 0 ? finish() : finish(new Error(stderr.trim() || `退出码 ${code}`))));
  });

const isJpeg = (bytes) => bytes && bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8;

const runConverter = async (converter, { input, output, scriptPath }, timeoutMs) => {
  if (converter.kind === "sips") {
    await run(
      converter.path,
      ["-s", "format", "jpeg", "-s", "formatOptions", "60", "-Z", "320", input, "--out", output],
      timeoutMs
    );
    return;
  }
  if (converter.kind === "ffmpeg") {
    await run(
      converter.path,
      ["-loglevel", "error", "-y", "-i", input, "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "5", output],
      timeoutMs
    );
    return;
  }
  await writeFile(scriptPath, WIC_SCRIPT);
  await run(
    converter.path,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-InputPath",
      input,
      "-OutputPath",
      output,
    ],
    Math.max(timeoutMs, 12000)
  );
};

/**
 * HEIC/HEIF -> JPEG。任何失败都返回 null（调用方回退到原图）。
 * @param {Buffer} bytes 原图字节
 * @returns {Promise<Buffer|null>}
 */
export async function convertToJpeg(bytes, { timeoutMs = MEDIA_LIMITS.coverTimeoutMs } = {}) {
  if (!bytes || bytes.length === 0) return null;
  const converters = listImageConverters();
  if (converters.length === 0) return null;
  // 上次成功的转换器先试，省掉必然失败的探测。
  const ordered = lastGoodKind
    ? [...converters.filter((item) => item.kind === lastGoodKind), ...converters.filter((item) => item.kind !== lastGoodKind)]
    : converters;

  let dir = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "hongguo-cover-"));
    const input = join(dir, "in.heic");
    const output = join(dir, "out.jpg");
    const scriptPath = join(dir, "wic-cover.ps1");
    await writeFile(input, bytes, { mode: 0o600 });
    for (const converter of ordered) {
      try {
        await runConverter(converter, { input, output, scriptPath }, timeoutMs);
        const jpeg = await readFile(output);
        if (isJpeg(jpeg)) {
          lastGoodKind = converter.kind;
          return jpeg;
        }
      } catch {
        // 换下一个转换器；全部失败时返回 null。
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 已经是浏览器能解的格式就原样返回；否则尽量转 JPEG。 */
const toBrowserImage = async (bytes, contentType) => {
  const type = normalizeType(contentType);
  if (BROWSER_IMAGE_TYPES.has(type)) return { bytes, contentType: type, converted: false };
  const jpeg = await convertToJpeg(bytes);
  if (!jpeg) return null;
  return { bytes: jpeg, contentType: "image/jpeg", converted: true };
};

/**
 * /cover 的取图逻辑：命中缓存优先，HEIC 转成 JPEG 后落盘覆盖原缓存。
 * 转换不可用时返回原图与原 content-type（面板显示占位），不抛错。
 */
export function createCoverResolver({ cache, log = () => {} } = {}) {
  if (!cache) throw new TypeError("createCoverResolver 需要 cache");

  return {
    async resolve(rawUrl) {
      const url = assertCoverUrl(rawUrl);
      const cached = await cache.readCover(url.href);
      if (cached) {
        const converted = await toBrowserImage(cached.bytes, cached.contentType);
        if (!converted) {
          return { bytes: cached.bytes, contentType: cached.contentType, converted: false, cache: "hit" };
        }
        if (converted.converted) {
          await cache.writeCover(url.href, converted.bytes, converted.contentType).catch((error) => {
            log(`封面转码缓存写入失败：${error?.message ?? error}`);
          });
        }
        return { ...converted, cache: "hit" };
      }

      let fetched;
      try {
        fetched = await fetchCoverBytes(url, { maxBytes: LIMITS.coverMaxBytes });
      } catch (error) {
        log(`封面拉取失败 ${url.host}${url.pathname}：${error?.code ?? ""} ${error?.message ?? error}`);
        throw error instanceof HttpError ? error : new HttpError(502, "COVER_FETCH_FAILED", "封面拉取失败");
      }
      if (!fetched.contentType.startsWith("image/")) {
        throw new HttpError(502, "COVER_NOT_IMAGE", "封面地址返回的不是图片");
      }

      const converted = await toBrowserImage(fetched.bytes, fetched.contentType);
      const result = converted ?? { bytes: fetched.bytes, contentType: fetched.contentType, converted: false };
      await cache.writeCover(url.href, result.bytes, result.contentType).catch((error) => {
        log(`封面缓存写入失败：${error?.message ?? error}`);
      });
      return { ...result, cache: "miss" };
    },
  };
}
