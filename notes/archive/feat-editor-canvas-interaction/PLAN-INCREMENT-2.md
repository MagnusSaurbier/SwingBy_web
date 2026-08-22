# Plan increment 2 — derived resting position, and the 2b finding

Supersedes `PLAN-INCREMENT-1.md` (stored offset). **No code written.** The spike used to observe the
new rule was built in a **copy of the repo outside the tree** (`scratchpad/spike`, its own vite on
:5200) precisely so no spike lands in the branch; the working tree is clean at `8e66a37`.

---

## Part 1 — Change 2b: your reading is right, and it is **zero work**

Checked against the code, and I can settle the one you flagged rather than punting it.

| Owner's clause | Status |
|---|---|
| "show the object while dragging (or moving) from the selection button to where it's placed" | **built** — `1f48723`, verified |
| "deselect after first place automatically" | **already true** — `commitPlacement()` ends `placeType = null; phantom = null` |
| "No need for rebinding of any clicks or anything" | **nothing to build** |
| "And show the selected item's button as right now" | **nothing to build** — see below |

**The ambiguity resolves, on evidence.** You asked whether "deselect" might mean the newly placed
*object* is no longer auto-selected. It does not, and the deciding evidence is the clause you
suspected might bear on it. **The toolbar Place buttons have no selected-state styling of any
kind** — no class toggle, no `aria-pressed`, nothing driven by `getPlaceType()`; `updateToolbarState()`
only ever toggles `disabled`. So "show the selected item's button as right now" cannot be describing
a toolbar button state, because there is no such state to preserve. The only "button" that a
*selected item* has, and that is shown "right now", is its on-canvas contextual handle set — which
exists **because** `commitPlacement()` sets `selectedIndex = bodies.length - 1`. Reading it as "keep
auto-selecting the placed object" makes the clause meaningful; reading it as "stop auto-selecting"
makes the owner's own sentence self-contradicting.

That also leaves `notes/T-11-DRAFT/log.md` decision #7 ("auto-selecting the newly placed object and
opening its panel") intact rather than silently reversed.

So: **2b is complete as of `1f48723`.** If the owner did mean the opposite, it is one line in
`commitPlacement` — I would rather be told than guess, but I do not think this is a guess.

---

## Part 2 — the derived resting position

Rule: on release the handle rests at **distance derived from `size`**, in the **direction from the
body toward the screen centre** (in world terms, toward `camera.x/y` — `worldToScreen` maps the
camera position to the viewport centre).

### 2.1 The edge cases from increment 1 are now impossible by construction

Worth recording, as you asked. The position becomes a **pure function of `body.x`, `body.y`,
`body.size` and the camera**, all of which the overlay already receives. There is no stored state,
so there is nothing to key, invalidate or orphan:

| Case from increment 1 | Now |
|---|---|
| Undo re-clones every body (`bodies = snap.bodies`) | **impossible** — nothing keyed to identity; the restored body's `size` gives the position |
| Delete this body / a different body | **impossible** — no entry to orphan or shift |
| `pushHistory()` cloning into the stack | **impossible** — nothing to disturb |
| Panel `setSelectedSize` edit | **automatically correct** — position tracks `size` by definition |
| Deselect / reselect, reload | **impossible** — no session state to lose; a fresh engine renders identically |
| Redo | still n/a (no redo exists) |
| Anything persisted | **none.** `types.ts` untouched, `toLevel()`/`serialize()`/storage untouched |

The `WeakMap`, and the whole "how do we get identity without an id on a frozen type" problem, is
**deleted**, not solved.

### 2.2 Units — numbers, then a recommendation, and I am not picking

First, a **correction to a premise in your message**, because it was load-bearing. "World units …
sits exactly on the body's rendered rim, since the rendered radius *is* `size * zoom`" is true for
**suns only** (`drawSun`: `radius = worldRadius * zoom`). A **planet** draws at
`Math.max(6, size * 2.3 * zoom)` (`render/bodies.ts:64`) — 2.3× further out — and the **player** is a
sprite at `ROCKET_SCALE * zoom`. So the "lands on the rim" argument does not hold for two of the
three body types, and cannot carry the decision.

Relevant thresholds, from the code: `hitTestButtons` returns the **first** button within
`BUTTON_RADIUS + pad = 20` px, scanning in order **move, velocity, resize, delete** — so a resize
handle within 20 px of the move or velocity centre is **unclickable**, not merely crowded. Visual
overlap starts below 32 px (2 × `BUTTON_RADIUS`). Zoom range is **0.12 … 5.0**; `size` clamps to
**4 … 40**; the canvas half-width at a 1280 viewport is ≈ 510 px.

Screen distance at the four corners, for the three candidate readings:

| Reading | size 4, zoom 0.12 | size 40, zoom 0.12 | size 4, zoom 1 | size 40, zoom 1 | size 4, zoom 5 | size 40, zoom 5 |
|---|---|---|---|---|---|---|
| **A** — `size` in screen px | 4 ✗ | 40 ✓ | 4 ✗ | 40 ✓ | 4 ✗ | 40 ✓ |
| **B** — `size` in world units (`size·zoom`) | 0.48 ✗ | 4.8 ✗ | 4 ✗ | 40 ✓ | 20 ✗ | 200 ✓ |
| **C** — Godot's rim (`size·5·zoom`) | 2.4 ✗ | 24 ✗ | 20 ✗ | 200 ✓ | 100 ✓ | 1000 ✗ off-canvas |

✗ = unclickable (≤ 20 px from move) or off-canvas. **Every pure reading fails somewhere**, because
`size` spans 10× and `zoom` spans 42×, so any world-space reading spans 417× while the usable
screen band is roughly 32–500 px. Reading A additionally makes the handle **zoom-invariant**, which
contradicts "behave like the speed selector" — velocity is world-space and scales with zoom.

**There is, however, a non-arbitrary scale factor, and it falls out of the drag maths rather than
taste.** The drag sets `size = startSize + 0.1 · (d_now − d_grab)` in world units
(`SIZE_DRAG_SENSITIVITY = 0.1`, matching Godot). Ask for the resting distance `D = k · size` that
makes "the handle's length **is** the size property" *self-consistent with dragging* — i.e. grabbing
the handle at its resting spot and dragging leaves it exactly at the new resting spot on release, so
the snap only ever rotates and never jumps radially. Substituting `d_grab = k·startSize` and
requiring `d_now = k·size_new`:

```
size_new = startSize + 0.1·(k·size_new − k·startSize)   ⟹   k = 1 / 0.1 = 10
```

**k = 10** is the unique solution. Godot's `WEIGHT_BUTTON_DISTANCE_SCALE = 0.5` is exactly a
deliberate halving of this (`0.5 / 0.1 = 5`), which is why its handle moves at half the drag rate.
With k = 10 the owner's two clauses become *literally simultaneously true*: the handle keeps "the
length it was drawn to" **and** "the length of that vector is the size property".

Screen distance under **k = 10** (`size · 10 · zoom`):

| | size 4 | size 10 (default) | size 40 |
|---|---|---|---|
| zoom 0.12 | 4.8 ✗ | 12 ✗ | 48 ✓ |
| zoom 0.5 | 20 ✗ | 50 ✓ | 200 ✓ |
| zoom 1 | 40 ✓ | 100 ✓ | 400 ✓ |
| zoom 5 | 200 ✓ | 500 ~edge | 2000 ✗ |

Good across the middle, still degenerate at min zoom and off-canvas at max. Note the extremes are
largely unreachable *by dragging* — at zoom 5 you would have to drag 2000 px to reach size 40 — so
they are only hit via the panel's Size field. That limitation already exists today and is not a
regression.

**Recommendation, for the owner to confirm — I am not implementing a choice:** **k = 10**, with the
screen distance **clamped to [44, 45 % of the smaller canvas dimension]**. 44 is today's
`BUTTON_SPACING`, so the handle is never closer than it is today and never becomes unclickable; the
upper clamp keeps it on canvas. Inside the clamp the owner's rule holds exactly. **The clamp is the
part that needs the owner's yes**, because it makes the stated rule false at the two extremes —
exactly the kind of scale-factor concession you predicted Godot had needed.

### 2.3 The degenerate case

`len = 0` when the body sits exactly at the camera centre. **Fallback: direction `(-1, 0)`, straight
left** — the same direction as today's compass position and as Godot's `center + (-rim_radius, 0)`,
so the fallback is continuous with the existing look. Explicitly tested for a finite, non-`NaN`
position, because a `NaN` would propagate into `hitTestButtons` (`Math.sqrt(NaN) <= 20` is false, so
the handle would silently become unclickable rather than throwing).

**Also a near-degenerate hazard, which the rule as stated does not cover:** just *near* the centre
the direction is numerically stable but perceptually violent — a one-pixel body move can swing the
handle through a large angle, and crossing the centre flips it 180°. I propose treating "within a
small epsilon of the centre" as the degenerate case too, and will report how it looks.

### 2.4 What it actually looks like — observed, not predicted

Spike built out of tree, real `/editor` in Chromium at 1280×900, planet at default size 10.

**Finding 1 — panning mostly cannot re-orient the handle, because panning deselects.** A pan drag
starts on empty canvas, and `pointerDown` sets `selectedIndex = -1` before `gesture = "pan"`. So the
handles vanish the moment a pan begins. Re-orientation is therefore visible almost entirely through
**moving the body** and through **zooming** (the wheel does not deselect). Worth knowing: the
scenario you asked me to watch for is largely unreachable by the route you named.

**Finding 2 — the handle collides with the *fixed* compass buttons in two of four directions, and
loses the hit-test.** Screenshots `S-0`, `T-1`, `T-2`:

- Body **above** the screen centre → handle points **down**, landing ~25 px above the **delete**
  button and ~25 px below **move**: three buttons stacked within 45 px, all overlapping (`S-0`).
- Body **left** of the screen centre → handle points **right**, landing **almost exactly on the
  velocity handle**, which rests at a fixed `center + 44` when velocity is zero (`T-1`). Because
  `hitTestButtons` checks **velocity before resize**, the resize handle is then **unclickable** —
  the user cannot grab it to resize again.
- Body **below** the centre → handle points **up**; clean, no collision (`T-2`).

This is inherent to mixing a *rotating* handle with three *fixed* compass handles, so it is not
fixed by the scale factor and it is not something I should design around unilaterally. **It needs
the owner**, and the cheap options are: (a) accept the overlap; (b) reorder `hitTestButtons` so
resize is tested before velocity/delete, which makes it grabbable while still overlapping; or (c)
give the rotating handle a minimum angular clearance from the fixed ones. I recommend (b) as the
minimal change that removes the *functional* failure while leaving the visual one for the owner to
judge — but I am not building any of them without a decision.

### 2.5 Surface, tests, verification

**Surface.** `overlay.ts` only, for the position: the `case "resize"` else-branch computes the polar
position from `body`, `camera` and the clamp constants — no new parameter, no engine state, and
`liveResizeEnd` (from `e04e683`) keeps its meaning for the during-drag case. `editor.ts` needs **no
change at all** for this increment. Plus the doc-comment record updated again to state the final
rule and that it superseded both the fixed compass and the stored-offset designs.

**Tests** (failing-first output recorded for each):
1. Handle rests at distance `k·size` (clamped) from the body, direction toward the camera centre —
   asserted as an angle and a magnitude, at three body positions around the centre.
2. Rotates as the body moves across the centre — including the 180° flip.
3. Scales with zoom, cross-checked against the velocity handle in the same test.
4. Tracks a panel `setSelectedSize` edit with no drag at all.
5. Survives undo/delete-other/deselect-reselect **because it is derived** — one test asserting the
   position is identical before and after each, with no session state involved.
6. **Degenerate:** body exactly at the camera centre → finite position, direction `(-1, 0)`, and
   `hitTestButtons` still finds it. Explicit `Number.isFinite` assertions on both components.
7. Clamp low and clamp high both bite at the stated thresholds.
8. **REFUSAL — nothing persisted:** `toLevel()`/`serialize()` unchanged apart from `size`/`gravity`.
9. **REFUSAL — the during-drag behaviour is untouched:** the `e04e683` tracking tests still pass, and
   a drag still ends with the handle under the cursor *before* the release snap.
10. **Right-click, as you asked:** a source-text assertion that the editor's pointer handlers contain
    **no `ev.button` filter**, commented as the owner's deliberate decision of 2026-08-20 (panning
    kept, right-click cancel declined) so a later "cleanup" trips a test. Paired with a Playwright
    check that right-drag pans and right-click places. Flagged again for the record: **this test
    passes today without any change** — it documents a decision rather than covering a fix, and it
    exists only because you asked for the decision locked down.

**Verification.** All four gates with the numbers I watch, plus the real `/editor` at 1280×900 and
360×740: rest position at three body positions around the centre, at three zooms, the flip across
the centre, the degenerate case, both clamps, and a re-drag *after* a snap (the case where the
collision would bite) — per-sample pixel deltas, not pass/fail.

---

## Open questions for the owner

1. **The clamp.** k = 10 with screen distance clamped to [44 px, 45 % of the smaller canvas
   dimension]. Confirm — inside the clamp the rule holds exactly; outside it the stated rule is
   knowingly violated to keep the handle clickable and on-screen.
2. **The collision** (§2.4 finding 2). Accept the overlap, reorder the hit-test so resize wins, or
   require angular clearance?
3. **Near-centre jitter** — treat "within epsilon of the centre" as degenerate (handle parks left),
   or let it swing freely?

**Status: awaiting GO. No code written.** Nothing is blocked on these except the resting position
itself; the right-click test can proceed independently on your word.
