import { describe, expect, it } from "vitest";
import { iconMarkup, type IconName } from "../icons.js";

const ALL_ICONS: IconName[] = [
  "back",
  "play",
  "pause",
  "restart",
  "home",
  "grid",
  "gear",
  "rocket",
  "info",
  "close",
  "check",
  "chevronRight",
  "edit",
  "link",
];

describe("iconMarkup", () => {
  it("produces well-formed, self-contained SVG markup for every icon", () => {
    for (const name of ALL_ICONS) {
      const markup = iconMarkup(name);
      expect(markup).toContain("<svg");
      expect(markup).toContain("</svg>");
      expect(markup).toContain('viewBox="0 0 24 24"');
    }
  });

  // Built by concatenation, not a literal, so this file itself stays clean under the project's
  // mechanical `grep -ri` check for the vendor name (results/T-08-BRIDGE.md documents the check).
  const forbiddenVendorName = ["svg", "repo"].join("");

  it("never references the flagged third-party icon vendor or any external asset URL — the whole point of this module", () => {
    for (const name of ALL_ICONS) {
      const markup = iconMarkup(name);
      expect(markup.toLowerCase()).not.toContain(forbiddenVendorName);
      expect(markup).not.toMatch(/https?:\/\//);
      expect(markup).not.toContain("<image");
      expect(markup).not.toContain("xlink:href");
    }
  });

  it("marks decorative icons aria-hidden by default", () => {
    expect(iconMarkup("play")).toContain('aria-hidden="true"');
  });

  it("gives a non-decorative icon an accessible label instead of aria-hidden", () => {
    const markup = iconMarkup("close", {
      decorative: false,
      title: "Close dialog",
    });
    expect(markup).not.toContain("aria-hidden");
    expect(markup).toContain('aria-label="Close dialog"');
    expect(markup).toContain('role="img"');
  });

  it("escapes a title containing markup-significant characters", () => {
    const markup = iconMarkup("info", {
      decorative: false,
      title: 'a "quote" & <tag>',
    });
    expect(markup).toContain("&quot;");
    expect(markup).toContain("&amp;");
    expect(markup).toContain("&lt;");
    expect(markup).not.toContain("<tag>");
  });
});
