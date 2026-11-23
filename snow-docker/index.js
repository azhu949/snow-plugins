// 构建产物：由 build.mjs 从 src/panel 打包生成，请勿直接编辑。

// src/panel/react.js
var bound = null;
function bindReact(React) {
  if (!React || typeof React.createElement !== "function") return false;
  bound = { React, createElement: React.createElement };
  return true;
}
function getReact() {
  if (!bound) throw new Error("宿主 React 尚未注入");
  return bound.React;
}
function h(type, props, ...children) {
  if (!bound) throw new Error("宿主 React 尚未注入");
  const flat = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      for (const item of child) flat.push(item);
    } else {
      flat.push(child);
    }
  }
  return bound.createElement(type, props, ...flat);
}
var Fragment = (props) => {
  const React = getReact();
  return React.createElement(React.Fragment, null, props?.children ?? null);
};
function ensureReact(api) {
  if (bound) return bound.React;
  const fromGlobal = typeof window !== "undefined" ? window.SnowAppPlugin?.React : null;
  if (bindReact(fromGlobal)) return bound.React;
  if (bindReact(api?.ui?.React)) return bound.React;
  throw new Error("宿主没有提供 React 实例");
}

// locales/zh-CN.json
var zh_CN_default = {
  "app.title": "Docker",
  "status.checking": "正在连接 Docker…",
  "status.online": "引擎在线",
  "status.cliMissing": "未找到 docker 命令",
  "status.daemonOffline": "引擎未运行",
  "status.refreshing": "正在刷新",
  "status.stale": "数据可能已过期",
  "action.refresh": "刷新",
  "action.retry": "重试",
  "action.cancel": "取消",
  "tab.containers": "容器",
  "tab.logs": "日志",
  "tab.images": "镜像",
  "tab.project": "项目",
  "tab.ssh": "远程",
  "tab.overview": "概览",
  "target.label": "服务器",
  "target.choose": "选择服务器",
  "target.search": "搜索服务器",
  "target.empty": "没有匹配的服务器",
  "target.none": "还没有远程服务器",
  "target.manage": "管理",
  "target.add": "添加服务器",
  "target.connect": "去连接",
  "target.offline": "未连接服务器",
  "target.needServer": "还没有远程服务器",
  "target.needServerHint": "本插件只通过 SSH 操作远程 Docker：先到「远程」页添加一台服务器并连接，容器、日志、镜像与概览都会从它读取",
  "target.notConnected": "还没有连接服务器",
  "target.notConnectedHint": "在面板顶部的「服务器」下拉里选一台即可连接，容器、日志、镜像与概览都会从它读取",
  "target.connecting": "正在切换…",
  "filter.placeholder": "过滤名称或镜像",
  "filter.all": "全部",
  "filter.running": "运行中",
  "list.empty": "没有匹配的容器",
  "list.emptyImages": "没有镜像",
  "list.noMatchImages": "没有匹配的镜像",
  "container.start": "启动",
  "container.stop": "停止",
  "container.restart": "重启",
  "container.pause": "暂停",
  "container.unpause": "恢复",
  "container.remove": "删除",
  "container.removeConfirm": "再点一次删除",
  "container.logs": "日志",
  "container.logsRefresh": "重新加载",
  "container.follow": "自动跟随",
  "container.followHint": "开启时贴到最新一行；关闭后仍接收新日志，只是不改变滚动位置",
  "container.inspect": "配置",
  "container.stats": "资源",
  "container.statsLoading": "读取中…",
  "container.noLogs": "暂无日志",
  "container.openLogs": "查看日志",
  "logs.select": "选择容器",
  "logs.selectSearch": "搜索容器",
  "logs.selectEmpty": "没有匹配的容器",
  "logs.empty": "没有可查看日志的容器",
  "logs.emptyHint": "先在「容器」标签页里启动或创建一个容器",
  "logs.clear": "清屏",
  "logs.cleared": "已清屏，只显示之后的新日志",
  "logs.showAll": "显示全部",
  "logs.wrap": "自动换行",
  "logs.ended": "日志流已结束",
  "container.detailLoading": "正在读取详情…",
  "container.ports": "端口",
  "container.mounts": "挂载",
  "container.env": "环境变量",
  "container.command": "命令",
  "container.created": "创建于",
  "container.restartPolicy": "重启策略",
  "container.networks": "网络",
  "container.exitCode": "退出码",
  "container.cpu": "CPU",
  "container.memory": "内存",
  "container.netIO": "网络",
  "container.blockIO": "磁盘",
  "container.pids": "进程数",
  "state.running": "运行中",
  "state.exited": "已停止",
  "state.paused": "已暂停",
  "state.created": "已创建",
  "state.restarting": "重启中",
  "state.removing": "删除中",
  "state.dead": "异常",
  "state.unknown": "未知",
  "image.pull": "拉取",
  "image.pullPlaceholder": "镜像名，如 nginx:latest",
  "image.remove": "删除",
  "image.removeConfirm": "确认删除",
  "image.deleting": "正在删除 {{image}}…",
  "image.usedByRunning": "使用中 {{count}}",
  "image.usedByStopped": "已停止引用",
  "image.usedByRunningHint": "正在被容器 {{names}} 使用",
  "image.usedByStoppedHint": "被已停止的容器 {{names}} 引用",
  "image.pulling": "正在拉取…",
  "image.pullStarted": "开始拉取 {{reference}}",
  "image.upload": "上传到远程",
  "image.uploadNeedTarget": "请先选择要上传到的服务器",
  "image.uploadSwitchHint": "上传会先连接所选服务器，并上传本机同名镜像",
  "image.uploadSameTarget": "该镜像已在当前连接的服务器上；上传只发送本机同名镜像",
  "image.uploadStarted": "开始上传 {{image}}",
  "image.uploading": "正在上传…",
  "image.target": "远程目标",
  "image.connect": "连接",
  "image.disconnect": "断开",
  "image.connectFirst": "请先连接所选远程服务器",
  "image.noTarget": "先在「远程」标签页添加 SSH 服务器，再回到这里上传镜像",
  "image.viewingRemote": "正在查看 {{target}} 上的镜像；该服务器上的镜像直接 pull 即可",
  "image.sourceLocal": "列表来自服务器",
  "image.sourceLocalHint": "镜像列表来自已连接的服务器；上传发送的是本机 docker 里的同名镜像",
  "image.uploadConfirm": "确认上传本机镜像",
  "image.uploadSourceWarning": "列表中的 {{image}} 来自 {{source}}，上传将发送本机 docker 里的同名镜像到 {{target}}；内容不同会覆盖目标上的同名镜像。再次点击「上传」确认。",
  "overview.cli": "命令行",
  "overview.daemon": "引擎",
  "overview.version": "版本",
  "overview.apiVersion": "API 版本",
  "overview.os": "系统",
  "overview.arch": "架构",
  "overview.cpus": "CPU 核数",
  "overview.memory": "内存",
  "overview.containers": "容器（运行 / 总数）",
  "overview.images": "镜像数",
  "overview.driver": "存储驱动",
  "overview.rootDir": "数据目录",
  "overview.disk": "磁盘占用",
  "overview.target": "当前目标",
  "overview.remoteHint": "容器、镜像、概览都跟随当前连接的服务器",
  "overview.compose": "Compose 项目",
  "overview.none": "无",
  "overview.reclaimable": "可回收",
  "error.title": "出错了",
  "error.dockerNotFound": "未找到 docker 命令：请安装 Docker Desktop 或把 docker 加入 PATH，然后重启 Snow App。",
  "error.daemonUnavailable": "连不上 Docker 引擎：请先启动 Docker Desktop 或对应 daemon。",
  "error.permissionDenied": "权限不足：当前用户没有访问 Docker 的权限。",
  "error.timeout": "Docker 响应超时，稍后再试。",
  "error.backgroundUnavailable": "后台服务未就绪：请确认插件已启用，稍后重试。",
  "error.generic": "操作失败：{{message}}",
  "notice.actionDone": "已执行：{{action}}",
  "notice.removed": "已删除",
  "notice.imageRemoved": "已删除 {{image}}",
  "notice.pulled": "已拉取 {{reference}}",
  "task.running": "执行中",
  "task.succeeded": "已完成",
  "task.failed": "失败",
  "task.cancelled": "已取消",
  "task.cancel": "取消任务",
  "task.clear": "收起日志",
  "task.truncated": "日志过长，较早的日志已被省略",
  "conn.title": "连接",
  "conn.cliPath": "CLI 路径（留空则用 PATH 中的 docker）",
  "conn.dockerHost": "DOCKER_HOST（可选，如 npipe:////./pipe/docker_engine）",
  "conn.context": "Context（可选）",
  "conn.contextDefault": "跟随系统默认",
  "conn.detect": "自动检测",
  "conn.detecting": "检测中…",
  "conn.save": "保存",
  "conn.saving": "保存中…",
  "conn.saved": "连接设置已保存",
  "conn.current": "当前",
  "conn.cliFound": "CLI 可用",
  "conn.cliUsed": "实际使用",
  "conn.envHost": "DOCKER_HOST",
  "conn.envContext": "DOCKER_CONTEXT",
  "conn.contexts": "已有 context",
  "conn.yes": "是",
  "conn.no": "否",
  "conn.autoRetry": "未就绪时每 6 秒自动重试",
  "ssh.servers": "远程服务器",
  "ssh.addServer": "新增服务器",
  "ssh.empty": "还没有远程服务器",
  "ssh.emptyHint": "在下面填好主机、用户名和密码后保存。",
  "ssh.newServer": "新增服务器",
  "ssh.name": "名称",
  "ssh.namePlaceholder": "如 测试机（留空用 用户@主机）",
  "ssh.host": "主机",
  "ssh.port": "端口",
  "ssh.username": "用户名",
  "ssh.password": "密码",
  "ssh.passwordSaved": "已保存，留空不修改",
  "ssh.passwordEmpty": "尚未设置",
  "ssh.clearPassword": "清除已保存密码",
  "ssh.clearPasswordConfirm": "再点一次清除",
  "ssh.clearPasswordDone": "已清除保存的密码",
  "ssh.clearPasswordFailed": "密码未能从安全存储中清除，请重试",
  "ssh.dockerPath": "远程 docker 路径",
  "ssh.connect": "保存并连接",
  "ssh.connecting": "连接中…",
  "ssh.test": "测试连接",
  "ssh.testing": "测试中…",
  "ssh.testOk": "连接成功，远程 Docker {{version}}",
  "ssh.dockerUnavailable": "已登录，但远程 docker 不可用",
  "ssh.save": "保存",
  "ssh.cancel": "取消",
  "ssh.saved": "服务器配置已保存",
  "ssh.passwordNotSaved": "服务器配置已保存，但密码没有写入系统安全存储，请重试或检查系统密钥服务",
  "ssh.saveFirst": "请先保存服务器配置",
  "ssh.remove": "删除",
  "ssh.removeConfirm": "再点一次删除",
  "ssh.removed": "服务器已删除",
  "ssh.lastUsed": "上次使用：{{name}}",
  "ssh.unknown": "未知",
  "ssh.disconnect": "断开",
  "ssh.connected": "已连接远程主机",
  "ssh.disconnected": "已断开远程主机",
  "ssh.statusIdle": "未连接",
  "ssh.statusConnecting": "正在连接…",
  "ssh.statusConnected": "已连接",
  "ssh.statusError": "连接失败",
  "ssh.statusClosed": "已断开",
  "ssh.target": "远端主机",
  "ssh.dockerVersion": "远程 Docker",
  "ssh.connectedAt": "连接时间",
  "ssh.onlyPassword": "目前只支持账号密码登录，密钥等其他验证方式后续再加。",
  "ssh.hostKey": "主机指纹",
  "ssh.hostKeyNone": "尚未固定；下次连接会记录并核对",
  "ssh.hostKeyReset": "重置主机指纹",
  "ssh.hostKeyResetConfirm": "再点一次重置",
  "ssh.hostKeyResetDone": "主机指纹已重置，下次连接会重新记录",
  "ssh.hostKeyHint": "首次连接会记录服务器主机指纹，之后指纹变化将阻断连接；确认服务器已重装或更换密钥后再重置",
  "project.noProject": "没有激活的项目",
  "project.noProjectHint": "先在左侧选中一个项目，再回到这里",
  "project.remoteUnsupported": "远程 SSH 项目暂不支持扫描本机 Dockerfile",
  "project.scanning": "正在扫描项目…",
  "project.rescan": "重新扫描",
  "project.dockerfiles": "Dockerfile",
  "project.composeFiles": "Compose 文件",
  "project.empty": "项目里没有找到 Dockerfile 或 compose 文件",
  "project.emptyHint": "扫描不到的 Dockerfile 可以在「运行配置」弹窗里手动添加路径",
  "project.build": "构建",
  "project.building": "构建中…",
  "project.buildStarted": "已开始构建 {{tag}}",
  "project.buildRun": "构建并运行",
  "project.buildRunStarted": "已开始构建并运行 {{tag}}",
  "project.config": "配置",
  "project.runConfigs": "运行配置",
  "project.configDockerfile": "Dockerfile",
  "project.buildArgsAdd": "添加参数",
  "project.removeArg": "移除该参数",
  "project.contextInvalid": "构建上下文必须是绝对路径",
  "project.configCancel": "取消",
  "project.configName": "配置名称",
  "project.configServer": "服务器",
  "project.serverLocal": "本机",
  "project.serverHint": "构建与运行都在选中的服务器上执行，本插件不操作本机 Docker",
  "project.needServer": "请选择一台远程服务器：本插件只通过 SSH 操作远程 Docker",
  "project.sectionBuild": "构建",
  "project.sectionRun": "运行",
  "project.modify": "修改",
  "project.option.platform": "目标平台",
  "project.option.buildArgs": "构建参数",
  "project.option.noCache": "不使用缓存",
  "project.option.pull": "构建前拉取基础镜像",
  "project.option.ports": "绑定端口",
  "project.option.mounts": "绑定挂载",
  "project.option.env": "环境变量",
  "project.option.runOptions": "运行选项",
  "project.configContainerName": "容器名称",
  "project.configContainerNameHint": "留空由 Docker 自动命名",
  "project.notSet": "未设置",
  "project.keyName": "名称",
  "project.keyValue": "值",
  "project.editValue": "编辑该值",
  "project.sectionSwitch": "开关",
  "project.preBuild": "构建前执行",
  "project.preBuildTool": "构建工具",
  "project.preBuildHint": "选择 npm 或 Maven 后可继续配置参数",
  "project.packageJson": "package.json",
  "project.packageJsonHint": "留空则按工作目录找 package.json；仅用于读取 scripts 候选，执行目录由「工作目录」决定",
  "project.packageManager": "包管理器",
  "project.npmCommand": "命令",
  "project.npmScript": "脚本",
  "project.npmScriptHint": "脚本名，可从 package.json 的 scripts 里选",
  "project.scriptCustom": "自定义…",
  "project.scriptsNeedRestart": "后台还是旧版本，重启一次 App 后即可读取脚本",
  "project.npmArguments": "参数",
  "project.argumentsHint": "传给脚本的追加参数",
  "project.nodePath": "Node 解释器",
  "project.nodePathHint": "留空使用 PATH 里的 node",
  "project.nodeOptions": "Node 参数",
  "project.nodeOptionsHint": "写进 NODE_OPTIONS，例如 --max-old-space-size=4096",
  "project.preBuildEnv": "环境变量",
  "project.preBuildCwd": "工作目录",
  "project.preBuildCwdHint": "留空则用构建上下文文件夹",
  "project.mavenPath": "Maven 可执行文件",
  "project.mavenPathHint": "留空用 PATH 里的 mvn；可填 Maven 安装目录、bin 目录或 mvn.cmd 的绝对路径",
  "project.mavenPathInvalid": "Maven 可执行文件要么是 mvn 这样的名字，要么是绝对路径",
  "project.mavenGoals": "Goals",
  "project.mavenGoalsHint": "例如 -B clean package -DskipTests",
  "project.mavenProfiles": "Profiles",
  "project.mavenProfilesHint": "多个用逗号分隔，例如 dev,test",
  "project.mavenJvm": "JVM 选项",
  "project.mavenJvmHint": "写进 MAVEN_OPTS，例如 -Xmx1g",
  "project.toolNone": "不执行",
  "project.scriptsLoad": "重新读取脚本",
  "project.scriptsLoading": "正在读取 package.json…",
  "project.scriptsFound": "已读取 {{count}} 个脚本",
  "project.scriptsEmpty": "package.json 里没有 scripts",
  "project.scriptsMissing": "没找到 package.json",
  "project.npmScriptInvalid": "请填写 npm 的脚本名",
  "project.mavenGoalsInvalid": "请填写 Maven 的 goals",
  "project.packageJsonInvalid": "package.json 必须是绝对路径",
  "project.preBuildCwdInvalid": "工作目录必须是绝对路径",
  "project.configContextFolder": "上下文文件夹",
  "project.configTag": "镜像标记",
  "project.configContextHint": "留空则用 Dockerfile 所在目录",
  "project.configPlatform": "目标平台",
  "project.configBuildArgs": "构建参数",
  "project.addRow": "添加",
  "project.removeRow": "移除该行",
  "project.portHost": "主机端口",
  "project.portContainer": "容器端口",
  "project.mountHost": "服务器路径",
  "project.mountTarget": "容器路径",
  "project.mountReadOnly": "只读挂载",
  "project.mountReadOnlyShort": "只读",
  "project.runOptionsHint": "追加的 docker run 参数，例如 --restart=always",
  "project.envSecretHint": "值会以 -e 参数进入远端命令行与进程表，容器内也能通过 inspect 与 /proc/1/environ 读到；私钥、证书等敏感内容建议改用只读绑定挂载，或在运行选项里使用 --env-file（文件需已存在于服务器）",
  "project.run": "运行",
  "project.runStarted": "已开始运行 {{name}}",
  "project.containerNameInvalid": "容器名称只能包含字母、数字、点、横线与下划线，且以字母或数字开头",
  "project.portInvalid": "端口必须是 1-65535 之间的数字",
  "project.mountHostInvalid": "绑定挂载的主机路径必须是服务器上的绝对路径（以 / 开头），例如 /data/app",
  "project.mountTargetInvalid": "绑定挂载的容器路径必须以 / 开头",
  "project.envInvalid": "环境变量名只能包含字母、数字与下划线，且不能以数字开头",
  "project.envValueTooLong": "环境变量 {{key}} 的值有 {{count}} 个字符，超过单值上限 {{max}}；请精简内容或改用文件挂载",
  "project.envTotalTooLarge": "环境变量的总值约 {{count}} KB，超过单份配置上限 {{max}} KB；请精简变量，或把大段内容放到服务器上的文件里",
  "project.preBuildEnvValueTooLong": "前置构建环境变量 {{key}} 的值有 {{count}} 个字符，超过单值上限 {{max}}；请精简内容，或改用文件挂载传入",
  "project.preBuildEnvTotalTooLarge": "前置构建环境变量的合计长度 {{count}} 个字符（含变量名与分隔符），超过合计上限 {{max}}；请精简变量，或改用文件挂载传入",
  "project.preBuildEnvTotalCount": "合计 {{count}} / {{max}} 字符（含变量名）",
  "project.dockerfileInvalid": "Dockerfile 路径必须是绝对路径，且文件名形如 Dockerfile、Dockerfile.dev",
  "project.configNoCache": "不使用缓存",
  "project.configPull": "构建前拉取最新基础镜像",
  "project.configLoading": "正在读取已保存的配置…",
  "project.configApply": "应用",
  "project.configSave": "保存配置",
  "project.configSaveBuild": "保存并构建",
  "project.configDelete": "删除配置",
  "project.configDeleteConfirm": "再点一次删除",
  "project.configSaved": "运行配置已保存",
  "project.configDeleted": "运行配置已删除",
  "project.uploadNone": "不上传",
  "project.addDockerfile": "添加 Dockerfile",
  "project.addDockerfileHint": "Dockerfile 的绝对路径，如 D:\\proj\\deploy\\Dockerfile",
  "project.add": "添加",
  "project.added": "已添加该 Dockerfile",
  "project.addInvalid": "请填写 Dockerfile 的绝对路径",
  "project.manual": "手动",
  "project.missing": "文件不存在",
  "project.configured": "已配置",
  "project.configuredHint": "已保存运行配置",
  "project.needTag": "请填写镜像标签，例如 app:latest",
  "project.buildArgsInvalid": "构建参数格式不对，每行一个 KEY=VALUE",
  "project.composeStarted": "已开始 compose {{action}}",
  "project.composeUp": "启动",
  "project.composeDown": "停止并移除",
  "project.composeDownConfirm": "确认移除",
  "project.composeStop": "停止",
  "project.composeRestart": "重启",
  "project.composeLocal": "本机执行",
  "project.localDocker": "本机 Docker",
  "project.composeLocalHint": "Compose 命令在本机 docker 上执行，不经过顶部选中的服务器",
  "project.composeLocalUnavailable": "本机 docker 不可用，无法执行 compose 操作",
  "project.loadingServices": "正在读取服务状态…",
  "project.noServices": "没有运行中的服务",
  "project.openFile": "打开",
  "project.truncated": "目录较大，扫描结果已截断",
  "settings.recovered.body": "已从本地配置备份恢复：{{configs}} 条运行配置的{{fields}}已按隐私策略清空，直接构建或运行会以空参数执行，请打开对应配置重新填写。",
  "settings.recovered.dismiss": "知道了",
  "settings.recovered.field.buildArgs": "构建参数值",
  "settings.recovered.field.env": "环境变量值",
  "settings.recovered.field.runOptions": "运行选项",
  "settings.recovered.field.preBuildEnv": "前置构建环境变量值",
  "security.tokenNotPersisted": "通道令牌未能写入插件存储，本机其它进程可调用面板接口（含删除、构建等写操作）。请重启 App 或检查插件数据目录权限。"
};

// locales/zh-TW.json
var zh_TW_default = {
  "app.title": "Docker",
  "status.checking": "正在連線 Docker…",
  "status.online": "引擎在線",
  "status.cliMissing": "找不到 docker 指令",
  "status.daemonOffline": "引擎未執行",
  "status.refreshing": "正在重新整理",
  "status.stale": "資料可能已過期",
  "action.refresh": "重新整理",
  "action.retry": "重試",
  "action.cancel": "取消",
  "tab.containers": "容器",
  "tab.logs": "日誌",
  "tab.images": "映像",
  "tab.project": "專案",
  "tab.ssh": "遠端",
  "tab.overview": "概覽",
  "target.label": "伺服器",
  "target.choose": "選擇伺服器",
  "target.search": "搜尋伺服器",
  "target.empty": "沒有符合的伺服器",
  "target.none": "還沒有遠端伺服器",
  "target.manage": "管理",
  "target.add": "新增伺服器",
  "target.connect": "去連線",
  "target.offline": "未連線伺服器",
  "target.needServer": "還沒有遠端伺服器",
  "target.needServerHint": "本外掛只透過 SSH 操作遠端 Docker：先到「遠端」分頁新增一台伺服器並連線，容器、日誌、映像與概覽都會從它讀取",
  "target.notConnected": "還沒有連線伺服器",
  "target.notConnectedHint": "在面板頂部的「伺服器」下拉裡選一台即可連線，容器、日誌、映像與概覽都會從它讀取",
  "target.connecting": "正在切換…",
  "filter.placeholder": "篩選名稱或映像",
  "filter.all": "全部",
  "filter.running": "執行中",
  "list.empty": "沒有符合的容器",
  "list.emptyImages": "沒有映像",
  "list.noMatchImages": "沒有符合的映像",
  "container.start": "啟動",
  "container.stop": "停止",
  "container.restart": "重新啟動",
  "container.pause": "暫停",
  "container.unpause": "恢復",
  "container.remove": "刪除",
  "container.removeConfirm": "再點一次刪除",
  "container.logs": "日誌",
  "container.logsRefresh": "重新載入",
  "container.follow": "自動跟隨",
  "container.followHint": "開啟時貼到最新一行；關閉後仍接收新日誌，只是不改變捲動位置",
  "container.inspect": "設定",
  "container.stats": "資源",
  "container.statsLoading": "讀取中…",
  "container.noLogs": "尚無日誌",
  "container.openLogs": "檢視日誌",
  "logs.select": "選擇容器",
  "logs.selectSearch": "搜尋容器",
  "logs.selectEmpty": "沒有符合的容器",
  "logs.empty": "沒有可檢視日誌的容器",
  "logs.emptyHint": "先在「容器」分頁裡啟動或建立一個容器",
  "logs.clear": "清屏",
  "logs.cleared": "已清屏，只顯示之後的新日誌",
  "logs.showAll": "顯示全部",
  "logs.wrap": "自動換行",
  "logs.ended": "日誌流已結束",
  "container.detailLoading": "正在讀取詳情…",
  "container.ports": "連接埠",
  "container.mounts": "掛載",
  "container.env": "環境變數",
  "container.command": "指令",
  "container.created": "建立於",
  "container.restartPolicy": "重啟策略",
  "container.networks": "網路",
  "container.exitCode": "結束代碼",
  "container.cpu": "CPU",
  "container.memory": "記憶體",
  "container.netIO": "網路",
  "container.blockIO": "磁碟",
  "container.pids": "程序數",
  "state.running": "執行中",
  "state.exited": "已停止",
  "state.paused": "已暫停",
  "state.created": "已建立",
  "state.restarting": "重新啟動中",
  "state.removing": "刪除中",
  "state.dead": "異常",
  "state.unknown": "未知",
  "image.pull": "拉取",
  "image.pullPlaceholder": "映像名稱，如 nginx:latest",
  "image.remove": "刪除",
  "image.removeConfirm": "再點一次刪除",
  "image.deleting": "正在刪除 {{image}}…",
  "image.usedByRunning": "使用中 {{count}}",
  "image.usedByStopped": "已停止引用",
  "image.usedByRunningHint": "正在被容器 {{names}} 使用",
  "image.usedByStoppedHint": "被已停止的容器 {{names}} 引用",
  "image.pulling": "正在拉取…",
  "image.upload": "上傳到遠端",
  "image.uploadNeedTarget": "請先選擇要上傳到的伺服器",
  "image.uploadSwitchHint": "上傳會先連線所選伺服器，並上傳本機同名映像",
  "image.uploadSameTarget": "該映像已在目前連線的伺服器上；上傳只傳送本機同名映像",
  "image.uploadStarted": "開始上傳 {{image}}",
  "image.uploading": "正在上傳…",
  "image.target": "遠端目標",
  "image.connect": "連線",
  "image.disconnect": "中斷",
  "image.connectFirst": "請先連線所選的遠端伺服器",
  "image.noTarget": "先在「遠端」分頁新增 SSH 伺服器，再回到這裡上傳映像",
  "image.viewingRemote": "正在檢視 {{target}} 上的映像；該伺服器上的映像直接 pull 即可",
  "image.sourceLocal": "清單來自伺服器",
  "image.sourceLocalHint": "映像清單來自已連線的伺服器；上傳傳送的是本機 docker 裡同名映像",
  "image.uploadConfirm": "確認上傳本機映像",
  "image.uploadSourceWarning": "清單中的 {{image}} 來自 {{source}}，上傳將傳送本機 docker 裡同名映像到 {{target}}；內容不同會覆蓋目標上的同名映像。再次點擊「上傳」確認。",
  "overview.cli": "命令列",
  "overview.daemon": "引擎",
  "overview.version": "版本",
  "overview.apiVersion": "API 版本",
  "overview.os": "系統",
  "overview.arch": "架構",
  "overview.cpus": "CPU 核心數",
  "overview.memory": "記憶體",
  "overview.containers": "容器（執行 / 總數）",
  "overview.images": "映像數",
  "overview.driver": "儲存驅動",
  "overview.rootDir": "資料目錄",
  "overview.disk": "磁碟佔用",
  "overview.target": "目前目標",
  "overview.remoteHint": "容器、映像、概覽都跟隨目前連線的伺服器",
  "overview.compose": "Compose 專案",
  "overview.none": "無",
  "overview.reclaimable": "可回收",
  "error.title": "發生錯誤",
  "error.dockerNotFound": "找不到 docker 指令：請安裝 Docker Desktop 或把 docker 加入 PATH，然後重新啟動 Snow App。",
  "error.daemonUnavailable": "連不上 Docker 引擎：請先啟動 Docker Desktop 或對應 daemon。",
  "error.permissionDenied": "權限不足：目前使用者沒有存取 Docker 的權限。",
  "error.timeout": "Docker 回應逾時，請稍後再試。",
  "error.backgroundUnavailable": "後台服務尚未就緒：請確認外掛已啟用，稍後重試。",
  "error.generic": "操作失敗：{{message}}",
  "notice.actionDone": "已執行：{{action}}",
  "notice.removed": "已刪除",
  "notice.imageRemoved": "已刪除 {{image}}",
  "notice.pulled": "已拉取 {{reference}}",
  "task.running": "執行中",
  "task.succeeded": "已完成",
  "task.failed": "失敗",
  "task.cancelled": "已取消",
  "task.cancel": "取消任務",
  "task.clear": "收起日誌",
  "task.truncated": "日誌過長，較早的日誌已被省略",
  "conn.title": "連線",
  "conn.cliPath": "CLI 路徑（留空則用 PATH 中的 docker）",
  "conn.dockerHost": "DOCKER_HOST（可選，如 npipe:////./pipe/docker_engine）",
  "conn.context": "Context（可選）",
  "conn.contextDefault": "跟隨系統預設",
  "conn.detect": "自動偵測",
  "conn.detecting": "偵測中…",
  "conn.save": "儲存",
  "conn.saving": "儲存中…",
  "conn.saved": "連線設定已儲存",
  "conn.current": "目前",
  "conn.cliFound": "CLI 可用",
  "conn.cliUsed": "實際使用",
  "conn.envHost": "DOCKER_HOST",
  "conn.envContext": "DOCKER_CONTEXT",
  "conn.contexts": "現有 context",
  "conn.yes": "是",
  "conn.no": "否",
  "conn.autoRetry": "未就緒時每 6 秒自動重試",
  "ssh.servers": "遠端伺服器",
  "ssh.addServer": "新增伺服器",
  "ssh.empty": "還沒有遠端伺服器",
  "ssh.emptyHint": "在下面填好主機、使用者名稱與密碼後儲存。",
  "ssh.newServer": "新增伺服器",
  "ssh.name": "名稱",
  "ssh.namePlaceholder": "如 測試機（留空用 使用者@主機）",
  "ssh.host": "主機",
  "ssh.port": "連接埠",
  "ssh.username": "使用者名稱",
  "ssh.password": "密碼",
  "ssh.passwordSaved": "已儲存，留空不修改",
  "ssh.passwordEmpty": "尚未設定",
  "ssh.clearPassword": "清除已儲存密碼",
  "ssh.clearPasswordConfirm": "再點一次清除",
  "ssh.clearPasswordDone": "已清除儲存的密碼",
  "ssh.clearPasswordFailed": "密碼未能從安全儲存中清除，請重試",
  "ssh.dockerPath": "遠端 docker 路徑",
  "ssh.connect": "儲存並連線",
  "ssh.connecting": "連線中…",
  "ssh.test": "測試連線",
  "ssh.testing": "測試中…",
  "ssh.testOk": "連線成功，遠端 Docker {{version}}",
  "ssh.dockerUnavailable": "已登入，但遠端 docker 無法使用",
  "ssh.save": "儲存",
  "ssh.cancel": "取消",
  "ssh.saved": "伺服器設定已儲存",
  "ssh.passwordNotSaved": "伺服器設定已儲存，但密碼沒有寫入系統安全儲存，請重試或檢查系統金鑰服務",
  "ssh.saveFirst": "請先儲存伺服器設定",
  "ssh.remove": "刪除",
  "ssh.removeConfirm": "再點一次刪除",
  "ssh.removed": "伺服器已刪除",
  "ssh.lastUsed": "上次使用：{{name}}",
  "ssh.unknown": "未知",
  "ssh.disconnect": "中斷",
  "ssh.connected": "已連線遠端主機",
  "ssh.disconnected": "已中斷遠端主機",
  "ssh.statusIdle": "未連線",
  "ssh.statusConnecting": "正在連線…",
  "ssh.statusConnected": "已連線",
  "ssh.statusError": "連線失敗",
  "ssh.statusClosed": "已中斷",
  "ssh.target": "遠端主機",
  "ssh.dockerVersion": "遠端 Docker",
  "ssh.connectedAt": "連線時間",
  "ssh.onlyPassword": "目前只支援帳號密碼登入，金鑰等其他驗證方式後續再加。",
  "ssh.hostKey": "主機指紋",
  "ssh.hostKeyNone": "尚未固定；下次連線會記錄並核對",
  "ssh.hostKeyReset": "重設主機指紋",
  "ssh.hostKeyResetConfirm": "再點一次重設",
  "ssh.hostKeyResetDone": "主機指紋已重設，下次連線會重新記錄",
  "ssh.hostKeyHint": "首次連線會記錄伺服器主機指紋，之後指紋變更將阻斷連線；確認伺服器已重裝或更換金鑰後再重設",
  "project.noProject": "沒有啟用的專案",
  "project.noProjectHint": "先在左側選取一個專案，再回到這裡",
  "project.remoteUnsupported": "遠端 SSH 專案暫不支援掃描本機 Dockerfile",
  "project.scanning": "正在掃描專案…",
  "project.rescan": "重新掃描",
  "project.dockerfiles": "Dockerfile",
  "project.composeFiles": "Compose 檔案",
  "project.empty": "專案裡沒有找到 Dockerfile 或 compose 檔案",
  "project.emptyHint": "掃描不到的 Dockerfile 可以在「執行設定」彈窗裡手動新增路徑",
  "project.build": "建置",
  "project.building": "建置中…",
  "project.buildStarted": "已開始建置 {{tag}}",
  "project.buildRun": "建置並執行",
  "project.buildRunStarted": "已開始建置並執行 {{tag}}",
  "project.config": "設定",
  "project.runConfigs": "執行設定",
  "project.configDockerfile": "Dockerfile",
  "project.buildArgsAdd": "新增參數",
  "project.removeArg": "移除該參數",
  "project.contextInvalid": "建置上下文必須是絕對路徑",
  "project.configCancel": "取消",
  "project.configName": "設定名稱",
  "project.configServer": "伺服器",
  "project.serverLocal": "本機",
  "project.serverHint": "建置與執行都在選取的伺服器上執行，本外掛不操作本機 Docker",
  "project.needServer": "請選擇一台遠端伺服器：本外掛只透過 SSH 操作遠端 Docker",
  "project.sectionBuild": "建置",
  "project.sectionRun": "執行",
  "project.modify": "修改",
  "project.option.platform": "目標平台",
  "project.option.buildArgs": "建置參數",
  "project.option.noCache": "不使用快取",
  "project.option.pull": "建置前拉取基礎映像",
  "project.option.ports": "綁定連接埠",
  "project.option.mounts": "綁定掛載",
  "project.option.env": "環境變數",
  "project.option.runOptions": "執行選項",
  "project.configContainerName": "容器名稱",
  "project.configContainerNameHint": "留空由 Docker 自動命名",
  "project.notSet": "未設定",
  "project.keyName": "名稱",
  "project.keyValue": "值",
  "project.editValue": "編輯該值",
  "project.sectionSwitch": "開關",
  "project.preBuild": "建置前執行",
  "project.preBuildTool": "建置工具",
  "project.preBuildHint": "選擇 npm 或 Maven 後可繼續設定參數",
  "project.packageJson": "package.json",
  "project.packageJsonHint": "留空則依工作目錄尋找 package.json；僅用於讀取 scripts 候選，執行目錄由「工作目錄」決定",
  "project.packageManager": "套件管理器",
  "project.npmCommand": "命令",
  "project.npmScript": "腳本",
  "project.npmScriptHint": "腳本名稱，可從 package.json 的 scripts 選擇",
  "project.scriptCustom": "自訂…",
  "project.scriptsNeedRestart": "後台還是舊版本，重新啟動一次 App 後即可讀取腳本",
  "project.npmArguments": "參數",
  "project.argumentsHint": "傳給腳本的追加參數",
  "project.nodePath": "Node 解譯器",
  "project.nodePathHint": "留空使用 PATH 裡的 node",
  "project.nodeOptions": "Node 參數",
  "project.nodeOptionsHint": "寫進 NODE_OPTIONS，例如 --max-old-space-size=4096",
  "project.preBuildEnv": "環境變數",
  "project.preBuildCwd": "工作目錄",
  "project.preBuildCwdHint": "留空則用建置上下文資料夾",
  "project.mavenPath": "Maven 執行檔",
  "project.mavenPathHint": "留空用 PATH 裡的 mvn；可填 Maven 安裝目錄、bin 目錄或 mvn.cmd 的絕對路徑",
  "project.mavenPathInvalid": "Maven 執行檔要么是 mvn 這樣的名字，要么是絕對路徑",
  "project.mavenGoals": "Goals",
  "project.mavenGoalsHint": "例如 -B clean package -DskipTests",
  "project.mavenProfiles": "Profiles",
  "project.mavenProfilesHint": "多個以逗號分隔，例如 dev,test",
  "project.mavenJvm": "JVM 選項",
  "project.mavenJvmHint": "寫進 MAVEN_OPTS，例如 -Xmx1g",
  "project.toolNone": "不執行",
  "project.scriptsLoad": "重新讀取腳本",
  "project.scriptsLoading": "正在讀取 package.json…",
  "project.scriptsFound": "已讀取 {{count}} 個腳本",
  "project.scriptsEmpty": "package.json 裡沒有 scripts",
  "project.scriptsMissing": "找不到 package.json",
  "project.npmScriptInvalid": "請填寫 npm 的腳本名稱",
  "project.mavenGoalsInvalid": "請填寫 Maven 的 goals",
  "project.packageJsonInvalid": "package.json 必須是絕對路徑",
  "project.preBuildCwdInvalid": "工作目錄必須是絕對路徑",
  "project.configContextFolder": "上下文資料夾",
  "project.configTag": "映像標記",
  "project.configContextHint": "留空則用 Dockerfile 所在目錄",
  "project.configPlatform": "目標平台",
  "project.configBuildArgs": "建置參數",
  "project.addRow": "新增",
  "project.removeRow": "移除該列",
  "project.portHost": "主機連接埠",
  "project.portContainer": "容器連接埠",
  "project.mountHost": "伺服器路徑",
  "project.mountTarget": "容器路徑",
  "project.mountReadOnly": "唯讀掛載",
  "project.mountReadOnlyShort": "唯讀",
  "project.runOptionsHint": "附加的 docker run 參數，例如 --restart=always",
  "project.envSecretHint": "值會以 -e 參數進入遠端命令列與行程表，容器內也能透過 inspect 與 /proc/1/environ 讀到；私鑰、憑證等敏感內容建議改用唯讀綁定掛載，或在執行選項裡使用 --env-file（檔案需已存在於伺服器）",
  "project.run": "執行",
  "project.runStarted": "已開始執行 {{name}}",
  "project.containerNameInvalid": "容器名稱只能包含字母、數字、點、橫線與底線，且以字母或數字開頭",
  "project.portInvalid": "連接埠必須是 1-65535 之間的數字",
  "project.mountHostInvalid": "綁定掛載的主機路徑必須是伺服器上的絕對路徑（以 / 開頭），例如 /data/app",
  "project.mountTargetInvalid": "綁定掛載的容器路徑必須以 / 開頭",
  "project.envInvalid": "環境變數名稱只能包含字母、數字與底線，且不能以數字開頭",
  "project.envValueTooLong": "環境變數 {{key}} 的值有 {{count}} 個字元，超過單值上限 {{max}}；請精簡內容或改用檔案掛載",
  "project.envTotalTooLarge": "環境變數的總值約 {{count}} KB，超過單份設定上限 {{max}} KB；請精簡變數，或把大段內容放到伺服器上的檔案裡",
  "project.preBuildEnvValueTooLong": "前置建置環境變數 {{key}} 的值有 {{count}} 個字元，超過單值上限 {{max}}；請精簡內容，或改用檔案掛載傳入",
  "project.preBuildEnvTotalTooLarge": "前置建置環境變數的合計長度 {{count}} 個字元（含變數名稱與分隔符），超過合計上限 {{max}}；請精簡變數，或改用檔案掛載傳入",
  "project.preBuildEnvTotalCount": "合計 {{count}} / {{max}} 字元（含變數名稱）",
  "project.dockerfileInvalid": "Dockerfile 路徑必須是絕對路徑，且檔名形如 Dockerfile、Dockerfile.dev",
  "project.configNoCache": "不使用快取",
  "project.configPull": "建置前拉取最新基礎映像",
  "project.configLoading": "正在讀取已儲存的設定…",
  "project.configApply": "套用",
  "project.configSave": "儲存設定",
  "project.configSaveBuild": "儲存並建置",
  "project.configDelete": "刪除設定",
  "project.configDeleteConfirm": "再點一次刪除",
  "project.configSaved": "執行設定已儲存",
  "project.configDeleted": "執行設定已刪除",
  "project.uploadNone": "不上傳",
  "project.addDockerfile": "新增 Dockerfile",
  "project.addDockerfileHint": "Dockerfile 的絕對路徑，如 D:\\proj\\deploy\\Dockerfile",
  "project.add": "新增",
  "project.added": "已新增該 Dockerfile",
  "project.addInvalid": "請填寫 Dockerfile 的絕對路徑",
  "project.manual": "手動",
  "project.missing": "檔案不存在",
  "project.configured": "已設定",
  "project.configuredHint": "已儲存執行設定",
  "project.needTag": "請填寫映像標籤，例如 app:latest",
  "project.buildArgsInvalid": "建置參數格式不對，每行一個 KEY=VALUE",
  "project.composeStarted": "已開始 compose {{action}}",
  "project.composeUp": "啟動",
  "project.composeDown": "停止並移除",
  "project.composeDownConfirm": "確認移除",
  "project.composeStop": "停止",
  "project.composeRestart": "重新啟動",
  "project.composeLocal": "本機執行",
  "project.localDocker": "本機 Docker",
  "project.composeLocalHint": "Compose 指令在本機 docker 上執行，不經過頂部選取的伺服器",
  "project.composeLocalUnavailable": "本機 docker 無法使用，不能執行 compose 操作",
  "project.loadingServices": "正在讀取服務狀態…",
  "project.noServices": "沒有執行中的服務",
  "project.openFile": "開啟",
  "project.truncated": "目錄較大，掃描結果已截斷",
  "settings.recovered.body": "已從本機設定備份還原：{{configs}} 條執行設定的{{fields}}已依隱私策略清空，直接建置或執行會以空參數執行，請開啟對應設定重新填寫。",
  "settings.recovered.dismiss": "知道了",
  "settings.recovered.field.buildArgs": "建置參數值",
  "settings.recovered.field.env": "環境變數值",
  "settings.recovered.field.runOptions": "執行選項",
  "settings.recovered.field.preBuildEnv": "前置建置環境變數值",
  "security.tokenNotPersisted": "通道權杖未能寫入外掛儲存，本機其他程序可呼叫面板介面（含刪除、建置等寫入操作）。請重新啟動 App 或檢查外掛資料目錄權限。"
};

// locales/en.json
var en_default = {
  "app.title": "Docker",
  "status.checking": "Connecting to Docker…",
  "status.online": "Engine online",
  "status.cliMissing": "docker command not found",
  "status.daemonOffline": "Engine not running",
  "status.refreshing": "Refreshing",
  "status.stale": "Data may be stale",
  "action.refresh": "Refresh",
  "action.retry": "Retry",
  "action.cancel": "Cancel",
  "tab.containers": "Containers",
  "tab.logs": "Logs",
  "tab.images": "Images",
  "tab.project": "Project",
  "tab.ssh": "Remote",
  "tab.overview": "Overview",
  "target.label": "Server",
  "target.choose": "Choose a server",
  "target.search": "Search servers",
  "target.empty": "No matching server",
  "target.none": "No remote server yet",
  "target.manage": "Manage",
  "target.add": "Add server",
  "target.connect": "Connect",
  "target.offline": "No server connected",
  "target.needServer": "No remote server yet",
  "target.needServerHint": "This plugin only works with remote Docker over SSH: add and connect a server in the Remote tab first, then containers, logs, images and the overview read from it",
  "target.notConnected": "No server connected yet",
  "target.notConnectedHint": "Pick one from the Server dropdown at the top of the panel; containers, logs, images and the overview will read from it",
  "target.connecting": "Switching…",
  "filter.placeholder": "Filter by name or image",
  "filter.all": "All",
  "filter.running": "Running",
  "list.empty": "No matching containers",
  "list.emptyImages": "No images",
  "list.noMatchImages": "No matching images",
  "container.start": "Start",
  "container.stop": "Stop",
  "container.restart": "Restart",
  "container.pause": "Pause",
  "container.unpause": "Resume",
  "container.remove": "Remove",
  "container.removeConfirm": "Click again to remove",
  "container.logs": "Logs",
  "container.logsRefresh": "Reload",
  "container.follow": "Follow",
  "container.followHint": "On: stick to the newest line. Off: keep receiving logs without moving the viewport",
  "container.inspect": "Config",
  "container.stats": "Stats",
  "container.statsLoading": "Loading…",
  "container.noLogs": "No log output",
  "container.openLogs": "View logs",
  "logs.select": "Select container",
  "logs.selectSearch": "Search containers",
  "logs.selectEmpty": "No matching container",
  "logs.empty": "No container to show logs for",
  "logs.emptyHint": "Start or create a container in the Containers tab first",
  "logs.clear": "Clear",
  "logs.cleared": "Cleared; only new output is shown",
  "logs.showAll": "Show all",
  "logs.wrap": "Soft wrap",
  "logs.ended": "Log stream ended",
  "container.detailLoading": "Loading details…",
  "container.ports": "Ports",
  "container.mounts": "Mounts",
  "container.env": "Environment",
  "container.command": "Command",
  "container.created": "Created",
  "container.restartPolicy": "Restart policy",
  "container.networks": "Networks",
  "container.exitCode": "Exit code",
  "container.cpu": "CPU",
  "container.memory": "Memory",
  "container.netIO": "Network",
  "container.blockIO": "Block I/O",
  "container.pids": "PIDs",
  "state.running": "Running",
  "state.exited": "Stopped",
  "state.paused": "Paused",
  "state.created": "Created",
  "state.restarting": "Restarting",
  "state.removing": "Removing",
  "state.dead": "Dead",
  "state.unknown": "Unknown",
  "image.pull": "Pull",
  "image.pullPlaceholder": "Image reference, e.g. nginx:latest",
  "image.remove": "Remove",
  "image.removeConfirm": "Click again to remove",
  "image.deleting": "Removing {{image}}…",
  "image.usedByRunning": "In use {{count}}",
  "image.usedByStopped": "Stopped only",
  "image.usedByRunningHint": "Used by running container(s): {{names}}",
  "image.usedByStoppedHint": "Referenced by stopped container(s): {{names}}",
  "image.pulling": "Pulling…",
  "image.pullStarted": "Pulling {{reference}}",
  "image.upload": "Upload to remote",
  "image.uploadNeedTarget": "Choose a server to upload to first",
  "image.uploadSwitchHint": "Upload connects to the selected server first and sends the local image with the same name",
  "image.uploadSameTarget": "This image is already on the connected server; upload only sends the local image with the same name",
  "image.uploadStarted": "Uploading {{image}}",
  "image.uploading": "Uploading…",
  "image.target": "Remote target",
  "image.connect": "Connect",
  "image.disconnect": "Disconnect",
  "image.connectFirst": "Connect the selected remote server first",
  "image.noTarget": "Add an SSH server in the Remote tab, then come back to upload images",
  "image.viewingRemote": "Viewing images on {{target}}; pull directly on that server",
  "image.sourceLocal": "List from server",
  "image.sourceLocalHint": "The image list comes from the connected server; upload sends the same-named image from local Docker",
  "image.uploadConfirm": "Confirm local image upload",
  "image.uploadSourceWarning": "{{image}} in this list comes from {{source}}, but upload sends the same-named image from local Docker to {{target}}; different content will overwrite the same tag there. Click Upload again to confirm.",
  "overview.cli": "CLI",
  "overview.daemon": "Engine",
  "overview.version": "Version",
  "overview.apiVersion": "API version",
  "overview.os": "OS",
  "overview.arch": "Architecture",
  "overview.cpus": "CPU cores",
  "overview.memory": "Memory",
  "overview.containers": "Containers (running / total)",
  "overview.images": "Images",
  "overview.driver": "Storage driver",
  "overview.rootDir": "Data root",
  "overview.disk": "Disk usage",
  "overview.target": "Current target",
  "overview.remoteHint": "Containers, images and the overview follow the connected server",
  "overview.compose": "Compose projects",
  "overview.none": "None",
  "overview.reclaimable": "reclaimable",
  "error.title": "Something went wrong",
  "error.dockerNotFound": "docker command not found. Install Docker Desktop or add docker to PATH, then restart Snow App.",
  "error.daemonUnavailable": "Cannot reach the Docker engine. Start Docker Desktop (or the daemon) first.",
  "error.permissionDenied": "Permission denied: the current user cannot access Docker.",
  "error.timeout": "Docker timed out. Try again later.",
  "error.backgroundUnavailable": "Background service is not ready. Make sure the plugin is enabled and retry.",
  "error.generic": "Failed: {{message}}",
  "notice.actionDone": "Done: {{action}}",
  "notice.removed": "Removed",
  "notice.imageRemoved": "Removed {{image}}",
  "notice.pulled": "Pulled {{reference}}",
  "task.running": "Running",
  "task.succeeded": "Succeeded",
  "task.failed": "Failed",
  "task.cancelled": "Cancelled",
  "task.cancel": "Cancel task",
  "task.clear": "Hide log",
  "task.truncated": "Log too long; earlier lines were omitted",
  "conn.title": "Connection",
  "conn.cliPath": "CLI path (empty = docker from PATH)",
  "conn.dockerHost": "DOCKER_HOST (optional, e.g. npipe:////./pipe/docker_engine)",
  "conn.context": "Context (optional)",
  "conn.contextDefault": "Follow system default",
  "conn.detect": "Auto detect",
  "conn.detecting": "Detecting…",
  "conn.save": "Save",
  "conn.saving": "Saving…",
  "conn.saved": "Connection settings saved",
  "conn.current": "current",
  "conn.cliFound": "CLI available",
  "conn.cliUsed": "In use",
  "conn.envHost": "DOCKER_HOST",
  "conn.envContext": "DOCKER_CONTEXT",
  "conn.contexts": "Known contexts",
  "conn.yes": "yes",
  "conn.no": "no",
  "conn.autoRetry": "Retrying every 6 seconds until ready",
  "ssh.servers": "Remote servers",
  "ssh.addServer": "Add server",
  "ssh.empty": "No remote server yet",
  "ssh.emptyHint": "Fill in host, username and password below, then save.",
  "ssh.newServer": "New server",
  "ssh.name": "Name",
  "ssh.namePlaceholder": "e.g. staging (defaults to user@host)",
  "ssh.host": "Host",
  "ssh.port": "Port",
  "ssh.username": "Username",
  "ssh.password": "Password",
  "ssh.passwordSaved": "saved, leave empty to keep",
  "ssh.passwordEmpty": "not set",
  "ssh.clearPassword": "Clear saved password",
  "ssh.clearPasswordConfirm": "Click again to clear",
  "ssh.clearPasswordDone": "Saved password cleared",
  "ssh.clearPasswordFailed": "Could not clear the saved password; please retry",
  "ssh.dockerPath": "Remote docker path",
  "ssh.connect": "Save and connect",
  "ssh.connecting": "Connecting…",
  "ssh.test": "Test connection",
  "ssh.testing": "Testing…",
  "ssh.testOk": "Connected, remote Docker {{version}}",
  "ssh.dockerUnavailable": "Signed in, but the remote docker is unavailable",
  "ssh.save": "Save",
  "ssh.cancel": "Cancel",
  "ssh.saved": "Server settings saved",
  "ssh.passwordNotSaved": "Server settings saved, but the password could not be written to the system secret storage. Retry or check the system key service",
  "ssh.saveFirst": "Save the server first",
  "ssh.remove": "Delete",
  "ssh.removeConfirm": "Click again to delete",
  "ssh.removed": "Server deleted",
  "ssh.lastUsed": "Last used: {{name}}",
  "ssh.unknown": "unknown",
  "ssh.disconnect": "Disconnect",
  "ssh.connected": "Connected to the remote host",
  "ssh.disconnected": "Disconnected from the remote host",
  "ssh.statusIdle": "Not connected",
  "ssh.statusConnecting": "Connecting…",
  "ssh.statusConnected": "Connected",
  "ssh.statusError": "Connection failed",
  "ssh.statusClosed": "Disconnected",
  "ssh.target": "Remote host",
  "ssh.dockerVersion": "Remote Docker",
  "ssh.connectedAt": "Connected at",
  "ssh.onlyPassword": "Password login only for now; key-based auth comes later.",
  "ssh.hostKey": "Host key fingerprint",
  "ssh.hostKeyNone": "Not pinned yet; the next connection records and verifies it",
  "ssh.hostKeyReset": "Reset host key",
  "ssh.hostKeyResetConfirm": "Click again to reset",
  "ssh.hostKeyResetDone": "Host key reset; the next connection pins it again",
  "ssh.hostKeyHint": "The first connection pins the server host key; a changed key blocks the connection. Reset only after you confirm the server was reinstalled or its key rotated",
  "project.noProject": "No active project",
  "project.noProjectHint": "Select a project on the left, then come back",
  "project.remoteUnsupported": "Remote SSH projects cannot be scanned for local Dockerfiles yet",
  "project.scanning": "Scanning project…",
  "project.rescan": "Rescan",
  "project.dockerfiles": "Dockerfiles",
  "project.composeFiles": "Compose files",
  "project.empty": "No Dockerfile or compose file found in this project",
  "project.emptyHint": "Add the path of an unscanned Dockerfile inside the Run configurations dialog",
  "project.build": "Build",
  "project.building": "Building…",
  "project.buildStarted": "Building {{tag}}",
  "project.buildRun": "Build and run",
  "project.buildRunStarted": "Building and running {{tag}}",
  "project.config": "Configuration",
  "project.runConfigs": "Run configurations",
  "project.configDockerfile": "Dockerfile",
  "project.buildArgsAdd": "Add argument",
  "project.removeArg": "Remove this argument",
  "project.contextInvalid": "Build context must be an absolute path",
  "project.configCancel": "Cancel",
  "project.configName": "Name",
  "project.configServer": "Server",
  "project.serverLocal": "Local machine",
  "project.serverHint": "Build and run execute on the selected server; this plugin never touches a local Docker",
  "project.needServer": "Choose a remote server: this plugin only works with remote Docker over SSH",
  "project.sectionBuild": "Build",
  "project.sectionRun": "Run",
  "project.modify": "Modify",
  "project.option.platform": "Target platform",
  "project.option.buildArgs": "Build arguments",
  "project.option.noCache": "Do not use cache",
  "project.option.pull": "Always pull newer base image",
  "project.option.ports": "Port bindings",
  "project.option.mounts": "Bind mounts",
  "project.option.env": "Environment variables",
  "project.option.runOptions": "Run options",
  "project.configContainerName": "Container name",
  "project.configContainerNameHint": "Leave empty to let Docker name it",
  "project.notSet": "Not set",
  "project.keyName": "Name",
  "project.keyValue": "Value",
  "project.editValue": "Edit this value",
  "project.sectionSwitch": "Switches",
  "project.preBuild": "Before build",
  "project.preBuildTool": "Build tool",
  "project.preBuildHint": "Pick npm or Maven to configure the arguments",
  "project.packageJson": "package.json",
  "project.packageJsonHint": "Empty looks for package.json in the working directory; used only to list scripts, the command runs in the working directory",
  "project.packageManager": "Package manager",
  "project.npmCommand": "Command",
  "project.npmScript": "Script",
  "project.npmScriptHint": "Script name, or pick one from package.json",
  "project.scriptCustom": "Custom…",
  "project.scriptsNeedRestart": "The background module is still an old build; restart the app to read scripts",
  "project.npmArguments": "Arguments",
  "project.argumentsHint": "Extra arguments passed to the script",
  "project.nodePath": "Node interpreter",
  "project.nodePathHint": "Empty uses node from PATH",
  "project.nodeOptions": "Node options",
  "project.nodeOptionsHint": "Written to NODE_OPTIONS, e.g. --max-old-space-size=4096",
  "project.preBuildEnv": "Environment variables",
  "project.preBuildCwd": "Working directory",
  "project.preBuildCwdHint": "Empty uses the build context folder",
  "project.mavenPath": "Maven executable",
  "project.mavenPathHint": "Leave empty to use mvn from PATH; a Maven home, its bin folder or the absolute path of mvn.cmd works too",
  "project.mavenPathInvalid": "Maven executable must be a name like mvn or an absolute path",
  "project.mavenGoals": "Goals",
  "project.mavenGoalsHint": "For example -B clean package -DskipTests",
  "project.mavenProfiles": "Profiles",
  "project.mavenProfilesHint": "Comma separated, e.g. dev,test",
  "project.mavenJvm": "JVM options",
  "project.mavenJvmHint": "Written to MAVEN_OPTS, e.g. -Xmx1g",
  "project.toolNone": "Do not run",
  "project.scriptsLoad": "Reload scripts",
  "project.scriptsLoading": "Reading package.json…",
  "project.scriptsFound": "{{count}} scripts loaded",
  "project.scriptsEmpty": "No scripts in package.json",
  "project.scriptsMissing": "package.json not found",
  "project.npmScriptInvalid": "Enter the npm script name",
  "project.mavenGoalsInvalid": "Enter the Maven goals",
  "project.packageJsonInvalid": "package.json must be an absolute path",
  "project.preBuildCwdInvalid": "Working directory must be an absolute path",
  "project.configContextFolder": "Context folder",
  "project.configTag": "Image tag",
  "project.configContextHint": "Empty uses the Dockerfile folder",
  "project.configPlatform": "Target platform",
  "project.configBuildArgs": "Build arguments",
  "project.addRow": "Add",
  "project.removeRow": "Remove this row",
  "project.portHost": "Host port",
  "project.portContainer": "Container port",
  "project.mountHost": "Server path",
  "project.mountTarget": "Container path",
  "project.mountReadOnly": "Mount read-only",
  "project.mountReadOnlyShort": "RO",
  "project.runOptionsHint": "Extra docker run arguments, e.g. --restart=always",
  "project.envSecretHint": "The value is passed as an -e argument, so it is visible in the remote command line and process table, and readable inside the container via inspect and /proc/1/environ. For private keys and certificates, prefer a read-only bind mount or --env-file in the extra run arguments (the file must already exist on the server)",
  "project.run": "Run",
  "project.runStarted": "Running {{name}}",
  "project.containerNameInvalid": "Container name may contain letters, digits, dots, dashes and underscores, and must start with a letter or digit",
  "project.portInvalid": "Ports must be numbers between 1 and 65535",
  "project.mountHostInvalid": "The host path of a bind mount must be an absolute path on the server (starting with /), e.g. /data/app",
  "project.mountTargetInvalid": "The container path of a bind mount must start with /",
  "project.envInvalid": "Variable names may contain letters, digits and underscores, and must not start with a digit",
  "project.envValueTooLong": "The value of {{key}} is {{count}} characters, over the {{max}} character limit; trim it or pass it as a mounted file",
  "project.envTotalTooLarge": "Environment variables total about {{count}} KB, over the {{max}} KB limit per configuration; trim them or put large content in a file on the server",
  "project.preBuildEnvValueTooLong": "Pre-build environment variable {{key}} has {{count}} characters, over the single-value limit of {{max}}; trim it or pass it as a mounted file",
  "project.preBuildEnvTotalTooLarge": "Pre-build environment variables total {{count}} characters including names and separators, over the combined limit of {{max}}; trim them or pass them as a mounted file",
  "project.preBuildEnvTotalCount": "Total {{count}} / {{max}} characters including names",
  "project.dockerfileInvalid": "The Dockerfile path must be absolute and named like Dockerfile or Dockerfile.dev",
  "project.configNoCache": "Do not use cache",
  "project.configPull": "Always pull newer base image",
  "project.configLoading": "Loading the saved configuration...",
  "project.configApply": "Apply",
  "project.configSave": "Save configuration",
  "project.configSaveBuild": "Save and build",
  "project.configDelete": "Delete configuration",
  "project.configDeleteConfirm": "Click again to delete",
  "project.configSaved": "Run configuration saved",
  "project.configDeleted": "Run configuration deleted",
  "project.uploadNone": "Do not upload",
  "project.addDockerfile": "Add Dockerfile",
  "project.addDockerfileHint": "Absolute Dockerfile path, e.g. D:\\proj\\deploy\\Dockerfile",
  "project.add": "Add",
  "project.added": "Dockerfile added",
  "project.addInvalid": "Enter an absolute Dockerfile path",
  "project.manual": "Manual",
  "project.missing": "File missing",
  "project.configured": "Configured",
  "project.configuredHint": "Run configuration saved",
  "project.needTag": "Enter an image tag, e.g. app:latest",
  "project.buildArgsInvalid": "Invalid build arguments: one KEY=VALUE per line",
  "project.composeStarted": "Compose {{action}} started",
  "project.composeUp": "Up",
  "project.composeDown": "Down",
  "project.composeDownConfirm": "Click again to remove",
  "project.composeStop": "Stop",
  "project.composeRestart": "Restart",
  "project.composeLocal": "Runs locally",
  "project.localDocker": "Local Docker",
  "project.composeLocalHint": "Compose commands run against the local docker CLI, not the server selected at the top",
  "project.composeLocalUnavailable": "The local docker CLI is unavailable, so compose actions cannot run",
  "project.loadingServices": "Loading service status…",
  "project.noServices": "No running services",
  "project.openFile": "Open",
  "project.truncated": "Directory is large; scan results truncated",
  "settings.recovered.body": "Settings were restored from the local backup: {{fields}} of {{configs}} run configuration(s) were cleared for privacy, so building or running now would pass empty values. Open those configurations and fill them in again.",
  "settings.recovered.dismiss": "Dismiss",
  "settings.recovered.field.buildArgs": "build argument values",
  "settings.recovered.field.env": "environment variable values",
  "settings.recovered.field.runOptions": "run options",
  "settings.recovered.field.preBuildEnv": "pre-build environment variable values",
  "security.tokenNotPersisted": "The channel token could not be saved to plugin storage, so other local processes can call the panel API (including delete and build operations). Restart the app or check the plugin data directory permissions."
};

// src/panel/i18n.js
var PACKS = { "zh-CN": zh_CN_default, "zh-TW": zh_TW_default, en: en_default };
var normalizeLocale = (locale) => {
  const raw = String(locale || "").toLowerCase();
  if (!raw) return "zh-CN";
  if (raw.startsWith("zh-tw") || raw.startsWith("zh-hk") || raw === "zh-hant") return "zh-TW";
  if (raw.startsWith("zh")) return "zh-CN";
  if (raw.startsWith("en")) return "en";
  return "zh-CN";
};
var interpolate = (template, values) => {
  if (!values) return template;
  return String(template).replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (match, key) => Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
};
function createTranslator(api, locale) {
  const resolved = normalizeLocale(locale || api?.locale);
  const pack = PACKS[resolved] || PACKS["zh-CN"];
  const fallbackPack = PACKS["zh-CN"];
  const t = (key, values) => {
    const fallback = pack[key] ?? fallbackPack[key] ?? key;
    try {
      if (api && typeof api.t === "function") {
        return api.t(key, { defaultValue: fallback, values });
      }
    } catch {
    }
    return interpolate(fallback, values);
  };
  return { t, locale: resolved };
}

// src/shared/contract.js
var PORT_FIRST = 37291;
var PORT_LAST = 37300;
var CHANNEL_HEADER = "x-snow-docker-channel";
var CHANNEL_HEADER_VALUE = "panel-rpc-v1";
var CHANNEL_TOKEN_HEADER = "x-snow-docker-token";
var CHANNEL_ENDPOINT_STORAGE_KEY = "channelEndpoint";
var ENV_VALUE_MAX = 16 * 1024;
var ENV_TOTAL_MAX = 64 * 1024;
var PRE_BUILD_ENV_VALUE_MAX = 8 * 1024;
var PRE_BUILD_ENV_TOTAL_MAX = 16 * 1024;
var utf8Bytes = (text) => {
  let bytes = 0;
  for (const ch of String(text ?? "")) {
    const code = ch.codePointAt(0);
    if (code <= 127) bytes += 1;
    else if (code <= 2047) bytes += 2;
    else if (code <= 65535) bytes += 3;
    else bytes += 4;
  }
  return bytes;
};
var normalizeEnvValue = (value) => typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/\0/g, "") : "";
var ROUTES = {
  health: "/health",
  system: "/system",
  containers: "/containers",
  containerAction: "/container/action",
  containerLogs: "/container/logs",
  containerInspect: "/container/inspect",
  containerStats: "/container/stats",
  images: "/images",
  imagePull: "/image/pull",
  imageRemove: "/image/remove",
  compose: "/compose",
  settings: "/settings",
  detect: "/detect",
  projectScan: "/project/scan",
  projectBuild: "/project/build",
  projectBuildRun: "/project/build-run",
  projectRun: "/project/run",
  projectConfig: "/project/config",
  // 单条读取单独一条路由：读取不能复用保存路由，否则旧后台会把读请求当成写请求。
  projectConfigRead: "/project/config/get",
  projectPackageScripts: "/project/package-scripts",
  composeServices: "/compose/services",
  composeAction: "/compose/action",
  task: "/task",
  taskCancel: "/task/cancel",
  sshStatus: "/ssh/status",
  sshConnect: "/ssh/connect",
  sshDisconnect: "/ssh/disconnect",
  sshTest: "/ssh/test",
  sshSave: "/ssh/save",
  sshRemove: "/ssh/remove",
  sshUpload: "/ssh/upload"
};
var LIMITS = {
  /**
   * 请求体硬上限，超出直接 413。
   * 环境变量另有更严的约束（ENV_VALUE_MAX / ENV_TOTAL_MAX / PRE_BUILD_ENV_TOTAL_MAX）：
   * 这里只为 buildArgs、挂载与 JSON 结构留余量，4 MB 足以容纳一份接近上限的配置。
   */
  requestMaxBytes: 4 * 1024 * 1024,
  /** 容器日志一次最多拉取的行数（--tail 参数）与返回给面板的最大行数。 */
  logsTailDefault: 300,
  logsTailMax: 2e3,
  logsLinesMax: 4e3,
  /** 单行日志超过该长度即截断，避免终端刷屏把面板拖死。 */
  logLineChars: 2e3,
  /** docker ps / images 的输出上限。 */
  listMaxBytes: 4 * 1024 * 1024,
  /** docker pull 输出上限与超时。 */
  pullMaxBytes: 2 * 1024 * 1024,
  pullTimeoutMs: 600 * 1e3,
  /** 列表短期缓存：面板轮询不必每次都真的调 docker。 */
  listCacheTtlMs: 800
};

// src/panel/rpc.js
var PanelError = class extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = "PanelError";
    this.code = String(code || "UNKNOWN");
    this.status = Number.isFinite(options.status) ? options.status : 0;
  }
};
var isConnectionError = (text) => /ECONNREFUSED|ECONNRESET|ENOTFOUND|EPIPE|connection refused|connection reset|failed to fetch|net::ERR|socket hang up|fetch failed/i.test(
  text
);
var isTimeoutError = (text) => /timeout|timed out|ETIMEDOUT|超时/i.test(text);
var buildQuery = (query) => {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === void 0 || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
};
var CHANNEL_TOKEN_PATTERN = /^[A-Za-z0-9]{32,128}$/;
function createRpc(api, { log = () => {
} } = {}) {
  let endpoint = null;
  let endpointLoaded = false;
  let endpointLoading = null;
  const readEndpoint = async () => {
    if (!api?.storage) return null;
    try {
      const saved = typeof api.storage.getJson === "function" ? await api.storage.getJson(CHANNEL_ENDPOINT_STORAGE_KEY, null) : typeof api.storage.get === "function" ? JSON.parse(await api.storage.get(CHANNEL_ENDPOINT_STORAGE_KEY) || "null") : null;
      const port = Number(saved?.port);
      const token = typeof saved?.token === "string" ? saved.token : "";
      if (!Number.isInteger(port) || port < PORT_FIRST || port > PORT_LAST) return null;
      if (!CHANNEL_TOKEN_PATTERN.test(token)) return null;
      return { port, token };
    } catch (error) {
      log(`[rpc] 读取通道记录失败：${error?.message || error}`);
      return null;
    }
  };
  const ensureEndpoint = async () => {
    if (endpointLoaded) return endpoint;
    endpointLoading ?? (endpointLoading = (async () => {
      try {
        endpoint = await readEndpoint();
        endpointLoaded = Boolean(endpoint);
        return endpoint;
      } finally {
        endpointLoading = null;
      }
    })());
    return endpointLoading;
  };
  const rawRequest = async (target, pathname, { method = "GET", body, query, timeoutMs = 2e4 } = {}) => {
    if (!api?.net || typeof api.net.fetch !== "function") {
      throw new PanelError("NET_UNAVAILABLE", "api.net.fetch 不可用（请在 plugin.json 声明 network 隐私域）");
    }
    const url = `http://127.0.0.1:${target.port}${pathname}${buildQuery(query)}`;
    let response;
    try {
      response = await api.net.fetch(url, {
        method,
        headers: {
          [CHANNEL_HEADER]: CHANNEL_HEADER_VALUE,
          ...target.token ? { [CHANNEL_TOKEN_HEADER]: target.token } : {},
          ...body === void 0 ? {} : { "content-type": "application/json" }
        },
        body: body === void 0 ? void 0 : JSON.stringify(body),
        responseType: "text",
        timeoutMs
      });
    } catch (error) {
      const text2 = String(error?.message || error);
      throw new PanelError(isConnectionError(text2) ? "BACKGROUND_UNAVAILABLE" : "TRANSPORT", text2);
    }
    if (!response || response.error) {
      const failure = String(response?.error || "网络请求失败");
      if (isConnectionError(failure)) throw new PanelError("BACKGROUND_UNAVAILABLE", failure);
      if (isTimeoutError(failure)) throw new PanelError("TIMEOUT", failure);
      throw new PanelError("TRANSPORT", failure);
    }
    const text = typeof response.body === "string" ? response.body : "";
    let payload = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new PanelError("PROTOCOL", `后台响应不是 JSON：${error?.message ?? error}`);
      }
    }
    if (response.ok !== true || payload && payload.error) {
      const detail = payload?.error || null;
      const code = typeof detail?.code === "string" && detail.code ? detail.code : `HTTP_${response.status ?? 0}`;
      const message = typeof detail?.message === "string" && detail.message || response.statusText || `HTTP ${response.status ?? 0}`;
      if (/未知接口/.test(message)) {
        throw new PanelError("BACKGROUND_OUTDATED", "后台还在运行旧版本（缺少新接口），请重启一次 App 后重试", {
          status: response.status
        });
      }
      throw new PanelError(code, message, { status: response.status });
    }
    return payload;
  };
  const request = async (pathname, options = {}) => {
    const retryable = (options.method || "GET").toUpperCase() === "GET";
    const send = async () => {
      const target = await ensureEndpoint();
      if (!target) {
        throw new PanelError("BACKGROUND_PENDING", "后台尚未发布连接记录：请关闭并重新打开插件面板");
      }
      return rawRequest(target, pathname, options);
    };
    try {
      return await send();
    } catch (error) {
      if (error?.code !== "BACKGROUND_UNAVAILABLE") throw error;
      if (!retryable) {
        throw new PanelError(
          "BACKGROUND_UNAVAILABLE",
          `${String(error?.message || error)}（请求可能已被后台受理，请先确认任务列表再重试）`
        );
      }
      try {
        return await send();
      } catch (again) {
        if (again?.code !== "BACKGROUND_UNAVAILABLE") throw again;
        throw new PanelError(
          "BACKGROUND_UNAVAILABLE",
          `${String(again?.message || again)}（后台可能已重启：请关闭并重新打开插件面板）`
        );
      }
    }
  };
  return {
    resetPort() {
      endpoint = null;
      endpointLoaded = false;
      endpointLoading = null;
    },
    health: () => request(ROUTES.health, { timeoutMs: 4e3 }),
    system: () => request(ROUTES.system, { timeoutMs: 6e4 }),
    containers: ({ all = true } = {}) => request(ROUTES.containers, { query: { all: all ? "1" : "0" }, timeoutMs: 2e4 }),
    images: () => request(ROUTES.images, { timeoutMs: 2e4 }),
    inspect: (id) => request(ROUTES.containerInspect, { query: { id }, timeoutMs: 2e4 }),
    logsStream: (id, { tail, streamId, offset, reset } = {}) => request(ROUTES.containerLogs, {
      query: { id, tail, streamId, offset, reset: reset ? "1" : "" },
      timeoutMs: 3e4
    }),
    stats: (id) => request(ROUTES.containerStats, { query: { id }, timeoutMs: 3e4 }),
    containerAction: (id, action, force = false) => request(ROUTES.containerAction, { method: "POST", body: { id, action, force }, timeoutMs: 7e4 }),
    // 拉取在后台转成任务（/image/pull 立即返回 taskId），这里只要一次短请求；
    // 宿主对 api.net.fetch 的超时上限是 120 秒，长拉取不能再同步等待。
    pull: (reference) => request(ROUTES.imagePull, { method: "POST", body: { reference }, timeoutMs: 2e4 }),
    removeImage: (reference, force = false) => request(ROUTES.imageRemove, { method: "POST", body: { reference, force }, timeoutMs: 7e4 }),
    settings: () => request(ROUTES.settings, { timeoutMs: 1e4 }),
    saveSettings: (patch) => request(ROUTES.settings, { method: "POST", body: patch, timeoutMs: 15e3 }),
    detect: () => request(ROUTES.detect, { timeoutMs: 3e4 }),
    scanProject: (root) => request(ROUTES.projectScan, { method: "POST", body: { root }, timeoutMs: 4e4 }),
    packageScripts: (path, dir) => request(ROUTES.projectPackageScripts, { query: { path, dir }, timeoutMs: 15e3 }),
    build: (payload) => request(ROUTES.projectBuild, { method: "POST", body: payload, timeoutMs: 12e4 }),
    buildAndRun: (payload) => request(ROUTES.projectBuildRun, { method: "POST", body: payload, timeoutMs: 12e4 }),
    runImage: (image, config) => request(ROUTES.projectRun, { method: "POST", body: { image, config }, timeoutMs: 12e4 }),
    saveProjectConfig: (dockerfile, config, register = false, root = "") => request(ROUTES.projectConfig, {
      method: "POST",
      body: { dockerfile, config, register: register === true, root },
      timeoutMs: 15e3
    }),
    // 列表只回摘要：编辑配置或构建前按路径取一次完整配置。
    // 读取走独立 GET：旧后台没有这条路径时会返回「未知接口」，面板据此提示重启。
    readProjectConfig: (dockerfile) => request(ROUTES.projectConfigRead, { query: { dockerfile }, timeoutMs: 15e3 }),
    removeProjectConfig: (dockerfile) => request(ROUTES.projectConfig, { method: "POST", body: { dockerfile, remove: true }, timeoutMs: 15e3 }),
    composeServices: (file) => request(ROUTES.composeServices, { query: { file }, timeoutMs: 3e4 }),
    composeAction: (file, action) => request(ROUTES.composeAction, { method: "POST", body: { file, action }, timeoutMs: 2e4 }),
    task: (id, offset) => request(ROUTES.task, { query: { id, offset }, timeoutMs: 2e4 }),
    cancelTask: (id) => request(ROUTES.taskCancel, { method: "POST", body: { id }, timeoutMs: 1e4 }),
    sshStatus: () => request(ROUTES.sshStatus, { timeoutMs: 15e3 }),
    sshSave: (payload) => request(ROUTES.sshSave, { method: "POST", body: payload, timeoutMs: 15e3 }),
    sshRemove: (id) => request(ROUTES.sshRemove, { method: "POST", body: { id }, timeoutMs: 15e3 }),
    sshConnect: (id) => request(ROUTES.sshConnect, { method: "POST", body: { id }, timeoutMs: 9e4 }),
    sshDisconnect: () => request(ROUTES.sshDisconnect, { method: "POST", body: {}, timeoutMs: 2e4 }),
    sshTest: (payload) => request(ROUTES.sshTest, { method: "POST", body: payload || {}, timeoutMs: 6e4 }),
    // 上传在后台可能先自动建连并探活 docker（与 sshConnect 同量级耗时）：超时给到一致，
    // 否则面板先报超时，后台却已切好目标并启动了上传任务。
    sshUpload: (image, serverId) => request(ROUTES.sshUpload, { method: "POST", body: { image, serverId }, timeoutMs: 9e4 })
  };
}

// src/panel/ui.jsx
function Btn({ children, onClick, disabled, variant, size, title, type = "button" }) {
  return /* @__PURE__ */ h(
    "button",
    {
      type,
      className: "dk-btn",
      "data-variant": variant,
      "data-size": size,
      title,
      disabled: disabled === true,
      onClick
    },
    children
  );
}
var STATE_TONE = {
  running: "ok",
  paused: "warn",
  restarting: "warn",
  exited: "muted",
  created: "muted",
  removing: "warn",
  dead: "bad",
  unknown: "muted"
};
function StateBadge({ state, t }) {
  const tone = STATE_TONE[state] || "muted";
  const key = `state.${Object.prototype.hasOwnProperty.call(STATE_TONE, state) ? state : "unknown"}`;
  return /* @__PURE__ */ h("span", { className: "dk-badge", "data-tone": tone }, t(key));
}
function Spinner() {
  return /* @__PURE__ */ h("span", { className: "dk-spinner", "aria-hidden": "true" });
}
function Loading({ text }) {
  return /* @__PURE__ */ h("div", { className: "dk-loading" }, /* @__PURE__ */ h(Spinner, null), /* @__PURE__ */ h("span", null, text));
}
function EmptyState({ title, hint, action }) {
  return /* @__PURE__ */ h("div", { className: "dk-emptystate" }, title ? /* @__PURE__ */ h("div", { className: "dk-emptystate-title" }, title) : null, hint ? /* @__PURE__ */ h("div", null, hint) : null, action || null);
}
function Field({ label, value }) {
  const hasValue = value !== null && value !== void 0 && String(value).trim() !== "";
  if (!hasValue) return null;
  return [
    /* @__PURE__ */ h("span", { key: "k", className: "dk-kv-key" }, label),
    /* @__PURE__ */ h("span", { key: "v", className: "dk-kv-value" }, value)
  ];
}
function ErrorBox({ title, message, action }) {
  return /* @__PURE__ */ h("div", { className: "dk-errorbox" }, title ? /* @__PURE__ */ h("div", { className: "dk-errorbox-title" }, title) : null, message ? /* @__PURE__ */ h("div", null, message) : null, action || null);
}
function SectionTitle({ children, extra }) {
  return /* @__PURE__ */ h("div", { className: "dk-section-title" }, /* @__PURE__ */ h("span", null, children), extra ? /* @__PURE__ */ h("span", null, extra) : null);
}

// src/panel/select.jsx
var GAP = 4;
var MENU_MAX_HEIGHT = 240;
var SEARCH_BAR_HEIGHT = 38;
var VIEWPORT_GAP = 8;
var MIN_WIDTH = 132;
var SUPPRESS_MS = 300;
function DkSelect({
  value,
  options,
  onChange,
  ariaLabel,
  size,
  disabled,
  searchable,
  searchPlaceholder,
  emptyText
}) {
  const React = getReact();
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState(null);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const rootRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const suppressUntilRef = React.useRef(0);
  const selected = options.find((option) => option.value === value);
  const visible = React.useMemo(() => {
    if (!searchable) return options;
    const keyword = query.trim().toLowerCase();
    if (!keyword) return options;
    return options.filter((option) => String(option.label ?? "").toLowerCase().includes(keyword));
  }, [options, searchable, query]);
  const measure = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, MIN_WIDTH);
    const maxLeft = Math.max(VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP);
    const left = Math.min(Math.max(VIEWPORT_GAP, rect.left), maxLeft);
    const below = rect.bottom + GAP;
    const menuHeight = MENU_MAX_HEIGHT + (searchable ? SEARCH_BAR_HEIGHT : 0);
    const openUp = below + menuHeight > window.innerHeight - VIEWPORT_GAP && rect.top > menuHeight;
    const top = openUp ? Math.max(VIEWPORT_GAP, rect.top - menuHeight - GAP) : below;
    setPosition({ left, top, width });
  }, [searchable]);
  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(-1);
      return void 0;
    }
    measure();
    const onPointerDown = (event) => {
      const target = event.target;
      if (rootRef.current && target instanceof Node && rootRef.current.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onViewportChange = (event) => {
      const target = event && event.target;
      if (rootRef.current && target instanceof Node && rootRef.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open, measure]);
  React.useEffect(() => {
    if (!open || !searchable || !position) return;
    if (inputRef.current) inputRef.current.focus();
  }, [open, position, searchable]);
  React.useEffect(() => {
    setActiveIndex((current) => current >= visible.length ? -1 : current);
  }, [visible.length]);
  React.useEffect(() => {
    if (activeIndex < 0) return;
    const menu = menuRef.current;
    if (!menu) return;
    const node = menu.querySelector(`[data-index="${activeIndex}"]`);
    if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);
  const pick = (option) => {
    suppressUntilRef.current = Date.now() + SUPPRESS_MS;
    setOpen(false);
    onChange(option.value);
  };
  const onSearchKeyDown = (event) => {
    if (event.nativeEvent && event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (visible.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const next = current + step;
        if (next < 0) return visible.length - 1;
        if (next >= visible.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = visible[activeIndex];
      if (option) pick(option);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };
  return /* @__PURE__ */ h("div", { className: `dk-select${size === "sm" ? " is-sm" : ""}`, ref: rootRef }, /* @__PURE__ */ h(
    "button",
    {
      type: "button",
      ref: triggerRef,
      className: "dk-select-trigger",
      "aria-haspopup": "listbox",
      "aria-expanded": open ? "true" : "false",
      "aria-label": ariaLabel || void 0,
      title: selected ? selected.label : "",
      disabled: disabled === true,
      onClick: () => {
        if (Date.now() < suppressUntilRef.current) return;
        setOpen((current) => !current);
      }
    },
    /* @__PURE__ */ h("span", { className: "dk-select-label" }, selected ? selected.label : String(value ?? "")),
    /* @__PURE__ */ h("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ h("path", { d: "M6 9l6 6 6-6", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }))
  ), open && position ? /* @__PURE__ */ h(
    "div",
    {
      className: "dk-select-menu",
      role: "listbox",
      ref: menuRef,
      style: {
        left: `${Math.round(position.left)}px`,
        top: `${Math.round(position.top)}px`,
        width: `${Math.round(position.width)}px`,
        maxHeight: `${MENU_MAX_HEIGHT}px`
      }
    },
    searchable ? /* @__PURE__ */ h("div", { className: "dk-select-search" }, /* @__PURE__ */ h(
      "input",
      {
        ref: inputRef,
        type: "text",
        value: query,
        placeholder: searchPlaceholder || "",
        spellCheck: false,
        onChange: (event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        },
        onKeyDown: onSearchKeyDown
      }
    )) : null,
    visible.length === 0 ? /* @__PURE__ */ h("div", { className: "dk-select-empty" }, emptyText || "") : visible.map((option, index) => /* @__PURE__ */ h(
      "button",
      {
        key: option.value,
        type: "button",
        role: "option",
        "data-index": index,
        "aria-selected": option.value === value ? "true" : "false",
        className: `dk-select-item${option.value === value ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}`,
        onMouseEnter: () => setActiveIndex(index),
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          pick(option);
        }
      },
      option.label
    ))
  ) : null);
}

// src/panel/containers.jsx
var MAX_ENV_CHIPS = 40;
var sortContainers = (list) => {
  const weight = (item) => {
    if (item.state === "running") return 0;
    if (item.state === "paused") return 1;
    if (item.state === "restarting") return 2;
    return 3;
  };
  return [...list].sort((a, b) => {
    const delta = weight(a) - weight(b);
    if (delta !== 0) return delta;
    return String(a.name).localeCompare(String(b.name));
  });
};
var matchesFilter = (item, filter) => {
  if (!filter) return true;
  const text = filter.trim().toLowerCase();
  if (!text) return true;
  return [item.name, item.image, item.ports, item.status, item.shortId].filter(Boolean).some((value) => String(value).toLowerCase().includes(text));
};
function ActionBar({ t, container, busy, onAction, onOpenLogs }) {
  const running = container.state === "running";
  const paused = container.state === "paused";
  const [confirmRemove, setConfirmRemove] = getReact().useState(false);
  getReact().useEffect(() => {
    if (!confirmRemove) return void 0;
    const timer = setTimeout(() => setConfirmRemove(false), 4e3);
    return () => clearTimeout(timer);
  }, [confirmRemove]);
  return /* @__PURE__ */ h("div", { className: "dk-actionbar" }, running ? /* @__PURE__ */ h(Btn, { size: "sm", disabled: busy, onClick: () => onAction("stop") }, t("container.stop")) : /* @__PURE__ */ h(Btn, { size: "sm", variant: "primary", disabled: busy || paused, onClick: () => onAction("start") }, t("container.start")), /* @__PURE__ */ h(Btn, { size: "sm", disabled: busy, onClick: () => onAction("restart") }, t("container.restart")), running ? /* @__PURE__ */ h(Btn, { size: "sm", disabled: busy, onClick: () => onAction("pause") }, t("container.pause")) : null, paused ? /* @__PURE__ */ h(Btn, { size: "sm", disabled: busy, onClick: () => onAction("unpause") }, t("container.unpause")) : null, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: onOpenLogs }, t("container.openLogs")), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: "danger",
      disabled: busy,
      onClick: () => {
        if (!confirmRemove) {
          setConfirmRemove(true);
          return;
        }
        setConfirmRemove(false);
        onAction("remove", { force: running });
      }
    },
    confirmRemove ? t("container.removeConfirm") : t("container.remove")
  ));
}
function ContainerDetail({ t, container, rpc, notify, onChanged, onOpenLogs }) {
  const React = getReact();
  const [inspect, setInspect] = React.useState({ status: "loading", data: null, error: "" });
  const [stats, setStats] = React.useState({ status: "idle", data: null, error: "" });
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState("");
  const seqRef = React.useRef(0);
  const containerId = container.id;
  const loadInspect = React.useCallback(async () => {
    const seq = ++seqRef.current;
    setInspect({ status: "loading", data: null, error: "" });
    try {
      const data2 = await rpc.inspect(containerId);
      if (seq !== seqRef.current) return;
      setInspect({ status: "ready", data: data2, error: "" });
    } catch (error) {
      if (seq !== seqRef.current) return;
      setInspect({ status: "error", data: null, error: String(error?.message || error) });
    }
  }, [containerId, rpc]);
  React.useEffect(() => {
    void loadInspect();
    setStats({ status: "idle", data: null, error: "" });
    setActionError("");
  }, [containerId, container.state, loadInspect]);
  const runAction = async (action, options = {}) => {
    setBusy(true);
    setActionError("");
    try {
      await rpc.containerAction(containerId, action, options.force === true);
      notify("success", `${t("notice.actionDone", { action: t(`container.${action === "remove" ? "remove" : action}`) })}`);
      if (action === "remove") {
        onChanged();
        return;
      }
      onChanged();
    } catch (error) {
      setActionError(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };
  const loadStats = async () => {
    setStats({ status: "loading", data: null, error: "" });
    try {
      const data2 = await rpc.stats(containerId);
      setStats({ status: "ready", data: data2, error: "" });
    } catch (error) {
      setStats({ status: "error", data: null, error: String(error?.message || error) });
    }
  };
  const data = inspect.data;
  return /* @__PURE__ */ h("div", { className: "dk-detail" }, /* @__PURE__ */ h(ActionBar, { t, container, busy, onAction: runAction, onOpenLogs }), actionError ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, actionError) : null, inspect.status === "loading" ? /* @__PURE__ */ h(Loading, { text: t("container.detailLoading") }) : null, inspect.status === "error" ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, inspect.error) : null, data ? /* @__PURE__ */ h("div", null, /* @__PURE__ */ h(SectionTitle, null, t("container.inspect")), /* @__PURE__ */ h("div", { className: "dk-kv" }, /* @__PURE__ */ h(Field, { label: t("container.command"), value: data.command || data.entrypoint }), /* @__PURE__ */ h(Field, { label: t("container.created"), value: data.created ? data.created.replace("T", " ").slice(0, 19) : "" }), /* @__PURE__ */ h(Field, { label: t("container.exitCode"), value: data.state?.exitCode }), /* @__PURE__ */ h(Field, { label: t("container.restartPolicy"), value: data.restartPolicy }), /* @__PURE__ */ h(Field, { label: t("container.networks"), value: Array.isArray(data.networks) ? data.networks.join(", ") : "" })), data.ports?.length ? /* @__PURE__ */ h("div", { style: { marginTop: "8px" } }, /* @__PURE__ */ h(SectionTitle, null, t("container.ports")), /* @__PURE__ */ h("div", { className: "dk-chips" }, data.ports.map((item) => /* @__PURE__ */ h("span", { className: "dk-chip", key: item.containerPort }, item.containerPort, item.host ? ` -> ${item.host}` : "")))) : null, data.mounts?.length ? /* @__PURE__ */ h("div", { style: { marginTop: "8px" } }, /* @__PURE__ */ h(SectionTitle, null, t("container.mounts")), /* @__PURE__ */ h("div", { className: "dk-chips" }, data.mounts.map((item) => /* @__PURE__ */ h("span", { className: "dk-chip", key: `${item.destination}-${item.source}` }, item.source ? `${item.source} -> ` : "", item.destination, item.readOnly ? " (ro)" : "")))) : null, data.env?.length ? /* @__PURE__ */ h("div", { style: { marginTop: "8px" } }, /* @__PURE__ */ h(SectionTitle, null, t("container.env")), /* @__PURE__ */ h("div", { className: "dk-chips" }, data.env.slice(0, MAX_ENV_CHIPS).map((item, index) => /* @__PURE__ */ h("span", { className: "dk-chip", key: `${item}-${index}`, title: item }, item)))) : null) : null, /* @__PURE__ */ h("div", null, /* @__PURE__ */ h(
    SectionTitle,
    {
      extra: /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: stats.status === "loading", onClick: loadStats }, stats.status === "loading" ? t("container.statsLoading") : t("container.stats"))
    },
    t("container.stats")
  ), stats.status === "error" ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, stats.error) : null, stats.data ? /* @__PURE__ */ h("div", { className: "dk-kv" }, /* @__PURE__ */ h(Field, { label: t("container.cpu"), value: stats.data.cpu }), /* @__PURE__ */ h(Field, { label: t("container.memory"), value: `${stats.data.memoryUsage} ${stats.data.memoryPercent}` }), /* @__PURE__ */ h(Field, { label: t("container.netIO"), value: stats.data.netIO }), /* @__PURE__ */ h(Field, { label: t("container.blockIO"), value: stats.data.blockIO }), /* @__PURE__ */ h(Field, { label: t("container.pids"), value: stats.data.pids })) : null));
}
function ContainerRow({ t, container, expanded, onToggle, children }) {
  return /* @__PURE__ */ h("div", { className: "dk-row", "data-selected": expanded ? "1" : "0" }, /* @__PURE__ */ h("div", { className: "dk-row-head", onClick: onToggle, role: "button", tabIndex: 0 }, /* @__PURE__ */ h("div", { className: "dk-row-main" }, /* @__PURE__ */ h("div", { className: "dk-row-title" }, /* @__PURE__ */ h("span", { className: "dk-name", title: container.name }, container.name), /* @__PURE__ */ h(StateBadge, { state: container.state, t })), /* @__PURE__ */ h("span", { className: "dk-meta", title: `${container.image} · ${container.status}` }, container.image), container.ports ? /* @__PURE__ */ h("span", { className: "dk-ports" }, container.ports) : null)), expanded ? children : null);
}
function ContainersView({
  t,
  rpc,
  containers,
  loading,
  error,
  filter,
  setFilter,
  onlyRunning,
  setOnlyRunning,
  selectedId,
  setSelectedId,
  notify,
  onChanged,
  onOpenLogs
}) {
  const visible = sortContainers(containers).filter((item) => onlyRunning ? item.state === "running" : true).filter((item) => matchesFilter(item, filter));
  return /* @__PURE__ */ h("div", { className: "dk-body" }, /* @__PURE__ */ h("div", { className: "dk-toolbar" }, /* @__PURE__ */ h(
    "input",
    {
      className: "dk-input",
      value: filter,
      placeholder: t("filter.placeholder"),
      onChange: (event) => setFilter(event.target.value)
    }
  ), /* @__PURE__ */ h("div", { className: "dk-toggle" }, /* @__PURE__ */ h("button", { type: "button", "data-active": onlyRunning ? "0" : "1", onClick: () => setOnlyRunning(false) }, t("filter.all")), /* @__PURE__ */ h("button", { type: "button", "data-active": onlyRunning ? "1" : "0", onClick: () => setOnlyRunning(true) }, t("filter.running")))), error ? /* @__PURE__ */ h(ErrorBox, { title: t("error.title"), message: error }) : null, loading && containers.length === 0 ? /* @__PURE__ */ h(Loading, { text: t("status.refreshing") }) : null, !loading && !error && visible.length === 0 ? /* @__PURE__ */ h(EmptyState, { title: t("list.empty") }) : null, /* @__PURE__ */ h("div", { className: "dk-list" }, visible.map((item) => {
    const expanded = selectedId === item.id;
    return /* @__PURE__ */ h(
      ContainerRow,
      {
        key: item.id,
        t,
        container: item,
        expanded,
        onToggle: () => setSelectedId(expanded ? "" : item.id)
      },
      /* @__PURE__ */ h(
        ContainerDetail,
        {
          t,
          container: item,
          rpc,
          notify,
          onChanged,
          onOpenLogs: () => onOpenLogs(item.id)
        }
      )
    );
  })));
}

// src/panel/ansi.js
var ESCAPE_PATTERN = /\u001B(?:\[([0-9;]*)m|\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\u0007|\u001B\\)|[@-_])/g;
var DOCKER_TS_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z /;
var DEFAULT_ANSI = Object.freeze({
  fg: 0,
  bold: false,
  dim: false,
  italic: false,
  underline: false
});
var fresh = () => ({ ...DEFAULT_ANSI });
var applyCodes = (state, source) => {
  const codes = String(source || "0").split(";").map((part) => part === "" ? 0 : Number(part));
  let next = state;
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (!Number.isFinite(code)) continue;
    if (code === 0) {
      next = fresh();
      continue;
    }
    if (next === state) next = { ...state };
    if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 39) next.fg = 0;
    else if (code >= 30 && code <= 37 || code >= 90 && code <= 97) next.fg = code;
    else if (code === 38 || code === 48) {
      if (codes[index + 1] === 5) index += 2;
      else if (codes[index + 1] === 2) index += 4;
    }
  }
  return next;
};
function parseAnsiLine(raw, state = DEFAULT_ANSI) {
  const text = String(raw ?? "").replace(DOCKER_TS_PREFIX, "").replace(/\u001B\[[0-9;]*$/, "");
  if (!text.includes("\x1B")) {
    return { text, segments: [{ text, state }], state };
  }
  let current = state;
  const segments = [];
  let last = 0;
  ESCAPE_PATTERN.lastIndex = 0;
  let match = ESCAPE_PATTERN.exec(text);
  while (match) {
    const chunk = text.slice(last, match.index).replace(/[\u001B\u009B]/g, "");
    if (chunk) segments.push({ text: chunk, state: current });
    if (match[1] !== void 0) current = applyCodes(current, match[1]);
    last = ESCAPE_PATTERN.lastIndex;
    match = ESCAPE_PATTERN.exec(text);
  }
  const tail = text.slice(last).replace(/[\u001B\u009B]/g, "");
  if (tail) segments.push({ text: tail, state: current });
  if (segments.length === 0) segments.push({ text: "", state: current });
  return { text, segments, state: current };
}
function ansiClass(state) {
  const names = [];
  if (state.fg) names.push(`dk-ansi-fg-${state.fg}`);
  if (state.bold) names.push("dk-ansi-bold");
  if (state.dim) names.push("dk-ansi-dim");
  if (state.italic) names.push("dk-ansi-italic");
  if (state.underline) names.push("dk-ansi-underline");
  return names.join(" ");
}

// src/panel/logs.jsx
var FOLLOW_INTERVAL_MS = 1500;
var MAX_LOG_LINES = 1e3;
var MAX_BUFFER_LINES = 2e3;
var MAX_ANSI_CACHE = 2048;
var LOG_TAIL = 300;
var LINE_TIME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/;
var parseLineTime = (line) => {
  const match = LINE_TIME_RE.exec(String(line ?? ""));
  if (!match) return null;
  const value = Date.parse(match[1]);
  return Number.isFinite(value) ? value : null;
};
var EMPTY_LOGS = { status: "idle", lines: [], offset: 0, streamId: "", live: false, ended: false, error: "" };
function LogsView({ t, rpc, containers, loading, selectedId, setSelectedId, active, visible }) {
  const React = getReact();
  const [logs, setLogs] = React.useState(EMPTY_LOGS);
  const [follow, setFollow] = React.useState(true);
  const [wrap, setWrap] = React.useState(true);
  const [cleared, setCleared] = React.useState({ id: "", at: 0 });
  const streamRef = React.useRef({ streamId: "", offset: 0 });
  const containerRef = React.useRef("");
  const queueRef = React.useRef(Promise.resolve());
  const seqRef = React.useRef(0);
  const busyRef = React.useRef(false);
  const boxRef = React.useRef(null);
  const ordered = React.useMemo(() => sortContainers(containers), [containers]);
  const selected = ordered.find((item) => item.id === selectedId) || null;
  const containerId = selected ? selected.id : "";
  const containerState = selected ? selected.state : "";
  const clearedAt = cleared.id === containerId ? cleared.at : 0;
  containerRef.current = containerId;
  React.useEffect(() => {
    if (!visible) return;
    if (ordered.length === 0) return;
    if (selectedId && ordered.some((item) => item.id === selectedId)) return;
    setSelectedId(ordered[0].id);
  }, [visible, ordered, selectedId, setSelectedId]);
  const readLogs = React.useCallback(
    ({ reset = false, skipIfBusy = false } = {}) => {
      if (!containerId) return Promise.resolve();
      if (skipIfBusy && busyRef.current) return Promise.resolve();
      const run = async () => {
        busyRef.current = true;
        const seq = ++seqRef.current;
        const requestContainer = containerId;
        if (reset) {
          setLogs((prev) => ({ ...prev, status: prev.lines.length ? prev.status : "loading", error: "" }));
        }
        try {
          const data = await rpc.logsStream(containerId, {
            tail: LOG_TAIL,
            streamId: reset ? "" : streamRef.current.streamId,
            offset: reset ? void 0 : streamRef.current.offset,
            reset
          });
          if (seq !== seqRef.current || requestContainer !== containerRef.current) return;
          const incoming = Array.isArray(data?.lines) ? data.lines : [];
          const nextStreamId = String(data?.streamId || streamRef.current.streamId || "");
          const nextOffset = Number.isFinite(data?.offset) ? data.offset : streamRef.current.offset;
          streamRef.current = { streamId: nextStreamId, offset: nextOffset };
          const base = nextOffset - incoming.length;
          const nextLive = data?.live === true;
          const nextEnded = data?.ended === true;
          const nextError = typeof data?.error === "string" ? data.error : "";
          setLogs((prev) => {
            const reset2 = data?.reset === true;
            if (!reset2 && incoming.length === 0 && prev.status === "ready" && prev.offset === nextOffset && prev.streamId === nextStreamId && prev.live === nextLive && prev.ended === nextEnded && prev.error === nextError) {
              return prev;
            }
            const appended = incoming.map((text, index) => ({ id: base + index, text: String(text ?? "") }));
            const nextLines = reset2 ? appended : prev.lines.concat(appended);
            return {
              status: "ready",
              lines: nextLines.slice(-MAX_BUFFER_LINES),
              offset: nextOffset,
              streamId: nextStreamId,
              live: nextLive,
              ended: nextEnded,
              error: nextError
            };
          });
        } catch (error) {
          if (seq !== seqRef.current || requestContainer !== containerRef.current) return;
          setLogs((prev) => ({
            ...prev,
            status: prev.lines.length ? "ready" : "error",
            error: String(error?.message || error)
          }));
        } finally {
          busyRef.current = false;
        }
      };
      const next = queueRef.current.then(run, run);
      queueRef.current = next.catch(() => {
      });
      return next;
    },
    [containerId, rpc]
  );
  React.useEffect(() => {
    seqRef.current += 1;
    busyRef.current = false;
    streamRef.current = { streamId: "", offset: 0 };
    if (!containerId) {
      setLogs(EMPTY_LOGS);
      return;
    }
    const shouldLoad = visible && active !== false;
    setLogs({ ...EMPTY_LOGS, status: shouldLoad ? "loading" : "idle" });
    if (shouldLoad) void readLogs({ reset: true });
  }, [containerId, containerState, readLogs]);
  React.useEffect(() => {
    if (!visible || active === false || !containerId || busyRef.current) return;
    if (!logs.streamId) {
      void readLogs({ reset: true });
      return;
    }
    if (!logs.ended) void readLogs({ skipIfBusy: true });
  }, [visible, active]);
  React.useEffect(() => {
    if (!visible || active === false || !containerId || logs.ended) return void 0;
    const timer = setInterval(() => void readLogs({ skipIfBusy: true }), FOLLOW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [visible, active, containerId, logs.ended, readLogs]);
  React.useEffect(() => {
    if (!visible || active === false || !containerId || logs.ended) return;
    void readLogs({ skipIfBusy: true });
  }, [visible, active, containerId, logs.ended, readLogs]);
  React.useEffect(() => {
    if (!follow) return;
    const box = boxRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  }, [logs.lines, logs.status, visible, follow]);
  const clearLogs = () => {
    if (!containerId) return;
    const last = logs.lines.length ? parseLineTime(logs.lines[logs.lines.length - 1]?.text) : null;
    setCleared({ id: containerId, at: Number.isFinite(last) ? last : Date.now() });
  };
  const options = ordered.map((item) => ({ value: item.id, label: item.name }));
  const visibleLogs = React.useMemo(
    () => logs.lines.filter((line) => {
      if (!clearedAt) return true;
      const time = parseLineTime(line.text);
      return time === null || time > clearedAt;
    }).slice(-MAX_LOG_LINES),
    [logs.lines, clearedAt]
  );
  const ansiCacheRef = React.useRef(/* @__PURE__ */ new Map());
  const parsedLogs = React.useMemo(() => {
    const cache = ansiCacheRef.current;
    let state = DEFAULT_ANSI;
    return visibleLogs.map((line) => {
      if (!line.text.includes("\x1B")) {
        const parsed2 = parseAnsiLine(line.text, state);
        state = parsed2.state;
        return { key: line.id, segments: parsed2.segments };
      }
      const stateKey = `${state.fg}|${state.bold ? 1 : 0}|${state.dim ? 1 : 0}|${state.italic ? 1 : 0}|${state.underline ? 1 : 0}`;
      const cacheKey = `${stateKey}\0${line.text}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        state = cached.state;
        return { key: line.id, segments: cached.segments };
      }
      const parsed = parseAnsiLine(line.text, state);
      if (cache.size >= MAX_ANSI_CACHE) cache.clear();
      cache.set(cacheKey, { segments: parsed.segments, state: parsed.state });
      state = parsed.state;
      return { key: line.id, segments: parsed.segments };
    });
  }, [visibleLogs]);
  return /* @__PURE__ */ h("div", { className: "dk-logs", hidden: !visible }, /* @__PURE__ */ h("div", { className: "dk-toolbar" }, /* @__PURE__ */ h("div", { className: "dk-logs-picker" }, /* @__PURE__ */ h(
    DkSelect,
    {
      value: containerId,
      options,
      onChange: (next) => setSelectedId(next),
      ariaLabel: t("logs.select"),
      size: "sm",
      disabled: options.length === 0,
      searchable: true,
      searchPlaceholder: t("logs.selectSearch"),
      emptyText: t("logs.selectEmpty")
    }
  )), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: "ghost",
      disabled: !containerId || logs.status === "loading",
      onClick: () => void readLogs({ reset: true })
    },
    t("container.logsRefresh")
  ), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: follow ? "primary" : "ghost",
      disabled: !containerId,
      title: t("container.followHint"),
      onClick: () => setFollow((value) => !value)
    },
    t("container.follow")
  ), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: "ghost",
      disabled: !containerId || logs.status === "loading",
      onClick: clearLogs
    },
    t("logs.clear")
  ), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: wrap ? "primary" : "ghost",
      onClick: () => setWrap((value) => !value),
      title: t("logs.wrap")
    },
    t("logs.wrap")
  )), selected ? /* @__PURE__ */ h("div", { className: "dk-logs-meta" }, /* @__PURE__ */ h("span", { className: "dk-name", title: selected.name }, selected.name), /* @__PURE__ */ h(StateBadge, { state: selected.state, t }), /* @__PURE__ */ h("span", { className: "dk-meta", title: `${selected.image} · ${selected.status}` }, selected.image, " · ", selected.status)) : null, options.length === 0 ? loading ? /* @__PURE__ */ h(Loading, { text: t("status.refreshing") }) : /* @__PURE__ */ h(EmptyState, { title: t("logs.empty"), hint: t("logs.emptyHint") }) : /* @__PURE__ */ h("div", { className: `dk-log dk-log-fill${wrap ? "" : " dk-log-nowrap"}`, ref: boxRef }, logs.status === "loading" ? /* @__PURE__ */ h("span", { className: "dk-log-empty" }, t("status.refreshing")) : null, logs.error ? /* @__PURE__ */ h("span", { className: "dk-inline-error" }, logs.error) : null, logs.status === "ready" && !logs.error && visibleLogs.length === 0 ? /* @__PURE__ */ h("span", { className: "dk-log-empty" }, clearedAt ? t("logs.cleared") : t("container.noLogs")) : null, parsedLogs.map((line) => {
    const hasText = line.segments.some((segment) => segment.text);
    return /* @__PURE__ */ h("span", { className: "dk-log-line", key: line.key }, hasText ? line.segments.map(
      (segment, index) => segment.text ? h("span", { key: index, className: ansiClass(segment.state) || void 0 }, segment.text) : null
    ) : " ");
  })), logs.ended && !logs.error ? /* @__PURE__ */ h("div", { className: "dk-meta" }, t("logs.ended")) : null, clearedAt ? /* @__PURE__ */ h("div", { className: "dk-logs-note" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("logs.cleared")), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => setCleared({ id: "", at: 0 }) }, t("logs.showAll"))) : null);
}

// src/panel/tasklog.jsx
var STATUS_KEY = {
  running: "task.running",
  succeeded: "task.succeeded",
  cancelled: "task.cancelled",
  failed: "task.failed"
};
var STATUS_TONE = {
  running: "warn",
  succeeded: "ok",
  cancelled: "muted",
  failed: "bad"
};
function TaskLog({ t, task, onCancel, onClear, maxHeight = "180px" }) {
  const React = getReact();
  const boxRef = React.useRef(null);
  React.useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [task?.lines?.length]);
  if (!task) return null;
  const running = task.status === "running";
  const statusText = t(STATUS_KEY[task.status] || "task.running");
  const tone = STATUS_TONE[task.status] || "muted";
  return /* @__PURE__ */ h("div", { className: "dk-card", style: { marginBottom: "8px" } }, /* @__PURE__ */ h("div", { className: "dk-card-title" }, /* @__PURE__ */ h("span", { title: task.title }, task.title ? `${task.kind} · ${task.title}` : task.kind), /* @__PURE__ */ h("span", { className: "dk-pill" }, /* @__PURE__ */ h("span", { className: "dk-dot", "data-tone": tone }), statusText, task.exitCode !== null && task.exitCode !== void 0 ? ` (exit ${task.exitCode})` : "")), /* @__PURE__ */ h("div", { className: "dk-log", ref: boxRef, style: { maxHeight } }, task.lines.length === 0 ? /* @__PURE__ */ h("span", { className: "dk-log-empty" }, t("task.running")) : null, task.lines.map((line, index) => /* @__PURE__ */ h("span", { className: "dk-log-line", key: `${index}-${line.slice(0, 16)}` }, line))), task.truncated ? /* @__PURE__ */ h("div", { className: "dk-meta", style: { paddingTop: "4px" } }, t("task.truncated")) : null, task.error ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, task.error) : null, /* @__PURE__ */ h("div", { style: { display: "flex", gap: "5px", marginTop: "6px" } }, running ? /* @__PURE__ */ h(Btn, { size: "sm", onClick: onCancel }, t("task.cancel")) : null, !running ? /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: onClear }, t("task.clear")) : null));
}

// src/panel/images.jsx
var MAX_LOG_LINES2 = 800;
var SSH_POLL_MS = 1e4;
var matchesFilter2 = (item, filter) => {
  if (!filter) return true;
  const text = filter.trim().toLowerCase();
  if (!text) return true;
  return `${imageLabel(item)} ${item.id || ""}`.toLowerCase().includes(text);
};
var imageLabel = (item) => item.repository && item.repository !== "<none>" ? `${item.repository}:${item.tag}` : String(item.id || "").slice(0, 12);
var imageTarget = (item) => {
  const repo = item.repository && item.repository !== "<none>" ? item.repository : "";
  const tag = item.tag && item.tag !== "<none>" ? item.tag : "";
  const digest = item.digest && item.digest !== "<none>" ? item.digest : "";
  if (repo && tag) return `${repo}:${tag}`;
  if (repo && digest) return `${repo}@${digest}`;
  return String(item.id || "");
};
var imageKey = (item) => `${item.id}:${item.repository}:${item.tag}`;
var containersUsingImage = (item, containers) => {
  const label = imageLabel(item);
  const imageId = String(item.id || "").replace(/^sha256:/, "");
  const list = [];
  for (const container of containers) {
    const ref = String(container.image || "");
    const refId = ref.replace(/^sha256:/, "");
    const byLabel = ref === label;
    const byId = Boolean(refId && imageId) && (refId.startsWith(imageId) || imageId.startsWith(refId));
    if (byLabel || byId) list.push(container);
  }
  return list;
};
var serverLabel = (item) => item.name || `${item.username || "root"}@${item.host || ""}`;
function ImagesView({ t, rpc, images, containers, loading, error, filter, setFilter, notify, onChanged, active }) {
  const React = getReact();
  const [reference, setReference] = React.useState("");
  const [pulling, setPulling] = React.useState(false);
  const [busyId, setBusyId] = React.useState("");
  const [uploading, setUploading] = React.useState("");
  const [uploadConfirm, setUploadConfirm] = React.useState("");
  const [uploadWarning, setUploadWarning] = React.useState("");
  const [confirmId, setConfirmId] = React.useState("");
  const [actionError, setActionError] = React.useState("");
  const [ssh, setSsh] = React.useState({ status: "idle", id: "", host: "", username: "", servers: [], currentId: "" });
  const [targetId, setTargetId] = React.useState("");
  const [sshBusy, setSshBusy] = React.useState("");
  const [task, setTask] = React.useState(null);
  const [hidden, setHidden] = React.useState(() => /* @__PURE__ */ new Set());
  const [deleting, setDeleting] = React.useState({ active: false, label: "" });
  const taskCursor = React.useRef({ id: "", offset: 0 });
  const aliveRef = React.useRef(true);
  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (!confirmId) return void 0;
    const timer = setTimeout(() => setConfirmId(""), 4e3);
    return () => clearTimeout(timer);
  }, [confirmId]);
  React.useEffect(() => {
    if (!uploadConfirm) return void 0;
    const timer = setTimeout(() => {
      setUploadConfirm("");
      setUploadWarning("");
    }, 6e3);
    return () => clearTimeout(timer);
  }, [uploadConfirm]);
  React.useEffect(() => {
    setUploadConfirm("");
    setUploadWarning("");
  }, [targetId, ssh.id]);
  const refreshSsh = React.useCallback(async () => {
    try {
      const data = await rpc.sshStatus();
      if (!aliveRef.current) return;
      const servers = Array.isArray(data?.servers) ? data.servers : [];
      setSsh({
        status: data?.status || "idle",
        id: String(data?.id || ""),
        host: String(data?.host || ""),
        username: String(data?.username || ""),
        servers,
        currentId: String(data?.currentId || "")
      });
      setTargetId((prev) => {
        if (prev && servers.some((item) => item.id === prev)) return prev;
        const preferred = servers.find((item) => item.id === (data?.id || data?.currentId)) || servers[0];
        return preferred ? preferred.id : "";
      });
    } catch {
    }
  }, [rpc]);
  React.useEffect(() => {
    void refreshSsh();
  }, [refreshSsh]);
  React.useEffect(() => {
    if (active === false) return void 0;
    const timer = setInterval(() => void refreshSsh(), SSH_POLL_MS);
    return () => clearInterval(timer);
  }, [active, refreshSsh]);
  React.useEffect(() => {
    if (!task?.id || task.status !== "running") return void 0;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await rpc.task(task.id, taskCursor.current.offset);
        if (cancelled || !data) return;
        taskCursor.current.offset = Number.isFinite(data.nextOffset) ? data.nextOffset : taskCursor.current.offset;
        setTask((prev) => {
          if (!prev || prev.id !== data.id) return prev;
          const merged = [...prev.lines, ...Array.isArray(data.lines) ? data.lines : []];
          return {
            ...prev,
            status: data.status,
            exitCode: data.exitCode ?? null,
            error: data.error || "",
            lines: merged.slice(-MAX_LOG_LINES2),
            truncated: prev.truncated || data.truncated === true
          };
        });
      } catch (cause) {
        if (!cancelled) {
          setTask((prev) => prev ? { ...prev, status: "failed", error: String(cause?.message || cause) } : prev);
        }
      }
    };
    const timer = setInterval(() => void tick(), 1e3);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [task?.id, task?.status, rpc]);
  const settledRef = React.useRef("");
  React.useEffect(() => {
    const current = task;
    if (!current?.id || current.status === "running") return;
    const key = `${current.id}:${current.status}`;
    if (settledRef.current === key) return;
    settledRef.current = key;
    if (current.kind !== "pull" || current.status !== "succeeded") return;
    void (async () => {
      try {
        await onChanged();
      } catch {
      }
    })();
    notify("success", t("notice.pulled", { reference: current.title }));
  }, [task, onChanged, notify, t]);
  const connected = ssh.status === "connected";
  const currentServer = ssh.servers.find((item) => item.id === ssh.id) || null;
  const currentLabel = currentServer ? serverLabel(currentServer) : `${ssh.username || "root"}@${ssh.host || ""}`;
  const connectedHere = connected && Boolean(targetId) && ssh.id === targetId;
  const targetServer = ssh.servers.find((item) => item.id === targetId) || null;
  const targetLabel = targetServer ? serverLabel(targetServer) : t("image.target");
  const connectTarget = async () => {
    if (!targetId) return;
    setSshBusy("connect");
    setActionError("");
    try {
      await rpc.sshConnect(targetId);
      await refreshSsh();
      notify("success", t("ssh.connected"));
    } catch (cause) {
      setActionError(String(cause?.message || cause));
    } finally {
      setSshBusy("");
    }
  };
  const disconnectTarget = async () => {
    setSshBusy("disconnect");
    setActionError("");
    try {
      await rpc.sshDisconnect();
      await refreshSsh();
    } catch (cause) {
      setActionError(String(cause?.message || cause));
    } finally {
      setSshBusy("");
    }
  };
  const upload = async (item) => {
    if (uploading) return;
    const label = imageLabel(item);
    const key = imageKey(item);
    if (ssh.status === "connected" && uploadConfirm !== key) {
      setUploadConfirm(key);
      setUploadWarning(
        t("image.uploadSourceWarning", { image: label, source: currentLabel, target: targetLabel })
      );
      return;
    }
    setUploadConfirm("");
    setUploadWarning("");
    setUploading(key);
    setActionError("");
    try {
      const payload = await rpc.sshUpload(label, targetId || void 0);
      taskCursor.current = { id: payload.taskId, offset: 0 };
      setTask({
        id: payload.taskId,
        kind: "upload",
        title: label,
        status: "running",
        lines: [],
        error: "",
        exitCode: null,
        truncated: false
      });
      notify("info", t("image.uploadStarted", { image: label }));
      await refreshSsh();
      try {
        await onChanged();
      } catch {
      }
    } catch (cause) {
      setActionError(String(cause?.message || cause));
    } finally {
      setUploading("");
    }
  };
  const pull = async () => {
    const value = reference.trim();
    if (!value) return;
    setPulling(true);
    setActionError("");
    try {
      const payload = await rpc.pull(value);
      setReference("");
      taskCursor.current = { id: payload.taskId, offset: 0 };
      setTask({
        id: payload.taskId,
        kind: "pull",
        title: value,
        status: "running",
        lines: [],
        error: "",
        exitCode: null,
        truncated: false
      });
      notify("info", t("image.pullStarted", { reference: value }));
    } catch (cause) {
      setActionError(String(cause?.message || cause));
    } finally {
      setPulling(false);
    }
  };
  const remove = async (item) => {
    const target = imageTarget(item);
    const key = imageKey(item);
    if (confirmId !== key) {
      setConfirmId(key);
      return;
    }
    setConfirmId("");
    setBusyId(key);
    setActionError("");
    setDeleting({ active: true, label: target });
    let removed = false;
    try {
      await rpc.removeImage(target, false);
      setHidden((prev) => new Set(prev).add(imageKey(item)));
      try {
        await onChanged();
      } finally {
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(imageKey(item));
          return next;
        });
      }
      removed = true;
    } catch (cause) {
      setActionError(String(cause?.message || cause));
    } finally {
      setBusyId("");
      setDeleting({ active: false, label: "" });
    }
    if (removed) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      notify("success", t("notice.imageRemoved", { image: target }));
    }
  };
  const usage = React.useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    for (const item of images) map.set(imageKey(item), containersUsingImage(item, containers || []));
    return map;
  }, [images, containers]);
  const visible = images.filter((item) => !hidden.has(imageKey(item))).filter((item) => matchesFilter2(item, filter));
  const hasServers = ssh.servers.length > 0;
  const targetOptions = ssh.servers.map((item) => ({
    value: item.id,
    label: `${serverLabel(item)}${connected && ssh.id === item.id ? ` (${t("ssh.statusConnected")})` : ""}`
  }));
  return /* @__PURE__ */ h("div", { className: "dk-images" }, /* @__PURE__ */ h("div", { className: "dk-body" }, /* @__PURE__ */ h("div", { className: "dk-toolbar" }, /* @__PURE__ */ h(
    "input",
    {
      className: "dk-input",
      value: reference,
      placeholder: t("image.pullPlaceholder"),
      onChange: (event) => setReference(event.target.value),
      onKeyDown: (event) => {
        if (event.key === "Enter") void pull();
      }
    }
  ), /* @__PURE__ */ h(Btn, { variant: "primary", disabled: pulling || task?.status === "running" || !reference.trim(), onClick: pull }, pulling ? t("image.pulling") : t("image.pull"))), /* @__PURE__ */ h("div", { className: "dk-toolbar", style: { paddingTop: 0 } }, /* @__PURE__ */ h(
    "input",
    {
      className: "dk-input",
      value: filter,
      placeholder: t("filter.placeholder"),
      onChange: (event) => setFilter(event.target.value)
    }
  )), hasServers ? /* @__PURE__ */ h("div", { className: "dk-toolbar", style: { paddingTop: 0 } }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("image.target")), /* @__PURE__ */ h("div", { style: { flex: "1 1 auto", minWidth: 0 } }, /* @__PURE__ */ h(
    DkSelect,
    {
      value: targetId,
      options: targetOptions,
      onChange: setTargetId,
      ariaLabel: t("image.target"),
      size: "sm"
    }
  )), connectedHere ? /* @__PURE__ */ h(Btn, { size: "sm", disabled: Boolean(sshBusy), onClick: () => void disconnectTarget() }, t("image.disconnect")) : /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: "primary",
      disabled: Boolean(sshBusy) || !targetId,
      onClick: () => void connectTarget()
    },
    sshBusy === "connect" ? t("ssh.connecting") : t("image.connect")
  )) : /* @__PURE__ */ h("div", { className: "dk-meta", style: { padding: "0 10px 7px" } }, t("image.noTarget")), connected ? /* @__PURE__ */ h("div", { className: "dk-meta", style: { padding: "0 10px 7px" } }, t("image.viewingRemote", { target: currentLabel })) : null, task ? /* @__PURE__ */ h("div", { style: { padding: "0 10px 8px" } }, /* @__PURE__ */ h(
    TaskLog,
    {
      t,
      task,
      maxHeight: "150px",
      onCancel: () => {
        void rpc.cancelTask(task.id).catch(() => {
        });
      },
      onClear: () => setTask(null)
    }
  )) : null, actionError ? /* @__PURE__ */ h("div", { className: "dk-inline-error", style: { padding: "0 10px 8px" } }, actionError) : null, uploadWarning ? /* @__PURE__ */ h("div", { className: "dk-inline-error", style: { padding: "0 10px 8px" } }, uploadWarning) : null, error ? /* @__PURE__ */ h(ErrorBox, { title: t("error.title"), message: error }) : null, loading && images.length === 0 ? /* @__PURE__ */ h(Loading, { text: t("status.refreshing") }) : null, !loading && !error && visible.length === 0 ? /* @__PURE__ */ h(EmptyState, { title: images.length ? t("list.noMatchImages") : t("list.emptyImages") }) : null, /* @__PURE__ */ h("div", { className: "dk-list" }, visible.map((item) => {
    const label = imageLabel(item);
    return /* @__PURE__ */ h("div", { className: "dk-row", key: imageKey(item) }, /* @__PURE__ */ h("div", { className: "dk-row-head", style: { cursor: "default" } }, /* @__PURE__ */ h("div", { className: "dk-row-main" }, /* @__PURE__ */ h("div", { className: "dk-row-title" }, /* @__PURE__ */ h("span", { className: "dk-name", title: label }, label), (() => {
      const using = usage.get(imageKey(item)) || [];
      if (!using.length) return null;
      const running = using.filter((container) => container.state === "running");
      const names = using.map((container) => container.name).filter(Boolean).slice(0, 4).join(", ");
      return running.length ? /* @__PURE__ */ h(
        "span",
        {
          className: "dk-badge",
          "data-tone": "ok",
          title: t("image.usedByRunningHint", { names: names || "-" })
        },
        t("image.usedByRunning", { count: running.length })
      ) : /* @__PURE__ */ h(
        "span",
        {
          className: "dk-badge",
          "data-tone": "muted",
          title: t("image.usedByStoppedHint", { names: names || "-" })
        },
        t("image.usedByStopped")
      );
    })()), /* @__PURE__ */ h("span", { className: "dk-meta" }, item.size, " · ", item.createdSince), /* @__PURE__ */ h("span", { className: "dk-ports" }, item.id.slice(0, 12)), /* @__PURE__ */ h("span", { className: "dk-badge", "data-tone": "muted", title: t("image.sourceLocalHint") }, t("image.sourceLocal"))), /* @__PURE__ */ h("div", { className: "dk-row-actions" }, hasServers ? /* @__PURE__ */ h(
      Btn,
      {
        size: "sm",
        disabled: !targetId || Boolean(sshBusy) || task?.status === "running" || Boolean(uploading),
        title: !targetId ? t("image.uploadNeedTarget") : connectedHere ? t("image.uploadSameTarget") : t("image.uploadSwitchHint"),
        onClick: () => void upload(item)
      },
      uploading === imageKey(item) ? t("image.uploading") : uploadConfirm === imageKey(item) ? t("image.uploadConfirm") : t("image.upload")
    ) : null, /* @__PURE__ */ h(
      Btn,
      {
        size: "sm",
        variant: "danger",
        disabled: busyId === imageKey(item),
        onClick: () => void remove(item)
      },
      confirmId === imageKey(item) ? t("image.removeConfirm") : t("image.remove")
    ))));
  }))), deleting.active ? /* @__PURE__ */ h("div", { className: "dk-busy-mask", role: "status", "aria-live": "polite" }, /* @__PURE__ */ h("span", { className: "dk-spinner", "aria-hidden": "true" }), /* @__PURE__ */ h("span", { className: "dk-busy-text" }, t("image.deleting", { image: deleting.label }))) : null);
}

// src/panel/runconfig.js
var BUILD_ARG_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
var CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
var DOCKERFILE_NAME = /^(dockerfile([-_.][\w.-]+)?|[\w.-]+\.dockerfile|containerfile)$/i;
var BUILD_OPTION_IDS = ["platform", "buildArgs", "noCache", "pull"];
var RUN_OPTION_IDS = ["ports", "mounts", "env", "runOptions"];
var ALL_OPTION_IDS = [...BUILD_OPTION_IDS, ...RUN_OPTION_IDS];
var PRE_BUILD_TOOLS = ["npm", "maven"];
var PACKAGE_MANAGERS = ["npm", "yarn", "pnpm"];
var NPM_COMMANDS = ["run", "run-script", "install", "ci", "test", "start", "stop", "restart", "exec", "publish", "pack"];
var PRE_BUILD_DEFAULTS = {
  npm: { packageManager: "npm", command: "run", script: "build" },
  maven: { goals: "-B clean package -DskipTests" }
};
var emptyPreBuild = () => ({
  tool: "",
  cwd: "",
  packageJson: "",
  packageManager: "npm",
  command: "run",
  script: "",
  arguments: "",
  nodePath: "",
  nodeOptions: "",
  mavenPath: "",
  env: [],
  goals: "",
  profiles: "",
  jvmOptions: ""
});
var baseName = (path) => {
  const text = String(path || "");
  const index = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  return index >= 0 ? text.slice(index + 1) : text;
};
var toPosix = (path) => String(path || "").replace(/\\/g, "/");
var isAbsolutePath = (path) => /^([A-Za-z]:\/|\/)/.test(toPosix(path));
var isRemoteAbsolutePath = (path) => /^\//.test(String(path || ""));
var isDockerfilePath = (path) => DOCKERFILE_NAME.test(baseName(path));
var isPortText = (text) => {
  if (!/^\d{1,5}$/.test(text)) return false;
  const value = Number(text);
  return value > 0 && value <= 65535;
};
var suggestTag = (projectName, file) => {
  const raw = String(projectName || "").trim() || baseName(projectName);
  let slug = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  if (!slug) {
    const fallback = baseName(file?.name || file?.path || "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    slug = fallback || "app";
  }
  if (file && file.depth > 0) {
    const dir = String(file.relative || "").split("/").slice(-2, -1)[0];
    if (dir) slug = `${slug}-${dir.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`;
  }
  return `${slug}:latest`;
};
var emptyDraft = () => ({
  name: "",
  dockerfile: "",
  serverId: "",
  tag: "",
  context: "",
  platform: "",
  noCache: false,
  pull: false,
  buildArgs: [],
  containerName: "",
  ports: [],
  mounts: [],
  env: [],
  runOptions: "",
  preBuild: emptyPreBuild(),
  options: []
});
var collectOptions = (config) => {
  if (!config) return [];
  const ids = Array.isArray(config.options) ? config.options.filter((id) => ALL_OPTION_IDS.includes(id)) : [];
  const add = (id) => {
    if (!ids.includes(id)) ids.push(id);
  };
  if (config.platform) add("platform");
  if ((config.buildArgs || []).length) add("buildArgs");
  if (config.noCache === true) add("noCache");
  if (config.pull === true) add("pull");
  if ((config.ports || []).length) add("ports");
  if ((config.mounts || []).length) add("mounts");
  if ((config.env || []).length) add("env");
  if (config.runOptions) add("runOptions");
  return ids;
};
var draftFromConfig = (file, config, projectName) => ({
  name: config?.name || file.relative || baseName(file.path),
  dockerfile: file.path,
  serverId: config?.serverId || "",
  tag: config?.tag || suggestTag(projectName, file),
  context: config?.context || "",
  platform: config?.platform || "",
  noCache: config?.noCache === true,
  pull: config?.pull === true,
  buildArgs: (config?.buildArgs || []).map((arg) => ({ key: arg.key, value: arg.value })),
  containerName: config?.containerName || "",
  ports: (config?.ports || []).map((port) => ({
    host: String(port.host ?? ""),
    container: String(port.container ?? ""),
    protocol: port.protocol === "udp" ? "udp" : "tcp"
  })),
  mounts: (config?.mounts || []).map((mount) => ({
    host: mount.host || "",
    container: mount.container || "",
    readOnly: mount.readOnly === true
  })),
  env: (config?.env || []).map((item) => ({ key: item.key || "", value: item.value || "" })),
  runOptions: config?.runOptions || "",
  preBuild: {
    tool: PRE_BUILD_TOOLS.includes(config?.preBuild?.tool) ? config.preBuild.tool : "",
    cwd: config?.preBuild?.cwd || "",
    packageJson: config?.preBuild?.packageJson || "",
    packageManager: PACKAGE_MANAGERS.includes(config?.preBuild?.packageManager) ? config.preBuild.packageManager : "npm",
    command: NPM_COMMANDS.includes(config?.preBuild?.command) ? config.preBuild.command : "run",
    script: config?.preBuild?.script || "",
    arguments: config?.preBuild?.arguments || "",
    nodePath: config?.preBuild?.nodePath || "",
    nodeOptions: config?.preBuild?.nodeOptions || "",
    mavenPath: config?.preBuild?.mavenPath || "",
    env: (config?.preBuild?.env || []).map((item) => ({ key: item.key || "", value: item.value || "" })),
    goals: config?.preBuild?.goals || "",
    profiles: config?.preBuild?.profiles || "",
    jvmOptions: config?.preBuild?.jvmOptions || ""
  },
  options: collectOptions(config)
});
var draftToConfig = (draft) => {
  const buildArgs = [];
  for (const arg of draft.buildArgs || []) {
    const key = String(arg.key || "").trim();
    const value = String(arg.value || "").trim();
    if (!key && !value) continue;
    if (!BUILD_ARG_KEY.test(key)) return { config: null, error: "project.buildArgsInvalid" };
    buildArgs.push({ key, value });
  }
  const ports = [];
  for (const port of draft.ports || []) {
    const host = String(port.host || "").trim();
    const container = String(port.container || "").trim();
    if (!host && !container) continue;
    if (!isPortText(host) || !isPortText(container)) return { config: null, error: "project.portInvalid" };
    ports.push({ host, container, protocol: port.protocol === "udp" ? "udp" : "tcp" });
  }
  const mounts = [];
  for (const mount of draft.mounts || []) {
    const host = String(mount.host || "").trim();
    const container = String(mount.container || "").trim();
    if (!host && !container) continue;
    if (!isRemoteAbsolutePath(host)) return { config: null, error: "project.mountHostInvalid" };
    if (!container.startsWith("/")) return { config: null, error: "project.mountTargetInvalid" };
    mounts.push({ host, container, readOnly: mount.readOnly === true });
  }
  const env = [];
  let envBytes = 0;
  for (const item of draft.env || []) {
    const key = String(item.key || "").trim();
    const value = normalizeEnvValue(item.value);
    if (!key && !value.trim()) continue;
    if (!BUILD_ARG_KEY.test(key)) return { config: null, error: "project.envInvalid" };
    if (value.length > ENV_VALUE_MAX) {
      return {
        config: null,
        error: "project.envValueTooLong",
        params: { key, count: value.length, max: ENV_VALUE_MAX }
      };
    }
    envBytes += utf8Bytes(key) + utf8Bytes(value);
    env.push({ key, value });
  }
  if (envBytes > ENV_TOTAL_MAX) {
    return {
      config: null,
      error: "project.envTotalTooLarge",
      params: { count: Math.ceil(envBytes / 1024), max: ENV_TOTAL_MAX / 1024 }
    };
  }
  const tag = String(draft.tag || "").trim();
  if (!tag) return { config: null, error: "project.needTag" };
  const dockerfile = toPosix(String(draft.dockerfile || "").trim());
  if (!isAbsolutePath(dockerfile) || !isDockerfilePath(dockerfile)) {
    return { config: null, error: "project.dockerfileInvalid" };
  }
  const context = String(draft.context || "").trim();
  if (context && !isAbsolutePath(context)) return { config: null, error: "project.contextInvalid" };
  const containerName = String(draft.containerName || "").trim();
  if (containerName && !CONTAINER_NAME.test(containerName)) {
    return { config: null, error: "project.containerNameInvalid" };
  }
  const before = draft.preBuild || {};
  const beforeEnv = [];
  let beforeEnvChars = 0;
  for (const item of before.env || []) {
    const key = String(item.key || "").trim();
    const value = normalizeEnvValue(item.value);
    if (!key && !value.trim()) continue;
    if (!BUILD_ARG_KEY.test(key)) return { config: null, error: "project.envInvalid" };
    if (value.length > PRE_BUILD_ENV_VALUE_MAX) {
      return {
        config: null,
        error: "project.preBuildEnvValueTooLong",
        params: { key, count: value.length, max: PRE_BUILD_ENV_VALUE_MAX }
      };
    }
    beforeEnvChars += key.length + value.length + 1;
    beforeEnv.push({ key, value });
  }
  if (beforeEnvChars > PRE_BUILD_ENV_TOTAL_MAX) {
    return {
      config: null,
      error: "project.preBuildEnvTotalTooLarge",
      params: { count: beforeEnvChars, max: PRE_BUILD_ENV_TOTAL_MAX }
    };
  }
  const preBuild = {
    tool: PRE_BUILD_TOOLS.includes(before.tool) ? before.tool : "",
    cwd: String(before.cwd || "").trim(),
    packageJson: String(before.packageJson || "").trim(),
    packageManager: PACKAGE_MANAGERS.includes(before.packageManager) ? before.packageManager : "npm",
    command: NPM_COMMANDS.includes(before.command) ? before.command : "run",
    script: String(before.script || "").replace(/\s+/g, ""),
    arguments: String(before.arguments || "").replace(/[\r\n]+/g, " ").trim(),
    nodePath: String(before.nodePath || "").trim(),
    nodeOptions: String(before.nodeOptions || "").replace(/[\r\n]+/g, " ").trim(),
    mavenPath: String(before.mavenPath || "").trim(),
    env: beforeEnv,
    goals: String(before.goals || "").replace(/[\r\n]+/g, " ").trim(),
    profiles: String(before.profiles || "").replace(/[\r\n]+/g, " ").trim(),
    jvmOptions: String(before.jvmOptions || "").replace(/[\r\n]+/g, " ").trim()
  };
  if (preBuild.tool && preBuild.cwd && !isAbsolutePath(preBuild.cwd)) {
    return { config: null, error: "project.preBuildCwdInvalid" };
  }
  if (preBuild.tool && preBuild.packageJson && !isAbsolutePath(preBuild.packageJson)) {
    return { config: null, error: "project.packageJsonInvalid" };
  }
  if (!String(draft.serverId || "").trim()) {
    return { config: null, error: "project.needServer" };
  }
  if (preBuild.tool === "maven") {
    if (!preBuild.goals) return { config: null, error: "project.mavenGoalsInvalid" };
    if (preBuild.mavenPath && !isAbsolutePath(preBuild.mavenPath) && !/^[A-Za-z0-9._-]+$/.test(preBuild.mavenPath)) {
      return { config: null, error: "project.mavenPathInvalid" };
    }
  } else if (preBuild.tool === "npm") {
    if (!preBuild.script && (preBuild.command === "run" || preBuild.command === "run-script")) {
      return { config: null, error: "project.npmScriptInvalid" };
    }
  }
  return {
    config: {
      name: String(draft.name || "").trim(),
      serverId: draft.serverId || "",
      tag,
      context,
      platform: String(draft.platform || "").trim(),
      noCache: draft.noCache === true,
      pull: draft.pull === true,
      buildArgs,
      containerName,
      ports,
      mounts,
      env,
      runOptions: String(draft.runOptions || "").replace(/[\r\n]+/g, " ").trim(),
      preBuild,
      options: (draft.options || []).filter((id) => ALL_OPTION_IDS.includes(id))
    },
    error: ""
  };
};

// src/panel/configdialog.jsx
var CONFIRM_MS = 4e3;
var CloseIcon = () => /* @__PURE__ */ h("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ h("path", { d: "M6 6l12 12M18 6L6 18", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round" }));
var FolderIcon = () => /* @__PURE__ */ h("svg", { width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ h(
  "path",
  {
    d: "M3 7.5A1.5 1.5 0 014.5 6h4l2 2h7a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0117.5 18h-13A1.5 1.5 0 013 16.5v-9z",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinejoin: "round"
  }
));
var RefreshIcon = () => /* @__PURE__ */ h("svg", { width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ h(
  "path",
  {
    d: "M20 12a8 8 0 10-2.6 5.9M20 5v5h-5",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }
));
var SCRIPT_CUSTOM_ID = "__custom__";
var LIST_FIELDS = {
  buildArgs: {
    columns: [
      { key: "key", placeholderKey: "project.keyName" },
      { key: "value", placeholderKey: "project.keyValue" }
    ],
    empty: () => ({ key: "", value: "" })
  },
  ports: {
    columns: [
      { key: "host", placeholderKey: "project.portHost", width: "88px" },
      { key: "container", placeholderKey: "project.portContainer", width: "88px" }
    ],
    empty: () => ({ host: "", container: "", protocol: "tcp" })
  },
  mounts: {
    columns: [
      { key: "host", placeholderKey: "project.mountHost" },
      { key: "container", placeholderKey: "project.mountTarget" },
      { key: "readOnly", type: "check", labelKey: "project.mountReadOnlyShort" }
    ],
    empty: () => ({ host: "", container: "", readOnly: false })
  },
  env: {
    columns: [
      { key: "key", placeholderKey: "project.keyName" },
      // 值可能是 PEM 私钥这类多行文本，用文本域保留换行；limit 只用于显示字数，不做截断。
      { key: "value", placeholderKey: "project.keyValue", multiline: true, limit: ENV_VALUE_MAX }
    ],
    empty: () => ({ key: "", value: "" })
  }
};
function OptionMenu({ t, ids, selected, onToggle, disabled }) {
  const React = getReact();
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState(null);
  const rootRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const ITEM_HEIGHT = 26;
  const MENU_MAX = 260;
  const place = React.useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const need = Math.min(MENU_MAX, ids.length * ITEM_HEIGHT + 14);
    const below = window.innerHeight - rect.bottom - 10;
    const above = rect.top - 10;
    const up = below < need && above > below;
    setCoords({
      position: "fixed",
      right: Math.max(8, window.innerWidth - rect.right),
      maxHeight: `${Math.max(120, Math.min(need, up ? above : below))}px`,
      ...up ? { bottom: Math.max(8, window.innerHeight - rect.top + 4) } : { top: rect.bottom + 4 }
    });
  }, [ids.length]);
  React.useEffect(() => {
    if (!open) return void 0;
    place();
    const onDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScroll = (event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);
  return /* @__PURE__ */ h("div", { className: "dk-option-anchor", ref: rootRef }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: disabled === true, onClick: () => setOpen((value) => !value) }, t("project.modify")), open && coords ? /* @__PURE__ */ h("div", { className: "dk-option-menu", ref: menuRef, style: coords, role: "menu" }, ids.map((id) => /* @__PURE__ */ h("label", { className: "dk-option-item", key: id }, /* @__PURE__ */ h("input", { type: "checkbox", checked: selected.includes(id), onChange: () => onToggle(id) }), /* @__PURE__ */ h("span", null, t(`project.option.${id}`))))) : null);
}
var summarize = (rows, mapper) => {
  const parts = (rows || []).map(mapper).filter(Boolean);
  return parts.join(", ");
};
function ConfigDialog({
  t,
  files,
  runConfigSummaries,
  servers,
  projectName,
  projectRoot,
  initialPath,
  onSave,
  onRemove,
  onAdd,
  onLoadScripts,
  onLoadConfig,
  onClose
}) {
  const React = getReact();
  const [selected, setSelected] = React.useState("");
  const [drafts, setDrafts] = React.useState({});
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [add, setAdd] = React.useState({ open: false, path: "", error: "" });
  const [editor, setEditor] = React.useState(null);
  const [scripts, setScripts] = React.useState({ loading: false, list: [], missing: false, error: "", path: "" });
  const [scriptCustom, setScriptCustom] = React.useState(false);
  const [loadingPath, setLoadingPath] = React.useState("");
  const loadSeq = React.useRef(0);
  const maskRef = React.useRef(null);
  React.useEffect(() => {
    const node = maskRef.current;
    if (!node) return void 0;
    const patched = [];
    let el = node.parentElement;
    while (el && el !== document.body) {
      const computed = window.getComputedStyle(el);
      const saved = {
        el,
        transform: el.style.transform,
        filter: el.style.filter,
        backdropFilter: el.style.backdropFilter,
        perspective: el.style.perspective,
        contain: el.style.contain,
        zIndex: el.style.zIndex
      };
      let touched = false;
      if (computed.transform && computed.transform !== "none") {
        el.style.transform = "none";
        touched = true;
      }
      if (computed.filter && computed.filter !== "none") {
        el.style.filter = "none";
        touched = true;
      }
      if (computed.backdropFilter && computed.backdropFilter !== "none") {
        el.style.backdropFilter = "none";
        touched = true;
      }
      if (computed.perspective && computed.perspective !== "none") {
        el.style.perspective = "none";
        touched = true;
      }
      if (computed.contain && computed.contain !== "none" && /paint|layout|strict|content/.test(computed.contain)) {
        el.style.contain = "none";
        touched = true;
      }
      if (touched) {
        el.style.zIndex = "70";
        patched.push(saved);
      }
      el = el.parentElement;
    }
    return () => {
      for (const item of patched) {
        item.el.style.transform = item.transform;
        item.el.style.filter = item.filter;
        item.el.style.backdropFilter = item.backdropFilter;
        item.el.style.perspective = item.perspective;
        item.el.style.contain = item.contain;
        item.el.style.zIndex = item.zIndex;
      }
    };
  }, []);
  React.useEffect(() => {
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (!files.some((file) => file.path === key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [files]);
  React.useEffect(() => {
    if (!selected || drafts[selected] || !onLoadConfig) return void 0;
    const seq = ++loadSeq.current;
    const path = selected;
    setLoadingPath(path);
    let cancelled = false;
    (async () => {
      try {
        const data = await onLoadConfig(path);
        if (cancelled || seq !== loadSeq.current) return;
        const file = files.find((item) => item.path === path) || {
          path,
          relative: baseName(path),
          name: baseName(path),
          depth: 0
        };
        setDrafts(
          (prev) => prev[path] ? prev : { ...prev, [path]: draftFromConfig(file, data?.config || null, projectName) }
        );
      } catch (cause) {
        if (!cancelled && seq === loadSeq.current) setError(String(cause?.message || cause));
      } finally {
        if (!cancelled && seq === loadSeq.current) setLoadingPath("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, drafts, files, projectName, onLoadConfig]);
  React.useEffect(() => {
    if (!files.length) {
      setSelected("");
      return;
    }
    setSelected((prev) => {
      if (prev && files.some((file) => file.path === prev)) return prev;
      if (initialPath && files.some((file) => file.path === initialPath)) return initialPath;
      return files[0].path;
    });
  }, [files, initialPath]);
  React.useEffect(() => {
    if (!confirmRemove) return void 0;
    const timer = setTimeout(() => setConfirmRemove(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmRemove]);
  const current = files.find((file) => file.path === selected) || null;
  const draft = selected && drafts[selected] || emptyDraft();
  const configReady = Boolean(selected && drafts[selected]);
  const locked = Boolean(selected && onLoadConfig) && !configReady;
  const serverOptions = [
    ...draft.serverId ? [] : [{ value: "", label: t("target.choose") }],
    ...servers.map((item) => ({
      value: item.id,
      label: item.name || `${item.username || "root"}@${item.host || ""}`
    }))
  ];
  const has = (id) => draft.options.includes(id);
  const preBuildSummary = (pre) => {
    if (!pre || !pre.tool) return "";
    if (pre.tool === "maven") return ["Maven", pre.goals].filter(Boolean).join(" ");
    const manager = pre.packageManager || "npm";
    const isRun = pre.command === "run" || pre.command === "run-script";
    const tail = isRun ? ["run", pre.script].filter(Boolean).join(" ") : pre.command;
    return [manager, tail].filter(Boolean).join(" ");
  };
  const preBuildToolOptions = [
    { value: "", label: t("project.toolNone") },
    { value: "npm", label: "npm" },
    { value: "maven", label: "Maven" }
  ];
  const packageManagerOptions = [
    { value: "npm", label: "npm" },
    { value: "yarn", label: "yarn" },
    { value: "pnpm", label: "pnpm" }
  ];
  const npmCommandOptions = NPM_COMMANDS.map((id) => ({ value: id, label: id }));
  const scriptOptions = (() => {
    const list = [...scripts.list];
    const current2 = String(editor?.value?.script || "");
    if (current2 && !list.includes(current2)) list.unshift(current2);
    return [
      ...list.map((name) => ({ value: name, label: name })),
      { value: SCRIPT_CUSTOM_ID, label: t("project.scriptCustom") }
    ];
  })();
  const patch = (next) => {
    if (selected && onLoadConfig && !drafts[selected]) return;
    setDrafts((prev) => ({ ...prev, [selected]: { ...prev[selected] || emptyDraft(), ...next } }));
  };
  const toggleOption = (id) => {
    if (has(id)) {
      const cleared = {
        platform: { platform: "" },
        buildArgs: { buildArgs: [] },
        noCache: { noCache: false },
        pull: { pull: false },
        ports: { ports: [] },
        mounts: { mounts: [] },
        env: { env: [] },
        runOptions: { runOptions: "" }
      }[id] || {};
      patch({ ...cleared, options: draft.options.filter((item) => item !== id) });
      return;
    }
    patch({ options: [...draft.options, id] });
  };
  const selectFile = (path) => {
    setSelected(path);
    setError("");
    setConfirmRemove(false);
    setEditor(null);
  };
  const openTextEditor = (field, title, placeholder) => {
    setEditor({ kind: "text", field, title, value: String(draft[field] || ""), placeholder: placeholder || "" });
  };
  const openListEditor = (field, title) => {
    setEditor({ kind: "list", field, title, rows: (draft[field] || []).map((row) => ({ ...row })) });
  };
  const openPreBuildEditor = () => {
    const value = { ...emptyPreBuild(), ...draft.preBuild || {} };
    value.env = (draft.preBuild?.env || []).map((item) => ({ ...item }));
    setScripts({ loading: false, list: [], missing: false, error: "", path: "" });
    setScriptCustom(false);
    setEditor({ kind: "form", field: "preBuild", title: t("project.preBuild"), value });
    if (value.tool === "npm") void loadScripts(value);
  };
  const patchEditorValue = (next) => {
    setEditor((prev) => prev ? { ...prev, value: { ...prev.value, ...next } } : prev);
  };
  const scriptBaseDir = () => {
    const context = String(draft.context || "").trim();
    if (context) return context;
    const root = String(projectRoot || "").trim();
    if (root) return root;
    const file = toPosix(String(draft.dockerfile || ""));
    const index = file.lastIndexOf("/");
    return index > 0 ? file.slice(0, index) : "";
  };
  const loadScripts = async (value) => {
    if (!onLoadScripts) return;
    const target = String(value?.packageJson || "").trim();
    const dir = String(value?.cwd || "").trim() || scriptBaseDir();
    setScripts({ loading: true, list: [], missing: false, error: "", path: target });
    try {
      const data = await onLoadScripts(target, dir);
      setScripts({
        loading: false,
        list: Array.isArray(data?.scripts) ? data.scripts : [],
        missing: data?.exists === false,
        error: "",
        path: data?.path || target
      });
    } catch (cause) {
      const text = cause?.code === "HTTP_404" ? t("project.scriptsNeedRestart") : String(cause?.message || cause);
      setScripts({ loading: false, list: [], missing: false, error: text, path: target });
    }
  };
  const changePreBuildTool = (tool) => {
    if (!editor) return;
    const value = { ...editor.value, tool };
    if (tool === "npm") {
      value.packageManager = value.packageManager || PRE_BUILD_DEFAULTS.npm.packageManager;
      value.command = value.command || PRE_BUILD_DEFAULTS.npm.command;
      value.script = value.script || PRE_BUILD_DEFAULTS.npm.script;
    } else if (tool === "maven") {
      value.goals = value.goals || PRE_BUILD_DEFAULTS.maven.goals;
    }
    setEditor({ ...editor, value });
    if (tool === "npm") void loadScripts(value);
  };
  const patchPreBuildEnv = (index, next) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const env = (prev.value.env || []).map((row, at) => at === index ? { ...row, ...next } : row);
      return { ...prev, value: { ...prev.value, env } };
    });
  };
  const addPreBuildEnv = () => {
    setEditor(
      (prev) => prev ? { ...prev, value: { ...prev.value, env: [...prev.value.env || [], { key: "", value: "" }] } } : prev
    );
  };
  const removePreBuildEnv = (index) => {
    setEditor(
      (prev) => prev ? { ...prev, value: { ...prev.value, env: (prev.value.env || []).filter((_, at) => at !== index) } } : prev
    );
  };
  const applyEditor = () => {
    if (!editor) return;
    if (editor.kind === "text") patch({ [editor.field]: editor.value });
    else if (editor.kind === "list") patch({ [editor.field]: editor.rows });
    else patch({ [editor.field]: editor.value });
    setEditor(null);
  };
  const commit = async (mode) => {
    if (!selected || !drafts[selected]) return;
    const converted = draftToConfig(draft);
    if (converted.error) {
      setError(t(converted.error, converted.params));
      return;
    }
    setBusy(mode);
    setError("");
    try {
      const previousPath = selected;
      const nextPath = toPosix(draft.dockerfile.trim());
      await onSave(nextPath, converted.config, previousPath);
      if (nextPath !== previousPath) {
        setDrafts((prev) => {
          const next = { ...prev };
          const moved = next[previousPath] || draft;
          delete next[previousPath];
          next[nextPath] = { ...moved, dockerfile: nextPath };
          return next;
        });
        setSelected(nextPath);
        setEditor(null);
      }
      if (mode === "save") onClose();
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };
  const remove = async () => {
    if (!selected) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setConfirmRemove(false);
    setBusy("remove");
    setError("");
    try {
      await onRemove(selected);
      const target = files.find((file) => file.path === selected);
      setDrafts((prev) => {
        const next = { ...prev };
        if (target) next[selected] = draftFromConfig(target, null, projectName);
        else delete next[selected];
        return next;
      });
      setEditor(null);
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };
  const submitAdd = async () => {
    const path = toPosix(add.path.trim());
    if (!isAbsolutePath(path)) {
      setAdd((prev) => ({ ...prev, error: t("project.addInvalid") }));
      return;
    }
    setBusy("add");
    setAdd((prev) => ({ ...prev, error: "" }));
    try {
      await onAdd(path);
      setAdd({ open: false, path: "", error: "" });
      setSelected(path);
    } catch (cause) {
      setAdd((prev) => ({ ...prev, error: String(cause?.message || cause) }));
    } finally {
      setBusy("");
    }
  };
  const valueRow = (label, summary, onEdit, disabled) => /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, label), /* @__PURE__ */ h("span", { className: "dk-value" }, /* @__PURE__ */ h("span", { className: "dk-value-text", title: summary }, summary || t("project.notSet")), /* @__PURE__ */ h(
    "button",
    {
      type: "button",
      className: "dk-icon-btn",
      title: t("project.editValue"),
      disabled: disabled === true,
      onClick: onEdit
    },
    /* @__PURE__ */ h(FolderIcon, null)
  )));
  const listConfig = editor && editor.kind === "list" ? LIST_FIELDS[editor.field] : null;
  const preBuildEnvChars = (editor?.value?.env || []).reduce(
    (sum, item) => sum + String(item.key || "").length + normalizeEnvValue(item.value).length + 1,
    0
  );
  return /* @__PURE__ */ h(
    "div",
    {
      className: "dk-modal-mask",
      ref: maskRef,
      role: "presentation",
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) onClose();
      }
    },
    /* @__PURE__ */ h("div", { className: "dk-modal", role: "dialog", "aria-modal": "true", "aria-label": t("project.runConfigs") }, /* @__PURE__ */ h("div", { className: "dk-modal-head" }, /* @__PURE__ */ h("span", { className: "dk-modal-title" }, t("project.runConfigs")), /* @__PURE__ */ h("button", { type: "button", className: "dk-icon-btn", title: t("project.configCancel"), onClick: onClose }, /* @__PURE__ */ h(CloseIcon, null))), /* @__PURE__ */ h("div", { className: "dk-modal-body" }, /* @__PURE__ */ h("div", { className: "dk-modal-side" }, /* @__PURE__ */ h("div", { className: "dk-config-list" }, files.map((file) => {
      const saved = runConfigSummaries[file.path] || null;
      const label = drafts[file.path]?.name || saved?.name || file.relative;
      return /* @__PURE__ */ h(
        "button",
        {
          key: file.path,
          type: "button",
          className: "dk-config-item",
          "data-active": file.path === selected ? "1" : "0",
          title: file.path,
          onClick: () => selectFile(file.path)
        },
        /* @__PURE__ */ h("span", { className: "dk-config-item-name" }, label),
        /* @__PURE__ */ h("span", { className: "dk-config-item-path" }, file.missing ? `${t("project.missing")} · ` : "", file.relative)
      );
    }), files.length === 0 ? /* @__PURE__ */ h("div", { className: "dk-meta" }, t("project.empty")) : null), /* @__PURE__ */ h("div", { className: "dk-config-add" }, add.open ? /* @__PURE__ */ h("div", { className: "dk-form" }, /* @__PURE__ */ h(
      "input",
      {
        className: "dk-input",
        value: add.path,
        placeholder: t("project.addDockerfileHint"),
        onChange: (event) => setAdd((prev) => ({ ...prev, path: event.target.value, error: "" })),
        onKeyDown: (event) => {
          if (event.key === "Enter") void submitAdd();
        }
      }
    ), /* @__PURE__ */ h("div", { className: "dk-actionbar" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "primary", disabled: busy === "add" || !add.path.trim(), onClick: () => void submitAdd() }, t("project.add")), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => setAdd({ open: false, path: "", error: "" }) }, t("project.configCancel"))), add.error ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, add.error) : null) : /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => setAdd({ open: true, path: "", error: "" }) }, `+ ${t("project.addDockerfile")}`))), /* @__PURE__ */ h("div", { className: "dk-modal-main" }, loadingPath === selected ? /* @__PURE__ */ h("div", { className: "dk-note" }, t("project.configLoading")) : null, current ? /* @__PURE__ */ h("div", { className: "dk-form" }, /* @__PURE__ */ h("label", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.configName")), /* @__PURE__ */ h(
      "input",
      {
        className: "dk-input",
        value: draft.name,
        placeholder: current.relative,
        disabled: locked,
        onChange: (event) => patch({ name: event.target.value })
      }
    )), /* @__PURE__ */ h("div", { className: "dk-field dk-field-block" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.configServer")), /* @__PURE__ */ h("span", { className: "dk-value dk-value-stack" }, /* @__PURE__ */ h(
      DkSelect,
      {
        value: draft.serverId,
        options: serverOptions,
        onChange: (value) => patch({ serverId: value }),
        ariaLabel: t("project.configServer"),
        disabled: locked,
        size: "sm"
      }
    ), /* @__PURE__ */ h("span", { className: "dk-note" }, t("project.serverHint")))), /* @__PURE__ */ h("div", { className: "dk-section" }, /* @__PURE__ */ h("div", { className: "dk-section-head" }, /* @__PURE__ */ h("span", null, t("project.sectionBuild")), /* @__PURE__ */ h("span", { className: "dk-head-spacer" }), /* @__PURE__ */ h(
      OptionMenu,
      {
        t,
        ids: BUILD_OPTION_IDS,
        selected: draft.options,
        onToggle: toggleOption,
        disabled: locked
      }
    )), valueRow(
      t("project.configDockerfile"),
      draft.dockerfile,
      () => openTextEditor("dockerfile", t("project.configDockerfile"), current.path),
      locked
    ), valueRow(
      t("project.configContextFolder"),
      draft.context,
      () => openTextEditor("context", t("project.configContextFolder"), t("project.configContextHint")),
      locked
    ), /* @__PURE__ */ h("label", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.configTag")), /* @__PURE__ */ h(
      "input",
      {
        className: "dk-input",
        value: draft.tag,
        placeholder: "app:latest",
        disabled: locked,
        onChange: (event) => patch({ tag: event.target.value })
      }
    )), has("platform") ? valueRow(
      t("project.option.platform"),
      draft.platform,
      () => openTextEditor("platform", t("project.option.platform"), "linux/amd64"),
      locked
    ) : null, has("buildArgs") ? valueRow(
      t("project.option.buildArgs"),
      summarize(draft.buildArgs, (arg) => arg.key ? `${arg.key}=${arg.value}` : ""),
      () => openListEditor("buildArgs", t("project.option.buildArgs")),
      locked
    ) : null, has("noCache") || has("pull") ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.sectionSwitch")), /* @__PURE__ */ h("span", { className: "dk-checks" }, has("noCache") ? /* @__PURE__ */ h("label", null, /* @__PURE__ */ h(
      "input",
      {
        type: "checkbox",
        checked: draft.noCache,
        disabled: locked,
        onChange: (event) => patch({ noCache: event.target.checked })
      }
    ), /* @__PURE__ */ h("span", null, t("project.configNoCache"))) : null, has("pull") ? /* @__PURE__ */ h("label", null, /* @__PURE__ */ h(
      "input",
      {
        type: "checkbox",
        checked: draft.pull,
        disabled: locked,
        onChange: (event) => patch({ pull: event.target.checked })
      }
    ), /* @__PURE__ */ h("span", null, t("project.configPull"))) : null)) : null), /* @__PURE__ */ h("div", { className: "dk-section" }, /* @__PURE__ */ h("div", { className: "dk-section-head" }, /* @__PURE__ */ h("span", null, t("project.sectionRun")), /* @__PURE__ */ h("span", { className: "dk-head-spacer" }), /* @__PURE__ */ h(OptionMenu, { t, ids: RUN_OPTION_IDS, selected: draft.options, onToggle: toggleOption, disabled: locked })), /* @__PURE__ */ h("label", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.configContainerName")), /* @__PURE__ */ h(
      "input",
      {
        className: "dk-input",
        value: draft.containerName,
        placeholder: t("project.configContainerNameHint"),
        disabled: locked,
        onChange: (event) => patch({ containerName: event.target.value })
      }
    )), has("ports") ? valueRow(
      t("project.option.ports"),
      summarize(
        draft.ports,
        (port) => port.host || port.container ? `${port.host || "?"}:${port.container || "?"}` : ""
      ),
      () => openListEditor("ports", t("project.option.ports")),
      locked
    ) : null, has("mounts") ? valueRow(
      t("project.option.mounts"),
      summarize(
        draft.mounts,
        (mount) => mount.host || mount.container ? `${mount.host || "?"} -> ${mount.container || "?"}${mount.readOnly ? " (ro)" : ""}` : ""
      ),
      () => openListEditor("mounts", t("project.option.mounts")),
      locked
    ) : null, has("env") ? valueRow(
      t("project.option.env"),
      // 摘要只显示键名：值可能是私钥，不在折叠行与 tooltip 里铺明文。
      summarize(draft.env, (item) => item.key ? `${item.key}=***` : ""),
      () => openListEditor("env", t("project.option.env")),
      locked
    ) : null, has("runOptions") ? valueRow(
      t("project.option.runOptions"),
      draft.runOptions,
      () => openTextEditor("runOptions", t("project.option.runOptions"), t("project.runOptionsHint")),
      locked
    ) : null), /* @__PURE__ */ h("div", { className: "dk-section" }, /* @__PURE__ */ h("div", { className: "dk-section-head" }, /* @__PURE__ */ h("span", null, t("project.preBuild")), /* @__PURE__ */ h("span", { className: "dk-head-spacer" })), valueRow(
      t("project.preBuildTool"),
      // 未选工具时明确写「不执行」，避免看成没配置。
      preBuildSummary(draft.preBuild) || t("project.toolNone"),
      openPreBuildEditor,
      locked
    )), error ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, error) : null) : /* @__PURE__ */ h("div", { className: "dk-meta" }, t("project.emptyHint")))), /* @__PURE__ */ h("div", { className: "dk-modal-foot" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "danger", disabled: !current || Boolean(busy), onClick: () => void remove() }, confirmRemove ? t("project.configDeleteConfirm") : t("project.configDelete")), /* @__PURE__ */ h("span", { className: "dk-head-spacer" }), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: onClose }, t("project.configCancel")), /* @__PURE__ */ h(Btn, { size: "sm", disabled: !current || Boolean(busy) || !configReady, onClick: () => void commit("apply") }, t("project.configApply")), /* @__PURE__ */ h(Btn, { size: "sm", disabled: !current || Boolean(busy) || !configReady, onClick: () => void commit("save") }, t("project.configSave")))),
    editor ? /* @__PURE__ */ h(
      "div",
      {
        className: "dk-submask",
        role: "presentation",
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) setEditor(null);
        }
      },
      /* @__PURE__ */ h(
        "div",
        {
          className: "dk-subdialog",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": editor.title,
          "data-wide": editor.kind === "form" ? "1" : "0"
        },
        /* @__PURE__ */ h("div", { className: "dk-subdialog-head" }, /* @__PURE__ */ h("span", { className: "dk-modal-title" }, editor.title), /* @__PURE__ */ h("button", { type: "button", className: "dk-icon-btn", title: t("project.configCancel"), onClick: () => setEditor(null) }, /* @__PURE__ */ h(CloseIcon, null))),
        /* @__PURE__ */ h("div", { className: "dk-subdialog-body" }, editor.kind === "text" ? /* @__PURE__ */ h(
          "input",
          {
            className: "dk-input",
            value: editor.value,
            placeholder: editor.placeholder,
            autoFocus: true,
            onChange: (event) => setEditor((prev) => ({ ...prev, value: event.target.value })),
            onKeyDown: (event) => {
              if (event.key === "Enter") applyEditor();
            }
          }
        ) : null, editor.kind === "list" ? /* @__PURE__ */ h("div", { className: "dk-rows" }, editor.rows.map((row, index) => /* @__PURE__ */ h("div", { className: "dk-row-inputs", key: `row-${index}` }, listConfig.columns.map(
          (column) => column.type === "check" ? /* @__PURE__ */ h("label", { className: "dk-inline-check", key: column.key, title: t(column.labelKey) }, /* @__PURE__ */ h(
            "input",
            {
              type: "checkbox",
              checked: row[column.key] === true,
              onChange: (event) => setEditor((prev) => ({
                ...prev,
                rows: prev.rows.map(
                  (item, at) => at === index ? { ...item, [column.key]: event.target.checked } : item
                )
              }))
            }
          ), /* @__PURE__ */ h("span", null, t(column.labelKey))) : column.multiline ? /* @__PURE__ */ h("div", { className: "dk-multiline", key: column.key }, /* @__PURE__ */ h(
            "textarea",
            {
              className: "dk-input dk-textarea",
              rows: 4,
              spellCheck: false,
              value: row[column.key] || "",
              placeholder: t(column.placeholderKey),
              onChange: (event) => setEditor((prev) => ({
                ...prev,
                rows: prev.rows.map(
                  (item, at) => at === index ? { ...item, [column.key]: event.target.value } : item
                )
              }))
            }
          ), column.limit ? /* @__PURE__ */ h(
            "span",
            {
              className: "dk-env-count",
              "data-over": normalizeEnvValue(row[column.key]).length > column.limit ? "1" : "0"
            },
            `${normalizeEnvValue(row[column.key]).length} / ${column.limit}`
          ) : null) : /* @__PURE__ */ h(
            "input",
            {
              key: column.key,
              className: "dk-input",
              style: column.width ? { flex: "none", width: column.width } : void 0,
              value: row[column.key] || "",
              placeholder: t(column.placeholderKey),
              onChange: (event) => setEditor((prev) => ({
                ...prev,
                rows: prev.rows.map(
                  (item, at) => at === index ? { ...item, [column.key]: event.target.value } : item
                )
              }))
            }
          )
        ), /* @__PURE__ */ h(
          "button",
          {
            type: "button",
            className: "dk-icon-btn",
            title: t("project.removeRow"),
            onClick: () => setEditor((prev) => ({ ...prev, rows: prev.rows.filter((_, at) => at !== index) }))
          },
          /* @__PURE__ */ h(CloseIcon, null)
        ))), /* @__PURE__ */ h("div", null, /* @__PURE__ */ h(
          Btn,
          {
            size: "sm",
            variant: "ghost",
            onClick: () => setEditor((prev) => ({ ...prev, rows: [...prev.rows, listConfig.empty()] }))
          },
          `+ ${t("project.addRow")}`
        )), editor.field === "env" ? /* @__PURE__ */ h("div", { className: "dk-note" }, t("project.envSecretHint")) : null) : null, editor.kind === "form" ? /* @__PURE__ */ h("div", { className: "dk-form" }, /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.preBuildTool")), /* @__PURE__ */ h("span", { className: "dk-value" }, /* @__PURE__ */ h(
          DkSelect,
          {
            value: editor.value.tool,
            options: preBuildToolOptions,
            size: "sm",
            ariaLabel: t("project.preBuildTool"),
            onChange: changePreBuildTool
          }
        ))), editor.value.tool === "npm" ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.packageJson")), /* @__PURE__ */ h("span", { className: "dk-value" }, /* @__PURE__ */ h(
          "input",
          {
            className: "dk-input",
            value: editor.value.packageJson,
            placeholder: t("project.packageJsonHint"),
            onChange: (event) => patchEditorValue({ packageJson: event.target.value }),
            onBlur: () => void loadScripts(editor.value)
          }
        ), /* @__PURE__ */ h(
          "button",
          {
            type: "button",
            className: "dk-icon-btn",
            title: t("project.scriptsLoad"),
            onClick: () => void loadScripts(editor.value)
          },
          /* @__PURE__ */ h(RefreshIcon, null)
        ))) : null, editor.value.tool === "npm" ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.npmCommand")), /* @__PURE__ */ h("span", { className: "dk-value" }, /* @__PURE__ */ h(
          DkSelect,
          {
            value: editor.value.command,
            options: npmCommandOptions,
            size: "sm",
            ariaLabel: t("project.npmCommand"),
            onChange: (value) => patchEditorValue({ command: value })
          }
        ))) : null, editor.value.tool === "npm" && (editor.value.command === "run" || editor.value.command === "run-script") ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.npmScript")), /* @__PURE__ */ h("span", { className: "dk-value" }, scripts.list.length > 0 && !scriptCustom ? /* @__PURE__ */ h(
          DkSelect,
          {
            value: editor.value.script,
            options: scriptOptions,
            size: "sm",
            ariaLabel: t("project.npmScript"),
            onChange: (value) => {
              if (value === SCRIPT_CUSTOM_ID) setScriptCustom(true);
              else patchEditorValue({ script: value });
            }
          }
        ) : /* @__PURE__ */ h(
          "input",
          {
            className: "dk-input",
            value: editor.value.script,
            placeholder: t("project.npmScriptHint"),
            onChange: (event) => patchEditorValue({ script: event.target.value })
          }
        ), /* @__PURE__ */ h(
          "button",
          {
            type: "button",
            className: "dk-icon-btn",
            title: t("project.scriptsLoad"),
            onClick: () => {
              setScriptCustom(false);
              void loadScripts(editor.value);
            }
          },
          /* @__PURE__ */ h(RefreshIcon, null)
        ))) : null, editor.value.tool === "npm" && (editor.value.command === "run" || editor.value.command === "run-script") && scripts.list.length > 0 ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }), /* @__PURE__ */ h("span", { className: "dk-note" }, t("project.scriptsFound", { count: scripts.list.length }))) : null, editor.value.tool === "npm" && (editor.value.command === "run" || editor.value.command === "run-script") && scripts.list.length === 0 ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }), /* @__PURE__ */ h("span", { className: "dk-note" }, scripts.loading ? t("project.scriptsLoading") : scripts.error || (scripts.missing ? t("project.scriptsMissing") : t("project.scriptsEmpty")))) : null, editor.value.tool === "npm" ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.npmArguments")), /* @__PURE__ */ h(
          "input",
          {
            className: "dk-input",
            value: editor.value.arguments,
            placeholder: t("project.argumentsHint"),
            onChange: (event) => patchEditorValue({ arguments: event.target.value })
          }
        )) : null, editor.value.tool === "npm" ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.nodePath")), /* @__PURE__ */ h(
          "input",
          {
            className: "dk-input",
            value: editor.value.nodePath,
            placeholder: t("project.nodePathHint"),
            onChange: (event) => patchEditorValue({ nodePath: event.target.value })
          }
        )) : null, editor.value.tool === "npm" ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.packageManager")), /* @__PURE__ */ h("span", { className: "dk-value" }, /* @__PURE__ */ h(
          DkSelect,
          {
            value: editor.value.packageManager,
            options: packageManagerOptions,
            size: "sm",
            ariaLabel: t("project.packageManager"),
            onChange: (value) => patchEditorValue({ packageManager: value })
          }
        ))) : null, editor.value.tool === "npm" ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.nodeOptions")), /* @__PURE__ */ h(
          "input",
          {
            className: "dk-input",
            value: editor.value.nodeOptions,
            placeholder: t("project.nodeOptionsHint"),
            onChange: (event) => patchEditorValue({ nodeOptions: event.target.value })
          }
        )) : null, editor.value.tool === "maven" ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.mavenPath")), /* @__PURE__ */ h(
          "input",
          {
            className: "dk-input",
            value: editor.value.mavenPath || "",
            placeholder: t("project.mavenPathHint"),
            onChange: (event) => patchEditorValue({ mavenPath: event.target.value })
          }
        )) : null, editor.value.tool === "maven" ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.mavenGoals")), /* @__PURE__ */ h(
          "input",
          {
            className: "dk-input",
            value: editor.value.goals,
            placeholder: t("project.mavenGoalsHint"),
            onChange: (event) => patchEditorValue({ goals: event.target.value })
          }
        )) : null, editor.value.tool === "maven" ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.mavenProfiles")), /* @__PURE__ */ h(
          "input",
          {
            className: "dk-input",
            value: editor.value.profiles,
            placeholder: t("project.mavenProfilesHint"),
            onChange: (event) => patchEditorValue({ profiles: event.target.value })
          }
        )) : null, editor.value.tool === "maven" ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.mavenJvm")), /* @__PURE__ */ h(
          "input",
          {
            className: "dk-input",
            value: editor.value.jvmOptions,
            placeholder: t("project.mavenJvmHint"),
            onChange: (event) => patchEditorValue({ jvmOptions: event.target.value })
          }
        )) : null, editor.value.tool ? /* @__PURE__ */ h("div", { className: "dk-field dk-field-block" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.preBuildEnv")), /* @__PURE__ */ h("div", { className: "dk-rows" }, (editor.value.env || []).map((row, index) => /* @__PURE__ */ h("div", { className: "dk-row-inputs", key: `env-${index}` }, /* @__PURE__ */ h(
          "input",
          {
            className: "dk-input",
            value: row.key,
            placeholder: t("project.keyName"),
            onChange: (event) => patchPreBuildEnv(index, { key: event.target.value })
          }
        ), /* @__PURE__ */ h("div", { className: "dk-multiline" }, /* @__PURE__ */ h(
          "textarea",
          {
            className: "dk-input dk-textarea",
            rows: 2,
            spellCheck: false,
            value: row.value,
            placeholder: t("project.keyValue"),
            onChange: (event) => patchPreBuildEnv(index, { value: event.target.value })
          }
        ), /* @__PURE__ */ h(
          "span",
          {
            className: "dk-env-count",
            "data-over": normalizeEnvValue(row.value).length > PRE_BUILD_ENV_VALUE_MAX ? "1" : "0"
          },
          `${normalizeEnvValue(row.value).length} / ${PRE_BUILD_ENV_VALUE_MAX}`
        )), /* @__PURE__ */ h(
          "button",
          {
            type: "button",
            className: "dk-icon-btn",
            title: t("project.removeRow"),
            onClick: () => removePreBuildEnv(index)
          },
          /* @__PURE__ */ h(CloseIcon, null)
        ))), /* @__PURE__ */ h("div", null, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: addPreBuildEnv }, `+ ${t("project.addRow")}`), /* @__PURE__ */ h("span", { className: "dk-env-count", "data-over": preBuildEnvChars > PRE_BUILD_ENV_TOTAL_MAX ? "1" : "0" }, t("project.preBuildEnvTotalCount", {
          count: preBuildEnvChars,
          max: PRE_BUILD_ENV_TOTAL_MAX
        }))))) : null, editor.value.tool ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("project.preBuildCwd")), /* @__PURE__ */ h(
          "input",
          {
            className: "dk-input",
            value: editor.value.cwd,
            placeholder: t("project.preBuildCwdHint"),
            onChange: (event) => patchEditorValue({ cwd: event.target.value })
          }
        )) : null, !editor.value.tool ? /* @__PURE__ */ h("div", { className: "dk-note" }, t("project.preBuildHint")) : null) : null),
        /* @__PURE__ */ h("div", { className: "dk-subdialog-foot" }, /* @__PURE__ */ h("span", { className: "dk-head-spacer" }), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => setEditor(null) }, t("project.configCancel")), /* @__PURE__ */ h(Btn, { size: "sm", variant: "primary", onClick: applyEditor }, t("project.configApply")))
      )
    ) : null
  );
}

// src/panel/overview.jsx
var formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
};
function ConnectionCard({ t, rpc, notify, onSaved, title }) {
  const React = getReact();
  const [form, setForm] = React.useState({ cliPath: "", dockerHost: "", context: "" });
  const [detect, setDetect] = React.useState({ status: "idle", data: null, error: "" });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [loaded, setLoaded] = React.useState(false);
  const applySaved = React.useCallback((saved) => {
    setForm({
      cliPath: String(saved?.cliPath || ""),
      dockerHost: String(saved?.dockerHost || ""),
      context: String(saved?.context || "")
    });
  }, []);
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await rpc.settings();
        if (!alive) return;
        applySaved(saved);
        setLoaded(true);
      } catch (cause) {
        if (alive) setError(String(cause?.message || cause));
      }
    })();
    return () => {
      alive = false;
    };
  }, [rpc, applySaved]);
  const runDetect = React.useCallback(async () => {
    setDetect({ status: "loading", data: null, error: "" });
    try {
      const data = await rpc.detect();
      setDetect({ status: "ready", data, error: "" });
    } catch (cause) {
      setDetect({ status: "error", data: null, error: String(cause?.message || cause) });
    }
  }, [rpc]);
  React.useEffect(() => {
    void runDetect();
  }, [runDetect]);
  const buildPayload = () => ({ ...form });
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const saved = await rpc.saveSettings(buildPayload());
      applySaved(saved);
      await runDetect();
      onSaved?.();
      notify("success", t("conn.saved"));
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setSaving(false);
    }
  };
  const contexts = detect.data?.contexts || [];
  const contextOptions = [
    { value: "", label: t("conn.contextDefault") },
    ...contexts.map((item) => ({
      value: item.name,
      label: item.current ? `${item.name} (${t("conn.current")})` : item.name
    }))
  ];
  return /* @__PURE__ */ h("div", { className: "dk-card" }, /* @__PURE__ */ h("div", { className: "dk-card-title" }, /* @__PURE__ */ h("span", null, title || t("conn.title")), /* @__PURE__ */ h("span", { className: "dk-pill" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: detect.status === "loading", onClick: () => void runDetect() }, detect.status === "loading" ? t("conn.detecting") : t("conn.detect")))), !loaded ? /* @__PURE__ */ h(Loading, { text: t("status.checking") }) : null, loaded ? /* @__PURE__ */ h("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } }, /* @__PURE__ */ h("label", { style: { display: "flex", flexDirection: "column", gap: "3px" } }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("conn.cliPath")), /* @__PURE__ */ h(
    "input",
    {
      className: "dk-input",
      value: form.cliPath,
      placeholder: "docker",
      onChange: (event) => setForm((prev) => ({ ...prev, cliPath: event.target.value }))
    }
  )), /* @__PURE__ */ h("label", { style: { display: "flex", flexDirection: "column", gap: "3px" } }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("conn.dockerHost")), /* @__PURE__ */ h(
    "input",
    {
      className: "dk-input",
      value: form.dockerHost,
      placeholder: "npipe:////./pipe/docker_engine",
      onChange: (event) => setForm((prev) => ({ ...prev, dockerHost: event.target.value }))
    }
  )), /* @__PURE__ */ h("div", { style: { display: "flex", flexDirection: "column", gap: "3px" } }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("conn.context")), /* @__PURE__ */ h(
    DkSelect,
    {
      value: form.context,
      options: contextOptions,
      onChange: (next) => setForm((prev) => ({ ...prev, context: next })),
      ariaLabel: t("conn.context")
    }
  )), /* @__PURE__ */ h("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "primary", disabled: saving, onClick: () => void save() }, saving ? t("conn.saving") : t("conn.save")), error ? /* @__PURE__ */ h("span", { className: "dk-inline-error" }, error) : null)) : null, detect.status === "error" ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, detect.error) : null, detect.data ? /* @__PURE__ */ h("div", { className: "dk-kv", style: { marginTop: "8px" } }, /* @__PURE__ */ h(Field, { label: t("conn.cliFound"), value: detect.data.cli?.found ? detect.data.cli.version || t("conn.yes") : t("conn.no") }), /* @__PURE__ */ h(Field, { label: t("conn.cliUsed"), value: detect.data.cli?.bin }), /* @__PURE__ */ h(Field, { label: t("conn.envHost"), value: detect.data.env?.dockerHost }), /* @__PURE__ */ h(Field, { label: t("conn.envContext"), value: detect.data.env?.dockerContext }), /* @__PURE__ */ h(
    Field,
    {
      label: t("conn.contexts"),
      value: contexts.length ? contexts.map((item) => item.name).join(", ") : t("overview.none")
    }
  )) : null, detect.data?.cli?.error ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, detect.data.cli.error) : null);
}
function OverviewView({ t, rpc, notify, system, loading, error, onRetry, targetKind }) {
  if (error) {
    return /* @__PURE__ */ h("div", { className: "dk-body" }, /* @__PURE__ */ h(ErrorBox, { title: t("error.title"), message: error }));
  }
  if (!system) {
    return /* @__PURE__ */ h("div", { className: "dk-body" }, loading ? /* @__PURE__ */ h(Loading, { text: t("status.checking") }) : /* @__PURE__ */ h(EmptyState, { title: t("error.title") }));
  }
  const { cli, daemon, disk, compose } = system;
  const containersText = daemon.containers?.running !== null && daemon.containers?.total !== null ? `${daemon.containers.running} / ${daemon.containers.total}` : "";
  return /* @__PURE__ */ h("div", { className: "dk-body" }, /* @__PURE__ */ h("div", { className: "dk-overview" }, /* @__PURE__ */ h("div", { className: "dk-card" }, /* @__PURE__ */ h("div", { className: "dk-card-title" }, /* @__PURE__ */ h("span", null, t("overview.daemon"), system.target?.label ? ` · ${system.target.label}` : ""), /* @__PURE__ */ h("span", { className: "dk-pill" }, /* @__PURE__ */ h("span", { className: "dk-dot", "data-tone": daemon.online ? "ok" : "bad" }), daemon.online ? t("status.online") : t("status.daemonOffline"))), /* @__PURE__ */ h("div", { className: "dk-kv" }, /* @__PURE__ */ h(Field, { label: t("overview.version"), value: daemon.version }), /* @__PURE__ */ h(Field, { label: t("overview.apiVersion"), value: daemon.apiVersion }), /* @__PURE__ */ h(Field, { label: t("overview.os"), value: daemon.operatingSystem }), /* @__PURE__ */ h(Field, { label: t("overview.arch"), value: daemon.architecture }), /* @__PURE__ */ h(Field, { label: t("overview.cpus"), value: daemon.cpus }), /* @__PURE__ */ h(Field, { label: t("overview.memory"), value: formatBytes(daemon.memoryBytes) }), /* @__PURE__ */ h(Field, { label: t("overview.driver"), value: daemon.driver }), /* @__PURE__ */ h(Field, { label: t("overview.containers"), value: containersText }), /* @__PURE__ */ h(Field, { label: t("overview.images"), value: daemon.images }), /* @__PURE__ */ h(Field, { label: t("overview.rootDir"), value: daemon.rootDir })), daemon.error ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, daemon.error) : null, !daemon.online && onRetry ? /* @__PURE__ */ h("div", { style: { marginTop: "8px", display: "flex", alignItems: "center", gap: "8px" } }, /* @__PURE__ */ h(Btn, { size: "sm", onClick: onRetry }, t("action.retry")), /* @__PURE__ */ h("span", { className: "dk-meta" }, t("conn.autoRetry"))) : null), /* @__PURE__ */ h("div", { className: "dk-card" }, /* @__PURE__ */ h("div", { className: "dk-card-title" }, /* @__PURE__ */ h("span", null, t("overview.target"))), /* @__PURE__ */ h("div", { className: "dk-kv" }, /* @__PURE__ */ h(Field, { label: t("target.label"), value: system.target?.label || "" }), /* @__PURE__ */ h(Field, { label: t("overview.cli"), value: system.cli?.bin || "" })), /* @__PURE__ */ h("div", { className: "dk-meta", style: { marginTop: "6px" } }, t("overview.remoteHint"))), /* @__PURE__ */ h("div", { className: "dk-card" }, /* @__PURE__ */ h("div", { className: "dk-card-title" }, /* @__PURE__ */ h("span", null, t("overview.cli")), /* @__PURE__ */ h("span", { className: "dk-pill" }, /* @__PURE__ */ h("span", { className: "dk-dot", "data-tone": cli.available ? "ok" : "bad" }), cli.available ? t("overview.version") : t("status.cliMissing"))), /* @__PURE__ */ h("div", { className: "dk-kv" }, /* @__PURE__ */ h(Field, { label: t("overview.version"), value: cli.version }), /* @__PURE__ */ h(Field, { label: t("overview.apiVersion"), value: cli.apiVersion }), /* @__PURE__ */ h(Field, { label: t("overview.os"), value: cli.os }), /* @__PURE__ */ h(Field, { label: t("overview.arch"), value: cli.arch })), cli.error ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, cli.error) : null), disk?.length ? /* @__PURE__ */ h("div", { className: "dk-card" }, /* @__PURE__ */ h("div", { className: "dk-card-title" }, /* @__PURE__ */ h("span", null, t("overview.disk"))), /* @__PURE__ */ h("div", { className: "dk-kv" }, disk.map((row) => /* @__PURE__ */ h(
    Field,
    {
      key: `${row.Type}-${row.TotalCount}`,
      label: row.Type,
      value: `${row.Size || ""} · ${row.Reclaimable || ""} ${t("overview.reclaimable")}`
    }
  )))) : null, /* @__PURE__ */ h("div", { className: "dk-card" }, /* @__PURE__ */ h("div", { className: "dk-card-title" }, /* @__PURE__ */ h("span", null, t("overview.compose"))), compose?.length ? /* @__PURE__ */ h("div", { className: "dk-kv" }, compose.map((item) => /* @__PURE__ */ h(Field, { key: item.Name, label: item.Name, value: item.Status }))) : /* @__PURE__ */ h("div", { className: "dk-meta" }, t("overview.none")))));
}

// src/panel/project.jsx
var MAX_LOG_LINES3 = 800;
var SSH_REFRESH_MS = 15e3;
var CONFIRM_MS2 = 4e3;
var stateTone = (state) => {
  const text = String(state || "").toLowerCase();
  if (text.includes("running") || text === "up") return "ok";
  if (text.includes("exited") || text.includes("stop")) return "muted";
  if (text.includes("restarting") || text.includes("pending")) return "warn";
  if (text.includes("dead") || text.includes("error")) return "bad";
  return "muted";
};
function ProjectView({ t, rpc, notify, project, onOpenFile, active }) {
  const React = getReact();
  const [scan, setScan] = React.useState({ status: "idle", data: null, error: "" });
  const [runConfigSummaries, setRunConfigSummaries] = React.useState({});
  const [servers, setServers] = React.useState([]);
  const [dialog, setDialog] = React.useState({ open: false, path: "" });
  const [compose, setCompose] = React.useState({});
  const [task, setTask] = React.useState(null);
  const [busy, setBusy] = React.useState("");
  const [confirmDown, setConfirmDown] = React.useState("");
  const taskCursor = React.useRef({ id: "", offset: 0 });
  const root = project?.path || "";
  const remote = project?.kind === "ssh";
  const canScan = Boolean(root) && !remote;
  const projectName = project?.name || "";
  const rescan = React.useCallback(async () => {
    if (!canScan) return;
    setScan((prev) => ({ status: "loading", data: prev.data, error: "" }));
    try {
      const data = await rpc.scanProject(root);
      setScan({ status: "ready", data, error: "" });
      setRunConfigSummaries(
        data?.runConfigSummaries && typeof data.runConfigSummaries === "object" ? data.runConfigSummaries : {}
      );
    } catch (error) {
      setScan({ status: "error", data: null, error: String(error?.message || error) });
    }
  }, [canScan, root, rpc]);
  const loadProjectConfig = React.useCallback((path) => rpc.readProjectConfig(path), [rpc]);
  const refreshServers = React.useCallback(async () => {
    try {
      const data = await rpc.sshStatus();
      setServers(Array.isArray(data?.servers) ? data.servers : []);
    } catch {
    }
  }, [rpc]);
  React.useEffect(() => {
    setDialog({ open: false, path: "" });
    setCompose({});
    setTask(null);
    setConfirmDown("");
    taskCursor.current = { id: "", offset: 0 };
    void rescan();
  }, [root, rescan]);
  React.useEffect(() => {
    if (!confirmDown) return void 0;
    const timer = setTimeout(() => setConfirmDown(""), CONFIRM_MS2);
    return () => clearTimeout(timer);
  }, [confirmDown]);
  React.useEffect(() => {
    void refreshServers();
  }, [refreshServers]);
  React.useEffect(() => {
    if (active === false) return void 0;
    const timer = setInterval(() => void refreshServers(), SSH_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, refreshServers]);
  const loadCompose = React.useCallback(
    async (file) => {
      setCompose((prev) => ({ ...prev, [file]: { status: "loading", names: [], services: [], error: "" } }));
      try {
        const data = await rpc.composeServices(file);
        setCompose((prev) => ({
          ...prev,
          [file]: {
            status: "ready",
            names: Array.isArray(data?.names) ? data.names : [],
            services: Array.isArray(data?.services) ? data.services : [],
            error: data?.error || "",
            // compose 只在本机执行：本机 docker 不可用时禁用按钮并展示原因。
            local: {
              available: data?.local?.available !== false,
              error: data?.local?.available === false ? String(data.local.error || "") : ""
            }
          }
        }));
      } catch (error) {
        setCompose((prev) => ({
          ...prev,
          [file]: { status: "error", names: [], services: [], error: String(error?.message || error) }
        }));
      }
    },
    [rpc]
  );
  React.useEffect(() => {
    const files = scan.data?.composeFiles || [];
    for (const file of files.slice(0, 5)) {
      if (!compose[file.path]) void loadCompose(file.path);
    }
  }, [scan.data, compose, loadCompose]);
  const acceptTask = React.useCallback((payload, kind, title) => {
    taskCursor.current = { id: payload.taskId, offset: 0 };
    setTask({
      id: payload.taskId,
      kind,
      title,
      status: "running",
      lines: [],
      error: "",
      exitCode: null,
      truncated: false
    });
  }, []);
  React.useEffect(() => {
    if (!task?.id || task.status !== "running") return void 0;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await rpc.task(task.id, taskCursor.current.offset);
        if (cancelled || !data) return;
        taskCursor.current.offset = Number.isFinite(data.nextOffset) ? data.nextOffset : taskCursor.current.offset;
        setTask((prev) => {
          if (!prev || prev.id !== data.id) return prev;
          const merged = [...prev.lines, ...Array.isArray(data.lines) ? data.lines : []];
          return {
            ...prev,
            status: data.status,
            exitCode: data.exitCode ?? null,
            error: data.error || "",
            lines: merged.slice(-MAX_LOG_LINES3),
            truncated: prev.truncated || data.truncated === true
          };
        });
      } catch (error) {
        if (!cancelled) setTask((prev) => prev ? { ...prev, status: "failed", error: String(error?.message || error) } : prev);
      }
    };
    const timer = setInterval(() => void tick(), 1e3);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [task?.id, task?.status, rpc]);
  React.useEffect(() => {
    if (!task || task.status !== "succeeded") return;
    if (!task.kind.startsWith("compose-")) return;
    const file = String(task.title || "").split(" ")[0];
    for (const item of scan.data?.composeFiles || []) {
      if (baseName(item.path) === file) void loadCompose(item.path);
    }
  }, [task, scan.data, loadCompose]);
  const startBuildRun = async (file, config) => {
    const saved = config || (await loadProjectConfig(file.path))?.config || {};
    const tag = String(saved.tag || "").trim() || suggestTag(projectName, file);
    const payload = await rpc.buildAndRun({
      dockerfile: file.path,
      tag,
      context: saved.context || "",
      platform: saved.platform || "",
      noCache: saved.noCache === true,
      pull: saved.pull === true,
      buildArgs: Array.isArray(saved.buildArgs) ? saved.buildArgs : [],
      serverId: saved.serverId || "",
      preBuild: saved.preBuild || null,
      config: saved
    });
    acceptTask(payload, "build-run", saved.containerName || tag);
    notify("info", t("project.buildRunStarted", { tag }));
  };
  const buildRunFromCard = async (file) => {
    setBusy(`${file.path}:build-run`);
    try {
      await startBuildRun(file);
    } catch (error) {
      notify("error", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  const openDialog = (path) => {
    const files = scan.data?.dockerfiles || [];
    setDialog({ open: true, path: path || files[0]?.path || "" });
  };
  const saveConfig = async (path, config, previousPath) => {
    const result = await rpc.saveProjectConfig(path, config, false, root);
    if (result?.summary) {
      setRunConfigSummaries((prev) => ({ ...prev, [path]: result.summary }));
    }
    if (previousPath && previousPath !== path) {
      try {
        await rpc.removeProjectConfig(previousPath);
        setRunConfigSummaries((prev) => {
          const next = { ...prev };
          delete next[previousPath];
          return next;
        });
      } catch {
      }
      await rescan();
    }
    notify("success", t("project.configSaved"));
  };
  const removeConfig = async (path) => {
    await rpc.removeProjectConfig(path);
    setRunConfigSummaries((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    notify("success", t("project.configDeleted"));
    const target = (scan.data?.dockerfiles || []).find((file) => file.path === path);
    if (target?.manual) await rescan();
  };
  const addDockerfile = async (path) => {
    const name = baseName(path);
    const file = { path, relative: name, name, depth: 0 };
    await rpc.saveProjectConfig(toPosix(path), { name, tag: suggestTag(projectName, file) }, true, root);
    await rescan();
  };
  const runCompose = async (file, action) => {
    if (action === "down") {
      const key = `${file}:down`;
      if (confirmDown !== key) {
        setConfirmDown(key);
        return;
      }
      setConfirmDown("");
    }
    setBusy(`${file}:${action}`);
    try {
      const payload = await rpc.composeAction(file, action);
      acceptTask(payload, `compose-${action}`, `${baseName(file)} ${action}`);
      notify("info", t("project.composeStarted", { action }));
    } catch (error) {
      notify("error", String(error?.message || error));
    } finally {
      setBusy("");
    }
  };
  if (!root) {
    return /* @__PURE__ */ h("div", { className: "dk-body" }, /* @__PURE__ */ h(EmptyState, { title: t("project.noProject"), hint: t("project.noProjectHint") }));
  }
  if (remote) {
    return /* @__PURE__ */ h("div", { className: "dk-body" }, /* @__PURE__ */ h(EmptyState, { title: t("project.remoteUnsupported"), hint: root }));
  }
  const dockerfiles = scan.data?.dockerfiles || [];
  const composeFiles = scan.data?.composeFiles || [];
  return /* @__PURE__ */ h("div", { className: "dk-body" }, /* @__PURE__ */ h("div", { className: "dk-toolbar", style: { paddingBottom: "4px" } }, /* @__PURE__ */ h("span", { className: "dk-meta", title: root, style: { flex: "1 1 auto", minWidth: 0 } }, projectName ? `${projectName} · ` : "", root), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: scan.status === "loading", onClick: () => openDialog("") }, t("project.runConfigs")), /* @__PURE__ */ h(Btn, { size: "sm", disabled: scan.status === "loading", onClick: () => void rescan() }, t("project.rescan"))), /* @__PURE__ */ h("div", { style: { padding: "0 10px 8px" } }, /* @__PURE__ */ h(
    TaskLog,
    {
      t,
      task,
      onCancel: () => {
        void rpc.cancelTask(task.id).catch(() => {
        });
      },
      onClear: () => setTask(null)
    }
  )), /* @__PURE__ */ h("div", { className: "dk-list", style: { paddingBottom: "8px" } }, dockerfiles.length ? /* @__PURE__ */ h("div", { className: "dk-card" }, /* @__PURE__ */ h("div", { className: "dk-card-title" }, /* @__PURE__ */ h("span", null, t("project.dockerfiles")), /* @__PURE__ */ h("span", { className: "dk-pill" }, dockerfiles.length)), dockerfiles.map((file) => {
    const config = runConfigSummaries[file.path] || null;
    const server = config?.serverId ? servers.find((item) => item.id === config.serverId) : null;
    const meta = [
      config?.tag || suggestTag(projectName, file),
      config?.platform || "",
      server ? `${t("project.configServer")} ${server.name || server.host}` : ""
    ].filter(Boolean).join(" · ");
    return /* @__PURE__ */ h("div", { key: file.path, style: { padding: "6px 0", borderTop: "1px solid var(--dk-border)" } }, /* @__PURE__ */ h("div", { className: "dk-row-title", style: { flexWrap: "wrap", rowGap: "4px" } }, /* @__PURE__ */ h("span", { className: "dk-name", title: file.path }, config?.name || file.relative), file.manual ? /* @__PURE__ */ h("span", { className: "dk-badge", "data-tone": "muted" }, t("project.manual")) : null, file.missing ? /* @__PURE__ */ h("span", { className: "dk-badge", "data-tone": "bad" }, t("project.missing")) : null, config ? /* @__PURE__ */ h("span", { className: "dk-badge", "data-tone": "ok", title: t("project.configuredHint") }, t("project.configured")) : null, /* @__PURE__ */ h("span", { className: "dk-head-spacer" }), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => onOpenFile?.(file.path) }, t("project.openFile")), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => openDialog(file.path) }, t("project.config")), /* @__PURE__ */ h(
      Btn,
      {
        size: "sm",
        variant: "primary",
        disabled: busy === `${file.path}:build-run` || file.missing || task?.status === "running",
        onClick: () => void buildRunFromCard(file)
      },
      busy === `${file.path}:build-run` ? t("project.building") : t("project.buildRun")
    )), /* @__PURE__ */ h("div", { className: "dk-meta", title: file.relative, style: { marginTop: "2px" } }, file.relative, ` · ${meta}`));
  })) : null), /* @__PURE__ */ h("div", { style: { padding: "0 10px 8px" } }, /* @__PURE__ */ h(
    ConnectionCard,
    {
      t,
      rpc,
      notify,
      title: t("project.localDocker"),
      onSaved: () => setCompose({})
    }
  )), scan.status === "loading" ? /* @__PURE__ */ h(Loading, { text: t("project.scanning") }) : null, scan.status === "error" ? /* @__PURE__ */ h("div", { className: "dk-inline-error", style: { padding: "0 10px 8px" } }, scan.error) : null, scan.status === "ready" && dockerfiles.length === 0 && composeFiles.length === 0 ? /* @__PURE__ */ h(EmptyState, { title: t("project.empty"), hint: t("project.emptyHint") }) : null, /* @__PURE__ */ h("div", { className: "dk-list" }, composeFiles.map((file) => {
    const info = compose[file.path];
    const localBlocked = info?.local?.available === false;
    return /* @__PURE__ */ h("div", { className: "dk-card", key: file.path }, /* @__PURE__ */ h("div", { className: "dk-card-title" }, /* @__PURE__ */ h("span", { className: "dk-name", title: file.path }, file.relative), /* @__PURE__ */ h("span", { className: "dk-badge", "data-tone": "muted", title: t("project.composeLocalHint") }, t("project.composeLocal")), /* @__PURE__ */ h("span", { className: "dk-pill" }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => onOpenFile?.(file.path) }, t("project.openFile")))), /* @__PURE__ */ h("div", { className: "dk-actionbar", style: { marginBottom: "6px" } }, /* @__PURE__ */ h(
      Btn,
      {
        size: "sm",
        variant: "primary",
        disabled: Boolean(busy) || task?.status === "running" || localBlocked,
        onClick: () => void runCompose(file.path, "up")
      },
      t("project.composeUp")
    ), /* @__PURE__ */ h(
      Btn,
      {
        size: "sm",
        disabled: Boolean(busy) || task?.status === "running" || localBlocked,
        onClick: () => void runCompose(file.path, "stop")
      },
      t("project.composeStop")
    ), /* @__PURE__ */ h(
      Btn,
      {
        size: "sm",
        disabled: Boolean(busy) || task?.status === "running" || localBlocked,
        onClick: () => void runCompose(file.path, "restart")
      },
      t("project.composeRestart")
    ), /* @__PURE__ */ h(
      Btn,
      {
        size: "sm",
        variant: "danger",
        disabled: Boolean(busy) || task?.status === "running" || localBlocked,
        onClick: () => void runCompose(file.path, "down")
      },
      confirmDown === `${file.path}:down` ? t("project.composeDownConfirm") : t("project.composeDown")
    )), info?.status === "loading" ? /* @__PURE__ */ h(Loading, { text: t("project.loadingServices") }) : null, info?.error ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, info.error) : null, localBlocked ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, t("project.composeLocalUnavailable"), info?.local?.error ? ` · ${info.local.error}` : "") : null, info?.services?.length ? /* @__PURE__ */ h("div", { className: "dk-kv" }, info.services.map((service) => /* @__PURE__ */ h(Field2, { key: service.service || service.name, label: service.service || service.name, value: `${service.state}${service.health ? ` · ${service.health}` : ""}`, tone: stateTone(service.state) }))) : null, info?.status === "ready" && !info.services.length && info.names.length ? /* @__PURE__ */ h("div", { className: "dk-chips" }, info.names.map((name) => /* @__PURE__ */ h("span", { className: "dk-chip", key: name }, name))) : null, info?.status === "ready" && !info.services.length && !info.names.length && !info.error ? /* @__PURE__ */ h("div", { className: "dk-meta" }, t("project.noServices")) : null);
  })), scan.data?.truncated ? /* @__PURE__ */ h("div", { className: "dk-meta", style: { padding: "0 10px 10px" } }, t("project.truncated")) : null, dialog.open ? /* @__PURE__ */ h(
    ConfigDialog,
    {
      t,
      files: dockerfiles,
      runConfigSummaries,
      onLoadConfig: loadProjectConfig,
      servers,
      projectName,
      projectRoot: scan.data?.root || "",
      initialPath: dialog.path,
      onSave: saveConfig,
      onRemove: removeConfig,
      onAdd: addDockerfile,
      onLoadScripts: (path, dir) => rpc.packageScripts(path, dir),
      onClose: () => setDialog({ open: false, path: "" })
    }
  ) : null);
}
function Field2({ label, value, tone }) {
  return [
    /* @__PURE__ */ h("span", { key: "k", className: "dk-kv-key" }, label),
    /* @__PURE__ */ h("span", { key: "v", className: "dk-kv-value" }, tone ? /* @__PURE__ */ h("span", { className: "dk-badge", "data-tone": tone, style: { marginRight: "5px" } }, value) : value)
  ];
}

// src/panel/ssh.jsx
var DEFAULT_DOCKER_PATH = "docker";
var STATUS_POLL_MS = 8e3;
var CONFIRM_MS3 = 4e3;
var STATUS_TONE2 = {
  idle: "muted",
  connecting: "warn",
  connected: "ok",
  closed: "warn",
  error: "bad"
};
var emptyForm = () => ({
  id: "",
  name: "",
  host: "",
  port: 22,
  username: "",
  password: "",
  dockerPath: DEFAULT_DOCKER_PATH,
  hostKey: ""
});
var formatClock = (value) => {
  const stamp = Number(value);
  if (!Number.isFinite(stamp) || stamp <= 0) return "";
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
var serverLabel2 = (item) => item.name || `${item.username || "root"}@${item.host || ""}`;
function SshView({ t, rpc, notify }) {
  const React = getReact();
  const [servers, setServers] = React.useState([]);
  const [currentId, setCurrentId] = React.useState("");
  const [session, setSession] = React.useState({ status: "idle", id: "", docker: null, error: null, connectedAt: null });
  const [form, setForm] = React.useState(emptyForm);
  const [hasPassword, setHasPassword] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [test, setTest] = React.useState({ status: "idle", message: "", error: "" });
  const [confirmId, setConfirmId] = React.useState("");
  const [hostKeyConfirm, setHostKeyConfirm] = React.useState(false);
  const [passwordConfirm, setPasswordConfirm] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const aliveRef = React.useRef(true);
  const formRef = React.useRef(null);
  const applyStatus = React.useCallback((payload) => {
    setServers(Array.isArray(payload?.servers) ? payload.servers : []);
    setCurrentId(String(payload?.currentId || ""));
    setSession({
      status: payload?.status || "idle",
      id: String(payload?.id || ""),
      docker: payload?.docker || null,
      error: payload?.error || null,
      connectedAt: payload?.connectedAt || null
    });
  }, []);
  const applyServers = React.useCallback((payload) => {
    setServers(Array.isArray(payload?.servers) ? payload.servers : []);
    setCurrentId(String(payload?.currentId || ""));
  }, []);
  const selectServer = React.useCallback((item) => {
    setForm({
      id: item.id || "",
      name: item.name || "",
      host: item.host || "",
      port: item.port || 22,
      username: item.username || "",
      password: "",
      dockerPath: item.dockerPath || DEFAULT_DOCKER_PATH,
      hostKey: item.hostKey || ""
    });
    setHasPassword(item.hasPassword === true);
    setTest({ status: "idle", message: "", error: "" });
    setError("");
    setHostKeyConfirm(false);
    setPasswordConfirm(false);
  }, []);
  const editServer = React.useCallback(
    (item) => {
      selectServer(item);
      setEditing(item.id || "new");
    },
    [selectServer]
  );
  const startNew = React.useCallback(() => {
    setForm(emptyForm());
    setHasPassword(false);
    setTest({ status: "idle", message: "", error: "" });
    setError("");
    setHostKeyConfirm(false);
    setPasswordConfirm(false);
    setEditing("new");
  }, []);
  const closeForm = React.useCallback(() => {
    setEditing(null);
    setForm(emptyForm());
    setHasPassword(false);
    setTest({ status: "idle", message: "", error: "" });
    setError("");
    setHostKeyConfirm(false);
    setPasswordConfirm(false);
  }, []);
  React.useEffect(() => {
    if (!editing) return;
    const node = formRef.current;
    if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
  }, [editing]);
  React.useEffect(() => {
    aliveRef.current = true;
    (async () => {
      try {
        const data = await rpc.sshStatus();
        if (!aliveRef.current) return;
        applyStatus(data);
        setLoaded(true);
      } catch (cause) {
        if (aliveRef.current) {
          setError(String(cause?.message || cause));
          setLoaded(true);
        }
      }
    })();
    return () => {
      aliveRef.current = false;
    };
  }, [rpc, applyStatus]);
  React.useEffect(() => {
    const tick = async () => {
      try {
        const data = await rpc.sshStatus();
        if (aliveRef.current) applyStatus(data);
      } catch {
      }
    };
    const timer = setInterval(() => void tick(), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [rpc, applyStatus]);
  React.useEffect(() => {
    if (!confirmId) return void 0;
    const timer = setTimeout(() => setConfirmId(""), CONFIRM_MS3);
    return () => clearTimeout(timer);
  }, [confirmId]);
  React.useEffect(() => {
    if (!hostKeyConfirm) return void 0;
    const timer = setTimeout(() => setHostKeyConfirm(false), CONFIRM_MS3);
    return () => clearTimeout(timer);
  }, [hostKeyConfirm]);
  React.useEffect(() => {
    if (!passwordConfirm) return void 0;
    const timer = setTimeout(() => setPasswordConfirm(false), CONFIRM_MS3);
    return () => clearTimeout(timer);
  }, [passwordConfirm]);
  const connected = session.status === "connected";
  const connectedHere = connected && session.id === form.id && Boolean(form.id);
  const buildServer = () => ({
    id: form.id || void 0,
    name: form.name.trim(),
    host: form.host.trim(),
    port: Number(form.port) || 22,
    username: form.username.trim(),
    dockerPath: form.dockerPath.trim() || DEFAULT_DOCKER_PATH
  });
  const canSubmit = Boolean(form.host.trim() && form.username.trim());
  const save = async () => {
    const payload = { server: buildServer() };
    if (form.password) payload.password = form.password;
    const data = await rpc.sshSave(payload);
    applyServers(data);
    const savedId = data?.savedId || form.id;
    const item = (data?.servers || []).find((row) => row.id === savedId);
    if (item) selectServer(item);
    setEditing(savedId || "new");
    return { savedId, passwordSaved: data?.passwordSaved !== false };
  };
  const saveOnly = async () => {
    setBusy("save");
    setError("");
    try {
      const { passwordSaved } = await save();
      if (passwordSaved) notify("success", t("ssh.saved"));
      else notify("warn", t("ssh.passwordNotSaved"));
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };
  const connectServer = async (id) => {
    setBusy("connect");
    setError("");
    setTest({ status: "idle", message: "", error: "" });
    try {
      await rpc.sshConnect(id);
      const data = await rpc.sshStatus();
      if (aliveRef.current) {
        applyStatus(data);
        const item = (data?.servers || []).find((row) => row.id === id);
        if (item) setForm((prev) => prev.id === id ? { ...prev, hostKey: item.hostKey || "" } : prev);
      }
      notify("success", t("ssh.connected"));
    } catch (cause) {
      const message = String(cause?.message || cause);
      setError(message);
      setSession((prev) => ({ ...prev, status: "error", error: message }));
    } finally {
      setBusy("");
    }
  };
  const saveAndConnect = async () => {
    setBusy("connect");
    setError("");
    setTest({ status: "idle", message: "", error: "" });
    try {
      const { savedId, passwordSaved } = await save();
      if (!savedId) throw new Error(t("ssh.saveFirst"));
      if (!passwordSaved) {
        setError(t("ssh.passwordNotSaved"));
        setBusy("");
        return;
      }
      await connectServer(savedId);
    } catch (cause) {
      setError(String(cause?.message || cause));
      setBusy("");
    }
  };
  const disconnect = async () => {
    setBusy("disconnect");
    setError("");
    try {
      await rpc.sshDisconnect();
      const data = await rpc.sshStatus();
      if (aliveRef.current) applyStatus(data);
      notify("success", t("ssh.disconnected"));
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };
  const remove = async (item) => {
    if (confirmId !== item.id) {
      setConfirmId(item.id);
      return;
    }
    setConfirmId("");
    setBusy(`remove:${item.id}`);
    setError("");
    try {
      const data = await rpc.sshRemove(item.id);
      applyServers(data);
      if (editing === item.id || form.id === item.id) {
        const remaining = Array.isArray(data?.servers) ? data.servers : [];
        if (remaining.length) editServer(remaining[0]);
        else closeForm();
      }
      notify("success", t("ssh.removed"));
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };
  const runTest = async () => {
    setBusy("test");
    setError("");
    setTest({ status: "loading", message: "", error: "" });
    try {
      const payload = { ...buildServer() };
      if (!payload.id) delete payload.id;
      if (form.password) payload.password = form.password;
      const result = await rpc.sshTest(payload);
      const docker = result?.docker || {};
      if (docker.ok) {
        setTest({ status: "ok", message: t("ssh.testOk", { version: docker.version || "" }), error: "" });
      } else {
        setTest({ status: "error", message: "", error: docker.error || t("ssh.dockerUnavailable") });
      }
    } catch (cause) {
      setTest({ status: "error", message: "", error: String(cause?.message || cause) });
    } finally {
      setBusy("");
    }
  };
  const resetHostKey = async () => {
    if (!form.id) return;
    if (!hostKeyConfirm) {
      setHostKeyConfirm(true);
      return;
    }
    setHostKeyConfirm(false);
    setBusy("hostkey");
    setError("");
    try {
      const data = await rpc.sshSave({ server: buildServer(), resetHostKey: true });
      applyServers(data);
      const savedId = data?.savedId || form.id;
      const item = (data?.servers || []).find((row) => row.id === savedId);
      if (item) selectServer(item);
      notify("success", t("ssh.hostKeyResetDone"));
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };
  const clearPassword = async () => {
    if (!form.id) return;
    if (!passwordConfirm) {
      setPasswordConfirm(true);
      return;
    }
    setPasswordConfirm(false);
    setBusy("password");
    setError("");
    try {
      const data = await rpc.sshSave({ server: buildServer(), clearPassword: true });
      applyServers(data);
      const savedId = data?.savedId || form.id;
      const item = (data?.servers || []).find((row) => row.id === savedId);
      if (item) selectServer(item);
      if (data?.passwordCleared === false) notify("warn", t("ssh.clearPasswordFailed"));
      else notify("success", t("ssh.clearPasswordDone"));
    } catch (cause) {
      setError(String(cause?.message || cause));
    } finally {
      setBusy("");
    }
  };
  const statusTone = STATUS_TONE2[session.status] || "muted";
  const statusText = session.status === "connecting" ? t("ssh.statusConnecting") : session.status === "connected" ? t("ssh.statusConnected") : session.status === "error" ? t("ssh.statusError") : session.status === "closed" ? t("ssh.statusClosed") : t("ssh.statusIdle");
  const connectedName = servers.find((item) => item.id === session.id);
  const lastUsedName = currentId && currentId !== form.id ? serverLabel2(servers.find((item) => item.id === currentId) || {}) : "";
  return /* @__PURE__ */ h("div", { className: "dk-body" }, /* @__PURE__ */ h("div", { className: "dk-overview" }, /* @__PURE__ */ h("div", { className: "dk-card" }, /* @__PURE__ */ h("div", { className: "dk-card-title" }, /* @__PURE__ */ h("span", null, t("ssh.servers")), /* @__PURE__ */ h("span", { className: "dk-pill" }, /* @__PURE__ */ h("span", { className: "dk-dot", "data-tone": statusTone }), connected ? `${statusText}${connectedName ? ` · ${serverLabel2(connectedName)}` : ""}` : statusText)), !loaded ? /* @__PURE__ */ h(Loading, { text: t("status.checking") }) : null, loaded && servers.length === 0 ? /* @__PURE__ */ h(EmptyState, { title: t("ssh.empty"), hint: t("ssh.emptyHint") }) : null, servers.length ? /* @__PURE__ */ h("div", { className: "dk-ssh-rows" }, servers.map((item) => {
    const active = editing === item.id;
    const live = connected && session.id === item.id;
    return /* @__PURE__ */ h(
      "div",
      {
        key: item.id,
        className: "dk-ssh-row",
        "data-active": active ? "1" : "0",
        role: "button",
        tabIndex: 0,
        onClick: () => editServer(item),
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            editServer(item);
          }
        }
      },
      /* @__PURE__ */ h("span", { className: "dk-dot", "data-tone": live ? "ok" : "muted" }),
      /* @__PURE__ */ h("span", { className: "dk-name", title: serverLabel2(item) }, serverLabel2(item)),
      /* @__PURE__ */ h("span", { className: "dk-meta" }, item.username, "@", item.host, ":", item.port),
      /* @__PURE__ */ h(
        Btn,
        {
          size: "sm",
          variant: "danger",
          disabled: Boolean(busy),
          onClick: (event) => {
            event.stopPropagation();
            void remove(item);
          }
        },
        confirmId === item.id ? t("ssh.removeConfirm") : t("ssh.remove")
      )
    );
  })) : null, /* @__PURE__ */ h("div", { className: "dk-actionbar", style: { marginTop: "8px" } }, /* @__PURE__ */ h(Btn, { size: "sm", variant: editing === "new" ? void 0 : "primary", onClick: editing ? closeForm : startNew }, editing ? t("ssh.cancel") : t("ssh.addServer")), lastUsedName ? /* @__PURE__ */ h("span", { className: "dk-meta" }, t("ssh.lastUsed", { name: lastUsedName })) : null)), editing ? /* @__PURE__ */ h("div", { className: "dk-card", ref: formRef }, /* @__PURE__ */ h("div", { className: "dk-card-title" }, /* @__PURE__ */ h("span", null, editing === "new" ? t("ssh.newServer") : form.name || serverLabel2(form)), /* @__PURE__ */ h("span", { className: "dk-pill" }, connectedHere ? h(
    Fragment,
    null,
    h("span", { className: "dk-dot", "data-tone": "ok" }),
    t("ssh.statusConnected")
  ) : null)), /* @__PURE__ */ h("div", { className: "dk-form" }, /* @__PURE__ */ h("label", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("ssh.name")), /* @__PURE__ */ h(
    "input",
    {
      className: "dk-input",
      value: form.name,
      placeholder: t("ssh.namePlaceholder"),
      onChange: (event) => setForm((prev) => ({ ...prev, name: event.target.value }))
    }
  )), /* @__PURE__ */ h("div", { className: "dk-form-row" }, /* @__PURE__ */ h("label", { className: "dk-field dk-field-grow" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("ssh.host")), /* @__PURE__ */ h(
    "input",
    {
      className: "dk-input",
      value: form.host,
      placeholder: "192.168.1.10",
      onChange: (event) => setForm((prev) => ({ ...prev, host: event.target.value }))
    }
  )), /* @__PURE__ */ h("label", { className: "dk-field dk-field-port" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("ssh.port")), /* @__PURE__ */ h(
    "input",
    {
      className: "dk-input",
      value: form.port,
      inputMode: "numeric",
      onChange: (event) => setForm((prev) => ({ ...prev, port: event.target.value }))
    }
  ))), /* @__PURE__ */ h("label", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("ssh.username")), /* @__PURE__ */ h(
    "input",
    {
      className: "dk-input",
      value: form.username,
      placeholder: "root",
      autoComplete: "off",
      onChange: (event) => setForm((prev) => ({ ...prev, username: event.target.value }))
    }
  )), /* @__PURE__ */ h("label", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("ssh.password"), hasPassword ? ` · ${t("ssh.passwordSaved")}` : ` · ${t("ssh.passwordEmpty")}`), /* @__PURE__ */ h(
    "input",
    {
      className: "dk-input",
      type: "password",
      value: form.password,
      placeholder: hasPassword ? "******" : "",
      autoComplete: "new-password",
      onChange: (event) => setForm((prev) => ({ ...prev, password: event.target.value }))
    }
  )), form.id && hasPassword ? /* @__PURE__ */ h("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: Boolean(busy), onClick: () => void clearPassword() }, passwordConfirm ? t("ssh.clearPasswordConfirm") : t("ssh.clearPassword"))) : null, /* @__PURE__ */ h("label", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("ssh.dockerPath")), /* @__PURE__ */ h(
    "input",
    {
      className: "dk-input",
      value: form.dockerPath,
      placeholder: "docker",
      onChange: (event) => setForm((prev) => ({ ...prev, dockerPath: event.target.value }))
    }
  )), form.id ? /* @__PURE__ */ h("div", { className: "dk-field" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("ssh.hostKey")), /* @__PURE__ */ h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } }, /* @__PURE__ */ h(
    "span",
    {
      className: "dk-meta",
      style: { flex: "1 1 100%", wordBreak: "break-all" },
      title: form.hostKey || t("ssh.hostKeyNone")
    },
    form.hostKey || t("ssh.hostKeyNone")
  ), form.hostKey ? /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      variant: "ghost",
      disabled: Boolean(busy),
      title: t("ssh.hostKeyHint"),
      onClick: () => void resetHostKey()
    },
    hostKeyConfirm ? t("ssh.hostKeyResetConfirm") : t("ssh.hostKeyReset")
  ) : null)) : null), /* @__PURE__ */ h("div", { className: "dk-actionbar", style: { marginTop: "8px" } }, /* @__PURE__ */ h(Btn, { size: "sm", variant: "primary", disabled: Boolean(busy) || !canSubmit, onClick: () => void saveAndConnect() }, busy === "connect" ? t("ssh.connecting") : t("ssh.connect")), /* @__PURE__ */ h(Btn, { size: "sm", disabled: Boolean(busy) || !canSubmit, onClick: () => void runTest() }, busy === "test" ? t("ssh.testing") : t("ssh.test")), /* @__PURE__ */ h(Btn, { size: "sm", disabled: Boolean(busy) || !canSubmit, onClick: () => void saveOnly() }, t("ssh.save")), connected ? /* @__PURE__ */ h(Btn, { size: "sm", disabled: Boolean(busy), onClick: () => void disconnect() }, t("ssh.disconnect")) : null, /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", disabled: Boolean(busy), onClick: closeForm }, t("ssh.cancel"))), connectedHere ? /* @__PURE__ */ h("div", { className: "dk-kv", style: { marginTop: "8px" } }, /* @__PURE__ */ h(Field, { label: t("ssh.target"), value: session.host }), /* @__PURE__ */ h(Field, { label: t("ssh.dockerVersion"), value: session.docker?.version || t("ssh.unknown") }), /* @__PURE__ */ h(Field, { label: t("ssh.connectedAt"), value: formatClock(session.connectedAt) })) : null, connectedHere && session.docker && session.docker.ok === false && session.docker.error ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, session.docker.error) : null, test.status === "loading" ? /* @__PURE__ */ h("div", { className: "dk-meta" }, t("ssh.testing")) : null, test.status === "ok" ? /* @__PURE__ */ h("div", { className: "dk-ok-text" }, test.message) : null, test.status === "error" ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, test.error) : null, session.status === "error" && session.error ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, session.error) : null, error ? /* @__PURE__ */ h("div", { className: "dk-inline-error" }, error) : null, /* @__PURE__ */ h("div", { className: "dk-meta", style: { marginTop: "6px" } }, t("ssh.onlyPassword"))) : null));
}

// src/panel/main.jsx
if (typeof window !== "undefined" && window.SnowAppPlugin && window.SnowAppPlugin.React) {
  bindReact(window.SnowAppPlugin.React);
}
var TAB_IDS = ["containers", "logs", "images", "project", "ssh", "overview"];
var TAB_LABEL = {
  containers: "tab.containers",
  logs: "tab.logs",
  images: "tab.images",
  project: "tab.project",
  ssh: "tab.ssh",
  overview: "tab.overview"
};
var TAB_ICONS = {
  containers: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("path", { d: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" }), /* @__PURE__ */ h("path", { d: "m3.3 7 8.7 5 8.7-5" }), /* @__PURE__ */ h("path", { d: "M12 22V12" })),
  logs: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("path", { d: "m4 17 6-6-6-6" }), /* @__PURE__ */ h("path", { d: "M12 19h8" })),
  images: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("path", { d: "m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" }), /* @__PURE__ */ h("path", { d: "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" }), /* @__PURE__ */ h("path", { d: "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" })),
  project: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("path", { d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" })),
  ssh: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("rect", { width: "20", height: "8", x: "2", y: "2", rx: "2", ry: "2" }), /* @__PURE__ */ h("rect", { width: "20", height: "8", x: "2", y: "14", rx: "2", ry: "2" }), /* @__PURE__ */ h("path", { d: "M6 6h.01" }), /* @__PURE__ */ h("path", { d: "M6 18h.01" })),
  overview: /* @__PURE__ */ h("g", null, /* @__PURE__ */ h("rect", { width: "7", height: "9", x: "3", y: "3", rx: "1" }), /* @__PURE__ */ h("rect", { width: "7", height: "5", x: "14", y: "3", rx: "1" }), /* @__PURE__ */ h("rect", { width: "7", height: "9", x: "14", y: "12", rx: "1" }), /* @__PURE__ */ h("rect", { width: "7", height: "5", x: "3", y: "16", rx: "1" }))
};
var ACTIVE_REFRESH_MS = 5e3;
var OVERVIEW_REFRESH_MS = 15e3;
var RETRY_REFRESH_MS = 6e3;
var SYSTEM_REFRESH_MS = 3e4;
var SSH_REFRESH_MS2 = 15e3;
var NOTICE_MS = 3600;
function DockerPanel({ api, locale, isActive }) {
  const React = ensureReact(api);
  const translator = React.useMemo(() => createTranslator(api, locale), [api, locale]);
  const t = translator.t;
  const log = React.useCallback(
    (...args) => {
      try {
        api?.log?.(...args);
      } catch {
      }
    },
    [api]
  );
  const rpc = React.useMemo(() => createRpc(api, { log }), [api, log]);
  const [boot, setBoot] = React.useState({ status: "loading", error: "", code: "" });
  const [system, setSystem] = React.useState(null);
  const [containers, setContainers] = React.useState([]);
  const [images, setImages] = React.useState([]);
  const [listLoading, setListLoading] = React.useState(false);
  const [listReady, setListReady] = React.useState(false);
  const [containersError, setContainersError] = React.useState("");
  const [imagesError, setImagesError] = React.useState("");
  const [tab, setTab] = React.useState("containers");
  const [filter, setFilter] = React.useState("");
  const [imageFilter, setImageFilter] = React.useState("");
  const [onlyRunning, setOnlyRunning] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState("");
  const [notices, setNotices] = React.useState([]);
  const [project, setProject] = React.useState({ path: "", name: "", kind: "", pathState: "" });
  const [ssh, setSsh] = React.useState({ status: "idle", id: "", host: "", username: "", servers: [] });
  const [targetBusy, setTargetBusy] = React.useState(false);
  const [systemStale, setSystemStale] = React.useState("");
  const [tokenWarn, setTokenWarn] = React.useState(false);
  const [recoveryInfo, setRecoveryInfo] = React.useState(null);
  const aliveRef = React.useRef(true);
  const noticeTimersRef = React.useRef(/* @__PURE__ */ new Map());
  const refreshInFlightRef = React.useRef(null);
  const listInFlightRef = React.useRef(null);
  const systemInFlightRef = React.useRef(null);
  const systemSeenRef = React.useRef(false);
  const targetGenRef = React.useRef(0);
  const sshRef = React.useRef({ id: "" });
  const refreshSshRef = React.useRef(null);
  const targetResyncRef = React.useRef({ at: 0, promise: null });
  React.useEffect(() => {
    aliveRef.current = true;
    const timers = noticeTimersRef.current;
    return () => {
      aliveRef.current = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);
  const notify = React.useCallback((tone, text) => {
    if (!aliveRef.current) return;
    const id = `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setNotices((list) => [...list.slice(-2), { id, tone: tone || "info", text: String(text || "") }]);
    const timer = setTimeout(() => {
      noticeTimersRef.current.delete(id);
      if (!aliveRef.current) return;
      setNotices((list) => list.filter((item) => item.id !== id));
    }, NOTICE_MS);
    noticeTimersRef.current.set(id, timer);
  }, []);
  const describeError = React.useCallback(
    (error) => {
      const code = String(error?.code || "");
      if (code === "DOCKER_NOT_FOUND") return t("error.dockerNotFound");
      if (code === "DAEMON_UNAVAILABLE") return t("error.daemonUnavailable");
      if (code === "PERMISSION_DENIED") return t("error.permissionDenied");
      if (code === "DOCKER_TIMEOUT" || code === "TIMEOUT") return t("error.timeout");
      if (code === "BACKGROUND_UNAVAILABLE") return t("error.backgroundUnavailable");
      if (code === "NET_UNAVAILABLE") return t("error.backgroundUnavailable");
      return t("error.generic", { message: String(error?.message || error) });
    },
    [t]
  );
  const noteTargetDrift = React.useCallback(() => {
    const now = Date.now();
    if (targetResyncRef.current.promise || now - targetResyncRef.current.at < 2e3) return;
    targetResyncRef.current.at = now;
    const job = Promise.resolve(refreshSshRef.current?.()).finally(() => {
      if (targetResyncRef.current.promise === job) targetResyncRef.current.promise = null;
    });
    targetResyncRef.current.promise = job;
  }, []);
  const applyListResults = React.useCallback(
    ({ gen, containersResult, imagesResult }) => {
      if (!aliveRef.current) return;
      if (gen !== targetGenRef.current) return;
      const containersTarget = containersResult.ok ? String(containersResult.data?.target?.id || "") : "";
      const imagesTarget = imagesResult.ok ? String(imagesResult.data?.target?.id || "") : "";
      if (containersTarget && imagesTarget && containersTarget !== imagesTarget) {
        noteTargetDrift();
        return;
      }
      const seenTarget = containersTarget || imagesTarget;
      const knownTarget = String(sshRef.current?.id || "");
      if (seenTarget && knownTarget && seenTarget !== knownTarget) {
        noteTargetDrift();
        return;
      }
      if (containersResult.ok) {
        setContainers(Array.isArray(containersResult.data?.containers) ? containersResult.data.containers : []);
        setContainersError("");
      } else {
        setContainers([]);
        setContainersError(describeError(containersResult.error));
      }
      if (imagesResult.ok) {
        setImages(Array.isArray(imagesResult.data?.images) ? imagesResult.data.images : []);
        setImagesError("");
      } else {
        setImages([]);
        setImagesError(describeError(imagesResult.error));
      }
      if (containersResult.ok || imagesResult.ok) setListReady(true);
    },
    [describeError, noteTargetDrift]
  );
  const loadListResults = React.useCallback(() => {
    const gen = targetGenRef.current;
    return Promise.all([
      rpc.containers({ all: true }).then((data) => ({ ok: true, data })).catch((error) => ({ ok: false, error })),
      rpc.images().then((data) => ({ ok: true, data })).catch((error) => ({ ok: false, error }))
    ]).then(([containersResult, imagesResult]) => ({ gen, containersResult, imagesResult }));
  }, [rpc]);
  const applySystemResult = React.useCallback(
    (systemResult) => {
      if (!aliveRef.current) return;
      if (systemResult.ok) {
        const seenTarget = String(systemResult.data?.target?.id || "");
        const knownTarget = String(sshRef.current?.id || "");
        if (seenTarget && knownTarget && seenTarget !== knownTarget) {
          noteTargetDrift();
          return;
        }
        systemSeenRef.current = true;
        setSystem(systemResult.data);
        setSystemStale("");
        setBoot({ status: "ready", error: "", code: "" });
        return;
      }
      const code = String(systemResult.error?.code || "");
      const engineDown = code === "DOCKER_NOT_FOUND" || code === "DAEMON_UNAVAILABLE" || code === "PERMISSION_DENIED";
      if (code === "SSH_NOT_CONNECTED") {
        systemSeenRef.current = false;
        setSystem(null);
        setSystemStale("");
        setBoot({ status: "offline", error: "", code });
      } else if (!systemSeenRef.current || engineDown) {
        setBoot({ status: "error", error: describeError(systemResult.error), code });
      } else {
        setSystemStale(describeError(systemResult.error));
      }
    },
    [describeError, noteTargetDrift]
  );
  const refreshData = React.useCallback(
    ({ silent = false } = {}) => {
      if (refreshInFlightRef.current) return refreshInFlightRef.current;
      const gen = targetGenRef.current;
      const listTask = (async () => {
        if (aliveRef.current && !silent) setListLoading(true);
        try {
          const listResult = await loadListResults();
          if (aliveRef.current) applyListResults(listResult);
        } finally {
          if (aliveRef.current) setListLoading(false);
        }
      })();
      if (!systemInFlightRef.current) {
        const systemTask = rpc.system().then((data) => ({ ok: true, data })).catch((error) => ({ ok: false, error })).then((systemResult) => {
          if (aliveRef.current && gen === targetGenRef.current) applySystemResult(systemResult);
        }).finally(() => {
          if (systemInFlightRef.current === systemTask) systemInFlightRef.current = null;
        });
        systemInFlightRef.current = systemTask;
      }
      refreshInFlightRef.current = listTask;
      listTask.finally(() => {
        if (refreshInFlightRef.current === listTask) refreshInFlightRef.current = null;
      });
      return listTask;
    },
    [rpc, applySystemResult, loadListResults, applyListResults]
  );
  const refreshSystem = React.useCallback(async () => {
    const systemResult = await rpc.system().then((data) => ({ ok: true, data })).catch((error) => ({ ok: false, error }));
    applySystemResult(systemResult);
  }, [rpc, applySystemResult]);
  const refreshLists = React.useCallback(() => {
    if (listInFlightRef.current) return listInFlightRef.current;
    const run = (async () => {
      const listResult = await loadListResults();
      applyListResults(listResult);
    })();
    listInFlightRef.current = run;
    run.finally(() => {
      if (listInFlightRef.current === run) listInFlightRef.current = null;
    });
    return run;
  }, [loadListResults, applyListResults]);
  const refreshSsh = React.useCallback(async () => {
    try {
      const data = await rpc.sshStatus();
      if (!aliveRef.current) return;
      setSsh({
        status: String(data?.status || "idle"),
        id: String(data?.id || ""),
        host: String(data?.host || ""),
        username: String(data?.username || ""),
        servers: Array.isArray(data?.servers) ? data.servers : []
      });
    } catch {
    }
  }, [rpc]);
  React.useEffect(() => {
    refreshSshRef.current = refreshSsh;
  }, [refreshSsh]);
  React.useEffect(() => {
    sshRef.current = ssh;
  }, [ssh]);
  React.useEffect(() => {
    void refreshSsh();
  }, [refreshSsh]);
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await rpc.health();
        if (alive) setTokenWarn(data?.tokenEnforced === false);
      } catch {
      }
    })();
    return () => {
      alive = false;
    };
  }, [rpc, boot.status]);
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await rpc.settings();
        if (!alive) return;
        const info = data?.recovery;
        setRecoveryInfo(info && info.restoredFromBackup && info.runConfigCount > 0 ? info : null);
      } catch {
      }
    })();
    return () => {
      alive = false;
    };
  }, [rpc, boot.status]);
  React.useEffect(() => {
    if (isActive === false) return void 0;
    const timer = setInterval(() => void refreshSsh(), SSH_REFRESH_MS2);
    return () => clearInterval(timer);
  }, [isActive, refreshSsh]);
  const switchTarget = React.useCallback(
    async (next) => {
      const current = ssh.status === "connected" ? ssh.id : "";
      if (!next) return;
      if (next === current || targetBusy) return;
      setTargetBusy(true);
      targetGenRef.current += 1;
      setContainers([]);
      setImages([]);
      setContainersError("");
      setImagesError("");
      setSelectedId("");
      setListLoading(true);
      setListReady(false);
      try {
        if (next) await rpc.sshConnect(next);
        else await rpc.sshDisconnect();
        systemSeenRef.current = false;
        setSystemStale("");
        if (refreshInFlightRef.current) await refreshInFlightRef.current.catch(() => {
        });
        await refreshSsh();
        await refreshData();
      } catch (error) {
        notify("error", String(error?.message || error));
        setListLoading(false);
      } finally {
        setTargetBusy(false);
      }
    },
    [ssh.status, ssh.id, targetBusy, refreshSsh, refreshData, notify, rpc]
  );
  React.useEffect(() => {
    void refreshData({ silent: ssh.status !== "idle" });
  }, [refreshData, ssh.status, ssh.id]);
  React.useEffect(() => {
    if (isActive === false) return void 0;
    if (boot.status !== "ready") return void 0;
    const interval = tab === "overview" ? OVERVIEW_REFRESH_MS : ACTIVE_REFRESH_MS;
    const timer = setInterval(() => {
      void refreshLists();
    }, interval);
    return () => clearInterval(timer);
  }, [boot.status, isActive, tab, refreshLists]);
  React.useEffect(() => {
    if (isActive === false) return void 0;
    if (boot.status === "loading") return void 0;
    const interval = boot.status === "error" || boot.status === "offline" ? RETRY_REFRESH_MS : SYSTEM_REFRESH_MS;
    const timer = setInterval(() => {
      void refreshSystem();
    }, interval);
    return () => clearInterval(timer);
  }, [boot.status, isActive, refreshSystem]);
  React.useEffect(() => {
    let alive = true;
    let subscription = null;
    const apply = (runtimeDomain) => {
      if (!alive) return;
      const dir = runtimeDomain?.activeDirectory || null;
      setProject({
        path: typeof dir?.path === "string" ? dir.path : "",
        name: typeof dir?.name === "string" ? dir.name : "",
        kind: typeof dir?.kind === "string" ? dir.kind : "",
        pathState: typeof dir?.pathState === "string" ? dir.pathState : ""
      });
    };
    (async () => {
      try {
        const initial = await api?.metadata?.get?.("runtime");
        apply(initial?.domains?.runtime);
      } catch (error) {
        log("[panel] 读取当前项目失败", String(error?.message || error));
      }
      try {
        const sub = await api?.metadata?.subscribe?.("runtime", (next) => apply(next?.domains?.runtime), {});
        if (alive) subscription = sub;
        else sub?.unsubscribe?.();
      } catch (error) {
        log("[panel] 订阅项目变化失败", String(error?.message || error));
      }
    })();
    return () => {
      alive = false;
      try {
        subscription?.unsubscribe?.();
      } catch {
      }
    };
  }, [api, log]);
  React.useEffect(() => {
    if (!selectedId) return;
    if (!containers.some((item) => item.id === selectedId)) setSelectedId("");
  }, [containers, selectedId]);
  const openFile = React.useCallback(
    async (filePath) => {
      try {
        const result = await api?.write?.run?.("panels.openFile", { filePath });
        if (result && result.ok === false) notify("error", String(result.error || "打开文件失败"));
      } catch (error) {
        notify("error", String(error?.message || error));
      }
    },
    [api, notify]
  );
  const daemonOnline = system?.daemon?.online === true;
  const cliMissing = system ? system.cli?.available !== true : false;
  const connectedTarget = ssh.status === "connected" ? `${ssh.username || "root"}@${ssh.host || ""}` : "";
  const hasServers = ssh.servers.length > 0;
  const targetValue = ssh.status === "connected" ? ssh.id : "";
  const targetOptions = [
    ...targetValue ? [] : [{ value: "", label: t("target.choose") }],
    ...ssh.servers.map((item) => ({
      value: item.id,
      label: item.name || `${item.username || "root"}@${item.host || ""}`
    }))
  ];
  const statusTone = boot.status === "error" || boot.status === "offline" ? "bad" : daemonOnline ? "ok" : "warn";
  const statusText = boot.status === "loading" ? t("status.checking") : boot.status === "offline" ? t("target.offline") : boot.status === "error" ? boot.error : connectedTarget ? `${connectedTarget} · ${daemonOnline ? t("status.online") : cliMissing ? t("status.cliMissing") : t("status.daemonOffline")}` : t("target.offline");
  const runningCount = containers.filter((item) => item.state === "running").length;
  const needsDaemon = tab === "containers" || tab === "logs" || tab === "images" || tab === "overview";
  const canOpenLocalTabs = boot.status !== "loading";
  const listVisible = boot.status === "ready" || listReady && boot.status === "loading";
  return /* @__PURE__ */ h("div", { className: "dk-panel" }, /* @__PURE__ */ h("div", { className: "dk-head" }, /* @__PURE__ */ h("div", { className: "dk-title", title: statusText }, /* @__PURE__ */ h("span", { className: "dk-dot", "data-tone": statusTone }), /* @__PURE__ */ h("span", { className: "dk-title-text" }, t("app.title"))), /* @__PURE__ */ h("div", { className: "dk-head-sub", title: statusText }, statusText), systemStale ? /* @__PURE__ */ h("span", { className: "dk-meta", title: systemStale }, t("status.stale")) : null, /* @__PURE__ */ h("div", { className: "dk-head-spacer" }), /* @__PURE__ */ h(
    Btn,
    {
      size: "sm",
      disabled: listLoading || boot.status === "loading" && !listVisible,
      title: t("action.refresh"),
      onClick: () => {
        void refreshData();
      }
    },
    t("action.refresh")
  )), tokenWarn ? /* @__PURE__ */ h("div", { className: "dk-inline-warn", role: "status" }, t("security.tokenNotPersisted")) : null, recoveryInfo ? /* @__PURE__ */ h("div", { className: "dk-inline-warn", role: "status" }, t("settings.recovered.body", {
    configs: recoveryInfo.runConfigCount,
    fields: (recoveryInfo.fields || []).map((id) => t(`settings.recovered.field.${id}`)).join("、")
  }), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => setRecoveryInfo(null) }, t("settings.recovered.dismiss"))) : null, /* @__PURE__ */ h("div", { className: "dk-tabs" }, TAB_IDS.map((id) => {
    const count = id === "containers" ? containers.length : id === "images" ? images.length : 0;
    const label = t(TAB_LABEL[id]);
    return /* @__PURE__ */ h(
      "button",
      {
        key: id,
        type: "button",
        className: "dk-tab",
        "data-active": tab === id ? "1" : "0",
        onClick: () => setTab(id)
      },
      TAB_ICONS[id] ? /* @__PURE__ */ h(
        "svg",
        {
          className: "dk-tab-icon",
          width: "14",
          height: "14",
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true"
        },
        TAB_ICONS[id]
      ) : null,
      /* @__PURE__ */ h("span", null, label),
      count > 0 ? /* @__PURE__ */ h("span", { className: "dk-count" }, count) : null
    );
  })), /* @__PURE__ */ h("div", { className: "dk-toolbar dk-target-bar" }, /* @__PURE__ */ h("span", { className: "dk-meta" }, t("target.label")), hasServers ? /* @__PURE__ */ h("div", { style: { flex: "1 1 auto", minWidth: 0 } }, /* @__PURE__ */ h(
    DkSelect,
    {
      value: targetValue,
      options: targetOptions,
      onChange: (next) => void switchTarget(next),
      ariaLabel: t("target.label"),
      size: "sm",
      searchable: true,
      searchPlaceholder: t("target.search"),
      emptyText: t("target.empty"),
      disabled: targetBusy
    }
  )) : /* @__PURE__ */ h("span", { className: "dk-meta", style: { flex: "1 1 auto", minWidth: 0 } }, t("target.none")), /* @__PURE__ */ h(Btn, { size: "sm", variant: "ghost", onClick: () => setTab("ssh") }, hasServers ? t("target.manage") : t("target.add")), targetBusy ? /* @__PURE__ */ h("span", { className: "dk-meta" }, t("target.connecting")) : null), boot.status === "loading" && (!listVisible || tab === "overview" && !system) ? /* @__PURE__ */ h(Loading, { text: t("status.checking") }) : null, boot.status === "offline" && needsDaemon ? /* @__PURE__ */ h("div", { style: { paddingTop: "10px" } }, /* @__PURE__ */ h(
    EmptyState,
    {
      title: hasServers ? t("target.notConnected") : t("target.needServer"),
      hint: hasServers ? t("target.notConnectedHint") : t("target.needServerHint"),
      action: /* @__PURE__ */ h(Btn, { size: "sm", variant: "primary", onClick: () => setTab("ssh") }, t("target.add"))
    }
  )) : null, boot.status === "error" && needsDaemon ? /* @__PURE__ */ h("div", { style: { paddingTop: "10px" } }, /* @__PURE__ */ h(
    ErrorBox,
    {
      title: t("error.title"),
      message: boot.error,
      action: /* @__PURE__ */ h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, /* @__PURE__ */ h(
        Btn,
        {
          size: "sm",
          variant: "primary",
          onClick: () => {
            rpc.resetPort();
            setBoot({ status: "loading", error: "", code: "" });
            void refreshData();
          }
        },
        t("action.retry")
      ), /* @__PURE__ */ h("span", { className: "dk-meta" }, t("conn.autoRetry")))
    }
  )) : null, listVisible && tab === "containers" ? /* @__PURE__ */ h(
    ContainersView,
    {
      t,
      rpc,
      containers,
      loading: listLoading,
      error: containersError,
      filter,
      setFilter,
      onlyRunning,
      setOnlyRunning,
      selectedId,
      setSelectedId,
      notify,
      onChanged: refreshLists,
      onOpenLogs: (id) => {
        setSelectedId(id);
        setTab("logs");
      }
    }
  ) : null, listVisible ? /* @__PURE__ */ h(
    LogsView,
    {
      t,
      rpc,
      containers,
      loading: listLoading,
      selectedId,
      setSelectedId,
      active: isActive !== false,
      visible: tab === "logs"
    }
  ) : null, listVisible ? /* @__PURE__ */ h(
    "div",
    {
      hidden: tab !== "images",
      style: { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }
    },
    /* @__PURE__ */ h(
      ImagesView,
      {
        t,
        rpc,
        images,
        containers,
        loading: listLoading,
        error: imagesError,
        filter: imageFilter,
        setFilter: setImageFilter,
        notify,
        onChanged: refreshLists,
        active: isActive !== false && tab === "images"
      }
    )
  ) : null, canOpenLocalTabs ? /* @__PURE__ */ h(
    "div",
    {
      hidden: tab !== "project",
      style: { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }
    },
    /* @__PURE__ */ h(
      ProjectView,
      {
        t,
        rpc,
        notify,
        project,
        onOpenFile: openFile,
        active: isActive !== false && tab === "project"
      }
    )
  ) : null, canOpenLocalTabs && tab === "ssh" ? /* @__PURE__ */ h(SshView, { t, rpc, notify }) : null, boot.status === "ready" && tab === "overview" ? /* @__PURE__ */ h(
    OverviewView,
    {
      t,
      rpc,
      notify,
      system,
      loading: listLoading,
      error: "",
      targetKind: "remote",
      onRetry: () => {
        void refreshData();
      }
    }
  ) : null, listVisible ? /* @__PURE__ */ h(
    "div",
    {
      className: "dk-head",
      style: { borderTop: "1px solid var(--dk-border)", borderBottom: 0, padding: "5px 10px" }
    },
    /* @__PURE__ */ h("span", { className: "dk-head-sub" }, t("tab.containers"), ": ", runningCount, " / ", containers.length, " · ", t("tab.images"), ": ", images.length)
  ) : null, notices.length ? /* @__PURE__ */ h("div", { className: "dk-notices" }, notices.map((notice) => /* @__PURE__ */ h("div", { className: "dk-notice", "data-tone": notice.tone, key: notice.id }, notice.text))) : null);
}
export {
  DockerPanel as default
};
