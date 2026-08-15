// T-08 BRIDGE — small shared markup fragments used by more than one screen (title block, back
// link). Deliberately NOT a `makeButton`-style widget factory — the task doc calls that out
// explicitly ("If you find yourself writing a makeButton helper, stop; that is a <button> and a
// stylesheet."). This is just de-duplicating the two bits of structure every screen repeats.

import { fromMarkup, h } from "./dom.js";
import { iconMarkup, type IconName } from "./icons.js";

export function screenHeader(title: string, subtitle?: string): HTMLElement {
  return h("div", { class: "screen-header" }, [
    h("h1", {}, [title]),
    subtitle ? h("p", { class: "subtitle" }, [subtitle]) : null,
  ]);
}

export function backLink(href: string, label = "Back"): HTMLElement {
  return h("a", { href, class: "btn btn-ghost" }, [fromMarkup(iconMarkup("back")), ` ${label}`]);
}

export function iconedButton(
  tag: "a" | "button",
  name: IconName,
  label: string,
  attrs: Record<string, string | boolean | ((ev: never) => void) | undefined>,
): HTMLElement {
  return h(tag, attrs, [fromMarkup(iconMarkup(name)), ` ${label}`]);
}
