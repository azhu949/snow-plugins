// 运行配置弹窗：左侧是项目里的 Dockerfile 列表，右侧按 IDEA 的 Docker 运行配置分组：
// 配置名称、服务器、构建（Dockerfile / 上下文文件夹 / 镜像标记）、运行（容器名称）。
// 列表型与路径型的值都放在二级弹窗里编辑，入口是每一行右侧的文件夹图标。
import { h, getReact } from "./react.js";
import { Btn } from "./ui.jsx";
import { DkSelect } from "./select.jsx";
import {
  ENV_TOTAL_MAX,
  ENV_VALUE_MAX,
  PRE_BUILD_ENV_TOTAL_MAX,
  PRE_BUILD_ENV_VALUE_MAX,
  normalizeEnvValue,
  utf8Bytes,
} from "../shared/contract.js";
import {
  BUILD_ARG_KEY,
  BUILD_OPTION_IDS,
  CONTAINER_NAME,
  NPM_COMMANDS,
  PRE_BUILD_DEFAULTS,
  PRE_BUILD_TOOLS,
  RUN_OPTION_IDS,
  baseName,
  draftFromConfig,
  draftToConfig,
  emptyDraft,
  emptyPreBuild,
  isAbsolutePath,
  toPosix,
} from "./runconfig.js";

const CONFIRM_MS = 4000;

/** 可聚焦元素口径：主弹窗与二级弹窗共用，避免两处选择器漂移。 */
const FOCUSABLE_SELECTOR =
  "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

/**
 * 把 Tab 圈定在 container 内：走到首 / 末个可聚焦元素时回首尾，
 * 焦点已落在容器外时也拉回容器。二级弹窗是主弹窗的同级节点，
 * 主弹窗的按键监听收不到它的 Tab，因此两处各以自己的容器为根调用。
 */
function trapTabKey(event, container) {
  if (!container) return false;
  const nodes = container.querySelectorAll(FOCUSABLE_SELECTOR);
  if (!nodes.length) return false;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (!container.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  return false;
}

const CloseIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const FolderIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M3 7.5A1.5 1.5 0 014.5 6h4l2 2h7a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0117.5 18h-13A1.5 1.5 0 013 16.5v-9z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

/** 重新读取 package.json 的 scripts。 */
const RefreshIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M20 12a8 8 0 10-2.6 5.9M20 5v5h-5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SCRIPT_CUSTOM_ID = "__custom__";

/** 二级弹窗里可编辑的列表字段：列定义与空行。 */
const LIST_FIELDS = {
  buildArgs: {
    columns: [
      { key: "key", placeholderKey: "project.keyName" },
      { key: "value", placeholderKey: "project.keyValue" },
    ],
    empty: () => ({ key: "", value: "" }),
  },
  ports: {
    columns: [
      { key: "host", placeholderKey: "project.portHost", width: "88px" },
      { key: "container", placeholderKey: "project.portContainer", width: "88px" },
    ],
    empty: () => ({ host: "", container: "", protocol: "tcp" }),
  },
  mounts: {
    columns: [
      { key: "host", placeholderKey: "project.mountHost" },
      { key: "container", placeholderKey: "project.mountTarget" },
      { key: "readOnly", type: "check", labelKey: "project.mountReadOnlyShort" },
    ],
    empty: () => ({ host: "", container: "", readOnly: false }),
  },
  env: {
    columns: [
      { key: "key", placeholderKey: "project.keyName" },
      // 值可能是 PEM 私钥这类多行文本，用文本域保留换行；limit 只用于显示字数，不做截断。
      { key: "value", placeholderKey: "project.keyValue", multiline: true, limit: ENV_VALUE_MAX },
    ],
    empty: () => ({ key: "", value: "" }),
  },
};

/** 「更多参数」下拉：勾选后对应的行才显示，和 IDEA 的 Modify options 一致。 */
function OptionMenu({ t, ids, selected, onToggle, disabled }) {
  const React = getReact();
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState(null);
  const rootRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const ITEM_HEIGHT = 26;
  const MENU_MAX = 260;
  const count = ids.filter((id) => selected.includes(id)).length;

  // 菜单用 fixed 定位：它所在的滚动容器会裁掉 absolute 子元素，
  // 那样向下展开时只能看到头两项。这里按按钮的实际坐标算位置，
  // 下方放不下就往上方展开。
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
      ...(up ? { bottom: Math.max(8, window.innerHeight - rect.top + 4) } : { top: rect.bottom + 4 }),
    });
  }, [ids.length]);

  React.useEffect(() => {
    if (!open) return undefined;
    place();
    // 点击别处关闭；不用全屏遮罩，否则会挡住弹窗内容的滚动。
    const onDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    // 菜单按固定坐标画，容器滚动后位置会漂，直接关掉。
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

  return (
    <div
      className="dk-option-anchor"
      ref={rootRef}
      onKeyDown={(event) => {
        // [UX优化]: 菜单展开时 Esc 先收菜单，不要顺带把整个弹窗关掉。
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      {/* [UX优化]: 原按钮只写「修改」，看不出点开是勾选附加项；补上已启用数量，
          不展开菜单也能判断这一组还有哪些参数在生效。 */}
      <Btn
        size="sm"
        variant="ghost"
        disabled={disabled === true}
        aria-haspopup="true"
        aria-expanded={open ? "true" : "false"}
        title={t("project.modifyOptionsHint")}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{t("project.modifyOptions")}</span>
        <span className="dk-count-pill" data-empty={count ? "0" : "1"} aria-hidden="true">
          {count}
        </span>
      </Btn>
      {open && coords ? (
        <div className="dk-option-menu" ref={menuRef} style={coords} role="menu">
          {ids.map((id) => (
            <label className="dk-option-item" key={id}>
              <input type="checkbox" checked={selected.includes(id)} onChange={() => onToggle(id)} />
              <span>{t(`project.option.${id}`)}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const summarize = (rows, mapper) => {
  const parts = (rows || []).map(mapper).filter(Boolean);
  return parts.join(", ");
};

/** 列表型字段（端口 / 挂载 / 环境变量）的编辑入口：用列表图标，别再借用文件夹图标。 */
const ListIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M8 7h12M8 12h12M8 17h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="4" cy="7" r="1.2" fill="currentColor" />
    <circle cx="4" cy="12" r="1.2" fill="currentColor" />
    <circle cx="4" cy="17" r="1.2" fill="currentColor" />
  </svg>
);

const EyeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M2.6 12S6.1 5.6 12 5.6 21.4 12 21.4 12S17.9 18.4 12 18.4 2.6 12 2.6 12z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);

const EyeOffIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path
      d="M10.6 10.7a2.6 2.6 0 003.6 3.6M7 7.1C4.3 8.9 2.6 12 2.6 12S6.1 18.4 12 18.4c1.4 0 2.7-.4 3.8-1"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9.6 6c.8-.3 1.6-.4 2.4-.4 5.9 0 9.4 6.4 9.4 6.4a18 18 0 01-3 3.7"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** 名称看起来像口令时默认遮罩显示：只影响展示，不改存储的值。 */
const looksSecret = (key) =>
  /(?:^|_)(?:PASS|PASSWD|PASSWORD|PWD|SECRET|TOKEN|CREDENTIAL|PRIVATE|KEY)(?:_|$)/i.test(String(key || ""));

/** 引号感知的切词：只在引号外按空白切分，成对引号会被去掉。
 *  返回 null 表示引号未闭合，调用方据此整段拒绝，避免半截值被静默存进去。 */
const tokenizeCommand = (text) => {
  const tokens = [];
  let buf = "";
  let quote = "";
  let started = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        quote = "";
        continue;
      }
      // 双引号内保留 \" 与 \\ 的转义语义；单引号内一律原样，与 shell 一致。
      if (quote === '"' && ch === "\\" && i + 1 < text.length) {
        const next = text[i + 1];
        if (next === '"' || next === "\\") {
          buf += next;
          i += 1;
          continue;
        }
      }
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        tokens.push(buf);
        buf = "";
        started = false;
      }
      continue;
    }
    buf += ch;
    started = true;
  }
  if (quote) return null;
  if (started) tokens.push(buf);
  return tokens;
};

/** -e / --env 标记本身，以及 --env=KEY=VALUE 这种内联写法。 */
const ENV_FLAG = /^--?(?:env|e)$/i;
const ENV_INLINE_FLAG = /^--?(?:env|e)=(.+)$/i;
/** .env 写法：行首就是 KEY=VALUE（可带 export），值允许含空格，必须按整行原文保留。 */
const ENV_LINE = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/;

/** .env 行只有「值的第一个字符是引号」才需要找闭合引号；值中间的撇号按字面处理。
 *  返回该引号字符，值不以引号开头时返回空串。 */
const envValueOpenQuote = (line) => {
  const text = String(line || "");
  const eq = text.indexOf("=");
  if (eq === -1) return "";
  const value = text.slice(eq + 1).trimStart();
  return value[0] === '"' || value[0] === "'" ? value[0] : "";
};

/** 引号未闭合时，下一行若是新的变量声明就不该继续并入多行值。 */
const startsEntry = (line) => {
  const body = String(line || "").trim();
  if (!body || body.startsWith("#")) return true;
  return ENV_LINE.test(body) || /^--?(?:env|e)(?:\s|=|$)/i.test(body);
};

/**
 * 解析粘贴的文本：每行一条，兼容 .env 文件、export 写法与 docker run 里的 -e 片段。
 * 不能按值里出现的 " -e " 切行：那样会把尾部参数并进值、把引号内的内容截断。
 * 注释与空行跳过；识别不出变量的行与引号不配对的片段单独收集，
 * 由调用方明确告知「忽略了几行」，不静默吞掉。
 * 没有等号的 -e KEY 是 docker 的「从环境继承」，单独收集，不能落成空值。
 */
const parseEnvLines = (text) => {
  const rows = [];
  const skipped = [];
  const inherited = [];
  const pushRow = (assignment, stripQuotes) => {
    const eq = assignment.indexOf("=");
    const key = (eq === -1 ? assignment : assignment.slice(0, eq)).trim();
    let value = eq === -1 ? "" : assignment.slice(eq + 1);
    // 从命令行复制时常带成对引号：去掉引号，避免引号被当成值的一部分存进去。
    if (stripQuotes) {
      const quoted = value.trim();
      if (quoted.length > 1 && (quoted[0] === '"' || quoted[0] === "'") && quoted.endsWith(quoted[0])) {
        value = quoted.slice(1, -1);
      }
    }
    if (!BUILD_ARG_KEY.test(key)) {
      skipped.push(assignment.trim());
      return false;
    }
    // 没有等号时 docker 是去客户端环境里取同名变量，和显式空值不同：
    // 只记下名称交给调用方提示，不生成表格行，避免语义被改写。
    if (eq === -1) {
      inherited.push(key);
      return false;
    }
    rows.push({ key, value });
    return true;
  };

  const lines = String(text || "").split(/\r?\n/);
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at].trim();
    if (!line || line.startsWith("#")) continue;
    // 引号跨行时把后续行并回同一个逻辑行：多行值整段保留，不拆散、不丢行。
    // .env 行只有「值以引号开头」才可能跨行；值中间的撇号（don't）按字面处理，
    // 不先过一遍 shell 引号校验，否则合法值会被整行丢弃，或与后续行拼成含换行的错误值。
    let block = line;
    let tokens;
    if (ENV_LINE.test(line) && !envValueOpenQuote(line)) {
      tokens = [];
    } else {
      tokens = tokenizeCommand(block);
      while (!tokens && at + 1 < lines.length && !startsEntry(lines[at + 1])) {
        at += 1;
        block += `\n${lines[at]}`;
        tokens = tokenizeCommand(block);
      }
    }
    if (!tokens) {
      skipped.push(block);
      continue;
    }
    // .env 写法优先按整行原文解析：值里的空格与「 -e 」都是值的一部分。
    if (ENV_LINE.test(block)) {
      pushRow(block.replace(/^export\s+/i, "").trim(), true);
      continue;
    }
    // docker run 写法按词解析：只有紧跟 -e/--env 的那一个词才是变量，
    // 镜像名等尾部参数不再并入上一条的值，值内部的「 -e 」也不会被切开。
    const before = skipped.length;
    const beforeInherited = inherited.length;
    let produced = false;
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      const inline = token.match(ENV_INLINE_FLAG);
      if (inline) {
        if (pushRow(inline[1], false)) produced = true;
        continue;
      }
      if (!ENV_FLAG.test(token)) continue;
      const next = tokens[i + 1];
      if (next === undefined || ENV_FLAG.test(next) || ENV_INLINE_FLAG.test(next)) {
        skipped.push(token);
        continue;
      }
      i += 1;
      if (pushRow(next, false)) produced = true;
    }
    // 继承形态也算「认出了这一行」，否则会被重复计入 skipped。
    if (!produced && skipped.length === before && inherited.length === beforeInherited) skipped.push(block);
  }
  return { rows, skipped, inherited };
};

/** 被忽略行的摘要：折叠换行并截断，避免单行提示条被多行原文撑变形。 */
const describeSkipped = (items) => {
  const list = (items || [])
    .map((item) => {
      const flat = String(item || "").replace(/\s*\n\s*/g, " ").trim();
      if (!flat) return "";
      return flat.length > 40 ? `${flat.slice(0, 40)}…` : flat;
    })
    .filter(Boolean);
  const head = list.slice(0, 2).join(" / ");
  return list.length > 2 ? `${head} …` : head;
};

/** 按变量名合并：同名覆盖原位置（运行时也是最后一条生效），其余追加，返回新增 / 覆盖条数用于反馈。 */
const mergeEnvRows = (base, incoming) => {
  const next = (base || []).map((row) => ({ ...row }));
  const indexByKey = new Map();
  next.forEach((row, at) => {
    const key = String(row.key || "").trim();
    if (key) indexByKey.set(key, at);
  });
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    const at = indexByKey.get(item.key);
    if (at === undefined) {
      indexByKey.set(item.key, next.length);
      next.push({ ...item });
      added += 1;
    } else {
      next[at] = { ...next[at], key: item.key, value: item.value };
      updated += 1;
    }
  }
  return { next, added, updated };
};

/**
 * 环境变量的值输入：单行 34px 起，按换行数增高到 4 行上限，超出内部滚动。
 * 关闭自动换行（wrap="off"）：短值不会折成两行把行高撑歪；
 * 横向滚动条在样式里隐藏，长值仍可用滚轮 / 方向键横向查看，不再压住文字。
 */
function EnvValueField({ t, value, valueMax, masked, onUpdate, onEnter, bindRef }) {
  const React = getReact();
  const count = normalizeEnvValue(value).length;
  const lines = Math.min(4, Math.max(1, String(value).split("\n").length));

  return (
    <div className="dk-env-value">
      <textarea
        ref={bindRef}
        className={masked ? "dk-input dk-env-input dk-env-masked" : "dk-input dk-env-input"}
        rows={1}
        wrap="off"
        spellCheck={false}
        aria-label={t("project.keyValue")}
        placeholder={t("project.envValuePlaceholder")}
        value={value}
        // [UX优化]: 高度由行数直接决定，单行也留出滚动条位置的余量，正文不再被挡
        style={{ height: `${lines * 18 + 16}px` }}
        onChange={(event) => onUpdate(event.target.value)}
        onKeyDown={(event) => {
          // 输入法组合期间的回车属于确认候选词，不能当成提交。
          if (event.nativeEvent && event.nativeEvent.isComposing) return;
          // 值里还没有换行时 Enter 直接开下一条；Shift + Enter 或已有多行内容时保留换行。
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !String(value).includes("\n")
          ) {
            event.preventDefault();
            onEnter();
          }
        }}
      />
      {count > valueMax * 0.6 ? (
        <span className="dk-env-count" data-over={count > valueMax ? "1" : "0"}>
          {t("project.envChars", { count, max: valueMax })}
        </span>
      ) : null}
    </div>
  );
}

/**
 * 环境变量编辑器：一行一条，值默认单行，只有多行内容才增高。
 * 支持批量粘贴（.env 文件 / docker run 的 -e 片段）、名称即时校验、同名提示、删除后可撤销。
 */
// 值去向决定文案：运行环境变量以 -e 进远端 docker run，前置构建的 env 只进本机构建子进程的环境块。
// 两处共用本组件，提示键因此由调用方指定，默认值保持运行环境变量的现有说法。
function EnvListEditor({
  t,
  rows,
  onChange,
  valueMax = ENV_VALUE_MAX,
  totalMax = ENV_TOTAL_MAX,
  totalUnit = "bytes",
  emptyHintKey = "project.envEmptyHint",
  hintKey = "project.envSecretHintShort",
}) {
  const React = getReact();
  const [importOpen, setImportOpen] = React.useState(false);
  const [importText, setImportText] = React.useState("");
  // [UX优化]: 默认明文显示。这个弹窗的首要任务是核对 key/value，整列圆点反而难读；
  // 口令类变量在行尾提供「隐藏值」，需要时再自行遮罩。
  // [缺陷修复]: 遮罩归属按变量名记录（原按行索引记录，插入 / 删除 / 撤销后索引位移，
  // 遮罩会落到别的行上：口令变明文、未点过的口令被误遮罩）。改名即换归属，行移动不影响。
  const [hidden, setHidden] = React.useState(() => new Set());
  const [undo, setUndo] = React.useState(null);
  const [flash, setFlash] = React.useState("");
  const [focusRow, setFocusRow] = React.useState(-1);
  const keyRefs = React.useRef([]);
  const valueRefs = React.useRef([]);
  const undoTimer = React.useRef(null);
  const flashTimer = React.useRef(null);

  React.useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    []
  );

  // 新增一行后把焦点落到名称上：连续录入不用每次手动点。
  React.useEffect(() => {
    if (focusRow < 0) return;
    keyRefs.current[focusRow]?.focus();
    setFocusRow(-1);
  }, [focusRow, rows.length]);

  const say = (text) => {
    setFlash(text);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(""), 5000);
  };

  const patchRow = (index, next) => {
    onChange(rows.map((row, at) => (at === index ? { ...row, ...next } : row)));
  };

  /** 遮罩开关：按变量名记录，同名变量共用（重复名本就有提示，不需要各自独立控制）。 */
  const toggleHidden = (name) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const addRow = (after = rows.length - 1) => {
    const at = Math.min(after + 1, rows.length);
    const next = [...rows];
    next.splice(at, 0, { key: "", value: "" });
    onChange(next);
    setFocusRow(at);
    setUndo(null);
  };

  const removeRow = (index) => {
    const removed = rows[index];
    onChange(rows.filter((_, at) => at !== index));
    // 删除不弹确认框：改成一次可撤销，误删的成本比每次点确认更低。
    setUndo({ row: removed, index });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  };

  const undoRemove = () => {
    if (!undo) return;
    const next = [...rows];
    next.splice(Math.min(undo.index, next.length), 0, undo.row);
    onChange(next);
    setUndo(null);
  };

  /** 继承形态（-e KEY）不进表格：回显名称，并说明该写法要写进运行选项才生效。 */
  const inheritNote = (names) => {
    const head = names.slice(0, 5).join(", ");
    return t("project.envImportInherit", {
      count: names.length,
      names: names.length > 5 ? `${head}…` : head,
    });
  };

  /** 批量导入：同名覆盖、其余追加，并把「新增 / 覆盖 / 忽略 / 未导入的继承写法」如实说一遍。 */
  const importRows = (raw) => {
    const parsed = parseEnvLines(raw);
    if (!parsed.rows.length) {
      const notes = [t("project.envImportNone")];
      if (parsed.skipped.length)
        notes.push(
          t("project.envImportIgnoredLines", {
            count: parsed.skipped.length,
            lines: describeSkipped(parsed.skipped),
          })
        );
      if (parsed.inherited.length) notes.push(inheritNote(parsed.inherited));
      say(notes.join(" · "));
      return false;
    }
    const merged = mergeEnvRows(rows, parsed.rows);
    onChange(merged.next);
    const head = merged.updated
      ? t("project.envImportedUpdated", { count: merged.added + merged.updated, updated: merged.updated })
      : t("project.envImported", { count: merged.added });
    const notes = [head];
    if (parsed.skipped.length)
      notes.push(
        t("project.envImportIgnoredLines", {
          count: parsed.skipped.length,
          lines: describeSkipped(parsed.skipped),
        })
      );
    if (parsed.inherited.length) notes.push(inheritNote(parsed.inherited));
    say(notes.join(" · "));
    return true;
  };

  const preview = parseEnvLines(importText);

  const keyCounts = {};
  rows.forEach((row) => {
    const key = String(row.key || "").trim();
    if (key) keyCounts[key] = (keyCounts[key] || 0) + 1;
  });

  const used = rows.reduce((sum, row) => {
    const key = String(row.key || "").trim();
    const value = normalizeEnvValue(row.value);
    return totalUnit === "bytes" ? sum + utf8Bytes(key) + utf8Bytes(value) : sum + key.length + value.length + 1;
  }, 0);
  const usedText = totalUnit === "bytes" ? Math.round((used / 1024) * 10) / 10 : used;

  return (
    <div className="dk-env">
      <div className="dk-env-toolbar">
        <span>{t("project.envCount", { count: rows.length })}</span>
        <span className="dk-env-sep" aria-hidden="true">
          ·
        </span>
        <span className="dk-env-usage" data-over={used > totalMax ? "1" : "0"}>
          {totalUnit === "bytes"
            ? t("project.envUsageBytes", { used: usedText, max: totalMax / 1024 })
            : t("project.envUsageChars", { used: usedText, max: totalMax })}
        </span>
        {flash ? (
          <span className="dk-env-flash" role="status">
            {flash}
          </span>
        ) : null}
        <span className="dk-head-spacer" />
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => {
            setImportOpen((open) => !open);
            setImportText("");
          }}
        >
          {t("project.envImport")}
        </Btn>
      </div>

      {importOpen ? (
        <div className="dk-env-import">
          <textarea
            className="dk-input dk-textarea"
            rows={4}
            spellCheck={false}
            autoFocus
            value={importText}
            placeholder={t("project.envImportPlaceholder")}
            aria-label={t("project.envImportTitle")}
            onChange={(event) => setImportText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setImportOpen(false);
              }
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                if (importRows(importText)) {
                  setImportText("");
                  setImportOpen(false);
                }
              }
            }}
          />
          <div className="dk-env-import-foot">
            <span className="dk-note">
              {preview.rows.length || preview.inherited.length
                ? [
                    preview.rows.length ? t("project.envImportCount", { count: preview.rows.length }) : "",
                    preview.skipped.length
                      ? t("project.envImportIgnoredLines", {
                          count: preview.skipped.length,
                          lines: describeSkipped(preview.skipped),
                        })
                      : "",
                    preview.inherited.length ? inheritNote(preview.inherited) : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : t("project.envImportHint")}
            </span>
            <span className="dk-head-spacer" />
            <Btn size="sm" variant="ghost" onClick={() => setImportOpen(false)}>
              {t("project.configCancel")}
            </Btn>
            <Btn
              size="sm"
              variant="primary"
              disabled={preview.rows.length === 0}
              onClick={() => {
                if (!importRows(importText)) return;
                setImportText("");
                setImportOpen(false);
              }}
            >
              {t("project.envImportAction")}
            </Btn>
          </div>
          <div className="dk-note">{t("project.envImportHint")}</div>
        </div>
      ) : null}

      {rows.length === 0 && !importOpen ? (
        <div className="dk-env-empty">
          <div className="dk-env-empty-title">{t("project.envEmptyTitle")}</div>
          <div className="dk-note">{t(emptyHintKey)}</div>
          <div className="dk-env-empty-actions">
            <Btn size="sm" variant="primary" onClick={() => addRow()}>
              {`+ ${t("project.envAddRow")}`}
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
              {t("project.envImport")}
            </Btn>
          </div>
        </div>
      ) : null}

      {rows.length ? (
        <div className="dk-env-head" aria-hidden="true">
          <span>{t("project.keyName")}</span>
          <span>{t("project.keyValue")}</span>
        </div>
      ) : null}

      <div className="dk-env-list">
        {rows.map((row, index) => {
          const keyText = String(row.key || "").trim();
          const invalid = keyText.length > 0 && !BUILD_ARG_KEY.test(keyText);
          const duplicate = keyText.length > 0 && keyCounts[keyText] > 1;
          const secret = looksSecret(keyText);
          const masked = secret && hidden.has(keyText);
          return (
            <div className="dk-env-row" key={`env-${index}`}>
              <input
                ref={(node) => {
                  keyRefs.current[index] = node;
                }}
                className="dk-input dk-env-key"
                data-invalid={invalid ? "1" : "0"}
                value={row.key}
                title={row.key || undefined}
                placeholder={t("project.envKeyPlaceholder")}
                spellCheck={false}
                autoComplete="off"
                aria-label={t("project.keyName")}
                aria-invalid={invalid ? "true" : undefined}
                onChange={(event) => patchRow(index, { key: event.target.value })}
                onKeyDown={(event) => {
                  // 输入法组合期间的回车属于确认候选词，不能当成提交。
                  if (event.nativeEvent && event.nativeEvent.isComposing) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    valueRefs.current[index]?.focus();
                  } else if (event.key === "Backspace" && !row.key && !row.value) {
                    // 空行上按退格直接删掉，和常见编辑器一致，省一次移开鼠标。
                    event.preventDefault();
                    removeRow(index);
                  }
                }}
                onPaste={(event) => {
                  const text = event.clipboardData?.getData("text") || "";
                  // 多行内容粘在名称框里就是批量导入，不必先找到「批量导入」按钮。
                  if (text.includes("\n") && text.includes("=")) {
                    event.preventDefault();
                    // [缺陷修复]: 一条都解析不出来时不能只弹提示就结束——原文既没进名称框
                    // （已被 preventDefault 拦下），也没进导入面板，等于把剪贴板内容吞掉了。
                    // 改为把原文转进导入面板，用户可对照预览修好再导入。
                    if (!importRows(text)) {
                      setImportText(text);
                      setImportOpen(true);
                    }
                  }
                }}
              />
              <EnvValueField
                t={t}
                value={row.value}
                valueMax={valueMax}
                masked={masked}
                bindRef={(node) => {
                  valueRefs.current[index] = node;
                }}
                onUpdate={(value) => patchRow(index, { value })}
                onEnter={() => addRow(index)}
              />
              {secret ? (
                <button
                  type="button"
                  className="dk-icon-btn dk-icon-btn-lg"
                  title={masked ? t("project.envReveal") : t("project.envHide")}
                  aria-label={`${masked ? t("project.envReveal") : t("project.envHide")}: ${keyText}`}
                  onClick={() => toggleHidden(keyText)}
                >
                  {masked ? <EyeIcon /> : <EyeOffIcon />}
                </button>
              ) : (
                // 非口令变量不显示眼睛按钮，但保留空列，保证每一行的删除按钮都对齐
                <span className="dk-env-slot" aria-hidden="true" />
              )}
              <button
                type="button"
                className="dk-icon-btn dk-icon-btn-lg"
                title={t("project.removeRow")}
                aria-label={keyText ? `${t("project.removeRow")}: ${keyText}` : t("project.removeRow")}
                onClick={() => removeRow(index)}
              >
                <CloseIcon />
              </button>
              {invalid || duplicate ? (
                <div className="dk-env-hint" data-kind={invalid ? "error" : "warn"}>
                  {invalid ? t("project.envInvalid") : t("project.envDuplicate")}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {rows.length ? (
        <div className="dk-env-foot">
          <Btn size="sm" variant="ghost" onClick={() => addRow()}>
            {`+ ${t("project.envAddRow")}`}
          </Btn>
          <span className="dk-head-spacer" />
          <span className="dk-note">{t("project.envKeyRule")}</span>
        </div>
      ) : null}

      {undo ? (
        <div className="dk-env-undo" role="status">
          <span>{t("project.envUndo", { key: undo.row?.key || t("project.keyName") })}</span>
          <Btn size="sm" variant="ghost" onClick={undoRemove}>
            {t("project.envUndoAction")}
          </Btn>
        </div>
      ) : null}

      {rows.length ? <div className="dk-note">{t(hintKey)}</div> : null}
    </div>
  );
}

/**
 * files: [{ path, relative, name, depth, manual, missing }]
 * runConfigSummaries: { [path]: { name, tag, platform, serverId, ... } }
 * servers: [{ id, name, host, username }]
 * onLoadConfig(path) 读取一条运行配置的完整内容：扫描只回摘要，env 等值不随列表下发
 * onSave(path, config, previousPath) / onRemove(path) / onAdd(path) 失败时抛错，由本组件展示
 */
export function ConfigDialog({
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
  onClose,
}) {
  const React = getReact();
  const [selected, setSelected] = React.useState("");
  const [drafts, setDrafts] = React.useState({});
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [add, setAdd] = React.useState({ open: false, path: "", error: "" });
  const [editor, setEditor] = React.useState(null);
  /** 二级弹窗里有未应用的修改时，第一次 Esc 只提示，第二次才丢弃。 */
  const [escWarn, setEscWarn] = React.useState(false);
  const [scripts, setScripts] = React.useState({ loading: false, list: [], missing: false, error: "", path: "" });
  const [scriptCustom, setScriptCustom] = React.useState(false);
  /** 正在按路径读取完整配置的文件；读取完成前不允许保存，避免把空草稿写回。 */
  const [loadingPath, setLoadingPath] = React.useState("");
  /** 读取失败的配置路径：状态条据此区分「正在读取」与「读取失败」。 */
  const [loadFailedPath, setLoadFailedPath] = React.useState("");
  /** 读取失败后的重试计数：变化即重新触发一次按需读取。 */
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const loadSeq = React.useRef(0);
  const maskRef = React.useRef(null);
  const modalRef = React.useRef(null);
  /** 二级弹窗容器：Tab 圈定以它自身为根，不用主弹窗的根。 */
  const subdialogRef = React.useRef(null);
  const nameRef = React.useRef(null);
  const errorRef = React.useRef(null);
  /** [UX优化]: 打开前的焦点位置，关闭后还回去，键盘用户不会掉回窗口开头。 */
  const restoreFocusRef = React.useRef(null);
  /** 每份配置载入时的快照，用来判断「有未保存的修改」。 */
  const baselineRef = React.useRef({});
  const [closeWarn, setCloseWarn] = React.useState(false);
  /** 「保存并关闭」时其它配置还有未保存的修改：>0 表示已保存当前份，再点一次才丢弃它们。 */
  const [othersWarn, setOthersWarn] = React.useState(0);
  const [savedFlash, setSavedFlash] = React.useState("");
  const [filter, setFilter] = React.useState("");

  /**
   * 兜底：宿主某些主题会给面板祖先加上 transform / backdrop-filter / contain，
   * 这些值会为 fixed 后代创建包含块，弹窗就被困在面板里。这里在挂载后逐个清掉，
   * 并把面板提到最上层；卸载时原样还原。样式表里已有 :has 规则做同样的事。
   */
  React.useEffect(() => {
    const node = maskRef.current;
    if (!node) return undefined;
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
        zIndex: el.style.zIndex,
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

  // 列表变化（重扫 / 新增 / 删除）时清掉已消失的草稿；草稿在选中该文件时按需加载。
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
      // 没有变化就返回原引用：files 为空数组时也照常渲染，避免状态被反复替换。
      return changed ? next : prev;
    });
  }, [files]);

  // 选中项还没有草稿时按路径取完整配置：列表只回摘要，env 等值不常驻面板 state。
  React.useEffect(() => {
    if (!selected || drafts[selected] || !onLoadConfig) return undefined;
    const seq = ++loadSeq.current;
    const path = selected;
    setLoadingPath(path);
    setLoadFailedPath("");
    let cancelled = false;
    (async () => {
      try {
        const data = await onLoadConfig(path);
        if (cancelled || seq !== loadSeq.current) return;
        const file = files.find((item) => item.path === path) || {
          path,
          relative: baseName(path),
          name: baseName(path),
          depth: 0,
        };
        // 快照与草稿一起生成，保证「未保存」判断和表单初值完全一致。
        const loaded = draftFromConfig(file, data?.config || null, projectName);
        baselineRef.current[path] = JSON.stringify(loaded);
        setDrafts((prev) => (prev[path] ? prev : { ...prev, [path]: loaded }));
      } catch (cause) {
        // 记下失败的路径：状态条据此显示「读取失败 + 重试」，不再谎报正在读取。
        if (!cancelled && seq === loadSeq.current) {
          setLoadFailedPath(path);
          setError(String(cause?.message || cause));
        }
      } finally {
        if (!cancelled && seq === loadSeq.current) setLoadingPath("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, drafts, files, projectName, onLoadConfig, loadAttempt]);

  // 选中项：优先用调用方指定的文件，它被删掉后回退到第一个。
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
    if (!confirmRemove) return undefined;
    const timer = setTimeout(() => setConfirmRemove(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmRemove]);

  React.useEffect(() => {
    if (!escWarn) return undefined;
    const timer = setTimeout(() => setEscWarn(false), 3500);
    return () => clearTimeout(timer);
  }, [escWarn]);

  // 关闭提示同样自动回落，避免提示一直挂着挡住按钮区。
  React.useEffect(() => {
    if (!closeWarn) return undefined;
    const timer = setTimeout(() => setCloseWarn(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [closeWarn]);

  // 「其它配置还有未保存的修改」同口径回落：提示挂太久会让下一次点击变成无条件丢弃。
  React.useEffect(() => {
    if (!othersWarn) return undefined;
    const timer = setTimeout(() => setOthersWarn(0), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [othersWarn]);

  // 「已保存」是一次性反馈：2.4 秒后自动淡出，不占住底栏。
  React.useEffect(() => {
    if (!savedFlash) return undefined;
    const timer = setTimeout(() => setSavedFlash(""), 2400);
    return () => clearTimeout(timer);
  }, [savedFlash]);

  /** [UX优化]: 打开时把焦点收进弹窗（优先当前配置的名称框），关闭时归还，
   *  否则 Tab 会先跑到弹窗背后的面板按钮上。 */
  React.useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    const timer = setTimeout(() => {
      const root = modalRef.current;
      const name = nameRef.current;
      // 配置还在读取时名称框是禁用的，此时退回到左栏当前项，焦点仍停在弹窗内。
      const node =
        (name && !name.disabled ? name : null) ||
        root?.querySelector(".dk-config-item[data-active='1']") ||
        root?.querySelector("button:not(:disabled), input:not(:disabled)");
      if (node && typeof node.focus === "function") node.focus();
    }, 30);
    return () => {
      clearTimeout(timer);
      const back = restoreFocusRef.current;
      if (back && typeof back.focus === "function" && document.contains(back)) back.focus();
    };
  }, []);

  /**
   * 二级弹窗是主弹窗的同级节点：焦点不搬进去，Esc / Tab 就还归主弹窗处理。
   * 打开时把焦点放到容器内第一个可聚焦元素，容器自身（tabIndex=-1）兜底；
   * 编辑过程中 editor 对象会被频繁替换，只在切换字段或类型时重新定位。
   */
  React.useEffect(() => {
    if (!editor) return;
    const node = subdialogRef.current;
    if (!node) return;
    const body = node.querySelector(".dk-subdialog-body") || node;
    const target = body.querySelector(FOCUSABLE_SELECTOR) || node;
    if (target && typeof target.focus === "function") target.focus();
  }, [editor?.field, editor?.kind]);

  const current = files.find((file) => file.path === selected) || null;
  const draft = (selected && drafts[selected]) || emptyDraft();
  /** 完整配置已取回才允许保存：摘要对象不含 env 等值，直接写回会清空已存配置。 */
  const configReady = Boolean(selected && drafts[selected]);
  /**
   * 完整配置未就绪时锁住表单：此时表单里的值只是空草稿，任何输入都会顶掉
   * 随后返回的服务端配置。没有按需读取能力时保持可编辑，与旧行为一致。
   */
  const locked = Boolean(selected && onLoadConfig) && !configReady;
  /**
   * 读取失败必须与「正在读取」分开表达：失败后草稿仍未写入，locked 继续为真
   * （此时放开编辑会让空表单写回、清掉已存配置），但状态条不能再显示正在读取。
   */
  const loadFailed = Boolean(selected && onLoadConfig) && !configReady && loadFailedPath === selected;
  /** 只有请求确实在途时才渲染脉动点，避免失败后看起来还在读。 */
  const loadingSelected = Boolean(selected) && loadingPath === selected;
  const loadingConfig = locked && !loadFailed;

  /**
   * [UX优化]: 有未保存的修改时给出明确提示，并在关闭前拦一次。
   * 快照在载入时记录，逐字段比较即可；按全部草稿统计，切换过文件也不会漏掉别的项。
   */
  const isPending = (path) => {
    const base = baselineRef.current[path];
    return Boolean(base && drafts[path]) && JSON.stringify(drafts[path]) !== base;
  };

  /**
   * 直接由草稿与快照派生，不再用 state 手动同步：保存只更新 baselineRef（ref 不触发重渲染），
   * 用 state 时保存后必须顺手清零，会把其它配置的未保存修改一起抹掉。
   */
  const dirty = Object.keys(drafts).some((path) => isPending(path));

  // 草稿全部干净了（逐份应用过，或重新扫描把草稿清掉）就没有可丢弃的内容，提示随之下线。
  React.useEffect(() => {
    if (othersWarn && !dirty) setOthersWarn(0);
  }, [othersWarn, dirty]);

  /** 容器名称与镜像标记是最容易出错的必填项：输入过程中就校验，不等点保存。 */
  const containerNameValue = String(draft.containerName || "").trim();
  const containerNameInvalid = Boolean(containerNameValue) && !CONTAINER_NAME.test(containerNameValue);
  const tagMissing = configReady && !String(draft.tag || "").trim();

  /** Esc / 右上角关闭 / 点遮罩共用：有未保存修改时先提示一次，再操作才丢弃。 */
  const requestClose = () => {
    if (dirty && !closeWarn) {
      setCloseWarn(true);
      return;
    }
    onClose();
  };

  const revealError = () => {
    if (typeof requestAnimationFrame !== "function") return;
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: "nearest" }));
  };

  /**
   * [UX优化]: 弹窗级快捷键与焦点圈定。原来只能靠鼠标：Esc 不生效、
   * Ctrl+Enter 不能保存、Tab 会跑到弹窗背后的面板上。
   */
  const onModalKeyDown = (event) => {
    if (event.key === "Escape") {
      // 二级弹窗打开时 Esc 归它处理：主弹窗不能再顺手把整个弹窗关掉。
      if (editor) {
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (configReady && !busy) void commit("save");
      return;
    }
    if ((event.key === "s" || event.key === "S") && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (configReady && !busy) void commit("apply");
      return;
    }
    if (event.key !== "Tab") return;
    // 二级弹窗打开时按键归它自己圈定，主弹窗不再抢（两者是同级节点）。
    if (editor) return;
    trapTabKey(event, modalRef.current);
  };
  /**
   * 构建前步骤的脏检查：两侧都以 emptyPreBuild 拉平键集合、env 行归一为 key/value，
   * 再逐字段比较。既不依赖键顺序，也不会被缺省字段或历史配置里的多余键顶成误报。
   */
  const preBuildDirty = (left, right) => {
    const base = emptyPreBuild();
    const normalize = (source) => {
      const merged = { ...base, ...(source || {}) };
      merged.env = (merged.env || []).map((row) => ({
        key: String(row?.key ?? ""),
        value: String(row?.value ?? ""),
      }));
      return merged;
    };
    const a = normalize(left);
    const b = normalize(right);
    return Object.keys(base).some((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
  };

  /**
   * 二级弹窗里是否有未应用的修改：列表、单值、表单三类都参与比较。
   * 表单类（构建前步骤）与草稿同构后再逐字段比，改了 goals / env / cwd / 脚本名都能拦下。
   */
  const editorDirty = Boolean(editor) && (() => {
    if (editor.kind === "list") {
      return JSON.stringify(editor.rows) !== JSON.stringify(draft[editor.field] || []);
    }
    if (editor.kind === "text") {
      return String(editor.value || "") !== String(draft[editor.field] || "");
    }
    if (editor.kind === "form") {
      return preBuildDirty(editor.value, draft[editor.field]);
    }
    return false;
  })();

  /** Esc / 点遮罩关闭：有未应用的修改先提示一次，再按一次才丢弃。 */
  const requestCloseEditor = () => {
    if (editorDirty && !escWarn) {
      setEscWarn(true);
      return;
    }
    setEscWarn(false);
    setEditor(null);
  };
  const serverOptions = [
    ...(draft.serverId ? [] : [{ value: "", label: t("target.choose") }]),
    ...servers.map((item) => ({
      value: item.id,
      label: item.name || `${item.username || "root"}@${item.host || ""}`,
    })),
  ];
  const has = (id) => draft.options.includes(id);

  /** 构建前步骤的只读摘要：npm run build / Maven -B clean package。 */
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
    { value: "maven", label: "Maven" },
  ];

  const packageManagerOptions = [
    { value: "npm", label: "npm" },
    { value: "yarn", label: "yarn" },
    { value: "pnpm", label: "pnpm" },
  ];

  const npmCommandOptions = NPM_COMMANDS.map((id) => ({ value: id, label: id }));

  /** 脚本下拉：package.json 里的 scripts + 当前值（旧值可能不在列表）+ 「自定义」。 */
  const scriptOptions = (() => {
    const list = [...scripts.list];
    const current = String(editor?.value?.script || "");
    if (current && !list.includes(current)) list.unshift(current);
    return [
      ...list.map((name) => ({ value: name, label: name })),
      { value: SCRIPT_CUSTOM_ID, label: t("project.scriptCustom") },
    ];
  })();

  const patch = (next) => {
    // 完整配置还没取回时不写草稿：先写进去会占住 drafts[path]，
    // 随后返回的服务端配置被判为已有草稿而丢弃，界面上就成了「配置被清空」。
    // 没有按需读取能力时不做拦截，避免退化成「能输入但输入无效」。
    if (selected && onLoadConfig && !drafts[selected]) return;
    setDrafts((prev) => ({ ...prev, [selected]: { ...(prev[selected] || emptyDraft()), ...next } }));
  };

  const toggleOption = (id) => {
    if (has(id)) {
      // 取消勾选即清空该项的数据，避免下次打开时又按数据补勾回来。
      const cleared = {
        platform: { platform: "" },
        buildArgs: { buildArgs: [] },
        noCache: { noCache: false },
        pull: { pull: false },
        ports: { ports: [] },
        mounts: { mounts: [] },
        env: { env: [] },
        runOptions: { runOptions: "" },
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
    setCloseWarn(false);
    setOthersWarn(0);
    setSavedFlash("");
  };

  /** 读取失败后重试：清掉这一份的失败标记与错误提示，再触发一次按需读取。 */
  const retryLoad = () => {
    if (!selected) return;
    setLoadFailedPath("");
    setError("");
    setLoadAttempt((count) => count + 1);
  };

  /**
   * 打开二级弹窗时先清掉上一个编辑器留下的 Esc 警告：警告属于某个编辑器的一次操作，
   * 否则重开编辑器会凭空显示「未应用的修改」，并让首次 Esc 跳过拦截直接丢弃编辑。
   */
  const openTextEditor = (field, title, placeholder) => {
    setEscWarn(false);
    setEditor({ kind: "text", field, title, value: String(draft[field] || ""), placeholder: placeholder || "" });
  };

  const openListEditor = (field, title) => {
    setEscWarn(false);
    setEditor({ kind: "list", field, title, rows: (draft[field] || []).map((row) => ({ ...row })) });
  };

  /** 构建前步骤：一个弹窗里按 IDEA 的 npm / Maven 口径配完整参数。 */
  const openPreBuildEditor = () => {
    const value = { ...emptyPreBuild(), ...(draft.preBuild || {}) };
    value.env = (draft.preBuild?.env || []).map((item) => ({ ...item }));
    setScripts({ loading: false, list: [], missing: false, error: "", path: "" });
    setScriptCustom(false);
    setEscWarn(false);
    setEditor({ kind: "form", field: "preBuild", title: t("project.preBuild"), value });
    if (value.tool === "npm") void loadScripts(value);
  };

  const patchEditorValue = (next) => {
    setEditor((prev) => (prev ? { ...prev, value: { ...prev.value, ...next } } : prev));
  };

  /**
   * package.json 的默认查找目录：工作目录 → 构建上下文 → 项目根 → Dockerfile 所在目录。
   * 项目根优先于 Dockerfile 目录，和 IDEA 的默认行为一致（前端项目常把 package.json 放在根）。
   */
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
        path: data?.path || target,
      });
    } catch (cause) {
      // 后台还是旧版本时这个接口不存在，提示用户重启而不是显示 HTTP 404。
      const text = cause?.code === "HTTP_404" ? t("project.scriptsNeedRestart") : String(cause?.message || cause);
      setScripts({ loading: false, list: [], missing: false, error: text, path: target });
    }
  };

  /** 换工具时补上常用默认值，用户可以直接改。 */
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

  const applyEditor = () => {
    if (!editor) return;
    if (editor.kind === "text") patch({ [editor.field]: editor.value });
    else if (editor.kind === "list") patch({ [editor.field]: editor.rows });
    else patch({ [editor.field]: editor.value });
    // 编辑已应用：本次的 Esc 警告随之作废，不能留到下一个编辑器里。
    setEscWarn(false);
    setEditor(null);
  };

  const commit = async (mode) => {
    if (!selected || !drafts[selected]) return;
    const converted = draftToConfig(draft);
    if (converted.error) {
      setError(t(converted.error, converted.params));
      setSavedFlash("");
      revealError();
      return;
    }
    const previousPath = selected;
    const nextPath = toPosix(draft.dockerfile.trim());
    // 目标路径已经是左栏里的另一份配置：写下去会把它的已存配置与草稿整体覆盖，先拦下。
    // 仅在列表里、从未配置过的文件不算占用，改路径到它仍走原有的迁移流程。
    const targetOccupied =
      nextPath !== previousPath && (Boolean(drafts[nextPath]) || Boolean((runConfigSummaries || {})[nextPath]));
    if (targetOccupied) {
      setError(t("project.dockerfileConflict", { path: nextPath }));
      setSavedFlash("");
      revealError();
      return;
    }
    // 已经提示过「还有其它未保存的配置」且当前这份没有新改动：这次点击就是确认关闭，不再重复写盘。
    if (mode === "save" && othersWarn && !isPending(selected)) {
      onClose();
      return;
    }
    setBusy(mode);
    setError("");
    try {
      await onSave(nextPath, converted.config, previousPath);
      // 路径改过：草稿键与选中项一起搬到新路径，否则左侧仍高亮旧项、再点「应用」会重复迁移。
      // onSave 内部已完成重扫，新路径此刻已经在 files 里。
      if (nextPath !== previousPath) {
        setDrafts((prev) => {
          const next = { ...prev };
          const moved = next[previousPath] || draft;
          delete next[previousPath];
          next[nextPath] = { ...moved, dockerfile: nextPath };
          // 快照跟着走，否则搬完立刻被判定成「有未保存修改」。
          baselineRef.current[nextPath] = JSON.stringify(next[nextPath]);
          delete baselineRef.current[previousPath];
          return next;
        });
        setSelected(nextPath);
        setEditor(null);
      } else {
        baselineRef.current[nextPath] = JSON.stringify(draft);
      }
      if (mode === "save") {
        // 这个按钮只写当前一份：快照已更新后仍然 pending 的其它草稿会随关闭丢失，先要一次确认。
        const others = Object.keys(drafts).filter(
          (path) => path !== previousPath && path !== nextPath && isPending(path)
        ).length;
        if (others) {
          setOthersWarn(others);
          setSavedFlash("");
          return;
        }
        onClose();
      }
      // [UX优化]: 「应用」不关闭弹窗，必须给回执，否则用户不知道到底存上了没有。
      else {
        setOthersWarn(0);
        setSavedFlash(t("project.savedFlash"));
      }
    } catch (cause) {
      setError(String(cause?.message || cause));
      revealError();
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
      // 删除成功后把当前草稿还原成「未配置」：否则再点应用 / 保存会把旧值重新写回成配置。
      const target = files.find((file) => file.path === selected);
      const reset = target ? draftFromConfig(target, null, projectName) : null;
      if (reset) baselineRef.current[selected] = JSON.stringify(reset);
      else delete baselineRef.current[selected];
      setDrafts((prev) => {
        const next = { ...prev };
        if (reset) next[selected] = reset;
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

  /**
   * 一行「标签 + 值 + 编辑图标」，值在二级弹窗里改；列表型字段传列表图标。
   * [UX优化]: 整行都是按钮，原来只有右侧 26px 的图标可点，鼠标要瞄准两次。
   */
  const valueRow = (label, summary, onEdit, disabled, icon) => (
    <div className="dk-field">
      <span className="dk-meta">{label}</span>
      <button
        type="button"
        className="dk-value dk-value-btn"
        title={summary || t("project.notSet")}
        aria-label={`${t("project.editValue")}: ${label}`}
        disabled={disabled === true}
        onClick={onEdit}
      >
        <span className="dk-value-text" data-empty={summary ? "0" : "1"}>
          {summary || t("project.notSet")}
        </span>
        <span className="dk-icon-btn dk-icon-btn-lg" aria-hidden="true">
          {icon || <FolderIcon />}
        </span>
      </button>
    </div>
  );

  const listConfig = editor && editor.kind === "list" ? LIST_FIELDS[editor.field] : null;
  /** [UX优化]: Dockerfile 多起来后左栏是一条长列表，超过 4 条时出现筛选框。 */
  const filterKeyword = filter.trim().toLowerCase();
  /**
   * 筛选框的显示条件必须与过滤条件同源：只要筛选词真的在生效，就得保留清除入口，
   * 否则文件数降到 4 条及以下时框消失、列表被过滤成空，用户只能关掉弹窗重开。
   */
  const showFileFilter = files.length > 4 || filterKeyword !== "";
  const visibleFiles = (() => {
    if (!filterKeyword) return files;
    return files.filter((file) =>
      `${file.relative} ${file.path} ${drafts[file.path]?.name || ""} ${runConfigSummaries[file.path]?.name || ""}`
        .toLowerCase()
        .includes(filterKeyword)
    );
  })();
  /** 环境变量摘要：值可能是口令，只列前几个名称；数量与名称都比一长串 KEY=*** 更好扫。 */
  const envSummary = (rows) => {
    const keys = (rows || []).map((item) => String(item.key || "").trim()).filter(Boolean);
    if (!keys.length) return "";
    const head = keys.slice(0, 3).join(", ");
    return t("project.envSummary", { count: keys.length, keys: keys.length > 3 ? `${head}…` : head });
  };

  return (
    <div
      className="dk-modal-mask"
      ref={maskRef}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        className="dk-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dk-runconfig-title"
        onKeyDown={onModalKeyDown}
      >
        <div className="dk-modal-head">
          <span className="dk-modal-title" id="dk-runconfig-title">
            {t("project.runConfigs")}
          </span>
          {/* [UX优化]: 标题旁一句话说明「这里改的是什么、影响哪次操作」，不用猜。 */}
          <span className="dk-modal-head-note" title={t("project.runConfigsHint")}>
            {t("project.runConfigsHint")}
          </span>
          <button
            type="button"
            className="dk-icon-btn dk-icon-btn-lg"
            title={t("project.configCancel")}
            aria-label={t("project.configCancel")}
            onClick={requestClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="dk-modal-body">
          <div className="dk-modal-side">
            {/* [UX优化]: 只有真的超过 4 条才默认出现筛选，低频功能不占默认视线；筛选生效时必须保留入口。 */}
            {showFileFilter ? (
              <div className="dk-config-search">
                <input
                  className="dk-input"
                  value={filter}
                  placeholder={t("project.listFilter")}
                  aria-label={t("project.listFilter")}
                  spellCheck={false}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </div>
            ) : null}
            <div className="dk-config-list">
              {visibleFiles.map((file) => {
                const saved = runConfigSummaries[file.path] || null;
                // 正在编辑的项优先显示草稿里的名字，改名时左侧列表立刻跟着变。
                const label = drafts[file.path]?.name || saved?.name || file.relative;
                return (
                  <button
                    key={file.path}
                    type="button"
                    className="dk-config-item"
                    data-active={file.path === selected ? "1" : "0"}
                    data-missing={file.missing ? "1" : "0"}
                    aria-current={file.path === selected ? "true" : undefined}
                    title={file.path}
                    onClick={() => selectFile(file.path)}
                  >
                    <span className="dk-config-item-head">
                      {/* [UX优化]: 该项有未保存修改时点一个小圆点，切走再切回也看得见。 */}
                      {isPending(file.path) ? (
                        <span
                          className="dk-config-item-dot"
                          title={t("project.unsavedBadge")}
                          aria-hidden="true"
                        />
                      ) : null}
                      <span className="dk-config-item-name">{label}</span>
                      {/* [UX优化]: 「这一项存没存过配置」原来要点进去才知道，列表上直接标出来。 */}
                      {saved ? (
                        <span className="dk-config-item-badge" data-tone="ok">
                          {t("project.configured")}
                        </span>
                      ) : null}
                    </span>
                    <span className="dk-config-item-path">
                      {file.missing ? `${t("project.missing")} · ` : ""}
                      {file.relative}
                    </span>
                  </button>
                );
              })}
              {files.length === 0 ? (
                <div className="dk-config-empty">
                  <div className="dk-config-empty-title">{t("project.noFilesTitle")}</div>
                  <div className="dk-note">{t("project.empty")}</div>
                </div>
              ) : null}
              {files.length > 0 && visibleFiles.length === 0 ? (
                <div className="dk-note" role="status">
                  {t("project.listEmptyFiltered")}
                </div>
              ) : null}
            </div>

            <div className="dk-config-add">
              {add.open ? (
                <div className="dk-form">
                  <input
                    className="dk-input"
                    value={add.path}
                    placeholder={t("project.addDockerfileHint")}
                    aria-label={t("project.addDockerfile")}
                    autoFocus
                    spellCheck={false}
                    onChange={(event) => setAdd((prev) => ({ ...prev, path: event.target.value, error: "" }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submitAdd();
                    }}
                  />
                  <div className="dk-actionbar">
                    <Btn size="sm" variant="primary" disabled={busy === "add" || !add.path.trim()} onClick={() => void submitAdd()}>
                      {t("project.add")}
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setAdd({ open: false, path: "", error: "" })}>
                      {t("project.configCancel")}
                    </Btn>
                  </div>
                  {add.error ? (
                    <div className="dk-inline-error" role="alert">
                      {add.error}
                    </div>
                  ) : null}
                </div>
              ) : (
                <Btn size="sm" variant="ghost" onClick={() => setAdd({ open: true, path: "", error: "" })}>
                  {`+ ${t("project.addDockerfile")}`}
                </Btn>
              )}
            </div>
          </div>

          <div className="dk-modal-main">
            {/* [UX优化]: 读取配置期间给出明确状态位，并说清「此刻为什么改不了」，
                否则禁用态的输入框看起来像是坏了。读取失败时换成失败说明与重试入口，
                不再显示「正在读取」，避免与下方错误信息自相矛盾。 */}
            {loadFailed ? (
              <div className="dk-statusbar" data-tone="error" role="status">
                <span>{t("project.configLoadFailed")}</span>
                <span className="dk-note">{t("project.configLoadFailedHint")}</span>
                <Btn size="sm" variant="ghost" title={t("project.configReloadHint")} onClick={retryLoad}>
                  {t("project.configReload")}
                </Btn>
              </div>
            ) : loadingConfig ? (
              <div className="dk-statusbar" role="status">
                {loadingSelected ? <span className="dk-skeleton-dot" aria-hidden="true" /> : null}
                <span>{t("project.configLoading")}</span>
                <span className="dk-note">{t("project.lockedHint")}</span>
              </div>
            ) : null}
            {current ? (
              <div className="dk-form" data-locked={locked ? "1" : "0"}>
                <label className="dk-field">
                  <span className="dk-meta">{t("project.configName")}</span>
                  <input
                    ref={nameRef}
                    className="dk-input"
                    value={draft.name}
                    placeholder={current.relative}
                    aria-label={t("project.configName")}
                    spellCheck={false}
                    disabled={locked}
                    onChange={(event) => patch({ name: event.target.value })}
                  />
                </label>

                <div className="dk-field dk-field-block">
                  <span className="dk-meta">{t("project.configServer")}</span>
                  <span className="dk-value dk-value-stack">
                    <DkSelect
                      value={draft.serverId}
                      options={serverOptions}
                      onChange={(value) => patch({ serverId: value })}
                      ariaLabel={t("project.configServer")}
                      disabled={locked}
                      size="sm"
                    />
                    <span className="dk-note">{t("project.serverHint")}</span>
                  </span>
                </div>

                <div className="dk-section">
                  <div className="dk-section-head">
                    <span>{t("project.sectionBuild")}</span>
                    <span className="dk-head-spacer" />
                    <OptionMenu
                      t={t}
                      ids={BUILD_OPTION_IDS}
                      selected={draft.options}
                      onToggle={toggleOption}
                      disabled={locked}
                    />
                  </div>

                  {valueRow(t("project.configDockerfile"), draft.dockerfile, () =>
                    openTextEditor("dockerfile", t("project.configDockerfile"), current.path),
                    locked
                  )}

                  {valueRow(t("project.configContextFolder"), draft.context, () =>
                    openTextEditor("context", t("project.configContextFolder"), t("project.configContextHint")),
                    locked
                  )}

                  <label className="dk-field" data-invalid={tagMissing ? "1" : "0"} data-hint={tagMissing ? "1" : "0"}>
                    <span className="dk-meta">{t("project.configTag")}</span>
                    <input
                      className="dk-input"
                      value={draft.tag}
                      placeholder="app:latest"
                      aria-label={t("project.configTag")}
                      aria-invalid={tagMissing ? "true" : undefined}
                      spellCheck={false}
                      disabled={locked}
                      onChange={(event) => patch({ tag: event.target.value })}
                    />
                    {/* [UX优化]: 清空必填项时立刻在字段下方说清楚，不等提交后统一报错。 */}
                    {tagMissing ? (
                      <span className="dk-field-hint dk-inline-error">{t("project.needTagInline")}</span>
                    ) : null}
                  </label>

                  {has("platform")
                    ? valueRow(t("project.option.platform"), draft.platform, () =>
                        openTextEditor("platform", t("project.option.platform"), "linux/amd64"),
                        locked
                      )
                    : null}

                  {has("buildArgs")
                    ? valueRow(
                        t("project.option.buildArgs"),
                        summarize(draft.buildArgs, (arg) => (arg.key ? `${arg.key}=${arg.value}` : "")),
                        () => openListEditor("buildArgs", t("project.option.buildArgs")),
                        locked,
                        <ListIcon />
                      )
                    : null}

                  {has("noCache") || has("pull") ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.sectionSwitch")}</span>
                      <span className="dk-checks">
                        {has("noCache") ? (
                          <label>
                            <input
                              type="checkbox"
                              checked={draft.noCache}
                              disabled={locked}
                              onChange={(event) => patch({ noCache: event.target.checked })}
                            />
                            <span>{t("project.configNoCache")}</span>
                          </label>
                        ) : null}
                        {has("pull") ? (
                          <label>
                            <input
                              type="checkbox"
                              checked={draft.pull}
                              disabled={locked}
                              onChange={(event) => patch({ pull: event.target.checked })}
                            />
                            <span>{t("project.configPull")}</span>
                          </label>
                        ) : null}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="dk-section">
                  <div className="dk-section-head">
                    <span>{t("project.sectionRun")}</span>
                    <span className="dk-head-spacer" />
                    <OptionMenu t={t} ids={RUN_OPTION_IDS} selected={draft.options} onToggle={toggleOption} disabled={locked} />
                  </div>

                  <label className="dk-field" data-invalid={containerNameInvalid ? "1" : "0"} data-hint={containerNameInvalid ? "1" : "0"}>
                    <span className="dk-meta">{t("project.configContainerName")}</span>
                    <input
                      className="dk-input"
                      value={draft.containerName}
                      placeholder={t("project.configContainerNameHint")}
                      aria-label={t("project.configContainerName")}
                      aria-invalid={containerNameInvalid ? "true" : undefined}
                      spellCheck={false}
                      disabled={locked}
                      onChange={(event) => patch({ containerName: event.target.value })}
                    />
                    {/* [UX优化]: 容器名的字符规则原来只在提交时告知，现在边输边提示。 */}
                    {containerNameInvalid ? (
                      <span className="dk-field-hint dk-inline-error">{t("project.containerNameInvalid")}</span>
                    ) : null}
                  </label>

                  {has("ports")
                    ? valueRow(
                        t("project.option.ports"),
                        summarize(draft.ports, (port) =>
                          port.host || port.container ? `${port.host || "?"}:${port.container || "?"}` : ""
                        ),
                        () => openListEditor("ports", t("project.option.ports")),
                        locked,
                        <ListIcon />
                      )
                    : null}

                  {has("mounts")
                    ? valueRow(
                        t("project.option.mounts"),
                        summarize(draft.mounts, (mount) =>
                          mount.host || mount.container
                            ? `${mount.host || "?"} -> ${mount.container || "?"}${mount.readOnly ? " (ro)" : ""}`
                            : ""
                        ),
                        () => openListEditor("mounts", t("project.option.mounts")),
                        locked,
                        <ListIcon />
                      )
                    : null}

                  {has("env")
                    ? valueRow(
                        t("project.option.env"),
                        // 摘要只列名称与数量：值可能是口令，不在折叠行与 tooltip 里铺明文。
                        envSummary(draft.env),
                        () => openListEditor("env", t("project.option.env")),
                        locked,
                        <ListIcon />
                      )
                    : null}

                  {has("runOptions")
                    ? valueRow(t("project.option.runOptions"), draft.runOptions, () =>
                        openTextEditor("runOptions", t("project.option.runOptions"), t("project.runOptionsHint")),
                        locked
                      )
                    : null}
                </div>

                <div className="dk-section">
                  <div className="dk-section-head">
                    <span>{t("project.preBuild")}</span>
                    <span className="dk-head-spacer" />
                  </div>

                  {valueRow(
                    t("project.preBuildTool"),
                    // 未选工具时明确写「不执行」，避免看成没配置。
                    preBuildSummary(draft.preBuild) || t("project.toolNone"),
                    openPreBuildEditor,
                    locked
                  )}
                </div>

                {error ? (
                  <div className="dk-inline-error dk-error-inline" role="alert" ref={errorRef}>
                    {error}
                  </div>
                ) : null}
              </div>
            ) : (
              /* [UX优化]: 没有可编辑对象时给一个明确的下一步，而不是只留一句说明。 */
              <div className="dk-modal-empty">
                <div className="dk-modal-empty-title">{t("project.emptyGuideTitle")}</div>
                <div className="dk-note">{t("project.emptyHint")}</div>
                <Btn
                  size="sm"
                  variant="primary"
                  onClick={() => setAdd({ open: true, path: "", error: "" })}
                >
                  {`+ ${t("project.addDockerfile")}`}
                </Btn>
              </div>
            )}
          </div>
        </div>

        <div className="dk-modal-foot">
          <Btn
            size="sm"
            variant="danger"
            disabled={!current || Boolean(busy)}
            aria-live="polite"
            onClick={() => void remove()}
          >
            {confirmRemove ? t("project.configDeleteConfirm") : t("project.configDelete")}
          </Btn>
          <span className="dk-head-spacer" />
          {/* [UX优化]: 底栏先说清当前状态（待确认 / 已保存 / 有改动），不用回头比对表单。 */}
          {closeWarn ? (
            <span className="dk-foot-note" data-tone="warn" role="status">
              {t("project.discardWarn")}
            </span>
          ) : othersWarn ? (
            <span className="dk-foot-note" data-tone="warn" role="status">
              {t("project.saveOthersWarn", { count: othersWarn })}
            </span>
          ) : savedFlash ? (
            <span className="dk-foot-note" data-tone="ok" role="status">
              {savedFlash}
            </span>
          ) : dirty ? (
            <span className="dk-foot-note" role="status">
              {t("project.unsavedNote")}
            </span>
          ) : null}
          <Btn size="sm" variant="ghost" onClick={requestClose}>
            {t("project.configCancel")}
          </Btn>
          <Btn
            size="sm"
            disabled={!current || Boolean(busy) || !configReady}
            title={t("project.applyHint")}
            onClick={() => void commit("apply")}
          >
            {busy === "apply" ? t("project.configSaving") : t("project.configApply")}
          </Btn>
          {/* [UX优化]: 主操作只保留一个 primary：视线落在右下角，不会在「应用 / 保存」之间犹豫。 */}
          <Btn
            size="sm"
            variant="primary"
            disabled={!current || Boolean(busy) || !configReady}
            title={t("project.saveCloseHint")}
            onClick={() => void commit("save")}
          >
            {busy === "save" ? t("project.configSaving") : t("project.configSave")}
          </Btn>
        </div>
      </div>

      {editor ? (
        <div
          className="dk-submask"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) requestCloseEditor();
          }}
        >
          <div
            className="dk-subdialog"
            ref={subdialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={editor.title}
            tabIndex={-1}
            data-wide={editor.kind === "form" || editor.field === "env" ? "1" : "0"}
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                trapTabKey(event, subdialogRef.current);
                return;
              }
              if (event.key !== "Escape") return;
              event.stopPropagation();
              requestCloseEditor();
            }}
          >
            <div className="dk-subdialog-head">
              <span className="dk-modal-title">{editor.title}</span>
              <button
                type="button"
                className="dk-icon-btn dk-icon-btn-lg"
                title={t("project.configCancel")}
                aria-label={t("project.configCancel")}
                onClick={requestCloseEditor}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="dk-subdialog-body">
              {editor.kind === "text" ? (
                <input
                  className="dk-input"
                  value={editor.value}
                  placeholder={editor.placeholder}
                  autoFocus
                  onChange={(event) => setEditor((prev) => ({ ...prev, value: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyEditor();
                  }}
                />
              ) : null}

              {editor.kind === "list" && editor.field === "env" ? (
                <EnvListEditor
                  t={t}
                  rows={editor.rows}
                  onChange={(next) => setEditor((prev) => (prev ? { ...prev, rows: next } : prev))}
                />
              ) : null}

              {editor.kind === "list" && editor.field !== "env" ? (
                <div className="dk-rows">
                  {editor.rows.map((row, index) => (
                    <div className="dk-row-inputs" key={`row-${index}`}>
                      {listConfig.columns.map((column) =>
                        column.type === "check" ? (
                          <label className="dk-inline-check" key={column.key} title={t(column.labelKey)}>
                            <input
                              type="checkbox"
                              checked={row[column.key] === true}
                              onChange={(event) =>
                                setEditor((prev) => ({
                                  ...prev,
                                  rows: prev.rows.map((item, at) =>
                                    at === index ? { ...item, [column.key]: event.target.checked } : item
                                  ),
                                }))
                              }
                            />
                            <span>{t(column.labelKey)}</span>
                          </label>
                        ) : column.multiline ? (
                          <div className="dk-multiline" key={column.key}>
                            <textarea
                              className="dk-input dk-textarea"
                              rows={4}
                              spellCheck={false}
                              value={row[column.key] || ""}
                              placeholder={t(column.placeholderKey)}
                              onChange={(event) =>
                                setEditor((prev) => ({
                                  ...prev,
                                  rows: prev.rows.map((item, at) =>
                                    at === index ? { ...item, [column.key]: event.target.value } : item
                                  ),
                                }))
                              }
                            />
                            {column.limit ? (
                              <span
                                className="dk-env-count"
                                data-over={
                                  normalizeEnvValue(row[column.key]).length > column.limit ? "1" : "0"
                                }
                              >
                                {`${normalizeEnvValue(row[column.key]).length} / ${column.limit}`}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <input
                            key={column.key}
                            className="dk-input"
                            style={column.width ? { flex: "none", width: column.width } : undefined}
                            value={row[column.key] || ""}
                            placeholder={t(column.placeholderKey)}
                            onChange={(event) =>
                              setEditor((prev) => ({
                                ...prev,
                                rows: prev.rows.map((item, at) =>
                                  at === index ? { ...item, [column.key]: event.target.value } : item
                                ),
                              }))
                            }
                          />
                        )
                      )}
                      <button
                        type="button"
                        className="dk-icon-btn"
                        title={t("project.removeRow")}
                        onClick={() =>
                          setEditor((prev) => ({ ...prev, rows: prev.rows.filter((_, at) => at !== index) }))
                        }
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  ))}
                  <div>
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditor((prev) => ({ ...prev, rows: [...prev.rows, listConfig.empty()] }))}
                    >
                      {`+ ${t("project.addRow")}`}
                    </Btn>
                  </div>
                </div>
              ) : null}

              {editor.kind === "form" ? (
                <div className="dk-form">
                  <div className="dk-field">
                    <span className="dk-meta">{t("project.preBuildTool")}</span>
                    <span className="dk-value">
                      <DkSelect
                        value={editor.value.tool}
                        options={preBuildToolOptions}
                        size="sm"
                        ariaLabel={t("project.preBuildTool")}
                        onChange={changePreBuildTool}
                      />
                    </span>
                  </div>

                  {editor.value.tool === "npm" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.packageJson")}</span>
                      <span className="dk-value">
                        <input
                          className="dk-input"
                          value={editor.value.packageJson}
                          placeholder={t("project.packageJsonHint")}
                          onChange={(event) => patchEditorValue({ packageJson: event.target.value })}
                          onBlur={() => void loadScripts(editor.value)}
                        />
                        <button
                          type="button"
                          className="dk-icon-btn"
                          title={t("project.scriptsLoad")}
                          onClick={() => void loadScripts(editor.value)}
                        >
                          <RefreshIcon />
                        </button>
                      </span>
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.npmCommand")}</span>
                      <span className="dk-value">
                        <DkSelect
                          value={editor.value.command}
                          options={npmCommandOptions}
                          size="sm"
                          ariaLabel={t("project.npmCommand")}
                          onChange={(value) => patchEditorValue({ command: value })}
                        />
                      </span>
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" &&
                  (editor.value.command === "run" || editor.value.command === "run-script") ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.npmScript")}</span>
                      <span className="dk-value">
                        {scripts.list.length > 0 && !scriptCustom ? (
                          <DkSelect
                            value={editor.value.script}
                            options={scriptOptions}
                            size="sm"
                            ariaLabel={t("project.npmScript")}
                            onChange={(value) => {
                              // 选「自定义」时切成输入框，脚本名保留。
                              if (value === SCRIPT_CUSTOM_ID) setScriptCustom(true);
                              else patchEditorValue({ script: value });
                            }}
                          />
                        ) : (
                          <input
                            className="dk-input"
                            value={editor.value.script}
                            placeholder={t("project.npmScriptHint")}
                            onChange={(event) => patchEditorValue({ script: event.target.value })}
                          />
                        )}
                        <button
                          type="button"
                          className="dk-icon-btn"
                          title={t("project.scriptsLoad")}
                          onClick={() => {
                            setScriptCustom(false);
                            void loadScripts(editor.value);
                          }}
                        >
                          <RefreshIcon />
                        </button>
                      </span>
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" &&
                  (editor.value.command === "run" || editor.value.command === "run-script") &&
                  scripts.list.length > 0 ? (
                    <div className="dk-field">
                      <span className="dk-meta" />
                      <span className="dk-note">{t("project.scriptsFound", { count: scripts.list.length })}</span>
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" &&
                  (editor.value.command === "run" || editor.value.command === "run-script") &&
                  scripts.list.length === 0 ? (
                    <div className="dk-field">
                      <span className="dk-meta" />
                      <span className="dk-note">
                        {scripts.loading
                          ? t("project.scriptsLoading")
                          : scripts.error || (scripts.missing ? t("project.scriptsMissing") : t("project.scriptsEmpty"))}
                      </span>
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.npmArguments")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.arguments}
                        placeholder={t("project.argumentsHint")}
                        onChange={(event) => patchEditorValue({ arguments: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.nodePath")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.nodePath}
                        placeholder={t("project.nodePathHint")}
                        onChange={(event) => patchEditorValue({ nodePath: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.packageManager")}</span>
                      <span className="dk-value">
                        <DkSelect
                          value={editor.value.packageManager}
                          options={packageManagerOptions}
                          size="sm"
                          ariaLabel={t("project.packageManager")}
                          onChange={(value) => patchEditorValue({ packageManager: value })}
                        />
                      </span>
                    </div>
                  ) : null}

                  {editor.value.tool === "npm" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.nodeOptions")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.nodeOptions}
                        placeholder={t("project.nodeOptionsHint")}
                        onChange={(event) => patchEditorValue({ nodeOptions: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool === "maven" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.mavenPath")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.mavenPath || ""}
                        placeholder={t("project.mavenPathHint")}
                        onChange={(event) => patchEditorValue({ mavenPath: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool === "maven" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.mavenGoals")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.goals}
                        placeholder={t("project.mavenGoalsHint")}
                        onChange={(event) => patchEditorValue({ goals: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool === "maven" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.mavenProfiles")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.profiles}
                        placeholder={t("project.mavenProfilesHint")}
                        onChange={(event) => patchEditorValue({ profiles: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool === "maven" ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.mavenJvm")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.jvmOptions}
                        placeholder={t("project.mavenJvmHint")}
                        onChange={(event) => patchEditorValue({ jvmOptions: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {editor.value.tool ? (
                    <div className="dk-field dk-field-block">
                      <span className="dk-meta">{t("project.preBuildEnv")}</span>
                      {/* [UX优化] 与运行环境变量共用同一套编辑器：批量粘贴、即时校验、删除可撤销，两处体验一致。 */}
                      <EnvListEditor
                        t={t}
                        rows={editor.value.env || []}
                        onChange={(next) => patchEditorValue({ env: next })}
                        valueMax={PRE_BUILD_ENV_VALUE_MAX}
                        totalMax={PRE_BUILD_ENV_TOTAL_MAX}
                        totalUnit="chars"
                        emptyHintKey="project.preBuildEnvEmptyHint"
                        hintKey="project.preBuildEnvSecretHint"
                      />
                    </div>
                  ) : null}

                  {editor.value.tool ? (
                    <div className="dk-field">
                      <span className="dk-meta">{t("project.preBuildCwd")}</span>
                      <input
                        className="dk-input"
                        value={editor.value.cwd}
                        placeholder={t("project.preBuildCwdHint")}
                        onChange={(event) => patchEditorValue({ cwd: event.target.value })}
                      />
                    </div>
                  ) : null}

                  {!editor.value.tool ? <div className="dk-note">{t("project.preBuildHint")}</div> : null}
                </div>
              ) : null}
            </div>

            <div className="dk-subdialog-foot">
              {escWarn ? <span className="dk-env-escwarn">{t("project.envDiscardWarn")}</span> : null}
              <span className="dk-head-spacer" />
              <Btn size="sm" variant="ghost" onClick={requestCloseEditor}>
                {t("project.configCancel")}
              </Btn>
              <Btn size="sm" variant="primary" onClick={applyEditor}>
                {/* 二级弹窗只写回父弹窗草稿、不落盘，文案必须与主弹窗的「保存」区分。 */}
                {t("project.editorApply")}
              </Btn>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
