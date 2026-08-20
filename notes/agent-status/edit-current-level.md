# feat/edit-current-level

**Agent:** Open the currently played level in the level editor, via a rebindable modifier-chord hotkey (default ⌥⌘E) and an "Edit this level" button in the paused in-game menu.
**State:** ready for review
**Head:** `c2d73d6` - documentation-only corrections to stale gated-stage prose, plus two extra verification passes (custom-level path; production build). Every changed `.ts` line in it is comment text.

## Done

- Feature **merged to main at `e078c44`**, which carried `fb6b089`. It is in production.
- Shipped: `/editor/:levelId` route; editor seeded via `mountEditor`'s pre-existing `level` option (nothing under `editor/**` touched); general chord-binding mechanism in `ui/view-models.ts`; persisted `editLevelHotkey` settings key outside the frozen `Settings` type, recorded in `INTERFACES.md`; Play-screen `document` keydown listener with teardown; pause-menu entry; Settings rebind row.
- Gates at merge: 57 files, 901 passed, 1 skipped; lint and typecheck clean; 41.60 KB gzip vs 40.55 baseline.
- Verification: 57/57 browser cases against the production build, plus failing-first and mutation checks on the two key refusals.

## In progress

- **`c2d73d6` is unmerged and was not asked for.** It is complete and self-contained, not half-done. Contents: rewrites the `PlayMeta.editHref` doc comment (the orchestrator's REVISE — note `fb6b089`, already in main, fixed the same comment concurrently; `c2d73d6` keeps that wording and adds one clause); four sibling stale-prose fixes the orchestrator asked me to sweep for, in `view-models.ts`, `edit-current-level.test.ts` and `PLAN.md` ×2; and `verify3.mjs` plus a `results/` section for two coverage gaps I found and closed (the custom-level path end to end, and re-running all three suites against the minified production build).
- No behaviour, no assertion and no gate number changes in it. `fb6b089`'s message claims the sibling sweep found none; it found four.

## Blocked on

- Nothing. Merging `c2d73d6` is the orchestrator's call, since it was not requested.

## Next step

- Orchestrator decides whether to merge `c2d73d6` or drop it. If dropped, the four stale comments and the two extra verification passes stay out of `main`.
- Outstanding pre-merge check unrelated to that commit: **nobody has pressed ⌥⌘E on a Mac.** No macOS on this container. ⌥⌘D was ruled out from Apple's published shortcut list; ⌥⌘E is not on that list, but "not on the list" is weaker than "tried it". It is rebindable if claimed.

## Files owned

`packages/web/src/ui/{app.ts, view-models.ts, screens/{play.ts, settings.ts, editorPlaceholder.ts, ingameMenu.ts}, __tests__/{router,view-models}.test.ts}`; `packages/web/test/edit-current-level.test.ts`; `packages/web/src/hud/{index,pause}.ts` (9 added lines, under explicit lane clearance); `INTERFACES.md` (one subsection); `notes/feat-edit-current-level/**`; `results/feat-edit-current-level.md`. Nothing under `packages/core/**` or `packages/web/src/editor/**`.
