# T-03 · ATLAS — results

Levels: loading, validation, solvability CI. Area `packages/core`.

Note on paths: the orchestrator's session instructions route test files under
`packages/core/test/level/**` rather than the task doc's originally-listed
`packages/core/test/level.test.ts` / `packages/core/test/solvability/**`. I followed the
orchestrator (explicit, more specific for this environment); the content and coverage match the
task doc's Deliverables section exactly, only the directory differs.

## Deliverables

| # | Artifact | Path | Status |
|---|---|---|---|
| 1 | `hydrate`, `serialize`, `validate`, `levelId`, `customLevelId`, `BUILTIN_LEVELS` | `packages/core/src/level.ts` | Done |
| 2 | Level data, byte-identical to the Godot original | `packages/core/src/levels.json` | Done — `diff` clean, sha256 matches |
| 3 | Unit tests: defaults, validation, round-trip | `packages/core/test/level/level.test.ts` | Done — 77 tests |
| 4 | One known-good solvability tape per level (33) | `packages/core/test/level/solvability/tapes/*.json` | Done — 33 files, **real verified solves**, not placeholders (see "How the tapes were produced" below) |
| 5 | Solvability runner, CI-wired | `packages/core/test/level/solvability/run.test.ts` | Done — 33 tests, all green |
| 6 | The `turn_speed` decision, recorded in code comments | `packages/core/src/level.ts` (search "turn_speed — deliberate decision") | Done |
| — | Physics availability adapter (not a task doc deliverable, but required by the orchestrator's standalone-working instructions) | `packages/core/test/level/solvability/physics-adapter.ts` | Done |

Files touched, total: `packages/core/src/level.ts`, `packages/core/src/levels.json`,
`packages/core/test/level/level.test.ts`, `packages/core/test/level/solvability/physics-adapter.ts`,
`packages/core/test/level/solvability/run.test.ts`,
`packages/core/test/level/solvability/tapes/builtin-00.json` … `builtin-32.json` (33 files), plus
this results file and `notes/T-03-ATLAS/log.md`. Nothing else was modified — in particular
`packages/core/src/types.ts`, `constants.ts`, and `packages/core/src/index.ts` were **not** touched.

**`packages/core/src/index.ts` needs `export * from "./level.js";` added.** I do not own that file
(not in my row of INTERFACES.md's ownership table) and did not edit it. The orchestrator/whoever
owns `index.ts` needs to add that line for `BUILTIN_LEVELS`/`hydrate`/`serialize`/`validate`/
`levelId`/`customLevelId`/`LevelError` to be reachable from `@swingby/core`'s public entry point.

## Definition of done

- [x] `BUILTIN_LEVELS.length === 33`, all passing `validate()` — verified: 33/33, see numbers below.
- [x] `serialize(hydrate(l))` deep-equals `l` for all 33 — exact round-trip — verified: 33/33 (one
      `it` per level, all green), plus 2 additional hand-authored fixtures round-trip too
      (exercising branches the 33 builtins don't: `anchored:true`, an explicit `turn_speed`
      override, non-zero `boost_type`, and a sun with `visible:false`).
- [x] `levels.json` is byte-identical to the Godot original (`diff` clean) — verified: `diff`
      produces no output, sha256 matches exactly.
- [x] Malformed levels return **all** applicable errors, never throw raw — verified: 13 rejection
      tests, including a "returns ALL applicable errors, not just the first" test that breaks two
      unrelated rules at once and asserts ≥3 errors come back together; two "never throws" tests
      feed genuinely malformed non-Level shapes (`objects: "not-an-array"`, `null`, `42`) through
      `validate()` and assert no exception, `ok:false` instead.
- [x] A solvability tape exists for every one of the 33 levels and all pass — verified: 33/33 tape
      files exist, 33/33 solvability tests pass. See "How the tapes were produced" below for how
      this went from "structurally impossible today" to "actually verified" mid-session, because
      T-01 KEPLER's `physics.ts` landed concurrently while this task was in progress.
- [x] `turn_speed` decision made, documented, and **no `Math.random()` anywhere** — decision:
      deterministic pseudo-spin `-2.0 - ((index * 0.37) % 1.0)`, documented in a code comment in
      `level.ts` (search "turn_speed — deliberate decision"). `grep -rn "Math.random"
      packages/core/src/level.ts` is empty (see numbers below for the one caveat: physics.ts, not
      mine, has an unrelated prose mention).
- [x] Zero dependencies — `level.ts` imports only from `./types.js`, `./constants.js`, and
      `./levels.json` (via the `with { type: "json" }` import attribute, no bundler/loader
      dependency). No `package.json` changes.
- [x] Global checklist (PROJECT.md §7):
  - [x] `npm run typecheck`-equivalent (`npx tsc --noEmit -p tsconfig.json`) clean, project-wide —
        0 lines of output. No `any` in my files, no `@ts-expect-error`.
  - [x] Full repo `npx vitest run` green: 145 passed, 1 skipped (the 1 skipped is T-01 KEPLER's own
        parity test, not mine — see numbers below).
  - [x] No file outside my ownership row was modified (see file list above).
  - [x] No new runtime dependency in `packages/core`.
  - [x] Interfaces consumed (T-01's `simulateTick`) are used exactly as frozen in INTERFACES.md; no
        interface change requested.
  - [x] Every measurement below is a number.

## Numbers

**Round trip (33 built-in levels):** 33/33 pass `serialize(hydrate(l))` deep-equals `l`
(one `it` per level in `level.test.ts`; all green — see full test name list in the session, e.g.
`round-trips level 0 (Orbital Primer): serialize(hydrate(l)) deep-equals l` … `level 32 (Final
Thread)`).

**Validation — accepts:** 33/33 built-in levels pass `validate()` (single test asserting the full
list, zero failures).

**Validation — rejects (one deliberately-malformed case per rule, all confirmed rejected):**

| Rule | Test | Result |
|---|---|---|
| exactly one player | "rejects a level with no player object" | rejected, error mentions "exactly one player" |
| exactly one player | "rejects a level with two player objects" | rejected, error mentions "found 2" |
| goal.index in range | "rejects goal.index out of range (negative)" | rejected |
| goal.index in range | "rejects goal.index out of range (>= objects.length)" | rejected |
| goal.index not player | "rejects goal.index pointing at the player" | rejected, error mentions "must not reference the player" |
| goal.range > 0 | "rejects goal.range === 0" | rejected |
| goal.range > 0 | "rejects goal.range < 0" | rejected |
| finite coordinates | "rejects a non-finite coordinate (NaN x)" | rejected |
| finite coordinates | "rejects a non-finite coordinate (Infinity y)" | rejected |
| finite velocity/gravity/size | "rejects non-finite velocity/gravity/size" | rejected, all 3 sub-errors present at once |
| gravity > 0 somewhere | "rejects a level with no body with gravity > 0" | rejected |
| all errors returned, not just first | combines 2 broken rules, asserts ≥3 errors | 3 errors returned together |
| never throws on malformed input | non-array `objects`, missing `goal` | `ok:false`, no exception |
| never throws on malformed input | `null` and `42` cast as `Level` | `ok:false`, no exception |

14 rejection tests total, covering every one of the 5 required rules (some with 2-3 cases).

**`tsc --noEmit -p tsconfig.json`:** 0 lines of output (clean), project-wide, run after every
substantive edit.

**`npx vitest run packages/core/test/level`:** 2 test files, **110/110 tests passed**, 0 failed
(77 in `level.test.ts`, 33 in `solvability/run.test.ts`). Run duration ~0.7–0.8s.

**Full repo `npx vitest run`:** 4 test files (mine: 2; T-01 KEPLER's: 2), **145 passed, 1 skipped**,
0 failed. The 1 skip is T-01's own `packages/core/test/parity/parity.test.ts` (not mine to explain).

**`levels.json` vs reference:** `diff packages/core/src/levels.json
reference/godot/data/levels_builtin.json` → no output (identical). sha256 of both files:
`ac7b8be1cfdb6c9beca69c14e181c5026d2d1c7a81b8799e402a87d3850d1dde` (matches).

**`grep -rn "Math.random" packages/core/src/level.ts`:** empty (0 matches). Note:
`grep -rn "Math.random" packages/core/src/` (the literal command in the task doc, scanning the
whole directory) finds one match in `physics.ts:14` — a prose doc-comment ("No clock, no
Math.random, no globals"), not a call, and not my file; T-01 KEPLER owns it.

## Prove the tests can fail (both done for real, both reverted)

**1. Round-trip suite.** Temporarily changed `serializeObject()`'s x_vel-emission condition from
`if (body.type !== "sun" || body.xVel !== 0)` to `if (false && ...)` in `level.ts` (disabling x_vel
re-emission entirely). Re-ran `level.test.ts`: **35 failed / 42 passed** (every round-trip case
involving a nonzero-or-non-sun x_vel went red, correctly). Reverted the one-line change; re-ran:
**77/77 passed** again, `tsc` clean.

**2. Solvability suite.** Temporarily perturbed a *clone* of `builtin-00` (Orbital Primer)'s initial
player velocity by +5% inside `run.test.ts` (BUILTIN_LEVELS itself was never mutated — cloned via
`JSON.parse(JSON.stringify(...))` before the edit). Re-ran the solvability suite: **1 failed / 32
passed** — exactly `builtin-00`, the level that was perturbed, went red; every other level's tape
was unaffected. Reverted; re-ran: **33/33 passed** again. (This is consistent with the fragility
analysis below: `builtin-00`'s winning tape was already found to break at just a 1% perturbation.)

## How the tapes were produced (this changed mid-session — read this)

At the start of this task, neither `packages/core/src/physics.ts` (T-01 KEPLER) nor
`packages/core/src/replay.ts` (T-02 TAPE) existed in this checkout (confirmed via `Glob` before
relying on their absence, per the "work standalone" instructions). Boost/brake only rescale speed
along the current heading — they cannot steer; all steering comes from gravity bending the
trajectory over time — so hand-authoring a genuinely correct input tape without a working simulator
to check it against is not realistically possible. Reimplementing physics myself to check candidate
tapes was considered and rejected (that's T-01's exclusive file; a second implementation risks
exactly the drift PROJECT.md warns against, and I was told not to read/import it or wait for it).

So the harness was built to **skip loudly, not pass vacuously**, exactly as instructed:
`solvability/physics-adapter.ts` dynamically imports `../../../src/physics.js`; if that import
fails, every per-level solvability test is registered as `it.skip(...)` with `[SKIPPED - physics.ts
unavailable]` in its name, plus a console banner, and the 33 tapes that existed at that point were
honest placeholders — pure coast (`{boost: [], brake: []}`), not claimed as verified.

**T-01 KEPLER's `physics.ts` landed partway through this session** (this repo has several agents
editing disjoint files concurrently). The adapter picked it up automatically — no code changes
needed — and, correctly, most of the placeholder coast-tapes immediately failed once real physics
was exercised (24/33), because most of these levels are not solvable by pure coasting. That was the
expected, correct behaviour of a harness that "lights up for real," not a bug.

Given a real simulator was now available, I did not ship those placeholders. I wrote a one-off
search tool (scratchpad only — **not part of this deliverable**, not committed anywhere under
`packages/core`) that imports the real `level.ts` and `physics.ts` and grid-searches simple
boost/brake strategies per level: a single burst held from tick 0 (~24 durations), two-phase
boost-then-brake / brake-then-boost combinations (~112 pairs), and, as a fallback, delayed
mid-flight bursts (~182 combinations) for anything still unsolved. Every candidate was **actually
simulated** against the real physics engine — nothing here is hand-waved.

**Result: 33/33 levels solved** on the grid pass (the delayed-burst fallback was never needed). Each
tape's `ticks` was then tightened to `reachedTick + 1` — the minimum horizon that still covers the
successful tick — so the committed tapes are both real and tight (a regression that makes a level
even slightly slower to solve, not just impossible, will show up as a failure too).

## Solvability margin — the real "least margin" ranking

Rather than a "ticks remaining in an arbitrary horizon" proxy (which is meaningless once tapes are
tight — it's always ~1), I computed the actual thing the task doc's "How to verify" step 4 describes
("perturb one level's ship velocity... confirm the solvability run goes red"), for all 33 levels at
once: for each level's winning tape, perturbed the player's initial velocity by ±{1, 2, 5, 10, 20,
50}% and re-ran the *same, unchanged* tape, recording the smallest magnitude that breaks it. Least
margin first (most fragile — these are the ones a future physics change will break first):

| Fragility (breaks at) | Levels |
|---|---|
| 1% | builtin-00 Orbital Primer, builtin-02 Blue Transfer, builtin-05 Counterspin, builtin-06 Halo Drift, builtin-13 Relay Run, builtin-14 Chain Reaction, builtin-27 Crescent Loop, builtin-29 Wide Net, builtin-32 Final Thread |
| 2% | builtin-04 Outer Ring, builtin-09 Clockwork, builtin-16 Shepherd Moon |
| 5% | builtin-03 Hidden Pull, builtin-11 Boomerang, builtin-24 Triple Threat, builtin-25 Gravity Braids, builtin-28 Deep Well, builtin-30 Long Way Round |
| 10% | builtin-01 Falling Star, builtin-08 Silent Orbit, builtin-15 Crossroads, builtin-26 Triad |
| 20% | builtin-07 Long Burn, builtin-17 Periapsis, builtin-19 Slingshot School |
| 50% | builtin-18 Figure Eight |
| >50% | builtin-10 Home Stretch, builtin-12 Pocket Transfer, builtin-20 Twin Arc, builtin-21 Lagrange-ish, builtin-22 Dark Passage, builtin-23 The Squeeze, builtin-31 Dark Matter Lesson |

**Caveat, stated plainly:** this fragility number is a property of the *specific tape I found* for
that level, not a fundamental property of the level's solvability space — a differently-shaped
solution (e.g. a later, gentler correction burst instead of an aggressive one at tick 0) could well
be more robust. It's still a real, reproducible, useful signal for "which of these committed tapes
will need re-authoring first" after any future physics change, which is what the task doc asks for.

Solve-time-only ranking (fastest to reach goal, no perturbation) is also printed by every
`run.test.ts` run via a `console.log` in `afterAll` — fastest is `builtin-10` Home Stretch at 28
ticks (~0.19s), slowest is `builtin-00` Orbital Primer at 2109 ticks (~14.6s).

## What the solvability suite covers today vs. what was stubbed

**Today (final state, after T-01 landed):** everything is real. `physics-adapter.ts`'s dynamic
import resolves to the actual `physics.ts`; `run.test.ts` replays each of the 33 real tapes against
the real simulator and asserts `TickResult.reachedGoal` becomes true within the tape's tick horizon;
all 33 pass. Nothing is stubbed or skipped in the committed, final state.

**What's still stub infrastructure, kept deliberately (not vestigial — this is the resilience the
orchestrator asked for):** `physics-adapter.ts` still goes through a dynamic `import()` rather than
a static one, and still degrades to a loud, per-level `it.skip(...)` plus a console banner if
`physics.ts` is ever unavailable (a checkout without T-01's work, a future refactor that
temporarily breaks the export, etc.). This was exercised for real earlier in this session (see
`notes/T-03-ATLAS/log.md`) — the suite genuinely skipped rather than passing vacuously — before
`physics.ts` landed and it started running for real. No consumer of `level.ts`'s public API
(`BUILTIN_LEVELS`, `hydrate`, `serialize`, `validate`, `levelId`, `customLevelId`) depends on
`physics.ts` at all; only this test-only harness does.

## Key decisions (full reasoning in `notes/T-03-ATLAS/log.md`)

- **`size` default is 10 for every body type** (not Godot's actual per-type runtime default of sun
  18 / player 12 / planet 10), matching the frozen `Body.size` doc comment in `types.ts` and the
  task doc's defaults table exactly. In the reference data this only ever affects the player (the
  only type that ever omits `size`); no sun or planet's hydrated size is affected.
- **`turn_speed`**: deterministic pseudo-spin `-2.0 - ((index * 0.37) % 1.0)`, `index` being the
  object's position in `Level.objects`. Lands in the same (-3, -2] band as Godot's
  `randf_range(-3.0, -2.0)`, zero randomness, per-object-index so it's still visually varied.
- **`boost_type`** is copied through raw on hydrate (no clamping to 0-3, no ±1 offset), because the
  reference data stores it 1-indexed for players and Godot's own runtime never actually reads a
  player's persisted `boost_type` for gameplay (it substitutes the user's equipped Settings skin
  instead) — clamping would have both been unfaithful to the source data and broken the round-trip.
- **`serializeObject()`'s field-omission rule is per-field, mixing type-gating and value-gating** —
  not a uniform "omit if equals default." This was derived from an actual census of the 33 levels'
  ~154 objects (in `notes/T-03-ATLAS/log.md`), not assumed: e.g. sun `visible` is *always* explicit
  in the source data (even when `true`, the "default"), so a naive value-based omission rule would
  have broken the round-trip; only `anchored` and `turn_speed` are safe to omit by value in this
  dataset.
- **JSON import without `resolveJsonModule`**: `import levelsData from "./levels.json" with { type:
  "json" }` type-checks cleanly under the existing (unmodified, not-owned-by-me) root
  `tsconfig.json`, which has no `resolveJsonModule`. Verified empirically across `tsc`, plain
  `node`, and `vitest` before committing to it — no ambient `.d.ts` file needed, no tsconfig edit
  needed, both of which were out of my ownership anyway.
- **`customLevelId`**: `slug(name) + "-" + djb2(JSON.stringify(level))`, exactly as INTERFACES.md
  specifies. Tested that it's deterministic, that editing OR renaming a level changes the id (the
  documented consequence), and that an empty/symbols-only name falls back to a non-empty slug.
- **`levelId`**: `"builtin-" + index padded to 2 digits`, e.g. `levelId(4) === "builtin-04"`. Godot's
  `DataManager.score_key("builtin", 4) === "builtin_4"` maps directly: same index, just
  underscore-to-hyphen and zero-padded, documented in a code comment for T-10 VAULT's migration.
