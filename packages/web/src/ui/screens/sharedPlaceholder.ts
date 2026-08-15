// T-08 BRIDGE — /l/:shareId placeholder. Fetching a shared custom level is T-13 PODIUM's
// deliverable (packages/web/src/net/**, not yet started). This screen exists so the route resolves
// on a cold load — same reasoning as editorPlaceholder.ts.

import { fromMarkup, h } from "../dom.js";
import { backLink } from "../chrome.js";
import { iconMarkup } from "../icons.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

export function renderSharedPlaceholder(ctx: ScreenCtx): ScreenResult {
  const el = h("main", { class: "screen placeholder-screen" }, [
    fromMarkup(iconMarkup("link", { decorative: false, title: "Shared level" })),
    h("h1", {}, ["Shared level"]),
    h("p", { class: "subtitle" }, [`Fetching shared levels (T-13 PODIUM) isn't wired up yet — id "${ctx.params.shareId ?? ""}".`]),
    backLink("/", "Back to menu"),
  ]);
  return { el };
}
