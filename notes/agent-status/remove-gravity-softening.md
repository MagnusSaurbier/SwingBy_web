# feat/remove-gravity-softening

**Agent:** Remove the Plummer gravity-softening term rho from the physics core entirely, per the owner's request.
**State:** surveying
**Head:** 24208d2 - survey findings only; no behaviour change, no repo code touched on this branch.

## Done
- Read AGENTS.md, README.md, PROJECT.md, INTERFACES.md, PHYSICS.md. Reproduced the baseline in my own clone: 56 files, 847 passed, 1 skipped, typecheck exit 0.
- Located all four rho call sites (`physics.ts:95-96`, `106-109`, `125-132`, `154-155`); confirmed by grep that nothing in `src/` outside physics.ts uses softening, and no FROZEN file needs to change.
- Measured the full blast radius in a throwaway spike outside the repo tree. Written up in `notes/feat-remove-gravity-softening/SURVEY.md`.

## In progress
Load-bearing question (`d -> 0` with rho removed) — **reached and measured**, full tables in SURVEY.md §2:
- **Acceleration:** at exactly `d = 0` it is **`NaN`**, not `Infinity` — `-(mu*dx)/dist15` is `0/0`. A NaN never recovers, and because every comparison against NaN is false the ship neither reaches the goal nor goes out of bounds; the level just hangs. The guard at `physics.ts:156`, which PHYSICS.md §5.4 documents as **unreachable**, becomes **load-bearing** and is the only protection. It fires for `d <= 1e-3`.
- **Substep count:** it does **not** explode — `Math.ceil(Infinity)` is `Infinity` and `clampInt` pins it to **12**. That is the problem: the raw demand is `162,037,038` substeps at `d = 1e-3` and `1,620,371` at `d = 0.01`, against a frozen `PHYSICS_SUBSTEPS_MAX = 12`. The adaptive protection is fully defeated below `d ~ 5`.
- **Integrator / ship through a centre:** semi-implicit Euler with no error estimate integrates a near-impulse in one substep and manufactures energy. Measured, same tapes: builtin-19 peaks at **91.20** units/tick vs **6.60** today (13.8x) and leaves the world bounds at tick 439; builtin-31 **58.25** vs **6.04**, out of bounds at tick 445. No non-finite value occurred in any of the 33 levels — closest approach in shipped content is 4.55 units.
- **Suite impact:** 68 failed / 779 passed / 1 skipped. 20 of 33 solvability tapes stop reaching the goal, 47 replay-verify assertions fail, 1 self-consistency golden value fails because the Godot reference itself has softening. Nothing was weakened to get these numbers.
- The Godot parity gate **has never run** — `test/parity/traces/` holds only `.gitkeep`, and that skip is the baseline's "1 skipped". No Godot here, so I can neither break it nor claim parity.

Plan was being written when interrupted; not yet drafted in the repo.

## Blocked on
Nothing technical. Four questions for the owner, recorded under "Open questions" in SURVEY.md §5: (1) does "entirely" include the substep travel budget `max(10, 0.35*rho)`, which perturbs trajectories at *every* distance, not just close passes; (2) what replaces collision, given softening exists because there is none; (3) what to do about 20 red tapes — re-derive them, accept red, or drop the levels (a failing tape proves that one scripted solution broke, **not** that the level is unsolvable); (4) `PHYSICS_SUBSTEPS_MAX = 12` is frozen and is the lever that would make close passes sane.

## Next step
Write `notes/feat-remove-gravity-softening/PLAN.md` from the survey and submit it with a `PLAN READY:` commit. Then stop and wait for GO. Questions 1-3 above materially change what gets built, so they want answers before the plan is final.

## Files owned
Expected to write on this branch: `packages/core/src/physics.ts` (the only source file), `packages/core/test/parity/self-consistency.test.ts`, possibly `packages/core/test/level/solvability/tapes/*.json` (only if question 3 says re-derive), `PHYSICS.md`, and these notes. Not touching `types.ts`/`constants.ts` (frozen), `reference/`, `ui/**`, `hud/pause.ts`, `hud/index.ts`, or `editor/**`.
