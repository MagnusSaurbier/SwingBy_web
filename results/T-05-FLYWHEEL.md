# T-05 FLYWHEEL — results

Game loop, camera, bounds, and win condition for the SwingBy web port. This is the module that
wires T-01 KEPLER's physics, T-02 TAPE's replay recording, T-03 ATLAS's level hydration, and
T-04 AURORA's renderer into an actual playable attempt at a level.

## Deliverables

| # | Artifact | Path | Status |
|---|---|---|---|
| 1 | `createSession` + the `GameSession` interface | `packages/web/src/game/loop.ts` | Done. Also ships an additional, non-frozen export `createGameLoop` (+ `GameEngine`) — the real engine with a directly-callable `frame(dt)`, which `createSession` wraps with a real `requestAnimationFrame` loop. See "Architecture" below for why this split exists. |
| 2 | Camera with asymmetric zoom smoothing | `packages/web/src/game/camera.ts` | Done. |
| 3 | Bounds warning, reset, and flash | `packages/web/src/game/bounds.ts` | Done. |
| 4 | Headless tests with stubbed renderer/input/audio | `packages/web/test/loop.test.ts` | Done. 18 tests, all headless (own hand-written fake canvas/2D-context — no jsdom in this project, confirmed empirically). |
| 5 | Measured tick counts at 30/60/144 fps | this file, "Numbers" below | Done. |

## Architecture note (read before the checklist below)

`INTERFACES.md`'s `GameSession` has no `frame(dt)` method — real gameplay is meant to be driven by
a real `requestAnimationFrame`. But every required verification step in the brief needs `frame(dt)`
driven with a *synthetic* `dt`, headlessly, with no browser. Those aren't in tension because
`loop.ts` has two layers:

- `createGameLoop(opts): GameEngine` — not part of the frozen interface, an additional export. Does
  all the real work (fixed-timestep accumulator, camera/bounds updates, win/reset logic,
  `renderer.draw()`) and exposes `frame(dt): void` directly. This is what every test below drives.
- `createSession(opts): GameSession` — the exact frozen export. A thin wrapper: builds a
  `createGameLoop` instance and, on `start()`, schedules a real `requestAnimationFrame` loop that
  computes `dt` from consecutive rAF timestamps and calls `frame(dt)`. Guards
  `typeof requestAnimationFrame === "function"` so constructing/starting a session outside a browser
  never throws.

`createSession`'s exact signature and every member of `GameSession`/`GameSnapshot`/`GameStatus`
match `INTERFACES.md#webgameloopts--t-05-flywheel` verbatim — the extra `createGameLoop`/`GameEngine`
exports are additive, not a substitute or a deviation.

## CRITICAL: tick → ms rounding

**`ticksToMs(ticks) = Math.round(ticks * 1000 / TPS)`**, defined at `loop.ts`'s `ticksToMs`
function — identical formula and identical rounding function to `packages/core/src/replay.ts`'s
private `ticksToMs` (`replay.ts:114`, `:122-124`). This is not merely stated to match — it is
*proven* to match by the end-to-end test (see "Numbers" below): a tape recorded by this module, run
through the real `verifyReplay`, is accepted with **zero** tolerance needed, at the default
zero-tolerance setting. If the rounding functions disagreed even by one direction on one boundary
case, `verifyReplay`'s independently-recomputed `timeMs`/`boostMs` would not equal the claimed
values and `result.ok` would read `false`. It reads `true`. `elapsedTicks` at capture is also
defined identically on both sides: `captureTick + 1` (0-based tick index of the tick on which
`reachedGoal` first became true, plus one) — `loop.ts`'s `completeAttempt()` calls
`tapeRecorder.finish(elapsedTicks)` with exactly that value.

## Definition of done

| Item | Status | Reason |
|---|---|---|
| A level completes with correct time and boost totals | ✅ | End-to-end test: `BUILTIN_LEVELS[0]` driven by T-03's real solvability tape reaches `status:"complete"` with `timeMs=14653`, `boostMs=0`, both accepted by `verifyReplay`. |
| Tick count identical at 30, 60, and 144 fps for the same input tape | ✅ | Measured: 288/288/288 ticks over a synthetic 2s drive at each fps, 0 deviation from the 288-tick ideal. See "Numbers". |
| The recorded tape replays through `verifyReplay` with zero divergence | ✅ | `verifyReplay` returned `{ok:true, timeMs:14653, boostMs:0, ticks:2110}` — exact match against the claimed values, no tolerance parameter used. |
| A 5-second tab stall does not spiral: bounded catch-up, no frozen frame | ✅ | Single `frame(5.0)` call executes exactly **8** ticks (`MAX_TICKS_PER_FRAME`), not 720. A real floating-point boundary bug was found and fixed here — see "Numbers" and the log. |
| Camera smoothing is visually identical at 60 and 144 fps | ✅ | Zoom-out smoothing after 0.5s of simulated time: 30 steps at 1/60 vs 72 steps at 1/144 agree to `5.55e-17` absolute difference (float noise only — the exponential-decay compounding is exact by construction for any step subdivision of a fixed total time). |
| `onComplete` fires exactly once per attempt | ✅ | 10 consecutive attempts via `restart()`, `onComplete` fired exactly 10 times total (never 0, never 2, for any attempt); a further 20 `frame()` calls after a single capture produce no additional firing. |
| Restart fully resets positions, velocities, timers, trail, tape, and `firstBoostFired` | ✅ | Indirect but strong proof: 10 `restart()`-driven replays of the *identical* tape from tick 0 produce **bit-identical** `onComplete` payloads (`timeMs`, `boostMs`, and the full `tape` object deep-equal across all 10) — any leaked state (position, velocity, `xAcc`/`yAcc`, `firstBoostFired`, tick counters, the `TapeRecorder`) would almost certainly have made at least one of the 10 runs diverge in capture tick or fail to reach the goal within the guard window. Also verified directly: immediately after `restart()`, `snapshot()` reports `elapsedTicks:0`, `boostTicks:0`, `reachedGoal:false`, `status:"resetting"`. |
| Tests run headlessly — no browser required | ✅ | `packages/web/test/loop.test.ts` uses a hand-written fake canvas/2D-context (not jsdom, not a real browser); `npx vitest run` confirms no DOM/browser API is touched at module scope. |
| Global checklist — PROJECT.md §7 | | |
| `npm run typecheck` clean | ✅ | Clean, exit 0, for the whole repo at time of writing (see "What could not be verified" for one transient unrelated blip observed mid-session). |
| `npm test` green, including other tasks' suites | ⚠️ partially outside my control | `packages/web/test/loop.test.ts`: 18/18 green. Full repo: 561 passed / 7 failed / 1 skipped (569 total). All 7 failures are in `api/test/` (T-12 LEDGER's files — `_db.test.ts`, `_validate.test.ts`, `score.test.ts`), zero overlap with anything T-05 owns. The 1 skip is T-01's own documented, intentional Godot-parity skip. Confirmed by the orchestrator independently as pre-existing and not mine to fix. |
| No file outside my ownership row in INTERFACES.md modified | ✅ | Only `packages/web/src/game/loop.ts`, `camera.ts`, `bounds.ts`, `packages/web/test/loop.test.ts`, `notes/T-05-FLYWHEEL/log.md`, `results/T-05-FLYWHEEL.md` were written. |
| No new runtime dependency in `packages/core` | ✅ | `packages/core` untouched entirely — this task only writes into `packages/web`. |
| Interfaces consumed are unchanged | ✅ | Consumed `@swingby/core` (T-01/T-02/T-03), `../render/index.js` (T-04, types + `createRenderer` only), `./input.js` (T-06, types only), `./audio.js` (T-07, types only) — all read-only, all exactly as frozen in INTERFACES.md. |
| Anything measured is reported as a number, not an adjective | ✅ | See "Numbers" below. |
| UI work includes a screenshot; numeric work includes the measurements | N/A / ✅ | No UI work in this task (no DOM/rendering owned here) — numeric measurements included throughout. |

## Numbers

**1. Tick counts at 30/60/144 fps** (`createGameLoop.frame(dt)` driven synthetically over a fixed
2-second wall-clock duration, `DRIFT_FIXTURE_LEVEL` — a level engineered to never reach its own goal
within the test window, so the count reflects pure timestep bookkeeping, not an early completion):

| fps | dt (s) | frames driven | ticks executed | ideal (`round(2×144)`) | deviation |
|---|---|---|---|---|---|
| 30 | 0.03333… | 60 | **288** | 288 | 0 |
| 60 | 0.01667… | 120 | **288** | 288 | 0 |
| 144 | 0.00694… | 288 | **288** | 288 | 0 |

All three identical, zero deviation from ideal. This is the entire point of the fixed timestep.

**2. Spiral-of-death guard.** Single `frame(5.0)` call (simulating a 5-second backgrounded-tab gap)
on a fresh session: **8 ticks executed**, not 720 (`5 × 144`). `MAX_TICKS_PER_FRAME = 8` is enforced.

A genuine bug was found and fixed while measuring this: the naive implementation (clamp `dt` to
`MAX_FRAME_TIME = 8 × TICK_INTERVAL`, drain via `while (accumulator >= TICK_INTERVAL)`) measured
**7**, not 8. Root cause, confirmed with a standalone repro: `8 × (1/144)` accumulated as a float,
then drained via 7 subtractions of `1/144`, leaves `0.006944444444444434` against a `TICK_INTERVAL`
of `0.006944444444444444` — short by `1.04e-17`, pure IEEE 754 rounding noise. Fix: a
`TICK_EPSILON = 1e-9` tolerance on the drain comparison (`accumulator >= TICK_INTERVAL -
TICK_EPSILON`) — eight orders of magnitude bigger than the observed noise, seven orders of magnitude
smaller than any real per-frame `dt` (0.0069s at 144fps is the smallest normal case), so it cannot
manufacture a spurious extra tick in normal play. Re-measured the 30/60/144fps parity numbers above
*after* this fix: still exactly 288/288/288, confirming the epsilon has no effect on normal
operation.

**3. End-to-end — physics, recording, and verification agreement.** `BUILTIN_LEVELS[0]`
(`levelId(0) === "builtin-00"`) driven by T-03's own verified solvability tape
(`packages/core/test/level/solvability/tapes/builtin-00.json`, read-only, 2110 ticks, brake held
ticks 0–49) through a real `createGameLoop` session to completion:

- `elapsedTicks = 2110`, `timeMs = 14653`, `boostMs = 0`.
- Recorded `tape.ticks = 2110` — matches the source tape's own `ticks` exactly (expected: T-03's
  tapes are `captureTick + 1`-tight by construction).
- `onComplete` fired **exactly once**.
- `verifyReplay(level, tape, {timeMs: 14653, boostMs: 0})` → **`{"ok":true,"timeMs":14653,"boostMs":0,"ticks":2110}`**
  — **ACCEPTED**, zero tolerance parameter needed.

**4. `onComplete` exactly-once.**
- Single attempt: 1 firing at capture; 20 further `frame()` calls after capture produce 0 additional
  firings (`completions.length` stays at 1, `status` stays `"complete"`).
- 10 attempts via `restart()`: `onComplete` fired **exactly 10 times**, one per attempt, never 0 and
  never 2 for any single attempt.

**5. Camera smoothing, frame-rate independence.**
- Zoom-out (target below current, uses `ZOOM_SMOOTHING = 8.0`) after 0.5s simulated: 30 steps at
  dt=1/60 → `zoom = 0.41098938333324053`; 72 steps at dt=1/144 → `zoom = 0.4109893833332405`.
  Absolute difference: **5.551115123125783e-17** (float noise only).
- Asymmetry: one frame at dt=1/60, zoom-in progress (target above current, `ZOOM_IN_SMOOTHING = 20.0`)
  = `0.14173434471310542`; zoom-out progress (same magnitude, `ZOOM_SMOOTHING = 8.0`) =
  `0.062413340478526314`. Zoom-in is measurably faster, as specified.

**6. Bounds.**
- Countdown armed at ratio > 1, cancelled on recovery to ratio ≤ 1 (both confirmed directly on
  `BoundsState`).
- Continuous countdown (dt = 1/60 steps) from arming to expiry: measured **0.6500s** against a
  `BOUNDS_WARNING_DURATION` of 0.65s (quantized to the 1/60s step grid used to drive it, hence not
  bit-exact but within one frame).
- Full-pipeline live-session check (`escapeLevel` fixture: high-speed straight-line departure,
  negligible gravity): bounds ratio crosses 1 mid-session, the countdown runs while ticks keep
  advancing normally (matching Godot: physics is not held during the warning), and an **automatic**
  reset fires (`status → "resetting"`, `elapsedTicks → 0`) with no manual `restart()` call.

**7. Prove the tests can fail** (`runTicks`'s fixed-timestep `while` condition temporarily replaced
with `while (ticksThisFrame < 1)` — exactly one tick per `frame()` call regardless of `dt`, a
textbook variable-timestep bug):

```
 ❯ packages/web/test/loop.test.ts (18 tests | 2 failed) 313ms
   × frame-rate independence > tick count is identical at 30/60/144 fps for the same wall-clock duration
     → expected 60 to be 120 // Object.is equality
   × frame-rate independence > a 5-second frame gap is capped at MAX_TICKS_PER_FRAME (8), not 720
     → expected 1 to be 8 // Object.is equality

 Test Files  1 failed (1)
      Tests  2 failed | 16 passed (18)
```
Console output before the assertion failures: `30fps=60 60fps=120 144fps=288` (deviation from ideal:
`-228, -168, 0`) and `ticks executed after a 5s stall: 1`. Exactly the two accumulator-dependent
tests failed, with the exact failure signature expected (tick count now scales with frame count
instead of wall-clock time); the other 16 (end-to-end/tape/restart/camera/bounds) stayed green,
since they don't depend on the tick-count-per-frame property, only on ticks eventually happening in
the right order, which the broken version still does. Reverted immediately after capturing this.
Re-ran: **18/18 green again**, numbers matching the pre-break measurements exactly (288/288/288,
8-tick spiral cap).

## Test results

- `npx vitest run packages/web/test/loop.test.ts` → **18 passed, 0 failed** (18 total).
- `npm run typecheck` → clean, exit 0, repo-wide, at time of writing.
- `npx vitest run` (whole repo) → **561 passed, 7 failed, 1 skipped** (569 total); all 7 failures in
  `api/test/` (T-12 LEDGER), unrelated to this task; the 1 skip is T-01's own documented, intentional
  Godot-parity gate.
- `npx prettier --check` on the 4 files this task owns → clean (`All matched files use Prettier code
  style!`).

## Design decisions worth a reviewer's attention

- **Bounds origin fixed at world-space `(0,0)`**, not Godot's viewport-pixel-size `world_origin`
  hack — matches T-01's own documented decision for `TickResult.outOfBounds`
  (`notes/T-01-KEPLER/log.md`, `physics.ts:340-352`), which explicitly names T-05 as the task to
  agree with. The warning ramp and the actual out-of-bounds trigger use the identical origin/formula
  by construction, so they can never visually disagree (full-red warning with `outOfBounds` still
  false, or vice versa).
- **Camera origin is a level-specific fixed point** (the bounding-box center of the level's starting
  bodies, computed once per attempt), not Godot's `world_origin` (literally half the game window's
  pixel dimensions, reassigned every frame — a quantity with no portable meaning for an
  arbitrarily-resizable canvas). The *smoothing/zoom-to-fit formula itself* (`_recalculate_zoom`,
  `GameWorld.gd:662-676`) is ported verbatim. This is a documented, deliberate divergence from the
  reference implementation's literal mechanism, not from its intent.
- **`"resetting"` status holds the tick loop for `RESET_FLASH_DURATION` (0.24s)** before returning to
  `"playing"`, unlike Godot (where `restart_level()` is instant and gameplay is already live during
  the cosmetic flash). World state, trail, tape, and timers all reset immediately on `restart()` —
  only tick *simulation* is held for the flash window. Chosen for simplicity; behaviorally almost
  identical anyway (a fresh attempt sitting still at tick 0 for ~35 ticks changes nothing
  observable).
- **`pause()`/`resume()` zero the tick accumulator** on both transitions, rather than replicating
  Godot's "keep draining the accumulator while skipping the physics call" mechanism. Functionally
  equivalent (no catch-up burst on resume either way), simpler to reason about and test.
- **`Body.boostType` override from `Settings.boostType`** applied after every `hydrate()` call
  (`clampInt(settings.boostType, 0, 3)`) — `level.ts`'s own doc comment explicitly says the persisted
  value is an inert echo and "callers that want 'the skin to render' should apply their own
  Settings-derived override on top, same as Godot does." This task is that caller.
- **`input.setBindings(settings.controls)` and edge-triggered `"restart"`/`"pause"` handling** are
  done inside the loop (`opts.input.drainEvents()` drained once per frame), since `GameSession` is
  the sole legitimate owner of the injected `InputSource` — `drainEvents()` destructively drains a
  queue, so a second concurrent consumer would silently steal events from the first. `"menu"`,
  `"toggleFps"`, `"toggleHighscores"` are drained (so the queue doesn't back up) but not acted on —
  those are UI/settings concerns outside a `GameSession`'s scope, and `GameSession` has no hook to
  forward them elsewhere. Flagged here for whoever builds T-09 GAUGE / T-08 BRIDGE.
- **`attachTouch(...)` is deliberately never called from `loop.ts`** — it requires concrete on-screen
  button layout (a `DOMRect` per zone), which is a HUD/UI concern, not something a `GameSession`
  constructed from just a `<canvas>` can invent.
- Neither `input.destroy()` nor `audio.destroy()` is called from `GameSession.destroy()` — both were
  injected by the caller (constructed outside `createSession`), so their lifecycle is assumed to be
  the caller's, not this session's (e.g. reusing one `InputSource`/`AudioSink` across level
  navigations without recreating it every time). `destroy()` only cancels this session's own rAF
  handle and clears its own subscriber lists.

## What could not be verified

- **Real-browser manual checks** (task doc's "How to verify" §3 "switch tabs for 5s and return in
  the browser" and §4 "record at 60 and 144fps [in a real browser] and compare zoom response") —
  this environment has no jsdom and no real browser/`requestAnimationFrame` (confirmed empirically,
  same finding T-04 AURORA's log records independently for the render package). Substituted with the
  synthetic-`dt` equivalents described above, which are strictly more precise (bit-exact numbers
  instead of "looks the same") for exactly the claims being tested — frame-rate independence and
  smoothing-rate correctness are properties of the math, not of wall-clock timing jitter, so a
  synthetic drive is the more rigorous check, not a weaker substitute.
- **A live-rendered visual check of camera/bounds/trail/prediction overlays** — `RenderFrame` is
  built and handed to a real `Renderer` (via `createRenderer`) in every test, and the fake 2D context
  records every draw call without crashing, but nothing inspects the *pixels* (that's T-04 AURORA's
  own, already-verified territory for the renderer itself; this task's job is producing a correct
  `RenderFrame`, which is what's tested).
- **One transient `npm run typecheck` failure** was observed mid-session (2 errors in
  `api/test/_ratelimit.test.ts`, an `IncomingMessage` cast issue, T-12 LEDGER's file) that was gone
  on an immediate rerun — almost certainly a concurrent edit from another task's agent caught
  mid-save (the same transient-error pattern T-02 TAPE's own log records for a different file). Not
  something in this task's files; typecheck is clean as of the final run reported above.
- **The 7 failing `api/test/` tests and the 1 skipped `packages/core` test** are outside this task's
  ownership and were not investigated further, per the explicit instruction to ignore other tasks'
  concurrent state and the orchestrator's independent confirmation that this matches what it already
  observed.
