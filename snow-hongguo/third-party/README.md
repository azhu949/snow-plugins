# 第三方软件与离线保调实现说明

## SoundTouchJS Core

- npm 包：`@soundtouchjs/core`，固定版本 `2.1.1`。
- 上游项目：[SoundTouchJS](https://github.com/cutterbl/SoundTouchJS "SoundTouchJS 上游项目与完整源码")，包位于 `packages/core`。
- 许可：Mozilla Public License 2.0（`MPL-2.0`）。原包的 `LICENSE` 原样保存在 `soundtouch/LICENSE`；该文件指向 [MPL 2.0 完整许可](https://www.mozilla.org/en-US/MPL/2.0/ "Mozilla Public License 2.0 官方全文")。
- 原版权声明中的作者：Olli Parviainen、Ryan Berdeen、Jakub Fiala、Steve 'Cutter' Blades。
- 未修改上游源码。`soundtouch/` 内的 JavaScript 文件来自安装包 `.dist/`，是原样可读的发布源码，不是本插件重新实现或重新压缩的版本。所有现有版权、许可与 sourceMappingURL 注释均保留。

随插件分发的副本：

| 本目录中的文件 | 原 npm 包路径 | 用途 |
| --- | --- | --- |
| `soundtouch/LICENSE` | `LICENSE` | 原包许可说明 |
| `soundtouch/index.js` | `.dist/index.js` | 公共导出入口的归属记录 |
| `soundtouch/Stretch.js` | `.dist/Stretch.js` | 保持音高的 WSOLA 时间伸缩 |
| `soundtouch/AbstractSamplePipe.js` | `.dist/AbstractSamplePipe.js` | 输入、输出缓冲基类 |
| `soundtouch/FifoSampleBuffer.js` | `.dist/FifoSampleBuffer.js` | 交错立体声帧缓冲 |
| `soundtouch/CircularSampleBuffer.js` | `.dist/CircularSampleBuffer.js` | Stretch 引用的可选环形缓冲适配实现 |

这些副本用于源码与许可提供，不作为运行时可导入目录；未用到的导出及可选适配器可以被构建器 tree-shake。公共入口还导出其他算法，但保调 Worker 只使用 `Stretch`，不使用 `SoundTouch`、重采样器或插值策略。`build.mjs` 根据 Worker 构建的元数据核对实际进入产物的第三方模块与原样副本，新增第三方依赖没有归属副本时构建失败。

构建 Worker 时保留 `legalComments: "inline"`；上游普通版权块不属于 esbuild 的特殊 legal comment，因此另将 `Stretch.js` 的首个版权块原样作为 Worker banner。完整 Worker 作为字符串嵌入面板，不依赖外网、相对 URL 或额外服务。版权说明和本目录须随插件包保留；现有 `scripts/pack.ps1` 不排除 `third-party/`。

## 离线保调行为

本插件自己的适配代码在 `src/panel/player/tempo-worker.js` 和 `src/panel/player/tempo-audio.js`，不是对以上上游文件的修改。

- `createTempoRenderer(context, sourceBuffer)` 返回 `getBuffer(rate)`、`cancel()`、`destroy()`。
- 1 倍直接返回原始 AudioBuffer，不启动 Worker；非 1 倍只接受有限的 `0.75..3` 倍率。
- 保持原始 sampleRate 与声道数；输出帧数严格为 `Math.max(1, Math.round(sourceBuffer.length / rate))`。只接受 mono/stereo，超过双声道明确报错。
- mono 在一个有限输入块内复制到左右两路，输出时只取原单声道；stereo 两路使用同一次 Stretch 匹配，避免声道漂移。
- 语音窗口为 sequence 50 ms、seek 15 ms、overlap 8 ms，开启 quickSeek。该组短窗口偏向对白，不能保证音乐、高倍速或所有瞬态完全无伪影。
- 每次最多输入 8192 个立体声帧，立即消费输出；不会将整集交错输入塞进 FIFO。缓冲 API 中的长度均是帧，不是 float 数量。
- 片尾有限补零预算为 `ceil(inputChunkSize + rate * outputChunkSize + sampleRate * 0.008)` 个输入帧，涵盖 lookahead、bootstrap 和一次名义输入步长；只消费到理论输出总长。预算耗尽仍不足则报错，不用静音伪造未处理的尾部。
- 不额外裁掉开头 overlap，不把算法处理等待时间计入媒体时间；调用方用原媒体时间定位，播放保调结果时 `playbackRate = 1`、偏移为原媒体秒数除以倍率。

## 生命周期与内存

- 同一 pending 倍率复用同一个 Promise；切换倍率（包括回到 1 倍或已有缓存）先取消旧任务并以 `AbortError` 拒绝旧 Promise。
- 模块只保留一个已完成非 1 倍缓存。新倍率处理期间可以保留上一次缓存，成功后替换；`cancel()` 仅取消未完成任务，适用于 seek/pause，保留缓存。
- `destroy()` 取消任务，释放本模块持有的源音频、缓存和 context 引用；后续 `getBuffer()` 以 `AbortError` 拒绝。调用方已取得的 AudioBuffer 不会被主动破坏。
- 每个任务使用一个独立 Blob Worker；完成、取消、error、messageerror 或 60 秒超时都终止 Worker、清除定时器、回收 Blob URL。Worker 自身完成后也关闭，不长期缓存整集数据。
- 输入转移的是独立 Float32Array 副本，绝不 transfer/neuter 原 AudioBuffer；输出平面用 transferable 返回，主线程再创建并填充 AudioBuffer。
- 设原始音频占用 `S = 4 * channels * frames` 字节，新倍率输出占用约 `O = S / rate`，旧缓存占用 `C`。稳定持有量约 `S + O`；处理中约 `2S + C + O`；结果复制期间的保守瞬时上界约 `2S + C + 2O`，另有少量块缓冲和运行时开销。调用方自行保留的旧结果不在本模块控制范围内。
- 例如 120 秒、48 kHz、stereo 的原始音频约 46.08 MB，0.75 倍结果约 61.44 MB；单份长期缓存不会随着八个倍率全部累积。切档准备仍可能出现数百 MB 的短时内存占用，GC 时机由宿主决定。
- Worker 不可用、Blob Worker 被 CSP 拒绝或算法失败会明确 reject，不静默回退到变调播放。es2020 构建目标不代表第三方运行时 API 被 polyfill；FifoSampleBuffer 使用的可调整大小 ArrayBuffer 由当前宿主提供。
