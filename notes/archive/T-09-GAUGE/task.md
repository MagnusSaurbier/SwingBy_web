# T-09 · GAUGE — In-game HUD, pause, level complete, toasts

**Area:** `packages/web/src/hud` · **Depends on:** T-05 FLYWHEEL *(interface only)* · **Blocks:** nothing

## Goal

Everything overlaid on the game canvas during play. DOM on top of canvas — not drawn into it.

## Owned files

```
packages/web/src/hud/**
```

## Reference

`reference/godot/scripts/HUDController.gd` (309 lines) — `_update_hud` and the refresh methods.

## Interface

Consumes `GameSession` from T-05:

```ts
session.subscribe((snapshot: GameSnapshot) => { /* update DOM */ });
session.onComplete(({ timeMs, boostMs, tape }) => { /* completion panel */ });
```

You read `GameSnapshot`. You never touch `world`, `physics`, or the renderer.

## Elements

| Element | Source | Notes |
|---|---|---|
| Level label + name + author | level metadata | Fades after ~3 s |
| Elapsed time | `snapshot.elapsedTicks` | `ticks / TPS`, format `M:SS.mmm` |
| Boost time | `snapshot.boostTicks` | The efficiency metric — give it equal weight to time |
| Personal best | T-10 VAULT | Only when `showTimes` |
| Hint text | level hints | Context-triggered; see below |
| FPS | `snapshot.fps` | Only when `showFps` |
| Bounds warning | `snapshot.boundsWarning` | Escalating visual, paired with T-07's alarm |
| Pause indicator | `snapshot.status` | |
| Toasts | — | Short non-blocking messages: "Target reached", "Saved custom stage" |

## Panels

**Pause** — Resume, Restart, Settings, Level Select, Main Menu. Reuses T-08's in-game menu
component; coordinate rather than duplicating it.

**Level complete** — time and boost, whether either is a new personal best, and Next / Retry /
Level Select. This is also where leaderboard submission surfaces (T-13 PODIUM), so leave a slot for
it and do not block the panel on a network call.

## Hints

The Swift project models these as `{ condition, text }` with conditions `notBoosted`, `nearBounds`,
`nearGoal`. The Godot tutorial has richer triggers. Built-in level JSON currently carries no hints,
so this is additive — design the trigger evaluation so hints can be attached per level later without
schema churn, and ship the tutorial hints at minimum.

## Update discipline

`subscribe` fires every frame. Naive DOM writes at 144 Hz will cost more than the renderer.

- Cache node references once; never query in the callback.
- Write only on change — compare against the last rendered value.
- Time readouts only need ~10 Hz. Throttle them; nobody reads milliseconds at 144 fps.
- No layout thrash: never read `offsetWidth` in the update path.

Budget: **under 1 ms per frame**. Measure it.

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | HUD: level info, timers, hints, FPS, bounds warning | `packages/web/src/hud/hud.ts` |
| 2 | Pause panel | `packages/web/src/hud/pause.ts` |
| 3 | Level complete panel, with a slot for T-13's rank | `packages/web/src/hud/complete.ts` |
| 4 | Toast queue | `packages/web/src/hud/toast.ts` |
| 5 | Fake `GameSession` emitting scripted snapshots | `packages/web/test/fake-session.ts` |
| 6 | Measured HUD update cost, in the PR | — |

## Definition of done

- [ ] Time and boost readouts match the completion values **exactly** — no rounding drift between
      the live HUD and the recorded score
- [ ] HUD update stays **under 1 ms/frame at 144 fps** — report the number
- [ ] Pause panel opens and closes without disturbing the simulation
- [ ] Completion panel appears **exactly once** per attempt
- [ ] Toasts queue and expire; a burst does not stack into a wall
- [ ] Usable at 360 px wide **and does not overlap the touch zones T-06 defines** — check with HELM
- [ ] No layout thrash: no `offsetWidth`/`getBoundingClientRect` reads in the update path
- [ ] No import from `render/` or `core/physics`
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Working without T-05

`GameSession` is a small interface. Stub it with a fake that emits scripted snapshots on a timer —
enough to build and demo the entire HUD before the loop exists.

## How to verify

```bash
npm test -w @swingby/web -- hud
npm run dev -w @swingby/web
```

**1. Readout agreement — the one that produces bug reports.** Complete a level and compare the final
HUD time against the value in the completion panel and the value submitted. All three must be
identical. A rounding difference here reads to players as a stolen personal best.

**2. Update cost.** DevTools → Performance, 10 s of play at 144 fps. Filter to your update callback;
mean must be under 1 ms. Report the number.

**3. No layout thrash.** In the Performance recording, confirm no forced reflow warnings inside the
update path. Any `offsetWidth` read there will show up as one.

**4. Completion fires once.** Finish a level ten times; the panel must appear exactly ten times,
never twice for one capture.

**5. Toast burst.** Fire 20 toasts in 2 s from the console. They must queue and expire, not stack
into a wall or overlap.

**6. Touch-zone overlap** — check with T-06 HELM. At 360 px wide, overlay the HUD on the touch zone
rects and confirm no interactive HUD element sits inside a zone. A pause button under the boost zone
makes the game unplayable on a phone and is invisible on desktop.

Before T-05 lands, drive all of this from the fake session in `packages/web/test/fake-session.ts`.
