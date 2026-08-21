/**
 * Self-contained orbital-periodicity check. No Godot, no external reference: a
 * bound two-body orbit under pure inverse-square gravity must be periodic, so lap 2
 * of the player's trajectory must retrace lap 1 exactly (same (x, y) at the same
 * angle around the sun, one revolution later). This pins down how well that
 * property holds today so a future regression to the integrator gets caught.
 *
 * Setup: sun (immovable — type "sun" bodies never integrate, see physics.ts) fixed
 * at the origin with gravity = GM. Player starts at r=1, purely tangential v=1, so
 * specific energy E = 0.5 - GM. The orbit is bound (returns to start) only for
 * GM > 0.5 (E < 0).
 *
 * GM values: 0.6 (wide eccentric ellipse, e~=0.67), 1.0 (circular), 1.2 (tighter
 * eccentric ellipse, e~=0.17). NOT 2.0, despite that being a natural third example:
 * at r=1 with GM>1, r=1 is the orbit's APOAPSIS and periapsis shrinks as GM grows
 * (periapsis ~= 0.33 at GM=2). substepCount()'s adaptive-substep thresholds
 * (MAX_GRAVITY_DV_PER_SUBSTEP / MIN_TRAVEL_RESOLUTION, physics.ts) are calibrated
 * in TICK_INTERVAL-scaled absolute units for game-scale levels (positions in the
 * hundreds+, gravity in the thousands+) and never fire at this unit-scale problem,
 * so every case here runs the baseline PHYSICS_SUBSTEPS=4 regardless of GM.
 * Measured directly: at GM=2.0 that fixed 4-substep resolution is too coarse for
 * the tight periapsis passage — specific energy drifts +147% within 300 ticks and
 * the "orbit" flies out to r>350, i.e. it is not actually periodic under this
 * engine's current resolution, so it cannot be used for a periodicity check. GM=1.2
 * stays well-resolved (energy drift +0.5% over 300 ticks, i.e. ~30 orbits) while
 * still being visibly tighter/faster than the circular case.
 *
 * Method: step at the engine's normal tick rate, recording the player's (x, y)
 * every tick. Track the polar angle around the sun, unwrapped (accumulate the
 * per-tick delta rather than raw atan2, so it climbs monotonically instead of
 * wrapping at +-pi — safe here because a bound orbit has constant-sign angular
 * momentum). Stop once the unwrapped angle reaches 4*pi (two full revolutions).
 * lap1 = points with unwrapped angle in [0, 2*pi); lap2 = [2*pi, 4*pi).
 *
 * For each lap2 point, find its angle mod 2*pi in lap1 and predict its position
 * with a 4-point Lagrange cubic fit through the nearest lap1 points, then compare
 * to the actual lap2 point. The tolerance below is 10x the max error actually
 * measured for each GM (see the console.log in the test) — tight enough to catch
 * a real regression, loose enough to not be a flaky hair-trigger on ordinary
 * floating-point/integration noise.
 */

import { describe, expect, it } from "vitest";
import type { Body, BodyType, World } from "../../src/types.js";
import { NO_INPUT } from "../../src/types.js";
import { simulateTick } from "../../src/physics.js";

// ---------------------------------------------------------------------------
// Test helpers (mirrors self-consistency.test.ts's makeBody/makeWorld)
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

function makeWorld(bodies: Body[], playerIndex: number): World {
  return { bodies, playerIndex, goalIndex: 0, goalRange: 50 };
}

interface TrackPoint {
  angle: number; // unwrapped
  x: number;
  y: number;
}

/** 4-point Lagrange interpolation of `points` (angle, value) at `t`. */
function lagrangeInterp(
  points: readonly { angle: number; value: number }[],
  t: number,
): number {
  let result = 0;
  for (let i = 0; i < points.length; i++) {
    const pi = points[i];
    if (pi === undefined) continue;
    let term = pi.value;
    for (let j = 0; j < points.length; j++) {
      if (j === i) continue;
      const pj = points[j];
      if (pj === undefined) continue;
      term *= (t - pj.angle) / (pi.angle - pj.angle);
    }
    result += term;
  }
  return result;
}

/**
 * Runs a two-body sun/player orbit for GM, records the player's trajectory for
 * two full revolutions, and returns the max Euclidean error between lap2 and a
 * cubic interpolation of lap1 at the same angle.
 */
function measureLapError(GM: number): number {
  const sun = makeBody({ type: "sun", x: 0, y: 0, gravity: GM });
  const player = makeBody({
    type: "player",
    x: 1,
    y: 0,
    xVel: 0,
    yVel: 1,
    gravity: 0,
  });
  const world = makeWorld([sun, player], 1);

  const points: TrackPoint[] = [];
  let prevRaw = Math.atan2(player.y - sun.y, player.x - sun.x);
  let unwrapped = prevRaw;
  points.push({ angle: unwrapped, x: player.x, y: player.y });

  const maxTicks = 200_000; // generous safety cap, well above any GM tested here
  let ticks = 0;
  while (unwrapped < 4 * Math.PI && ticks < maxTicks) {
    simulateTick(world, NO_INPUT, { allowInput: true, firstBoostFired: false });
    ticks++;
    const p = world.bodies[1];
    if (p === undefined) throw new Error("unreachable");
    const raw = Math.atan2(p.y - sun.y, p.x - sun.x);
    let delta = raw - prevRaw;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    unwrapped += delta;
    prevRaw = raw;
    points.push({ angle: unwrapped, x: p.x, y: p.y });
  }
  if (unwrapped < 4 * Math.PI) {
    throw new Error(
      `orbit did not complete 2 revolutions within ${maxTicks} ticks`,
    );
  }

  const lap1 = points.filter((p) => p.angle >= 0 && p.angle < 2 * Math.PI);
  const lap2 = points.filter(
    (p) => p.angle >= 2 * Math.PI && p.angle < 4 * Math.PI,
  );

  // Extend lap1 with a few wrapped points at each end (angle +/- 2*pi) so
  // interpolation near lap1's start/end doesn't need special-casing.
  const wrapLo = lap1
    .slice(-4)
    .map((p) => ({ ...p, angle: p.angle - 2 * Math.PI }));
  const wrapHi = lap1
    .slice(0, 4)
    .map((p) => ({ ...p, angle: p.angle + 2 * Math.PI }));
  const extended = [...wrapLo, ...lap1, ...wrapHi];

  let maxError = 0;
  let j = 0; // extended[j].angle <= effAngle, advanced monotonically
  for (const p2 of lap2) {
    const effAngle = p2.angle - 2 * Math.PI;
    while (
      j + 1 < extended.length - 1 &&
      (extended[j + 1]?.angle ?? Infinity) <= effAngle
    ) {
      j++;
    }
    let lo = j - 1;
    if (lo < 0) lo = 0;
    if (lo + 4 > extended.length) lo = extended.length - 4;
    const four = extended.slice(lo, lo + 4);
    const xPoints = four.map((p) => ({ angle: p.angle, value: p.x }));
    const yPoints = four.map((p) => ({ angle: p.angle, value: p.y }));
    const predX = lagrangeInterp(xPoints, effAngle);
    const predY = lagrangeInterp(yPoints, effAngle);
    const error = Math.hypot(predX - p2.x, predY - p2.y);
    if (error > maxError) maxError = error;
  }

  console.log(
    `orbit-stability GM=${GM}: ticks=${ticks}, lap1=${lap1.length} pts, ` +
      `lap2=${lap2.length} pts, maxError=${maxError.toExponential(4)}`,
  );

  return maxError;
}

// GM > 0.5 required for a bound orbit (E = 0.5 - GM < 0). See the file header for
// why 1.2 stands in for a "tight" third case instead of 2.0. Tolerances are ~10x
// the max error actually measured for each GM (measured: 4.911e-2, 3.089e-2,
// 6.967e-2 respectively — see this test's console.log output).
const CASES: ReadonlyArray<{ GM: number; tolerance: number }> = [
  { GM: 0.6, tolerance: 0.5 },
  { GM: 1.0, tolerance: 0.31 },
  { GM: 1.2, tolerance: 0.7 },
];

describe.each(CASES)("orbit periodicity: GM=$GM", ({ GM, tolerance }) => {
  it(`lap 2 matches a cubic interpolation of lap 1 within ${tolerance}`, () => {
    const maxError = measureLapError(GM);
    expect(maxError).toBeLessThan(tolerance);
  });
});
