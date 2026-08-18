# T-01 KEPLER — parity debug session log (2026-08-18)

Append-only. Debugging the first real Godot parity gate run.

## Baseline facts (from task brief, already established — not re-derived)

- zeroInput passes on every level to 1e-6 over 2000 ticks.
- Two assertions fail: `parity.test.ts:307` (scripted boost/brake, large/varied
  divergence 6.43-37.72) and `parity.test.ts:334` (predict() vs
  recalculate_predictions, tiny/uniform divergence 5.8e-5 to 6.1e-5 clustered
  around 6.0e-5).
- first_boost_fired flag divergence between trace.gd (hardcoded false) and
  parity.test.ts (running flag) is confirmed INERT — only gates the cosmetic
  first_boost_triggered return value, never touches velocity.
- Scripted tape constants (BOOST_TRANSITIONS/BRAKE_TRANSITIONS) and
  pressedAtTick/_input_at_tick predicate are byte-identical between trace.gd
  and parity.test.ts.

## Session start — reading code before touching anything

Read in full: packages/core/src/physics.ts (531 lines),
reference/godot/scripts/PhysicsEngine.gd (225 lines, READ-ONLY ground truth),
tools/godot-trace/trace.gd (299 lines), parity.test.ts (352 lines),
.github/workflows/parity-traces.yml, tasks/T-01-KEPLER.md,
notes/T-01-KEPLER/log.md (prior session's porting log).

### Structural comparison of predict()/recalculate_predictions

Compared physics.ts:463-523 against PhysicsEngine.gd:166-212 line by line.
Horizon rules (>4 moving -> *2/3, >6 moving -> /2, independent ifs not
elif), planet stride doubling above 2 planets, substep-then-sample order,
`tick % PREDICTION_STRIDE`/`tick % planetStride` sampling — all structurally
identical. This is NOT an algorithmic/off-by-one bug in predict()'s tick loop
shape. The divergence must be a numeric-precision issue, not a logic issue.

### HYPOTHESIS (not yet verified against real trace data): Godot Vector2 is
### single-precision (real_t = float32) by default; GDScript scalar `float`
### is NOT.

notes/T-01-KEPLER/log.md gotcha #8 (and physics.ts's own header comment,
"Only + - * / Math.sqrt in the numeric path") both assert "GDScript floats
are already 64-bit, there is no float32 step to reproduce." This is true for
the scalar `float` keyword and Dictionary-stored values (all float64/double)
but IS WRONG about Vector2. In a standard (non-double-precision-build) Godot
4.x binary — which is exactly what parity-traces.yml downloads
(Godot_v4.3-stable_linux.x86_64.zip, no `precision=double` custom build) —
`Vector2`'s x/y components are typed `real_t`, which defaults to 32-bit
`float`, NOT the 64-bit `float` that GDScript's scalar type name confusingly
also calls `float`. Constructing a Vector2 from double values rounds them to
float32, and any arithmetic performed via Vector2 methods (`.length()`,
`.normalized()`, etc.) executes in float32.

Grepped every `Vector2(float(...), float(...))` construction in
PhysicsEngine.gd. Three are on paths the parity suite actually samples:

1. **PhysicsEngine.gd:10**, `substep_count`:
   `body_speed := Vector2(float(x_vel), float(y_vel)).length()`
   — used for EVERY body, EVERY tick (real run and shadow/predict run alike),
   to help decide `required` substep count via `travel_budget` comparison.
2. **PhysicsEngine.gd:117-118**, `apply_player_input`:
   `velocity := Vector2(float(x_vel), float(y_vel)); speed := velocity.length()`
   — feeds DIRECTLY into the boost/brake rescale factor
   `share = (speed + step_boost) / speed`, which multiplies the (full
   float64-precision) xVel/yVel. Only exercised when boost or brake is held.
3. **PhysicsEngine.gd:204 and :207**, `recalculate_predictions`:
   `prediction_player.append(Vector2(float(x), float(y)))` and the matching
   planet-track line — the FINAL output value of every sampled prediction
   point is round-tripped through a float32 Vector2. This happens once per
   sample, does not feed back into the simulation (`shadow_objects` stays
   float64 throughout), so it does NOT compound.

Why this fits the two failure signatures:

- **predict() (~6e-5, uniform):** matches a ONE-TIME float64->float32 output
  rounding, not a compounding error. Max relative rounding error at float32
  is 2^-24 ~= 5.96e-8. World coordinates in these levels run several hundred
  to ~1-2 thousand units (physics.ts:367 cites measured range x in
  [180,1660], y in [100,820] for level *starting* positions; predicted
  trajectories can range further but stay same order of magnitude).
  value * 5.96e-8 for value ~1000 = 5.96e-5 — matches the observed cluster
  (5.8e-5 to 6.1e-5) almost exactly. This is the strongest single piece of
  evidence gathered so far.
- **scripted boost/brake (~6-38, compounding):** the speed value used in the
  boost/brake rescale is float32-rounded before multiplying the (still
  float64) velocity. Every substep while boost/brake is held re-introduces a
  ~1e-7-relative perturbation. Over up to ~2000 ticks x up to
  PHYSICS_SUBSTEPS_MAX substeps of gravitationally-coupled, boost-driven
  (potentially close-flyby) motion, this is exactly the kind of seed that
  chaotic/sensitive dynamics amplifies into O(1-10) world-unit divergence —
  and explains why magnitude varies a lot level-to-level (depends on how
  close a flyby ends up, how many boost intervals are held, etc.) while
  zeroInput (no Vector2().length() call ever happens there — no player input,
  and substep_count's body_speed effect is usually not the threshold-crossing
  term) stays untouched.

substep_count's body_speed (site 1) affects an integer `ceil()`-rounded
substep count, which is normally robust to a 1e-7 relative perturbation
(only flips if the true value sits within 1e-7 relative of an integer
boundary) — so it's a plausible LOW-FREQUENCY contributor to occasional
divergence but not the main story for either failure signature. Filed as
"probably present in both engines' substep decision most of the time, worth
reproducing anyway for exactness, unlikely to be the dominant term."

### Next step: fetch real CI trace artifact to confirm quantitatively before
touching physics.ts. Latest run is 32171277521 (commit b536562), conclusion
"failure", same two-assertion signature expected. Fetching its
`parity-traces` artifact now.

## Confirmed against the real CI run (32171277521, commit b536562) via job logs

`mcp__github__get_job_logs` (return_content:true) worked where direct artifact
download via curl did NOT — the artifact zip lives on
productionresultssa10.blob.core.windows.net, which the egress proxy 403s
(confirmed via `curl -v`: CONNECT tunnel rejected with 403, "policy denial").
GitHub's own API (job logs endpoint) is proxied through the MCP server itself,
not my sandboxed HTTPS_PROXY, so it worked. This is the "BEFORE" per-level
divergence table, read from the verbose reporter's own console.log lines
(job log lines ~398-695, unescaped from literal `\n` -> real newlines then
grepped for "max divergence"):

| level | zeroInput | scriptedInput | prediction (player) | prediction (planets) |
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

zeroInput passes everywhere (all < 1e-6 except level-21/25/26 which are still
< 1e-6, just closer to it — all comfortably under). scriptedInput and
prediction both fail everywhere. CRITICAL corroborating data point I did not
have before: **prediction planets divergence is EXACTLY 0.000e+0 on level-00
and level-03, the only two levels with zero planets** (maxVec2Divergence over
an empty array returns 0 by construction) — every other level has a nonzero
planet divergence in the same ~5.9e-5 to 6.1e-5 band as the player divergence.
This rules out "predict()'s tick-loop/stride logic itself is wrong" (a logic
bug would not care whether planets exist) and is exactly what a per-sample
OUTPUT rounding artifact looks like (see hypothesis below): with 0 planets,
there is nothing to output, so nothing to round, so 0 divergence.

## ROOT CAUSE FOUND: gotcha #10, missed by the original port

**In the port: NO.** In the harness: also no — the harness (trace.gd) is a
thin, faithful wrapper that calls the real `PhysicsEngine` static functions
directly; it does not reimplement any physics. **The bug is in
`packages/core/src/physics.ts`** — specifically, it is a MISSING gotcha in
the original port, not a wrong translation of an existing one.

**What's actually going on:** GDScript's scalar `float` keyword is 64-bit —
gotcha #8 (physics.ts's original header comment, and
notes/T-01-KEPLER/log.md's "no float32 step to reproduce") is correct about
that. But `Vector2`'s x/y components are typed `real_t`, which is **32-bit**
`float` in the standard (non-`precision=double`-build) Godot 4 binary — the
exact binary `.github/workflows/parity-traces.yml` downloads
(`Godot_v4.3-stable_linux.x86_64.zip`, the stock release, not a custom
double-precision build). This is a real, well-documented Godot fact (see
Godot's own "Large world coordinates" docs on why double-precision is an
opt-in custom build), and gotcha #8 conflated "GDScript float() casts are
64-bit" (true) with "so there is no float32 anywhere" (false) — it just never
looked at Vector2 specifically.

`PhysicsEngine.gd` constructs a `Vector2` from 64-bit values and calls a
Vector2 method on it in exactly THREE places, all of which feed a traced
quantity:

1. **`PhysicsEngine.gd:10`**, `substep_count`:
   `body_speed := Vector2(float(x_vel), float(y_vel)).length()` — every body,
   every tick (real run and predict() shadow run alike).
2. **`PhysicsEngine.gd:117-118`**, `apply_player_input`:
   `velocity := Vector2(...); speed := velocity.length()` — feeds directly
   into the boost/brake rescale `share = (speed + step_boost) / speed`, which
   multiplies the full-64-bit xVel/yVel. Only exercised when boost/brake held.
3. **`PhysicsEngine.gd:204` and `:207`**, `recalculate_predictions`: every
   sampled trajectory point is stored as `Vector2(float(x), float(y))` before
   being appended to the output array — a ONE-TIME output rounding (does not
   feed back into `shadow_objects`, which stays 64-bit throughout the shadow
   substep loop — confirmed by reading `simulate_shadow_substep`, lines 75-94,
   which is pure Dictionary-float arithmetic, no Vector2 anywhere).

`physics.ts` (the port) used `Math.sqrt(vx*vx + vy*vy)` — full float64 — in
all three equivalent spots. That is the bug: a missing gotcha, not a
mistranslated one.

**Why this explains both failure signatures exactly:**

- **predict() (~6e-5, tight, uniform, present in EVERY level with planets,
  absent in the two with none):** site 3 is a single float64->float32
  rounding of the OUTPUT coordinate, not a compounding one. Max relative
  rounding error at float32 is 2^-24 ~= 5.96e-8. World coordinates sampled by
  predict() (which can range further from the level's starting bounds
  [x in [180,1660], y in [100,820], per physics.ts's own outOfBounds comment]
  as bodies move under gravity/boost, but stay the same order of magnitude,
  several hundred to a couple thousand) times 5.96e-8 lands very close to
  observed range. For a coordinate magnitude of ~1000: 1000 * 5.96e-8 =
  5.96e-5 — matches the observed 5.7e-5 to 6.1e-5 band almost exactly. This
  is the single strongest piece of quantitative evidence in this session.
- **scripted boost/brake (~3 to 296, wildly varying by level):** site 2's
  float32-rounded `speed` feeds directly into `share`/`brakeShare`, which
  multiplies the REAL (not shadow) velocity — a ~1e-7-relative perturbation
  injected every SUBSTEP a boost/brake key is held (not just once per
  transition — apply_player_input runs every substep of every tick the key is
  down). Over up to 2000 ticks x up to PHYSICS_SUBSTEPS_MAX substeps of
  gravitationally-coupled, boost-driven motion (including close flybys near
  suns on some levels), this seed is exactly the kind of thing sensitive
  n-body dynamics amplifies — consistent with the huge level-to-level spread
  (level-21 at 296 world units vs level-13 at 4.6), which tracks how much
  chaos/close-encounter amplification each level's specific geometry produces,
  not a fixed per-tick error rate.
- **zeroInput stays untouched:** ZERO_INPUT never presses boost/brake (site 2
  never triggers), and site 1's effect on substep_count's integer `ceil()`
  result is usually robust to a 1e-7 relative perturbation (only flips
  right at an integer boundary) — consistent with zeroInput passing at
  1e-8 to 1e-12 on 30/33 levels, with three slightly-elevated but still-well-
  under-1e-6 levels (21, 25, 26) that are plausible substep-boundary hits.

## Fix implemented in packages/core/src/physics.ts

Added `vector2LengthF32(x, y)`: rounds to float32 (`Math.fround`) at every
intermediate step of `sqrt(x*x+y*y)` — construction, both squarings, the sum,
and the sqrt — not just the final result, to faithfully reproduce hardware
float32 rounding at each operation (this matters because IEEE add/multiply is
not associative across widths; rounding only the end result of a float64
computation is not always equal to a true float32 computation done at every
step). Used at the two `substepCount`/`applyPlayerInput` `speed` sites (1, 2
above). Not `Math.pow` — still obeys hard rule #4. Updated physics.ts's
header comment (previously claimed "Only + - * / Math.sqrt in the numeric
path" and asserted no float32 step existed) to document gotcha #10.

At the predict() output site (3 above), applied `Math.fround` directly to the
`x`/`y` values pushed into `player`/`planetTracks` — a one-time output
rounding, not fed back into the simulation, matching the reference exactly
(shadow substep math elsewhere is untouched, still pure float64).

## Fallout: one self-consistency test needed correcting, not the parity gate

`packages/core/test/parity/self-consistency.test.ts`'s "speed === 0: boost
adds to xVel only... for a whole tick" test hand-derived its expected xVel
assuming pure float64 arithmetic through all 4 substeps (comment traced exact
fractions cancelling to precisely 0.005) and asserted
`toBeCloseTo(BOOST_STRENGTH, 12)` (~5e-13 tolerance). With the fix, substeps
2-4 (where xVel is nonzero, so `speed > 0` and vector2LengthF32 actually
rounds something) pick up a real ~4.35e-11 perturbation — which is exactly
what REAL Godot does too (same float32 Vector2.length() call, same substep
recurrence), so the test's old tight tolerance was the thing out of step with
reality, not the port. Fixed by having the test itself re-derive the expected
value via the same fround-per-step recurrence (not a hardcoded magic float,
not a blindly loosened tolerance) — this still catches a regression in either
the recurrence or the rounding model. Confirmed the re-derivation produces
exactly the observed failing value (0.005000000043461725) via a standalone
node script before editing the test, so this isn't a guess.

This is NOT the Godot parity gate (`parity.test.ts`) — hard rule 1 does not
apply to this file's tolerance the same way; it's the hand-derived
self-consistency suite the task doc explicitly created as a Godot-optional
substitute, and its old assertion assumed something now known to be false
about the reference engine's actual numerics, not "an assertion that's
inconvenient right now." `parity.test.ts` itself has NOT been touched.

Full local `npm test -w @swingby/core` after the fix: 283 passed, 1 skipped
(parity.test.ts still SKIPPED locally — no traces on disk yet), 0 failed.
`npm run typecheck`: clean. `grep -n "Math.pow" packages/core/src/physics.ts`:
empty.

## Next: need real trace JSON locally to prove the parity gate itself goes
green, not just that self-consistency and the analytical model agree.

## Could not obtain real Godot trace JSON in this session — here is why, and what I did instead

Tried the documented path: `mcp__github__actions_get` method
`download_workflow_run_artifact` on run 32171277521's `parity-traces` artifact
(id 9337377234) returns a signed URL on
`productionresultssa10.blob.core.windows.net`. Direct `curl` to that host
403s at the CONNECT level (`curl -v` shows the egress gateway itself rejects
the CONNECT tunnel: "gateway answered 403 to CONNECT (policy denial)") —
confirmed via `$HTTPS_PROXY/__agentproxy/status`'s recentRelayFailures. This
is a genuine network-policy block, not a credentials problem: GitHub's
artifact API always redirects bytes through Azure Blob Storage for a private
repo, regardless of how the redirect is obtained, so there is no alternate
URL to ask for.

`mcp__github__get_job_logs` (with `return_content: true`) DID work at that
same moment, for the same run — that tool fetches server-side, through the
MCP server's own infrastructure, not through my sandboxed `HTTPS_PROXY`. That
is how the full per-level divergence table above was obtained: real,
CI-produced numbers, not fabricated. But it only gives text (job console
output), not the raw trace JSON files (binary/large artifact content), so it
cannot substitute for actually running `parity.test.ts` locally against real
traces.

Considered: reorder `.github/workflows/parity-traces.yml` so "Commit traces"
runs before the (currently-still-failing, pre-fix) parity gate step, so a
fresh workflow_dispatch run commits real trace-*.json files straight into git
— which I could then read via `get_file_contents` (near-certainly also
server-side, sidestepping the blob-storage block entirely). Made that
workflow edit (it is a legitimate fix regardless — see below), but it cannot
take effect until it is actually on the remote branch, and I am explicitly
told not to run any git command, and I'm treating `mcp__github__push_files`/
`create_or_update_file` as off-limits for the same reason (they'd create a
commit on the branch via a different mechanism, which is exactly what "the
orchestrator owns git" is protecting against, not just the literal `git`
binary). So: I could not push this edit, so I could not trigger a run that
would emit committable traces, so no real trace JSON reached this session.

**What I substituted, since I could not get real traces:**

1. **Independent cross-check of `vector2LengthF32`.** Implemented the exact
   same "round-to-float32-at-every-step" computation TWO ways in isolation —
   once via `Math.fround` (what physics.ts actually uses) and once via a
   `Float32Array` round-trip (a completely separate V8/IEEE754 code path —
   typed-array element stores truncate to binary32 on write, independent of
   `Math.fround`'s implementation). Ran 200,000 random `(x, y)` pairs spanning
   the world-coordinate range (+-2000): **0 mismatches, maxDiff 0.** This is
   real, independently-verified confirmation that `vector2LengthF32` performs
   genuine, correctly-rounded 32-bit-float arithmetic, not a coincidence or a
   tautological self-check.
2. **Quantified the old (pre-fix) port's actual error against true float32,**
   same 200,000-trial sweep: max relative error 1.544e-7, versus the
   theoretical bound of a couple ULPs at 32-bit precision (2^-24 = 5.96e-8,
   compounding across 4 chained roundings in the helper — construction, two
   squarings, the sum, the sqrt — lands at ~1.5e-7, in the right ballpark).
   Confirms the missing gotcha really does inject an error of exactly the
   order of magnitude needed to explain the observed divergence.
3. **Checked the predict()-output-rounding model against real level geometry.**
   `reference/godot/data/levels_builtin.json` (read-only, local, no Godot
   needed) gives the actual starting |x|/|y| distribution across all 33
   levels' objects: min 100, p25 500, median 560, p75 960, max 1660. Applying
   `magnitude * 2^-24` to that range predicts rounding error from ~1.5e-5 (at
   the smallest coordinates) up to ~9.9e-5 (at the largest), bracketing the
   CI-observed 5.7e-5 to 6.1e-5 band almost exactly once you account for
   predicted trajectories drifting somewhat from a level's starting bounds
   while staying the same order of magnitude. This is real level data, not
   invented numbers.
4. **Proved the fix is load-bearing and the local suite bites** (the
   non-Godot equivalent of "flip a sign in applyGravityAcceleration, confirm
   red" that tasks/T-01-KEPLER.md's own verification section prescribes):
   temporarily replaced `vector2LengthF32`'s body with the OLD plain
   `Math.sqrt(x*x+y*y)` (one line, immediately after the function signature,
   with the real implementation left in place but unreachable below it), ran
   `npm test -w @swingby/core -- self-consistency`. Result: RED — exactly the
   "speed === 0 boost" test I fixed earlier fails again, with
   `physics.ts` now producing exactly `0.005` (the old buggy-port value)
   against the test's independently-derived expected `0.005000000043461725`.
   Restored the real fix (overwrote from a pre-edit backup copy, verified via
   `grep` that no TEMP marker or stray early-return remained) and reran: back
   to 283 passed / 1 skipped / 0 failed. Also reran full `npm test`
   (all packages/api, not just core) after restoring: **820 passed, 1
   skipped, 0 failed** — no downstream fallout in T-05/T-11/etc's consumers
   of physics.ts.

**What this does NOT prove:** none of the above is a run of the actual
`parity.test.ts` Godot-trace suite against real Godot output with the fix
applied. That is the one proof this session could not produce, for the
network/permission reasons above — not because the fix doesn't work, but
because the ground-truth data to check it against never reached this
session. See results/PARITY-DEBUG.md's "what's unverified" section for
exactly what the next CI run (after the orchestrator commits and pushes
these changes) needs to confirm.
