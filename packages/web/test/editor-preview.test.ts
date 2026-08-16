/**
 * T-11 DRAFT — preview.ts: the `createGameLoop`-wrapping preview lifecycle. Proves the
 * "preview-state trap" drift signal (`isDirty()`) end to end: dirty flips true once the underlying
 * engine has actually simulated a tick, `reset()` clears it, and the world genuinely restarts from
 * the authored level (not from wherever the previous attempt drifted to).
 *
 * Drives `PreviewController.frame(dt)` synthetically — see the module doc comment in
 * `editor/preview.ts` and notes/T-11-DRAFT/log.md decision #3 for why `createGameLoop` (not
 * `createSession`) is used: `requestAnimationFrame` doesn't exist under plain-Node vitest.
 */
import { describe, expect, it } from "vitest";
import { BUILTIN_LEVELS, DEFAULT_SETTINGS, TICK_INTERVAL } from "@swingby/core";
import { makeFakeCanvas, makeFakeTarget } from "../src/editor/__tests__/fakes.js";
import { createPreviewController } from "../src/editor/preview.js";

// BUILTIN_LEVELS[0] ("Orbital Primer") has real gravity and a moving player — guaranteed to
// actually move within a handful of ticks, unlike a hand-rolled all-static fixture might.
const LEVEL = BUILTIN_LEVELS[0]!;

function makeController() {
  const { canvas } = makeFakeCanvas();
  const target = makeFakeTarget();
  return createPreviewController(LEVEL, { canvas, inputTarget: target, settings: DEFAULT_SETTINGS });
}

describe("preview controller: the drift gate", () => {
  it("starts clean (not dirty), and stays clean while merely constructed/drawn but not played", () => {
    const controller = makeController();
    expect(controller.isDirty()).toBe(false);
    controller.frame(1 / 60); // a render-only frame before Play — no ticks should run
    expect(controller.snapshot().elapsedTicks).toBe(0);
    expect(controller.isDirty()).toBe(false);
  });

  it("becomes dirty once the attempt has actually advanced a tick after Play", () => {
    const controller = makeController();
    controller.play();
    controller.frame(TICK_INTERVAL * 2); // enough wall-clock time for >=1 tick at 144Hz
    expect(controller.snapshot().elapsedTicks).toBeGreaterThan(0);
    expect(controller.isDirty()).toBe(true);
  });

  it("reset() clears dirty and returns elapsedTicks to 0 — a genuine fresh attempt, not a resume", () => {
    const controller = makeController();
    controller.play();
    for (let i = 0; i < 20; i++) controller.frame(TICK_INTERVAL);
    expect(controller.isDirty()).toBe(true);
    expect(controller.snapshot().elapsedTicks).toBeGreaterThan(0);

    controller.reset();
    expect(controller.isDirty()).toBe(false);
    expect(controller.snapshot().elapsedTicks).toBe(0);
    expect(controller.snapshot().status).toBe("paused"); // reset does NOT auto-resume

    // And stays at 0 across render-only frames until Play is pressed again.
    controller.frame(1 / 60);
    expect(controller.snapshot().elapsedTicks).toBe(0);
    expect(controller.isDirty()).toBe(false);
  });

  it("pause keeps the current dirty/tick state (does not itself reset)", () => {
    const controller = makeController();
    controller.play();
    for (let i = 0; i < 20; i++) controller.frame(TICK_INTERVAL);
    const ticksBeforePause = controller.snapshot().elapsedTicks;
    controller.pause();
    controller.frame(1 / 60);
    expect(controller.snapshot().elapsedTicks).toBe(ticksBeforePause);
    expect(controller.isDirty()).toBe(true);
  });

  it("play() after pause resumes rather than restarting from tick 0", () => {
    const controller = makeController();
    controller.play();
    for (let i = 0; i < 10; i++) controller.frame(TICK_INTERVAL);
    controller.pause();
    const ticksAtPause = controller.snapshot().elapsedTicks;
    controller.play();
    controller.frame(TICK_INTERVAL);
    expect(controller.snapshot().elapsedTicks).toBeGreaterThanOrEqual(ticksAtPause);
  });

  it("destroy() does not throw and stops advancing further ticks", () => {
    const controller = makeController();
    controller.play();
    controller.frame(TICK_INTERVAL);
    expect(() => controller.destroy()).not.toThrow();
  });
});
