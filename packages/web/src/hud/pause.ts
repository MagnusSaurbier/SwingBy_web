/**
 * T-09 GAUGE — deliverable 2: the pause panel. Task doc: "Resume, Restart, Settings, Level Select,
 * Main Menu. Reuses T-08's in-game menu component; coordinate rather than duplicating it."
 *
 * T-08 BRIDGE already built the actual menu UI at `ui/screens/ingameMenu.ts` (`mountIngameMenu`),
 * whose own header comment says: "Kept separate so T-09 GAUGE can reuse it once a real GameSession
 * exists." This module is exactly that reuse: a thin, session-aware wrapper. It owns nothing about
 * *how* the menu looks (that stays T-08's), only *when* it's shown and what Resume/Restart do
 * against a real `GameSession` — the part that didn't exist when T-08 wired its own placeholder
 * `openMenu`/`closeMenu` into `ui/screens/play.ts` (there is no session there yet; see
 * notes/T-09-GAUGE/log.md finding #4).
 *
 * Visibility is driven by `snapshot.status === "paused"` — this module never decides to pause on
 * its own; that already happens inside `loop.ts`'s edge-event handling for the bound "pause" key.
 * `open()` is exposed for a caller-side manual trigger (an on-screen pause BUTTON, not the keyboard
 * shortcut) — it calls `session.pause()` and shows the overlay in the same synchronous call, so
 * there's no one-frame flicker waiting for the next `subscribe` notification.
 *
 * "Pause panel opens and closes without disturbing the simulation" (DoD): this module calls
 * `session.pause()`/`resume()`/`restart()` and nothing else on `GameSession` — no direct world/tick
 * access exists here to disturb in the first place (hud/** never imports `core/physics` or
 * `render/`, confirmed absent from this file's imports).
 */

import type { GameSession, GameSnapshot } from "../game/loop.js";
import {
  mountIngameMenu,
  type IngameMenuHandle,
} from "../ui/screens/ingameMenu.js";

export interface PausePanelDeps {
  session: GameSession;
  /** Same label shown in the menu's subtitle — caller-computed, matches `ui/screens/play.ts`'s own
   *  `levelLabel` convention ("Stage 01 · Orbital Primer", "Custom · My Level", ...). */
  levelLabel: string;
  onSettings(): void;
  onChooseLevel(): void;
  onMainMenu(): void;
  /** Optional passthrough to `mountIngameMenu`'s own optional "Edit this level" action — see its
   *  doc comment. Carried, not interpreted: this module still calls nothing on `GameSession` but
   *  pause/resume/restart. */
  onEditLevel?: () => void;
}

export interface PausePanelHandle {
  /** Mount point — append once into the play screen; the overlay attaches/detaches inside it. */
  el: HTMLElement;
  isOpen(): boolean;
  /** Manual trigger (e.g. an on-screen pause button): pauses the session and shows the panel
   *  immediately. No-ops if not currently playing (delegates to `session.pause()`'s own guard). */
  open(): void;
  /** Manual close without resuming — rare (e.g. navigating away while paused); the Resume button
   *  itself calls `session.resume()` first, this does not. */
  close(): void;
  destroy(): void;
}

export function mountPausePanel(deps: PausePanelDeps): PausePanelHandle {
  const root = document.createElement("div");
  root.classList.add("sb-pause-root");

  let overlay: IngameMenuHandle | null = null;
  let lastStatus: GameSnapshot["status"] | null = null;

  function showOverlay(): void {
    if (overlay) return;
    const handle = mountIngameMenu(deps.levelLabel, {
      onResume: () => {
        deps.session.resume();
        hideOverlay();
      },
      onRestart: () => {
        deps.session.restart();
        hideOverlay();
      },
      onSettings: deps.onSettings,
      onChooseLevel: deps.onChooseLevel,
      onMainMenu: deps.onMainMenu,
      onEditLevel: deps.onEditLevel,
    });
    overlay = handle;
    root.appendChild(handle.el);
    handle.activate();
  }

  function hideOverlay(): void {
    if (!overlay) return;
    overlay.close();
    overlay.el.remove();
    overlay = null;
  }

  function onSnapshot(snap: GameSnapshot): void {
    if (snap.status === lastStatus) return;
    lastStatus = snap.status;
    if (snap.status === "paused") showOverlay();
    else hideOverlay();
  }

  onSnapshot(deps.session.snapshot());
  const unsubscribe = deps.session.subscribe(onSnapshot);

  return {
    el: root,
    isOpen(): boolean {
      return overlay !== null;
    },
    open(): void {
      deps.session.pause();
      showOverlay();
    },
    close(): void {
      hideOverlay();
    },
    destroy(): void {
      unsubscribe();
      hideOverlay();
    },
  };
}
