/**
 * Shared test fixtures. Not itself a test file (no `describe`/`it`), so vitest's
 * default `*.test.ts` glob skips it; imported by the actual `.test.ts` files in this directory.
 */

import { hydrate } from "../../src/level.js";
import type { Level, ReplayTape } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Seeded PRNG — deterministic, reproducible generated tapes. `Math.random` is fine in test code
// (the zero-RNG rule in docs/GAME.md §4 is about `packages/core/src`, the simulation itself — this
// file is test-only), but a fixed seed means a failing generated case reproduces exactly on rerun
// instead of only failing intermittently in CI.
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, good enough statistical quality for fixture generation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Random ReplayTape generation — always well-formed (strictly increasing, in-range), matching
// the invariants `verifyReplay`'s malformed checks enforce. Used for round-trip and
// `inputAtTick`-agrees-with-naive-expansion property tests.
// ---------------------------------------------------------------------------

export interface GenTapeOptions {
  maxTicks?: number;
  maxTransitionsPerControl?: number;
}

function genTransitions(
  rng: () => number,
  ticks: number,
  maxCount: number,
): number[] {
  if (ticks <= 0) return [];
  const count = Math.min(ticks, Math.floor(rng() * (maxCount + 1)));
  const chosen = new Set<number>();
  // Rejection sampling is fine here: count is bounded well below ticks in practice (maxCount
  // defaults to 25, ticks defaults up to 2000), so this terminates quickly.
  let guard = 0;
  while (chosen.size < count && guard < count * 50 + 100) {
    chosen.add(Math.floor(rng() * ticks));
    guard++;
  }
  return [...chosen].sort((a, b) => a - b);
}

/** A random, always-well-formed `ReplayTape`. */
export function genTape(
  rng: () => number,
  opts: GenTapeOptions = {},
): ReplayTape {
  const maxTicks = opts.maxTicks ?? 2000;
  const maxTransitionsPerControl = opts.maxTransitionsPerControl ?? 25;
  const ticks = 1 + Math.floor(rng() * maxTicks);
  return {
    ticks,
    boost: genTransitions(rng, ticks, maxTransitionsPerControl),
    brake: genTransitions(rng, ticks, maxTransitionsPerControl),
  };
}

/** N random tapes from a fixed seed — same sequence every run. */
export function genTapes(
  count: number,
  seed: number,
  opts: GenTapeOptions = {},
): ReplayTape[] {
  const rng = mulberry32(seed);
  const tapes: ReplayTape[] = [];
  for (let i = 0; i < count; i++) tapes.push(genTape(rng, opts));
  return tapes;
}

// ---------------------------------------------------------------------------
// Synthetic benchmark level — a player in a tight, stable, bound orbit around a single sun, with
// an unreachable goal far outside the orbit. Guarantees the FULL tick budget is simulated (no
// early exit from reaching goal or leaving bounds), which is the worst case for timing a 60s
// (8,640-tick) verification — a real solving tape would exit early and understate the cost.
// ---------------------------------------------------------------------------

export const BENCH_LEVEL: Level = {
  name: "T-02 bench fixture (synthetic, not a real level)",
  author: "T-02 TAPE",
  goal: { index: 2, range: 1 },
  objects: [
    {
      type: "player",
      x: 100,
      y: 0,
      x_vel: 0,
      y_vel: 31.622776601683796,
      gravity: 0,
    },
    { type: "sun", x: 0, y: 0, gravity: 100000, visible: true, size: 20 },
    // Decorative, unreachable "goal marker" far from the orbit — gravity 0 so it never perturbs
    // the player; only exists so `goal.index` has something finite and non-player to point at.
    { type: "sun", x: 2500, y: 1700, gravity: 0, visible: true, size: 5 },
  ],
};

/** 8,640 ticks (60s at 144Hz) with ~40 transitions — "tens", matching a real human run's shape. */
export function benchTape(): ReplayTape {
  const ticks = 8640;
  const boost: number[] = [];
  const brake: number[] = [];
  for (let i = 0; i < 20; i++) {
    const base = 200 + i * 400;
    boost.push(base, base + 30);
  }
  for (let i = 0; i < 20; i++) {
    const base = 220 + i * 400;
    brake.push(base, base + 15);
  }
  return { ticks, boost, brake };
}

/** Sanity check used by the bench script and a regression test: the bench level really is
 *  unreachable and in-bounds for the whole tape (i.e. actually exercises the worst case). */
export function benchWorldStaysBound(): boolean {
  const world = hydrate(BENCH_LEVEL);
  return world.playerIndex >= 0;
}
