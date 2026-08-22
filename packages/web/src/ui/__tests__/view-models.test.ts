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
  MIN_STAR_SIZE_MAX,
  MIN_STAR_SIZE_MIN,
} from "../../render/starfield.js";
import {
  DEFAULT_EDIT_LEVEL_HOTKEY,
  MIN_STAR_SIZE_SLIDER_STEPS,
  applePlatform,
  beatsPersonalBest,
  buildLevelList,
  chordLabel,
  codeLabel,
  firstIncompleteLevel,
  formatChord,
  formatMs,
  isModifierCode,
  isTypingTarget,
  matchesChord,
  minStarSizeToSlider,
  parseChord,
  resolveEditorTarget,
  resolveHotkeyCapture,
  resolveLevel,
  resolveRebindKey,
  sliderToMinStarSize,
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

// ---------------------------------------------------------------------------------------------
// Chord key bindings
// ---------------------------------------------------------------------------------------------

/** A `ChordEvent` with everything released unless overridden. */
function ev(
  code: string,
  mods: Partial<{
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
  }> = {},
) {
  return {
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  };
}

const OPT_CMD_E = { altKey: true, metaKey: true };

describe("parseChord / formatChord", () => {
  it("parses the default binding", () => {
    expect(parseChord("Alt+Meta+KeyE")).toEqual({
      ctrl: false,
      alt: true,
      shift: false,
      meta: true,
      code: "KeyE",
    });
  });

  it("parses a bare key as a chord with no modifiers", () => {
    expect(parseChord("KeyR")).toEqual({
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      code: "KeyR",
    });
  });

  it("round-trips every ordering of all four modifiers to one canonical spelling", () => {
    const all = {
      ctrl: true,
      alt: true,
      shift: true,
      meta: true,
      code: "KeyE",
    };
    expect(formatChord(all)).toBe("Ctrl+Alt+Shift+Meta+KeyE");
    expect(parseChord(formatChord(all))).toEqual(all);
  });

  it("REFUSES modifiers out of canonical order — one chord, one spelling", () => {
    expect(parseChord("Meta+Alt+KeyE")).toBeNull();
    expect(parseChord("Shift+Ctrl+KeyE")).toBeNull();
  });

  it("REFUSES a repeated modifier", () => {
    expect(parseChord("Alt+Alt+KeyE")).toBeNull();
  });

  it("REFUSES an unknown modifier name", () => {
    expect(parseChord("Cmd+KeyE")).toBeNull();
    expect(parseChord("Option+KeyE")).toBeNull();
  });

  it("REFUSES a modifier used as the key, and an empty key", () => {
    expect(parseChord("Alt+Meta")).toBeNull();
    expect(parseChord("Alt+Meta+MetaLeft")).toBeNull();
    expect(parseChord("Alt+Meta+")).toBeNull();
    expect(parseChord("")).toBeNull();
  });
});

describe("matchesChord", () => {
  it("fires on the exact chord", () => {
    expect(matchesChord(ev("KeyE", OPT_CMD_E), DEFAULT_EDIT_LEVEL_HOTKEY)).toBe(
      true,
    );
  });

  it("REFUSES an extra modifier held on top — the most important refusal here", () => {
    // A chord that fired on "at least these modifiers" would swallow every richer chord the OS,
    // the browser or a future binding owns. With a two-modifier default this is also the case most
    // likely to regress, which is why it is asserted for all three extra modifiers.
    expect(
      matchesChord(
        ev("KeyE", { ...OPT_CMD_E, ctrlKey: true }),
        DEFAULT_EDIT_LEVEL_HOTKEY,
      ),
    ).toBe(false);
    expect(
      matchesChord(
        ev("KeyE", { ...OPT_CMD_E, shiftKey: true }),
        DEFAULT_EDIT_LEVEL_HOTKEY,
      ),
    ).toBe(false);
    expect(
      matchesChord(
        ev("KeyE", {
          ctrlKey: true,
          altKey: true,
          shiftKey: true,
          metaKey: true,
        }),
        DEFAULT_EDIT_LEVEL_HOTKEY,
      ),
    ).toBe(false);
  });

  it("REFUSES a missing modifier", () => {
    expect(
      matchesChord(ev("KeyE", { altKey: true }), DEFAULT_EDIT_LEVEL_HOTKEY),
    ).toBe(false);
    expect(
      matchesChord(ev("KeyE", { metaKey: true }), DEFAULT_EDIT_LEVEL_HOTKEY),
    ).toBe(false);
    expect(matchesChord(ev("KeyE"), DEFAULT_EDIT_LEVEL_HOTKEY)).toBe(false);
  });

  it("REFUSES the right modifiers with the wrong key", () => {
    expect(matchesChord(ev("KeyD", OPT_CMD_E), DEFAULT_EDIT_LEVEL_HOTKEY)).toBe(
      false,
    );
    expect(matchesChord(ev("KeyR", OPT_CMD_E), DEFAULT_EDIT_LEVEL_HOTKEY)).toBe(
      false,
    );
  });

  it("REFUSES to match anything at all on a malformed or empty binding", () => {
    expect(matchesChord(ev("KeyE", OPT_CMD_E), "Cmd+Opt+KeyE")).toBe(false);
    expect(matchesChord(ev("KeyE"), "")).toBe(false);
    expect(matchesChord(ev("KeyE", OPT_CMD_E), "Meta+Alt+KeyE")).toBe(false);
  });

  it("matches a bare-key binding, and only when no modifier is held", () => {
    expect(matchesChord(ev("KeyR"), "KeyR")).toBe(true);
    expect(matchesChord(ev("KeyR", { shiftKey: true }), "KeyR")).toBe(false);
  });
});

describe("resolveHotkeyCapture", () => {
  it("commits a full chord, canonicalised", () => {
    expect(resolveHotkeyCapture(ev("KeyE", OPT_CMD_E))).toEqual({
      kind: "bind",
      binding: "Alt+Meta+KeyE",
    });
    // Same chord, modifiers observed in a different mental order — one spelling out.
    expect(
      resolveHotkeyCapture(ev("KeyE", { metaKey: true, altKey: true })),
    ).toEqual({
      kind: "bind",
      binding: "Alt+Meta+KeyE",
    });
  });

  it("commits a bare key", () => {
    expect(resolveHotkeyCapture(ev("KeyR"))).toEqual({
      kind: "bind",
      binding: "KeyR",
    });
  });

  it("cancels on Escape, with or without modifiers held", () => {
    expect(resolveHotkeyCapture(ev("Escape"))).toEqual({ kind: "cancel" });
    expect(resolveHotkeyCapture(ev("Escape", OPT_CMD_E))).toEqual({
      kind: "cancel",
    });
  });

  it("REFUSES to commit a modifier pressed on its own — the user is mid-chord", () => {
    // Without this the capture would bind "Option" the instant it went down, and a chord could
    // never be entered at all.
    for (const code of [
      "AltLeft",
      "AltRight",
      "MetaLeft",
      "MetaRight",
      "ControlLeft",
      "ControlRight",
      "ShiftLeft",
      "ShiftRight",
    ]) {
      expect(resolveHotkeyCapture(ev(code, { altKey: true }))).toEqual({
        kind: "pending",
      });
      expect(isModifierCode(code)).toBe(true);
    }
  });
});

describe("chordLabel", () => {
  it("renders the macOS glyphs in macOS order, unseparated", () => {
    expect(chordLabel("Alt+Meta+KeyE", { apple: true })).toBe("\u2325\u2318E");
    expect(chordLabel("Ctrl+Alt+Shift+Meta+KeyE", { apple: true })).toBe(
      "\u2303\u2325\u21e7\u2318E",
    );
  });

  it("spells the modifiers out everywhere else", () => {
    expect(chordLabel("Alt+Meta+KeyE", { apple: false })).toBe("Alt+Meta+E");
    expect(chordLabel("KeyR", { apple: false })).toBe("R");
  });

  it("reuses codeLabel for the key half, so it agrees with the other 11 buttons", () => {
    expect(chordLabel("Ctrl+Space", { apple: false })).toBe("Ctrl+Space");
    expect(chordLabel("Alt+ArrowUp", { apple: false })).toBe("Alt+\u2191");
    expect(chordLabel("F1", { apple: false })).toBe("F1");
  });

  it("renders a malformed binding as Unbound rather than raw garbage", () => {
    expect(chordLabel("Cmd+E", { apple: true })).toBe("Unbound");
    expect(chordLabel("", { apple: false })).toBe("Unbound");
  });
});

describe("applePlatform", () => {
  it("is true for mac and iOS platform strings", () => {
    expect(applePlatform("MacIntel")).toBe(true);
    expect(
      applePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
    ).toBe(true);
    expect(applePlatform("iPhone")).toBe(true);
    expect(applePlatform("iPad")).toBe(true);
  });

  it("is false for Windows, Linux and an empty hint", () => {
    expect(applePlatform("Win32")).toBe(false);
    expect(applePlatform("Linux x86_64")).toBe(false);
    expect(applePlatform("")).toBe(false);
  });
});

describe("DEFAULT_EDIT_LEVEL_HOTKEY", () => {
  it("is a well-formed chord", () => {
    expect(parseChord(DEFAULT_EDIT_LEVEL_HOTKEY)).not.toBeNull();
    expect(formatChord(parseChord(DEFAULT_EDIT_LEVEL_HOTKEY)!)).toBe(
      DEFAULT_EDIT_LEVEL_HOTKEY,
    );
  });

  it("is Option+Command+E, and deliberately NOT Option+Command+D", () => {
    // Apple documents Option-Command-D as the system "Show or hide the Dock" shortcut, so macOS
    // claims it before a page ever sees the keydown. The repo owner chose E once that was raised.
    // This test exists so nobody "restores" the original request without re-reading why.
    expect(DEFAULT_EDIT_LEVEL_HOTKEY).toBe("Alt+Meta+KeyE");
    expect(DEFAULT_EDIT_LEVEL_HOTKEY).not.toBe("Alt+Meta+KeyD");
  });
});

describe("sliderToMinStarSize / minStarSizeToSlider", () => {
  it("map the slider's two endpoints onto the range's two endpoints", () => {
    expect(sliderToMinStarSize(0)).toBeCloseTo(MIN_STAR_SIZE_MIN, 9);
    expect(sliderToMinStarSize(MIN_STAR_SIZE_SLIDER_STEPS)).toBeCloseTo(
      MIN_STAR_SIZE_MAX,
      9,
    );
  });

  it("is logarithmic, not linear: the midpoint slider position lands on the geometric mean, not the arithmetic mean", () => {
    const mid = sliderToMinStarSize(MIN_STAR_SIZE_SLIDER_STEPS / 2);
    const geometricMean = Math.sqrt(MIN_STAR_SIZE_MIN * MIN_STAR_SIZE_MAX);
    const arithmeticMean = (MIN_STAR_SIZE_MIN + MIN_STAR_SIZE_MAX) / 2;
    expect(mid).toBeCloseTo(geometricMean, 6);
    expect(Math.abs(mid - arithmeticMean)).toBeGreaterThan(0.1);
  });

  it("minStarSizeToSlider is the inverse of sliderToMinStarSize at every integer step", () => {
    for (let s = 0; s <= MIN_STAR_SIZE_SLIDER_STEPS; s++) {
      expect(minStarSizeToSlider(sliderToMinStarSize(s))).toBe(s);
    }
  });

  it("clamps out-of-range slider positions instead of extrapolating", () => {
    expect(sliderToMinStarSize(-50)).toBeCloseTo(MIN_STAR_SIZE_MIN, 9);
    expect(sliderToMinStarSize(MIN_STAR_SIZE_SLIDER_STEPS + 50)).toBeCloseTo(
      MIN_STAR_SIZE_MAX,
      9,
    );
  });

  it("is monotonically increasing", () => {
    let prev = -Infinity;
    for (let s = 0; s <= MIN_STAR_SIZE_SLIDER_STEPS; s++) {
      const v = sliderToMinStarSize(s);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});
