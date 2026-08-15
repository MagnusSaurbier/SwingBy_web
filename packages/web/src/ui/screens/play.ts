// T-08 BRIDGE — Play route. A routing/chrome placeholder, NOT the game itself — see
// notes/T-08-BRIDGE/log.md "Scope boundary on the /play/:levelId route" for the full reasoning:
// the DoD forbids importing `game/loop.ts` or `render/` from this task, and the task doc frames
// T-08 as "every screen that is not the game itself." This route resolves level identity (so deep
// links and "Play" from the menu work), renders a stably-classed mount point for T-05/T-09 to
// attach the real simulation to later, and hosts the in-game menu overlay — the actual T-08
// deliverable for this screen — reachable via Escape or the on-screen Menu button.

import { buildPath } from "../router.js";
import { backLink, iconedButton } from "../chrome.js";
import { h } from "../dom.js";
import { resolveLevel } from "../view-models.js";
import { mountIngameMenu, type IngameMenuHandle } from "./ingameMenu.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

export function renderPlay(ctx: ScreenCtx): ScreenResult {
  const levelId = ctx.params.levelId ?? "";
  const customs = ctx.storage.listCustomLevels();
  const resolved = resolveLevel(levelId, customs);

  if (!resolved) {
    const el = h("main", { class: "screen placeholder-screen" }, [
      h("h1", {}, ["Level not found"]),
      h("p", { class: "subtitle" }, [`No level matches "${levelId}".`]),
      backLink("/levels", "Back to level select"),
    ]);
    return { el };
  }

  const { level, index, isCustom } = resolved;
  const levelLabel = `${isCustom ? "Custom" : `Stage ${String(index + 1).padStart(2, "0")}`} · ${level.name}`;

  const menuTrigger = iconedButton("button", "pause", "Menu", { type: "button", class: "btn btn-ghost" });

  const chrome = h("div", { class: "play-chrome" }, [
    h("div", {}, [h("strong", {}, [level.name]), h("span", { class: "subtitle" }, [` by ${level.author}`])]),
    menuTrigger,
  ]);

  const canvas = h("canvas", {
    class: "play-canvas",
    "data-swingby-game-mount": "true",
    "aria-hidden": "true",
  });

  const canvasWrap = h("div", { class: "play-canvas-wrap" }, [
    canvas,
    h("p", { class: "play-placeholder-note" }, [
      "Flight systems mount here once a session starts — T-05 FLYWHEEL / T-09 GAUGE.",
    ]),
  ]);

  const el = h("main", { class: "screen play-screen" }, [chrome, canvasWrap]);

  let overlay: IngameMenuHandle | null = null;

  function openMenu(): void {
    if (overlay) return;
    const handle = mountIngameMenu(levelLabel, {
      onResume: closeMenu,
      onRestart: closeMenu,
      onSettings: () => {
        closeMenu();
        ctx.navigate("/settings", { state: { returnTo: buildPath("/play/:levelId", { levelId }) } });
      },
      onChooseLevel: () => {
        closeMenu();
        ctx.navigate("/levels");
      },
      onMainMenu: () => {
        closeMenu();
        ctx.navigate("/");
      },
    });
    overlay = handle;
    el.append(handle.el);
  }

  function closeMenu(): void {
    if (!overlay) return;
    overlay.close();
    overlay.el.remove();
    overlay = null;
    menuTrigger.focus();
  }

  menuTrigger.addEventListener("click", openMenu);

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      if (overlay) closeMenu();
      else openMenu();
    }
  }
  document.addEventListener("keydown", onKeydown);

  return {
    el,
    destroy(): void {
      document.removeEventListener("keydown", onKeydown);
      overlay?.close();
    },
  };
}
