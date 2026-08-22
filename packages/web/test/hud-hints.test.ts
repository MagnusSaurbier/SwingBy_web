import { describe, expect, it } from "vitest";
import { BUILTIN_LEVELS } from "@swingby/core";
import { evaluateHint } from "../src/hud/hints.js";

describe("evaluateHint", () => {
  it("returns null while not playing (paused/resetting/complete), regardless of the level's hint", () => {
    const level = BUILTIN_LEVELS[0]!;
    for (const status of ["paused", "resetting", "complete"] as const) {
      expect(evaluateHint(level, status)).toBeNull();
    }
  });

  it("returns the level's authored hint, trimmed, while playing", () => {
    const level = { ...BUILTIN_LEVELS[0]!, hint: "  Author-written tip.  " };
    expect(evaluateHint(level, "playing")).toBe("Author-written tip.");
  });

  it("returns null while playing when the level has no hint set", () => {
    const level = { ...BUILTIN_LEVELS[0]! };
    delete level.hint;
    expect(evaluateHint(level, "playing")).toBeNull();
  });

  it("returns null while playing when the level's hint is blank", () => {
    const level = { ...BUILTIN_LEVELS[0]!, hint: "   " };
    expect(evaluateHint(level, "playing")).toBeNull();
  });

  it("every built-in level ships a non-empty hint", () => {
    for (const level of BUILTIN_LEVELS) {
      const text = evaluateHint(level, "playing");
      expect(typeof text).toBe("string");
      expect(text!.length).toBeGreaterThan(0);
    }
  });
});
