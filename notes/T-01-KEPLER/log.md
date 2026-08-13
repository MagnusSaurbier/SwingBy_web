# T-01 KEPLER — working log

Append-only. See notes/README.md for the convention.

---

## 2026-08-13 — session start, backfilled after reading + first implementation pass

**Read, in order:** README.md, PROJECT.md, INTERFACES.md, tasks/T-01-KEPLER.md,
`reference/godot/scripts/PhysicsEngine.gd` (all 224 lines), `GameConstants.gd`,
`packages/core/src/types.ts`, `packages/core/src/constants.ts`. Also pulled in
`reference/godot/scripts/GameWorld.gd` in full — not in the task doc's required-reading
list, but I needed it to answer a question the frozen interface raises and doesn't
answer (see "outOfBounds" below), and to confirm exactly what belongs to PhysicsEngine.gd
proper vs. GameWorld orchestration.

Godot is confirmed not installed in this container (`which godot` / no binary, no
SwingBy2026 checkout anywhere under the filesystem I have access to). Proceeding per the
task doc's explicit contingency: port + self-consistency suite + documented trace format
+ loud skip, no invented traces.

### Gotcha-by-gotcha, as ported

1. **Boost/brake rescale speed, don't add a vector** (`PhysicsEngine.gd:122-134`).
   Ported literally: `share = (speed + stepBoost) / speed; xVel *= share; yVel *= share`.
   Brake: `max(0, speed - stepBoost) / speed`. Special case `speed === 0`: boost does
   `xVel += stepBoost` only, `yVel` untouched — this is `physics.ts`'s
   `applyPlayerInput`, matches GDScript's `else: player["x_vel"] = ... + step_boost`
   branch (no `y_vel` touch at all in that branch). I did NOT write the "obvious" port
   (`xVel += dir.x * step`) — confirmed by reading the GDScript that `share` multiplies
   the *existing* velocity components, which is only equivalent to adding a directional
   vector when velocity is already unit-length, which it never is here.

2. **`pow(x, 1.5)` → `x * Math.sqrt(x)`.** Applied in three places: `applyGravityAcceleration`,
   `substepCount`'s `accel_mag` calc. Verified `grep -n "Math.pow" packages/core/src/physics.ts`
   is empty — but first pass caught a self-inflicted trap: my own explanatory comment
   *said* "Math.pow" as prose ("No `Math.pow`. ..."), which the grep would have flagged
   as a false failure since it's a literal substring match, not a real Math.pow call. Fixed
   by rewording the comment to never contain the contiguous string "Math.pow" while still
   being clear in English. Worth remembering: the grep is dumb-substring, so it polices
   comments too, not just code — write around it deliberately, don't just avoid the API call.

3. **Acceleration zeroes per substep, not per tick** (`PhysicsEngine.gd:46-47`, inside
   `simulate_substep`'s per-body loop, i.e. inside the substep, before gravity
   accumulates). `advanceRealSubstep`/`advanceShadowSubstep` both zero `xAcc`/`yAcc` at
   the top of the per-body loop, which itself runs once per substep call (the substep
   loop is the caller, in `simulateTick`/`predict`). Confirmed NOT hoisted above the
   substep loop.

4. **Sign convention** (`PhysicsEngine.gd:148-157`). `dx = body.x - source.x` (vector
   FROM source TO body), then `x_acc -= gravity * dx / dist_1_5` (subtract). Both halves
   ported as-is. Noted for whoever reviews this: flipping *either* half alone (just the
   dx sign, or just + instead of -) silently produces repulsion while still "looking
   plausible" in a skim — this is exactly the kind of bug the sign-flip proof (see below)
   is meant to catch.

5. **Skip rules.** Suns and anchored bodies never integrate — `if (body.type === "sun" ||
   body.anchored) continue;` at the top of both substep functions' per-body loop, before
   even zeroing acceleration (matches `PhysicsEngine.gd:43-44`/`78`). Sources with
   `gravity === 0` skipped in the inner force loop (matches `:60-62`/`87-88`) AND inside
   `applyGravityAcceleration` itself as a defensive no-op per INTERFACES.md's explicit
   spec for that function (Godot's own `apply_gravity_acceleration` does NOT re-check
   gravity==0 internally — the caller always pre-filters — but the frozen TS interface
   asks for the guard on the exported function itself, so both checks exist; harmless
   double-guard since the caller already filters before calling).

6. **`substepCount` reads pre-step state, computed once per tick** — confirmed
   `GameWorld._physics_tick` (`GameWorld.gd:529`) calls `PhysicsEngine.substep_count(objects)`
   ONCE, before the substep loop, using whatever position/velocity state existed at the
   *start* of the tick. `simulateTick` in physics.ts does the same: `substepCount` call
   sits above the substep `for` loop, not inside it.

   **Non-obvious wrinkle I had to read `substep_count` closely to catch**: its outer loop
   skips only `type == "sun"` — it does NOT skip anchored bodies (`PhysicsEngine.gd:8`
   has no anchored check, unlike `simulate_substep`'s `:43` which skips both sun AND
   anchored). So an anchored planet's speed and the gravity pull *on* it still feed into
   the required-substep-count calculation even though that planet will never actually
   move. This looks like it could be a bug in the reference, but it's not our call to
   fix — it changes `stepScale` for the whole tick, which changes every other body's
   trajectory too, so silently "fixing" it (skipping anchored bodies in our
   `substepCount` port) would make our port diverge from the real engine. Ported the
   asymmetry faithfully and left an explicit comment in physics.ts explaining why it
   looks wrong but isn't ours to change.

7. **Semi-implicit Euler** (`PhysicsEngine.gd:65-68`/`91-94`). Velocity updates from
   acceleration first, then position from the *new* velocity, both `* stepScale`. Ported
   in that literal order in both substep functions.

8. **GDScript float coercion.** `float(...)` calls throughout the GDScript are Variant
   narrowing, not a float32 step — GDScript floats are already 64-bit, same as JS
   numbers. No action needed; noted so nobody "fixes" a nonexistent precision gap later.

9. **Non-deterministic `turn_speed`.** `GameWorld._create_runtime_object`
   (`GameWorld.gd:630`) draws `randf_range(-3.0, -2.0)` per body per load. Confirmed by
   reading every PhysicsEngine.gd function that touches `turn_speed`: only
   `simulate_substep`'s planet-angle line reads it (`angle += deg_to_rad(turn_speed) *
   step_scale`), and nothing ever reads `angle` back into an acceleration or velocity
   calculation. So it's fully decoupled from trajectory. Response: physics.ts's
   `simulateTick` still *computes* the planet angle update (gotcha table says this is
   "visual only; physics ignores it" — meaning don't skip implementing it, just don't
   compare it), but the parity trace format (documented in
   `packages/core/test/parity/README.md`) excludes `angle`/`turnSpeed` from the JSON
   schema entirely, and `trace.gd` additionally seeds a FIXED `turn_speed` constant
   (defense in depth, so the exporter itself is deterministic run-to-run — satisfies the
   task doc's "Sanity-check the trace generator itself" byte-identical-reruns check).

### A frozen-interface gap I had to resolve by reading GameWorld.gd (not in the required-reading list)

`TickResult.outOfBounds` ("True once the player is outside MAX_WORLD_BOUNDS") is part of
the frozen `types.ts` contract that `simulateTick` must return. But `PhysicsEngine.gd`
itself has NO bounds-check logic at all — that lives in `GameWorld._check_world_bounds`
(`GameWorld.gd:694-717`), which is NOT part of the file this task ports. Read it anyway
because I have to return something for `outOfBounds`.

Found the actual Godot logic is relative to `world_origin`, which is NOT a fixed level
origin — it's reset every single render frame to `get_viewport_rect().size * 0.5`
(`GameWorld.gd:412`, inside `_process`, runs whenever not in editor mode). That is: the
"center" the bounds box is measured from is literally half the browser/game window's
pixel dimensions, recomputed continuously. This is a rendering/window-size quantity with
zero business being read by a pure, node-safe, browser-free `packages/core` module (Hard
rule #5), and it's also not physically meaningful to reproduce exactly server-side (two
clients with different window sizes would get different bounds boxes for the *same*
trajectory, which can't be right for a server-verified score).

Decision: `simulateTick`'s `outOfBounds` uses a FIXED origin at world-space `(0, 0)`,
i.e. `|player.x| > MAX_WORLD_BOUNDS_X || |player.y| > MAX_WORLD_BOUNDS_Y`. Justification,
not just convenience:
- `constants.ts`'s own comment for `MAX_WORLD_BOUNDS_X/Y` already says "half-extents from
  origin" (no mention of a dynamic viewport-tied origin) — the frozen contract already
  implies a fixed origin, it just doesn't spell out *which* fixed origin.
- Checked actual level data (`reference/godot/data/levels_builtin.json`): all 33 levels'
  object coordinates fall in x∈[180,1660], y∈[100,820] — well inside a fixed
  ±2600×±1800 box centered at (0,0). Godot's dynamic box (centered near its default
  world_origin (960, 508), same half-extents) covers roughly x∈[-1640,3560],
  y∈[-1292,2308] for a "typical" window size — same order of magnitude, not tighter or
  looser in any way that would change which of the 33 levels are solvable. This is a
  generous crash-guard ("you flew way too far, auto-reset"), not a precision gameplay
  boundary, so reproducing Godot's window-size-dependent number exactly is not required
  for parity in the sense this task cares about (trajectory correctness).
- Confirmed via `tasks/T-05-FLYWHEEL.md` (bounds.ts owner) that FLYWHEEL's own spec for
  the bounds rectangle is stated as "half-extents MAX_WORLD_BOUNDS_X/Y (2600×1800)" with
  no mention of any dynamic origin either — consistent with treating (0,0) as fixed.

This is a judgment call, not something I could verify against a trace (no Godot to
check window-size-dependent behavior against even if I had it — it's inherently
non-reproducible). Flagged prominently in `results/T-01-KEPLER.md` and in a code comment
in `physics.ts` right at the `outOfBounds` line, naming T-05 FLYWHEEL as the task to
revisit this with if it turns out to matter. Not treating this as at risk for the
"33 levels become unsolvable" failure mode the task warns about, because `outOfBounds`
only ever *resets* an attempt (never blocks reaching the goal) and the margin is huge
relative to where any of the 33 levels' geometry lives.

`reachedGoal` had no such ambiguity: `GameWorld._check_win_condition` (`:678-691`) is a
plain Euclidean distance check, `distance(player, goal) <= goal.range`, ported directly,
no judgment calls needed.

### Dead end avoided

Almost imported `T-02`'s `replay.ts` `ReplayTape`/`inputAtTick` machinery into the parity
harness for convenience (driving the scripted boost/brake trace). Stopped: T-01 does not
own `replay.ts`, it may not exist yet (parallel task), and PROJECT.md's working agreement
says "do not read another task's implementation, and do not wait for it — stub it."
Wrote a tiny standalone transition-list-to-boolean helper independently in both
`trace.gd` and (about to write) `parity.test.ts`, documented as intentionally duplicated
in `packages/core/test/parity/README.md` rather than shared.

### State / next step

Done so far: `packages/core/src/physics.ts` (all 5 exported functions), typechecks clean
(`npx tsc --noEmit -p tsconfig.json` — zero errors project-wide), `Math.pow` grep empty.
`packages/core/test/parity/README.md` (trace format spec) and `tools/godot-trace/trace.gd`
(exporter, untested — no Godot here) written. `traces/.gitkeep` placeholder added so the
directory survives in git while empty.

Next: write `packages/core/test/parity/parity.test.ts` (loud-skip-when-empty + the
consumer side of the trace format) and the self-consistency suite (two-body circular
orbit energy/momentum, symmetry, boost/brake special cases, skip rules, golden value by
hand from the GDScript). Then the deliberate sign-flip proof. Then `results/T-01-KEPLER.md`.
