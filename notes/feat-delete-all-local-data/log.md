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
