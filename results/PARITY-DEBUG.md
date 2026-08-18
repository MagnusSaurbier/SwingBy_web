# PARITY-DEBUG — T-01 KEPLER's first real Godot parity run

**Session date:** 2026-08-18. **CI run debugged:** `32171277521` (commit `b536562`,
branch `claude/current-limit-usage-0737a4`), the first parity-traces.yml run to
successfully export traces, pass the determinism check, and actually execute the
parity suite against real Godot output.

## Root cause, stated plainly

**The port (`packages/core/src/physics.ts`) was wrong — a missing gotcha, not a
mistranslated one.** The harness (`tools/godot-trace/trace.gd`) is correct; it is a
thin wrapper that calls the real `PhysicsEngine` static functions directly and
reimplements nothing.

GDScript's scalar `float` keyword is 64-bit — the port's original comment ("GDScript
floats are already 64-bit, there is no float32 step to reproduce",
`notes/T-01-KEPLER/log.md` gotcha #8) is correct about that. But `Vector2`'s `x`/`y`
components are typed `real_t`, which is **32-bit** `float` in the standard
(non-`precision=double`-build) Godot 4 binary — exactly the binary
`.github/workflows/parity-traces.yml` downloads
(`Godot_v4.3-stable_linux.x86_64.zip`, the stock release). Gotcha #8 never looked at
`Vector2` specifically and missed this.

`reference/godot/scripts/PhysicsEngine.gd` constructs a `Vector2` from 64-bit values
and calls a method on it (which computes entirely in 32-bit float) in exactly three
places that feed a traced quantity:

| # | Reference (ground truth) | Port (bug, now fixed) |
|---|---|---|
| 1 | `PhysicsEngine.gd:10` — `substep_count`'s `body_speed := Vector2(...).length()` | `physics.ts`'s `substepCount`, was `Math.sqrt(vx*vx+vy*vy)` |
| 2 | `PhysicsEngine.gd:117-118` — `apply_player_input`'s `speed := velocity.length()` | `physics.ts`'s `applyPlayerInput`, same |
| 3 | `PhysicsEngine.gd:204` and `:207` — `recalculate_predictions`'s output `Vector2(float(x), float(y))` per sampled point | `physics.ts`'s `predict()`, was storing raw `body.x`/`body.y` |

Sites 1-2 are a **compounding** error: the float32-rounded `speed` feeds the
boost/brake rescale factor (`share = (speed + step) / speed`), which multiplies the
still-64-bit velocity — every substep a boost/brake key is held re-injects a
~1e-7-relative perturbation, and up to 2000 ticks of gravitationally-coupled,
occasionally-close-flyby motion amplifies that into O(1-300) world-unit divergence,
varying wildly by level (this is the `scripted boost/brake divergence` failure,
`parity.test.ts:307`).

Site 3 is a **one-time output** rounding — it does not feed back into the simulation
(the shadow substep loop stays pure 64-bit throughout; confirmed by reading
`simulate_shadow_substep`, `PhysicsEngine.gd:75-94`, which never touches `Vector2`) —
so it produces a small, near-constant, magnitude-proportional error of
`coordinate * 2^-24` per sampled point (this is the `predict() matches
recalculate_predictions` failure, `parity.test.ts:334`).

## Port or harness — unambiguous answer

**Port.** `physics.ts` needed a fix; `trace.gd` needed none. See
`notes/T-01-KEPLER/parity-debug.md` for the full derivation trail, including why
zero-input parity (2000 ticks, 1e-6 tolerance) staying clean the whole time is fully
consistent with this: `ZERO_INPUT` never triggers site 1-2's boost/brake path, and
site 3 doesn't exist in the zeroInput/scriptedInput trace path at all (those export
raw Dictionary floats, never a `Vector2`).

## Fix applied

`packages/core/src/physics.ts`: added `vector2LengthF32(x, y)`, which rounds to
float32 (`Math.fround`) at every intermediate step of `sqrt(x*x+y*y)` — not just the
final result, since IEEE add/multiply isn't associative across widths and hardware
float32 rounds at every operation. Used at sites 1 and 2. At site 3, applied
`Math.fround` directly to each sampled `x`/`y` before pushing into `predict()`'s
output arrays. Not `Math.pow` — `grep -n "Math.pow" packages/core/src/physics.ts` is
still empty. `packages/core/test/parity/self-consistency.test.ts`'s one affected
test (a hand-derived "speed===0 boost, whole tick" case that assumed pure float64
arithmetic) was corrected to re-derive its expected value via the same
float32-per-step recurrence, not loosened blindly or hardcoded — see that file and
the debug log for the derivation. `parity.test.ts` itself was **not touched** — no
tolerance loosened, no level skipped, no trace edited.

## Per-level divergence — before (real CI numbers) / after (see caveat)

**Before** — from CI run `32171277521`'s job log (`mcp__github__get_job_logs`,
`return_content: true`; the artifact zip itself is unreachable from this session, see
"What could not be verified" below), the verbose reporter's per-level table:

| level | zeroInput (< 1e-6, passing) | scriptedInput (< 1e-6, FAILING) | prediction player (< 1e-6, FAILING) | prediction planets (< 1e-6, FAILING) |
|---|---|---|---|---|
| 00 | 1.468e-10 | **1.339e+1** | **6.059e-5** | 0.000e+0 (no planets) |
| 01 | 7.945e-10 | **1.385e+1** | **5.745e-5** | **6.075e-5** |
| 02 | 1.660e-11 | **4.095e+1** | **6.015e-5** | **6.069e-5** |
| 03 | 6.310e-12 | **1.049e+1** | **6.062e-5** | 0.000e+0 (no planets) |
| 04 | 5.912e-12 | **2.376e+1** | **6.083e-5** | **6.097e-5** |
| 05 | 2.569e-11 | **2.799e+1** | **6.086e-5** | **6.084e-5** |
| 06 | 7.014e-11 | **2.107e+1** | **4.706e-5** | **6.103e-5** |
| 07 | 1.569e-11 | **1.008e+1** | **5.985e-5** | **6.102e-5** |
| 08 | 7.390e-12 | **1.548e+1** | **5.548e-5** | **5.940e-5** |
| 09 | 7.617e-11 | **1.246e+1** | **5.966e-5** | **6.073e-5** |
| 10 | 4.013e-10 | **2.056e+1** | **5.985e-5** | **6.095e-5** |
| 11 | 5.912e-12 | **8.820e+0** | **6.100e-5** | **6.078e-5** |
| 12 | 1.779e-10 | **6.745e+0** | **6.089e-5** | **6.027e-5** |
| 13 | 1.683e-11 | **4.623e+0** | **5.068e-5** | **6.032e-5** |
| 14 | 5.036e-11 | **3.512e+0** | **5.908e-5** | **5.963e-5** |
| 15 | 7.628e-11 | **6.308e+1** | **5.721e-5** | **5.972e-5** |
| 16 | 4.468e-11 | **3.975e+0** | **6.097e-5** | **6.102e-5** |
| 17 | 1.751e-11 | **2.519e+1** | **6.001e-5** | **6.100e-5** |
| 18 | 2.952e-11 | **1.818e+1** | **6.036e-5** | **6.094e-5** |
| 19 | 8.640e-11 | **9.075e+0** | **6.090e-5** | **6.086e-5** |
| 20 | 2.361e-10 | **3.727e+1** | **6.010e-5** | **6.083e-5** |
| 21 | 4.104e-9  | **2.960e+2** | **3.035e-5** | **6.085e-5** |
| 22 | 2.910e-10 | **4.687e+0** | **3.041e-5** | **6.084e-5** |
| 23 | 2.279e-11 | **3.274e+0** | **6.079e-5** | **5.987e-5** |
| 24 | 1.342e-10 | **3.649e+1** | **5.968e-5** | **6.016e-5** |
| 25 | 5.313e-8  | **2.390e+1** | **5.987e-5** | **6.048e-5** |
| 26 | 1.020e-8  | **9.224e+0** | **6.035e-5** | **6.093e-5** |
| 27 | 1.039e-10 | **2.815e+1** | **5.801e-5** | **6.083e-5** |
| 28 | 1.353e-10 | **8.109e+0** | **6.003e-5** | **6.079e-5** |
| 29 | 7.276e-12 | **6.430e+0** | **6.009e-5** | **6.011e-5** |
| 30 | 6.821e-12 | **6.607e+0** | **5.870e-5** | **6.103e-5** |
| 31 | 1.251e-11 | **3.772e+1** | **6.068e-5** | **6.101e-5** |
| 32 | 1.468e-10 | **2.208e+1** | **6.103e-5** | **6.094e-5** |

Note the tell that pinned down site 3 specifically: **planets divergence is exactly
`0.000e+0` on level-00 and level-03, the only two levels with zero planets** — a
logic bug in `predict()`'s loop shape would not care whether planets exist; a
per-sample output-rounding artifact naturally produces zero when there is nothing to
round.

**After:** not measured against real Godot output in this session — see next
section. Locally, with real traces absent, the parity suite still (correctly) prints
its SKIPPED banner. What IS measured after the fix, standing in for it:

- `packages/core/test/parity/self-consistency.test.ts`: 35/35 passing (was 34/35 —
  see "gate still bites" below for the one that changed and why).
- Full monorepo `npm test`: 820 passed, 1 skipped (the Godot suite, still
  legitimately skipped), 0 failed.
- `npm run typecheck`: clean.
- Independent, non-circular verification that the fix's arithmetic is genuinely
  correct float32 (not just "some other formula"): a `Float32Array`-based
  reimplementation of the same length computation, cross-checked against
  `Math.fround`-based `vector2LengthF32` over 200,000 random `(x, y)` pairs spanning
  the world-coordinate range — **0 mismatches**.
- The predicted error model (`coordinate_magnitude * 2^-24`) applied to the real 33
  levels' actual coordinate distribution (`reference/godot/data/levels_builtin.json`,
  min 100 / median 560 / max 1660) predicts rounding error from ~1.5e-5 to ~9.9e-5 —
  bracketing the observed 5.7e-5 to 6.1e-5 band closely.

## Proof the gate still bites

Temporarily reverted `vector2LengthF32` to the old buggy `Math.sqrt(x*x+y*y)` (one
line inserted right after the function signature; real implementation left in place,
unreachable, below it — trivially removable, and was removed). Re-ran
`npm test -w @swingby/core -- self-consistency`:

```
FAIL  test/parity/self-consistency.test.ts > boost/brake special cases (gotcha #1)
      > speed === 0: boost adds to xVel only, yVel untouched, for a whole tick
AssertionError: expected 0.005 to be 0.005000000043461725
```

— i.e. with the gotcha-#10 fix removed, `physics.ts` regresses to producing exactly
`0.005` (old float64-only behavior) instead of the float32-correct
`0.005000000043461725`. Restored the real implementation (verified via `grep` that
no temporary marker remained) and reran: back to 35/35 passing, and the full
monorepo suite back to 820/821 (1 legitimately skipped).

This is the same style of proof `tasks/T-01-KEPLER.md`'s own "How to verify" section
prescribes ("flip a sign in `applyGravityAcceleration`, confirm it fails") — applied
to the newly-found gotcha instead, since the actual Godot parity gate could not be
exercised locally this session (see below).

## What could not be verified — Godot only runs in CI, and this session could not
## reach either the real trace data or a fresh CI run

1. **The Godot parity gate itself was not re-run against real trace data with the
   fix applied.** Everything in "after," above, is a substitute (self-consistency
   suite, independent float32 cross-check, and the analytical error model against
   real level geometry) — strong, non-fabricated evidence, but not the actual
   `parity.test.ts` suite executing against `level-*.json` files produced by real
   Godot. Reasons, both structural to this session, not fixable by trying harder
   within it:
   - The already-uploaded `parity-traces` CI artifact
     (run `32171277521`, artifact id `9337377234`) lives on
     `productionresultssa10.blob.core.windows.net`. Direct download 403s at the
     network layer — `curl -v` shows the egress proxy itself rejects the CONNECT
     tunnel ("policy denial"), confirmed via the proxy's own status endpoint. This
     is a genuine environment restriction, not a credentials problem — no
     alternate URL exists for a private repo's artifact.
   - Getting CI to commit real trace JSON into git (so it could be read via
     `get_file_contents` instead, which appears to work server-side the same way
     `get_job_logs` did) requires the reordered `parity-traces.yml` — already
     edited in this session — to actually be running on the remote branch, which
     requires a push. This session is instructed not to run git commands (the
     orchestrator owns git), and `mcp__github__push_files`/`create_or_update_file`
     were treated as off-limits for the same reason (same effect — a new commit on
     the branch — via a different mechanism).
2. **`.github/workflows/parity-traces.yml`'s reorder was never exercised.** Moved
   "Commit traces" to run right after the determinism check (independent of whether
   the later parity-gate step passes — committing ground-truth traces should never
   be gated on the physics port already agreeing with them, which was circular
   before). This is a workflow-correctness fix, not a gate weakening — the parity
   step's own assertions and tolerances are untouched, byte-for-byte, and it still
   fully gates the job's pass/fail. Not run in CI this session for the reasons
   above.
3. **`tools/godot-trace/trace.gd` was not touched** — no changes were needed there;
   confirmed the harness is correct by full read, and the "before" numbers (a real
   CI run of the unmodified harness) are consistent with the harness being right
   and the port being wrong, not the reverse.

## Recommended next step

Once the orchestrator commits and pushes `packages/core/src/physics.ts`,
`packages/core/test/parity/self-consistency.test.ts`, and
`.github/workflows/parity-traces.yml`: trigger `parity-traces.yml` via
`workflow_dispatch` with `commit_traces: true` on this branch. Two outcomes to
check: (a) the parity gate step should now go GREEN across all 33 levels — the
scripted-boost/brake and predict() failures above should both disappear, per the
root-cause analysis; (b) real `level-*.json` traces should land in
`packages/core/test/parity/traces/` via the reordered commit step regardless, so
that even if (a) surfaces something this session's analysis missed, the real data
needed to debug it further will actually be available next time, unlike this
session's opening state.

## Related reading

- `notes/T-01-KEPLER/parity-debug.md` — full append-only derivation log, including
  every ruled-out hypothesis, the Vector2/`real_t` research, all verification
  scripts run and their exact output, and more detail on each item above.
- `results/T-01-KEPLER.md` — the original T-01 KEPLER task writeup (pre-dates this
  debugging session; describes the port and harness as built, not this fix).
