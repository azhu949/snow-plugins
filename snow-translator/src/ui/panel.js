// 翻译浮层：翻译视图 + 设置视图，全部状态来自 store，写操作走 actions。
// 下拉与开关沿用 Snow App 的视觉：自定义下拉（用量统计日期范围）与通用设置里的 toggle。
import { h } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { ENGINE_IDS, FREE_ENGINES, MAX_SOURCE_CHARS } from "../constants.js";
import { errorChainText, errorDetailLine, errorHint, errorText, shortErrorText } from "../error-text.js";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES, languageName } from "../languages.js";
import { resultOutdated } from "../text-limit.js";
import { Icon } from "./icons.js";
import { StSelect } from "./select.js";
import { StSwitch } from "./switch.js";

function useStore(store) {
  const [state, setState] = useState(store.get());
  useEffect(() => store.subscribe(setState), [store]);
  return state;
}

function languageOptions(codes, locale, t) {
  return codes.map((code) => ({
    value: code,
    label: code === "auto" ? t("st.auto") : languageName(code, locale),
  }));
}

// 字段容器用 div：label 包裹 button 时点击浮层选项会被 label 再次激活触发器，
// 表现为「选中后下拉又弹回来」。
function Field({ label, children }) {
  return h(
    "div",
    { className: "st-field" },
    h("span", { className: "st-field-label" }, label),
    children,
  );
}

// 设置项行：左侧标题与说明，右侧开关（与通用设置里的排版一致）。
function OptionRow({ label, hint, children }) {
  return h(
    "div",
    { className: "st-option-row" },
    h(
      "div",
      { className: "st-option-text" },
      h("span", { className: "st-option-label" }, label),
      hint ? h("span", { className: "st-option-hint" }, hint) : null,
    ),
    children,
  );
}

// 说明块：浅底 + 信息图标，用来说明密钥要求、接口差异等。
function Tip({ children }) {
  return h(
    "div",
    { className: "st-tip" },
    h("span", { className: "st-tip-icon" }, h(Icon, { name: "info", size: 12 })),
    h("span", { className: "st-tip-text" }, children),
  );
}

// 设置分组：小号大写标题 + 右侧状态说明，内容放进一张卡片（卡片内各项带分隔线）。
function Group({ title, note, foot, children }) {
  return h(
    "section",
    { className: "st-group" },
    h(
      "div",
      { className: "st-group-head" },
      h("span", { className: "st-group-title" }, title),
      note ? h("span", { className: "st-group-note" }, note) : null,
    ),
    h("div", { className: "st-group-card" }, children),
    foot ? h(Tip, null, foot) : null,
  );
}

function Skeleton() {
  return h("div", { className: "st-skeleton" }, h("span", null), h("span", null), h("span", null));
}

function formatTime(value, locale) {
  const time = Number(value) || 0;
  if (!time) return "";
  try {
    return new Date(time).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// 顶部状态胶囊：圆点只表示「最近一次测试」的结果，不再用颜色暗示「无需密钥」。
// 未测试为灰、成功为绿、失败为红；密钥要求与测试时间放进悬停提示。
function EnginePill({ state, t, locale }) {
  const engine = state.settings.engine;
  const result = state.testResult;
  const tone = !result ? "is-untested" : result.ok ? "is-ok" : "is-failed";
  const time = result ? formatTime(result.at, locale) : "";
  const status = !result
    ? t("st.settings.untested")
    : `${result.ok ? t("st.settings.testOk") : t("st.settings.testFail")}${time ? ` · ${time}` : ""}`;
  const title = [
    t(`st.engine.${engine}`),
    FREE_ENGINES.includes(engine) ? t("st.settings.freeEngine") : t("st.settings.needsKey"),
    status,
  ].join(" · ");

  return h(
    "span",
    { className: `st-pill ${tone}`, title },
    h("span", { className: "st-pill-dot", "aria-hidden": "true" }),
    t(`st.engine.${engine}`),
  );
}

// 测试连接结果：头部给结论与时间，中间是引擎 / 状态 / 耗时，失败时再补原因、建议与原始错误。
function TestResult({ result, t, locale }) {
  if (!result) return null;

  const ok = result.ok;
  const time = formatTime(result.at, locale);
  const pairs = [[t("st.settings.testEngine"), t(`st.engine.${result.engine}`)]];
  if (ok) {
    pairs.push([t("st.settings.testLatency"), `${result.elapsedMs} ms`]);
    pairs.push([t("st.settings.testSample"), result.text]);
  } else {
    pairs.push([t("st.settings.testStatus"), result.status ? `HTTP ${result.status}` : "-"]);
    pairs.push([t("st.settings.testLatency"), `${Math.max(0, Number(result.elapsedMs) || 0)} ms`]);
  }

  const rows = [];
  for (const [label, value] of pairs) {
    rows.push(h("dt", null, label));
    rows.push(h("dd", { title: value }, value));
  }

  const hint = ok ? "" : errorHint(result, t);

  return h(
    "div",
    { className: `st-test-result${ok ? " is-ok" : " is-failed"}` },
    h(
      "div",
      { className: "st-test-result-head" },
      h(Icon, { name: ok ? "check" : "alert", size: 12 }),
      h("strong", null, ok ? t("st.settings.testOk") : t("st.settings.testFail")),
      time ? h("span", { className: "st-test-result-time" }, t("st.settings.testAt", { time })) : null,
    ),
    h("dl", { className: "st-test-result-grid" }, rows),
    ok ? null : h("p", { className: "st-test-result-error" }, errorText(result, t)),
    hint ? h("p", { className: "st-test-result-hint" }, hint) : null,
    !ok && result.detail ? h("p", { className: "st-test-result-detail" }, result.detail) : null,
  );
}

function ResultBox({ state, t, locale, actions }) {
  if (state.loading) {
    return h(
      "div",
      { className: "st-result is-loading" },
      h("div", { className: "st-result-head" }, h("span", { className: "st-result-title" }, t("st.result"))),
      h(Skeleton, null),
    );
  }

  if (state.error) {
    const hint = errorHint(state.error, t);
    const chain = errorChainText(state.error, t);
    // 原始响应摘要：与设置页「测试连接」的诊断行共用同一套样式与截断口径。
    const detail = errorDetailLine(state.error);
    return h(
      "div",
      { className: "st-result is-error" },
      h(
        "div",
        { className: "st-result-head" },
        h(Icon, { name: "alert", size: 13 }),
        h("span", { className: "st-result-title" }, errorText(state.error, t)),
      ),
      hint ? h("div", { className: "st-result-hint" }, hint) : null,
      chain ? h("div", { className: "st-result-hint" }, chain) : null,
      detail ? h("div", { className: "st-test-result-detail" }, detail) : null,
    );
  }

  if (!state.result) {
    return h(
      "div",
      { className: "st-result is-empty" },
      h("span", { className: "st-empty-title" }, t("st.resultEmpty")),
      h("span", { className: "st-empty-hint" }, t("st.idleHint")),
    );
  }

  const result = state.result;
  // 快照对不上当前输入：译文已过期，写回会覆盖用户刚改的内容。
  const stale = resultOutdated(result, state.text);
  // 回退时明确写出「这不是你设置的引擎」，并区分两条原因：主引擎为什么失败、
  // 兜底链最后一次失败在哪个引擎，避免把兜底引擎的错误算到主引擎头上。
  const fallback = result.fallback;
  const fellBack = Boolean(fallback && fallback.engine !== result.engine);
  const primaryReason = fellBack ? shortErrorText(fallback, t) : "";
  const lastEngine = fellBack && fallback.lastEngine && fallback.lastEngine !== fallback.engine ? fallback.lastEngine : "";
  const lastReason = lastEngine
    ? shortErrorText(
        {
          code: fallback.lastCode,
          status: fallback.lastStatus,
          reason: fallback.lastReason,
          apiCode: fallback.lastApiCode,
        },
        t,
      )
    : "";
  const metaText = fellBack
    ? `${t("st.meta", { engine: t(`st.engine.${result.engine}`), ms: result.elapsedMs })} · ${t("st.fallback", {
        from: t(`st.engine.${fallback.engine}`),
      })}${primaryReason ? `（${primaryReason}）` : ""}`
    : t("st.meta", { engine: t(`st.engine.${result.engine}`), ms: result.elapsedMs });
  const fallbackHint = fellBack
    ? lastEngine
      ? t("st.fallbackDetail", {
          primary: t(`st.engine.${fallback.engine}`),
          primaryReason,
          last: t(`st.engine.${lastEngine}`),
          lastReason,
        })
      : `${t(`st.engine.${fallback.engine}`)} · ${primaryReason}`
    : "";

  return h(
    "div",
    { className: "st-result" },
    h(
      "div",
      { className: "st-result-head" },
      h("span", { className: "st-result-title" }, t("st.result")),
      h(
        "div",
        { className: "st-result-tools" },
        h("button", { type: "button", className: "st-text-btn", onClick: actions.copy }, t("st.copy")),
      ),
    ),
    h("div", { className: "st-result-body" }, result.text),
    stale ? h("div", { className: "st-result-hint" }, t("st.resultStale")) : null,
    h(
      "div",
      { className: fellBack ? "st-result-meta is-fallback" : "st-result-meta", title: fallbackHint },
      metaText,
      result.detected
        ? ` · ${t("st.detected", { lang: languageName(result.detected, locale) })}`
        : "",
    ),
  );
}

function TranslateBody({ state, t, locale, actions }) {
  const textareaRef = useRef(null);
  // 译文快照对不上当前输入时禁用写回，避免整段替换掉用户刚改的内容。
  const stale = resultOutdated(state.result, state.text);

  // 输入框随内容长高，上限跟随窗口高度，避免浮层被撑出屏幕。
  // 用布局副作用：视图切回来时高度必须在绘制前算好，否则会先按 CSS 的
  // min-height 画一帧再长高，看起来像面板闪了一下。
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    const limit = Math.round(window.innerHeight * 0.32);
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 68), limit)}px`;
  }, [state.text, state.view]);

  return h(
    "div",
    { className: "st-body" },
    h(
      "div",
      { className: "st-langbar" },
      h(
        "div",
        { className: "st-lang" },
        h("span", { className: "st-lang-label" }, t("st.source")),
        h(StSelect, {
          value: state.source,
          options: languageOptions(SOURCE_LANGUAGES, locale, t),
          onChange: actions.setSource,
          ariaLabel: t("st.source"),
        }),
      ),
      h(
        "button",
        {
          type: "button",
          className: "st-icon-btn st-swap",
          title: t("st.swap"),
          "aria-label": t("st.swap"),
          onClick: actions.swap,
        },
        h(Icon, { name: "swap", size: 15 }),
      ),
      h(
        "div",
        { className: "st-lang" },
        h("span", { className: "st-lang-label" }, t("st.target")),
        h(StSelect, {
          value: state.target,
          options: languageOptions(TARGET_LANGUAGES, locale, t),
          onChange: actions.setTarget,
          ariaLabel: t("st.target"),
        }),
      ),
    ),
    h(
      "div",
      { className: "st-editor" },
      h("textarea", {
        ref: textareaRef,
        className: "st-textarea",
        value: state.text,
        maxLength: MAX_SOURCE_CHARS,
        placeholder: t("st.placeholder"),
        spellcheck: false,
        onInput: (event) => actions.setText(event.currentTarget.value),
        // maxLength 会静默截断粘贴内容，超限提示只能在这里按剪贴板长度判断。
        onPaste: (event) => {
          const pasted = event.clipboardData ? event.clipboardData.getData("text") : "";
          const element = event.currentTarget;
          const replaced = Math.max(0, element.selectionEnd - element.selectionStart);
          if (pasted && element.value.length - replaced + pasted.length > MAX_SOURCE_CHARS) {
            actions.warnSourceTooLong();
          }
        },
        onKeyDown: (event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            actions.translate();
          }
        },
      }),
      h(
        "div",
        { className: "st-editor-foot" },
        h("span", { className: "st-count" }, t("st.chars", { count: state.text.length })),
        h(
          "button",
          {
            type: "button",
            className: "st-text-btn",
            onClick: actions.clear,
            disabled: !state.text,
          },
          t("st.clear"),
        ),
      ),
    ),
    h(
      OptionRow,
      { label: t("st.autoTranslate") },
      h(StSwitch, {
        checked: state.settings.autoTranslate,
        onChange: (value) => actions.updateSettings({ autoTranslate: value }),
        onText: t("st.enabled"),
        offText: t("st.disabled"),
      }),
    ),
    h(
      "div",
      { className: "st-actions" },
      h(
        "button",
        {
          type: "button",
          className: "st-btn st-btn-primary",
          disabled: state.loading || !state.text.trim(),
          onClick: actions.translate,
        },
        state.loading ? t("st.translating") : t("st.translate"),
      ),
      h("button", { type: "button", className: "st-btn", onClick: actions.readInput }, t("st.readInput")),
      h(
        "button",
        {
          type: "button",
          className: "st-btn",
          // 写回是整段替换：说明清楚，用户才不会以为译文会被追加到输入框末尾。
          // 译文与当前输入不一致时禁用，避免把上一段文本的译文写回来。
          title: stale ? t("st.resultStale") : t("st.writeInputHint"),
          "aria-label": stale ? t("st.resultStale") : t("st.writeInputHint"),
          disabled: state.loading || !state.result || stale,
          onClick: actions.writeInput,
        },
        t("st.writeInput"),
      ),
      h("span", { className: "st-kbd-hint" }, "Ctrl + Enter"),
    ),
    h(ResultBox, { state, t, locale, actions }),
  );
}

// 引擎自己的密钥字段：只有百度 / DeepL / OpenAI 需要，免费引擎不显示这一段。
function engineFields(engine, settings, t, actions) {
  if (engine === "deepl") {
    return h(
      Group,
      {
        title: t("st.engine.deepl"),
        note: t("st.settings.needsKey"),
        foot: t("st.settings.deeplHint"),
      },
      h(
        Field,
        { label: t("st.settings.key") },
        h("input", {
          className: "st-input",
          type: "password",
          value: settings.deepl.key,
          placeholder: "DeepL API Key",
          autocomplete: "off",
          spellcheck: false,
          onInput: (event) => actions.updateSettings({ deepl: { key: event.currentTarget.value } }),
        }),
      ),
      h(
        Field,
        { label: t("st.settings.plan") },
        h(StSelect, {
          value: settings.deepl.plan,
          options: [
            { value: "free", label: t("st.settings.planFree") },
            { value: "pro", label: t("st.settings.planPro") },
          ],
          onChange: (value) => actions.updateSettings({ deepl: { plan: value } }),
          ariaLabel: t("st.settings.plan"),
        }),
      ),
    );
  }

  if (engine === "baidu") {
    return h(
      Group,
      {
        title: t("st.engine.baidu"),
        note: t("st.settings.needsKey"),
        foot: t("st.settings.baiduHint"),
      },
      h(
        Field,
        { label: t("st.settings.appid") },
        h("input", {
          className: "st-input",
          type: "text",
          value: settings.baidu.appid,
          placeholder: "2024012300xxxxxx",
          autocomplete: "off",
          spellcheck: false,
          onInput: (event) => actions.updateSettings({ baidu: { appid: event.currentTarget.value } }),
        }),
      ),
      h(
        Field,
        { label: t("st.settings.key") },
        h("input", {
          className: "st-input",
          type: "password",
          value: settings.baidu.key,
          autocomplete: "off",
          spellcheck: false,
          onInput: (event) => actions.updateSettings({ baidu: { key: event.currentTarget.value } }),
        }),
      ),
    );
  }

  if (engine === "openai") {
    const openai = settings.openai;
    return h(
      Group,
      {
        title: t("st.engine.openai"),
        note: t("st.settings.needsKey"),
        foot: t("st.settings.openaiHint"),
      },
      h(
        Field,
        { label: t("st.settings.baseUrl") },
        h("input", {
          className: "st-input",
          type: "text",
          value: openai.baseUrl,
          placeholder: "https://api.openai.com/v1",
          autocomplete: "off",
          spellcheck: false,
          onInput: (event) => actions.updateSettings({ openai: { baseUrl: event.currentTarget.value } }),
        }),
      ),
      h(
        Field,
        { label: t("st.settings.model") },
        h("input", {
          className: "st-input",
          type: "text",
          value: openai.model,
          placeholder: "gpt-4o-mini",
          autocomplete: "off",
          spellcheck: false,
          onInput: (event) => actions.updateSettings({ openai: { model: event.currentTarget.value } }),
        }),
      ),
      h(
        Field,
        { label: t("st.settings.key") },
        h("input", {
          className: "st-input",
          type: "password",
          value: openai.key,
          autocomplete: "off",
          spellcheck: false,
          onInput: (event) => actions.updateSettings({ openai: { key: event.currentTarget.value } }),
        }),
      ),
      h(
        Field,
        { label: t("st.settings.prompt") },
        h("textarea", {
          className: "st-input st-input-area",
          value: openai.prompt,
          placeholder: t("st.settings.promptPlaceholder"),
          spellcheck: false,
          onInput: (event) => actions.updateSettings({ openai: { prompt: event.currentTarget.value } }),
        }),
      ),
    );
  }

  return null;
}

function SettingsBody({ state, t, locale, actions }) {
  const settings = state.settings;
  const onText = t("st.enabled");
  const offText = t("st.disabled");
  const toggle = (checked, onChange) => h(StSwitch, { checked, onChange, onText, offText });
  const interactions = [
    settings.autoTranslate,
    settings.selectionButton,
    settings.messageButton,
    settings.autoFillSelection,
  ];

  return h(
    "div",
    { className: "st-body st-settings" },
    h(
      Group,
      {
        title: t("st.settings.engine"),
        note: t("st.settings.statusActive"),
        foot: t("st.settings.engineHint"),
      },
      h(
        Field,
        { label: t("st.settings.provider") },
        h(StSelect, {
          value: settings.engine,
          options: ENGINE_IDS.map((id) => ({ value: id, label: t(`st.engine.${id}`) })),
          onChange: (value) => actions.updateSettings({ engine: value }),
          ariaLabel: t("st.settings.provider"),
        }),
      ),
      h(
        OptionRow,
        { label: t("st.settings.fallback"), hint: t("st.settings.fallbackHint") },
        toggle(settings.fallback, (value) => actions.updateSettings({ fallback: value })),
      ),
    ),
    engineFields(settings.engine, settings, t, actions),
    h(
      Group,
      {
        title: t("st.settings.interaction"),
        note: t("st.settings.countOn", {
          on: interactions.filter(Boolean).length,
          total: interactions.length,
        }),
      },
      h(
        OptionRow,
        { label: t("st.settings.autoTranslate"), hint: t("st.settings.autoTranslateHint") },
        toggle(settings.autoTranslate, (value) => actions.updateSettings({ autoTranslate: value })),
      ),
      h(
        OptionRow,
        { label: t("st.settings.selectionButton"), hint: t("st.settings.selectionButtonHint") },
        toggle(settings.selectionButton, (value) => actions.updateSettings({ selectionButton: value })),
      ),
      h(
        OptionRow,
        { label: t("st.settings.messageButton"), hint: t("st.settings.messageButtonHint") },
        toggle(settings.messageButton, (value) => actions.updateSettings({ messageButton: value })),
      ),
      h(
        OptionRow,
        { label: t("st.settings.autoFill"), hint: t("st.settings.autoFillHint") },
        toggle(settings.autoFillSelection, (value) => actions.updateSettings({ autoFillSelection: value })),
      ),
    ),
    h(
      Group,
      { title: t("st.settings.languages"), foot: t("st.settings.languagesHint") },
      h(
        "div",
        { className: "st-lang-pair" },
        h(
          Field,
          { label: t("st.settings.defaultSource") },
          h(StSelect, {
            value: settings.sourceLang,
            options: languageOptions(SOURCE_LANGUAGES, locale, t),
            onChange: (value) => actions.updateSettings({ sourceLang: value }),
            ariaLabel: t("st.settings.defaultSource"),
          }),
        ),
        h(
          "button",
          {
            type: "button",
            className: "st-round-btn st-swap-inline",
            title: t("st.swap"),
            "aria-label": t("st.swap"),
            onClick: actions.swap,
          },
          h(Icon, { name: "swap", size: 12 }),
        ),
        h(
          Field,
          { label: t("st.settings.defaultTarget") },
          h(StSelect, {
            value: settings.targetLang,
            options: languageOptions(TARGET_LANGUAGES, locale, t),
            onChange: (value) => actions.updateSettings({ targetLang: value }),
            ariaLabel: t("st.settings.defaultTarget"),
          }),
        ),
      ),
    ),
    h(
      "div",
      { className: "st-settings-foot" },
      h(
        "button",
        {
          type: "button",
          className: "st-btn st-btn-primary st-btn-tall",
          disabled: state.testing,
          onClick: actions.testEngine,
        },
        h(Icon, { name: "zap", size: 13 }),
        h("span", null, state.testing ? t("st.settings.testing") : t("st.settings.test")),
      ),
      h(
        "button",
        {
          type: "button",
          className: state.confirmReset ? "st-btn st-btn-tall is-armed" : "st-btn st-btn-tall",
          onClick: actions.resetSettings,
        },
        h(Icon, { name: "rotate", size: 13 }),
        h("span", null, state.confirmReset ? t("st.settings.resetConfirmAction") : t("st.settings.reset")),
      ),
      h(TestResult, { result: state.testResult, t, locale }),
    ),
  );
}

export default function TranslatePanel({ store, t, actions }) {
  const state = useStore(store);
  const locale = state.locale || "zh-CN";
  const isSettings = state.view === "settings";
  const targetLabel = languageName(state.target, locale);

  return h(
    "div",
    { className: "st-panel", role: "dialog", "aria-label": t("st.title") },
    h(
      "header",
      { className: "st-head", "data-st-drag": "true" },
      h("span", { className: "st-mark" }, h(Icon, { name: "languages", size: 15 })),
      h(
        "div",
        { className: "st-head-text" },
        h("span", { className: "st-title" }, isSettings ? t("st.settingsTitle") : t("st.title")),
        h(
          "div",
          { className: "st-head-meta" },
          h(EnginePill, { state, t, locale }),
          isSettings ? null : h("span", { className: "st-sub" }, targetLabel),
        ),
      ),
      h(
        "div",
        { className: "st-head-actions" },
        h(
          "button",
          {
            type: "button",
            className: `st-icon-btn${isSettings ? " is-active" : ""}`,
            title: isSettings ? t("st.back") : t("st.settings"),
            "aria-label": isSettings ? t("st.back") : t("st.settings"),
            onClick: actions.toggleView,
          },
          h(Icon, { name: isSettings ? "back" : "settings", size: 15 }),
        ),
        h(
          "button",
          { type: "button", className: "st-icon-btn", title: t("st.close"), "aria-label": t("st.close"), onClick: actions.close },
          h(Icon, { name: "close", size: 15 }),
        ),
      ),
    ),
    isSettings
      ? h(SettingsBody, { state, t, locale, actions })
      : h(TranslateBody, { state, t, locale, actions }),
    state.notice
      ? h(
          "div",
          { className: `st-notice${state.noticeTone ? ` is-${state.noticeTone}` : ""}`, role: "status" },
          state.notice,
        )
      : null,
  );
}
