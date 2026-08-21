/**
 * Lock-down for a repo-owner decision of 2026-08-20: **panning kept, right-click cancel declined.**
 *
 * The owner was asked whether right-click should cancel an armed placement. Doing so requires
 * ignoring non-left buttons in the editor's `mousedown`/`mouseup` handlers, because those handlers
 * do not filter on `ev.button` at all today — every mouse button behaves as the left one. That was
 * measured in a real browser before the question was asked: with "Place planet" armed, a
 * right-click on the canvas PLACED an object (the panel's object count went 2 -> 3), and a
 * right-drag pans exactly like a left-drag.
 *
 * The owner chose to keep that behaviour rather than gain the cancel: "No need for rebinding of any
 * clicks or anything." Escape remains the way to cancel an armed placement.
 *
 * So the absence of a button filter is now DELIBERATE, and this file exists so that a later
 * "cleanup" that adds one trips a test instead of silently reversing the decision.
 *
 * Two things to be honest about, both stated in the plan this came from
 * (notes/feat-editor-canvas-interaction/PLAN-INCREMENT-2.md, test 10):
 *
 *   - **This test passes today without any change.** It documents a decision rather than covering a
 *     fix, which AGENTS.md normally treats as a reason to refuse a test. It is here only because
 *     the decision was explicitly asked to be locked down.
 *   - It asserts on **literal source text**, not behaviour. `mountEditor` is where button handling
 *     lives and it has no unit coverage — there is no jsdom in this project, and the engine itself
 *     has no concept of mouse buttons (`pointerDown` takes a point). This is the same technique
 *     `ui-toggle-css.test.ts` and `hud-css.test.ts` use for the same reason, paired there as here
 *     with real Playwright verification.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("../src/editor/editor.ts", import.meta.url),
  "utf8",
);

describe("editor pointer handlers — owner decision: no mouse-button filtering", () => {
  it("does not filter on ev.button, so every button still places, drags and pans", () => {
    expect(SOURCE).toMatch(/function onPointerDown\(/);
    expect(SOURCE).toMatch(/function onPointerUp\(/);
    // Any `.button` reference in this file would be a filter on which mouse button was used.
    expect(SOURCE).not.toMatch(/\bev\.button\b/);
    expect(SOURCE).not.toMatch(/\bevent\.button\b/);
    expect(SOURCE).not.toMatch(/\bbutton\s*!==\s*0\b/);
    expect(SOURCE).not.toMatch(/\bbutton\s*===\s*[12]\b/);
  });

  it("registers no contextmenu handler, so the browser's own menu is left alone", () => {
    expect(SOURCE).not.toMatch(/["']contextmenu["']/);
    expect(SOURCE).not.toMatch(/\bpreventDefault\(\)[^\n]*contextmenu/);
  });

  it("keeps Escape as the documented way to cancel an armed placement", () => {
    expect(SOURCE).toMatch(/ev\.key === "Escape"/);
    expect(SOURCE).toMatch(/cancelPlace\(\)/);
  });
});
