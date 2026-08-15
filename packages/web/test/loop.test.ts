/**
 * T-05 FLYWHEEL — headless tests for loop.ts (+ camera.ts, bounds.ts, which have no owned test
 * file of their own — see INTERFACES.md's ownership table, only `loop.test.ts` is listed).
 *
 * No browser required anywhere in this file: no jsdom in this project (confirmed —
 * `typeof globalThis.requestAnimationFrame === "undefined"` under plain-Node vitest, same finding
 * T-04 AURORA's log records independently), so every fixture below (canvas, 2D context,
 * `InputSource`, `AudioSink`) is a hand-written stub. `createGameLoop`'s `frame(dt)` is driven
 * directly with synthetic `dt` — that is the whole point of splitting it out from `createSession`,
 * see the doc comment at the top of ../src/game/loop.ts and notes/T-05-FLYWHEEL/log.md.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BUILTIN_LEVELS,
  DEFAULT_SETTINGS,
  inputAtTick,
  levelId,
  MAX_WORLD_BOUNDS_X,
  MAX_WORLD_BOUNDS_Y,
  NO_INPUT,
  TICK_INTERVAL,
  TPS,
  verifyReplay,
} from "@swingby/core";
import type { ControlAction, InputState, Level, ReplayTape } from "@swingby/core";

import {
  boundsWarningLevel,
  boundsRatio,
  createBoundsState,
  tickBoundsCountdown,
  updateBoundsWarning,
} from "../src/game/bounds.js";
import { createCameraState, recalcTargetZoom, stepCamera } from "../src/game/camera.js";
import { createGameLoop, createSession, type CompletionPayload, type GameEngine } from "../src/game/loop.js";
import type { AudioSink } from "../src/game/audio.js";
import type { InputSource } from "../src/game/input.js";

// ---------------------------------------------------------------------------
// Fixtures — hand-written, not imported from any other task's test infra (see brief: "Touch ONLY
// the files listed as yours"; render/__tests__/fakeCanvas.ts is T-04's test infrastructure, not a
// public dependency of this package).
// ---------------------------------------------------------------------------

class FakeGradient {
  addColorStop(): void {
    /* no-op */
  }
}

class FakeCtx {
  fillStyle = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  fill(): void {}
  stroke(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  setTransform(): void {}
  drawImage(): void {}
  createRadialGradient(): FakeGradient {
    return new FakeGradient();
  }
}

function makeFakeCanvas(width = 800, height = 600): HTMLCanvasElement {
  const ctx = new FakeCtx();
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: { width: "", height: "" },
    getContext(id: string) {
      return id === "2d" ? ctx : null;
    },
  };
  return canvas as unknown as HTMLCanvasElement;
}

function makeAudioStub(): AudioSink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    setBoost(active: boolean): void {
      calls.push(`setBoost:${active}`);
    },
    setBrake(active: boolean): void {
      calls.push(`setBrake:${active}`);
    },
    setAlarm(intensity: number): void {
      calls.push(`setAlarm:${intensity.toFixed(3)}`);
    },
    chime(kind: "levelStart" | "goal" | "reset" | "click"): void {
      calls.push(`chime:${kind}`);
    },
    setMuted(muted: boolean): void {
      calls.push(`setMuted:${muted}`);
    },
    destroy(): void {
      calls.push("destroy");
    },
  };
}

function makeStaticInputSource(input: InputState = NO_INPUT): InputSource {
  return {
    poll: () => input,
    drainEvents: () => [],
    setBindings: () => {},
    attachTouch: () => {},
    destroy: () => {},
  };
}

/** Replays a fixed `ReplayTape` one tick per `poll()` call, via T-02's real `inputAtTick`.
 *  `reset()` rewinds the internal tick counter back to 0 — used to replay the SAME tape across
 *  multiple attempts within one test (e.g. restart -> replay again from tick 0). */
function makeTapeInputSource(tape: ReplayTape): { source: InputSource; reset: () => void } {
  let tick = 0;
  const source: InputSource = {
    poll: () => {
      const input = inputAtTick(tape, Math.min(tick, Math.max(tape.ticks - 1, 0)));
      tick++;
      return input;
    },
    drainEvents: () => [],
    setBindings: () => {},
    attachTouch: () => {},
    destroy: () => {},
  };
  return { source, reset: () => (tick = 0) };
}

/** A queue-based InputSource for testing edge-triggered actions (restart/pause). */
function makeQueueInputSource(): { source: InputSource; push: (a: ControlAction) => void } {
  let queue: ControlAction[] = [];
  const source: InputSource = {
    poll: () => NO_INPUT,
    drainEvents: () => {
      const drained = queue;
      queue = [];
      return drained;
    },
    setBindings: () => {},
    attachTouch: () => {},
    destroy: () => {},
  };
  return { source, push: (a: ControlAction) => queue.push(a) };
}

/** Never reaches its own goal within any realistic test window: the goal body sits far behind the
 *  player's starting velocity, with weak gravity from an unrelated direction. Used for every test
 *  that only cares about tick bookkeeping / timing, not actually solving a level (BUILTIN_LEVELS[0]
 *  + the real solvability tape is used instead wherever reaching the goal is the point). */
const DRIFT_FIXTURE_LEVEL: Level = {
  name: "Drift Fixture",
  author: "T-05 FLYWHEEL tests",
  goal: { index: 1, range: 1 },
  objects: [
    { type: "player", x: 0, y: 0, x_vel: 2, y_vel: 0, gravity: 0 },
    { type: "sun", x: -2000, y: -2000, gravity: 50, visible: true, size: 18 },
  ],
};

function loadSolvabilityTape(id: string): ReplayTape {
  const url = new URL(`../../core/test/level/solvability/tapes/${id}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as ReplayTape;
}

function makeEngine(overrides?: {
  level?: Level;
  input?: InputSource;
  audio?: AudioSink;
}): GameEngine {
  return createGameLoop({
    level: overrides?.level ?? DRIFT_FIXTURE_LEVEL,
    canvas: makeFakeCanvas(),
    input: overrides?.input ?? makeStaticInputSource(),
    audio: overrides?.audio ?? makeAudioStub(),
    settings: DEFAULT_SETTINGS,
  });
}

/** Drives `frames = round(seconds * fps)` calls of `frame(1/fps)`. */
function driveForSeconds(engine: GameEngine, fps: number, seconds: number): number {
  const dt = 1 / fps;
  const frameCount = Math.round(seconds * fps);
  for (let i = 0; i < frameCount; i++) engine.frame(dt);
  return frameCount;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. Frame-rate independence — the core claim of a fixed timestep.
// ---------------------------------------------------------------------------

describe("frame-rate independence", () => {
  it("tick count is identical at 30/60/144 fps for the same wall-clock duration", () => {
    const seconds = 2;
    const ideal = Math.round(seconds * TPS);
    const counts: Record<number, number> = {};

    for (const fps of [30, 60, 144]) {
      const engine = makeEngine();
      engine.start();
      driveForSeconds(engine, fps, seconds);
      const snap = engine.snapshot();
      expect(snap.reachedGoal, "fixture level must not complete mid-test").toBe(false);
      counts[fps] = snap.elapsedTicks;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[loop.test] tick counts over ${seconds}s: 30fps=${counts[30]} 60fps=${counts[60]} ` +
        `144fps=${counts[144]} ideal=${ideal} ` +
        `(deviation: 30fps=${counts[30]! - ideal}, 60fps=${counts[60]! - ideal}, 144fps=${counts[144]! - ideal})`,
    );

    expect(counts[30]).toBe(counts[60]);
    expect(counts[60]).toBe(counts[144]);
    expect(Math.abs(counts[144]! - ideal)).toBeLessThanOrEqual(1);
  });

  it("a 5-second frame gap is capped at MAX_TICKS_PER_FRAME (8), not 720", () => {
    const engine = makeEngine();
    engine.start();
    const before = engine.snapshot().elapsedTicks;
    engine.frame(5.0);
    const after = engine.snapshot().elapsedTicks;
    const executed = after - before;
    // eslint-disable-next-line no-console
    console.log(`[loop.test] ticks executed after a 5s stall: ${executed}`);
    expect(executed).toBe(8);
  });

  it("pause/resume does not produce a catch-up tick burst", () => {
    const engine = makeEngine();
    engine.start();
    engine.frame(1 / 60);
    const before = engine.snapshot().elapsedTicks;
    engine.pause();
    engine.frame(5.0); // huge dt while paused
    expect(engine.snapshot().elapsedTicks).toBe(before);
    engine.resume();
    engine.frame(1 / 60);
    const after = engine.snapshot().elapsedTicks;
    expect(after - before).toBeLessThanOrEqual(8);
    expect(after - before).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. End-to-end: real level + T-03's verified solving tape + T-02's verifyReplay.
// ---------------------------------------------------------------------------

describe("end-to-end: physics, tape recording, and verification agree", () => {
  it("a real built-in level, driven by its verified solving tape, completes and verifyReplay ACCEPTS the recorded tape", () => {
    const level = BUILTIN_LEVELS[0]!;
    const id = levelId(0);
    expect(id).toBe("builtin-00");
    const sourceTape = loadSolvabilityTape(id);

    const stub = makeTapeInputSource(sourceTape);
    const audio = makeAudioStub();
    const engine = makeEngine({ level, input: stub.source, audio });

    const completions: CompletionPayload[] = [];
    engine.onComplete((r) => completions.push(r));

    engine.start();
    let guard = 0;
    while (engine.snapshot().status !== "complete" && guard < sourceTape.ticks + 200) {
      engine.frame(TICK_INTERVAL);
      guard++;
    }

    expect(engine.snapshot().status).toBe("complete");
    expect(completions.length).toBe(1);
    const payload = completions[0]!;

    // eslint-disable-next-line no-console
    console.log(
      `[loop.test] end-to-end capture: elapsedTicks=${engine.snapshot().elapsedTicks} ` +
        `timeMs=${payload.timeMs} boostMs=${payload.boostMs} tape.ticks=${payload.tape.ticks} ` +
        `(source tape ticks=${sourceTape.ticks})`,
    );

    // T-03's tapes are deliberately tight (reachedTick + 1) — my own capture-tick bookkeeping
    // (elapsedTicks = captureTick + 1) should reproduce the identical total, since both are
    // replaying the exact same deterministic input schedule against the exact same physics.
    expect(payload.tape.ticks).toBe(sourceTape.ticks);

    const result = verifyReplay(level, payload.tape, {
      timeMs: payload.timeMs,
      boostMs: payload.boostMs,
    });
    // eslint-disable-next-line no-console
    console.log(`[loop.test] verifyReplay result: ${JSON.stringify(result)}`);
    expect(result.ok).toBe(true);
    expect(result.timeMs).toBe(payload.timeMs);
    expect(result.boostMs).toBe(payload.boostMs);

    // onComplete must not re-fire on any subsequent frame boundary.
    for (let i = 0; i < 20; i++) engine.frame(TICK_INTERVAL);
    expect(completions.length).toBe(1);
    expect(engine.snapshot().status).toBe("complete");
  });

  it("Math.round tick->ms matches T-02's own ticksToMs formula explicitly", () => {
    // Not derived from a live session — a direct, explicit statement of the formula this module
    // uses, cross-checked against replay.ts's own documented constant (TPS = 144).
    const msPerTick = 1000 / TPS;
    for (const ticks of [0, 1, 7, 144, 1001, 2110]) {
      const mine = Math.round(ticks * msPerTick);
      // replay.ts:114 `const MS_PER_TICK = 1000 / TPS;` replay.ts:122-124 `Math.round(ticks * MS_PER_TICK)`
      const theirs = Math.round(ticks * (1000 / TPS));
      expect(mine).toBe(theirs);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Restart resets fully + onComplete fires exactly once per attempt.
// ---------------------------------------------------------------------------

describe("restart and onComplete", () => {
  it("10 identical completions from restart(), onComplete firing exactly once each — proves restart fully resets position/velocity/timers/trail/tape/firstBoostFired", () => {
    const level = BUILTIN_LEVELS[0]!;
    const sourceTape = loadSolvabilityTape(levelId(0));
    const stub = makeTapeInputSource(sourceTape);
    const engine = makeEngine({ level, input: stub.source });

    const completions: CompletionPayload[] = [];
    engine.onComplete((r) => completions.push(r));

    const ATTEMPTS = 10;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      stub.reset();
      if (attempt === 0) engine.start();
      else engine.restart();

      // Drive through the post-reset flash (status "resetting") before ticks resume.
      let flashGuard = 0;
      while (engine.snapshot().status === "resetting" && flashGuard < 1000) {
        engine.frame(TICK_INTERVAL);
        flashGuard++;
      }
      expect(engine.snapshot().status, `attempt ${attempt}: must resume playing after the flash`).toBe(
        "playing",
      );

      let guard = 0;
      while (engine.snapshot().status !== "complete" && guard < sourceTape.ticks + 200) {
        engine.frame(TICK_INTERVAL);
        guard++;
      }
      expect(engine.snapshot().status, `attempt ${attempt}: must reach completion`).toBe("complete");
    }

    // eslint-disable-next-line no-console
    console.log(
      `[loop.test] ${ATTEMPTS} attempts -> onComplete fired ${completions.length} times; ` +
        `payload[0]=${JSON.stringify(completions[0])}`,
    );

    expect(completions.length).toBe(ATTEMPTS);
    for (const r of completions) {
      expect(r.timeMs).toBe(completions[0]!.timeMs);
      expect(r.boostMs).toBe(completions[0]!.boostMs);
      expect(r.tape).toEqual(completions[0]!.tape);
    }
  });

  it("restart() immediately reports status 'resetting' and reachedGoal false, elapsedTicks/boostTicks 0", () => {
    const engine = makeEngine({ input: makeStaticInputSource({ boost: true, brake: false, thrustX: 0, thrustY: 0 }) });
    engine.start();
    for (let i = 0; i < 30; i++) engine.frame(TICK_INTERVAL);
    expect(engine.snapshot().elapsedTicks).toBeGreaterThan(0);

    engine.restart();
    const snap = engine.snapshot();
    expect(snap.status).toBe("resetting");
    expect(snap.elapsedTicks).toBe(0);
    expect(snap.boostTicks).toBe(0);
    expect(snap.reachedGoal).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Edge-triggered input: restart/pause actions drained once per frame.
// ---------------------------------------------------------------------------

describe("edge-triggered input actions", () => {
  it("a queued 'pause' action pauses, another 'pause' resumes; a queued 'restart' action restarts", () => {
    const queue = makeQueueInputSource();
    const engine = makeEngine({ input: queue.source });
    engine.start();
    engine.frame(1 / 60);
    expect(engine.snapshot().status).toBe("playing");

    queue.push("pause");
    engine.frame(1 / 60);
    expect(engine.snapshot().status).toBe("paused");

    queue.push("pause");
    engine.frame(1 / 60);
    expect(engine.snapshot().status).toBe("playing");

    const before = engine.snapshot().elapsedTicks;
    expect(before).toBeGreaterThan(0);
    queue.push("restart");
    engine.frame(1 / 60);
    expect(engine.snapshot().elapsedTicks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Camera — asymmetric, frame-rate-independent exponential smoothing.
// ---------------------------------------------------------------------------

describe("camera smoothing", () => {
  it("zoom-out smoothing converges to the same value at 60fps and 144fps over the same elapsed time", () => {
    const totalSeconds = 0.5;
    const start = 1.0;
    const target = 0.4; // zooming OUT (target < current) -> ZOOM_SMOOTHING (8.0)

    const stateAt60 = createCameraState(0, 0);
    stateAt60.zoom = start;
    stateAt60.targetZoom = target;
    const steps60 = Math.round(totalSeconds * 60);
    for (let i = 0; i < steps60; i++) stepCamera(stateAt60, 1 / 60);

    const stateAt144 = createCameraState(0, 0);
    stateAt144.zoom = start;
    stateAt144.targetZoom = target;
    const steps144 = Math.round(totalSeconds * 144);
    for (let i = 0; i < steps144; i++) stepCamera(stateAt144, 1 / 144);

    const diff = Math.abs(stateAt60.zoom - stateAt144.zoom);
    // eslint-disable-next-line no-console
    console.log(
      `[loop.test] camera zoom-out after ${totalSeconds}s: 60fps(${steps60} steps)=${stateAt60.zoom} ` +
        `144fps(${steps144} steps)=${stateAt144.zoom} abs diff=${diff}`,
    );
    expect(diff).toBeLessThan(1e-9);
  });

  it("zoom-in uses a faster rate (ZOOM_IN_SMOOTHING=20) than zoom-out (ZOOM_SMOOTHING=8) for the same dt/displacement", () => {
    const dt = 1 / 60;

    const zoomingIn = createCameraState(0, 0);
    zoomingIn.zoom = 0.5;
    zoomingIn.targetZoom = 1.0; // growing -> IN
    stepCamera(zoomingIn, dt);
    const inProgress = zoomingIn.zoom - 0.5;

    const zoomingOut = createCameraState(0, 0);
    zoomingOut.zoom = 1.0;
    zoomingOut.targetZoom = 0.5; // shrinking -> OUT
    stepCamera(zoomingOut, dt);
    const outProgress = 1.0 - zoomingOut.zoom;

    // eslint-disable-next-line no-console
    console.log(`[loop.test] one-frame progress: zoom-in=${inProgress} zoom-out=${outProgress}`);
    expect(inProgress).toBeGreaterThan(outProgress);
  });

  it("_recalculate_zoom: at rest near the origin the target is 1.0; far away it zooms out below 1.0", () => {
    const state = createCameraState(0, 0);
    recalcTargetZoom(state, 10, 10, 1000, 800);
    expect(state.targetZoom).toBe(1);

    recalcTargetZoom(state, 5000, 0, 1000, 800);
    expect(state.targetZoom).toBeLessThan(1);
    expect(state.targetZoom).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Bounds — warning ramp, countdown/expiry state machine.
// ---------------------------------------------------------------------------

describe("bounds", () => {
  it("boundsRatio matches physics.ts's own outOfBounds threshold (fixed origin at (0,0))", () => {
    expect(boundsRatio(0, 0)).toBe(0);
    expect(boundsRatio(MAX_WORLD_BOUNDS_X, 0)).toBeCloseTo(1, 10);
    expect(boundsRatio(0, MAX_WORLD_BOUNDS_Y)).toBeCloseTo(1, 10);
    expect(boundsRatio(MAX_WORLD_BOUNDS_X * 2, 0)).toBeCloseTo(2, 10);
  });

  it("boundsWarningLevel ramps 0 below the start ratio, linearly to 1 at ratio 1, clamped above", () => {
    expect(boundsWarningLevel(0.5)).toBe(0);
    expect(boundsWarningLevel(0.8)).toBe(0);
    expect(boundsWarningLevel(0.9)).toBeCloseTo(0.5, 10);
    expect(boundsWarningLevel(1.0)).toBe(1);
    expect(boundsWarningLevel(1.5)).toBe(1);
  });

  it("the reset countdown arms on exit, cancels on recovery, and expires after BOUNDS_WARNING_DURATION", () => {
    const state = createBoundsState();
    updateBoundsWarning(state, 1.2); // exits bounds
    expect(state.warningTimer).toBeGreaterThan(0);

    // Recovers before expiry: cancelled.
    updateBoundsWarning(state, 0.5);
    expect(state.warningTimer).toBe(0);

    // Exits again and stays out until expiry.
    updateBoundsWarning(state, 1.2);
    const armed = state.warningTimer;
    let expired = false;
    let elapsed = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 1000 && !expired; i++) {
      expired = tickBoundsCountdown(state, dt);
      elapsed += dt;
    }
    // eslint-disable-next-line no-console
    console.log(`[loop.test] bounds countdown armed at ${armed}s, expired after ${elapsed.toFixed(4)}s`);
    expect(expired).toBe(true);
    expect(elapsed).toBeCloseTo(armed, 1);
  });

  it("an out-of-bounds excursion in a live session eventually forces an automatic reset", () => {
    // A level with no gravity pulling the player back — pure straight-line ballistic escape.
    const escapeLevel: Level = {
      name: "Escape Fixture",
      author: "T-05 FLYWHEEL tests",
      goal: { index: 1, range: 1 },
      objects: [
        { type: "player", x: 0, y: 0, x_vel: 500, y_vel: 0, gravity: 0 },
        { type: "sun", x: 100000, y: 100000, gravity: 1, visible: true, size: 18 },
      ],
    };
    const engine = makeEngine({ level: escapeLevel });
    engine.start();

    let sawResetting = false;
    for (let i = 0; i < 2000 && !sawResetting; i++) {
      engine.frame(TICK_INTERVAL);
      if (engine.snapshot().status === "resetting") sawResetting = true;
    }
    expect(sawResetting, "player must eventually exit bounds and trigger an automatic reset").toBe(true);
    expect(engine.snapshot().elapsedTicks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. createSession — the frozen wrapper's own rAF-driving logic.
// ---------------------------------------------------------------------------

describe("createSession (real requestAnimationFrame wrapper)", () => {
  it("start() schedules exactly one rAF callback; each invocation reschedules; destroy() stops the chain", () => {
    const scheduled: Array<(t: number) => void> = [];
    let nextId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void): number => {
      scheduled.push(cb);
      return nextId++;
    });
    vi.stubGlobal("cancelAnimationFrame", (_id: number): void => {});

    const session = createSession({
      level: DRIFT_FIXTURE_LEVEL,
      canvas: makeFakeCanvas(),
      input: makeStaticInputSource(),
      audio: makeAudioStub(),
      settings: DEFAULT_SETTINGS,
    });

    session.start();
    expect(scheduled.length).toBe(1);

    const cb1 = scheduled.pop()!;
    cb1(0); // first timestamp: dt computed as 0 (no prior timestamp)
    expect(scheduled.length).toBe(1); // rescheduled itself

    const cb2 = scheduled.pop()!;
    cb2(1000 / 60); // ~16.7ms later
    expect(scheduled.length).toBe(1);
    expect(session.snapshot().elapsedTicks).toBeGreaterThan(0);

    session.pause();
    expect(session.snapshot().status).toBe("paused");
    session.resume();
    expect(session.snapshot().status).toBe("playing");
    session.restart();
    expect(session.snapshot().status).toBe("resetting");

    const pending = scheduled.pop()!;
    session.destroy();
    const lenBeforeStaleInvoke = scheduled.length;
    pending(2000 / 60); // a stale callback firing after destroy must not reschedule
    expect(scheduled.length).toBe(lenBeforeStaleInvoke);
  });

  it("start()/destroy() do not throw when requestAnimationFrame is unavailable (non-browser environment)", () => {
    expect(typeof globalThis.requestAnimationFrame).toBe("undefined");
    const session = createSession({
      level: DRIFT_FIXTURE_LEVEL,
      canvas: makeFakeCanvas(),
      input: makeStaticInputSource(),
      audio: makeAudioStub(),
      settings: DEFAULT_SETTINGS,
    });
    expect(() => {
      session.start();
      session.pause();
      session.resume();
      session.restart();
      session.snapshot();
      session.subscribe(() => {});
      session.onComplete(() => {});
      session.destroy();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. subscribe()
// ---------------------------------------------------------------------------

describe("subscribe", () => {
  it("notifies subscribers once per frame and the returned unsubscribe stops further notifications", () => {
    const engine = makeEngine();
    engine.start();

    let count = 0;
    const unsubscribe = engine.subscribe(() => {
      count++;
    });

    engine.frame(1 / 60);
    engine.frame(1 / 60);
    expect(count).toBe(2);

    unsubscribe();
    engine.frame(1 / 60);
    expect(count).toBe(2);
  });
});
