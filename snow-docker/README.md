# Docker 面板插件

`com.snow.docker-panel` · 版本 0.1.0

Snow App 面板插件：在右侧面板通过 SSH 查看和操作远程 Docker。面板只负责界面，真正的 docker 调用由随插件的常驻后台模块在宿主 Electron 主进程内执行。

## 功能

### 服务器（远程 daemon）

- 插件只操作远程 Docker：面板顶部的「服务器」下拉列出已保存的 SSH 服务器，选中即建立连接；容器、日志、镜像、概览四个视图都从它读取
- 还没有服务器时，内容区会提示先去「远程」页添加一台；添加并连接后各处自动开始加载，不需要重开面板
- 项目页的构建并运行按运行配置里的「服务器」自动连接，连上后顶部选择也会跟着切过去（同一个 SSH 会话）

### 容器

- 列表：来自当前选中的服务器，运行中优先排序、按名称/镜像/端口过滤、只看运行中
- 操作：启动、停止、重启、暂停、恢复、删除（删除需二次点击确认，运行中的容器删除自动带 `--force`），全部在选中的服务器上执行
- 详情：命令、创建时间、退出码、重启策略、网络、端口映射、挂载、环境变量（`password|secret|token|key|credential|auth` 命中的键名打码）
- 资源：点击才读 `docker stats --no-stream`，不做后台轮询
- 详情操作栏的「查看日志」直接跳到「日志」标签页并选中这个容器

### 日志

- 独立标签页：顶部下拉选容器（默认选运行中的第一个，下拉可直接输入关键字搜索），下面是占满面板剩余高度的日志区
- 后台只为当前容器保留一条 `docker logs --tail 300 --timestamps -f` 流，走一条常驻 SSH 通道；面板按 offset 增量读取，不再每 2.5 秒重新执行一次 docker logs
- 日志每 1.5 秒增量拉取一次（切到别的标签页停止轮询，后台流空闲 5 分钟后自动关闭，回来时自动重连或整体重置）；「自动跟随」只控制是否贴到最新一行，关闭后仍继续接收新日志，方便回头翻历史
- 日志缓冲：后台环形缓冲最多 4000 行 / 2 MB，面板最多保留最近 2000 行、渲染最近 1000 行；单行超 2000 字符截断
- ANSI 颜色控制码（如 `\x1b[36m`）由面板解析成颜色，时间、线程、级别、logger 各自着色；Docker 的 UTC 时间戳前缀只在后台用于清屏过滤，界面不显示
- 清屏：清掉当前显示的历史，之后只显示新输出；底部提示「已清屏」，点「显示全部」恢复清屏前的内容（切标签页也不会丢）
- 自动换行：默认开启，长行折行显示；关掉后长行横向滚动（等同 IDEA 控制台的 Soft-Wrap 开关）
- 流在容器停止或 SSH 断开后结束，界面会提示；容器重新启动或点「重新加载」会重建流

### 镜像

- 列表、拉取（回车执行）、删除（二次确认），都在当前服务器上执行
- 上传到远程：镜像行的「上传」把本机 `docker save <image>` 的 stdout 直接 pipe 到远程 `<dockerPath> load` 的 stdin（不落临时文件，每秒报一次已传字节数，可取消）；需要本机装了 docker CLI 并已有该镜像。镜像列表跟随当前连接的服务器，上传发送的却是本机同名镜像：本机没有该镜像时会在任务开始前直接报错并说明原因，不会静默失败

### 项目

- 自动扫描当前激活项目（最多 8 层，跳过 `node_modules` / `dist` / `build` / `target` / `.git` 等目录），识别 `Dockerfile`、`Dockerfile.dev`、`Dockerfile-prod`、`app.dockerfile`、`Containerfile` 与 `docker-compose.yml` / `compose.yaml` / `compose.override.yml`
- 扫描覆盖不到的目录（例如放在被跳过目录里、或命名不在规则内）可以在「运行配置」弹窗左下角「添加 Dockerfile」手动填绝对路径登记：登记项标「手动」，文件被删掉后标「文件不存在」且可以删除配置
- 点「运行配置」或某行的「配置」打开配置弹窗（版式参考 IDEA 的 Docker 运行配置，弹窗覆盖整个 App 窗口并居中）：左侧列出项目里的 Dockerfile，右侧编辑选中项的配置，可反复修改并长期保存
- 已保存过运行配置的 Dockerfile 会在行上标「已配置」，方便区分还没配过的项
- 配置项按 IDEA 分组：配置名称、服务器（必选一台已保存的 SSH 服务器；构建与运行都在它上面执行，本机不需要装 Docker）；「构建」分组放 Dockerfile、上下文文件夹、镜像标记；「运行」分组放容器名称；「构建前执行」在运行之下单独一块，放构建工具（npm / Maven）
- 「构建前执行」是构建镜像前的打包步骤，版式对齐 IDEA 的 npm 运行配置：点该行右侧的文件夹图标打开配置弹窗
  - 构建工具：不执行 / npm / Maven
  - npm 侧：package.json 路径（留空按工作目录找；仅用于读取 scripts 候选，npm 的执行目录由「工作目录」决定）、包管理器（npm / yarn / pnpm）、命令（run / run-script / install / ci / test / start / …）、脚本名（点「重新读取脚本」会从 package.json 的 scripts 读出来做候选）、参数、Node 解释器、Node 参数（写进 `NODE_OPTIONS`）、环境变量、工作目录（留空用构建上下文）
  - Maven 侧：Maven 可执行文件（留空用 PATH 里的 `mvn`；PATH 里没有时填 Maven 安装目录、其 `bin` 目录或 `mvn.cmd` 的绝对路径，插件会把它放进 PATH 最前面）、Goals、Profiles（拼成 `-P`）、JVM 选项（写进 `MAVEN_OPTS`）、环境变量、工作目录
  - 事件顺序：npm / Maven 失败立即中止，构件不会白跑一次 `docker build`，日志会写明退出码
- 「构建」「运行」标题右侧的「修改」是勾选式附加项，勾上才显示对应输入区：构建侧为目标平台、构建参数、不使用缓存、构建前拉取基础镜像；运行侧为绑定端口、绑定挂载、环境变量、运行选项（取消勾选会同时清空该组的值）
- 弹窗底部：删除配置（二次确认）、取消、应用、保存配置（保存并关闭）
- 构建只有远程一种落点：把构建上下文用 SFTP 传到远程临时目录，在服务器上执行 `docker build`，结束后删掉临时目录，本机全程不需要 Docker
- 选了服务器但当前没连着不用先去「远程」页手动连接：点「构建并运行」会自动用该服务器已保存的密码连一次（这也正是 IDEA 的 Docker 工具不用先启动本机 Docker 的原因）
- 卡片上的「构建并运行」是一条龙：前置构建 → `docker build` → 按运行配置 `docker run`。链路是「本机前置构建（npm / Maven）→ 上传上下文 → 远程 build → 远程 run」。它对应 IDEA 里点 Dockerfile 左侧运行图标的行为，一个按钮跑完，不用先构建再运行；中途任一步失败立即中止
- 重跑同名容器：`docker run` 不允许两个同名容器，所以配置了容器名称时，构建并运行会先用 `docker rm -f <名称>` 替换掉旧容器（日志里会写一行「已删除原有容器」），和 IDEA 的 Docker 运行配置行为一致
- Compose：读 `config --services` 列出服务名（不需要 daemon），再读 `ps --format json` 显示运行状态与端口；提供 `up -d` / `stop` / `restart` / `down`，输出同样实时滚动。这些命令在本机 docker 上执行、不经过顶部选中的服务器：卡片标注「本机执行」，本机 docker 不可用时按钮禁用并给出原因；本机 docker CLI 路径 / `DOCKER_HOST` / context 在项目页的「本机 Docker」卡片里配置，保存后立即生效（该卡片不依赖 compose 文件，项目页始终显示）
- 「打开」按钮用宿主的文件阅读器打开 Dockerfile / compose 文件
- 切换项目会自动重扫；SSH 远程项目暂不支持扫描

### 远程（SSH 服务器配置）

- 独立标签页，只放 SSH 配置，可保存多台服务器：默认只显示服务器列表，点「新增服务器」或点列表里任一行，才在下方展开配置表单（名称、主机、端口、用户名、密码、远程 docker 路径）
- 每台服务器独立保存密码（宿主安全存储 `ctx.secrets`，不进插件私有存储，也不回显）；删除需二次点击，删掉正在连接的那台会先断开
- 「保存并连接」先保存表单再连接；「测试连接」用表单当前值连一次并跑 `docker version`，确认远程 daemon 可用；连接失败直接展示 `ECONNREFUSED` / 认证失败等原始原因
- 项目页的构建并运行也会用这台会话：没连接时按已保存的密码自动连一次，然后把构建上下文传到远程临时目录执行 `docker build`，本机不需要 Docker
- 认证目前只做账号密码；同一时刻只保持一条 SSH 会话，换另一台前会先断开
- 主机指纹：首次连接会记录服务器的 SHA256 主机指纹并保存在插件存储里，之后每次连接都在发送密码前核对；指纹变化会阻断连接，确认服务器重装或更换密钥后到表单底部点「重置主机指纹」
- 服务器清单与运行配置会额外备份到宿主数据目录下的 `plugin-data/com.snow.docker-panel/connection-backup.json`（不含密码、环境变量值、构建参数值、运行选项、Node / JVM 选项与脚本参数）：只在插件存储读取为空或读取失败时用于恢复，这些值需要重填；备份不在插件安装目录里，插件更新不会清掉它，旧版本留在安装目录的备份会在首次启动时自动迁移过去
- 备份文件是本机运行期数据，不能进仓库：仓库里只提交空字段模板 `connection-backup.example.json`（仅作结构参考，代码不读它），运行期的 `connection-backup.json` 由 `snow-docker/.gitignore` 排除。旧版本误把它提交进索引时，用 `git rm --cached snow-docker/connection-backup.json` 撤出索引并保留本地文件
- 模板字段：`cliPath` / `dockerHost` / `context` 是本机 docker 三项；`ssh.servers[]` 每台含 `id`、`name`、`host`、`port`、`username`、`dockerPath`、`hostKey`（密码不写进备份，单独存在宿主安全存储）；`runConfigs` 是以 Dockerfile 绝对路径为键的运行配置表

### 概览

- 显示当前服务器上的引擎、磁盘与 Compose 项目
- 连接卡片只显示当前服务器与远程 docker 路径；本机 docker CLI（路径 / `DOCKER_HOST` / context）在「项目」页的「本机 Docker」卡片里配置（无 compose 文件时该卡片同样显示），compose 与镜像上传都用它
- 引擎卡片：在线状态、版本、API 版本、系统/架构、CPU 与内存、存储驱动、数据目录、容器与镜像计数
- 磁盘占用（`docker system df`）与 Compose 项目列表

### 连接与重试

- 连接记录落盘：后台在 37291-37300 内取第一个可绑定端口，把「端口 + 随机令牌」写入插件私有存储，面板只按这条记录连接；后台重启后重新打开面板即可读到新记录
- 引擎离线时面板每 6 秒自动重试；Docker Desktop 启动后无需手动点刷新
- 面板在前台时容器/镜像 5 秒、概览 15 秒刷新

## 架构

```text
面板（ESM，宿主 React）
   │  127.0.0.1 回环 HTTP，带 x-snow-docker-channel 头
   ▼
background.mjs（Electron 主进程，Node 全权限）
   │  child_process            │ ssh2 会话（exec / sftp）
   ▼                           ▼
本机 docker CLI → Engine      远程主机：build / load / run / ps / logs / inspect
```

- 通道头做本机隔离：服务不应答 CORS 预检，网页跨站请求带不上自定义头。
- 后台只执行白名单子命令（ps / images / inspect / logs / stats / start / stop / restart / pause / unpause / rm / pull / rmi / build / compose / system / version / context / info）；容器 id、镜像引用、路径、tag 都过正则校验。运行选项会解析引号后作为 `docker run` 的追加参数（`--privileged` 等真实生效），但不接受任意 shell 片段。
- 远程命令同样是固定模板 + 校验过的参数拼成（远程 docker 路径只允许 `docker` 或绝对路径），不接受任意命令透传。
- 长任务（build、compose、镜像上传）在内存里保留最近 20 个任务、每个最多 2000 行，面板按 offset 增量拉取。
- 容器日志走常驻流：本机 spawn 一个 `docker logs -f` 子进程，远程保持一条 SSH 通道；后台维护 4000 行 / 2 MB 的环形缓冲，面板按绝对 offset 增量拉取，客户端落后时自动整体重置。

## 运行前提

- 本机只需要 docker CLI 用于镜像上传时的 `docker save`；其余操作全部通过 SSH 在服务器上执行。
- 本机不需要 Docker daemon：容器、日志、镜像、概览都通过 SSH 在服务器上执行，本机只负责前置构建（npm / Maven）、上传上下文，以及 compose 操作（compose 走本机 docker CLI，需要本机装 docker 且有可用 daemon）；顶部「服务器」选中哪台，四个视图就读哪台。
- 远程读取走 SSH：列表与概览每次刷新会开一个 `docker ...` 通道（面板 5 秒轮询一次），容器日志则是单独一条常驻通道；服务器上的 daemon 同样需要允许该账号执行 docker。
- 修改 PATH 或安装 Docker 后需重启 Snow App，后台模块才会继承新的环境变量。

## 开发

```powershell
Set-Location D:\ai-workspace\snow-plugins\snow-docker
npm install
npm run build
npm run check
```

产物：

- `src/panel/main.jsx` → `index.js`（渲染层 ESM，React 由宿主注入，JSX 编译为 `h(...)`）
- `src/background/main.js` → `background.mjs`（主进程 ESM）

安装：插件列表 → 从目录安装，选择本目录；或用 `config-manage` 的 `plugins` 域安装后启用。

## 边界

- 不提供任意 shell 透传：容器操作走白名单子命令，镜像引用、路径、端口、环境变量名都由正则校验；构建与运行的附加参数按数组传给 docker，运行选项解析引号后原样追加（`--privileged` 等会真实生效）。
- 运行配置存在插件私有存储里（按 Dockerfile 绝对路径索引），项目换机器后需要重新配置。
- 运行选项是自由文本，会按 IDEA 的写法解析引号后作为 `docker run` 的追加参数，请自行确认参数含义（例如 `--privileged`、`--network=host` 都会真实生效）。
- 日志与任务输出有上限（任务单次最多 2000 行、单行 1000 字符；容器日志后台缓冲 4000 行 / 2 MB、单行 2000 字符）。
- Docker socket 访问等同本机高权限；所有写操作都由你点击触发，插件不后台执行。
- 远程上传依赖远程主机已装 docker 且当前账号能执行它；上传时长受镜像大小与网络限制，整体 30 分钟超时。
- 主机指纹采用首次信任（TOFU）：首次连接会记录并固定指纹，但无法防御「第一次连接就已被中间人劫持」的情形；高安全场景请先用服务器控制台核对指纹，再点「保存并连接」。
- 远程构建把上下文整体传到服务器：内置忽略 `node_modules` / `.git` / `.idea` / `.gradle` 等目录，并遵守上下文目录里的 `.dockerignore`（支持通配符、目录尾斜杠、`#` 注释与 `!` 反选）；`dist` / `target` / `build` 这类产物目录**不会**被忽略，因为它们通常正是 Dockerfile 要 COPY 的内容。上限为 20000 个文件 / 1 GB，超出时请在项目里补 `.dockerignore` 或把构建上下文改成更小的目录
- 远程构建要求服务器上的 `/tmp`（或 `TMPDIR`）可写：临时目录形如 `/tmp/snow-docker-XXXXXX`，构建结束 / 失败 / 取消都会 `rm -rf` 掉；构建过程中单个镜像最多可跑 1 小时
- 前置构建（npm / Maven）始终在本机执行：产物要落在构建上下文目录里才会随之上传，日志里会给提示
- 远程构建的 `docker build` 只接受 `-f` / `-t` / `--platform` / `--build-arg` / `--no-cache` / `--pull` 与上下文 `.`，每个参数单独加引号后拼进命令，不接受任意 shell 片段
- 构建前执行只支持 npm（含 yarn / pnpm 三种包管理器）与 Maven 两种构建工具：npm 按 IDEA 的拼法生成 `npm run <script> <参数>`（或 `npm <命令>`），Maven 生成 `mvn <goals> -P <profiles>`。不接受 `./mvnw`、Gradle 等其他构建工具；参数逐个加引号后交给 `npm.cmd` / `yarn.cmd` / `pnpm.cmd` / `mvn.cmd`。Windows 下参数会先校验：含双引号、`%`、`&`、`|` 等 cmd 元字符直接报错，不会被当成命令分隔符执行。
- 暂无：交互式容器终端、Volume / Network 管理、Registry 登录与 push、SSH 密钥 / 跳板机认证、远程 compose、Dockerfile 语法高亮。
