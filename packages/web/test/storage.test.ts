// Real IndexedDB implementation for node — needed so the custom-levels backend can be exercised
// for real instead of only through its "unavailable" fallback path. Side-effect import: installs
// `indexedDB` / `IDBKeyRange` on globalThis.
import "fake-indexeddb/auto";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Level } from "@swingby/core";
import {
  createStorage,
  customLevelId,
  VAULT_IDB_CUSTOM_LEVELS_KEY,
  VAULT_IDB_DB_NAME,
  VAULT_IDB_STORE_NAME,
} from "../src/storage/index.js";
import { mapGodotScores, parseGodotScores } from "../src/storage/migrate.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// ---------------------------------------------------------------------------
// Fake localStorage — lets us simulate "reload" (same backing map across two
// createStorage() calls), corruption (pre-seed garbage), and Safari private mode
// (setItem throws).
// ---------------------------------------------------------------------------

class FakeLocalStorage {
  private map = new Map<string, string>();
  constructor(private opts: { throwOnSet?: boolean; throwOnGet?: boolean } = {}) {}
  getItem(key: string): string | null {
    if (this.opts.throwOnGet) throw new Error("simulated storage access failure");
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    if (this.opts.throwOnSet) {
      const err = new Error("QuotaExceededError");
      err.name = "QuotaExceededError";
      throw err;
    }
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  raw(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  seed(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function deleteVaultDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(VAULT_IDB_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function seedVaultIdb(value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const openReq = indexedDB.open(VAULT_IDB_DB_NAME, 1);
    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      if (!db.objectStoreNames.contains(VAULT_IDB_STORE_NAME)) db.createObjectStore(VAULT_IDB_STORE_NAME);
    };
    openReq.onsuccess = () => {
      const db = openReq.result;
      const tx = db.transaction(VAULT_IDB_STORE_NAME, "readwrite");
      tx.objectStore(VAULT_IDB_STORE_NAME).put(value, VAULT_IDB_CUSTOM_LEVELS_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    openReq.onerror = () => reject(openReq.error);
  });
}

function makeLevel(overrides: Partial<Level> = {}): Level {
  return {
    name: "Test Level",
    author: "Tester",
    goal: { index: 1, range: 50 },
    objects: [
      { type: "player", x: 0, y: 0, x_vel: 1, y_vel: 0, gravity: 0 },
      { type: "sun", x: 500, y: 500, gravity: 1000, size: 20 },
    ],
    ...overrides,
  };
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await deleteVaultDb();
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe("settings", () => {
  it("round-trips across a simulated reload", () => {
    const backing = new FakeLocalStorage();
    vi.stubGlobal("localStorage", backing);

    const first = createStorage();
    first.setSettings({ username: "Magnus", trail: true, showFps: true });

    const second = createStorage();
    const settings = second.getSettings();
    expect(settings.username).toBe("Magnus");
    expect(settings.trail).toBe(true);
    expect(settings.showFps).toBe(true);
    // Untouched defaults still present.
    expect(settings.showHighscores).toBe(true);
    expect(settings.controls.boost).toBe("Space");
  });

  it("preserves unknown fields across a write cycle (forward compatibility)", () => {
    const backing = new FakeLocalStorage();
    backing.seed(
      "swingby.settings",
      JSON.stringify({
        version: 1,
        data: { username: "FutureUser", aFieldFromANewerBuild: { nested: true, n: 7 } },
      }),
    );
    vi.stubGlobal("localStorage", backing);

    const storage = createStorage();
    // getSettings() carries the unknown field through structurally...
    expect((storage.getSettings() as unknown as Record<string, unknown>).aFieldFromANewerBuild).toEqual({
      nested: true,
      n: 7,
    });

    // ...and it must still be there after this (older) build writes through setSettings.
    storage.setSettings({ trail: true });
    const reloaded = createStorage();
    expect((reloaded.getSettings() as unknown as Record<string, unknown>).aFieldFromANewerBuild).toEqual({
      nested: true,
      n: 7,
    });
    expect(reloaded.getSettings().trail).toBe(true);
  });

  it("resets to defaults on corrupt JSON without throwing", () => {
    const backing = new FakeLocalStorage();
    backing.seed("swingby.settings", "{{{not json");
    vi.stubGlobal("localStorage", backing);

    expect(() => createStorage()).not.toThrow();
    const storage = createStorage();
    expect(storage.getSettings()).toEqual(expect.objectContaining({ username: "Guest" }));
  });

  it("resets to defaults on valid JSON of the wrong shape (array instead of object)", () => {
    const backing = new FakeLocalStorage();
    backing.seed("swingby.settings", "[]");
    vi.stubGlobal("localStorage", backing);

    expect(() => createStorage()).not.toThrow();
    const storage = createStorage();
    expect(storage.getSettings()).toEqual(expect.objectContaining({ username: "Guest" }));
  });
});

// ---------------------------------------------------------------------------
// Personal bests
// ---------------------------------------------------------------------------

describe("personal bests", () => {
  it("has no best for a level that has never been played", () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    const storage = createStorage();
    expect(storage.getBest("builtin-01")).toBeNull();
  });

  it("records the first run as both bests", () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    const storage = createStorage();
    const result = storage.recordBest("builtin-01", { timeMs: 10_000, boostMs: 500 });
    expect(result).toEqual({ timeIsNew: true, boostIsNew: true });
    expect(storage.getBest("builtin-01")).toEqual({ timeMs: 10_000, boostMs: 500 });
  });

  it("improves time and boost independently — a run can beat one without the other", () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    const storage = createStorage();
    storage.recordBest("builtin-01", { timeMs: 10_000, boostMs: 500 });

    // Beats time, but boost is worse.
    const result = storage.recordBest("builtin-01", { timeMs: 8_000, boostMs: 900 });
    expect(result).toEqual({ timeIsNew: true, boostIsNew: false });

    const best = storage.getBest("builtin-01");
    expect(best?.timeMs).toBe(8_000);
    expect(best?.boostMs).toBe(500); // unchanged
  });

  it("improves boost without touching time when only boost gets better", () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    const storage = createStorage();
    storage.recordBest("builtin-01", { timeMs: 10_000, boostMs: 500 });

    const result = storage.recordBest("builtin-01", { timeMs: 20_000, boostMs: 100 });
    expect(result).toEqual({ timeIsNew: false, boostIsNew: true });

    const best = storage.getBest("builtin-01");
    expect(best?.timeMs).toBe(10_000); // unchanged
    expect(best?.boostMs).toBe(100);
  });

  it("resets scores to defaults on corrupt JSON without throwing", () => {
    const backing = new FakeLocalStorage();
    backing.seed("swingby.scores", "{{{not json");
    vi.stubGlobal("localStorage", backing);

    expect(() => createStorage()).not.toThrow();
    const storage = createStorage();
    expect(storage.getBest("builtin-01")).toBeNull();
  });

  it("resets scores to defaults on valid JSON of the wrong shape (array instead of object)", () => {
    const backing = new FakeLocalStorage();
    backing.seed("swingby.scores", "[]");
    vi.stubGlobal("localStorage", backing);

    expect(() => createStorage()).not.toThrow();
    const storage = createStorage();
    expect(storage.getBest("builtin-01")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// localStorage unavailable
// ---------------------------------------------------------------------------

describe("localStorage unavailable", () => {
  it("falls back to an in-memory store when localStorage throws (Safari private mode)", () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage({ throwOnSet: true }));

    expect(() => createStorage()).not.toThrow();
    const storage = createStorage();

    // Fully playable: settings and bests work for the session even though nothing persists.
    expect(() => storage.setSettings({ username: "Ghost" })).not.toThrow();
    expect(storage.getSettings().username).toBe("Ghost");
    expect(() => storage.recordBest("builtin-01", { timeMs: 1, boostMs: 1 })).not.toThrow();
    expect(storage.getBest("builtin-01")).toEqual({ timeMs: 1, boostMs: 1 });
  });

  it("falls back to an in-memory store when localStorage does not exist at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => createStorage()).not.toThrow();
    const storage = createStorage();
    expect(() => storage.setSettings({ username: "Ghost" })).not.toThrow();
    expect(storage.getSettings().username).toBe("Ghost");
  });
});

// ---------------------------------------------------------------------------
// Custom levels (IndexedDB-backed)
// ---------------------------------------------------------------------------

describe("custom levels", () => {
  it("round-trips through IndexedDB across a simulated reload", async () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    const level = makeLevel({ name: "My Level" });

    const first = createStorage();
    first.saveCustomLevel(level);
    expect(first.listCustomLevels()).toEqual([level]);

    const second = createStorage();
    await vi.waitFor(() => {
      expect(second.listCustomLevels()).toEqual([level]);
    });
  });

  it("deletes a custom level by its derived id", async () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    const storage = createStorage();
    const level = makeLevel({ name: "Deletable" });
    storage.saveCustomLevel(level);
    expect(storage.listCustomLevels()).toHaveLength(1);

    storage.deleteCustomLevel(customLevelId(level));
    expect(storage.listCustomLevels()).toHaveLength(0);
  });

  it("round-trips a level near the internal size limit", () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    const storage = createStorage();
    // ~3.5MB of object payload, comfortably under the 4MB soft cap on its own.
    const big = makeLevel({
      name: "Big Level",
      objects: Array.from({ length: 40_000 }, (_, i) => ({
        type: "planet" as const,
        x: i,
        y: i,
        gravity: 10,
      })),
    });
    expect(() => storage.saveCustomLevel(big)).not.toThrow();
    expect(storage.listCustomLevels()).toEqual([big]);
  });

  it("surfaces a clear error when the internal quota is exceeded, without dropping existing data", () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    const storage = createStorage();

    let threw = false;
    let savedCount = 0;
    try {
      for (let i = 0; i < 200; i++) {
        const level = makeLevel({
          name: `Level ${i}`,
          objects: Array.from({ length: 5_000 }, (_, j) => ({
            type: "planet" as const,
            x: j,
            y: j,
            gravity: 10,
          })),
        });
        storage.saveCustomLevel(level);
        savedCount++;
      }
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/quota/i);
    }

    expect(threw).toBe(true);
    // Nothing already accepted was silently dropped by the failed save.
    expect(storage.listCustomLevels()).toHaveLength(savedCount);
  });

  it("drops a malformed stored record instead of crashing on startup", async () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    // Wrong shape entirely: an object where an array of levels was expected.
    await seedVaultIdb({ version: 1, data: { levels: "not-an-array" } });

    const storage = createStorage();
    await vi.waitFor(() => {
      expect(storage.listCustomLevels()).toEqual([]);
    });
  });

  it("drops individually malformed entries but keeps the valid ones", async () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    const good = makeLevel({ name: "Good" });
    await seedVaultIdb({
      version: 1,
      data: { levels: [good, { not: "a level" }, 42, null] },
    });

    const storage = createStorage();
    await vi.waitFor(() => {
      expect(storage.listCustomLevels()).toEqual([good]);
    });
  });
});

// ---------------------------------------------------------------------------
// export / import
// ---------------------------------------------------------------------------

describe("export/import", () => {
  it("round-trips a full backup", async () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    const storage = createStorage();
    storage.setSettings({ username: "Magnus" });
    storage.recordBest("builtin-01", { timeMs: 5_000, boostMs: 200 });
    const level = makeLevel({ name: "Exported" });
    storage.saveCustomLevel(level);

    const backup = storage.export();
    expect(() => JSON.parse(backup)).not.toThrow(); // human-readable JSON, not an opaque blob

    const fresh = createStorage();
    fresh.import(backup);
    expect(fresh.getSettings().username).toBe("Magnus");
    expect(fresh.getBest("builtin-01")).toEqual({ timeMs: 5_000, boostMs: 200 });
    await vi.waitFor(() => {
      expect(fresh.listCustomLevels()).toEqual([level]);
    });
  });

  it("throws a clear error on invalid JSON instead of silently ignoring it", () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    const storage = createStorage();
    expect(() => storage.import("not json at all")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Godot desktop -> web migration
// ---------------------------------------------------------------------------

describe("Godot scores.json migration", () => {
  const raw = readFileSync(join(FIXTURES_DIR, "godot-scores.json"), "utf-8");
  const expected = JSON.parse(readFileSync(join(FIXTURES_DIR, "godot-scores.expected.json"), "utf-8"));

  it("maps a real Godot scores.json onto the right level ids (pure mapper)", () => {
    const godot = parseGodotScores(raw);
    expect(godot).not.toBeNull();
    const mapped = mapGodotScores(godot!);
    expect(mapped.levels).toEqual(expected.levels);
    expect(mapped.imported).toBe(expected.imported);
    expect(mapped.skipped).toEqual(expected.skipped);
  });

  it("does not confuse efficient's boost value (stored under the 'time' key) with a time best", () => {
    const godot = parseGodotScores(raw);
    const mapped = mapGodotScores(godot!);
    // builtin_1 only has an 'efficient' entry -> must land as boostMs, never as timeMs.
    expect(mapped.levels["builtin-02"]).toEqual({ boostMs: 5100, boostName: "Ada" });
  });

  it("imports through the Storage instance, improving bests independently", () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    const storage = createStorage();

    // Pre-existing local best that is BETTER than what the Godot file has for builtin-01's time.
    storage.recordBest("builtin-01", { timeMs: 1_000, boostMs: 100_000 });

    const result = storage.importGodotScores(raw);
    expect(result.imported).toBe(5);

    // Time best must not regress (1000ms beats the imported 12340ms).
    expect(storage.getBest("builtin-01")?.timeMs).toBe(1_000);
    // Boost best does improve (imported 2500ms beats the placeholder 100000ms).
    expect(storage.getBest("builtin-01")?.boostMs).toBe(2_500);

    // A level with no prior local record picks up the imported values directly.
    expect(storage.getBest("builtin-03")).toEqual({ timeMs: 45_600, boostMs: Infinity });
    expect(storage.getBest("builtin-02")).toEqual({ timeMs: Infinity, boostMs: 5_100 });
  });

  it("survives across a reload (persisted, not just in-memory)", () => {
    const backing = new FakeLocalStorage();
    vi.stubGlobal("localStorage", backing);
    createStorage().importGodotScores(raw);

    const reloaded = createStorage();
    expect(reloaded.getBest("custom-0")).toEqual({ timeMs: 30_000, boostMs: Infinity });
  });

  it("throws a clear error on invalid input instead of silently importing nothing", () => {
    vi.stubGlobal("localStorage", new FakeLocalStorage());
    const storage = createStorage();
    expect(() => storage.importGodotScores("not json")).toThrow();
  });
});
