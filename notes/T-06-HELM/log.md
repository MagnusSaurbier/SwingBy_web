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

## 2026-08-13T00:40Z — plan revised while writing: keyboard listeners moved to `target`, not `window`

Reversed the previous entry's plan. Reason: the task brief's own testing instruction says to
"write a small fake EventTarget/element double and dispatch synthetic KeyboardEvent-shaped...
objects **at it**" — i.e. at `target`. Node has no `window` global at all, so if keydown/keyup
listen on `window`, none of it is unit-testable without inventing a fake global `window` (not
asked for, and riskier: two listeners on two different EventTargets in a REAL browser, where a
real keydown bubbles from the focused element through every ancestor up to `window`, would both
fire for the SAME physical keypress if `target` is an ancestor of the focused element — i.e.
double-firing, which would break the "edge action fires exactly once" contract). Decision: attach
keydown/keyup to `target` only, single source of truth, no double-fire risk. This does mean the
caller (T-05 FLYWHEEL, not yet written) is responsible for `target` being focusable and holding
focus (e.g. `tabIndex`, calling `.focus()`) — documented in input.ts's module comment and flagged
here as an assumption about an unwritten consumer. Did NOT mutate `target.tabIndex` myself from
inside `createInputSource` — considered it, rejected it: `target` is presumably a canvas T-05
exclusively owns the lifecycle of, and silently changing an attribute the caller didn't set felt
like the wrong layer to make that call at.

`blur`, by contrast, DOES need `window` specifically — task doc says "window blur must release
it" (OS-level tab-switch), which is a different event from `target` merely losing DOM focus to
some other on-page element. Compromise: attach `releaseAll` to BOTH `target`'s own `blur` (testable
in Node, and a reasonable defensive second layer) AND `window`'s `blur` (guarded by
`typeof window !== "undefined"`, real-browser-only, not independently unit-testable here — see
"what I could not verify" list, to be written into results/T-06-HELM.md). Same reasoning applied
to `gamepadconnected`/`gamepaddisconnected` (window-only events, guarded the same way).

**Gamepad allocation concern found while writing, not anticipated in the earlier plan:**
`navigator.getGamepads()` is spec-permitted to allocate a fresh array on every call, and it's the
only way to read button state (no button-level events exist). Calling it unconditionally inside
`poll()` would mean EVERY tick allocates once `navigator.getGamepads` exists at all — true in
basically every modern browser regardless of whether a physical gamepad is plugged in, i.e. the
allocation would hit on by far the common case (no gamepad), not just the rare one. Fix: gate the
per-poll call behind a `gamepadConnected` boolean maintained by the free `gamepadconnected`/
`gamepaddisconnected` window events, seeded once at construction via a single synchronous probe
call (for a pad already connected before this InputSource existed — `gamepadconnected` isn't
guaranteed to re-fire for that case in every browser). Net effect: zero gamepad-related allocation
in `poll()` for the no-gamepad case, one `getGamepads()` call per poll only when a pad is actually
present. Tested and confirmed via a mocked `navigator.getGamepads` call-count assertion (see test
file) — 1 call total across 20 `poll()`s when disconnected (the construction probe only), 21 when
connected (probe + one per poll).

**Rebind conflict policy implemented:** last-action-in-`ACTION_ORDER`-wins, loser's code becomes
`""` (sentinel, never matches a real `KeyboardEvent.code`). `ACTION_ORDER` is fixed to
`Object.keys(DEFAULT_CONTROLS)` order (boost, brake, thrustUp/Down/Left/Right, restart, pause,
menu, toggleFps, toggleHighscores) — deliberately NOT the input record's own key iteration order,
since object key order on a caller-supplied record isn't something call sites should be assumed to
control or rely on. Covered by a unit test (`boost`/`brake` both bound to `"Space"` → `brake` wins
since it's later in `ACTION_ORDER`).

**All 32 unit tests green** (`npx vitest run packages/web/src/game`), full-repo `npm test` also
green (394 passed, 1 skipped — the pre-existing T-01 Godot-parity skip, not mine), full-repo
`npm run typecheck` clean (exit 0, no output = no errors under `tsc --build --force`).

**poll() cost measured (Node, vitest, `performance.now()`, 100,000 calls after a 1,000-call
warm-up, boost+thrustRight+one touch held throughout, no gamepad connected):
0.1836 us/call** on the first run, **0.2084 us/call** on a second run after other edits — both
comfortably sub-microsecond, reported as a range since two runs on shared CI-ish hardware
naturally jitter a bit; will note both numbers in results/T-06-HELM.md rather than picking one and
implying false precision.

**Fail-proof done:** temporarily replaced `isHeld`'s `heldCodes.has(code)` with
`heldCodes.has(code + "__BROKEN_FOR_FAIL_PROOF__")` (a guaranteed-never-match lookup) — suite went
red, **10 failed / 22 passed**, output captured. Reverted the one-line change immediately after
capturing the output; re-ran, back to 32/32 green and typecheck clean. Full before/after output is
in this session's transcript and will be summarized with the exact numbers in
results/T-06-HELM.md.

### Current state / next step

Core deliverable (input.ts + test file) is done, green, and typechecked. Still owed, in order:
(1) gzipped size of the module (bundle it standalone with esbuild the way T-04's log describes
doing for render/index.ts, gzip the output, report bytes); (2) an honest attempt at a real-browser
check via the globally-installed Playwright + `/opt/pw-browsers/chromium` (real `KeyboardEvent`
code-vs-key dispatch, real `window` blur, and — if `performance.memory` is available in this
headless Chromium build without special flags — a heap-used-before/after 10k-`poll()`-calls number
as a stronger stand-in for the task doc's literal "DevTools → Memory" instruction than the Node
approximation); this all happens in the scratchpad directory only, nothing added to the repo,
consistent with the "nothing else anywhere" file-ownership rule. (3) write results/T-06-HELM.md.
(4) final append to this log noting what the browser check did/did not show, before wrapping up.
Will log again immediately before invoking headless Chromium, per the "before anything slow/risky"
cadence rule.

## 2026-08-13T01:05Z — gzip size measured, about to try headless Chromium (real-browser check)

**Module size (esbuild --bundle --minify, entry = input.ts only, browser platform, ES2022,
mirrors T-04 AURORA's methodology):**
- `@swingby/core` externalized (this module's own incremental weight — the fair number, since
  core is shared across every task that imports it, not duplicated per-consumer in the real app
  bundle): raw 3473 B (3.392 KB), **gzip 1357 B = 1.325 KB**.
- `@swingby/core` bundled in (worst case, esbuild tree-shaking applied but not sharing across a
  larger app the way the real build would): raw 3892 B (3.801 KB), **gzip 1569 B = 1.532 KB**.

Both numbers are trivial against the 250 KB whole-app gzip budget (PROJECT.md §2, INTERFACES.md's
"hard rule" reminder). Scratch build artifacts are in the scratchpad dir only, not the repo.

About to try driving real headless Chromium (global Playwright at
`/opt/node22/lib/node_modules/playwright`, browser at `/opt/pw-browsers/chromium`, confirmed
present the same way T-04 AURORA's log describes) to get: (a) a real `KeyboardEvent` dispatched
with mismatched `code`/`key` to double-confirm layout-independence outside the fake-double
harness, (b) a real `window` "blur" firing (impossible to unit-test in Node — see above), (c) if
`performance.memory` is exposed in this Chromium build without extra flags, a heap-used-before/
after-10k-`poll()`-calls number as a stronger analogue of the task doc's literal "DevTools →
Memory" step than the Node approximation. This is genuinely optional per the task doc ("Use
headless Chromium only if you want an end-to-end check") — the Node vitest suite is already the
primary, sufched proof. Building the harness entirely under the scratchpad dir, nothing added to
the repo. If this doesn't pan out cleanly in reasonable time, falling back to a Node-based
heap-delta approximation and reporting that honestly instead.

## 2026-08-13T01:40Z — headless Chromium check done, all green, one real bug found (in the harness, not input.ts)

Launched `/opt/pw-browsers/chromium` headless via the globally-installed Playwright
(`NODE_PATH=/opt/node22/lib/node_modules`, required CJS not ESM — `import "playwright"` under
plain `node script.mjs` fails with `ERR_MODULE_NOT_FOUND` because `NODE_PATH` isn't honoured by
the ESM resolver, only by CJS `require`; switched the harness script to `.cjs`/`require` and it
resolved immediately). Bundled `input.ts` standalone to an IIFE (`esbuild`, global name
`SwingByInput`, no `@swingby/core` external since a plain `<script>` tag has no import-map),
loaded via `page.addScriptTag({content})` against a `page.setContent('<canvas>...')` page —
no dev server needed.

**A real bug surfaced, in my TEST HARNESS, not in `input.ts` — worth recording in detail because
it directly validates the "poll() returns the same object" design decision from earlier.** First
harness attempt captured `const state = window.__src.poll()` after a two-finger touchstart, then
later in the same `page.evaluate` call captured `const afterCancel = window.__src.poll()` after a
touchcancel, and returned `{ state, afterCancel }`. Both came back `{boost:false, brake:false}` —
looked exactly like the touch zones silently failing. They weren't: `state` and `afterCancel` are
the *same object reference* (poll()'s documented zero-allocation design), so the second `poll()`
call mutated the very object `state` also pointed to, and Playwright's evaluate()-return
serialization only happens once, at the very end, after BOTH mutations — so `state` got serialized
showing the LATER value. Confirmed by testing several intermediate variants (isolated touch-only
script worked; combining with the earlier keyboard steps still worked; only the version that
called `poll()` twice into two differently-named variables inside one `evaluate()` failed) before
finding the actual cause. **Fix: snapshot with `{ ...window.__src.poll() }` any time a caller
needs to keep more than one poll() result alive at once** — applies to test/harness code, not to
`input.ts` itself, which is working exactly as designed. This is good evidence the "callers must
not retain a reference across ticks" caveat documented earlier in this log is a real, easy-to-hit
trap, not a theoretical one — I hit it myself within the hour of writing that warning.

**Results, all against the real bundled `input.ts` running in real Chromium:**
1. Real `KeyboardEvent{code:"Space", key:"e"}` (mismatched, simulating a non-QWERTY layout where
   the physical Space-adjacent key's `.key` differs) → `boost` true on keydown, false on keyup.
   Layout-independence confirmed outside the fake-double harness too.
2. Real `window.dispatchEvent(new Event("blur"))` → held boost released. This is the one
   assertion the Node suite structurally cannot make (no `window` in Node) — now confirmed for
   real.
3. Real `new Touch(...)`/`new TouchEvent(...)` (browser context launched with `hasTouch: true`),
   two simultaneous touches in the boost and brake zones → both `true` simultaneously; then
   `touchcancel` for both → both `false`. Confirms multi-touch and cancel-release against actual
   browser `Touch`/`TouchEvent` constructors, not just my hand-shaped plain objects.
4. `poll()` cost measured **inside the browser** (not Node): **0.178 us/call** (100,000 calls,
   1,000-call warm-up first) — same order of magnitude as the Node number (0.18-0.21 us/call),
   good agreement between environments.
5. `destroy()` then a post-destroy keydown → `drainEvents()` returns `[]`. Confirmed in a real
   browser, not just against the fake double.
6. **Heap measurement, done properly** (first attempt was flawed — forcing `gc()` immediately
   before AND after the loop measures only *retained* growth, which is close to zero for ANY
   loop whose garbage is fully collectable, so it couldn't distinguish "doesn't allocate" from
   "allocates but nothing escapes" — not useful as a discriminating test). Redone as: force gc()
   once for a clean baseline, run 10,000 calls with NO gc() in between (capturing the
   "sawtooth" — DevTools' own term from the task doc — before it gets swept), THEN gc() again to
   also see what's retained. Measured with a genuine control alongside `poll()` for calibration:
   - **Control** (a loop that deliberately builds a fresh `{boost,brake,thrustX,thrustY}` object
     literal every call, same shape as `InputState`): heap grew **180,856 bytes before the next
     GC (18.09 bytes/call)**, and a forced GC reclaimed all but 6,724 bytes of it — i.e. the
     methodology correctly detects real per-call allocation and correctly shows it as
     collectable garbage.
   - **Real `src.poll()`**: heap grew **15,112 bytes before the next GC (1.51 bytes/call)** —
     about **12x smaller** than the deliberately-allocating control — and a forced GC reclaimed
     almost none of it (14,884 bytes retained), meaning this small residual isn't
     poll()-generated garbage at all (there'd be something to collect if it were); most likely
     attributable to `performance.memory`/CDP measurement overhead itself, unrelated to
     `input.ts`. Read together with the source (no `new`, no object/array literal, no closure
     allocation anywhere inside the returned `poll` function — verified by inspection, see
     input.ts), this is strong evidence for "no meaningful per-call allocation", though I'm
     reporting the measured 1.51 B/call number rather than claiming a clean zero, since that's
     what was actually measured and "anything measured is a number, not an adjective."

All harness scripts (`input-browser-check.cjs`, `heap-final.cjs`, `input.iife.js`, and some
now-deleted intermediate debug scripts used only to isolate the bug above) live in the scratchpad
directory only — nothing added to the repo, per hard rule 1.

### Current state / next step

Everything owed by the task doc's "How to verify" and Definition of done is now measured. Next:
write `results/T-06-HELM.md` with every number above, then a final log entry closing this out. One
open item I'm flagging rather than silently deciding: the task doc's deliverable #2
(`touch-zones.ts`) and #4 (`input-dev.html`) were deliberately NOT created, per the very first log
entry's file-ownership conflict resolution — will restate that explicitly in the results file so
it doesn't read as an oversight.

## 2026-08-13T02:10Z — done: results/T-06-HELM.md written, final full-repo pass green

`results/T-06-HELM.md` written with every deliverable, the DoD checklist, and every measured
number from this log. Ran `npx prettier --check` on both my files — failed on first check (pure
whitespace), fixed with `--write`, confirmed the reformat changed nothing semantically (re-ran
`npm run typecheck` and `npx vitest run packages/web/src/game`, both still clean/32-32 after the
reformat).

**Noticed while re-running:** T-07 CHORUS has landed `packages/web/src/game/__tests__/audio.test.ts`
(34 tests) since my last check — confirms another agent really is actively writing into this same
shared directory concurrently, exactly as the brief warned. No conflict: my file, their file,
both run cleanly together (`npx vitest run packages/web/src/game` → 2 files, 66/66 passed).

**Final numbers, last run before closing out:**
- `npm run typecheck`: clean, exit 0, no output.
- `npx vitest run packages/web/src/game`: 2 files, 66/66 passed (32 mine).
- `npm test` (whole repo): 18 files, 428 passed + 1 skipped (429 total) — up from 394+1 at the
  start of this task purely because T-07's 34 new tests landed in between; nothing of mine
  changed that count downward at any point.
- `poll()` cost, this run: 0.1869 us/call (consistent with the 0.18-0.26 us/call range already
  reported in results/T-06-HELM.md across multiple runs).

**Never ran any git command**, per the hard rule — verified my own file set purely by memory of
what I wrote (`packages/web/src/game/input.ts`, `packages/web/src/game/__tests__/input.test.ts`,
this log, `results/T-06-HELM.md`) plus `ls`/`find`, not `git status`/`git diff`.

Task complete from this agent's side. Nothing left in-flight; no known open bugs. Open, honestly-
flagged gaps are exactly the ones listed in results/T-06-HELM.md's "What could not be verified"
section (real phone, real gamepad, a human looking at DevTools' actual Memory panel) — all
inherent to this being a headless container, not something more effort here would have closed.
