/**
 * The solvability gate (tasks/T-03-ATLAS.md "Solvability harness"): for every built-in level,
 * replay a known-good input tape and assert the goal is reached. This is the safety net that
 * catches a physics change (including T-01's own `Math.pow` -> `x * Math.sqrt(x)` fix) quietly
 * making a hand-verified level unsolvable.
 *
 * The 33 tapes under ./tapes/*.json are REAL, VERIFIED solutions — found by a grid search over
 * simple boost/brake burst strategies (single bursts from tick 0 at ~50 durations, two-phase
 * boost-then-brake / brake-then-boost combinations, and delayed mid-flight bursts for the harder
 * cases), each one actually simulated against `packages/core/src/physics.ts` and confirmed to
 * reach the goal. Recall boost/brake only rescale speed along the current heading — they cannot
 * steer — so this is exactly the "script an approximate solution" path the task doc allows in lieu
 * of hand-flying each level; every candidate was mechanically verified, not hand-waved. The search
 * tool itself is not part of this deliverable (one-off, not committed); see
 * notes/T-03-ATLAS/log.md and results/T-03-ATLAS.md for the numbers (fastest solve, and each
 * level's sensitivity to a % perturbation of the player's initial velocity — the actual "least
 * margin" ranking, not just ticks-remaining-in-an-arbitrary-horizon).
 *
 * This runner still goes through `physics-adapter.ts`'s dynamic import rather than a static one:
 * physics.ts did not exist for most of this task's development (T-01 KEPLER landed concurrently,
 * partway through), and the adapter is what let this file and its tests be written and validated
 * (structurally) before that happened. If physics.ts is ever unavailable again (e.g. a checkout
 * without T-01's work), every per-level check SKIPS loudly — visible vitest "skipped" status plus
 * the console banner below — rather than silently reporting a false green.
 */

import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

import { BUILTIN_LEVELS, hydrate, levelId } from "../../../src/level.js";
import type { InputState, ReplayTape } from "../../../src/types.js";
import { physicsAdapter } from "./physics-adapter.js";

function stateAtTick(transitions: readonly number[], tick: number): boolean {
  let held = false;
  for (const t of transitions) {
    if (t > tick) break;
    held = !held;
  }
  return held;
}

/**
 * Reconstructs input at a tick from a transition-encoded ReplayTape (types.ts's documented
 * semantics: entries are the tick indices at which that control CHANGED STATE, starting released).
 * Test-local rather than imported from T-02 TAPE's replay.ts, which does not exist yet either —
 * this harness does not depend on T-02 at all, only on the frozen `ReplayTape` shape in types.ts.
 */
function inputAtTick(tape: ReplayTape, tick: number): InputState {
  return {
    boost: stateAtTick(tape.boost, tick),
    brake: stateAtTick(tape.brake, tick),
    thrustX: 0,
    thrustY: 0,
  };
}

function loadTape(id: string): ReplayTape {
  const url = new URL(`./tapes/${id}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as ReplayTape;
}

const adapter = await physicsAdapter;

if (!adapter.available) {
  console.warn(
    "\n" +
      "=".repeat(78) +
      "\n" +
      "SOLVABILITY SUITE SKIPPED (loudly, not silently): " +
      adapter.unavailableReason +
      "\n" +
      "All 33 per-level solvability checks below are SKIPPED, not passing. This is\n" +
      "NOT a green safety net until packages/core/src/physics.ts exists — see\n" +
      "results/T-03-ATLAS.md for what this does and does not cover today.\n" +
      "=".repeat(78) +
      "\n",
  );
}

// id -> tick the goal was reached on, purely for the diagnostic printout below. Each tape's
// `ticks` is deliberately tight (reachedTick + 1), so this always equals `tape.ticks - 1` — it is
// NOT the "least margin" ranking from tasks/T-03-ATLAS.md "How to verify" step 3 (that ranking is
// about sensitivity to a small physics/velocity perturbation, not tape slack; see
// results/T-03-ATLAS.md and notes/T-03-ATLAS/log.md for those numbers, computed once via a
// one-off search tool rather than re-perturbed on every CI run).
const solveTickByLevel = new Map<string, number>();

describe("solvability — replay a known-good tape per level and assert the goal is reached", () => {
  BUILTIN_LEVELS.forEach((level, index) => {
    const id = levelId(index);
    const title = `${id} ${level.name}: reaches the goal within its tape's horizon`;

    if (!adapter.available) {
      it.skip(`[SKIPPED - physics.ts unavailable] ${title}`, () => {
        // Never runs — see the banner above and results/T-03-ATLAS.md.
      });
      return;
    }

    it(title, () => {
      const tape = loadTape(id);
      expect(
        tape.ticks,
        `${id}: tape must cover at least one tick`,
      ).toBeGreaterThan(0);

      const world = hydrate(level);
      let firstBoostFired = false;
      let reachedAtTick = -1;

      for (let tick = 0; tick < tape.ticks; tick++) {
        const input = inputAtTick(tape, tick);
        const result = adapter.simulateTick(world, input, {
          allowInput: true,
          firstBoostFired,
        });
        firstBoostFired = firstBoostFired || result.firstBoostTriggered;
        if (result.reachedGoal) {
          reachedAtTick = tick;
          break;
        }
      }

      if (reachedAtTick >= 0) {
        solveTickByLevel.set(id, reachedAtTick);
      }

      expect(
        reachedAtTick,
        `${id} (${level.name}) never reached the goal within ${tape.ticks} ticks. ` +
          `Tape: packages/core/test/level/solvability/tapes/${id}.json`,
      ).toBeGreaterThanOrEqual(0);
    });
  });
});

afterAll(() => {
  if (!adapter.available || solveTickByLevel.size === 0) return;
  const sorted = [...solveTickByLevel.entries()].sort((a, b) => a[1] - b[1]);
  console.log(
    "\nSolve time per level (ticks until goal reached), fastest first — see results/T-03-ATLAS.md\n" +
      "for the actual least-margin (perturbation-sensitivity) ranking:\n" +
      sorted
        .map(([id, tick]) => `  ${id}: reached goal at tick ${tick}`)
        .join("\n") +
      "\n",
  );
});
