# Plan increment 1 — size-handle resting position (owner chose "stay where dropped")

Scope: **`feat/editor-canvas-interaction` only.** Change 1's during-drag mechanism (`e04e683`) and
Change 2a (`1f48723`) are unaffected and stay as merged-ready. No code written for this increment.

---

## First: the question numbers do not line up, and that could cost a build

Your verdict message uses different numbers from the ones in `PLAN.md`. Mapping, so nobody acts on
the wrong item:

| Your message | `PLAN.md` | Subject | State |
|---|---|---|---|
| "Q4 — size handle after release" | **Q1** | where the handle rests after release | **answered: (B) stay where dropped** |
| — | Q2 | tracking past the 4–40 clamp | answered by you: keeps tracking. Built, tested |
| "Q5 — still open" | **Q3** | what ends repeat-place mode | open |
| "Q6 — right-click" | **Q4** | right-click / panning | **answered: keep all panning** |
| "Q7 — still open" | **Q5** | auto-select each repeat placement | open |
| — | Q6 | ghost artwork (reuse existing) | you accepted the default; built |
| — | Q7 | ghost hidden off-canvas, tool stays armed | you accepted the default; built |

Note `PLAN.md`'s Q6 and Q7 are *already-accepted defaults that are built*, while your message uses
"Q6"/"Q7" for right-click and auto-select. Below I use descriptions, not numbers. Worth fixing on
your side before the owner's next answer arrives against a third numbering.

---

## What changes, concretely

The resize handle's resting position stops being a fixed compass offset and becomes **the point the
last resize drag ended at, remembered per body, in world space**, so that:

- release leaves the handle exactly where the cursor let go (< 0.5 px);
- moving the body carries the handle with it;
- zooming and panning scale/translate it exactly as they do the velocity handle;
- a body that has never been resize-dragged keeps **today's** position, `center.x - BUTTON_SPACING`,
  `center.y` — stated explicitly, not implied.

### World space, not screen pixels — and why that is the existing pattern, not a new one

The remembered value is a **world-space offset from the body**, `{dx, dy}`, painted at
`worldToScreen(b.x + dx, b.y + dy)`. Screen-space pixels would pin the handle at a constant on-screen
distance regardless of zoom, which is *not* what the speed selector does: velocity rests at
`worldToScreen(b + vel*100)`, so it scales with zoom and rides along on pan and on a move-drag. World
space reproduces that exactly.

This also produces a discontinuity — an undragged body's handle is zoom-invariant, a dragged one's
scales with zoom — and that is worth stating because it is **precisely the velocity handle's own
existing behaviour**: zero velocity gives a fixed `center.x + BUTTON_SPACING` screen offset, nonzero
velocity gives a world-scaled position. Same shape, same file, same reasoning.

### Keying: `WeakMap<Body, {dx, dy}>` — identity, no invented id

You asked how identity is obtained given `types.ts` is FROZEN and no id field is available. It is
not needed: the `Body` objects in the engine's `bodies` array **are** the identity, and a
`WeakMap` keyed on the object reference gives a stable binding with no invalidation bookkeeping and
no leak (a deleted body's entry becomes unreachable and is collected).

I checked what each operation does to those references rather than assuming:

- `pushHistory()` pushes `cloneBodies(bodies)` into the undo stack — the **live** objects are not
  replaced, so taking a snapshot does not disturb any offset.
- `deleteAt()` does `bodies.splice(index, 1)` — the surviving objects keep their references, so
  deleting one body does not disturb any other body's offset. (Index keying would get this wrong,
  which is why I am not using it.)
- `undo()` does `bodies = snap.bodies`, i.e. **every** body becomes a fresh clone. All identities are
  lost at once, so **undo resets every remembered offset to the default.** That is a real consequence
  and I am not hiding it: see the table below and the test that pins it.
- panel edits (`setSelectedSize` etc.) and move-drags mutate in place — identity survives.

### Behaviour table — every case you asked for

| Event | Offset |
|---|---|
| Resize drag released | **set** to the drop point (world offset from the body) |
| Body move-dragged | **moves with the body** (offset is relative, so the handle rides along) |
| Zoom | **scales** with zoom, like the velocity handle |
| Pan | **translates** with the body, like every other handle |
| Deselect and reselect | **persists** — keyed to the body, not to the selection |
| New Size typed into the panel | **persists** — under (B) the resting position no longer encodes size at all, which is the trade the owner accepted |
| Delete a **different** body | **persists** (splice preserves references) |
| Delete **this** body | entry becomes unreachable; if a later undo restores the body it is a clone, so it comes back at the default |
| **Undo** (any undo, not just of a resize) | **resets to default for every body** — `undo()` replaces the whole array with clones |
| **Redo** | n/a — there is no redo in this editor (`history.ts`: "No redo — not required by the task doc") |
| **Reload** | **resets to default.** The `WeakMap` lives inside one `createEditorEngine` closure; a reload builds a new engine |
| Body never resize-dragged | **default**: `center.x - BUTTON_SPACING`, `center.y` — today's position, unchanged |

**Confirmed: nothing is persisted.** No new field on `Body` (`types.ts` FROZEN, untouched), nothing
in `toLevel()`, nothing in `serialize()`, nothing written through `storage`. A test asserts the
serialized level is byte-identical before and after a resize drag apart from the `size`/`gravity`
the drag legitimately changed.

### Surface

1. `overlay.ts` — the 6th parameter added in `e04e683` is **renamed** `liveResizeEnd` → `resizeEnd`
   and its doc widened: "where the resize handle sits — the live cursor during its own drag, or the
   remembered drop point afterwards; null → the default compass position". No new parameter. The
   asymmetry with velocity (whose resting position `buttonPositions` derives itself from the body's
   own vector, while resize's must be supplied because it lives in engine state) is documented in
   place, because it is the one thing a reader will trip on.
2. `editor.ts` — a `WeakMap<Body, {dx, dy}>`; written in `pointerUp` when the released drag was a
   resize (from the final `dragWorldPt`, which already exists); read in `currentButtons()` when no
   resize drag is in progress. `dragWorldPt` keeps its current role unchanged.
3. `overlay.ts` doc comment — extended to record that the owner also overrode the *resting* half of
   the original fixed-compass decision, so the record stays accurate rather than half-updated.

### Blast radius

Unchanged from the original plan, plus: `currentButtons()` now reads the map on every frame for the
selected body only (one `WeakMap.get`, no allocation). `hitTestButtons` consumes the same array, so
the handle is grabbable wherever it now rests — which is the point. Nothing else reads the map.

---

## Tests

### Which existing tests change

- **Overlay test 3** ("rests at the fixed compass position when no live drag point is given") —
  **kept as-is.** It still describes the truth at the `buttonPositions` level: null → compass
  default. Only its parameter name changes.
- **Engine test 9** ("REFUSES to keep following once the drag is released") — **inverted, not
  deleted, and it keeps a real refusal.** New form: after `pointerUp` the handle is still within
  0.5 px of the drop point (the (B) behaviour), **and** subsequent `pointerMove`s with no button
  held do not move it — the "refuses to track an unpressed cursor" half survives intact and is the
  part that would catch the plausible bug (leaving the live-tracking branch armed after release).
- **Engine test 8** ("REFUSES to follow a cursor with no button held") — kept; it now covers a body
  that has never been dragged, i.e. the default position.
- Everything else in `e04e683` and `1f48723` is untouched.

### New tests

Failing-first output recorded for each before implementing, as usual.

1. Handle rests at the exact drop point after release (< 0.5 px). *Fails today: snaps back to
   `center-44`.*
2. Remembered position **moves with the body** on a subsequent move-drag.
3. Remembered position **scales with zoom** — assert the body→handle screen distance changes by the
   zoom ratio, and cross-check it against the velocity handle's behaviour in the same test so the
   claim "like the speed selector" is asserted, not just asserted-about.
4. Survives deselect → reselect.
5. Survives a panel `setSelectedSize` edit.
6. Survives deleting a **different** body.
7. **Resets to default after undo** — pins the consequence of `undo()` re-cloning, so it is a
   documented decision rather than a surprise.
8. A second body that was never dragged still gets the default position.
9. **REFUSAL — nothing reaches the saved level:** `toLevel()`/`serialize()` after a resize drag
   differs only in `size`/`gravity`; no handle data anywhere.
10. **REFUSAL — reload semantics:** a freshly constructed engine over the same bodies has every
    handle at the default (proves the map is engine-scoped, not global or persisted).

---

## Right-click / panning — owner said keep everything as it is

Nothing to implement: no `ev.button` guard, no `contextmenu` listener, no context-menu suppression,
Escape stays the cancel route. The "existing users lose right-drag panning" regression is gone from
this branch entirely.

**On pinning that decision with a test — the honest problem, and the repo's own answer.** The
planned "right-click does not place" test cannot simply be inverted into an engine test, because
**the engine has no concept of mouse buttons at all**: `pointerDown(screenPt)` takes a point. Button
handling lives in `mountEditor`'s DOM listeners, and `mountEditor` has **zero unit-test coverage** —
there is no jsdom in this project (`AGENTS.md`; `grep mountEditor` across every `*.test.ts` returns
nothing).

The repo already has an established pattern for exactly this situation: `ui-toggle-css.test.ts` and
`hud-css.test.ts` assert on **literal source text** for behaviour that cannot be unit-tested here,
paired with real Playwright verification. So I propose the same two-part shape:

- a source-text assertion that the editor's pointer handlers contain **no `ev.button` filter**, with
  a comment naming this as the owner's deliberate trade (panning kept, right-click cancel declined)
  so a future "cleanup" that adds the guard trips a test instead of silently reversing an owner
  decision;
- a Playwright check that a right-drag still pans and a right-click still places.

I want this called out rather than slipped in: **that test passes today without any change.** It
documents a decision rather than covering a fix, which is normally a refusal ground in `AGENTS.md`,
and it is only justified here because you explicitly asked for the decision to be locked down. If
you would rather not carry a characterization test on this branch, say so and I will drop it — the
decision then lives only in the plan record.

---

## Still open / not in this increment

- What ends repeat-place mode, and whether each clone is auto-selected — with the owner; **Change 2b
  is not built and moves to `feat/editor-preview`.**
- The pre-existing bugs in `RESULTS.md` (dead Undo button, canvas resize-on-select shift, player
  ghost radius) stay reported and unfixed.

## Verification matrix for this increment

The one from `PLAN.md`, plus: release-and-release-again at three zooms; handle position after a
move-drag; after a pan; after undo; after reload — each checked in the real `/editor` in Chromium
with the ring-fit detector and screenshots, at 1280×900 and 360×740, and reported with per-sample
pixel deltas rather than pass/fail. All four gates re-run and reported with the numbers I watch.

**Status: awaiting GO. No code written for this increment.**
