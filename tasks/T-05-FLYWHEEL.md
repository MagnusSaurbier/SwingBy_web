# T-05 · FLYWHEEL — Game loop, camera, bounds, win condition

**Area:** `packages/web/src/game` · **Depends on:** T-01, T-04, T-06, T-07 *(interfaces only)*
**Blocks:** T-09 GAUGE, T-11 DRAFT · **Critical path.**

## Goal

The thing that turns a physics library and a renderer into a game: a fixed-timestep loop, a camera
that keeps the ship framed, bounds handling with auto-reset, and goal detection.

## Owned files

```
packages/web/src/game/loop.ts
packages/web/src/game/camera.ts
packages/web/src/game/bounds.ts
packages/web/test/loop.test.ts
```

## Reference

`reference/godot/scripts/GameWorld.gd` — `_process`, `_recalculate_zoom`, `_check_win_condition`,
`_check_world_bounds`, `_trigger_shake`, `_reset_runtime_state`.

## Interface

Exactly as in [INTERFACES.md](../INTERFACES.md#webgameloopts--t-05-flywheel).

## The loop

Fixed timestep at `TICK_INTERVAL` (1/144 s), accumulator pattern, rendering decoupled at rAF rate.

```
frame(dt):
  accumulator += min(dt, MAX_FRAME_TIME)
  ticks = 0
  while accumulator >= TICK_INTERVAL and ticks < MAX_TICKS_PER_FRAME:
    input = inputSource.poll()
    tapeRecorder.record(tickIndex, input)
    result = simulateTick(world, input, { allowInput, firstBoostFired })
    accumulator -= TICK_INTERVAL
    ticks++
  renderer.draw(buildFrame())
```

- `MAX_TICKS_PER_FRAME = 8`. Without this cap, a backgrounded tab returns with seconds of
  accumulated time and the loop spirals. Dropping simulation time is correct here — the alternative
  is a frozen page.
- **Sample input once per tick, inside the loop** — not once per frame. Sampling per frame makes the
  recorded tape disagree with what was simulated, and T-02's verification will reject the score.
- `elapsedTicks` and `boostTicks` are integer counters. Convert to ms only at the display and API
  boundary. Never accumulate wall-clock seconds — it makes scores frame-rate dependent.

## Camera

Auto-zoom keeps the ship and the system framed: compute the bounding box of the player plus nearby
bodies, apply `ZOOM_MARGIN` (0.72), and smooth toward the target. Zooming **out** uses
`ZOOM_SMOOTHING` (8.0); zooming **in** uses `ZOOM_IN_SMOOTHING` (20.0) — asymmetric on purpose, so
the camera retreats gently but recovers quickly. Smoothing is per-second exponential, so it must be
frame-rate independent: `factor = 1 - exp(-rate * dt)`.

Camera shake on first boost and on goal capture (`_trigger_shake`). Shake is presentation only —
never let it touch simulation state.

## Bounds

Rectangle, half-extents `MAX_WORLD_BOUNDS_X/Y` (2600 × 1800). At
`BOUNDS_WARNING_START_RATIO` (0.8) begin a warning ramping 0→1 over the remaining distance; feed it
to `frame.boundsWarning` and to T-07's `setAlarm`. On full exit: flash
(`RESET_FLASH_DURATION` 0.24 s), reset cue, restart the attempt.

## Win condition

Player within `goalRange` of `bodies[goalIndex]`, checked once per tick after the step. On capture:
stop the clock, freeze input, emit `onComplete` with `{ timeMs, boostMs, tape }`. Emit **exactly
once** — a second emission double-submits to the leaderboard.

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | `createSession` + the `GameSession` interface | `packages/web/src/game/loop.ts` |
| 2 | Camera with asymmetric zoom smoothing | `packages/web/src/game/camera.ts` |
| 3 | Bounds warning, reset, and flash | `packages/web/src/game/bounds.ts` |
| 4 | Headless tests with stubbed renderer/input/audio | `packages/web/test/loop.test.ts` |
| 5 | Measured tick counts at 30/60/144 fps, in the PR | — |

## Definition of done

- [ ] A level completes with correct time and boost totals
- [ ] **Tick count identical at 30, 60, and 144 fps** for the same input tape — the whole point of
      the fixed timestep. Drive `frame(dt)` directly with synthetic `dt`
- [ ] The recorded tape replays through `verifyReplay` with **zero** divergence — the integration
      test proving loop and physics agree
- [ ] A 5-second tab stall does not spiral: bounded catch-up, no frozen frame
- [ ] Camera smoothing is visually identical at 60 and 144 fps
- [ ] `onComplete` fires **exactly once** per attempt
- [ ] Restart fully resets positions, velocities, timers, trail, tape, and `firstBoostFired`
- [ ] Tests run headlessly — no browser required
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Working without dependencies

Every dependency is injected via `createSession`. Stub them: an `InputSource` replaying a fixed
array, a no-op `AudioSink`, a `Renderer` that counts calls. The loop is testable headlessly and
should be tested that way — do not require a browser to run these tests.

## How to verify

**1. Frame-rate independence — the core claim:**

```bash
npm test -w @swingby/web -- loop
```

The test drives `frame(dt)` with synthetic `dt` for 30, 60, and 144 fps over the same input tape and
asserts identical tick counts and identical final positions. If these differ, wall-clock time is
leaking into the simulation and every recorded score is frame-rate dependent.

**2. The loop agrees with the physics** — the integration test that matters:

```bash
npm test -w @swingby/web -- loop-replay
```

Play a scripted level through the session, take the emitted tape, run it through `verifyReplay`, and
assert **zero** divergence. This is the check that catches sampling input per frame instead of per
tick — a bug that looks completely fine until scores start being rejected in production.

**3. Stall recovery.** In the browser, switch tabs for 5 s and return. The game must resume with
bounded catch-up, not a freeze and not a teleport.

**4. Camera.** Record at 60 and at 144 fps and compare zoom response. Asymmetric smoothing (8.0 out,
20.0 in) must look the same at both — if it does not, the exponential smoothing is not
frame-rate corrected.

**5. Single completion.** Instrument `onComplete` with a counter and finish a level ten times. The
counter must read exactly 10.
