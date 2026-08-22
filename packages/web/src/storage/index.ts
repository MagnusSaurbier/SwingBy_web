// Local persistence: settings, personal bests, custom levels.
//
// This module is the ONLY place that touches `localStorage` (input rebinding and the settings
// screen both go through `setSettings`). Two behaviours are non-negotiable (docs/INTERFACES.md
// "web/storage/index.ts"):
//
//   1. Must migrate cleanly from an EMPTY store — every getter has a well-defined default.
//   2. Must NEVER throw on corrupt data — reset that key to defaults and keep going. The game
//      must always start; losing settings/scores/levels to corruption is an acceptable failure,
//      a white screen is not.
//
// The one deliberate exception is `saveCustomLevel` / `deleteCustomLevel`: a real quota-exceeded
// error on an explicit save must surface to the caller rather than be silently dropped. See the
// long comment above `persistCustomLevelsOrThrow`
// for how that's reconciled with rule 2 above — short version: rule 2 is about STORAGE BEING
// UNAVAILABLE OR CORRUPT (detected once, up front, and permanently degrades to an in-memory
// fallback with no further errors), whereas the custom-level quota case is a WORKING store that
// is legitimately out of room on one specific write.

import type { Level, Settings } from "@swingby/core";
import { customLevelId, DEFAULT_SETTINGS } from "@swingby/core";
import {
  isPlainObject,
  looksLikeLevel,
  migrateBestsFile,
  migrateCustomLevelMetaFile,
  migrateCustomLevelsFile,
  migrateSettingsFile,
  sanitizePersonalBest,
  SCHEMA_VERSION,
  type BestsFileV1,
  type CustomLevelMetaFileV1,
  type CustomLevelsFileV1,
  type SettingsFileV1,
} from "./migrate.js";

export interface PersonalBest {
  timeMs: number;
  boostMs: number;
}

export interface Storage {
  getSettings(): Settings;
  setSettings(patch: Partial<Settings>): void;
  getBest(levelId: string): PersonalBest | null;
  recordBest(
    levelId: string,
    r: PersonalBest,
  ): { timeIsNew: boolean; boostIsNew: boolean };
  listCustomLevels(): Level[];
  saveCustomLevel(level: Level, opts?: { createdAt?: string }): void;
  deleteCustomLevel(id: string): void;
  /** ISO creation timestamp for a custom level, or null when it predates this tracking (saved
   *  before this key existed) or `id` names no known custom level. */
  getCustomLevelCreatedAt(id: string): string | null;
  export(): string; // full JSON backup
  import(json: string): void;
}

const KEYS = {
  settings: "swingby:settings",
  bests: "swingby:bests",
  customLevels: "swingby:custom_levels",
  customLevelMeta: "swingby:custom_level_meta",
} as const;

// ---------------------------------------------------------------------------
// Backing store: real localStorage when it works, an in-memory Map when it doesn't.
// ---------------------------------------------------------------------------

/** The minimal slice of the `Storage` DOM interface (confusingly, same name) this module needs. */
interface BackingStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class MemoryBackingStore implements BackingStore {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function warn(message: string, err?: unknown): void {
  try {
    // eslint-disable-next-line no-console -- this module's one sanctioned diagnostic channel
    console.warn(`[swingby/storage] ${message}`, err ?? "");
  } catch {
    // Even console can be missing/broken in a sufficiently locked-down host. Never let logging
    // itself be the thing that throws.
  }
}

/** `globalThis.localStorage`, or null if absent, non-conforming, or throws just to look at it. */
function readGlobalLocalStorage(): BackingStore | null {
  try {
    const candidate = (globalThis as { localStorage?: unknown }).localStorage;
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      typeof (candidate as BackingStore).getItem === "function" &&
      typeof (candidate as BackingStore).setItem === "function" &&
      typeof (candidate as BackingStore).removeItem === "function"
    ) {
      return candidate as BackingStore;
    }
    return null;
  } catch {
    return null;
  }
}

/** A no-op round trip write, used only to detect "present but throws on every write" (Safari
 *  private mode: `localStorage` exists, `setItem` always throws QuotaExceededError). */
function probeWritable(store: BackingStore): boolean {
  const probeKey = "swingby:__probe__";
  try {
    store.setItem(probeKey, "1");
    store.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

function chooseBackingStore(): { store: BackingStore; degraded: boolean } {
  const candidate = readGlobalLocalStorage();
  if (candidate && probeWritable(candidate)) {
    return { store: candidate, degraded: false };
  }
  return { store: new MemoryBackingStore(), degraded: true };
}

/** Read + JSON.parse a key. Never throws — returns `undefined` for missing/unreadable/corrupt. */
function readJson(store: BackingStore, key: string): unknown {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch (err) {
    warn(`could not read "${key}", using defaults`, err);
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    warn(`corrupt JSON at "${key}", resetting to defaults`, err);
    return undefined;
  }
}

/** Deep clone via JSON — safe for `Level`, which is plain JSON-serialisable data by contract. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Settings merge — fills defaults, preserves unknown fields.
// ---------------------------------------------------------------------------

function mergeSettings(
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const defaultControls = DEFAULT_SETTINGS.controls as Record<string, string>;
  const storedControls = isPlainObject(stored.controls) ? stored.controls : {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    // Controls get their own merge (default-fill + preserve-unknown), same idea as the top level
    // but one layer down — otherwise a stored `controls` object missing one action would lose the
    // rest of the defaults for every OTHER action too, since the outer spread replaces it wholesale.
    controls: { ...defaultControls, ...storedControls },
  };
}

function toSettings(merged: Record<string, unknown>): Settings {
  const controls = isPlainObject(merged.controls) ? merged.controls : {};
  return { ...merged, controls: { ...controls } } as Settings;
}

// ---------------------------------------------------------------------------
// createStorage
// ---------------------------------------------------------------------------

export function createStorage(): Storage {
  const { store, degraded } = chooseBackingStore();
  if (degraded) {
    warn(
      "localStorage unavailable (absent, or throws on write) — using an in-memory, non-persistent fallback for this session",
    );
  }

  // Each cache is hydrated once, synchronously, at construction — this is what makes every
  // Storage method below able to be synchronous despite JSON.parse/localStorage access, per the
  // frozen (non-async) interface.
  let settingsCache: Record<string, unknown> = mergeSettings(
    migrateSettingsFile(readJson(store, KEYS.settings)).settings,
  );
  let bestsCache: Record<string, PersonalBest> = migrateBestsFile(
    readJson(store, KEYS.bests),
  ).bests;
  let customLevelsCache: Level[] = migrateCustomLevelsFile(
    readJson(store, KEYS.customLevels),
  ).levels;
  let customLevelMetaCache: Record<string, string> = migrateCustomLevelMetaFile(
    readJson(store, KEYS.customLevelMeta),
  ).createdAt;

  // Settings/bests writes are OPTIMISTIC: update the in-memory cache first, then best-effort
  // persist. A persistence failure here (e.g. the store degrades mid-session) is swallowed —
  // the caller always sees its write take effect for the rest of the session, which is the
  // "game stays playable, losing settings is an acceptable failure" contract. This is
  // deliberately different from custom-level writes below.
  function persistSettings(): void {
    const payload: SettingsFileV1 = {
      schemaVersion: SCHEMA_VERSION,
      settings: settingsCache,
    };
    try {
      store.setItem(KEYS.settings, JSON.stringify(payload));
    } catch (err) {
      warn("failed to persist settings (kept in memory for this session)", err);
    }
  }

  function persistBests(): void {
    const payload: BestsFileV1 = {
      schemaVersion: SCHEMA_VERSION,
      bests: bestsCache,
    };
    try {
      store.setItem(KEYS.bests, JSON.stringify(payload));
    } catch (err) {
      warn(
        "failed to persist personal bests (kept in memory for this session)",
        err,
      );
    }
  }

  // Custom-level writes are PERSIST-FIRST and let a write error propagate: if `store.setItem`
  // throws (a real quota-exceeded on a store that has been working all session), the caller gets
  // the exception and `customLevelsCache` is left untouched, so the cache and the backing store
  // never disagree about what was actually saved. This is the explicit exception to "never
  // throw": a quota-exceeded error on a custom level save must surface a clear error to the
  // caller, not be silently dropped. It does NOT apply when the store was already degraded at
  // startup (Safari private mode etc.) — `MemoryBackingStore.setItem` never throws, so in that mode
  // saves always "succeed" (in memory only), which is correct: the game must stay fully
  // playable without persistence, per the interface doc's non-negotiable rule.
  function persistCustomLevelsOrThrow(next: Level[]): void {
    const payload: CustomLevelsFileV1 = {
      schemaVersion: SCHEMA_VERSION,
      levels: next,
    };
    store.setItem(KEYS.customLevels, JSON.stringify(payload));
    customLevelsCache = next;
  }

  // Creation-date metadata is secondary to the level list itself: a failure here is logged and
  // swallowed rather than thrown (matching persistSettings/persistBests), so losing a "created at"
  // timestamp never blocks or rolls back a level save that already succeeded above.
  function persistCustomLevelMeta(): void {
    const payload: CustomLevelMetaFileV1 = {
      schemaVersion: SCHEMA_VERSION,
      createdAt: customLevelMetaCache,
    };
    try {
      store.setItem(KEYS.customLevelMeta, JSON.stringify(payload));
    } catch (err) {
      warn(
        "failed to persist custom level creation dates (kept in memory for this session)",
        err,
      );
    }
  }

  return {
    getSettings(): Settings {
      return toSettings(settingsCache);
    },

    setSettings(patch: Partial<Settings>): void {
      const patchObj = patch as Record<string, unknown>;
      const nextControls = isPlainObject(patchObj.controls)
        ? {
            ...(settingsCache.controls as Record<string, unknown>),
            ...patchObj.controls,
          }
        : settingsCache.controls;
      settingsCache = { ...settingsCache, ...patchObj, controls: nextControls };
      persistSettings();
    },

    getBest(levelId: string): PersonalBest | null {
      const entry = bestsCache[levelId];
      return entry ? { ...entry } : null;
    },

    recordBest(
      levelId: string,
      r: PersonalBest,
    ): { timeIsNew: boolean; boostIsNew: boolean } {
      const existing = bestsCache[levelId];
      const timeIsNew = !existing || r.timeMs < existing.timeMs;
      const boostIsNew = !existing || r.boostMs < existing.boostMs;
      if (timeIsNew || boostIsNew) {
        bestsCache = {
          ...bestsCache,
          [levelId]: {
            timeMs: timeIsNew ? r.timeMs : (existing as PersonalBest).timeMs,
            boostMs: boostIsNew
              ? r.boostMs
              : (existing as PersonalBest).boostMs,
          },
        };
        persistBests();
      }
      return { timeIsNew, boostIsNew };
    },

    listCustomLevels(): Level[] {
      return cloneJson(customLevelsCache);
    },

    saveCustomLevel(level: Level, opts?: { createdAt?: string }): void {
      persistCustomLevelsOrThrow([...customLevelsCache, cloneJson(level)]);
      customLevelMetaCache = {
        ...customLevelMetaCache,
        [customLevelId(level)]: opts?.createdAt ?? new Date().toISOString(),
      };
      persistCustomLevelMeta();
    },

    deleteCustomLevel(id: string): void {
      const next = customLevelsCache.filter((l) => customLevelId(l) !== id);
      if (next.length === customLevelsCache.length) return; // nothing matched — quiet no-op
      persistCustomLevelsOrThrow(next);
      if (id in customLevelMetaCache) {
        customLevelMetaCache = Object.fromEntries(
          Object.entries(customLevelMetaCache).filter(([key]) => key !== id),
        );
        persistCustomLevelMeta();
      }
    },

    getCustomLevelCreatedAt(id: string): string | null {
      return customLevelMetaCache[id] ?? null;
    },

    export(): string {
      const payload = {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        settings: settingsCache,
        bests: bestsCache,
        customLevels: customLevelsCache,
      };
      return JSON.stringify(payload, null, 2);
    },

    import(json: string): void {
      let raw: unknown;
      try {
        raw = JSON.parse(json);
      } catch (err) {
        warn("import(): invalid JSON, ignoring", err);
        return;
      }
      if (!isPlainObject(raw)) {
        warn("import(): unrecognised top-level shape, ignoring");
        return;
      }

      // Settings: merge over current state (same rule as setSettings — preserve unknown fields,
      // never wholesale-replace).
      if (isPlainObject(raw.settings)) {
        const patchObj = raw.settings;
        const nextControls = isPlainObject(patchObj.controls)
          ? {
              ...(settingsCache.controls as Record<string, unknown>),
              ...patchObj.controls,
            }
          : settingsCache.controls;
        settingsCache = {
          ...settingsCache,
          ...patchObj,
          controls: nextControls,
        };
        persistSettings();
      }

      // Bests: merge, improving each metric independently per level — restoring an older backup
      // must never regress a best already achieved locally since that backup was made.
      if (isPlainObject(raw.bests)) {
        const draft = { ...bestsCache };
        for (const [id, value] of Object.entries(raw.bests)) {
          const clean = sanitizePersonalBest(value);
          if (!clean) continue;
          const existing = draft[id];
          draft[id] = {
            timeMs:
              existing && existing.timeMs <= clean.timeMs
                ? existing.timeMs
                : clean.timeMs,
            boostMs:
              existing && existing.boostMs <= clean.boostMs
                ? existing.boostMs
                : clean.boostMs,
          };
        }
        bestsCache = draft;
        persistBests();
      }

      // Custom levels: append anything not already present (dedupe by customLevelId). A quota
      // failure here is caught and logged rather than thrown — `import()` is bulk/best-effort by
      // nature: corrupt/unusable input must never crash the caller, unlike the single explicit
      // `saveCustomLevel` action.
      if (Array.isArray(raw.customLevels)) {
        const existingIds = new Set(
          customLevelsCache.map((l) => customLevelId(l)),
        );
        const additions = raw.customLevels.filter(
          (l): l is Level =>
            looksLikeLevel(l) && !existingIds.has(customLevelId(l)),
        );
        if (additions.length > 0) {
          try {
            persistCustomLevelsOrThrow([...customLevelsCache, ...additions]);
          } catch (err) {
            warn(
              "import(): failed to persist imported custom levels (quota?); previous state kept",
              err,
            );
          }
        }
      }
    },
  };
}
