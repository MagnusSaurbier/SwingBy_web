# reference/ — staging copies, not canonical

Source material copied here so agents working in isolated containers can read it without access to
Magnus's local machine. **Nothing here is part of the product.** It is deleted once the port is done.

| Path | Copied from | Used by |
|---|---|---|
| `godot/scripts/*.gd` | `SwingBy2026/scripts/` | all tasks — behavioural reference |
| `godot/data/levels_builtin.json` | `SwingBy2026/data/` | T-03 ATLAS |
| `godot/images/rocket*.png` | `SwingBy2026/images/` | T-04 AURORA |
| `swift/AudioManager.swift` | `SwingBy` (Swift rewrite) | **T-07 CHORUS** |
| `swift/InputManager.swift` | `SwingBy` (Swift rewrite) | T-06 HELM |
| `swift/EditorScene.swift` | `SwingBy` (Swift rewrite) | T-11 DRAFT |

## Rules

1. **Read-only.** Never edit anything under `reference/`. Changes here go nowhere — the real
   sources live in the Godot and Swift repos.
2. **Not a dependency.** No file in `packages/` or `api/` may import from `reference/`. Copy what
   you need into your own owned path (T-03 copies `levels_builtin.json` into
   `packages/core/src/levels.json`; T-04 copies the rocket sprites into `packages/web/public/`).
3. **`godot/` is the reference implementation.** Behaviour comes from here.
4. **`swift/` is not**, with one exception: `AudioManager.swift` is the model for T-07 CHORUS's
   procedural synthesis. `InputManager.swift` and `EditorScene.swift` are included as a
   well-factored second opinion on touch handling and editor interaction — read them for ideas, not
   for authority. The Swift project's *physics constants differ* and must never be ported.

## Why these files are here rather than cloned

`SwingBy2026` is on GitHub (`MagnusSaurbier/SwingBy2026`) and could be cloned. The Swift project
has **no remote at all** and exists only on Magnus's Mac — `AudioManager.swift` would otherwise be
unreachable from a container, and T-07 depends on it. Staging both here keeps every agent reading
the same pinned snapshot instead of whatever `main` happens to be that hour.

Snapshot taken 2026-08-05 from `SwingBy2026` at commit `dd2b501`.
