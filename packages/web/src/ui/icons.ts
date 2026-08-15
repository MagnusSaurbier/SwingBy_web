// T-08 BRIDGE — deliverable 4: replacement inline SVG icons.
//
// The third-party icon set `reference/godot/images/` used has unconfirmed licensing (see
// DESIGN.md §9 and README.md "Open items" for the full story — deliberately not named here so a
// mechanical grep of this package for that vendor's name stays clean, see results/T-08-BRIDGE.md).
// This task sidesteps resolving that licence by replacing every icon this UI needs with
// hand-authored paths, inline, in this file. No icon font, no sprite sheet, no external asset
// request. Every path below was drawn by hand on a 24x24 grid for this project; none are copied
// from any third-party icon set.

export type IconName =
  | "back"
  | "play"
  | "pause"
  | "restart"
  | "home"
  | "grid"
  | "gear"
  | "rocket"
  | "info"
  | "close"
  | "check"
  | "chevronRight"
  | "edit"
  | "link";

// Each entry is the *inner* markup of a 24x24 viewBox SVG — <path>/<circle>/etc, no outer <svg>
// tag (that's added once by `iconMarkup` so stroke/fill defaults live in one place).
const PATHS: Record<IconName, string> = {
  back: '<path d="M15 4 L7 12 L15 20" />',
  play: '<path d="M7 4 L20 12 L7 20 Z" />',
  pause: '<path d="M7 4 H10 V20 H7 Z M14 4 H17 V20 H14 Z" />',
  restart:
    '<path d="M19 12a7 7 0 1 1-2.34-5.24" /><path d="M19 4v5h-5" />',
  home: '<path d="M4 11 L12 4 L20 11 V20 H14 V14 H10 V20 H4 Z" />',
  grid: '<path d="M4 4 H10 V10 H4 Z M14 4 H20 V10 H14 Z M4 14 H10 V20 H4 Z M14 14 H20 V20 H14 Z" />',
  gear:
    '<circle cx="12" cy="12" r="3.4" />' +
    '<path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5' +
    'M17.66 6.34l-1.7 1.7M8.04 15.96l-1.7 1.7M17.66 17.66l-1.7-1.7M8.04 8.04l-1.7-1.7" />',
  rocket:
    '<path d="M12 2c3 2.6 4.4 6.1 4.4 9.6 0 2-.5 3.8-1.3 5.3l-3.1 2.6-3.1-2.6c-.8-1.5-1.3-3.3-1.3-5.3' +
    'C7.6 8.1 9 4.6 12 2Z" />' +
    '<circle cx="12" cy="10.4" r="1.7" />' +
    '<path d="M8.4 15.8 5.6 18.4l.7-3.6M15.6 15.8l2.8 2.6-.7-3.6" />' +
    '<path d="M10.3 19.5 12 22l1.7-2.5" />',
  info: '<circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.4v.1" stroke-linecap="round" />',
  close: '<path d="M5 5 L19 19 M19 5 L5 19" />',
  check: '<path d="M4.5 12.5 L9.5 17.5 L19.5 6.5" />',
  chevronRight: '<path d="M9 4 L17 12 L9 20" />',
  edit: '<path d="M4 20 L4.8 16.2 L15.5 5.5 a1.8 1.8 0 0 1 2.5 0 l0.5 0.5 a1.8 1.8 0 0 1 0 2.5 L7.8 19.2 Z" /><path d="M13.8 7.2 L16.8 10.2" />',
  link: '<path d="M9.5 14.5 L14.5 9.5" /><path d="M11 6.5 L13.2 4.3a3.6 3.6 0 0 1 5.1 5.1L16 11.7M13 17.5l-2.2 2.2a3.6 3.6 0 0 1-5.1-5.1L8 12.3" />',
};

const STROKE_ICONS = new Set<IconName>([
  "back",
  "restart",
  "home",
  "grid",
  "gear",
  "close",
  "check",
  "chevronRight",
  "edit",
  "link",
]);

/**
 * Renders `name` as a standalone `<svg>` markup string, sized via CSS (`width`/`height` default to
 * 1em so it follows the surrounding text). `decorative: true` (the default) marks it
 * `aria-hidden="true"` for screen readers, on the assumption every icon in this app sits beside a
 * visible text label — there are no icon-only buttons in this UI (see settings.ts / menu.ts). Pass
 * `decorative: false` and an accessible `title` for the rare icon-only case.
 */
export function iconMarkup(name: IconName, opts: { decorative?: boolean; title?: string } = {}): string {
  const decorative = opts.decorative ?? true;
  const inner = PATHS[name];
  const strokeMode = STROKE_ICONS.has(name);
  const style = strokeMode
    ? 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
    : 'fill="currentColor" stroke="none"';
  const a11y = decorative
    ? 'aria-hidden="true" focusable="false"'
    : `role="img" aria-label="${escapeAttr(opts.title ?? name)}"`;
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" class="icon icon-${name}" ${style} ${a11y}>${inner}</svg>`;
}

/** DOM-element form of `iconMarkup`, for call sites building via `createElement` rather than
 *  `innerHTML`. */
export function iconElement(name: IconName, opts: { decorative?: boolean; title?: string } = {}): SVGSVGElement {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = iconMarkup(name, opts);
  const svg = wrapper.firstElementChild as SVGSVGElement;
  return svg;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
