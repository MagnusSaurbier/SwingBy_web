// T-08 BRIDGE — Credits screen. Task doc: "Attribution."

import { h } from "../dom.js";
import { backLink } from "../chrome.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

export function renderCredits(_ctx: ScreenCtx): ScreenResult {
  const el = h("main", { class: "screen credits-screen" }, [
    h("div", { class: "panel credits-card" }, [
      h("p", { class: "game-name" }, ["SwingBy"]),
      h("p", { class: "names" }, ["Magnus Saurbier"]),
      h("p", { class: "subtitle" }, ["Original design and 33 hand-verified levels, built in Godot 4.6."]),
      h("p", { class: "thanks" }, ["Ported to the browser for swingby.magnussaurbier.de. Thank you for playing."]),
      backLink("/", "Back to menu"),
    ]),
  ]);
  return { el };
}
