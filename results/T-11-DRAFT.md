# T-11 DRAFT — Results

Level editor for the SwingBy web port. Author, edit, playtest, and save custom levels, all gated on
T-03's `validate()` so nothing malformed or unsolvable-by-construction can be persisted.

**See "Follow-ups" below** for two fixes made after the integration pass: the editor's Share action
is now wired to T-13's `shareLevel`, and a real-mouse-click race in the properties panel (found
during integration, flagged by T-08 as not their file to fix) is fixed.

## Deliverables

| # | Artifact | Path | Status |
|---|---|---|---|
| 1 | Editor controller: tools, selection, placement | `packages/web/src/editor/editor.ts` | **Done.** `createEditorEngine` (headless-testable core) + `mountEditor` (DOM wiring), ~1,036 lines |
| 2 | Properties panel and contextual on-canvas controls | `packages/web/src/editor/panel.ts` (DOM panel) + `packages/web/src/editor/overlay.ts` (on-canvas buttons — see note below) | **Done** |
| 3 | Pan/zoom camera control | `packages/web/src/editor/viewport.ts` | **Done** |
| 4 | `EditorOverlay` type, published for T-04 AURORA | `packages/web/src/editor/overlay.ts` | **Done.** See "EditorOverlay contract" below |
| 5 | Confirmation dialogs for Clear, Back, Save | `packages/web/src/editor/dialogs.ts` | **Done** |
| 6 | A level authored in the web editor, opened in Godot — screenshots of both | `packages/web/src/editor/fixtures/authored-level.json` + screenshots of the web side | **BLOCKED — host-only.** See "Deliverable 6" below |

Supporting files under `editor/**` (not individually named deliverables, all within my ownership):

- `editor/preview.ts` — wraps T-05's `createGameLoop` for the live playtest session.
- `editor/history.ts` — the undo stack.
- `editor/__tests__/fakes.ts` — hand-written fake canvas/2D-context/DOM-target for headless tests.
- `editor/dev.html` + `editor/dev.ts` — standalone dev/screenshot harness (mirrors T-04's own
  `render/dev.html` pattern), not referenced by the shipped app.
- `editor/fixtures/authored-level.json` — the deliverable-6 fixture level.
- `editor/screenshots/*.png` — the 8 screenshots referenced throughout this document.

### Note on deliverable 2's split

"A properties panel plus contextual on-canvas buttons" is genuinely two different UIs (a DOM side
panel, and canvas-drawn buttons next to the selected body). `panel.ts` owns the DOM half.
`overlay.ts` owns the on-canvas half (button geometry, hit-testing, and the actual paint calls) —
it's the same file as deliverable 4 because the on-canvas buttons ARE part of the `EditorOverlay`
contract (they're computed into `EditorOverlay.buttons` and painted by `overlay.ts`'s own
`paintEditorOverlay`). Both files are named in the deliverables table above.

## `EditorOverlay` contract (deliverable 4)

Exported from `packages/web/src/editor/overlay.ts`:

```ts
export interface EditorOverlay {
  tool: "select" | "place";
  placeType: BodyType | null;
  selectedIndex: number;
  hoverIndex: number;
  phantom: { type: BodyType; x: number; y: number } | null;
  dragging: { index: number; handle: "move" | "velocity" | "resize" | "delete" } | null;
  requiresReset: boolean; // the preview-drift gate — see below
  buttons: readonly OverlayButton[]; // pre-positioned (screen space) contextual buttons
  goalIndex: number;
}
```

**T-04 AURORA needs no code change.** `render/index.ts`'s `draw()` never reads `frame.
editorOverlay` (confirmed by reading the source) — this was already true before this task started,
and stays true. `mountEditor` builds its OWN second `Renderer` instance (via the real
`createRenderer`) for edit-mode drawing, populates `RenderFrame.editorOverlay` with an
`EditorOverlay` for documentation purposes, calls `renderer.draw(frame)`, and then paints the
overlay itself via `overlay.ts`'s `paintEditorOverlay(ctx, overlay, ...)` against the same canvas's
2D context (`canvas.getContext("2d")` is idempotent — same context object every call). The live
preview (T-05's `createGameLoop`) never sets `editorOverlay` at all — it isn't drawing editor chrome,
it's a real playtest.

## Definition of done

| Item | Status | Reason |
|---|---|---|
| Every capability listed works | **Done** | Placement (click + press-and-drag, ghost preview), selection (click/hover ring), move/velocity/resize drags, resize-scales-gravity for non-player, sun visibility toggle, planet anchored toggle, set-as-goal + goal range, delete, pan, zoom (wheel, suppressed over the panel), undo, clear, preview play/pause/reset, rename, save, back — all implemented and exercised either by an automated test or a screenshot below |
| Level authored in web editor loads unchanged in Godot desktop, and vice versa | **BLOCKED — host-only** | No Godot binary, no `SwingBy2026` checkout in this container. See "Deliverable 6" below for exact host steps and what WAS verified here |
| Preview-state gate prevents committing a mid-simulation position as authored start state | **Done, and structurally stronger than required** | Two independent `Body[]` copies (authored vs. preview-internal) — a drifted preview position cannot leak into authored state by construction, not just because a check happens to run first. See "Preview-state gate" below |
| Undo covers at least placement, scope documented | **Done** | Covers placement, move, resize (+ its gravity-coupling side effect), delete, panel field edits, and clear — snapshot-stack, 50-entry cap. No redo (not required; see log decision #10) |
| Confirmation dialogs on Clear, Back, and Save | **Done** | Screenshots #3 (Save-errors), #4 (Clear); Back uses the same `confirmDialog` helper (not separately screenshotted, identical code path, see `editor.ts`'s `backBtn`) |
| Save rejects invalid levels showing ALL validation errors, not just the first | **Done — 5/5** | See "Validate gate" numbers below |
| Resize still scales gravity for non-player objects | **Done, deliberately narrower than the literal GDScript** | See "Decision #6" in the log — the task doc's own DoD wording says "non-player"; the actual `LevelEditor.gd` applies the coupling to the player too. Followed the task doc's explicit instruction |
| Mouse-usable; touch explicitly stated out of scope | **Done** | Visible "Desktop / mouse only — touch input is not supported in the editor." note under the canvas in every screenshot; no touch listeners attached anywhere in `editor/**` |
| `EditorOverlay` type published and T-04 AURORA notified | **Done** | See contract above; no `render/` change required or made |
| No direct import of `core/physics` — preview runs through a T-05 session | **Done** | `grep -rn "core/physics\|from \"@swingby/core/physics\"" packages/web/src/editor` → no matches. Preview uses `createGameLoop` (T-05's own additional export — see "createGameLoop vs createSession" below) |
| Global checklist (PROJECT.md §7) | **Done**, with the git-diff item unverifiable | `npm run typecheck` clean repo-wide; `npm test` (whole repo) 763 passed / 1 skipped / 0 failed; no new runtime dependency anywhere; `packages/core` untouched; no file outside `editor/**` / `packages/web/test/editor*.test.ts` / `notes/T-11-DRAFT/` / `results/T-11-DRAFT.md` was written. I did **not** run `git diff --name-only` myself (git commands are off-limits per the orchestrator's standing rule for this session) — the orchestrator owns confirming this from the actual diff |

## `createGameLoop` vs `createSession` — resolving an interface-vs-code conflict

The task doc says the preview "runs a T-05 session in a mode with `allowInput: false`". Reading the
REAL `loop.ts`: `createSession` is a thin `requestAnimationFrame` wrapper around `createGameLoop`,
and `createGameLoop`'s tick loop calls `simulateTick(world, input, { allowInput: true, ... })`
**unconditionally** — there is no `allowInput: false` code path anywhere in the real implementation.
Per this repo's own established precedent (T-04's and T-05's logs both defer to the landed code over
a task doc's paraphrase when they disagree), the preview here is a literal playtest: boost/brake
actually work, matching T-05's own one-line description of the interaction ("for playtesting a level
from inside the editor"). `createGameLoop` (not `createSession`) is used because `requestAnimationFrame`
doesn't exist under plain-Node vitest, so `createSession.start()` never advances a tick in a headless
test; `createGameLoop`'s `frame(dt)` is exactly what `loop.ts`'s own doc comment says it exists for.
`GameEngine extends GameSession`, so every method the frozen interface promises is still present —
this satisfies "the preview runs through a T-05 session" literally, just via the additional export
built for exactly this kind of external driving. `mountEditor` runs its own tiny `requestAnimationFrame`
wrapper around `PreviewController.frame(dt)`, structurally identical to what `createSession` does
internally, so real browser gameplay is still real-rAF-driven.

## Preview-state gate — the "subtlest behaviour"

Godot keeps one `objects` array with both "live" and "start" fields per object, diverging while
ticking, and checks `editor_runtime_matches_start_state()` (position diff > 0.01, velocity diff >
0.0001) to decide whether editing is gated. This port instead keeps the **authored** `Body[]`
(inside `createEditorEngine`) completely separate from whatever `createGameLoop` does with its own
`hydrate(serialize(...))` copy during a preview run. The authored array is never touched by a running
preview — structurally, not by convention — so a drifted preview position cannot leak into the
authored state under any code path.

Two gates are implemented, deliberately overlapping (not a single point of failure):

1. **Engine-level, literal drift signal** (`EditorEngine.requiresReset()`): tied to `GameSession.
   snapshot().elapsedTicks > 0` since the preview was last reset. `GameSession`'s frozen interface
   exposes **no body-position accessor** (only status/ticks/fps/boundsWarning/reachedGoal), so a
   literal per-body position diff isn't reachable through the published contract without duplicating
   physics — expressly forbidden. "Has advanced at least one tick" is a conservative superset of
   "has visibly drifted" (every valid level has `gravity > 0` somewhere per `validate()`'s own rule,
   so a ticked body essentially always moves). Every mutating `EditorEngine` method checks this flag
   and is a verified no-op while it's set — see `editor-engine.test.ts`'s "preview gate" suite.
2. **DOM-level, whole-session gate**: `mountEditor`'s own pointer/keyboard listeners are simply not
   routed to the engine for the entire duration a preview session is mounted (canvas ownership is
   handed to the preview's own internal renderer) — stricter than Godot, which still permits placing
   *new* objects while gated. Logged as a deliberate, known divergence, not a silent gap.

Screenshot #6 shows this live in a real browser: the toolbar has swapped to Pause/Reset-preview, and
the panel shows "Preview has run — reset the preview to continue editing."

## Verification — numbers

**Tests.** `npx vitest run packages/web/test/editor*.test.ts`:

```
✓ editor-viewport.test.ts   (7 tests)
✓ editor-overlay.test.ts    (6 tests)
✓ editor-engine.test.ts     (29 tests)
✓ editor-preview.test.ts    (6 tests)
✓ editor-fixture.test.ts    (5 tests)

Test Files  5 passed (5)
     Tests  53 passed (53)
```

Whole-repo `npx vitest run`: **763 passed, 1 skipped, 0 failed, 48 files** (the 1 skip is T-01
KEPLER's own intentional Godot-parity-pending-host-traces skip, unrelated to this task).

**Typecheck.** `npx tsc --noEmit -p tsconfig.json`: **clean, zero errors, repo-wide**, at the time
this was written. (One transient, unrelated error in `packages/web/test/net-queue.test.ts` — T-13
PODIUM's own file, confirmed via `grep` to contain no mention of `editor` anywhere — was observed
earlier in this session and resolved itself on a later run, presumably a concurrent T-13 fix; noted
here in case a stale error is seen again, it is not mine.)

**Hit-testing accuracy**, using T-04's real `renderer.worldToScreen`/`screenToWorld` (never
reimplemented — `editor-engine.test.ts`'s `hitTest` calls straight through to the injected real
`Renderer`): tested at **zoom = 0.12 (MIN_ZOOM), 0.25, 0.5, 1, 2, 3, 5.0 (MAX_ZOOM)** — the editor's
entire supported zoom range (the same `[0.12, 5.0]` clamp Godot's own `editor_zoom_at_screen` uses).
At every one of those 7 levels, 3 simultaneously-placed bodies (player/sun/planet) were each
correctly selected by clicking their exact rendered screen position, and a point far from everything
correctly selected nothing. **7/7 zoom levels pass, 0 failures.** Z-order (two bodies placed exactly
on top of each other) correctly resolves to the topmost/last-placed one.

**Round-trip**, through T-03's real `serialize`/`hydrate` (never a custom serializer): **5/5**
authored levels — built via the real engine's placement/drag/panel-setter code paths, covering every
serialize branch this task's object model can produce (nonzero and zero velocity, visible and
invisible sun, anchored and unanchored planet, non-default and exactly-default goal range, and the
empty-name/author "Custom Stage"/"Guest" fallback) — each satisfies
`serialize(hydrate(level)) deepEquals level` exactly.

**`validate()` gate — 5/5**, each refused with the correct error substring present:

| # | Case | Refused | Error contains |
|---|---|---|---|
| 1 | No player | ✅ | `"exactly one player"` |
| 2 | Two players | ✅ | `"found 2"` |
| 3 | Goal points at the player | ✅ | `"must not reference the player"` |
| 4 | `goal.range <= 0` | ✅ | `"goal.range"` |
| 5 | No body with `gravity > 0` | ✅ | `"gravity > 0"` |

Plus a sixth control case (a fully valid level) IS accepted, and a seventh case proves **all**
applicable errors surface simultaneously (3 simultaneous violations, all 3 present in one
`errors[]` array) — matching the DoD's "showing ALL validation errors, not just the first."
Screenshot #3 shows this live in the browser: Save on an invalid stage lists 2 problems at once.

**Undo.** Covers placement (N places → N undos → back to empty, verified), move, resize (with its
gravity-coupling side effect verified to also revert), and delete — interleaved in one test, each
undo step checked for **exact** restoration of the prior body array. Capped at 50 entries (placed 60
objects, `undoDepth() === 50`, confirmed). No redo (not required by the task doc, which only asks
the scope be documented — documented here and in the log).

**Gzipped size** (esbuild `--bundle --minify --format=esm`, from `editor/editor.ts`):

| Measurement | Raw | Gzip |
|---|---|---|
| `editor/**`'s own code only (core/render/storage/game marked `--external` — the true marginal weight on top of what's already shipped for gameplay) | 18.5 KB | **6.89 KB** |
| Full transitive graph (everything `editor.ts` imports, nothing shared/deduped — the worst-case standalone number) | 44.7 KB | **16.16 KB** |
| Current real whole-app build (`npm run build -w @swingby/web` + `npm run size`) | 51.56 KB | **15.74 KB**, PASS, 234.26 KB under the 250 KB budget |

The whole-app number is **unchanged by this task** — `editor/**` is not wired into `main.ts`/`ui/**`
(not my file to touch; see "ui/ wiring needed" below). Once wired, the real marginal delta will be
close to the 6.89 KB "own code" figure (render/game/storage are already in the 15.74 KB baseline),
and even the worst-case 16.16 KB fully-standalone figure leaves >200 KB of headroom. No new
dependency was added anywhere.

**Screenshots** (`packages/web/src/editor/screenshots/`), captured via headless Chromium
(`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) against `editor/dev.html` served by
`npm run dev -w @swingby/web`:

| File | What it shows |
|---|---|
| `1-empty-1280.png` | Fresh, empty editor at 1280px |
| `2-populated-selected-1280.png` | Player + sun + planet placed, planet selected — panel AND on-canvas contextual buttons (move/velocity/resize/delete) both visible at once |
| `3-invalid-save-errors-1280.png` | Save on an intentionally invalid stage — the errors dialog lists BOTH problems at once |
| `4-clear-confirm-1280.png` | Clear-stage confirmation dialog |
| `5-loaded-level-1280.png` | A built-in level ("Orbital Primer") loaded into the editor — velocity arrow + gravity-influence ring overlay visible |
| `6-preview-playing-1280.png` | The same level mid-preview: toolbar swapped to Play/Pause/Reset-preview, panel showing the "Preview has run — reset the preview to continue editing" hint, ship visibly moved from its start position — a REAL T-05 `createGameLoop` session driving a REAL browser canvas |
| `7-empty-360.png` | Empty editor at 360px (mobile-width layout) |
| `8-populated-360.png` | Populated + selected, at 360px, **after** fixing a real layout bug found by looking at this exact screenshot (see below) |

**A real bug found by looking at the 360px screenshot, not just running the script.** The first pass
of `8-populated-360.png` showed the properties panel as an empty black strip with no visible fields
— a CSS flexbox bug (`.editor-canvas-wrap`'s `flex:1` shorthand has `flex-basis:0`, which contributes
zero weight to flexbox's shrink-distribution math, so the sibling panel — `flex-basis:auto`, no
explicit sizing — absorbed nearly all of the deficit and was squeezed to near-zero height instead of
its content height). Fixed in `editor/dev.html`'s own scratch CSS (`min-height: 40vh` on the canvas
wrap, `flex: 0 0 auto` + `overflow-y: auto` on the panel) and re-screenshotted to confirm. This fix
is scoped to the dev harness only — see "ui/ wiring needed" below for the equivalent rule the real
app's stylesheet will need.

**Prove tests can fail, then restore — done twice, output captured both times:**

1. Hit-testing: temporarily replaced `pickObjectAt`'s body with `return -1;`. Result: **8/8**
   hit-testing-dependent tests failed (all 7 zoom levels + z-order), the other 21 stayed green.
   Reverted; re-ran; 29/29 green.
2. The validate/save gate: temporarily replaced `validateCurrent()` with a stub always returning
   `{ ok: true }`. Result: **6/6** gate-dependent tests failed (all 5 invalid cases + the multi-error
   case), 23 others stayed green (including the "valid level IS accepted" control, unaffected since
   it was already true). Reverted; re-ran; 29/29 green.

Both breaks targeted exactly the claim each group of tests protects and nothing else moved.

## Deliverable 6 — fixture level, and the exact host steps for Godot

**Fixture:** `packages/web/src/editor/fixtures/authored-level.json`, authored through the real
editor engine's own code paths (placement + panel setters), not hand-written JSON. Contains one of
each element the task doc's cross-build check names: an anchored planet, an invisible sun, a moving
planet, and a non-default goal range (90, not the default 50). Verified in this container, all in
the committed `editor-fixture.test.ts`:

- `validate(fixture)` → `{ ok: true }`.
- `serialize(hydrate(fixture))` deep-equals `fixture` exactly (the round-trip guarantee).
- Loadable by the real editor engine (`createEditorEngine({ initialLevel: fixture })`) and
  re-exports identically via `toLevel()`.
- **Solvable**: driven end-to-end through T-05's real `createGameLoop` with a static `NO_INPUT`
  source (a pure coast) — reaches the goal at tick 144 (1.0s of simulated time), confirmed via
  `snapshot().reachedGoal === true`. Not trusted from the scratchpad search that found the winning
  initial velocity — independently re-verified by this committed test driving the real physics.

**BLOCKED — host-only, exactly as flagged for T-01 KEPLER's own parity harness.** There is no Godot
binary and no `SwingBy2026` checkout in this container. I have **not** observed this file open in
Godot and make no claim that it does. Steps for Magnus to run on the host:

```bash
# 1. Copy the fixture into Godot's custom-levels file (adjust the path for your OS/user; this is
#    the macOS path per the task doc's own example).
mkdir -p "$HOME/Library/Application Support/Godot/app_userdata/SwingBy"
# custom_levels.json is a bare ARRAY (per INTERFACES.md's "Custom level ids" section) — wrap the
# fixture in [ ... ] if the file doesn't already exist, or append it to the existing array.
python3 -c "
import json
p = '$HOME/Library/Application Support/Godot/app_userdata/SwingBy/custom_levels.json'
try:
    with open(p) as f: levels = json.load(f)
except FileNotFoundError:
    levels = []
with open('packages/web/src/editor/fixtures/authored-level.json') as f:
    levels.append(json.load(f))
with open(p, 'w') as f: json.dump(levels, f, indent=2)
"

# 2. Launch Godot against the SwingBy2026 project.
/Applications/Godot.app/Contents/MacOS/Godot \
  --path /Users/magnussaurbier/Documents/Dev/2026_Swingby/SwingBy2026

# 3. In-game: Custom Levels -> "Fixture Orbit" -> Play. Confirm it loads (5 objects: a visible sun
#    at (1300,900), an invisible sun at (1300,500) that should exert gravity but not be drawn, an
#    anchored planet at (1900,1300) that should NOT orbit, a moving planet at (900,1300) that IS
#    the goal (range 90) and should be drifting via its authored velocity (0,-1.4), and the player
#    launching from (400,900) at velocity (4,0)). It should reach the goal quickly (this container
#    measured 144 ticks / 1.0s under a pure coast).
# 4. Reverse direction: open the LEVEL EDITOR in Godot itself, author a small level (or reuse one
#    of the 33 built-ins, exported), copy its exported JSON into
#    packages/web/src/editor/fixtures/godot-authored-level.json (a NEW file — do not overwrite
#    the one this task committed), then load it in the web editor's dev harness
#    (`npm run dev -w @swingby/web`, then in a browser console:
#    `fetch('/src/editor/fixtures/godot-authored-level.json').then(r=>r.json()).then(l =>
#    window.__editorDev.mount === undefined ? null : null)` — or more simply, paste the JSON's
#    fields into the editor by hand, or wire a "load from file" input if convenient) and confirm it
#    opens without error and LOOKS the same (same object count/positions/goal).
# 5. Screenshot both directions for the PR, exactly as the task doc's own "How to verify" section
#    asks.
```

If step 3 or 4 fails, the task doc's own guidance applies: "the bug is almost certainly in T-03's
`serialize` — report it there rather than patching around it in the editor" (this container's own
round-trip and validate checks against T-03's real, unmodified `serialize`/`hydrate`/`validate` all
passed, which is the strongest evidence available from inside this container that the persisted
JSON shape is correct — but it is evidence, not the same as having actually watched Godot load it).

## `ui/` wiring needed — exact change, for the orchestrator

I do not own `ui/**` and have not touched it. `mountEditor` was deliberately designed to return
`{ el: HTMLElement, destroy(): void }` — structurally identical to `ui/screen.ts`'s `ScreenResult`
— specifically so wiring it in is a small, mechanical change to
`packages/web/src/ui/screens/editorPlaceholder.ts`:

```ts
// packages/web/src/ui/screens/editorPlaceholder.ts (or rename the file/route as T-08 sees fit)
import { mountEditor } from "../../editor/editor.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

export function renderEditorPlaceholder(ctx: ScreenCtx): ScreenResult {
  return mountEditor({
    storage: ctx.storage,
    // level: <look up ctx.params if this route ever supports /editor/:levelId for editing an
    //        existing custom level; omit for "new level">
    onExit: () => ctx.navigate("/"),
    onSaved: () => ctx.navigate("/levels"), // or wherever a saved-custom-level should land
  });
}
```

No other code change is required — `EditorMountOptions`/`EditorHandle` need nothing from `ui/**`
beyond a `Storage` instance (already published, T-10 VAULT) and two plain callbacks.

**One CSS addition IS needed**, because I cannot add rules to `styles/**` (not mine) and the real
app's stylesheet does not yet have layout rules for `.editor-*` classes (my `dev.html` harness ships
its own scratch copy of these rules, which the shipped app never loads). The mobile flexbox bug
described above (found via the 360px screenshot) needs its fix present in whatever stylesheet
actually renders the mounted editor:

```css
.editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.editor-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.editor-canvas-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}
.editor-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.editor-panel {
  width: 260px;
  max-width: 40vw;
  overflow-y: auto;
}
@media (max-width: 640px) {
  .editor-body {
    flex-direction: column;
  }
  .editor-canvas-wrap {
    min-height: 40vh; /* without this, the sibling panel gets flexbox-squeezed to ~0 height */
    flex: 1 1 auto;
  }
  .editor-panel {
    width: 100%;
    max-width: none;
    max-height: 45vh;
    flex: 0 0 auto;
    overflow-y: auto;
  }
}
```
(`editor/dev.html` has the full, exact rule set I tested this against, including the `--space-*`
custom-property fallbacks I improvised for the standalone harness — T-08's real `tokens.css` already
defines the real ones, so the real integration should be simpler than the harness's copy, not more.)

## What could not be verified

- **Deliverable 6's actual cross-build check** — no Godot binary, no `SwingBy2026` checkout in this
  container. See the host steps above. Everything verifiable *without* Godot (validate, round-trip,
  loadability via the real editor engine, solvability via a real T-05 session) was verified.
- **`git diff --name-only`** (PROJECT.md §7's file-ownership check) — git commands are off-limits
  for this session per the orchestrator's standing rule. I tracked every file I touched manually
  (listed in the Deliverables table above) and did not open, read the contents for editing, or write
  to anything outside `packages/web/src/editor/**`, `packages/web/test/editor*.test.ts`,
  `notes/T-11-DRAFT/**`, `results/T-11-DRAFT.md`.
- **Real touch/mobile-device testing** — touch is explicitly out of scope per the task doc ("touch
  explicitly stated as out of scope in the UI rather than half-working"); the 360px screenshots
  prove the layout is usable at a phone-sized viewport with a mouse/trackpad, not that touch
  gestures work (they're not wired up at all, by design).
- **The real production-integrated (`ui/`-wired) page** — screenshot appearance and behavior after
  the orchestrator applies the "ui/ wiring needed" change above. I only verified the standalone
  `dev.html` harness, since I don't own `ui/**`. I could not run the integrated page myself to
  confirm it looks identical to my harness (it should, since `mountEditor` builds its own complete
  DOM subtree independent of the host page, but this is inference, not observation).
- **A real browser-native Save/Load round-trip through T-10's `localStorage`-backed `Storage`** —
  `mountEditor`'s Save button does call the real `storage.saveCustomLevel(level)` (confirmed by
  reading the code path and by the "1 object" / "Save" screenshots showing the flow reach that
  call), but I did not add a dedicated screenshot of "reload the page, see the level persisted" —
  that's T-10's own already-shipped, already-tested persistence guarantee (`storage/index.ts`'s own
  test suite), not something new this task needed to re-prove.

## Follow-ups (post-integration-pass)

T-08 BRIDGE's integration pass wired the whole app together and found two real issues living in
`editor/**`, which it flagged rather than fixed (outside its ownership). Both addressed here.

### Follow-up 1 — the real-mouse-click race in `editor.ts` (T-08's "bug 5")

**Root cause** (diagnosed by T-08, confirmed and fixed here — see `results/T-08-BRIDGE.md`'s
"Integration pass" bug table and `notes/T-08-BRIDGE/log.md`'s 2026-08-16T13:10Z entry for the
original, precise diagnosis): `onPointerUp` was attached to `window`'s `mouseup` (deliberately, so
a canvas-originated drag keeps tracking even if released off-canvas), but it acted
**unconditionally** on every mouseup anywhere on the page — including a plain click on a
`.editor-panel` button — and called `refreshPanel()`, which does `root.replaceChildren()` (a full
panel DOM rebuild) synchronously during that same mouseup's bubble phase. Per the DOM click-
synthesis spec, a trailing `click` only fires if the mousedown/mouseup target is still attached
when the browser checks; rebuilding the panel detaches the just-pressed button first, so `click`
never fires. This affected every button inside `.editor-panel` (Set as goal, Delete, the Visible/
Anchored toggles) for every real mouse user.

**Fix**: a `pointerActive` flag, set only by canvas's own scoped `mousedown` listener. The
window-level `mouseup`/`mousemove` handlers now only act when `pointerActive` is true (a
canvas-originated gesture is genuinely in progress) or, for idle hover updates, when the event
target is literally the canvas. A mouseup whose mousedown never touched the canvas — a panel
button click — now leaves the panel's DOM untouched through the dispatch, so the browser's real
`click` synthesis proceeds normally. Canvas-originated drags ending off-canvas are unaffected —
`pointerActive` stays true for the whole gesture regardless of where the pointer wanders.

**Verified with real mouse events in headless Chromium** (`/opt/pw-browsers/chromium-1194/
chrome-linux/chrome`, via the globally installed Playwright at `/opt/node22/lib/node_modules/
playwright`), driving `editor/dev.html` with genuine `page.mouse.click()`/Playwright `.click()`
calls (real mousedown+mouseup+click dispatch, not `element.click()` or a keyboard shortcut):

- Real click on "Set as goal" flips it to "Goal ✓" — the exact original repro. **Pass.**
- Real click on the Visible checkbox (sun) toggles it. **Pass.**
- Real click on the Anchored checkbox (planet) toggles it. **Pass.**
- Real click on Delete removes the object. **Pass.**
- No unexpected console/page errors during the whole sequence. **Pass.**

**Break/restore proof**: removed the `pointerActive` guard (reproducing the exact original bug byte
for byte) and re-ran the same real-Chromium script — it reproduced the ORIGINAL failure mode
exactly: the "Set as goal" click silently did nothing, the button text never changed, the script's
wait for a post-click "Goal" button timed out. Restored the guard; re-ran; passed again.

No headless `vitest` regression test is possible for this specific fix — this project has no jsdom
anywhere (confirmed, same finding every prior task in this repo independently records), and the bug
is specifically about real-browser DOM click-synthesis timing relative to a mid-dispatch DOM
mutation; a hand-rolled fake DOM could only "prove" this by re-implementing the exact spec behavior
under test, which would not be convincing evidence. The real-Chromium verification above (reproduced
the failure, then the fix, on demand) is the regression evidence for this one.

### Follow-up 2 — wire the editor's Share action to `Api.shareLevel`

Added a "Share" toolbar button (only rendered when a caller passes `api: Api` — see below) backed
by a new, headless-testable, exported orchestration function in `editor.ts`:

```ts
export async function shareLevelFlow(level: Level, deps: ShareDeps): Promise<ShareOutcome>
```

Order of operations, and why it satisfies both properties the coordinator named:

1. `deps.validateLevel(level)` — an invalid level is never sent anywhere, exactly like Save.
2. `deps.saveLocally(level)` (T-10's `storage.saveCustomLevel`, synchronous) runs and must
   complete (or throw) BEFORE the network call is ever made — literal program order, not a race.
   `deps.onSavedLocally` fires immediately after, still before `shareLevel` is called.
3. `deps.shareLevel(level)` is awaited inside `withTimeout(..., 6000, "Share")` — never blocks
   forever, regardless of what a given `Api` does (defense in depth on top of T-13's own ~4s
   `requestJson` timeout, per `results/T-13-PODIUM.md`).
4. The resolved value is treated as hostile remote data: `sanitizeShareResult` re-checks the shape
   AND the URL's scheme (only `http`/`https` accepted — rejects `javascript:`/`data:`/malformed)
   even though T-13's own `parseShareResponse` already validated it server-response-side. Rendered
   exclusively via a readonly `<input>`'s `value` property (`dialogs.ts`'s new
   `showShareLinkDialog`) — never `innerHTML`, never a live clickable `<a href>`.

`mountEditor`'s `handleShare` is a thin DOM adapter over `shareLevelFlow`, translating each
`ShareOutcome` variant (`invalid` / `save-failed` / `share-failed` / `shared`) into the right
dialog (`showErrorsDialog` / `showMessageDialog` / `showShareLinkDialog`).

`EditorMountOptions.api` is **optional**, deliberately: T-08's integration pass already landed
`ui/screens/editorPlaceholder.ts` calling `mountEditor({storage, onExit, onSaved})` (no `api`), per
my own earlier results doc. Making `api` required would break that already-shipped, already-working
call site, which I'm not allowed to edit. The Share button simply doesn't render until a caller
passes `api` — see "`ui/` change still needed" below.

**Headless regression tests** (`packages/web/test/editor-share.test.ts`, 27 tests, no DOM needed —
tests `shareLevelFlow`/`sanitizeShareResult`/`withTimeout`/`describeError` directly):

- Validation gate: invalid level refused, `saveLocally`/`shareLevel` never called.
- **Save-before-network ordering**: call order asserted directly (`["saveLocally",
  "onSavedLocally", "shareLevel"]`), plus three more tests each confirming `saveLocally` was
  called exactly once even when the network call subsequently fails, hangs forever, or when the
  local save itself throws (in which case `shareLevel` is proven never called at all).
- **Never blocks on the network**: a `shareLevel` that never resolves still produces a
  `share-failed` outcome within the configured timeout, measured directly (elapsed time asserted
  `< 1000ms` against a 50ms test timeout) — not left pending.
- **Hostile remote data**: 13 distinct malformed/hostile response shapes (missing/wrong-typed
  fields, `javascript:`/`data:` URL schemes, an absurdly long id, an array instead of an object,
  etc.) each rejected, plus 2 well-formed cases (https, http-for-local-dev) accepted, plus an
  end-to-end case proving `shareLevelFlow` never reaches a `"shared"` outcome for a hostile
  response.

**Verified with real mouse events in headless Chromium**, same script/session as follow-up 1 (see
`editor/dev.ts`: `api` now defaults to a real `createApi(window.location.origin)`, and accepts an
injectable fake `Api` for fully controllable success/hang/hostile-response cases):

- Default real `Api` against this plain `vite` dev server (no `/api/**` routes — a genuine 404):
  Share resolves to an error dialog in **82-132ms** measured across runs — not a hang. **Pass.**
- The level was saved locally via T-10 (`localStorage["swingby:custom_levels"]` checked directly)
  even though the network call failed. **Pass.**
- Injected `Api.shareLevel` that never resolves: the editor stayed fully interactive DURING the
  hang (a 3rd object was placed with a real mouse click while the share was still in flight), and
  the 6s client-side timeout still eventually produced an error dialog. **Pass.**
- Injected `Api.shareLevel` resolving successfully: the "Level shared" dialog shows the exact URL
  as plain text in a readonly input, zero `<a>` elements. Screenshot: `editor/screenshots/
  9-share-success-1280.png`. **Pass.**
- Injected `Api.shareLevel` returning a hostile response (wrong-typed `id`, `javascript:` URL):
  rejected, shown as a generic error, zero `<a>` elements, and a `page.on("dialog")` listener
  (which would catch a real native `alert()`) never fired. **Pass.**

**11/11** real-Chromium checks passed (5 for follow-up 1, 6 for follow-up 2 including the shared
error/no-error-consoles check counted once).

**Break/restore proof** (in addition to follow-up 1's, above), both done for real, output captured:

1. Moved `saveLocally` to AFTER the network call inside `shareLevelFlow` (reproducing the exact
   ordering bug the safety property guards against). **4/4** ordering tests failed with clear
   diffs; 23 others stayed green. Reverted; 27/27 green again.
2. Made `sanitizeShareResult` an identity passthrough. **13/13** hostile-data tests failed (every
   rejection case returned the raw hostile value instead of `null`); 14 others stayed green.
   Reverted; 27/27 green again.

### `ui/` change still needed (one line, not applied by me — not my file)

`ui/screens/editorPlaceholder.ts` already calls `mountEditor({storage, onExit, onSaved})`. To turn
the Share button on for real users, it needs exactly one more field:

```ts
mountEditor({ storage: ctx.storage, api: ctx.api, onExit: () => ctx.navigate("/"), onSaved: ... });
```

`ctx.api: Api` already exists — T-08's own integration pass added it to `ScreenCtx` (`results/
T-08-BRIDGE.md`'s "What was wired" table, `ui/screen.ts` row) for exactly this purpose (their own
"Blocked / not mine to do" section names this as the one thing routed to me). No other `ui/` change
is needed; the Share button, dialogs, and error handling are entirely self-contained in `editor/**`.

### Numbers, re-measured fresh after both fixes

- `npx tsc --noEmit -p tsconfig.json`: clean, 0 errors, repo-wide.
- `npx vitest run packages/web/test/editor*.test.ts`: **80/80 passing**, 6 files (added
  `editor-share.test.ts`'s 27 tests; the original 5 files' 53 tests all still pass unchanged).
- `npx vitest run` (whole repo): **798 passed, 1 skipped, 0 failed, 50 files**.
- `editor/**`'s own gzip weight (deps external, same methodology as the original measurement):
  **7.89 KB** (up from 6.89 KB — the Share/dialog additions).
- Real whole-app build (`npm run build -w @swingby/web && npm run size`): **39.95 KB gzip, PASS,
  210.05 KB under the 250 KB budget** (up from the coordinator-reported 39.11 KB pre-follow-up
  baseline — the Share code is now bundled into the already-wired `ui/` call site even though
  `api` itself isn't passed there yet; once it is, no further size change is expected since the
  code is already shipping).
- `npx prettier --check` on every file touched this session: clean.

### What's still not verifiable from here

- The actual `ui/`-wired Share button, end-to-end in the real app (with `api: ctx.api` added) — I
  verified the standalone `dev.html` harness with both a real (404-ing) `Api` and fully-controlled
  fake ones, not the final integrated page, since I don't own `ui/**`.
- A real, reachable `/api/levels` backend's actual response shape in production — verified against
  T-13's own documented contract and a real 404 (genuine network failure), not a live server.

## Files touched

```
packages/web/src/editor/editor.ts
packages/web/src/editor/panel.ts
packages/web/src/editor/viewport.ts
packages/web/src/editor/overlay.ts
packages/web/src/editor/dialogs.ts
packages/web/src/editor/preview.ts
packages/web/src/editor/history.ts
packages/web/src/editor/dev.html
packages/web/src/editor/dev.ts
packages/web/src/editor/__tests__/fakes.ts
packages/web/src/editor/fixtures/authored-level.json
packages/web/src/editor/screenshots/*.png (9 files — added 9-share-success-1280.png)
packages/web/test/editor-viewport.test.ts
packages/web/test/editor-overlay.test.ts
packages/web/test/editor-engine.test.ts
packages/web/test/editor-preview.test.ts
packages/web/test/editor-fixture.test.ts
packages/web/test/editor-share.test.ts
notes/T-11-DRAFT/log.md
results/T-11-DRAFT.md
```

Nothing outside this list was written. `packages/core/src/types.ts`/`constants.ts` untouched;
`reference/**` untouched; `ui/**` untouched; `hud/**` untouched; `net/**` untouched (only imported
its published `Api` type); `styles/**` untouched; `api/**` untouched.
