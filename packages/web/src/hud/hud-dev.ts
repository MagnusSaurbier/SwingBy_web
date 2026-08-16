/**
 * T-09 GAUGE dev harness script. See hud-dev.html's header comment for scope/rationale.
 */

import { BUILTIN_LEVELS, levelId } from "@swingby/core";
import { createStorage } from "../storage/index.js";
import { mountGauge } from "./index.js";
import {
  createFakeSession,
  driveBoundsWarningRamp,
  driveResetFlash,
  drivePaused,
  driveCompletion,
} from "../../test/fake-session.js";

const level = BUILTIN_LEVELS[0]!;
const key = levelId(0);

const stage = document.getElementById("stage")!;
const storage = createStorage();

const session = createFakeSession({ status: "playing", elapsedTicks: 0 });

const gauge = mountGauge({
  session,
  level,
  levelLabel: "Stage 01",
  levelKey: key,
  storage,
  onSettings: () => gauge.toast.show("Settings (stub)"),
  onChooseLevel: () => gauge.toast.show("Level select (stub)"),
  onMainMenu: () => gauge.toast.show("Main menu (stub)"),
  onNext: () => gauge.toast.show("Next level (stub)"),
});
stage.appendChild(gauge.el);

// Let a few ticks accumulate so the timer readout isn't stuck at 0:00.000 for the base screenshot.
session.patch({ elapsedTicks: 812, boostTicks: 140, fps: 144 });

// ---------------------------------------------------------------------------
// Control surface — both wired to the on-page buttons and exposed on window for the Playwright
// capture script, matching T-04 AURORA's window.__aurora precedent.
// ---------------------------------------------------------------------------

function completeWith(timeMs: number, boostMs: number): void {
  driveCompletion(session, {
    timeMs,
    boostMs,
    tape: { ticks: Math.round((timeMs * 144) / 1000), boost: [], brake: [] },
  });
}

const api = {
  session,
  gauge,
  storage,
  driveBoundsWarningRamp: () => driveBoundsWarningRamp(session, 20),
  driveResetFlash: () => driveResetFlash(session),
  openPause: () => gauge.pause.open(),
  resume: () => {
    gauge.pause.close();
    session.resume();
  },
  completeNewBest: () => completeWith(9200, 150),
  completeNotBest: () => completeWith(30000, 4000),
  toastOne: () => gauge.toast.show("Target reached"),
  toastBurst: (n = 20) => {
    for (let i = 0; i < n; i++) gauge.toast.show(`Saved custom stage ${i}`);
  },
};

declare global {
  interface Window {
    __gauge: typeof api;
  }
}
window.__gauge = api;

document
  .getElementById("btn-bounds")!
  .addEventListener("click", api.driveBoundsWarningRamp);
document.getElementById("btn-pause")!.addEventListener("click", api.openPause);
document.getElementById("btn-resume")!.addEventListener("click", api.resume);
document
  .getElementById("btn-reset-flash")!
  .addEventListener("click", api.driveResetFlash);
document
  .getElementById("btn-complete-new")!
  .addEventListener("click", api.completeNewBest);
document
  .getElementById("btn-complete-old")!
  .addEventListener("click", api.completeNotBest);
document
  .getElementById("btn-toast-one")!
  .addEventListener("click", api.toastOne);
document
  .getElementById("btn-toast-burst")!
  .addEventListener("click", () => api.toastBurst(20));
