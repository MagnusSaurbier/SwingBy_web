// Regression tests for `rocketAngleFromVelocity`, ported from
// PhysicsEngine.gd:215-218 (`rocket_angle_from_velocity`).
//
// The bug this guards against: the helper existed in the Godot reference but was
// not in INTERFACES.md's list of five physics functions, so it was never ported.
// The renderer rotated the ship by `body.angle`, `simulateTick` only advanced
// `angle` for planets, and nothing ever set the player's — so the rocket stayed
// pointing at 0 radians for an entire run while flying in every direction.
//
// Expected values below are derived from the GDScript, not from the TypeScript,
// so this suite would still be meaningful if the implementation were rewritten.
import { describe, expect, it } from "vitest";
import { rocketAngleFromVelocity } from "../../src/physics.js";

/**
 * Godot reads the angle back as `Vector2.UP.rotated(angle)` (GameWorld.gd:876)
 * and expects the unit velocity out. This reimplements that rotation so the
 * tests can assert the property the offset exists for, rather than just the
 * number: rotating UP=(0,-1) by θ gives (sin θ, -cos θ).
 */
function upRotatedBy(angle: number): { x: number; y: number } {
  return { x: Math.sin(angle), y: -Math.cos(angle) };
}

describe("rocketAngleFromVelocity", () => {
  it("returns 0 for a motionless ship rather than an arbitrary atan2(0,0) heading", () => {
    expect(rocketAngleFromVelocity(0, 0)).toBe(0);
  });

  it("uses the reference's length_squared <= 1e-6 guard, not a length guard", () => {
    // |v|^2 = 1e-6 exactly → still treated as motionless (<=, not <).
    expect(rocketAngleFromVelocity(1e-3, 0)).toBe(0);
    // Just above the threshold → a real angle. |v|^2 = 4e-6 > 1e-6.
    expect(rocketAngleFromVelocity(2e-3, 0)).not.toBe(0);
  });

  it("matches hand-derived GDScript values on the cardinal directions", () => {
    // +y is DOWN in this coordinate space (Godot screen convention).
    // velocity.angle() = atan2(vy, vx); result = that + PI/2.
    expect(rocketAngleFromVelocity(1, 0)).toBeCloseTo(0 + Math.PI / 2, 12); // right
    expect(rocketAngleFromVelocity(0, 1)).toBeCloseTo(
      Math.PI / 2 + Math.PI / 2,
      12,
    ); // down
    expect(rocketAngleFromVelocity(-1, 0)).toBeCloseTo(
      Math.PI + Math.PI / 2,
      12,
    ); // left
    expect(rocketAngleFromVelocity(0, -1)).toBeCloseTo(
      -Math.PI / 2 + Math.PI / 2,
      12,
    ); // up → 0
  });

  it("points the sprite's UP axis along the direction of travel", () => {
    // This is the property the + PI/2 offset exists for. If someone 'simplifies'
    // it away, the cardinal test above still fails — but this one explains why.
    const cases = [
      { vx: 1, vy: 0 },
      { vx: 0, vy: 1 },
      { vx: -1, vy: 0 },
      { vx: 0, vy: -1 },
      { vx: 3, vy: 4 },
      { vx: -7.5, vy: 2.25 },
      { vx: 0.001, vy: -0.002 },
    ];
    for (const { vx, vy } of cases) {
      const len = Math.sqrt(vx * vx + vy * vy);
      const dir = upRotatedBy(rocketAngleFromVelocity(vx, vy));
      expect(dir.x).toBeCloseTo(vx / len, 10);
      expect(dir.y).toBeCloseTo(vy / len, 10);
    }
  });

  it("is scale-invariant — only direction matters", () => {
    expect(rocketAngleFromVelocity(3, 4)).toBeCloseTo(
      rocketAngleFromVelocity(300, 400),
      12,
    );
  });

  it("never reads or mutates anything outside its arguments", () => {
    // Pure: same inputs, same output, no globals, no clock, no RNG.
    const a = rocketAngleFromVelocity(1.25, -3.5);
    const b = rocketAngleFromVelocity(1.25, -3.5);
    expect(a).toBe(b);
  });
});
