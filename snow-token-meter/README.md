# Token 用量仪表（snow-token-meter）

Snow App **客户端脚本插件**：默认以可拖动的悬浮胶囊停在窗口顶部中间（与顶栏同一行），常驻显示今日 token 总量与估算花费，点击后胶囊原地展开成浮层，查看今日 / 累计 / 周期用量、按模型拆分与手动模型映射；也可在设置里切成顶栏徽标。

金额有两种口径：能拿到完整逐条用量时按**逐请求精算**（能正确处理「整次请求选档」的长上下文档位）；拿不到时退回**聚合估算**并给出数学上合法的**区间**，此时主金额是下限，前面带 `≥`。

单价来自所选价格目录，也可以由用户为单个模型写**自定义价**（含自己的倍率）。金额始终按当前目录估算，不回放历史价格。

## 定位与形态

- 这是**客户端脚本插件**（脚本插件），入口是「插件 → 插件列表 → 脚本插件」，安装、启停与编辑都在那里完成，不走 `config-set scope=plugins`，也没有 `plugin.json` 与 `renderMode`。
- 产物是单文件 `dist/snow-token-meter.user.js`，元数据头声明 `@snow-target client`、`@snow-view *`、`@snow-scope global`、`@snow-privacy usage`，运行在默认沙箱档（未声明 `@snow-sandbox`，不使用 `unsafeWindow` / `window.snow`）。
- 也**不是浏览器油猴脚本**：它不注入内置浏览器的网页，只注入 Snow App 桌面窗口本身。
- 安装并启用后，默认形态是 `position: fixed` 的悬浮胶囊，徽标节点直接挂在 `body` 下（不放进顶栏插槽：顶栏卡片的 `backdrop-filter` 会成为 fixed 的包含块，按视口算出的坐标会被当成卡片内坐标），停在窗口顶部中间（与顶栏同一行垂直居中，按会话消息列水平居中）；拖动后位置写入设置，重启仍停在原处。设置里切成「顶栏」后，徽标才挂进 `topbar.actions` 插槽。`@snow-scope global` 让它在所有视图里都在；点击徽标后浮层以胶囊为原点展开、收起时缩回胶囊。停用或卸载后徽标与浮层一并消失（脚本在 `snow.onCleanup` 里移除节点、样式、监听与定时器）。
- 界面由脚本自建：徽标是直接的 DOM 节点，浮层是 `body` 下的独立 Preact root，关闭时只隐藏不卸载。

## 功能

- **徽标**：图标 + 今日 token（紧凑写法 `999` / `1.2K` / `1.23M` / `2.5B`）+ 今日估算花费（默认人民币）；可在设置里改成显示累计。金额是下限时前面带 `≥`。悬停徽标弹出**自绘信息卡**：首行是当前区间名与 token 总数，其下是主金额与另一币种的近似值，再用两列键值列出输入 / 输出 / 缓存读取（同样按 K/M/B）、请求数、另一区间的 token 与花费、计价方式（逐请求精算 / 聚合估算）、价格同步与汇率同步时间，最后是告警块与「点击打开用量详情」提示。信息卡优先出现在徽标下方，下方空间不足时翻到上方；滚动、缩放或打开浮层即收起，且不接收鼠标事件。数值变化时新值从下方弹入并短暂染上强调色；加载与流式期间胶囊内部有一道扫描光，流式时外圈另有呼吸光环。
- **告警点**：价格同步失败、目录使用缓存（stale）、缺少 `@snow-privacy usage` 声明、今日价格覆盖率（`rowCoverage`）低于 95%、金额只是下限时，徽标右上角出现琥珀点（慢呼吸，不常亮闪烁），悬停信息卡的告警块里列出具体原因。
- **浮层概览**：今日与累计两张卡片，各自展示 token 总数（K/M/B 紧凑写法）、估算花费（主币种 + 另一种币种的近似值，下限带 `≥`）与请求数；金额悬停可见区间、计价方式、假设、未估算维度与目录版本；底部按当前价格来源注明「按 OpenRouter 目录价估算 / 按 models.dev 跨渠道中位价估算 / 按 LiteLLM 目录价估算」，并说明金额可能是下限、快速模式 / 图片 token / 推理拆分未单独计价。
- **周期统计**：今日 / 近 7 天 / 近 30 天 / 全部四个 tab；每个周期展示 token（K/M/B）、估算花费（下限带 `≥`）、请求数、缓存命中率（cache read / input），以及一枚计价方式徽标（逐请求精算 / 聚合估算）；回退聚合时徽标旁写明原因（页数超限 / 与汇总口径不一致 / 目录无档位 / 宿主未返回逐条数据 / 已关闭精算）。按模型明细按 token 降序，最多 50 条，其余折叠为「还有 N 个模型」。
- **按模型明细**：每行显示用量模型名、token 数、估算花费、命中长上下文档位时的「档位价」徽标、匹配状态（精确 / 归一化 / 模糊≈ / 手动 / 渠道匹配 / 跨渠道 / 猜测≈ / 未匹配 / 已忽略）；猜测匹配的金额后缀 `≈`；点状态徽标进入映射视图。鼠标停在整行上会给出该模型的**计算过程**：自绘浮层按「项目 / 算式 / 金额」三列对齐，展示 token 拆分 × 单价 → 分项小计 → 合计，并附区间与写价假设。
- **模型映射**：候选条目一键固定、标记忽略、恢复自动匹配；也可按渠道、id 或名称搜索价格目录并固定，列表里显示「渠道/id」与「输入 / 输出，每 1M token」单价。映射后成本立即重算，不需要重新拉用量。
- **自定义价**：映射视图里为当前模型写 4 个 token 单价（输入 / 输出 / 缓存读取 / 缓存写入，单位 USD / 1M token）、一个倍率与备注；留空 = 继承目录同名字段，`0` = 显式免费。保存后金额立即重算，不重新拉用量。自定义价是扁平价，不覆盖目录的 1 小时价、按次费与长上下文档位。
- **底部状态**：价格覆盖率、未计价 token、忽略 token、猜测 token、精算条数、自定义价模型数，以及「刷新」按钮（同时刷新用量和价格目录）。
- **悬浮胶囊**：默认形态。徽标是视口内的胶囊（`position: fixed`），停在窗口顶部中间（与顶栏同一行垂直居中，按会话消息列水平居中），可按住拖动，松手后位置写入设置、重启后仍在原位；窗口变小或换到小屏时按当前视口夹取，完全越界则回到默认位；设置里切到「顶栏」会清空保存的坐标，徽标回到 `topbar.actions` 插槽。悬浮形态是玻璃底 + 双层投影，悬停轻微上浮、按下回收；拖动时不再上浮，位置优先跟手。
- **开合动效**：点开浮层不是凭空出现——脚本先按自然尺寸定位，再把浮层以胶囊中心为水平原点、顶部对齐胶囊顶部缩到 0.88，随后回到自然态，形成「从胶囊里长出来」的过渡；收起原路缩回后隐藏。动画只改 `transform` / `opacity`，不参与定位计算，也不改浮层内部的滚动与命中区域。
- **钉住浮层**：浮层右上角图钉可钉住，钉住后点击浮层外部不再关闭，Esc 仍可关闭；未钉住时点击外部收起。
- **设置**：默认项排在各自下拉的第一位——显示货币（CNY / USD）、刷新间隔（30 / 60 / 120 / 300 秒）、展示形态（悬浮 / 顶栏）、徽标显示（今日 / 累计）、汇率来源（自动获取 / 手动填写）；自动模式下汇率框只读显示实际获取到的汇率，手动模式下可编辑；另有手动汇率（0.1–20，步进 0.0001，自动失败时回退）、目录缓存（1 / 6 / 12 / 24 / 72 / 168 小时）、API 档案过滤（留空 = 全部档案）、自动刷新开关、**逐请求精算**（自动 / 总是 / 关闭）、**缓存写假设**（5 分钟 / 1 小时），以及「刷新价格」「刷新汇率」「清除目录缓存」「重置默认设置」「重置悬浮位置」「重置全部映射」。汇率源 URL、价格来源（OpenRouter / models.dev / LiteLLM）与价格源 URL 收在底部的「数据源设置」里，点击展开后编辑并保存；切换价格来源会自动换成该源的默认接口。「重置默认设置」只把设置写回默认值，手工映射、价格目录与汇率缓存保留；「重置悬浮位置」只清悬浮坐标，其它设置不变；「清除目录缓存」会清掉三个价格源各自的缓存；「清除目录缓存」「重置默认设置」「重置全部映射」放在独立的危险操作区，需要再点一次确认。「清空全部自定义价」与「重置全部映射」是两个独立的危险操作。
- **刷新时机**：打开浮层、手动刷新、`stream-end` 后 1.5 秒（合并连续流式结束）、按刷新间隔的自动刷新；`stream-start` / `stream-end` 同时驱动胶囊的活性光，当前流式状态以宿主 `snow.context.isStreaming` 为准（脚本补挂或视图重建后也能恢复，不依赖是否见过 `stream-start`）。刷新之间有 10 秒最小间隔（打开浮层与流式结束触发的刷新同样受节流，同一时刻只跑一次请求），只有手动刷新、切换周期 / 档案与重置设置会立即请求；同一 API 档案口径下，全部历史区间 5 分钟内复用上次结果。
- **语言与主题**：文案跟随宿主语言（`zh-CN` / `zh-TW` / `en`，缺失键回退简体中文）；颜色只用宿主主题 token（文字 / 线 / 表面 / 强调色 / 圆角），深浅色自动跟随，没有硬编码深色主题。

## 数据口径

- 用量只读宿主 `usage` 元数据域：`snow.metadata.get(["usage"], { params: { since, until, profileName, limit: 100, offset: 0 } })`，区间用本地时间文本（`YYYY-MM-DD HH:MM:SS`）。今日是当天 `00:00:00`–`23:59:59`，近 N 天含今天，全部历史从 `2000-01-01 00:00:00` 起。同一响应顺带返回最新 100 条逐条用量（`records`），第 1 页不额外发请求。
- `totalTokens = input + output`：一律按 `input + output` 重算，不读取宿主返回的 `summary.totalTokens`（逐模型同样）。cache read 与 cache creation 都是 input 层面的字段，不重复计入总量。
- token 拆分（`src/cost.js::splitTokens`，逐条与聚合共用同一函数）：

  ```text
  input   = floor(max(0, input))
  output  = floor(max(0, output))
  read    = min(floor(max(0, read)), input)
  creation= floor(max(0, creation))

  creation 在 input 之外 = creation > input - read
  nonCachedInput = input - read - (在 input 之外 ? 0 : creation)
  promptForTier  = input + (在 input 之外 ? creation : 0)
  ```

  这条判定同时兼容「宿主已把 cache read / creation 计入 input」（Anthropic 直连）与「只把 cache read 加进 input」（部分 chat / responses 中继）：一旦 `creation` 超过 `input - read`，就按「creation 在 input 之外」处理，不再把它截断丢失。
- 成本公式（USD，逐请求与聚合行同形）：

  ```text
  cost = nonCachedInput × prompt
       + read          × cacheRead
       + creation      × cacheWrite（cacheWriteTtl=1h 且目录有 1h 价时改用 cacheWrite1h）
       + output        × completion
       + 计费请求数    × request
  ```

  单价统一换算成 USD/token；每个分项、每个模型行按 1e-8 取整，区间金额 = 各模型行金额之和再取整。`request` 是目录里的按次费，官方三源都没有该字段（恒 0）；错误请求（`status=error`）不付按次费，token 仍计价。
- **取价优先级**：`__ignore__` > **自定义价**（状态 `custom`）> 手工映射 > 自动匹配。自定义价可以借用匹配到的目录条目补齐缺失字段：`prompt/completion/cacheRead/cacheWrite` 缺失继承同名目录价，`cacheWrite1h` 与 `request` 恒定继承目录（自定义价不覆盖）；没有目录匹配时 `prompt/completion` 缺省 0，`cacheRead/cacheWrite` 回退 `prompt`，`cacheWrite1h` 仍是 `null`（绝不回退成 5 分钟价），`request` 缺省 0。`null` / 留空 = 继承，`0` = 显式免费，两者严格区分。
- **倍率只作用在单价层一次**：自定义价里的 `multiplier` 只乘该记录写出的四项 token 价；继承来的目录字段保持挂牌价，按次费与 1 小时价**永不乘倍率**。倍率在 `round8` 之前生效，所以每个模型行的五项 `parts` 之和仍严格等于行金额。
- **自定义价不继承目录档位**：只写基础价就是扁平价（整次请求只有一个向量），长上下文请求会按基础价计。需要档位精度时不要给该模型写自定义价，直接用目录价。
- **长上下文档位是「整次请求选一档」，不是分段累进**：由 `promptForTier` 选出命中的最高档，再用该档的四个分项单价对整次请求的全部 token 计价。阈值比较随价格源不同：OpenRouter 的 `min_prompt_tokens` 用 `>=`（达到即进入），models.dev 的 `tier.size` 与 LiteLLM 的 `_above_*` 用 `>`；比较方式存在目录记录级（`tierInclusive`），旧缓存按来源 URL 推断。
- 聚合模式不知道每个请求落在哪一档，因此给区间而不是猜一个值：把「基础价 + 各档位价」分别代入总量求值，取最小 / 最大。真实成本是这组数的凸组合，必然落在区间内，不需要假设档位价单调。三种情况**档位轴**会塌缩成精确值：目录没有档位、该模型只有一个请求、`promptForTier` 低于最小档阈值；如果目录同时给了 1 小时价，金额仍可能因 TTL 轴保留上界（见下一条）。
- **1 小时缓存写**：宿主只有 `cache_creation_input_tokens` 总量，不区分 5 分钟 / 1 小时。默认「缓存写假设 = 5 分钟」时，5 分钟价是下限、目录有 1 小时价时用其作为上限（区间）；选择「1 小时」时按 1 小时价计，这是显式假设——title 里写明「缓存写按 1 小时价（假设）」，金额不再因 TTL 不确定而加 `≥`；目录没有 1 小时价则回退 5 分钟价并声明「该模型目录无 1 小时价」。
- **金额是不是下限**只有一个判据：`isLowerBound = unpricedTokens > 0 || uncoveredRequests > 0 || (upperUsd !== null && upperUsd > lowerUsd)`。`unpricedTokens` 包含「有 token 但无单价」与「精算时 models 中整组没有 records 的 token」（后者另出 `uncoveredTokens` 字段），它们都没有进入金额。为真时金额前显示 `≥`，title 里给出区间、计价方式、假设、未估算维度与目录版本；`upper === lower` 时不显示 `≥`（精确值不降级成下限）。存在未计价 token 或未覆盖缺口时上界为空（`upperUsd = null`）。
- **逐请求精算**（设置项「逐请求精算」，默认「自动」）：
  - 只有 `records` 覆盖完整（`recordsStatus = complete`）时才精算；其余情况整体回退聚合，**一个区间只有一个金额语义，绝不把精算与聚合相加**。
  - 第 1 页（最新 100 条）随 `usage` 免费返回。需要更多时按 `offset` 串行追加页，单页固定 100 条；今日与周期最多 5 页 / 500 行，全部历史最多 3 页 / 300 行；每轮刷新最多 10 次追加调用（三个区间共享预算）。终止条件全部基于数据本身：已覆盖、本页不足 100 条、已翻过窗口起点、到页数 / 行数上限、预算用尽。
  - 「自动」：请求数超过页数上限直接回退；目录里没有任何长上下文档位且请求数超过一页时不翻页，整段回退聚合（免费的第 1 页也不参与计价），并在界面标注「目录没有长上下文档位」（此时逐请求与聚合在数学上等价，多翻页没有收益）。「总是」忽略档位条件，仍受页数与预算约束；「关闭」不使用 `records`（即使宿主随响应返回也忽略）。
  - 一致性校验：行数 ≥ `totalRequests - max(1, 0.5%)`，且 Σinput、Σoutput 各自落在 summary 的 `±max(2000, 1%)` 内，才算 `complete`；行数够但 token 不符记 `mismatch`；翻页失败或触上限记 `truncated`。`mismatch` 与 `truncated` 都不参与计价。
  - 快照与去重：第 1 页最大的 `createdAt` 作为快照上界（并发插入只会让 offset 后移），同 `id` 只计一次，时间窗在本地按字符串过滤。金额 title 里显示「精算 N 条（截至 HH:MM:SS）」，底部状态另显示精算条数。
  - 精算金额来自 records 快照，卡片上的 token 数来自 summary（宿主两次独立查询）。两者最多差「最后几条请求」，不混用，也不修改宿主数字。
- 价格覆盖率 `coverage = pricedTokens / (summary.totalTokens - ignoredTokens)` 只用于展示；徽标 95% 告警改用 `rowCoverage = pricedTokens / (modelsTokens + uncoveredTokens - ignoredTokens)`（分子分母同源，精算时把 records 未覆盖的聚合 token 补回分母），避免 summary 与 models 不是同一快照时误报。猜测匹配（`guess`）计入金额与 `guessedTokens`，但不计入覆盖率分子；`unmatched` 只累计未计价 token，`ignored` 单独统计，两者成本为 0。自定义价（`custom`）与目录命中一样计入已计价覆盖率，底部另计 `customModels`。
- **只声明、不估算的维度**：快速模式（priority / fast）、图片 token、reasoning 拆分。宿主没有对应字段，插件不按倍率或按张数伪造；1 小时缓存写在目录有价时用区间表达，否则只声明假设。
- 单价来自所选价格目录，统一换算成 USD/token。OpenRouter 用 `pricing`：`input_cache_read` / `input_cache_write` 缺失时**回退 `prompt`**，`input_cache_write_1h` 缺失记为 `null`（只能出区间上界），`pricing.overrides[]` 转成档位；`request` 缺失按 0。models.dev 的 `cost` 是 USD / 百万 token，读取时除以 `1e6`；`cache_write` 明确写 0 时按 0，只有字段缺失才回退输入价；`cost.tiers` 只保留 `type=context`，`context_over_200k` 仅在没有 `tiers` 时作为 `above=200000` 兜底；models.dev 全表没有 1 小时价。LiteLLM 的 `*_cost_per_token` 原生是 USD/token，`*_above_<N>k_tokens` 的阈值单位是**千 token**（归一化时 ×1000），`cache_creation_input_token_cost_above_1hr` 提供 1 小时价。三者都不读 `internal_reasoning` / priority / flex 价（无法区分或宿主没有该维度）。
- **模型行的计算过程**（悬停模型行，自绘浮层）：独立小卡片按「项目 / 算式 / 金额」三列对齐，依次给出 token 四项拆分（非缓存输入 / 缓存读 / 缓存写 / 输出）、每项单价（USD / 1M token）与小计、按次费（仅大于 0 时出现）、合计、显示币种换算、区间与写价假设，全部用 USD 对账。浮层优先出现在行下方，空间不足时翻到上方；滚动、缩放或切换周期即收起，且不接收鼠标事件。聚合行的分项就是「tokens × 下限向量单价」一次算出，等式严格成立；精算行的分项是逐条小计之和，金额前用 `≈` 表示取整差，单价随档位不同时不出单价、只给 token 数与分项。未匹配 / 已忽略的行只给「未计价」与 token 拆分。
- 金额展示：默认 CNY。USD 按大小自适应小数位（`$0.0012` / `$0.123` / `$1.85` / `$1,234`）；CNY 由 `USD × 当前汇率` 换算（汇率默认自动获取，失败回退手动值），并按大小自适应：`<¥0.0001`、四位、三位、两位小数，不再把有花费显示成 `¥0.00`。概览卡片主金额按设置币种，并用「≈」并列显示另一币种（周期统计行只显示主币种）；徽标只显示主币种。
- **这是按目录挂牌价估算的花费，不是实际账单**：真正的计费还受套餐、折扣、服务档位、推理 token 计价、图片计价等影响。走包月套餐时，按 token 复算的金额只是「等价刊例成本」，不是实际支出。逐请求精算与聚合模式都按**当前目录**重算，区间 title 里的「目录版本 HH:mm」就是本次用的目录时间；上游调价会立即反映到全部区间。

## 自定义价

- **存储独立**：自定义价写在 `tokenmeter:prices`（`{ schema: 1, models: { "<模型名小写>": PriceRecord } }`），与 `tokenmeter:mappings` 完全分开。「重置全部映射」不会清价，「清空全部自定义价」也不会动映射——两者在危险操作区各自确认。
- **记录格式**：`input` / `output` / `cacheRead` / `cacheWrite` 一律是 **USD / 1M token**（内部只在 `src/prices.js` 除一次 `1e6` 换成 USD/token），`multiplier` 无量纲（0.01–10，默认 1），另有可选的 `note` 与 `updatedAt`。
- **三态**：留空 / `null` = 继承匹配到的目录同名字段；`0` = 显式免费（不回退）；正数 = 绝对价。字段缺口的回退链见「数据口径」。
- **优先级**：`__ignore__` > 自定义价（状态显示「自定义价」）> 手工映射 > 自动匹配。被忽略的模型即使写了自定义价也不计价，编辑区会提示。自定义价计入已计价覆盖率，底部另显示「自定义价 N 个模型」。
- **倍率只乘自己写出的价**：`multiplier` 只作用于记录里的四项 token 价；继承来的目录字段保持挂牌价，按次费与 1 小时价永不乘倍率。倍率作用在单价上、在任何取整之前，因此五项 `parts` 之和仍等于行金额。
- **算例（可复算）**：目录 `input 3 / output 15 / cacheRead 0.3 / cacheWrite 3.75 / 1h 6`（USD / 1M），200k 档 `6 / 22.5 / 0.6 / 7.5 / 12`；长请求 `input 250000`（非缓存 20000 / read 180000 / write 50000）、`output 5000`，短请求 `input 100000`（60000 / 30000 / 10000）、`output 2000`。
  - 自定义价 `{input 3, output 15, cacheRead 0.3, cacheWrite 3.75, multiplier 0.3}`（扁平价）：长请求 `0.11295`、短请求 `0.07695`、合计 `0.1899`（同一批请求按目录档位精算为 `0.9720`，缓存写按默认 5 分钟价，少 80.5%）。

## 价格与汇率同步

- 价格来源有三条，可在「数据源设置」里切换：
  - `OpenRouter`（默认）：`GET https://openrouter.ai/api/v1/models?output_modalities=all`，单一渠道目录，模型 id 唯一；本机快照 692 条、精简后约 91 KB，78 条带长上下文档位、34 条带 1 小时缓存写价。
  - `models.dev`：`GET https://models.dev/api.json`，按 provider 收录各厂商与中转站挂牌价（本机快照 8527 条、精简后约 1.1 MB，816 条带档位，没有 1 小时价），更适合判断「某个渠道大概收多少」。
  - `LiteLLM`：默认 `GET https://cdn.jsdelivr.net/gh/BerriAI/litellm@main/model_prices_and_context_window.json`（单文件约 3 MB，精简后约 430 KB / 3305 条）。只保留 `mode ∈ {chat, responses, 空}` 且至少有一个 token 价的条目，丢弃 embedding / 图片 / 音频 / rerank 等非文本模型。1 小时价（229 条）与长上下文档位（286 条）覆盖最全。
- LiteLLM 的镜像重试：只有使用默认地址且首次抓取失败时，才用 `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json` 再试一次；成功后在状态里记 `mirror` 与实际地址。用户把地址改成自定义值时不重试、不替换。失败冷却仍为 5 分钟。
- 三个来源各占一个缓存键（`tokenmeter:catalog` / `tokenmeter:catalog:modelsdev` / `tokenmeter:catalog:litellm`），来回切换不会互相覆盖。本地目录用定长数组存储：v2 为 11 列（尾部追加 `cacheWrite1h` 与 `tiers`），旧 9 列缓存原样可读（读出 `tiers=[]`、`cacheWrite1h=null`，金额与升级前一致），旧版本插件读到新缓存会忽略第 10/11 列；下一次成功同步会自然升级为 v2，不需要迁移代码。记录级另存 `schema`、`tierInclusive`、`mirror`、`resolvedUrl` 与失败状态。
- 自定义地址仍可用：只要响应结构与被选来源一致即可（OpenRouter 是 `{ data: [...] }`，models.dev 是 `{ providerId: { models: {...} } }`，LiteLLM 是 `{ "<model key>": {...} }`）。地址只接受 **https 域名地址**，`localhost`、内网主机名与任何 IP 字面量（IPv4 / IPv6）都会被拒绝并回退到默认接口。
- 目录默认缓存 12 小时（设置范围 1–168 小时）。命中缓存且未过期时直接用本地目录；过期才请求网络。
- 空 / 残缺保护：解析结果少于 100 条、且上一份健康目录本身 ≥100 条时，视为残缺响应并保留旧目录（防上游错误页 / 半截 JSON）；首次拉取的小目录（例如自建代理只有几十条）不会被误判。
- 请求失败时**保留旧目录**并标记 `stale`，浮层顶部与徽标信息卡的告警块显示同步失败原因；换了价格源地址后请求失败时不沿用旧地址的目录（避免按旧源计价），按无目录处理。失败后 5 分钟内的自动刷新不再重试，手动「刷新价格」立即生效。本地没有任何目录时价格不可用，成本按 0 计算并在浮层里提示。
- 并发的目录请求按「价格源 + 缓存键 + URL」合并成一次网络调用，`force` 不参与合并键：「刷新价格」遇到在途的同身份请求会直接复用它；「刷新价格」与「清除目录缓存」会绕过 TTL 与失败冷却重新拉取。汇率请求的合并键包含强制标记，强制刷新会另发一次。
- 汇率默认请求 `GET https://api.frankfurter.app/latest?from=USD&to=CNY`（ECB 参考价，免密钥），可在设置里改成任何返回 `{ rates: { CNY: number } }` 的 https 公网接口；只取 `rates.CNY`。设置页在自动模式下只读显示当前汇率，切到手动时会先用当前自动汇率预填。
- 汇率缓存 6 小时，随用量刷新一起检查，不额外增加请求频率；「刷新汇率」强制重新拉取。失败时保留旧汇率并标记 `stale` / `error`，失败后 5 分钟内的自动刷新不再重试，本地没有任何汇率时才回退手动值（默认 7.2）。
- 隐私边界：只发 GET 价格目录与汇率，不发送本地用量、会话内容、模型映射或密钥；除这三个目录地址与汇率地址外脚本不发起任何网络请求。请求经应用主进程代发，按宿主约定沿用当前会话 Cookie，所以地址必须是可信的 https 站点；静态校验只看主机名形态与 IP 字面量，域名是否解析到内网不在校验范围内。

## 模型匹配

匹配顺序固定（实现见 `src/match.js`），所有目录共用同一条流水线（不再有「只有 models.dev 才做身份层」的分支）：

1. **手工映射优先**：映射键是模型名小写（大小写不敏感），值是目录条目 `id`（OpenRouter / LiteLLM）、`provider/id`（models.dev，可固定渠道）或 `__ignore__`；旧版纯 `id` 映射继续有效。解析时整串 `id` 优先，其次按第一个 `/` 拆分渠道与模型；映射到不存在的条目时按未匹配处理。
2. **精确**：用量模型名与目录条目的 `id` 或 `slug`（OpenRouter 的 `canonical_slug`、models.dev 的 `provider/id`）忽略大小写相等。
3. **渠道**：用量名形如 `vendor/model` 时，只在该 provider 自己的条目里匹配（精确 → 归一化 → 连续子序列），命中就用该渠道挂牌价（状态 `provider`）。这是唯一按渠道取价的自动路径。
4. **模型身份（裸 id）**：把用量名去掉路径、括号、方括号与 `:variant`，点号与分隔符统一成横线，得到裸 id；同一裸 id 在多个渠道下出现时取中位挂牌价（状态 `canonical`）。点号 / 横线在这里等价：`claude-sonnet-4.5` 与 `claude-sonnet-4-5` 会落到同一个条目。
5. **模型身份（canonical）**：按条目的 `canonical` / `canonical_model_id` 分组，同样取中位价。
6. **归一化 token**：去掉厂商前缀后 token 序列完全一致；命中多个条目视为歧义。
7. **连续 token 子序列**：用量名里出现目录条目的完整连续 token 序列（至少 2 个 token），容忍代理前缀、区域、日期、噪声后缀；得分最高的条目唯一时才算命中，**同分不同条目视为歧义**。
8. **Bedrock 区域前缀**：去掉 `us.` / `eu.` / `apac.` / `jp.` / `au.` / `ca.` / `in.` / `global.` / `us-gov.` 等前缀后重新查身份层。
9. **Bedrock 版本后缀**：去掉 `-v1` / `-v1:0` / `-v1.0` / `-v1-0` 后重新查身份层。
10. **`-latest`**（`guess`）：去掉尾部 `-latest` 后查身份层。
11. **日期后缀**（`guess`）：去掉尾部 `-20250929` 或 `-2025-09-29` 后查身份层。
12. **渠道 / 代理前缀**（`guess`）：去掉开头 2–24 个字符的字母数字前缀后，剩余部分必须命中已知模型才采用。
13. **家族兜底**（`guess`）：用量 token 是某个条目 id token 的**真前缀**时（例如 `qwen3` → `qwen3-235b-a22b`），按该条目计价；真实目录里若同时存在多个同前缀条目（如多个 `qwen3-*`），仍判歧义。

补充规则：

- **`guess` 的四个来源**：第 10–12 步、身份层命中但组内**无价格共识**（组内输入价落在中位数 ±5% 的条目占比低于 34%）、身份层命中但 usage token 是条目 token 的真子集、家族兜底。`guess` 计入金额，但不计入覆盖率分子，徽标状态显示「猜测≈」，金额后缀 `≈`，底部单独统计「猜测 N」。
- 身份层的共识护栏用于挡住「同一裸 id 在几十个渠道下价差数倍」的误配：价差倍数会误伤「同价但条目多」的大模型，因此用共识比例而不是倍数判据。低于阈值仍按中位价计价，但降级为 `guess`。
- 歧义与未匹配都不会猜一个「最像」的条目，而是要求手动映射，避免把成本记到错误模型上。
- `:` 变体（如 `:batch`、`:free`）不自动参与：只有当用量模型名带同一个变体时，带该变体的目录条目才进入候选；`~` 开头的 latest 别名永不参与自动匹配。带变体时不做身份层归一。
- 忽略的模型不计成本，也不进入覆盖率分子与分母。
- 本机常见代理别名示例：`opencode-go/deepseek-v4.1-flash` 与 `moonshotai/kimi-k3` 在 models.dev 下按渠道精确命中；`deepseek-v4.1-flash` 按同 id 跨渠道中位价命中；`DeepSeek-Flash` 在 models.dev 下命中 deepseek 官方的 `deepseek-flash`，在 OpenRouter 下仍停在未匹配；`qwen3.8-max` 在真实目录里可能命中同名条目，否则停在未匹配，需要手动映射或忽略。

## 隐私与联网

- 元数据头只声明 `@snow-privacy usage`；脚本只读聚合用量与逐条用量（同一 `usage` 域），不读会话、消息、文件、Git 或 API 密钥，也不写任何应用数据（不使用 `snow.write`）。
- 本地持久化只用 `GM_*`：`tokenmeter:settings`（设置）、`tokenmeter:catalog`（OpenRouter 目录）、`tokenmeter:catalog:modelsdev`（models.dev 目录）、`tokenmeter:catalog:litellm`（LiteLLM 目录）、`tokenmeter:mappings`（手工映射）、`tokenmeter:prices`（自定义价）、`tokenmeter:prices:backup`（价表结构损坏时的原始值备份）、`tokenmeter:fx`（汇率缓存）；`src/constants.js` 另预留 `tokenmeter:ui`，当前版本未写入。浮层的展开状态不持久化。
- 存储内容损坏时，先把原始值备份到 `<键>:corrupt`，再回退默认值，避免脚本启动失败。
- 无遥测、无埋点；联网只发生在价格目录与汇率同步，全部是 https 公网 GET。自定义价（含单模型倍率）全部在本机计算并落在 `GM_*`，不新增任何网络请求。

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

- `npm test` 当前共 **195 项**：`cost` 34、`engine` 30、`match` 26、`pricing` 26、`settings` 19、`usage` 10、`util` 17、`records` 15、`prices` 9、`i18n` 4，以及 `ui-smoke` 5（产物元数据契约 1 + JSDOM 冒烟 4）。核心用例覆盖 token 拆分、档位选择（含多档取最高与同阈值去重）、聚合区间、逐请求精算与缺口、records 分页 / 覆盖率 / 预算 / 回退、三源归一化与价格源缓存键路由、匹配流水线与共识护栏、自定义价的继承与单模型倍率 / 取价优先级；冒烟测试直接加载 `dist` 产物，验证「插槽挂载 → 徽标 → 浮层 → 设置视图 → 映射视图 → 清理还原」的真实链路，并断言聚合 / 精算两种金额语义与 `≥` 前缀。
- 构建脚本以 `package.json` 的 `version` 为唯一来源，写入元数据头 `@version`；构建后校验产物以 `// ==UserScript==` 开头并包含 Preact 的 MIT 许可声明，失败时保留旧产物。
- 版本规则：功能改动、修 bug、重构、补测试都不升版本；版本号只在发布流程中按用户指定的目标版本修改。

## 目录结构

```text
snow-token-meter/
  src/
    constants.js        存储键、周期、默认设置、三个价格源与汇率 URL、档位语义、records 限额
    cost.js             token 拆分（含 creation 是否在 input 之外）、档位选择、聚合区间、逐请求成本、覆盖率
    match.js            模型名 → 目录条目（手工 / 渠道 / 身份 / 归一化 / 子序列 / 区域 / 版本 / latest / 日期 / 前缀 / 家族 / 歧义）
    pricing.js          OpenRouter、models.dev、LiteLLM 目录抓取、精简（v2 紧凑数组）、持久化与 TTL 缓存
    fx.js               USD→CNY 汇率抓取、持久化与 TTL 缓存
    settings.js         设置与映射的归一化、范围收敛
    prices.js           自定义价：记录归一化、目录条目叠加（继承 / 0 与 null）、单价倍率、取价优先级
    usage.js            usage 元数据域读取、records 归一化 / 分页采集 / 覆盖判定 / 缓存键
    util.js             本地日期区间、紧凑 token、金额与 JSON 工具
    store.js            极简订阅式状态容器
    engine.js           并行拉取今日 / 周期 / 全量用量，编排 records 采集，合并目录并重算成本
    i18n.js             三语言字典与回退
    script/
      api.js            宿主能力探测、GM_* JSON 存储、snow.metadata 适配
      main.js           注入样式、挂载徽标 / 悬浮胶囊与浮层、拖动、定位、数值脉冲与开合动效、清理
    ui/
      format.js         币种、金额、区间、时间、比例格式化
      icons.js          内联 SVG 图标
      meter-panel.js    主视图 / 设置视图 / 映射视图（Preact，含自定义价编辑区）
  build.mjs             esbuild 打包：IIFE + UserScript 元数据头 + 许可声明
  style.css             徽标与浮层样式（构建时内联）
  locales/              zh-CN / zh-TW / en 语言包（构建时打入脚本）
  test/                 核心单测（cost / engine / match / pricing / settings / prices / usage / util / records / i18n）+ JSDOM 冒烟
  dist/snow-token-meter.user.js  构建产物（安装到脚本插件的就是它，不入库）
```

## 已知限制与故障排查

**已知限制**

- **服务档位（priority / fast）未计价**：宿主没有该维度，插件按标准价计。若全部请求实际走 priority（上游约 2×），这部分金额会低约 50%，不做任何金额调整。
- **图片 token 未单独计价**：插件不按张数、不按尺寸估算，图片输入按其文本 token 计；目录里的图片单价不读。
- **reasoning / thinking token 并入输出**：宿主没有独立列（Anthropic 与 Gemini 都把 thought 并进 output），一律按输出单价计；目录里的 reasoning 价不读。若真实 reasoning 价低于输出价，估算偏高，反之偏低。
- **1 小时缓存写只能给区间或假设**：宿主只有 `cache_creation_input_tokens` 总量。默认按 5 分钟价计；目录有 1 小时价时，区间上限按 1 小时价计（5 分钟是下限）。选「1 小时」时按 1 小时价计，这是假设，只在金额 title 里标注，不会因此把金额标成 `≥`。models.dev 全表没有 1 小时价，选该源时这一项只能按 5 分钟价计并声明。
- **聚合模式只能给区间**：同一段时间内不知道每个请求落在哪一档，下限可能显著低于真实值（本机 fixture：聚合下限 0.6330 / 精算 0.9720，低 34.9%）。区间是数学上合法的范围，不是估计值；区间中点也不保证更接近真值。
- **精算有页数与行数上限**：今日与周期最多 5 页 / 500 行，全部历史最多 3 页 / 300 行，每轮刷新最多 10 次追加调用。超过上限、追加页失败、或逐条与汇总口径不一致（`mismatch`）时整体回退聚合，不再精确；这些情况会在周期统计的计价方式旁写明原因。
- **「自动」精算在目录没有档位且超过一页时不翻页**：此时逐请求与聚合在数学上等价，翻页没有收益，会整段回退聚合并标注「目录没有长上下文档位」；需要强制精确可切到「总是」（仍受页数与预算约束）。
- **精算金额与卡片 token 不是同一瞬间**：精算来自 records 快照（最多几十秒前），token 数来自 summary；两者最多差最后几条请求，属于宿主两次独立查询，不混用也不改写宿主数字。精算下 models 中整组没有 records 的模型不会被静默漏掉：其 token 计入未计价与 `uncoveredTokens`，金额按下限显示。
- **金额始终按当前目录重算，不回放历史价格**：上游调价、改自定义价或改映射后，所有区间（包括昨天的记录）都会按新价重算。这是有意为之：`summary` / `models` 是整段窗口的聚合、没有日期维度，`daily` 又没有模型维度，回放过去的价格只能靠编造。金额 title 里的「目录版本 HH:mm」就是本次用的目录时间。
- **自定义价默认是扁平价**：自定义价不继承目录的长上下文档位，只写基础价时长上下文请求会明显少算（本机算例：0.1899 vs 保留档位 0.9720，少 80.5%）。需要档位精度时不要给该模型写自定义价，直接用目录价。
- **自定义价继承来的目录字段保持挂牌价**：只有记录里写出的四项 token 价参与该记录自己的 `multiplier`；留空继承的目录字段按目录原价，按次费与 1 小时价永不乘倍率。想让写出的四项都按同一折扣缩放，请把四个 token 价都写全并给 `multiplier`。
- **跨源缺价补全未实现**：`fillSource` 只预留键与归一化（固定为空 = 关闭），主源没有的模型就是未匹配，不会偷偷用其它源的价格。
- **猜测匹配可能偏差**：`-latest`、日期后缀、渠道前缀、家族兜底、无共识价的跨渠道中位价都记为 `guess`：计入金额但不计入覆盖率分子，界面显示「猜测≈」。这些是有意近似，不是精确值。
- **0 价条目的两种含义**：OpenRouter 的 0 价条目是真实的免费变体（精确命中、金额 0、计入覆盖率）；models.dev 里没有 `cost` 的条目被丢弃（按未匹配处理）。两者在界面上的区别只体现在状态与覆盖率。
- **LiteLLM 的档位语义是假设**：`_above_<N>k_tokens` 按「整次请求选一档」消费（与 Anthropic / OpenAI 长上下文计价一致），但上游计算器的实际消费方式未核；若上游实为分段累进，整次选档会高估。只在显式选择 LiteLLM 源时受影响。
- **LiteLLM 默认走 jsDelivr**：CDN 边缘节点可能比 GitHub 落后数小时；需要最新价可把地址改成 raw.githubusercontent 或手动「刷新价格」。镜像重试只兜可达性，不兜新鲜度。
- **目录体积**：models.dev 精简后约 1.1 MB、LiteLLM 约 430 KB、OpenRouter 约 91 KB。解析失败或响应残缺时保留旧目录；首次拉取少于 100 条的响应不会被残缺保护拦住（避免误杀自建小目录）。
- **旧 9 列缓存的档位与 1 小时价缺失**：升级后的第一次成功同步才会写成 v2；在那之前金额按旧口径（无档位、无 1 小时价），与升级前完全一致。
- **CNY 金额分段显示**：`<¥0.0001`、四位、三位、两位小数，极小成本不会再显示成 `¥0.00`，但也不会无限提高精度。
- 订阅套餐类 provider（`umans-ai-coding-plan`、`zai-coding-plan` 等）在 models.dev 的 `cost` 全为 0，命中后成本显示 0；这是刊例口径，不代表你的实际支出。
- 汇率默认从 Frankfurter（ECB 参考价）获取，是每日参考价而非实时成交价，周末与节假日不更新；自动获取失败时回退手动值（默认 7.2）。改汇率只影响 CNY 展示，不改变 USD 估算。
- 浮层位置只在打开、窗口 resize、视图切换与拖动时重算，不监听宿主布局动画；徽标与浮层都不随滚动移动，因此不监听 scroll；默认悬浮位置按 `chat.messages`（其它视图回退 `main.view`）的水平中心与 `topbar` 的垂直中心计算，量不到时按 CSS 的顶部居中与 8px 兜底。悬浮胶囊挂在 `body` 下并使用 `position: fixed`（正是为了避开顶栏插槽祖先的 `transform` / `filter` 包含块）；顶栏形态的徽标是插槽内的普通节点，按顶栏布局定位。展开 / 收起动画在定位完成之后单独施加，只写 `transform` 与 `opacity`；收起动画结束才加 `is-hidden`，量不到尺寸（脚本补挂未完成、无布局环境）时直接隐藏、不留延迟，避免界面卡在收起中途。`prefers-reduced-motion: reduce` 下脚本跳过 morph，样式表同时关闭全部动画与位移。
- 「重置全部映射」不可撤销：一次写入空映射表并只重算一次成本（`engine.clearMappings`），映射条数与写入次数无关；重置后需要重新设置全部手工固定与忽略。
- 写入 `GM_*` 失败时，保存设置与重置操作会提示「写入失败」，改动只在当前会话生效、重启后回退；价格目录缓存写入失败仍不提示，表现是每次刷新重新下载目录。JSON 损坏时留下的 `<键>:corrupt` 备份不会自动清理。
- 用量范围由宿主的 `usage` 域决定：`summary` / `models` 只接受 `since`、`until`、`profileName`，**不按项目过滤**，所以今日、近 7 天、近 30 天与累计都是本机所有项目的合计；只有 `records` 支持 `directoryId`（本插件未使用，逐条数据同样按全局窗口过滤）。需要单项目用量时以宿主用量页为准。
- 顶栏锚点被整体替换且此后没有任何 DOM 变更或 context 事件时，observer 感知不到；脚本已用 20 次 × 200ms 的有界重试、`context` 事件与 resize 兜底。

**故障排查**

- **看不到徽标**：先确认脚本在「插件列表 → 脚本插件」里是启用状态；再确认安装件的元数据头是 `@snow-target client`、`@snow-scope global`、`@snow-view *`。默认形态是「悬浮」，胶囊停在窗口顶部中间、与顶栏同一行；若改成「顶栏」，则需要当前视图的顶栏渲染了 `topbar.actions` 插槽。
- **显示「无法读取用量」**：说明宿主拒绝了 `usage` 域，检查元数据头是否包含 `@snow-privacy usage`（缺少时脚本会显示横幅并在徽标上打点），在脚本的隐私域弹窗里确认后重新启用。
- **金额前面带 `≥`**：说明这是下限——存在未计价 token，或档位区间 / 1 小时缓存写让上界高于下界。把鼠标停在金额上看区间、假设与未估算维度；「总是」精算可避免因页数判断回退聚合，补齐模型映射可减少未计价 token。
- **成本全是 0 或覆盖率很低**：看浮层底部「目录 N 条」与覆盖率；目录为空说明价格同步失败，检查网络、价格源 URL、目录缓存 TTL，必要时点「刷新价格」或「清除目录缓存」。
- **提示价格使用缓存**：网络失败时脚本保留旧目录并标记 stale，恢复网络后刷新即可。
- **提示「逐请求与汇总的口径不一致」**：逐条数据与 summary 的 token 对不上（可能是宿主查询快照差异或字段语义问题），本轮已回退聚合；多刷几次仍如此时以聚合下限为准。
- **金额与预期不符**：先确认模型匹配状态（未匹配 / 猜测 / 已忽略不计价），再确认计价方式（逐请求精算 / 聚合估算）与币种 / 汇率（浮层头部「价格同步」右侧会显示实际汇率与同步时间）；本工具是估算，不是账单。
- **自定义价没生效**：看映射视图里的状态徽标——被标记「忽略」时自定义价不参与计价（编辑区有提示）；留空的字段继承目录价，填 `0` 才是免费。保存后金额立即重算，不需要重新拉用量。
- **金额和昨天看到的不一样**：插件始终按当前目录价与当前自定义价重算全部区间，上游调价、改映射或改自定义价都会立刻改变历史区间的金额；没有历史价格快照，也不回放过去的价。
- **汇率获取失败**：浮层头部「价格同步」右侧会显示汇率失败原因；检查网络与汇率源 URL，或把「汇率来源」改成手动填写。已有旧汇率时会继续使用缓存值。
- **脚本被自动停用**：宿主对连续失败 5 次的脚本会自动禁用，重新启用前先看日志里的报错原因。

## 许可

MIT（见 `package.json` 的 `license` 字段）。产物在 UserScript 元数据头之后内联了 Preact 10.29.8 的 MIT 许可声明。
