# 第三方软件、封面解码与离线保调实现说明

## HEIC 封面解码

- `libheif-js@1.23.5`（LGPL-3.0），上游：[libheif-js 1.23.5](https://github.com/catdad-experiments/libheif-js/tree/1.23.5)。`libheif/libheif-bundle.cjs` 是 npm 包 `libheif-wasm/libheif-bundle.js` 的原样副本，只把扩展名改为 `.cjs`，兼容有无 `type: module` 的插件安装目录。WASM 已包含在文件中，运行时不会下载组件。
- 上述包使用 [libheif-emscripten v1.23.5](https://github.com/catdad-experiments/libheif-emscripten/tree/v1.23.5) 的构建，libheif 子模块提交为 `413e2a87e6a70b3eccc3a3adc5801179dd2d9e00`，构建脚本默认带 `libde265 1.0.15` HEVC 解码器。对应许可分别保存在 `libheif/LICENSE`、`libheif/LIBHEIF-LICENSE`、`libheif/LIBDE265-LICENSE`；后两份包含完整 GPL/LGPL 文本。
- 对应源码不参与运行，作为独立的 `com.snow.hongguo-<插件版本>-sources.zip` 附件放在**安装包所在的同一 [GitHub Release](https://github.com/azhu949/snow-plugins/releases)**，可免费单独下载，无需安装。附件包括 `libheif-js-1.23.5-source.tar.gz`、`libheif-emscripten-1.23.5-source.tar.gz`、`libheif-source.tar.gz` 与 `libde265-1.0.15-source.tar.gz`，均对应上述固定 tag/commit；仓库副本位于 `third-party-sources/snow-hongguo/`。重建步骤见附件的 README、npm 包的 `scripts/install.js`/`scripts/bundle.js`、构建仓库的 `.github/workflows/emscripten.yml`（Emscripten 3.1.61）与 libheif 的 `build-emscripten.sh`。
- 插件通过 CommonJS `require` 加载独立的 `libheif/libheif-bundle.cjs`，未把库合并进后台入口；可以原位替换成接口兼容的修改版本，不要求签名或校验。使用者可以修改库，并为调试修改版本而进行逆向工程。
- `jpeg-js@0.4.4`（BSD-3-Clause），上游：[jpeg-js](https://github.com/jpeg-js/jpeg-js)。`jpeg-js/encoder.cjs` 是 npm 包 `lib/encoder.js` 的原样源码，保留 Adobe 的版权及许可头；包级版权及许可保存在 `jpeg-js/LICENSE`。编码器打包进 `cover-worker.cjs`，不依赖系统 JPEG 工具。

本插件的适配代码位于 `src/background/media/cover-worker.js` 和 `cover-wasm.js`。每张图在独立 Node Worker 内解码，最长边缩小到 320 像素，以质量 60 输出 JPEG；透明像素合成到白底。最多两个 Worker 并发，排队与解码合计 8 秒超时；成功、异常、提前退出及超时都会终止 Worker、释放队列名额。输入通过独立字节副本传递，不转移或修改缓存持有的 Buffer。解码库原样文件与本节列出的许可随安装包保留；对应源码以同一 Release 下的独立附件提供，Release 说明须给出该附件的下载入口。

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

## 流式保调行为

本插件自己的适配代码在 `src/panel/player/tempo-processing.js`、`tempo-worker.js`、`tempo-audio.js` 和 `stream-audio.js`，不是对以上上游文件的修改。

- `createTempoStreamRenderer({ rate, sampleRate, channels })` 返回 `append(planes, final)` 与 `destroy()`。每次顺序传入独立 Float32 声道平面，返回当前可播放的输出块。
- 1 倍直接播放原始 PCM，不启动 Worker；非 1 倍只接受有限的 `0.75..3` 倍率。保留实际 PCM 采样率，由 Web Audio 重采样到设备采样率。
- 同一段连续播放共用一个 Stretch 实例；网络分段边界不重置 WSOLA、不补静音。真正音轨结束后才排空，总输出帧数为 `Math.round(totalInputFrames / rate)`。
- mono 在有限输入块内复制到左右两路，输出时取原单声道；stereo 共用匹配。非 1 倍只支持 mono/stereo。
- 语音窗口为 sequence 50 ms、seek 15 ms、overlap 8 ms，开启 quickSeek；不能保证音乐、高倍速或所有瞬态完全无伪影。
- 每次最多向 Stretch 输入 8192 个立体声帧，随即消费输出；FIFO 的长度单位是帧，不是 float 数量。
- 片尾补零预算为 `ceil(inputChunkSize + rate * outputChunkSize + sampleRate * 0.008)`；只消费到理论总长。预算不足报错，不用静音伪造尾部。
- 输出始终以 `playbackRate = 1` 播放，声卡时钟按倍率换回原媒体时间，不二次加速。

## 生命周期与内存

- 增量接收 AAC，从 MP4 的 esds 提取实际编码类型与 AudioSpecificConfig 后配置 AudioDecoder，保留 HE-AAC v2 等扩展类型；解码提交队列最多 64 个样本，只在整条音轨提交完毕后 flush。priming 按轨道时间基换算，在原始 PCM 起点裁剪一次。
- 原始 PCM 分块缓存供本集 seek，最多 128MB，不拼接、复制整集 AudioBuffer。输出按当前位置前方约 3 秒准备，单次输入不超过一秒原始 PCM；没有整集倍速缓存。
- 起播与缓冲恢复前积累约 1 秒的真实音频输出，再与视频共同放行；片尾剩余不足 1 秒时允许直接播放到结束。首次不足一秒的 Worker 回包不会立即启动声音。
- 音块按同一 AudioContext 时间轴连续排程，并在音块结束事件中续排；准备窗口按声卡时钟计算，后台动画帧暂停不会耗尽已准备好的音频。数据不足或错过排程时间时同步缓冲，不能把迟到音块接到错误时间位置。
- 暂停、seek、改速、切集和关闭取消旧 Worker 与排程音源；迟到回调不能重新发声。暂停/seek 保留原始 PCM，关闭释放 PCM、解码器与上下文。
- 每段连续的非 1 倍播放使用一个 Blob Worker；片尾、取消、error、messageerror 或单次处理超时（60 秒）终止 Worker、清除定时器并回收 Blob URL。
- 输入转移独立 Float32Array 副本，不 transfer 原始 PCM；输出平面用 transferable 返回后填入 AudioBuffer。输出窗口有界，内存不随八个倍率累积。
- Worker 不可用、被 CSP 拒绝或算法失败会明确报错，不静默改用变调播放。es2020 构建目标不代表第三方 API 已被 polyfill；FifoSampleBuffer 的可调整大小 ArrayBuffer 由当前宿主提供。
