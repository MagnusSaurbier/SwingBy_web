/**
 * Confirmation dialogs for Clear, Back and Save — Clear/Back/Save all need confirmation to guard
 * against losing work — plus an errors dialog for a failed `validate()` gate: Save rejects
 * invalid levels showing ALL validation errors, not just the first.
 *
 * Deliberately NOT importing `ui/dom.ts`'s `h()`/`trapFocus()` helpers — this module owns no file
 * under `ui/**` and `editor/**` is self-contained against published interfaces only, not against
 * `ui/**`'s internal DOM-building sugar. `.dialog`/`.dialog-actions`/`.overlay`/`.btn*` class names
 * ARE reused, though — those are the UI shell's shipped, documented design tokens, meant to be
 * consumed, not touched.
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

/**
 * A single free-text message dialog (network/share failures, etc.) — distinct from
 * `showErrorsDialog` above, whose copy ("N problems must be fixed before saving") is specific to
 * the `validate()` gate. `message` is always plain text (`el()`'s string-child path uses
 * `document.createTextNode`, never `innerHTML`) — safe even for a message built from an untrusted
 * source, though in practice every caller here only passes locally-constructed diagnostic strings.
 */
export function showMessageDialog(
  root: HTMLElement,
  title: string,
  message: string,
): Promise<void> {
  return new Promise((resolve) => {
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
        el("p", { class: "dialog-sub" }, [message]),
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

/**
 * Shown after a successful Share. `url` is untrusted-ish remote-derived data (built by `net/
 * index.ts` from the server's returned share id) — rendered exclusively via a readonly `<input>`'s
 * `value` property/attribute, never `innerHTML`, never as a live `<a href>` (an attacker-controlled
 * `javascript:`/`data:` scheme in a clickable link would be a real risk; a copyable text field has
 * no such surface). `editor.ts`'s caller additionally validates the URL's shape/scheme before ever
 * reaching this function — see `sanitizeShareResult` there — so this is defense in depth, not the
 * only check.
 */
export function showShareLinkDialog(
  root: HTMLElement,
  url: string,
): Promise<void> {
  return new Promise((resolve) => {
    const urlInput = el("input", {
      type: "text",
      class: "text-input",
      readonly: "true",
      value: url,
      "aria-label": "Share link",
    });
    urlInput.addEventListener("focus", () => urlInput.select());

    const copyBtn = el(
      "button",
      { type: "button", class: "btn btn-block btn-ghost" },
      ["Copy link"],
    );
    copyBtn.addEventListener("click", () => {
      urlInput.select();
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        // Best-effort — clipboard access can be denied by permissions policy; never let a copy
        // failure surface as an error, the URL is still visible/selectable either way.
        void navigator.clipboard.writeText(url).catch(() => {});
      } else if (typeof document !== "undefined" && document.execCommand) {
        try {
          document.execCommand("copy");
        } catch {
          /* best-effort only */
        }
      }
    });

    const okBtn = el(
      "button",
      { type: "button", class: "btn btn-block btn-primary" },
      ["Done"],
    );
    const dialog = el(
      "div",
      {
        class: "panel dialog",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "Level shared",
      },
      [
        el("h2", {}, ["Level shared"]),
        el("p", { class: "dialog-sub" }, [
          "Anyone with this link can open and play your level:",
        ]),
        el("label", { class: "field" }, ["Share link", urlInput]),
        el("div", { class: "dialog-actions" }, [copyBtn, okBtn]),
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
