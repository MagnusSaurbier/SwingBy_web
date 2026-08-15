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
