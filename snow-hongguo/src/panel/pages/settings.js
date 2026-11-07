// 设置页：清晰度偏好、缓存清理、后台状态（/health）。
import { getReact, h } from "../ui/runtime.js";
import { ErrorNotice, Icon, Spinner, describeError, formatUptime } from "../ui/common.js";
import { Select } from "../ui/select.js";
import { QUALITY_OPTIONS } from "../storage.js";
import { PLAYBACK_RATES } from "../playback-prefs.js";

export function SettingsPage({ ctx, active }) {
  const React = getReact();
  const t = ctx.t;
  const rpc = ctx.rpc;
  const [healthState, setHealthState] = React.useState({ status: "loading", data: null, error: null });
  const [clearing, setClearing] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [cacheMessage, setCacheMessage] = React.useState(null);

  const healthSeqRef = React.useRef(0);
  const healthBusyRef = React.useRef(false);
  const clearTimerRef = React.useRef(null);

  React.useEffect(
    () => () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    },
    []
  );

  const refreshHealth = React.useCallback(async () => {
    if (healthBusyRef.current) return;
    healthBusyRef.current = true;
    const seq = healthSeqRef.current + 1;
    healthSeqRef.current = seq;
    setHealthState((prev) => ({ ...prev, status: "loading", error: null }));
    try {
      const data = await rpc.health();
      if (seq !== healthSeqRef.current) return;
      setHealthState({ status: "ok", data, error: null });
    } catch (error) {
      if (seq !== healthSeqRef.current) return;
      setHealthState({ status: "error", data: null, error });
    } finally {
      healthBusyRef.current = false;
    }
  }, [rpc]);

  // 每次切到设置页都重新探测一次，避免展示过期端口。
  React.useEffect(() => {
    if (!active) return;
    void refreshHealth();
  }, [active, refreshHealth]);

  const askClearCache = async () => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null;
        setConfirmClear(false);
      }, 4000);
      return;
    }

    setConfirmClear(false);
    setClearing(true);
    setCacheMessage(null);
    try {
      const result = await rpc.clearCache();
      const removed = Number(result?.removed);
      setCacheMessage({
        kind: "success",
        text: Number.isFinite(removed)
          ? t("settings.cacheClearedCount", { count: removed })
          : t("settings.cacheCleared"),
      });
    } catch (error) {
      if (error?.code === "NOT_FOUND" || error?.code === "METHOD_NOT_ALLOWED") {
        setCacheMessage({ kind: "warn", text: t("settings.cacheUnsupported") });
      } else {
        setCacheMessage({
          kind: "error",
          text: t("settings.cacheFailed", { error: describeError(t, error).message }),
        });
      }
    } finally {
      setClearing(false);
    }
  };

  const health = healthState.data;
  const quality = ctx.prefs?.quality || "720p";
  const miniWindow = ctx.prefs?.miniWindow || {};
  const miniOpacity = Math.round((Number(miniWindow.opacity) || 0.92) * 100);
  const patchMiniWindow = (patch) => ctx.updatePrefs({ miniWindow: { ...miniWindow, ...patch } });

  return h(
    "div",
    { className: "hg-page hg-settings" },
    h("div", { className: "hg-page-head" }, h("div", { className: "hg-page-title" }, t("settings.heading"))),
    h(
      "div",
      { className: "hg-scroll" },
      h(
        "section",
        { className: "hg-card-panel" },
        h(
          "div",
          { className: "hg-sec-head" },
          h("span", null, t("settings.playback")),
          h(Icon, { ctx, name: "SlidersHorizontal", size: 14 })
        ),
        h(
          "div",
          { className: "hg-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-quality" }, t("settings.quality")),
          h(Select, {
            id: "hg-quality", value: quality, active, ariaLabel: t("settings.quality"),
            onChange: (value) => ctx.updatePrefs({ quality: value }),
            options: QUALITY_OPTIONS.map((value) => ({ value, label: value })),
          })
        ),
        h("div", { className: "hg-hint" }, t("settings.qualityHint")),
        h("div", { className: "hg-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-playback-rate" }, t("player.speed")),
          h(Select, {
            id: "hg-playback-rate", value: ctx.prefs.playbackRate, active, ariaLabel: t("player.speed"),
            onChange: (value) => ctx.updatePrefs({ playbackRate: Number(value) }),
            options: PLAYBACK_RATES.map((value) => ({ value, label: `${value}x` })),
          })
        ),
        h("div", { className: "hg-field hg-range-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-volume" }, t("player.volume")),
          h("div", { className: "hg-range-control" },
            h("input", {
              id: "hg-volume", className: "hg-range", type: "range", min: 0, max: 100, step: 1,
              value: Math.round(ctx.prefs.volume * 100),
              onChange: (event) => ctx.updatePrefs({ volume: Number(event.target.value) / 100 }),
            }), h("span", { className: "hg-range-value" }, `${Math.round(ctx.prefs.volume * 100)}%`)
          )
        ),
        h("div", { className: "hg-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-muted" }, t("player.mute")),
          h("input", {
            id: "hg-muted", className: "hg-toggle", type: "checkbox", role: "switch", checked: ctx.prefs.muted,
            onChange: (event) => ctx.updatePrefs({ muted: event.target.checked }),
          })
        ),
        h("div", { className: "hg-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-auto-next" }, t("settings.autoNext")),
          h("input", {
            id: "hg-auto-next", className: "hg-toggle", type: "checkbox", role: "switch", checked: ctx.prefs.autoNext,
            onChange: (event) => ctx.updatePrefs({ autoNext: event.target.checked }),
          })
        ),
        h("div", { className: "hg-hint" }, t("settings.playbackRemembered")),
        h(
          "div",
          { className: "hg-field hg-range-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-mini-opacity" }, t("settings.miniOpacity")),
          h(
            "div",
            { className: "hg-range-control" },
            h("input", {
              id: "hg-mini-opacity",
              className: "hg-range",
              type: "range",
              min: 5,
              max: 100,
              step: 1,
              value: miniOpacity,
              onChange: (event) => patchMiniWindow({ opacity: Number(event.target.value) / 100 }),
            }),
            h("span", { className: "hg-range-value" }, `${miniOpacity}%`)
          )
        ),
        h("div", { className: "hg-hint" }, t("settings.miniOpacityHint")),
        h(
          "div",
          { className: "hg-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-mini-autohide" }, t("settings.miniAutoHide")),
          h("input", {
            id: "hg-mini-autohide",
            className: "hg-toggle",
            type: "checkbox",
            role: "switch",
            checked: miniWindow.autoHide === true,
            onChange: (event) => patchMiniWindow({ autoHide: event.target.checked }),
          })
        ),
        h("div", { className: "hg-hint" }, t("settings.miniAutoHideHint"))
      ),
      h(
        "section",
        { className: "hg-card-panel" },
        h(
          "div",
          { className: "hg-sec-head" },
          h("span", null, t("settings.cache")),
          h(Icon, { ctx, name: "Database", size: 14 })
        ),
        h("div", { className: "hg-hint" }, t("settings.cacheHint")),
        h(
          "button",
          {
            type: "button",
            className: `hg-btn${confirmClear ? " danger" : ""}`,
            disabled: clearing,
            onClick: () => void askClearCache(),
          },
          clearing ? h(Spinner, { label: t("settings.clearCache") }) : null,
          clearing
            ? t("settings.clearCache")
            : confirmClear
              ? t("settings.clearCacheConfirm")
              : t("settings.clearCache")
        ),
        cacheMessage
          ? h(
              "div",
              { className: `hg-callout is-${cacheMessage.kind}` },
              cacheMessage.text
            )
          : null
      ),
      h(
        "section",
        { className: "hg-card-panel" },
        h(
          "div",
          { className: "hg-sec-head" },
          h("span", null, t("settings.status")),
          h(
            "span",
            { className: `hg-status-dot${health ? " is-online" : ""}` },
            health ? t("settings.running") : t("settings.notRunning")
          )
        ),
        h("div", { className: "hg-hint" }, t("settings.statusHint")),
        healthState.status === "error" && healthState.error
          ? h(
              "div",
              { className: "hg-health-error" },
              h(ErrorNotice, {
                ctx,
                error: healthState.error,
                compact: true,
                onRetry: () => void refreshHealth(),
              }),
              h("div", { className: "hg-hint" }, t("settings.unavailableHint"))
            )
          : null,
        healthState.status === "loading" && !health
          ? h(
              "div",
              { className: "hg-loading-line" },
              h(Spinner, { label: t("settings.status") }),
              h("span", null, t("settings.status"))
            )
          : null,
        health
          ? h(
              "div",
              { className: "hg-kv" },
              h("div", { className: "hg-kv-row" }, h("span", null, t("settings.port")), h("code", null, `127.0.0.1:${health.port ?? "?"}`)),
              h("div", { className: "hg-kv-row" }, h("span", null, t("settings.version")), h("code", null, String(health.version ?? "?"))),
              h("div", { className: "hg-kv-row" }, h("span", null, t("settings.pid")), h("code", null, String(health.pid ?? "?"))),
              h("div", { className: "hg-kv-row" }, h("span", null, t("settings.uptime")), h("code", null, formatUptime(health.uptimeMs))),
              h(
                "div",
                { className: "hg-kv-row" },
                h("span", null, t("settings.sdk")),
                h(
                  "code",
                  null,
                  health.sdk?.ready ? t("settings.sdkReady") : t("settings.sdkIdle")
                )
              ),
              health.sdk?.lastError
                ? h(
                    "div",
                    { className: "hg-kv-row" },
                    h("span", null, t("settings.sdkLastError")),
                    h("code", null, String(health.sdk.lastError))
                  )
                : null
            )
          : null,
        h(
          "button",
          {
            type: "button",
            className: "hg-btn",
            disabled: healthState.status === "loading",
            onClick: () => void refreshHealth(),
          },
          healthState.status === "loading" ? h(Spinner, { label: t("settings.recheck") }) : null,
          t("settings.recheck")
        )
      ),
      h(
        "section",
        { className: "hg-card-panel" },
        h("div", { className: "hg-sec-head" }, h("span", null, t("settings.about"))),
        h("div", { className: "hg-about-version" }, `${ctx.api?.name || "Hongguo Shorts"} · v${ctx.api?.version || "?"}`),
        h("div", { className: "hg-hint" }, t("settings.aboutText"))
      )
    )
  );
}

