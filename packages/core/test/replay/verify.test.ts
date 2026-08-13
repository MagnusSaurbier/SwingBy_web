/**
 * T-02 TAPE — `verifyReplay`. This is the trust boundary: assume the tape (and, worst case, the
 * level and the claim riding along with it) are attacker-controlled. Every case here either
 * confirms a genuine result is accepted exactly, or that a specific form of hostility is rejected
 * — never a thrown exception, never an accepted forgery.
 */

import { describe, expect, it } from "vitest";

import { verifyReplay } from "../../src/replay.js";
import type { Level, ReplayTape } from "../../src/types.js";
import { BENCH_LEVEL, benchTape, loadSolvabilityFixtures } from "./fixtures.js";

const fixtures = loadSolvabilityFixtures();

// ---------------------------------------------------------------------------
// 33-tape corpus: genuine tapes accept exactly; an inflated claim on the same genuine tape is
// rejected. This is the end-to-end proof the task doc asks for.
// ---------------------------------------------------------------------------

describe("33 genuine solving tapes vs. the real physics engine", () => {
  it("all 33 fixtures loaded", () => {
    expect(fixtures.length).toBe(33);
  });

  let acceptCount = 0;
  let rejectInflatedCount = 0;

  fixtures.forEach(({ id, level, tape }) => {
    it(`${id}: accepts the genuine tape with zero tick divergence`, () => {
      // Probe with a claim guaranteed to mismatch, purely to read back the ground-truth simulated
      // values (VerifyResult always populates timeMs/boostMs/ticks, ok or not).
      const probe = verifyReplay(level, tape, { timeMs: -1, boostMs: -1 });
      expect(probe.reason, `${id} probe`).not.toBe("malformed");
      expect(probe.reason, `${id} probe should have reached the goal`).not.toBe("no-goal");
      expect(probe.reason, `${id} probe should have stayed in bounds`).not.toBe("out-of-bounds");

      const result = verifyReplay(level, tape, { timeMs: probe.timeMs, boostMs: probe.boostMs });
      expect(result.ok, `${id}: ${JSON.stringify(result)}`).toBe(true);
      expect(result.timeMs).toBe(probe.timeMs);
      expect(result.boostMs).toBe(probe.boostMs);
      acceptCount++;
    });

    it(`${id}: rejects an inflated claim on the same genuine tape`, () => {
      const probe = verifyReplay(level, tape, { timeMs: -1, boostMs: -1 });
      const inflated = verifyReplay(level, tape, {
        timeMs: probe.timeMs + 500,
        boostMs: probe.boostMs,
      });
      expect(inflated.ok, `${id}: inflated claim should have been rejected`).toBe(false);
      expect(inflated.reason).toBe("time-mismatch");
      rejectInflatedCount++;
    });
  });

  it("summary: 33/33 accepted genuinely, 33/33 rejected when inflated", () => {
    expect(acceptCount).toBe(33);
    expect(rejectInflatedCount).toBe(33);
    console.log(`33-tape corpus: ${acceptCount}/33 genuine accepts, ${rejectInflatedCount}/33 inflated-claim rejects`);
  });
});

// ---------------------------------------------------------------------------
// Tamper test (tasks/T-02-TAPE.md "How to verify"): flip one transition index by +1 on a passing
// tape and confirm it fails. Done once as the literal demonstration (builtin-00, which has real
// transitions to flip), then as a uniform "ticks - 1" tamper across all 33 tapes — every
// solvability tape is tight by construction (T-03: `ticks = reachedTick + 1`), so shaving the last
// tick off any of them should reliably miss the goal regardless of whether that tape has any
// transitions to flip (11 of the 33 are pure zero-input coasts with nothing to flip at all).
// ---------------------------------------------------------------------------

describe("tamper: a single-tick edit to a passing tape breaks verification", () => {
  it("literal demonstration: builtin-00, flip brake[1] from 50 to 51", () => {
    const fixture = fixtures.find((f) => f.id === "builtin-00");
    if (!fixture) throw new Error("builtin-00 fixture missing");
    const { level, tape } = fixture;
    expect(tape.brake).toEqual([0, 50]);

    const probe = verifyReplay(level, tape, { timeMs: -1, boostMs: -1 });
    expect(probe.reason).not.toBe("malformed");

    const tampered: ReplayTape = { ...tape, brake: [0, 51] };
    const tamperedResult = verifyReplay(level, tampered, {
      timeMs: probe.timeMs,
      boostMs: probe.boostMs,
    });
    expect(tamperedResult.ok, `tampered result: ${JSON.stringify(tamperedResult)}`).toBe(false);
    console.log(
      `tamper demo: builtin-00 brake[1] 50->51 => ok=${tamperedResult.ok} reason=${tamperedResult.reason} ` +
        `(genuine timeMs=${probe.timeMs}, tampered timeMs=${tamperedResult.timeMs})`,
    );
  });

  it("broad sweep: shaving the last tick off all 33 tight tapes breaks every one of them", () => {
    let brokenCount = 0;
    for (const { id, level, tape } of fixtures) {
      const probe = verifyReplay(level, tape, { timeMs: -1, boostMs: -1 });
      const shaved: ReplayTape = { ...tape, ticks: tape.ticks - 1 };
      const shavedResult = verifyReplay(level, shaved, {
        timeMs: probe.timeMs,
        boostMs: probe.boostMs,
      });
      if (!shavedResult.ok) brokenCount++;
      else console.warn(`${id}: shaving the last tick did NOT break verification (unexpected slack)`);
    }
    expect(brokenCount, "all 33 tight tapes should break when their last tick is removed").toBe(33);
    console.log(`tamper sweep: ${brokenCount}/33 tight tapes broken by removing their last tick`);
  });
});

// ---------------------------------------------------------------------------
// Rejection rules — malformed, checked before any simulation (tasks/T-02-TAPE.md).
// ---------------------------------------------------------------------------

const anyLevel: Level = fixtures[0]!.level;

interface MalformedCase {
  name: string;
  tape: unknown;
}

const malformedCases: MalformedCase[] = [
  { name: "ticks over the 10-minute cap (144*600 + 1)", tape: { ticks: 144 * 600 + 1, boost: [], brake: [] } },
  { name: "ticks negative", tape: { ticks: -1, boost: [], brake: [] } },
  { name: "ticks non-integer", tape: { ticks: 12.5, boost: [], brake: [] } },
  { name: "ticks NaN", tape: { ticks: Number.NaN, boost: [], brake: [] } },
  { name: "ticks Infinity", tape: { ticks: Number.POSITIVE_INFINITY, boost: [], brake: [] } },
  { name: "ticks -Infinity", tape: { ticks: Number.NEGATIVE_INFINITY, boost: [], brake: [] } },
  { name: "ticks missing entirely", tape: { boost: [], brake: [] } },
  { name: "ticks wrong type (string)", tape: { ticks: "100", boost: [], brake: [] } },
  { name: "boost not an array (string)", tape: { ticks: 100, boost: "nope", brake: [] } },
  { name: "boost not an array (object)", tape: { ticks: 100, boost: { 0: 5 }, brake: [] } },
  { name: "brake not an array (null)", tape: { ticks: 100, boost: [], brake: null } },
  { name: "more than 2000 total transitions", tape: makeOversizedTransitionsTape() },
  { name: "boost not strictly increasing (duplicate index)", tape: { ticks: 100, boost: [5, 5, 10], brake: [] } },
  { name: "boost not strictly increasing (decreasing)", tape: { ticks: 100, boost: [10, 5], brake: [] } },
  { name: "brake index negative", tape: { ticks: 100, boost: [], brake: [-1] } },
  { name: "boost index equals ticks (out of range, >= ticks)", tape: { ticks: 100, boost: [100], brake: [] } },
  { name: "boost index far beyond ticks", tape: { ticks: 100, boost: [99999], brake: [] } },
  { name: "boost index non-integer", tape: { ticks: 100, boost: [5.5], brake: [] } },
  { name: "boost index NaN", tape: { ticks: 100, boost: [Number.NaN], brake: [] } },
  { name: "boost index Infinity", tape: { ticks: 100, boost: [Number.POSITIVE_INFINITY], brake: [] } },
  { name: "boost element is an object (deeply nested junk)", tape: { ticks: 100, boost: [{ nested: { junk: true } }], brake: [] } },
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
      const result = verifyReplay(anyLevel, tape as ReplayTape, { timeMs: 0, boostMs: 0 });
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
    const result = verifyReplay(anyLevel, tape as ReplayTape, { timeMs: 0, boostMs: 0 });
    const elapsedMs = performance.now() - start;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed");
    expect(elapsedMs).toBeLessThan(50);
    console.log(`gigantic-array rejection: 200,000-element array rejected in ${elapsedMs.toFixed(3)}ms`);
  });

  it("rejects an absurdly large ticks value fast, without attempting to simulate it", () => {
    const tape = { ticks: Number.MAX_SAFE_INTEGER, boost: [], brake: [] };
    const start = performance.now();
    const result = verifyReplay(anyLevel, tape as ReplayTape, { timeMs: 0, boostMs: 0 });
    const elapsedMs = performance.now() - start;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed");
    expect(elapsedMs).toBeLessThan(10);
  });

  it("ticks exactly AT the cap (144*600) is not itself malformed", () => {
    // Use a level/tape pair that reaches its goal almost immediately regardless of the declared
    // ceiling (a coasting builtin tape), so this stays a cheap test rather than actually
    // simulating 86,400 ticks — the point is only that the boundary value passes the shape check.
    const fixture = fixtures.find((f) => f.tape.boost.length === 0 && f.tape.brake.length === 0);
    if (!fixture) throw new Error("expected at least one zero-input fixture");
    const atCap: ReplayTape = { ...fixture.tape, ticks: 144 * 600 };
    const result = verifyReplay(fixture.level, atCap, { timeMs: 0, boostMs: 0 });
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
    expect(() => verifyReplay(badLevel, tape, { timeMs: 0, boostMs: 0 })).not.toThrow();
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
  const fixture = fixtures[0]!;

  it("NaN claim.timeMs is rejected, not silently accepted", () => {
    const result = verifyReplay(fixture.level, fixture.tape, { timeMs: Number.NaN, boostMs: 0 });
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
    const probe = verifyReplay(fixture.level, fixture.tape, { timeMs: -1, boostMs: -1 });
    const result = verifyReplay(fixture.level, fixture.tape, {
      timeMs: probe.timeMs,
      boostMs: Number.NaN,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("boost-mismatch");
  });

  it("a claim object missing fields entirely does not throw", () => {
    expect(() =>
      verifyReplay(fixture.level, fixture.tape, {} as unknown as { timeMs: number; boostMs: number }),
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
      verifyReplay(fixture.level, fixture.tape, null as unknown as { timeMs: number; boostMs: number }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tolerance parameter — default is strict (0), but loosening it is supported (task doc: "make
// tolerance a parameter so it can be loosened if reality disagrees, but ship it at zero").
// ---------------------------------------------------------------------------

describe("tolerance parameter", () => {
  const fixture = fixtures[0]!;

  it("default tolerance is zero: a 1ms-off claim is rejected", () => {
    const probe = verifyReplay(fixture.level, fixture.tape, { timeMs: -1, boostMs: -1 });
    const result = verifyReplay(fixture.level, fixture.tape, {
      timeMs: probe.timeMs + 1,
      boostMs: probe.boostMs,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("time-mismatch");
  });

  it("an explicit tolerance accepts a claim within it", () => {
    const probe = verifyReplay(fixture.level, fixture.tape, { timeMs: -1, boostMs: -1 });
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
    console.log(`60s-tape verifyReplay: ${elapsedMs.toFixed(3)}ms (budget: 100ms)`);
    expect(elapsedMs).toBeLessThan(100);
  });
});
