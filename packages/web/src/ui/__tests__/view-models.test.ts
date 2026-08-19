import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_LEVELS,
  customLevelId,
  levelId,
  type Level,
} from "@swingby/core";
import { createStorage } from "../../storage/index.js";
import {
  beatsPersonalBest,
  buildLevelList,
  codeLabel,
  firstIncompleteLevel,
  formatMs,
  isTypingTarget,
  resolveEditorTarget,
  resolveLevel,
  resolveRebindKey,
} from "../view-models.js";

// createStorage() falls back to an in-memory backing store when `localStorage` is undefined
// (confirmed by reading storage/index.ts) — no DOM/jsdom needed, and no hand-written Storage fake
// needed either; see notes/T-08-BRIDGE/log.md.

const TWO_LEVELS: Level[] = [
  { name: "Alpha", author: "A", goal: { index: 1, range: 50 }, objects: [] },
  { name: "Beta", author: "B", goal: { index: 1, range: 50 }, objects: [] },
];

describe("buildLevelList", () => {
  it("marks levels with a recorded best as completed, others not", () => {
    const storage = createStorage();
    storage.recordBest(levelId(0), { timeMs: 1000, boostMs: 100 });
    const { builtin } = buildLevelList(TWO_LEVELS, [], storage);
    expect(builtin[0]?.completed).toBe(true);
    expect(builtin[0]?.best).toEqual({ timeMs: 1000, boostMs: 100 });
    expect(builtin[1]?.completed).toBe(false);
    expect(builtin[1]?.best).toBeNull();
  });

  it("tags custom levels with isCustom and their content-derived id", () => {
    const storage = createStorage();
    const { custom } = buildLevelList([], TWO_LEVELS, storage);
    expect(custom).toHaveLength(2);
    expect(custom.every((c) => c.isCustom)).toBe(true);
    expect(custom[0]?.id).not.toBe(custom[1]?.id);
  });
});

describe("firstIncompleteLevel", () => {
  it("returns the first level when nothing is completed", () => {
    const storage = createStorage();
    expect(firstIncompleteLevel(TWO_LEVELS, storage)).toEqual({
      id: levelId(0),
      index: 0,
    });
  });

  it("skips completed levels and returns the first incomplete one", () => {
    const storage = createStorage();
    storage.recordBest(levelId(0), { timeMs: 1, boostMs: 1 });
    expect(firstIncompleteLevel(TWO_LEVELS, storage)).toEqual({
      id: levelId(1),
      index: 1,
    });
  });

  it("falls back to level 0 when every level is complete — always something to play", () => {
    const storage = createStorage();
    storage.recordBest(levelId(0), { timeMs: 1, boostMs: 1 });
    storage.recordBest(levelId(1), { timeMs: 1, boostMs: 1 });
    expect(firstIncompleteLevel(TWO_LEVELS, storage)).toEqual({
      id: levelId(0),
      index: 0,
    });
  });
});

describe("resolveLevel", () => {
  it("resolves a real built-in id — the exact deep-link case, builtin-07", () => {
    const resolved = resolveLevel("builtin-07", []);
    expect(resolved).not.toBeNull();
    expect(resolved?.isCustom).toBe(false);
    expect(resolved?.index).toBe(7);
    expect(resolved?.level).toBe(BUILTIN_LEVELS[7]);
  });

  it("resolves a custom level by its content-derived id", () => {
    const customs = [TWO_LEVELS[0] as Level];
    const id = customLevelId(customs[0] as Level);
    const resolved = resolveLevel(id, customs);
    expect(resolved).toEqual({ level: customs[0], index: 0, isCustom: true });
  });

  it("returns null for an id matching neither", () => {
    expect(resolveLevel("does-not-exist", [])).toBeNull();
  });
});

describe("resolveRebindKey", () => {
  it("Escape cancels", () => {
    expect(resolveRebindKey({ code: "Escape" })).toEqual({ cancel: true });
  });

  it("any other code is accepted as the new binding", () => {
    expect(resolveRebindKey({ code: "KeyJ" })).toEqual({
      cancel: false,
      code: "KeyJ",
    });
  });
});

describe("codeLabel", () => {
  it("labels known special codes", () => {
    expect(codeLabel("Space")).toBe("Space");
    expect(codeLabel("ShiftLeft")).toBe("Shift");
    expect(codeLabel("Escape")).toBe("Esc");
    expect(codeLabel("ArrowUp")).toBe("↑");
  });

  it("strips the Key/Digit prefix for letter and digit codes", () => {
    expect(codeLabel("KeyW")).toBe("W");
    expect(codeLabel("Digit7")).toBe("7");
  });

  it("passes an unrecognised code through unchanged", () => {
    expect(codeLabel("NumpadEnter")).toBe("NumpadEnter");
  });
});

describe("formatMs", () => {
  it("formats milliseconds as seconds to 3 decimal places", () => {
    expect(formatMs(12345)).toBe("12.345s");
    expect(formatMs(0)).toBe("0.000s");
  });
});

describe("beatsPersonalBest", () => {
  it("a first-ever completion (no prior best) always counts as a beat", () => {
    expect(beatsPersonalBest(null, { timeMs: 99999, boostMs: 99999 })).toBe(
      true,
    );
  });

  it("a strictly faster time beats, even with worse boost", () => {
    expect(
      beatsPersonalBest(
        { timeMs: 20000, boostMs: 1000 },
        { timeMs: 19999, boostMs: 1500 },
      ),
    ).toBe(true);
  });

  it("strictly less boost beats, even with a worse time", () => {
    expect(
      beatsPersonalBest(
        { timeMs: 20000, boostMs: 1000 },
        { timeMs: 20001, boostMs: 999 },
      ),
    ).toBe(true);
  });

  it("a strictly worse attempt on both metrics does not beat", () => {
    expect(
      beatsPersonalBest(
        { timeMs: 20000, boostMs: 1000 },
        { timeMs: 20001, boostMs: 1001 },
      ),
    ).toBe(false);
  });

  it("an exact tie on both metrics does not beat (matches storage's strict < comparison)", () => {
    expect(
      beatsPersonalBest(
        { timeMs: 20000, boostMs: 1000 },
        { timeMs: 20000, boostMs: 1000 },
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// feat/edit-current-level
// ---------------------------------------------------------------------------------------------

describe("resolveEditorTarget", () => {
  it("no param at all -> blank, the pre-existing /editor behaviour", () => {
    expect(resolveEditorTarget(undefined, [])).toEqual({ kind: "blank" });
  });

  it("an empty param -> blank rather than not-found", () => {
    // `/editor/` normalizes to `/editor` before matching, so this is belt-and-braces; a blank
    // stage is still the right answer for "no level was named" either way.
    expect(resolveEditorTarget("", [])).toEqual({ kind: "blank" });
  });

  it("a built-in id -> that exact level object", () => {
    const target = resolveEditorTarget("builtin-07", []);
    expect(target).toEqual({ kind: "level", level: BUILTIN_LEVELS[7] });
  });

  it("a custom level's content-derived id -> that level", () => {
    const customs = [TWO_LEVELS[0] as Level];
    const target = resolveEditorTarget(
      customLevelId(customs[0] as Level),
      customs,
    );
    expect(target).toEqual({ kind: "level", level: customs[0] });
  });

  it("REFUSES an unknown id — not-found, never a silent blank stage", () => {
    // The refusal that matters: falling back to a blank editor would quietly discard what the URL
    // asked for, and the author would not find out until they saved.
    expect(resolveEditorTarget("does-not-exist", [])).toEqual({
      kind: "not-found",
      id: "does-not-exist",
    });
  });

  it("REFUSES a custom id that is not in the list it was given", () => {
    const orphan = TWO_LEVELS[1] as Level;
    const id = customLevelId(orphan);
    expect(resolveEditorTarget(id, [TWO_LEVELS[0] as Level])).toEqual({
      kind: "not-found",
      id,
    });
  });

  it("REFUSES a shared-level key — /l/:shareId is out of scope by construction", () => {
    expect(resolveEditorTarget("shared:abc123", [])).toEqual({
      kind: "not-found",
      id: "shared:abc123",
    });
  });
});

describe("isTypingTarget", () => {
  it("is true for the three form tags a global hotkey must not steal keys from", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
  });

  it("is case-insensitive about the tag name", () => {
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
  });

  it("is true for a contentEditable host", () => {
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(
      true,
    );
  });

  it("is false for the play canvas, a button, and non-objects", () => {
    expect(isTypingTarget({ tagName: "CANVAS" })).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget("INPUT")).toBe(false);
  });

  it("matches game/input.ts's isEditableTarget, which it deliberately re-derives", () => {
    // Guards the duplication called out in both files: if one copy is changed, this fails.
    const source = readFileSync(
      new URL("../../game/input.ts", import.meta.url),
      "utf8",
    );
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(source).toContain(`"${tag}"`);
    }
    expect(source).toContain("isContentEditable");
  });
});
