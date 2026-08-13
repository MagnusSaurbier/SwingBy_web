/**
 * T-02 TAPE — measured numbers, run by hand (not part of `npm test`; no `describe`/`it`, so
 * vitest's `*.test.ts` glob doesn't pick it up).
 *
 * Run with (from the repo root):
 *   node --experimental-strip-types \
 *     --import ./packages/core/test/replay/register-loader.mjs \
 *     packages/core/test/replay/bench.ts
 *
 * The `--import register-loader.mjs` is required in THIS checkout's Node (v22.22.2): plain
 * `--experimental-strip-types` alone does not resolve `packages/core/src`'s internal ".js"
 * specifiers to their sibling ".ts" files (verified empirically — a minimal two-file repro
 * throws `ERR_MODULE_NOT_FOUND` without it; vitest and `tsc` both resolve this convention fine,
 * only bare `node` needs help). See resolve-hook.mjs's header comment and notes/T-02-TAPE/log.md
 * for the full story. This does not add an npm dependency — the hook uses only `node:module`.
 *
 * Prints:
 *   1. Wall time to verifyReplay() an 8,640-tick (60s) worst-case tape — must be < 100ms
 *      (tasks/T-02-TAPE.md DoD).
 *   2. inputAtTick timing across growing transition counts, as evidence (not just an assertion)
 *      that it is O(log n) — total time should grow much slower than the transition count.
 *   3. Encoded size for a representative 60s run, and bytes-per-transition.
 */

import { inputAtTick, verifyReplay, encodeTape } from "../../src/replay.js";
import type { ReplayTape } from "../../src/types.js";
import { BENCH_LEVEL, benchTape } from "./fixtures.js";

function nowMs(): number {
  return performance.now();
}

// ---------------------------------------------------------------------------
// 1. verifyReplay budget for a 60s tape
// ---------------------------------------------------------------------------

function benchVerify(): void {
  const tape = benchTape();
  // Run a few times and take the min — first call pays JIT warmup, we want steady-state.
  const runs = 5;
  const timesMs: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = nowMs();
    const result = verifyReplay(BENCH_LEVEL, tape, { timeMs: 0, boostMs: 0 });
    const elapsed = nowMs() - start;
    timesMs.push(elapsed);
    if (result.reason !== "no-goal") {
      throw new Error(
        `bench fixture assumption broken: expected reason "no-goal", got ${result.reason}`,
      );
    }
    if (result.ticks !== tape.ticks) {
      throw new Error(
        `bench fixture did not simulate the full tape: ticks=${result.ticks}, expected ${tape.ticks}`,
      );
    }
  }
  const min = Math.min(...timesMs);
  const max = Math.max(...timesMs);
  const avg = timesMs.reduce((a, b) => a + b, 0) / timesMs.length;
  console.log("=".repeat(78));
  console.log(
    "1. verifyReplay budget — 8,640-tick (60s) worst-case tape (never reaches goal,",
  );
  console.log(
    "   so the full tape is simulated every run; this is the worst case, not the",
  );
  console.log(
    "   average case, since a real solving tape exits the loop early on capture).",
  );
  console.log(
    `   runs=${runs}  min=${min.toFixed(3)}ms  avg=${avg.toFixed(3)}ms  max=${max.toFixed(3)}ms`,
  );
  console.log(
    `   budget: < 100ms  =>  ${max < 100 ? "PASS" : "FAIL"} (using max of ${runs} runs)`,
  );
}

// ---------------------------------------------------------------------------
// 2. inputAtTick O(log n) evidence
// ---------------------------------------------------------------------------

function makeTapeWithNTransitions(n: number, ticks: number): ReplayTape {
  const boost: number[] = [];
  const step = Math.max(1, Math.floor(ticks / (n + 1)));
  for (let i = 0; i < n; i++) boost.push(i * step);
  return { ticks, boost, brake: [] };
}

function benchInputAtTick(): void {
  const ticks = 86400; // max allowed tape length, so lookups span the full range
  const sizes = [1, 10, 100, 500, 1000, 2000];
  const lookupsPerSize = 300_000;

  console.log("=".repeat(78));
  console.log(
    "2. inputAtTick timing vs. transition count (O(log n) evidence, not assertion)",
  );
  console.log(
    `   ${lookupsPerSize} random-tick lookups per size, ticks=${ticks} (max tape length)`,
  );
  console.log(
    "   " +
      [
        "transitions",
        "totalMs",
        "nsPerLookup",
        "log2(n)",
        "nsPerLookup/log2(n)",
      ]
        .map((h) => h.padStart(16))
        .join(""),
  );

  // Deterministic pseudo-random tick indices, generated once and reused across all sizes so the
  // comparison isn't skewed by which ticks happen to get queried.
  let seed = 0x1234abcd;
  function rand(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  const queryTicks: number[] = [];
  for (let i = 0; i < lookupsPerSize; i++)
    queryTicks.push(Math.floor(rand() * ticks));

  const rows: { n: number; totalMs: number; nsPerLookup: number }[] = [];
  for (const n of sizes) {
    const tape = makeTapeWithNTransitions(n, ticks);
    // Warmup.
    for (let i = 0; i < 1000; i++)
      inputAtTick(tape, queryTicks[i % queryTicks.length]!);

    const start = nowMs();
    let sink = 0; // prevent dead-code elimination
    for (let i = 0; i < lookupsPerSize; i++) {
      const r = inputAtTick(tape, queryTicks[i]!);
      if (r.boost) sink++;
    }
    const elapsed = nowMs() - start;
    if (sink < 0) console.log(sink); // never true; keeps `sink` observably used
    const nsPerLookup = (elapsed / lookupsPerSize) * 1_000_000;
    rows.push({ n, totalMs: elapsed, nsPerLookup });
    const log2n = Math.log2(Math.max(n, 1));
    console.log(
      "   " +
        [
          String(n),
          elapsed.toFixed(2),
          nsPerLookup.toFixed(1),
          log2n.toFixed(2),
          (nsPerLookup / Math.max(log2n, 1)).toFixed(1),
        ]
          .map((s) => s.padStart(16))
          .join(""),
    );
  }

  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const nRatio = last.n / Math.max(first.n, 1);
  const timeRatio = last.nsPerLookup / Math.max(first.nsPerLookup, 0.001);
  console.log(
    `   transition-count grew ${nRatio.toFixed(0)}x (${first.n} -> ${last.n}); ` +
      `per-lookup time grew only ${timeRatio.toFixed(2)}x — consistent with O(log n), not O(n) ` +
      `(a linear scan would grow ~${nRatio.toFixed(0)}x too).`,
  );
}

// ---------------------------------------------------------------------------
// 3. Encoded size
// ---------------------------------------------------------------------------

function benchEncodedSize(): void {
  const tape = benchTape();
  const transitions = tape.boost.length + tape.brake.length;
  const encoded = encodeTape(tape);
  const approxBytes = Math.floor((encoded.length * 3) / 4);
  console.log("=".repeat(78));
  console.log("3. Encoded size — representative 60s (8,640-tick) run");
  console.log(`   ticks=${tape.ticks}  transitions=${transitions}`);
  console.log(
    `   encoded chars=${encoded.length}  approx bytes=${approxBytes}`,
  );
  console.log(`   bytes/transition=${(approxBytes / transitions).toFixed(2)}`);
}

benchVerify();
benchInputAtTick();
benchEncodedSize();
console.log("=".repeat(78));
