# T-06 · HELM — Input: keyboard, touch, gamepad, rebinding

**Area:** `packages/web/src/game/input.ts` · **Depends on:** nothing · **Blocks:** T-05 FLYWHEEL

## Goal

One `InputSource` that turns keyboard, touch, and gamepad into the same `InputState`, polled once per
simulation tick. Mobile is a first-class target, not a fallback.

## Owned files

```
packages/web/src/game/input.ts
packages/web/src/game/touch-zones.ts
packages/web/test/input.test.ts
```

## Reference

`reference/godot/scripts/InputHandler.gd`, and `DEFAULT_CONTROLS` in `constants.ts` (frozen).
`reference/swift/InputManager.swift` has a well-factored multi-touch model worth reading.

## Interface

Exactly as in [INTERFACES.md](../INTERFACES.md#webgameinputts--t-06-helm).

## Two kinds of input, kept separate

**Continuous** — boost, brake, directional thrust. Polled by the loop via `poll()`, must be cheap and
allocation-free. Reflects the state *now*.

**Edge-triggered** — restart, pause, menu, toggle FPS, toggle highscores. Queued on keydown, drained
once per frame via `drainEvents()`. Never poll these; a held key must fire once.

Conflating the two is the classic bug here: a held restart key restarting every tick.

## Bindings

`KeyboardEvent.code`, not `.key`. `code` is physical position, so `KeyW` is the same key on QWERTZ —
which matters, since this is a German-keyboard household. `.key` would give `z` on QWERTZ for the
same physical key.

Defaults are in `DEFAULT_CONTROLS`. Rebinding UI is T-08 BRIDGE's; you own `setBindings` and the
matching logic. Support cancelling a pending rebind, and reject binding a key already bound to
another action (or unbind the other — pick one and document it).

## Directional thrust

`SIDE_THRUST` is `0.0`, so WASD currently does nothing. Populate `thrustX`/`thrustY` correctly
anyway — the contract is defined and the constant may change. But **do not surface WASD in the
on-screen control hints** while the force is zero: teaching new web players a control that does
nothing is worse than omitting it. Flag it if you disagree; this is a judgement call, not a
constraint.

## Touch

The model that works for this game (from the Swift version): split the screen into a boost zone and
a brake zone, track touches by identifier, and hold while any touch is inside the zone.

- Track by `Touch.identifier`. Multi-touch is required — boost and brake simultaneously must work.
- `touchcancel` must release, or an interrupting call leaves the ship boosting forever.
- `touch-action: none` on the canvas to kill scroll and double-tap zoom.
- Zones come from `attachTouch`; T-08 BRIDGE decides the layout and passes rects.
- Do not use `preventDefault` on `touchstart` globally — it breaks UI buttons outside the canvas.

Prototype this early on a real phone. It is the single most likely thing to make the web version
feel bad, and it cannot be evaluated on desktop.

## Gamepad

Gamepad API, polled in `poll()`. Godot maps boost to A / right shoulder, brake to B / left shoulder.
Cheap to add; skip only if it fights the touch work.

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | `createInputSource` + the `InputSource` interface | `packages/web/src/game/input.ts` |
| 2 | Touch zone geometry and hit-testing | `packages/web/src/game/touch-zones.ts` |
| 3 | Unit tests for polling, edge events, binding matching | `packages/web/test/input.test.ts` |
| 4 | Dev page showing live `InputState` and drained events | `packages/web/src/game/input-dev.html` |
| 5 | **Video or screenshot of the dev page on a real phone**, in the PR | — |

## Definition of done

- [ ] `poll()` allocates nothing — heap profile over 10,000 calls
- [ ] Held edge-triggered keys fire **exactly once**
- [ ] Simultaneous boost + brake on touch both register
- [ ] `touchcancel` and window `blur` release everything — no stuck inputs
- [ ] Bindings work on QWERTZ and QWERTY unchanged (`code`, not `key`)
- [ ] Rebinding persists via T-10 VAULT's settings object — you never touch `localStorage`
- [ ] Verified on a real phone, not an emulator or a narrow desktop window
- [ ] No dependency on `loop.ts`, `render/`, or `ui/`
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Working standalone

Ship a dev page that prints live `InputState` and drained events. That is enough to develop and
demo this task with nothing else built, and it doubles as the manual test for the phone.

## How to verify

```bash
npm test -w @swingby/web -- input
npm run dev -w @swingby/web
# open http://localhost:5173/src/game/input-dev.html
```

**1. Edge vs. continuous.** Hold the restart key for 5 s on the dev page. `drainEvents` must report
exactly one `restart`. Hold boost for 5 s: `poll()` must report `boost: true` throughout.

**2. Stuck-input paths.** These are the ones that ruin a session:
- Start a touch in the boost zone, then `touchcancel` (take a call, or swipe into the system UI).
- Hold boost, then `alt-tab` away. Window `blur` must release it.

Both must end with `boost: false`.

**3. Layout independence.** Switch the OS keyboard to QWERTZ and confirm the WASD cluster still maps
to the same physical keys. If `key` was used instead of `code`, `KeyW`/`KeyZ` will betray it.

**4. On a real phone — required, not optional:**

```bash
npm run dev -w @swingby/web -- --host
# open http://<your-lan-ip>:5173/src/game/input-dev.html on the phone
```

Confirm simultaneous boost + brake registers, that the page does not scroll or zoom on double-tap,
and that dragging off a zone releases cleanly. Attach a screen recording to the PR — this is the
single most likely thing to make the web version feel bad, and it cannot be judged on desktop.

**5. Allocation:** DevTools → Memory, 10,000 `poll()` calls, no allocation sawtooth.
