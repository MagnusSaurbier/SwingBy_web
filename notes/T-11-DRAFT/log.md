# T-11 DRAFT — thought log

## 2026-08-15T00:00Z — plan, before any code

Read in order: README.md, PROJECT.md, INTERFACES.md, tasks/T-11-DRAFT.md, then
`reference/godot/scripts/LevelEditor.gd` (full, 734 lines) and the relevant slice of
`reference/godot/scripts/GameWorld.gd` (editor_* methods, `_process`, `_draw`, `world_to_screen`/
`screen_to_world`/`editor_zoom_at_screen`/`editor_apply_pan_screen_delta`, `_create_runtime_object`,
`editor_export_level`, `editor_runtime_matches_start_state`/`editor_overlay_requires_reset`). Also
read the FROZEN `packages/core/src/types.ts`, `constants.ts`, the REAL implementations of
`packages/core/src/level.ts` (T-03), `packages/web/src/render/index.ts` (T-04),
`packages/web/src/game/loop.ts` + `camera.ts` + `bounds.ts` (T-05), `game/input.ts` (T-06),
`game/audio.ts` (T-07), `storage/index.ts` (T-10), and the thought logs for T-03/T-04/T-05 in full.
Also read `ui/screens/editorPlaceholder.ts`, `ui/screen.ts`, `ui/screens/play.ts`,
`ui/screens/ingameMenu.ts`, `ui/dom.ts` (read-only, to understand what integration point exists —
NOT importing anything from `ui/` in my own code), and the two existing fake-DOM/fake-canvas test
helpers other tasks wrote (`hud/__tests__/fakeDom.ts`, `render/__tests__/fakeCanvas.ts`) as prior
art for testing DOM/canvas code with no jsdom in this project (confirmed again: no jsdom in
node_modules, plain-Node vitest environment).

### Key architectural decisions, made now so I can move fast once coding

1. **Two-layer split, same shape as T-05's own `createGameLoop`/`createSession` split**: the
   editor's actual state machine (placement, selection, dragging, undo, save/validate, preview
   lifecycle) lives in a headless-testable "engine" with no DOM dependency beyond an injected
   `Renderer`-shaped `{worldToScreen, screenToWorld}` pair (satisfied by a REAL `createRenderer`
   handed a fake canvas in tests, or the real canvas in the browser — never a reimplementation of
   the transform math, per the task doc's explicit "rely on T-04's transforms" instruction). A thin
   DOM-wiring layer (toolbar, panel mount, canvas event listeners, dialogs) sits on top and is only
   verified via a real headless-Chromium screenshot pass, not unit tests — mirrors exactly how T-04
   and T-05 split "pure logic, unit-testable" from "real browser, screenshot-verified".

2. **`createRenderer` works fine with a fake canvas under plain Node** (T-04's own test precedent):
   it only needs `canvas.getContext("2d")` to return an object with a callable `setTransform` (used
   inside `resize()`), plus `canvas.width/height/style` — no real DOM required. This means my
   hit-testing tests can call the REAL `renderer.worldToScreen`/`screenToWorld` headlessly, which is
   exactly what the task doc requires ("Hit-testing uses T-04's worldToScreen/screenToWorld... rely
   on that as exact inverses") — not a reimplementation, not a browser-only check.

3. **Preview uses `createGameLoop`, not `createSession`.** `createSession` is a thin
   `requestAnimationFrame` wrapper around `createGameLoop` (loop.ts's own doc comment says so, and
   T-05's log designed the split specifically for headless testability). `requestAnimationFrame`
   does not exist in plain Node, so `createSession.start()` would never actually advance a single
   tick under test — but `createGameLoop`'s `GameEngine.frame(dt)` can be driven synthetically,
   exactly like `loop.test.ts` does. `GameEngine extends GameSession`, so using it still satisfies
   the DoD's "the preview runs through a T-05 session" (every `GameSession` method is present, plus
   `frame`, which loop.ts's own doc comment says exists FOR exactly this kind of external driving).
   I will write my own tiny rAF wrapper around `frame(dt)` in the browser runtime layer (a few lines,
   structurally identical to what `createSession` already does internally) so real gameplay in the
   browser is driven by real `requestAnimationFrame`, while tests drive `frame(dt)` synthetically.
   Logged here as the resolution to an apparent conflict: the task doc says "runs a T-05 session in
   a mode with `allowInput: false`", but `createGameLoop`'s `runTicks` always calls `simulateTick`
   with `allowInput: true` unconditionally (no such mode exists in the real T-05 code — confirmed by
   reading `loop.ts` directly, not just the interface doc). Per the established precedent in this
   repo (T-04's and T-05's logs both defer to the actual landed code over a task doc's paraphrase
   when they disagree — README: "all behaviour comes from" the real implementation), I'm reading
   "preview" as a literal playtest (boost/brake actually work, matching T-05's own one-line
   description of its interaction with T-11: "for playtesting a level from inside the editor"), not
   a scripted no-input coast. `allowInput` is not a knob that exists to pass through.

4. **Two independent `World`/body-array copies, not one mutated-in-place array.** Godot keeps ONE
   `objects` array with both a "live" (x/y/x_vel/y_vel) and a "start" (start_x/start_y/...) pair of
   fields per object, mutated together outside simulation and diverging only while ticking; its
   `editor_runtime_matches_start_state()` compares them field-by-field (pos tolerance 0.01, vel
   tolerance 0.0001, skip suns entirely, skip anchored planets' velocity) to decide whether editing
   is gated. My design instead keeps the AUTHORED body array (`EditorEngine`'s own state) completely
   separate from whatever `createGameLoop` does internally with its own `hydrate(serialize(...))`
   copy during a preview run — the authored array is *never* touched by a running preview, by
   construction, so a drifted preview position cannot leak into the authored state no matter what
   happens (a strictly stronger guarantee than a runtime comparison could give). The task doc's
   named failure mode (silently committing a mid-simulation position as the authored start state)
   cannot occur in this design at all, structurally, not just because a check happens to run first.
   I still implement the explicit "requires reset" gate/banner for UX parity (the visible behaviour
   the task's own verification script checks for — "you must get the reset prompt, not an edit"),
   using a simpler signal than Godot's per-field diff: `GameSession.snapshot().elapsedTicks > 0`
   since the preview engine was last (re)constructed. Reasoning: `GameSession`'s frozen interface
   exposes no body-position accessor at all (only `snapshot()`: status/ticks/fps/boundsWarning/
   reachedGoal), so a literal position-diff gate is not reachable through the published contract
   without reaching into render-internal state or duplicating physics — which I'm expressly
   forbidden from doing (no direct `core/physics` import). "Has the attempt advanced at least one
   tick since the last reset" is a conservative superset of "has visibly drifted" (any real level
   has gravity>0 somewhere per `validate()`'s own rule, so a ticked body essentially always moves;
   the only false-positive case — a tick that produced literally zero displacement — still safely
   over-gates rather than under-gates, which is the safe direction to be wrong in given what this
   gate protects against). Logged as a deliberate, reasoned substitution, not an oversight.

5. **Editing is disabled for the ENTIRE duration a preview session exists** (not just while
   "drifted"), because canvas ownership is handed to `createGameLoop`'s own internal renderer while
   a preview is live — my own edit-mode mouse handlers (pan/select/drag/place) are simply not
   attached to anything meaningful during that window. This is a strictly STRICTER gate than
   Godot's (which still permits placing brand-new objects while gated — `place_object`'s branch in
   `handle_left_press` is reachable even under `editor_overlay_requires_reset()`). Chosen for
   implementation simplicity given the two-renderer/two-canvas-owner architecture in decision #4;
   the essential guarantee (never silently commit a drifted position as authored state) still holds,
   if anything more strongly. Documented here as a deliberate, known divergence — will restate in
   results.md, not silently drop it.

6. **Resize-scales-gravity coupling applies only to non-player objects** (task doc's own DoD
   wording: "Resize still scales gravity for non-player objects — the coupling is deliberate").
   Note this is actually a *narrowing* vs. the literal Godot source: `LevelEditor.gd`'s
   `handle_drag`'s `"size"` case (line ~428-438) applies the cubic size→gravity formula
   unconditionally, including to a selected `player` object (players DO have a "size" contextual
   button too — `_contextual_circle_button_names` doesn't exclude player). Since the task doc's own
   Definition-of-Done item explicitly says "non-player", and player gravity is 0 in every one of the
   33 built-in levels (players are never intended to be gravity sources), I'm following the task
   doc's explicit instruction over the letter of the GDScript here — same "task doc vs. actual code"
   tension as items #3 above, resolved the other way this time because the task doc is unambiguous
   and gives an explicit reason ("preserve that coupling, it is how levels stay balanced"), which
   only makes sense read as "the sun/planet balancing act", not the player.

7. **Placement UX simplified from Godot's two distinct paths** (toolbar press-hold-drag with a 0.5s
   threshold state machine producing a ghost, vs. instant canvas click with no ghost) into ONE
   unified path: arm a tool+type from the toolbar, show a ghost following the cursor over the
   canvas, commit on mouseup regardless of whether that mouseup came right after mousedown (click)
   or after some dragging (press-and-drag) — satisfies both interaction styles named in the task doc
   ("Click-to-place and press-and-drag, with a ghost preview before commit") through one code path
   instead of two state machines. Also simplified: Godot auto-switches the active tool to
   "velocity" (player/planet) or "gravity" (sun) immediately after placement, continuing the same
   drag gesture into "now set the launch vector / gravity radius". I'm instead auto-selecting the
   newly placed object and opening its panel, leaving velocity/gravity editable via the on-canvas
   handles or panel fields on a fresh subsequent gesture — the "gravity" tool specifically is
   dropped in favour of the persistent resize handle's cubic size→gravity coupling (decision #6),
   which is discoverable and covers the same need (sun gravity is fully controllable by dragging its
   resize handle) without a transient, easy-to-miss tool mode.

8. **Hit-test hover-ring radius simplified from Godot's formula.** `_hover_ring_radius_px_for_obj`
   (LevelEditor.gd:217-224) computes `0.5 * max(max(18, 28*zoom), 70)` unioned with each contextual
   button's own distance+26 — a formula shaped by which buttons happen to be laid out around the
   body, not by the body's actual rendered size. Using `Math.max(body.size * zoom + 10, 24)` instead
   — proportional to the actual drawn radius, with a minimum tappable target — which is what the
   task's own hit-testing verification step actually cares about ("clicking a body still selects
   it") and is far simpler to reason about/test at extreme zoom. Selection order still mirrors
   Godot exactly: iterate objects topmost (highest index) to bottommost, first whose on-screen
   distance (via the REAL `renderer.worldToScreen`) is within its hit radius wins.

9. **Contextual on-canvas buttons shown only for the SELECTED object, not merely hovered** (a small,
   logged UX simplification — Godot draws them only for `_hover_index` too, so behaviourally close,
   but my hit-test for buttons also only considers the selected object, where Godot's `pick_object_
   index` technically checks buttons against every object regardless of whether they're drawn,
   which is dead code in practice since a click without a preceding hover-establishing motion event
   is the only way that path could ever fire).

10. **Undo: snapshot-stack, not command objects.** Push a deep clone of `{bodies, goalIndex,
    goalRange}` before every mutating operation (place/delete/move-commit/velocity-commit/
    resize-commit/goal-change/visible-toggle/anchored-toggle/clear), capped at 50 entries. Simpler
    and more robust than fine-grained inverse-command objects, and trivially covers "at least
    placement" plus everything else. No redo — not required by the task doc (only "document undo's
    exact scope" is required), and out of scope given the size of this task already.

11. **`EditorOverlay` (deliverable 4) is populated into `RenderFrame.editorOverlay` when *my own*
    edit-mode renderer instance builds a frame** (a second `createRenderer(canvas)`, separate from
    the one `createGameLoop` builds internally for preview) — but the actual overlay PAINT (rings,
    ghost, buttons, velocity arrows, gravity rings, reset-required hint) happens via my own
    subsequent canvas 2D calls, grabbing the same canvas's 2D context again (idempotent per the
    Canvas spec — `getContext("2d")` returns the same context object on every call) right after
    `renderer.draw(frame)` returns. This matches T-04's own log ("no code reads editorOverlay... T-11
    presumably renders it separately on top") — the renderer genuinely never has to change, and the
    field is still meaningfully populated and documented, satisfying "export it cleanly and document
    it" without requiring any `render/` change.

### Not yet done

No code written yet. Plan: `viewport.ts` (pure pan/zoom camera math, its own small formula copy for
testability — NOT used for hit-testing, which goes through the real renderer) → `overlay.ts`
(`EditorOverlay` type + button-position math + the paint function) → `history.ts` (undo stack) →
`editor.ts` (the engine: state, placement, hit-test, drag, undo, save/validate, preview lifecycle,
plus the DOM-wiring `mountEditor` on top) → `panel.ts` (DOM properties panel) → `dialogs.ts` (DOM
confirm/error modals) → tests (engine logic, hit-test-at-extreme-zoom, round-trip, 5/5 validate
gate, undo) → a `dev.html` harness (same pattern as T-04's) for the screenshot pass → author the
fixture level through the real engine, verify round-trip/validate/solvability → results.md. Will log
again before the headless-Chromium screenshot run (the slow/risky step) and before the "break a test
on purpose" proof.

### Interaction-model decisions finalized before writing editor.ts (recorded here so a resumed
session doesn't have to re-derive them)

- **Pointer gesture state machine, one unified path**: `pointerDown` picks one of `place` (tool
  armed) / `drag` (hit a contextual button OR hit a body directly, which always begins a `move`
  drag — see below) / `pan` (hit nothing). `pointerMove` advances whichever gesture is active.
  `pointerUp` commits it (`place` → create the body at the ghost's current position, covering both
  click-to-place and press-and-drag with one code path; `drag` → nothing further, the mutation
  already applied live during move; `pan` → nothing further).
- **Clicking a body directly (not a specific handle button) starts a MOVE drag immediately.** Godot
  requires a "sticky tool" (the last-clicked contextual button persists as `_tool`, so a later plain
  click-drag on the body reuses whatever tool was last active) to get this effect. Simpler here:
  "click and drag a body" always means move; velocity/resize/delete each require their own specific
  on-canvas button. Matches the task doc's plain reading of "move" as the base capability.
- **Dropped**: Godot's distinct "goal" canvas tool (click a body to set it as goal) — replaced with
  a "Set as goal" button in the DOM panel, acting on the current selection. Equally functional,
  simpler. Also dropped: the transient tool-becomes-"gravity"/"velocity" auto-switch right after
  placing a sun/player/planet (see decision #7) and the "click a hovered body while gated triggers
  restart_level()" affordance (superseded by decision #5 — the editor's own pointer handlers are not
  attached to the canvas at all while a preview session owns it, so that click could never reach the
  engine in this architecture; the DOM layer instead shows a persistent "Reset Preview" control
  outside the canvas). All logged as deliberate, not silent, drops.
- **`requiresReset()` (engine-level) stays tied to `elapsedTicks > 0` since the last preview reset**
  (decision #4) — the literal, testable reproduction of "has the preview been allowed to run". The
  DOM-level fact that pointer events aren't even routed to the engine during an active preview
  (decision #5) is a SEPARATE, stricter, redundant belt-and-suspenders guarantee about the real
  browser UI, not a replacement for the engine-level gate — both are implemented; unit tests exercise
  the engine-level one directly (construct engine, drive a fake preview forward via
  `setPreviewGate(true)`, assert mutators no-op, `setPreviewGate(false)`, assert they work again).
- **Undo granularity**: one snapshot pushed per *gesture* (drag-start, not per pointermove tick) or
  per single-shot mutation (place-commit, delete, panel field edit, clear). `history.ts`'s
  `UndoStack` holds up to 50 snapshots of `{bodies, goalIndex, goalRange}`.
- **`editor.ts` will house**: `EditorEngine` (headless-testable: state, hit-test, drag, undo,
  save/validate) AND `mountEditor()` (DOM wiring: toolbar, canvas listeners, rAF preview loop). A
  new supporting file `editor/preview.ts` (not one of the 5 named deliverables, but under my owned
  `editor/**`) isolates the `createGameLoop`-wrapping preview lifecycle (play/pause/reset/frame) so
  it can be unit-tested on its own with a fake canvas + fake input target, independent of DOM
  construction concerns.

Next: write `preview.ts`, then `editor.ts`, then `panel.ts`, then `dialogs.ts`, then tests.

## 2026-08-16T00:00Z — resumed after a usage-limit kill; orchestrator confirmed prior files intact

Orchestrator's resume message confirms: `overlay.ts`, `viewport.ts`, `history.ts` and an (empty at
that point) `fixtures/` dir survived on disk exactly as left; full-repo suite at time of kill was
646 passed / 1 skipped / 0 failed, typecheck clean — none of it mine yet (no editor tests existed).
Verified independently on resume: those 3 files present, no `editor.test.ts`/`editor/preview.ts`/
`editor/editor.ts`/`panel.ts`/`dialogs.ts` yet — matches the orchestrator's description exactly, so
resuming from exactly the "next: write preview.ts" point recorded above, no re-derivation needed.
Proceeding to implement without re-reading the reference GDScript again — all the load-bearing
findings from it are already captured in the decisions above and in `overlay.ts`'s/`viewport.ts`'s
own doc comments.

## 2026-08-16T00:40Z — engine + preview + panel + dialogs + all 5 test files green, before the
## headless-Chromium screenshot pass

Wrote, in order: `dialogs.ts`, `panel.ts` (both self-contained, no import from `ui/**` — own tiny
`el()` DOM builder, reusing only T-08's already-shipped CSS class NAMES like `.btn`/`.panel`/
`.dialog`, never its `ui/dom.ts` helper code), `editor.ts` (both `createEditorEngine` — the
headless-testable core — and `mountEditor` — the DOM-wiring layer, per decision #1), `preview.ts`
(the `createGameLoop`-wrapping preview lifecycle, per decision #3), and
`editor/__tests__/fakes.ts` (a fake canvas/context/DOM-target, owned inside `editor/**`, same
"duplicate a small stub" precedent as T-05/T-09 — NOT importing `render/__tests__/fakeCanvas.ts`).

One real TS structural-typing bug caught by `tsc`, fixed: `overlay.ts`'s `OverlayContext2D.
strokeStyle`/`fillStyle` were typed as plain `string`, but the REAL `CanvasRenderingContext2D`
types those properties as `string | CanvasGradient | CanvasPattern` — TypeScript's property
variance rules made a real `CanvasRenderingContext2D` NOT structurally assignable to my narrower
interface even though every actual write in `paintEditorOverlay` only ever assigns a string. Fixed
by widening the interface's property types to match the real DOM type (documented inline) — this
is exactly the kind of bug that would only show up when `mountEditor` hands a REAL canvas context
to `paintEditorOverlay`, never in a test using a fake context typed loosely as `string`. Caught
before ever running in a browser, which is the point of running `tsc` early and often.

Also fixed 3 initially-failing engine tests (resize-handle tests + the undo/resize/move
interleaving test): my first draft called `pointerDown(resizeBtn)` then immediately
`pointerMove(far)` expecting the resize delta to be measured from the button's OWN position, but
`applyDrag`'s resize case (mirroring `LevelEditor.gd:431-433`) captures `resizeGrabDist` on the
FIRST `pointerMove` after `pointerDown`, not from `pointerDown` itself (which never calls
`applyDrag` — see the "lazy history push" design note). So the very first `pointerMove` call was
being consumed as the grab-establishing move, making the "then drag further" delta zero. Fixed by
adding an explicit `pointerMove(resizeBtn)` first (establishing the grab distance at the button's
own screen position, matching how a real mouse-down-then-drag gesture would naturally start from
right where the button was clicked) before the real "drag outward" move. This is a real, useful
finding about the drag-anchor mechanic, not just a test-fixture bug — recorded here so a future
reader modifying the resize gesture understands why two `pointerMove` calls are needed to exercise
it from a cold `pointerDown`.

**Numbers so far** (packages/web/test/editor*.test.ts, `npx vitest run`): **53/53 passing** across
5 files (`editor-viewport`, `editor-overlay`, `editor-engine`, `editor-preview`, `editor-fixture`).
Hit-testing tested at zoom = [0.12 (MIN_ZOOM), 0.25, 0.5, 1, 2, 3, 5.0 (MAX_ZOOM)] — the editor's
full supported range (ported from `editor_zoom_at_screen`'s own clamp, GameWorld.gd:500) — all 7
levels pick the correct body for all 3 placed bodies plus a definite miss, using the REAL
`renderer.worldToScreen`/`hitTest` (which itself calls the real `screenToWorld`/`worldToScreen`),
never a reimplementation. Round-trip: 5 authored levels via the real engine, each
`serialize(hydrate(l))` deep-equals `l` exactly (5/5). Save/validate gate: 5/5 invalid cases
refused (no player, two players, goal->player, `goal.range<=0`, no gravity source), plus a
multi-error case proving ALL applicable errors are reported at once, plus one "valid level IS
accepted" control case. Undo: covers placement (N places, N undos -> empty), move, resize (with
its gravity-coupling side effect), delete, interleaved in one test with each undo step checked for
EXACT restoration; capped at 50 (verified by placing 60 objects and reading `undoDepth() === 50`).
Preview gate: every mutating engine method is a verified no-op while `setPreviewGate(true)`, and
works again once cleared. Fixture level (deliverable 6): built by grid-searching a solving initial
player velocity via a scratchpad script driving the REAL `hydrate`/`simulateTick` directly (fine
for a one-off scratchpad search, same precedent as T-03's own solvability tape search — NOT part of
any committed editor file, which still imports zero `core/physics`), found `vx=4, vy=0` solves in
exactly 144 ticks (1.0s); committed the winning level JSON to
`editor/fixtures/authored-level.json`, contains one of each required element (invisible sun,
anchored planet, moving planet, non-default goal range 90). The committed test
(`editor-fixture.test.ts`) independently re-verifies solvability by driving the REAL T-05
`createGameLoop` with a static `NO_INPUT` source end-to-end (not trusting the scratchpad search's
own physics call) — reached the goal, confirmed `elapsedTicks` in (0, 2000).

Full-repo `npx vitest run` just now: **760 passed, 1 skipped, 0 failed, 47 files** (the 53 editor
tests are counted in the 760). `npx tsc --noEmit -p tsconfig.json`: clean except ONE pre-existing
error in `packages/web/test/net-queue.test.ts:167` (`Type 'never' has no call signatures'`) —
confirmed via `grep` that file contains zero mention of `editor`, so unrelated to anything I touched
(T-13 PODIUM's own file, likely mid-edit by a concurrent agent — orchestrator's brief explicitly
told me to ignore other tasks' concurrent breakage).

**Next (about to do, the slow/risky step):** build `editor/dev.html` + `dev.ts` (mirroring T-04's
own dev-harness pattern, mounting the REAL `mountEditor` against the REAL `createStorage()`) and
drive it with headless Chromium via Playwright for screenshots at 1280px and 360px, gzip-measure the
editor module, and do the "break a test on purpose, show red, restore" proof. Logging now, before
starting the dev server / launching Chromium, per the cadence instruction.
