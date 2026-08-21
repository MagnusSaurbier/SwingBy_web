// Pure, DOM-free logic for the level selector's "download level files" / "import" feature:
// building the export payload, parsing + validating an imported file, and duplicate/name-collision
// detection. DOM wiring (buttons, select mode, dialogs) lives in ui/screens/levelSelect.ts — kept
// out of this file so the logic here is unit-testable (no jsdom in this repo).

import type { Level } from "@swingby/core";
import { validate } from "@swingby/core";
import { isPlainObject, looksLikeLevel } from "../storage/migrate.js";

export const LEVEL_EXPORT_KIND = "swingby-level-export";
export const LEVEL_EXPORT_SCHEMA_VERSION = 1;

export interface ExportedLevelEntry {
  level: Level;
  /** ISO timestamp, or null when the source level predates createdAt tracking. */
  createdAt: string | null;
}

export interface LevelExportFile {
  schemaVersion: typeof LEVEL_EXPORT_SCHEMA_VERSION;
  kind: typeof LEVEL_EXPORT_KIND;
  exportedAt: string;
  levels: ExportedLevelEntry[];
}

export function buildLevelExport(
  levels: readonly Level[],
  createdAtFor: (level: Level) => string | null,
): LevelExportFile {
  return {
    schemaVersion: LEVEL_EXPORT_SCHEMA_VERSION,
    kind: LEVEL_EXPORT_KIND,
    exportedAt: new Date().toISOString(),
    levels: levels.map((level) => ({ level, createdAt: createdAtFor(level) })),
  };
}

// ---------------------------------------------------------------------------
// Parsing / validation
// ---------------------------------------------------------------------------

/** `rawEntry.level` (this app's wrapper shape) if it looks like a `Level`, else `rawEntry` itself
 *  if that looks like one, else null. */
function extractLevel(rawEntry: unknown): Level | null {
  if (isPlainObject(rawEntry) && looksLikeLevel(rawEntry.level))
    return rawEntry.level;
  if (looksLikeLevel(rawEntry)) return rawEntry;
  return null;
}

export type ParsedLevelExport =
  | { ok: true; entries: ExportedLevelEntry[]; malformed: string[] }
  | { ok: false; reason: string };

/**
 * Parses and validates a level export `.json` file's contents. Never throws.
 *
 * Individual malformed levels are dropped and reported in `malformed` rather than failing the
 * whole import ("still import the functional ones") — only a file that isn't JSON, or has no
 * `levels` array at all, fails outright. Accepts either this app's own wrapper shape
 * (`{ levels: [{ level, createdAt }] }`) or a bare array of levels for each entry, so a
 * hand-edited or foreign file with plain `Level` objects still imports.
 */
export function parseLevelExportFile(json: string): ParsedLevelExport {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: "That file isn't valid JSON." };
  }

  const rawLevels: unknown = isPlainObject(raw)
    ? raw.levels
    : Array.isArray(raw)
      ? raw
      : undefined;
  if (!Array.isArray(rawLevels)) {
    return {
      ok: false,
      reason: "That file doesn't look like a SwingBy level export.",
    };
  }

  const entries: ExportedLevelEntry[] = [];
  const malformed: string[] = [];

  rawLevels.forEach((rawEntry, i) => {
    const level = extractLevel(rawEntry);
    if (level === null) {
      malformed.push(`level ${i + 1}: not a recognisable level`);
      return;
    }
    const result = validate(level);
    if (!result.ok) {
      malformed.push(
        `"${level.name || `level ${i + 1}`}": ${result.errors.join("; ")}`,
      );
      return;
    }
    const createdAt =
      isPlainObject(rawEntry) && typeof rawEntry.createdAt === "string"
        ? rawEntry.createdAt
        : null;
    entries.push({ level, createdAt });
  });

  return { ok: true, entries, malformed };
}

// ---------------------------------------------------------------------------
// Duplicate / name-collision detection
// ---------------------------------------------------------------------------

/** djb2 string hash, base-36. Independent copy of `@swingby/core`'s private helper (level.ts) —
 *  small enough that duplicating it beats exporting a hashing primitive from core's public surface
 *  for this one caller. */
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33 + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Hashes a level's gameplay content only (goal + objects) — deliberately NOT name/author, so a
 *  renamed copy of the same level is still recognised as a content duplicate rather than merely a
 *  name collision. */
export function levelContentHash(level: Level): string {
  return djb2(JSON.stringify({ goal: level.goal, objects: level.objects }));
}

export function normalizeLevelName(name: string): string {
  return name.trim().toLowerCase();
}

export interface DuplicateCheckState {
  contentHashes: Set<string>;
  names: Set<string>;
}

export function buildDuplicateCheckState(
  existing: readonly Level[],
): DuplicateCheckState {
  return {
    contentHashes: new Set(existing.map(levelContentHash)),
    names: new Set(existing.map((l) => normalizeLevelName(l.name))),
  };
}

export type ImportConflict = "new" | "duplicate-content" | "duplicate-name";

/**
 * Classifies one incoming level against the current state. Content match wins over a mere name
 * match — two levels that are truly the same level always share both, so checking content first
 * means the caller never has to ask about a name collision the duplicate-content prompt already
 * covers.
 */
export function classifyImportEntry(
  level: Level,
  state: DuplicateCheckState,
): ImportConflict {
  if (state.contentHashes.has(levelContentHash(level)))
    return "duplicate-content";
  if (state.names.has(normalizeLevelName(level.name))) return "duplicate-name";
  return "new";
}

/** Registers `level` into `state` after it's been accepted (imported), so later entries in the
 *  same import batch are checked against it too, not just against the pre-existing library.
 *  Mutates `state`. */
export function registerImportedLevel(
  level: Level,
  state: DuplicateCheckState,
): void {
  state.contentHashes.add(levelContentHash(level));
  state.names.add(normalizeLevelName(level.name));
}
