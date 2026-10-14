# snow-plugins

Snow App 插件集合仓库。每个子目录是一个独立插件（该目录本身即发布打包根，`plugin.json` 位于目录根部）。

## 插件列表

| 插件 | ID | 版本 | 说明 |
| ---- | -- | ---- | ---- |
| 小说阅读器 | `com.snow.novel-reader` | 1.1.0 | 悬浮 TXT 小说阅读器（可调透明度与显示位置、滚轮与快捷键翻页、章节识别与自动滚动）+ legado 书源导入、多源并发搜索与在线追书 |

### 小说阅读器：功能范围

- 本地阅读：导入 TXT（可多选）、书架与目录、阅读进度、悬浮阅读窗（透明度 / 位置 / 字号 / 行高，配色跟随宿主主题）。
- 在线追书：导入 **legado 格式**书源（只支持 legado，不做其它阅读器格式适配；一次可导入多个源）、多源并发搜索、详情与目录分页抓取、章节正文缓存。
- 隐私：不内置任何书源、不后台联网；只有你主动点「搜索」或打开在线章节时，才会通过宿主网络通道访问书源里指定的站点。
- 「数据」页的「清空全部数据」会一并清掉书源与章节缓存（阅读设置与快捷键保留），二次确认时会列出清除范围。

## 目录结构

```
snow-plugins/
  snow-novel-reader/          插件源码目录（打包根）
    plugin.json               插件清单（id / version / panels / locales / styles / privacy）
    index.js                  入口（默认导出 React 面板组件；兼容 export function mount(container, api)）
    style.css                 面板与悬浮阅读窗样式
    locales/                  zh-CN / zh-TW / en 语言包
    icon.svg                  插件图标
  sources/                    本地 legado 书源合集（已加入 .gitignore，见 sources/README.md）
  scripts/
    pack.ps1                  打包脚本：生成可发布的 zip 并输出 SHA-256
  dist/                       打包产物（已加入 .gitignore）
  .snow/                      本地测试与开发脚本（已加入 .gitignore）
```

## 本地开发与调试

通过 Snow App 的 `config` 工具（`plugins` 域）把源码目录安装到本机，安装位置为 `~/.snowapp/plugins/com.snow.novel-reader/`：

```
config-set scope=plugins key=com.snow.novel-reader value={sourceDir: "D:/ai-workspace/snow-plugins/snow-novel-reader"}
```

- 修改源码后重新执行一次上面的安装即可原地更新，插件启用状态保留。
- 只修改了安装目录内的文件时，可用 `value={rescan: true}` 重新读取清单。
- 开发规范以内置文档为准：
  - `~/.snowapp/docs/zh-CN/2-使用指南/24-插件开发与安装.md`
  - `~/.snowapp/docs/zh-CN/3-参考手册/6-插件元数据域参考.md`

## 发布到插件市场

1. 修改 `plugin.json` 中的 `version`（如 `1.0.0` → `1.0.1`），提交并推送本仓库。
2. 打包并计算哈希：

   ```powershell
   pwsh -File scripts/pack.ps1 -Plugin snow-novel-reader
   # 或 Windows PowerShell: powershell -ExecutionPolicy Bypass -File scripts\pack.ps1 -Plugin snow-novel-reader
   ```

   产物为 `dist/com.snow.novel-reader-<version>.zip`（`plugin.json` 位于 zip 根目录），脚本会输出 SHA-256。
3. 在本仓库创建 GitHub Release，把该 zip 作为 Release 资产上传。tag 用 `<插件 id 末段>/v<版本>` 形式（如 `com.snow.novel-reader` 对应 `novel-reader/v1.0.0`），避免同一仓库内多个插件的 tag 冲突。
4. 到索引仓库 [snow-plugin-store](https://github.com/MayDay-wpf/snow-plugin-store) 新增或更新 `app/plugins/com.snow.novel-reader.json`（一插件一文件，文件名等于插件 id），提交 PR：

   ```json
   {
     "id": "com.snow.novel-reader",
     "kind": "plugin",
     "name": { "default": "Novel Reader", "zh-CN": "小说阅读器", "zh-TW": "小說閱讀器" },
     "description": {
       "default": "Floating TXT novel reader with adjustable opacity and position, wheel and hotkey paging, auto hide on mouse leave, chapter detection and auto scroll.",
       "zh-CN": "悬浮 TXT 小说阅读器：可调透明度与显示位置，支持滚轮与快捷键翻页、鼠标移入显示移出隐藏，并带章节识别与自动滚动。"
     },
     "author": "azhu949",
     "repo": "https://github.com/azhu949/snow-plugins",
     "homepage": "https://github.com/azhu949/snow-plugins/tree/main/snow-novel-reader",
     "version": "1.0.0",
     "tag": "novel-reader/v1.0.0",
     "asset": "com.snow.novel-reader-1.0.0.zip",
     "downloadUrl": "https://github.com/azhu949/snow-plugins/releases/download/novel-reader%2Fv1.0.0/com.snow.novel-reader-1.0.0.zip",
     "sha256": "<pack.ps1 输出的 64 位十六进制哈希>",
     "icon": "lucide:BookOpen",
     "privacy": [],
     "tags": ["novel", "reader", "txt", "floating", "小说", "阅读器"]
   }
   ```

   注意：tag 含 `/` 时必须同时提供 `downloadUrl`（把 tag 中的 `/` 编码为 `%2F`）。客户端优先使用 `downloadUrl`，缺失时才按 `https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>` 推导，而斜杠会让推导结果产生路径歧义。

   本地可用 `node app/scripts/validate-registry.mjs`（在 snow-plugin-store 仓库内）先自校验。
5. CI 校验通过并合并后，客户端「插件市场」刷新即可安装或更新。

## 许可

以各插件目录内 `plugin.json` 的 `license` 字段为准（当前均为 MIT）。
