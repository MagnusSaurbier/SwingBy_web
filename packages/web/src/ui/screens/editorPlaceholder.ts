// T-08 BRIDGE — `/editor` and `/editor/:levelId`. Wires T-11 DRAFT's real `mountEditor` — its own
// results file (results/T-11-DRAFT.md, "ui/ wiring needed") specifies this exact call: `mountEditor`
// was deliberately designed to return `{ el: HTMLElement; destroy(): void }`, structurally identical
// to `ui/screen.ts`'s `ScreenResult`, precisely so this integration is this mechanical.
//
// File kept at its original name/path (`editorPlaceholder.ts`) — T-11's doc says "rename... as
// T-08 sees fit"; not renaming avoids an unnecessary import-path churn across `app.ts` for a task
// this scoped. It is no longer a placeholder; only the filename is a fossil of that.
//
// feat/edit-current-level: this screen now also serves `/editor/:levelId`, which seeds the editor
// with an existing level rather than a blank stage — the extension point the previous version of
// this comment named as missing. Nothing inside `editor/**` changed to make that work:
// `EditorMountOptions.level` and `createEditorEngine`'s `initialLevel` handling already existed and
// simply had no caller. The *decision* (blank / seeded / not-found) lives in `view-models.ts`'s
// `resolveEditorTarget` so it can be unit tested — there is no jsdom here and `mountEditor` needs a
// real canvas and renderer, so only the decision is reachable from plain-Node vitest.

import { mountEditor } from "../../editor/editor.js";
import { backLink } from "../chrome.js";
import { h } from "../dom.js";
import { resolveEditorTarget } from "../view-models.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

export function renderEditorPlaceholder(ctx: ScreenCtx): ScreenResult {
  const target = resolveEditorTarget(
    ctx.params.levelId,
    ctx.storage.listCustomLevels(),
  );

  // An id that names neither a built-in nor a saved custom level mounts NO editor. Opening a blank
  // stage instead would silently discard what the URL asked for; the same not-found panel
  // `ui/screens/play.ts` renders for the same situation is the honest answer.
  if (target.kind === "not-found") {
    return {
      el: h("main", { class: "screen placeholder-screen" }, [
        h("h1", {}, ["Level not found"]),
        h("p", { class: "subtitle" }, [`No level matches "${target.id}".`]),
        backLink("/levels", "Back to level select"),
      ]),
    };
  }

  return mountEditor({
    storage: ctx.storage,
    // Enables the editor's Share action. `api` is optional on `EditorMountOptions`, so omitting it
    // leaves the button inert rather than breaking the build — which is why the Share feature could
    // land in `editor/` before this line existed. T-11's `shareLevelFlow` saves locally through
    // `storage` before it ever touches the network, so a failed or hanging share cannot lose the
    // author's work.
    api: ctx.api,
    // `undefined` on the bare `/editor` route, which is the pre-existing behaviour verbatim: a
    // fresh, empty "Custom Stage". Saving a seeded level still APPENDS a new custom level rather
    // than overwriting its source — `storage.saveCustomLevel` is append-only and `customLevelId` is
    // derived from content, so a built-in can never be edited in place. See PLAN.md §2.
    level: target.kind === "level" ? target.level : undefined,
    onExit: () => ctx.navigate("/"),
    onSaved: () => ctx.navigate("/levels"),
  });
}
