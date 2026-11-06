# S0 Spike 报告：openhongguo + Snow App 面板插件

- 日期：2026-11-05
- 环境：Windows，Node v22.20.0，npm 10.9.3，宿主 Electron `^37.10.3`
- 插件：`com.snow.hongguo` v0.1.0，`openhongguo@0.2.0`
- 探针目录（临时，不属于插件产物）：`.snow/hongguo-probe/`
- 骨架目录：`snow-hongguo/`

## 结论总表

| 项 | 结论 | 关键证据 |
| --- | --- | --- |
| A SDK 能否跑通 | 能。五个方法全部返回 200，字段完整 | `discover` 9 部、`search("末世")` 6 部、`listEpisodes` 131/536 集、`resolvePlayback` 5 路 `bytevc1` 流 + 内容密钥 |
| B 请求体形态 | 混合：设备注册是 **protobuf 二进制**，业务 POST 是 **JSON 文本**。面板无法脱离后台直接跑 SDK | 设备注册 790 字节、`application/octet-stream;tt-data=a`、首 16 字节 `7463051000003176c9b6d71579d7e821`；`video_detail` 206 字节、`application/json`、首 16 字节 `7b2262697a5f706172616d22` |
| C 面板 ↔ 后台通道 | 方案可用：`node:http` 监听 `127.0.0.1:37191-37200` + 自定义请求头，端口用区间扫描发现、不依赖 storage。服务端与安装目录副本已实测；面板侧 `api.net.fetch` 这一跳待人工确认 | `/health` 200、`/rpc` ping 200、缺请求头 403、带 `Origin` 403、清理后端口关闭 |
| D HEVC + MSE | 面板已实现并在挂载时自动执行；宿主渲染层实测值**待人工确认**（同机 Chrome 交叉验证：GPU 开 → `hvc1` 两种 profile 都 true，GPU 关 → 都 false） | 面板渲染 + `api.log` 双写；Chrome headless 对照见 D 节 |
| E wasm 资产 | 可用。`dist/openhongguo.wasm` 6,920,507 字节，加载约 63-103 ms，`globalThis.__openhongguo` 存在 | `/probe/wasm` 返回 `{"loaded":true,"loadMs":91,"hasGlobal":true,"bytes":6920507}`；安装目录副本为 63 ms |

## A. SDK 能否真的跑通

安装与执行：

```powershell
mkdir D:\ai-workspace\snow-plugins\.snow\hongguo-probe
cd D:\ai-workspace\snow-plugins\.snow\hongguo-probe
npm i openhongguo@0.2.0 --no-audit --no-fund
node sdk-probe.mjs
```

探针用 `memoryProfileStore()` + 包装过的 `nodeTransport`，逐步调用并打印关键字段。

真实输出（节选，完整输出见 `.snow/hongguo-probe/probe-output.log`）：

```
=== discover OK (3936ms) ===
{ "has_more": true, "count": 9,
  "first3": [ { "id": "7701328280862854168", "title": "装穷提亲，娶到全家嫌弃的她", "episode_count": 80 } ] }

=== search(末世) OK (1172ms) ===
{ "has_more": true, "count": 6,
  "first3": [ { "id": "7682325650463542334", "title": "天灾末世，她囤满物资后所向披靡！", "episode_count": 536 } ] }

=== getSeries(7682325650463542334) OK (501ms) ===
{ "title": "天灾末世，她囤满物资后所向披靡！", "episode_count": 536, "is_multi_season": false }

=== listEpisodes(...) OK (399ms) ===
{ "has_more": false, "count": 536,
  "first3": [ { "id": "7682333262898809880", "number": 1, "title": "第1集", "playable": true } ] }

=== resolvePlayback(7682333262898809880) OK (153ms) ===
{ "protected": true, "streamCount": 5,
  "streams": [ { "quality": "normal", "codec": "bytevc1", "protected": true } ],
  "contentKey": { "version": "1", "keyLength": 32 },
  "contentKeyError": null }
```

要点：

- 首次调用会先注册匿名设备（`POST /service/2/device_register/`），之后所有请求都带同一套设备参数。
- 分集列表可能一次返回全部（536 集，`has_more=false`），也可能分页（131 集，`has_more=false`），取决于剧。
- 播放模型是**受保护**的：`protected=true`，5 路流全部 `codec=bytevc1`（字节 HEVC 变体），并返回 32 位十六进制的 AES 内容密钥（CENC AES-CTR）。解封装与解密是后续节点的核心难点。
- 二跑时出现过 `anonymous device unusable (openhongguo: anonymous response was empty); registering a new one`：SDK 在空响应时会自动换一台匿名设备重试，因此一次 `resolvePlayback` 可能包含两次设备注册请求。

结论：SDK 在 Node 22 下真实可用，无需账号。

## B. transport 的请求体是文本还是二进制

同一探针把每个请求的 `method / url / headers / body 构造器 / 字节长度 / 首 16 字节 hex` 记录下来。

真实输出：

```
[transport] #1 POST https://log5-applog-lq.fqnovel.com/service/2/device_register/?...
            ctor=Uint8Array bytes=790 hex16=7463051000003176c9b6d71579d7e821 looksJson=false
            contentType=application/octet-stream;tt-data=a
[transport] #2 GET  https://api5-normal-sinfonlinea.fqnovel.com/reading/bookapi/bookmall/tab/v?...
            ctor=Uint8Array bytes=0   hex16=(empty)
[transport] #5 POST https://api5-normal-sinfonlinea.fqnovel.com/novel/player/video_detail/v1/?...
            ctor=Uint8Array bytes=206 hex16=7b2262697a5f706172616d223a7b2263 looksJson=true
            contentType=application/json; charset=UTF-8
[transport] #7 POST https://api5-normal-sinfonlinea.fqnovel.com/novel/player/video_model/v1/?...
            ctor=Uint8Array bytes=118 hex16=7b2262697a5f706172616d223a7b226e looksJson=true
```

汇总：`requestCount=7`，`bodySizes=[790,0,0,0,206,206,118]`，`jsonBodyCount=3`，`binaryBodyCount=1`。

结论必须写死：**不是纯 JSON 文本**。

- 设备注册：protobuf 二进制，790 字节，`Content-Type: application/octet-stream;tt-data=a`，首字节 `0x74 0x63`（"tc"）后接 protobuf 字段。
- 业务接口（`video_detail` / `video_model`）：JSON 文本（首字符 `{`），`Content-Type: application/json; charset=UTF-8`。
- GET 请求没有 body。

对插件的影响：面板侧 `api.net.fetch` 的 `body` 只接受字符串，无法发送 protobuf 二进制；而且 SDK 还用 Go 里的签名逻辑生成 URL 与请求头。因此**面板不能脱离后台直接跑 SDK**，必须由后台模块（Node 全权限）调用 SDK。这条结论直接决定架构：面板只做 UI，后台持有 SDK 与设备档案。

## C. 面板 ↔ background 通道

实现（骨架内）：

- 后台：`node:http` 绑定 `127.0.0.1`，端口从 `37191` 起逐个试到 `37200`，首个可用即用。
- 路由：`GET /health`、`GET /probe/wasm`、`GET /probe/sdk`、`POST /rpc`。
- 鉴权：所有请求必须带 `x-snow-hongguo-channel: panel-rpc-v1`；带 `Origin` 头的请求一律 403（挡网页 CSRF，不应答 CORS 预检）。
- 端口发现：面板**并行**请求 10 个端口的 `/health`，只认 `pluginId === "com.snow.hongguo"` 的响应。**不读 `api.storage`** —— 面板侧 storage 有本地缓存，后台写入未必立刻可见，端口不能靠它传递。

离线验证（用假 ctx 直跑构建产物 `background.mjs`，完全按安装目录布局）：

```
[ctx.log] [http] listening on http://127.0.0.1:37191
[ctx.log] [hongguo] background started v0.1.0 installPath=D:\ai-workspace\snow-plugins\snow-hongguo

=== /health (37191) ===
{ "ok": true, "pluginId": "com.snow.hongguo", "version": "0.1.0", "port": 37191, ... }

=== POST /rpc ping ===
200 {"ok":true,"id":"h1","result":{"pong":true,"now":1793879954541,"port":37191}}

=== security checks ===
missing header -> 403
origin header -> 403

=== cleanup ===
[ctx.log] [hongguo] background stopped
port closed after cleanup -> true
```

安装到宿主后的通道实测见 F.3（安装目录副本）与 F.4（面板侧仍待确认）。

## D. HEVC + MSE 平台支持

面板挂载时立即执行以下检测并渲染，同时 `api.log` 输出一份（宿主日志可检索 `[probe] D media`）：

```js
typeof MediaSource
MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"')
MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L120.B0"')
MediaSource.isTypeSupported('video/mp4; codecs="avc1.640028"')
```

结果分两部分：

**宿主渲染层：待人工确认。** 后台模块的启动需要宿主触发一次 `plugins:rescan`/重启（见 F.4 坑 1），本轮没能从 AI 侧打开面板。面板的 D 行会在挂载时自动跑并渲染，同时写 `api.log`。

**同机 Chromium 交叉验证（不是宿主渲染层，只能作参考）：** 用本机 Chrome 156 版 headless 跑同一段检测（`.snow/hongguo-probe/media-check.html`）：

```
不带 --disable-gpu：
"hasMediaSource": true
hvc1.1.6.L93.B0   mse: true   canPlayType: "probably"
hvc1.1.6.L120.B0  mse: true   canPlayType: "probably"
avc1.640028       mse: true   canPlayType: "probably"

带 --disable-gpu：
hvc1.1.6.L93.B0   mse: false
hvc1.1.6.L120.B0  mse: false
avc1.640028       mse: true
```

读法：这台 Windows 上 HEVC 的 MSE 支持依赖 GPU/硬件解码路径，关掉 GPU 就退化为不支持。宿主 Electron 37 对应 Chromium 138，版本低于上面的 Chrome 156，且宿主是否启用 GPU 加速未知，所以**不能把 Chrome 的结论直接当宿主结论**，必须等面板实测。

用户查看步骤：

1. 先在「插件列表」里点一次「重新读取清单」（或重启宿主），让后台模块真正启动。
2. 顶栏加号菜单 → 插件 → 红果短剧（或左侧插件列表点该插件）。
3. 面板打开后 D 行自动出结果，无需点击；需要复核时在「设置 → 系统日志」搜 `[probe] D media`，可见完整 JSON（含 `userAgent`、三项 `mse` 与 `canPlayType`）。


## E. wasm 资产可用

包内文件（`npm i` 后）：

```
node_modules/openhongguo/dist/openhongguo.wasm   6920507 字节
node_modules/openhongguo/dist/wasm_exec.js         16992 字节
```

构建时由 `build.mjs` 复制到插件 `dist/`，安装后的目录（`C:\Users\<user>\.snowapp\plugins\com.snow.hongguo`）里同样存在：

```
dist\openhongguo.wasm   6920507
dist\wasm_exec.js         16992
dist\package.json            25
```

加载验证（`GET /probe/wasm`，走的是构建产物 `background.mjs`，不是源码）：

```json
{"ok":true,"wasm":{"loaded":true,"loadMs":91,"hasGlobal":true,"bytes":6920507,
 "path":"...\\com.snow.hongguo\\dist\\openhongguo.wasm",
 "execPath":"...\\com.snow.hongguo\\dist\\wasm_exec.js"}}
```

安装目录副本（`C:\Users\<user>\.snowapp\plugins\com.snow.hongguo`）里再加载一次是 `loadMs=63`、`bytes=6920507`、`hasGlobal=true`（见 F.3）。

关键细节（必须保留，否则换机器/换 Node 版本会炸）：

1. 官方包内部按 `dirname(import.meta.url)` + `dist/` 查找 wasm，bundle 后 `import.meta.url` 就是 `background.mjs` 的位置，所以 wasm 必须放在 `<插件目录>/dist/`，不能放别处。
2. 官方包用 `createRequire(import.meta.url); require(join(here,'dist','wasm_exec.js'))`。插件根 `package.json` 是 `"type":"module"`，Node 会把 `dist/wasm_exec.js` 当 ESM 解析。构建脚本因此额外写一个 `dist/package.json`：`{"type":"commonjs"}`，把该目录钉成 CJS，`require` 才能稳定工作。
3. 不能用 `instantiateStreaming`，也不能改成 `WebAssembly.instantiate` 之外的花样：官方包自己读文件字节并 `WebAssembly.instantiate`。

## F. 宿主内验证

### F.1 安装与启用

```powershell
# 安装（宿主返回 installed:true，enabled:true）
config-set scope=plugins key="new" value={sourceDir: "D:\ai-workspace\snow-plugins\snow-hongguo"}
```

`config-list scope=plugins` 中该项 `enabled: true`，`installPath` 为 `C:\Users\<user>\.snowapp\plugins\com.snow.hongguo`。

### F.2 后台启动日志

宿主把 `snowLog` 写入 `~/.snowapp/snowapp.db` 的 `app_logs` 表（不是文本文件）。本机没有 `config-logs-read` 工具，改用 Node 22 的 `node:sqlite` 直读：

```powershell
node --experimental-sqlite .snow\hongguo-probe\db-logs.cjs pluginBackground 30
```

预期看到 `module=pluginBackground`、`func=com.snow.hongguo`、`message=Plugin background started`，以及插件自己写的 `[http] listening on http://127.0.0.1:37191`。

实测结果与「坑」见 F.5。

### F.3 安装目录副本再跑一遍（证明「装上去的版本」可加载）

把 harness 指向安装目录，跑的是宿主复制过去的那份 `background.mjs` 与 `dist/`：

```powershell
node .snow\hongguo-probe\bundle-harness.mjs "C:\Users\<user>\.snowapp\plugins\com.snow.hongguo"
```

```
[ctx.log] [http] listening on http://127.0.0.1:37191
[ctx.log] [hongguo] background started v0.1.0 installPath=C:\Users\59684\.snowapp\plugins\com.snow.hongguo
=== GET /probe/wasm ===
200 {"ok":true,"wasm":{"loaded":true,"loadMs":63,"hasGlobal":true,"bytes":6920507,
  "path":"C:\\Users\\59684\\.snowapp\\plugins\\com.snow.hongguo\\dist\\openhongguo.wasm",
  "execPath":"C:\\Users\\59684\\.snowapp\\plugins\\com.snow.hongguo\\dist\\wasm_exec.js"}}
[ctx.log] [probe] sdk ok 6353ms {"discover":8,"search":6,"episodes":536,"streams":5,"requests":9}
=== POST /rpc ping === 200 {"ok":true,...,"pong":true}
missing header -> 403 / origin header -> 403
port closed after cleanup -> true
storage keys === [ 'device-profile' ]
```

也就是说：安装目录布局（`background.mjs` + `dist/wasm_exec.js` + `dist/openhongguo.wasm` + `dist/package.json`）在真实安装路径下可加载、可跑完整 SDK 链路、可正常清理。

### F.4 面板侧：待人工确认

以下三项必须在宿主渲染层里才能拿到，本轮未能打开面板（原因见 F.5）：

- `api.net.fetch("http://127.0.0.1:<port>/health")` 是否真的能通（主进程 `net.fetch` 对回环地址的行为、Clash 等系统代理是否影响）。
- 四项 MSE 检测在宿主 renderer 的真实值（D 项）。
- 面板渲染与 A/B/E 三行在点击按钮后的实际显示。

届时打开面板即可，D 自动跑，C 自动探测；点一次「测试本机后台」会串行执行 `/health` → `/rpc ping` → `/probe/wasm` → `/probe/sdk`。宿主日志里搜 `[probe]` 可看到每一步的 JSON。

### F.5 坑：AI 通过内置 `config-set` 安装插件不会启动后台模块

- 现象：`config-set scope=plugins` 返回 `installed:true`、DB 里 `enabled=1`、`manifest_json` 里 `background:{entry:"background.mjs"}` 都在，但 `app_logs` 没有任何 `pluginBackground` 记录，`127.0.0.1:37191-37200` 全部无响应。
- 原因：`config-set` 的 plugins 域由 Rust 侧直接写库（`native/src/mcp/servers/config/plugins_scope.rs`），主进程的 `syncPluginBackgrounds()` 只在 `plugins:install` / `plugins:rescan` / `plugins:set-enabled` / `plugins:delete` 这些 IPC 处理里被调用（`src/main/ipc/handlers/pluginHandlers.ts`）。`nativeHandlers.ts` 里那条「config-set 后同步后台」的分支只覆盖以 MCP 工具形式转发的调用，内置 config 服务不走它。
- 处理：安装后需要宿主触发一次 `plugins:rescan`（插件列表 →「重新读取清单」）或先禁用再启用，后台模块才会启动；重启宿主也行。后续节点发版验证时不要假设「config-set 成功 = 后台已运行」。

### F.6 其他实测记录

- 重复安装（`config-set` 用已有 id 再装一次）会原地替换目录并保持 `enabled: true`，但仍不会触发后台启动。
- 宿主日志不在文本文件里：`~/.snowapp/logs/runtime-trace.jsonl` 只记录内存/挂起事件，`snowLog` 全部进 `snowapp.db` 的 `app_logs` 表。
- `app_plugins.manifest_json` 保留完整清单（含 `background`），后台宿主读的就是这一份，所以清单写法只要 `plugin.json` 对就行。


## 复现清单

```powershell
# 1) A + B：SDK 与请求体
cd D:\ai-workspace\snow-plugins\.snow\hongguo-probe
npm i openhongguo@0.2.0
node sdk-probe.mjs

# 2) E + C（离线）：构建 + 假 ctx 直跑产物
cd D:\ai-workspace\snow-plugins\snow-hongguo
npm install
node build.mjs
cd D:\ai-workspace\snow-plugins\.snow\hongguo-probe
node bundle-harness.mjs

# 3) 宿主内：安装、启用、看日志
config-set scope=plugins key="new" value={sourceDir: "D:\ai-workspace\snow-plugins\snow-hongguo"}
config-list scope=plugins
node --experimental-sqlite .snow\hongguo-probe\db-logs.cjs pluginBackground 30
```

## 风险与后续节点注意

1. **播放模型是加密的**：`protected=true`、`bytevc1`（HEVC）+ CENC AES-CTR，`contentKey.key` 是 32 位十六进制。MSE 原生只吃 `cenc`/`cbcs` 的 `encrypted` 事件或分片解密，Chromium 的 ClearKey 需要正确的 `pssh` 与 init data；后续节点必须先验证「分片能否解密 + HEVC 能否解码」，否则要转码。
2. **协议非官方**：接口地址、签名、字段随时可能变；SDK 错误码要按 `code` 分支处理（`RATE_LIMITED` / `ANONYMOUS_LIMITED` / `DEVICE_REJECTED` / `CONTENT_UNAVAILABLE` / `END_OF_LIST`）。
3. **匿名设备身份**：本骨架把档案放在 `ctx.storage`（键 `device-profile`）。设备被拒或空响应时 SDK 会自动换设备，但频繁换设备可能触发风控；不要每次请求 `resetDevice()`。
4. **5 MB 响应上限**：`api.net.fetch` 与 `ctx.net.fetch` 都有 5 MB 上限。分集列表（536 集）与播放模型 JSON 都远小于此，但不要把整段视频走这两个通道。
5. **网络出口**：后台用官方默认 `nodeTransport`（`node:https`），不走宿主代理、不带 Cookie，也不受 `privacy` 的 `network` 校验（那是 `ctx.net.fetch` 的限制）。若要跟随应用代理，需要自己实现 transport 并用 `ctx.net.fetch` —— 但 `ctx.net.fetch` 的 body 只接受字符串，protobuf 注册体会失败，因此这条路只能用于纯 JSON 的接口。
6. **日志位置**：宿主日志在 `~/.snowapp/snowapp.db` 的 `app_logs` 表，`~/.snowapp/logs/runtime-trace.jsonl` 只有内存/挂起事件，不包含插件日志。
7. **安装目录可写**：插件更新会整体替换安装目录，所以不要把设备档案写在插件目录里（本骨架用 `ctx.storage` 规避）。
