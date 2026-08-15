// T-08 BRIDGE — fallback for any path that matches none of the defined routes. Reachable via the
// SPA fallback rewrite (vercel.json / vite's default appType:"spa") serving index.html for an
// arbitrary path that isn't one of ours — must render something helpful, not crash.

import { h } from "../dom.js";
import { backLink } from "../chrome.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

export function renderNotFound(_ctx: ScreenCtx): ScreenResult {
  const el = h("main", { class: "screen placeholder-screen" }, [
    h("h1", {}, ["Not found"]),
    h("p", { class: "subtitle" }, ["That page doesn't exist."]),
    backLink("/", "Back to menu"),
  ]);
  return { el };
}
