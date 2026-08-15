// T-08 BRIDGE — /editor placeholder. The real level editor is T-11 DRAFT's deliverable
// (packages/web/src/editor/**, not yet started at the time of writing). This screen exists so the
// route resolves on a cold load rather than 404ing (task doc's own "How to verify" step 2 checks
// `/editor` directly) — T-11 replaces this screen's contents, not its route.

import { h } from "../dom.js";
import { backLink } from "../chrome.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

export function renderEditorPlaceholder(_ctx: ScreenCtx): ScreenResult {
  const el = h("main", { class: "screen placeholder-screen" }, [
    h("h1", {}, ["Editor"]),
    h("p", { class: "subtitle" }, ["The level editor (T-11 DRAFT) lands here."]),
    backLink("/", "Back to menu"),
  ]);
  return { el };
}
