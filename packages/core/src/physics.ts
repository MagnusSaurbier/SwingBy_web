/**
 * T-01 KEPLER — physics core.
 *
 * Direct, function-for-function port of `reference/godot/scripts/PhysicsEngine.gd`
 * (Godot 4.6, static class `PhysicsEngine`). Every function below carries a comment
 * pointing at the GDScript it mirrors so a reviewer can check them side by side.
 *
 * Rules this file must obey (see PROJECT.md §4, INTERFACES.md, tasks/T-01-KEPLER.md):
 *   - The JS builtin power function is never used. `pow(x, 1.5)` becomes
 *     `x * Math.sqrt(x)` — exactly equal under IEEE 754 and reproducible
 *     across engines, which that builtin is not (it is not required to be
 *     correctly rounded).
 *   - Only `+ - * / Math.sqrt` in the numeric path, PLUS `Math.fround` at the
 *     specific spots noted below (gotcha #10) where the reference genuinely
 *     computes in 32-bit float, not the 64-bit `+ - * /` everywhere else.
 *   - No import outside `./types` and `./constants`. No clock, no Math.random, no globals.
 *   - `predict()` never mutates `world`; `simulateTick()` mutates `world.bodies` in place.
 *
 * Gotcha #10 (found during parity debugging, 2026-08-18 — see
 * notes/T-01-KEPLER/parity-debug.md for the full derivation): GDScript's scalar
 * `float` keyword is 64-bit, as the file's other comments correctly note — but
 * `Vector2`'s x/y components are typed `real_t`, which is 32-bit `float` in the
 * standard (non-`precision=double`) Godot 4 build that `parity-traces.yml`
 * downloads. `PhysicsEngine.gd` constructs a `Vector2` from 64-bit values and
 * calls `.length()` on it in exactly three places that affect a traced
 * quantity — that call computes entirely in 32-bit float (storage AND the
 * `sqrt(x*x+y*y)` arithmetic), then returns a 64-bit `float` that all
 * *further* arithmetic treats as ordinary 64-bit — so the narrowing is a single,
 * local event, not a general precision change. `vector2LengthF32` below
 * reproduces exactly that: round-to-float32 at every intermediate step of the
 * length computation (matching real hardware float32 rounding, since sqrt is
 * correctly-rounded in both widths and IEEE addition/multiplication are not
 * associative across widths), then hand back a 64-bit JS number holding that
 * float32-exact value for normal arithmetic to continue from.
 */

import type {
  Body,
  InputState,
  Prediction,
  TickResult,
  Vec2,
  World,
} from "./types.js";
import {
  BOOST_STRENGTH,
  MAX_GRAVITY_DV_PER_SUBSTEP,
  MAX_WORLD_BOUNDS_X,
  MAX_WORLD_BOUNDS_Y,
  MIN_TRAVEL_RESOLUTION,
  PHYSICS_SUBSTEPS,
  PHYSICS_SUBSTEPS_MAX,
  PREDICTION_STRIDE,
  PREDICTION_TICKS,
  SIDE_THRUST,
  TICK_INTERVAL,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Local literals — these are raw numeric literals in the GDScript source
// itself (not named GameConstants), so they are not in constants.ts. Kept
// here, named, so their provenance is obvious.
// ---------------------------------------------------------------------------

/** PhysicsEngine.gd uses the bare literal 0.000001 in three places as a
 *  degenerate-distance guard. Named here for clarity; value is unchanged. */
const EPS_DIST_SQ = 0.000001;

const DEG_TO_RAD = Math.PI / 180.0;

/**
 * Emulates `Vector2(float(x), float(y)).length()` from PhysicsEngine.gd — see
 * gotcha #10 above. `Vector2`'s components are 32-bit `real_t` in the standard
 * Godot 4 build, and `Vector2::length()` computes `sqrt(x*x + y*y)` entirely
 * in that width. `Math.fround` rounds a JS double to the nearest value
 * representable in float32 (still returned as a double) — applying it after
 * every intermediate operation reproduces the hardware rounding of each step
 * (construction, both squarings, the sum, and the sqrt) rather than only
 * rounding a float64 computation's final result, which is not the same value
 * in general. The 64-bit `float` this hands back is exactly what GDScript's
 * `length()` return type is — ordinary 64-bit arithmetic resumes at the
 * caller, which is why this narrowing is local to this helper alone.
 */
function vector2LengthF32(x: number, y: number): number {
  const fx = Math.fround(x);
  const fy = Math.fround(y);
  const xx = Math.fround(fx * fx);
  const yy = Math.fround(fy * fy);
  const sumSq = Math.fround(xx + yy);
  return Math.fround(Math.sqrt(sumSq));
}

// ---------------------------------------------------------------------------
// substep_count — PhysicsEngine.gd lines 4-27
// ---------------------------------------------------------------------------

/**
 * Adaptive substep count for the current state. Clamped to
 * [PHYSICS_SUBSTEPS, PHYSICS_SUBSTEPS_MAX].
 *
 * Mirrors `PhysicsEngine.substep_count`. Reads pre-step state (positions and
 * velocities as they are right now) and is meant to be called exactly once
 * per tick, before any substep runs — never recomputed mid-tick.
 *
 * Faithful to a quirk of the original: the outer loop skips only suns
 * (`if body.type == "sun": continue`), NOT anchored bodies. An anchored
 * planet's speed and the gravitational pull it feels still contribute to the
 * required substep count even though it will never actually integrate. This
 * is intentional in the reference and changes the resulting stepScale for
 * every other body in the world, so it is reproduced exactly.
 */
export function substepCount(bodies: readonly Body[]): number {
  let required = PHYSICS_SUBSTEPS;

  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body === undefined) continue;
    if (body.type === "sun") continue;

    // Gotcha #10: PhysicsEngine.gd:10 computes this via a 32-bit Vector2 —
    // see vector2LengthF32's doc comment.
    const bodySpeed = vector2LengthF32(body.xVel, body.yVel);

    for (let sourceIndex = 0; sourceIndex < bodies.length; sourceIndex++) {
      if (sourceIndex === i) continue;
      const source = bodies[sourceIndex];
      if (source === undefined) continue;
      if (source.gravity === 0) continue;

      const dx = body.x - source.x;
      const dy = body.y - source.y;
      const distSqRaw = dx * dx + dy * dy;
      const distSq = Math.max(distSqRaw, EPS_DIST_SQ);
      const distance = Math.sqrt(distSq);
      // pow(distSq, 1.5) === distSq * sqrt(distSq)
      const dist15 = distSq * distance;
      const accelMag = (source.gravity * distance) / dist15;

      required = Math.max(
        required,
        Math.ceil((accelMag * TICK_INTERVAL) / MAX_GRAVITY_DV_PER_SUBSTEP),
      );

      required = Math.max(
        required,
        Math.ceil((bodySpeed * TICK_INTERVAL) / MIN_TRAVEL_RESOLUTION),
      );
    }
  }

  return clampInt(required, PHYSICS_SUBSTEPS, PHYSICS_SUBSTEPS_MAX);
}

// ---------------------------------------------------------------------------
// apply_gravity_acceleration — PhysicsEngine.gd lines 147-157
// ---------------------------------------------------------------------------

/**
 * Accumulates the attraction of `source` into `body.xAcc`/`body.yAcc`.
 * No-op if `source.gravity === 0`.
 *
 * Sign convention (gotcha #4): dx = body.x - source.x, and the acceleration
 * is SUBTRACTED: `xAcc -= gravity * dx / dist^1.5`. That combination —
 * "vector points away from the source" and "subtract it" — is what makes
 * the net effect attraction. Flipping either half alone silently produces
 * repulsion while still "looking right" in a skim read.
 *
 * Pure inverse-square (no softening): the distSq <= EPS_DIST_SQ guard is
 * load-bearing here, not defensive — at exact overlap distSq is 0 and
 * dist15 would be 0, making the division 0/0 -> NaN.
 */
export function applyGravityAcceleration(body: Body, source: Body): void {
  if (source.gravity === 0) return;

  const dx = body.x - source.x;
  const dy = body.y - source.y;
  const distSq = dx * dx + dy * dy;
  if (distSq <= EPS_DIST_SQ) return;

  // pow(distSq, 1.5) === distSq * sqrt(distSq)
  const dist15 = distSq * Math.sqrt(distSq);
  body.xAcc -= (source.gravity * dx) / dist15;
  body.yAcc -= (source.gravity * dy) / dist15;
}

// ---------------------------------------------------------------------------
// apply_player_input — PhysicsEngine.gd lines 97-144
// ---------------------------------------------------------------------------

interface PlayerInputResult {
  thrusting: boolean;
  firstBoostTriggered: boolean;
}

/**
 * Mirrors `apply_player_input`, restricted to what the frozen `InputState`
 * carries (boost, brake, thrustX/thrustY already resolved by T-06 — no
 * separate touch/keyboard merge here, that happens upstream).
 *
 * Gotcha #1: boost and brake RESCALE speed, they do not add a vector.
 *   share = (speed + BOOST_STRENGTH * stepScale) / speed; xVel *= share; yVel *= share.
 *   Brake mirrors with max(0, speed - step) / speed.
 *   Special case: speed === 0 → boost adds `step` to xVel ONLY, yVel untouched.
 */
function applyPlayerInput(
  player: Body,
  stepScale: number,
  input: InputState,
  firstBoostFired: boolean,
): PlayerInputResult {
  const boostPressed = input.boost;
  const brakePressed = input.brake;

  player.isBoosting = boostPressed;
  player.isBraking = brakePressed;

  // Gotcha #10: PhysicsEngine.gd:117-118 computes this via a 32-bit Vector2 —
  // see vector2LengthF32's doc comment. This is the dominant source of the
  // scripted boost/brake parity divergence: `share`/`brakeShare` below
  // multiply the (still 64-bit) velocity directly, so a ~1e-7-relative
  // perturbation is injected every substep a boost/brake key is held, and
  // 2000 ticks of gravitationally-coupled motion amplifies it.
  const speed = vector2LengthF32(player.xVel, player.yVel);
  const stepBoost = BOOST_STRENGTH * stepScale;
  let firstBoostTriggered = false;

  if (boostPressed) {
    if (speed > 0.0) {
      const share = (speed + stepBoost) / speed;
      player.xVel = player.xVel * share;
      player.yVel = player.yVel * share;
    } else {
      // speed === 0: boost adds `step` to xVel only. yVel is left untouched.
      player.xVel = player.xVel + stepBoost;
    }
    if (!firstBoostFired) {
      firstBoostTriggered = true;
    }
  } else if (brakePressed && speed > 0.0) {
    const brakeShare = Math.max(0.0, speed - stepBoost) / speed;
    player.xVel = player.xVel * brakeShare;
    player.yVel = player.yVel * brakeShare;
  }

  // Directional thrust: SIDE_THRUST is 0.0 today, so this never actually
  // accelerates anything — but it still counts toward `thrusting`, exactly
  // like the reference (apply_player_input's `thrusting` includes
  // `direction != Vector2.ZERO` regardless of SIDE_THRUST's value).
  let directionPressed = false;
  if (input.thrustX !== 0 || input.thrustY !== 0) {
    directionPressed = true;
    const len = Math.sqrt(
      input.thrustX * input.thrustX + input.thrustY * input.thrustY,
    );
    if (len > 0) {
      const dirX = input.thrustX / len;
      const dirY = input.thrustY / len;
      player.xAcc += dirX * SIDE_THRUST;
      player.yAcc += dirY * SIDE_THRUST;
    }
  }

  return {
    thrusting: boostPressed || brakePressed || directionPressed,
    firstBoostTriggered,
  };
}

// ---------------------------------------------------------------------------
// simulate_substep / simulate_shadow_substep — PhysicsEngine.gd lines 30-95
// ---------------------------------------------------------------------------

interface SubstepResult {
  thrusting: boolean;
  firstBoostTriggered: boolean;
}

/**
 * One substep of the real simulation. Mirrors `simulate_substep`.
 *
 * Gotcha #3: acceleration zeroes per SUBSTEP, not per tick — `xAcc = 0` sits
 * inside this function, before gravity accumulates.
 * Gotcha #5: suns and anchored bodies never integrate — skipped entirely.
 *   Sources with gravity === 0 are skipped in the force loop too (this
 *   includes the player, whose gravity is 0, so the player never attracts
 *   anything).
 * Gotcha #7: semi-implicit Euler — velocity updates from acceleration
 *   first, then position updates from the NEW velocity. Both scaled by
 *   stepScale = 1 / substeps.
 */
function advanceRealSubstep(
  world: World,
  allowInput: boolean,
  stepScale: number,
  input: InputState,
  firstBoostFired: boolean,
): SubstepResult {
  const bodies = world.bodies;
  let thrusting = false;
  let firstBoostTriggered = false;

  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body === undefined) continue;
    if (body.type === "sun" || body.anchored) continue;

    body.xAcc = 0.0;
    body.yAcc = 0.0;

    if (body.type === "player" && allowInput) {
      const result = applyPlayerInput(body, stepScale, input, firstBoostFired);
      if (result.thrusting) thrusting = true;
      if (result.firstBoostTriggered) {
        firstBoostTriggered = true;
        firstBoostFired = true;
      }
    }

    for (let sourceIndex = 0; sourceIndex < bodies.length; sourceIndex++) {
      if (sourceIndex === i) continue;
      const source = bodies[sourceIndex];
      if (source === undefined) continue;
      if (source.gravity === 0) continue;
      applyGravityAcceleration(body, source);
    }

    body.xVel = body.xVel + body.xAcc * stepScale;
    body.yVel = body.yVel + body.yAcc * stepScale;
    body.x = body.x + body.xVel * stepScale;
    body.y = body.y + body.yVel * stepScale;

    // Visual only — physics never reads angle back. See gotcha in
    // INTERFACES.md: "Planet angle += degToRad(turnSpeed) * stepScale is
    // visual only; physics ignores it."
    if (body.type === "planet") {
      body.angle = body.angle + DEG_TO_RAD * body.turnSpeed * stepScale;
    }
  }

  return { thrusting, firstBoostTriggered };
}

/**
 * One substep of the shadow (prediction) simulation. Mirrors
 * `simulate_shadow_substep` — identical to the real substep except it never
 * touches player input and never updates planet angle (purely a physics
 * lookahead, nothing here is rendered).
 */
function advanceShadowSubstep(bodies: Body[], stepScale: number): void {
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body === undefined) continue;
    if (body.type === "sun" || body.anchored) continue;

    body.xAcc = 0.0;
    body.yAcc = 0.0;

    for (let sourceIndex = 0; sourceIndex < bodies.length; sourceIndex++) {
      if (sourceIndex === i) continue;
      const source = bodies[sourceIndex];
      if (source === undefined) continue;
      if (source.gravity === 0) continue;
      applyGravityAcceleration(body, source);
    }

    body.xVel = body.xVel + body.xAcc * stepScale;
    body.yVel = body.yVel + body.yAcc * stepScale;
    body.x = body.x + body.xVel * stepScale;
    body.y = body.y + body.yVel * stepScale;
  }
}

// ---------------------------------------------------------------------------
// simulateTick — orchestrates advanceRealSubstep + win/bounds checks
// ---------------------------------------------------------------------------

/**
 * Advances the world by exactly one tick (all substeps). Mutates
 * `world.bodies` in place.
 *
 * Gotcha #6: substepCount is computed ONCE per tick, from pre-step state,
 * before any substep runs — not recomputed mid-tick.
 *
 * `reachedGoal`/`outOfBounds` are evaluated unconditionally after the full
 * tick, mirroring GameWorld._check_win_condition / _check_world_bounds
 * (which the reference calls once per tick, after the substep loop). The
 * reference's bounds check is relative to a `world_origin` that tracks the
 * VIEWPORT's on-screen center every render frame — a rendering/window-size
 * quantity with no place in a pure, browser-free physics module. This port
 * instead treats MAX_WORLD_BOUNDS_X/Y as half-extents from the fixed world
 * origin (0, 0), consistent with constants.ts's own comment ("half-extents
 * from origin"). All 33 built-in levels sit well inside +-2600/+-1800 of
 * (0, 0) (measured object range: x in [180, 1660], y in [100, 820]), so this
 * is a generous same-order-of-magnitude safety envelope, not a tightened
 * one. See results/T-01-KEPLER.md for the full reasoning; T-05 FLYWHEEL
 * (which owns bounds.ts) is the consumer to flag if this needs revisiting.
 */
/**
 * Visual rotation for the player ship, from its velocity. Ports
 * `PhysicsEngine.gd:215-218` (`rocket_angle_from_velocity`) exactly:
 *
 * ```gdscript
 * if velocity.length_squared() <= 0.000001: return 0.0
 * return velocity.angle() + PI / 2.0
 * ```
 *
 * The `+ PI/2` is not arbitrary: the rocket art points UP, and Godot reads the
 * result back as `Vector2.UP.rotated(angle)` (GameWorld.gd:876) to place the
 * exhaust. Rotating (0,-1) by `atan2(vy,vx) + PI/2` yields `(cos a, sin a)` —
 * the unit velocity — so the offset is what makes "up on the sprite" mean
 * "the way it is travelling".
 *
 * Purely cosmetic: nothing in the physics path reads `angle` back, which is why
 * the parity traces deliberately exclude it. Called once per tick by the game
 * loop rather than from `simulateTick`, matching where Godot calls it
 * (GameWorld.gd:551, after the tick — not inside `PhysicsEngine`).
 */
export function rocketAngleFromVelocity(xVel: number, yVel: number): number {
  // length_squared() <= 0.000001, not a length comparison — matches the
  // reference and avoids a sqrt. A motionless ship keeps angle 0 rather than
  // snapping to an arbitrary heading from atan2(0, 0).
  if (xVel * xVel + yVel * yVel <= 0.000001) return 0;
  return Math.atan2(yVel, xVel) + Math.PI / 2;
}

export function simulateTick(
  world: World,
  input: InputState,
  opts: { allowInput: boolean; firstBoostFired: boolean },
): TickResult {
  const substeps = substepCount(world.bodies);
  const stepScale = 1.0 / substeps;

  let thrusting = false;
  let firstBoostFired = opts.firstBoostFired;
  let firstBoostTriggered = false;

  for (let s = 0; s < substeps; s++) {
    const result = advanceRealSubstep(
      world,
      opts.allowInput,
      stepScale,
      input,
      firstBoostFired,
    );
    if (result.thrusting) thrusting = true;
    if (result.firstBoostTriggered) {
      firstBoostFired = true;
      firstBoostTriggered = true;
    }
  }

  const player = world.bodies[world.playerIndex];
  const goal = world.bodies[world.goalIndex];

  let reachedGoal = false;
  let outOfBounds = false;
  if (player !== undefined) {
    if (goal !== undefined) {
      const dx = player.x - goal.x;
      const dy = player.y - goal.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      reachedGoal = distance <= world.goalRange;
    }
    outOfBounds =
      Math.abs(player.x) > MAX_WORLD_BOUNDS_X ||
      Math.abs(player.y) > MAX_WORLD_BOUNDS_Y;
  }

  return { thrusting, firstBoostTriggered, reachedGoal, outOfBounds };
}

// ---------------------------------------------------------------------------
// predict — recalculate_predictions — PhysicsEngine.gd lines 166-212
// ---------------------------------------------------------------------------

/**
 * Forward simulation with no input, for the trajectory overlay. Never
 * mutates `world` — operates on a shallow-copied shadow of every body
 * (all of Body's fields are primitives, so a shallow copy is a full copy).
 *
 * Horizon shortens with crowding (moving bodies = everything but suns):
 *   > 4 moving bodies → PREDICTION_TICKS * 2/3 (integer floor division)
 *   > 6 moving bodies → PREDICTION_TICKS / 2 (from the constant directly,
 *     NOT chained from the *2/3 result — matches two independent `if`s in
 *     the reference, not `if/elif`).
 * Planet sampling stride doubles above 2 planets.
 */
export function predict(world: World): Prediction {
  const shadow: Body[] = world.bodies.map((b) => ({ ...b }));

  let movingCount = 0;
  let planetCount = 0;
  for (const body of shadow) {
    if (body.type !== "sun") movingCount++;
    if (body.type === "planet") planetCount++;
  }

  let ticks = PREDICTION_TICKS;
  if (movingCount > 4) {
    ticks = Math.floor((PREDICTION_TICKS * 2) / 3);
  }
  if (movingCount > 6) {
    ticks = Math.floor(PREDICTION_TICKS / 2);
  }

  const planetStride = PREDICTION_STRIDE * (planetCount > 2 ? 2 : 1);
  const substeps = substepCount(shadow);
  const substepScale = 1.0 / substeps;

  const planetIndices: number[] = [];
  const planetTracks: Vec2[][] = [];
  for (let i = 0; i < shadow.length; i++) {
    const body = shadow[i];
    if (body !== undefined && body.type === "planet") {
      planetIndices.push(i);
      planetTracks.push([]);
    }
  }

  const player: Vec2[] = [];

  for (let tick = 0; tick < ticks; tick++) {
    for (let s = 0; s < substeps; s++) {
      advanceShadowSubstep(shadow, substepScale);
    }

    // Gotcha #10: PhysicsEngine.gd:204/207 store each sampled point as a
    // 32-bit Vector2 (`Vector2(float(x), float(y))`) — a one-time output
    // rounding that does not feed back into `shadow` (which stays 64-bit
    // throughout, matching advanceShadowSubstep above), so it does not
    // compound. This is the whole predict()-vs-recalculate_predictions
    // divergence: without it, every sampled point is off by the float64->
    // float32 rounding error of that coordinate (~value * 2^-24).
    if (tick % PREDICTION_STRIDE === 0) {
      for (const body of shadow) {
        if (body.type === "player") {
          player.push({ x: Math.fround(body.x), y: Math.fround(body.y) });
        }
      }
    }

    if (tick % planetStride === 0) {
      for (let k = 0; k < planetIndices.length; k++) {
        const idx = planetIndices[k];
        if (idx === undefined) continue;
        const body = shadow[idx];
        const track = planetTracks[k];
        if (body === undefined || track === undefined) continue;
        track.push({ x: Math.fround(body.x), y: Math.fround(body.y) });
      }
    }
  }

  return { player, planets: planetTracks };
}

// ---------------------------------------------------------------------------
// small local helper (not exported — not part of the frozen interface)
// ---------------------------------------------------------------------------

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
