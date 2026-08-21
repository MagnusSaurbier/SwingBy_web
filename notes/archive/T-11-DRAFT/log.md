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

## 2026-08-16T01:20Z — screenshots, a real 360px bug found+fixed, gzip sizes, break/restore proof, task complete

Built `editor/dev.html` + `dev.ts` (own self-contained chrome CSS, reusing T-08's class NAMES —
`.btn`/`.panel`/`.dialog`/`.overlay`/`.field`/`.text-input`/`.toggle-row` — with my OWN values,
since this harness is never loaded by the shipped app, same as T-04's `render/dev.html`). Started
`vite` on port 5188 (avoiding collision with any other agent's default 5173), drove it with headless
Chromium (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` — note: the path is
`chromium-1194/chrome-linux/chrome`, NOT `chromium/chrome-linux/chrome` as the bare `chromium`
symlink's target path suggested at first; had to `find` for the real executable) via the globally
installed Playwright package at `/opt/node22/lib/node_modules/playwright` (CommonJS default export,
`import pkg from ...; const { chromium } = pkg;` — a bare named import fails under Node's ESM/CJS
interop for this package).

**Real bug found via the 360px screenshot, exactly as the orchestrator's reminder predicted**: the
properties panel rendered as an empty ~0-height black strip below the canvas at 360px width instead
of showing its fields. Root cause: `.editor-body`'s mobile media query set `flex-direction: column`
but left `.editor-canvas-wrap` at `flex: 1` (shorthand for `flex-grow:1 flex-shrink:1 flex-basis:0%`)
while `.editor-panel` had only `max-height: 45vh` and no explicit flex sizing (`flex-basis: auto`
by default). In CSS flexbox's negative-space distribution, a `flex-basis:0` item contributes zero
weight to the shrink calculation, so nearly ALL of the deficit (container height minus both
children's hypothetical sizes) landed on the auto-basis panel, squeezing it toward zero instead of
its content height. Fixed by giving `.editor-canvas-wrap` an explicit `min-height: 40vh` and
`.editor-panel` `flex: 0 0 auto` (content-sized, doesn't grow or shrink) with `overflow-y: auto` as
a safety net if content still exceeds `max-height`. Re-screenshotted — panel renders correctly with
all its fields visible below the canvas. **This fix lives only in `editor/dev.html`'s own scratch
CSS** (which I own and which the shipped app never loads) — see the exact equivalent CSS the real
`ui/`-wired version will need, written into `results/T-11-DRAFT.md`'s "ui/ wiring" section, since I
cannot add rules to `styles/**` (not mine).

8 screenshots captured to `editor/screenshots/`, reviewed by actually looking at the pixels (not
just "script exited 0"): empty editor (1280), populated + selected planet showing the panel AND the
on-canvas contextual buttons (move/velocity.../resize/delete) simultaneously (1280), Save-refused
error dialog listing BOTH applicable problems at once for an intentionally invalid stage (1280),
Clear-stage confirm dialog (1280), a loaded built-in level ("Orbital Primer") showing the velocity
arrow + gravity ring overlay (1280), that same level mid-preview with the toolbar swapped to
Play/Pause/Reset-preview/Save/Back and the panel showing the "Preview has run — reset the preview to
continue editing" hint, confirming the drift gate is visibly live in a REAL browser session driven
by a REAL T-05 `createGameLoop` (1280), and the two 360px shots (empty, populated-with-selection)
post-fix.

**Gzip sizes** (esbuild --bundle --minify --format=esm, from `editor/editor.ts`):
- Full transitive graph (editor/** + render/** + game/loop+input+audio + @swingby/core, i.e. what a
  fully-standalone bundle would weigh with nothing shared): raw 44.7 KB, gzip **16,546 B = 16.16
  KB**.
- `editor/**`'s OWN code only (`@swingby/core`, `render/index.js`, `storage/index.js`,
  `game/loop.js`, `game/input.js`, `game/audio.js` marked `--external`, since all of those are
  already shipped for real gameplay in the real app — this is the true marginal weight my task adds
  on top of what T-04/T-05/T-06/T-07/T-10 already ship): raw 18.5 KB, gzip **7,059 B = 6.89 KB**.
- Current real whole-app build (`npm run build -w @swingby/web` + `npm run size`), UNCHANGED by
  this task since `editor/**` is not wired into `main.ts`/`ui/**` (not my file to touch): **15.74 KB
  gzip total**, PASS, 234.26 KB under the 250 KB budget. Once the orchestrator wires `mountEditor`
  into `ui/screens/editorPlaceholder.ts`, the real marginal delta will be close to the 6.89 KB
  "own code" number above (render/game/storage are already in that 15.74 KB), landing comfortably
  under budget either way — even the full 16.16 KB worst-case still leaves >200 KB of headroom.

**Break/restore proof, done for real, twice:**
1. Hit-testing: temporarily replaced `pickObjectAt`'s body with an unconditional `return -1;`. Ran
   `editor-engine.test.ts` — **8/8 hit-testing-dependent tests failed** (all 7 zoom-level tests plus
   the z-order test), every other test (21) stayed green — output saved to
   `/tmp/.../scratchpad/red-hittest.txt`. Reverted; re-ran; 29/29 green again.
2. The validate/save gate: temporarily replaced `validateCurrent()`'s body with
   `return { ok: true as const };` (always accepts). Ran the same file — **6/6 gate-dependent tests
   failed** (all 5 invalid-case tests plus the multi-error test; the "valid level IS accepted"
   control case stayed green, as expected since it was already true), 23 others stayed green —
   output saved to `/tmp/.../scratchpad/red-validate.txt`. Reverted; re-ran; 29/29 green again.
Both breaks targeted exactly the claim each group of tests protects, and nothing else moved —
confirms the suite actually exercises what it claims to, not just "passes something."

**Final numbers, all re-measured fresh just now:**
- `npx vitest run packages/web/test/editor*.test.ts` (5 files): **53/53 passing**
  (editor-viewport 7, editor-overlay 6, editor-engine 29, editor-preview 6, editor-fixture 5).
- `npx vitest run` (whole repo): **763 passed, 1 skipped, 0 failed, 48 files** (the 1 skip is T-01's
  own intentional Godot-parity-pending-host-traces skip, unrelated to me).
- `npx tsc --noEmit -p tsconfig.json`: **clean, zero errors, repo-wide** (the one `net-queue.test.ts`
  error seen earlier this session — T-13 PODIUM's own file, confirmed unrelated via `grep` for
  "editor" — is gone on this final run, presumably fixed by that task's own concurrent agent).
- `npx prettier --check` on every file I own: clean (ran `--write` scoped to exactly my files after
  finding formatting drift, matching T-05's own precedent for handling this).
- Hit-testing: correct at zoom = 0.12 (MIN_ZOOM), 0.25, 0.5, 1, 2, 3, 5.0 (MAX_ZOOM) — the editor's
  full supported range — for 3 simultaneously-placed bodies each, plus a definite-miss point, plus
  z-order (topmost-wins) for two exactly-overlapping bodies. All via the REAL `renderer.
  worldToScreen`/`screenToWorld` (T-04), never reimplemented.
- Round-trip: 5/5 authored levels exact (`serialize(hydrate(l))` deep-equals `l`), covering every
  serialize branch this task's own object model can produce (nonzero/zero velocity, visible/
  invisible sun, anchored/unanchored planet, non-default/default-exact goal range, empty
  name/author triggering the "Custom Stage"/"Guest" fallback).
- Validate/save gate: **5/5** invalid cases refused (no player; two players; goal->player;
  `goal.range<=0`; no gravity source), plus a "valid level IS accepted" control, plus a
  multi-simultaneous-error case proving ALL applicable errors surface at once, not just the first.
- Undo: covers placement (its literal, minimum requirement), move, resize (with its gravity-
  coupling side effect), delete, each verified to restore EXACT prior state when interleaved and
  undone in sequence; capped at 50 entries (verified).
- Fixture level (deliverable 6): `editor/fixtures/authored-level.json` — contains one of each
  required element, `validate()`-clean, exact round-trip, loadable via the real editor engine,
  solvable (reaches goal at tick 144 / 1.0s of sim time via a pure `NO_INPUT` coast driven through
  the REAL T-05 `createGameLoop`) — all independently re-verified in the committed
  `editor-fixture.test.ts`, not just trusted from the scratchpad search that found it.

Task complete. `results/T-11-DRAFT.md` written with every deliverable/status, the full DoD
checklist with one-line reasons, all numbers above, the screenshot index, the exact `ui/` wiring
change (including the CSS rule the real stylesheet will need — the same fix found via the 360px
screenshot bug), the host-only Godot steps for deliverable 6, and an explicit "what could not be
verified" section. Final state, everything re-confirmed fresh immediately before writing this
entry: `npx tsc --noEmit -p tsconfig.json` clean repo-wide (exit 0); `npx vitest run packages/web/
test/editor*.test.ts` 53/53; `npx vitest run` (whole repo) 763 passed / 1 skipped / 0 failed / 48
files; no stray scratch files left under `packages/web/test/`; `git status --short` (read-only,
informational) shows only files under `editor/**`, `notes/T-11-DRAFT/`, and `results/
T-11-DRAFT.md` touched by this session (plus `notes/T-13-PODIUM/log.md`, which is a concurrent
agent's own file, not mine — untouched by me). Nothing else outstanding for T-11 DRAFT.

## Follow-ups — 2026-08-16T14:00Z, resumed after the integration pass

Coordinator's message: T-08 BRIDGE's integration pass wired the whole app together and found two
real issues in `editor/**`, both flagged rather than fixed since they're outside T-08's ownership.
Repo state at hand-off: typecheck clean, 768 passed / 1 skipped / 0 failed, bundle 39.11 KB gzip.
Read `results/T-13-PODIUM.md` (the `Api`/`shareLevel` contract) and the "Integration pass" section
of `results/T-08-BRIDGE.md` plus the referenced `notes/T-08-BRIDGE/log.md` 2026-08-16T13:10Z entry
(bug 5's full diagnosis) before touching anything, per the coordinator's instruction. Plan: fix the
mouse-click race first (it's the one with a concrete, already-diagnosed root cause), then wire
Share, then real-browser regression verification for both, in that order — logging before the
real-Chromium step per the cadence instruction (below).

### Fix 1 — the real-mouse-click race in `editor.ts`

T-08's diagnosis (log-cited above, re-read directly, not re-derived from scratch): `onPointerUp` is
attached to `window`'s `mouseup` — deliberately, so a canvas-originated drag (move/resize/pan) keeps
tracking even if released off-canvas — but it ran **unconditionally** for every mouseup anywhere on
the page, including a plain click on a `.editor-panel` button, and called `refreshPanel()`
synchronously, which does `root.replaceChildren()` — a full panel DOM teardown/rebuild. Per the DOM
click-synthesis spec, a trailing `click` only fires if the mousedown/mouseup target is still
attached when the UA checks; rebuilding the panel out from under the just-pressed button during that
same mouseup's bubble phase detaches it first, so `click` never fires. T-08 confirmed this precisely
(mousedown/mouseup fire, click never does; native `.click()` and keyboard Tab+Enter both work fine,
isolating the break to specifically the real-mouse mouseup->rebuild race) — I did not need to
re-diagnose, only fix.

**Fix**: added a `pointerActive` flag, set `true` only by canvas's own scoped `mousedown` listener.
The window-level `mouseup`/`mousemove` handlers now only act (call `engine.pointerUp`/`refreshPanel`,
or track hover during an active drag) when `pointerActive` is true OR (for the idle-hover case in
`mousemove`) the event target is literally the canvas element. A mouseup whose matching mousedown
never touched the canvas — a panel button click — now leaves the panel's DOM completely untouched
through the whole mouseup dispatch, so the browser's own click synthesis proceeds normally. A
canvas-originated drag that ends off-canvas (over the panel, anywhere) is unaffected — `pointerActive`
stays true for the whole gesture regardless of where the pointer wanders, matching the pre-fix drag
behaviour exactly. Full reasoning is also captured as a doc comment directly above the fix in
`editor.ts` (`onPointerDown`/`onPointerMove`/`onPointerUp`), since a future reader touching this code
needs the "why", not just the "what".

No headless regression test is possible for this fix — this project has no jsdom anywhere (confirmed
independently, same finding every prior task's log records), and the bug is specifically about real
DOM click-synthesis timing (mousedown/mouseup/click ordering relative to a DOM mutation mid-dispatch),
which a hand-rolled fake DOM could only "prove" by re-implementing the same spec behavior I'd be
testing — not convincing, so not attempted. Verified instead with REAL headless Chromium (see below),
matching exactly how T-08 originally found the bug.

### Fix 2 — wire the editor's Share action to `Api.shareLevel`

No "Share" action existed yet at all (the original task doc's Actions list didn't separately call
it out, and T-13 hadn't landed when I built the original toolbar) — added one. Design, per the
coordinator's two named properties:

- **Never blocks on the network, level saved locally first.** Refactored the whole orchestration
  out of `mountEditor`'s closure into a plain, exported, DOM-free async function —
  `shareLevelFlow(level, deps)` — taking injected `validateLevel`/`saveLocally`/`onSavedLocally`/
  `shareLevel`/`timeoutMs`. Order is `validate -> saveLocally (sync, T-10) -> onSavedLocally fires
  -> shareLevel (awaited inside withTimeout)`. This is the SAME "headless-testable core, thin DOM
  adapter" split the rest of this file already uses (`createEditorEngine` vs. `mountEditor`), applied
  here specifically so "saved before any network call" is a property of the function's own control
  flow, provable in a real test, not just documented intent. `withTimeout` (6s,
  `SHARE_CLIENT_TIMEOUT_MS`) is defense in depth on top of T-13's own ~4s `requestJson` timeout
  (results/T-13-PODIUM.md) — belt and suspenders, and it's what makes "a permanently-hanging
  `shareLevel` still resolves to an error" testable with a fake `Api` that never settles at all,
  independent of whatever a real `Api` implementation does.
- **Hostile remote data.** `sanitizeShareResult` re-validates the resolved `{id, url}` shape AND the
  URL's scheme (`http`/`https` only — rejects `javascript:`/`data:`/malformed) even though `net/
  validate.ts`'s `parseShareResponse` already validated it server-response-side inside T-13's own
  `shareLevel` — never trust a boundary twice-removed. Rendered exclusively through
  `dialogs.ts`'s new `showShareLinkDialog`, via a readonly `<input>`'s `value` property (never
  `innerHTML`, never a live clickable `<a href>`).
- **`api` is OPTIONAL on `EditorMountOptions`**, deliberately — T-08's integration pass already
  landed `ui/screens/editorPlaceholder.ts` calling `mountEditor({storage, onExit, onSaved})` (no
  `api`) per my own prior results doc; making `api` required would have broken that already-shipped
  call site, which I'm not allowed to edit. The Share button simply doesn't render until a caller
  passes `api` — see "ui/ change needed" below for the one-line addition that turns it on for real.

### Verification — real headless Chromium, both fixes, mouse events throughout

Built a Playwright script (scratchpad, not committed — same precedent T-04/T-05/T-08 all used for
their own DOM-behavior verification scripts) driving `editor/dev.html` (updated: `api` now defaults
to a REAL `createApi(window.location.origin)`, and `mount(levelIndex, apiOverride)` accepts an
injectable fake `Api` for the fully-controllable success/hang/hostile-response cases). Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (note: `chromium-1194/chrome-linux/chrome`, not
`chromium/chrome-linux/chrome` — same path quirk noted in this log's earlier screenshot entry).

**11/11 checks passed**, every one using genuine `page.mouse.click()` / Playwright `.click()` (real
mousedown+mouseup+click dispatch, not `element.click()` or keyboard shortcuts):

1. Real mouse click on "Set as goal" flips it to "Goal ✓" — the exact original repro.
2. Real mouse click on the Visible checkbox toggles it.
3. Real mouse click on Delete removes the object.
4. No unexpected console/page errors during that sequence (one filtered, known-benign favicon 404,
   same as every earlier screenshot pass against this harness).
5. Real mouse click on the Anchored checkbox (a second body type) toggles it.
6. Default real `Api` against this plain `vite` dev server (no `/api/**` routes — a genuine 404, not
   a mock): Share resolves to an error dialog in **82-132ms** across runs (measured, not a hang).
7. The level was saved locally via T-10 (`localStorage["swingby:custom_levels"]` verified directly)
   even though the network call failed.
8. Injected fake `Api.shareLevel` that **never resolves**: the editor stayed fully interactive
   during the hang — a 3rd object was placed with a real click while the share was still in flight —
   and the client-side 6s timeout still eventually produced an error dialog (found within an 8s
   wait).
9. Injected fake `Api.shareLevel` resolving successfully: the "Level shared" dialog shows the exact
   URL as plain text in a readonly input (`inputValue === url`), **zero** `<a>` elements in the
   dialog. Screenshot captured (`9-share-success-1280.png`).
10. Injected fake `Api.shareLevel` returning a hostile response (`id: 12345` — wrong type — and
    `url: "javascript:alert(document.cookie)"`): rejected by `sanitizeShareResult`, shown as a
    generic "Share failed" message, **zero** `<a>` elements, and a `page.on("dialog")` listener
    (which would catch a real native `alert()`/`confirm()`) never fired — proves the hostile
    `javascript:` URL was never executed or embedded as a live link.

One real bug found IN MY OWN VERIFICATION SCRIPT while writing it (not in the product): my first
draft placed a single sun with no player and expected a "Set as goal" button, but a lone
freshly-placed body at index 0 already IS the default goal (`goalIndex` starts at 0) — so the panel
correctly showed "Goal ✓" immediately, and my regex-based button lookup for "Set as goal" timed out
looking for text that would never appear. Fixed by placing a player first (claiming the default
goalIndex=0 slot) so the sun genuinely starts as "not yet the goal" — recorded here so a future
reader modifying this script doesn't waste time on the same false lead.

**Break/restore proof, done for both fixes, output captured each time:**
1. Moved `deps.saveLocally(level)` in `shareLevelFlow` to AFTER the network call (reproducing
   exactly the ordering bug the safety property guards against). Ran `editor-share.test.ts`:
   **4/4** ordering-dependent tests failed with clear diffs (`['shareLevel','saveLocally',...]` vs.
   expected `['saveLocally',...]`; `saveLocally` "called 0 times" instead of 1; etc.), 23 others
   stayed green. Reverted; re-ran; 27/27 green.
2. Made `sanitizeShareResult` an identity passthrough (`return value as {id,url}`). Ran the same
   file: **13/13** hostile-data tests failed (every rejection case now returned the raw hostile
   value instead of `null`), 14 others stayed green. Reverted; re-ran; 27/27 green.
3. Removed the `if (!pointerActive) return;` guard from `onPointerUp` (the exact original bug).
   Re-ran the real-Chromium script: it reproduced the ORIGINAL failure mode exactly — the "Set as
   goal" click silently did nothing, the button never changed, and my script's wait for a
   post-click "Goal" button timed out (the same observable symptom T-08 originally found). Restored
   the guard; re-ran the script: 11/11 passed again.

### Final numbers, all re-measured fresh after both fixes and their tests

- `npx tsc --noEmit -p tsconfig.json`: clean, 0 errors, repo-wide.
- `npx vitest run packages/web/test/editor*.test.ts`: **80/80 passing**, 6 files (added
  `editor-share.test.ts`, 27 tests; the previous 5 files' 53 tests all still pass unchanged).
- `npx vitest run` (whole repo): **798 passed, 1 skipped, 0 failed, 50 files**.
- `npx prettier --check` on every file touched this session: clean (ran `--write` scoped to exactly
  those files first).
- Real-Chromium mouse-event verification: **11/11 passed** (full list above).
- `editor/**`'s own gzip weight (deps external, same methodology as the original results):
  **8,077 B = 7.89 KB** (up from 6.89 KB pre-follow-up — the Share/dialog additions). Real whole-app
  build+size (`npm run build -w @swingby/web && npm run size`): **39.95 KB gzip, PASS, 210.05 KB
  under the 250 KB budget** (up from the coordinator's reported 39.11 KB pre-follow-up baseline —
  consistent with the Share code now being bundled into the already-wired `ui/` call site, even
  though `api` itself isn't passed there yet).

### `ui/` change still needed (one line, not applied by me)

`ui/screens/editorPlaceholder.ts` already calls `mountEditor({storage, onExit, onSaved})` per my
original results doc. To actually turn the Share button on in the real app, it needs exactly one
more field: `api: ctx.api` (T-08's own integration pass already put `api: Api` on `ScreenCtx` — see
`results/T-08-BRIDGE.md`'s "What was wired" table, `ui/screen.ts` row). Restated in
`results/T-11-DRAFT.md`'s Follow-ups section for the orchestrator to route.

Task complete (again). Nothing else outstanding.
