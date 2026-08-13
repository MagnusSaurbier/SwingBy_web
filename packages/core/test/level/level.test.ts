import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BUILTIN_LEVELS,
  LevelError,
  customLevelId,
  hydrate,
  levelId,
  serialize,
  validate,
} from "../../src/level.js";
import { DEFAULT_BODY_SIZE } from "../../src/constants.js";
import type { Level, LevelObject } from "../../src/types.js";

/** Deep clone via structured JSON round trip — used to mutate a fixture without aliasing. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// A hand-authored level whose optional-field presence already matches what serialize() reproduces
// (see level.ts's serializeObject doc comment) — used to check both hydrate() defaults AND that a
// non-builtin, hand-authored level round-trips exactly, not just the 33 builtins.
const minimalFixture: Level = {
  name: "Minimal Fixture",
  author: "T-03 ATLAS",
  goal: { index: 1, range: 30 },
  objects: [
    { type: "player", x: 0, y: 0, x_vel: 0, y_vel: 0, gravity: 0 },
    { type: "sun", x: 300, y: 300, gravity: 800, visible: true, size: 18 },
    { type: "planet", x: 600, y: 600, x_vel: 0, y_vel: 0, gravity: 25, size: 9 },
  ],
};

// A second fixture that deliberately exercises every "non-default, must survive round trip" branch:
// anchored:true, an explicit turn_speed override, a non-zero boost_type, and both visible:true and
// visible:false suns.
const richFixture: Level = {
  name: "Round Trip Fixture",
  author: "T-03 ATLAS",
  goal: { index: 2, range: 40 },
  objects: [
    { type: "player", x: 10, y: 20, x_vel: 1.5, y_vel: -0.5, gravity: 0, boost_type: 2 },
    { type: "sun", x: 200, y: 200, gravity: 500, visible: false, size: 22 },
    { type: "sun", x: 250, y: 150, gravity: 400, visible: true, size: 14 },
    {
      type: "planet",
      x: 400,
      y: 400,
      x_vel: 0.2,
      y_vel: 0.1,
      gravity: 30,
      size: 12,
      anchored: true,
      turn_speed: -2.5,
    },
    { type: "planet", x: 700, y: 700, x_vel: 0, y_vel: 0, gravity: 20, size: DEFAULT_BODY_SIZE },
  ],
};

describe("BUILTIN_LEVELS", () => {
  it("has exactly 33 levels", () => {
    expect(BUILTIN_LEVELS.length).toBe(33);
  });

  it("every built-in level passes validate()", () => {
    const failures: string[] = [];
    BUILTIN_LEVELS.forEach((level, index) => {
      const result = validate(level);
      if (!result.ok) {
        failures.push(`[${index}] ${level.name}: ${result.errors.join("; ")}`);
      }
    });
    expect(failures).toEqual([]);
  });

  it("is byte-identical to the Godot reference (copied verbatim, never reformatted)", () => {
    const oursPath = new URL("../../src/levels.json", import.meta.url);
    const referencePath = new URL(
      "../../../../reference/godot/data/levels_builtin.json",
      import.meta.url,
    );
    const ours = readFileSync(oursPath, "utf8");
    const reference = readFileSync(referencePath, "utf8");
    expect(ours).toBe(reference);
  });

  // One `it` per level for granular pass/fail reporting — deep-equal round trip is the whole point
  // of the persisted<->runtime boundary (PROJECT.md §4, INTERFACES.md core/level.ts).
  BUILTIN_LEVELS.forEach((level, index) => {
    it(`round-trips level ${index} (${level.name}): serialize(hydrate(l)) deep-equals l`, () => {
      const world = hydrate(level);
      const restored = serialize(world, { name: level.name, author: level.author });
      expect(restored).toEqual(level);
    });
  });
});

describe("hydrate() defaults", () => {
  it("fills x_vel/y_vel default 0 when absent", () => {
    const level: Level = clone(minimalFixture);
    delete (level.objects[2] as LevelObject).x_vel;
    delete (level.objects[2] as LevelObject).y_vel;
    const world = hydrate(level);
    expect(world.bodies[2]?.xVel).toBe(0);
    expect(world.bodies[2]?.yVel).toBe(0);
  });

  it("fills size default DEFAULT_BODY_SIZE (10) when absent, for every body type", () => {
    const world = hydrate(minimalFixture);
    // player omits size in the fixture (matches the reference data's own convention).
    expect(world.bodies[0]?.size).toBe(DEFAULT_BODY_SIZE);
    expect(DEFAULT_BODY_SIZE).toBe(10);
  });

  it("fills visible default true when absent", () => {
    const level: Level = clone(minimalFixture);
    // planet never carries `visible` in practice, but the Body always needs a value.
    const world = hydrate(level);
    expect(world.bodies[2]?.visible).toBe(true);
  });

  it("fills anchored default false when absent", () => {
    const world = hydrate(minimalFixture);
    expect(world.bodies[2]?.anchored).toBe(false);
  });

  it("fills boost_type default 0 when absent (player)", () => {
    const world = hydrate(minimalFixture);
    expect(world.bodies[0]?.boostType).toBe(0);
  });

  it("preserves an explicit boost_type unchanged, including values outside 0-3", () => {
    const world = hydrate(richFixture);
    expect(world.bodies[0]?.boostType).toBe(2);
  });

  it("initialises angle, xAcc, yAcc to 0 and isBoosting/isBraking to false for every body", () => {
    const world = hydrate(richFixture);
    for (const body of world.bodies) {
      expect(body.angle).toBe(0);
      expect(body.xAcc).toBe(0);
      expect(body.yAcc).toBe(0);
      expect(body.isBoosting).toBe(false);
      expect(body.isBraking).toBe(false);
    }
  });

  it("computes turn_speed via the deterministic synthetic default when absent (no Math.random)", () => {
    const world = hydrate(minimalFixture);
    // index 0: -2.0 - (0 * 0.37 % 1) = -2.0
    expect(world.bodies[0]?.turnSpeed).toBeCloseTo(-2.0, 10);
    // index 2: -2.0 - (2 * 0.37 % 1) = -2.0 - 0.74 = -2.74
    expect(world.bodies[2]?.turnSpeed).toBeCloseTo(-2.74, 10);
  });

  it("preserves an explicit turn_speed unchanged (does not override with the synthetic default)", () => {
    const world = hydrate(richFixture);
    expect(world.bodies[3]?.turnSpeed).toBe(-2.5);
  });

  it("hydrate() output is deterministic — two calls on the same level produce identical bodies", () => {
    const a = hydrate(minimalFixture);
    const b = hydrate(minimalFixture);
    expect(a).toEqual(b);
  });

  it("level.ts source never CALLS Math.random (packages/core is deterministic by contract)", () => {
    // Checks for an actual invocation `Math.random(`, not the bare substring — level.ts's own doc
    // comments mention "Math.random" by name (explaining why it's avoided), which would otherwise
    // false-positive this check.
    const src = readFileSync(new URL("../../src/level.ts", import.meta.url), "utf8");
    expect(src.includes("Math.random(")).toBe(false);
  });
});

describe("hand-authored levels round-trip exactly (not just the 33 builtins)", () => {
  it("minimalFixture", () => {
    const world = hydrate(minimalFixture);
    const restored = serialize(world, { name: minimalFixture.name, author: minimalFixture.author });
    expect(restored).toEqual(minimalFixture);
  });

  it("richFixture (anchored, explicit turn_speed, non-zero boost_type, mixed sun visibility)", () => {
    const world = hydrate(richFixture);
    const restored = serialize(world, { name: richFixture.name, author: richFixture.author });
    expect(restored).toEqual(richFixture);
  });
});

describe("validate() — accepts", () => {
  it("minimalFixture and richFixture", () => {
    expect(validate(minimalFixture)).toEqual({ ok: true });
    expect(validate(richFixture)).toEqual({ ok: true });
  });
});

describe("validate() — rejects, one case per rule, never throws", () => {
  it("rejects a level with no player object", () => {
    const level: Level = clone(minimalFixture);
    level.objects[0] = { type: "planet", x: 0, y: 0, x_vel: 0, y_vel: 0, gravity: 0, size: 10 };
    level.goal = { index: 1, range: 30 };
    const result = validate(level);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /exactly one player/.test(e))).toBe(true);
    }
  });

  it("rejects a level with two player objects", () => {
    const level: Level = clone(minimalFixture);
    level.objects.push({ type: "player", x: 50, y: 50, x_vel: 0, y_vel: 0, gravity: 0 });
    const result = validate(level);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /exactly one player \(found 2\)|exactly one player object is required \(found 2\)/.test(e))).toBe(true);
    }
  });

  it("rejects goal.index out of range (negative)", () => {
    const level: Level = clone(minimalFixture);
    level.goal = { index: -1, range: 30 };
    const result = validate(level);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /goal\.index/.test(e))).toBe(true);
  });

  it("rejects goal.index out of range (>= objects.length)", () => {
    const level: Level = clone(minimalFixture);
    level.goal = { index: level.objects.length, range: 30 };
    const result = validate(level);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /goal\.index/.test(e))).toBe(true);
  });

  it("rejects goal.index pointing at the player", () => {
    const level: Level = clone(minimalFixture);
    level.goal = { index: 0, range: 30 }; // object 0 is the player in minimalFixture
    const result = validate(level);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /must not reference the player/.test(e))).toBe(true);
    }
  });

  it("rejects goal.range === 0", () => {
    const level: Level = clone(minimalFixture);
    level.goal = { index: 1, range: 0 };
    const result = validate(level);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /goal\.range/.test(e))).toBe(true);
  });

  it("rejects goal.range < 0", () => {
    const level: Level = clone(minimalFixture);
    level.goal = { index: 1, range: -5 };
    const result = validate(level);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /goal\.range/.test(e))).toBe(true);
  });

  it("rejects a non-finite coordinate (NaN x)", () => {
    const level: Level = clone(minimalFixture);
    (level.objects[2] as LevelObject).x = Number.NaN;
    const result = validate(level);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /objects\[2\]\.x must be a finite number/.test(e))).toBe(true);
  });

  it("rejects a non-finite coordinate (Infinity y)", () => {
    const level: Level = clone(minimalFixture);
    (level.objects[2] as LevelObject).y = Number.POSITIVE_INFINITY;
    const result = validate(level);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /objects\[2\]\.y must be a finite number/.test(e))).toBe(true);
  });

  it("rejects non-finite velocity/gravity/size", () => {
    const level: Level = clone(minimalFixture);
    (level.objects[2] as LevelObject).x_vel = Number.NaN;
    (level.objects[2] as LevelObject).gravity = Number.POSITIVE_INFINITY;
    (level.objects[2] as LevelObject).size = Number.NaN;
    const result = validate(level);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /x_vel/.test(e))).toBe(true);
      expect(result.errors.some((e) => /gravity/.test(e))).toBe(true);
      expect(result.errors.some((e) => /size/.test(e))).toBe(true);
    }
  });

  it("rejects a level with no body with gravity > 0", () => {
    const level: Level = clone(minimalFixture);
    // minimalFixture has TWO gravitating bodies (sun 800, planet 25) — both must be zeroed to
    // actually exercise this rule, otherwise the planet alone keeps the level valid.
    (level.objects[1] as LevelObject).gravity = 0;
    (level.objects[2] as LevelObject).gravity = 0;
    const result = validate(level);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /gravity > 0/.test(e))).toBe(true);
    }
  });

  it("returns ALL applicable errors at once, not just the first", () => {
    const level: Level = clone(minimalFixture);
    (level.objects[1] as LevelObject).gravity = 0; // breaks "gravity > 0" (combined with the next line)
    (level.objects[2] as LevelObject).gravity = 0; // ditto — no positive-gravity body remains
    level.goal = { index: -1, range: 0 }; // breaks both goal.index range AND goal.range > 0
    const result = validate(level);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("never throws on a genuinely malformed object (objects not an array, goal missing)", () => {
    const malformed = { name: "x", author: "y", objects: "not-an-array" } as unknown as Level;
    expect(() => validate(malformed)).not.toThrow();
    const result = validate(malformed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /objects must be an array/.test(e))).toBe(true);
      expect(result.errors.some((e) => /goal must be an object/.test(e))).toBe(true);
    }
  });

  it("never throws on null/primitive input cast as Level", () => {
    expect(() => validate(null as unknown as Level)).not.toThrow();
    expect(validate(null as unknown as Level).ok).toBe(false);
    expect(() => validate(42 as unknown as Level)).not.toThrow();
    expect(validate(42 as unknown as Level).ok).toBe(false);
  });
});

describe("hydrate() throws LevelError for invalid levels, with every applicable error", () => {
  it("throws LevelError (not a raw/generic error) and carries the errors array", () => {
    const level: Level = clone(minimalFixture);
    level.objects[0] = { type: "planet", x: 0, y: 0, x_vel: 0, y_vel: 0, gravity: 0, size: 10 };
    level.goal = { index: 1, range: 30 };

    let caught: unknown;
    try {
      hydrate(level);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LevelError);
    const err = caught as LevelError;
    expect(err.errors.some((e) => /exactly one player/.test(e))).toBe(true);
    expect(err.message).toContain("Invalid level");
  });

  it("hydrate() succeeds on every valid fixture without throwing", () => {
    expect(() => hydrate(minimalFixture)).not.toThrow();
    expect(() => hydrate(richFixture)).not.toThrow();
    BUILTIN_LEVELS.forEach((level) => expect(() => hydrate(level)).not.toThrow());
  });
});

describe("levelId()", () => {
  it("formats a stable, zero-padded id", () => {
    expect(levelId(0)).toBe("builtin-00");
    expect(levelId(4)).toBe("builtin-04");
    expect(levelId(9)).toBe("builtin-09");
    expect(levelId(10)).toBe("builtin-10");
    expect(levelId(32)).toBe("builtin-32");
  });

  it("documents the migration mapping from Godot's score_key", () => {
    // Godot: DataManager.score_key("builtin", 4) === "builtin_4"
    // Web:   levelId(4) === "builtin-04"
    expect(levelId(4)).toBe("builtin-04");
  });

  it("rejects a non-integer index", () => {
    expect(() => levelId(1.5)).toThrow(RangeError);
  });

  it("rejects a negative index", () => {
    expect(() => levelId(-1)).toThrow(RangeError);
  });

  it("produces a distinct id for every one of the 33 built-in levels", () => {
    const ids = BUILTIN_LEVELS.map((_, i) => levelId(i));
    expect(new Set(ids).size).toBe(33);
  });
});

describe("customLevelId()", () => {
  it("is deterministic: same content produces the same id", () => {
    const a = customLevelId(minimalFixture);
    const b = customLevelId(clone(minimalFixture));
    expect(a).toBe(b);
  });

  it("embeds a slug of the level name", () => {
    const id = customLevelId(minimalFixture);
    expect(id.startsWith("minimal-fixture-")).toBe(true);
  });

  it("changes when the level is edited (documented consequence of content-derived ids)", () => {
    const before = customLevelId(minimalFixture);
    const edited: Level = clone(minimalFixture);
    (edited.objects[0] as LevelObject).x += 1;
    const after = customLevelId(edited);
    expect(after).not.toBe(before);
  });

  it("changes when the level is renamed", () => {
    const before = customLevelId(minimalFixture);
    const renamed: Level = clone(minimalFixture);
    renamed.name = "Renamed Fixture";
    const after = customLevelId(renamed);
    expect(after).not.toBe(before);
  });

  it("slugifies an empty/symbols-only name to a non-empty fallback", () => {
    const weird: Level = clone(minimalFixture);
    weird.name = "!!!";
    const id = customLevelId(weird);
    expect(id.startsWith("level-")).toBe(true);
  });

  it("produces a distinct id for every one of the 33 built-in levels", () => {
    const ids = BUILTIN_LEVELS.map((level) => customLevelId(level));
    expect(new Set(ids).size).toBe(33);
  });
});
