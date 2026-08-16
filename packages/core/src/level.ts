/**
 * T-03 ATLAS — level loading, validation, and the persisted <-> runtime boundary.
 *
 * `LevelObject` (packages/core/src/types.ts) is the persisted, snake_case shape that must
 * round-trip byte-for-byte with the Godot original (`reference/godot/data/levels_builtin.json`,
 * copied verbatim into `./levels.json`). `Body` is the fully-populated, camelCase runtime shape.
 * `hydrate()` and `serialize()` are the ONLY conversion points between them — see PROJECT.md §4.
 */

import type { Body, Level, LevelGoal, LevelObject, World } from "./types.js";
import { DEFAULT_BODY_SIZE } from "./constants.js";

// levels.json is copied verbatim from the Godot reference (never hand-edited, never reformatted —
// see "How to verify" in tasks/T-03-ATLAS.md, which diffs it against the original file byte-for-byte).
// TypeScript infers a widened structural type from the JSON literal (string instead of the BodyType
// union, etc.); the assertion below is safe because `validate()` is the actual runtime gate — every
// level in BUILTIN_LEVELS is asserted valid by the test suite (see test/level/level.test.ts), and any
// consumer that types-checks this file gets the precise `Level` shape from that point on.
import levelsData from "./levels.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown by `hydrate()` when the level fails `validate()`. Carries every applicable error, not
 * just the first, matching `validate()`'s "return all errors at once" contract.
 */
export class LevelError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`Invalid level: ${errors.join("; ")}`);
    this.name = "LevelError";
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Built-in levels
// ---------------------------------------------------------------------------

/**
 * The 33 built-in levels, in Godot's original order. `levelId(index)` is the stable handle for
 * this array — do not key anything off the array index directly (see `levelId`).
 */
export const BUILTIN_LEVELS: readonly Level[] = levelsData as readonly Level[];

// ---------------------------------------------------------------------------
// turn_speed — deliberate decision (see tasks/T-03-ATLAS.md "turn_speed needs a decision")
// ---------------------------------------------------------------------------
//
// Godot's GameWorld._create_runtime_object assigns `randf_range(-3.0, -2.0)` to every object's
// turn_speed on every load — a fresh random spin per session. It is visual-only (drives
// `body.angle`; no force calculation reads it), so it cannot affect solvability, but
// `packages/core` is deterministic by contract (no RNG calls, no clock — PROJECT.md §4) and a
// hidden random source here is exactly the kind of leak that makes replay verification flaky.
//
// Chosen option (1 of 3 offered): deterministic pseudo-spin derived from the object's index within
// `Level.objects`, reproducing the *look* of independent per-body spin without any randomness:
//
//   turnSpeed = -2.0 - ((index * 0.37) % 1.0)
//
// This lands in the same (-3, -2] band Godot's randf_range(-3.0, -2.0) drew from, is a pure
// function of position in the array, and is identical across every load, every client, and the
// server replay verifier. T-04 AURORA: this is what feeds `Body.angle` advancement each tick
// (`angle += degToRad(turnSpeed) * stepScale`, done in physics.ts) — no action needed on your side
// beyond drawing the rotated sprite as usual.
function syntheticTurnSpeed(index: number): number {
  return -2.0 - ((index * 0.37) % 1.0);
}

// ---------------------------------------------------------------------------
// hydrate: persisted -> runtime
// ---------------------------------------------------------------------------

/**
 * Persisted -> runtime. Fills every default (matching Godot's `.get(key, default)` calls in
 * `GameWorld._create_runtime_object`), producing a fully-populated `World`. Throws `LevelError`
 * (with every applicable error, not just the first) if the level fails `validate()`.
 *
 * Defaults applied when a field is absent from a `LevelObject`:
 *
 * | field        | default                              |
 * |--------------|---------------------------------------|
 * | x_vel, y_vel | 0                                      |
 * | size         | `DEFAULT_BODY_SIZE` (10) — for every type, including player. Godot's own
 * |              | runtime defaults size per-type (sun 18, player 12, planet 10), but every
 * |              | player object in the reference data omits `size` and no sun/planet ever
 * |              | does, so the single frozen default documented on `Body.size` (types.ts) is
 * |              | what's implemented here; it does not change any built-in level's physics
 * |              | (only players omit it, and the softening formula for the player's own body
 * |              | size only affects incoming gravity onto the player itself).
 * | visible      | true                                   |
 * | anchored     | false                                  |
 * | turn_speed   | `syntheticTurnSpeed(index)` — see above, deterministic, never random       |
 * | boost_type   | 0                                      |
 *
 * `angle`, `xAcc`, `yAcc`, `isBoosting`, `isBraking` always initialise to `0` / `false`.
 *
 * Note on `boost_type`: the reference data stores it 1-indexed for players (1-4, one greater than
 * the 0-3 "rocket sprite variant" `Body.boostType` is documented to hold) — Godot's own runtime
 * never actually reads a player's persisted `boost_type` for gameplay (it substitutes the user's
 * equipped skin from Settings instead; see `GameWorld._create_runtime_object`), so the field is
 * effectively an inert echo of whatever skin was equipped when the level was authored/exported.
 * `hydrate()` copies it through unchanged (default 0 only when absent) rather than reinterpreting
 * or clamping it, so `serialize(hydrate(l))` reproduces the exact stored value. Callers that want
 * "the skin to render" should apply their own Settings-derived override on top, same as Godot does.
 */
export function hydrate(level: Level): World {
  const result = validate(level);
  if (!result.ok) {
    throw new LevelError(result.errors);
  }

  const bodies: Body[] = level.objects.map((obj, index) =>
    hydrateObject(obj, index),
  );
  const playerIndex = bodies.findIndex((b) => b.type === "player");

  return {
    bodies,
    playerIndex,
    goalIndex: level.goal.index,
    goalRange: level.goal.range,
  };
}

function hydrateObject(obj: LevelObject, index: number): Body {
  return {
    type: obj.type,
    x: obj.x,
    y: obj.y,
    xVel: obj.x_vel ?? 0,
    yVel: obj.y_vel ?? 0,
    xAcc: 0,
    yAcc: 0,
    gravity: obj.gravity,
    size: obj.size ?? DEFAULT_BODY_SIZE,
    visible: obj.visible ?? true,
    anchored: obj.anchored ?? false,
    angle: 0,
    turnSpeed: obj.turn_speed ?? syntheticTurnSpeed(index),
    isBoosting: false,
    isBraking: false,
    boostType: obj.boost_type ?? 0,
  };
}

// ---------------------------------------------------------------------------
// serialize: runtime -> persisted
// ---------------------------------------------------------------------------

/**
 * Runtime -> persisted. `World` carries no name/author (they are not simulation state), so they
 * are supplied via `meta`. Round-trips: `serialize(hydrate(l), { name: l.name, author: l.author })`
 * deep-equals `l` for every built-in level (see test/level/level.test.ts).
 *
 * Optional fields are only re-emitted when they cannot be reproduced by `hydrate()`'s defaulting
 * alone — i.e. when the value differs from what an absent field would have hydrated to for that
 * body's type/position. This is what makes the round trip exact: the reference data consistently
 * omits fields that don't apply to a body's type (e.g. `visible` never appears on a planet, `x_vel`
 * never appears on a sun) and omits `anchored`/`turn_speed` whenever they'd be at their default, so
 * mirroring that convention on the way out reproduces the original object shape exactly.
 */
export function serialize(
  world: World,
  meta: { name: string; author: string },
): Level {
  const objects: LevelObject[] = world.bodies.map((body, index) =>
    serializeObject(body, index),
  );

  const goal: LevelGoal = {
    index: world.goalIndex,
    range: world.goalRange,
  };

  return {
    name: meta.name,
    author: meta.author,
    goal,
    objects,
  };
}

function serializeObject(body: Body, index: number): LevelObject {
  const obj: LevelObject = {
    type: body.type,
    x: body.x,
    y: body.y,
    gravity: body.gravity,
  };

  // x_vel/y_vel: suns are stationary in every reference level and omit these; player/planet always
  // carry them (even when exactly 0), so only suck-in the zero-omission for suns.
  if (body.type !== "sun" || body.xVel !== 0) {
    obj.x_vel = body.xVel;
  }
  if (body.type !== "sun" || body.yVel !== 0) {
    obj.y_vel = body.yVel;
  }

  // size: only the player ever omits it (and always hydrates to the default when it does); suns
  // and planets always carry an explicit size, even when it numerically equals the default.
  if (body.type !== "player" || body.size !== DEFAULT_BODY_SIZE) {
    obj.size = body.size;
  }

  // visible: sun-only concept in the reference data, always explicit there (even when true);
  // player/planet never carry it, so only emit for non-suns when it deviates from the default.
  if (body.type === "sun" || body.visible !== true) {
    obj.visible = body.visible;
  }

  // anchored: never explicitly false anywhere in the reference data; only emitted when true.
  if (body.anchored !== false) {
    obj.anchored = true;
  }

  // turn_speed: never explicit in the reference data (every body's spin comes from the synthetic
  // default). Emit only when the stored value diverges from what hydrate() would have produced for
  // an absent field at this index — i.e. it was explicitly authored (or edited) to something else.
  const defaultTurnSpeed = syntheticTurnSpeed(index);
  if (body.turnSpeed !== defaultTurnSpeed) {
    obj.turn_speed = body.turnSpeed;
  }

  // boost_type: player-only in the reference data, always explicit there; emit only a non-default
  // value so an untouched player (boostType === 0) round-trips through an omitted field too.
  if (body.type === "player" && body.boostType !== 0) {
    obj.boost_type = body.boostType;
  }

  return obj;
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates a level, returning every applicable error (never just the first — T-11 DRAFT surfaces
 * all of them in the editor at once). Never throws, regardless of how malformed the input is; the
 * parameter is typed `Level` for the happy path but every access is guarded so that genuinely
 * malformed external JSON (cast to `Level` by an untrusting caller) produces errors, not exceptions.
 *
 * Rules (tasks/T-03-ATLAS.md "Validation" / INTERFACES.md):
 *   - exactly one `player` object
 *   - `goal.index` within `objects`, and not the player
 *   - `goal.range > 0`
 *   - every coordinate/velocity/gravity/size is finite (rejects NaN and Infinity)
 *   - at least one body with `gravity > 0`
 */
export function validate(
  level: Level,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (level == null || typeof level !== "object") {
    return { ok: false, errors: ["level must be an object"] };
  }

  const rawObjects: unknown = level.objects;
  const objects: readonly LevelObject[] = Array.isArray(rawObjects)
    ? rawObjects
    : [];
  if (!Array.isArray(rawObjects)) {
    errors.push("objects must be an array");
  }

  let playerCount = 0;
  let hasPositiveGravity = false;

  objects.forEach((obj, i) => {
    if (obj == null || typeof obj !== "object") {
      errors.push(`objects[${i}] must be an object`);
      return;
    }

    const type: unknown = obj.type;
    if (type !== "player" && type !== "sun" && type !== "planet") {
      errors.push(
        `objects[${i}].type must be "player", "sun", or "planet" (got ${JSON.stringify(type)})`,
      );
    } else if (type === "player") {
      playerCount += 1;
    }

    if (!isFiniteNumber(obj.x)) {
      errors.push(`objects[${i}].x must be a finite number`);
    }
    if (!isFiniteNumber(obj.y)) {
      errors.push(`objects[${i}].y must be a finite number`);
    }
    if (obj.x_vel !== undefined && !isFiniteNumber(obj.x_vel)) {
      errors.push(`objects[${i}].x_vel must be a finite number`);
    }
    if (obj.y_vel !== undefined && !isFiniteNumber(obj.y_vel)) {
      errors.push(`objects[${i}].y_vel must be a finite number`);
    }
    if (!isFiniteNumber(obj.gravity)) {
      errors.push(`objects[${i}].gravity must be a finite number`);
    } else if (obj.gravity > 0) {
      hasPositiveGravity = true;
    }
    if (obj.size !== undefined && !isFiniteNumber(obj.size)) {
      errors.push(`objects[${i}].size must be a finite number`);
    }
  });

  if (playerCount !== 1) {
    errors.push(`exactly one player object is required (found ${playerCount})`);
  }
  if (!hasPositiveGravity) {
    errors.push("at least one body must have gravity > 0");
  }

  const goal: unknown = level.goal;
  if (goal == null || typeof goal !== "object") {
    errors.push("goal must be an object");
  } else {
    const g = goal as Partial<LevelGoal>;
    if (!Number.isInteger(g.index)) {
      errors.push("goal.index must be an integer");
    } else {
      const goalIndex = g.index as number;
      if (goalIndex < 0 || goalIndex >= objects.length) {
        errors.push(
          `goal.index (${goalIndex}) is out of range for ${objects.length} objects`,
        );
      } else {
        const goalObj = objects[goalIndex];
        if (
          goalObj != null &&
          typeof goalObj === "object" &&
          goalObj.type === "player"
        ) {
          errors.push("goal.index must not reference the player object");
        }
      }
    }
    if (!isFiniteNumber(g.range) || (g.range as number) <= 0) {
      errors.push("goal.range must be a finite number greater than 0");
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * Stable id for a built-in level, used everywhere scores/URLs/leaderboards key off a level
 * (tasks/T-03-ATLAS.md "Note on level ids"). Godot keys scores by raw index
 * (`DataManager.score_key`: `"%s_%d" % [category, level_index]`, e.g. `"builtin_4"`) — indices
 * break the moment a level is inserted, so this format is deliberately different, but the mapping
 * back to Godot's local scores is direct and worth documenting for T-10 VAULT's migration:
 *
 *   Godot score_key "builtin_<N>"  ->  levelId(N) === "builtin-<NN>" (same N, zero-padded to 2 digits)
 *
 * e.g. `"builtin_4"` (Godot) migrates to `levelId(4) === "builtin-04"`.
 */
export function levelId(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(
      `levelId: index must be a non-negative integer, got ${index}`,
    );
  }
  return `builtin-${String(index).padStart(2, "0")}`;
}

/**
 * Stable id for a CUSTOM level (INTERFACES.md "Custom level ids"). `Level` carries no id and
 * Godot's `custom_levels.json` is a bare array, so three different tasks (T-10 VAULT's local
 * storage, T-11 DRAFT's editor save flow, T-13 PODIUM's share links) each need a handle for "this
 * level" derived from content alone. T-03 ATLAS owns the canonical implementation; every other task
 * imports this function rather than reimplementing it.
 *
 * `slug(name) + "-" + djb2(JSON.stringify(level))`.
 *
 * Consequence worth restating here (see INTERFACES.md for the full explanation): renaming or
 * editing a custom level changes its id, because both halves of the id are derived from the level's
 * current content. That's fine for local storage keys and unlisted share links (an edit is a new
 * version, which is a new link) but it means this id is NOT durable identity — never use it as a
 * database primary key that must survive an edit. T-12 LEDGER mints its own independent slug for
 * shared levels for exactly this reason.
 */
export function customLevelId(level: Level): string {
  return `${slug(level.name)}-${djb2(JSON.stringify(level))}`;
}

function slug(name: string): string {
  const cleaned = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "level";
}

/** djb2 string hash, returned as a base-36 string of the unsigned 32-bit result. */
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    // hash * 33 + charCode, kept in 32-bit signed range via `| 0`.
    hash = (hash * 33 + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
