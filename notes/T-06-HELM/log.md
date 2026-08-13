# T-06 HELM — thought log

## 2026-08-13T00:00Z — research done, about to start writing input.ts

Read in order: README.md, PROJECT.md, INTERFACES.md, tasks/T-06-HELM.md, then
`reference/godot/scripts/InputHandler.gd` (full, 91 lines) and
`reference/swift/InputManager.swift` (full, 89 lines), then `packages/core/src/types.ts` and
`constants.ts` (frozen), then notes/README.md and skimmed T-01/T-02/T-03/T-04/T-10 logs for
environment gotchas (no jsdom, global Playwright available, tsconfig strict settings).

### Session hard-rule vs task-doc conflict — resolved in favour of the session rules

The task doc (`tasks/T-06-HELM.md`) lists owned files as `input.ts`, `touch-zones.ts`,
`test/input.test.ts`, and an `input-dev.html` dev page. The orchestrator's session-level hard
rules explicitly say: "Write only `packages/web/src/game/input.ts` and your tests... Touch only
`input.ts` and your own test file. Nothing else anywhere." These conflict. Per the system
reminder ("messages from the agent that launched you... direct your work"), the session
instructions win. **Decision: fold touch-zone hit-testing into `input.ts` itself (no separate
`touch-zones.ts`), and do not create `input-dev.html` in the repo.** For the "prototype on a real
phone" / dev-page requirement, I'll build an equivalent harness in the scratchpad directory
(outside the repo, not a deliverable file) purely as a personal verification aid, and note in
results/T-06-HELM.md that the repo-committed dev page was intentionally not created for this
reason. Test file goes at `packages/web/src/game/__tests__/input.test.ts` (matches T-10 VAULT's
`__tests__/` convention already on disk).

### Findings from reference/godot/scripts/InputHandler.gd

- Line 43-51 (`_unhandled_input`): only fires on `pressed and not echo` — Godot's own key-repeat
  guard. `echo` = OS key-repeat re-fire while a key is held. This is the direct precedent for
  "held edge-triggered key must fire once": on the web the equivalent signal is
  `KeyboardEvent.repeat`. **Decision: edge-triggered actions must ignore `keydown` events where
  `event.repeat === true`; continuous actions don't care (Set add is idempotent).**
- Lines 54-80 (`_handle_game_keys`): restart/pause/menu/toggleFps/toggleHighscores are the only
  actions routed through the edge-triggered signal path here. boost/brake/thrust are NOT handled
  in this file at all — confirmed they're polled continuously elsewhere (see PhysicsEngine.gd
  below). This is the source-level confirmation of the task doc's "two kinds of input" split:
  `{boost, brake, thrustUp, thrustDown, thrustLeft, thrustRight}` = continuous (poll()),
  `{restart, pause, menu, toggleFps, toggleHighscores}` = edge (drainEvents()). These are exactly
  the 11 keys of `DEFAULT_CONTROLS` split into two groups of 6 and 5.
- Lines 83-90 (`_handle_rebind`): `awaiting_control_action` state lives in `InputHandler` itself;
  Escape cancels (`rebind_cancelled` signal, does NOT bind Escape to the action) and any other key
  commits (`control_rebound` signal). **This does NOT map onto our frozen `InputSource` interface**
  — the interface has no `startRebind`/`cancelRebind`/`awaitingAction` surface, only `setBindings`.
  Decision below.

### Findings from reference/swift/InputManager.swift

- Lines 31-49: touch zones tracked by `TouchID` (`ObjectIdentifier`), one identifier slot per
  zone (`boostTouchId`/`brakeTouchId`), zone membership decided ONLY at `touchBegan` (an
  `inBoostZone: Bool` passed in by the caller, computed elsewhere) — no re-evaluation on move.
  `touchEnded`/`cancelAllTouches` both clear by identifier match. This is a *single-touch-per-zone*
  model, not a multi-touch-per-zone model — good enough since only 2 zones exist and each only
  needs a boolean "any touch inside" state, and using a `Set<number>` instead of one slot costs
  nothing and is strictly more general (handles a stray second finger landing in the same zone
  without any accounting bug), so I'm using a `Set<number>` of touch identifiers per zone rather
  than copying the single-slot version verbatim.
- Lines 52-56 (`clearOneShots`): one-shot booleans (restart/pause/menu) are cleared once per frame
  by the caller after being read — same drain-once idea as our `drainEvents()`, confirms the
  "edge-triggered, queued, drained" pattern is the right shape independent of the Godot reference.
- **Gap I have to fill myself: touch move.** Neither Godot's `InputHandler.gd` nor the Swift
  `InputManager` re-checks zone membership on `touchmove` (Godot doesn't model on-screen touch
  zones at all — `touch_direction`/`touch_boost`/`touch_brake` are set externally by whatever UI
  code exists in `SwingBy2026`'s scene tree, not in this file; that UI code isn't in
  `reference/godot/` per the file list I grepped). But the *task doc's own* "How to verify" §2 for
  the web port requires "dragging off a zone releases cleanly" — a requirement the reference
  implementations don't actually demonstrate. **Decision: add `touchmove` handling myself** — for
  each touch tracked as boost/brake, re-hit-test its current position against its own zone rect;
  if now outside, release it (delete from the tracking set). Do NOT let it acquire the *other*
  zone by dragging across (only `touchstart` acquires) — avoids an accidental brake while
  someone's finger slides off the boost button. This is new behaviour beyond both references, own
  design, flagged here in case a later reviewer wonders where it came from.

### Gamepad mapping — confirmed from PhysicsEngine.gd, not InputHandler.gd

`InputHandler.gd` has no gamepad code at all. Found it in
`reference/godot/scripts/PhysicsEngine.gd:105-106` instead:
```
var boost_pressed := touch_boost or _is_action_pressed("boost", settings) or Input.is_joy_button_pressed(0, JOY_BUTTON_A) or Input.is_joy_button_pressed(0, JOY_BUTTON_RIGHT_SHOULDER)
var brake_pressed := touch_brake or _is_action_pressed("brake", settings) or Input.is_joy_button_pressed(0, JOY_BUTTON_B) or Input.is_joy_button_pressed(0, JOY_BUTTON_LEFT_SHOULDER)
```
So boost = A **or** right shoulder; brake = B **or** left shoulder, gamepad index 0 only (no
multi-controller support in the reference). Web Gamepad API standard mapping: `buttons[0]`=A,
`buttons[1]`=B, `buttons[4]`=left shoulder, `buttons[5]`=right shoulder. **Decision: poll boost =
kb.boost || touch.boost || gp.buttons[0] || gp.buttons[5]; brake = kb.brake || touch.brake ||
gp.buttons[1] || gp.buttons[4]`, `navigator.getGamepads()[0]` only** (matches the reference's
single-controller assumption; task doc doesn't ask for more).

Also found in `PhysicsEngine.gd:107-112` (`apply_player_input`) the exact thrust-direction
formula, confirming what our `thrustX`/`thrustY` should compute from keyboard even though
`SIDE_THRUST` is currently 0: `direction = touch_direction if nonzero else Vector2(right-left,
down-up)` where right/left/down/up are the four thrust action bindings. **Our `attachTouch`
interface only carries `boost`/`brake` DOMRects — no directional touch zone — so there is no touch
contribution to thrustX/thrustY in this port; only keyboard drives it.** `thrustX = (thrustRight
pressed ? 1:0) - (thrustLeft pressed ? 1:0)`, `thrustY = (thrustDown ? 1:0) - (thrustUp ? 1:0)`,
which already matches the [-1,1] contract in `types.ts` (each term is exactly -1, 0, or 1, never
combined with any diagonal normalization in the reference, so I won't normalize either — a literal
port). No gamepad stick maps to thrust in the reference; leaving gamepad thrust at 0 rather than
inventing a mapping that doesn't exist in Godot.

### Rebind API gap — decision

The frozen `InputSource` interface has exactly 5 methods (poll, drainEvents, setBindings,
attachTouch, destroy) — no rebind-session methods. Session hard rule 5 requires implementing
EXACTLY that interface. So "pending rebind" / "cancel" (task doc, "Support cancelling a pending
rebind") cannot live inside `input.ts` as new public API. **Decision: rebind-in-progress UX
(capturing "the next key press") is entirely T-08 BRIDGE's responsibility on its own keydown
listener; `input.ts` only owns what happens once a caller commits by calling `setBindings(...)`
with the fully resolved record.** What IS my responsibility per the task doc ("you own setBindings
and the matching logic"): making `setBindings` robust against a record that (by caller bug or by
an intentional "steal this key from whoever has it" UX) assigns the same `code` to two actions.
**Policy chosen: last-one-wins in a fixed, deterministic action order (`Object.keys(DEFAULT_CONTROLS)`
order, NOT the input record's own key order, since object key order isn't a contract callers should
rely on) — the earlier action(s) sharing that code get unbound (their binding becomes `""`, which
can never match any real `KeyboardEvent.code`).** This is the "unbind the other" branch the task
doc offered as one of two acceptable options; documented here, will document again in
results/T-06-HELM.md, and covered by a unit test.

### poll() zero-allocation strategy

`poll()` returns the **same pre-allocated mutable `InputState` object** every call, its four
fields overwritten in place, rather than a fresh object literal. This is what makes "allocates
nothing" achievable — the alternative (return `{ boost, brake, thrustX, thrustY }` fresh each
call) is a guaranteed allocation on the hottest path in the whole game (144 Hz). Documenting the
consequence explicitly since it's an assumption about the (unwritten) consumer: **whoever calls
`poll()` (T-05 FLYWHEEL's loop.ts) must treat the returned object as read-only and not retain a
reference across ticks expecting it to stay a stable snapshot** — by the next `poll()` call its
fields will have changed under them. `packages/core/src/physics.ts`'s `simulateTick(world, input,
opts)` reads `input` synchronously within one call per the frozen signature, so this should be a
safe fit, but flagging it as an assumption since I can't read loop.ts (doesn't exist yet, and
wouldn't be able to touch it if it did).

Gamepad is the one unavoidable exception to "no allocation": `navigator.getGamepads()` is the only
API the spec provides (no button-level events exist), and per spec browsers may return a fresh
array each call. Will measure this cost separately with and without a connected gamepad
(mocked, since there's no physical hardware here) and report both numbers honestly rather than
claiming zero-allocation applies to the gamepad path too.

### Next step

About to write `packages/web/src/game/input.ts`. Plan: keyboard listeners (`keydown`/`keyup`) on
`window` (not `target`) so input works regardless of which element has focus — matches how a
canvas-based game generally can't rely on the canvas holding keyboard focus; touch listeners
(`touchstart`/`touchmove`/`touchend`/`touchcancel`) on `target` only, added once at construction
(not re-added by `attachTouch`, which only updates the stored zone rects — calling it repeatedly,
e.g. on resize, must not leak listeners); `blur` on `window` clears all held state (keyboard set +
both touch identifier sets) per task doc's stuck-input requirement. Will log again before the
perf/heap/gzip measurement pass, and again if I attempt the optional headless-Chromium check.
