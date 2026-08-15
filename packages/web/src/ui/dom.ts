// T-08 BRIDGE — DOM construction sugar. NOT a UI framework: no virtual DOM, no diffing, no
// reactivity, no component lifecycle. `h()` is a one-shot element builder around
// `document.createElement` — every screen still just builds a DOM subtree once and hands it back;
// re-render on state change means "build a new subtree and swap it in" (see app.ts), the same
// mental model as calling `innerHTML =` but keeping real event listeners and no string escaping
// bugs. This keeps faith with the framework decision recorded in main.ts / the log: plain DOM.

export type Child = Node | string | null | undefined | false;

export type Attrs = Record<string, string | number | boolean | ((ev: never) => void) | undefined>;

function isEventAttr(key: string): key is `on${string}` {
  return key.length > 2 && key.startsWith("on") && key[2] === key[2]?.toUpperCase();
}

/** Builds one element. Attribute keys: `class`, `for`, `data-*`, `aria-*`, boolean DOM properties
 *  (`disabled`, `checked`, `selected`), plain string/number attributes, and `onClick`/`onInput`/…
 *  which attach listeners via `addEventListener` (not inline `on*` attributes). */
export function h(tag: string, attrs: Attrs = {}, children: Child[] = []): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (isEventAttr(key)) {
      const eventName = key.slice(2).toLowerCase();
      el.addEventListener(eventName, value as EventListener);
      continue;
    }
    if (key === "class") {
      el.className = String(value);
      continue;
    }
    if (typeof value === "boolean") {
      if (value) el.setAttribute(key, "");
      else el.removeAttribute(key);
      // Keep DOM properties (checked/disabled/selected) in sync too — setAttribute alone doesn't
      // update live boolean IDL properties on elements that already exist, but does for creation.
      (el as unknown as Record<string, unknown>)[key] = value;
      continue;
    }
    el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(el: HTMLElement, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
}

export function text(value: string): Text {
  return document.createTextNode(value);
}

/** Parses `markup` (expected to be a single root element, e.g. output of `iconMarkup`) into a
 *  real Node — used for the handful of places an icon is inlined without going through `h()`. */
export function fromMarkup(markup: string): Element {
  const wrap = document.createElement("div");
  wrap.innerHTML = markup;
  const first = wrap.firstElementChild;
  if (!first) throw new Error("fromMarkup: no root element");
  return first;
}

/**
 * Traps Tab/Shift+Tab within `container` and restores focus to whatever had it before, on
 * `release()`. Used by the in-game menu overlay (a modal) — see screens/ingameMenu.ts.
 */
export function trapFocus(container: HTMLElement): { release: () => void } {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  function focusable(): HTMLElement[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== "Tab") return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
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

  return {
    release(): void {
      container.removeEventListener("keydown", onKeydown);
      previouslyFocused?.focus?.();
    },
  };
}
