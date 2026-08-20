// T-08 BRIDGE - modal confirm dialog for the UI shell.
//
// The repo already has this pattern twice: `editor/dialogs.ts`'s `confirmDialog` (T-11 DRAFT, which
// documents why it may not import from `ui/**` and therefore hand-rolls its own `el()`/`trapFocus()`)
// and `ui/screens/ingameMenu.ts`'s overlay markup. This is the `ui/` side of it, built on the
// helpers that already exist here (`h()`, `trapFocus()`) and on T-08's shipped design tokens
// (`.overlay`, `.panel.dialog`, `.dialog-sub`, `.dialog-actions`, `.btn-danger`, `.btn-ghost`) -
// no new CSS. There is deliberately no `window.confirm` anywhere in this repo.

import { h, trapFocus } from "./dom.js";

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (`.btn-danger`). */
  danger?: boolean;
}

export interface ConfirmHandle {
  /** Resolves true only on the confirm button; false on cancel, Escape, or `dismiss()`. */
  result: Promise<boolean>;
  /** Closes the dialog as a cancel. Idempotent - safe to call from a screen's `destroy()`. */
  dismiss(): void;
}

/**
 * Appends a focus-trapped confirm dialog to `root` and returns its outcome.
 *
 * Nothing outside this function is mutated, so a caller that performs its action strictly after
 * awaiting `true` cannot act on a cancel by construction - the same property `editor/dialogs.ts`
 * relies on for the editor's Clear/Back/Save confirmations.
 */
export function confirmDialog(
  root: HTMLElement,
  opts: ConfirmOptions,
): ConfirmHandle {
  let settle: ((value: boolean) => void) | null = null;
  const result = new Promise<boolean>((resolve) => {
    settle = resolve;
  });

  const confirmBtn = h(
    "button",
    {
      type: "button",
      class: `btn btn-block ${opts.danger ? "btn-danger" : "btn-primary"}`,
    },
    [opts.confirmLabel ?? "Confirm"],
  );
  const cancelBtn = h(
    "button",
    { type: "button", class: "btn btn-block btn-ghost" },
    [opts.cancelLabel ?? "Cancel"],
  );

  const dialog = h(
    "div",
    {
      class: "panel dialog",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": opts.title,
    },
    [
      h("h2", {}, [opts.title]),
      h("p", { class: "dialog-sub" }, [opts.body]),
      h("div", { class: "dialog-actions" }, [confirmBtn, cancelBtn]),
    ],
  );
  const overlay = h("div", { class: "overlay" }, [dialog]);

  let trap: { release: () => void } | null = null;
  let finished = false;

  function finish(value: boolean): void {
    if (finished) return;
    finished = true;
    trap?.release();
    trap = null;
    overlay.remove();
    settle?.(value);
  }

  confirmBtn.addEventListener("click", () => finish(true));
  cancelBtn.addEventListener("click", () => finish(false));
  overlay.addEventListener("keydown", (ev) => {
    if ((ev as KeyboardEvent).key !== "Escape") return;
    ev.stopPropagation();
    finish(false);
  });

  root.append(overlay);
  // After the append, never before: `.focus()` on a detached element is a silent no-op, the exact
  // bug `ingameMenu.ts`'s `activate()` comment records.
  trap = trapFocus(dialog);

  return {
    result,
    dismiss(): void {
      finish(false);
    },
  };
}
