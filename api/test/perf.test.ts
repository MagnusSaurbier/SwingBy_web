/**
 * Measured verification timing through the REAL route path (`handleScore`), not just
 * `verifyReplay` in isolation (already measured in isolation — see notes/archive/T-02-TAPE/log.md
 * and notes/archive/T-02-TAPE/results.md — this file measures it as the real route calls it:
 * parse -> validate -> resolveLevel -> verifyReplay -> rank -> insert, against the in-memory
 * FakeDb). Numbers are `console.log`ged (not just asserted against a budget) — per docs/GAME.md
 * §6's definition of done, anything measured is reported as a number, not an adjective.
 *
 * `PERF_LEVEL` below is its own unreachable-goal fixture (not importing
 * `packages/core/test/replay/fixtures.ts` — that's a test-internal fixture, not part of
 * `@swingby/core`'s public surface, so importing it here would be reaching across package-test
 * boundaries). A worst-case tape must never reach the goal or leave bounds early — either would
 * let `verifyReplay` exit before simulating the full tape, understating the cost — so the goal
 * here is placed far from a motionless player that a comically distant, deliberately negligible
 * gravity source can't meaningfully perturb across even the full 10-minute cap.
 */

import { describe, expect, it } from "vitest";

import type { Level, ReplayTape } from "@swingby/core";
import { MAX_TAPE_TICKS } from "@swingby/core";

import { handleScore } from "../score.js";
import { FakeDb } from "./support/fake-db.js";

const PERF_LEVEL: Level = {
  name: "perf-bench-unreachable",
  author: "T-12",
  goal: { index: 2, range: 1 },
  objects: [
    // Motionless: net force from the sun below is ~2e-12 units/tick^2 (see comment below) —
    // integrated over even the full 86,400-tick cap, displacement stays well under 1 unit, so the
    // player never leaves MAX_WORLD_BOUNDS (2600 x 1800) and never drifts near the goal.
    { type: "player", x: 0, y: 0, gravity: 0 },
    // Satisfies validate()'s "at least one body with gravity > 0" without perturbing the player:
    // at ~7.07e6 distance, gravity=100 produces a genuinely negligible acceleration (falls off
    // faster than linearly with distance in the softened-inverse-square force law physics.ts uses).
    { type: "sun", x: 5_000_000, y: 5_000_000, gravity: 100 },
    // The goal target: stationary, far from the player, well within bounds itself, but the player
    // never moves far enough from (0,0) to enter its 1-unit capture radius within any tape length
    // this suite ever constructs.
    { type: "planet", x: 2000, y: 1000, gravity: 0, anchored: true },
  ],
};

/**
 * Distributes `pulseCount` brief (1-tick) boost pulses evenly across the tape, spaced well apart.
 *
 * First attempt at this (kept in git history, not here) alternated boost on/off at `transitionCount`
 * evenly-spaced points — which holds boost for roughly HALF the tape's ticks in long stretches, not
 * brief pulses. Since boost adds a fixed ~`BOOST_STRENGTH` (0.005) to speed every tick it's held
 * (from physics.ts's rescale formula — with the player starting at rest, "when speed === 0, boost
 * adds `step` to `xVel` only" per INTERFACES.md's physics notes, and then keeps adding per tick
 * thereafter), holding it for ~half of an 8,640-tick tape reaches a speed high enough to cross
 * MAX_WORLD_BOUNDS_X (2600) well before the tape ends — confirmed empirically (this benchmark
 * failed its own "never reaches goal, never leaves bounds" sanity check with `reason:
 * "out-of-bounds"` on the very first attempt). Once boost ends, nothing decelerates the player
 * (brake is what does that, and this tape never uses it) — released speed persists at whatever it
 * reached, forever, so total ACCUMULATED held-time (not how it's distributed) is what determines
 * final drift speed and therefore total displacement across the remainder of the tape.
 *
 * Fix: cap total held-time at a handful of ticks regardless of `pulseCount`, so the worst-case
 * ordering (every pulse concentrated at the very start) still keeps total displacement comfortably
 * under 2600 units even across the full 86,400-tick cap: `pulseCount` capped at 4 -> final speed
 * <= 4 * 0.005 = 0.02 units/tick -> displacement <= 0.02 * 86400 = 1728 units, safely under bounds.
 * This means transition DENSITY here is deliberately low — that's fine, `inputAtTick`'s O(log n)
 * behavior across up to 2000 real transitions is already proven with real numbers in
 * notes/archive/T-02-TAPE/log.md and notes/archive/T-02-TAPE/results.md; this file's job is
 * measuring the ADDITIONAL
 * route-level cost (resolveLevel + rank + insert) on top of `verifyReplay`, not re-deriving that.
 */
function benchTape(ticks: number, pulseCount: number): ReplayTape {
  const safePulseCount = Math.min(pulseCount, 4);
  const boost: number[] = [];
  const step = Math.max(2, Math.floor(ticks / (safePulseCount + 1)));
  for (let i = 0; i < safePulseCount; i++) {
    const start = (i + 1) * step;
    if (start + 1 >= ticks) break;
    boost.push(start, start + 1); // held for exactly one tick, then released
  }
  return { ticks, boost, brake: [] };
}

function nowMs(): number {
  return performance.now();
}

interface Timing {
  runs: number;
  minMs: number;
  avgMs: number;
  maxMs: number;
}

describe("verifyReplay timing through the real route path (handleScore)", () => {
  it("resolves PERFBENCH1 via a custom-level row (so the timing loop measures the SAME resolveLevel path a real custom-level score would take)", async () => {
    const db = new FakeDb();
    db.customLevelRows.push({
      id: "PERFBENCH1",
      name: "perf",
      author: "t12",
      data: PERF_LEVEL,
      plays: 0,
      created_at: new Date().toISOString(),
    });
    const { body } = await handleScore(
      {
        levelId: "PERFBENCH1",
        metric: "fastest",
        timeMs: 0,
        boostMs: 0,
        name: "sanity",
        tape: { ticks: 10, boost: [], brake: [] },
      },
      { sql: db.query },
    );
    expect(body.reason).toBe("no-goal"); // confirms the fixture behaves as designed before benchmarking
  });

  it("measures a 60s (8,640-tick) worst-case submission — task's own stated budget: < 100ms", async () => {
    const ticks = 8640;
    const tape = benchTape(ticks, 4); // capped for safety — see benchTape's doc comment

    const timing = await measureWithLevel(tape);

    // eslint-disable-next-line no-console
    console.log(
      `handleScore, 60s/8640-tick worst case (never reaches goal, full tape always simulated): ` +
        `runs=${timing.runs} min=${timing.minMs.toFixed(3)}ms avg=${timing.avgMs.toFixed(3)}ms max=${timing.maxMs.toFixed(3)}ms ` +
        `(budget < 100ms: ${timing.maxMs < 100 ? "PASS" : "FAIL"})`,
    );
    expect(timing.maxMs).toBeLessThan(100);
  });

  it("measures the full 10-minute (86,400-tick, MAX_TAPE_TICKS) cap — the actual worst case this route will ever simulate", async () => {
    expect(MAX_TAPE_TICKS).toBe(86400);
    const tape = benchTape(MAX_TAPE_TICKS, 4); // capped for safety — see benchTape's doc comment

    const timing = await measureWithLevel(tape, 3); // fewer runs — this one is much slower per run

    // eslint-disable-next-line no-console
    console.log(
      `handleScore, full 10-minute/86400-tick cap (MAX_TAPE_TICKS, never reaches goal): ` +
        `runs=${timing.runs} min=${timing.minMs.toFixed(3)}ms avg=${timing.avgMs.toFixed(3)}ms max=${timing.maxMs.toFixed(3)}ms`,
    );
    // No hard budget asserted here — the stated <100ms figure is specifically for a 60s tape
    // (notes/archive/T-12-LEDGER/task.md "How to verify" §5); this is ~10x the tick count,
    // reported as a number for Magnus to judge, not silently held to the smaller tape's budget.
  });
});

async function measureWithLevel(tape: ReplayTape, runs = 5): Promise<Timing> {
  const timesMs: number[] = [];
  for (let i = 0; i < runs; i++) {
    const db = new FakeDb();
    db.customLevelRows.push({
      id: "PERFBENCH1",
      name: "perf",
      author: "t12",
      data: PERF_LEVEL,
      plays: 0,
      created_at: new Date().toISOString(),
    });
    const start = nowMs();
    const { body } = await handleScore(
      {
        levelId: "PERFBENCH1",
        metric: "fastest",
        timeMs: 0,
        boostMs: 0,
        name: "bench",
        tape,
      },
      { sql: db.query },
    );
    const elapsed = nowMs() - start;
    timesMs.push(elapsed);
    if (body.accepted || body.reason !== "no-goal") {
      throw new Error(
        `perf fixture assumption broken: expected a rejected "no-goal" result every run, got accepted=${body.accepted} reason=${body.reason}`,
      );
    }
  }
  return {
    runs,
    minMs: Math.min(...timesMs),
    avgMs: timesMs.reduce((a, b) => a + b, 0) / timesMs.length,
    maxMs: Math.max(...timesMs),
  };
}
