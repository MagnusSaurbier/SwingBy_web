// T-06 HELM — keyboard, touch, and gamepad input unified into one InputSource, polled once per
// simulation tick by the game loop (T-05 FLYWHEEL, not written yet at the time of this file —
// this is coded purely against INTERFACES.md#webgameinputts--t-06-helm, per the working agreement
// that dependents are interfaces, not implementations).
//
// Two kinds of input, kept deliberately separate (task doc, "Two kinds of input"):
//   CONTINUOUS  boost, brake, thrustUp/Down/Left/Right — read every tick via poll(), reflects
//               "is this held right now". Must be cheap: no allocation, no DOM query, per call.
//   EDGE        restart, pause, menu, toggleFps, toggleHighscores — queued on keydown, drained
//               once via drainEvents(). A held key must fire exactly once. Conflating the two
//               ("the classic bug here" per the task doc) means a held restart key would restart
//               every tick.
//
// Reference findings (full trail with line citations in notes/T-06-HELM/log.md):
//   - reference/godot/scripts/InputHandler.gd:44 only reacts to `pressed and not echo` — the
//     `event.repeat` check below (applied only to edge actions) is the direct web equivalent of
//     Godot's OS key-repeat guard.
//   - reference/godot/scripts/InputHandler.gd:54-80 routes exactly restart/pause/menu/toggleFps/
//     toggleHighscores through the edge-triggered path; boost/brake/thrust are read continuously
//     elsewhere. Confirms the 6-continuous / 5-edge split below matches the reference's own split
//     of the 11 `DEFAULT_CONTROLS` actions.
//   - reference/godot/scripts/PhysicsEngine.gd:105-106 is the actual source of the gamepad
//     mapping (boost = button A or right shoulder; brake = button B or left shoulder) — this is
//     NOT in InputHandler.gd, which has no gamepad code. Web Gamepad API standard mapping:
//     buttons[0]=A, buttons[1]=B, buttons[4]=left shoulder, buttons[5]=right shoulder.
//   - reference/godot/scripts/PhysicsEngine.gd:107-112 is the source of the thrust-direction
//     formula: thrustX = (thrustRight held) - (thrustLeft held), thrustY = (thrustDown held) -
//     (thrustUp held), each an exact -1/0/1, never diagonal-normalized. Ported as-is even though
//     SIDE_THRUST is currently 0 (task doc: "the contract is defined and the constant may
//     change"). `attachTouch`'s zones are boost/brake rects only (no directional touch zone in
//     the frozen interface), so touch never contributes to thrustX/thrustY — only keyboard does.
//
// Bindings are KeyboardEvent.code (physical key position), never .key (layout-dependent) — see
// task doc "Bindings" and INTERFACES.md ("Bindings are KeyboardEvent.code strings, not key —
// layout-independent"). `code` for the physical key under the left pinky's home-row-left neighbor
// is always "KeyA" whether the OS layout is QWERTY, QWERTZ, or AZERTY; `.key` would report
// different characters ("a", "a", "q") on each.
//
// Rebind conflict policy (task doc offered two options, "reject" or "unbind the other" — picking
// the latter): if `setBindings` is given a record where two actions share one `code`, the action
// later in `DEFAULT_CONTROLS` key order keeps the code and the earlier one is unbound (its code
// becomes "", a sentinel that can never equal a real `KeyboardEvent.code`). "Pending rebind" /
// "cancel" UX has no home in this module: the frozen `InputSource` interface has exactly 5
// methods, none of them a rebind-session API, so capturing "the next keypress" for a rebind
// screen is the caller's (T-08 BRIDGE's) responsibility on its own listener — this module only
// owns what happens once a caller commits by calling `setBindings(...)`.

import type { ControlAction, InputState } from "@swingby/core";
import { DEFAULT_CONTROLS } from "@swingby/core";

export interface InputSource {
  /** Sampled once per tick by the loop. Must be cheap. */
  poll(): InputState;
  /** Edge-triggered actions (restart, pause, menu, toggles). Drains the queue. */
  drainEvents(): ControlAction[];
  setBindings(bindings: Record<ControlAction, string>): void;
  attachTouch(zones: { boost: DOMRect; brake: DOMRect }): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------------------------
// Action taxonomy
// ---------------------------------------------------------------------------------------------

/** Canonical action order — used only to resolve binding-code collisions deterministically. */
const ACTION_ORDER = Object.keys(DEFAULT_CONTROLS) as ControlAction[];

const EDGE_ACTIONS: readonly ControlAction[] = [
  "restart",
  "pause",
  "menu",
  "toggleFps",
  "toggleHighscores",
];

/** Sentinel "unbound" value. Never equal to a real `KeyboardEvent.code`, which is always non-empty. */
const UNBOUND = "";

// ---------------------------------------------------------------------------------------------
// createInputSource
// ---------------------------------------------------------------------------------------------

export function createInputSource(target: HTMLElement): InputSource {
  // ---- bindings ---------------------------------------------------------------------------
  let bindings: Record<ControlAction, string> = { ...DEFAULT_CONTROLS };
  let codeToEdgeAction = buildEdgeReverseMap(bindings);

  function buildEdgeReverseMap(
    b: Record<ControlAction, string>,
  ): Map<string, ControlAction> {
    const map = new Map<string, ControlAction>();
    for (const action of EDGE_ACTIONS) {
      const code = b[action];
      if (code !== UNBOUND) map.set(code, action);
    }
    return map;
  }

  function isHeld(action: ControlAction): boolean {
    const code = bindings[action];
    return code !== UNBOUND && heldCodes.has(code);
  }

  // ---- continuous state: the set of currently-held KeyboardEvent.code values --------------
  const heldCodes = new Set<string>();

  // ---- touch state --------------------------------------------------------------------------
  let touchZones: { boost: DOMRect; brake: DOMRect } | null = null;
  const boostTouches = new Set<number>();
  const brakeTouches = new Set<number>();

  function inRect(x: number, y: number, r: DOMRect): boolean {
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function classifyTouch(t: Touch): "boost" | "brake" | null {
    if (!touchZones) return null;
    if (inRect(t.clientX, t.clientY, touchZones.boost)) return "boost";
    if (inRect(t.clientX, t.clientY, touchZones.brake)) return "brake";
    return null;
  }

  // ---- edge event queue -----------------------------------------------------------------
  let eventQueue: ControlAction[] = [];

  // ---- the single reused InputState object returned by poll() -----------------------------
  // Deliberately NOT a fresh object literal per call — see log entry "poll() zero-allocation
  // strategy". Consequence for whoever calls poll() (T-05 FLYWHEEL): treat the returned object
  // as read-only and don't retain a reference across ticks expecting a stable snapshot; its
  // fields are overwritten in place on the next call.
  const state: InputState = {
    boost: false,
    brake: false,
    thrustX: 0,
    thrustY: 0,
  };

  function releaseAll(): void {
    heldCodes.clear();
    boostTouches.clear();
    brakeTouches.clear();
  }

  // ---- keyboard ---------------------------------------------------------------------------

  function isEditableTarget(t: EventTarget | null): boolean {
    if (!t || typeof t !== "object") return false;
    const tagName = (t as { tagName?: unknown }).tagName;
    if (typeof tagName === "string") {
      const tag = tagName.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
        return true;
    }
    return (t as { isContentEditable?: unknown }).isContentEditable === true;
  }

  function onKeyDown(event: KeyboardEvent): void {
    // Best-effort: don't steal keys from a focused text field (e.g. T-08's username input or a
    // rebind-capture field). Only actually prevents anything when `target` is an ancestor of the
    // focused element in the real DOM tree — documented as best-effort in the log, not guaranteed
    // given an unknown future caller-side DOM structure.
    if (isEditableTarget(event.target)) return;
    const code = event.code;
    if (!code) return;
    heldCodes.add(code);
    // reference/godot/scripts/InputHandler.gd:44 — "pressed and not echo". OS key-repeat must
    // not re-fire an edge action; continuous actions don't care (Set.add is idempotent).
    if (event.repeat) return;
    const action = codeToEdgeAction.get(code);
    if (action !== undefined) eventQueue.push(action);
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.code) heldCodes.delete(event.code);
  }

  // ---- touch --------------------------------------------------------------------------------
  // Model: zone membership is decided at touchstart only (matches reference/swift/
  // InputManager.swift:31-39's touchBegan-only acquisition — dragging INTO a zone never starts a
  // control). touchmove re-checks a *tracked* touch against its own zone and releases it if it
  // has left — new behaviour beyond both references, added to satisfy the task doc's "dragging
  // off a zone releases cleanly" verification step (see log for why neither reference models this).

  function onTouchStart(event: TouchEvent): void {
    for (const t of Array.from(event.changedTouches)) {
      const zone = classifyTouch(t);
      if (zone === "boost") {
        boostTouches.add(t.identifier);
        event.preventDefault();
      } else if (zone === "brake") {
        brakeTouches.add(t.identifier);
        event.preventDefault();
      }
      // Touch outside both zones: leave it alone, don't preventDefault — task doc: "Do not use
      // preventDefault on touchstart globally — it breaks UI buttons outside the canvas."
    }
  }

  function onTouchMove(event: TouchEvent): void {
    if (!touchZones) return;
    for (const t of Array.from(event.changedTouches)) {
      if (boostTouches.has(t.identifier)) {
        if (inRect(t.clientX, t.clientY, touchZones.boost)) {
          event.preventDefault();
        } else {
          boostTouches.delete(t.identifier);
        }
      } else if (brakeTouches.has(t.identifier)) {
        if (inRect(t.clientX, t.clientY, touchZones.brake)) {
          event.preventDefault();
        } else {
          brakeTouches.delete(t.identifier);
        }
      }
    }
  }

  function onTouchEnd(event: TouchEvent): void {
    for (const t of Array.from(event.changedTouches)) {
      boostTouches.delete(t.identifier);
      brakeTouches.delete(t.identifier);
    }
  }

  function onTouchCancel(event: TouchEvent): void {
    // touchcancel must release exactly like touchend — task doc: "touchcancel must release, or
    // an interrupting call leaves the ship boosting forever."
    onTouchEnd(event);
    // Defensive extra beyond both references: if the surface now reports zero live touches,
    // hard-clear both sets even if some identifier bookkeeping went wrong somewhere. Cheap
    // insurance against a stuck input, which is explicitly the worst failure mode here.
    if (event.touches.length === 0) {
      boostTouches.clear();
      brakeTouches.clear();
    }
  }

  // ---- gamepad ------------------------------------------------------------------------------
  // The Gamepad API has no per-button events — `navigator.getGamepads()` is the only way to read
  // button state, and per spec it may allocate a fresh array each call. To keep the common case
  // (no gamepad connected) genuinely allocation-free, `poll()` only calls it when a gamepad is
  // known to be connected, tracked via the free `gamepadconnected`/`gamepaddisconnected` window
  // events plus a one-time construction-time probe (for a pad already connected before this
  // InputSource existed, which may not re-fire `gamepadconnected`).

  function hasGamepadApi(): boolean {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.getGamepads === "function"
    );
  }

  function probeGamepadConnected(): boolean {
    if (!hasGamepadApi()) return false;
    try {
      const pads = navigator.getGamepads();
      for (const p of pads) {
        if (p && p.connected) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  let gamepadConnected = probeGamepadConnected();

  function onGamepadConnected(): void {
    gamepadConnected = true;
  }
  function onGamepadDisconnected(): void {
    gamepadConnected = probeGamepadConnected();
  }

  function buttonPressed(
    buttons: readonly GamepadButton[],
    index: number,
  ): boolean {
    const b = buttons[index];
    return b ? b.pressed : false;
  }

  // ---- wire up listeners ----------------------------------------------------------------
  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", releaseAll);
  target.addEventListener("touchstart", onTouchStart, { passive: false });
  target.addEventListener("touchmove", onTouchMove, { passive: false });
  target.addEventListener("touchend", onTouchEnd, { passive: false });
  target.addEventListener("touchcancel", onTouchCancel, { passive: false });
  if (target.style) {
    // Kills scroll and double-tap zoom on the play surface — task doc, "Touch" section.
    target.style.touchAction = "none";
  }

  // window-level listeners are best-effort: real browsers have `window`, the plain-Node test
  // environment used for this module's unit tests does not (see notes/T-06-HELM/log.md — the
  // release LOGIC is identical and is tested via target-level blur instead).
  const hasWindow =
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function";
  if (hasWindow) {
    // Task doc: "Hold boost, then alt-tab away. Window blur must release it." — OS-level focus
    // loss stops keyup delivery, so held state would otherwise go stale forever.
    window.addEventListener("blur", releaseAll);
    window.addEventListener("gamepadconnected", onGamepadConnected);
    window.addEventListener("gamepaddisconnected", onGamepadDisconnected);
  }

  return {
    poll(): InputState {
      let gpBoost = false;
      let gpBrake = false;
      if (gamepadConnected && hasGamepadApi()) {
        const pads = navigator.getGamepads();
        const pad = pads[0];
        if (pad && pad.connected) {
          gpBoost =
            buttonPressed(pad.buttons, 0) || buttonPressed(pad.buttons, 5);
          gpBrake =
            buttonPressed(pad.buttons, 1) || buttonPressed(pad.buttons, 4);
        }
      }
      state.boost = isHeld("boost") || boostTouches.size > 0 || gpBoost;
      state.brake = isHeld("brake") || brakeTouches.size > 0 || gpBrake;
      state.thrustX =
        (isHeld("thrustRight") ? 1 : 0) - (isHeld("thrustLeft") ? 1 : 0);
      state.thrustY =
        (isHeld("thrustDown") ? 1 : 0) - (isHeld("thrustUp") ? 1 : 0);
      return state;
    },

    drainEvents(): ControlAction[] {
      const drained = eventQueue;
      eventQueue = [];
      return drained;
    },

    setBindings(next: Record<ControlAction, string>): void {
      const source: Partial<Record<ControlAction, string>> =
        next && typeof next === "object" ? next : {};
      const resolved: Record<ControlAction, string> = { ...DEFAULT_CONTROLS };
      for (const action of ACTION_ORDER) {
        const raw = source[action];
        resolved[action] = typeof raw === "string" ? raw : bindings[action];
      }
      // Conflict resolution: later action in ACTION_ORDER wins a shared code; earlier is
      // unbound. See the module doc comment for why this policy (vs. rejecting the call).
      const claimedBy = new Map<string, ControlAction>();
      for (const action of ACTION_ORDER) {
        const code = resolved[action];
        if (code === UNBOUND) continue;
        const priorHolder = claimedBy.get(code);
        if (priorHolder !== undefined) {
          resolved[priorHolder] = UNBOUND;
        }
        claimedBy.set(code, action);
      }
      bindings = resolved;
      codeToEdgeAction = buildEdgeReverseMap(bindings);
    },

    attachTouch(zones: { boost: DOMRect; brake: DOMRect }): void {
      // Only updates the stored rects — listeners are attached once, at construction, so calling
      // this repeatedly (e.g. on window resize) never leaks a listener.
      touchZones = zones;
    },

    destroy(): void {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", releaseAll);
      target.removeEventListener("touchstart", onTouchStart);
      target.removeEventListener("touchmove", onTouchMove);
      target.removeEventListener("touchend", onTouchEnd);
      target.removeEventListener("touchcancel", onTouchCancel);
      if (hasWindow) {
        window.removeEventListener("blur", releaseAll);
        window.removeEventListener("gamepadconnected", onGamepadConnected);
        window.removeEventListener(
          "gamepaddisconnected",
          onGamepadDisconnected,
        );
      }
      releaseAll();
      eventQueue = [];
      touchZones = null;
    },
  };
}
