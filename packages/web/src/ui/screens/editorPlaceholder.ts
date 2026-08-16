// T-08 BRIDGE — /editor route. Wires T-11 DRAFT's real `mountEditor` — its own results file
// (results/T-11-DRAFT.md, "ui/ wiring needed") specifies this exact call: `mountEditor` was
// deliberately designed to return `{ el: HTMLElement; destroy(): void }`, structurally identical
// to `ui/screen.ts`'s `ScreenResult`, precisely so this integration is this mechanical.
//
// File kept at its original name/path (`editorPlaceholder.ts`) — T-11's doc says "rename... as
// T-08 sees fit"; not renaming avoids an unnecessary import-path churn across `app.ts` for a task
// this scoped. It is no longer a placeholder; only the filename is a fossil of that.

import { mountEditor } from "../../editor/editor.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

export function renderEditorPlaceholder(ctx: ScreenCtx): ScreenResult {
  return mountEditor({
    storage: ctx.storage,
    // No `/editor/:levelId` route exists yet for editing an existing custom level — every visit
    // starts a fresh, empty level. `ctx.params` is intentionally not consulted here.
    onExit: () => ctx.navigate("/"),
    onSaved: () => ctx.navigate("/levels"),
  });
}
