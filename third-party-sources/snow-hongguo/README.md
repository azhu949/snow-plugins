# Hongguo HEIC 解码器对应源码

这些文件用于提供内置解码器的对应源码，供查看、修改和重新构建，不参与插件运行，不应复制到插件安装目录。

发布时使用仓库的 `scripts/pack.ps1 -Plugin snow-hongguo`；脚本会把本目录单独打成 `com.snow.hongguo-<插件版本>-sources.zip`。该附件应与插件安装包一起上传到同一个 GitHub Release，并在 Release 说明中提供可免费下载的链接；不要只发布安装包。

## 固定版本与来源

| 归档 | 对应来源 | SHA-256 |
| --- | --- | --- |
| `libheif-js-1.23.5-source.tar.gz` | [libheif-js 1.23.5](https://github.com/catdad-experiments/libheif-js/tree/1.23.5) | `b2bcc4d1e94a47eff30afa05671374170f2f9f5ad88dd2e3cb1196d2df4d6f76` |
| `libheif-emscripten-1.23.5-source.tar.gz` | [libheif-emscripten v1.23.5](https://github.com/catdad-experiments/libheif-emscripten/tree/v1.23.5) | `8e3395ca983e369448bea84d223c35f1117373953e00219588415f1bc37c86ea` |
| `libheif-source.tar.gz` | [libheif 413e2a87e6a70b3eccc3a3adc5801179dd2d9e00](https://github.com/strukturag/libheif/tree/413e2a87e6a70b3eccc3a3adc5801179dd2d9e00) | `ef8e86a4e5670b7338a58b17553e306b8be88e506587b265dfdfe44495896999` |
| `libde265-1.0.15-source.tar.gz` | [libde265 v1.0.15](https://github.com/strukturag/libde265/tree/v1.0.15) | `d4e55706dfc5b2c5c9702940b675ce2d3e7511025c6894eaddcdbaf0b15fd3f3` |

## 构建与替换

1. 解压以上归档。将 libheif 源码放在 libheif-emscripten 的 `libheif/` 子模块路径，保持上述提交版本。
2. 按 libheif-emscripten 的 `.github/workflows/emscripten.yml` 使用 Emscripten 3.1.61；WASM 构建设置 `USE_WASM=1 USE_UNSAFE_EVAL=0`，并启用上游工作流中的 TypeScript 输出。底层过程由 libheif 的 `build-emscripten.sh` 管理，HEVC 解码依赖 libde265 1.0.15；该源码副本也在本附件中。完整构建步骤与系统依赖以上游脚本为准。
3. libheif-js 的 `scripts/install.js` 和 `scripts/bundle.js` 将 Emscripten 输出与 WASM 组合成 `libheif-wasm/libheif-bundle.js`。重建修改版时将该脚本的输入改为自己的构建结果，不能重新下载未修改的发布二进制来代替。
4. 将生成的 bundle 保存为插件目录下 `third-party/libheif/libheif-bundle.cjs`。插件通过 CommonJS 动态加载这个文件，可使用接口兼容的修改版；运行时没有库签名或哈希锁定。无需重建其它插件模块。

各归档保留上游许可；安装包另含 libheif-js、libheif 和 libde265 的许可全文。用于调试库修改的逆向工程不受本插件限制。本插件自身的封面适配代码与打包脚本位于 [snow-plugins](https://github.com/azhu949/snow-plugins)，发布时使用与安装包相同的 Release tag 对应代码。
