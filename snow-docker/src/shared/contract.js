// 面板与后台模块共用的通道契约：监听区间、请求头、路由与各类上限都在这里。
export const PLUGIN_ID = "com.snow.docker-panel";

/**
 * 后台 HTTP 服务从 PORT_FIRST 开始逐个试到 PORT_LAST，取第一个能绑定的端口。
 * 区间与该仓库其它插件（红果 37191-37200）错开，避免同机端口撞车。
 * 实际端口与令牌一起发布到插件私有存储，面板按那条记录连接，不扫描端口。
 */
export const PORT_FIRST = 37291;
export const PORT_LAST = 37300;

/**
 * 自定义请求头：网页跨站请求带不上它，而本服务不应答 CORS 预检，可挡掉网页发起的调用。
 * 它不是身份认证：同机进程可以照抄，所以真正的调用方校验靠下面的随机令牌。
 */
export const CHANNEL_HEADER = "x-snow-docker-channel";
export const CHANNEL_HEADER_VALUE = "panel-rpc-v1";

/**
 * 通道令牌：后台启动时生成并写入插件私有存储，面板读取后随每个请求发送。
 * 令牌只存在于插件存储与内存里，本机其它进程无法凭空得知，因此不能像固定头那样直接伪造。
 * 令牌与监听端口作为同一条记录发布：面板只把令牌发给这条记录里的端口，
 * 不会像早先的端口扫描那样把令牌投递给区间内的任意监听者。
 */
export const CHANNEL_TOKEN_HEADER = "x-snow-docker-token";
export const CHANNEL_ENDPOINT_STORAGE_KEY = "channelEndpoint";

/**
 * 远程 docker 可执行文件：允许 PATH 里的名字（docker）或绝对路径（/usr/local/bin/docker）。
 * 远程命令由它和固定参数模板拼成，因此只允许路径安全字符。
 */
export const DOCKER_PATH_PATTERN = /^[A-Za-z0-9/_.-]{1,255}$/;

/**
 * 环境变量值的长度上限。PEM 私钥、证书这类多行文本动辄一两千字符，所以从 512 放宽到 16 KB；
 * 再大就必须改用文件挂载，否则会撞上 SSH 单包与子进程环境块两类限制。
 */
export const ENV_VALUE_MAX = 16 * 1024;
/**
 * 单份运行配置里环境变量（键 + 值）的 UTF-8 字节总量上限。
 * 这些值最终拼进一条 SSH exec 命令，OpenSSH 单包上限 256 KB；留 64 KB 是为了给
 * docker 路径、镜像名、端口 / 挂载参数与 SSH 引号转义留出余量。
 */
export const ENV_TOTAL_MAX = 64 * 1024;
/**
 * 前置构建环境变量的单值上限。
 * 前置构建的值不进 SSH 命令，而是整份塞进本机子进程的环境块；Windows 环境块上限是
 * 32767 字符，还要给系统已有的环境变量留位置，所以单值比运行环境更严。
 * 必须严格小于 PRE_BUILD_ENV_TOTAL_MAX：合计还要累加键名与分隔符，两个常数相等时
 * 单值会先撞上合计检查，报出与实际原因不符的错误。
 */
export const PRE_BUILD_ENV_VALUE_MAX = 8 * 1024;
/**
 * 单份配置里前置构建环境变量（键 + 值 + 分隔符）的字符总量上限。
 * 前置构建只在本机跑，但整份 env 会随 spawn 传给子进程；32 条 × 8 KB 会撞上
 * 环境块的长度边界并让 spawn 直接失败，所以这里单独收紧。
 */
export const PRE_BUILD_ENV_TOTAL_MAX = 16 * 1024;

/** 按 UTF-8 计算字节数：面板与后台共用，保证同一个值在两边得到同样的结论。 */
export const utf8Bytes = (text) => {
  let bytes = 0;
  for (const ch of String(text ?? "")) {
    const code = ch.codePointAt(0);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
};

/**
 * 环境变量值：保留换行（PEM 私钥的 BEGIN/END 行必须各占一行）与首尾空白，只统一行尾并去掉 NUL。
 * 面板的计数与保存校验、后台的存储归一化都调用它，保证同一个值在两边得到同样的结论。
 */
export const normalizeEnvValue = (value) =>
  typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/\0/g, "") : "";

export const ROUTES = {
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
  sshUpload: "/ssh/upload",
};

export const LIMITS = {
  /**
   * 请求体硬上限，超出直接 413。
   * 环境变量另有更严的约束（ENV_VALUE_MAX / ENV_TOTAL_MAX / PRE_BUILD_ENV_TOTAL_MAX）：
   * 这里只为 buildArgs、挂载与 JSON 结构留余量，4 MB 足以容纳一份接近上限的配置。
   */
  requestMaxBytes: 4 * 1024 * 1024,
  /** 容器日志一次最多拉取的行数（--tail 参数）与返回给面板的最大行数。 */
  logsTailDefault: 300,
  logsTailMax: 2000,
  logsLinesMax: 4000,
  /** 单行日志超过该长度即截断，避免终端刷屏把面板拖死。 */
  logLineChars: 2000,
  /** docker ps / images 的输出上限。 */
  listMaxBytes: 4 * 1024 * 1024,
  /** docker pull 输出上限与超时。 */
  pullMaxBytes: 2 * 1024 * 1024,
  pullTimeoutMs: 600 * 1000,
  /** 列表短期缓存：面板轮询不必每次都真的调 docker。 */
  listCacheTtlMs: 800,
};
