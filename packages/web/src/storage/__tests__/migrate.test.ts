import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { customLevelId, type Level } from "@swingby/core";
import {
  importGodotScores,
  isPlainObject,
  looksLikeLevel,
  migrateBestsFile,
  migrateCustomLevelMetaFile,
  migrateCustomLevelsFile,
  migrateSettingsFile,
  sanitizePersonalBest,
} from "../migrate.js";

const FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/godot-scores.json", import.meta.url),
);
const GODOT_SCORES_JSON = readFileSync(FIXTURE_PATH, "utf-8");

const SAMPLE_CUSTOM_LEVEL: Level = {
  name: "Slingshot",
  author: "Magnus",
  goal: { index: 1, range: 60 },
  objects: [
    { type: "player", x: 0, y: 0, gravity: 0 },
    { type: "sun", x: 500, y: 0, gravity: 900 },
  ],
};

describe("isPlainObject", () => {
  it("accepts plain objects, rejects arrays/null/primitives", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject("x")).toBe(false);
    expect(isPlainObject(42)).toBe(false);
  });
});

describe("sanitizePersonalBest", () => {
  it("accepts a well-formed PersonalBest", () => {
    expect(sanitizePersonalBest({ timeMs: 100, boostMs: 20 })).toEqual({
      timeMs: 100,
      boostMs: 20,
    });
  });
  it("rejects non-numeric, negative, NaN, or missing fields", () => {
    expect(sanitizePersonalBest(null)).toBeNull();
    expect(sanitizePersonalBest([])).toBeNull();
    expect(sanitizePersonalBest({ timeMs: "100", boostMs: 20 })).toBeNull();
    expect(sanitizePersonalBest({ timeMs: -1, boostMs: 20 })).toBeNull();
    expect(sanitizePersonalBest({ timeMs: NaN, boostMs: 20 })).toBeNull();
    expect(sanitizePersonalBest({ timeMs: 100 })).toBeNull();
  });
});

describe("looksLikeLevel", () => {
  it("accepts the sample level and rejects obvious non-levels", () => {
    expect(looksLikeLevel(SAMPLE_CUSTOM_LEVEL)).toBe(true);
    expect(looksLikeLevel({})).toBe(false);
    expect(looksLikeLevel({ name: "x" })).toBe(false);
    expect(looksLikeLevel(null)).toBe(false);
    expect(looksLikeLevel([])).toBe(false);
  });
});

describe("migrateSettingsFile", () => {
  it("passes through an already-current-version wrapper", () => {
    const result = migrateSettingsFile({
      schemaVersion: 1,
      settings: { username: "Rae" },
    });
    expect(result).toEqual({ schemaVersion: 1, settings: { username: "Rae" } });
  });
  it("treats a bare unwrapped object as legacy/unversioned and wraps it", () => {
    const result = migrateSettingsFile({ username: "Rae" });
    expect(result).toEqual({ schemaVersion: 1, settings: { username: "Rae" } });
  });
  it("falls back to empty settings for garbage shapes (array, primitive, null, undefined)", () => {
    expect(migrateSettingsFile([1, 2, 3])).toEqual({
      schemaVersion: 1,
      settings: {},
    });
    expect(migrateSettingsFile("nope")).toEqual({
      schemaVersion: 1,
      settings: {},
    });
    expect(migrateSettingsFile(null)).toEqual({
      schemaVersion: 1,
      settings: {},
    });
    expect(migrateSettingsFile(undefined)).toEqual({
      schemaVersion: 1,
      settings: {},
    });
  });
});

describe("migrateBestsFile", () => {
  it("passes through a current-version wrapper, dropping malformed individual entries", () => {
    const result = migrateBestsFile({
      schemaVersion: 1,
      bests: {
        "builtin-00": { timeMs: 1000, boostMs: 200 },
        "builtin-01": { timeMs: "bad" },
      },
    });
    expect(result).toEqual({
      schemaVersion: 1,
      bests: { "builtin-00": { timeMs: 1000, boostMs: 200 } },
    });
  });
  it("falls back to empty bests for garbage shapes", () => {
    expect(migrateBestsFile([])).toEqual({ schemaVersion: 1, bests: {} });
    expect(migrateBestsFile("garbage")).toEqual({
      schemaVersion: 1,
      bests: {},
    });
  });
});

describe("migrateCustomLevelsFile", () => {
  it("accepts a bare array directly (matches Godot's own custom_levels.json shape)", () => {
    const result = migrateCustomLevelsFile([SAMPLE_CUSTOM_LEVEL]);
    expect(result).toEqual({ schemaVersion: 1, levels: [SAMPLE_CUSTOM_LEVEL] });
  });
  it("accepts a current-version wrapper and drops malformed individual levels", () => {
    const result = migrateCustomLevelsFile({
      schemaVersion: 1,
      levels: [SAMPLE_CUSTOM_LEVEL, { name: "broken" }],
    });
    expect(result).toEqual({ schemaVersion: 1, levels: [SAMPLE_CUSTOM_LEVEL] });
  });
  it("falls back to an empty list for garbage shapes (object where array expected)", () => {
    expect(migrateCustomLevelsFile({})).toEqual({
      schemaVersion: 1,
      levels: [],
    });
    expect(migrateCustomLevelsFile(null)).toEqual({
      schemaVersion: 1,
      levels: [],
    });
  });
});

describe("migrateCustomLevelMetaFile", () => {
  it("accepts a current-version wrapper and drops non-date-string entries", () => {
    const result = migrateCustomLevelMetaFile({
      schemaVersion: 1,
      createdAt: {
        "level-a": "2024-01-01T00:00:00.000Z",
        "level-b": "not a date",
        "level-c": 123,
      },
    });
    expect(result).toEqual({
      schemaVersion: 1,
      createdAt: { "level-a": "2024-01-01T00:00:00.000Z" },
    });
  });
  it("falls back to an empty map for garbage shapes", () => {
    expect(migrateCustomLevelMetaFile({})).toEqual({
      schemaVersion: 1,
      createdAt: {},
    });
    expect(migrateCustomLevelMetaFile(null)).toEqual({
      schemaVersion: 1,
      createdAt: {},
    });
    expect(migrateCustomLevelMetaFile([1, 2, 3])).toEqual({
      schemaVersion: 1,
      createdAt: {},
    });
  });
});

describe("importGodotScores — real fixture (packages/web/src/storage/__tests__/fixtures/godot-scores.json)", () => {
  it("maps builtin_N entries onto levelId(N) with correct seconds->ms conversion, without opts.customLevels", () => {
    const result = importGodotScores(GODOT_SCORES_JSON);

    // builtin_0 -> levelId(0) === "builtin-00" (0-indexed, per @swingby/core's level.ts).
    expect(result.bests["builtin-00"]).toEqual({
      timeMs: 12345,
      boostMs: 3200,
    });
    // builtin_4 -> levelId(4) === "builtin-04".
    expect(result.bests["builtin-04"]).toEqual({
      timeMs: 45600,
      boostMs: 9750,
    });

    // custom_0 / custom_1 can't be resolved without the matching custom_levels.json content, so
    // without opts.customLevels they must be skipped, not guessed at.
    expect(
      Object.keys(result.bests).some((id) => id.startsWith("custom")),
    ).toBe(false);
  });

  it("skips and explains every entry it cannot map", () => {
    const result = importGodotScores(GODOT_SCORES_JSON);
    const reasons = Object.fromEntries(
      result.skipped.map((s) => [s.key, s.reason]),
    );

    expect(reasons["weird_7"]).toMatch(/unrecognised score_key/);
    expect(reasons["builtin_2"]).toMatch(/numeric time/);
    expect(reasons["custom_0"]).toMatch(/opts.customLevels/);
    expect(reasons["custom_1"]).toMatch(/opts.customLevels/);
  });

  it("resolves custom_N entries when the matching custom_levels.json array is supplied", () => {
    const customLevels: Level[] = [SAMPLE_CUSTOM_LEVEL];
    const result = importGodotScores(GODOT_SCORES_JSON, { customLevels });
    const id = customLevelId(SAMPLE_CUSTOM_LEVEL);

    expect(result.bests[id]).toEqual({ timeMs: 20000, boostMs: 5500 });
    // custom_1 still has no matching array entry (array has length 1) -> still skipped.
    expect(result.skipped.some((s) => s.key === "custom_1")).toBe(true);
  });

  it("the 'efficient' bucket's field named \"time\" maps to boostMs, never timeMs (the documented Godot gotcha)", () => {
    const result = importGodotScores(GODOT_SCORES_JSON);
    const best = result.bests["builtin-00"];
    // fastest.builtin_0.time === 12.345s, efficient.builtin_0.time === 3.2s. If the two ever got
    // swapped or conflated, boostMs would equal timeMs here — they must not.
    expect(best?.timeMs).not.toBe(best?.boostMs);
    expect(best).toEqual({ timeMs: 12345, boostMs: 3200 });
  });

  it("never throws on garbage or unrelated-shape JSON", () => {
    expect(() => importGodotScores("{{{not json")).not.toThrow();
    expect(importGodotScores("{{{not json")).toEqual({
      bests: {},
      mapped: 0,
      skipped: [],
    });
    expect(() => importGodotScores("[1,2,3]")).not.toThrow();
    expect(importGodotScores("[1,2,3]")).toEqual({
      bests: {},
      mapped: 0,
      skipped: [],
    });
  });

  it("reports mapped count matching the number of successfully-resolved score_key entries", () => {
    const result = importGodotScores(GODOT_SCORES_JSON, {
      customLevels: [SAMPLE_CUSTOM_LEVEL],
    });
    // builtin_0, builtin_4, custom_0 all resolve; builtin_2, custom_1, weird_7 do not.
    expect(result.mapped).toBe(3);
  });
});
