/**
 * T-11 DRAFT — preview lifecycle. Wraps T-05's `createGameLoop` (loop.ts's own additional export,
 * NOT the frozen `createSession`) so the editor can playtest a level.
 *
 * See notes/T-11-DRAFT/log.md decision #3 for the full reasoning on why `createGameLoop` and not
 * `createSession`: `createSession` is a thin `requestAnimationFrame` wrapper around
 * `createGameLoop`, and `requestAnimationFrame` does not exist under plain-Node vitest, so
 * `createSession.start()` would never advance a single tick in a headless test. `createGameLoop`
 * exposes `frame(dt): void` directly (loop.ts's own doc comment: built specifically so
 * `loop.test.ts` can drive it with synthetic `dt` — the exact need this module has too), and
 * `GameEngine extends GameSession`, so every method the frozen interface promises is still present.
 * This module's own `frame()` is called by a real `requestAnimationFrame` loop in the browser
 * (`editor.ts`'s `mountEditor`, structurally identical to what `createSession` does internally) and
 * synchronously in tests — never a second physics implementation, never a direct `core/physics`
 * import (this file imports nothing from `@swingby/core` except types and `hydrate`... actually not
 * even that — `createGameLoop` does its own hydration internally).
 */

import type { Level, Settings } from "@swingby/core";
import { createGameLoop, type GameEngine, type GameSnapshot } from "../game/loop.js";
import { createInputSource, type InputSource } from "../game/input.js";
import { createAudio, type AudioSink } from "../game/audio.js";

export interface PreviewController {
  /** First call starts the attempt; subsequent calls resume from pause. */
  play(): void;
  pause(): void;
  /** Tears down and rebuilds the underlying engine from the (unchanged) authored level — the
   *  world snaps back to the authored start state and the drift gate (`isDirty()`) clears. Stays
   *  paused afterward (does NOT auto-resume) — see the module doc comment on why `createGameLoop`
   *  is used instead of `createSession`: this exact "reset and stay paused" behaviour has no
   *  equivalent reachable through `restart()` alone (it always leads to an auto-resumed "playing"
   *  state after the reset flash), so reset here is "destroy and reconstruct a fresh, unstarted
   *  engine" rather than calling `restart()`. */
  reset(): void;
  destroy(): void;
  /** True once the current attempt has advanced at least one simulated tick since the last
   *  `reset()` (or since construction). This is the editor's "preview has run, must reset before
   *  editing" signal — see notes/T-11-DRAFT/log.md decision #4 for why a tick count is used rather
   *  than a literal per-body position diff (the frozen `GameSession`/`GameEngine` interfaces expose
   *  no body-position accessor at all). */
  isDirty(): boolean;
  snapshot(): GameSnapshot;
  /** Advances the underlying engine by `dt` seconds of wall-clock time. Call every animation frame
   *  while a preview is mounted (even while paused/not-yet-started — this is what keeps the canvas
   *  showing the current, possibly-paused world instead of a stale frame). */
  frame(dt: number): void;
}

export interface CreatePreviewOptions {
  canvas: HTMLCanvasElement;
  /** Element `createInputSource` attaches keyboard/touch listeners to — the real DOM canvas in the
   *  browser, a fake element in tests. */
  inputTarget: HTMLElement;
  settings: Settings;
}

export function createPreviewController(level: Level, opts: CreatePreviewOptions): PreviewController {
  let input: InputSource;
  let audio: AudioSink;
  let engine: GameEngine;
  let started = false;
  let dirty = false;

  function build(): void {
    input = createInputSource(opts.inputTarget);
    audio = createAudio();
    engine = createGameLoop({
      level,
      canvas: opts.canvas,
      input,
      audio,
      settings: opts.settings,
    });
    started = false;
    dirty = false;
  }

  build();

  return {
    play(): void {
      if (!started) {
        started = true;
        engine.start();
      } else {
        engine.resume();
      }
    },
    pause(): void {
      engine.pause();
    },
    reset(): void {
      input.destroy();
      audio.destroy();
      engine.destroy();
      build();
    },
    destroy(): void {
      input.destroy();
      audio.destroy();
      engine.destroy();
    },
    isDirty(): boolean {
      return dirty;
    },
    snapshot(): GameSnapshot {
      return engine.snapshot();
    },
    frame(dt: number): void {
      engine.frame(dt);
      if (engine.snapshot().elapsedTicks > 0) dirty = true;
    },
  };
}
