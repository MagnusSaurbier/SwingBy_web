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
