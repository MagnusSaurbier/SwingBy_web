/**
 * T-02 TAPE — `verifyReplay`. This is the trust boundary: assume the tape (and, worst case, the
 * level and the claim riding along with it) are attacker-controlled. Every case here either
 * confirms a genuine result is accepted exactly, or that a specific form of hostility is rejected
 * — never a thrown exception, never an accepted forgery.
 *
 * The end-to-end proof against the 33 real built-in levels (genuine tapes accept exactly, a
 * tamper/inflated claim on the same tape is rejected) was removed on
 * feat/remove-gravity-softening: those tapes were recorded and solved under the old softened
 * gravity, and physics.ts now implements pure inverse-square gravity (owner-directed), so the
 * tapes no longer reach their levels' goals and hardcode a trajectory that no longer exists.
 * Re-verify solvability of the built-in levels separately (new tapes, or manual play) rather than
 * loosening or faking this suite. Everything below uses synthetic levels/tapes that do not depend
 * on any specific physics trajectory.
 */

import { describe, expect, it } from "vitest";

import { verifyReplay } from "../../src/replay.js";
import type { Level, ReplayTape } from "../../src/types.js";
import { BENCH_LEVEL, benchTape } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Rejection rules — malformed, checked before any simulation (tasks/T-02-TAPE.md).
// ---------------------------------------------------------------------------

const anyLevel: Level = BENCH_LEVEL;

/** A synthetic level whose goal is satisfied at (or immediately after) tick 0 regardless of
 *  input, for tests that need "some real level + tape pair" without depending on any specific,
 *  hand-solved trajectory. */
const instantGoalLevel: Level = {
  name: "T-02 instant-goal fixture (synthetic, not a real level)",
  author: "T-02 TAPE",
  goal: { index: 1, range: 1000 },
  objects: [
    { type: "player", x: 0, y: 0, x_vel: 0, y_vel: 0, gravity: 0 },
    { type: "sun", x: 0, y: 0, gravity: 50, visible: true, size: 5 },
  ],
};

interface MalformedCase {
  name: string;
  tape: unknown;
}

const malformedCases: MalformedCase[] = [
  {
    name: "ticks over the 10-minute cap (144*600 + 1)",
    tape: { ticks: 144 * 600 + 1, boost: [], brake: [] },
  },
  { name: "ticks negative", tape: { ticks: -1, boost: [], brake: [] } },
  { name: "ticks non-integer", tape: { ticks: 12.5, boost: [], brake: [] } },
  { name: "ticks NaN", tape: { ticks: Number.NaN, boost: [], brake: [] } },
  {
    name: "ticks Infinity",
    tape: { ticks: Number.POSITIVE_INFINITY, boost: [], brake: [] },
  },
  {
    name: "ticks -Infinity",
    tape: { ticks: Number.NEGATIVE_INFINITY, boost: [], brake: [] },
  },
  { name: "ticks missing entirely", tape: { boost: [], brake: [] } },
  {
    name: "ticks wrong type (string)",
    tape: { ticks: "100", boost: [], brake: [] },
  },
  {
    name: "boost not an array (string)",
    tape: { ticks: 100, boost: "nope", brake: [] },
  },
  {
    name: "boost not an array (object)",
    tape: { ticks: 100, boost: { 0: 5 }, brake: [] },
  },
  {
    name: "brake not an array (null)",
    tape: { ticks: 100, boost: [], brake: null },
  },
  {
    name: "more than 2000 total transitions",
    tape: makeOversizedTransitionsTape(),
  },
  {
    name: "boost not strictly increasing (duplicate index)",
    tape: { ticks: 100, boost: [5, 5, 10], brake: [] },
  },
  {
    name: "boost not strictly increasing (decreasing)",
    tape: { ticks: 100, boost: [10, 5], brake: [] },
  },
  {
    name: "brake index negative",
    tape: { ticks: 100, boost: [], brake: [-1] },
  },
  {
    name: "boost index equals ticks (out of range, >= ticks)",
    tape: { ticks: 100, boost: [100], brake: [] },
  },
  {
    name: "boost index far beyond ticks",
    tape: { ticks: 100, boost: [99999], brake: [] },
  },
  {
    name: "boost index non-integer",
    tape: { ticks: 100, boost: [5.5], brake: [] },
  },
  {
    name: "boost index NaN",
    tape: { ticks: 100, boost: [Number.NaN], brake: [] },
  },
  {
    name: "boost index Infinity",
    tape: { ticks: 100, boost: [Number.POSITIVE_INFINITY], brake: [] },
  },
  {
    name: "boost element is an object (deeply nested junk)",
    tape: { ticks: 100, boost: [{ nested: { junk: true } }], brake: [] },
  },
  { name: "tape is null", tape: null },
  { name: "tape is undefined", tape: undefined },
  { name: "tape is a string", tape: "not a tape" },
  { name: "tape is a number", tape: 42 },
  { name: "tape is an array", tape: [1, 2, 3] },
];

function makeOversizedTransitionsTape(): ReplayTape {
  const boost = Array.from({ length: 1001 }, (_, i) => i * 2);
  const brake = Array.from({ length: 1000 }, (_, i) => i * 2 + 1);
  return { ticks: 4000, boost, brake };
}

describe("verifyReplay rejects malformed tapes without simulating", () => {
  malformedCases.forEach(({ name, tape }) => {
    it(name, () => {
      const result = verifyReplay(anyLevel, tape as ReplayTape, {
        timeMs: 0,
        boostMs: 0,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("malformed");
      expect(result.ticks).toBe(0);
    });
  });

  it(`exercised all ${malformedCases.length} rejection-rule cases`, () => {
    expect(malformedCases.length).toBeGreaterThanOrEqual(10);
  });

  it("rejects a gigantic transitions array FAST (length check, not a scan) — proves the guard is O(1)-ish", () => {
    const huge = Array.from({ length: 200_000 }, (_, i) => i);
    const tape = { ticks: 200_001, boost: huge, brake: [] };
    const start = performance.now();
    const result = verifyReplay(anyLevel, tape as ReplayTape, {
      timeMs: 0,
      boostMs: 0,
    });
    const elapsedMs = performance.now() - start;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed");
    expect(elapsedMs).toBeLessThan(50);
    console.log(
      `gigantic-array rejection: 200,000-element array rejected in ${elapsedMs.toFixed(3)}ms`,
    );
  });

  it("rejects an absurdly large ticks value fast, without attempting to simulate it", () => {
    const tape = { ticks: Number.MAX_SAFE_INTEGER, boost: [], brake: [] };
    const start = performance.now();
    const result = verifyReplay(anyLevel, tape as ReplayTape, {
      timeMs: 0,
      boostMs: 0,
    });
    const elapsedMs = performance.now() - start;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed");
    expect(elapsedMs).toBeLessThan(10);
  });

  it("ticks exactly AT the cap (144*600) is not itself malformed", () => {
    // instantGoalLevel reaches its goal at tick 0 regardless of the declared ceiling, so this
    // stays a cheap test rather than actually simulating 86,400 ticks — the point is only that
    // the boundary value passes the shape check.
    const atCap: ReplayTape = { ticks: 144 * 600, boost: [], brake: [] };
    const result = verifyReplay(instantGoalLevel, atCap, {
      timeMs: 0,
      boostMs: 0,
    });
    expect(result.reason).not.toBe("malformed");
  });

  it("exactly 2000 total transitions is not itself malformed", () => {
    const boost = Array.from({ length: 1000 }, (_, i) => i * 3);
    const brake = Array.from({ length: 1000 }, (_, i) => i * 3 + 1);
    const tape: ReplayTape = { ticks: 3000, boost, brake };
    const result = verifyReplay(BENCH_LEVEL, tape, { timeMs: 0, boostMs: 0 });
    expect(result.reason).not.toBe("malformed");
  });

  it("a malformed level (fails hydrate/validate) degrades to malformed, does not throw", () => {
    const badLevel = {
      name: "no player",
      author: "hostile",
      goal: { index: 0, range: 10 },
      objects: [{ type: "sun", x: 0, y: 0, gravity: 100 }],
    } as unknown as Level;
    const tape: ReplayTape = { ticks: 10, boost: [], brake: [] };
    expect(() =>
      verifyReplay(badLevel, tape, { timeMs: 0, boostMs: 0 }),
    ).not.toThrow();
    const result = verifyReplay(badLevel, tape, { timeMs: 0, boostMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed");
  });
});

// ---------------------------------------------------------------------------
// Claim hardening — NaN/Infinity/missing claim fields must never silently pass (NaN comparisons
// are always false in JS, which is the exact trap: an unguarded `Math.abs(x - NaN) > 0` is
// `false`, i.e. "within tolerance", i.e. an accepted forgery, unless explicitly guarded).
// ---------------------------------------------------------------------------

describe("hostile claim values never silently pass", () => {
  const fixture = {
    level: instantGoalLevel,
    tape: { ticks: 1, boost: [], brake: [] } as ReplayTape,
  };

  it("NaN claim.timeMs is rejected, not silently accepted", () => {
    const result = verifyReplay(fixture.level, fixture.tape, {
      timeMs: Number.NaN,
      boostMs: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("time-mismatch");
  });

  it("Infinity claim.timeMs is rejected", () => {
    const result = verifyReplay(fixture.level, fixture.tape, {
      timeMs: Number.POSITIVE_INFINITY,
      boostMs: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("time-mismatch");
  });

  it("NaN claim.boostMs is rejected once timeMs matches", () => {
    const probe = verifyReplay(fixture.level, fixture.tape, {
      timeMs: -1,
      boostMs: -1,
    });
    const result = verifyReplay(fixture.level, fixture.tape, {
      timeMs: probe.timeMs,
      boostMs: Number.NaN,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("boost-mismatch");
  });

  it("a claim object missing fields entirely does not throw", () => {
    expect(() =>
      verifyReplay(
        fixture.level,
        fixture.tape,
        {} as unknown as { timeMs: number; boostMs: number },
      ),
    ).not.toThrow();
    const result = verifyReplay(
      fixture.level,
      fixture.tape,
      {} as unknown as { timeMs: number; boostMs: number },
    );
    expect(result.ok).toBe(false);
  });

  it("a null claim does not throw", () => {
    expect(() =>
      verifyReplay(
        fixture.level,
        fixture.tape,
        null as unknown as { timeMs: number; boostMs: number },
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tolerance parameter — default is strict (0), but loosening it is supported (task doc: "make
// tolerance a parameter so it can be loosened if reality disagrees, but ship it at zero").
// ---------------------------------------------------------------------------

describe("tolerance parameter", () => {
  const fixture = {
    level: instantGoalLevel,
    tape: { ticks: 1, boost: [], brake: [] } as ReplayTape,
  };

  it("default tolerance is zero: a 1ms-off claim is rejected", () => {
    const probe = verifyReplay(fixture.level, fixture.tape, {
      timeMs: -1,
      boostMs: -1,
    });
    const result = verifyReplay(fixture.level, fixture.tape, {
      timeMs: probe.timeMs + 1,
      boostMs: probe.boostMs,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("time-mismatch");
  });

  it("an explicit tolerance accepts a claim within it", () => {
    const probe = verifyReplay(fixture.level, fixture.tape, {
      timeMs: -1,
      boostMs: -1,
    });
    const result = verifyReplay(
      fixture.level,
      fixture.tape,
      { timeMs: probe.timeMs + 1, boostMs: probe.boostMs },
      { timeMs: 1 },
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// out-of-bounds / no-goal — the two non-malformed failure reasons besides mismatches.
// ---------------------------------------------------------------------------

describe("out-of-bounds and no-goal", () => {
  it("a player launched straight out of MAX_WORLD_BOUNDS is rejected with out-of-bounds", () => {
    const level: Level = {
      name: "T-02 out-of-bounds fixture (synthetic)",
      author: "T-02 TAPE",
      goal: { index: 2, range: 10 },
      objects: [
        { type: "player", x: 0, y: 0, x_vel: 100000, y_vel: 0, gravity: 0 },
        { type: "sun", x: 0, y: 0, gravity: 1, visible: true, size: 10 },
        { type: "sun", x: 100, y: 100, gravity: 0, visible: true, size: 5 },
      ],
    };
    const tape: ReplayTape = { ticks: 10, boost: [], brake: [] };
    const result = verifyReplay(level, tape, { timeMs: 0, boostMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("out-of-bounds");
  });

  it("a tape that never reaches the goal within its own horizon is rejected with no-goal", () => {
    const tape: ReplayTape = { ticks: 500, boost: [], brake: [] };
    const result = verifyReplay(BENCH_LEVEL, tape, { timeMs: 0, boostMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-goal");
    expect(result.ticks).toBe(500);
  });
});

describe("braking contributes to the efficiency metric", () => {
  it("counts ticks held only for braking", () => {
    // A synthetic level that takes well over 50 ticks to reach goal, so holding brake for exactly
    // the first 50 ticks (released at tick 50) leaves plenty of run left for the goal to actually
    // be reached, and the 50-tick hold is never truncated by an early capture.
    const brakeMetricLevel: Level = {
      name: "T-02 brake-metric fixture (synthetic)",
      author: "T-02 TAPE",
      goal: { index: 1, range: 15 },
      objects: [
        { type: "player", x: -1000, y: 0, x_vel: 5, y_vel: 0, gravity: 0 },
        { type: "sun", x: 0, y: 0, gravity: 50, visible: true, size: 5 },
      ],
    };
    const tape: ReplayTape = { ticks: 2000, boost: [], brake: [0, 50] };

    const result = verifyReplay(brakeMetricLevel, tape, {
      timeMs: -1,
      boostMs: -1,
    });

    expect(result.reason).not.toBe("malformed");
    expect(result.reason).not.toBe("no-goal");
    expect(result.boostMs).toBe(Math.round((50 * 1000) / 144));
  });

  it("counts overlapping boost and brake ticks once", () => {
    const tape: ReplayTape = {
      ticks: 3,
      boost: [0, 1],
      brake: [0, 2],
    };
    const result = verifyReplay(BENCH_LEVEL, tape, {
      timeMs: 0,
      boostMs: 0,
    });

    expect(result.reason).toBe("no-goal");
    expect(result.boostMs).toBe(Math.round((2 * 1000) / 144));
    expect(result.boostMs).toBeLessThanOrEqual(result.timeMs);
  });
});

// ---------------------------------------------------------------------------
// Performance regression guard — task doc DoD: "A 60-second tape verifies in < 100 ms in node".
// The full numeric report (this number plus the O(log n) growth evidence) is measured separately
// in test/replay/bench.ts per tasks/T-02-TAPE.md "How to verify"; this is a lighter pass/fail
// guard so a regression is caught on every `npm test` run, not just when someone remembers to run
// the bench script by hand.
// ---------------------------------------------------------------------------

describe("performance: 60-second tape verification budget", () => {
  it("verifies an 8,640-tick (60s) worst-case tape in under 100ms", () => {
    const tape = benchTape();
    const start = performance.now();
    const result = verifyReplay(BENCH_LEVEL, tape, { timeMs: 0, boostMs: 0 });
    const elapsedMs = performance.now() - start;
    expect(result.reason).toBe("no-goal"); // by construction, BENCH_LEVEL never reaches goal
    expect(result.ticks).toBe(tape.ticks); // proves the full tape was actually simulated
    console.log(
      `60s-tape verifyReplay: ${elapsedMs.toFixed(3)}ms (budget: 100ms)`,
    );
    expect(elapsedMs).toBeLessThan(100);
  });
});
