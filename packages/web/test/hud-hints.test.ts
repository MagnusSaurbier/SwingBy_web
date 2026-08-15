import { describe, expect, it } from "vitest";
import { BUILTIN_LEVELS, TPS } from "@swingby/core";
import {
  evaluateHint,
  hintRulesForLevel,
  type HintContext,
} from "../src/hud/hints.js";

function ctx(overrides: Partial<HintContext> = {}): HintContext {
  return {
    status: "playing",
    elapsedTicks: 0,
    boostTicks: 0,
    boundsWarning: 0,
    reachedGoal: false,
    ...overrides,
  };
}

describe("evaluateHint", () => {
  const rules = hintRulesForLevel(BUILTIN_LEVELS[0]!);

  it("returns null while not playing (paused/resetting/complete) regardless of other fields", () => {
    for (const status of ["paused", "resetting", "complete"] as const) {
      expect(evaluateHint(rules, ctx({ status, boundsWarning: 0.9 }))).toBeNull();
    }
  });

  it("nearBounds wins over everything else once boundsWarning exceeds 0.3", () => {
    const text = evaluateHint(
      rules,
      ctx({ boundsWarning: 0.31, boostTicks: 0, elapsedTicks: 10_000 }),
    );
    expect(text).toMatch(/too far/i);
  });

  it("boundsWarning at exactly 0.3 does NOT trigger nearBounds (strictly greater-than, matches GameWorld.gd:944)", () => {
    const text = evaluateHint(rules, ctx({ boundsWarning: 0.3 }));
    expect(text).not.toMatch(/too far/i);
  });

  it("notBoosted fires once past the grace period with zero boost ticks, below the bounds threshold", () => {
    const grace = TPS * 2;
    expect(evaluateHint(rules, ctx({ elapsedTicks: grace }))).not.toMatch(/hold boost/i);
    const text = evaluateHint(rules, ctx({ elapsedTicks: grace + 1 }));
    expect(text).toMatch(/hold boost/i);
  });

  it("falls through to the level's default hint once boosted and away from bounds", () => {
    const text = evaluateHint(
      rules,
      ctx({ elapsedTicks: TPS * 10, boostTicks: 50, boundsWarning: 0 }),
    );
    expect(text).toBe("Press Boost to accelerate into the blue planet's orbit.");
  });

  it("every built-in level resolves to a non-empty default hint text (generic fallback for unnamed levels)", () => {
    for (const level of BUILTIN_LEVELS) {
      const r = hintRulesForLevel(level);
      const text = evaluateHint(r, ctx({ elapsedTicks: TPS * 10, boostTicks: 50 }));
      expect(typeof text).toBe("string");
      expect(text!.length).toBeGreaterThan(0);
    }
  });

  it("nearGoal is a supported condition in the schema but can never win a match today (no goal-distance field on GameSnapshot)", () => {
    const withNearGoal = [
      ...rules,
      { condition: "nearGoal" as const, text: "SHOULD NEVER APPEAR" },
    ];
    const text = evaluateHint(withNearGoal, ctx({ elapsedTicks: TPS * 10, boostTicks: 50 }));
    expect(text).not.toBe("SHOULD NEVER APPEAR");
  });
});
