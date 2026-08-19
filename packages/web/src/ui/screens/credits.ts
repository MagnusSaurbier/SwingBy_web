// T-08 BRIDGE — Credits screen. Task doc: "Attribution."
//
// The section list below is supplied verbatim by the repo owner and is the authority on names,
// roles and order — these are real people. Do not reword, reorder or "tidy" it. The full project
// lineage (Pygame 2020 -> Godot/Swift 2026 -> web) lives in CREDITS.md at the repo root; this card
// is deliberately just the names.

import { h } from "../dom.js";
import { backLink } from "../chrome.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

/** Ordered credit sections: [section heading, contributors]. Exported for the copy test. */
export const CREDIT_SECTIONS: readonly (readonly [string, string])[] = [
  ["A Game by", "Magnus Saurbier"],
  ["Original 2020 Version (Pygame)", "Magnus Saurbier"],
  ["Levels", "Magnus Saurbier"],
  ["Godot and Swift Versions", "Mirza Polat and Magnus Saurbier"],
  ["New Graphic Design", "Mirza Polat"],
  ["Sound Design", "Mirza Polat"],
  ["Original Earth Pixel Art", "Tom Kailing"],
  ["Web Version", "Magnus Saurbier"],
  [
    "Big Thanks for Feedback, Input and Ideas",
    "Mirza Polat, Marcel Hagemann, Laurens Peter, Jonathan Deul, Tom Kailing",
  ],
];

export function renderCredits(_ctx: ScreenCtx): ScreenResult {
  const el = h("main", { class: "screen credits-screen" }, [
    h("div", { class: "panel credits-card" }, [
      h("p", { class: "game-name" }, ["SwingBy"]),
      h(
        "div",
        { class: "credits-sections" },
        CREDIT_SECTIONS.map(([heading, people]) =>
          h("section", { class: "credits-section" }, [
            h("h2", { class: "credits-role" }, [heading]),
            h("p", { class: "names" }, [people]),
          ]),
        ),
      ),
      h("p", { class: "credits-note" }, [
        "Claude assisted with the Godot, Swift, and web versions.",
      ]),
      h("p", { class: "thanks" }, ["Thank you for playing."]),
      backLink("/", "Back to menu"),
    ]),
  ]);
  return { el };
}
