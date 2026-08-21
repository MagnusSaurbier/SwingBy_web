import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Level, Settings } from "@swingby/core";
import { customLevelId, DEFAULT_SETTINGS } from "@swingby/core";
import { createStorage, type PersonalBest, type Storage } from "../index.js";
import { FakeLocalStorage } from "./fake-local-storage.js";

// ---------------------------------------------------------------------------
// globalThis.localStorage plumbing — save/restore around every test so tests can't leak state
// into each other (Node has no localStorage global at all by default, so the "restore" path is
// almost always "delete it again").
// ---------------------------------------------------------------------------

let originalDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
});

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(globalThis, "localStorage", originalDescriptor);
  } else {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

function setGlobalLocalStorage(store: unknown): void {
  Object.defineProperty(globalThis, "localStorage", {
    value: store,
    configurable: true,
    writable: true,
  });
}

function removeGlobalLocalStorage(): void {
  delete (globalThis as { localStorage?: unknown }).localStorage;
}

function sampleLevel(name: string, objectCount = 2): Level {
  const objects: Level["objects"] = [
    { type: "player", x: 0, y: 0, gravity: 0 },
  ];
  for (let i = 1; i < objectCount; i++) {
    objects.push({
      type: "planet",
      x: i * 50,
      y: i * 25,
      gravity: 400,
      anchored: true,
    });
  }
  return {
    name,
    author: "Test",
    goal: { index: objects.length - 1, range: 40 },
    objects,
  };
}

// ---------------------------------------------------------------------------
// 1. Empty store — the first non-negotiable behaviour.
// ---------------------------------------------------------------------------

describe("empty store", () => {
  it("createStorage() against a brand-new store never throws and yields full defaults", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    let storage!: Storage;
    expect(() => (storage = createStorage())).not.toThrow();

    expect(storage.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(storage.getBest("builtin-00")).toBeNull();
    expect(storage.listCustomLevels()).toEqual([]);
  });

  it("also migrates cleanly with no localStorage global present at all", () => {
    removeGlobalLocalStorage();
    let storage!: Storage;
    expect(() => (storage = createStorage())).not.toThrow();
    expect(storage.getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

// ---------------------------------------------------------------------------
// 2. Settings round-trip across "reload" (same backing store, new createStorage() call).
// ---------------------------------------------------------------------------

describe("settings", () => {
  it("round-trips across a simulated reload", () => {
    const backing = new FakeLocalStorage();
    setGlobalLocalStorage(backing);

    const a = createStorage();
    a.setSettings({ username: "Magnus", trail: true, boostType: 2 });

    // Simulate a reload: fresh Storage instance, same backing store.
    const b = createStorage();
    const settings = b.getSettings();
    expect(settings.username).toBe("Magnus");
    expect(settings.trail).toBe(true);
    expect(settings.boostType).toBe(2);
    // Untouched fields still carry their defaults.
    expect(settings.showFps).toBe(DEFAULT_SETTINGS.showFps);
  });

  it("merges controls per-action instead of replacing the whole object", () => {
    const backing = new FakeLocalStorage();
    setGlobalLocalStorage(backing);
    const storage = createStorage();

    // `Settings["controls"]` intersects with a literal-keyed default object (constants.ts), so TS
    // narrows individual binding values to their default literal type (e.g. `boost: "Space"`) —
    // a quirk of the frozen `Settings` type, not something index.ts needs to work around (it
    // never constructs a `controls` value through the type system this directly). Cast here since
    // this is test code exercising an intentionally-arbitrary rebind at runtime.
    const patchedControls = {
      ...storage.getSettings().controls,
      boost: "KeyJ",
    } as Settings["controls"];
    storage.setSettings({ controls: patchedControls });
    const controls = storage.getSettings().controls;
    expect(controls.boost).toBe("KeyJ");
    // Every other binding is still the default — a partial controls patch must not wipe the rest.
    expect(controls.brake).toBe(DEFAULT_SETTINGS.controls.brake);
    expect(controls.pause).toBe(DEFAULT_SETTINGS.controls.pause);
  });

  it("unknown stored fields survive a write cycle (top-level and inside controls)", () => {
    const backing = new FakeLocalStorage();
    backing.forceSet(
      "swingby:settings",
      JSON.stringify({
        schemaVersion: 1,
        settings: {
          username: "Rae",
          fromFutureVersion: "keep-me",
          controls: { boost: "Space", fromFutureBinding: "KeyZ" },
        },
      }),
    );
    setGlobalLocalStorage(backing);

    const storage = createStorage();
    // Write through setSettings with an UNRELATED patch — the unknown fields must still be there
    // afterwards, both in the live object and in what actually got persisted.
    storage.setSettings({ trail: true });

    const live = storage.getSettings() as unknown as Record<string, unknown>;
    expect(live.fromFutureVersion).toBe("keep-me");
    expect((live.controls as Record<string, unknown>).fromFutureBinding).toBe(
      "KeyZ",
    );

    const persisted = JSON.parse(backing.getItem("swingby:settings") as string);
    expect(persisted.settings.fromFutureVersion).toBe("keep-me");
    expect(persisted.settings.controls.fromFutureBinding).toBe("KeyZ");
  });
});

// ---------------------------------------------------------------------------
// 3. recordBest — independent metrics.
// ---------------------------------------------------------------------------

describe("recordBest", () => {
  it("both metrics are new on the first recorded run", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    const storage = createStorage();
    const r = storage.recordBest("builtin-00", {
      timeMs: 10_000,
      boostMs: 2_000,
    });
    expect(r).toEqual({ timeIsNew: true, boostIsNew: true });
    expect(storage.getBest("builtin-00")).toEqual({
      timeMs: 10_000,
      boostMs: 2_000,
    });
  });

  it("a run can beat the best time while missing the best efficiency, independently", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    const storage = createStorage();
    storage.recordBest("builtin-00", { timeMs: 10_000, boostMs: 2_000 });

    const r = storage.recordBest("builtin-00", {
      timeMs: 9_000,
      boostMs: 2_500,
    });
    expect(r).toEqual({ timeIsNew: true, boostIsNew: false });
    // The stored boost best must be UNCHANGED — this is the exact case the task doc calls out.
    expect(storage.getBest("builtin-00")).toEqual({
      timeMs: 9_000,
      boostMs: 2_000,
    });
  });

  it("symmetrically: a run can beat boost while missing time", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    const storage = createStorage();
    storage.recordBest("builtin-00", { timeMs: 10_000, boostMs: 2_000 });

    const r = storage.recordBest("builtin-00", {
      timeMs: 11_000,
      boostMs: 1_500,
    });
    expect(r).toEqual({ timeIsNew: false, boostIsNew: true });
    expect(storage.getBest("builtin-00")).toEqual({
      timeMs: 10_000,
      boostMs: 1_500,
    });
  });

  it("a tie does not count as new (strict improvement only, matches DataManager.gd's `>` check)", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    const storage = createStorage();
    storage.recordBest("builtin-00", { timeMs: 10_000, boostMs: 2_000 });
    const r = storage.recordBest("builtin-00", {
      timeMs: 10_000,
      boostMs: 2_000,
    });
    expect(r).toEqual({ timeIsNew: false, boostIsNew: false });
  });

  it("bests for different levels are independent of each other", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    const storage = createStorage();
    storage.recordBest("builtin-00", { timeMs: 5_000, boostMs: 1_000 });
    storage.recordBest("builtin-01", { timeMs: 7_000, boostMs: 1_500 });
    expect(storage.getBest("builtin-00")).toEqual({
      timeMs: 5_000,
      boostMs: 1_000,
    });
    expect(storage.getBest("builtin-01")).toEqual({
      timeMs: 7_000,
      boostMs: 1_500,
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Custom levels — round trip, including near a configured size limit, and quota surfacing.
// ---------------------------------------------------------------------------

describe("custom levels", () => {
  it("round-trips save/list/delete", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    const storage = createStorage();
    const level = sampleLevel("Slingshot");

    storage.saveCustomLevel(level);
    expect(storage.listCustomLevels()).toEqual([level]);

    const id = customLevelId(level);
    storage.deleteCustomLevel(id);
    expect(storage.listCustomLevels()).toEqual([]);
  });

  it("round-trips across a simulated reload", () => {
    const backing = new FakeLocalStorage();
    setGlobalLocalStorage(backing);
    const a = createStorage();
    a.saveCustomLevel(sampleLevel("One"));
    a.saveCustomLevel(sampleLevel("Two"));

    const b = createStorage();
    expect(b.listCustomLevels().map((l) => l.name)).toEqual(["One", "Two"]);
  });

  it("saves right up to a configured quota, then the next save throws and surfaces to the caller", () => {
    // Each sampleLevel(...) serialises to a bit under 250 bytes; budget for exactly 3.
    const probeSize = JSON.stringify({
      schemaVersion: 1,
      levels: [sampleLevel("X")],
    }).length;
    const quotaBytes = probeSize + 2 * 120; // room for ~3 levels, not 4 — exact margin doesn't matter
    const backing = new FakeLocalStorage({ quotaBytes });
    setGlobalLocalStorage(backing);
    const storage = createStorage();

    let saved = 0;
    let threw: unknown;
    try {
      for (let i = 0; i < 50; i++) {
        storage.saveCustomLevel(sampleLevel(`Level ${i}`));
        saved++;
      }
    } catch (err) {
      threw = err;
    }

    expect(threw).toBeDefined();
    expect((threw as Error).name).toBe("QuotaExceededError");
    expect(saved).toBeGreaterThan(0);
    expect(saved).toBeLessThan(50);
    // The error must not be swallowed AND the cache must reflect only what actually got persisted
    // — the failed save must not silently appear to have succeeded.
    expect(storage.listCustomLevels()).toHaveLength(saved);
  });

  it("custom levels near (but under) the quota still round-trip fully", () => {
    const level = sampleLevel("BigOne", 40); // many objects -> a meaningfully large payload
    const encoded = JSON.stringify({ schemaVersion: 1, levels: [level] });
    const backing = new FakeLocalStorage({ quotaBytes: encoded.length + 16 }); // just enough room
    setGlobalLocalStorage(backing);
    const storage = createStorage();

    expect(() => storage.saveCustomLevel(level)).not.toThrow();
    expect(storage.listCustomLevels()).toEqual([level]);
  });
});

describe("custom level creation dates", () => {
  it("is null for a level id that was never saved", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    const storage = createStorage();
    expect(storage.getCustomLevelCreatedAt("nonexistent-id")).toBeNull();
  });

  it("defaults to now when saveCustomLevel is called with no explicit createdAt", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    const storage = createStorage();
    const level = sampleLevel("Slingshot");
    const before = Date.now();
    storage.saveCustomLevel(level);
    const after = Date.now();

    const createdAt = storage.getCustomLevelCreatedAt(customLevelId(level));
    expect(createdAt).not.toBeNull();
    const ms = Date.parse(createdAt as string);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  it("preserves an explicit createdAt (import restoring the original save date)", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    const storage = createStorage();
    const level = sampleLevel("Slingshot");
    storage.saveCustomLevel(level, { createdAt: "2020-01-01T00:00:00.000Z" });
    expect(storage.getCustomLevelCreatedAt(customLevelId(level))).toBe(
      "2020-01-01T00:00:00.000Z",
    );
  });

  it("round-trips across a simulated reload", () => {
    const backing = new FakeLocalStorage();
    setGlobalLocalStorage(backing);
    const a = createStorage();
    const level = sampleLevel("Slingshot");
    a.saveCustomLevel(level, { createdAt: "2021-06-15T12:00:00.000Z" });

    const b = createStorage();
    expect(b.getCustomLevelCreatedAt(customLevelId(level))).toBe(
      "2021-06-15T12:00:00.000Z",
    );
  });

  it("is cleared when the level is deleted", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    const storage = createStorage();
    const level = sampleLevel("Slingshot");
    const id = customLevelId(level);
    storage.saveCustomLevel(level, { createdAt: "2021-06-15T12:00:00.000Z" });
    storage.deleteCustomLevel(id);
    expect(storage.getCustomLevelCreatedAt(id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Corruption robustness — every key, both "garbage JSON" and "valid JSON, wrong shape".
// ---------------------------------------------------------------------------

describe("corruption robustness", () => {
  const KEYS = [
    "swingby:settings",
    "swingby:bests",
    "swingby:custom_levels",
  ] as const;

  it.each(KEYS)(
    "garbage (unparseable) JSON at %s never throws, resets that key to defaults",
    (key) => {
      const backing = new FakeLocalStorage();
      backing.forceSet(key, "{{{not json");
      setGlobalLocalStorage(backing);

      let storage!: Storage;
      expect(() => (storage = createStorage())).not.toThrow();
      expect(storage.getSettings()).toEqual(DEFAULT_SETTINGS);
      expect(storage.getBest("builtin-00")).toBeNull();
      expect(storage.listCustomLevels()).toEqual([]);
    },
  );

  it("valid JSON of the wrong shape at settings ([] instead of an object) resets to defaults", () => {
    const backing = new FakeLocalStorage();
    backing.forceSet("swingby:settings", "[]");
    setGlobalLocalStorage(backing);
    const storage = createStorage();
    expect(storage.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("valid JSON of the wrong shape at bests ([] instead of an object) resets to defaults", () => {
    const backing = new FakeLocalStorage();
    backing.forceSet("swingby:bests", "[]");
    setGlobalLocalStorage(backing);
    const storage = createStorage();
    expect(storage.getBest("builtin-00")).toBeNull();
  });

  it("valid JSON of the wrong shape at custom levels ({} instead of an array) resets to defaults", () => {
    const backing = new FakeLocalStorage();
    backing.forceSet("swingby:custom_levels", "{}");
    setGlobalLocalStorage(backing);
    const storage = createStorage();
    expect(storage.listCustomLevels()).toEqual([]);
  });

  it("a single malformed entry in an otherwise-good bests file drops only that entry", () => {
    const backing = new FakeLocalStorage();
    backing.forceSet(
      "swingby:bests",
      JSON.stringify({
        schemaVersion: 1,
        bests: {
          "builtin-00": { timeMs: 1000, boostMs: 200 },
          "builtin-01": { timeMs: "oops" },
        },
      }),
    );
    setGlobalLocalStorage(backing);
    const storage = createStorage();
    expect(storage.getBest("builtin-00")).toEqual({
      timeMs: 1000,
      boostMs: 200,
    });
    expect(storage.getBest("builtin-01")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Storage unavailable — throws on write from the very first call, or absent entirely.
// ---------------------------------------------------------------------------

describe("storage unavailable", () => {
  it("localStorage present but throwing on every write (Safari private mode): full in-memory fallback, nothing throws", () => {
    setGlobalLocalStorage(new FakeLocalStorage({ throwOnWrite: true }));
    let storage!: Storage;
    expect(() => (storage = createStorage())).not.toThrow();

    expect(() => storage.setSettings({ username: "Rae" })).not.toThrow();
    expect(storage.getSettings().username).toBe("Rae"); // the in-memory cache still updates

    expect(() =>
      storage.recordBest("builtin-00", { timeMs: 1, boostMs: 1 }),
    ).not.toThrow();

    const level = sampleLevel("StillWorks");
    expect(() => storage.saveCustomLevel(level)).not.toThrow();
    expect(storage.listCustomLevels()).toEqual([level]);
  });

  it("localStorage entirely absent: full in-memory fallback, nothing throws", () => {
    removeGlobalLocalStorage();
    let storage!: Storage;
    expect(() => (storage = createStorage())).not.toThrow();

    expect(() => storage.setSettings({ trail: true })).not.toThrow();
    expect(() =>
      storage.recordBest("builtin-00", { timeMs: 1, boostMs: 1 }),
    ).not.toThrow();
    expect(() => storage.saveCustomLevel(sampleLevel("Fine"))).not.toThrow();
    expect(storage.listCustomLevels()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 7. export() / import() — round-trip fidelity, and robustness of import() itself.
// ---------------------------------------------------------------------------

describe("export / import", () => {
  it("round-trips settings (incl. an unknown field), bests, and custom levels into a fresh store", () => {
    const backingA = new FakeLocalStorage();
    setGlobalLocalStorage(backingA);
    const a = createStorage();

    a.setSettings({ username: "Magnus", trail: true, boostType: 3 });
    // Simulate an unknown-to-this-build field arriving via a raw write underneath setSettings,
    // the way a newer build's export might carry one.
    const raw = JSON.parse(backingA.getItem("swingby:settings") as string);
    raw.settings.fromNewerBuild = "carried-over";
    backingA.forceSet("swingby:settings", JSON.stringify(raw));
    const aReloaded = createStorage(); // pick the unknown field back up into the live cache

    const levels: Level[] = [
      sampleLevel("Alpha"),
      sampleLevel("Beta"),
      sampleLevel("Gamma"),
    ];
    const bestIds = ["builtin-00", "builtin-01", "builtin-02", "builtin-03"];
    for (const level of levels) aReloaded.saveCustomLevel(level);
    for (const [i, id] of bestIds.entries()) {
      aReloaded.recordBest(id, {
        timeMs: 1000 * (i + 1),
        boostMs: 100 * (i + 1),
      });
    }

    const exported = aReloaded.export();

    // Fresh, independent store — the real target of the round trip.
    setGlobalLocalStorage(new FakeLocalStorage());
    const b = createStorage();
    expect(() => b.import(exported)).not.toThrow();

    // --- report as counts ---
    const settingsB = b.getSettings() as unknown as Record<string, unknown>;
    let settingsPreserved = 0;
    if (settingsB.username === "Magnus") settingsPreserved++;
    if (settingsB.trail === true) settingsPreserved++;
    if (settingsB.boostType === 3) settingsPreserved++;
    if (settingsB.fromNewerBuild === "carried-over") settingsPreserved++;
    expect(settingsPreserved).toBe(4); // 3 known fields + 1 unknown field, all preserved

    let bestsPreserved = 0;
    for (const [i, id] of bestIds.entries()) {
      const expected = { timeMs: 1000 * (i + 1), boostMs: 100 * (i + 1) };
      if (JSON.stringify(b.getBest(id)) === JSON.stringify(expected))
        bestsPreserved++;
    }
    expect(bestsPreserved).toBe(4);

    const namesB = new Set(b.listCustomLevels().map((l) => l.name));
    let levelsPreserved = 0;
    for (const level of levels) if (namesB.has(level.name)) levelsPreserved++;
    expect(levelsPreserved).toBe(3);
  });

  it("import() merges bests, never regressing a locally-better score with an older backup", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    const storage = createStorage();
    storage.recordBest("builtin-00", { timeMs: 5000, boostMs: 500 });

    const oldBackup = JSON.stringify({
      schemaVersion: 1,
      settings: {},
      bests: { "builtin-00": { timeMs: 9000, boostMs: 100 } }, // worse time, better boost
      customLevels: [],
    });
    storage.import(oldBackup);

    // time: local 5000 is better than backup's 9000 -> kept. boost: backup's 100 is better -> taken.
    expect(storage.getBest("builtin-00")).toEqual({
      timeMs: 5000,
      boostMs: 100,
    });
  });

  it("import() never throws on garbage or wrong-shape JSON", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    const storage = createStorage();
    expect(() => storage.import("{{{not json")).not.toThrow();
    expect(() => storage.import("[1,2,3]")).not.toThrow();
    expect(() => storage.import("null")).not.toThrow();
    // State must still be exactly the untouched empty defaults after all of that.
    expect(storage.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(storage.listCustomLevels()).toEqual([]);
  });

  it("import() dedupes custom levels already present by customLevelId", () => {
    setGlobalLocalStorage(new FakeLocalStorage());
    const storage = createStorage();
    const level = sampleLevel("Dupe");
    storage.saveCustomLevel(level);

    const backup = JSON.stringify({
      schemaVersion: 1,
      settings: {},
      bests: {},
      customLevels: [level, sampleLevel("NotADupe")],
    });
    storage.import(backup);

    expect(
      storage
        .listCustomLevels()
        .map((l) => l.name)
        .sort(),
    ).toEqual(["Dupe", "NotADupe"]);
  });
});

// A canary type-check: PersonalBest's shape is exactly {timeMs, boostMs} per INTERFACES.md.
const _typeCheck: PersonalBest = { timeMs: 0, boostMs: 0 };
void _typeCheck;
