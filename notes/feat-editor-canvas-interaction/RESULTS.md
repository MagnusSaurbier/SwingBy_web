# Results — Change 1 and Change 2a implemented, verified, pushed

Branch `feat/editor-canvas-interaction`. Two commits, independently reviewable/revertible:

| Commit | Change |
|---|---|
| `e04e683` | **C1** feat: size handle tracks the cursor for the duration of its own drag |
| `1f48723` | **C2a** fix: draw the placement ghost from the moment a tool is armed |

**Change 2b (repeat place) is NOT implemented**, as instructed. `commitPlacement()` still disarms on
commit, and `1f48723` adds a test pinning that so the change is deliberate when 2b lands.

## Gates — numbers I watched

| Gate | Baseline (`main`) | Now | |
|---|---|---|---|
| `npm run typecheck` | clean | clean | ✅ |
| `npm test` | 56 files, 847 passed, 1 skipped | **56 files, 867 passed, 1 skipped** | ✅ +20 |
| `npm run lint` | clean | clean | ✅ |
| `npm run size` | 40.55 KB gzip | **40.65 KB gzip** (PASS, 209.35 KB under budget) | ✅ +0.10 KB |

No new test files — 11 tests added to the C1 commit, 9 to the C2a commit, in the two existing
editor test files. All pre-existing editor tests pass unchanged; none was edited or weakened.

## Failing-first output, recorded before implementing

**C1** — 6 of the 11 new tests failed against unmodified source. The 4 refusal tests passed before
the change by design (they exist to fail if the override is wired to the wrong `dragHandle`), and
the release test failed on its own positive precondition:

```
× buttonPositions — resize live-drag override > puts the resize button exactly at the live drag point
  AssertionError: expected 436 to be close to 123.5, received difference is 312.5
× ... > sits on the cursor from the very first move, before any size change
  AssertionError: expected 69.46221994724903 to be less than 0.5
× ... > tracks the cursor exactly for the whole drag
  AssertionError: expected 286.5309756378881 to be less than 0.5
× ... > keeps tracking the cursor after size has clamped at its maximum
  AssertionError: expected 956 to be less than 0.5
× ... > follows the cursor for a sun too, which still has no velocity handle
  AssertionError: expected 189.73665961010278 to be less than 0.5
× ... > REFUSES to keep following once the drag is released
  AssertionError: expected 272.9468812791236 to be less than 0.5
```

**C2a** — 6 of the 9 new tests failed against unmodified source:

```
× shows a ghost at the cursor as soon as a tool is armed and the pointer moves   expected null not to be null
× tracks the cursor across successive moves, for every placeable type            expected null not to be null
× hides the ghost off-canvas but keeps the tool armed, and restores it on re-entry
                                                        TypeError: engine.pointerLeave is not a function
× does not drop a press-and-drag placement when the pointer leaves the canvas mid-gesture
                                                        TypeError: engine.pointerLeave is not a function
× REFUSES to show a ghost once placement is cancelled, and places nothing on the next click
                                                                                 expected null not to be null
× REFUSES to show a ghost while the preview gate is up                           expected null not to be null
```

## Browser verification — real `/editor`, real mouse

Headless Chromium via preinstalled Playwright (`playwright install` never run), driving the shipped
`/editor` route. Handle positions measured with a Hough-style ring detector (score every candidate
centre in a small window by how many 16px-radius ring pixels fit it) rather than a pixel centroid —
a centroid is dragged up to ~10px off by the velocity arrow or the gravity ring crossing a button,
and that produced false failures in an earlier version of the harness.

**Desktop 1280×900 — 24/24 checks pass.**

| Check | Result |
|---|---|
| Ghost at cursor before any click, for planet / sun / player | PASS (3 screenshots) |
| Ghost tracks the cursor | PASS |
| Ghost hidden off-canvas; restored on re-entry; tool stays armed; nothing placed | PASS |
| Escape clears the ghost | PASS |
| No ghost painted during a running preview | PASS |
| Resize handle at its resting compass offset when idle (3 zooms) | PASS |
| **Resize handle on the cursor mid-drag, zoom 1×** | PASS — **2.83 / 3.16 / 2.83 px** |
| **zoomed in (3 wheel steps)** | PASS — **2.83 / 2.83 / 3.16 px** |
| **zoomed out (5 wheel steps)** | PASS — **2.82 / 3.61 / 3.16 px** |
| **body near the canvas edge** | PASS — **2.83 / 2.82 / 3.16 px** |
| Resize handle stops following on release (3 zooms) | PASS |
| **Velocity handle unchanged (the control — untouched code)** | PASS — **2.82 / 2.83 / 3.61 px** |
| Move drag still works | PASS |
| Pan still works | PASS |
| Interleaved: arm → ghost → place → Escape → select → resize-drag | PASS — 2.83 / 3.61 / 2.24 px, 1 object |

On the measurement floor, honestly: every handle measures ~2.2–3.6 px from the cursor, **including
the velocity handle, whose code I did not touch and which is the owner's own reference for correct
behaviour**. That uniform offset is the harness's floor (canvas/CSS scale mapping plus ring-fit
granularity), not a per-handle error. The tolerance is set at 5 px on that basis, and the raw
per-sample numbers are above rather than a bare pass/fail.

**Mobile layout 360×740** — mouse events only; the editor states "Desktop / mouse only" and I make
no touch claim. Positive tracking passes at **2.0–3.0 px** at 1× and zoomed out, near the edge, and
interleaved. The automated *negative* checks and one zoomed-in case reported failures that turned
out to be harness artifacts on the small canvas — the colour filter picks up background stars, and
scaled drag targets can leave a 336px-wide canvas — so I verified those four cases **visually**
instead, which is stronger evidence than the detector:

- ghost visible while armed → gone after the cursor leaves the canvas (`N-1`, `N-2`)
- gone after Escape (`N-3`)
- gone during a running preview (`N-4`)
- after releasing a resize drag, all four handles are back in their compass arrangement and nothing
  remains at the drop point (`R2-after`)
- zoomed-in mid-drag, the ⤡ handle sits exactly on the cursor at page (134, 375) vs cursor
  (134.4, 375.2) (`R3-middrag`)

## The blast-radius item you asked me to watch

**It does not materialise, and here is why rather than "it looked fine".** The selection ring is
suppressed while `phantom` exists (`ringIndex >= 0 && ... && !overlay.phantom`), and C2a does make
ghosts long-lived. But `armPlace()` already sets `selectedIndex = -1`, and C2a's `case "none"` also
clears `hoverIndex`/`hoveredButton` while armed — so while a place tool is armed there is no
selection and no hover, hence no ring to suppress. Confirmed on screen: an armed ghost renders over
an empty selection, and the ring/handles return the moment the tool disarms on commit.

Worth flagging forward: this stops being true the moment **2b** lands, because then a body is
selected *and* a ghost is live at the same time. Whether the placed body stays selected under repeat
mode is exactly open question Q5, so the two are the same decision.

## Pre-existing bugs found, reported, NOT fixed

1. **The Undo toolbar button never re-enables.** `updateToolbarState()` is called only at mount, at
   the end of the Share flow, and on preview enter/reset — never from `refreshPanel()` or any
   pointer handler. So `undoBtn` stays `disabled` from load onward and undo is unreachable from the
   UI, even though the engine's undo works (its tests pass). Measured on unmodified behaviour:
   `at load: disabled`, `after placing one object: disabled`, `after placing two objects: disabled`.
   It is in my lane's file but in neither approved change, so I left it. `git diff main` for
   `editor.ts` contains zero occurrences of `updateToolbarState`, i.e. my commits do not touch it.
2. **Canvas resizes on first selection** — 686 px → 810 px tall at 1280×900 as the properties panel
   gains content and the page starts scrolling, shifting everything on canvas down ~62 px. Reported
   earlier; still not in scope.
3. **Right-click still places an object** (no `ev.button` filter). Unchanged — it is Q4, part of the
   held 2b.
4. The player ghost's radius 14 vs `DEFAULT_BODY_SIZE = 10` mismatch — flagged, untouched, as agreed.

## Still open

Q1 (where the size handle rests after release), Q3, Q4, Q5. Q1 (A) is implemented provisionally and
its two resting-position tests are the only things that change under (B)/(C); the during-drag
mechanism is independent of the answer. Q2 was answered by the orchestrator (keep tracking past the
clamp) and is implemented and tested that way — I agree with the reading: the request is
unconditional and the speed handle it is measured against has no clamp either.

---

# Results — owner decisions implemented (rebased onto current `main`)

The branch was rebased onto current `main` (it was ~12 commits behind; rebase applied cleanly, then
`git push --force-with-lease`). All numbers below are from the rebased tree, so they do not match
the pre-rebase numbers above — `main` has gained tests and bytes in the meantime.

## The two decisions, as given by the owner

1. **Repeat place: NO.** Keep disarm-on-commit; confirm select-on-place end to end.
2. **Size-handle resting position: the derived offset.** `3 x drawn radius` from the body's origin,
   in the direction of the screen centre. Overshooting the centre is explicitly fine.

## Decision 1 — what I found, not what I changed

`commitPlacement()` (`editor/editor.ts:376`) already matches the described behaviour exactly:
it pushes history, appends the body, sets `selectedIndex = bodies.length - 1`, then clears
`placeType` and `phantom`. **No production change was needed.** What was missing was a test pinning
the *whole loop* rather than its pieces, so I added one:
`"selects the placed object and disarms, and a second one needs re-arming"`. It asserts, in order:
selection starts at `-1`; arming leaves it at `-1` (so any later selection can only come from the
commit); after commit there is 1 body, `selectedIndex === 0`, the selected body is the placed
`planet`, `getPlaceType()` is `null`, and handles are live on it; a second click elsewhere places
**nothing** (still 1 body); re-arming with `sun` places the second and moves the selection to it.

Honesty note: **this test passes against unmodified source** — it is a pinning/confirmation test, as
the owner asked ("confirm the current code already matches"). It is not failing-first, because there
was no gap to fix.

## Decision 2 — the derived resting position

`buttonPositions()` in `editor/overlay.ts` previously placed the resize handle at a fixed
`center.x - BUTTON_SPACING` (44 px due west). It now rests at
`center + dir * (RESIZE_REST_RADII * drawnRadiusPx(body, camera.zoom))`, where `RESIZE_REST_RADII = 3`
and `dir` is the existing `resizeRestDirection()` (unit vector body → camera centre, with a finite
`(-1, 0)` fallback for a body exactly at the centre). The live-drag override is untouched: while
`liveResizeEnd` is set, the handle is still exactly on the cursor.

`drawnRadiusPx()` mirrors `render/bodies.ts` rather than guessing:

| Type | `render/bodies.ts` | `drawnRadiusPx` |
|---|---|---|
| sun | `worldRadius * clampZoom(zoom)` | `size * z` |
| planet | `Math.max(6, worldSize * 2.3 * clampZoom(zoom))` | `Math.max(6, size * 2.3 * z)` |
| player | sprite drawn at `ROCKET_SCALE * clampZoom(zoom)`, **independent of `size`** | `(245 / 2) * ROCKET_SCALE * z` |

**Caveat I cannot verify away:** the player is drawn from a sprite, so it has no single "radius". The
sprites differ per variant (rocket1 87×245, rocket2 84×250, rocket3 112×241, rocket4 130×256), and
the variant is not known to the overlay. I used rocket1's half-height (245/2) as the representative,
i.e. 20.825 px at zoom 1, resting distance 62.475 px. That is a documented approximation, not a
measured identity, and it is the one number in this change an owner might want changed.

Only the resize handle changed. Move, velocity and delete keep their existing compass positions, and
a test asserts that.

## Failing-first output, recorded before implementing (decision 2)

Tests were written first and run against the old fixed 44 px offset: **8 failed, 16 passed** in
`packages/web/test/editor-overlay.test.ts`.

```
 ❯ packages/web/test/editor-overlay.test.ts (24 tests | 8 failed) 16ms
   × rests at exactly 3 x the drawn radius, for every body type
     → expected 44 to be close to 82.8, received difference is 38.8, but expected 5e-7
   × points from the body toward the screen centre, at three positions around it
     → expected -1 to be close to 1, received difference is 2, but expected 5e-10
   × overshoots the centre when 3 x drawn radius is longer than the distance to it — deliberate
     → expected 44 to be close to 276, received difference is 232, but expected 5e-7
   × rotates 180 degrees as the body crosses the screen centre
     → expected -1 to be 1 // Object.is equality
   × scales with zoom for suns and planets, exactly as the drawn body does
     → expected 44 to be close to 34.5, received difference is 9.5, but expected 5e-7
   × tracks a size change with no drag at all
     → expected 44 to be greater than 44
   × honours the planet's 6 px drawn floor — the distance bottoms out at 18 px, never zero
     → expected 44 to be close to 18, received difference is 26, but expected 5e-7
   × is independent of `size` for the player, whose drawn size is too
     → expected 44 to be close to 62.47500000000001, received difference is 18.47500000000001
```

## Two pre-existing tests I had to change, and why

`editor-engine.test.ts` had two refusal tests asserting `offset(resize) === before` — a *constant*
offset vector. Under the approved rule the offset legitimately changes when the body moves (the
direction to the screen centre rotates) or when its size changes (the distance is `3 x` the drawn
radius). Both tests do exactly one of those things, so the old assertion now contradicts the approved
behaviour. Their *intent* is preserved and restated, not weakened:

- `REFUSES to pin the resize handle to the cursor during a MOVE drag` — now asserts the handle is at
  its derived rest distance (`toBeCloseTo(3 * max(6, size*2.3*zoom), 9)`) and still >10 px from the
  cursor. Failure mode it catches (the resize override firing on a move drag) is unchanged.
- `REFUSES to keep following once the drag is released` — now asserts that after release the handle
  is at the derived rest distance, is >0.5 px away from the drop point, and does not move on
  subsequent cursor moves. Previously it compared to the pre-drag offset, which the size change made
  invalid.

The other refusal tests (`REFUSES to follow a cursor with no button held`, the velocity-drag one)
were left untouched and still pass, because nothing in them changes position or size.

## Gates — real numbers, before and after

Baseline = rebased branch at `fd1832e` (before this change). After = this change.

| Gate | Baseline (rebased) | After | |
|---|---|---|---|
| `npm run typecheck` | clean | clean | ✅ |
| `npm test` | 58 files, 928 passed, 1 skipped | **58 files, 940 passed, 1 skipped** | ✅ +12 |
| `npm run lint` | clean | clean | ✅ |
| `npm run build -w @swingby/web` | success | **success, 113.05 KB js / 37.52 KB gzip, built in 659ms** | ✅ |
| `npm run size` | 41.71 KB gzip | **41.85 KB gzip** (PASS, 208.15 KB under budget) | ✅ +0.14 KB |

12 tests added (11 resting-position tests in `editor-overlay.test.ts`, 1 placement-loop test in
`editor-engine.test.ts`). No new files. `git diff --name-only` is four files, all inside the
ownership boundary: `editor/editor.ts` (one stale comment), `editor/overlay.ts`,
`test/editor-engine.test.ts`, `test/editor-overlay.test.ts`. `packages/core` untouched.

## Browser verification

See the PR description for the screenshots and what was exercised. Anything the automated harness
could not show is called out there rather than claimed here.
