import { describe, expect, it } from "vitest";
import type { Level } from "@swingby/core";
import {
  buildDuplicateCheckState,
  buildLevelExport,
  classifyImportEntry,
  levelContentHash,
  LEVEL_EXPORT_KIND,
  normalizeLevelName,
  parseLevelExportFile,
  registerImportedLevel,
} from "../levelExport.js";

function sampleLevel(name = "Slingshot", author = "Magnus"): Level {
  return {
    name,
    author,
    goal: { index: 1, range: 60 },
    objects: [
      { type: "player", x: 0, y: 0, gravity: 0 },
      { type: "sun", x: 500, y: 0, gravity: 900 },
    ],
  };
}

describe("buildLevelExport", () => {
  it("wraps levels with a createdAt looked up per level, and stamps the file metadata", () => {
    const a = sampleLevel("A");
    const b = sampleLevel("B");
    const file = buildLevelExport([a, b], (lvl) =>
      lvl.name === "A" ? "2026-01-01T00:00:00.000Z" : null,
    );
    expect(file.kind).toBe(LEVEL_EXPORT_KIND);
    expect(file.schemaVersion).toBe(1);
    expect(file.levels).toEqual([
      { level: a, createdAt: "2026-01-01T00:00:00.000Z" },
      { level: b, createdAt: null },
    ]);
  });
});

describe("parseLevelExportFile", () => {
  it("fails outright on invalid JSON", () => {
    const result = parseLevelExportFile("not json");
    expect(result.ok).toBe(false);
  });

  it("fails outright on a recognisable-but-wrong top-level shape", () => {
    const result = parseLevelExportFile(JSON.stringify({ foo: "bar" }));
    expect(result.ok).toBe(false);
  });

  it("parses this app's own wrapper shape, preserving createdAt", () => {
    const file = buildLevelExport(
      [sampleLevel()],
      () => "2026-02-02T00:00:00.000Z",
    );
    const result = parseLevelExportFile(JSON.stringify(file));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.malformed).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.createdAt).toBe("2026-02-02T00:00:00.000Z");
    expect(result.entries[0]?.level.name).toBe("Slingshot");
  });

  it("accepts a bare array of raw Level objects (foreign/hand-edited file), with null createdAt", () => {
    const result = parseLevelExportFile(JSON.stringify([sampleLevel("Bare")]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.createdAt).toBeNull();
  });

  it("drops individually malformed levels but still imports the functional ones", () => {
    const good = sampleLevel("Good");
    const badShape = { not: "a level" };
    const badValidation: Level = {
      name: "Bad goal",
      author: "X",
      goal: { index: -1, range: -5 }, // range must be > 0
      objects: [{ type: "player", x: 0, y: 0, gravity: 0 }],
    };
    const result = parseLevelExportFile(
      JSON.stringify({
        levels: [{ level: good }, badShape, { level: badValidation }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.level.name).toBe("Good");
    expect(result.malformed).toHaveLength(2);
  });
});

describe("levelContentHash", () => {
  it("is identical for the same content under a different name/author", () => {
    const a = sampleLevel("A", "Alice");
    const b = sampleLevel("B", "Bob");
    expect(levelContentHash(a)).toBe(levelContentHash(b));
  });

  it("differs when objects differ", () => {
    const a = sampleLevel("A");
    const b: Level = {
      ...sampleLevel("A"),
      objects: [
        ...sampleLevel("A").objects,
        { type: "planet", x: 10, y: 10, gravity: 5 },
      ],
    };
    expect(levelContentHash(a)).not.toBe(levelContentHash(b));
  });
});

describe("normalizeLevelName", () => {
  it("trims and lowercases", () => {
    expect(normalizeLevelName("  Slingshot  ")).toBe("slingshot");
  });
});

describe("duplicate detection", () => {
  it("classifies an unrelated level as new", () => {
    const state = buildDuplicateCheckState([sampleLevel("Existing")]);
    const unrelated: Level = {
      ...sampleLevel("Something else"),
      objects: [
        { type: "player", x: 7, y: 7, gravity: 0 },
        { type: "planet", x: 300, y: 100, gravity: 250 },
      ],
    };
    expect(classifyImportEntry(unrelated, state)).toBe("new");
  });

  it("classifies identical content (even renamed) as duplicate-content", () => {
    const state = buildDuplicateCheckState([sampleLevel("Existing", "Alice")]);
    const renamedCopy = sampleLevel("Renamed", "Bob");
    expect(classifyImportEntry(renamedCopy, state)).toBe("duplicate-content");
  });

  it("classifies same name, different content as duplicate-name (not duplicate-content)", () => {
    const existing = sampleLevel("Shared Name");
    const state = buildDuplicateCheckState([existing]);
    const differentLevel: Level = {
      ...sampleLevel("Shared Name"),
      objects: [
        { type: "player", x: 0, y: 0, gravity: 0 },
        { type: "planet", x: 999, y: 999, gravity: 50 },
      ],
    };
    expect(classifyImportEntry(differentLevel, state)).toBe("duplicate-name");
  });

  it("name match is case/whitespace-insensitive", () => {
    const state = buildDuplicateCheckState([sampleLevel("Shared Name")]);
    const differentLevel: Level = {
      ...sampleLevel("  shared name  "),
      objects: [{ type: "player", x: 1, y: 1, gravity: 0 }],
    };
    expect(classifyImportEntry(differentLevel, state)).toBe("duplicate-name");
  });

  it("registerImportedLevel makes later entries in the same batch conflict too", () => {
    const state = buildDuplicateCheckState([]);
    const first = sampleLevel("First");
    expect(classifyImportEntry(first, state)).toBe("new");
    registerImportedLevel(first, state);

    const duplicateOfFirst = {
      ...sampleLevel("Renamed"),
      objects: first.objects,
      goal: first.goal,
    };
    expect(classifyImportEntry(duplicateOfFirst, state)).toBe(
      "duplicate-content",
    );
  });
});
