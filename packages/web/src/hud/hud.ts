/**
 * The always-on in-game HUD (level info, timers, hint, FPS, bounds warning, pause indicator).
 * DOM overlaid on top of the game canvas, never drawn into it. Consumes `GameSession` exactly as
 * documented in docs/INTERFACES.md: `session.subscribe((snapshot) => {...})`.
 *
 * Update discipline (this runs up to 144x/sec):
 *   - Every DOM node is created ONCE at mount and cached in closure variables. `onSnapshot` never
 *     calls `document.createElement` or queries the DOM.
 *   - Two update tiers. "Every frame": bounds-warning glow opacity, pause-indicator visibility,
 *     level-label fade — all single comparisons + at most one write, driven by fields that
 *     genuinely change every tick (`boundsWarning`) or by a cheap boolean derived from `status`/
 *     `elapsedTicks`. "Throttled ~10 Hz": time/boost/best/FPS text and hint re-evaluation, via a
 *     plain modulo counter on the subscribe call count — deliberately NOT `performance.now()` (see
 *     notes/archive/T-09-GAUGE/log.md: the render module's log flags wall-clock-driven cosmetic
 *     state as a real flakiness hazard in exact-comparison tests; a tick/call-count-based throttle
 *     needs no clock mocking and is fully deterministic under the fake session).
 *   - Every write compares against the last-rendered value first — a steady value costs zero DOM
 *     writes, not just zero *visible* changes.
 *   - No `offsetWidth`/`getBoundingClientRect` anywhere in this file.
 */

import type { Level } from "@swingby/core";
import { TPS } from "@swingby/core";
import type { GameSession, GameSnapshot } from "../game/loop.js";
import type { PersonalBest, Storage } from "../storage/index.js";
import { cssRgba } from "./colors.js";
import { formatDuration, ticksToMs } from "./format.js";
import { evaluateHint } from "./hints.js";
import { attachCornerDrag } from "./hint-drag.js";

export interface HudDeps {
  session: GameSession;
  level: Level;
  /** Caller-computed label, matching `ui/screens/play.ts`'s own convention ("Stage 01", "Custom",
   *  ...) — HUD doesn't own level-index->label logic, that's routing/level-select's job. */
  levelLabel: string;
  /** `levelId(index)` or `customLevelId(level)` — the key `storage.getBest` expects. */
  levelKey: string;
  storage: Pick<Storage, "getSettings" | "getBest">;
}

export interface HudHandle {
  el: HTMLElement;
  /** Re-reads `storage.getSettings()` immediately (throttled polling otherwise catches up within
   *  ~100ms on its own — call this right after the Settings screen closes for instant feedback). */
  refreshSettings(): void;
  /** Re-reads `storage.getBest(levelKey)` immediately — call after a completion records a score. */
  refreshBest(): void;
  /** Suppresses the small "Paused" badge without touching anything else — for when a caller (e.g.
   *  `hud/index.ts`'s `mountGauge`) shows the full pause PANEL, which already says "Paused" as its
   *  title; showing both reads as redundant. Mirrors Godot's own
   *  `hud_pause_label.visible = paused and not menu_panel.visible` (`HUDController.gd:102`). */
  setPauseIndicatorSuppressed(suppressed: boolean): void;
  destroy(): void;
}

/** Task doc: "Fades after ~3 s." Tick-based (not wall-clock) so it's deterministic under the fake
 *  session and re-fades-in naturally on every restart (elapsedTicks resets to 0). */
const LABEL_FADE_TICKS = TPS * 3;

/** ~10 Hz at 144 fps (144 / 14 ≈ 10.3). A plain call-count modulo, not a timer. */
const THROTTLE_FRAMES = 14;

export function mountHud(deps: HudDeps): HudHandle {
  const root = document.createElement("div");
  root.classList.add("sb-hud");
  root.style.setProperty("--sb-hud-glow-color", cssRgba("hudGlow", 1));

  const boundsGlow = document.createElement("div");
  boundsGlow.classList.add("sb-hud-bounds-glow");
  root.appendChild(boundsGlow);

  const top = document.createElement("div");
  top.classList.add("sb-hud-top");
  root.appendChild(top);

  const levelBox = document.createElement("div");
  levelBox.classList.add("sb-hud-level");
  top.appendChild(levelBox);

  const levelText = document.createElement("div");
  levelText.classList.add("sb-hud-level-text");
  levelText.textContent = `${deps.levelLabel} · ${deps.level.name}`;
  levelBox.appendChild(levelText);

  const authorText = document.createElement("div");
  authorText.classList.add("sb-hud-level-author");
  authorText.textContent = `by ${deps.level.author}`;
  levelBox.appendChild(authorText);

  const stats = document.createElement("div");
  stats.classList.add("sb-hud-stats");
  top.appendChild(stats);

  const timerEl = document.createElement("div");
  timerEl.classList.add("sb-hud-timer");
  stats.appendChild(timerEl);

  const boostEl = document.createElement("div");
  boostEl.classList.add("sb-hud-boost");
  stats.appendChild(boostEl);

  const bestEl = document.createElement("div");
  bestEl.classList.add("sb-hud-best");
  stats.appendChild(bestEl);

  const fpsEl = document.createElement("div");
  fpsEl.classList.add("sb-hud-fps");
  stats.appendChild(fpsEl);

  // Card wrapper (`.sb-hud-hint`) + a collapse toggle (top-left arrow button, no text content of
  // its own — a CSS-drawn triangle, not a glyph) + the actual hint text in its own child. Keeping
  // the toggle's own text empty means `hintEl.textContent` (the card) still equals exactly the
  // hint text, same as before this card ever had a button in it.
  const hintEl = document.createElement("div");
  hintEl.classList.add("sb-hud-hint");
  root.appendChild(hintEl);

  const hintToggle = document.createElement("button");
  hintToggle.type = "button";
  hintToggle.classList.add("sb-hud-hint-toggle");
  hintEl.appendChild(hintToggle);

  const hintArrow = document.createElement("span");
  hintArrow.classList.add("sb-hud-hint-arrow");
  hintArrow.setAttribute("aria-hidden", "true");
  hintToggle.appendChild(hintArrow);

  const hintTextEl = document.createElement("div");
  hintTextEl.classList.add("sb-hud-hint-text");
  hintEl.appendChild(hintTextEl);

  let hintCollapsed = false;
  function setHintCollapsed(collapsed: boolean): void {
    hintCollapsed = collapsed;
    hintEl.classList.toggle("sb-collapsed", collapsed);
    hintToggle.setAttribute("aria-expanded", String(!collapsed));
    hintToggle.setAttribute(
      "aria-label",
      collapsed ? "Show hint" : "Collapse hint",
    );
  }
  setHintCollapsed(false);

  // Draggable, corner-snapping, from anywhere on the card (including the toggle button, so the
  // collapsed button-only state stays draggable too). The toggle's own click still just collapses
  // — `wasDragged()` tells it apart from the click a drag-release synthesizes on the same element.
  const hintDrag = attachCornerDrag(hintEl, root);
  hintToggle.addEventListener("click", () => {
    if (hintDrag.wasDragged()) return;
    setHintCollapsed(!hintCollapsed);
  });

  const pauseIndicator = document.createElement("div");
  pauseIndicator.classList.add("sb-hud-pause-indicator");
  pauseIndicator.textContent = "⏸ Paused";
  root.appendChild(pauseIndicator);

  // ---- cached state for compare-before-write; also the mutable "settings"/"best" the throttled
  // tier reads instead of hitting storage every single frame (storage.getSettings() allocates a
  // fresh object per call — see storage/index.ts's toSettings — so caching + explicit refresh is
  // what keeps the hot path allocation-free). ----
  let settings = deps.storage.getSettings();
  let best: PersonalBest | null = deps.storage.getBest(deps.levelKey);
  let pauseSuppressed = false;

  let lastTimerText: string | null = null;
  let lastBoostText: string | null = null;
  let lastBestText: string | null = null;
  let lastFpsText: string | null = null;
  let lastHintText: string | null | undefined = undefined;
  let lastHintVisible: boolean | null = null;
  let lastTimesVisible: boolean | null = null;
  let lastFpsVisible: boolean | null = null;
  let lastBoundsWarning = -1;
  let lastPauseVisible: boolean | null = null;
  let lastLevelFaded: boolean | null = null;
  let lastEvaluatedStatus: GameSnapshot["status"] | null = null;

  let frameCounter = 0;
  // The most recent snapshot, kept around so `refreshSettings()`/`refreshBest()`/
  // `setPauseIndicatorSuppressed()` — all called OUTSIDE the subscribe callback, from arbitrary
  // caller code — can re-render immediately against real data instead of silently updating a cache
  // that only takes visible effect on the NEXT snapshot. Found via a real integration test
  // (hud-gauge.test.ts): `mountGauge`'s composition calls `setPauseIndicatorSuppressed` and
  // `refreshBest` from ITS OWN subscriber/onComplete callback, i.e. from OUTSIDE this closure's own
  // `onSnapshot`, and both need to land the same tick they're called, not "eventually" — this
  // module's own doc comments already promised that ("call this right after the Settings screen
  // closes for INSTANT feedback"), so the fix is making that literally true, not softening the
  // promise. See notes/T-09-GAUGE/log.md.
  let lastSnapshot: GameSnapshot = deps.session.snapshot();

  function renderPauseIndicator(): void {
    const pauseVisible = lastSnapshot.status === "paused" && !pauseSuppressed;
    if (pauseVisible !== lastPauseVisible) {
      lastPauseVisible = pauseVisible;
      pauseIndicator.classList.toggle("sb-visible", pauseVisible);
    }
  }

  /** The timer/boost/best/fps block — normally run on the throttled ~10Hz tier, but ALSO callable
   *  on demand by `refreshSettings()`/`refreshBest()` for immediate feedback. */
  function renderStats(snap: GameSnapshot): void {
    const timesVisible = settings.showTimes;
    if (timesVisible !== lastTimesVisible) {
      lastTimesVisible = timesVisible;
      timerEl.classList.toggle("sb-hidden", !timesVisible);
      boostEl.classList.toggle("sb-hidden", !timesVisible);
      bestEl.classList.toggle(
        "sb-hidden",
        !(timesVisible && settings.showHighscores),
      );
    }
    if (timesVisible) {
      const timerText = `Time ${formatDuration(ticksToMs(snap.elapsedTicks))}`;
      if (timerText !== lastTimerText) {
        lastTimerText = timerText;
        timerEl.textContent = timerText;
      }
      const boostText = `Boost ${formatDuration(ticksToMs(snap.boostTicks))}`;
      if (boostText !== lastBoostText) {
        lastBoostText = boostText;
        boostEl.textContent = boostText;
      }
      if (settings.showHighscores) {
        const bestText = best
          ? `Best ${formatDuration(best.timeMs)} · ${formatDuration(best.boostMs)} boost`
          : "Best —";
        if (bestText !== lastBestText) {
          lastBestText = bestText;
          bestEl.textContent = bestText;
        }
      }
    }

    const fpsVisible = settings.showFps;
    if (fpsVisible !== lastFpsVisible) {
      lastFpsVisible = fpsVisible;
      fpsEl.classList.toggle("sb-hidden", !fpsVisible);
    }
    if (fpsVisible) {
      const fpsText = `FPS ${Math.round(snap.fps)}`;
      if (fpsText !== lastFpsText) {
        lastFpsText = fpsText;
        fpsEl.textContent = fpsText;
      }
    }
  }

  function renderHint(snap: GameSnapshot): void {
    lastEvaluatedStatus = snap.status;
    const hintText = evaluateHint(deps.level, snap.status);
    const hintVisible = hintText !== null;
    if (hintVisible !== lastHintVisible) {
      lastHintVisible = hintVisible;
      hintEl.classList.toggle("sb-visible", hintVisible);
    }
    if (hintText !== lastHintText) {
      lastHintText = hintText;
      hintTextEl.textContent = hintText ?? "";
    }
  }

  function onSnapshot(snap: GameSnapshot): void {
    frameCounter++;
    lastSnapshot = snap;

    // --- every-frame tier ---
    if (snap.boundsWarning !== lastBoundsWarning) {
      lastBoundsWarning = snap.boundsWarning;
      boundsGlow.style.opacity = String(snap.boundsWarning);
    }

    renderPauseIndicator();

    const levelFaded =
      snap.status === "playing" && snap.elapsedTicks > LABEL_FADE_TICKS;
    if (levelFaded !== lastLevelFaded) {
      lastLevelFaded = levelFaded;
      levelBox.classList.toggle("sb-faded", levelFaded);
    }

    // --- throttled ~10Hz tier (always runs on the very first call, so the HUD isn't blank for a
    // whole throttle window right after mount) ---
    const throttledTick =
      frameCounter === 1 || frameCounter % THROTTLE_FRAMES === 0;
    // The hint block additionally runs on any STATUS TRANSITION, not just the periodic throttle.
    // Found via the 360px pause-panel screenshot (see notes/T-09-GAUGE/log.md): gating hint
    // visibility purely by the throttled tier meant a snapshot stream that pauses right between
    // two throttled ticks (the common case for a scripted/manually-driven session, and possible —
    // if rare — for a real 144Hz one too) left stale hint text visible, faintly bleeding through
    // the pause dialog's translucent panel background. `evaluateHint` already returns `null`
    // whenever `status !== "playing"` (hints.ts) — that result needs to land the SAME frame the
    // status changes, not up to ~14 frames later. The hint's TEXT content while actively playing
    // still only needs the normal throttled cadence (nobody reads hint copy at 144Hz); only the
    // visibility gate on a transition needs to be immediate.
    const statusChanged = snap.status !== lastEvaluatedStatus;

    if (throttledTick) renderStats(snap);
    if (throttledTick || statusChanged) renderHint(snap);
  }

  // Render immediately from the current snapshot so the HUD isn't blank for the first frame.
  onSnapshot(deps.session.snapshot());
  const unsubscribe = deps.session.subscribe(onSnapshot);

  return {
    el: root,
    refreshSettings(): void {
      settings = deps.storage.getSettings();
      renderStats(lastSnapshot);
    },
    refreshBest(): void {
      best = deps.storage.getBest(deps.levelKey);
      renderStats(lastSnapshot);
    },
    setPauseIndicatorSuppressed(suppressed: boolean): void {
      pauseSuppressed = suppressed;
      renderPauseIndicator();
    },
    destroy(): void {
      unsubscribe();
      hintDrag.destroy();
    },
  };
}
