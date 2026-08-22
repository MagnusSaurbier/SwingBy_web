# T-01 KEPLER — results

## STATUS: DONE-PENDING-TRACES. NOT DONE.

**The 33 Godot reference traces are outstanding. The parity gate (`parity.test.ts`) has
never run against real Godot output — it is architecturally wired up and correctly
*skips loudly* (not silently passes) because `packages/core/test/parity/traces/` is
empty.** Godot is not available in the container this task was implemented in, so no
trace was generated and none was invented — inventing one would have made the parity
suite green against physics nobody had checked, which is explicitly worse than the
current honest "unrun" state. Everything else in this document is real and measured, but
none of it is a substitute for that gate. Do not mark T-01 complete until:

1. Someone with Godot 4.6 + a `SwingBy2026` checkout runs the command in
   ["Generating the traces"](#generating-the-traces-the-one-remaining-step) below,
2. the resulting `traces/level-*.json` files are committed, and
3. `npx vitest run packages/core/test/parity` is re-run and its printed per-level
   divergence numbers are checked against the Definition-of-done bounds.

---

## Deliverables

| # | Artifact | Path | Status |
|---|---|---|---|
| 1 | `physics.ts` — all five exported functions | `packages/core/src/physics.ts` | **Done.** Ports every function in `PhysicsEngine.gd`; typechecks clean; `Math.pow`-free. Not yet checked against Godot (see above). |
| 2 | GDScript trace exporter, runnable headless | `tools/godot-trace/trace.gd` | **Done, but untested.** Written carefully against the real `PhysicsEngine`/`GameConstants` classes (calls them, never reimplements them). Could not be run — no Godot in this container. Needs a real run to confirm it doesn't have a syntax/API-usage mistake. |
| 3 | 33 reference traces, committed | `packages/core/test/parity/traces/level-*.json` | **Outstanding.** Directory contains only `.gitkeep` explaining why it's empty. |
| 4 | Parity test suite | `packages/core/test/parity/parity.test.ts` | **Done, unrun for real.** Consumes the documented trace format, measures max divergence per level/section, and — critically — dynamically **skips** (vitest "skipped" status, not "passed") with a loud banner when no traces are present. Currently: 1 test, skipped. |
| 5 | Measured divergence table | (this file, in the PR description) | **Cannot be produced yet** — no traces to diverge against. Table will be per-level `zeroInput` / `scriptedInput` / `prediction` / (`longRun` for level 0) max-abs-position divergence once traces land. |

**Additional, not in the original deliverables table but load-bearing while traces are
outstanding:**

| Artifact | Path | Status |
|---|---|---|
| Trace format specification | `packages/core/test/parity/README.md` | **Done.** Exact JSON schema, the canonical scripted input tape, generation command, and the reasoning behind excluding `angle`/`turnSpeed`. |
| Self-consistency suite (no Godot needed) | `packages/core/test/parity/self-consistency.test.ts` | **Done and green.** 35 tests, 0 failures. See below — this is the real safety net until the traces land. |
| Working log | `notes/T-01-KEPLER/log.md` | **Done, ongoing.** Gotcha-by-gotcha derivation trail, the `outOfBounds` judgment call, a real arithmetic mistake caught and fixed mid-session, and the sign-flip proof. |

---

## Definition of done

- [ ] All 33 levels, 2,000 ticks of zero input: max absolute position divergence **< 1e-6** world units
  — **Cannot verify. No traces.**
- [ ] All 33 levels with a scripted boost/brake tape: same bound
  — **Cannot verify. No traces.** (The scripted tape itself is fully specified and implemented on both the TS and GDScript sides — see README.md — ready to run the instant traces exist.)
- [ ] A 10,000-tick run on level 1 stays under **< 1e-3** (drift accumulation check)
  — **Cannot verify. No traces.** (`trace.gd` emits this as `level-00.json`'s `longRun` section; `parity.test.ts` has the assertion wired up and ready.)
- [ ] `predict()` matches `recalculate_predictions` sample-for-sample
  — **Cannot verify against Godot. No traces.** Self-consistency suite does check `predict()`'s own internal behavior (never mutates `world`, correct sample counts, horizon-shortening thresholds) — see below — but that is not the same claim as matching Godot's actual numbers.
- [ ] Traces committed and the suite passes **on a machine without Godot installed**
  — **Not applicable yet — traces don't exist.** The suite *does* already run correctly on a machine without Godot: it skips loudly rather than failing or vacuously passing. That half of this requirement is met; the "traces committed" half is not.
- [x] `grep -n "Math.pow" packages/core/src/physics.ts` returns nothing
  — **True.** Verified below. (One gotcha along the way: my own explanatory comment originally contained the literal substring "Math.pow" as prose, which the grep would have flagged. Reworded — see log.)
- [x] No import outside `./types` and `./constants`; no clock, no RNG, no globals
  — **True.** `physics.ts`'s only imports are `./types.js` and `./constants.js`. No `Date`, no `Math.random`, no `window`/`document`/`process` reference anywhere in the file.
- [ ] Plus the global checklist in PROJECT.md §7 — see below, item by item.

### PROJECT.md §7 global checklist

- [x] `npm run typecheck` clean — no `any` in `packages/core`, no `@ts-expect-error` left behind. Verified project-wide (output below), and specifically `grep -n "\bany\b"` / `grep -n "ts-expect-error"` on `physics.ts` both return nothing (the only two hits for the word "any" are inside English prose in comments — "before **any** substep runs" — not the TypeScript type).
- [x] `npm test` green, including other tasks' suites, as far as this task's files affect them — see "Bonus: T-03 ATLAS's solvability harness" below for a concrete cross-task check. (I did not run every workspace's full suite; T-14 LAUNCHPAD's and others' files are outside my visibility/ownership and other agents are actively editing them per the environment brief.)
- [x] No file outside my ownership row was modified. Touched only: `packages/core/src/physics.ts`, `packages/core/test/parity/**`, `tools/godot-trace/**`, plus `notes/T-01-KEPLER/log.md` and `results/T-01-KEPLER.md` per this task's explicit instructions. (A throwaway probe test file, `packages/core/test/parity/zzprobe.test.ts`, was created to numerically check a test parameter and deleted before finishing — never left in place.)
- [x] No new runtime dependency in `packages/core` — `physics.ts` imports only `./types.js`/`./constants.js`, both already in the package.
- [x] Interfaces consumed are unchanged. `physics.ts` implements exactly the five signatures frozen in `INTERFACES.md#corephysicsts--t-01-kepler`, no deviation.
- [x] Anything measured is reported as a number — see "Measured numbers" below.
- [ ] UI work includes a screenshot — not applicable, this task has no UI.

---

## Measured numbers

Commands run from the repo root, `/home/user/SwingBy_web`.

### `npx vitest run packages/core/test/parity`

```
 Test Files  2 passed (2)
      Tests  35 passed | 1 skipped (36)
```

- `parity.test.ts`: **1 test, 1 skipped** (loud banner printed, reproduced below). This is the
  correct, designed-for outcome while `traces/` is empty — not a false green.
- `self-consistency.test.ts`: **35 tests, 35 passed, 0 failed.**

Skip banner, verbatim:

```
############################################################################
#  PARITY GATE DID NOT RUN.                                               #
#  packages/core/test/parity/traces/ contains no level-*.json files.      #
#  physics.ts has NOT been checked against the real Godot engine.         #
#  This is expected in a container without Godot installed — see          #
#  packages/core/test/parity/README.md for how to generate the traces     #
#  and results/T-01-KEPLER.md for full status.                            #
#  This test is SKIPPED, not passed — do not read a green run here as     #
#  parity proof.                                                          #
############################################################################
```

Same result via `npm test -w @swingby/core -- parity`.

### `npx tsc --noEmit -p tsconfig.json`

Output: **empty. Exit code 0.** (This is a project-wide check, per the environment
notes other tasks' files may have errors that are not mine to fix — there were none at
all at the time of this run.)

### `grep -n "Math.pow" packages/core/src/physics.ts`

Output: **empty.** (grep exit code 1 = no match.)

### Self-consistency suite — notable measured values (all printed by the suite itself)

- Two-body circular orbit (G=8000, r=800, one full period = 1590 ticks, zero input):
  `maxRadiusDeviation=0.458%`, `finalDistFromStart=21.238` world units (bound: < 5% of r = 40),
  `energyDrift=0.0000%`, `angularMomentumDrift=0.0000%` (bounds: < 3% and < 1% respectively).
- Per-substep-zeroing check (gravity=4,000,000 at distance=300, substeps=7): real
  simulateTick output matches the correct (zero-per-substep) hand-rolled model to
  `|real-correct|=0`, and diverges from the buggy (zero-per-tick) hand-rolled model by
  `|real-buggy|=139.57` (real xVel=-45.8998, buggy model's would-be xVel=-185.4696 — a
  ~4x error the test is built to catch).
- `predict()` horizon shortening: player-sample counts of 200 / 134 / 100 for 2 / 5 / 7
  moving bodies respectively, confirming both the `>4` and `>6` threshold cuts fire.

### Deliberate sign-flip proof

Changed `applyGravityAcceleration`'s `body.xAcc -= (source.gravity * dx) / dist15;` to
`body.xAcc += (source.gravity * dx) / dist15;` (x-axis only, left y correct — an
asymmetric flip, not a wholesale negation, specifically so the proof shows the suite
catches a single-axis sign bug, not only a fully-inverted one).

Ran `npx vitest run packages/core/test/parity/self-consistency.test.ts`:

```
 Test Files  1 failed (1)
      Tests  6 failed | 29 passed (35)
```

Failures, with the actual numbers (not just red/green):

| Test | Failure |
|---|---|
| `sign convention (gotcha #4) > a body pulls toward a source...` | dot product `9.954303374937941` (expected `< 0`) |
| `golden values > gravity acceleration...` | `xAcc` came out `0.08447735669133895` instead of `-0.08447735669133895` — exact sign inversion on x, y unaffected, matching the asymmetric flip |
| `two-body circular orbit > stays bounded...` | `maxRadiusDeviation` `640.098%` (bound `< 3%`); the "orbit" flew apart |
| `two-body circular orbit` energy/momentum (same test) | `energyDrift=201.7020%`, `angularMomentumDrift=181.2677%` |
| `symmetry > rotating 90 degrees...` | off by `3184.78` world units |
| `skip rules > skip driven purely by gravity value...` | `xVel` `0.196...` (expected `< 0`) |
| `semi-implicit Euler ordering > position update uses the NEW velocity...` | `xVel` `2.179...` (expected `< 0`) |

Reverted immediately after capturing this output. Re-ran the full
`packages/core/test/parity` suite: back to **35 passed, 1 skipped**. Confirmed via
`grep -n "body.xAcc -= " packages/core/src/physics.ts` that the restored line matches
the original exactly (`body.xAcc -= (source.gravity * dx) / dist15;`).

**Conclusion: the self-consistency suite is not vacuous. A real, plausible porting bug
(a single-axis sign error) makes 6 of 35 tests fail, with failure output that points at
the actual broken mechanism (attraction vs. repulsion), not a generic assertion
message.**

### Bonus: T-03 ATLAS's solvability harness (independent, cross-task signal)

Not part of this task's deliverables, but worth recording: T-03 ATLAS is developing
concurrently in the same working tree and has already built
`packages/core/test/level/solvability/run.test.ts` — 33 hand/grid-search-verified input
tapes, one per built-in level, replayed through `physics.ts` via a dynamic-import
adapter (`physics-adapter.ts`) that was written to skip loudly if `physics.ts` didn't
exist yet. Since `physics.ts` now exists, this suite exercises it for real:

```
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 109 passed (110)
```

32 of 33 levels reach their goal using T-03's tapes and this task's `physics.ts`
(solve times ranging from 28 to 2016 ticks — printed table omitted here, see that
suite's own output). The one failure (`builtin-00`) is an intentional, explicitly
commented "DO NOT COMMIT" perturbation T-03 left in their own test file to prove *their*
harness bites (a 5% velocity perturbation on a clone of the level, not a change to the
real level or to `physics.ts`) — not a bug in this task's physics port. This is
independent, real-world-shaped evidence (real levels, real goal-capture geometry, tapes
nobody derived by hand from `PhysicsEngine.gd` the way this task's golden values were)
that `physics.ts` behaves sensibly end-to-end. It is still not Godot parity — a
consistent-but-wrong port could in principle still let a grid search find solutions —
but it is a meaningfully different kind of check than anything in this task's own suite,
and it came back clean.

---

## Generating the traces (the one remaining step)

Run on a machine with Godot 4.6+ (needs `JSON.stringify`'s `full_precision` parameter,
added in 4.3 — without it every tolerance in this suite is meaningless) and a checkout of
`MagnusSaurbier/SwingBy2026`:

```bash
cd /path/to/SwingBy_web        # trace.gd writes output relative to this cwd
/Applications/Godot.app/Contents/MacOS/Godot --headless \
  --path /path/to/SwingBy2026 \
  --script tools/godot-trace/trace.gd
```

This writes `packages/core/test/parity/traces/level-00.json` .. `level-32.json`. Commit
them, then re-run:

```bash
npx vitest run packages/core/test/parity
```

and read the printed per-level, per-section max-divergence numbers against the
Definition-of-done bounds above (`< 1e-6` for the 2000-tick zero/scripted runs and the
prediction check, `< 1e-3` for level 0's 10,000-tick drift check).

**Also do the determinism check once** (see `packages/core/test/parity/README.md`): run
the exporter twice and diff the two output directories — they must be byte-identical.
`trace.gd` seeds `turn_speed` to a fixed constant specifically so this holds; if it
doesn't, something else in the engine path is non-deterministic and needs to be found
before the traces mean anything.

**If `trace.gd` fails to run at all** (untested — no Godot in the container this was
written in): the most likely failure points, in order of my own confidence, are (1) the
output-directory path resolution (`DirAccess.make_dir_recursive_absolute` with a
non-`res://`/`user://` relative path — documented as resolving against the OS working
directory in Godot 4, but not verified here), and (2) the `JSON.stringify(..., true,
true)` four-argument call shape for `full_precision` (verified against my knowledge of
the Godot 4.3+ API, not against a running engine). Both are flagged with comments at
their call sites in `trace.gd`.

---

## The `outOfBounds` judgment call — flagged for T-05 FLYWHEEL

`TickResult.outOfBounds` is part of the frozen `types.ts` contract, but the bounds
rectangle in the actual Godot reference (`GameWorld._check_world_bounds`,
`GameWorld.gd:694-717`) is measured relative to `world_origin`, which is reset every
render frame to half the on-screen **viewport's pixel size** — a rendering/window-size
quantity `packages/core` cannot and should not depend on (Hard rule: browser-free,
node-safe; also two clients with different window sizes would get different bounds for
an identical trajectory, which cannot be right for server-side score verification).

`physics.ts` instead measures `outOfBounds` from a **fixed** world-space origin `(0, 0)`:
`|player.x| > MAX_WORLD_BOUNDS_X || |player.y| > MAX_WORLD_BOUNDS_Y`. Reasoning (full
detail in `notes/T-01-KEPLER/log.md`):

- `constants.ts`'s own comment for these constants already says "half-extents from
  origin" — a fixed origin is already implied, just not which one.
- All 33 levels' object coordinates fall in x∈[180,1660], y∈[100,820] — comfortably
  inside a fixed ±2600×±1800 box, the same order of magnitude as Godot's dynamic,
  window-size-dependent box. This is a generous "you flew way too far, auto-reset"
  crash guard, not a tight gameplay boundary, so it is not required to reproduce Godot's
  literal (and inherently non-reproducible) window-size-tied number for solvability.
- `tasks/T-05-FLYWHEEL.md` (bounds.ts's owner) itself describes the box as "half-extents
  MAX_WORLD_BOUNDS_X/Y (2600×1800)" with no dynamic-origin mention either.

This is a judgment call, not something verifiable against a trace (window-size-dependent
behavior isn't reproducible even with Godot available). If T-05 FLYWHEEL's bounds.ts
needs different semantics here, that's an INTERFACES.md conversation, not a silent
divergence — flagging explicitly rather than burying it.

---

## For whoever owns `packages/core/src/index.ts`

That file is not in this task's ownership row and was not touched. It needs:

```ts
export * from "./physics.js";
```

added alongside the existing `export * from "./types.js"` / `export * from
"./constants.js"` lines, so `@swingby/core`'s public surface actually includes
`substepCount`, `gravitySofteningRadius`, `applyGravityAcceleration`, `simulateTick`, and
`predict`.
