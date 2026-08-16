// T-08 BRIDGE — Settings screen. Task doc: "Username, all display toggles (trail, showFps,
// showHighscores, showTimes, showFuture, showForceVector), and the control rebinding list."
//
// Rebind capture: this screen owns "listen for the next keydown" (input.ts's own header comment,
// read directly, confirms this explicitly — the frozen InputSource interface has no rebind-session
// API on purpose; T-06 HELM's module "only owns what happens once a caller commits by calling
// setBindings(...)"). A live `InputSource` is created for the lifetime of this screen purely to
// drive that call (DoD: "Rebinding UI drives InputSource.setBindings") — the actual source of
// truth a running game session reads is `Settings.controls` via T-10 VAULT, re-read fresh each
// time T-05 constructs a session; this instance additionally keeps any *already-live* InputSource
// (e.g. one instantiated by a session paused behind the in-game menu) in sync without restarting it.

import type { ControlAction, Settings } from "@swingby/core";
import { DEFAULT_CONTROLS } from "@swingby/core";
import { createInputSource } from "../../game/input.js";
import { h } from "../dom.js";
import { backLink, screenHeader } from "../chrome.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";
import {
  CONTROL_SECTIONS,
  DISPLAY_TOGGLES,
  codeLabel,
  resolveRebindKey,
} from "../view-models.js";

interface RouterState {
  returnTo?: string;
}

export function renderSettings(ctx: ScreenCtx): ScreenResult {
  const settings = ctx.storage.getSettings();
  let controls: Record<ControlAction, string> = { ...settings.controls };
  const inputSource = createInputSource(document.body);

  // --- Username ----------------------------------------------------------------------------
  const usernameInput = h("input", {
    id: "settings-username",
    class: "text-input",
    type: "text",
    placeholder: "Guest",
    value: settings.username,
    maxlength: "24",
  }) as HTMLInputElement;
  function commitUsername(): void {
    const value = usernameInput.value.trim() || "Guest";
    ctx.storage.setSettings({ username: value });
  }
  usernameInput.addEventListener("change", commitUsername);
  usernameInput.addEventListener("keydown", (ev) => {
    if ((ev as KeyboardEvent).key === "Enter") usernameInput.blur();
  });
  const usernameField = h("div", { class: "field" }, [
    h("label", { for: "settings-username" }, ["Player name"]),
    usernameInput,
  ]);

  // --- Display toggles -----------------------------------------------------------------------
  const toggleRows = DISPLAY_TOGGLES.map((toggle) => {
    const id = `toggle-${String(toggle.key)}`;
    const checkbox = h("input", {
      type: "checkbox",
      id,
      checked: Boolean(settings[toggle.key]),
    }) as HTMLInputElement;
    checkbox.addEventListener("change", () => {
      ctx.storage.setSettings({ [toggle.key]: checkbox.checked } as never);
    });
    return h("div", { class: "panel" }, [
      h("div", { class: "toggle-row" }, [
        h("div", { class: "toggle-text" }, [
          h("label", { class: "toggle-title", for: id }, [toggle.label]),
          h("span", { class: "toggle-desc" }, [toggle.description]),
        ]),
        h("span", { class: "toggle" }, [
          checkbox,
          h("span", { class: "track" }, [h("span", { class: "thumb" }, [])]),
        ]),
      ]),
    ]);
  });

  // --- Control rebinding ------------------------------------------------------------------
  let pending: ControlAction | null = null;
  const statusEl = h("p", {}, [
    "Select an action below, then press any key to rebind it.",
  ]);
  const rebindButtons = new Map<ControlAction, HTMLElement>();

  function setStatus(msg: string): void {
    statusEl.textContent = msg;
  }

  // `Settings["controls"]` is `typeof DEFAULT_CONTROLS & Record<ControlAction, string>` — TS
  // infers each key at DEFAULT's literal type (e.g. `boost: "Space"`), so a rebound
  // `Record<ControlAction, string>` needs an explicit cast here even though it's structurally
  // exactly what the field holds. Same friction T-10 VAULT's log already documented for the same
  // frozen type (notes/T-10-VAULT/log.md, session 4) — not a bug, just how the intersection infers.
  function persistControls(): void {
    ctx.storage.setSettings({ controls: controls as Settings["controls"] });
  }

  function stopPending(): void {
    if (pending) rebindButtons.get(pending)?.removeAttribute("aria-pressed");
    pending = null;
  }

  function startRebind(action: ControlAction, label: string): void {
    if (pending === action) {
      stopPending();
      setStatus("Rebind cancelled.");
      return;
    }
    stopPending();
    pending = action;
    rebindButtons.get(action)?.setAttribute("aria-pressed", "true");
    setStatus(`Press a key for ${label}. Press Escape to cancel.`);
  }

  function onDocumentKeydown(ev: KeyboardEvent): void {
    if (pending === null) return;
    ev.preventDefault();
    const action = pending;
    const btn = rebindButtons.get(action);
    stopPending();
    const result = resolveRebindKey({ code: ev.code });
    if (result.cancel) {
      setStatus("Rebind cancelled.");
      return;
    }
    controls = { ...controls, [action]: result.code };
    persistControls();
    inputSource.setBindings(controls);
    if (btn) btn.textContent = codeLabel(result.code);
    setStatus("Binding updated.");
  }
  document.addEventListener("keydown", onDocumentKeydown);

  function controlRow(action: ControlAction, label: string): HTMLElement {
    const btn = h("button", { type: "button", class: "btn" }, [
      codeLabel(controls[action]),
    ]);
    btn.addEventListener("click", () => startRebind(action, label));
    rebindButtons.set(action, btn);
    return h("div", { class: "control-row" }, [h("span", {}, [label]), btn]);
  }

  const controlSections = CONTROL_SECTIONS.map((section) =>
    h("div", { class: "panel controls-section" }, [
      h("h2", {}, [section.title]),
      ...section.actions.map(([action, label]) => controlRow(action, label)),
    ]),
  );

  const resetBtn = h("button", { type: "button", class: "btn btn-block" }, [
    "Reset all controls to default",
  ]);
  resetBtn.addEventListener("click", () => {
    stopPending();
    controls = { ...DEFAULT_CONTROLS };
    persistControls();
    inputSource.setBindings(controls);
    for (const [action, btn] of rebindButtons)
      btn.textContent = codeLabel(controls[action]);
    setStatus("Controls reset to default.");
  });

  // --- Back — returns to the in-game menu if that's where Settings was opened from -----------
  const routerState = ctx.router.state() as RouterState | null;
  const backHref = routerState?.returnTo ?? "/";

  const el = h("main", { class: "screen" }, [
    h("div", { class: "panel screen-shell" }, [
      screenHeader("Settings", "Customize your HUD, prediction, and controls."),
      usernameField,
      h("div", { class: "settings-toggles" }, toggleRows),
      ...controlSections,
      h("div", { class: "panel status-card" }, [statusEl]),
      resetBtn,
      h("div", { class: "screen-footer" }, [backLink(backHref)]),
    ]),
  ]);

  return {
    el,
    destroy(): void {
      document.removeEventListener("keydown", onDocumentKeydown);
      inputSource.destroy();
    },
  };
}
