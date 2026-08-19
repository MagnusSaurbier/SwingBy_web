# feat/edit-current-level — Results (parts 1 and 2 of a scoped GO)

Request: *"New feature reachable in settings and through selectable hotkey (defaults to opt+cmd+d):
The currently played level will be opened in the level editor."*

The orchestrator issued a **scoped GO for parts 1 and 2 only**. This document covers exactly those.
Parts 3 and 4 — the hotkey matcher/capture/label, the Play-screen listener, and the settings entry
point — are **not built**, pending three questions with the repo owner
([PLAN.md §10](../notes/feat-edit-current-level/PLAN.md)).

## What is built

| # | Thing | Where |
|---|---|---|
| 1 | `/editor/:levelId` route | `ui/app.ts` |
| 2 | Editor seeded from that id; blank on `/editor`; not-found on an unresolvable id | `ui/screens/editorPlaceholder.ts` + `resolveEditorTarget` in `ui/view-models.ts` |
| 3 | Persisted `editLevelHotkey` settings key + its two accessors | `ui/view-models.ts`, documented in `INTERFACES.md` |
| 4 | `PlayMeta.editHref` (populated, not yet read — its consumers are gated) | `ui/screens/play.ts` |
| 5 | `isTypingTarget` guard | `ui/view-models.ts` |

**Nothing under `packages/web/src/editor/**` was touched.** `mountEditor` already accepted
`level?: Level` and `createEditorEngine` already hydrated it — the feature only supplies it from a
call site in `ui/`. **Nothing under `packages/core/**` was touched.** No new dependency anywhere.

## Gates

| Gate | Baseline (`5ceb841`) | This branch | Delta |
|---|---|---|---|
| `npm run typecheck` | clean | clean | — |
| `npm test` | 56 files, 847 passed, 1 skipped | **57 files, 876 passed, 1 skipped** | +1 file, +29 tests |
| `npm run lint` | clean | clean | — |
| `npm run size` | 40.55 KB gzip | **40.66 KB gzip** | **+0.11 KB**, 209.34 KB under the 250 KB budget |

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

## What I could NOT verify

- **Whether macOS delivers ⌥⌘D to the browser at all.** Apple documents Option-Command-D as the
  system "Show or hide the Dock" shortcut. This container is Linux with no macOS and no Mac
  keyboard. Unverified and untestable here — it is open question Q2, not a claim.
- **Anything about the hotkey or the settings entry point.** Not built (gated). No assertion is made
  about them, and `PlayMeta.editHref` is written but has no reader yet.
- Touch/mobile behaviour of the editor itself: it declares itself desktop/mouse only
  (`editor/editor.ts`), unchanged by this branch.

## Deviations from the approved plan

Four, all recorded in [PLAN.md §10a](../notes/feat-edit-current-level/PLAN.md): the resolve decision
moved into `view-models.ts` for testability; `readEditLevelHotkey` returns `string | null` rather
than a defaulted string (a default cannot be written without choosing the grammar, which is gated);
`ROUTES` is exported from `app.ts`; and `router.test.ts`'s pre-existing round-trip test was re-keyed
from route name to route pattern, because the two editor routes deliberately share a name. None
widens scope; the last two strengthen coverage.
