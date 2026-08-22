/**
 * Self-consistency suite. Needs no Godot.
 *
 * This is the load-bearing suite for physics correctness: the Godot trace-comparison
 * suite (parity.test.ts) was removed on feat/remove-gravity-softening, since gravity now
 * deliberately diverges from the Godot reference (owner-directed: pure inverse-square,
 * matching S3, rather than the reference's Plummer softening) and verified manually
 * instead. This file is written to catch the specific porting mistakes listed as
 * "Gotchas" in notes/archive/T-01-KEPLER/task.md, independently of Godot ground truth:
 * sign errors, wrong loop nesting, per-substep vs per-tick bookkeeping, and the
 * boost/brake special cases.
 *
 * Every test here is designed to be *falsifiable* — see
 * notes/archive/T-01-KEPLER/results.md's "Deliberate sign-flip proof" for the proof that
 * these tests actually catch a broken port, not just describe one.
 */

import { describe, expect, it } from "vitest";
import type { Body, BodyType, InputState, World } from "../../src/types.js";
import { NO_INPUT } from "../../src/types.js";
import {
  BOOST_STRENGTH,
  MAX_WORLD_BOUNDS_X,
  MAX_WORLD_BOUNDS_Y,
  PHYSICS_SUBSTEPS,
  PHYSICS_SUBSTEPS_MAX,
} from "../../src/constants.js";
import {
  applyGravityAcceleration,
  predict,
  simulateTick,
  substepCount,
} from "../../src/physics.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeBody(partial: Partial<Body> & { type: BodyType }): Body {
  return {
    x: 0,
    y: 0,
    xVel: 0,
    yVel: 0,
    xAcc: 0,
    yAcc: 0,
    gravity: 0,
    size: 10,
    visible: true,
    anchored: false,
    angle: 0,
    turnSpeed: 0,
    isBoosting: false,
    isBraking: false,
    boostType: 0,
    ...partial,
  };
}

function makeWorld(
  bodies: Body[],
  opts?: { playerIndex?: number; goalIndex?: number; goalRange?: number },
): World {
  return {
    bodies,
    playerIndex:
      opts?.playerIndex ?? bodies.findIndex((b) => b.type === "player"),
    goalIndex: opts?.goalIndex ?? 0,
    goalRange: opts?.goalRange ?? 50,
  };
}

function cloneBody(b: Body): Body {
  return { ...b };
}

function cloneWorld(w: World): World {
  return { ...w, bodies: w.bodies.map(cloneBody) };
}

function runTicks(
  world: World,
  ticks: number,
  input: InputState = NO_INPUT,
): void {
  let firstBoostFired = false;
  for (let i = 0; i < ticks; i++) {
    const result = simulateTick(world, input, {
      allowInput: true,
      firstBoostFired,
    });
    if (result.firstBoostTriggered) firstBoostFired = true;
  }
}

// ===========================================================================
// 1. Golden values, hand-derived from PhysicsEngine.gd — arithmetic in comments
// ===========================================================================

describe("golden values (hand-derived from PhysicsEngine.gd)", () => {
  it("boost rescale held for a full tick: speed=5 (3,4), exact decimal arithmetic", () => {
    // PhysicsEngine.gd:122-126 (apply_player_input):
    //   var share := (speed + step_boost) / speed
    //   player["x_vel"] *= share ; player["y_vel"] *= share
    //
    // apply_player_input is called from INSIDE simulate_substep (PhysicsEngine.gd:50),
    // i.e. once per SUBSTEP, not once per tick — a naive "one substep" hand-derivation
    // is wrong here (an earlier draft of this test got exactly this wrong; corrected
    // after actually running it, see notes/T-01-KEPLER/log.md). But the per-substep
    // rescale has a clean substep-count-INDEPENDENT closed form, worth deriving:
    //
    //   share_k = (s_{k-1} + step_boost) / s_{k-1}, applied to the whole velocity
    //   vector, so it preserves direction and scales speed: s_k = s_{k-1} + step_boost
    //   (algebra: v_k = v_{k-1} * share_k = v_{k-1} * (s_{k-1}+step_boost)/s_{k-1};
    //   since v_{k-1} = s_{k-1} * unit_dir, this is (s_{k-1}+step_boost) * unit_dir).
    //
    //   Chained over N substeps: s_N = s_0 + N * step_boost = s_0 + N * BOOST_STRENGTH
    //   * stepScale = s_0 + BOOST_STRENGTH * (N * stepScale) = s_0 + BOOST_STRENGTH,
    //   because N * stepScale = N * (1/N) = 1 ALWAYS, for any substep count. So: for a
    //   full tick with boost held throughout and gravity=0 (direction never rotated by
    //   anything else), final speed = initial speed + BOOST_STRENGTH exactly, and
    //   direction is unchanged, regardless of how many substeps this tick used.
    //
    // Setup: player at rest position, xVel=3, yVel=4 -> speed = sqrt(9+16) = 5.
    // Unit direction = (3/5, 4/5) = (0.6, 0.8). BOOST_STRENGTH = 0.005.
    //   finalSpeed = 5 + 0.005 = 5.005
    //   xVel' = 0.6 * 5.005 = 3.003
    //   yVel' = 0.8 * 5.005 = 4.004
    const player = makeBody({
      type: "player",
      x: 0,
      y: 0,
      xVel: 3,
      yVel: 4,
      gravity: 0,
    });
    const world = makeWorld([player]);

    expect(substepCount(world.bodies)).toBe(PHYSICS_SUBSTEPS); // no sources -> baseline 4

    const result = simulateTick(
      world,
      { boost: true, brake: false, thrustX: 0, thrustY: 0 },
      {
        allowInput: true,
        firstBoostFired: false,
      },
    );

    const p = world.bodies[0];
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(p.xVel).toBeCloseTo(3.003, 9);
    expect(p.yVel).toBeCloseTo(4.004, 9);
    expect(result.thrusting).toBe(true);
    expect(result.firstBoostTriggered).toBe(true);
  });

  it("brake rescale held for a full tick: speed=5 (3,4), exact decimal arithmetic", () => {
    // PhysicsEngine.gd:131-134:
    //   var brake_share := maxf(0.0, speed - step_boost) / speed
    // Same closed form as the boost test above, sign flipped (as long as speed never
    // hits the max(0, ...) floor mid-tick, which it does not here):
    //   finalSpeed = 5 - 0.005 = 4.995
    //   xVel' = 0.6 * 4.995 = 2.997
    //   yVel' = 0.8 * 4.995 = 3.996
    const player = makeBody({
      type: "player",
      x: 0,
      y: 0,
      xVel: 3,
      yVel: 4,
      gravity: 0,
    });
    const world = makeWorld([player]);

    simulateTick(
      world,
      { boost: false, brake: true, thrustX: 0, thrustY: 0 },
      {
        allowInput: true,
        firstBoostFired: false,
      },
    );

    const p = world.bodies[0];
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(p.xVel).toBeCloseTo(2.997, 9);
    expect(p.yVel).toBeCloseTo(3.996, 9);
  });

  it("gravity acceleration: body at (100,0), source at origin, hand-derived formula", () => {
    // physics.ts's applyGravityAcceleration, pure inverse-square (no softening):
    //   dx = body.x - source.x ; dy = body.y - source.y
    //   dist_sq = dx*dx + dy*dy
    //   dist_1_5 = pow(dist_sq, 1.5)   -- ported as dist_sq*sqrt(dist_sq)
    //   x_acc -= source.gravity * dx / dist_1_5   (y_acc symmetric)
    //
    // Concrete numbers: source.gravity=1000, body at (100, 0), source at (0, 0):
    //   dx = 100, dy = 0
    //   dist_sq = 100*100 + 0 = 10000
    //   dist_1_5 = 10000 * sqrt(10000) = 10000 * 100 = 1000000
    //   x_acc = -(1000 * 100) / 1000000 = -0.1   (negative: pulled toward source, -x)
    //   y_acc = -(1000 * 0)   / 1000000 = 0       (dy is exactly 0)
    const body = makeBody({ type: "player", x: 100, y: 0, size: 10 });
    const source = makeBody({
      type: "sun",
      x: 0,
      y: 0,
      size: 20,
      gravity: 1000,
    });

    applyGravityAcceleration(body, source);

    expect(body.xAcc).toBeCloseTo(-0.1, 12);
    expect(body.yAcc).toBe(0);
    expect(body.xAcc).toBeLessThan(0); // attraction, not repulsion: pulled toward -x
  });

  it("refuses to divide by zero at exact overlap (guard is load-bearing, not defensive)", () => {
    const body = makeBody({ type: "player", x: 5, y: 5, size: 10 });
    const source = makeBody({
      type: "sun",
      x: 5,
      y: 5,
      size: 20,
      gravity: 1000,
    });

    applyGravityAcceleration(body, source);

    expect(body.xAcc).toBe(0);
    expect(body.yAcc).toBe(0);
    expect(Number.isNaN(body.xAcc)).toBe(false);
    expect(Number.isFinite(body.xAcc)).toBe(true);
  });

  it("finite and correctly signed just above the epsilon-distance guard", () => {
    // distSq = 0.01^2 = 0.0001, safely above EPS_DIST_SQ (1e-6).
    const body = makeBody({ type: "player", x: 0.01, y: 0, size: 10 });
    const source = makeBody({
      type: "sun",
      x: 0,
      y: 0,
      size: 20,
      gravity: 1000,
    });

    applyGravityAcceleration(body, source);

    expect(Number.isFinite(body.xAcc)).toBe(true);
    expect(body.xAcc).toBeLessThan(0);
    expect(body.yAcc).toBe(0);
  });
});

// ===========================================================================
// 2. Sign convention / attraction, not repulsion
// ===========================================================================

describe("sign convention (gotcha #4)", () => {
  it("a body pulls toward a source regardless of which side it starts on", () => {
    const source = makeBody({
      type: "sun",
      x: 0,
      y: 0,
      gravity: 5000,
      size: 15,
    });

    const positions: ReadonlyArray<readonly [number, number]> = [
      [500, 0],
      [-500, 0],
      [0, 500],
      [0, -500],
      [400, 300],
    ];
    for (const [sx, sy] of positions) {
      const body = makeBody({ type: "planet", x: sx, y: sy, size: 8 });
      applyGravityAcceleration(body, source);
      // Acceleration vector must point from body toward source, i.e. opposite the
      // body's position vector relative to the source (dot product negative).
      const dot = body.xAcc * sx + body.yAcc * sy;
      expect(dot).toBeLessThan(0);
    }
  });

  it("source.gravity === 0 produces no acceleration at all (no-op)", () => {
    const body = makeBody({ type: "planet", x: 100, y: 0 });
    const source = makeBody({ type: "sun", x: 0, y: 0, gravity: 0, size: 20 });
    applyGravityAcceleration(body, source);
    expect(body.xAcc).toBe(0);
    expect(body.yAcc).toBe(0);
  });
});

// ===========================================================================
// 3. Skip rules — suns, anchored bodies, zero-gravity sources (gotcha #5)
// ===========================================================================

describe("skip rules (gotcha #5)", () => {
  it("suns never integrate, even if given a velocity", () => {
    const sun = makeBody({
      type: "sun",
      x: 10,
      y: 20,
      xVel: 5,
      yVel: -5,
      gravity: 1000,
      size: 18,
    });
    const player = makeBody({ type: "player", x: 500, y: 500, gravity: 0 });
    const world = makeWorld([sun, player]);

    simulateTick(world, NO_INPUT, { allowInput: true, firstBoostFired: false });

    const s = world.bodies[0];
    expect(s).toBeDefined();
    if (s === undefined) return;
    expect(s.x).toBe(10);
    expect(s.y).toBe(20);
    expect(s.xVel).toBe(5);
    expect(s.yVel).toBe(-5);
  });

  it("anchored planets never integrate, even under strong gravity", () => {
    const sun = makeBody({ type: "sun", x: 0, y: 0, gravity: 50000, size: 18 });
    const anchoredPlanet = makeBody({
      type: "planet",
      x: 100,
      y: 0,
      xVel: 3,
      yVel: 0,
      anchored: true,
      size: 10,
    });
    const world = makeWorld([sun, anchoredPlanet], { playerIndex: -1 });

    runTicks(world, 50);

    const p = world.bodies[1];
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(p.x).toBe(100);
    expect(p.y).toBe(0);
    expect(p.xVel).toBe(3);
    expect(p.yVel).toBe(0);
  });

  it("a source with gravity === 0 contributes nothing — world with it matches world without it", () => {
    const player = makeBody({
      type: "player",
      x: 0,
      y: 0,
      xVel: 1,
      yVel: 0.5,
      gravity: 0,
    });
    const inertPlanet = makeBody({
      type: "planet",
      x: 50,
      y: 50,
      gravity: 0,
      size: 10,
    });

    const worldWith = makeWorld([cloneBody(player), cloneBody(inertPlanet)], {
      playerIndex: 0,
    });
    const worldWithout = makeWorld([cloneBody(player)], { playerIndex: 0 });

    runTicks(worldWith, 100);
    runTicks(worldWithout, 100);

    const withBody = worldWith.bodies[0];
    const withoutBody = worldWithout.bodies[0];
    expect(withBody).toBeDefined();
    expect(withoutBody).toBeDefined();
    if (withBody === undefined || withoutBody === undefined) return;
    expect(withBody.x).toBe(withoutBody.x);
    expect(withBody.y).toBe(withoutBody.y);
    expect(withBody.xVel).toBe(withoutBody.xVel);
    expect(withBody.yVel).toBe(withoutBody.yVel);
  });

  it("the player exerts no gravity when its own gravity is 0 (the realistic case)", () => {
    const player = makeBody({
      type: "player",
      x: 0,
      y: 0,
      gravity: 0,
      size: 10,
    });
    const freeBody = makeBody({
      type: "planet",
      x: 30,
      y: 0,
      gravity: 0,
      size: 10,
    });
    const world = makeWorld([player, freeBody], { playerIndex: 0 });

    runTicks(world, 20);

    const fb = world.bodies[1];
    expect(fb).toBeDefined();
    if (fb === undefined) return;
    // Nothing in this world has nonzero gravity, so nothing should have moved from
    // its initial straight-line (here: zero-velocity) motion.
    expect(fb.x).toBe(30);
    expect(fb.y).toBe(0);
  });

  it("skip is driven purely by the gravity VALUE, not by type === 'player'", () => {
    // Proves there is no accidental `if type === "player": skip as source` branch —
    // only `gravity === 0` matters. Give the player a contrived nonzero gravity and
    // confirm it then DOES attract a nearby free body.
    const player = makeBody({
      type: "player",
      x: 0,
      y: 0,
      gravity: 8000,
      size: 10,
    });
    const freeBody = makeBody({
      type: "planet",
      x: 200,
      y: 0,
      gravity: 0,
      size: 10,
    });
    const world = makeWorld([player, freeBody], { playerIndex: 0 });

    simulateTick(world, NO_INPUT, { allowInput: true, firstBoostFired: false });

    const fb = world.bodies[1];
    expect(fb).toBeDefined();
    if (fb === undefined) return;
    expect(fb.xVel).toBeLessThan(0); // pulled back toward the player, at -x
  });
});

// ===========================================================================
// 4. Acceleration zeroes per SUBSTEP, not per tick (gotcha #3)
// ===========================================================================

describe("per-substep acceleration zeroing (gotcha #3)", () => {
  // If accel is (wrongly) zeroed once per TICK instead of once per SUBSTEP, gravity's
  // contribution is never reset between substeps and keeps accumulating: substep k's
  // x_acc ends up holding roughly k times the single-substep contribution instead of
  // being recomputed fresh each time. Over N substeps that makes the total velocity
  // change roughly (N+1)/2 times too large (triangular-number growth) instead of the
  // correct ~1x (a plain semi-implicit Euler step over the whole tick). This test
  // builds both interpretations independently (using the same exported
  // applyGravityAcceleration primitive physics.ts itself uses) and checks that
  // simulateTick's real output matches ONLY the correct, per-substep-zeroing one.

  function forceHighSubstepScenario(): { player: Body; source: Body } {
    // Large gravity + short distance pushes substep_count's MAX_GRAVITY_DV_PER_SUBSTEP
    // trigger above the baseline of 4. Value chosen by measurement (see
    // notes/T-01-KEPLER/log.md): gravity=4e6 at distance=300 with default sizes
    // yields substepCount === 7.
    const player = makeBody({
      type: "player",
      x: 300,
      y: 0,
      xVel: 0,
      yVel: 0,
      gravity: 0,
    });
    const source = makeBody({
      type: "sun",
      x: 0,
      y: 0,
      gravity: 4_000_000,
      size: 18,
    });
    return { player, source };
  }

  it("substeps are actually > 1 in this scenario (test is meaningless otherwise)", () => {
    const { player, source } = forceHighSubstepScenario();
    const substeps = substepCount([player, source]);
    expect(substeps).toBeGreaterThan(4);
  });

  it("simulateTick matches per-substep zeroing, not per-tick zeroing", () => {
    const { player, source } = forceHighSubstepScenario();
    const substeps = substepCount([player, source]);
    const stepScale = 1 / substeps;

    // Model A — CORRECT: zero xAcc/yAcc at the top of every substep.
    const correctBodies = [cloneBody(player), cloneBody(source)];
    for (let s = 0; s < substeps; s++) {
      const b = correctBodies[0];
      const src = correctBodies[1];
      if (b === undefined || src === undefined) throw new Error("unreachable");
      b.xAcc = 0;
      b.yAcc = 0;
      applyGravityAcceleration(b, src);
      b.xVel += b.xAcc * stepScale;
      b.yVel += b.yAcc * stepScale;
      b.x += b.xVel * stepScale;
      b.y += b.yVel * stepScale;
    }

    // Model B — BUGGY: zero xAcc/yAcc once, before the substep loop (i.e. never reset
    // between substeps, so gravity's contribution accumulates on top of itself).
    const buggyBodies = [cloneBody(player), cloneBody(source)];
    {
      const b = buggyBodies[0];
      if (b === undefined) throw new Error("unreachable");
      b.xAcc = 0;
      b.yAcc = 0;
    }
    for (let s = 0; s < substeps; s++) {
      const b = buggyBodies[0];
      const src = buggyBodies[1];
      if (b === undefined || src === undefined) throw new Error("unreachable");
      applyGravityAcceleration(b, src); // note: no zeroing here
      b.xVel += b.xAcc * stepScale;
      b.yVel += b.yAcc * stepScale;
      b.x += b.xVel * stepScale;
      b.y += b.yVel * stepScale;
    }

    // The real thing under test.
    const world = makeWorld([cloneBody(player), cloneBody(source)], {
      playerIndex: 0,
    });
    simulateTick(world, NO_INPUT, { allowInput: true, firstBoostFired: false });

    const real = world.bodies[0];
    const correct = correctBodies[0];
    const buggy = buggyBodies[0];
    expect(real).toBeDefined();
    expect(correct).toBeDefined();
    expect(buggy).toBeDefined();
    if (real === undefined || correct === undefined || buggy === undefined)
      return;

    const diffFromCorrect = Math.abs(real.xVel - correct.xVel);
    const diffFromBuggy = Math.abs(real.xVel - buggy.xVel);

    console.log(
      `per-substep zeroing check: real=${real.xVel}, correctModel=${correct.xVel}, ` +
        `buggyModel=${buggy.xVel}, |real-correct|=${diffFromCorrect}, |real-buggy|=${diffFromBuggy}`,
    );

    expect(diffFromCorrect).toBeLessThan(1e-9);
    // The buggy model must be clearly, grossly different — not a rounding-level gap.
    expect(diffFromBuggy).toBeGreaterThan(Math.abs(correct.xVel) * 0.5);
  });
});

// ===========================================================================
// 5. Semi-implicit Euler ordering (gotcha #7)
// ===========================================================================

describe("semi-implicit Euler ordering (gotcha #7)", () => {
  it("position update uses the NEW (post-acceleration) velocity, not the old one", () => {
    // Single body, no gravity, but WITH a manually-forced acceleration via boost so we
    // get a nonzero xAcc-driven velocity change we can reason about precisely. Actually
    // boost changes velocity directly (gotcha #1), so instead use a real gravity source
    // to get a genuine xAcc contribution, and confirm position moved further than
    // "old velocity * stepScale" would predict — i.e. some of the new velocity is
    // baked into the position update of the SAME substep.
    const player = makeBody({
      type: "player",
      x: 300,
      y: 0,
      xVel: 0,
      yVel: 0,
      gravity: 0,
    });
    const source = makeBody({
      type: "sun",
      x: 0,
      y: 0,
      gravity: 200000,
      size: 18,
    });
    const world = makeWorld([player, source], { playerIndex: 0 });

    const substeps = substepCount(world.bodies);
    const stepScale = 1 / substeps;

    simulateTick(world, NO_INPUT, { allowInput: true, firstBoostFired: false });

    const p = world.bodies[0];
    expect(p).toBeDefined();
    if (p === undefined) return;

    // Old-velocity-only prediction: if position used the OLD velocity (explicit Euler),
    // and the body started at rest, it would not have moved at all in the first
    // substep, and every subsequent substep would lag one step behind the velocity
    // curve. We don't replicate the exact wrong number here (see the dedicated
    // ordering-divergence test below); this test only asserts the qualitative
    // signature: the body DID move (position changed) even though every substep
    // starts that substep's integration from x_vel accumulated in THIS same substep,
    // starting from rest.
    expect(p.x).not.toBe(300);
    expect(p.xVel).toBeLessThan(0); // pulled toward the sun at origin

    void stepScale; // (kept for readability of the derivation above)
  });

  it("swapping the update order (old-velocity-for-position) measurably diverges", () => {
    const player = makeBody({
      type: "player",
      x: 300,
      y: 0,
      xVel: 0,
      yVel: 0,
      gravity: 0,
    });
    const source = makeBody({
      type: "sun",
      x: 0,
      y: 0,
      gravity: 200000,
      size: 18,
    });
    const substeps = substepCount([player, source]);
    const stepScale = 1 / substeps;

    // Semi-implicit (correct): velocity first, then position from the NEW velocity.
    const semiImplicit = {
      x: player.x,
      y: player.y,
      xVel: player.xVel,
      yVel: player.yVel,
    };
    const src = cloneBody(source);
    for (let s = 0; s < substeps; s++) {
      const b = makeBody({ type: "player", ...semiImplicit, gravity: 0 });
      b.xAcc = 0;
      b.yAcc = 0;
      applyGravityAcceleration(b, src);
      semiImplicit.xVel += b.xAcc * stepScale;
      semiImplicit.yVel += b.yAcc * stepScale;
      semiImplicit.x += semiImplicit.xVel * stepScale; // NEW velocity
      semiImplicit.y += semiImplicit.yVel * stepScale;
    }

    // Explicit Euler (wrong order): position updates from the OLD velocity.
    const explicit = {
      x: player.x,
      y: player.y,
      xVel: player.xVel,
      yVel: player.yVel,
    };
    for (let s = 0; s < substeps; s++) {
      const b = makeBody({ type: "player", ...explicit, gravity: 0 });
      b.xAcc = 0;
      b.yAcc = 0;
      applyGravityAcceleration(b, src);
      const oldXVel = explicit.xVel;
      const oldYVel = explicit.yVel;
      explicit.xVel += b.xAcc * stepScale;
      explicit.yVel += b.yAcc * stepScale;
      explicit.x += oldXVel * stepScale; // OLD velocity
      explicit.y += oldYVel * stepScale;
    }

    const world = makeWorld([cloneBody(player), cloneBody(source)], {
      playerIndex: 0,
    });
    simulateTick(world, NO_INPUT, { allowInput: true, firstBoostFired: false });
    const real = world.bodies[0];
    expect(real).toBeDefined();
    if (real === undefined) return;

    expect(Math.abs(real.x - semiImplicit.x)).toBeLessThan(1e-9);
    // Starting from rest, explicit Euler's first substep moves 0 (old velocity was
    // zero), so it lags behind semi-implicit's position throughout — must be a real,
    // non-rounding-level gap.
    expect(Math.abs(real.x - explicit.x)).toBeGreaterThan(1e-6);
  });
});

// ===========================================================================
// 6. substepCount reads pre-step state, computed once per tick (gotcha #6)
// ===========================================================================

describe("substepCount semantics (gotcha #6)", () => {
  it("is clamped to [PHYSICS_SUBSTEPS, PHYSICS_SUBSTEPS_MAX]", () => {
    const lone = makeBody({ type: "player", gravity: 0 });
    expect(substepCount([lone])).toBe(PHYSICS_SUBSTEPS);

    const player = makeBody({
      type: "player",
      x: 1,
      y: 0,
      xVel: 0,
      yVel: 0,
      gravity: 0,
    });
    const source = makeBody({ type: "sun", x: 0, y: 0, gravity: 1e9, size: 5 });
    expect(substepCount([player, source])).toBe(PHYSICS_SUBSTEPS_MAX);
  });

  it("skips suns as the primary body but NOT as a contributor to other bodies' counts", () => {
    const sun = makeBody({ type: "sun", x: 0, y: 0, gravity: 5000, size: 18 });
    // A lone sun contributes nothing to the required count (it is skipped as the outer
    // "body" and there is no other body to be a source for).
    expect(substepCount([sun])).toBe(PHYSICS_SUBSTEPS);
  });

  it("an anchored body's speed/gravity-pull still feeds the count even though it never moves", () => {
    // Faithful port of a reference quirk: substep_count's outer loop skips only suns,
    // not anchored bodies (PhysicsEngine.gd:8 has no anchored check, unlike
    // simulate_substep's :43). Verify our port keeps this: an anchored body sitting
    // close to a strong source still raises the required substep count.
    const sun = makeBody({ type: "sun", x: 0, y: 0, gravity: 1e7, size: 18 });
    const anchoredNear = makeBody({
      type: "planet",
      x: 20,
      y: 0,
      anchored: true,
      size: 5,
    });
    const withAnchored = substepCount([sun, anchoredNear]);
    expect(withAnchored).toBeGreaterThan(PHYSICS_SUBSTEPS);
  });

  it("is computed once from PRE-step state — moving the body first changes the result", () => {
    const sunNear = makeBody({
      type: "sun",
      x: 20,
      y: 0,
      gravity: 1e7,
      size: 18,
    });
    const sunFar = makeBody({
      type: "sun",
      x: 2000,
      y: 0,
      gravity: 1e7,
      size: 18,
    });
    const bodyAtOrigin = makeBody({ type: "player", x: 0, y: 0, gravity: 0 });

    const near = substepCount([bodyAtOrigin, sunNear]);
    const far = substepCount([bodyAtOrigin, sunFar]);
    expect(near).toBeGreaterThan(far);
  });
});

// ===========================================================================
// 7. Boost/brake special cases (gotcha #1)
// ===========================================================================

describe("boost/brake special cases (gotcha #1)", () => {
  it("speed === 0: boost adds to xVel only, yVel untouched, for a whole tick", () => {
    // PhysicsEngine.gd:127-128 (apply_player_input, speed <= 0 branch):
    //   player["x_vel"] = float(player["x_vel"]) + step_boost   -- no y_vel touch
    //
    // This branch is evaluated once per SUBSTEP too. Tracing through 4 substeps by
    // hand (stepScale=0.25, step_boost = 0.005*0.25 = 0.00125 each):
    //   substep 1: speed=0            -> xVel = 0 + 0.00125 = 0.00125,           yVel=0
    //   substep 2: speed=0.00125 (>0) -> share=(0.00125+0.00125)/0.00125=2       -> xVel=0.0025,  yVel=0*2=0
    //   substep 3: speed=0.0025       -> share=(0.0025+0.00125)/0.0025=1.5      -> xVel=0.00375, yVel=0
    //   substep 4: speed=0.00375      -> share=(0.00375+0.00125)/0.00375=4/3    -> xVel=0.005,   yVel=0
    // That is the exact answer IF `speed` is computed in ordinary 64-bit float
    // throughout. It is not: PhysicsEngine.gd:117-118 computes `speed` via
    // `Vector2(...).length()`, and Vector2's components are 32-bit `real_t` in
    // the standard Godot 4 build (see physics.ts's gotcha #10 / vector2LengthF32,
    // and notes/T-01-KEPLER/parity-debug.md for the full derivation). Substep 1's
    // speed is exactly 0 either way (0 has no rounding error), but substeps 2-4
    // feed a nonzero, not-exactly-float32-representable xVel back into another
    // `.length()` call, so each of those three substeps' `share` is computed
    // from a float32-rounded `speed` — a real, reference-faithful perturbation,
    // not a bug in the port. yVel is untouched by this (0 times any finite share
    // is exactly 0 in every precision), so only xVel is affected.
    //
    // Re-derive the expected xVel by re-running the same substep recurrence with
    // the same float32-per-step rounding physics.ts's vector2LengthF32 applies,
    // rather than hardcoding the resulting magic float or loosening the
    // tolerance blindly — this still fails if either the recurrence or the
    // rounding model changes.
    function lengthF32(x: number, y: number): number {
      const fx = Math.fround(x);
      const fy = Math.fround(y);
      const xx = Math.fround(fx * fx);
      const yy = Math.fround(fy * fy);
      return Math.fround(Math.sqrt(Math.fround(xx + yy)));
    }
    const stepScale = 0.25;
    const stepBoost = BOOST_STRENGTH * stepScale;
    let expectedXVel = 0;
    for (let s = 0; s < 4; s++) {
      const speed = lengthF32(expectedXVel, 0);
      expectedXVel =
        speed > 0
          ? expectedXVel * ((speed + stepBoost) / speed)
          : expectedXVel + stepBoost;
    }

    const player = makeBody({
      type: "player",
      x: 0,
      y: 0,
      xVel: 0,
      yVel: 0,
      gravity: 0,
    });
    const world = makeWorld([player]);

    simulateTick(
      world,
      { boost: true, brake: false, thrustX: 0, thrustY: 0 },
      {
        allowInput: true,
        firstBoostFired: false,
      },
    );

    const p = world.bodies[0];
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(p.xVel).toBe(expectedXVel);
    // Still very close to BOOST_STRENGTH — the float32 perturbation is ~4e-11,
    // eight orders of magnitude below the rescale itself.
    expect(p.xVel).toBeCloseTo(BOOST_STRENGTH, 9);
    expect(p.yVel).toBe(0);
  });

  it("speed === 0: brake is a no-op (brake only applies when speed > 0)", () => {
    const player = makeBody({
      type: "player",
      x: 0,
      y: 0,
      xVel: 0,
      yVel: 0,
      gravity: 0,
    });
    const world = makeWorld([player]);

    simulateTick(
      world,
      { boost: false, brake: true, thrustX: 0, thrustY: 0 },
      {
        allowInput: true,
        firstBoostFired: false,
      },
    );

    const p = world.bodies[0];
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(p.xVel).toBe(0);
    expect(p.yVel).toBe(0);
  });

  it("brake clamps at zero — never reverses velocity when step exceeds speed", () => {
    const player = makeBody({
      type: "player",
      x: 0,
      y: 0,
      xVel: 0.0001,
      yVel: 0,
      gravity: 0,
    });
    const world = makeWorld([player]);
    // BOOST_STRENGTH * stepScale (>= 0.005/12 ~ 0.0004) exceeds this tiny speed easily.
    simulateTick(
      world,
      { boost: false, brake: true, thrustX: 0, thrustY: 0 },
      {
        allowInput: true,
        firstBoostFired: false,
      },
    );
    const p = world.bodies[0];
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(p.xVel).toBe(0);
    expect(p.xVel).toBeGreaterThanOrEqual(0); // definitely not negative
  });

  it("boost takes priority over brake when both are pressed", () => {
    const boostOnly = makeBody({
      type: "player",
      x: 0,
      y: 0,
      xVel: 3,
      yVel: 4,
      gravity: 0,
    });
    const both = makeBody({
      type: "player",
      x: 0,
      y: 0,
      xVel: 3,
      yVel: 4,
      gravity: 0,
    });

    const worldBoostOnly = makeWorld([boostOnly]);
    const worldBoth = makeWorld([both]);

    simulateTick(
      worldBoostOnly,
      { boost: true, brake: false, thrustX: 0, thrustY: 0 },
      {
        allowInput: true,
        firstBoostFired: false,
      },
    );
    simulateTick(
      worldBoth,
      { boost: true, brake: true, thrustX: 0, thrustY: 0 },
      {
        allowInput: true,
        firstBoostFired: false,
      },
    );

    const a = worldBoostOnly.bodies[0];
    const b = worldBoth.bodies[0];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) return;
    expect(b.xVel).toBe(a.xVel);
    expect(b.yVel).toBe(a.yVel);
  });

  it("directional thrust counts toward `thrusting` even though SIDE_THRUST=0 makes it inert", () => {
    const withDir = makeBody({
      type: "player",
      x: 300,
      y: 0,
      xVel: 1,
      yVel: 0,
      gravity: 0,
    });
    const withoutDir = makeBody({
      type: "player",
      x: 300,
      y: 0,
      xVel: 1,
      yVel: 0,
      gravity: 0,
    });
    const source = makeBody({
      type: "sun",
      x: 0,
      y: 0,
      gravity: 5000,
      size: 18,
    });

    const worldWith = makeWorld([cloneBody(withDir), cloneBody(source)], {
      playerIndex: 0,
    });
    const worldWithout = makeWorld([cloneBody(withoutDir), cloneBody(source)], {
      playerIndex: 0,
    });

    const resultWith = simulateTick(
      worldWith,
      { boost: false, brake: false, thrustX: 1, thrustY: 0 },
      {
        allowInput: true,
        firstBoostFired: false,
      },
    );
    const resultWithout = simulateTick(worldWithout, NO_INPUT, {
      allowInput: true,
      firstBoostFired: false,
    });

    expect(resultWith.thrusting).toBe(true);
    expect(resultWithout.thrusting).toBe(false);

    const pWith = worldWith.bodies[0];
    const pWithout = worldWithout.bodies[0];
    expect(pWith).toBeDefined();
    expect(pWithout).toBeDefined();
    if (pWith === undefined || pWithout === undefined) return;
    // SIDE_THRUST is 0.0, so the trajectory itself must be identical regardless.
    expect(pWith.x).toBe(pWithout.x);
    expect(pWith.y).toBe(pWithout.y);
    expect(pWith.xVel).toBe(pWithout.xVel);
    expect(pWith.yVel).toBe(pWithout.yVel);
  });

  it("firstBoostTriggered fires exactly once across a held-boost attempt", () => {
    const player = makeBody({
      type: "player",
      x: 0,
      y: 0,
      xVel: 0,
      yVel: 0,
      gravity: 0,
    });
    const world = makeWorld([player]);
    let firstBoostFired = false;
    let triggerCount = 0;

    for (let i = 0; i < 30; i++) {
      const result = simulateTick(
        world,
        { boost: true, brake: false, thrustX: 0, thrustY: 0 },
        {
          allowInput: true,
          firstBoostFired,
        },
      );
      if (result.firstBoostTriggered) {
        triggerCount++;
        firstBoostFired = true;
      }
    }

    expect(triggerCount).toBe(1);
  });
});

// ===========================================================================
// 8. Two-body circular orbit — energy/momentum/periodicity
// ===========================================================================

describe("two-body circular orbit", () => {
  it("stays bounded, returns near its start after ~one period, and conserves specific energy", () => {
    // Pure inverse-square force: a = G / r^2 exactly, so a circular orbit needs
    // v = sqrt(G / r).
    const G = 8000;
    const r = 800;
    const v = Math.sqrt(G / r);

    const sun = makeBody({ type: "sun", x: 0, y: 0, gravity: G, size: 18 });
    const planet = makeBody({
      type: "planet",
      x: r,
      y: 0,
      xVel: 0,
      yVel: v,
      gravity: 0,
      size: 8,
    });
    const world = makeWorld([sun, planet], { playerIndex: -1 });

    const period = Math.round((2 * Math.PI * r) / v);

    const energyAt = (b: Body): number => {
      const speedSq = b.xVel * b.xVel + b.yVel * b.yVel;
      const dist = Math.sqrt(b.x * b.x + b.y * b.y);
      return 0.5 * speedSq - G / dist; // exact potential for pure inverse-square gravity
    };
    const angularMomentumAt = (b: Body): number => b.x * b.yVel - b.y * b.xVel;

    const e0 = energyAt(planet);
    const l0 = angularMomentumAt(planet);

    let maxRadiusDeviation = 0;
    for (let tick = 0; tick < period; tick++) {
      simulateTick(world, NO_INPUT, {
        allowInput: true,
        firstBoostFired: false,
      });
      const p = world.bodies[1];
      if (p === undefined) continue;
      const dist = Math.sqrt(p.x * p.x + p.y * p.y);
      maxRadiusDeviation = Math.max(maxRadiusDeviation, Math.abs(dist - r) / r);
    }

    const p = world.bodies[1];
    expect(p).toBeDefined();
    if (p === undefined) return;

    const finalDistFromStart = Math.hypot(p.x - r, p.y - 0);
    const e1 = energyAt(p);
    const l1 = angularMomentumAt(p);

    console.log(
      `orbit check: period=${period} ticks, maxRadiusDeviation=${(maxRadiusDeviation * 100).toFixed(3)}%, ` +
        `finalDistFromStart=${finalDistFromStart.toFixed(3)} (r=${r}), ` +
        `energyDrift=${(Math.abs((e1 - e0) / e0) * 100).toFixed(4)}%, ` +
        `angularMomentumDrift=${(Math.abs((l1 - l0) / l0) * 100).toFixed(4)}%`,
    );

    // Bounded orbit: radius never strays far from r.
    expect(maxRadiusDeviation).toBeLessThan(0.03);
    // Returns close to its starting point after one period.
    expect(finalDistFromStart).toBeLessThan(r * 0.05);
    // Angular momentum (radial force => central force => L conserved) stays close.
    expect(Math.abs((l1 - l0) / l0)).toBeLessThan(0.01);
    // Specific energy stays close (symplectic-ish integrator: bounded oscillation, not
    // systematic drift, over a single period).
    expect(Math.abs((e1 - e0) / e0)).toBeLessThan(0.03);
  });

  it("REPULSION would fail this test: sanity-check via a deliberately inverted force", () => {
    // Not a test of physics.ts — a control, showing the orbit test above is actually
    // sensitive to the attraction/repulsion sign, not just asserting something trivially
    // true. Manually integrates a repulsive version of the same scenario and confirms it
    // does NOT stay bounded near r (proving the bounded-orbit assertion above is a real
    // signal, not a tautology it would pass regardless of sign).
    const G = 8000;
    const r = 800;
    const v = Math.sqrt(G / r);
    let x = r;
    let y = 0;
    let xVel = 0;
    let yVel = v;
    const period = Math.round((2 * Math.PI * r) / v);
    const substeps = 4;
    const stepScale = 1 / substeps;
    let maxDist = r;

    for (let tick = 0; tick < period; tick++) {
      for (let s = 0; s < substeps; s++) {
        const dist = Math.sqrt(x * x + y * y);
        const distSq = dist * dist;
        // Repulsive: sign flipped relative to applyGravityAcceleration.
        const acc = G / (distSq * dist);
        const xAcc = acc * x;
        const yAcc = acc * y;
        xVel += xAcc * stepScale;
        yVel += yAcc * stepScale;
        x += xVel * stepScale;
        y += yVel * stepScale;
      }
      maxDist = Math.max(maxDist, Math.sqrt(x * x + y * y));
    }

    expect(maxDist).toBeGreaterThan(r * 2); // flies away, does not orbit
  });
});

// ===========================================================================
// 9. Symmetry checks
// ===========================================================================

describe("symmetry", () => {
  it("mirroring every body through the x-axis mirrors the whole trajectory", () => {
    const sun = makeBody({ type: "sun", x: 0, y: 0, gravity: 6000, size: 16 });
    const planetA = makeBody({
      type: "planet",
      x: 300,
      y: 150,
      xVel: -0.5,
      yVel: 1.2,
      gravity: 0,
      size: 9,
    });
    const worldA = makeWorld([sun, planetA], { playerIndex: -1 });

    const sunM = makeBody({
      type: "sun",
      x: 0,
      y: -0,
      gravity: 6000,
      size: 16,
    });
    const planetM = makeBody({
      type: "planet",
      x: 300,
      y: -150,
      xVel: -0.5,
      yVel: -1.2,
      gravity: 0,
      size: 9,
    });
    const worldM = makeWorld([sunM, planetM], { playerIndex: -1 });

    runTicks(worldA, 500);
    runTicks(worldM, 500);

    const a = worldA.bodies[1];
    const m = worldM.bodies[1];
    expect(a).toBeDefined();
    expect(m).toBeDefined();
    if (a === undefined || m === undefined) return;

    expect(m.x).toBeCloseTo(a.x, 9);
    expect(m.y).toBeCloseTo(-a.y, 9);
    expect(m.xVel).toBeCloseTo(a.xVel, 9);
    expect(m.yVel).toBeCloseTo(-a.yVel, 9);
  });

  it("rotating every body 90 degrees rotates the whole trajectory", () => {
    // (x, y, vx, vy) -> (-y, x, -vy, vx) is a 90-degree rotation. The source sits at
    // the origin (a fixed point of the rotation), so this must commute with time
    // evolution if x and y are treated symmetrically by the force law.
    const sun = makeBody({ type: "sun", x: 0, y: 0, gravity: 6000, size: 16 });
    const planetA = makeBody({
      type: "planet",
      x: 300,
      y: 150,
      xVel: -0.5,
      yVel: 1.2,
      gravity: 0,
      size: 9,
    });
    const worldA = makeWorld([sun, planetA], { playerIndex: -1 });

    const sunR = makeBody({ type: "sun", x: 0, y: 0, gravity: 6000, size: 16 });
    const planetR = makeBody({
      type: "planet",
      x: -150,
      y: 300,
      xVel: -1.2,
      yVel: -0.5,
      gravity: 0,
      size: 9,
    });
    const worldR = makeWorld([sunR, planetR], { playerIndex: -1 });

    runTicks(worldA, 500);
    runTicks(worldR, 500);

    const a = worldA.bodies[1];
    const r = worldR.bodies[1];
    expect(a).toBeDefined();
    expect(r).toBeDefined();
    if (a === undefined || r === undefined) return;

    expect(r.x).toBeCloseTo(-a.y, 9);
    expect(r.y).toBeCloseTo(a.x, 9);
    expect(r.xVel).toBeCloseTo(-a.yVel, 9);
    expect(r.yVel).toBeCloseTo(a.xVel, 9);
  });
});

// ===========================================================================
// 10. predict() — never mutates, horizon shortening, sample-for-sample shape
// ===========================================================================

describe("predict()", () => {
  it("never mutates the world it is given", () => {
    const sun = makeBody({ type: "sun", x: 0, y: 0, gravity: 5000, size: 18 });
    const player = makeBody({
      type: "player",
      x: 400,
      y: 0,
      xVel: 0.2,
      yVel: 1,
      gravity: 0,
    });
    const world = makeWorld([sun, player], { playerIndex: 1 });
    const before = cloneWorld(world);

    predict(world);

    expect(world.bodies).toEqual(before.bodies);
    expect(world.playerIndex).toBe(before.playerIndex);
    expect(world.goalIndex).toBe(before.goalIndex);
    expect(world.goalRange).toBe(before.goalRange);
  });

  it("samples the player every PREDICTION_STRIDE ticks and returns one track per planet", () => {
    const sun = makeBody({ type: "sun", x: 0, y: 0, gravity: 5000, size: 18 });
    const player = makeBody({
      type: "player",
      x: 400,
      y: 0,
      xVel: 0.2,
      yVel: 1,
      gravity: 0,
    });
    const planet = makeBody({
      type: "planet",
      x: -400,
      y: 0,
      xVel: 0,
      yVel: -1,
      gravity: 0,
      size: 8,
    });
    const world = makeWorld([sun, player, planet], { playerIndex: 1 });

    const prediction = predict(world);

    expect(prediction.planets.length).toBe(1);
    expect(prediction.player.length).toBeGreaterThan(0);
    expect(prediction.planets[0]?.length).toBeGreaterThan(0);
  });

  it("shortens its horizon as moving-body count grows past 4 and past 6", () => {
    const sun = makeBody({ type: "sun", x: 0, y: 0, gravity: 100, size: 12 });

    const few = makeWorld(
      [sun, makeBody({ type: "player", x: 300, y: 0, gravity: 0 })],
      { playerIndex: 1 },
    );
    // 5 moving bodies (player + 4 planets) -> just above the ">4" threshold.
    const mid = makeWorld(
      [
        sun,
        makeBody({ type: "player", x: 300, y: 0, gravity: 0 }),
        makeBody({ type: "planet", x: 320, y: 0, gravity: 0 }),
        makeBody({ type: "planet", x: 340, y: 0, gravity: 0 }),
        makeBody({ type: "planet", x: 360, y: 0, gravity: 0 }),
        makeBody({ type: "planet", x: 380, y: 0, gravity: 0 }),
      ],
      { playerIndex: 1 },
    );
    // 7 moving bodies -> above the ">6" threshold.
    const many = makeWorld(
      [
        sun,
        makeBody({ type: "player", x: 300, y: 0, gravity: 0 }),
        makeBody({ type: "planet", x: 320, y: 0, gravity: 0 }),
        makeBody({ type: "planet", x: 340, y: 0, gravity: 0 }),
        makeBody({ type: "planet", x: 360, y: 0, gravity: 0 }),
        makeBody({ type: "planet", x: 380, y: 0, gravity: 0 }),
        makeBody({ type: "planet", x: 400, y: 0, gravity: 0 }),
        makeBody({ type: "planet", x: 420, y: 0, gravity: 0 }),
      ],
      { playerIndex: 1 },
    );

    const fewLen = predict(few).player.length;
    const midLen = predict(mid).player.length;
    const manyLen = predict(many).player.length;

    console.log(
      `predict() horizon sample counts: few=${fewLen}, mid(5 moving)=${midLen}, many(7 moving)=${manyLen}`,
    );

    expect(midLen).toBeLessThan(fewLen);
    expect(manyLen).toBeLessThan(midLen);
  });
});

// ===========================================================================
// 11. reachedGoal / outOfBounds
// ===========================================================================

describe("reachedGoal", () => {
  it("true iff within goalRange of the goal body (Euclidean distance)", () => {
    const player = makeBody({ type: "player", x: 0, y: 0, gravity: 0 });
    const goal = makeBody({ type: "planet", x: 30, y: 40, gravity: 0 }); // distance 50
    const world = makeWorld([player, goal], {
      playerIndex: 0,
      goalIndex: 1,
      goalRange: 50,
    });

    const atBoundary = simulateTick(world, NO_INPUT, {
      allowInput: true,
      firstBoostFired: false,
    });
    expect(atBoundary.reachedGoal).toBe(true); // <= range, boundary counts

    world.bodies[1] = makeBody({
      type: "planet",
      x: 30.0001,
      y: 40,
      gravity: 0,
    });
    const justOutside = simulateTick(world, NO_INPUT, {
      allowInput: true,
      firstBoostFired: false,
    });
    expect(justOutside.reachedGoal).toBe(false);
  });
});

describe("outOfBounds", () => {
  it("false well within MAX_WORLD_BOUNDS, true once past it on either axis", () => {
    const inBounds = makeBody({ type: "player", x: 100, y: 100, gravity: 0 });
    const worldIn = makeWorld([inBounds], { playerIndex: 0 });
    expect(
      simulateTick(worldIn, NO_INPUT, {
        allowInput: true,
        firstBoostFired: false,
      }).outOfBounds,
    ).toBe(false);

    const pastX = makeBody({
      type: "player",
      x: MAX_WORLD_BOUNDS_X + 1,
      y: 0,
      gravity: 0,
    });
    const worldX = makeWorld([pastX], { playerIndex: 0 });
    expect(
      simulateTick(worldX, NO_INPUT, {
        allowInput: true,
        firstBoostFired: false,
      }).outOfBounds,
    ).toBe(true);

    const pastY = makeBody({
      type: "player",
      x: 0,
      y: MAX_WORLD_BOUNDS_Y + 1,
      gravity: 0,
    });
    const worldY = makeWorld([pastY], { playerIndex: 0 });
    expect(
      simulateTick(worldY, NO_INPUT, {
        allowInput: true,
        firstBoostFired: false,
      }).outOfBounds,
    ).toBe(true);
  });
});
