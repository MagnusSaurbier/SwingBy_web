/**
 * T-08 BRIDGE — credits copy is factual attribution of real people, so it gets literal, character-
 * exact coverage: the table below is transcribed from the repo owner's supplied credits and any
 * drift (a dropped section, a reordered line, a misspelled name) fails the suite.
 *
 * There is no jsdom in this project (see hud/__tests__/fakeDom.ts's doc comment), so the render is
 * driven against T-09's hand-rolled fake DOM — the same fake `ui/dom.ts` is already exercised
 * against via `mountIngameMenu` in the hud tests. Imported read-only, not modified.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeDom,
  type FakeElement,
} from "../../hud/__tests__/fakeDom.js";
import { renderCredits, CREDIT_SECTIONS } from "../screens/credits.js";
import type { ScreenCtx } from "../screen.js";

/** The authoritative credits, as supplied. Order matters; spelling matters most. */
const EXPECTED: readonly (readonly [string, string])[] = [
  ["A Game by", "Magnus Saurbier"],
  ["Original 2020 Version (Pygame)", "Magnus Saurbier"],
  ["Levels", "Magnus Saurbier"],
  ["Godot and Swift Versions", "Mirza Polat and Magnus Saurbier"],
  ["New Graphic Design", "Mirza Polat"],
  ["Sound Design", "Mirza Polat"],
  ["Original Earth Pixel Art", "Tom Kailing"],
  ["Web Version", "Magnus Saurbier"],
  [
    "Big Thanks for Feedback, Input and Ideas",
    "Mirza Polat, Marcel Hagemann, Laurens Peter, Jonathan Deul, Tom Kailing",
  ],
];

const CLAUDE_NOTE = "Claude assisted with the Godot, Swift, and web versions.";
const CLOSING = "Thank you for playing.";

let fakeDoc: ReturnType<typeof createFakeDom>;

beforeEach(() => {
  fakeDoc = createFakeDom();
  vi.stubGlobal("document", fakeDoc);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function render(): FakeElement {
  return renderCredits({} as ScreenCtx).el as unknown as FakeElement;
}

/** Depth-first collection of every element carrying `cls` in its class list. */
function byClass(root: FakeElement, cls: string): FakeElement[] {
  const out: FakeElement[] = [];
  const walk = (el: FakeElement): void => {
    if (el.classList.contains(cls)) out.push(el);
    for (const child of el.children) walk(child);
  };
  walk(root);
  return out;
}

describe("credits data", () => {
  it("lists exactly the nine supplied sections, in order, spelled as supplied", () => {
    expect(CREDIT_SECTIONS.map((s) => [...s])).toEqual(
      EXPECTED.map((s) => [...s]),
    );
  });

  it("does not reintroduce the old, wrong Godot-origin / level-count copy", () => {
    const flat = CREDIT_SECTIONS.flat().join(" ");
    expect(flat).not.toMatch(/33/);
    expect(flat).not.toMatch(/hand-verified/i);
  });
});

describe("renderCredits", () => {
  it("renders every section as a role heading plus its names", () => {
    const el = render();
    const roles = byClass(el, "credits-role").map((n) => n.textContent);
    const names = byClass(el, "names").map((n) => n.textContent);
    expect(roles).toEqual(EXPECTED.map(([role]) => role));
    expect(names).toEqual(EXPECTED.map(([, people]) => people));
  });

  it("keeps the SwingBy game-name heading", () => {
    const el = render();
    expect(byClass(el, "game-name").map((n) => n.textContent)).toEqual([
      "SwingBy",
    ]);
  });

  it("renders the Claude note as a quiet footnote, not a credited section", () => {
    const el = render();
    const note = byClass(el, "credits-note");
    expect(note).toHaveLength(1);
    expect(note[0]?.textContent).toBe(CLAUDE_NOTE);
    // It must not be one of the credited-contributor entries.
    expect(note[0]?.classList.contains("names")).toBe(false);
    expect(byClass(el, "credits-role").map((n) => n.textContent)).not.toContain(
      CLAUDE_NOTE,
    );
  });

  it("closes with the thank-you line", () => {
    const el = render();
    expect(byClass(el, "thanks").map((n) => n.textContent)).toEqual([CLOSING]);
  });

  it("keeps a Back to menu link pointing at the menu route", () => {
    const el = render();
    const links = byClass(el, "btn-ghost");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("/");
    expect(links[0]?.textContent).toContain("Back to menu");
  });
});

describe("CREDITS.md", () => {
  const md = readFileSync(
    new URL("../../../../../CREDITS.md", import.meta.url),
    "utf8",
  );

  it("carries the same headings and names as the screen", () => {
    for (const [role, people] of EXPECTED) {
      expect(md).toContain(`## ${role}`);
      expect(md).toContain(people);
    }
  });

  it("records the project lineage and the Claude note", () => {
    expect(md).toContain("May 2020");
    expect(md).toContain("May 2026");
    expect(md).toContain("August 2026");
    expect(md).toContain(CLAUDE_NOTE);
  });
});

describe("screens.css credits rules", () => {
  const css = readFileSync(
    new URL("../../styles/screens.css", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, " ");

  it("keeps the card growing with its content so the page scrolls instead of clipping", () => {
    const screenRule = /\.credits-screen\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(screenRule).toMatch(/min-height:/);
    expect(screenRule).not.toMatch(/(^|[^-])height:\s*100/);
    expect(screenRule).not.toMatch(/overflow:\s*hidden/);
  });

  it("styles the Claude note as muted and smaller than the credited names", () => {
    const noteRule =
      /\.credits-card\s+\.credits-note\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(noteRule).toMatch(/color:\s*var\(--text-muted\)/);
    const noteSize = Number(/font-size:\s*([\d.]+)rem/.exec(noteRule)?.[1]);
    const namesRule =
      /\.credits-card\s+\.names\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const namesSize = Number(/font-size:\s*([\d.]+)rem/.exec(namesRule)?.[1]);
    expect(noteSize).toBeGreaterThan(0);
    expect(namesSize).toBeGreaterThan(noteSize);
  });
});
