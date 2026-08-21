# Implementation plan — editor canvas interaction (two changes, one branch)

Branch: `feat/editor-canvas-interaction` (renamed from `feat/editor-size-handle-follows-cursor`).
Base: `main` @ `5ceb841`. Status: **plan for review — no implementation code written.**

- **Change 1 — size handle follows the cursor.** Owner: *"also in the editor, the size selector
  button shall move to the exact location where the cursor was dragged to (behave like the speed
  selector button). Currently its fixed in place."*
- **Change 2 — placement ghost at the cursor + repeat place.** Owner: *"and when selecting "pace
  xxx", there should be the selected object shown at the cursor. After click (when the object is
  placed) a copy of the object shall still move with the cursor (to place a potential second clone)
  until another button is pressed or right click is performed."*

---

## Expected file list

| File | Change 1 | Change 2 |
|---|---|---|
| `packages/web/src/editor/overlay.ts` | yes | doc only |
| `packages/web/src/editor/editor.ts` | yes | yes |
| `packages/web/test/editor-overlay.test.ts` | yes | — |
| `packages/web/test/editor-engine.test.ts` | yes | yes |
| `notes/feat-editor-canvas-interaction/PLAN.md` | this file | this file |

Nothing else. No new source files. `packages/web/src/ui/**`, `game/**`, `storage/**`,
`packages/core/**` are untouched — I have **read** `ui/screens/editorPlaceholder.ts` and
`render/index.ts` only. `packages/core/src/types.ts` and `constants.ts` are FROZEN and not opened.

**Lane note:** `notes/**` is outside the lane the orchestrator gave me
(`packages/web/src/editor/**` + editor tests). I am writing there only because the orchestrator
directed this file to that path as the reply channel. Flagging rather than taking it silently.

**Branch housekeeping:** the local rename and the push of `feat/editor-canvas-interaction` both
succeeded. `git push origin --delete feat/editor-size-handle-follows-cursor` was **refused by this
session's permission classifier** (remote branch deletion). The old remote branch still exists and
holds only the empty start commit. I cannot delete it; please delete it on your side.

---

## Open questions

These change *what gets built*. I am not resolving any of them by guessing. Q1/Q2 are Change 1;
Q3–Q5 are Change 2. Q6 and Q7 I propose a default for and will implement that default unless told
otherwise — flagged so the default is a decision on the record, not a silent choice.

**Q1 (Change 1, blocking) — after the mouse is released, where does the size handle sit?**
During the drag the requirement is unambiguous: centred on the cursor, pixel-exact, like the speed
handle. After release there are three readings, all consistent with the sentence as written. The
speed handle stays at the drop point *only because the drop point is the stored velocity*; size is
a scalar with no direction, so there is nothing to derive a resting position from.
- **(A) Snap back** to 44 px left of the body the instant the drag ends — follows the cursor only
  while dragging.
- **(B) Stay where dropped** — the closest literal match to "behave like the speed selector
  button". Needs a per-body handle offset in editor session state; not saved with the level, so it
  resets on reload, and needs a defined answer for Undo, delete, and typing into the panel's Size
  field. Materially more code and more edge cases than (A); an offset cannot be keyed by body index
  because a delete or an undo re-clones the bodies and orphans it.
- **(C) Rest at a distance proportional to size** — the Godot original's behaviour: drifts outward
  as the body grows, returns to the horizontal axis on release.

**Q2 (Change 1) — clamp behaviour.** Size clamps at 4–40. Past the clamp, should the handle keep
tracking the cursor (velocity has no clamp, so the analogy says yes) or stop at the position
matching the clamped size?

**Q3 (Change 2, blocking) — what exactly ends repeat-place mode?** *"until another button is
pressed or right click is performed"*. "Another button" has at least three readings:
- **(i) another toolbar button** — any of Place player / Place sun / Place planet / Undo / Clear
  stage / Play preview / Save / Share / Back. Under this reading, clicking a *different* Place
  button ends the current repeat mode and starts a new one for that type, which is already what
  `armPlace` does today.
- **(ii) another mouse button** — i.e. anything that is not the left button.
- **(iii) any keyboard key.** Escape already cancels placement today (`onKeydown`).
My reading is (i) plus the already-existing Escape, because the owner wrote "button" alongside
"right click" as two separate things, which suggests "button" means an on-screen button rather than
a mouse button. But that is exactly the coin flip I am told not to make.

**Q4 (Change 2, blocking) — right-click, and what it costs existing users.** The editor's pointer
handlers do **not** filter on `ev.button` today. I verified in the running app that a **right-click
on the canvas currently places an object** (object count went 2 → 3 on a right-click with a tool
armed), and by the same code path a right-drag or middle-drag currently pans. Making right-click
*cancel* therefore requires ignoring non-left buttons in `mousedown`/`mouseup`, which removes
right-drag and middle-drag panning. Two decisions for the owner:
- Confirm right-click should stop placing and instead cancel — yes/no.
- Should the browser's native context menu be suppressed over the canvas (`preventDefault` on
  `contextmenu`)? Without it, a cancelling right-click also pops the OS menu over the editor.
  My reading is that suppressing it is implied by "right click is performed" being a UI gesture,
  but it is a visible change and I will not assume it.

**Q5 (Change 2, blocking) — is each placed object still auto-selected while repeat mode is armed?**
Today `commitPlacement()` selects the new body, which opens its properties panel and draws its four
contextual handles on the canvas. If repeat mode stays armed, every clone leaves a selected body
with handles drawn under the ghost the user is still moving. Keeping the current behaviour is
consistent but visually noisy; suppressing selection while armed is cleaner but changes what
happens on the *first* placement, which people use today. (Note the handles are not *clickable*
while armed — `pointerDown` returns at the `if (placeType)` branch before any handle hit-test — so
this is purely about clutter and about whether the panel opens.)

**Q6 (Change 2, default proposed) — what the ghost looks like.** The repo already has a placement
ghost: a translucent circle, radius by type (sun 18, player 14, planet 10, scaled by zoom, min 6
px), drawn by `paintEditorOverlay`. **Proposed default: reuse it unchanged** — it is the existing
pattern, and "shown at the cursor" is about *position*, not about upgrading the artwork. I will not
render the real body sprite unless asked. (Aside, not proposed for this change: the player ghost's
radius 14 does not match `DEFAULT_BODY_SIZE = 10`, the size it actually creates. Pre-existing;
flagging, not fixing.)

**Q7 (Change 2, default proposed) — ghost when the cursor leaves the canvas.** **Proposed default:
the ghost disappears while the cursor is outside the canvas and reappears on re-entry; the armed
tool stays armed.** This matches `EditorOverlay.phantom`'s own doc comment ("armed `place` tool,
**cursor over the canvas**").

---

## Classification — I agree on Change 1; Change 2 splits, and I think part of it is a bug

**Change 1 is a feature.** Nothing malfunctions, and the deliberate record you predicted exists —
see "Records to update" below.

**Change 2 part 2 (repeat place) is a feature.** New behaviour; the Godot original explicitly does
the opposite (`_do_place` clears the phantom).

**Change 2 part 1 (ghost at the cursor before the click) looks like a bug, not a feature.** Two
pieces of evidence that it is intended behaviour that fails, rather than behaviour never intended:
1. `EditorOverlay.phantom`'s own doc comment in `overlay.ts` states the ghost is drawn when the
   `place` tool is **armed and the cursor is over the canvas** — no mention of a press. The code
   only ever assigns `phantom` inside `pointerDown`.
2. `notes/T-11-DRAFT/log.md` decision #7 records the placement design as: *"arm a tool+type from the
   toolbar, **show a ghost following the cursor over the canvas**, commit on mouseup"*, explicitly
   to satisfy both click-to-place and press-and-drag through one code path.
The Godot reference agrees: in `_phantom_state == "wait_press"` the phantom is live and tracks
`mouse_world` every frame *before* the press.
Confirmed in the running app: with "Place planet" armed and the cursor over the canvas, **no ghost
is drawn** until the mouse button goes down (screenshot `PL-1-armed-hover.png`).
I am not re-classifying anything myself — flagging it with the evidence, per your instruction. It
does not change my implementation either way; it changes whether a regression test or a feature
test is the right framing, and I will follow your call.

---

## Grounding — what I observed in the real app

Headless Chromium via preinstalled Playwright (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`;
**`playwright install` never run**), real `mouse.down/move/up`, against the real `/editor` route
(`ui/screens/editorPlaceholder.ts` mounts the real `mountEditor` — this is the shipped editor, not
the dev harness), 1280×900. Handle positions were located by scanning the live canvas pixels rather
than by assuming coordinates.

**"pace xxx" confirmed against the actual UI:** the toolbar reads **"Place player"**, **"Place
sun"**, **"Place planet"**. The owner meant "place".

**Change 1 observations**
- Idle: move handle at (500.4, 437.4); resize 44 px left, velocity 44 px right, delete 44 px below.
- Velocity drag to (700.4, 557.4): mid-drag the `→` button rendered at **(700, 557)** — exactly under
  the cursor, arrow stretched to it. After release it stayed there.
- Resize drag to (250.4, 297.4): mid-drag the `⤡` button was still at **(456, 446)** — never moved,
  ~250 px from the cursor. Only the planet grew (Size 10 → 40).

**Change 2 observations** (object counts read from the panel)
| Step | Result |
|---|---|
| Arm "Place planet", hover the canvas, no click | **no ghost**, 0 objects |
| Click | 1 object; tool disarms |
| Move away, click again without re-arming | still **1 object** — confirms the tool disarmed |
| Press-and-drag placement | works; ghost visible during the drag (`PL-4-press-drag-ghost.png`) |
| **Right-click with a tool armed** | **placed an object** (2 → 3) — right-click is treated as left |

**Mechanisms (demonstrated, not asserted)**
- Change 1: `currentButtons()` builds a `liveEnd` override *only* for `dragHandle === "velocity"`.
  Because `applyDrag` sets `xVel = (worldPt.x - b.x) * 0.01` and the handle rests at `b + vel*100`,
  that resting point is algebraically identical to the cursor's world point — which is why the
  velocity handle both follows the cursor and stays where dropped. `resize` gets no override;
  `buttonPositions` hardcodes `x = center.x - BUTTON_SPACING; y = center.y`.
- Change 2: `phantom` is assigned only in `pointerDown` (`gesture = "place"`) and updated in
  `pointerMove`'s `case "place"`. `pointerMove`'s `case "none"` never touches it — hence no ghost
  before the press. `commitPlacement()` ends with `placeType = null; phantom = null;` — hence the
  disarm after one placement.

**Godot reference** (`reference/godot/scripts/LevelEditor.gd`, read-only, never imported):
`_button_screen_pos` gives `"velocity"` an explicit `is_active → world_to_screen(_drag_world)`
branch (the cursor) and gives `"size"` a resting position at `center + (-rim_radius, 0)` with
`rim_radius ∝ size`, with no active-drag branch. The phantom state machine keeps `_phantom_pos =
mouse_world` live in `"wait_press"` (ghost before the click) and `_do_place` clears the phantom
(no repeat). `ui_cancel` cancels the phantom.

---

## Records to update as part of this change

1. **`overlay.ts`, `buttonPositions()` doc comment** — currently:
   > "Move sits ON the body; velocity sits along the (possibly live-dragged) velocity vector, or a
   > fixed offset when velocity is zero; **resize sits along the resize-drag axis**; delete sits
   > below. This is a much simpler layout than Godot's rim-distance formulas
   > (LevelEditor.gd:237-262) — a fixed compass arrangement — **deliberately**, since the exact rim
   > geometry has no gameplay consequence and a predictable fixed layout is easier for a mouse user
   > to learn than one that moves with body size."

   Two things about it. First, it is already **internally inconsistent**: it claims resize "sits
   along the resize-drag axis", which the code does not do. Second, the deliberate rationale argues
   against a handle *that moves with body size* — which is a different thing from one that follows
   the cursor *during its own drag*. So the owner's override is narrow, and the part of the decision
   that survives (fixed compass layout for move/velocity-at-rest/delete; no rim-distance formulas)
   should be kept and said so. I will rewrite the paragraph to record: what the decision was, that
   the repo owner overrode the resize half of it and why, that the Godot original already gives
   `velocity` exactly this `is_active` branch, and what still stands.

2. **`notes/T-11-DRAFT/log.md` decision #7** records "auto-selecting the newly placed object and
   opening its panel" as a deliberate simplification of Godot's auto-tool-switch. Change 2 touches
   this if Q5 is answered "do not auto-select while armed". `notes/` is a dated historical log and
   is outside my lane — **I do not propose retro-editing it.** Instead the override will be recorded
   in a doc comment next to the code in `editor.ts`. Tell me if you want it in the log instead.

3. No other comment or note records either behaviour as deliberate. I grepped the repo's markdown
   for the layout decision and found nothing else; `notes/T-11-DRAFT/log.md` decisions #8 and #9
   cover hit-radius and selected-vs-hovered, not this.

---

## Change 1 — size handle follows the cursor

### What it does, concretely

While a `resize` drag is in progress, the `⤡` button's centre is drawn at the cursor's current
position, **exact to the pixel**: the same screen point `pointerMove` was handed, round-tripped
through `renderer.screenToWorld` → `renderer.worldToScreen` (the identical round-trip the velocity
handle already makes), asserted to within < 0.5 px. It tracks from `pointerDown` onward, so there is
no frame in which the button lags the cursor. It tracks at any zoom, with the body anywhere on
canvas, and regardless of whether `size` has hit its 4–40 clamp (subject to Q2).

When **not** being dragged: 44 px left of the body's screen centre — today's position, unchanged
(this is reading (A); Q1 may change it to (B) or (C)).

### What it deliberately does NOT do — scope boundary

- Does not change the resize **math**: `resizeGrabDist`, the `0.1 * (dNow - grabDist)` sensitivity,
  the 4–40 clamp and the cubic `size → gravity` coupling are untouched. A given drag produces
  exactly the sizes it produces today.
- Does not move `move`, `delete` or `velocity`, and does not touch `buttonNamesFor` — suns still
  have no velocity handle.
- Does not port Godot's `WEIGHT_BUTTON_DISTANCE_SCALE` / `SIZE_DRAG_SENSITIVITY` rim formulas, and
  does not add a size-proportional resting position (that is option (C) only).
- Does not touch hover or selection hit radii, panning, placement, undo, save/validate, or the panel.
- Does not add touch support — the editor states "Desktop / mouse only".
- Does not change anything persisted: no `Level` field, no storage, no URL.

### Surface changed, and the pattern it follows

1. `overlay.ts` — `buttonPositions()` gains a 6th optional parameter
   `liveResizeEnd?: { x: number; y: number } | null`, **exactly mirroring** the existing
   `liveVelocityEnd` 5th parameter, consumed in `case "resize"` the same way the velocity branch
   consumes its override. No new abstraction; no churn at existing call sites.
2. `editor.ts` — `currentButtons()` passes `renderer.worldToScreen(dragWorldPt, camera)` when
   `gesture === "drag" && dragHandle === "resize"`. This needs the drag's current world point kept
   in a module-local `dragWorldPt`, set in `beginDrag`, updated in `applyDrag`, cleared in
   `pointerUp` beside the existing `resizeGrabDist = -1; dragHandle = null`. **Not a new pattern:**
   this is precisely Godot's `_drag_world`, which `_button_screen_pos` reads for its `is_active`
   branch.
3. `overlay.ts` doc comment rewritten as described under "Records to update".

### Existing users

Visual only, and only while the mouse button is held on the `⤡` handle. No saved data, no URLs, no
defaults, no keybindings. Existing custom levels load and render identically. One consequence worth
naming: mid-drag the button sits under the cursor, so a hit-test at that moment would report
`"resize"` — identical to what `velocity` already does today, and `hoveredButton` is only recomputed
in `pointerMove`'s `case "none"`, so hover state cannot change mid-drag.

### Physics

**No.** `packages/core` untouched, no simulation input changes, level solvability cannot move.

### Blast radius

- `buttonPositions` has exactly two call sites: `editor.ts:currentButtons()` and
  `test/editor-overlay.test.ts`. The new parameter is optional; no other call site changes.
- `paintEditorOverlay` consumes `overlay.buttons` positionally — no change needed.
- **The two existing resize tests** (`editor-engine.test.ts:182`, `:202`) read the resize button's
  position from the overlay *before* pressing, then `pointerMove(resizeBtn)` to establish
  `resizeGrabDist`, then `pointerMove(far)`. `resizeGrabDist` is measured from the **body anchor**,
  not from the button, so both stay valid and must pass **unchanged** — that is itself evidence the
  drag math is untouched. The undo test at `:255` (move → resize → delete) likewise.
- **Sibling sweep for the root pattern** ("a handle that does not follow its own drag"): `velocity`
  already follows; `move` is inherently at the cursor modulo its grab offset; `delete` has no drag.
  `resize` was the only remaining instance, and this closes it. **Nothing else in the repo shows the
  pattern** — I checked every entry of `HandleName` and every consumer of `buttonPositions`.

### Alternatives considered and rejected

- **Rim-distance resting position (Godot's real `size` formula)** — rejected as the primary
  implementation: it makes the handle move with body *size*, not to the cursor, so it does not
  satisfy the request as stated. Offered as Q1 option (C) only because the owner might mean it.
- **Generalising `liveVelocityEnd` into a `Partial<Record<HandleName, Vec2>>` map** — rejected:
  rewrites a working signature for no behavioural gain and risks being a parallel new pattern.
- **Changing `BUTTON_SPACING` during a drag** — rejected: it is a module constant shared by `delete`
  and the zero-velocity `velocity` fallback; it would move unrelated buttons.
- **Deriving the handle position from `size` instead of from the cursor** — rejected: `size` is
  `startSize + 0.1*(d - grabDist)` and it clamps, so it is not a bijection with cursor distance; the
  handle would visibly desync from the cursor near the clamps. Only the stashed cursor point is
  pixel-exact.

### Tests

Each new test is run against **unmodified** source first and its failure output recorded before any
implementation. Stated failure deltas below.

*`editor-overlay.test.ts`*
1. `buttonPositions(..., liveResizeEnd = {x,y})` puts the resize button exactly there (`toBeCloseTo`,
   6 dp). **Today:** extra arg ignored → button at `center.x - 44` → fails by the full drag distance.
2. The same call leaves `move`, `velocity`, `delete` at their compass positions — guards against the
   override leaking.
3. With `liveResizeEnd` null/omitted, resize is at `center.x - 44, center.y`. Passes today —
   a deliberate lock on the resting position under (A).

*`editor-engine.test.ts`*
4. **Follows the cursor:** place planet, select, `pointerDown(resizeBtn)`, `pointerMove(far)`;
   `getOverlay().buttons.find(name === "resize")` is within 0.5 px of `far`. **Today:** sits at
   `center-44`, ~250 px away → fails.
5. **Follows from the first move** (no one-frame lag): assert after the *first* `pointerMove`,
   before `resizeGrabDist` has produced any size change. **Today:** fails.
6. **REFUSAL — a velocity drag must not move the resize handle:** during a `velocity` drag, resize
   stays at `center-44`. Passes today; it exists to fail if the override is wired to the wrong branch.
7. **REFUSAL — a move drag must not pin the resize handle to the cursor:** it stays 44 px left of the
   body's *new* centre.
8. **REFUSAL — no button held, no following:** `pointerMove` far away with `gesture === "none"`
   leaves resize at `center-44`.
9. **REFUSAL — release stops the tracking** *(reading (A))*: after `pointerUp`, back at `center-44`.
   Q1 rewrites this test under (B)/(C).
10. **Clamp** (per Q2): drag past size 40 and assert the handle is still at the cursor while
    `size === 40`.
11. **Sun:** the resize handle follows for a sun too, and the sun still has no velocity handle.
12. Existing `:182`, `:202`, `:255` pass **unchanged**.

---

## Change 2 — placement ghost at the cursor, and repeat place

### What it does, concretely

**(2a) Ghost before the click.** With a place tool armed and the cursor over the canvas, the ghost
is drawn centred on the cursor and tracks every `mousemove`, *before* any button is pressed. It is
the existing `PhantomGhost` drawn by the existing `paintEditorOverlay` — same translucent circle,
same per-type radius (Q6). It disappears while the cursor is off-canvas and returns on re-entry,
with the tool still armed (Q7).

**(2b) Repeat place.** After a placement commits, the tool stays armed and a fresh ghost keeps
following the cursor, so the next click places another body of the same type. Each placement is a
full, independent body created by the existing `makeDefaultBody` at the ghost's current world
position, and each pushes its own undo entry — N clicks then N undos returns to the starting state.
Repeat mode ends on: a right-click on the canvas (Q4), Escape (already implemented), and whatever
Q3 resolves "another button is pressed" to mean.

"A copy of the object" is read as *another body of the same armed type at its default parameters* —
i.e. what the current placement path already produces — **not** a duplicate of a selected body's
edited size/velocity/gravity. That is the reading the toolbar's "Place planet" wording supports; if
the owner meant "clone the object I just tweaked", that is a different feature and I would need to
be told.

### What it deliberately does NOT do — scope boundary

- Does not change *what* a placed body is: `makeDefaultBody`, the default size, the sun's default
  gravity 1000, and the goal-index bookkeeping (`clampIndexInto`) are untouched.
- Does not clone an existing body's edited properties (see the reading above).
- Does not change the press-and-drag placement path, or the click-to-place path, or the fact that
  placement commits on mouseup.
- Does not add a toolbar "armed" indicator, a cursor change, a placement counter, snapping, a grid,
  or drag-to-place-many. "Shown at the cursor" is about *position*, not new chrome.
- Does not upgrade the ghost's artwork to the real body sprite (Q6).
- Does not add right-click behaviour anywhere except the editor canvas, and adds no other keyboard
  shortcut beyond the Escape that already exists.
- Does not touch validation, save, share, preview or undo semantics beyond one undo entry per
  placement, which is what happens today.
- Does not add touch support.

### Surface changed, and the pattern it follows

All in `editor.ts`; `overlay.ts` gets a doc-comment correction only (its `phantom` and `buttons`
comments both describe behaviour the code does not currently have).

1. **Ghost while idle** — in `pointerMove`'s `case "none"`, when `placeType` is set, assign
   `phantom = { type: placeType, x: worldPt.x, y: worldPt.y }`. This is the same assignment
   `case "place"` already performs; it is the existing pattern, and it is what the module's own doc
   comment and `notes/T-11-DRAFT/log.md` decision #7 already describe.
2. **Ghost off-canvas** — a new engine method (working name `pointerLeave()`) clears `phantom`
   while leaving `placeType` armed, wired from a `mouseleave` listener on the canvas in
   `mountEditor`. Needed because `cancelPlace()` is too strong: it also disarms the tool. The DOM
   layer already distinguishes on-canvas from off-canvas for hover (`ev.target !== canvas` when no
   gesture is active), so this follows the wiring already there.
3. **Repeat place** — `commitPlacement()` stops clearing `placeType`, and re-seeds `phantom` at the
   just-placed position so the ghost is continuous rather than blinking out for one frame. Whether
   it still sets `selectedIndex` is Q5.
4. **Ending the mode** — a `contextmenu` listener on the canvas calls `preventDefault()` (Q4) and
   `engine.cancelPlace()`; `mousedown`/`mouseup` gain an `ev.button !== 0` guard so a non-left
   button neither places nor pans; the toolbar handlers call `engine.cancelPlace()` per Q3's answer.
   Escape already routes to `cancelPlace()` and is unchanged.

### Existing users — this one does change things people rely on

- **Right-drag and middle-drag no longer pan.** Today every mouse button behaves as the left button,
  so a right-drag pans and a right-click places. The `ev.button !== 0` guard removes both. This is
  the change most likely to be noticed, and it is a direct consequence of the owner's request; it
  needs the owner's yes (Q4).
- **A place tool no longer disarms after one placement.** Someone who today clicks "Place planet",
  clicks the canvas once, then clicks the canvas again expecting to *select* a body will now place a
  second planet instead. That is the requested behaviour, but it is a real change in muscle memory,
  and it makes the "how do I stop" answer (Q3) load-bearing rather than cosmetic.
- **The browser context menu stops appearing over the canvas** if Q4 says to suppress it.
- No saved data, URL, level-format or default changes. Placed bodies are byte-identical to today's.

### Physics

**No.** `packages/core` untouched. Placement creates the same `makeDefaultBody` output it does
today, so authored levels and their solvability are unaffected.

### Blast radius

- `phantom` is read by `getOverlay()`, by `paintEditorOverlay` (the ghost), and by
  `pointerMove`'s ring suppression (`ringIndex ... && !overlay.phantom` — the selection/hover ring is
  hidden while a ghost exists). **Consequence to watch:** with a ghost now live whenever a tool is
  armed, the selection ring is suppressed for that whole time, not just during a press. Under Q5's
  "keep auto-select" reading that means a selected body shows its four handles but no ring while the
  next ghost is following. I will verify this in the browser and report what it looks like.
- `placeType` is read by `getOverlay().tool`, `getPlaceType()`, `armPlace`, `cancelPlace` and the
  `if (placeType)` early return in `pointerDown`. Keeping it armed after a commit extends the reach
  of that early return, which is exactly what makes repeat place work — and it also means the
  contextual handles cannot be clicked while armed.
- `hoverIndex` is set to `-1` in `case "place"` but is still computed in `case "none"`; with a ghost
  live in `case "none"` I will set it consistently so a hover ring does not fight the ghost.
- Existing tests that arm a tool and place (`placeAt()` helper, used throughout
  `editor-engine.test.ts`) call `armPlace` before every placement, so they are unaffected by the
  tool staying armed. `editor-fixture.test.ts` builds its level through the same helper. Both must
  pass **unchanged**; if any of them turns out to depend on the disarm, I stop and re-submit rather
  than editing the test.
- `editor-preview.test.ts` and the `requiresReset` gate are untouched: `armPlace`, `pointerDown` and
  `pointerMove` all still return early when `gated()`.

### Alternatives considered and rejected

- **A separate "repeat" toggle in the toolbar** — rejected: new chrome the owner did not ask for,
  and it adds a mode the request already defines implicitly.
- **Keeping the ghost only after the first placement** (ghost appears once you have placed once) —
  rejected: it contradicts the module's own doc comment and decision #7, and would leave part 1 of
  the request unbuilt.
- **Implementing repeat place by re-arming inside the toolbar handler** — rejected: it would place
  the logic in the DOM layer, where the engine tests cannot reach it, and duplicate state the engine
  already owns.
- **Using `pointerdown`/`pointerup` (Pointer Events) instead of the existing `mousedown`/`mouseup`**
  — rejected: it would rewrite the deliberate window-vs-canvas listener arrangement documented at
  length in `editor.ts` (the "bug 5" fix), for no benefit to this request.
- **Treating "another button is pressed" as any mouse button** — not rejected, just not chosen
  unilaterally: it is Q3.

### Tests

*`editor-engine.test.ts`* (the engine is headless and fully testable; `fakes.ts` + `makeEngine()`
already exist)
1. **Ghost appears on hover while armed:** `armPlace("planet")`, `pointerMove(p)` →
   `getOverlay().phantom` is non-null and its world position equals `screenToWorld(p)`.
   **Today:** `phantom` is `null` → fails.
2. **Ghost tracks the cursor:** two successive `pointerMove`s move the ghost to each point.
   **Today:** fails (still null).
3. **Repeat place:** arm once, then `pointerDown`/`pointerUp` at three different points → three
   bodies, all of the armed type, and `getPlaceType()` is still that type afterwards.
   **Today:** the second and third clicks place nothing (verified in the browser: object count
   stayed at 1) → fails.
4. **Ghost survives the commit:** immediately after `pointerUp`, `phantom` is non-null again.
   **Today:** `commitPlacement` nulls it → fails.
5. **Undo:** three repeat placements then three undos returns to the starting body list.
6. **REFUSAL — right-click does not place:** with a tool armed, a right-button press/release places
   nothing and disarms. **Today:** it *places* (verified in the browser, 2 → 3) → fails.
7. **REFUSAL — a disarmed editor shows no ghost:** after `cancelPlace()`, `pointerMove` produces
   `phantom === null` and places nothing on click.
8. **REFUSAL — Escape ends the mode:** after Escape, a canvas click selects/pans instead of placing.
9. **REFUSAL — no ghost while the preview gate is up:** with `requiresReset` true, arming and moving
   produces no ghost and no placement (the `gated()` early returns must still hold).
10. **REFUSAL — the ghost does not place by itself:** N `pointerMove`s with no press create zero
    bodies.
11. **REFUSAL — off-canvas hides the ghost but keeps the tool armed** (Q7): `pointerLeave()` →
    `phantom === null`, `getPlaceType()` unchanged, and a later `pointerMove` brings the ghost back.
12. **Ending via "another button"** — one test per behaviour Q3 selects; written once Q3 is answered.
13. Existing placement tests across `editor-engine.test.ts` and `editor-fixture.test.ts` pass
    **unchanged**.

### How the two changes fit together

**They share a theme but not a code path, and I checked rather than assumed.**

- Shared: both are *presentation driven by live pointer position* surfaced through the same
  `EditorOverlay` contract, and both add a small piece of "what the pointer is currently doing" to
  the engine — Change 1 a stashed drag world point, Change 2 a stashed hover ghost. Both edit
  `pointerMove`'s `switch (gesture)` and both land in `editor-engine.test.ts`.
- Disjoint: Change 1 touches **only** the `gesture === "drag"` arm and `currentButtons()`'s
  `dragHandle === "resize"` branch. Change 2 touches **only** the `"none"` and `"place"` arms,
  `commitPlacement`, and the DOM listeners. Neither reads the other's state.
- **The one place they could have collided, and why they cannot:** `pointerDown` tests
  `if (placeType)` **before** any contextual-handle hit-test and returns. So while a place tool is
  armed — which, after Change 2, is most of the time during authoring — the resize handle cannot be
  grabbed at all, and Change 1's code path is unreachable. The two modes are mutually exclusive by
  construction, not by luck. The verification matrix has an explicit interleaved case for this:
  arm → place → place → Escape → select → resize-drag, all in one session.
- Because they are disjoint, I intend **separate commits** on the one branch, each with its own
  tests passing, so you can review or revert them independently.

---

## Verification matrix (both changes)

| What | How | Expected |
|---|---|---|
| Unit + integration | `npm test` | still **56 files** (tests added to existing files), 847 + N passed, 1 skipped; I report N and the exact tail |
| New tests genuinely cover the change | each run against unmodified source first | recorded failure output quoted in my report |
| Types | `npm run typecheck` | clean |
| Format | `npm run lint` | clean |
| Bundle | `npm run build -w @swingby/web && npm run size` | baseline 40.55 KB gzip; I report the measured number, not "unchanged" |
| **C1 — real pointer drag, desktop** | Chromium, `/editor` @ 1280×900, real press-drag-release on `⤡`; handle centre found by scanning live canvas pixels | within a few px of the cursor at 3 sampled points mid-drag; before/mid/after screenshots |
| **C1 — zoom** | same, after wheel zoom in and out | tracks the cursor at both zooms |
| **C1 — body near the canvas edge** | same, body in a corner | tracks; no clamping to the body |
| **C1 — velocity handle unchanged** | same harness | still lands exactly on the cursor and stays after release |
| **C1 — move drag / pan unchanged** | same harness | body follows the cursor with its grab offset; pan still pans |
| **C2 — ghost before the click** | arm each of the three Place buttons, hover without pressing | ghost visible at the cursor for each type; screenshot per type |
| **C2 — ghost tracks** | move along a path | ghost follows; no lag frame after the commit |
| **C2 — repeat place** | arm once, click 4 times at 4 points | 4 bodies at those points; panel object count 4 |
| **C2 — right-click ends it** | right-click on canvas | mode ends, nothing placed, and (Q4) no native context menu |
| **C2 — Escape ends it** | Escape | mode ends |
| **C2 — "another button"** | per Q3's answer | mode ends |
| **C2 — off-canvas** | move onto the panel and back | ghost hidden then restored, tool still armed |
| **C2 — right/middle drag no longer pans** | right-drag the canvas | no pan (the accepted cost of Q4) |
| **Interleaved** | arm → place → place → Escape → select a body → resize-drag it | both behaviours work in one session; no state leaks between them |
| **Mobile-layout viewport** | 360×740 (the editor's stacked layout), mouse events only | no layout-dependent breakage. I will **not** claim touch — the editor states mouse-only |
| Undo | in-app | size restored; N repeat placements undo in N steps |
| Preview gate | in-app | with the preview advanced, no ghost, no placement, no handle drag |

---

## Risks

1. **Q1 and Q3–Q5 are blocking.** I will not start the parts that depend on them.
2. **Q4 removes right-drag panning.** The most likely source of "you changed something I used".
3. **(B) for Q1 is not cheap** — per-body offsets cannot be keyed by index because delete and undo
   re-clone the bodies. If the owner picks (B) I re-scope before implementing rather than improvise.
4. **The selection ring is suppressed whenever a ghost exists** (`!overlay.phantom`). Change 2 makes
   ghosts long-lived, so the ring is suppressed for much longer than before. Called out under blast
   radius; I will look at it in the browser and report before treating it as acceptable.
5. **Unrelated pre-existing observation — reported, not fixed, not in scope:** the editor canvas
   grows from 686 px to 810 px tall the first time a body is selected (the properties panel gains
   content and the page starts scrolling), shifting everything on canvas down by ~62 px. It cost me
   my first drag attempt — I pressed at stale coordinates, missed every handle and started a pan. It
   is not part of either request; flagging in case the owner has seen it as jitter.

---

## Status

Plan submitted. **No implementation code written.** Awaiting: the owner's answers to Q1–Q5, and your
GO / REVISE / REJECT. On GO I implement exactly this, in two separate commits, and stop and
re-submit if the code disagrees with the plan.
