# 翻译助手（snow-translator）

Snow App 客户端脚本插件：在聊天输入工具栏放一个翻译图标（默认排在**修复工作台**扳手图标右侧），
提供浮层翻译、划词翻译、AI 回复翻译与输入框回写四种用法。

## 功能

- **浮层翻译**：点工具栏图标打开浮层，输入或粘贴文本，选源语言 / 目标语言后翻译；支持 Ctrl + Enter 立即翻译、复制译文、交换语言、拖拽移动。第一次打开落在聊天输入框上方并水平居中于输入框；一旦**你把它拖到自己想要的位置**，那个位置就成为默认位置——之后打开都回到这里，挪到别处后点设置页「恢复默认设置」也会回到这里。设置页高度不同，不参与位置记忆，切回翻译页会还原翻译页的位置。
- **目标语言自动**：源语言与目标语言都默认「自动检测」。目标语言选自动时按文本语种择向——中文译成英文，其它语种译成界面语言（简体中文 / 繁体中文 / 英文，英文界面下英文文本保持英文）。
- **自动翻译**：翻译页有一个「自动翻译」开关（默认开启），停止输入约 0.7 秒后自动翻译；同样的文本与语言不会重复请求，关闭后回到手动点「翻译」。
- **划词翻译**：在聊天消息区选中任意文字，选区下方浮出「翻译」按钮，点击后就地弹出译文卡片。
- **AI 回复翻译**：每条 AI 回复的操作栏右侧多一个翻译按钮，一键整段译成当前目标语言，结果以卡片展示。
- **输入框回写**：「读入输入框」取走聊天输入框里的草稿，「写回输入框」把译文替换回输入框。
- **设置页**：浮层右上角齿轮进入，可切换引擎、填写密钥、开关交互项、设置默认语言、测试连接。

## 翻译引擎

| 引擎 | 是否需要密钥 | 说明 |
| --- | --- | --- |
| 谷歌翻译（默认） | 否 | `translate.googleapis.com` 免费接口 |
| 微软翻译 | 否 | Edge 内置接口 `edge.microsoft.com/translate/translatetext`（免授权、免密钥；请求需带浏览器 UA）。该域名可直连，部分代理会在 TLS 握手阶段中断，遇到「网络请求失败」时优先怀疑代理 |
| 百度翻译 | 是 | `fanyi-api.baidu.com` 通用文本翻译，APP ID + 密钥，签名按官方规则 `MD5(appid + q + salt + 密钥)` |
| DeepL | 是 | 免费版 / 专业版域名自动区分 |
| 大模型（OpenAI 兼容） | 是 | 任意兼容 `/chat/completions` 的服务，可自定义提示词 |

默认开启「主引擎失败时自动回退到免费引擎」：按 谷歌 → 微软 的顺序兜底，
自填密钥的引擎报错（限流、认证、网络）时也不会让翻译直接失败。

长文本按段落边界切分成不超过 3200 字符的分片后串行翻译，再按原顺序拼接。

## 提示与排错

- **点击浮层外部收起**：点聊天区、输入框或窗口任意空白处都会关掉浮层；入口按钮、划词按钮、消息按钮除外（它们负责唤起界面）。划词 / 消息翻译卡片同样点外部收起，Esc 仍然可用。
- **同一时刻只有一套界面**：从卡片点「在面板中打开」会先收起卡片；划词或点消息按钮打开卡片时会先收起浮层。
- **顶部状态点**只表示最近一次「测试连接」的结果：灰色未测试、绿色成功、红色失败；密钥要求与测试时间在悬停提示里，不再用颜色暗示「无需密钥」。
- **测试连接失败**时，设置页底部会给出结论、HTTP 状态、耗时、具体原因（代理未连通 / TLS 握手中断 / 域名解析失败 / 请求超时 / 断网 / 连接被拒）、下一步建议，以及可复制的原始错误（形如 `TranslateError · net::ERR_SSL_PROTOCOL_ERROR`）。
- **翻译失败**时，结果区同样给出原因与建议，而不是只显示一句「请检查网络或代理」。
- 常见情形：谷歌翻译可直连但在国内常被阻断，微软翻译可直连但常被代理中断——两台通道都不可用时，先确认代理规则，再切换引擎。

## 工程与构建

```powershell
cd snow-translator
npm install
npm run build     # 产出 dist/snow-translator.user.js
npm run check     # node --check 语法校验
```

产物是单文件 IIFE + UserScript 元数据头（`@snow-target client`、`@snow-scope global`），
无 `plugin.json`，源文件在 `src/`，样式在 `style.css`，三语文案在 `locales/`。

## 安装

用 `config-manage` 的 `userscripts` 域安装，key 用列表里已有的 scriptId（不要用 `new`，否则会重复安装）：

```
config-manage action=set scope=userscripts key=com.snow.translator value={sourcePath:"<绝对路径>/dist/snow-translator.user.js"}
config-manage action=set scope=userscripts key=com.snow.translator value={enabled:true}
```

更新后需重载窗口（或停用再启用脚本）才生效。

## 目录

```
snow-translator/
├─ build.mjs                 # esbuild 打包 + 元数据头 + 产物校验
├─ style.css                 # 浮层 / 卡片 / 入口按钮样式（全部取宿主主题 token）
├─ locales/                  # zh-CN / zh-TW / en
├─ src/
│  ├─ constants.js           # 存储键、默认设置、分片与缓存上限、兜底文案
│  ├─ i18n.js                # 三语字典与插值
│  ├─ languages.js           # 语言清单、各引擎语言码映射、语言显示名
│  ├─ settings.js            # 设置校验 / 读写（GM_*）
│  ├─ store.js               # 命令式状态 → Preact 的单向桥
│  ├─ error-text.js          # 错误码 → 本地化文案
│  ├─ engine/                # baidu / bing / google / deepl / openai + 调度、分片、错误
│  ├─ host/                  # 工具栏入口、输入框读写、划词按钮、消息按钮
│  ├─ ui/                    # 浮层（含设置页）、结果卡片、图标
│  └─ script/main.js         # 入口：装配 store / 引擎 / UI / 宿主事件
└─ test/                     # （暂无；按约定不主动新增测试）
```

## 数据与隐私

- 设置（含 API Key）、浮层位置存在宿主 `userscript_values` 表，按 scriptId 隔离。
- 不声明 `@snow-privacy`：脚本不读取会话元数据，AI 回复文本通过 DOM 取用。
- 翻译请求经 `snow.fetch` 走主进程发出（绕过 CORS），只发往所配置的翻译接口。
