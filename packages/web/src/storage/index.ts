/**
 * T-10 VAULT — local persistence.
 *
 * The only module in this codebase allowed to touch `localStorage` / `indexedDB` directly (see
 * tasks/T-10-VAULT.md "Note"). T-06 HELM's rebinding and T-08 BRIDGE's settings screen both go
 * through `setSettings()`.
 *
 * Backend choice (per the task doc): `localStorage` for settings and personal bests — small,
 * synchronous, never touched by the game loop. `IndexedDB` for custom levels, which are unbounded.
 * The async boundary is kept inside this module: `listCustomLevels()` is synchronous and reads
 * from an in-memory cache that is hydrated from IndexedDB in the background at `createStorage()`
 * time.
 *
 * Robustness contract: getters never throw. Corrupt JSON or the wrong shape at any key resets
 * that key to defaults and keeps going. If `localStorage` itself throws on access (Safari private
 * mode), everything falls back to an in-memory store transparently.
 */

import type { Level, Settings } from "@swingby/core";
import { DEFAULT_CONTROLS, DEFAULT_SETTINGS } from "@swingby/core";
import {
  VAULT_SCHEMA_VERSION,
  defaultGodotLevelId,
  isPlainObject,
  mapGodotScores,
  parseGodotScores,
  readEnvelope,
  type GodotImportResult,
  type GodotLevelCategory,
  type ScorePatch,
} from "./migrate.js";

// ---------------------------------------------------------------------------
// Public interface — exactly as frozen in INTERFACES.md
// ---------------------------------------------------------------------------

export interface PersonalBest {
  timeMs: number;
  boostMs: number;
}

export interface Storage {
  getSettings(): Settings;
  setSettings(patch: Partial<Settings>): void;
  getBest(levelId: string): PersonalBest | null;
  recordBest(levelId: string, r: PersonalBest): { timeIsNew: boolean; boostIsNew: boolean };
  listCustomLevels(): Level[];
  saveCustomLevel(level: Level): void;
  deleteCustomLevel(id: string): void;
  export(): string; // full JSON backup
  import(json: string): void;
}

/**
 * `createStorage()`'s concrete return type. A strict superset of `Storage` — every method of
 * `Storage` is implemented exactly as specified; `importGodotScores` is an additive extension
 * (not a change to the frozen shape) that fulfils the task's "desktop player can carry their
 * bests over by pasting a file" requirement. Anything coded against the `Storage` interface
 * continues to work unmodified.
 */
export interface VaultStorage extends Storage {
  /**
   * Merges a desktop Godot `scores.json` into local bests. Improves each metric independently
   * and never regresses an existing (better) local score. Throws on invalid JSON — this is an
   * explicit, user-initiated action ("paste a file"), unlike the getters above which never throw.
   */
  importGodotScores(
    raw: string,
    toLevelId?: (category: GodotLevelCategory, index: number) => string,
  ): GodotImportResult;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "swingby.settings";
const SCORES_KEY = "swingby.scores";

/** Exported for tests that need to pre-seed or inspect this module's own storage footprint
 *  directly (corrupting a key, clearing the DB between cases). Not part of the frozen
 *  `Storage`/`VaultStorage` contract. */
export const VAULT_IDB_DB_NAME = "swingby-vault";
export const VAULT_IDB_STORE_NAME = "vault";
export const VAULT_IDB_CUSTOM_LEVELS_KEY = "customLevels";

const IDB_DB_NAME = VAULT_IDB_DB_NAME;
const IDB_STORE = VAULT_IDB_STORE_NAME;
const IDB_VERSION = 1;
const IDB_CUSTOM_LEVELS_KEY = VAULT_IDB_CUSTOM_LEVELS_KEY;

/**
 * Soft cap enforced by this module, independent of whatever real quota the browser gives
 * IndexedDB. Deliberately conservative (well under any realistic browser IndexedDB quota) so:
 *   (a) the "quota exceeded" path is deterministic and testable without a real browser, and
 *   (b) the background IndexedDB write that follows a successful `saveCustomLevel` is extremely
 *       unlikely to hit the browser's own (far larger, non-deterministic) quota.
 * `saveCustomLevel` throws synchronously against this cap, per the task's "surface a clear error
 * to the caller; do not silently drop" requirement — something the async IndexedDB write itself
 * cannot do against the frozen synchronous `void` signature. See the comment on
 * `persistCustomLevelsAsync` for that tradeoff.
 */
const CUSTOM_LEVELS_SOFT_QUOTA_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** Feature-detects a working `localStorage`. Falls back to an in-memory store on any failure —
 *  disabled cookies, Safari private mode (throws on `setItem`), or no `localStorage` at all
 *  (this module also runs in node-based tests). */
function detectLocalStorage(): StorageLike {
  try {
    const candidate = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!candidate) return createMemoryStorage();
    const probeKey = "swingby.__probe__";
    candidate.setItem(probeKey, "1");
    candidate.removeItem(probeKey);
    return candidate;
  } catch {
    return createMemoryStorage();
  }
}

function safeJsonParse(raw: string | null): unknown {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function looksLikeLevel(v: unknown): v is Level {
  if (!isPlainObject(v)) return false;
  if (typeof v.name !== "string" || typeof v.author !== "string") return false;
  if (!isPlainObject(v.goal)) return false;
  if (typeof v.goal.index !== "number" || typeof v.goal.range !== "number") return false;
  return Array.isArray(v.objects);
}

/** Pure JS djb2 string hash — deterministic, no crypto dependency, fine for a non-adversarial
 *  local id, not a security boundary. */
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33 + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "level";
}

/**
 * `Level` (frozen in types.ts) carries no id field, and Godot's own `custom_levels.json` is a
 * bare array with no ids either — positional only. Since `deleteCustomLevel(id)` needs a stable
 * string, this derives one deterministically from level content (name slug + content hash), so
 * the same level always maps to the same id without this module having to persist a separate id
 * table. Exported so callers (e.g. T-11 DRAFT's level list) can compute the id of a `Level` they
 * got back from `listCustomLevels()`.
 */
export function customLevelId(level: Level): string {
  return `${slugify(level.name)}-${djb2(JSON.stringify(level)).toString(36)}`;
}

function byteLength(s: string): number {
  // TextEncoder is available in every target this module runs in (browser + node >= 11).
  return new TextEncoder().encode(s).length;
}

// ---------------------------------------------------------------------------
// IndexedDB helpers (custom levels only)
// ---------------------------------------------------------------------------

function idbAvailable(): boolean {
  return typeof (globalThis as { indexedDB?: IDBFactory }).indexedDB !== "undefined";
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!idbAvailable()) {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
  });
}

async function idbGet(key: string): Promise<unknown> {
  const db = await openVaultDb();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB read failed"));
    });
  } finally {
    db.close();
  }
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openVaultDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB write failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB write aborted"));
    });
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Score entry shape
// ---------------------------------------------------------------------------

interface ScoreEntry {
  timeMs?: number;
  timeName?: string;
  boostMs?: number;
  boostName?: string;
}

interface ScoresData {
  levels: Record<string, ScoreEntry>;
}

function isScoresData(v: unknown): v is ScoresData {
  return isPlainObject(v) && (v.levels === undefined || isPlainObject(v.levels));
}

function normalizeScoresData(v: ScoresData): ScoresData {
  return { levels: isPlainObject(v.levels) ? (v.levels as Record<string, ScoreEntry>) : {} };
}

function isSettingsData(v: unknown): v is Record<string, unknown> {
  return isPlainObject(v);
}

function isCustomLevelsData(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

// ---------------------------------------------------------------------------
// createStorage
// ---------------------------------------------------------------------------

export function createStorage(): VaultStorage {
  const backend = detectLocalStorage();

  // --- settings ---
  let settingsState: Record<string, unknown> = (() => {
    const envelope = readEnvelope(safeJsonParse(backend.getItem(SETTINGS_KEY)), {}, isSettingsData);
    return envelope.data;
  })();

  function persistSettings(): void {
    try {
      backend.setItem(
        SETTINGS_KEY,
        JSON.stringify({ version: VAULT_SCHEMA_VERSION, data: settingsState }),
      );
    } catch (err) {
      // Writes may start failing mid-session (e.g. quota, or storage revoked). Never let a
      // settings write crash the game; the in-memory value is still correct for this session.
      console.warn("[vault] failed to persist settings, continuing in-memory", err);
    }
  }

  function currentUsername(): string {
    const value = settingsState.username;
    return typeof value === "string" && value.trim() !== "" ? value : DEFAULT_SETTINGS.username;
  }

  // --- scores ---
  let scoresState: ScoresData = (() => {
    const envelope = readEnvelope(safeJsonParse(backend.getItem(SCORES_KEY)), { levels: {} }, isScoresData);
    return normalizeScoresData(envelope.data);
  })();

  function persistScores(): void {
    try {
      backend.setItem(SCORES_KEY, JSON.stringify({ version: VAULT_SCHEMA_VERSION, data: scoresState }));
    } catch (err) {
      console.warn("[vault] failed to persist scores, continuing in-memory", err);
    }
  }

  // --- custom levels (IndexedDB, in-memory cache) ---
  let customLevelsCache = new Map<string, Level>();

  const hydration: Promise<void> = (async () => {
    if (!idbAvailable()) return;
    try {
      const raw = await idbGet(IDB_CUSTOM_LEVELS_KEY);
      const envelope = readEnvelope(raw, { levels: [] as unknown[] }, (v): v is { levels: unknown[] } =>
        isPlainObject(v) && Array.isArray(v.levels),
      );
      const next = new Map<string, Level>();
      for (const candidate of envelope.data.levels) {
        if (looksLikeLevel(candidate)) next.set(customLevelId(candidate), candidate);
        else console.warn("[vault] dropping malformed stored custom level", candidate);
      }
      customLevelsCache = next;
    } catch (err) {
      // IndexedDB missing, blocked, or corrupt: keep going with an empty in-memory list. The
      // game must never fail to start because of this.
      console.warn("[vault] custom levels unavailable, starting with an empty list", err);
    }
  })();
  // Hydration failures are already handled above; this exists only so an unexpected synchronous
  // rejection can never become an unhandled promise rejection.
  hydration.catch(() => {});

  function persistCustomLevelsAsync(levels: Level[]): void {
    if (!idbAvailable()) return;
    // Fire-and-forget: the frozen Storage interface is synchronous (`void`), so a background
    // IndexedDB failure here cannot be re-surfaced to the original caller. The synchronous soft
    // quota check in saveCustomLevel (well under any real browser quota) is what actually
    // fulfils "surface a clear error to the caller" from the task doc; this background write is
    // logged loudly on failure so it is at least discoverable, but is intentionally best-effort.
    idbPut(IDB_CUSTOM_LEVELS_KEY, { version: VAULT_SCHEMA_VERSION, data: { levels } }).catch((err) => {
      console.error("[vault] failed to persist custom levels to indexedDB", err);
    });
  }

  // --- Storage implementation ---

  const api: VaultStorage = {
    getSettings(): Settings {
      const controls = isPlainObject(settingsState.controls)
        ? { ...DEFAULT_CONTROLS, ...(settingsState.controls as Record<string, string>) }
        : { ...DEFAULT_CONTROLS };
      return { ...DEFAULT_SETTINGS, ...settingsState, controls } as Settings;
    },

    setSettings(patch: Partial<Settings>): void {
      const next: Record<string, unknown> = { ...settingsState, ...patch };
      if (patch.controls) {
        const existingControls = isPlainObject(settingsState.controls)
          ? (settingsState.controls as Record<string, string>)
          : DEFAULT_CONTROLS;
        next.controls = { ...existingControls, ...patch.controls };
      }
      settingsState = next;
      persistSettings();
    },

    getBest(levelId: string): PersonalBest | null {
      const entry = scoresState.levels[levelId];
      if (!entry) return null;
      // Infinity marks "not recorded yet" for a metric — same sentinel Godot's own code uses
      // (`float(existing.get("time", INF))`). It is a legitimate finite-free `number`, so this
      // still satisfies PersonalBest's non-optional fields honestly rather than lying with 0.
      return {
        timeMs: entry.timeMs ?? Infinity,
        boostMs: entry.boostMs ?? Infinity,
      };
    },

    recordBest(levelId: string, r: PersonalBest): { timeIsNew: boolean; boostIsNew: boolean } {
      const existing = scoresState.levels[levelId] ?? {};
      const timeIsNew = existing.timeMs === undefined || r.timeMs < existing.timeMs;
      const boostIsNew = existing.boostMs === undefined || r.boostMs < existing.boostMs;
      const username = currentUsername();

      const next: ScoreEntry = { ...existing };
      if (timeIsNew) {
        next.timeMs = r.timeMs;
        next.timeName = username;
      }
      if (boostIsNew) {
        next.boostMs = r.boostMs;
        next.boostName = username;
      }
      scoresState.levels[levelId] = next;
      persistScores();
      return { timeIsNew, boostIsNew };
    },

    listCustomLevels(): Level[] {
      return Array.from(customLevelsCache.values());
    },

    saveCustomLevel(level: Level): void {
      const id = customLevelId(level);
      const next = new Map(customLevelsCache);
      next.set(id, level);
      const levels = Array.from(next.values());
      const bytes = byteLength(JSON.stringify(levels));
      if (bytes > CUSTOM_LEVELS_SOFT_QUOTA_BYTES) {
        throw new Error(
          `Custom level storage quota exceeded (${bytes} bytes > ${CUSTOM_LEVELS_SOFT_QUOTA_BYTES} byte limit). ` +
            "Delete a level or export your levels before saving another.",
        );
      }
      customLevelsCache = next;
      persistCustomLevelsAsync(levels);
    },

    deleteCustomLevel(id: string): void {
      if (!customLevelsCache.has(id)) return;
      const next = new Map(customLevelsCache);
      next.delete(id);
      customLevelsCache = next;
      persistCustomLevelsAsync(Array.from(next.values()));
    },

    export(): string {
      const payload = {
        version: VAULT_SCHEMA_VERSION,
        settings: api.getSettings(),
        scores: scoresState.levels,
        customLevels: Array.from(customLevelsCache.values()),
      };
      return JSON.stringify(payload, null, 2);
    },

    import(json: string): void {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch (err) {
        throw new Error(`Vault import failed: not valid JSON (${(err as Error).message})`);
      }
      if (!isPlainObject(parsed)) {
        throw new Error("Vault import failed: expected a JSON object with settings/scores/customLevels");
      }

      if (isPlainObject(parsed.settings)) {
        settingsState = { ...settingsState, ...parsed.settings };
        persistSettings();
      }

      if (isPlainObject(parsed.scores)) {
        scoresState = { levels: { ...scoresState.levels, ...(parsed.scores as Record<string, ScoreEntry>) } };
        persistScores();
      }

      if (isCustomLevelsData(parsed.customLevels)) {
        const next = new Map(customLevelsCache);
        for (const candidate of parsed.customLevels) {
          if (looksLikeLevel(candidate)) next.set(customLevelId(candidate), candidate);
        }
        customLevelsCache = next;
        persistCustomLevelsAsync(Array.from(next.values()));
      }
    },

    importGodotScores(
      raw: string,
      toLevelId: (category: GodotLevelCategory, index: number) => string = defaultGodotLevelId,
    ): GodotImportResult {
      const godot = parseGodotScores(raw);
      if (!godot) {
        throw new Error("Godot scores.json import failed: not valid JSON or unexpected shape");
      }
      const mapped = mapGodotScores(godot, toLevelId);

      for (const [levelId, patch] of Object.entries(mapped.levels)) {
        applyScorePatch(levelId, patch);
      }
      persistScores();
      return mapped;
    },
  };

  function applyScorePatch(levelId: string, patch: ScorePatch): void {
    const existing = scoresState.levels[levelId] ?? {};
    const next: ScoreEntry = { ...existing };
    // Only touch the fields the patch actually supplies, and only if they improve on what is
    // already recorded — an import must never regress an existing local best, and must never
    // invent a fake "best" (e.g. Infinity) for a metric it has no data for.
    if (patch.timeMs !== undefined && (existing.timeMs === undefined || patch.timeMs < existing.timeMs)) {
      next.timeMs = patch.timeMs;
      next.timeName = patch.timeName;
    }
    if (patch.boostMs !== undefined && (existing.boostMs === undefined || patch.boostMs < existing.boostMs)) {
      next.boostMs = patch.boostMs;
      next.boostName = patch.boostName;
    }
    scoresState.levels[levelId] = next;
  }

  return api;
}
