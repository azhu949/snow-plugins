// 划词 / 消息翻译的结果卡片：独立于消息 DOM，避免被 React 重渲染抹掉。
import { h, render } from "preact";
import { TARGET_LANGUAGES, languageName } from "../languages.js";
import { MAX_SOURCE_CHARS } from "../constants.js";
import { clampSource } from "../text-limit.js";
import { errorText, toErrorPayload } from "../error-text.js";
import { Icon } from "./icons.js";
import { StSelect } from "./select.js";

const CARD_WIDTH = 380;
const GAP = 8;
const EXCERPT_CHARS = 90;
// 卡片内的轻提示时长：与面板提示保持一致，失败文案停留更久。
const CARD_NOTICE_MS = 2200;
const CARD_NOTICE_BAD_MS = 4200;
// 宿主划词后浮出的「添加到输入框」容器：卡片要排在它下方，避免两张浮层叠在一起。
const HOST_POPUP_SELECTOR = "[data-quote-popup]";

function CardView({ state, t, locale, onClose, onCopy, onRetarget, onRetranslate, onOpenPanel }) {
  const excerpt = state.text.length > EXCERPT_CHARS ? `${state.text.slice(0, EXCERPT_CHARS)}…` : state.text;
  const done = state.status === "done" && state.result;

  return h(
    "div",
    { className: "st-card", role: "dialog", "aria-label": t("st.title") },
    h(
      "header",
      { className: "st-card-head" },
      h("span", { className: "st-card-mark" }, h(Icon, { name: "languages", size: 13 })),
      h("span", { className: "st-card-excerpt", title: state.text }, excerpt),
      h(
        "button",
        {
          type: "button",
          className: "st-icon-btn st-icon-btn-sm",
          title: t("st.close"),
          "aria-label": t("st.close"),
          onClick: onClose,
        },
        h(Icon, { name: "close", size: 13 }),
      ),
    ),
    h(
      "div",
      { className: "st-card-langbar" },
      h("span", { className: "st-card-lang-label" }, t("st.target")),
      h(StSelect, {
        value: state.target,
        options: TARGET_LANGUAGES.map((code) => ({
          value: code,
          label: code === "auto" ? t("st.auto") : languageName(code, locale),
        })),
        onChange: onRetarget,
        ariaLabel: t("st.target"),
        size: "sm",
      }),
      done ? h("button", { type: "button", className: "st-text-btn", onClick: onRetranslate }, t("st.retranslate")) : null,
    ),
    h(
      "div",
      { className: `st-card-body${state.status === "error" ? " is-error" : ""}` },
      state.status === "loading"
        ? h("div", { className: "st-skeleton" }, h("span", null), h("span", null), h("span", null))
        : state.status === "error"
          ? h("span", { className: "st-card-error" }, errorText(state.error, t))
          : h("div", { className: "st-card-text" }, state.result?.text || ""),
    ),
    h(
      "div",
      { className: "st-card-foot" },
      h(
        "span",
        { className: "st-card-meta" },
        done
          ? `${t("st.meta", { engine: t(`st.engine.${state.result.engine}`), ms: state.result.elapsedMs })}${
              state.result.fallback && state.result.fallback.engine !== state.result.engine
                ? ` · ${t("st.fallback", { from: t(`st.engine.${state.result.fallback.engine}`) })}`
                : ""
            }`
          : "",
      ),
      h(
        "div",
        { className: "st-card-actions" },
        done ? h("button", { type: "button", className: "st-text-btn", onClick: onCopy }, t("st.copy")) : null,
        done ? h("button", { type: "button", className: "st-text-btn", onClick: onOpenPanel }, t("st.openPanel")) : null,
      ),
    ),
    // 复制反馈画在卡片内部：卡片场景下浮层是隐藏的，不能再依赖面板里的提示。
    state.notice
      ? h(
          "div",
          { className: `st-notice${state.noticeTone ? ` is-${state.noticeTone}` : ""}`, role: "status" },
          state.notice,
        )
      : null,
  );
}

export function createCard({ t, getLocale, translate, copy, onOpenPanel }) {
  const host = document.createElement("div");
  host.className = "st-card-host";
  host.hidden = true;
  document.body.append(host);

  let state = null;
  let anchorGetter = null;
  let lastRect = null;
  let frame = 0;
  let requestId = 0;
  let noticeTimer = 0;

  // 点击卡片之外的区域收起：卡片只是临时的翻译结果，点别处即视为收起。
  function onDocumentPointerDown(event) {
    if (!state) return;
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (host.contains(target)) return;
    // 入口按钮与划词 / 消息按钮会重新唤起卡片，不能在这里先把自己关掉。
    if (target.closest(".st-launcher, .st-selection-btn, .st-msg-btn")) return;
    hide();
  }

  document.addEventListener("pointerdown", onDocumentPointerDown, true);

  function locale() {
    return typeof getLocale === "function" ? getLocale() : "zh-CN";
  }

  // 宿主「添加到输入框」浮层的矩形；没有或不可见时返回 null。
  function hostPopupRect() {
    const popup = document.querySelector(HOST_POPUP_SELECTOR);
    if (!(popup instanceof Element)) return null;
    const box = popup.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return box;
  }

  function place() {
    if (!state) return;
    const fresh = anchorGetter ? anchorGetter() : null;
    if (fresh) lastRect = fresh;
    const anchor = lastRect;
    const width = host.offsetWidth || CARD_WIDTH;
    const height = host.offsetHeight || 180;
    const popup = hostPopupRect();
    let left;
    let top;
    if (popup) {
      // 宿主的「添加到输入框」还亮着：卡片排在它下方并左边缘对齐，避免两张浮层重叠。
      left = popup.left;
      top = popup.bottom + GAP;
    } else {
      left = anchor ? anchor.left + anchor.width / 2 - width / 2 : window.innerWidth - width - 24;
      top = anchor ? anchor.bottom + GAP : 120;
      if (anchor && top + height > window.innerHeight - GAP) {
        top = Math.max(GAP, anchor.top - height - GAP);
      }
    }
    left = Math.min(Math.max(GAP, left), Math.max(GAP, window.innerWidth - width - GAP));
    top = Math.min(Math.max(GAP, top), Math.max(GAP, window.innerHeight - height - GAP));
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      place();
    });
  }

  function draw() {
    render(
      state
        ? h(CardView, {
            state,
            t,
            locale: locale(),
            onClose: hide,
            onCopy: () => void handleCopy(),
            onRetarget: (target) => void run({ target }),
            onRetranslate: () => void run({}),
            onOpenPanel: () => onOpenPanel({ text: state.text, result: state.result }),
          })
        : null,
      host,
    );
    schedule();
  }

  function clearNoticeTimer() {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = 0;
  }

  // 卡片自己的轻提示：卡片场景下浮层是隐藏的，提示只有画在卡片内部才看得见。
  function showNotice(message, tone) {
    if (!state) return;
    clearNoticeTimer();
    state = { ...state, notice: message, noticeTone: tone };
    draw();
    noticeTimer = setTimeout(() => {
      noticeTimer = 0;
      if (!state) return;
      state = { ...state, notice: "", noticeTone: "" };
      draw();
    }, tone === "bad" ? CARD_NOTICE_BAD_MS : CARD_NOTICE_MS);
  }

  async function handleCopy() {
    const owner = state;
    const text = state?.result?.text || "";
    if (!text) return;
    let ok = false;
    try {
      ok = Boolean(await copy(text));
    } catch {
      ok = false;
    }
    // 复制是异步的：卡片已关闭或被新一次 show 换掉时不再提示。
    if (state !== owner) return;
    showNotice(t(ok ? "st.copied" : "st.copyFail"), ok ? "ok" : "bad");
  }

  async function run(patch) {
    if (!state) return;
    clearNoticeTimer();
    state = { ...state, ...patch, status: "loading", error: null, notice: "", noticeTone: "" };
    draw();
    // 每次请求都换一个 id：切目标语言或重新翻译时，旧响应回来不会覆盖新结果。
    const id = (requestId += 1);
    try {
      const result = await translate(state.text, state.target);
      if (id !== requestId || !state) return;
      state = { ...state, status: "done", result, error: null };
    } catch (error) {
      if (id !== requestId || !state) return;
      state = { ...state, status: "error", error: toErrorPayload(error), result: null };
    }
    draw();
  }

  function show({ text, target, rect, getAnchorRect }) {
    requestId += 1;
    clearNoticeTimer();
    anchorGetter = typeof getAnchorRect === "function" ? getAnchorRect : null;
    lastRect = rect || (anchorGetter ? anchorGetter() : null);
    // 统一长度护栏：消息按钮会把整段 AI 回复交进来，超长文本会被切成几十片串行请求。
    const source = clampSource(String(text || ""));
    state = {
      text: source.text,
      target,
      status: "loading",
      result: null,
      error: null,
      notice: "",
      noticeTone: "",
    };
    host.hidden = false;
    draw();
    void run({});
    // run() 开始时会清空 notice，所以截断提示必须排在它之后，否则会被立刻抹掉。
    if (source.truncated) showNotice(t("st.textTooLong", { max: MAX_SOURCE_CHARS }), "bad");
  }

  function hide() {
    requestId += 1;
    clearNoticeTimer();
    state = null;
    anchorGetter = null;
    host.hidden = true;
    render(null, host);
  }

  function onViewportChange() {
    if (state) schedule();
  }

  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);

  return {
    show,
    hide,
    isOpen() {
      return Boolean(state);
    },
    dispose() {
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      clearNoticeTimer();
      requestId += 1;
      state = null;
      render(null, host);
      host.remove();
    },
  };
}
