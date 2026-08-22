/**
 * The game loop: fixed-timestep accumulator, camera, bounds, win condition. This is the module
 * that turns `simulateTick`, `TapeRecorder`, `hydrate`, `createRenderer`, `InputSource` and
 * `AudioSink` into an actual playable attempt at a level.
 *
 * Two layers, on purpose (see notes/archive/T-05-FLYWHEEL/log.md for the full reasoning):
 *
 *   - `createGameLoop(opts)` — NOT part of the exported interface. The real engine: fixed-timestep
 *     tick accumulator, camera/bounds updates, win/reset logic, `renderer.draw()`. Exposes
 *     `frame(dt): void` directly so it can be driven with SYNTHETIC `dt` in headless tests — no
 *     `requestAnimationFrame` involved anywhere in this layer.
 *   - `createSession(opts): GameSession` — the export docs/INTERFACES.md requires. A thin wrapper
 *     around `createGameLoop` that schedules a real `requestAnimationFrame` loop on `start()`,
 *     computing `dt` from consecutive rAF timestamps. Guards
 *     `typeof requestAnimationFrame === "function"` so constructing/starting a session outside a
 *     browser (tests, SSR) never throws — it just doesn't self-drive.
 *
 * IMPORTANT contract (see notes/archive/T-02-TAPE/log.md's own flagged open question): tick -> ms
 * conversion uses `Math.round(ticks * 1000 / TPS)`, IDENTICAL to
 * `packages/core/src/replay.ts`'s private `ticksToMs` (replay.ts:114-124). `elapsedTicks` at
 * capture is `captureTick + 1` (0-based tick index of the capturing tick, plus one) — the same
 * quantity `verifyReplay` independently recomputes when replaying the tape this module hands out
 * via `onComplete`. Because both sides run the exact same `simulateTick` against the exact same
 * `hydrate(level)` starting state with the exact same input schedule, this is an EXACT agreement
 * by construction, not an approximation the `tolerance` parameter needs to paper over.
 */

import {
  hydrate,
  NO_INPUT,
  predict,
  rocketAngleFromVelocity,
  simulateTick,
  TapeRecorder,
  TICK_INTERVAL,
  TPS,
  TRAIL_LENGTH,
} from "@swingby/core";
import type {
  InputState,
  Level,
  ReplayTape,
  Settings,
  Vec2,
  World,
} from "@swingby/core";

import type { Camera, RenderFrame, Renderer } from "../render/index.js";
import { createRenderer } from "../render/index.js";

import type { AudioSink } from "./audio.js";
import {
  cameraForFrame,
  createCameraState,
  recalcTargetFit,
  recenterCameraToFit,
  stepCamera,
  triggerShake,
  type CameraState,
} from "./camera.js";
import {
  boundsRatio,
  boundsWarningLevel,
  createBoundsState,
  flashProgress,
  resetBoundsState,
  startResetFlash,
  tickBoundsCountdown,
  tickResetFlash,
  updateBoundsWarning,
  type BoundsState,
} from "./bounds.js";
import type { InputSource } from "./input.js";

// ---------------------------------------------------------------------------
// Exported interface — docs/INTERFACES.md "web/game/loop.ts"
// ---------------------------------------------------------------------------

export type GameStatus = "playing" | "paused" | "complete" | "resetting";

export interface GameSnapshot {
  status: GameStatus;
  elapsedTicks: number;
  boostTicks: number;
  fps: number;
  boundsWarning: number;
  reachedGoal: boolean;
}

export interface CompletionPayload {
  timeMs: number;
  boostMs: number;
  tape: ReplayTape;
}

export interface GameSession {
  start(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  destroy(): void;
  snapshot(): GameSnapshot;
  /** Fires once on capture, with the tape for submission. */
  onComplete(cb: (r: CompletionPayload) => void): void;
  subscribe(cb: (s: GameSnapshot) => void): () => void;
}

export interface CreateSessionOptions {
  level: Level;
  canvas: HTMLCanvasElement;
  input: InputSource; // T-06
  audio: AudioSink; // T-07
  settings: Settings; // T-10
}

// ---------------------------------------------------------------------------
// Local constants — not in constants.ts (that file is frozen and these are this module's own
// structural choices), so they live here.
// ---------------------------------------------------------------------------

/** Without this cap, a backgrounded tab returns with seconds of accumulated time and the loop
 *  spirals. Dropping simulation time is correct here — the alternative is a frozen page. */
const MAX_TICKS_PER_FRAME = 8;

/** Clamping the incoming frame delta to exactly one frame's worth of drainable ticks means the
 *  accumulator can never carry more than `MAX_TICKS_PER_FRAME` ticks of backlog into the next
 *  frame either — belt and suspenders with the `ticksThisFrame < MAX_TICKS_PER_FRAME` loop guard
 *  below: `accumulator += min(dt, MAX_FRAME_TIME)`. */
const MAX_FRAME_TIME = MAX_TICKS_PER_FRAME * TICK_INTERVAL;

const MS_PER_TICK = 1000 / TPS;

/** Ticks -> ms, MUST match `packages/core/src/replay.ts`'s private `ticksToMs` (replay.ts:122-124)
 *  exactly — see this file's top doc comment and notes/archive/T-05-FLYWHEEL/log.md. */
function ticksToMs(ticks: number): number {
  return Math.round(ticks * MS_PER_TICK);
}

/** The bodies the camera must always keep on screen: the player, every sun (regardless of
 *  `visible` — an invisible sun still needs headroom, it still gravitates), and the target (if
 *  one is set). Non-target planets are deliberately excluded — they may drift outside the view.
 *  `trailBounds` (see below) additionally keeps the player's recent flight path in view, fading
 *  each bucket's rectangle toward `fadeCenter` (the current screen center) as it ages rather than
 *  dropping it outright — see `recordTrailBoundsTick`. */
export function fitPoints(
  w: World,
  trailBounds: readonly TrailBoundsBucket[],
  fadeCenter: { x: number; y: number },
): Vec2[] {
  const points: Vec2[] = [];
  const player = w.bodies[w.playerIndex];
  if (player) points.push({ x: player.x, y: player.y });
  for (const b of w.bodies) {
    if (b.type === "sun") points.push({ x: b.x, y: b.y });
  }
  const goal = w.bodies[w.goalIndex];
  if (goal) points.push({ x: goal.x, y: goal.y });
  for (const bucket of trailBounds) {
    const f = trailBucketWeight(bucket);
    points.push({
      x: fadeCenter.x + (bucket.minX - fadeCenter.x) * f,
      y: fadeCenter.y + (bucket.minY - fadeCenter.y) * f,
    });
    points.push({
      x: fadeCenter.x + (bucket.maxX - fadeCenter.x) * f,
      y: fadeCenter.y + (bucket.maxY - fadeCenter.y) * f,
    });
  }
  return points;
}

/** Ticks a bucket stays "open" (still being extended by new samples) before a new one starts —
 *  one real second at the fixed sim rate. */
const TICKS_PER_TRAIL_BUCKET = Math.round(TPS);

/** How long (in ticks, after a bucket closes) it takes its rectangle to fade fully to a point at
 *  `fadeCenter` — roughly 5 seconds, "no need to be exact". Once fully faded a bucket contributes
 *  nothing beyond `fadeCenter` (already covered by the fit), so it's dropped. */
const TRAIL_FADE_TICKS = Math.round(TPS) * 5;

export interface TrailBoundsBucket {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Ticks since this bucket closed (started a new one after it). 0 while still open/current. */
  ageTicks: number;
}

/** Linear fade weight in [0, 1] from a bucket's age — 1 while still open, decaying to 0 over
 *  `TRAIL_FADE_TICKS` after closing. `fitPoints` lerps the bucket's corners toward `fadeCenter` by
 *  this fraction, so an expiring bucket shrinks smoothly instead of vanishing outright. */
function trailBucketWeight(bucket: TrailBoundsBucket): number {
  return Math.max(0, 1 - bucket.ageTicks / TRAIL_FADE_TICKS);
}

/** Rolling per-second min/max of the player's position — "efficient storage" for a multi-second
 *  trail's bounding box: a handful of running min/max rects (one per second, each fading out
 *  linearly after it closes — see `trailBucketWeight` — rather than storing or re-scanning every
 *  sampled point). Mutate-in-place state object, same idiom as `CameraState`/`BoundsState` here. */
export interface TrailBoundsTracker {
  buckets: TrailBoundsBucket[];
  ticksInBucket: number;
}

export function createTrailBoundsTracker(): TrailBoundsTracker {
  return { buckets: [], ticksInBucket: 0 };
}

export function resetTrailBoundsTracker(tracker: TrailBoundsTracker): void {
  tracker.buckets = [];
  tracker.ticksInBucket = 0;
}

/** Extends the current (or starts a new) 1-second bucket with `(x, y)`, ages every already-closed
 *  bucket by one tick, and drops any that have fully faded. O(number of open buckets) per call —
 *  bounded by how many seconds it takes a bucket to fade (a small constant), not by trail length. */
export function recordTrailBoundsTick(
  tracker: TrailBoundsTracker,
  x: number,
  y: number,
): void {
  // Age every already-closed bucket (all but the current open one, if any) by one tick, then drop
  // buckets that have fully faded — their corners have already lerped all the way to fadeCenter.
  for (let i = 0; i < tracker.buckets.length - 1; i++) {
    tracker.buckets[i]!.ageTicks++;
  }
  while (
    tracker.buckets.length > 0 &&
    tracker.buckets[0]!.ageTicks > TRAIL_FADE_TICKS
  ) {
    tracker.buckets.shift();
  }

  const last = tracker.buckets[tracker.buckets.length - 1];
  if (!last) {
    tracker.buckets.push({ minX: x, maxX: x, minY: y, maxY: y, ageTicks: 0 });
  } else {
    if (x < last.minX) last.minX = x;
    if (x > last.maxX) last.maxX = x;
    if (y < last.minY) last.minY = y;
    if (y > last.maxY) last.maxY = y;
  }
  tracker.ticksInBucket++;
  if (tracker.ticksInBucket >= TICKS_PER_TRAIL_BUCKET) {
    tracker.ticksInBucket = 0;
    tracker.buckets.push({ minX: x, maxX: x, minY: y, maxY: y, ageTicks: 0 });
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * Tolerance on the accumulator's `>= TICK_INTERVAL` drain check. Without this, `MAX_FRAME_TIME`
 * (exactly `8 * TICK_INTERVAL`) accumulated as a float and then drained via 8 repeated
 * `-= TICK_INTERVAL` subtractions leaves a remainder about `1.04e-17` short of one more
 * `TICK_INTERVAL` (measured directly: `8 * (1/144)` then seven subtractions of `1/144` leaves
 * `0.006944444444444434` against a `TICK_INTERVAL` of `0.006944444444444444`) — IEEE 754 rounding
 * noise, not a logic bug, but it silently drains only 7 ticks instead of 8 after a stall, which
 * fails the brief's explicit "must be capped at 8, not 720" requirement by one. `1e-9` is many
 * orders of magnitude larger than that noise (which stays sub-`1e-15` even after hundreds of
 * additions across a multi-second drive, per this module's own frame-rate-parity test) and many
 * orders of magnitude smaller than any real per-frame `dt` (0.0069-0.033s at 144-30fps), so it
 * cannot cause a spurious extra tick in normal operation — only resolves exact-boundary noise like
 * this one. See notes/archive/T-05-FLYWHEEL/log.md for the measurement that led to this.
 */
const TICK_EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// createGameLoop — the real engine. Additional export, not part of the frozen interface, but the
// thing every headless test in loop.test.ts drives directly.
// ---------------------------------------------------------------------------

export interface GameEngine extends GameSession {
  /** Advances the engine by one rendered frame's worth of wall-clock time (seconds). Safe to call
   *  with any non-negative `dt`, including huge values (a backgrounded-tab stall) — internally
   *  clamped, see MAX_FRAME_TIME. */
  frame(dt: number): void;
}

export function createGameLoop(opts: CreateSessionOptions): GameEngine {
  const renderer: Renderer = createRenderer(opts.canvas);

  let hasStarted = false;
  let status: GameStatus = "paused";

  let world: World = hydrateForAttempt();
  let elapsedTicks = 0;
  let boostTicks = 0;
  let firstBoostFired = false;
  let completed = false;
  let tapeRecorder = new TapeRecorder();
  let trail: Vec2[] = [];
  let lastInput: InputState = NO_INPUT;
  let accumulator = 0;

  let predictionCache: ReturnType<typeof predict> | null = null;
  let predictionSkipCounter = 0;

  let fps = 0;
  let fpsAccumTime = 0;
  let fpsFrameCount = 0;

  let lastWidth = -1;
  let lastHeight = -1;
  let lastDpr = -1;

  const cameraState: CameraState = createCameraState(0, 0);
  const boundsState: BoundsState = createBoundsState();

  // Kept independent of `opts.settings.trail` (the visual trail toggle): this is a
  // camera-framing concern, not a rendering one, and is cheap enough (O(1)/tick) to always track.
  const trailBoundsTracker: TrailBoundsTracker = createTrailBoundsTracker();

  const completeCallbacks: Array<(r: CompletionPayload) => void> = [];
  const subscribers: Array<(s: GameSnapshot) => void> = [];

  // -- helpers --------------------------------------------------------------

  function hydrateForAttempt(): World {
    const w = hydrate(opts.level);
    const player = w.bodies[w.playerIndex];
    // `Body.boostType`'s persisted value is an inert echo of whatever skin was equipped at export
    // time (level.ts:101-108) — Godot substitutes the PLAYER's currently-equipped skin from
    // Settings instead (GameWorld._create_runtime_object, GameWorld.gd:610-611), and explicitly
    // documents that the caller (us) is expected to apply that override. `w` here is a fresh
    // object from `hydrate()`, safe to mutate before anyone else observes it.
    if (player) {
      player.boostType = clampInt(opts.settings.boostType, 0, 3);
    }
    return w;
  }

  function getViewportSize(): { width: number; height: number } {
    const canvas = opts.canvas;
    const width = canvas.clientWidth || canvas.width || 1;
    const height = canvas.clientHeight || canvas.height || 1;
    return { width, height };
  }

  function resetAttempt(withFlash: boolean): void {
    world = hydrateForAttempt();
    elapsedTicks = 0;
    boostTicks = 0;
    firstBoostFired = false;
    completed = false;
    tapeRecorder = new TapeRecorder();
    trail = [];
    lastInput = NO_INPUT;
    predictionCache = null;
    predictionSkipCounter = 0;
    accumulator = 0;
    resetBoundsState(boundsState);
    resetTrailBoundsTracker(trailBoundsTracker);

    const { width, height } = getViewportSize();
    recenterCameraToFit(
      cameraState,
      // trailBoundsTracker was just reset above, so it's empty — fadeCenter is unused.
      fitPoints(world, trailBoundsTracker.buckets, { x: 0, y: 0 }),
      width,
      height,
    );

    // Silence immediately rather than waiting for this frame's shared audio-update tail to catch
    // up — otherwise a boost/brake sound held at the moment of reset would keep playing for up to
    // one frame after the world has already snapped back to the start line.
    opts.audio.setBoost(false);
    opts.audio.setBrake(false);

    if (withFlash) {
      startResetFlash(boundsState);
      status = "resetting";
      opts.audio.chime("reset");
    } else {
      status = "playing";
      opts.audio.chime("levelStart");
    }
  }

  function completeAttempt(): void {
    completed = true;
    status = "complete";
    triggerShake(cameraState, 10, 28); // GameWorld.gd:690, _check_win_condition
    const finishedTicks = elapsedTicks; // == captureTick + 1, see this file's top doc comment
    const tape = tapeRecorder.finish(finishedTicks);
    const timeMs = ticksToMs(finishedTicks);
    const boostMs = ticksToMs(boostTicks);
    opts.audio.chime("goal");
    const payload: CompletionPayload = { timeMs, boostMs, tape };
    // Snapshot the callback array before iterating: a callback that calls onComplete() again (or
    // otherwise mutates the list) must not affect this dispatch pass.
    for (const cb of completeCallbacks.slice()) cb(payload);
  }

  function runTicks(dt: number): void {
    accumulator += dt;
    let ticksThisFrame = 0;

    while (
      accumulator >= TICK_INTERVAL - TICK_EPSILON &&
      ticksThisFrame < MAX_TICKS_PER_FRAME
    ) {
      const input = opts.input.poll();
      lastInput = input;
      tapeRecorder.record(elapsedTicks, input);
      if (input.boost || input.brake) boostTicks++;

      const result = simulateTick(world, input, {
        allowInput: true,
        firstBoostFired,
      });
      if (result.firstBoostTriggered) {
        firstBoostFired = true;
        triggerShake(cameraState, 5, 24); // GameWorld.gd:547, first-boost shake
      }

      elapsedTicks++;
      accumulator -= TICK_INTERVAL;
      ticksThisFrame++;

      const player = world.bodies[world.playerIndex];
      if (player) {
        // GameWorld.gd:551-552 — the player's visual rotation is refreshed from
        // its velocity after every tick, in the loop rather than in the physics
        // step. Without this the ship never turns: the renderer rotates by
        // `body.angle` (bodies.ts) and `simulateTick` only advances `angle` for
        // planets, so the player's stays at its initial 0 forever.
        player.angle = rocketAngleFromVelocity(player.xVel, player.yVel);
        recordTrailBoundsTick(trailBoundsTracker, player.x, player.y);
      }
      if (player && opts.settings.trail) {
        trail.push({ x: player.x, y: player.y });
        if (trail.length > TRAIL_LENGTH) trail.shift();
      }

      if (result.reachedGoal && !completed) {
        completeAttempt();
        break;
      }

      if (player) {
        updateBoundsWarning(boundsState, boundsRatio(player.x, player.y));
      }
    }

    if (status === "playing") {
      const expired = tickBoundsCountdown(boundsState, dt);
      if (expired) {
        resetAttempt(true);
      }
    }
  }

  function updatePrediction(): void {
    const enabled = opts.settings.showFuture && status === "playing";
    if (!enabled) {
      predictionSkipCounter = 0;
      predictionCache = null;
      return;
    }
    // Mirrors GameWorld.gd:427-434's crowding-based skip cadence.
    let movingBodies = 0;
    for (const b of world.bodies) {
      if (b.type !== "sun") movingBodies++;
    }
    const skipFrames = movingBodies > 3 ? 2 : 1;
    predictionSkipCounter++;
    if (predictionSkipCounter >= skipFrames) {
      predictionSkipCounter = 0;
      predictionCache = predict(world);
    }
  }

  function buildFrame(): RenderFrame {
    const player = world.bodies[world.playerIndex];
    const ratio = player ? boundsRatio(player.x, player.y) : 0;
    const camera: Camera = cameraForFrame(cameraState);
    return {
      world,
      camera,
      trail,
      prediction: predictionCache,
      forceVector:
        opts.settings.showForceVector && player
          ? { x: player.xAcc, y: player.yAcc }
          : null,
      boundsWarning: boundsWarningLevel(ratio),
      flash: flashProgress(boundsState),
      showTrail: opts.settings.trail,
    };
  }

  function renderAndNotify(): void {
    const { width, height } = getViewportSize();
    const dpr =
      typeof window !== "undefined" && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1;
    if (width !== lastWidth || height !== lastHeight || dpr !== lastDpr) {
      renderer.resize(width, height, dpr);
      lastWidth = width;
      lastHeight = height;
      lastDpr = dpr;
    }
    renderer.draw(buildFrame());

    const snap = snapshot();
    for (const cb of subscribers.slice()) cb(snap);
  }

  function snapshot(): GameSnapshot {
    const player = world.bodies[world.playerIndex];
    const ratio = player ? boundsRatio(player.x, player.y) : 0;
    return {
      status,
      elapsedTicks,
      boostTicks,
      fps,
      boundsWarning: boundsWarningLevel(ratio),
      reachedGoal: completed,
    };
  }

  // -- GameSession + frame() -------------------------------------------------

  function start(): void {
    if (hasStarted) return;
    hasStarted = true;
    opts.input.setBindings(opts.settings.controls);
    resetAttempt(false);
  }

  function pause(): void {
    if (status === "playing") {
      status = "paused";
      accumulator = 0;
    }
  }

  function resume(): void {
    if (status === "paused" && hasStarted) {
      status = "playing";
      accumulator = 0;
    }
  }

  function restart(): void {
    hasStarted = true;
    resetAttempt(true);
  }

  function destroy(): void {
    subscribers.length = 0;
    completeCallbacks.length = 0;
  }

  function onComplete(cb: (r: CompletionPayload) => void): void {
    completeCallbacks.push(cb);
  }

  function subscribe(cb: (s: GameSnapshot) => void): () => void {
    subscribers.push(cb);
    return () => {
      const idx = subscribers.indexOf(cb);
      if (idx >= 0) subscribers.splice(idx, 1);
    };
  }

  function frame(rawDt: number): void {
    const dt = Math.min(Math.max(rawDt, 0), MAX_FRAME_TIME);

    // FPS uses the RAW, unclamped delta on purpose — a stalled/janky frame should be honestly
    // reported as low fps, not hidden by the same clamp that protects the simulation.
    fpsAccumTime += Math.max(rawDt, 0);
    fpsFrameCount++;
    if (fpsAccumTime >= 1) {
      fps = fpsFrameCount / fpsAccumTime;
      fpsFrameCount = 0;
      fpsAccumTime = 0;
    }

    for (const action of opts.input.drainEvents()) {
      if (action === "restart") {
        restart();
      } else if (action === "pause") {
        if (status === "paused") resume();
        else pause();
      }
      // Other edge-triggered actions (menu, toggleFps, toggleHighscores) are UI/settings concerns
      // outside a GameSession's scope — see notes/T-05-FLYWHEEL/log.md for the reasoning.
    }

    if (status === "resetting") {
      const progress = tickResetFlash(boundsState, dt);
      if (progress <= 0) status = "playing";
    } else if (status === "playing") {
      runTicks(dt);
    }

    const player = world.bodies[world.playerIndex];
    if (status === "playing") {
      const { width, height } = getViewportSize();
      recalcTargetFit(
        cameraState,
        // fadeCenter = the current screen center, so an expiring bucket's rectangle shrinks
        // toward wherever the camera is now pointed, even if that's moved since the bucket
        // closed — "recomputed each tick to account for a possibly moving screen center".
        fitPoints(world, trailBoundsTracker.buckets, {
          x: cameraState.originX,
          y: cameraState.originY,
        }),
        width,
        height,
      );
    }
    stepCamera(cameraState, dt);

    opts.audio.setBoost(lastInput.boost || lastInput.brake);
    const ratio = player ? boundsRatio(player.x, player.y) : 0;
    opts.audio.setAlarm(boundsWarningLevel(ratio));

    updatePrediction();
    renderAndNotify();
  }

  return {
    frame,
    start,
    pause,
    resume,
    restart,
    destroy,
    snapshot,
    onComplete,
    subscribe,
  };
}

// ---------------------------------------------------------------------------
// createSession — the frozen export. Thin real-time wrapper around createGameLoop.
// ---------------------------------------------------------------------------

export function createSession(opts: CreateSessionOptions): GameSession {
  const engine = createGameLoop(opts);

  let rafHandle: number | null = null;
  let lastTimestamp: number | null = null;

  const step = (timestamp: number): void => {
    const dt = lastTimestamp === null ? 0 : (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;
    engine.frame(dt);
    if (rafHandle !== null) {
      rafHandle = requestAnimationFrame(step);
    }
  };

  return {
    start(): void {
      engine.start();
      if (rafHandle === null && typeof requestAnimationFrame === "function") {
        lastTimestamp = null;
        rafHandle = requestAnimationFrame(step);
      }
    },
    pause(): void {
      engine.pause();
    },
    resume(): void {
      engine.resume();
    },
    restart(): void {
      engine.restart();
    },
    destroy(): void {
      if (rafHandle !== null) {
        if (typeof cancelAnimationFrame === "function")
          cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
      engine.destroy();
    },
    snapshot(): GameSnapshot {
      return engine.snapshot();
    },
    onComplete(cb: (r: CompletionPayload) => void): void {
      engine.onComplete(cb);
    },
    subscribe(cb: (s: GameSnapshot) => void): () => void {
      return engine.subscribe(cb);
    },
  };
}
