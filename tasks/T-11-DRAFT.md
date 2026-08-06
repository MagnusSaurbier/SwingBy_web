# T-11 · DRAFT — Level editor

**Area:** `packages/web/src/editor` · **Depends on:** T-03, T-04, T-05 *(interfaces)* · **Blocks:** T-13 sharing

## Goal

Port the level editor: place and configure bodies, preview live, save as a custom level. The largest
single gameplay feature after the game itself, and the reason custom-level sharing is worth building.

## Owned files

```
packages/web/src/editor/**
```

## Reference

`reference/godot/scripts/LevelEditor.gd` (733 lines) — the authority. `reference/swift/
EditorScene.swift` (535 lines) is an independent second take on the same feature and is worth
reading for its interaction model, but the Godot version is what ships.

## Capabilities

**Placement** — player, suns, planets. Click-to-place and press-and-drag, with a ghost preview
before commit.

**Selection** — click a body or its hover ring to open a properties panel plus contextual on-canvas
buttons.

**Per-object editing** — move; set launch velocity by dragging a vector; set gravity by dragging a
radius; resize by dragging (which **also scales gravity** for non-player objects — preserve that
coupling, it is how levels stay balanced); toggle sun visibility; toggle planet anchoring; mark as
goal; delete.

**Canvas** — pan by dragging empty space, zoom by wheel. Suppress zoom while the pointer is over a
panel, or the UI fights the canvas.

**Actions** — undo last placement, clear stage, reset preview, pause/resume preview, rename, save,
exit. Save is gated on a valid level (T-03's `validate`), and Clear / Back / Save all need
confirmation dialogs — that is an open item on the Godot ToDo list, so build it in here rather than
inheriting the gap.

## The preview-state trap

The single subtlest behaviour, and worth reading `LevelEditor.gd` carefully for:

> When the preview has been allowed to run, editing a body that has drifted from its authored start
> position is **blocked** until the user explicitly resets the preview.

Without this, a user runs the preview, nudges a planet, and silently commits its mid-simulation
position as the authored start state — corrupting their level in a way that is very hard to
understand after the fact. Godot shows a "reset stage" prompt instead. Reproduce that gate.

## Interaction with other tasks

- Hit-testing uses T-04's `worldToScreen` / `screenToWorld`. They are exact inverses; rely on that.
- The live preview runs a T-05 session in a mode with `allowInput: false`. Do not write a second
  simulation loop.
- `editorOverlay` in `RenderFrame` is typed `unknown` on purpose — **you** define its shape and the
  renderer draws it opaquely. Publish the type in your module and tell T-04 AURORA once it settles.
- Saving goes through T-10 VAULT's `saveCustomLevel`, serialized by T-03's `serialize`.

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | Editor controller: tools, selection, placement | `packages/web/src/editor/editor.ts` |
| 2 | Properties panel and contextual on-canvas controls | `packages/web/src/editor/panel.ts` |
| 3 | Pan/zoom camera control | `packages/web/src/editor/viewport.ts` |
| 4 | `EditorOverlay` type, published for T-04 AURORA | `packages/web/src/editor/overlay.ts` |
| 5 | Confirmation dialogs for Clear, Back, Save | `packages/web/src/editor/dialogs.ts` |
| 6 | A level authored in the web editor, opened in Godot — screenshots of both | — |

## Definition of done

- [ ] Every capability listed above works
- [ ] **A level authored in the web editor loads unchanged in the Godot desktop build, and vice
      versa.** This is the real test of T-03's round-trip guarantee — demonstrate it, do not assume it
- [ ] Preview-state gate prevents committing a mid-simulation position as the authored start state
- [ ] Undo covers at least placement, and its exact scope is documented
- [ ] Confirmation dialogs on Clear, Back, and Save
- [ ] Save rejects invalid levels showing **all** validation errors, not just the first
- [ ] Resize still scales gravity for non-player objects (the coupling is deliberate)
- [ ] Mouse-usable; touch explicitly stated as out of scope in the UI rather than half-working
- [ ] `EditorOverlay` type published and T-04 AURORA notified
- [ ] No direct import of `core/physics` — the preview runs through a T-05 session
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Sequencing

This is the largest task and blocks nothing on the critical path. Start it after KEPLER and AURORA
have settled their interfaces, or accept some churn if you start immediately.

## How to verify

```bash
npm run dev -w @swingby/web   # http://localhost:5173/editor
npm test -w @swingby/web -- editor
```


> **Host-only step.** Godot is not installed in the agent container. Do the port and the
> in-repo checks; leave the cross-build verification for Magnus to run on the host and say
> so explicitly in `results.txt`. Do not mark the cross-build criterion met if you did not
> observe it.

**1. Cross-build round-trip — the headline check.** Author a level in the web editor with at least
one of each: an anchored planet, an invisible sun, a moving planet, and a non-default goal range.
Save it, then open it in the Godot desktop build:

```bash
cp <exported-level>.json ~/Library/Application\ Support/Godot/app_userdata/SwingBy/custom_levels.json
/Applications/Godot.app/Contents/MacOS/Godot \
  --path /Users/magnussaurbier/Documents/Dev/2026_Swingby/SwingBy2026
```

It must load and play identically. Then author one in Godot and open it in the web editor. Screenshot
both directions for the PR. If this fails, the bug is almost certainly in T-03's `serialize` — report
it there rather than patching around it in the editor.

**2. The preview-state gate.** Run the preview until a planet has visibly drifted, then try to edit
that planet. You must get the reset prompt, not an edit. Then reset and confirm editing works again.
Skipping this check is how the corruption ships.

**3. Confirmations.** Clear, Back, and Save each prompt. Cancel on each must leave state untouched.

**4. Validation.** Try to save a level with no goal, then with two players, then with a goal index
pointing at the player. Each must list **all** applicable errors.

**5. Hit-testing at zoom extremes.** Zoom fully in and fully out and confirm clicking a body still
selects it. Off-by-half-pixel transform errors show up here first.
