# Token 用量仪表（snow-token-meter）

Snow App **客户端脚本插件**：默认以可拖动的悬浮胶囊停在窗口顶部中间（与顶栏同一行），常驻显示今日 token 总量与估算花费，点击展开浮层，查看今日 / 累计 / 周期用量、按模型拆分与手动模型映射；也可在设置里切成顶栏徽标。

## 定位与形态

- 这是**客户端脚本插件**（脚本插件），入口是「插件 → 插件列表 → 脚本插件」，安装、启停与编辑都在那里完成，不走 `config-set scope=plugins`，也没有 `plugin.json` 与 `renderMode`。
- 产物是单文件 `dist/snow-token-meter.user.js`，元数据头声明 `@snow-target client`、`@snow-view *`、`@snow-scope global`、`@snow-privacy usage`，运行在默认沙箱档（未声明 `@snow-sandbox`，不使用 `unsafeWindow` / `window.snow`）。
- 也**不是浏览器油猴脚本**：它不注入内置浏览器的网页，只注入 Snow App 桌面窗口本身。
- 安装并启用后，默认形态是 `position: fixed` 的悬浮胶囊，徽标节点直接挂在 `body` 下（不放进顶栏插槽：顶栏卡片的 `backdrop-filter` 会成为 fixed 的包含块，按视口算出的坐标会被当成卡片内坐标），停在窗口顶部中间（与顶栏同一行垂直居中，按会话消息列水平居中）；拖动后位置写入设置，重启仍停在原处。设置里切成「顶栏」后，徽标才挂进 `topbar.actions` 插槽。`@snow-scope global` 让它在所有视图里都在；点击徽标展开浮层。停用或卸载后徽标与浮层一并消失（脚本在 `snow.onCleanup` 里移除节点、样式、监听与定时器）。
- 界面由脚本自建：徽标是直接的 DOM 节点，浮层是 `body` 下的独立 Preact root，关闭时只隐藏不卸载。

## 功能

- **徽标**：图标 + 今日 token（紧凑写法 `999` / `1.2K` / `1.23M` / `2.5B`）+ 今日估算花费（默认人民币）；可在设置里改成显示累计。悬停 title 给出今日输入 / 输出 / 缓存读取（同样按 K/M/B）、请求数、累计 token 与花费、价格同步时间与告警。
- **告警点**：价格同步失败、目录使用缓存（stale）、缺少 `@snow-privacy usage` 声明、今日价格覆盖率低于 95% 时，徽标右上角出现琥珀点，title 里列出具体原因。
- **浮层概览**：今日与累计两张卡片，各自展示 token 总数（K/M/B 紧凑写法）、估算花费（主币种 + 另一种币种的近似值）与请求数；底部按当前价格来源注明「按 OpenRouter 目录价估算」或「按 models.dev 跨渠道中位价估算」。
- **周期统计**：今日 / 近 7 天 / 近 30 天 / 全部四个 tab；每个周期展示 token（K/M/B）、估算花费、请求数、缓存命中率（cache read / input）、按模型明细（按 token 降序，最多 50 条，其余折叠为「还有 N 个模型」）。
- **按模型明细**：每行显示用量模型名、token 数、估算花费与匹配状态（精确 / 归一化 / 模糊≈ / 手动 / 渠道匹配 / 跨渠道 / 未匹配 / 已忽略）；点状态徽标进入映射视图。
- **模型映射**：候选条目一键固定、标记忽略、恢复自动匹配；也可按渠道、id 或名称搜索价格目录并固定，列表里显示「渠道/id」与「输入 / 输出，每 1M token」单价。映射后成本立即重算，不需要重新拉用量。
- **底部状态**：价格覆盖率、未计价 token、忽略 token、目录条数与「刷新」按钮（同时刷新用量和价格目录）。
- **悬浮胶囊**：默认形态。徽标是视口内的胶囊（`position: fixed`），停在窗口顶部中间（与顶栏同一行垂直居中，按会话消息列水平居中），可按住拖动，松手后位置写入设置、重启后仍在原位；窗口变小或换到小屏时按当前视口夹取，完全越界则回到默认位；设置里切到「顶栏」会清空保存的坐标，徽标回到 `topbar.actions` 插槽。
- **钉住浮层**：浮层右上角图钉可钉住，钉住后点击浮层外部不再关闭，Esc 仍可关闭；未钉住时点击外部收起。
- **设置**：默认项排在各自下拉的第一位——显示货币（CNY / USD）、刷新间隔（30 / 60 / 120 / 300 秒）、展示形态（悬浮 / 顶栏）、徽标显示（今日 / 累计）、汇率来源（自动获取 / 手动填写）；自动模式下汇率框只读显示实际获取到的汇率，手动模式下可编辑；另有手动汇率（0.1–20，步进 0.0001，自动失败时回退）、目录缓存（1 / 6 / 12 / 24 / 72 / 168 小时）、API 档案过滤（留空 = 全部档案）、自动刷新开关，以及「刷新价格」「刷新汇率」「清除目录缓存」「重置默认设置」「重置悬浮位置」「重置全部映射」。汇率源 URL、价格来源（OpenRouter / models.dev）与价格源 URL 收在底部的「数据源设置」里，点击展开后编辑并保存；切换价格来源会自动换成该源的默认接口。「重置默认设置」只把设置写回默认值，手工映射、价格目录与汇率缓存保留；「重置悬浮位置」只清悬浮坐标，其它设置不变；「清除目录缓存」「重置默认设置」「重置全部映射」放在独立的危险操作区，需要再点一次确认。
- **刷新时机**：打开浮层、手动刷新、`stream-end` 后 1.5 秒（合并连续流式结束）、按刷新间隔的自动刷新；刷新之间有 10 秒最小间隔（打开浮层与流式结束触发的刷新同样受节流，同一时刻只跑一次请求），只有手动刷新、切换周期 / 档案与重置设置会立即请求；同一 API 档案口径下，全部历史区间 5 分钟内复用上次结果。
- **语言与主题**：文案跟随宿主语言（`zh-CN` / `zh-TW` / `en`，缺失键回退简体中文）；颜色只用宿主主题 token（文字 / 线 / 表面 / 强调色 / 圆角），深浅色自动跟随，没有硬编码深色主题。

## 数据口径

- 用量只读宿主 `usage` 元数据域：`snow.metadata.get(["usage"], { params: { since, until, profileName } })`，区间用本地时间文本（`YYYY-MM-DD HH:MM:SS`）。今日是当天 `00:00:00`–`23:59:59`，近 N 天含今天，全部历史从 `2000-01-01 00:00:00` 起。
- `totalTokens = input + output`：一律按 `input + output` 重算，不读取宿主返回的 `summary.totalTokens`（逐模型同样）。cache read 与 cache creation **都是 input 的子集**，不重复计入总量。
- 逐模型拆分（`src/cost.js::splitModelTokens`）先做夹取：`cacheRead = min(cacheRead, input)`、`cacheCreation = min(cacheCreation, input - cacheRead)`，两者互不重叠。
- 成本公式（USD，逐模型求和）：

  ```text
  nonCachedInput   = input - cacheRead - cacheCreation
  billableRequests = max(0, totalRequests - errorRequests)

  cost = nonCachedInput   * prompt
       + cacheRead        * cacheRead
       + cacheCreation    * cacheWrite
       + output           * completion
       + billableRequests * request
  ```

  每个分项与单模型总价按 8 位小数取整，全部模型求和后再取整一次。
- 单价来自所选价格目录，统一换算成 USD/token。OpenRouter 用 `pricing` 字段：`input_cache_read` / `input_cache_write` 缺失时**回退 `prompt`**，`request` 缺失时按 0。models.dev 的 `cost` 是 USD / 百万 token，读取时除以 `1e6`；`cache_write` 明确写 0 时按 0，只有字段缺失才回退输入价。两者都不使用 `internal_reasoning`（无法区分推理 token）。
- models.dev 模式的匹配顺序：手工映射 → `vendor/model` 前缀命中该渠道 → 模型 id 跨渠道中位价 → `canonical_model_id` 跨渠道中位价 → 折叠后的精确 / 归一化 / 模糊。同一模型有几十个渠道条目时折叠成一个代表，避免整片歧义。
- 只有匹配状态为 `exact` / `normalized` / `fuzzy` / `manual` / `provider` / `canonical` 的模型计入成本；`unmatched` 只累计未计价 token，`ignored` 单独统计，两者成本为 0。
- 价格覆盖率 `coverage = pricedTokens / (totalTokens - ignoredTokens)`，用于底部状态和 95% 告警阈值；全部 token 都被忽略时按 100% 处理。
- 金额展示：默认 CNY。USD 按大小自适应小数位（`$0.0012` / `$0.123` / `$1.85` / `$1,234`）；CNY 由 `USD × 当前汇率` 换算（汇率默认自动获取，失败回退手动值），固定两位小数（`¥13.30`）。概览卡片主金额按设置币种，并用「≈」并列显示另一币种（周期统计行只显示主币种）；徽标只显示主币种。
- **这是按目录挂牌价估算的花费，不是实际账单**：真正的计费还受套餐、折扣、条件价、推理 token 计价等影响。走包月套餐时，按 token 复算的金额只是「等价刊例成本」，不是实际支出。

## 价格与汇率同步

- 价格来源有两条，可在「数据源设置」里切换：
  - `OpenRouter`（默认）：`GET https://openrouter.ai/api/v1/models?output_modalities=all`，单一渠道目录，模型 id 唯一。
  - `models.dev`：`GET https://models.dev/api.json`，按 provider 收录各厂商与中转站挂牌价（约 8500 条），更适合判断「某个渠道大概收多少」。
- 两个来源各占一个缓存键（`tokenmeter:catalog` / `tokenmeter:catalog:modelsdev`），来回切换不会互相覆盖。本地目录用定长数组存储，models.dev 目录约 1 MB。
- 自定义地址仍可用：只要响应结构与被选来源一致即可（OpenRouter 是 `{ data: [...] }`，models.dev 是 `{ providerId: { models: {...} } }`）。地址只接受 **https 公网主机**，`localhost`、内网主机名、回环地址与私网段会被拒绝并回退到默认接口。
- 目录默认缓存 12 小时（设置范围 1–168 小时）。命中缓存且未过期时直接用本地目录；过期才请求网络。
- 请求失败时**保留旧目录**并标记 `stale`，浮层顶部与徽标 title 显示同步失败原因；换了价格源地址后请求失败时不沿用旧地址的目录（避免按旧源计价），按无目录处理。失败后 5 分钟内的自动刷新不再重试，手动「刷新价格」立即生效。本地没有任何目录时价格不可用，成本按 0 计算并在浮层里提示。
- 并发的目录请求按「价格源 + 缓存键 + URL」合并成一次网络调用，`force` 不参与合并键：「刷新价格」遇到在途的同身份请求会直接复用它；「刷新价格」与「清除目录缓存」会绕过 TTL 与失败冷却重新拉取。汇率请求的合并键包含强制标记，强制刷新会另发一次。
- 汇率默认请求 `GET https://api.frankfurter.app/latest?from=USD&to=CNY`（ECB 参考价，免密钥），可在设置里改成任何返回 `{ rates: { CNY: number } }` 的 https 公网接口；只取 `rates.CNY`。设置页在自动模式下只读显示当前汇率，切到手动时会先用当前自动汇率预填。
- 汇率缓存 6 小时，随用量刷新一起检查，不额外增加请求频率；「刷新汇率」强制重新拉取。失败时保留旧汇率并标记 `stale` / `error`，失败后 5 分钟内的自动刷新不再重试，本地没有任何汇率时才回退手动值（默认 7.2）。
- 隐私边界：只发 GET 价格目录与汇率，不发送本地用量、会话内容、模型映射或密钥；除这两个地址外脚本不发起任何网络请求。请求经应用主进程代发，按宿主约定沿用当前会话 Cookie，所以地址必须是可信的 https 公网站点。

## 模型匹配

匹配顺序固定（实现见 `src/match.js`）：

OpenRouter 目录：

1. **手工映射优先**：映射键是模型名小写（大小写不敏感），值是目录条目 `id`（OpenRouter）、`provider/id`（models.dev，可固定渠道）或 `__ignore__`；旧版纯 `id` 映射继续有效。解析时整串 `id` 优先，其次按第一个 `/` 拆分渠道与模型；映射到不存在的条目时按未匹配处理。
2. **精确**：用量模型名与目录条目的 `id` 或 `slug`（`canonical_slug`）忽略大小写相等。例如用量名是某个条目的 `canonical_slug`（如 `openai/gpt-6.1-sol-20260929`）时，会直接命中该条目 `openai/gpt-6.1-sol`。
3. **归一化**：去掉厂商前缀（第一个 `/` 之前的部分）后，token 序列与条目的 id 或 name 完全一致。模型名先转小写、按非字母数字切分，点号保留给版本号（`v4.1` / `5.3`）。命中多个条目视为歧义。
4. **连续 token 子序列**：用量名里出现目录条目的完整连续 token 序列（至少 2 个 token），容忍代理前缀、区域、日期、噪声后缀。得分是命中的 token 长度，得分最高的条目唯一时才算命中；**同分不同条目视为歧义**。

models.dev 目录在上面第 1 步之后、第 2 步之前多两层：

1. **渠道**：用量名形如 `vendor/model` 时，只在该 provider 自己的条目里匹配，命中就用该渠道挂牌价（状态 `provider`）。例如 `opencode-go/deepseek-v4.1-flash` 用 opencode-go 的价格。
2. **模型身份**：把用量名去掉路径、括号、方括号与 `:variant` 得到裸 id，先按「同 id 多渠道」取中位挂牌价，再按 `canonical_model_id` 取中位价（状态 `canonical`）。同一模型折叠成一个代表后再走精确 / 归一化 / 模糊，避免几十个渠道条目造成整片歧义。

补充规则：

- `:` 变体（如 `:batch`、`:free`）不自动参与：只有当用量模型名带同一个变体时，带该变体的目录条目才进入候选；`~` 开头的 latest 别名永不参与自动匹配。models.dev 模式下带变体时也不做身份归一。
- 歧义与未匹配都不会猜一个「最像」的条目，而是要求手动映射，避免把成本记到错误模型上。
- 忽略的模型不计成本，也不进入覆盖率分子与分母。
- 本机常见代理别名示例：`opencode-go/deepseek-v4.1-flash` 与 `moonshotai/kimi-k3` 在 models.dev 下按渠道精确命中；`deepseek-v4.1-flash` 按同 id 跨渠道中位价命中；`DeepSeek-Flash` 在 models.dev 下命中 deepseek 官方的 `deepseek-flash`，在 OpenRouter 下仍停在未匹配；`qwen3.8-max` 两种目录都可能停在未匹配，需要手动映射或忽略。

## 隐私与联网

- 元数据头只声明 `@snow-privacy usage`；脚本只读聚合用量，不读会话、消息、文件、Git 或 API 密钥，也不写任何应用数据（不使用 `snow.write`）。
- 本地持久化只用 `GM_*`：`tokenmeter:settings`（设置）、`tokenmeter:catalog`（OpenRouter 目录）、`tokenmeter:catalog:modelsdev`（models.dev 目录）、`tokenmeter:mappings`（手工映射）、`tokenmeter:fx`（汇率缓存）；`src/constants.js` 另预留 `tokenmeter:ui`，当前版本未写入。浮层的展开状态不持久化。
- 存储内容损坏时，先把原始值备份到 `<键>:corrupt`，再回退默认值，避免脚本启动失败。
- 无遥测、无埋点；联网只发生在价格目录与汇率同步。

## 安装、更新与卸载

下面的 `config-set` / `config-delete` 是 Snow App 的 `config` 工具调用（由 AI 在对话里执行），不是 shell 命令；路径用 Windows 绝对路径。

首次安装（`key="new"`）：

```text
config-set scope=userscripts key="new" value={sourcePath: "D:/ai-workspace/snow-plugins/snow-token-meter/dist/snow-token-meter.user.js"}
```

更新已安装脚本：`key` 必须是宿主分配的 **scriptId（UUID）**，不是元数据头里的 `@namespace`（拿 `@namespace` 当 key 会查不到记录）。本机当前为 `1a5f3275-0349-4f28-b84f-e8cc0d69c681`（换机器会不同，用 `config-list scope=userscripts` 查自己那一条的 `scriptId`）：

```text
config-set scope=userscripts key="1a5f3275-0349-4f28-b84f-e8cc0d69c681" value={sourcePath: "D:/ai-workspace/snow-plugins/snow-token-meter/dist/snow-token-meter.user.js"}
```

启停：

```text
config-set scope=userscripts key="1a5f3275-0349-4f28-b84f-e8cc0d69c681" value={enabled: false}
config-set scope=userscripts key="1a5f3275-0349-4f28-b84f-e8cc0d69c681" value={enabled: true}
```

卸载（会同时删除数据库记录与磁盘上的 `.user.js`，需要确认）：

```text
config-delete scope=userscripts key="1a5f3275-0349-4f28-b84f-e8cc0d69c681" confirmed=true
```

安装后的脚本文件位于 `~/.snowapp/browser-script/<scriptId>.user.js`。也可以在「插件 → 插件列表 → 脚本插件」里直接启用 / 停用 / 编辑 / 删除。

## 开发

```powershell
cd D:\ai-workspace\snow-plugins\snow-token-meter
npm install        # 首次：esbuild、jsdom、preact
npm run build      # src/script/main.js → dist/snow-token-meter.user.js（IIFE + 元数据头 + 内联样式）
npm run check      # node --check 产物
npm test           # pretest 会先构建，再用 node --test 跑全部测试
```

- `npm test` 覆盖核心纯函数（`cost` / `match` / `pricing` / `settings` / `usage` / `util` / `engine`）与一套 JSDOM 挂载冒烟测试；冒烟测试直接加载 `dist` 产物，验证「插槽挂载 → 徽标 → 浮层 → 设置视图 → 清理还原」的真实链路。当前共 82 项（核心 80 + UI 冒烟 2）。
- 构建脚本以 `package.json` 的 `version` 为唯一来源，写入元数据头 `@version`；构建后校验产物以 `// ==UserScript==` 开头并包含 Preact 的 MIT 许可声明，失败时保留旧产物。
- 版本规则：功能改动、修 bug、重构、补测试都不升版本；版本号只在发布流程中按用户指定的目标版本修改。

## 目录结构

```text
snow-token-meter/
  src/
    constants.js        存储键、周期、默认设置、价格与汇率 URL、各类限额
    cost.js             token 拆分、逐模型成本、覆盖率与未计价统计
    match.js            模型名 → 目录条目（手工 / 渠道 / 模型身份 / 精确 / 归一化 / 子序列 / 歧义）
    pricing.js          OpenRouter 与 models.dev 目录抓取、精简、持久化与 TTL 缓存
    fx.js               USD→CNY 汇率抓取、持久化与 TTL 缓存
    settings.js         设置与映射的归一化、范围收敛
    usage.js            usage 元数据域读取与错误分类
    util.js             本地日期区间、紧凑 token、金额与 JSON 工具
    store.js            极简订阅式状态容器
    engine.js           并行拉取今日 / 周期 / 全量用量，合并目录并重算成本
    i18n.js             三语言字典与回退
    script/
      api.js            宿主能力探测、GM_* JSON 存储、snow.metadata 适配
      main.js           注入样式、挂载徽标 / 悬浮胶囊与浮层、拖动、定位、清理
    ui/
      format.js         币种、金额、比例、相对时间格式化
      icons.js          内联 SVG 图标
      meter-panel.js    主视图 / 设置视图 / 映射视图（Preact）
  build.mjs             esbuild 打包：IIFE + UserScript 元数据头 + 许可声明
  style.css             徽标与浮层样式（构建时内联）
  locales/              zh-CN / zh-TW / en 语言包（构建时打入脚本）
  test/                 核心单测 + JSDOM 冒烟测试
  dist/snow-token-meter.user.js  构建产物（安装到脚本插件的就是它，不入库）
```

## 已知限制与故障排查

**已知限制**

- 代理别名不会被强行猜测：本机实测 `qwen3.8-max` 在两种目录下都可能停在未匹配（没有候选或同分歧义），需要手动映射或忽略。
- 所选目录里没有的模型无法计价，只统计为「未计价 token」，不会影响已匹配模型的成本。两个来源覆盖范围不同：OpenRouter 只有自家上架模型，models.dev 按渠道收录 8000 多条但对小众中转站也可能缺失。
- models.dev 同一模型跨渠道价差可能达到数倍。本插件按「同 id 多渠道中位价」取一个代表值，并在浮层底部注明来源；自动匹配不区分你实际走的是哪条渠道（只有模型名带 `vendor/model` 前缀时才按渠道取价），手动映射可用 `provider/id` 固定到指定渠道。
- 订阅套餐类 provider（`umans-ai-coding-plan`、`zai-coding-plan` 等）在 models.dev 的 `cost` 全为 0，命中后成本显示 0；这是刊例口径，不代表你的实际支出。
- models.dev 的上下文分层价（`tiers`）与 1 小时缓存写价（`cache_write_1h`）未实现：`usage` 域只有周期聚合，无法按单次请求的输入规模选档，也没有 1h / 5m 缓存写的拆分。硬套会把整段时间的总量当成一次请求，反而更不准。
- 汇率默认从 Frankfurter（ECB 参考价）获取，是每日参考价而非实时成交价，周末与节假日不更新；自动获取失败时回退手动值（默认 7.2）。改汇率只影响 CNY 展示，不改变 USD 估算。
- 条件价（`pricing.overrides`）与推理 token 单价未应用；成本始终是正文 token 口径的估算。
- CNY 金额固定两位小数，极小成本会显示 `¥0.00` / `¥0.01`。
- 浮层位置只在打开、窗口 resize、视图切换与拖动时重算，不监听宿主布局动画；徽标与浮层都不随滚动移动，因此不监听 scroll；默认悬浮位置按 `chat.messages`（其它视图回退 `main.view`）的水平中心与 `topbar` 的垂直中心计算，量不到时按 CSS 的顶部居中与 8px 兜底。悬浮胶囊挂在 `body` 下并使用 `position: fixed`（正是为了避开顶栏插槽祖先的 `transform` / `filter` 包含块）；顶栏形态的徽标是插槽内的普通节点，按顶栏布局定位。
- 「重置全部映射」不可撤销：一次写入空映射表并只重算一次成本（`engine.clearMappings`），映射条数与写入次数无关；重置后需要重新设置全部手工固定与忽略。
- 写入 `GM_*` 失败时，保存设置与重置操作会提示「写入失败」，改动只在当前会话生效、重启后回退；价格目录缓存写入失败仍不提示，表现是每次刷新重新下载目录。JSON 损坏时留下的 `<键>:corrupt` 备份不会自动清理。
- 用量范围由宿主的 `usage` 域决定：`summary` / `models` 只接受 `since`、`until`、`profileName`，**不按项目过滤**，所以今日、近 7 天、近 30 天与累计都是本机所有项目的合计；只有 `records` 支持 `directoryId`。需要单项目用量时以宿主用量页为准。
- 顶栏锚点被整体替换且此后没有任何 DOM 变更或 context 事件时，observer 感知不到；脚本已用 20 次 × 200ms 的有界重试、`context` 事件与 resize 兜底。

**故障排查**

- **看不到徽标**：先确认脚本在「插件列表 → 脚本插件」里是启用状态；再确认安装件的元数据头是 `@snow-target client`、`@snow-scope global`、`@snow-view *`。默认形态是「悬浮」，胶囊停在窗口顶部中间、与顶栏同一行；若改成「顶栏」，则需要当前视图的顶栏渲染了 `topbar.actions` 插槽。
- **显示「无法读取用量」**：说明宿主拒绝了 `usage` 域，检查元数据头是否包含 `@snow-privacy usage`（缺少时脚本会显示横幅并在徽标上打点），在脚本的隐私域弹窗里确认后重新启用。
- **成本全是 0 或覆盖率很低**：看浮层底部「目录 N 条」与覆盖率；目录为空说明价格同步失败，检查网络、价格源 URL、目录缓存 TTL，必要时点「刷新价格」或「清除目录缓存」。
- **提示价格使用缓存**：网络失败时脚本保留旧目录并标记 stale，恢复网络后刷新即可。
- **金额与预期不符**：先确认模型匹配状态（未匹配 / 已忽略不计价），再确认币种与当前汇率（浮层头部「价格同步」右侧会显示实际汇率与同步时间）；本工具是估算，不是账单。
- **汇率获取失败**：浮层头部「价格同步」右侧会显示汇率失败原因；检查网络与汇率源 URL，或把「汇率来源」改成手动填写。已有旧汇率时会继续使用缓存值。
- **脚本被自动停用**：宿主对连续失败 5 次的脚本会自动禁用，重新启用前先看日志里的报错原因。

## 许可

MIT（见 `package.json` 的 `license` 字段）。产物在 UserScript 元数据头之后内联了 Preact 10.29.8 的 MIT 许可声明。
