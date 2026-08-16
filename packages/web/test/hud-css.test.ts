/**
 * T-09 GAUGE — regression coverage for the pointer-events fix in `hud.css`
 * (see notes/T-09-GAUGE/log.md's 2026-08-16 "follow-up" entry and results/T-09-GAUGE.md's
 * "Follow-ups" section for the full story: T-08 BRIDGE's integration pass found that
 * `.sb-pause-root`/`.sb-complete-root` — both always-mounted, `position:absolute;inset:0`, and
 * normally EMPTY while their panel isn't showing — had no `pointer-events:none`, so an inactive
 * root silently occluded clicks meant for whatever was underneath, confirmed on the FIRST pause of
 * any session).
 *
 * `vitest` has no browser/layout engine in this project (no jsdom — see hud/__tests__/fakeDom.ts's
 * own doc comment), so `pointer-events` cascade/inheritance behaviour genuinely cannot be unit
 * tested; that's what the real-click-dispatch + `elementFromPoint` Playwright verification (logged
 * in notes/T-09-GAUGE/log.md, transcribed in results/T-09-GAUGE.md) is for. What CAN run under
 * plain `npm test`, with no browser, and will catch a careless future revert of the CSS text itself
 * (e.g. someone "cleaning up" the file and dropping the rule), is a direct assertion on the actual
 * rule text — deliberately narrow and literal, not a CSS parser, but precise enough to fail loudly
 * if either half of the fix (the `none` default or the `auto` re-enable) goes missing or is
 * reworded to target the wrong selector.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cssPath = new URL("../src/hud/hud.css", import.meta.url);
const css = readFileSync(cssPath, "utf8");

/** Strips comments and collapses whitespace so the assertions below don't care about exact
 *  formatting/line-wrapping, only which selectors are paired with which declarations. */
function normalize(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const normalized = normalize(css);

describe("hud.css — pause/complete root pointer-events fix", () => {
  it("both roots default to pointer-events:none (the actual root cause of the click-through bug)", () => {
    // Matches `.sb-pause-root, .sb-complete-root { ... pointer-events: none; ... }` regardless of
    // property order or which other declarations share the block.
    const rule = /\.sb-pause-root\s*,\s*\.sb-complete-root\s*\{[^}]*\}/.exec(
      normalized,
    );
    expect(
      rule,
      "no combined .sb-pause-root/.sb-complete-root rule found at all",
    ).not.toBeNull();
    expect(rule![0]).toMatch(/pointer-events\s*:\s*none\s*;/);
  });

  it("pointer-events is re-enabled on each root's OWN active overlay child, not on the root itself", () => {
    const pauseChildRule =
      /\.sb-pause-root\s*>\s*\.overlay[^{]*\{[^}]*pointer-events\s*:\s*auto\s*;[^}]*\}/;
    const completeChildRule =
      /\.sb-complete-root\s*>\s*\.sb-complete-overlay[^{]*\{[^}]*pointer-events\s*:\s*auto\s*;[^}]*\}/;
    expect(
      normalized,
      "expected `.sb-pause-root > .overlay { ... pointer-events: auto; ... }` (or the same selector combined with the complete-root rule below)",
    ).toMatch(pauseChildRule);
    expect(
      normalized,
      "expected `.sb-complete-root > .sb-complete-overlay { ... pointer-events: auto; ... }`",
    ).toMatch(completeChildRule);
  });

  it("the re-enable selectors target the SAME class names pause.ts/complete.ts actually mount ('.overlay' from T-08's mountIngameMenu, '.sb-complete-overlay' from complete.ts's own show())", () => {
    // Cross-checks against the real source, not just internal consistency within hud.css — if
    // either module ever renames its root overlay class, this test (not just a live click) should
    // be the one that fails first.
    const pauseSource = readFileSync(
      new URL("../src/hud/pause.ts", import.meta.url),
      "utf8",
    );
    const completeSource = readFileSync(
      new URL("../src/hud/complete.ts", import.meta.url),
      "utf8",
    );
    expect(normalized).toContain(".sb-pause-root > .overlay");
    expect(pauseSource).toMatch(/mountIngameMenu/); // .overlay's real owner — sanity-checks the pairing
    expect(normalized).toContain(".sb-complete-root > .sb-complete-overlay");
    expect(completeSource).toMatch(
      /classList\.add\(["']sb-complete-overlay["']\)/,
    );
  });
});
