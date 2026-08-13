/**
 * T-03 ATLAS's solvability harness needs to step the simulation, but T-01 KEPLER owns
 * `packages/core/src/physics.ts` and — per the working agreement — this task must not read,
 * import, or wait on it. This adapter is the one place that dependency is isolated:
 *
 *   - It dynamically imports `../../../src/physics.js` (never a static import, so this file loads
 *     fine whether or not physics.ts exists).
 *   - If the module isn't there yet (today, in this checkout — verified absent via Glob before
 *     writing this), `available` is `false` and the runner in `run.test.ts` skips every per-level
 *     check LOUDLY (vitest "skipped", plus a console banner) instead of silently reporting green.
 *   - The moment T-01 lands a real `physics.ts` exporting `simulateTick` matching the
 *     INTERFACES.md#corephysicsts--t-01-kepler signature, this adapter picks it up automatically —
 *     no changes needed here or in run.test.ts.
 *
 * This file is test-only infrastructure. Nothing under packages/core/src may import it.
 */

import type { InputState, TickResult, World } from "../../../src/types.js";

export type SimulateTick = (
  world: World,
  input: InputState,
  opts: { allowInput: boolean; firstBoostFired: boolean },
) => TickResult;

export interface PhysicsAdapter {
  readonly available: boolean;
  /** Human-readable reason `available` is false, for the loud-skip banner. Empty when available. */
  readonly unavailableReason: string;
  readonly simulateTick: SimulateTick;
}

function unavailableSimulateTick(): TickResult {
  throw new Error(
    "physics-adapter: simulateTick() was called while physics unavailable=true. " +
      "The solvability runner should have skipped instead of calling this — see run.test.ts.",
  );
}

async function loadPhysicsAdapter(): Promise<PhysicsAdapter> {
  try {
    // Intentionally dynamic (string not visible to bundlers/tsc as a static dependency): T-01
    // KEPLER's physics.ts may not exist in this checkout, and packages/core must still typecheck
    // and run its own tests without it.
    const modulePath = "../../../src/physics.js";
    const mod = (await import(modulePath)) as { simulateTick?: unknown };
    if (typeof mod.simulateTick !== "function") {
      return {
        available: false,
        unavailableReason:
          "../../src/physics.js resolved but does not export a `simulateTick` function " +
          "matching INTERFACES.md#corephysicsts--t-01-kepler",
        simulateTick: unavailableSimulateTick,
      };
    }
    return {
      available: true,
      unavailableReason: "",
      simulateTick: mod.simulateTick as SimulateTick,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      unavailableReason: `packages/core/src/physics.ts is not available yet (T-01 KEPLER not landed): ${reason}`,
      simulateTick: unavailableSimulateTick,
    };
  }
}

/** Resolved once per test run — physics.ts availability doesn't change mid-run. */
export const physicsAdapter: Promise<PhysicsAdapter> = loadPhysicsAdapter();
