# T-05 FLYWHEEL — thought log

## 2026-08-15T00:00Z — plan, before any code

Read in order: README.md, PROJECT.md, INTERFACES.md, tasks/T-05-FLYWHEEL.md, then
`reference/godot/scripts/GameWorld.gd` (full — `_process`, `_physics_tick`, `_recalculate_zoom`,
`_check_win_condition`, `_check_world_bounds`, `_trigger_shake`, `restart_level`, `toggle_pause`,
`_reset_runtime_state`, `_load_level`), `GameConstants.gd` (full), `packages/core/src/physics.ts`
(full — the REAL T-01 implementation, not just its interface), `packages/core/src/replay.ts` (full
— the REAL T-02 implementation), `packages/core/src/level.ts` (turn_speed section), `types.ts`,
`constants.ts`, `packages/web/src/render/index.ts` (full — the REAL T-04 implementation, to learn
the exact `Camera`/`RenderFrame` contract I must satisfy), and the thought logs for T-01, T-02, T-04
(full for all three). No code written yet.

### Key findings that shape the design

1. **`camera.x/y` semantics, confirmed from `render/index.ts` itself** (not just INTERFACES.md's
   prose): `sx = halfW + (body.x - camera.x) * zoom`. So `camera.{x,y}` is the WORLD POINT mapped to
   viewport center — exactly Godot's `world_origin` role in `world_to_screen`
   (`GameWorld.gd:508-516`). T-04's own log (2026-08-13T09:56Z entry) independently confirms this
   same reading. `Renderer.worldToScreen/screenToWorld` are PURE functions of `Camera` — no hidden
   shake state inside the renderer (T-04 explicitly ruled out putting shake in the renderer at all,
   since `Camera` has no shake field). Consequence for me: camera shake must be baked directly into
   the `camera.x/y` I hand to `draw()` each frame, not carried as a separate channel.

2. **Godot's actual `world_origin` is NOT player-following and NOT level-specific** — it's
   reassigned every single `_process` frame to `get_viewport_rect().size * 0.5`
   (`GameWorld.gd:412`), i.e. literally half the game window's PIXEL dimensions, reused as if they
   were world-space coordinates. This only "works" because Godot's window/design resolution
   happens to sit near where the 33 levels are authored (object range x∈[180,1660], y∈[100,820] per
   T-01's log). It is not a portable concept for an arbitrarily-resizable canvas. T-01 already ran
   into the same wall for `TickResult.outOfBounds` and made a documented decision: bounds use a
   FIXED origin at world-space `(0,0)`, explicitly flagging me (T-05, bounds.ts owner) as the one to
   revisit it with (`notes/T-01-KEPLER/log.md:107-149`, `physics.ts:340-352`).
   **Decision: bounds.ts uses the SAME fixed (0,0) origin as `TickResult.outOfBounds`** — so the
   warning ramp (0.8→1.0) and the actual out-of-bounds trigger agree on what "distance from origin"
   means. This is a hard constraint, not a style choice: if bounds.ts used a different origin than
   physics.ts's own `outOfBounds` check, the warning could show full-red while `outOfBounds` is still
   false (or vice versa), which would look like a bug to a player.
   For the CAMERA's origin (a different, presentation-only concept — where the view is centered for
   zoom-to-fit purposes), I'm picking a level-specific fixed point: the bounding-box center of every
   body's starting position, computed once at hydrate/restart time. This is my own synthesis, not
   lifted verbatim from Godot (which can't be, given #2 above) — flagged as an assumption below.
   `_recalculate_zoom`'s actual FORMULA (`GameWorld.gd:662-676`) I *am* porting verbatim: distance of
   the player from the origin on each axis vs. `viewport_half * ZOOM_MARGIN`, target zoom =
   `min(zoomX, zoomY)`, clamped to never zoom in past 1.0 — not the task doc's paraphrase ("bounding
   box of the player plus nearby bodies" per frame), which doesn't match what Godot's code actually
   does (only the player's distance from origin is used, no other body). README says "All behaviour
   comes from here [reference/godot/]" — deferring to the actual code over the task doc's looser
   English description, same precedent as T-04's several documented Godot-vs-task-doc reconciliations.

3. **`verifyReplay`'s exact tick/ms semantics, read directly from `replay.ts`** (this is the part I
   must byte-for-byte agree with, per the CRITICAL instruction in my brief):
   - `elapsedTicks = captureTick + 1` where `captureTick` is the 0-based tick index on which
     `result.reachedGoal` first becomes true (loop starts `tick=0`, calls `simulateTick`, checks
     `reachedGoal` AFTER simulating).
   - `boostTicks` counts ticks (0-indexed, inclusive of the capture tick) where `input.boost` was
     true, incremented BEFORE calling `simulateTick` for that tick.
   - `timeMs = Math.round(elapsedTicks * 1000 / TPS)`, `boostMs = Math.round(boostTicks * 1000 / TPS)`
     — `ticksToMs` in `replay.ts:122-124` uses `Math.round`, confirmed by reading the source, not
     just told about it. T-02's log (2026-08-13, "Open question" entry) independently flags this
     exact thing as unresolved pending T-05 — I'm resolving it now: **my `onComplete` payload MUST
     compute `timeMs`/`boostMs` with the identical `Math.round(ticks * 1000 / TPS)` formula**, and my
     own tick-loop bookkeeping (elapsedTicks/boostTicks) must count ticks the identical way (0-based,
     capture-inclusive) so that if I hand my own recorded tape back through `verifyReplay`, its
     independently-recomputed `elapsedTicks`/`boostTicks`/`timeMs`/`boostMs` come out identical to
     mine, not just "close" — this is what makes the zero-tolerance default in `verifyReplay` pass
     without needing the `tolerance` escape hatch at all. I will build the tape's `ticks` field
     (`tapeRecorder.finish(N)`) as exactly `elapsedTicks` at capture (i.e. `captureTick + 1`), so that
     `verifyReplay`'s own `for (tick=0; tick<tape.ticks; tick++)` loop finds `reachedGoal` on the
     LAST tick of the tape it's given — the two simulations are bit-for-bit identical (same
     `hydrate(level)` start state, same physics, same input schedule) so this is guaranteed by
     construction, not by luck.
   - Confirmed `allowInput: true` unconditionally in `verifyReplay`'s simulation loop — so my own
     loop must also always pass `allowInput: true` for every tick it actually simulates (no
     "menu mode" concept exists inside a `GameSession`; I simply never call `simulateTick` at all
     once complete/paused, rather than calling it with `allowInput:false`).

4. **`hydrate()` is fully deterministic** (T-03's `turn_speed` decision — synthetic pseudo-spin from
   body index, no `Math.random`, documented at `level.ts:50-67`). This means restart can safely be
   "call `hydrate(originalLevel)` again", no manual field-by-field reset bookkeeping needed, and two
   `hydrate()` calls on the same `Level` object are pixel-identical. Good — this is the simplest and
   most robust restart implementation, and I don't need to hand-roll a `_reset_runtime_state()` port.

5. **No jsdom, no `requestAnimationFrame`/`HTMLCanvasElement`/`Image` in the test environment**
   (confirmed myself: `node -e "console.log(typeof globalThis.requestAnimationFrame)"` → `undefined`;
   also independently confirmed in T-04's log). `packages/web/package.json`'s `test` script is plain
   `vitest run`, no environment override anywhere in the repo. Implication for architecture (this is
   the biggest structural decision of this task, see below): the thing the task doc calls `frame(dt)`
   cannot live only inside a real-`requestAnimationFrame`-driven closure, or none of the required
   synthetic-dt tests (30/60/144fps tick-count parity, 5s spiral guard) could run headlessly at all.

### Architecture decision — split the engine core from the rAF wrapper

`createSession(opts): GameSession` is the ONLY export INTERFACES.md freezes, and its interface has
no `frame(dt)` method — by design, real gameplay is driven by real `requestAnimationFrame`. But the
task's own verification steps explicitly say "Drive `frame(dt)` directly with synthetic `dt`". These
aren't in tension if `loop.ts` has TWO layers:

- `createGameLoop(opts)` — NOT part of the frozen interface, an additional export. Does all the real
  work: fixed-timestep accumulator, tick loop calling `simulateTick`/`TapeRecorder`, camera/bounds
  updates, `buildFrame()`/`renderer.draw()`, win/bounds/onComplete logic. Exposes `frame(dt): void`
  directly alongside the same method set as `GameSession` (`snapshot`, `pause`, `resume`, `restart`,
  `destroy`, `onComplete`, `subscribe`, plus `start` which just arms it — does NOT touch
  `requestAnimationFrame` at all). This is what `loop.test.ts` drives directly with synthetic `dt`
  values in a tight synchronous loop — fully headless, no timers, no fake clocks needed.
- `createSession(opts): GameSession` — the frozen, required export. A thin wrapper: builds a
  `createGameLoop` instance, and on `start()` schedules a real `requestAnimationFrame` loop that
  computes `dt` from consecutive rAF timestamps and calls the engine's `frame(dt)`. Guards
  `typeof requestAnimationFrame === "function"` so constructing/starting a session in a non-browser
  environment (tests) doesn't throw — it just won't self-drive, which is fine since nothing in
  INTERFACES.md requires it to. For testing `createSession`'s OWN wrapper logic (timestamp-diffing,
  start/destroy lifecycle), I'll stub `globalThis.requestAnimationFrame`/`cancelAnimationFrame` in
  the test file (capture the callback instead of auto-invoking it, then invoke manually with
  synthetic timestamps) — standard technique, not a hack, and it means I test the real code path
  the browser will use, not a parallel implementation.

This isn't gold-plating: every single required verification bullet in the brief needs headless
`frame(dt)` access, so this split is load-bearing, not optional structure.

### Design decisions for camera.ts / bounds.ts state machine (recorded now, to move fast once coding)

- **`GameStatus` has no "idle/ready" value.** Before `start()` is called, `snapshot().status` reports
  `"paused"` (nothing simulating yet, which is what "paused" means) rather than inventing a status
  value outside the frozen union. `start()` transitions paused→playing and arms the tick loop.
- **`pause()`/`resume()`**: zero the accumulator on both transitions (rather than Godot's "keep
  draining the accumulator while skipping `_physics_tick`" trick) — functionally equivalent (no
  catch-up burst on resume either way) and much simpler to reason about/test. Rendering keeps
  running while paused (camera/shake still step); only the tick loop is skipped. Documented as a
  deliberate simplification vs. Godot's literal mechanism.
- **`"resetting"` status**: unlike Godot (where `restart_level()` is instant and gameplay is already
  live during the cosmetic flash), I hold the tick loop for exactly `RESET_FLASH_DURATION` (0.24s,
  ~35 ticks) after any reset (manual `restart()` or bounds-triggered auto-reset) before returning to
  `"playing"`. World state, trail, tape, timers are all reset IMMEDIATELY (not deferred to the end of
  the flash) — only tick *simulation* is held. Chosen because it's simpler to reason about/test than
  replicating Godot's "physics keeps running under the flash" nuance, and it's behaviorally almost
  identical anyway since a fresh attempt at tick 0 sitting still for 35 ticks changes nothing
  observable. Flagged as an assumption.
- **Bounds countdown** (`BOUNDS_WARNING_DURATION`, 0.65s real-time grace period before an
  out-of-bounds excursion forces a reset) mirrors Godot's actual two-part mechanism exactly: armed
  per TICK (`ratio > 1` and not already counting) using that tick's fresh position, decremented per
  RENDERED FRAME using wall-clock `dt`, cancelled if the player recovers before it expires. This one
  IS ported faithfully (gameplay keeps running during this countdown, exactly like Godot) — it's only
  the post-expiry flash where I diverge (see above).
- **All per-frame wall-clock deltas (accumulator growth, camera smoothing, shake decay, bounds
  countdown, reset-flash countdown) reuse the SAME clamped `dt`** (`min(rawDt, MAX_FRAME_TIME)`,
  `MAX_FRAME_TIME := 8 * TICK_INTERVAL`) rather than clamping only the accumulator. At normal frame
  rates (30/60/144fps) this clamp never engages (their dt values are 0.033/0.0167/0.0069, all well
  under 0.0556) so it can't interfere with the frame-rate-independence tests. FPS reporting is the
  ONE exception — it uses the RAW unclamped `dt` on purpose, so a stalled/janky frame is honestly
  reported as low fps rather than hidden by the same clamp that protects the simulation.
- **`onComplete`**: guarded by a single `completed` boolean, reset by `restart()`. The tick loop
  `break`s the moment `reachedGoal` fires (no further ticks that frame), status flips to
  `"complete"`, and no further `simulateTick` calls happen at all until the next `restart()`.

### Not yet done

No code written yet. Next: write `bounds.ts`, then `camera.ts`, then `loop.ts`, then
`packages/web/test/loop.test.ts` (own minimal fake canvas/2D-context stub, NOT importing T-04's
`render/__tests__/fakeCanvas.ts` — that's their test infra, not a public dependency, and duplicating
a ~20-line stub is cheaper than coupling to it). Will log again before running the full verification
suite (typecheck, vitest, the fps/spiral/replay numbers, the break-tests-on-purpose proof).

## 2026-08-15T01:30Z — all three files + tests written, typecheck clean, 18/18 green, one real bug found and fixed

Wrote `bounds.ts`, `camera.ts`, `loop.ts` per the plan above (no architecture changes from the plan
— the two-layer `createGameLoop`/`createSession` split, fixed origin (0,0) for bounds, bounding-box
camera origin, `Math.round` tick->ms, restart-via-rehydrate all landed exactly as designed).
`packages/web/test/loop.test.ts` written with its own fake canvas/2D-context (NOT importing T-04's
`render/__tests__/fakeCanvas.ts`), stub `InputSource`/`AudioSink` builders, a `DRIFT_FIXTURE_LEVEL`
(player moving away from a distant weak sun, guaranteed not to reach its own goal within any test
window — used for pure tick-bookkeeping tests) and direct use of `BUILTIN_LEVELS[0]` +
`packages/core/test/level/solvability/tapes/builtin-00.json` (T-03's real verified solve, read-only)
for the end-to-end tests.

`npm run typecheck`: clean for every file I own. Two pre-existing errors in `api/test/_ratelimit.test.ts`
(T-12 LEDGER's file, `IncomingMessage` cast issue) — confirmed unrelated by grepping the tsc output
for `game/` or `web/test`: zero matches, both errors are `api/test/`.

**Real bug found via the first test run, not hypothesized in advance:** the 5-second-stall spiral
test initially measured **7 ticks, not 8**. Root cause, confirmed with a standalone node repro:
`MAX_FRAME_TIME = 8 * TICK_INTERVAL` (`8 * (1/144)` = `0.05555555555555555`) accumulated once, then
drained via 7 repeated `-= TICK_INTERVAL` subtractions, leaves `0.006944444444444434` against a
`TICK_INTERVAL` of `0.006944444444444444` — short by `1.04e-17`, pure IEEE 754 rounding noise, not a
logic error. The 8th iteration's `accumulator >= TICK_INTERVAL` check failed by that ~1e-17 margin,
so only 7 ticks fired instead of 8. This directly fails the brief's explicit "must be capped at 8,
not 720" requirement (7 satisfies "bounded, not spiraling" but not the literal target). Fix: added a
`TICK_EPSILON = 1e-9` tolerance to the drain condition
(`accumulator >= TICK_INTERVAL - TICK_EPSILON`) — `1e-9` is ~8 orders of magnitude bigger than the
observed ~1e-17 noise (so it reliably absorbs it) and ~7 orders of magnitude smaller than any real
per-frame `dt` (0.0069s at 144fps is the smallest normal case), so it cannot manufacture a spurious
extra tick in normal operation. Re-ran: now exactly 8, deterministically (verified — IEEE 754 ops are
reproducible, not a flaky pass). Documented in a code comment at `loop.ts`'s `TICK_EPSILON` constant
with the exact numbers, so a future reader doesn't mistake this for an arbitrary magic number.
Re-checked the frame-rate-parity test after this change: still exactly 288/288/288 ticks at
30/60/144fps for a 2-second drive, 0 deviation from ideal — the epsilon is too small to have any
effect on normal-operation accumulator behavior, confirmed by measurement, not just argued.

**All 18 tests green**, `npx vitest run packages/web/test/loop.test.ts`. Numbers captured from the
test run's own console output (these are the ones going in results/T-05-FLYWHEEL.md):
- Tick-count parity: 30fps=288, 60fps=288, 144fps=288 ticks over a 2s synthetic drive; ideal =
  round(2*144) = 288; deviation 0/0/0.
- Spiral guard: 8 ticks executed after a single `frame(5.0)` call (post-fix).
- End-to-end: `BUILTIN_LEVELS[0]` ("builtin-00") driven by its real solvability tape (2110 ticks,
  brake held ticks 0-49) via `createGameLoop` to completion. `elapsedTicks=2110`,
  `timeMs=14653`, `boostMs=0`, recorded `tape.ticks=2110` (matches the source tape's own `ticks`
  exactly, as expected — T-03's tapes are captureTick+1-tight by construction, see their run.test.ts
  comment). Fed through the REAL `verifyReplay(level, tape, {timeMs, boostMs})`:
  `{"ok":true,"timeMs":14653,"boostMs":0,"ticks":2110}` — ACCEPTED, zero tolerance needed, exact
  agreement by construction (same `hydrate()`, same `simulateTick`, same input schedule on both
  sides). `onComplete` fired exactly once (`completions.length === 1`), confirmed to NOT re-fire
  across 20 more `frame()` calls after capture.
- Restart/determinism: 10 attempts via `restart()` replaying the identical tape from tick 0 each
  time (stub's counter explicitly reset between attempts) all reached completion, `onComplete` fired
  exactly 10 times total, and EVERY payload (`timeMs`, `boostMs`, and the full `tape` object,
  deep-equal) was identical to the first — strong evidence restart resets position, velocity,
  xAcc/yAcc, elapsedTicks, boostTicks, firstBoostFired, and the tape recorder correctly (if any of
  those leaked across attempts, the second run's trajectory would almost certainly diverge and
  either capture at a different tick or not at all within the guard window).
- Camera: zoom-out smoothing after 0.5s of simulated time, computed via 30 steps at 1/60 vs 72 steps
  at 1/144, agree to `5.55e-17` absolute difference (float noise only) — confirms the exponential
  smoothing math is exactly frame-rate-independent by construction (compounding
  `1-exp(-rate*dt)` over n equal substeps of a fixed total time is mathematically exact regardless
  of `n`), not just "close enough" empirically. Asymmetry confirmed directly: one frame at 1/60s,
  zoom-in progress 0.1417 vs zoom-out progress 0.0624 for the same magnitude target displacement —
  ZOOM_IN_SMOOTHING (20.0) is measurably faster than ZOOM_SMOOTHING (8.0), as specified.
- Bounds: countdown armed at ratio>1, cancelled on recovery, and expires at very close to
  `BOUNDS_WARNING_DURATION` (0.65s) when driven continuously — measured 0.6500s (60fps steps, so
  quantized to a 1/60s grid, hence not bit-exact 0.65 but within one frame of it). A live-session
  test (`escapeLevel`, straight-line high-speed departure with negligible gravity) independently
  confirms the FULL pipeline: bounds ratio crosses 1 mid-session, the countdown runs while ticks
  keep advancing normally, and an automatic reset (status -> "resetting", elapsedTicks back to 0)
  fires within the driven window without any manual `restart()` call.

**tick -> ms: `Math.round(ticks * 1000 / TPS)`, identical formula and identical rounding function
to `packages/core/src/replay.ts`'s private `ticksToMs`** (replay.ts:114,122-124). Not just asserted
in a comment — the end-to-end test's `verifyReplay` call is the actual cross-check: if my rounding
diverged from theirs at all, `timeMs`/`boostMs` would not match `verifyReplay`'s independently
recomputed values and `result.ok` would be false even with the tolerance parameters left at their
zero default. It came back `true`, which is the strongest evidence available that the two sides
agree, not just the same source line quoted twice.

### Next step

Still need the explicit "prove tests can fail" step (break the accumulator on purpose, capture red
output, restore, capture green again) and `results/T-05-FLYWHEEL.md`. Both are next, in that order,
since the break/restore is the one "risky" remaining step (temporarily editing a landed file) —
logging immediately before it per the cadence instruction.

## 2026-08-15T02:00Z — session resumed after a usage-limit kill (per orchestrator's message); break/restore proof done, full-repo check done

Orchestrator confirmed the kill happened mid-way through this exact "next step" and that everything
written so far (`loop.ts`, `camera.ts`, `bounds.ts`, `loop.test.ts`, this log) survived intact.
Verified independently on resume: all four files present and matching what this log already
describes, `npx vitest run packages/web/test/loop.test.ts` still 18/18 green before touching
anything.

**Break-tests proof, done for real (not simulated/described):** temporarily edited `runTicks` in
`loop.ts` — replaced the fixed-timestep `while (accumulator >= TICK_INTERVAL - TICK_EPSILON &&
ticksThisFrame < MAX_TICKS_PER_FRAME)` with `while (ticksThisFrame < 1)` (a classic variable-timestep
bug: exactly one `simulateTick` per `frame()` call, ignoring `dt`/the accumulator entirely — dt is
still added to the now-pointless accumulator but never drained by more than one tick). Ran
`npx vitest run packages/web/test/loop.test.ts`, output saved to
`/tmp/.../scratchpad/red-run.txt`. Result: **2 of 18 failed**, exactly the two tests that exercise
the accumulator's frame-rate-independence claim —
- `tick count is identical at 30/60/144 fps`: `30fps=60 60fps=120 144fps=288` (deviation from the
  288 ideal: `-228, -168, 0`) — `expected 60 to be 120`.
- `a 5-second frame gap is capped at MAX_TICKS_PER_FRAME (8), not 720`: measured `1`, `expected 1 to
  be 8`.
The other 16 tests stayed green even under this breakage (end-to-end/tape/restart/camera/bounds
tests don't depend on the accumulator's tick-COUNT-per-frame behavior, only on ticks eventually
happening in the right order, which the broken version still does, one at a time) — exactly the
targeted failure signature expected from breaking specifically the fixed-timestep property, not a
blanket failure that would prove nothing about which claim the test suite actually protects.
Reverted the edit immediately after capturing this output (single `Edit` call restoring the exact
original line). Re-ran: **18/18 green again**, output saved to `/tmp/.../scratchpad/green-run.txt`,
matches the pre-break numbers exactly (288/288/288 ticks, 8-tick spiral cap, etc. — the earlier
`TICK_EPSILON` fix is still in effect post-revert, confirmed by the spiral test reading 8 not 7).

**Full-repo check**, both commands run fresh just now:
- `npm run typecheck` (`tsc --build --force`) — clean, exit 0, zero errors anywhere in the repo
  right now. (Earlier in this session I saw 2 errors in `api/test/_ratelimit.test.ts`, an
  `IncomingMessage` cast issue in T-12 LEDGER's file, unrelated to anything I own — gone on this
  rerun, almost certainly a concurrent T-12 edit caught mid-save, same transient-error pattern
  T-02's log records for a different file/task. Confirmed via a second immediate rerun, still clean.)
- `npx vitest run` (whole repo) — **561 passed, 7 failed, 1 skipped (569 total)**. The 1 skipped is
  T-01's known, intentionally-skipped Godot parity gate (pending host-generated traces — documented
  in the task brief itself, not a surprise). All 7 failures are in `api/test/` —
  `_db.test.ts` (a duplicate-key-constraint test), `_validate.test.ts` (4 tests, a 5000ms timeout),
  `score.test.ts` (2 tests, a forgery-rejection count mismatch and a truncated SQL-metacharacter
  string) — every one of them T-12 LEDGER's file, zero overlap with anything I own
  (`packages/web/src/game/**`, `packages/web/test/loop.test.ts`). `packages/web/test/loop.test.ts`
  itself is counted in the 24 passing test files. Not investigating further per the brief's explicit
  instruction to ignore other tasks' concurrent breakage and per the orchestrator's confirmation this
  matches what it already observed independently.

### Next step

Write `results/T-05-FLYWHEEL.md` — every deliverable + status, the DoD checklist with one-line
reasons, all measured numbers above, the explicit `Math.round` tick->ms statement, and anything not
verifiable (manual browser stall/screenshot-style checks — no real browser/rAF in this environment,
same constraint T-04 hit). This is the last piece of the task.
