// T-08 BRIDGE — Menu screen. Task doc: "Title, Play (resumes at first incomplete level), Level
// Select, Editor, Workshop, Settings, Credits."

import { BUILTIN_LEVELS } from "@swingby/core";
import { buildPath } from "../router.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";
import { iconedButton } from "../chrome.js";
import { firstIncompleteLevel } from "../view-models.js";

export function renderMenu(ctx: ScreenCtx): ScreenResult {
  const resume = firstIncompleteLevel(BUILTIN_LEVELS, ctx.storage);

  const nav = document.createElement("nav");
  nav.className = "menu-nav";
  nav.setAttribute("aria-label", "Main menu");
  nav.append(
    iconedButton("a", "play", "Play", {
      href: buildPath("/play/:levelId", { levelId: resume.id }),
      class: "btn btn-primary",
    }),
    iconedButton("a", "grid", "Level Select", {
      href: "/levels",
      class: "btn",
    }),
    iconedButton("a", "edit", "Editor", { href: "/editor", class: "btn" }),
    iconedButton("a", "rocket", "Workshop", {
      href: "/workshop",
      class: "btn",
    }),
    iconedButton("a", "gear", "Settings", { href: "/settings", class: "btn" }),
    iconedButton("a", "info", "Credits", { href: "/credits", class: "btn" }),
  );

  const card = document.createElement("div");
  card.className = "panel menu-card";
  card.append(nav);

  const title = document.createElement("h1");
  title.className = "menu-title";
  title.textContent = "SwingBy";

  const subtitle = document.createElement("p");
  subtitle.className = "menu-subtitle";
  subtitle.textContent =
    "Gravity is the only steering you get. Boost, brake, and read the field.";

  const el = document.createElement("main");
  el.className = "screen menu-screen";
  el.append(title, subtitle, card);

  return { el };
}
