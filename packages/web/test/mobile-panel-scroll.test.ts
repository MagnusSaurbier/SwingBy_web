/**
 * Regression coverage for "panels are not scrollable on mobile" — reported against the in-game
 * settings tab, but the cause was app-wide.
 *
 * Two independent defects, so two halves to this file.
 *
 * HALF 1 — `game/input.ts` set `touch-action: none` on `document.body`.
 *
 * The declaration is correct for a play surface and catastrophic for the document: it disables
 * every touch scroll gesture on the whole page. Three callers hand `createInputSource` the body
 * rather than a canvas, because what they want from it is document-level KEYBOARD capture
 * (`ui/screens/settings.ts`, and `ui/screens/play.ts` twice). The settings screen is ~2100px tall
 * on a phone, so its lower half — the controls list, the Reset button, the Back link — became
 * unreachable. `destroy()` never restored the property, so the dead state leaked across SPA
 * navigation to every screen visited after /play as well.
 *
 * This half is a real behavioural test, not a text assertion: it stubs a `document` global (the
 * plain-Node vitest environment has none — see input.test.ts's own note on why there is no jsdom
 * here) and asserts on what the module actually writes to `.style`.
 *
 * HALF 2 — centred modals with no scroll container, in two files.
 *
 * `.overlay` (styles/components.css) and `.sb-complete-overlay` (hud/hud.css) both centre a child
 * with `align-items: center` inside a fixed/absolute box with `overflow: visible`. A child taller
 * than the viewport then overflows equally in BOTH directions: its top goes above y=0, where no
 * scrolling can reach it, because a scroll container has no negative scroll offset. Measured on a
 * 740x360 landscape phone, the completion panel was 368px tall in a 360px viewport — top at y=-4,
 * bottom at y=364, and a real touch drag moved it 0px.
 *
 * Note that `overflow-y: auto` ALONE does not fix this — under `align-items: center` it exposes
 * only the bottom half and the top stays permanently cut off. The `align-items` value is the
 * load-bearing half of the fix, which is why it is asserted explicitly here.
 *
 * As with ui-toggle-css.test.ts and hud-css.test.ts: there is no jsdom in this project, so real
 * cascade and scroll behaviour cannot be unit tested. That is what the Playwright verification
 * covers (touch-emulated Chromium, real `Input.dispatchTouchEvent` drags — scripts kept in
 * notes/fix-mobile-panel-scroll/). What runs under plain `npm test` is a literal assertion on the
 * rule text, which catches a future "cleanup" that drops it.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createInputSource } from "../src/game/input.js";

// ---------------------------------------------------------------------------------------------
// Half 1 — input.ts must not disable touch scrolling on the document
// ---------------------------------------------------------------------------------------------

/** Minimal element double: only the surface `createInputSource` touches. */
function fakeElement(tagName: string): HTMLElement {
  return {
    tagName,
    style: {} as Record<string, string>,
    addEventListener(): void {},
    removeEventListener(): void {},
  } as unknown as HTMLElement;
}

const hadDocument = "document" in globalThis;

afterEach(() => {
  if (!hadDocument) {
    delete (globalThis as { document?: unknown }).document;
  }
});

/** Installs a `document` whose `body`/`documentElement` are the given doubles. */
function stubDocument(body: HTMLElement, documentElement: HTMLElement): void {
  (globalThis as { document?: unknown }).document = {
    body,
    documentElement,
  };
}

function touchActionOf(el: HTMLElement): string | undefined {
  return (el.style as unknown as Record<string, string>).touchAction;
}

describe("input.ts — touch-action must stay off the document", () => {
  it("does not disable touch scrolling when handed document.body", () => {
    // Before the fix this was "none", and that single assignment is the entire reported bug:
    // no panel anywhere in the app could be scrolled by touch afterwards.
    const body = fakeElement("BODY");
    const html = fakeElement("HTML");
    stubDocument(body, html);

    const source = createInputSource(body);
    expect(touchActionOf(body)).toBeUndefined();
    source.destroy();
  });

  it("does not disable touch scrolling when handed document.documentElement", () => {
    const body = fakeElement("BODY");
    const html = fakeElement("HTML");
    stubDocument(body, html);

    const source = createInputSource(html);
    expect(touchActionOf(html)).toBeUndefined();
    source.destroy();
  });

  it("still suppresses browser gestures on a real play surface", () => {
    // The fix must not overshoot. Dragging on the canvas must never pan or zoom the page, so an
    // element that is NOT the document root still gets the declaration. Without this assertion,
    // deleting the line outright would pass every test above.
    const body = fakeElement("BODY");
    const html = fakeElement("HTML");
    stubDocument(body, html);

    const canvas = fakeElement("CANVAS");
    const source = createInputSource(canvas);
    expect(touchActionOf(canvas)).toBe("none");
    source.destroy();
  });
});

// ---------------------------------------------------------------------------------------------
// Half 2 — modal overlays must be scroll containers that keep their child's top reachable
// ---------------------------------------------------------------------------------------------

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

/** Strip comments and collapse whitespace, so assertions care about declarations and not
 *  formatting. Stripping comments matters here: both fixes are documented in long comments that
 *  quote the very declarations being asserted. */
function normalize(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const components = normalize(read("../src/styles/components.css"));
const screens = normalize(read("../src/styles/screens.css"));
const base = normalize(read("../src/styles/base.css"));
const hud = normalize(read("../src/hud/hud.css"));

/** The rule body for an exact selector. Anchored on a rule boundary so that asking for
 *  `.overlay` cannot accidentally match `.sb-complete-overlay` or `.sb-pause-root > .overlay`. */
function ruleFor(css: string, selector: string, where: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[}{;]) *${escaped}\\s*\\{[^}]*\\}`).exec(css);
  expect(match, `no rule found for \`${selector}\` in ${where}`).not.toBeNull();
  return match![0];
}

describe("components.css — .overlay is a scroll container for its dialog", () => {
  it("scrolls vertically when the dialog is taller than the viewport", () => {
    expect(ruleFor(components, ".overlay", "components.css")).toMatch(
      /overflow-y:\s*auto/,
    );
  });

  it("aligns the dialog to the start, so its top can never end up above the scroll origin", () => {
    // The load-bearing half. `align-items: center` overflows a too-tall child equally in both
    // directions and the top half becomes unreachable even with overflow-y: auto set.
    const rule = ruleFor(components, ".overlay", "components.css");
    expect(rule).toMatch(/align-items:\s*flex-start/);
    expect(rule).not.toMatch(/align-items:\s*center/);
  });

  it("keeps the dialog visually centred while it fits, via auto margins", () => {
    // Without this the fix would be a regression on every viewport where the dialog DOES fit:
    // every modal in the app would jump to the top of the screen.
    expect(ruleFor(components, ".dialog", "components.css")).toMatch(
      /margin:\s*auto/,
    );
  });

  it("does not become a horizontal scroller", () => {
    expect(ruleFor(components, ".overlay", "components.css")).toMatch(
      /overflow-x:\s*hidden/,
    );
  });
});

describe("hud.css — .sb-complete-overlay has the same treatment", () => {
  // Same pattern, different file and different owner, and this is the instance that was actually
  // measured broken (368px panel in a 360px landscape viewport, top at y=-4). Both are worth
  // asserting: neither fix implies the other.
  it("scrolls vertically when the completion panel is taller than the viewport", () => {
    expect(ruleFor(hud, ".sb-complete-overlay", "hud.css")).toMatch(
      /overflow-y:\s*auto/,
    );
  });

  it("aligns the completion panel to the start", () => {
    const rule = ruleFor(hud, ".sb-complete-overlay", "hud.css");
    expect(rule).toMatch(/align-items:\s*flex-start/);
    expect(rule).not.toMatch(/align-items:\s*center/);
  });

  it("keeps the completion panel centred while it fits", () => {
    expect(ruleFor(hud, ".sb-complete-panel", "hud.css")).toMatch(
      /margin:\s*auto/,
    );
  });
});

describe("screens.css — the play surfaces keep suppressing browser gestures", () => {
  it("declares touch-action: none on the canvases, not on the document", () => {
    // This is the other half of the input.ts fix: the suppression moved from a JS-set inline
    // style on document.body to CSS on the two elements it was always meant for. If this rule
    // disappears, dragging to fly would pan the page instead.
    const rule = ruleFor(
      screens,
      ".play-canvas, .editor-canvas",
      "screens.css",
    );
    expect(rule).toMatch(/touch-action:\s*none/);
  });
});

describe("100dvh progressive upgrade on full-height screens", () => {
  // `100vh` is the viewport height with mobile browser chrome RETRACTED, so while the chrome is
  // showing it overstates the height and adds phantom scrollable space. Every rule that sets a
  // full-viewport min-height follows the `.credits-screen` precedent (commit dbe26d3) of repeating
  // the declaration in `dvh` immediately after, which browsers without `dvh` simply ignore.
  const cases: ReadonlyArray<[string, string, string]> = [
    ["body", base, "base.css"],
    ["#app", screens, "screens.css"],
    [".menu-screen", screens, "screens.css"],
    [".credits-screen", screens, "screens.css"],
    [".play-screen", screens, "screens.css"],
    [".editor-screen", screens, "screens.css"],
  ];

  for (const [selector, css, where] of cases) {
    it(`${selector} pairs min-height: 100vh with a 100dvh upgrade`, () => {
      const rule = ruleFor(css, selector, where);
      expect(rule).toMatch(/min-height:\s*100vh/);
      expect(rule).toMatch(/min-height:\s*100dvh/);
      // Order matters: the dvh line must come after, or it is the one that gets overridden.
      expect(rule.indexOf("100dvh")).toBeGreaterThan(rule.indexOf("100vh"));
    });
  }
});
