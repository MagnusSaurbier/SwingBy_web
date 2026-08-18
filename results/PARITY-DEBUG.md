# PARITY-DEBUG — T-01 KEPLER's first real Godot parity run

**Session date:** 2026-08-18. Two rounds. Round 1 debugged CI run `32171277521`
(commit `b536562`) — the first `parity-traces.yml` run to successfully export traces,
pass the determinism check, and execute the parity suite for real. Round 2 debugged
CI run `32173199002` (commit `2e8ada9`, the round-1 fix pushed by the coordinator) and
workflow_dispatch run `32173910468` (triggered mid-round-2 to get real trace data
committed to git). **Status: both root causes found, both fixed. The complete,
official 33-level real trace set (from workflow_dispatch run `32173910468`, landed
locally via the orchestrator's `git pull`) now runs clean through the actual
`parity.test.ts` suite: 141/141 tests pass — every level, every assertion
(zeroInput, scriptedInput, predict, plus level-00's 10,000-tick longRun). The one
thing not yet confirmed is the GitHub Actions job itself reporting green end-to-end
with this exact `parity.test.ts` committed — see "What still needs a CI run".**

## Root cause, stated plainly — there were two, independent, in different files

### Bug 1 — `packages/core/src/physics.ts` (the port): missing float32 gotcha

GDScript's scalar `float` keyword is 64-bit — correct, and already documented. But
`Vector2`'s `x`/`y` components are typed `real_t`, which is **32-bit** `float` in the
standard (non-`precision=double`-build) Godot 4 binary — exactly the binary
`.github/workflows/parity-traces.yml` downloads. `PhysicsEngine.gd` constructs a
`Vector2` from 64-bit values and calls a method on it (which computes entirely in
32-bit float) in exactly three places that feed a traced quantity:
`substep_count`'s `body_speed` (`:10`), `apply_player_input`'s `speed` (`:117-118`),
and `recalculate_predictions`'s per-sample output points (`:204`/`:207`). `physics.ts`
used plain `Math.sqrt`/raw float64 storage at all three. This caused the
`predict() matches recalculate_predictions` failure (`parity.test.ts:334`) and was a
**secondary, non-dominant** contributor to the scripted-input failure.

### Bug 2 — `packages/core/test/parity/parity.test.ts` (the harness): off-by-one tick index

`tools/godot-trace/trace.gd`'s `_run_scripted_input` loops
`for tick in range(1, total_ticks + 1)` — **1-indexed**. Its `tick`-th call to
`_physics_tick` evaluates `_input_at_tick(transitions, tick)` using that SAME
1-indexed `tick` — the physics step that advances state from "tick-1 done" to "tick
done" uses input evaluated at tick number `tick`.

`parity.test.ts`'s `replayAndMeasure` instead called `inputAt(currentTick)`, where
`currentTick` is **0-indexed** ("ticks completed so far", evaluated *before* the step
about to run). For the step advancing "49 ticks done" to "50 ticks done" (trace.gd's
tick 50, the first scripted boost transition), the harness called `inputAt(49)` —
`pressedAtTick(BOOST_TRANSITIONS, 49)` is `false` (pre-transition), while
`pressedAtTick(BOOST_TRANSITIONS, 50)` is `true` (post-transition) — so the harness
applied boost one physics step later than trace.gd actually did, at exactly the
transition. This caused the `scripted boost/brake divergence` failure
(`parity.test.ts:307`), and was its **entire, dominant** cause — bug 1's contribution
to this same failure was real but negligible by comparison (~1e-7 relative).

`pressedAtTick`/`_input_at_tick` are byte-identical **pure functions** — that
comparison, done early in this investigation, was correct and remains correct. The
bug was never in the predicate; it was in which tick number the call site fed it.

## Port or harness — both, in different places, unambiguously

- **Bug 1 is in the port** (`physics.ts`). `trace.gd` needed no change for it — it
  calls the real Godot engine directly and inherits real Godot's float32 behavior for
  free; `physics.ts` had to be taught to reproduce it deliberately.
- **Bug 2 is in the harness's test-only replay logic** (`parity.test.ts`), not in
  `physics.ts` and not in `trace.gd`. `simulateTick`/`applyPlayerInput` themselves
  were proven correct in isolation (see "How bug 2 was found" below) — the harness was
  simply feeding them the wrong tick's input at the transition boundaries.

Both are real bugs a plausible reviewer could miss: bug 1 because the file's own
"GDScript floats are 64-bit" comment was true but incomplete (about `Vector2`
specifically); bug 2 because the two implementations of the *predicate* really are
identical, and it takes noticing the *calling convention* differs to catch it.

## How bug 2 was found (bug 1 was round 1's work — see the full log for its discovery)

Round 2 started from the coordinator's evidence: after bug 1's fix, `predict()`
(parity.test.ts:334) stopped failing entirely, but `scriptedInput` divergences were
"essentially unchanged — same magnitudes, differing only in the last few digits" (their
exact framing: *"An error that stays at ~37 units after a precision fix is not a
precision problem at all — it is behavioral"*). That framing was exactly right and is
what pointed this round away from more precision work.

1. Got real trace JSON this time (round 1 could not — see its part of the log).
   `download_workflow_run_artifact` still 403s at the network layer (confirmed again,
   same failure). Fired a fresh `workflow_dispatch` run (`32173910468`, via
   `mcp__github__actions_run_trigger` — a workflow-trigger API call, not a git
   operation) with `commit_traces: true`, which used round 1's already-pushed workflow
   reorder to commit all 33 real traces to the branch. Fetched 4 of them (levels
   00, 13, 21, 31 — chosen to span the pre-fix divergence range, including the worst
   case at 296 units) via `mcp__github__get_file_contents` and saved them locally.
2. **Isolated `applyPlayerInput` from gravity entirely**: single player body,
   `gravity: 0`, no other bodies (so `substepCount` is always exactly the base
   `PHYSICS_SUBSTEPS = 4`), run through the full 2000-tick scripted tape, checked
   against the closed-form invariant (`speed += BOOST_STRENGTH` per whole tick boost
   is held — a real telescoping identity, true regardless of substep count, not an
   approximation). **0 of 2000 ticks disagreed by more than 1e-6**; final drift
   ~1.66e-11 (float rounding only). This proved the boost/brake math itself was
   correct — the bug had to be either an interaction with gravity, or upstream of
   `applyPlayerInput` entirely (i.e., in what input it was even called with).
3. **Bisected the real level-31 trace tick-by-tick.** Position divergence was
   ~1e-13 (pure float noise) for every sampled tick from 0 through 40, then jumped to
   3.014e-3 at **tick 50 exactly** — the first scripted boost transition — and grew
   steadily from there to the same ~37-unit scale CI reported by tick 2000. A jump
   that appears at exactly a transition boundary and not gradually is the signature of
   an indexing bug, not a physics bug.
4. **Tick-50 close-up, decisive test.** Advanced a fresh world through ticks 0-48
   using the harness's own (0-indexed) input convention, captured that state (matched
   the trace to ~1e-13, confirming setup was correct), then ran ONE more tick using
   `scriptedInputAtTick(50)` directly — not `(49)`, which is what the harness's actual
   loop would use for this transition — and got a result matching the trace's tick-50
   sample to 13-14 significant digits. Identical code, only the tick-index argument
   differing by one, produced perfect agreement instead of 3e-3 disagreement. That
   pinpointed the exact bug precisely (see "Root cause" above for the mechanism).

## Fixes applied (session total: two files, two commits' worth of work)

**Round 1**, `packages/core/src/physics.ts`: added `vector2LengthF32(x, y)`, rounding
to float32 (`Math.fround`) at every intermediate step of `sqrt(x*x+y*y)`, used at
`substepCount`'s `bodySpeed` and `applyPlayerInput`'s `speed`; `Math.fround` applied
directly to `predict()`'s output points. Not `Math.pow`. One self-consistency test
(`speed===0` boost, hand-derived) was corrected to re-derive its expected value via
the same float32-per-step recurrence rather than assuming pure float64 — a real
consequence of the fix, not a loosened assertion (see round 1's log entries for the
full derivation and independent Float32Array cross-check).

**Round 2**, `packages/core/test/parity/parity.test.ts`: `replayAndMeasure`'s inner
loop now calls `inputAt(currentTick + 1)` instead of `inputAt(currentTick)`.
Documented the 1-indexed convention in both `replayAndMeasure`'s and
`scriptedInputAtTick`'s doc comments, with the transition-boundary reasoning that
found it. `zeroInput`/`longRun` pass `() => ZERO_INPUT` (ignores its argument), so
this change provably cannot affect them — confirmed empirically: their divergence
numbers are byte-identical before and after this fix.

**`physics.ts` needed no further change in round 2.** `predict()` at 5e-12 to 5e-13
across all 4 real levels fetched (round 2), including planet tracks, confirms round
1's fix was already complete and correct.

## Per-level divergence — before and after, real numbers throughout

**Before (round 1 baseline, CI run `32171277521`, no fixes applied at all)** — all 33
levels, from the verbose reporter's real console output:

| level | zeroInput | scriptedInput | predict (player) | predict (planets) |
|---|---|---|---|---|
| 00 | 1.468e-10 | 1.339e+1 | 6.059e-5 | 0.000e+0 (no planets) |
| 01 | 7.945e-10 | 1.385e+1 | 5.745e-5 | 6.075e-5 |
| 02 | 1.660e-11 | 4.095e+1 | 6.015e-5 | 6.069e-5 |
| 03 | 6.310e-12 | 1.049e+1 | 6.062e-5 | 0.000e+0 (no planets) |
| 04 | 5.912e-12 | 2.376e+1 | 6.083e-5 | 6.097e-5 |
| 05 | 2.569e-11 | 2.799e+1 | 6.086e-5 | 6.084e-5 |
| 06 | 7.014e-11 | 2.107e+1 | 4.706e-5 | 6.103e-5 |
| 07 | 1.569e-11 | 1.008e+1 | 5.985e-5 | 6.102e-5 |
| 08 | 7.390e-12 | 1.548e+1 | 5.548e-5 | 5.940e-5 |
| 09 | 7.617e-11 | 1.246e+1 | 5.966e-5 | 6.073e-5 |
| 10 | 4.013e-10 | 2.056e+1 | 5.985e-5 | 6.095e-5 |
| 11 | 5.912e-12 | 8.820e+0 | 6.100e-5 | 6.078e-5 |
| 12 | 1.779e-10 | 6.745e+0 | 6.089e-5 | 6.027e-5 |
| 13 | 1.683e-11 | 4.623e+0 | 5.068e-5 | 6.032e-5 |
| 14 | 5.036e-11 | 3.512e+0 | 5.908e-5 | 5.963e-5 |
| 15 | 7.628e-11 | 6.308e+1 | 5.721e-5 | 5.972e-5 |
| 16 | 4.468e-11 | 3.975e+0 | 6.097e-5 | 6.102e-5 |
| 17 | 1.751e-11 | 2.519e+1 | 6.001e-5 | 6.100e-5 |
| 18 | 2.952e-11 | 1.818e+1 | 6.036e-5 | 6.094e-5 |
| 19 | 8.640e-11 | 9.075e+0 | 6.090e-5 | 6.086e-5 |
| 20 | 2.361e-10 | 3.727e+1 | 6.010e-5 | 6.083e-5 |
| 21 | 4.104e-9  | 2.960e+2 | 3.035e-5 | 6.085e-5 |
| 22 | 2.910e-10 | 4.687e+0 | 3.041e-5 | 6.084e-5 |
| 23 | 2.279e-11 | 3.274e+0 | 6.079e-5 | 5.987e-5 |
| 24 | 1.342e-10 | 3.649e+1 | 5.968e-5 | 6.016e-5 |
| 25 | 5.313e-8  | 2.390e+1 | 5.987e-5 | 6.048e-5 |
| 26 | 1.020e-8  | 9.224e+0 | 6.035e-5 | 6.093e-5 |
| 27 | 1.039e-10 | 2.815e+1 | 5.801e-5 | 6.083e-5 |
| 28 | 1.353e-10 | 8.109e+0 | 6.003e-5 | 6.079e-5 |
| 29 | 7.276e-12 | 6.430e+0 | 6.009e-5 | 6.011e-5 |
| 30 | 6.821e-12 | 6.607e+0 | 5.870e-5 | 6.103e-5 |
| 31 | 1.251e-11 | 3.772e+1 | 6.068e-5 | 6.101e-5 |
| 32 | 1.468e-10 | 2.208e+1 | 6.103e-5 | 6.094e-5 |

**Middle (round 1 fix only, CI run `32173199002`, all 33 levels)** — `predict()`
dropped to ~5e-12 to 5e-13 (essentially float64 noise) on EVERY level; `scriptedInput`
barely moved (round 1's fix was real but not the dominant cause):

| level | scriptedInput before | scriptedInput after bug-1 fix only | change |
|---|---|---|---|
| 31 | 37.71641448304729 | 37.71641463402739 | ~1e-7 relative |
| 32 | 22.084063903944752 | 22.084065630370787 | ~1e-7 relative |
| 12 | 6.607339730135664 | 6.607338525283922 | ~1e-7 relative |

**After — complete, official 33-level result.** Round 2 first verified against 4
manually-fetched real traces (levels 00, 13, 21, 31 — chosen to include the two worst
pre-fix outliers), then the orchestrator's `git pull` brought in the full 33-file set
committed by workflow_dispatch run `32173910468`, and the real `parity.test.ts` suite
was re-run against all 33 real, CI-produced traces with both fixes applied:

| level | scriptedInput before | scriptedInput after |
|---|---|---|
| 00 | 1.339e+1 | 4.547e-12 |
| 01 | 1.385e+1 | 9.132e-11 |
| 02 | 4.095e+1 | 1.660e-11 |
| 03 | 1.049e+1 | 6.139e-12 |
| 04 | 2.376e+1 | 6.594e-12 |
| 05 | 2.799e+1 | 1.660e-11 |
| 06 | 2.107e+1 | 1.228e-11 |
| 07 | 1.008e+1 | 6.139e-12 |
| 08 | 1.548e+1 | 5.002e-12 |
| 09 | 1.246e+1 | 7.617e-11 |
| 10 | 2.056e+1 | 2.394e-10 |
| 11 | 8.820e+0 | 5.912e-12 |
| 12 | 6.745e+0 | 1.421e-11 |
| 13 | 4.623e+0 | 1.683e-11 |
| 14 | 3.512e+0 | 5.036e-11 |
| 15 | 6.308e+1 | 6.139e-12 |
| 16 | 3.975e+0 | 8.640e-12 |
| 17 | 2.519e+1 | 1.751e-11 |
| 18 | 1.818e+1 | 2.952e-11 |
| 19 | 9.075e+0 | 8.640e-11 |
| 20 | 3.727e+1 | 2.361e-10 |
| 21 (worst before, 296 units) | 2.960e+2 | 4.041e-9 |
| 22 | 4.687e+0 | 5.912e-12 |
| 23 | 3.274e+0 | 8.811e-12 |
| 24 | 3.649e+1 | 4.093e-11 |
| 25 (largest remaining, still ~20000x under tolerance) | 2.390e+1 | 5.065e-8 |
| 26 | 9.224e+0 | 1.412e-10 |
| 27 | 2.815e+1 | 1.039e-10 |
| 28 | 8.109e+0 | 5.002e-12 |
| 29 | 6.430e+0 | 5.230e-12 |
| 30 | 6.607e+0 | 5.002e-12 |
| 31 | 3.772e+1 | 8.413e-12 |
| 32 | 2.208e+1 | 1.468e-10 |

Every one of the 33 pre-fix failures (3.27 to 296 world units) is now under 6e-8 —
most under 1e-10 — against the 1e-6 tolerance. `zeroInput` and `predict()` were
already passing and stayed passing at their round-1-fix values (predict at ~5e-12 to
5e-13, unaffected by round 2's fix, which is exactly expected since round 2 only
touches `scriptedInputAtTick`'s call site). Level-00's 10,000-tick `longRun` also
passes, at 1.871e-7 against its 1e-3 tolerance.

**`npm test -w @swingby/core -- parity`: 141/141 tests passed** — every one of the 33
levels' 3 assertions (zeroInput, scriptedInput, predict) plus level-00's longRun, plus
6 bundled `rocket-angle.test.ts` tests. This is the real, complete, official gate, not
a subset or a substitute script.

## Proof the gate still bites — three times, the last against the complete 33-level set

**Round 1** (no real traces available yet): reverted `vector2LengthF32` to plain
`Math.sqrt`, confirmed a self-consistency test regressed to the old-buggy value
(`0.005` instead of `0.005000000043461725`), restored, confirmed green again.

**Round 2, first pass** (against 4 real traces): reverted `replayAndMeasure`'s
`inputAt(currentTick + 1)` back to `inputAt(currentTick)`: 4 failed, 50 passed —
`scriptedInput` failures reappeared at exactly the original CI-observed magnitudes
(13.39, 4.623, 296.0, 37.72), `zeroInput`/`predict`/`longRun` stayed green. Restored,
reran: 54/54.

**Round 2, final pass** (against the complete, official 33-level real trace set —
the strongest version of this proof): reverted the same one line again: **exactly 33
failed, 108 passed** (1 test file failed, 2 passed) — one `scriptedInput` failure per
level, none elsewhere, matching the real CI failure count precisely (CI run
`32173199002` also failed exactly the `scriptedInput` assertion on every one of the
33 levels, nothing else). Restored the fix, reran: back to 141/141 passing.
`npm run typecheck` clean throughout every proof pass in both rounds.

## What still needs a CI run

The fix is now proven, locally, against the complete real 33-level Godot trace set,
through the actual `parity.test.ts` suite — this is no longer an extrapolation from a
subset. What remains unconfirmed is narrower than before: the GitHub Actions job
itself (Godot install, project assembly, trace export, determinism check, then this
exact `parity.test.ts`) has not yet reported green end-to-end in one CI run, because
the two CI runs referenced throughout this document (`32171277521`, `32173199002`)
both predate round 2's fix — they ran the OLD, buggy `replayAndMeasure`. The fix is
already committed on this branch (commit `b81e77c`, alongside round 1's `2e8ada9`).
Recommended: re-run `parity-traces.yml` (`push` or `workflow_dispatch`) against the
current branch HEAD to get the one remaining artifact this investigation could not
itself produce — an official CI job showing every step, including the Godot install
and trace export, green in a single run.

## Related reading

- `notes/T-01-KEPLER/parity-debug.md` — full append-only derivation log for both
  rounds, including every ruled-out hypothesis, the exact diagnostic scripts run and
  their full output, and the `Vector2`/`real_t` research from round 1.
- `results/T-01-KEPLER.md` — the original T-01 KEPLER task writeup (pre-dates this
  debugging session).
