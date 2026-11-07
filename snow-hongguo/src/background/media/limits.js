// 媒体管道的共享常量：单块大小、分段大小、base64 上限、ROUTE 路径都集中在这里。
// 面板侧 api.net.fetch 的响应上限是 5MB，原样二进制走 base64 会膨胀约 33%，所以原始字节必须留足余量。
export const MEDIA_ROUTES = {
  streamInfo: "/stream/info",
  streamInit: "/stream/init",
  streamSegment: "/stream/segment",
  streamPrefetch: "/stream/prefetch",
  streamPrefetchCancel: "/stream/prefetch/cancel",
  cacheClear: "/cache/clear",
  /** H.264 转码兜底：宿主没有 HEVC 解码器时使用，产物是普通 MP4。 */
  h264Info: "/h264/info",
  h264Start: "/h264/start",
  h264Chunk: "/h264/chunk",
};

export const QUALITIES = ["360p", "480p", "540p", "720p", "1080p"];

export const MEDIA_LIMITS = {
  /** 首个 Range 请求的大小；moov 超出时按 scanHead() 给出的 need 再追加。 */
  headBytes: 512 * 1024,
  maxHeadBytes: 64 * 1024 * 1024,
  /** 单次 Range 的原始字节上限 3MB（base64 后 4MB，仍在 5MB 面板上限内）。 */
  blockBytes: 3 * 1024 * 1024,
  /** 分段聚合目标 1.5MB、硬上限 2MB（base64 后 2.67MB）。 */
  segmentTargetBytes: 1536 * 1024,
  segmentMaxBytes: 2 * 1024 * 1024,
  /** api.net.fetch 单次响应上限 5MB：base64 长度不得超过。 */
  maxBase64Bytes: 5 * 1024 * 1024,
  /** 源文件保护：超过 512MB 的地址直接拒绝，避免误分配大缓冲区。 */
  maxTotalBytes: 512 * 1024 * 1024,
  rangeTimeoutMs: 30000,
  /** 同一个源的下载失败重试次数（配合 .part 续传）。 */
  rangeRetries: 2,
  rangeRetryDelayMs: 400,
  /** 等分段时允许连续没有新分段落盘的最长时间。 */
  segmentWaitMs: 30000,
  /** 同时保留的播放任务数（按 LRU 淘汰）。 */
  maxJobs: 6,
  /** 下一集只预取开头，最多 4MB / 两个面板，租约到期自动停止。 */
  prefetchMaxBytes: 4 * 1024 * 1024,
  prefetchMaxJobs: 2,
  prefetchTtlMs: 60 * 1000,
  /** 转码任务保留数：只保留少量已完成任务，其余按 LRU 淘汰；实际执行始终串行。 */
  transcodeMaxJobs: 4,
  coverTimeoutMs: 8000,
};

/** base64 后的字节数（不含换行）。 */
export const base64Length = (rawBytes) => Math.ceil(rawBytes / 3) * 4;

/** 在给定 base64 上限下允许的最大原始字节数。 */
export const maxRawBytes = (base64Limit = MEDIA_LIMITS.maxBase64Bytes) => Math.floor(base64Limit / 4) * 3;
