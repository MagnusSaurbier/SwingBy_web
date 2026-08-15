// T-08 BRIDGE — Workshop screen. Task doc: "Preview and pick one of four rocket variants.
// Persists as boostType." Rocket sprites are T-04 AURORA's asset (packages/web/src/render/assets)
// and this task's DoD forbids importing from render/ — so previews are hand-drawn inline SVG
// glyphs, same family as icons.ts, not the real sprites. See notes/T-08-BRIDGE/log.md.

import { fromMarkup, h } from "../dom.js";
import { backLink, screenHeader } from "../chrome.js";
import { iconMarkup } from "../icons.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

const CRAFT = [
  { name: "Pioneer", tag: "Balanced and reliable" },
  { name: "Arrow", tag: "Sleek aerodynamic profile" },
  { name: "Dart", tag: "Low profile, agile" },
  { name: "Shuttle", tag: "Heavy lifter, raw thrust" },
] as const;

export function renderWorkshop(ctx: ScreenCtx): ScreenResult {
  const settings = ctx.storage.getSettings();
  let equipped = settings.boostType;

  const previewName = h("h2", {}, [CRAFT[equipped]?.name ?? CRAFT[0]!.name]);
  const preview = h("div", { class: "panel workshop-preview" }, [
    h("div", { class: "craft-glyph-large" }, [fromMarkup(iconMarkup("rocket"))]),
    previewName,
    h("p", { class: "craft-badge" }, ["EQUIPPED"]),
  ]);

  // Selecting a craft updates in place (checked state, badge, preview name) rather than
  // rebuilding the screen — a full rerender would drop keyboard focus off the just-activated
  // card, which is exactly the kind of thing the keyboard-only pass is meant to catch.
  const badgeSlots: HTMLElement[] = [];
  const cardEls: HTMLElement[] = [];

  const cards = CRAFT.map((craft, index) => {
    const badgeSlot = h("span", {}, index === equipped ? [fromMarkup(iconMarkup("check")), " active"] : []);
    badgeSlot.className = "craft-badge";
    badgeSlots.push(badgeSlot);
    const card = h(
      "button",
      { class: "craft-card", type: "button", "aria-pressed": String(index === equipped) },
      [
        h("span", { class: "craft-glyph" }, [fromMarkup(iconMarkup("rocket"))]),
        h("span", { class: "craft-info" }, [
          h("span", {}, [`${String(index + 1).padStart(2, "0")}  ${craft.name}`]),
          h("span", { class: "craft-tag" }, [craft.tag]),
        ]),
        badgeSlot,
      ],
    );
    cardEls.push(card);
    card.addEventListener("click", () => {
      if (equipped === index) return;
      equipped = index;
      ctx.storage.setSettings({ boostType: index });
      previewName.textContent = craft.name;
      cardEls.forEach((c, i) => c.setAttribute("aria-pressed", String(i === index)));
      badgeSlots.forEach((slot, i) => {
        slot.replaceChildren(...(i === index ? [fromMarkup(iconMarkup("check")), document.createTextNode(" active")] : []));
      });
    });
    return card;
  });

  const el = h("main", { class: "screen" }, [
    h("div", { class: "panel screen-shell" }, [
      screenHeader("Workshop", "Choose the rocket you fly with. Each has a distinct silhouette."),
      h("div", { class: "workshop-layout" }, [preview, h("div", { class: "craft-list" }, cards)]),
      h("div", { class: "screen-footer" }, [backLink("/")]),
    ]),
  ]);

  return { el };
}
