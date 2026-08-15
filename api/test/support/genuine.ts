/**
 * T-12 LEDGER test support — loads T-03 ATLAS's real, verified solving tapes
 * (packages/core/test/level/solvability/tapes/builtin-*.json, READ-ONLY, never edited here) and
 * derives ground-truth `timeMs`/`boostMs` for each by asking `verifyReplay` itself, rather than
 * hand-computing or hardcoding numbers. This is what "genuine submissions" means throughout
 * api/test/**: an actual playthrough recording that actually reaches the actual goal of an actual
 * built-in level, replayed through the actual server-side verifier.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BUILTIN_LEVELS, verifyReplay, levelId } from "@swingby/core";
import type { Level, ReplayTape } from "@swingby/core";

const TAPES_DIR = fileURLToPath(
  new URL(
    "../../../packages/core/test/level/solvability/tapes/",
    import.meta.url,
  ),
);

export interface GenuineCase {
  index: number;
  levelId: string;
  level: Level;
  tape: ReplayTape;
  /** Server-truth values, obtained by replaying against an impossible claim and reading back the
   *  simulator's own reported `timeMs`/`boostMs` — never hand-typed. */
  timeMs: number;
  boostMs: number;
}

/** All 33 built-in levels' genuine solving tapes, each resolved to real `timeMs`/`boostMs`. */
export function loadAllGenuineCases(): GenuineCase[] {
  return BUILTIN_LEVELS.map((level, index) => loadGenuineCase(index, level));
}

export function loadGenuineCase(index: number, level: Level = BUILTIN_LEVELS[index] as Level): GenuineCase {
  const id = levelId(index);
  const tapePath = `${TAPES_DIR}${id}.json`;
  const tape = JSON.parse(readFileSync(tapePath, "utf8")) as ReplayTape;

  // Deliberately impossible claim: forces `ok: false` (reason "time-mismatch" almost certainly, or
  // conceivably "boost-mismatch") while still returning the simulator's real, computed timeMs/boostMs
  // — verifyReplay always reports what actually happened, win or lose. Reading those back is the
  // only way this file gets ground truth without a second, independent physics implementation.
  const probe = verifyReplay(level, tape, { timeMs: -1, boostMs: -1 });
  if (probe.ok) {
    // Would only happen if a tape genuinely finished in 0ms with 0 boost, which none of the 33 do —
    // guard so a future change to the corpus can't silently produce an untested assumption here.
    throw new Error(`loadGenuineCase(${index}): probe claim unexpectedly passed`);
  }

  return { index, levelId: id, level, tape, timeMs: probe.timeMs, boostMs: probe.boostMs };
}

/**
 * Returns a tampered copy of `tape` with exactly one transition index changed to a different value
 * — "one flipped index" per the task's Definition-of-done wording. Tries the first transition of
 * whichever array (`boost` then `brake`) has at least one entry, preferring a `±25`-tick nudge
 * (~0.17s — big enough to plausibly move when the goal is actually captured, since physics is not
 * maximally chaotic at every instant and a mere `±1` tick is sometimes fully absorbed with zero
 * effect on the outcome — empirically true for a handful of the 33 real tapes, see
 * notes/T-12-LEDGER/log.md) and falling back to smaller deltas (`±1`) only if the large one doesn't
 * fit within the tape's bounds. Returns `null` if neither array has an entry to flip at all (a tape
 * with zero transitions — none of the 33 real tapes are shaped this way, but this keeps the helper
 * honest about its own limits rather than silently no-op-ing).
 *
 * Important, and worth stating precisely: this function does NOT guarantee the tamper changes the
 * simulated outcome — it only guarantees the tape's bytes differ from the original. A flip that
 * happens not to move the goal-capture tick produces an IDENTICAL `timeMs`/`boostMs`, and accepting
 * that submission is correct, not a bug (there is nothing to detect: the run that actually happened
 * really did match the claim). api/test/score.test.ts's forgery-corpus test checks for the real
 * invariant — a tamper that changes the actual outcome must never be accepted — rather than
 * asserting every flip changes the outcome, which the physics does not promise.
 */
export function flipOneTransition(tape: ReplayTape): ReplayTape | null {
  for (const key of ["boost", "brake"] as const) {
    const arr = tape[key];
    if (arr.length === 0) continue;

    const original = arr[0] as number;
    const next = arr.length > 1 ? (arr[1] as number) : tape.ticks;

    let flipped: number | null = null;
    for (const delta of [25, -25, 1, -1]) {
      const candidate = original + delta;
      if (candidate >= 0 && candidate < next && candidate < tape.ticks) {
        flipped = candidate;
        break;
      }
    }
    if (flipped === null) continue;

    const newArr = arr.slice();
    newArr[0] = flipped;
    return { ...tape, [key]: newArr };
  }
  return null;
}
