# feat/brake-flip-burn

**Agent:** Make braking count toward the boost highscore, and make the brake an instant flip-and-burn (ship flips, boost flame shows, boost sound plays).
**State:** surveying
**Head:** 5982dda - survey findings only; no behaviour change, no repo code touched on this branch.

## Done
- Read AGENTS.md, README.md, PROJECT.md, INTERFACES.md, PHYSICS.md. Baseline reproduced in my own clone: 56 files, 847 passed, 1 skipped, typecheck exit 0. (Baseline was run once and applies to both branches.)
- Traced `boostMs` end to end: two counters that must agree exactly — `game/loop.ts:304` (client) and `core/replay.ts:249` (server) — plus every downstream consumer in hud/ui/net/storage/api.
- Traced all three flip-and-burn surfaces to specific lines, and confirmed **no FROZEN file needs to change**: `Body.isBraking` already exists on the frozen `Body` type and is already set every substep by `applyPlayerInput` (`physics.ts:193`).
- Written up in `notes/feat-brake-flip-burn/SURVEY.md`. No survey material is shared with the other branch.

## In progress
- **This request does not touch physics.** `applyPlayerInput` is unchanged, no trajectory moves, level solvability is unaffected. The flip writes `Body.angle`, which `INTERFACES.md` documents as cosmetic and excluded from the parity traces.
- **Verified the flip geometry rather than assuming it:** the fallback silhouette's nose is at `-y` (`render/bodies.ts:108`), its flame at `+y` (`:116-124`). `rocketAngleFromVelocity` is `atan2(yVel,xVel)+PI/2`, so the nose is prograde today. Adding `PI` puts the flame prograde — "pointing in the direction of flight", exactly the owner's wording. Self-consistent, no reinterpretation needed.
- **Stored-data finding:** `infra/schema.sql:19`'s `check (boost_ms <= time_ms)` **survives** the redefinition, because `boostTicks` still increments at most once per tick. Local PBs (`storage/index.ts:285-294`) keep `boostMs` as a minimum, so an old brake-heavy best becomes a record the same player's new runs cannot match — not corrupted, just no longer comparable.
- **Sharpest finding, and it is a correctness bug rather than a data question:** `api/score.ts:195-217` recomputes `boostMs` from the tape and compares it to the client's claim with `CLAIM_TOLERANCE_MS = 8` (~one tick). `main` deploys straight to production with no staging gate and clients cache JS, so the moment the new server lands, an old cached client's *genuine* run mismatches by far more than 8ms and is **rejected outright**. Mirror image for a new client against an old server.

Plan was being written when interrupted; not yet drafted in the repo.

## Blocked on
Nothing technical. Five questions for the owner in SURVEY.md §5: (1) existing personal bests — migrate, invalidate or leave; (2) existing leaderboard rows, which would rank boost-only against boost+brake on the same column — **row count unmeasurable, there is no database in this container**; (3) what to do about the deploy window above; (4) whether the metric's UI labels ("Boost used") should be renamed — those strings are in Worker A's `ui/**` lane; (5) whether brake should be suppressed while boost is held, which decides whether the ship flips when both are down.

## Next step
Write `notes/feat-brake-flip-burn/PLAN.md` and submit it with a `PLAN READY:` commit, then stop and wait for GO. Per the orchestrator this branch is planned after `feat/remove-gravity-softening`. Questions 1-3 change what gets built and want answers before the plan is final.

## Files owned
Expected to write on this branch: `packages/core/src/replay.ts`, `packages/web/src/game/loop.ts`, `packages/web/src/render/bodies.ts`, and their tests (`packages/core/test/replay/**`, `packages/web/test/loop.test.ts`, `packages/web/src/render/bodies.test.ts`), plus these notes. Possibly `packages/web/src/storage/index.ts` and `api/score.ts` depending on the answers to questions 1-3. Not touching `types.ts`/`constants.ts` (frozen), `reference/`, `ui/**`, `hud/pause.ts`, `hud/index.ts`, or `editor/**` — the UI label question is Worker A's lane and I will not take it.
