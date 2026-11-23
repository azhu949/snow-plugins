# snow-purge

Snow App 插件：把 dsh-purge（社区版「破甲」插件）在 Snow App 里**能做的部分**做到位。面板形态复刻 `snow-docker` 的工程模式（ESM 面板 + 常驻后台模块 + esbuild 双入口打包）。

> **卸载前必读**：卸载或停用本插件**不会**撤回已经写进宿主的托管内容——系统提示词条目、ROLE 文件里的托管段、代理脚本里的托管段、免审批工具清单都会继续生效。卸载或停用之前，请先打开面板点「撤回」，在状态页确认没有剩余的托管层；插件停止时也会在应用日志里提示还有几层没有撤回。

## 能做什么

| 能力 | 落地方式 | 证据 |
| --- | --- | --- |
| 分层自检 | 通道、系统提示词、全局角色、请求代理、注入探针、免审批清单逐项核对 | 每项带文件路径 / 哈希 / 条目 id / 时间 |
| 系统提示词托管 | 写入固定条目 `snow-purge.directive`（`systemPrompts.upsert`） | 提示词库可见、可停用、可删除 |
| 全局角色规则 | 在 ROLE 文件里维护 `snow-purge managed` 标记段，标记外内容保留 | `personalization.saveRole` |
| 预设 | 内置 4 套模板 + 自定义预设（存插件私有存储） | 只填充编辑框，不自动写入 |
| 免审批工具 | 读写全局 / 项目清单（`toolApproval.setGlobal` / `setProjectMany`），只有你在面板点保存时才写入；全局清单对所有项目生效 | 敏感命令规则只读展示，插件不改写 |
| 请求代理托管 | 在 `~/.snowapp/request-proxy/proxy.mjs` 内维护标记段，按 `context.provider` 分流注入 | 写前快照、越界让位、撤回还原 |
| 注入探针 | 托管段每次处理请求往探针日志追加一行 | 面板展示最近记录，确认注入真的到达请求 |
| 本机备份 / 回滚 | 应用前快照代理原文、角色文件、托管提示词原值（免审批清单由面板直写宿主，只记撤回依据，不产生该类快照） | 存在 `plugin-data/com.snow.purge/backups`，最多 30 份 |
| 审计 | 记录每次应用 / 撤回 / 写入，可联查宿主应用日志；动作流水与应用日志都能一键清空（`audit.clear` / `logs.clear`，按钮需二次确认） | 只存插件存储，最多 200 条 |
| 红队技能库 | 随插件附带上游 dsh-purge 的 23 份 `skills/redteam/*.md`，面板可安装 / 启停 / 移除到 `~/.snow/skills/snow-redteam-<id>/SKILL.md` | 环境自检只读 `~/.snow/.env` 与同名环境变量中的 FOFA_KEY / REDTEAM_VPS_HOST / REDTEAM_VPS_KEY（只显示长度或确认过的本机路径），以及工具箱与 PATH；不下工具、不执行命令 |
| 红队编队 | 把 5 个角色子代理（recon / assess / vuln-scan / exploit / internal）写入宿主 `subAgents` 配置（`subAgents.upsert` / `remove`），带角色化系统提示词与工具白名单 | 弹窗展示 Agent 网络（角色编入状态与角色卡；宿主未提供子代理会话数据时统一显示「未提供运行数据」而不是 0 值）、成员卡与角色任务模板，可逐个编入 / 更新 / 移除 |
| 链路派发 | 在链路页勾选环节、给每一环配任务（默认任务书 / 角色模板 / 自定义），插件逐环新建会话并投递任务文本（`conversations.create` + `autoReply`），由主代理按编队规则交给对应角色子代理；任务索引写 `redteam-tasks.json`，列表状态按会话运行情况推断，可打开会话或移除记录 | 投递文本含角色 agentId 与授权边界；插件不直接调用子代理；链路派发本身不代为批准工具授权（免审批清单只由你在授权页显式保存） |
| 链路自动接力 | 把角色按「测绘 → 评估 → 扫描 → 验证 → 横向」串成一条链路：后台每 15 秒读一次会话状态，上一环结束后把它的结论摘要作为**不可信参考数据**（单独围栏、明确禁止当作指令执行）传给下一环并自动派发；失败、会话消失、单步超过 30 分钟都会停下来等人处理，读不到宿主实时状态时同样停在本步等确认（不猜完成），可暂停 / 继续 / 跳过本步 / 停止 | 面板显示每步状态与当前环节结论；不做完成百分比与耗时预估 |

## 不能做什么（不假装能做）

- **不修改宿主安装目录**，也不复刻 dsh-purge 的 86 条 `cordis.patch.yml` 补丁、asar 补丁与锚点重定位：Snow App 没有对应机制。
- **不代为批准敏感命令，也不改写敏感命令规则**：`interactions.approveAuthorization` 遇到 `sensitive: true` 会被宿主直接拒绝；面板对敏感命令规则只做只读展示，匹配敏感命令规则的操作即使进了免审批清单仍会强制确认。
- **没有左侧栏整页**：Snow App 只提供 5 个写插槽，本插件以右侧面板呈现。
- **不自动重启宿主**，不自建更新器（升级交给插件市场）。
- **红队部分只做到技能文档层**：不做工具链自动下载，不做 `redteam_preflight`、报告生成——Snow App 插件没有注册工具的能力，这些只能由技能文档引导对话里的 Agent 去做。链路编排只到「排队 + 判定 + 派发」这一层：真正执行仍由主代理按 subAgents 规则交给角色子代理，插件不直接启动；链路派发本身不代为批准工具授权（免审批清单只由你在授权页显式保存）。
- **红队编队不等于 DSH 的红队模式**：Snow App 没有 agent preset 机制、`redteam_*` 工具族与 SQLite 资产库。宿主 `conversations` 元数据域只返回主会话（原生查询显式排除子代理会话，子代理字段恒为空），插件取不到角色级状态、模型、token、耗时与请求数：面板统一显示「未提供运行数据」，不拿 0 值冒充。`streamingSessions` 只覆盖当前活跃会话，无法归属到具体角色，插件不据此推算指标。除此之外也**没有**费用估算（宿主无单价配置）、步骤数、完成百分比与甘特条，也不做实时拓扑推送：弹窗每 8 秒轮询一次。
- 请求代理只改请求体：接口地址、请求头与凭据不在脚本可及范围内；Responses 的 WebSocket 传输不经过代理层。

## 请求代理的托管边界

`proxy.mjs` 是全局唯一文件，插件按三条底线处理：

1. **只替换标记块**：`// >>> snow-purge managed >>>` 到 `// <<< snow-purge managed <<<` 之间的内容；段外内容一行都不动。
2. **写前快照**：第一次应用前把原文件（即使不存在）记录到备份，撤回时按快照还原。
3. **越界让位**：托管段被手工改过、或段外已存在另一个 `onRequest` 导出时，插件拒绝覆盖并提示；确认要覆盖需勾选「强制覆盖」。

生成的托管段会：

- `chat` 改 `messages`（首条 system 追加或前置一条 system）；
- `responses` 改 `instructions`；
- `anthropic` 改 `system`；
- `gemini` 改 `systemInstruction`；
- 开启「尾部强化段」时，再往最后一条 user 消息尾部追加一次相同指令；
- 任何异常都返回 `undefined`，原请求照常发出。

## 红队技能库

上游 dsh-purge 的 `skills/redteam/` 共 23 份技能文档（侦察、指纹、目录爆破、凭据、隧道、WebShell、反弹 Shell、横向移动、未授权利用等），随本插件一起安装到 `skills/redteam/`。面板「红队」页提供：

- **安装 / 覆盖安装 / 更新**：把原文规范成宿主要求的 `SKILL.md`（`name`、`description`、`whenToUse`、`role`、`enable`），写到 `~/.snow/skills/snow-redteam-<id>/`；
- **启停**：只改 `enable:` 那一行，宿主 Skills 设置里也能看到同样的开关；
- **移除**：整个目录挪到 `plugin-data/com.snow.purge/redteam-removed/`，不直接删；
- **环境自检**：只读 `~/.snow/.env`（若存在）与同名环境变量中的 `FOFA_KEY`、`REDTEAM_VPS_HOST`、`REDTEAM_VPS_KEY`（环境变量优先；面板只显示长度，私钥仅在确认为本机路径时显示 `~` 路径），以及工具箱目录、完成标记，以及 PATH / 工具箱里是否已有 fscan、nuclei、chisel 等二进制。

边界：技能只是操作手册。插件不下载、不安装任何安全工具，不执行任何扫描或利用命令，也不提供任务链编排与报告生成。使用前请确认目标在授权范围内。

## 红队编队

上游 dsh-purge 的红队模式靠 DSH 的 agent preset 拉起一个会话与五个执行角色。Snow App 没有 preset 机制，但有子代理写域，于是这里用同等口径落成 5 个角色子代理：

| 角色 | agentId | 职责 | 工具白名单 |
| --- | --- | --- | --- |
| 资产测绘 | `redteam_recon` | 铺开授权范围内的公开资产面，输出带来源的资产表 | filesystem / grep / websearch / bash / skills |
| 风险评估 | `redteam_assess` | 把资产归并成攻击面并排 P0-P3 优先级，不做验证 | filesystem / grep / memory / todo / websearch |
| 漏洞扫描 | `redteam_vuln_scan` | 针对性模板检测，控制并发与速率 | filesystem / grep / bash / skills / websearch |
| 利用验证 | `redteam_exploit` | 最小可复现验证，不破坏、不持久化、不横向 | filesystem / grep / bash / skills |
| 内网横向 | `redteam_internal` | 授权内网段内的发现、路径分析与提权评估 | filesystem / grep / bash / skills / websearch |

红队页点「编队视图」打开全窗弹窗：顶部一行概览（编入进度、运行中角色、待跑任务、上次刷新时间），下面分三个工作区，用 Tab 切换，默认停在「编队」。

- **编队**：左侧是 Agent 网络（主控会话居中，五个角色绕成环，节点显示角色名与编入状态；宿主未提供子代理会话数据时统一标注「未提供运行数据」，不显示 0 值）与选中角色的详情（职责、指标占位、三条任务模板、工具白名单、系统提示词）；右侧是成员列表，支持搜索 + 全部 / 运行中 / 已结束 / 未编入筛选，卡片提供编入（更新、重新编入）/ 单步执行 / 移除，移除需点两次确认。
- **链路**：填靶标、勾选参与环节（默认只勾只读三步：测绘、评估、扫描；验证与横向需手动勾选），每个环节可展开编辑本步任务：默认用内置任务书，也可以换成该角色的模板，或自己加任务；只留一个环节就是「单步执行」。每步最多 8 条任务，超过会被面板拦住、后台也会拒绝启动。启动后，勾选中的环节按「测绘 → 评估 → 扫描 → 验证 → 横向」的固定先后自动接力，上一环的结论摘要作为不可信参考数据单独传给下一环（不进入操作者填写的补充说明）。派发文本里写明目标角色 `agentId`、授权边界与输出要求，主代理按宿主 subAgents 的选择规则把它交给该角色子代理执行。某一环失败会阻塞链路并说明原因，记录写进审计。
- **任务**：按角色、靶标、任务、时间、token、耗时、消息数展示每个派发记录，状态（运行中 / 已结束 / 失败 / 会话已不在）按会话运行情况推断；可切换到该会话继续对话，或移除记录。

编入 / 更新 / 移除、启动链路与移除任务都直接调用宿主动作，写动作记入审计。

边界：派发只是「新建会话 + 投递文本」，插件不直接调用 `sub-agents-activate`（那是保留工具），也不代为批准工具授权（免审批清单只由你在授权页显式保存）；主代理是否真的把任务交给目标角色，取决于宿主对编队子代理的选择与授权结果，插件不保证。敏感命令仍需你本人在对话里批准。

### 链路自动接力

角色之间是**串行**的：后一环要吃前一环的产出，并行只会重复采集并让判断互相打架。所以弹窗提供「链路」：填一次靶标，勾选参与的环节（默认只勾只读三步：测绘、评估、扫描；验证与横向需手动勾选，每步可换任务书或加自定义任务），点「启动链路」后：

1. 插件派发第一环，写入 `redteam-chains.json`；
2. 后台每 15 秒读一次会话状态（宿主没有完成事件，只能轮询），判定这一环「还在跑 / 已结束 / 失败 / 会话消失 / 超时」；
3. 结束后把它的**结论摘要**（会话最近一条回复）作为不可信参考数据传给下一环任务，再自动派发下一环；
4. 失败、会话消失、单步超过 30 分钟都会把链路置为「已阻塞」并停下来，等你处理；读不到会话列表、运行态或宿主的实时授权集合时同样不会推进，本步会停下等待确认，直到 30 分钟超时转「已阻塞」——这属于宿主实时状态不可用，不是该会话失败。

每一步都可以暂停、继续、跳过本步、停止或移除链路；链路状态与每步结论都显示在弹窗里。跳过某步时，下一环的任务会注明「上一环节已跳过，必要信息自行补齐」。

边界：这是**排队与推进**，不是执行编排。插件不知道子代理内部做了哪一步，也不判断结论质量；「已结束」只代表会话这一回合停了。要不要让「利用验证」与「内网横向」跑，仍由你决定——这两步默认不勾选，需要时自己勾上，运行中也可以随时暂停或跳过。

## 安装

```powershell
# 1) 构建
cd D:\ai-workspace\snow-plugins\snow-purge
npm install
npm run build
npm run check

# 2) 安装到 Snow App（真实 id 以 plugin.json 为准）
# config-manage action=set scope=plugins key="new" value={sourceDir:"D:/ai-workspace/snow-plugins/snow-purge"}
```

安装后从右侧面板打开 Purge，先看「状态」页的自检结果，再按需开启各层。

## 数据位置

| 内容 | 位置 |
| --- | --- |
| 插件配置 / 审计 | 插件私有存储（`app_plugin_values`） |
| 备份 | `<appData>/plugin-data/com.snow.purge/backups/` |
| 注入探针 | `<appData>/plugin-data/com.snow.purge/proxy-probe.log` |
| 代理脚本 | `<appData>/request-proxy/proxy.mjs`（Windows 下即 `C:\Users\<用户名>\.snowapp\request-proxy\proxy.mjs`） |
| 红队技能（安装后） | `~/.snow/skills/snow-redteam-<id>/SKILL.md`（Windows 下即 `C:\Users\<用户名>\.snow\skills\`） |
| 红队技能回收区 | `<appData>/plugin-data/com.snow.purge/redteam-removed/` |
| 红队编队索引 | `<appData>/plugin-data/com.snow.purge/redteam-roster.json`（只记签名与时间，角色配置本身在宿主数据库） |
| 红队任务索引 | `<appData>/plugin-data/com.snow.purge/redteam-tasks.json`（派发记录：角色、靶标、任务、会话 id；最多保留 40 条） |
| 红队任务归档 | `<appData>/plugin-data/com.snow.purge/redteam-tasks-archive.json`（被 40 条上限挤出的记录按同一结构保留，最多 200 条，用于回查会话与项目归属） |
| 红队链路索引 | `<appData>/plugin-data/com.snow.purge/redteam-chains.json`（每步角色、会话、状态与结论摘要；最多 10 条） |

## 隐私声明

面板只与本插件自己的后台服务通信（`127.0.0.1` 回环 HTTP + 随机令牌），不向任何外部服务上传数据。声明的域与用途见 `plugin.json` 的 `privacy.note`：`network`、`systemPrompts`、`personalization`、`toolApproval`、`subAgents`、`conversations`、`logs`。写动作的 `scope` 必须在这里声明，否则宿主会直接拒绝（`subAgents` 写编队配置，`conversations` 新建与切换任务会话）。`toolApproval` 的写入范围仅限免审批工具清单，且必须由你在面板点保存；敏感命令规则只读。`conversations` 只用于新建与切换任务会话，以及读取任务 / 链路自己派发的主会话状态；宿主未向插件暴露子代理会话记录，插件不读取子代理的标题、模型、token 或耗时。红队页的环境自检会只读 `~/.snow/.env`（若存在）与同名环境变量中的 `FOFA_KEY`、`REDTEAM_VPS_HOST`、`REDTEAM_VPS_KEY`（环境变量优先），面板只显示长度，私钥仅在确认为本机路径时显示 `~` 路径，主机地址只显示长度；文件内容不写入插件数据、不进入审计、不上传。通道令牌明文保存在插件私有存储（`channelEndpoint`）：同一用户下能读取该存储的本机进程拿到令牌后，即可调用本插件后台的全部读写接口（覆盖免审批清单、写 ROLE 与代理脚本、清空日志等）；插件不构成对本机恶意进程或其它插件的防护。

## 开发

```powershell
npm run build   # src/panel/main.jsx -> index.js；src/background/main.js -> background.mjs
npm run check   # 产物语法检查
```

工程约束：面板产物是单文件 bundle，禁止相对 import 与裸模块名；`react` / `react-dom` 由宿主注入；任何使用 `<>...</>` 的 `.jsx` 必须从 `./react.js` 导入 `Fragment`，否则运行时报 `Fragment is not defined`。
