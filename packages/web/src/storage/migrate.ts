// Schema versioning and the desktop-game -> web score migration.
//
// Two separate jobs live here, both about "some JSON I did not just write might be old, foreign,
// or garbage, and I must always produce something valid":
//
//  1. `migrateSettingsFile` / `migrateBestsFile` / `migrateCustomLevelsFile` — take whatever
//     `JSON.parse` produced for one of this module's own three localStorage keys (could be this
//     version's shape, an older version's shape, or plain garbage) and always return a valid
//     current-version shape. This is the same code path for "corrupt" and "old version": both are
//     just "not what I expected, fall back to what I understand."
//  2. `importGodotScores` — a one-time, explicitly-invoked conversion of the original desktop
//     game's `scores.json` into this app's `PersonalBest` map. Not part of the `Storage`
//     interface; callers (an "import my desktop scores" button in the UI) parse the pasted file
//     with this function, then feed the result through `Storage.recordBest` themselves so the
//     normal "only if better" comparison applies.

import type { Level } from "@swingby/core";
import { customLevelId, levelId } from "@swingby/core";
import type { PersonalBest } from "./index.js";

export const SCHEMA_VERSION = 1;

export interface SettingsFileV1 {
  schemaVersion: 1;
  /** Deliberately untyped: unknown fields must survive a read/write cycle (task doc "Robustness"). */
  settings: Record<string, unknown>;
}

export interface BestsFileV1 {
  schemaVersion: 1;
  bests: Record<string, PersonalBest>;
}

export interface CustomLevelsFileV1 {
  schemaVersion: 1;
  levels: Level[];
}

export interface CustomLevelMetaFileV1 {
  schemaVersion: 1;
  /** customLevelId -> ISO createdAt. Only levels saved/imported since this key was introduced have
   *  an entry — older custom levels have no recorded creation time. */
  createdAt: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** A `PersonalBest`-shaped value, or null if `v` doesn't qualify. Drops, never throws. */
export function sanitizePersonalBest(v: unknown): PersonalBest | null {
  if (!isPlainObject(v)) return null;
  if (!isFiniteNumber(v.timeMs) || !isFiniteNumber(v.boostMs)) return null;
  if (v.timeMs < 0 || v.boostMs < 0) return null;
  return { timeMs: v.timeMs, boostMs: v.boostMs };
}

/** Loose structural check — matches `LevelObject`'s required fields, tolerant of extras/optionals. */
export function looksLikeLevel(v: unknown): v is Level {
  if (!isPlainObject(v)) return false;
  if (typeof v.name !== "string" || typeof v.author !== "string") return false;
  if (!isPlainObject(v.goal)) return false;
  if (typeof v.goal.index !== "number" || typeof v.goal.range !== "number")
    return false;
  if (!Array.isArray(v.objects)) return false;
  return v.objects.every(
    (o) =>
      isPlainObject(o) &&
      typeof o.type === "string" &&
      typeof o.x === "number" &&
      typeof o.y === "number",
  );
}

// ---------------------------------------------------------------------------
// 1. Per-key migration / corruption recovery
// ---------------------------------------------------------------------------

/**
 * Always returns a valid `SettingsFileV1`. `raw` is whatever `JSON.parse` produced (or the
 * caller's own passthrough of `undefined` when there was nothing stored / parsing failed).
 * Note Godot's own `_load_settings` (DataManager.gd:90-104) silently DROPS unknown top-level
 * settings keys when merging over defaults; VAULT deliberately does the opposite (task doc
 * "Robustness": unknown fields must survive a write cycle), so this function does not filter
 * `settings` down to known keys — the merge-with-defaults step lives in index.ts, not here.
 */
export function migrateSettingsFile(raw: unknown): SettingsFileV1 {
  if (
    isPlainObject(raw) &&
    raw.schemaVersion === 1 &&
    isPlainObject(raw.settings)
  ) {
    return { schemaVersion: 1, settings: raw.settings };
  }
  // Unversioned legacy shape: a bare settings object with no wrapper (e.g. a hand-restored
  // export, or a pre-versioning save). Anything else (array, primitive, null) -> empty.
  if (isPlainObject(raw) && !("schemaVersion" in raw)) {
    return { schemaVersion: 1, settings: raw };
  }
  return { schemaVersion: 1, settings: {} };
}

/** Always returns a valid `BestsFileV1`. Drops individual malformed entries, never the whole file. */
export function migrateBestsFile(raw: unknown): BestsFileV1 {
  const source: unknown =
    isPlainObject(raw) && raw.schemaVersion === 1
      ? raw.bests
      : isPlainObject(raw) && !("schemaVersion" in raw)
        ? raw
        : {};
  const bests: Record<string, PersonalBest> = {};
  if (isPlainObject(source)) {
    for (const [id, entry] of Object.entries(source)) {
      const clean = sanitizePersonalBest(entry);
      if (clean) bests[id] = clean;
    }
  }
  return { schemaVersion: 1, bests };
}

/** Always returns a valid `CustomLevelsFileV1`. A bare array (Godot's own custom_levels.json shape,
 *  or an unversioned legacy save) is accepted directly. Drops individual malformed entries. */
export function migrateCustomLevelsFile(raw: unknown): CustomLevelsFileV1 {
  const source: unknown =
    isPlainObject(raw) && raw.schemaVersion === 1
      ? raw.levels
      : Array.isArray(raw)
        ? raw
        : [];
  const levels: Level[] = Array.isArray(source)
    ? source.filter(looksLikeLevel)
    : [];
  return { schemaVersion: 1, levels };
}

/** Always returns a valid `CustomLevelMetaFileV1`. Drops entries whose value isn't a parseable
 *  date string, never the whole file. */
export function migrateCustomLevelMetaFile(
  raw: unknown,
): CustomLevelMetaFileV1 {
  const source: unknown =
    isPlainObject(raw) && raw.schemaVersion === 1 ? raw.createdAt : {};
  const createdAt: Record<string, string> = {};
  if (isPlainObject(source)) {
    for (const [id, value] of Object.entries(source)) {
      if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
        createdAt[id] = value;
      }
    }
  }
  return { schemaVersion: 1, createdAt };
}

// ---------------------------------------------------------------------------
// 2. Godot desktop scores.json -> web PersonalBest map
// ---------------------------------------------------------------------------

interface GodotScoreEntry {
  time?: number;
  name?: string;
}

interface GodotScoresFile {
  fastest?: Record<string, GodotScoreEntry>;
  efficient?: Record<string, GodotScoreEntry>;
}

export interface GodotScoreImportResult {
  bests: Record<string, PersonalBest>;
  /** Count of source score_key entries (builtin_N or custom_N pairs) successfully mapped. */
  mapped: number;
  /** Source keys that could not be mapped, each with a short reason. */
  skipped: Array<{ key: string; reason: string }>;
}

const GODOT_SCORE_KEY = /^(builtin|custom)_(\d+)$/;

/**
 * Godot -> web seconds -> ms conversion. This is the one deliberate conversion boundary for the
 * migration path (PROJECT.md §4: ticks internally, ms only at display/API boundaries — Godot's
 * `scores.json` is itself an external API boundary, stored in float seconds, so it converts here
 * and nowhere else in this module).
 */
function secondsToMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

/**
 * Parses the original desktop game's `scores.json` and maps its index-keyed entries onto this
 * app's string level ids.
 *
 * IMPORTANT field-name gotcha: the `efficient` bucket stores boost-seconds under a field
 * literally named `"time"` — the same field name the `fastest` bucket uses for elapsed time.
 * Copying that field name through naively would make `boostMs` end up equal to `timeMs`; this
 * function reads `fastest[key].time` into `timeMs` and `efficient[key].time` into `boostMs`
 * explicitly, never sharing one read between the two.
 *
 * `custom_N` entries need the corresponding custom level's *content* to derive a stable
 * `customLevelId` (Level carries no id — see docs/INTERFACES.md "Custom level ids"). Pass the
 * player's `custom_levels.json` (parsed to `Level[]`, in the original save order) via `opts.customLevels`
 * to resolve those too; without it, `custom_N` keys are skipped with a clear reason rather than
 * guessed at.
 *
 * Never throws — malformed JSON or an unrecognised shape yields an empty result, consistent with
 * this module's "never throw on corrupt data" rule.
 */
export function importGodotScores(
  json: string,
  opts?: {
    customLevels?: readonly Level[];
    levelIdFor?: (index: number) => string;
    customLevelIdFor?: (level: Level) => string;
  },
): GodotScoreImportResult {
  const levelIdFor = opts?.levelIdFor ?? levelId;
  const customLevelIdFor = opts?.customLevelIdFor ?? customLevelId;
  const result: GodotScoreImportResult = { bests: {}, mapped: 0, skipped: [] };

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return result;
  }
  if (!isPlainObject(raw)) return result;

  const parsed = raw as GodotScoresFile;
  const fastest = isPlainObject(parsed.fastest) ? parsed.fastest : {};
  const efficient = isPlainObject(parsed.efficient) ? parsed.efficient : {};
  const keys = new Set([...Object.keys(fastest), ...Object.keys(efficient)]);

  for (const key of keys) {
    const match = GODOT_SCORE_KEY.exec(key);
    if (!match) {
      result.skipped.push({ key, reason: "unrecognised score_key format" });
      continue;
    }
    const category = match[1] as "builtin" | "custom";
    const index = Number(match[2]);

    let id: string;
    if (category === "builtin") {
      try {
        id = levelIdFor(index);
      } catch (err) {
        result.skipped.push({
          key,
          reason: `levelIdFor threw: ${String(err)}`,
        });
        continue;
      }
    } else {
      const level = opts?.customLevels?.[index];
      if (!level) {
        result.skipped.push({
          key,
          reason: "no matching entry in opts.customLevels",
        });
        continue;
      }
      id = customLevelIdFor(level);
    }

    const fastestEntry = fastest[key];
    const efficientEntry = efficient[key];
    const timeSeconds = isPlainObject(fastestEntry)
      ? fastestEntry.time
      : undefined;
    const boostSeconds = isPlainObject(efficientEntry)
      ? efficientEntry.time
      : undefined;
    const timeMs = isFiniteNumber(timeSeconds)
      ? secondsToMs(timeSeconds)
      : undefined;
    const boostMs = isFiniteNumber(boostSeconds)
      ? secondsToMs(boostSeconds)
      : undefined;
    if (timeMs === undefined && boostMs === undefined) {
      result.skipped.push({
        key,
        reason: "neither fastest nor efficient entry had a numeric time",
      });
      continue;
    }

    const existing = result.bests[id];
    result.bests[id] = {
      timeMs: timeMs ?? existing?.timeMs ?? Number.POSITIVE_INFINITY,
      boostMs: boostMs ?? existing?.boostMs ?? Number.POSITIVE_INFINITY,
    };
    result.mapped++;
  }

  return result;
}
