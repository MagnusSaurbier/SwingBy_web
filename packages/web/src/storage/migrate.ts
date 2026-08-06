/**
 * T-10 VAULT — schema versioning and the Godot desktop → web score migration.
 *
 * This module is intentionally pure: no localStorage/IndexedDB access here, only data shape
 * validation and transforms. `index.ts` owns all actual persistence I/O (see the note there about
 * being the only module that touches `localStorage`).
 */

// ---------------------------------------------------------------------------
// Envelope versioning
// ---------------------------------------------------------------------------

/**
 * Current on-disk schema version for every key this module writes (settings, scores, custom
 * levels). Bump this and add a case to `upgrade()` when the shape changes; version 1 is what
 * ships first, so there is nothing to upgrade from yet.
 */
export const VAULT_SCHEMA_VERSION = 1;

export interface Envelope<T> {
  version: number;
  data: T;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Reads a possibly-corrupt, possibly-legacy stored value into a well-formed envelope.
 *
 * Accepts three shapes on the way in:
 *   1. `{ version, data }` — the current wrapped form. `data` is validated and, if it belongs to
 *      an older version, run through `upgrade()`.
 *   2. A bare value that passes `isValid` — a pre-versioning (v0) write with no wrapper at all.
 *   3. Anything else (corrupt JSON already caught by the caller, `[]` where an object was
 *      expected, `null`, etc.) — falls back to `fallback`. Never throws.
 */
export function readEnvelope<T>(
  raw: unknown,
  fallback: T,
  isValid: (v: unknown) => v is T,
): Envelope<T> {
  if (isPlainObject(raw) && "version" in raw && "data" in raw) {
    const version = typeof raw.version === "number" && Number.isFinite(raw.version) ? raw.version : 0;
    if (isValid(raw.data)) {
      return { version: VAULT_SCHEMA_VERSION, data: upgrade(version, raw.data, isValid, fallback) };
    }
    return { version: VAULT_SCHEMA_VERSION, data: fallback };
  }
  // No envelope wrapper at all: either a legacy (pre-versioning) flat write, or garbage.
  if (isValid(raw)) {
    return { version: VAULT_SCHEMA_VERSION, data: upgrade(0, raw, isValid, fallback) };
  }
  return { version: VAULT_SCHEMA_VERSION, data: fallback };
}

/**
 * Upgrades `data` written under `fromVersion` forward to `VAULT_SCHEMA_VERSION`.
 * No-op today because there is only version 1. Add `if (v < 2) { data = ... }` steps here as the
 * schema grows — keep each step small and keep validating with `isValid` after every step.
 */
function upgrade<T>(fromVersion: number, data: T, _isValid: (v: unknown) => v is T, _fallback: T): T {
  void fromVersion;
  return data;
}

// ---------------------------------------------------------------------------
// Godot desktop → web score migration
// ---------------------------------------------------------------------------

/**
 * Shape of a decoded `user://scores.json` from `reference/godot/scripts/DataManager.gd`.
 *
 * Note the trap documented in tasks/T-10-VAULT.md: inside `efficient`, the boost-seconds value is
 * stored under the key `"time"` too (DataManager.gd's `submit_score` writes
 * `{"time": boost_elapsed, "name": username}` into the efficient bucket). That is not a typo in
 * this file — it mirrors the actual on-disk shape — and it is why `mapGodotScores` reads
 * `entry.time` for both buckets but routes it to `boostMs` for `efficient`.
 */
export interface GodotScoreEntry {
  time: number;
  name: string;
}

export interface GodotScores {
  fastest?: Record<string, GodotScoreEntry>;
  efficient?: Record<string, GodotScoreEntry>;
}

export type GodotLevelCategory = "builtin" | "custom";

/** Matches DataManager.gd's `score_key()`: `"%s_%d" % [category, level_index]`. */
const SCORE_KEY_RE = /^(builtin|custom)_(\d+)$/;

/**
 * Best-effort mapping from a Godot level index to T-03 ATLAS's stable string id.
 *
 * T-03 ATLAS (which owns `levelId()`) had not landed when this was written, so this is a
 * documented guess matching the convention its own task doc proposes (see
 * `tasks/T-03-ATLAS.md`, "Note on level ids": `"builtin-01"`, 1-based, zero-padded). Once T-03
 * ships its real `levelId()`, callers should pass that in as `toLevelId` instead of relying on
 * this default — do not assume this guess is authoritative.
 */
export function defaultGodotLevelId(category: GodotLevelCategory, index: number): string {
  return category === "builtin" ? `builtin-${String(index + 1).padStart(2, "0")}` : `custom-${index}`;
}

export interface ScorePatch {
  timeMs?: number;
  timeName?: string;
  boostMs?: number;
  boostName?: string;
}

export interface GodotImportResult {
  /** levelId -> only the fields this import actually supplied. */
  levels: Record<string, ScorePatch>;
  /** Number of score-key entries successfully mapped (fastest + efficient combined). */
  imported: number;
  /** `"<bucket>.<key>"` entries that did not match the expected `score_key` shape. */
  skipped: string[];
}

function isGodotEntry(v: unknown): v is GodotScoreEntry {
  return isPlainObject(v) && typeof v.time === "number" && Number.isFinite(v.time);
}

/** Parses a raw `scores.json` string. Returns null (never throws) on invalid JSON or shape. */
export function parseGodotScores(raw: string): GodotScores | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  return parsed as GodotScores;
}

/**
 * Maps a decoded Godot `scores.json` onto ATLAS-style level ids. Pure — does not touch storage.
 * Godot's `time` is in seconds; this converts to milliseconds, matching every other duration in
 * this codebase (PROJECT.md §4: ticks internally, ms at display/API boundaries).
 */
export function mapGodotScores(
  godot: GodotScores,
  toLevelId: (category: GodotLevelCategory, index: number) => string = defaultGodotLevelId,
): GodotImportResult {
  const levels: Record<string, ScorePatch> = {};
  const skipped: string[] = [];
  let imported = 0;

  for (const [key, entry] of Object.entries(godot.fastest ?? {})) {
    const match = SCORE_KEY_RE.exec(key);
    if (!match || !isGodotEntry(entry)) {
      skipped.push(`fastest.${key}`);
      continue;
    }
    const levelId = toLevelId(match[1] as GodotLevelCategory, Number(match[2]));
    levels[levelId] = { ...levels[levelId], timeMs: entry.time * 1000, timeName: entry.name };
    imported++;
  }

  for (const [key, entry] of Object.entries(godot.efficient ?? {})) {
    const match = SCORE_KEY_RE.exec(key);
    if (!match || !isGodotEntry(entry)) {
      skipped.push(`efficient.${key}`);
      continue;
    }
    const levelId = toLevelId(match[1] as GodotLevelCategory, Number(match[2]));
    // entry.time here is boost-seconds, not a timestamp — see the GodotScores doc comment above.
    levels[levelId] = { ...levels[levelId], boostMs: entry.time * 1000, boostName: entry.name };
    imported++;
  }

  return { levels, imported, skipped };
}
