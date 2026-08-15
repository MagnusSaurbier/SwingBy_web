/**
 * T-09 GAUGE — barrel + `mountGauge`, a convenience composition wiring hud.ts + pause.ts +
 * complete.ts + toast.ts against one `GameSession`. Not itself one of the four named deliverables,
 * but the thing that makes the dev harness (and a future `main.ts` integration, once someone wires
 * a real session into `ui/screens/play.ts`) a one-call affair instead of re-deriving this glue.
 */

export * from "./format.js";
export * from "./colors.js";
export * from "./hints.js";
export { createToastQueue, type ToastQueue, type ToastQueueOptions } from "./toast.js";
export { mountHud, type HudDeps, type HudHandle } from "./hud.js";
export { mountPausePanel, type PausePanelDeps, type PausePanelHandle } from "./pause.js";
export {
  mountCompletePanel,
  type CompletePanelDeps,
  type CompletePanelHandle,
  type RankSlot,
} from "./complete.js";

import type { Level } from "@swingby/core";
import type { GameSession } from "../game/loop.js";
import type { Storage } from "../storage/index.js";
import { mountHud, type HudHandle } from "./hud.js";
import { mountPausePanel, type PausePanelHandle } from "./pause.js";
import { mountCompletePanel, type CompletePanelHandle } from "./complete.js";
import { createToastQueue, type ToastQueue } from "./toast.js";

export interface GaugeDeps {
  session: GameSession;
  level: Level;
  levelLabel: string;
  levelKey: string;
  storage: Storage;
  onSettings(): void;
  onChooseLevel(): void;
  onMainMenu(): void;
  /** Absent when there's no next level. */
  onNext?: () => void;
}

export interface GaugeHandle {
  el: HTMLElement;
  hud: HudHandle;
  pause: PausePanelHandle;
  complete: CompletePanelHandle;
  toast: ToastQueue;
  destroy(): void;
}

export function mountGauge(deps: GaugeDeps): GaugeHandle {
  const root = document.createElement("div");
  root.classList.add("sb-gauge-root");

  const hud = mountHud({
    session: deps.session,
    level: deps.level,
    levelLabel: deps.levelLabel,
    levelKey: deps.levelKey,
    storage: deps.storage,
  });
  root.appendChild(hud.el);

  const pause = mountPausePanel({
    session: deps.session,
    levelLabel: deps.levelLabel,
    onSettings: deps.onSettings,
    onChooseLevel: deps.onChooseLevel,
    onMainMenu: deps.onMainMenu,
  });
  root.appendChild(pause.el);

  const complete = mountCompletePanel({
    session: deps.session,
    level: deps.level,
    levelLabel: deps.levelLabel,
    levelKey: deps.levelKey,
    storage: deps.storage,
    onNext: deps.onNext,
    onChooseLevel: deps.onChooseLevel,
  });
  root.appendChild(complete.el);

  const toast = createToastQueue();
  root.appendChild(toast.el);

  deps.session.onComplete(() => {
    toast.show("Target reached");
  });

  // Suppress hud.ts's small "Paused" badge while the full pause panel is showing — mirrors Godot's
  // own `hud_pause_label.visible = paused and not menu_panel.visible` (HUDController.gd:102).
  // Subscribes AFTER hud/pause so it observes their already-updated state within the same
  // notification pass (subscribers run in registration order — see notes/T-09-GAUGE/log.md).
  const unsubscribe = deps.session.subscribe(() => {
    hud.setPauseIndicatorSuppressed(pause.isOpen());
  });

  return {
    el: root,
    hud,
    pause,
    complete,
    toast,
    destroy(): void {
      unsubscribe();
      hud.destroy();
      pause.destroy();
      complete.destroy();
      toast.destroy();
    },
  };
}
