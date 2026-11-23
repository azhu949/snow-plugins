// 运行配置的共享工具：默认值、表单草稿与后台配置对象之间的转换。
// 一个 Dockerfile 对应一份配置，键是 Dockerfile 的绝对路径（正斜杠）。
// 「构建」「运行」两组里除必要字段外，其余附加项由 options 控制是否显示。
import {
  ENV_TOTAL_MAX,
  ENV_VALUE_MAX,
  PRE_BUILD_ENV_TOTAL_MAX,
  PRE_BUILD_ENV_VALUE_MAX,
  normalizeEnvValue,
  utf8Bytes,
} from "../shared/contract.js";

export const BUILD_ARG_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const DOCKERFILE_NAME = /^(dockerfile([-_.][\w.-]+)?|[\w.-]+\.dockerfile|containerfile)$/i;

export const BUILD_OPTION_IDS = ["platform", "buildArgs", "noCache", "pull"];
export const RUN_OPTION_IDS = ["ports", "mounts", "env", "runOptions"];
export const ALL_OPTION_IDS = [...BUILD_OPTION_IDS, ...RUN_OPTION_IDS];

/**
 * 构建前置步骤只接 npm（含 yarn / pnpm）与 Maven：先在本机打包，再执行 docker build。
 * 字段对齐 IDEA 的 npm 运行配置：package.json、包管理器、命令、脚本、参数、Node 解释器与参数、
 * 环境变量、工作目录；Maven 侧是 goals、profiles、JVM 选项。
 */
export const PRE_BUILD_TOOLS = ["npm", "maven"];
export const PACKAGE_MANAGERS = ["npm", "yarn", "pnpm"];
export const NPM_COMMANDS = ["run", "run-script", "install", "ci", "test", "start", "stop", "restart", "exec", "publish", "pack"];
export const PRE_BUILD_DEFAULTS = {
  npm: { packageManager: "npm", command: "run", script: "build" },
  maven: { goals: "-B clean package -DskipTests" },
};

/** 空的前置构建草稿；切换工具时也用它兜住缺省字段。 */
export const emptyPreBuild = () => ({
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
  jvmOptions: "",
});

export const baseName = (path) => {
  const text = String(path || "");
  const index = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  return index >= 0 ? text.slice(index + 1) : text;
};

export const toPosix = (path) => String(path || "").replace(/\\/g, "/");

export const isAbsolutePath = (path) => /^([A-Za-z]:\/|\/)/.test(toPosix(path));
/** 绑定挂载源必须是服务器上的 POSIX 绝对路径：运行配置只在远程服务器上执行。 */
export const isRemoteAbsolutePath = (path) => /^\//.test(String(path || ""));

export const isDockerfilePath = (path) => DOCKERFILE_NAME.test(baseName(path));

const isPortText = (text) => {
  if (!/^\d{1,5}$/.test(text)) return false;
  const value = Number(text);
  return value > 0 && value <= 65535;
};

/** 由项目名推一个合法镜像标记：小写、只留字母数字与点横线下划线。 */
export const suggestTag = (projectName, file) => {
  const raw = String(projectName || "").trim() || baseName(projectName);
  let slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
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

export const emptyDraft = () => ({
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
  options: [],
});

/** 已保存的配置里带值、但没记 options 时（老版本），按数据补上勾选状态。 */
const collectOptions = (config) => {
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

/** 把已保存的配置铺进表单草稿；没保存过的用文件名与建议标记兜底。 */
export const draftFromConfig = (file, config, projectName) => ({
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
    protocol: port.protocol === "udp" ? "udp" : "tcp",
  })),
  mounts: (config?.mounts || []).map((mount) => ({
    host: mount.host || "",
    container: mount.container || "",
    readOnly: mount.readOnly === true,
  })),
  env: (config?.env || []).map((item) => ({ key: item.key || "", value: item.value || "" })),
  runOptions: config?.runOptions || "",
  preBuild: {
    tool: PRE_BUILD_TOOLS.includes(config?.preBuild?.tool) ? config.preBuild.tool : "",
    cwd: config?.preBuild?.cwd || "",
    packageJson: config?.preBuild?.packageJson || "",
    packageManager: PACKAGE_MANAGERS.includes(config?.preBuild?.packageManager)
      ? config.preBuild.packageManager
      : "npm",
    command: NPM_COMMANDS.includes(config?.preBuild?.command) ? config.preBuild.command : "run",
    script: config?.preBuild?.script || "",
    arguments: config?.preBuild?.arguments || "",
    nodePath: config?.preBuild?.nodePath || "",
    nodeOptions: config?.preBuild?.nodeOptions || "",
    mavenPath: config?.preBuild?.mavenPath || "",
    env: (config?.preBuild?.env || []).map((item) => ({ key: item.key || "", value: item.value || "" })),
    goals: config?.preBuild?.goals || "",
    profiles: config?.preBuild?.profiles || "",
    jvmOptions: config?.preBuild?.jvmOptions || "",
  },
  options: collectOptions(config),
});

/**
 * 草稿转后台配置。返回 { config, error }：error 是文案键，非空表示校验没过。
 * 表格里两个格都留空的行会被忽略；构建参数允许只填 KEY。
 */
export const draftToConfig = (draft) => {
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
    // 值只统一行尾并去掉 NUL，首尾空白与换行原样保留：与后台 normalizeEnvValue 同源。
    const value = normalizeEnvValue(item.value);
    if (!key && !value.trim()) continue;
    if (!BUILD_ARG_KEY.test(key)) return { config: null, error: "project.envInvalid" };
    if (value.length > ENV_VALUE_MAX) {
      return {
        config: null,
        error: "project.envValueTooLong",
        params: { key, count: value.length, max: ENV_VALUE_MAX },
      };
    }
    envBytes += utf8Bytes(key) + utf8Bytes(value);
    env.push({ key, value });
  }
  // 与后台同一口径：这些值要拼进一条 SSH 命令，总量超限时远端会直接断开连接。
  if (envBytes > ENV_TOTAL_MAX) {
    return {
      config: null,
      error: "project.envTotalTooLarge",
      params: { count: Math.ceil(envBytes / 1024), max: ENV_TOTAL_MAX / 1024 },
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

  // 构建前置步骤：npm 需要脚本名，Maven 需要 goals；工作目录与 package.json 都要绝对路径。
  const before = draft.preBuild || {};
  const beforeEnv = [];
  let beforeEnvChars = 0;
  for (const item of before.env || []) {
    const key = String(item.key || "").trim();
    // 前置构建与运行环境同一套值处理，避免两条链路给出不同结果。
    const value = normalizeEnvValue(item.value);
    if (!key && !value.trim()) continue;
    if (!BUILD_ARG_KEY.test(key)) return { config: null, error: "project.envInvalid" };
    if (value.length > PRE_BUILD_ENV_VALUE_MAX) {
      return {
        config: null,
        error: "project.preBuildEnvValueTooLong",
        params: { key, count: value.length, max: PRE_BUILD_ENV_VALUE_MAX },
      };
    }
    // 前置构建的 env 整块进子进程环境，按字符累计（与后台 validatePreBuildEnv 一致）。
    beforeEnvChars += key.length + value.length + 1;
    beforeEnv.push({ key, value });
  }
  if (beforeEnvChars > PRE_BUILD_ENV_TOTAL_MAX) {
    return {
      config: null,
      error: "project.preBuildEnvTotalTooLarge",
      params: { count: beforeEnvChars, max: PRE_BUILD_ENV_TOTAL_MAX },
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
    jvmOptions: String(before.jvmOptions || "").replace(/[\r\n]+/g, " ").trim(),
  };

  if (preBuild.tool && preBuild.cwd && !isAbsolutePath(preBuild.cwd)) {
    return { config: null, error: "project.preBuildCwdInvalid" };
  }
  if (preBuild.tool && preBuild.packageJson && !isAbsolutePath(preBuild.packageJson)) {
    return { config: null, error: "project.packageJsonInvalid" };
  }
  // 只支持远程：每份运行配置都必须指明落点服务器（serverId 在草稿顶层，不在 preBuild 里）。
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
      options: (draft.options || []).filter((id) => ALL_OPTION_IDS.includes(id)),
    },
    error: "",
  };
};
