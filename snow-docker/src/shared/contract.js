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
   * 单份运行配置的合法上限之和已接近 128 KB：buildArgs 32 条 × 512、
   * env 64 条 × 512、preBuild.env 32 条 × 512（再加上键名与 JSON 结构）。
   * 早期取 64 KB 时，填满这些字段的合法配置会被误判为过大，所以留一倍余量。
   */
  requestMaxBytes: 256 * 1024,
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
