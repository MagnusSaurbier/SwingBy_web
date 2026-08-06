# T-01 · KEPLER — Physics core and Godot parity harness

**Area:** `packages/core` · **Depends on:** nothing · **Blocks:** T-05 FLYWHEEL, T-11 DRAFT
**Risk:** highest in the project. Start first.

## Goal

Port `reference/godot/scripts/PhysicsEngine.gd` (224 lines of GDScript) to `packages/core/src/physics.ts`,
and prove numerically that it matches the original. Everything else in SwingBy Web is conventional
web work; this is the task where being subtly wrong is invisible until 33 levels turn out to be
unsolvable.

## Owned files

```
packages/core/src/physics.ts
packages/core/test/parity/**          traces, harness, assertions
tools/godot-trace/**                  GDScript trace exporter
```

## Reference

`reference/godot/scripts/PhysicsEngine.gd` — the whole file. Also `GameConstants.gd` for values, already
ported into `packages/core/src/constants.ts` (frozen — use it, do not redefine).

## Interface

Implement exactly the signatures in [INTERFACES.md](../INTERFACES.md#corephysicsts--t-01-kepler).

## What to build

**1. The port.** Five functions: `substepCount`, `gravitySofteningRadius`,
`applyGravityAcceleration`, `simulateTick`, `predict`.

**2. The trace exporter.** A GDScript file run headless against the real engine:

```bash
/Applications/Godot.app/Contents/MacOS/Godot --headless --path <SwingBy2026> --script tools/trace.gd
```

For each of the 33 built-in levels it emits, at full `float64` precision, the complete body state
every N ticks for a fixed input tape (start with all-zero input, then add a scripted boost pattern).
Write these to `packages/core/test/parity/traces/*.json`. Commit them — they are the ground truth and
must survive without Godot installed.

> ### ⚠️ If you are running in a container, Godot is NOT available
>
> There is no Godot binary and no `SwingBy2026` checkout in the agent image. You **cannot** run step
> 2 yourself, and you must not fake it — invented traces are worse than none, because they would
> make the parity suite green against physics nobody has checked.
>
> What to do instead:
>
> 1. Write `tools/godot-trace/trace.gd` carefully against `reference/godot/scripts/`, and document
>    the exact output format you expect in `packages/core/test/parity/README.md`.
> 2. Write `physics.ts` and the parity harness so the suite **skips with a clear message** when
>    `traces/` is empty, rather than passing vacuously.
> 3. Write a self-consistency test suite that does not need Godot: energy/momentum behaviour on a
>    two-body circular orbit, symmetry checks, and a golden-value test you derive by hand from the
>    GDScript. These catch most porting errors on their own.
> 4. Say clearly in your `results.txt` that traces are outstanding and the parity gate has not run.
>
> Magnus runs the exporter on the host and commits the traces; the suite then goes green (or does
> not) without changing your code. **Do not report the task as done while the parity gate is
> unrun** — report it as done-pending-traces, and say so.

**3. The parity test.** Replay each trace through `physics.ts` and assert agreement.

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | `physics.ts` — all five exported functions | `packages/core/src/physics.ts` |
| 2 | GDScript trace exporter, runnable headless | `tools/godot-trace/trace.gd` |
| 3 | 33 reference traces, committed | `packages/core/test/parity/traces/level-*.json` |
| 4 | Parity test suite | `packages/core/test/parity/parity.test.ts` |
| 5 | Measured divergence table, in the PR description | — |

## Definition of done

- [ ] All 33 levels, 2,000 ticks of zero input: max absolute position divergence **< 1e-6** world units
- [ ] All 33 levels with a scripted boost/brake tape: same bound
- [ ] A 10,000-tick run on level 1 stays under **< 1e-3** (drift accumulation check)
- [ ] `predict()` matches `recalculate_predictions` sample-for-sample
- [ ] Traces committed and the suite passes **on a machine without Godot installed**
- [ ] `grep -n "Math.pow" packages/core/src/physics.ts` returns nothing
- [ ] No import outside `./types` and `./constants`; no clock, no RNG, no globals
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Gotchas

These are the specific places a natural-looking port goes wrong:

1. **Boost rescales speed, it does not add a vector.**
   ```gdscript
   var share := (speed + step_boost) / speed
   player["x_vel"] *= share ;  player["y_vel"] *= share
   ```
   Writing `xVel += dir.x * step` is the obvious port and is **wrong** — it is only equivalent when
   the velocity is already unit length. Brake mirrors this with `max(0, speed - step) / speed`.
   Special case: `speed === 0` → boost adds `step` to `xVel` only, leaving `yVel` untouched.

2. **`pow(x, 1.5)` must become `x * Math.sqrt(x)`.** Not a style preference — `Math.pow` is not
   correctly rounded, so client and server would disagree in the last bits and diverge over 100k
   substeps. The two expressions are exactly equal in IEEE 754. See DESIGN.md §6.

3. **Acceleration zeroes per substep, not per tick.** `body["x_acc"] = 0.0` sits inside the substep
   loop, before the gravity accumulation.

4. **Sign convention.** `dx = body.x - source.x`, and the acceleration is *subtracted*:
   `x_acc -= gravity * dx / dist_1_5`. Net effect is attraction. Flipping either half silently
   produces repulsion.

5. **Skip rules.** Suns and anchored bodies never integrate. Sources with `gravity === 0` are skipped
   in both `substepCount` and the force loop — including the player, whose gravity is 0, so the
   player never attracts anything.

6. **`substepCount` reads pre-step state** and is computed once per tick, not per substep.

7. **Semi-implicit Euler.** Velocity first, then position from the *updated* velocity. Both scaled by
   `stepScale = 1 / substeps`.

8. **Beware GDScript float coercion.** `float(body["x_vel"])` everywhere is defensive casting of
   Variant, not a semantic narrowing — GDScript floats are already 64-bit. There is no float32 step
   to reproduce.

9. **The Godot runtime is not fully deterministic, and you must work around it.**
   `GameWorld._create_runtime_object` initialises every body with
   `"turn_speed": randf_range(-3.0, -2.0)` — a fresh random value per object per load. It feeds only
   `body["angle"]`, which no force calculation reads, so **trajectories are unaffected**. But it
   means two runs of the same level produce different `angle` streams.

   Therefore: **exclude `angle` and `turn_speed` from the exported traces**, or seed the RNG in the
   trace script. Do not "fix" it by asserting on angle — that would make the parity suite flaky for
   a field that does not matter. Position and velocity are the ground truth.

## How to verify

**1. Regenerate the traces** (needs Godot; only when the reference changes):

```bash
/Applications/Godot.app/Contents/MacOS/Godot --headless \
  --path /Users/magnussaurbier/Documents/Dev/2026_Swingby/SwingBy2026 \
  --script tools/godot-trace/trace.gd
```

**2. Run the parity suite** (the real gate — no Godot needed):

```bash
npm test -w @swingby/core -- parity
```

It must print the max divergence per level. A pass with no numbers reported is not a pass.

**3. Confirm the suite actually bites.** Flip a sign in `applyGravityAcceleration`, re-run, and
confirm it fails. A parity suite that passes against broken physics is worse than none, and this is
the only way to know it is wired up.

```bash
npm run typecheck
grep -n "Math.pow" packages/core/src/physics.ts   # must be empty
```

**4. Sanity-check the trace generator itself.** Two independent Godot runs of the same level must
produce byte-identical traces. If they do not, something in the engine path is non-deterministic and
must be found before the traces mean anything — check `turn_speed`, which
`_create_runtime_object` initialises with `randf_range(-3.0, -2.0)`.
