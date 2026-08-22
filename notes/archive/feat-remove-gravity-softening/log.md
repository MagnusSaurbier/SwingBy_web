# Thought log — feat/remove-gravity-softening (append-only)

## 2026-08-20 — survey resumed, measured against the real parity branch

- Prior survey (SURVEY.md) measured 68 failing tests on old main WITHOUT the real Godot
  traces. Superseded number: against `claude/current-limit-usage-0737a4` (which carries the
  33 real traces + parity gate), the same rho-removal spike produces **179 failed tests**:
  parity 100, replay verify 47, solvability 20/33, score 7, loop/hud/editor 4,
  self-consistency golden 1. Do not conflate the two counts; different baselines.
- Baseline on the parity branch is green: 847 passed, 1 skipped; solvability 33/33,
  parity 306/306.
- Parity divergences with rho removed: 2.9e+1 (level-11) to 3.5e+5 (level-10) world units
  vs 1e-6 tolerance. Full per-level table captured in the spike run; regenerate with the
  recipe below if lost.
- Solvability tape failures (20): builtin-00,01,05,09,14,15,16,17,18,19,21,22,23,24,25,26,
  27,29,31,32. The other 13 tapes still solve. A failing tape != unsolvable level; human
  re-verification needed post-change.
- Dead end ruled out: the epsilon guard `softenedDistSq <= EPS_DIST_SQ` is unreachable
  under rho (softSq >= 196); after removal the equivalent guard on raw `distSq` becomes
  load-bearing (0/0 -> NaN otherwise). Keep it on distSq.
- `gravitySofteningRadius` has no src/ consumers outside physics.ts; only
  self-consistency.test.ts imports it. Default decision: keep exported (INTERFACES.md
  contract), gravity stops calling it. Frozen constants stay put; physics.ts just stops
  importing SOFTENING_*.
- Sequencing check: `claude/current-limit-usage-0737a4` NOT yet an ancestor of
  origin/main (checked 2026-08-20 22:45 UTC). Must not rebase/implement until it lands
  AND GO received.
- Spike reproduction: worktree off `claude/current-limit-usage-0737a4`; in physics.ts
  replace softened dist15 with `distSq * Math.sqrt(distSq)` at both call sites, guard
  `distSq <= EPS_DIST_SQ`, travelBudget = MIN_TRAVEL_RESOLUTION; `npx vitest run`.
- Next step: PLAN.md written (same folder), posting to owner, waiting for GO.
