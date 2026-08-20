# Plan: remove gravity softening (rho) from the physics path

Branch: `feat/remove-gravity-softening`. Status: awaiting GO. No production code changed yet.

## THIS TOUCHES PHYSICS

Loudly: this change alters every trajectory in the game. `packages/core` is parity-locked to
the Godot reference and all 33 levels were hand-verified solvable against the old numbers.
Removing rho invalidates the Godot traces, the recorded solving tapes, and every saved
replay/personal best/leaderboard row. Numbers below.

## What the feature does

Replaces Plummer-softened gravity with pure inverse-square gravity in
`packages/core/src/physics.ts`, matching how S3 implements it (owner: "the old gravity was
skewed anyway; the way S3 implements it is correct").

Current (softened), in `applyGravityAcceleration` and mirrored in `substepCount`:

```
rho     = max(14, source.size*1.15 + body.size*0.55 + 6)
softSq  = distSq + rho*rho
a      -= gravity * d / (softSq * sqrt(softSq))
```

New (inverse-square):

```
if (distSq <= EPS_DIST_SQ) return;          // guard now load-bearing: 0/0 -> NaN otherwise
a -= gravity * d / (distSq * sqrt(distSq))  // no Math.pow, per PROJECT.md
```

Three call sites change, all in `physics.ts` (T-01 KEPLER surface, which this branch owns):

1. `applyGravityAcceleration` (line ~150): drop softening; move the epsilon guard to raw
   `distSq`. Under rho the guard was unreachable (softSq >= 196); now it prevents NaN at
   exact overlap.
2. `substepCount` (line ~95): same formula change in the acceleration estimate, so the
   adaptive substepper sees the true (steeper) force and escalates substeps near close
   passes instead of underestimating them.
3. `substepCount` travel budget (line ~104): currently
   `max(MIN_TRAVEL_RESOLUTION, rho*0.35)`; becomes `MIN_TRAVEL_RESOLUTION` (frozen constant,
   value 10). Slightly tighter resolution near large bodies, which the steeper force needs.

`gravitySofteningRadius()` stays exported and tested (it is part of the INTERFACES.md
contract for `core/physics.ts`); gravity simply no longer calls it. The frozen
`SOFTENING_*` constants stay in `constants.ts` untouched (frozen file). If the owner would
rather delete the function, that is a one-line follow-up plus an INTERFACES.md edit this
branch does not own.

## What it deliberately does not do

- No collision detection/response at close approach. PHYSICS.md documents "no collision";
  adding one is a new mechanic, out of scope. Consequence: a body passing arbitrarily close
  to a source now receives arbitrarily large kicks (measured: at dist 1 with gravity 1000,
  |a| = 1000 vs 0.34 softened; the substep clamp MAX_GRAVITY_DV_PER_SUBSTEP still caps the
  per-substep dv but trajectories through near-zero distance are effectively chaotic).
- No edits to frozen `types.ts`/`constants.ts`, no edits to `reference/`, no new deps.
- No parity tolerance loosening, no trace editing, no skipping/deleting anyone's tests.
- No regeneration/fabrication of Godot traces or solving tapes in this container (no Godot,
  no way to honestly re-record human solutions).

## Measured impact (spike in a scratch worktree off `claude/current-limit-usage-0737a4`; not committed)

Baseline on that branch: 847 passed, 1 skipped, all green (solvability 33/33, parity 306/306).

With rho removed, full suite: **179 failed** out of the same set. Breakdown:

| Suite | Red | Why |
|---|---|---|
| `core/test/parity/parity.test.ts` | 100/100 | traces encode rho (expected red, see below) |
| `core/test/replay/verify.test.ts` | 47 | verification replays tapes recorded under old physics |
| `core/test/level/solvability/run.test.ts` | 20/33 | old solving tapes no longer reach the goal |
| `api/test/score.test.ts` | 7 | leaderboard verification uses the same tapes |
| `web/test/loop.test.ts`, `hud-e2e`, `editor-fixture` | 4 | end-to-end runs driven by old tapes |
| `core/test/parity/self-consistency.test.ts` | 1 | golden value hand-derived from the softened formula |

### Level solvability (headline finding)

T-03 ATLAS's harness replays a known-good tape per level. Before: **33/33**. After:
**13/33** tapes still reach the goal. The 20 stale tapes: builtin-00, 01, 05, 09, 14, 15,
16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 29, 31, 32.

Honest caveat: a stale tape proves the *recorded solution* no longer works, not that the
*level* is unsolvable under the new physics. Whether each of those 20 levels remains
humanly solvable cannot be verified in this container; it needs re-play (Magnus or a
browser session) after the change lands. Until then, treat "20 levels of unknown
solvability" as the risk headline.

### Parity (expected red)

All 100 parity assertions fail. Divergence vs the old Godot traces ranges from 2.9e+1 world
units (level-11) to 3.5e+5 (level-10), vs a 1e-6 tolerance - i.e. these are different
trajectories, not numeric noise. Full per-level table in the spike log. The traces were
generated from unmodified Godot and still encode rho; they must be regenerated on Magnus's
Mac from a Godot build carrying the equivalent change to
`reference/godot/scripts/PhysicsEngine.gd`'s formula (exporter `tools/godot-trace/trace.gd`,
procedure in `infra/AUTOMATION.md` and `packages/core/test/parity/README.md`).

Proposed parity-gate handling while traces are stale (needs owner decision, see Open
questions): mark the parity suite as *expected-fail* via a checked-in
`traces/STALE_PHYSICS` marker file that the test reads - assertions still run and report
divergence, but red does not fail CI until fresh traces replace the marker. No tolerance is
touched; deleting the marker restores full enforcement. Alternative rejected: leaving main
red for weeks (blocks every other branch's CI signal); skipping levels or loosening
tolerances (forbidden, and rightly so).

### Saved data

Personal bests, replays, and leaderboard rows were all recorded under softened physics.
Server-side verification recomputes the run; under new physics old tapes desync, so old
rows become unverifiable and old PBs unreachable/meaningless. Proposal: bump the replay/
scoreboard schema version (physics epoch) so old rows are segregated or wiped at deploy;
which of the two is Magnus's call (Open questions).

## Root cause / evidence

Not a bug fix; owner-directed behaviour change. Evidence the current code softens:
`physics.ts:125-133` and `reference/godot/scripts/PhysicsEngine.gd` use the identical
`max(14, ...)` Plummer form, so the reference is softened too - hence expected-red parity.

## Blast radius

Everything that integrates trajectories: `simulateTick`, `predict`, replay verification,
solvability tapes, score verification, HUD/loop e2e, editor fixture coast. All measured
above. Nothing outside `packages/core/src/physics.ts` changes in code; test/tape/trace
fallout is data-staleness, not logic.

## Alternatives considered

- Keep rho but shrink it: still diverges from S3's correct form; rejected by the request.
- Add a tiny fixed epsilon softening (e.g. rho=1): hides the singularity but is still not
  inverse-square; owner asked for S3's form. The EPS_DIST_SQ guard covers the exact-overlap
  NaN case; everything else is genuine dynamics.
- Fabricating new traces/tapes to get green: forbidden and worse than red.

## Tests for the new behaviour

1. Golden inverse-square value: body at (100,0), gravity 1000 -> xAcc == -0.1 (replaces the
   softened hand-derived golden in self-consistency; re-derived, not loosened).
2. Refusal/guard: body exactly at source position -> acceleration unchanged (no NaN, no
   Infinity); body at distSq just above EPS_DIST_SQ -> finite, correct sign.
3. No-op for gravity === 0 sources still holds.
4. substepCount escalates to PHYSICS_SUBSTEPS_MAX on a close pass where the softened code
   stayed at 4 (regression: fails without the substep-estimate change).
5. Energy sanity: two-body coast conserves specific energy to within integrator tolerance
   over 2000 ticks (inverse-square makes this meaningful; softened field has different
   invariant).
6. Update the two `gravitySofteningRadius` unit tests only if the function is deleted
   (default: keep function, keep tests).

Stale-tape suites (solvability, verify, score, loop, hud, editor-fixture): left red and
documented, or gated behind the same physics-epoch marker as parity - owner decision. No
assertion weakened either way.

## Verification matrix (run after implementation, numbers into PR)

`npm run typecheck`; `npm test` (full counts, red itemised); `npm run lint`;
`npm run build -w @swingby/web`; `npm run size`; solvability count before/after; parity
per-level divergence table. All on the rebased branch off post-landing `main`.

## Sequencing

`claude/current-limit-usage-0737a4` (float32 Vector2 fix + 33 real traces + parity gate)
has NOT landed on `main` yet (checked: not an ancestor). Implementation rebases onto main
only after it lands. If GO arrives first, I wait.

## Open questions for the owner

1. Parity gate while traces are stale: marker-file expected-fail (proposed), or leave main
   red until fresh traces arrive?
2. Same question for the 20 stale solving tapes and the 58 tape-driven tests in verify/
   score/loop/hud/editor-fixture: leave red, or same marker?
3. Saved leaderboard rows/PBs: wipe at deploy, or keep segregated under an old physics
   epoch?
4. `gravitySofteningRadius`: keep exported-but-unused (default), or delete and amend
   INTERFACES.md?
5. Who re-verifies human solvability of the 20 affected levels, and is that a blocker for
   merge?
