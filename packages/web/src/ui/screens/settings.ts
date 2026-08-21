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
import { confirmDialog, type ConfirmHandle } from "../dialog.js";
import { requestDeleteAllLocalData } from "../localData.js";
import { backLink, screenHeader } from "../chrome.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";
import {
  CONTROL_SECTIONS,
  DEFAULT_EDIT_LEVEL_HOTKEY,
  DISPLAY_TOGGLES,
  applePlatform,
  chordLabel,
  codeLabel,
  editLevelHotkeyPatch,
  readEditLevelHotkey,
  resolveHotkeyCapture,
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
  // `pending` gained a second variant when the editor hotkey landed. It cannot be a twelfth
  // `ControlAction` — that type is `keyof typeof DEFAULT_CONTROLS` in the frozen
  // `packages/core/src/constants.ts` — so it is a separate kind rather than another map entry, and
  // it captures through `resolveHotkeyCapture` (chords) instead of `resolveRebindKey` (single
  // keys). The 11 existing bindings' path below is unchanged.
  type Pending =
    { kind: "control"; action: ControlAction } | { kind: "hotkey" };
  let pending: Pending | null = null;
  const statusEl = h("p", {}, [
    "Select an action below, then press any key to rebind it.",
  ]);
  const rebindButtons = new Map<ControlAction, HTMLElement>();

  function setStatus(msg: string): void {
    statusEl.textContent = msg;
  }

  // --- Editor hotkey (a chord, not a single key) ------------------------------------------------
  const isApple =
    typeof navigator !== "undefined" &&
    applePlatform(navigator.userAgent ?? "");
  let editHotkey = readEditLevelHotkey(settings) ?? DEFAULT_EDIT_LEVEL_HOTKEY;
  const hotkeyBtn = h("button", { type: "button", class: "btn" }, [
    chordLabel(editHotkey, { apple: isApple }),
  ]);

  function refreshHotkeyLabel(): void {
    hotkeyBtn.textContent = chordLabel(editHotkey, { apple: isApple });
  }

  // `Settings["controls"]` is `typeof DEFAULT_CONTROLS & Record<ControlAction, string>` — TS
  // infers each key at DEFAULT's literal type (e.g. `boost: "Space"`), so a rebound
  // `Record<ControlAction, string>` needs an explicit cast here even though it's structurally
  // exactly what the field holds. Same friction T-10 VAULT's log already documented for the same
  // frozen type (notes/T-10-VAULT/log.md, session 4) — not a bug, just how the intersection infers.
  function persistControls(): void {
    ctx.storage.setSettings({ controls: controls as Settings["controls"] });
  }

  function pendingButton(p: Pending): HTMLElement | undefined {
    return p.kind === "control" ? rebindButtons.get(p.action) : hotkeyBtn;
  }

  function stopPending(): void {
    if (pending) pendingButton(pending)?.removeAttribute("aria-pressed");
    pending = null;
  }

  function startRebind(action: ControlAction, label: string): void {
    if (pending?.kind === "control" && pending.action === action) {
      stopPending();
      setStatus("Rebind cancelled.");
      return;
    }
    stopPending();
    pending = { kind: "control", action };
    rebindButtons.get(action)?.setAttribute("aria-pressed", "true");
    setStatus(`Press a key for ${label}. Press Escape to cancel.`);
  }

  function startHotkeyRebind(): void {
    if (pending?.kind === "hotkey") {
      stopPending();
      setStatus("Rebind cancelled.");
      return;
    }
    stopPending();
    pending = { kind: "hotkey" };
    hotkeyBtn.setAttribute("aria-pressed", "true");
    setStatus(
      "Press the key combination for Open level in editor. Press Escape to cancel.",
    );
  }
  hotkeyBtn.addEventListener("click", startHotkeyRebind);

  function onDocumentKeydown(ev: KeyboardEvent): void {
    if (pending === null) return;
    ev.preventDefault();

    if (pending.kind === "hotkey") {
      const capture = resolveHotkeyCapture(ev);
      // A modifier pressed on its own is the user mid-chord — stay armed and say nothing. Without
      // this, holding Option would instantly "bind" Option and the chord could never be entered.
      if (capture.kind === "pending") return;
      stopPending();
      if (capture.kind === "cancel") {
        setStatus("Rebind cancelled.");
        return;
      }
      editHotkey = capture.binding;
      ctx.storage.setSettings(editLevelHotkeyPatch(editHotkey));
      refreshHotkeyLabel();
      setStatus("Binding updated.");
      return;
    }

    const action = pending.action;
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
    // The editor hotkey resets with everything else. It is rendered as one more rebindable binding
    // in this screen, so a "Reset all controls" that quietly skipped it would be a lie.
    editHotkey = DEFAULT_EDIT_LEVEL_HOTKEY;
    ctx.storage.setSettings(editLevelHotkeyPatch(editHotkey));
    refreshHotkeyLabel();
    setStatus("Controls reset to default.");
  });

  // --- Delete all local data -----------------------------------------------------------------
  // Sits below "Reset all controls to default" and is a different promise: reset restores the
  // eleven bindings plus the editor hotkey and keeps everything else, this erases every
  // `swingby:`-prefixed key the app has written (name, settings, personal bests, custom levels,
  // T-13's offline submission queue) and reloads onto the main menu, so the app comes up exactly as
  // it does for a first-time visitor. `.btn-danger` under its own heading is what keeps the two
  // controls from reading as duplicates.
  let openDialog: ConfirmHandle | null = null;

  const deleteBtn = h(
    "button",
    { type: "button", class: "btn btn-block btn-danger" },
    ["Delete all local data"],
  );
  deleteBtn.addEventListener("click", () => {
    if (openDialog) return;
    stopPending();
    const dialog = confirmDialog(document.body, {
      title: "Delete all local data?",
      body: "This permanently deletes everything SwingBy has saved in this browser: your player name, settings and key bindings, personal best times, and your custom levels. Scores you have already submitted to the leaderboard and levels you have already shared stay online. This cannot be undone.",
      confirmLabel: "Delete everything",
      cancelLabel: "Cancel",
      danger: true,
    });
    openDialog = dialog;
    void requestDeleteAllLocalData({ confirm: () => dialog.result }).then(
      (outcome) => {
        openDialog = null;
        // Only reachable on cancel: the confirmed path has already started a document load, so
        // this screen is on its way out and any status text would flash and vanish.
        if (!outcome.deleted) setStatus("Nothing was deleted.");
      },
    );
  });

  const dangerSection = h("div", { class: "panel controls-section" }, [
    h("h2", {}, ["Local data"]),
    h("p", { class: "toggle-desc" }, [
      "Erases everything saved in this browser: player name, settings, personal bests and custom levels. Cannot be undone.",
    ]),
    deleteBtn,
  ]);

  // --- Back: returns to the in-game menu if that's where Settings was opened from -------------
  const routerState = ctx.router.state() as RouterState | null;
  const backHref = routerState?.returnTo ?? "/";

  const el = h("main", { class: "screen" }, [
    h("div", { class: "panel screen-shell" }, [
      screenHeader("Settings", "Customize your HUD, prediction, and controls."),
      usernameField,
      h("div", { class: "settings-toggles" }, toggleRows),
      ...controlSections,
      // Its own section rather than a row inside `CONTROL_SECTIONS`, because that array is typed
      // `[ControlAction, string]` and this binding deliberately is not a `ControlAction` (see the
      // `Pending` comment above). Same `.control-row` markup, so it looks and behaves like the
      // other eleven.
      h("div", { class: "panel controls-section" }, [
        h("h2", {}, ["Editor"]),
        h("div", { class: "control-row" }, [
          h("span", {}, ["Open level in editor"]),
          hotkeyBtn,
        ]),
      ]),
      h("div", { class: "panel status-card" }, [statusEl]),
      resetBtn,
      dangerSection,
      h("div", { class: "screen-footer" }, [backLink(backHref)]),
    ]),
  ]);

  return {
    el,
    destroy(): void {
      document.removeEventListener("keydown", onDocumentKeydown);
      // The dialog is mounted on `document.body`, not inside this screen's subtree, so navigating
      // away while it is open would otherwise leave it on screen over the next screen.
      openDialog?.dismiss();
      openDialog = null;
      inputSource.destroy();
    },
  };
}
