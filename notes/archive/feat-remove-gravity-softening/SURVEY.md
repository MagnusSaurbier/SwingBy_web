# Survey — `feat/remove-gravity-softening` (raw findings, plan not yet written)

Request (verbatim from owner): *"entirely remove the gravity softening factor (rho as described in
the physics.md). It skews the physics and is unecessary"*

Status: **surveying, interrupted mid-plan.** No repo code has been changed on this branch. Every
number below was measured in a throwaway spike **outside the repo tree** (scratchpad only, never
committed, never on a branch). Reproduction recipe is at the bottom.

---

## 1. Where rho actually lives

Three call sites, all in `packages/core/src/physics.ts`. Nothing outside physics.ts and its own
test file references softening at all — verified by grep across the repo:

| Site | Line | What rho does there |
|---|---|---|
| `gravitySofteningRadius()` | `physics.ts:125-132` | `max(14, 1.15*s_src + 0.55*s_tgt + 6)` |
| `applyGravityAcceleration()` | `physics.ts:154-155` | `softenedDistSq = distSq + rho²`, then `a = mu*d_vec / softenedDistSq^1.5` |
| `substepCount()` | `physics.ts:95-96` | same softened `dist15` for `accelMag`… |
| `substepCount()` | `physics.ts:106-109` | …**and** the travel budget `max(MIN_TRAVEL_RESOLUTION, 0.35*rho)` |

Consumers of the export outside physics.ts: **none in `src/`**. Only
`packages/core/test/parity/self-consistency.test.ts` imports `gravitySofteningRadius`
(lines 31, 223, 1359-1375).

`SOFTENING_MIN / SOURCE_COEFF / BODY_COEFF / BIAS` live in `constants.ts`, which is **FROZEN**.
Removing rho means physics.ts stops *importing* them; the constants themselves stay untouched.
No frozen file needs to change. (Frozen `types.ts` is untouched too — rho is not on `Body`.)

## 2. The load-bearing question: what happens as `d -> 0` with rho removed

Measured, not reasoned. `mu = 1050` (builtin-00's sun), `rho = 32.2` for that sun/player pair.

### 2a. Acceleration — `applyGravityAcceleration`

With `dist15 = distSq * sqrt(distSq) = d³`:

| d | `distSq` | `dist15` | `ax = -(mu*dx)/dist15` |
|---|---|---|---|
| `0` | `0` | `0` | **`NaN`** (`-(1050*0)/0` = `0/0`) |
| `1e-9` | `1e-18` | `1e-27` | `-1.05e+21` |
| `1e-4` | `1e-8` | `1e-12` | `-1.05e+11` |
| `1e-3` | `1e-6` | `1e-9` | `-1.05e+9` |
| `0.01` | `1e-4` | `1e-6` | `-1.05e+7` |

So the honest answer to "state exactly what happens as `d -> 0`":

- **At exactly `d = 0` the acceleration is `NaN`, not `Infinity`** — the numerator `mu*dx` is also
  zero, so it is `0/0`. A `NaN` here propagates into `xVel`, then `x`, and never recovers. It is
  also silently absorbed: `reachedGoal` and `outOfBounds` both compare with `<`/`>`, and every
  comparison against `NaN` is false, so a `NaN`-ed ship neither wins nor dies — the level hangs
  until the tick horizon runs out.
- **The existing guard is what saves this, and it changes status.** `physics.ts:156` currently reads
  `if (softenedDistSq <= EPS_DIST_SQ) return;`. PHYSICS.md §5.4 documents that guard as
  **unreachable** (because `rho >= 14` forces `softenedDistSq >= 196`). Remove rho and the natural
  rewrite `if (distSq <= EPS_DIST_SQ) return;` becomes **load-bearing**: it is the only thing between
  the integrator and `NaN`. It fires for `d <= 1e-3`. Keeping it is not optional.
- **`d = 0` is not the real problem.** The guard makes the singular point safe; the interval just
  outside it is not. At `d = 0.01` the acceleration is `1.05e7` units/tick², which with `N = 12`
  substeps is a single-substep `Delta v` of ~`8.75e5` units/tick against typical player speeds of
  ~`1.2` units/tick.

### 2b. Substep count — `substepCount`

**It does not explode. It saturates, and that is worse.** `clampInt` is
`Math.min(Math.max(v, 4), 12)` (`physics.ts:529`), so:

| d | `accelMag` | `ceil(accelMag*dt/G)` raw | N after clamp |
|---|---|---|---|
| `0` | `Infinity` | `Infinity` | **12** |
| `1e-3` | `1.05e+9` | `162 037 038` | **12** |
| `0.01` | `1.05e+7` | `1 620 371` | **12** |
| `0.1` | `1.05e+5` | `16 204` | **12** |
| `1` | `1.05e+3` | `163` | **12** |
| `5` | `4.20e+1` | `7` | 7 |
| `>= 10` | — | `<= 2` | 4 |

- `Math.ceil(Infinity)` is `Infinity`; `clampInt(Infinity, 4, 12)` is `12`. **Not `NaN`, not a hang** —
  the raw value is non-finite but the clamp is total. (`clampInt(NaN,…)` *would* return `NaN`, but
  `accelMag` is only `NaN` if `mu*distance` and `dist15` are both 0, and `distance` is floored at
  `sqrt(EPS_DIST_SQ)=1e-3`, so `accelMag` is `±Infinity`, never `NaN`.)
- The adaptive substep mechanism is therefore **fully defeated below `d ≈ 5`**: it asks for up to
  1.6e8 substeps and is capped at 12. `PHYSICS_SUBSTEPS_MAX = 12` is in **FROZEN** `constants.ts`
  and cannot be raised to fix this.
- **Separately: removing rho changes N even far from every body.** The travel budget
  `max(10, 0.35*rho)` loses its rho term. Measured for real level geometry:

  | `s_src` | `s_tgt` | rho | budget now | budget after |
  |---|---|---|---|---|
  | 8 | 10 | 20.70 | 10.000 | 10 |
  | 18 | 10 | 32.20 | **11.270** | 10 |
  | 20 | 10 | 34.50 | **12.075** | 10 |
  | 20 | 20 | 40.00 | **14.000** | 10 |

  So "entirely remove rho" perturbs trajectories at *all* distances, not only close in. **This is an
  ambiguity in the request that needs the owner** — see Open questions.

### 2c. The integrator, and a ship passing through a body's centre

Semi-implicit Euler, one force evaluation per substep, `sigma = 1/N`, no error estimate
(PHYSICS.md §5.5). It has no mechanism to notice it is under-resolved. With N pinned at 12 and
`a ~ mu/d²`, a close pass integrates a near-impulse in one or two substeps: energy is not
conserved, it is *manufactured*. Measured on the built-in levels (same tapes, same inputs):

| level | max speed now | max speed with rho removed | ratio |
|---|---|---|---|
| builtin-19 | 6.60 | **91.20** | 13.8x |
| builtin-31 | 6.04 | **58.25** | 9.6x |
| builtin-24 | 4.43 | 20.04 | 4.5x |
| builtin-15 | 3.76 | 19.00 | 5.1x |
| builtin-01 | 8.33 | 21.42 | 2.6x |

builtin-19 and builtin-31 are the two levels that then fly out of the world bounds (OOB at tick 439
and 445). That is the "ship passes near a centre" failure mode in practice: **not a crash, not a
`NaN` — a slingshot to escape velocity.**

**Non-finite values in practice: none.** Across all 33 built-in levels with rho removed, no
position or velocity component ever became non-finite (checked every tick). Nothing in the shipped
levels gets within `1e-3` of a centre — closest approach across all 33 is **4.55 units**
(builtin-15). So the `NaN` case is real in principle and unreached by current content.

## 3. How close do ships actually get, and how much does gravity change

Measured per level along its solvability tape, on **unmodified** physics:

- Closest approach overall: **builtin-15 at d = 4.55** (`mu=50`, rho=21.85, `d/rho = 0.208`)
- Next: **builtin-01 at d = 6.19** (`mu=1280`, rho=33.35, `d/rho = 0.186`)
- **11 of 33 levels pass inside rho** (`d/rho < 1`).
- Acceleration multiplier at closest approach when rho is removed:
  builtin-01 **164x**, builtin-15 **118x**, builtin-22 **26x**, builtin-05 **20x**,
  builtin-24 **13x**, builtin-32 **11x**, builtin-19 **7.0x**, builtin-31 **5.9x**,
  builtin-14 **5.2x**, builtin-23 **4.2x**, builtin-18 **2.5x**.
  The 22 levels that stay outside rho land between **1.14x and 1.92x** — still not 1.0.

There is no distance at which this change is a no-op: at d=1000 the ratio is still 1.0016.

## 4. What breaks in the suites — measured, nothing weakened

Spike = repo copy with rho removed from all four sites, guard rewritten to `distSq <= EPS_DIST_SQ`,
travel budget reduced to `MIN_TRAVEL_RESOLUTION`. `gravitySofteningRadius` left *present but unused*
(so its own 2 unit tests still pass — deleting the export costs 2 more).

Baseline on `main`, reproduced in this checkout: **56 files, 847 passed, 1 skipped**, typecheck exit 0.

Spike: **3 files failed, 68 tests failed, 779 passed, 1 skipped (848 total).**

| file | failures | what |
|---|---|---|
| `packages/core/test/replay/verify.test.ts` | **47** | the 33 genuine tapes: `accepts the genuine tape with zero tick divergence` + `rejects an inflated claim` |
| `packages/core/test/level/solvability/run.test.ts` | **20** | 20 of 33 levels no longer reach the goal on their known-good tape |
| `packages/core/test/parity/self-consistency.test.ts` | **1** | `golden values (hand-derived from PhysicsEngine.gd) > gravity acceleration: body at (100,0), source at origin, hand-derived formula` |

Per-level outcome on the same tape (13 still solve, 18 miss, 2 out of bounds):

- **still reach goal (13):** 02, 03, 04, 06, 07, 08, 10, 11, 12, 13, 20, 28, 30
- **never reach goal (18):** 00, 01, 05, 09, 14, 15, 16, 17, 18, 21, 22, 23, 25, 26, 27, 29, 32
- **out of bounds (2):** 19 (tick 439), 31 (tick 445)

### The parity question, answered plainly

**The Godot parity gate does not run and has never run.** `packages/core/test/parity/traces/`
contains only `.gitkeep`; `parity.test.ts` dynamically skips itself with a loud banner — that skip
*is* the "1 skipped" in the baseline. There is no Godot in this container, so I cannot generate
traces and cannot re-base a harness that has no ground truth.

So the honest statement is: **I cannot break the Godot parity suite, and I equally cannot claim
parity is preserved.** The only artefact in the repo that encodes the reference's softening
behaviour is the one hand-derived golden value in `self-consistency.test.ts:199-227`, whose comment
block spells out `softening = max(14, 20*1.15 + 10*0.55 + 6) = 34.5` and
`softened_dist_sq = 10000 + 1190.25`. That test fails, and **it fails because the Godot reference
itself has softening** — exactly the case the orchestrator flagged. Whether that means the golden
value should be re-derived or the change is wrong is **not my call**; it is Open question 3.

No tolerance was adjusted, no assertion weakened, no test skipped to produce any number above.

## 5. Open questions (need the repo owner)

1. **Does "entirely" include the substep travel budget?** Removing rho from
   `max(MIN_TRAVEL_RESOLUTION, 0.35*rho)` changes N — and therefore every trajectory — even for a
   ship nowhere near any body (measured §2b: budget 14.0 -> 10.0 for a size-20/size-20 pair). If the
   intent is only "the acceleration should be true inverse-square", the travel budget could keep its
   rho term and the change would be strictly local to close passes. I have not assumed either way.
2. **What replaces collision?** Softening exists *because* there is no collision detection. With it
   gone, a close pass is a slingshot to escape velocity (measured: 13.8x speed on builtin-19) and an
   exact centre-pass is `NaN` held back by a single guard. Options seem to be: (a) accept it, keep
   the `EPS_DIST_SQ` guard as the only protection; (b) add a crash/collision fail state when
   `d < body.size` — that is a new game mechanic and well beyond this request; (c) keep a small
   floor on `d`. Each is a different feature. This should be the owner's choice, not mine.
3. **20 of 33 solvability tapes and 47 replay-verify assertions go red.** The owner has said the
   built-in levels are throwaway, so red levels may be fine — but the solvability and replay suites
   are the repo's only working safety net for physics changes, and a permanently-red suite destroys
   that signal for everyone else. Options: re-derive all 33 tapes with the grid search described in
   `run.test.ts`'s header (I can do this — it is mechanical, and every tape gets verified against the
   new physics rather than invented); accept red; or drop the levels. **Note the distinction: a tape
   failing does not prove a level is unsolvable** — it proves that one scripted solution no longer
   works. Establishing actual unsolvability needs a search I have not run.
4. **`PHYSICS_SUBSTEPS_MAX = 12` is frozen** and is what defeats the adaptive substep protection
   below `d ≈ 5` (§2b). If the owner wants close passes to remain numerically sane without
   softening, that constant is the lever, and it is in a file I must not edit.

## 6. Reproducing these numbers

No spike artefact is committed. To rebuild it: copy the repo to a scratch dir, apply the four edits
listed at the top of §4 to `packages/core/src/physics.ts`, and run `npx vitest run`. The per-level
tables came from two throwaway vitest files that walk each `packages/core/test/level/solvability/tapes/*.json`
through `simulateTick` and record min approach distance, max speed, and outcome.
