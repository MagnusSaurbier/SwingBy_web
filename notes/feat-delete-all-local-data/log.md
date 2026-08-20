# Thought log - feat/delete-all-local-data

## Session 1

- Branch `feat/delete-all-local-data` created off `main` (`135f8f5`), empty start commit pushed
  before any reading, per AGENTS.md.
- Read README.md, PROJECT.md, INTERFACES.md, AGENTS.md. Surveyed `ui/**`, `storage/**`, `net/**`
  read-only. Findings in `survey.md`.
- Key findings that shaped the plan:
  1. The existing button in `ui/screens/settings.ts:217` is **"Reset all controls to default"** -
     controls + the editor hotkey only. Not username, not display toggles, not bests, not custom
     levels. The owner's phrase "reset all to defaults" refers to that button.
  2. The app persists **four** localStorage keys, all `swingby:`-prefixed, in two modules:
     `swingby:settings`, `swingby:bests`, `swingby:custom_levels` (T-10 VAULT, `storage/index.ts:55`)
     and `swingby:score_queue` (T-13 PODIUM, `net/queue.ts:36`). Plus two transient probe keys
     (`swingby:__probe__`, `swingby:__net_probe__`) that are removed immediately after writing.
  3. Nothing in the app uses cookies, sessionStorage, IndexedDB or the Cache API - grepped
     `document.cookie|sessionStorage|indexedDB` across `packages/`: only hits are a test string in
     `editor-share.test.ts:238` and comments. The owner's word "cookies" is loose.
  4. No editor drafts are persisted: `editor/**` writes no storage key (same grep).
  5. There is already a confirm-dialog pattern: `editor/dialogs.ts:83 confirmDialog()` (promise,
     `.overlay` + `.panel dialog` + `.dialog-actions` + `.btn-danger`), and the same overlay markup
     in `ui/screens/ingameMenu.ts:73-89` with `trapFocus` from `ui/dom.ts:80`. No `window.confirm`
     anywhere in the repo - so a bare `window.confirm` would NOT be following the repo.
  6. `Storage` (frozen, INTERFACES.md) has no `clear()`. Adding one would mean editing
     `storage/index.ts`, which `feat/brake-flip-burn` may also be editing.
- Plan written to `PLAN.md`, submitted to Magnus. No behaviour-changing code written yet.

## Implementation and verification (post-GO)

- Implemented as approved: `ui/localData.ts` (prefix sweep + confirm-then-wipe-then-navigate),
  `ui/dialog.ts` (the ui/ side of the existing `.overlay`/`.panel.dialog` focus-trapped modal),
  a "Local data" section in `ui/screens/settings.ts`, and the `swingby:` namespace convention
  written into INTERFACES.md. No edits to core/, editor/, storage/ or net/.
- Gates, all watched: typecheck pass; `npm test` 58 files / 913 passed / 1 skipped in 15.69s
  (this feature 12 tests); lint pass after a prettier pass on the new test file; web build 681ms;
  size PASS 42.38 KB gzip against a 250 KB budget (+0.78 KB vs a clean origin/main build in a
  separate worktree, CSS bundle hash identical).
- Runtime verification (headed Chromium via Playwright, desktop + real `locator.tap()` at 390x844
  and 844x390): all assertions passed, including cancel/Escape leaving the store byte-identical and
  the foreign `theme` key surviving a confirmed wipe. Details and screenshots in TEST_PLAN.md and on
  PR #5.
- CI: the `lighthouse` gate fails with "port 4173 never opened" on this branch AND identically on
  main (run 32426776009), so it is preexisting infrastructure, not this change.
