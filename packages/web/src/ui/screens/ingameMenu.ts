// T-08 BRIDGE — In-game menu overlay. Task doc: "Resume, Restart, Settings, Level Select, Main
// Menu. Opening Settings from here returns *here*, not to the main menu."
//
// This is a reusable component (not a routed screen) — the Play screen (play.ts) mounts it on
// Escape/pause. Kept separate so T-09 GAUGE can reuse it once a real GameSession exists (see
// notes/T-08-BRIDGE/log.md's "Scope boundary on /play/:levelId").

import { fromMarkup, h, trapFocus } from "../dom.js";
import { iconMarkup } from "../icons.js";

export interface IngameMenuCallbacks {
  onResume(): void;
  onRestart(): void;
  onSettings(): void;
  onChooseLevel(): void;
  onMainMenu(): void;
}

export interface IngameMenuHandle {
  el: HTMLElement;
  /**
   * Starts the focus trap (moves focus to Resume). MUST be called only after `el` has been
   * inserted into the live document — calling `.focus()` on a detached element is a silent no-op
   * in every browser, which was a real bug here initially (caught by the keyboard-only pass, see
   * notes/T-08-BRIDGE/log.md): `trapFocus` used to run inside this function, before the caller had
   * appended `el` anywhere, so focus never actually moved.
   */
  activate(): void;
  /** Removes the focus trap and restores focus to whatever triggered the overlay. */
  close(): void;
}

export function mountIngameMenu(levelLabel: string, cb: IngameMenuCallbacks): IngameMenuHandle {
  const resumeBtn = h("button", { type: "button", class: "btn btn-primary btn-block" }, [
    fromMarkup(iconMarkup("play")),
    " Resume",
  ]);
  resumeBtn.addEventListener("click", cb.onResume);

  function actionBtn(label: string, extraClass: string, onClick: () => void): HTMLElement {
    const btn = h("button", { type: "button", class: `btn btn-block ${extraClass}` }, [label]);
    btn.addEventListener("click", onClick);
    return btn;
  }

  const grid = h("div", { class: "dialog-actions" }, [
    actionBtn("Restart level", "", cb.onRestart),
    actionBtn("Settings", "", cb.onSettings),
    actionBtn("Choose level", "", cb.onChooseLevel),
    actionBtn("Main menu", "btn-danger", cb.onMainMenu),
  ]);

  const dialog = h(
    "div",
    { class: "panel dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "ingame-menu-title" },
    [
      h("h2", { id: "ingame-menu-title" }, ["Paused"]),
      h("p", { class: "dialog-sub" }, [levelLabel]),
      resumeBtn,
      grid,
    ],
  );

  const overlay = h("div", { class: "overlay" }, [dialog]);

  overlay.addEventListener("keydown", (ev) => {
    if ((ev as KeyboardEvent).key === "Escape") {
      ev.stopPropagation();
      cb.onResume();
    }
  });

  let trap: { release: () => void } | null = null;

  return {
    el: overlay,
    activate(): void {
      trap = trapFocus(dialog);
    },
    close(): void {
      trap?.release();
      trap = null;
    },
  };
}
