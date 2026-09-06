/**
 * Regression test for the rocket not turning into its direction of travel.
 *
 * The unit test in packages/core/test/parity/rocket-angle.test.ts covers the
 * formula. This one covers the wiring, which is where the bug actually was:
 * `rocket_angle_from_velocity` exists in PhysicsEngine.gd but was absent from
 * INTERFACES.md's list of five physics functions, so it was never ported, and
 * nothing in the game loop set the player's `angle`. The renderer dutifully
 * rotated by `body.angle` (render/bodies.ts) and `simulateTick` only advances
 * `angle` for planets — so the ship flew a curving trajectory while pointing in
 * a fixed direction for the whole run.
 *
 * Testing the helper alone would not have caught that: it would have passed
 * against a codebase where nobody called it. So this drives the REAL loop and
 * reads the REAL world, exactly as the renderer would.
 *
 * Headless, using the same `createGameLoop`/`frame(dt)` seam T-05 built for its
 * own tests — no browser, no jsdom.
 */

import { describe, expect, it, vi } from "vitest";

// Observe the world exactly as the renderer receives it. `world` is closure-local
// inside createGameLoop, and reaching into it would test an implementation
// detail — whereas `RenderFrame.world` is the published contract T-04's
// bodies.ts reads `angle` from, so it is the right place to assert.
const drawnFrames: { world: World }[] = [];
vi.mock("../src/render/index.js", () => ({
  createRenderer: () => ({
    resize: () => {},
    draw: (frame: { world: World }) => {
      const p = frame.world.bodies[frame.world.playerIndex]!;
      // Snapshot the values — `world.bodies` is mutated in place between frames
      // (docs/INTERFACES.md: "It must tolerate `world` mutating between frames"), so
      // storing the live object would give every entry the final state.
      drawnFrames.push({
        world: {
          ...frame.world,
          bodies: [{ ...p }],
          playerIndex: 0,
        } as unknown as World,
      });
    },
    worldToScreen: (p: { x: number; y: number }) => p,
    screenToWorld: (p: { x: number; y: number }) => p,
  }),
}));

import {
  BUILTIN_LEVELS,
  DEFAULT_SETTINGS,
  NO_INPUT,
  hydrate,
} from "@swingby/core";
import type { InputState, World } from "@swingby/core";

import { createGameLoop } from "../src/game/loop.js";
import type { AudioSink } from "../src/game/audio.js";
import type { InputSource } from "../src/game/input.js";

function makeFakeCanvas(width = 800, height = 600): HTMLCanvasElement {
  const ctx = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "canvas") return canvas;
        if (prop === "measureText") return () => ({ width: 0 });
        if (
          prop === "createLinearGradient" ||
          prop === "createRadialGradient"
        ) {
          return () => ({ addColorStop: () => {} });
        }
        if (prop === "getImageData") {
          return () => ({ data: new Uint8ClampedArray(4) });
        }
        return () => {};
      },
      set: () => true,
    },
  );
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
  return canvas;
}

function makeAudioStub(): AudioSink {
  return {
    setBoost: () => {},
    setBrake: () => {},
    setAlarm: () => {},
    chime: () => {},
    setMuted: () => {},
    setActive: () => {},
    destroy: () => {},
  };
}

function makeInput(state: InputState): InputSource {
  return {
    poll: () => state,
    drainEvents: () => [],
    setBindings: () => {},
    attachTouch: () => {},
    destroy: () => {},
  };
}

/** The reference formula, restated here so the assertion does not import the code under test. */
function expectedAngle(xVel: number, yVel: number): number {
  if (xVel * xVel + yVel * yVel <= 0.000001) return 0;
  return Math.atan2(yVel, xVel) + Math.PI / 2;
}

/** Compare angles as unit vectors so a 2π wrap is not a false failure. */
function angleError(a: number, b: number): number {
  return Math.hypot(Math.cos(a) - Math.cos(b), Math.sin(a) - Math.sin(b));
}

const LEVEL = BUILTIN_LEVELS[0]!;

describe("player rocket rotation, through the real game loop", () => {
  it("starts a fresh world with the player angle at 0", () => {
    const world: World = hydrate(LEVEL);
    expect(world.bodies[world.playerIndex]!.angle).toBe(0);
  });

  it("turns the ship to face its direction of travel as the trajectory curves", () => {
    const engine = createGameLoop({
      level: LEVEL,
      canvas: makeFakeCanvas(),
      input: makeInput({ ...NO_INPUT, boost: true }),
      audio: makeAudioStub(),
      settings: DEFAULT_SETTINGS,
    });
    engine.start?.();

    drawnFrames.length = 0;
    for (let i = 0; i < 90; i++) engine.frame(1 / 60);
    const seen = drawnFrames.map((f) => {
      const p = f.world.bodies[f.world.playerIndex]!;
      return { angle: p.angle, xVel: p.xVel, yVel: p.yVel };
    });

    expect(seen.length).toBeGreaterThan(30);

    // 1. The ship is genuinely moving — otherwise every check below is vacuous.
    const maxSpeed = Math.max(...seen.map((s) => Math.hypot(s.xVel, s.yVel)));
    expect(maxSpeed).toBeGreaterThan(0.01);

    // 2. The angle actually changes. This is the specific symptom that was
    //    reported: a constant angle while the velocity swings around.
    const distinct = new Set(seen.map((s) => s.angle.toFixed(6))).size;
    expect(distinct).toBeGreaterThan(2);

    // 3. And it changes to the RIGHT value every single tick — not merely to
    //    some other moving number, which (2) alone would accept.
    const worst = Math.max(
      ...seen.map((s) => angleError(s.angle, expectedAngle(s.xVel, s.yVel))),
    );
    expect(worst).toBeLessThan(1e-12);
  });

  it("points the sprite's UP axis along the velocity, which is what the +PI/2 is for", () => {
    const engine = createGameLoop({
      level: LEVEL,
      canvas: makeFakeCanvas(),
      input: makeInput({ ...NO_INPUT, boost: true }),
      audio: makeAudioStub(),
      settings: DEFAULT_SETTINGS,
    });
    engine.start?.();

    drawnFrames.length = 0;
    for (let i = 0; i < 90; i++) engine.frame(1 / 60);

    let checked = 0;
    let worst = 0;
    for (const f of drawnFrames) {
      const p = f.world.bodies[f.world.playerIndex]!;
      const len = Math.hypot(p.xVel, p.yVel);
      if (len < 1e-3) continue;
      // Godot reads it back as Vector2.UP.rotated(angle) — GameWorld.gd:876.
      // UP = (0,-1), so rotating by θ gives (sin θ, -cos θ).
      worst = Math.max(
        worst,
        Math.hypot(
          Math.sin(p.angle) - p.xVel / len,
          -Math.cos(p.angle) - p.yVel / len,
        ),
      );
      checked++;
    }

    expect(checked).toBeGreaterThan(30);
    expect(worst).toBeLessThan(1e-12);
  });
});
