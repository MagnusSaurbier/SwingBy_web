# feat/editor-canvas-interaction

**Agent:** Editor canvas interaction — size handle follows the cursor, and the placement ghost appears from the moment a Place tool is armed.
**State:** blocked
**Head:** ab2486e - resizeRestDirection (direction half of the polar resting rule, exported but deliberately unwired) + editor-pointer-buttons.test.ts locking down the no-button-filter decision + the three-design record in buttonPositions' doc comment.

## Done

- **Change 1 (during-drag), `e04e683`:** the resize handle tracks the cursor for the whole of its own drag, pixel-exact, via a `dragWorldPt` stash and a `liveResizeEnd` parameter mirroring the existing `liveVelocityEnd`. Verified in a real browser at 2.8-3.6 px, the same as the untouched velocity handle.
- **Change 2a (ghost from arm), `1f48723`:** classified a bug, not a feature — `EditorOverlay.phantom`'s doc comment and `notes/T-11-DRAFT/log.md` decision #7 both specify a ghost following the cursor with no press, but `phantom` was only ever assigned in `pointerDown`.
- **Change 2b resolved to zero work.** The owner's revised request is 2a plus behaviour the editor already had. Settled on evidence: the toolbar Place buttons have no selected state at all, so "show the selected item's button as right now" can only mean the placed object's contextual handles, which exist because `commitPlacement()` auto-selects. Decision #7 stands unreversed.
- Gates at head: typecheck clean, prettier clean, **57 files / 874 passed / 1 skipped**, 40.65 KB gzip. File count is 57 not the 56 baseline — `editor-pointer-buttons.test.ts` is new, per `ui-toggle-css.test.ts`'s precedent.

## In progress

Nothing. All three separately-cleared pieces are committed and pushed; the resting position is not started because it is not approved.

## Blocked on

Three owner decisions, all reported with measurements in `PLAN-INCREMENT-3.md`:

1. **The handle/velocity collision.** The rotating handle collides with the fixed compass handles in two of four directions. When the body is left of screen centre it lands on the velocity handle; since `hitTestButtons` scans move → velocity → resize, the grab target collapses to a **~4 px sliver** (measured: x ∈ 269..273). Correcting my own earlier wording — I called this "unclickable", which was too strong.
2. **Near-centre jitter** — treat "within epsilon of the screen centre" as degenerate (handle parks left), or let the direction swing freely as the body crosses.
3. **The player's drawn size does not depend on `body.size`** — it is `ROCKET_SCALE · zoom` times a sprite. So "distance = 3× drawn size" cannot vary with size for players and "size zero sits in the centre" cannot hold at any factor; the sprite's dimensions are also unreachable from `overlay.ts`.

Also awaiting confirmation of factor **4.0** over 3.0, and acceptance of the release jump it implies (8 % of the drag distance for planets, 60 % for suns).

## Next step

On the owner's answers: implement the resting distance in `buttonPositions`, wire `resizeRestDirection` into it, verify in Chromium at desktop viewports with per-sample pixel deltas, re-run all four gates. Rebase onto `main` when `feat/edit-current-level` lands.

## Files owned

- `packages/web/src/editor/overlay.ts`
- `packages/web/src/editor/editor.ts`
- `packages/web/test/editor-overlay.test.ts`
- `packages/web/test/editor-engine.test.ts`
- `packages/web/test/editor-pointer-buttons.test.ts`
- `notes/feat-editor-canvas-interaction/**`, `notes/agent-status/feat/editor-canvas-interaction.md` (authorized by the orchestrator, outside the code lane)
