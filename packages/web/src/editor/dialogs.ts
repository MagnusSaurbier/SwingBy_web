/**
 * T-11 DRAFT — deliverable 5: confirmation dialogs for Clear, Back and Save (task doc: "Clear /
 * Back / Save all need confirmation dialogs — that is an open item on the Godot ToDo list, so build
 * it in here rather than inheriting the gap"), plus an errors dialog for a failed `validate()` gate
 * (task doc: "Save rejects invalid levels showing ALL validation errors, not just the first").
 *
 * Deliberately NOT importing `ui/dom.ts`'s `h()`/`trapFocus()` helpers — this module owns no file
 * under `ui/**` and the task brief is explicit that `editor/**` is self-contained against T-03/T-04/
 * T-05/T-10's published interfaces only, not against T-08's internal DOM-building sugar. Same
 * "duplicate a small stub rather than couple to another task's internals" precedent T-05's and
 * T-09's logs both record for their own test infra. `.dialog`/`.dialog-actions`/`.overlay`/`.btn*`
 * class names ARE reused, though — those are T-08's shipped, documented design tokens (README:
 * "the UI shell, router and design tokens are done"), meant to be consumed, not touched.
 */

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

/** Minimal focus trap — Tab/Shift+Tab cycle within `container`, Escape triggers `onEscape`. */
function trapFocus(container: HTMLElement, onEscape: () => void): () => void {
  function focusable(): HTMLElement[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }
  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      onEscape();
      return;
    }
    if (ev.key !== "Tab") return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }
  container.addEventListener("keydown", onKeydown);
  const items = focusable();
  (items[0] ?? container).focus();
  return () => container.removeEventListener("keydown", onKeydown);
}

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (`.btn-danger`) — used for Clear. */
  danger?: boolean;
}

/**
 * Shows a modal confirm dialog appended to `root`. Resolves `true` on confirm, `false` on cancel or
 * Escape. `root` is left completely untouched (no state mutated anywhere) when the result is
 * `false` — the caller performs the actual mutation only after awaiting `true`, which is what makes
 * "Cancel on each must leave state untouched" true by construction rather than by care.
 */
export function confirmDialog(
  root: HTMLElement,
  opts: ConfirmOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    const confirmBtn = el(
      "button",
      {
        type: "button",
        class: `btn btn-block ${opts.danger ? "btn-danger" : "btn-primary"}`,
      },
      [opts.confirmLabel ?? "Confirm"],
    );
    const cancelBtn = el(
      "button",
      { type: "button", class: "btn btn-block btn-ghost" },
      [opts.cancelLabel ?? "Cancel"],
    );

    const dialog = el(
      "div",
      {
        class: "panel dialog",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": opts.title,
      },
      [
        el("h2", {}, [opts.title]),
        el("p", { class: "dialog-sub" }, [opts.body]),
        el("div", { class: "dialog-actions" }, [confirmBtn, cancelBtn]),
      ],
    );
    const overlay = el("div", { class: "overlay" }, [dialog]);
    root.append(overlay);

    let release: (() => void) | null = null;

    function finish(result: boolean): void {
      release?.();
      overlay.remove();
      resolve(result);
    }

    confirmBtn.addEventListener("click", () => finish(true));
    cancelBtn.addEventListener("click", () => finish(false));
    release = trapFocus(dialog, () => finish(false));
  });
}

/**
 * Shows every `validate()` error at once (never just the first — see this file's module doc
 * comment and `editor.ts`'s save flow). Resolves once dismissed.
 */
export function showErrorsDialog(
  root: HTMLElement,
  title: string,
  errors: readonly string[],
): Promise<void> {
  return new Promise((resolve) => {
    const list = el(
      "ul",
      { class: "dialog-errors" },
      errors.map((e) => el("li", {}, [e])),
    );
    const okBtn = el(
      "button",
      { type: "button", class: "btn btn-block btn-primary" },
      ["OK"],
    );
    const dialog = el(
      "div",
      {
        class: "panel dialog",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": title,
      },
      [
        el("h2", {}, [title]),
        el("p", { class: "dialog-sub" }, [
          `${errors.length} problem${errors.length === 1 ? "" : "s"} must be fixed before saving:`,
        ]),
        list,
        el("div", { class: "dialog-actions" }, [okBtn]),
      ],
    );
    const overlay = el("div", { class: "overlay" }, [dialog]);
    root.append(overlay);

    let release: (() => void) | null = null;
    function finish(): void {
      release?.();
      overlay.remove();
      resolve();
    }
    okBtn.addEventListener("click", finish);
    release = trapFocus(dialog, finish);
  });
}
