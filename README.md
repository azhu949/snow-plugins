# snow-plugins

Snow App 插件集合仓库。子目录包含两类插件：面板插件（发布打包根，`plugin.json` 位于目录根部）与客户端脚本插件（单文件 `.user.js`，无 `plugin.json`）。

## 插件列表

| 插件 | ID | 版本 | 说明 |
| ---- | -- | ---- | ---- |
| 小说阅读器 | `com.snow.novel-reader` | 1.3.0 | 悬浮 TXT 小说阅读器（可调透明度与显示位置、滚轮与快捷键翻页、章节识别与自动滚动）+ legado 书源导入、多源并发搜索与在线追书 |
| 修复工作台 | `com.snow.fix-bench` | 2.13.4 | 客户端脚本插件（`.user.js`）：聊天输入框工具栏扳手入口 + 居中浮层，完成代码审查 → issue 跟踪 → 批量修复 → 结果清理的闭环；项目切换、严重度筛选、结构化结果回写与清理确认 |
| Token 用量仪表 | com.snow.token-meter | 1.0.0 | 客户端脚本插件（.user.js）：默认悬浮在窗口顶部中间、与顶栏同一行的胶囊，常驻今日 token 与目录挂牌价估算花费（价格源可选 OpenRouter / models.dev，默认人民币，K/M/B 紧凑计数），浮层含累计/按模型拆分/手动映射 |

### 修复工作台：功能范围

- **形态是客户端脚本插件，不是面板插件**：产物为 `dist/snow-fix-bench.user.js`，在「插件 → 插件列表 → 脚本插件」中安装与启停，运行在默认沙箱档。
- 界面由脚本自建：聊天输入框工具栏左组（yolo 徽章右侧）的扳手入口，工具栏不渲染时回退到动作插槽 `chat.input.actions` + 居中浮层工作台（高度上限 620px，可拖动、双击标题栏复位，点击浮层外部收起）；左栏项目树按合集分组（合集名左侧带 Library 图标与颜色点），默认仅展开当前项目所在合集、其余折叠，支持点击展开与切换项目，右栏为「审查 / 提取 / 修复 / 清理」流程条与 issue 列表。不使用 `topbar.actions`。
- 审查：复用内置 `/review` 的范围选择与提示词规则，追加 `snow-issues` 结构化输出契约，仅把「严重 / 一般」写入工作台。沙箱档读不到 `window.snow` 文件树与 Git diff，审查范围以 `git` 元数据域的文件清单传给 AI，由 AI 只读读取文件并执行 `git diff`；审查消息使用宿主官方 `@@review:` 标签，显示为审查 chip。
- 修复：勾选 issue 新建会话，按内置批量修复流程（逐条取证 → 并行只读取证 → 冲突分析 → 最小范围实施 → 统一验证）执行，`snow-fix-results` 结构化结果自动回写状态。
- 清理：确认后归档 / 删除 issue，并归档 / 删除 / 保留对应会话；issue 数据存于脚本私有 `GM_*` 存储，按项目隔离。
- 自定义提示词：顶栏「提示词」入口展示审查 / 修复 / 复审三类提示词的完整结构——固定规则只读、附加要求可编辑（启用开关 + 多行文本，单槽 2000 字符上限），启用后注入对应提示词并声明固定规则优先；关闭或留空时行为与默认一致。
- 工作台只读跟踪会话进度，不中止 AI；Git 调用只有固定命令——读取提交记录的只读 `git log`、自动暂存收尾前的只读 `git rev-parse` 与 `git status`，以及开启「全部修复完成后自动暂存改动」时对修复结果里声明的文件执行 `git add`（不使用 `git add -A`，不提交、不推送），不联网。手动停止跟踪或跟踪报错后，活动卡片会保留在左栏右侧主区，可点「继续跟踪」恢复同一会话的轮询，或用「重新解析」直接读取最后回复。详细说明见 `snow-fix-bench/README.md`。

### 小说阅读器：功能范围

- 本地阅读：导入 TXT（可多选）、书架与目录、阅读进度、悬浮阅读窗（透明度 / 位置 / 字号 / 行高，配色跟随宿主主题）。
- 在线追书：导入 **legado 格式**书源（只支持 legado，不做其它阅读器格式适配；一次可导入多个源）、多源并发搜索、详情与目录分页抓取、章节正文缓存；响应走宿主原始字节通道并自动识别站点编码（GBK / GB18030 / UTF-16 等站点不再乱码）。
- 隐私：不内置任何书源、不后台联网；只有你主动点「搜索」或打开在线章节时，才会通过宿主网络通道访问书源里指定的站点。
- 「数据」页的「清空全部数据」会一并清掉书源与章节缓存（阅读设置与快捷键保留），二次确认时会列出清除范围。

### Token 用量仪表：功能范围

- **形态与入口**：客户端脚本插件（产物 `dist/snow-token-meter.user.js`），默认以悬浮胶囊停在窗口顶部中间、与顶栏同一行（可拖动，位置持久化），也可在设置里切成顶栏右侧徽标；元数据头声明 `@snow-target client`、`@snow-view *`、`@snow-scope global`，因此跨所有视图常驻，停用后徽标与浮层一并消失。不占用面板插件槽位。
- **用量与成本**：今日与累计概览，以及今日 / 近 7 天 / 近 30 天 / 全部四个周期；token 一律按 K/M/B 紧凑展示，按模型拆分 token 与估算花费，并展示缓存命中率、请求数、价格覆盖率与未计价 / 忽略 token。成本按所选价格目录（OpenRouter / models.dev）估算（默认人民币展示，汇率默认自动获取、可切手动），不是实际账单。用量域只提供整机合计，不按项目拆分。
- **价格同步**：只读宿主 `usage` 元数据域；价格目录可选 OpenRouter 模型接口或 models.dev 目录（只发 GET，地址可改；两个来源各存一份缓存），默认缓存 12 小时，同步失败时保留旧目录并在徽标与浮层标注；USD→CNY 汇率默认从 Frankfurter 获取（缓存 6 小时，失败回退手动值）。
- **模型匹配**：手工映射优先；models.dev 目录再按 `vendor/model` 渠道前缀、模型 id / canonical 跨渠道中位价取代表价；其后是精确 id / slug → 去厂商前缀 token 全等 → 连续 token 子序列。歧义或未匹配时在映射视图里搜索目录条目手动固定或忽略，忽略的模型不计成本。
- **隐私与联网**：元数据头只声明 `@snow-privacy usage`，只读聚合用量，不读会话、消息与密钥；除价格目录与汇率接口外不联网，无遥测；设置、目录、映射与汇率缓存存 `GM_*`。
- **交互**：悬浮胶囊（默认窗口顶部中间，位置持久化）或顶栏徽标，浮层可钉住（钉住后点击外部不关闭，Esc 仍关闭）；默认每 30 秒自动刷新；颜色只用宿主主题 token，深浅色自动跟随。开发与安装细节见 `snow-token-meter/README.md`。

## 目录结构

```
snow-plugins/
  snow-novel-reader/          面板插件（发布打包根）
    plugin.json               插件清单（id / version / panels / locales / styles / privacy）
    index.js                  构建产物（默认导出 React 面板组件；兼容 export function mount(container, api)）
    src/                      工程化源码
      main.js                 入口导出（default / mount）与引擎缓存
      constants.js            存储键与容量常量
      config.js               阅读设置默认值、收敛规则与键位绑定
      i18n.js                 语言包缺失时的内置中文兜底
      utils.js                通用小工具
      ui/assets.js            字体栈、阅读主题、图标几何与面板标签
      legado/                 书源规则引擎（表达式、净化、DOM/CSS、查询、求值与业务动作）
      engine/create-engine.js 引擎编排：状态、存储、悬浮阅读窗与 React 面板视图
    build.mjs                 esbuild 打包：src/ → 单文件 ESM（index.js）
    package.json              构建脚本与依赖（version 与 plugin.json 保持一致）
    style.css                 面板与悬浮阅读窗样式
    locales/                  zh-CN / zh-TW / en 语言包
    icon.svg                  插件图标
  snow-fix-bench/             客户端脚本插件（无 plugin.json）
    src/                      源码模块（constants / util / parse / issues / prompts / store / engine）
      script/                 脚本装载层（api.js 适配 snow/GM，main.js 聊天输入框入口与浮层）
      ui/                     内置 Preact 组件（host / components / dialogs / panel）
    build.mjs                 esbuild 打包脚本：IIFE + UserScript 元数据头 + 内联样式
    test/                     纯函数与引擎运行时测试（npm test）
    dist/snow-fix-bench.user.js  构建产物（安装到脚本插件的就是它，不入库）
    locales/ style.css README.md
  snow-token-meter/           客户端脚本插件（无 plugin.json）
    src/                      源码模块（constants / cost / match / pricing / settings / usage / util / store / engine / i18n）
      script/                 脚本装载层（api.js 适配 snow/GM，main.js 悬浮胶囊 / 顶栏徽标与浮层）
      ui/                     内置 Preact 组件（format / icons / meter-panel）
    build.mjs                 esbuild 打包脚本：IIFE + UserScript 元数据头 + 内联样式
    test/                     核心纯函数与 JSDOM 挂载冒烟测试（npm test）
    dist/snow-token-meter.user.js  构建产物（安装到脚本插件的就是它，不入库）
    locales/ style.css README.md
  sources/                    本地 legado 书源合集（已加入 .gitignore，见 sources/README.md）
  scripts/
    pack.ps1                  面板插件打包脚本：排除开发文件、校验入口产物，生成可发布的 zip 并输出 SHA-256
  dist/                       打包产物（已加入 .gitignore）
  .snow/                      本地测试与开发脚本（已加入 .gitignore）
```

## 本地开发与调试

### 面板插件（snow-novel-reader）

通过 Snow App 的 `config` 工具（`plugins` 域）把插件目录安装到本机，安装位置为 `~/.snowapp/plugins/com.snow.novel-reader/`。

工程化源码位于 `snow-novel-reader/src/`，`index.js` 是 esbuild 打包出的单文件 ESM 产物；宿主只读取入口文件，源码里的相对 `import` 不会被解析（宿主文档「工程化源码与单文件打包」）。修改源码后先构建：

```powershell
cd snow-novel-reader
npm install        # 首次
npm run build      # src/ → index.js
npm run check      # node --check index.js
```

然后安装到本机：

```
config-set scope=plugins key=com.snow.novel-reader value={sourceDir: "D:/ai-workspace/snow-plugins/snow-novel-reader"}
```

- 修改源码后重新执行一次上面的安装即可原地更新，插件启用状态保留。
- 只修改了安装目录内的文件时，可用 `value={rescan: true}` 重新读取清单。

### 客户端脚本插件（snow-fix-bench）

```powershell
cd snow-fix-bench
npm install
npm run build      # src → dist/snow-fix-bench.user.js
npm run check      # node --check 产物
npm test           # 纯函数与引擎运行时测试
```

安装 / 更新到本机（脚本插件用 `userscripts` 域；首次安装 `key="new"`，更新时传已有 scriptId）：

```text
config-set scope=userscripts key="new" value={sourcePath: "D:/ai-workspace/snow-plugins/snow-fix-bench/dist/snow-fix-bench.user.js"}
```

- 脚本保存后立即生效；浮层代码更新后建议关闭再打开工作台。
- 脚本运行在默认沙箱档：应用数据经 `snow.metadata` / `snow.write`，敏感域写在元数据头 `@snow-privacy`；不能使用 `window.snow` 的文件树与 Git diff。

开发规范以内置文档为准：
  - `~/.snowapp/docs/zh-CN/2-使用指南/22-油猴脚本.md`
  - `~/.snowapp/docs/zh-CN/2-使用指南/24-插件开发与安装.md`
  - `~/.snowapp/docs/zh-CN/3-参考手册/6-插件元数据域参考.md`

## 发布到插件市场

### 面板插件（snow-novel-reader）

1. 同步修改 `package.json` 与 `plugin.json` 的 `version`（构建脚本会校验两者一致），在 `snow-novel-reader` 下执行 `npm run build`，提交并推送本仓库。
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
       "default": "Novel reader with a floating TXT reading window (adjustable opacity and position, wheel and hotkey paging, auto hide on mouse leave, chapter detection and auto scroll), plus legado book-source import, multi-source search and online chapter reading with caching.",
       "zh-CN": "小说阅读器：悬浮 TXT 阅读窗（可调透明度与显示位置、滚轮与快捷键翻页、鼠标移入显示移出隐藏、章节识别与自动滚动），并支持导入 legado 书源、多源并发搜索、在线追书与章节缓存。"
     },
     "author": "azhu949",
     "repo": "https://github.com/azhu949/snow-plugins",
     "homepage": "https://github.com/azhu949/snow-plugins/tree/main/snow-novel-reader",
     "version": "1.3.0",
     "tag": "novel-reader/v1.3.0",
     "asset": "com.snow.novel-reader-1.3.0.zip",
     "downloadUrl": "https://github.com/azhu949/snow-plugins/releases/download/novel-reader%2Fv1.3.0/com.snow.novel-reader-1.3.0.zip",
     "sha256": "<pack.ps1 输出的 64 位十六进制哈希>",
     "icon": "lucide:BookOpen",
     "privacy": ["network"],
     "tags": ["novel", "reader", "txt", "floating", "小说", "阅读器"]
   }
   ```

   `sha256` 字段先保留占位符，以 `pack.ps1` 实际输出回填后再提交 PR。

   注意：tag 含 `/` 时必须同时提供 `downloadUrl`（把 tag 中的 `/` 编码为 `%2F`）。客户端优先使用 `downloadUrl`，缺失时才按 `https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>` 推导，而斜杠会让推导结果产生路径歧义。

   本地可用 `node app/scripts/validate-registry.mjs`（在 snow-plugin-store 仓库内）先自校验。
5. CI 校验通过并合并后，客户端「插件市场」刷新即可安装或更新。

### 客户端脚本插件（snow-fix-bench、snow-token-meter）

- 以单文件 `.user.js` 分发，不使用 `scripts/pack.ps1`，也没有 `plugin.json` 与目录 zip。
- 发布前在 `snow-fix-bench` 下执行 `npm run build`，把 `dist/snow-fix-bench.user.js` 作为 Release 资产上传；元数据头 `@version` 与 `package.json` 版本保持一致。
- 市场索引条目使用 `kind: "script"`，下载地址指向该 `.user.js` 资产，`sha256` 取构建产物的 SHA-256。
- `snow-token-meter`：发布前在其目录下执行 `npm run build`，把 `dist/snow-token-meter.user.js` 作为 Release 资产上传；`@version` 由构建脚本从 `package.json` 写入，两者始终一致。
- `snow-token-meter` 的市场索引条目同样使用 `kind: "script"`，下载地址指向该 `.user.js` 资产，`sha256` 取产物的 SHA-256；`id` 与元数据头 `@namespace` 一致（`com.snow.token-meter`）。

## 许可

以各插件目录内的 `plugin.json`（面板插件）或 `package.json`（脚本插件）的 `license` 字段为准；本项目插件均为 MIT。`snow-fix-bench` 的许可全文与第三方声明见其目录下的 `LICENSE` 与 `THIRD-PARTY-NOTICES.md`。

