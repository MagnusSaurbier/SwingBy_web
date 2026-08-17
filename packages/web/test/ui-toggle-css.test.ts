/**
 * Regression coverage for the unclickable settings toggles in `components.css`.
 *
 * The switch is built as a visually-hidden real `<input type="checkbox">`
 * (`opacity: 0`, deliberately not `display: none`, so it stays focusable) with a
 * decorative `.track` and `.thumb` painted over it. Both decorations are
 * positioned elements with `z-index: auto` that come AFTER the input in DOM
 * order, so they paint above it — and hit-testing follows paint order. Without
 * `pointer-events: none` they swallowed every click aimed at the switch.
 *
 * The symptom was a control that looked completely fine: it rendered correctly,
 * responded to hover, worked from the keyboard, and toggled when you clicked its
 * text label — but clicking the switch itself did nothing. `elementFromPoint`
 * over the input returned `span.thumb`, and a real mouse click left `checked`
 * unchanged on all six toggles.
 *
 * This is the same failure mode T-09 fixed in `hud.css` (see hud-css.test.ts):
 * an element that is invisible or purely decorative still eats input unless told
 * not to. Worth having both tests, because the two files are owned separately and
 * neither fix implies the other.
 *
 * As with hud-css.test.ts: there is no jsdom in this project, so real cascade and
 * hit-testing behaviour cannot be unit tested — that is what the Playwright
 * verification (real `page.mouse.click()` plus `elementFromPoint`, 5/5 including
 * persistence and a reload) covers. What runs under plain `npm test` is a literal
 * assertion on the rule text, which catches a future "cleanup" that drops it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  new URL("../src/styles/components.css", import.meta.url),
  "utf8",
);

/** Strip comments and collapse whitespace so assertions care about selectors and
 *  declarations, not formatting. Note the comment strip matters here: the fix is
 *  documented in a long comment that itself mentions `pointer-events`. */
function normalize(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const normalized = normalize(css);

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{[^}]*\\}`).exec(normalized);
  expect(
    match,
    `no rule found for \`${selector}\` in components.css`,
  ).not.toBeNull();
  return match![0];
}

describe("components.css — settings toggle click target", () => {
  it("the track does not intercept pointer events", () => {
    expect(ruleFor(".toggle .track")).toMatch(/pointer-events:\s*none/);
  });

  it("the thumb does not intercept pointer events", () => {
    // The thumb sits above the track and was the element elementFromPoint
    // actually returned, so this half is not redundant with the one above.
    expect(ruleFor(".toggle .thumb")).toMatch(/pointer-events:\s*none/);
  });

  it("the input itself still receives pointer events", () => {
    // The fix must not overshoot: if the input were also made inert, the switch
    // would still be unclickable, and every assertion above would still pass.
    const rule = ruleFor(".toggle input");
    expect(rule).not.toMatch(/pointer-events:\s*none/);
  });

  it("the input stays focusable — hidden with opacity, never display:none or visibility:hidden", () => {
    // `display: none` or `visibility: hidden` would take the checkbox out of the
    // tab order, breaking keyboard operation of the control and silently making
    // the settings screen unusable without a mouse.
    const rule = ruleFor(".toggle input");
    expect(rule).toMatch(/opacity:\s*0/);
    expect(rule).not.toMatch(/display:\s*none/);
    expect(rule).not.toMatch(/visibility:\s*hidden/);
  });

  it("the input still covers the visible switch, so the click lands where the user aims", () => {
    // The input is absolutely positioned at the track's exact size. If those
    // diverge, clicks near the edge of the visible switch miss the real control
    // even with pointer-events correct.
    const input = ruleFor(".toggle input");
    const track = ruleFor(".toggle .track");
    const size = (rule: string) => ({
      w: /width:\s*([\d.]+)px/.exec(rule)?.[1],
      h: /height:\s*([\d.]+)px/.exec(rule)?.[1],
    });
    expect(size(input)).toEqual(size(track));
  });
});
