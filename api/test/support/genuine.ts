/**
 * T-12 LEDGER test support — synthetic "genuine playthrough" fixtures.
 *
 * This used to load T-03 ATLAS's 33 real, hand-verified solving tapes for the real built-in
 * levels. Those were removed on feat/remove-gravity-softening: `packages/core/src/physics.ts` now
 * implements pure inverse-square gravity (owner-directed change, matching S3) instead of the old
 * Plummer-softened form the tapes were solved and timed under, so replaying them no longer reaches
 * their levels' goals — the exact "hardcoded physics trajectory" this suite must not depend on.
 *
 * Instead, each case here is a small synthetic CUSTOM level. `validate()` requires at least one
 * body with gravity > 0, so the sun carries a small gravity value — but nothing here hand-derives
 * a trajectory: `timeMs`/`boostMs`/the tape's tick count are always read back from an actual
 * `verifyReplay` simulation, never hand-typed, so this stays correct under any gravity formula.
 * The "genuine" part is that an actual playthrough recording actually reaches an actual goal through
 * the actual server-side verifier; only the level is synthetic, not the verification path.
 *
 * Because these are custom levels (not `builtin-NN`), a case's `level` must be registered in the
 * FakeDb's `customLevelRows` (see `seedGenuineCase`) before `resolveLevel`/`handleScore` can find
 * it by `levelId`.
 */

import { verifyReplay } from "@swingby/core";
import type { Level, ReplayTape } from "@swingby/core";
import type { FakeDb } from "./fake-db.js";

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

/** Custom level ids: alphanumeric, matching `LEVEL_ID_PATTERN` in api/_validate.ts. */
function customLevelId(index: number): string {
  return `GENUINE${String(index).padStart(2, "0")}`;
}

function makeLevel(index: number): Level {
  // Fixed speed and a start position far enough out that reaching the goal always takes well over
  // 90 ticks — keeps the [50, 90] boost window (see makeTape) safely inside every case's tape,
  // regardless of index, so tightening to `ticks = reachedTick + 1` never clips it out of range.
  const startX = -(600 + index * 50);
  const speed = 2;
  return {
    name: `T-12 synthetic genuine fixture ${index}`,
    author: "T-12 LEDGER",
    goal: { index: 1, range: 15 },
    objects: [
      { type: "player", x: startX, y: 0, x_vel: speed, y_vel: 0, gravity: 0 },
      { type: "sun", x: 0, y: 0, gravity: 50, visible: true, size: 5 },
    ],
  };
}

function makeTape(index: number): ReplayTape {
  // Even indices carry a short boost burst (something for flipOneTransition to flip); odd indices
  // are pure zero-input coasts — mirroring the real corpus's original mix of "some tapes have
  // transitions, some don't" so both code paths in the tamper tests stay exercised.
  const ticks = 5000;
  if (index % 2 === 0) {
    return { ticks, boost: [50, 90], brake: [] };
  }
  return { ticks, boost: [], brake: [] };
}

export function loadGenuineCase(index: number): GenuineCase {
  const id = customLevelId(index);
  const level = makeLevel(index);
  const looseTape = makeTape(index);

  // First pass with a generous tick budget, to find the tick the goal is actually captured on.
  const looseProbe = verifyReplay(level, looseTape, {
    timeMs: -1,
    boostMs: -1,
  });
  if (looseProbe.reason === "no-goal" || looseProbe.reason === "malformed") {
    throw new Error(
      `loadGenuineCase(${index}): fixture never reached its goal (reason=${looseProbe.reason}) — adjust makeLevel/makeTape`,
    );
  }

  // Tighten to `ticks = reachedTick + 1` (the minimum horizon that still reaches goal), matching
  // the old real-tape corpus's "tight by construction" property that the truncation-tamper test
  // relies on: shaving the last tick off a tight tape must always break verification.
  const tape: ReplayTape = { ...looseTape, ticks: looseProbe.ticks };
  const probe = verifyReplay(level, tape, { timeMs: -1, boostMs: -1 });
  if (probe.ok) {
    throw new Error(
      `loadGenuineCase(${index}): probe claim unexpectedly passed`,
    );
  }
  if (probe.reason === "no-goal" || probe.reason === "malformed") {
    throw new Error(
      `loadGenuineCase(${index}): tightened tape lost the goal (reason=${probe.reason})`,
    );
  }

  return {
    index,
    levelId: id,
    level,
    tape,
    timeMs: probe.timeMs,
    boostMs: probe.boostMs,
  };
}

/** A small corpus of synthetic genuine cases, standing in for the old 33-real-level corpus. */
export function loadAllGenuineCases(count = 12): GenuineCase[] {
  return Array.from({ length: count }, (_, index) => loadGenuineCase(index));
}

/** Registers a genuine case's synthetic level directly into a FakeDb's custom-level rows, so
 *  `resolveLevel`/`fetchCustomLevel` can find it by `levelId` without going through a real
 *  `insertCustomLevel` SQL round-trip. */
export function seedGenuineCase(db: FakeDb, c: GenuineCase): void {
  db.customLevelRows.push({
    id: c.levelId,
    name: c.level.name,
    author: c.level.author,
    data: c.level,
    plays: 0,
    created_at: new Date().toISOString(),
  });
}

export function seedGenuineCases(
  db: FakeDb,
  cases: readonly GenuineCase[],
): void {
  for (const c of cases) seedGenuineCase(db, c);
}

/**
 * Returns a tampered copy of `tape` with exactly one transition index changed to a different value
 * — "one flipped index" per the task's Definition-of-done wording. Returns `null` if neither array
 * has an entry to flip (a pure zero-input coast, by design present in this corpus too — see
 * `makeTape`).
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

/**
 * A second, independent tamper class: shaves the last tick off the tape (`ticks -= 1`). Every case
 * from `loadGenuineCase`/`loadAllGenuineCases` is tight by construction (`ticks = reachedTick + 1`
 * — the minimum horizon that still reaches goal), so shortening the horizon by one tick means the
 * simulation never reaches the tick the goal was actually captured on, reliably producing "no-goal".
 */
export function truncateTape(tape: ReplayTape): ReplayTape | null {
  if (tape.ticks <= 0) return null;
  return { ...tape, ticks: tape.ticks - 1 };
}
