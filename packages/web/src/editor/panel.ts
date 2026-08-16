/**
 * T-11 DRAFT — deliverable 2: the properties panel. On-canvas contextual buttons (the OTHER half of
 * "a properties panel plus contextual on-canvas buttons") live in `overlay.ts` — this file owns only
 * the DOM side panel: level metadata (name/author), the selected object's editable fields, and the
 * "Set as goal" / goal-range / delete actions. Self-contained, no import from `ui/**` — same
 * reasoning as `dialogs.ts`'s module doc comment.
 */

import type { Body, BodyType } from "@swingby/core/types";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    node.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
  return node;
}

export interface PanelCallbacks {
  onSetVelocity(vx: number, vy: number): void;
  onSetGravity(v: number): void;
  onSetSize(v: number): void;
  onSetVisible(v: boolean): void;
  onSetAnchored(v: boolean): void;
  onSetAsGoal(): void;
  onSetGoalRange(v: number): void;
  onDelete(): void;
  onSetMeta(name: string, author: string): void;
}

export interface PanelState {
  selected: Body | null;
  selectedIndex: number;
  isGoal: boolean;
  goalRange: number;
  name: string;
  author: string;
  /** True while the preview gate is active — every field is rendered disabled and a hint is shown
   *  instead of the object section. */
  requiresReset: boolean;
  bodyCount: number;
}

export interface PanelHandle {
  el: HTMLElement;
  /** Rebuilds the panel's fields from `state`. Cheap enough to call on every relevant state change
   *  (selection, an edit, undo, preview-gate toggle) — this module has no diffing, it just replaces
   *  its own subtree, matching the same "build a new subtree and swap it in" model the rest of this
   *  app's DOM code uses (see `ui/dom.ts`'s own doc comment, independently arrived at here too). */
  update(state: PanelState): void;
}

function numberField(
  label: string,
  value: number,
  onCommit: (v: number) => void,
  opts: { step?: string; min?: string; max?: string; disabled?: boolean } = {},
): HTMLElement {
  const input = el("input", {
    type: "number",
    class: "text-input",
    value: String(Number.isFinite(value) ? round(value) : 0),
    step: opts.step ?? "1",
    ...(opts.min !== undefined ? { min: opts.min } : {}),
    ...(opts.max !== undefined ? { max: opts.max } : {}),
    ...(opts.disabled ? { disabled: "true" } : {}),
  });
  input.addEventListener("change", () => {
    const v = Number.parseFloat(input.value);
    if (Number.isFinite(v)) onCommit(v);
  });
  return el("label", { class: "field" }, [label, input]);
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function textField(
  label: string,
  value: string,
  onCommit: (v: string) => void,
  disabled: boolean,
): HTMLElement {
  const input = el("input", {
    type: "text",
    class: "text-input",
    value,
    ...(disabled ? { disabled: "true" } : {}),
  });
  input.addEventListener("change", () => onCommit(input.value));
  return el("label", { class: "field" }, [label, input]);
}

function toggleField(
  label: string,
  checked: boolean,
  onCommit: (v: boolean) => void,
  disabled: boolean,
): HTMLElement {
  const input = el("input", {
    type: "checkbox",
    ...(disabled ? { disabled: "true" } : {}),
  });
  input.checked = checked;
  input.addEventListener("change", () => onCommit(input.checked));
  return el("label", { class: "toggle-row" }, [
    input,
    el("span", { class: "toggle" }, [label]),
  ]);
}

const TYPE_LABEL: Record<BodyType, string> = {
  player: "Player",
  sun: "Sun",
  planet: "Planet",
};

export function mountPanel(cb: PanelCallbacks): PanelHandle {
  const root = el("aside", {
    class: "panel editor-panel",
    "data-editor-panel": "true",
  });

  function update(state: PanelState): void {
    root.replaceChildren();
    root.append(el("h2", {}, ["Level"]));
    root.append(
      textField(
        "Name",
        state.name,
        (v) => cb.onSetMeta(v, state.author),
        state.requiresReset,
      ),
      textField(
        "Author",
        state.author,
        (v) => cb.onSetMeta(state.name, v),
        state.requiresReset,
      ),
    );
    root.append(
      el("p", { class: "dialog-sub" }, [
        `${state.bodyCount} object${state.bodyCount === 1 ? "" : "s"}`,
      ]),
    );

    if (state.requiresReset) {
      root.append(
        el("p", { class: "dialog-sub", "data-editor-reset-hint": "true" }, [
          "Preview has run — reset the preview to continue editing.",
        ]),
      );
      return;
    }

    if (!state.selected) {
      root.append(
        el("p", { class: "dialog-sub" }, [
          "Select an object to edit its properties.",
        ]),
      );
      return;
    }

    const body = state.selected;
    root.append(
      el("h2", {}, [`${TYPE_LABEL[body.type]} #${state.selectedIndex}`]),
    );
    // Position (x/y) is intentionally NOT a panel field — it's authored by dragging the body on
    // canvas (the "move" handle), matching how LevelEditor.gd and the Swift take both treat
    // position as a continuous drag interaction, not a numeric one. Velocity/gravity/size ARE
    // exposed here as exact numeric fields (in addition to their own on-canvas drag handles),
    // since those benefit from precise entry the way position rarely does.
    root.append(
      el("p", { class: "dialog-sub" }, [
        `Position: ${round(body.x)}, ${round(body.y)} (drag on canvas)`,
      ]),
    );

    if (body.type !== "sun") {
      root.append(
        numberField(
          "Velocity X",
          body.xVel,
          (v) => cb.onSetVelocity(v, body.yVel),
          { step: "0.01" },
        ),
        numberField(
          "Velocity Y",
          body.yVel,
          (v) => cb.onSetVelocity(body.xVel, v),
          { step: "0.01" },
        ),
      );
    }

    root.append(
      numberField("Gravity", body.gravity, (v) => cb.onSetGravity(v), {
        min: "0",
        step: "10",
      }),
    );
    root.append(
      numberField("Size", body.size, (v) => cb.onSetSize(v), {
        min: "4",
        max: "40",
        step: "1",
      }),
    );

    if (body.type === "sun") {
      root.append(
        toggleField("Visible", body.visible, (v) => cb.onSetVisible(v), false),
      );
    }
    if (body.type === "planet") {
      root.append(
        toggleField(
          "Anchored",
          body.anchored,
          (v) => cb.onSetAnchored(v),
          false,
        ),
      );
    }

    if (body.type !== "player") {
      const goalBtn = el(
        "button",
        {
          type: "button",
          class: `btn btn-block ${state.isGoal ? "btn-primary" : "btn-ghost"}`,
        },
        [state.isGoal ? "Goal ✓" : "Set as goal"],
      );
      goalBtn.addEventListener("click", () => cb.onSetAsGoal());
      root.append(goalBtn);
    }
    if (state.isGoal) {
      root.append(
        numberField(
          "Goal range",
          state.goalRange,
          (v) => cb.onSetGoalRange(v),
          { min: "1", step: "5" },
        ),
      );
    }

    const deleteBtn = el(
      "button",
      { type: "button", class: "btn btn-block btn-danger" },
      ["Delete"],
    );
    deleteBtn.addEventListener("click", () => cb.onDelete());
    root.append(deleteBtn);
  }

  update({
    selected: null,
    selectedIndex: -1,
    isGoal: false,
    goalRange: 50,
    name: "",
    author: "",
    requiresReset: false,
    bodyCount: 0,
  });

  return { el: root, update };
}
