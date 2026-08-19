# feat/edit-current-level — Results

Request: *"New feature reachable in settings and through selectable hotkey (defaults to opt+cmd+d):
The currently played level will be opened in the level editor."*

Built in two approved stages: a scoped GO for the route and the persisted key, then a full GO once
the repo owner answered the three open questions. **Complete.**

The owner's answers, all three of which changed the build:

- **Modifier chords, defaulting to ⌥⌘E** — explicitly *not* the ⌥⌘D of the original request, because
  Apple documents Option-Command-D as the system "Show or hide the Dock" shortcut and macOS would
  claim it before the page ever saw the keydown.
- **The chord support is a general mechanism**, with one consumer today.
- **The entry point is the paused in-game menu only**, not the Settings screen. Settings keeps the
  rebind row, since that is where rebinding lives.

## What is built

| # | Thing | Where |
|---|---|---|
| 1 | `/editor/:levelId` route | `ui/app.ts` |
| 2 | Editor seeded from that id; blank on `/editor`; not-found on an unresolvable id | `ui/screens/editorPlaceholder.ts` + `resolveEditorTarget` in `ui/view-models.ts` |
| 3 | Persisted `editLevelHotkey` settings key + its two accessors | `ui/view-models.ts`, documented in `INTERFACES.md` |
| 4 | Chord binding mechanism: `parseChord`, `formatChord`, `matchesChord`, `resolveHotkeyCapture`, `chordLabel`, `applePlatform` | `ui/view-models.ts` |
| 5 | `DEFAULT_EDIT_LEVEL_HOTKEY = "Alt+Meta+KeyE"` (⌥⌘E) | `ui/view-models.ts` |
| 6 | Play-screen `document` keydown listener, torn down in `destroy()` | `ui/screens/play.ts` |
| 7 | "Edit this level" in the paused menu, threaded `mountGauge` → `mountPausePanel` → `mountIngameMenu` | `hud/index.ts`, `hud/pause.ts`, `ui/screens/ingameMenu.ts` |
| 8 | Rebind row in Settings, incl. Reset | `ui/screens/settings.ts` |
| 9 | `isTypingTarget` guard | `ui/view-models.ts` |

### The chord mechanism is general; its single consumer is deliberate

Grammar: modifiers in the fixed canonical order `Ctrl`, `Alt`, `Shift`, `Meta`, then the
`KeyboardEvent.code`, joined by `+` — `"Alt+Meta+KeyE"`. One chord has exactly one spelling, so
stored strings compare as strings and parse/format round-trips as the identity.

Per the owner's instruction it is written as "this repo's way to express a chord binding", not as
this hotkey's private helper — but the existing 11 bindings were **not** migrated to it,
`game/input.ts` is untouched, and `constants.ts` stays frozen, which remains the reason this key
lives outside `Settings`. The module comment states that the narrow use is a scope decision and
says how to widen it.

**Matching is exact on all four modifiers.** A binding that fired on "at least these modifiers"
would swallow every richer chord the OS, the browser, or a future binding owns.

**Nothing under `packages/web/src/editor/**` was touched.** `mountEditor` already accepted
`level?: Level` and `createEditorEngine` already hydrated it — the feature only supplies it from a
call site in `ui/`. **Nothing under `packages/core/**` was touched**, `constants.ts` and `types.ts`
least of all. `game/input.ts` untouched. No new dependency anywhere.

`hud/pause.ts` and `hud/index.ts` were changed only under the orchestrator's explicit lane
clearance, and only to carry one optional callback: **9 added lines across the two files, nothing
refactored.**

## Gates

| Gate | Baseline (`5ceb841`) | This branch | Delta |
|---|---|---|---|
| `npm run typecheck` | clean | clean | — |
| `npm test` | 56 files, 847 passed, 1 skipped | **57 files, 901 passed, 1 skipped** | +1 file, +54 tests |
| `npm run lint` | clean | clean | — |
| `npm run size` | 40.55 KB gzip | **41.60 KB gzip** | **+1.05 KB**, 208.40 KB under the 250 KB budget |

Every number above was watched, not inferred. Size is measured after
`npm run build -w @swingby/web`.

## The new tests fail without the change

Run in a detached `git worktree` at HEAD so the working tree was never at risk.

**A — all four changed source files reverted to `5ceb841`, tests kept:**

```
 ✓ packages/web/src/ui/__tests__/router.test.ts   (22 tests)
 ❯ packages/web/src/ui/__tests__/view-models.test.ts (31 tests | 11 failed)
 ❯ packages/web/test/edit-current-level.test.ts   (11 tests | 11 failed)
```

`TypeError: resolveEditorTarget is not a function`, `isTypingTarget is not a function`, and the
whole persistence file failing on the missing accessors. 22 of the 29 new tests fail.

**This check earned its keep.** It caught that `router.test.ts`'s new cases passed *unchanged*
against a routing table that had never gained the route — they assert against that file's own local
`ROUTES` fixture, which is a copy of the app's, so they documented the pattern without covering the
wiring. Fixed by exporting `ROUTES` from `app.ts` and asserting on the real table in
`edit-current-level.test.ts`.

**B — only the new `RouteDef` line removed, everything else present:**

```
 × routes /editor/:levelId to the editor screen
   → expected null to deeply equal { name: 'editor', …(1) }
      Tests  1 failed | 4 passed | 6 skipped (11)
```

Exactly the one assertion that depends on the route, failing for the right reason. The other four
route tests still pass, correctly — they are guards (bare `/editor` unchanged, deeper paths
refused, existing routes undisturbed, no shadowing of `/play/:levelId`), not covers.

## Real-browser verification — 15/15

Headless Chromium 1280×800 against `npm run dev -w @swingby/web`. Playwright 1.56.1 from the global
install (`/opt/node22/lib/node_modules`), browsers from `/opt/pw-browsers`. **No Playwright
dependency was added to the repo** — the script is kept at
`notes/feat-edit-current-level/verify.mjs` and run out-of-tree, the same pattern
`notes/T-04-AURORA/log.md` and `notes/T-08-BRIDGE/log.md` record.

| Case | Result |
|---|---|
| `/editor/builtin-07` mounts an editor | PASS |
| …seeded with that level's name | PASS — panel shows `"Long Burn"`, matching `BUILTIN_LEVELS[7].name` |
| …seeded with that level's objects | PASS — panel shows `3 objects`, matching the level's 3 |
| `/editor` still opens a blank stage | PASS — `0 objects` |
| …with the pre-existing default name | PASS — `"Custom Stage"` |
| `/editor/does-not-exist` mounts **no** editor | PASS — 0 editor canvases |
| …and names the id in the not-found panel | PASS |
| `/editor/builtin-07/extra` falls through to notFound | PASS — `"Not found / That page doesn't exist."` |
| `/`, `/levels`, `/settings`, `/play/builtin-07` still render | PASS (4/4) |
| Saving a seeded built-in navigates to `/levels` | PASS |
| …and appends a custom level | PASS — `swingby:custom_levels` gains `{"name":"Long Burn",…}` |
| The fork appears in Level Select | PASS |

Screenshots: [`screenshots/`](../notes/feat-edit-current-level/screenshots/) — seeded editor, blank
editor, not-found panel, post-save level select.

The last two rows are also the **empirical confirmation of the Q4 consequence**: the fork is stored
under the built-in's own name, so Level Select now lists `"Long Burn"` on both tabs. That is the
decided behaviour, recorded in PLAN.md §Q4, not an accident.

## Failing-first and mutation checks — parts 3 and 4

**C — the chord mechanism reverted, its tests kept:** `25 failed | 31 passed (56)`,
`ReferenceError: parseChord is not defined` and friends.

Reverting a whole module proves the tests need it, but not that any individual assertion is load
bearing. So the two refusals that matter most were also checked by **mutating the implementation**
while leaving everything else intact:

**D — `matchesChord` weakened to a permissive "at least these modifiers" match:**

```
× matchesChord > REFUSES an extra modifier held on top — the most important refusal here
  → expected true to be false
```

**E — `resolveHotkeyCapture` mutated to commit a lone modifier press:**

```
× resolveHotkeyCapture > REFUSES to commit a modifier pressed on its own — the user is mid-chord
  → expected { Object (kind, binding) } to deeply equal { kind: 'pending' }
```

Each mutation is caught by exactly the assertion written for it, and by nothing else. These two
cover rather than accompany.

## Real-browser verification, parts 3 and 4 — 33/33

Same harness. `notes/feat-edit-current-level/verify2.mjs`.

| Group | Cases | Result |
|---|---|---|
| Hotkey fires | during flight → `/editor/builtin-07`, seeded with "Long Burn"; also on the pre-flight Ready panel | 3/3 PASS |
| Hotkey **refuses** | extra modifier (`Ctrl+⌥⌘E`), missing modifier (`⌥E`), no modifiers (`E`), wrong key (`⌥⌘D` — the original request) | 4/4 PASS |
| **Listener teardown** | left Play via the pause menu → the hotkey is inert on `/`, `/levels` and `/settings` | 4/4 PASS |
| Typing guard | ⌥⌘E with focus in the username field navigates nowhere | PASS |
| Pause-menu entry | "Edit this level" is present and performs the identical navigation | 2/2 PASS |
| Settings rebind | row present, labelled `Alt+Meta+E`; rebound to `Ctrl+Shift+B`; survives reload; new binding fires and old default no longer does | 6/6 PASS |
| Existing 11 unbroken | Boost still `Space`, rebinds to `Q`, Escape still cancels, Reset restores `Space` **and** the editor hotkey | 5/5 PASS |
| Escape on a chord rebind | cancels without changing the binding | PASS |
| Shared level | `/l/:shareId` keeps the hotkey inert | PASS |
| **Mobile 390×844 portrait + 844×390 landscape** | "Edit this level" visible, fully inside the viewport, and opens the editor | 6/6 PASS |

The teardown row is the one the orchestrator asked to see run for real rather than reasoned about.
It was: the run navigates Play → pause menu → Main menu, then presses the chord on three subsequent
screens and asserts the URL does not change.

The mobile rows exist because this repo has already been bitten by a panel-height regression
(`test/mobile-panel-scroll.test.ts`). Both orientations assert the button's bounding box lies
entirely within the viewport, not merely that it is "visible".

Screenshots 5–8 in [`screenshots/`](../notes/feat-edit-current-level/screenshots/).

## What I could NOT verify

- **Anything about how macOS itself treats ⌥⌘E.** The whole browser pass ran on Linux Chromium,
  where `page.keyboard.press("Alt+Meta+KeyE")` is delivered to the page unconditionally. That proves
  the app handles the chord correctly; it does **not** prove macOS lets ⌥⌘E through to a browser in
  the first place. There is no macOS and no Mac keyboard on this container. ⌥⌘D was ruled out from
  Apple's published shortcut list, not from testing, and ⌥⌘E is not on that list — but "not on the
  list" is weaker evidence than "tried it". **Someone on a Mac should press it once before this is
  called done.** It is rebindable if it turns out to be claimed.
- **The macOS `keyup` suppression quirk** (while ⌘ is held, macOS does not deliver `keyup` for other
  keys, so `game/input.ts`'s `heldCodes` could go stale). Reasoned to be unobservable here — the
  hotkey navigates away immediately and the Play screen's teardown plus `window blur` clear the set
  — but not tested, for the same no-macOS reason.
- **The `apple: true` label branch in a real browser.** `chordLabel(_, {apple:true})` → `⌥⌘E` is
  covered by unit test; the browser pass saw only the non-Apple form (`Alt+Meta+E`), which is
  correct for Linux Chromium.
- Touch/mobile behaviour of the editor itself: it declares itself desktop/mouse only
  (`editor/editor.ts`), unchanged by this branch.

## Deviations from the approved plan

Recorded in [PLAN.md §10a](../notes/feat-edit-current-level/PLAN.md) rather than adapted quietly.

From the scoped-GO stage: the resolve decision moved into `view-models.ts` for testability;
`readEditLevelHotkey` returns `string | null` rather than a defaulted string; `ROUTES` is exported
from `app.ts` (the failing-first check showed the route tests otherwise passed against a table that
never gained the route); and `router.test.ts`'s pre-existing round-trip test was re-keyed from route
name to route pattern, because the two editor routes deliberately share a name.

From this stage:

5. **`resolveHotkeyCapture` has three outcomes, not two.** §5 specified
   `{cancel:true} | {cancel:false, binding}`. A modifier pressed on its own needs a third,
   `pending`: with only two, holding Option would bind Option the instant it went down and a chord
   could never be entered at all. The plan's own test 6 required this behaviour, so the third state
   is what makes the approved test passable, not a widening. Judged not to be the "materially
   different shape" that warrants a re-submit — same function, same call site, one more case.

6. **"Reset all controls to default" also resets the editor hotkey.** Not stated in the plan. The
   hotkey is rendered as one more rebindable binding on that screen, so a Reset that silently
   skipped it would be a lie to the user. Additive: no existing setting changes meaning.

7. **`chordLabel` renders `"Unbound"` for a malformed binding**, matching `game/input.ts`'s own
   `UNBOUND` sentinel concept rather than showing raw stored garbage.
