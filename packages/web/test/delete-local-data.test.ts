// feat/delete-all-local-data - the wipe's own suite.
//
// Covers the behaviour the feature adds AND what it must refuse to do: cancelling deletes nothing
// and navigates nowhere, foreign keys survive, and the wipe never throws on a store that cannot be
// enumerated or written. There is no jsdom here, which is why `ui/localData.ts` is DOM-free: every
// assertion below runs against the real `createStorage()` / `createSubmissionQueue()` writers and a
// `localStorage`-shaped double, so it proves the effect a reloaded app would see rather than
// restating the implementation.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@swingby/core";
import { createStorage } from "../src/storage/index.js";
import { createSubmissionQueue, QUEUE_STORAGE_KEY } from "../src/net/queue.js";
import {
  HOME_HREF,
  LOCAL_DATA_KEY_PREFIX,
  collectLocalDataKeys,
  requestDeleteAllLocalData,
  wipeLocalData,
  type EnumerableStore,
} from "../src/ui/localData.js";
import { FakeLocalStorage } from "../src/storage/__tests__/fake-local-storage.js";

// Same globalThis.localStorage install/restore discipline as storage.test.ts and
// edit-current-level.test.ts - node has no such global, so the restore path has to handle "delete
// it again" as well as "put the original descriptor back".
let originalDescriptor: PropertyDescriptor | undefined;

function installGlobal(store: unknown): void {
  originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    value: store,
    configurable: true,
    writable: true,
  });
}

function restoreGlobal(): void {
  if (originalDescriptor) {
    Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    originalDescriptor = undefined;
  } else {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

function keysOf(store: FakeLocalStorage): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key !== null) out.push(key);
  }
  return out.sort();
}

/**
 * Seeds every kind of local data the shipped app writes. Settings/bests/levels go through T-10's
 * real writers; the queue key is written literally in T-13's on-disk shape rather than via
 * `queue.submit()`, because `submit()` deliberately fires a `drain()` off into the background and
 * that request landing mid-assertion would make this suite flaky (the same race the plan documents
 * for the real wipe).
 */
function seedEverything(store: FakeLocalStorage): void {
  const storage = createStorage();
  storage.setSettings({ username: "Magnus", showFps: true });
  storage.recordBest("level-1", { timeMs: 12_345, boostMs: 678 });
  storage.saveCustomLevel({
    id: "custom-1",
    name: "Test level",
    objects: [],
    start: { x: 0, y: 0 },
    goal: { x: 10, y: 10 },
  } as never);
  store.forceSet(
    QUEUE_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 1,
      items: [
        {
          id: "q1",
          payload: {
            levelId: "level-1",
            metric: "fastest",
            timeMs: 12_345,
            boostMs: 678,
            name: "Magnus",
            tape: { ticks: 100, boost: [10], brake: [50] },
          },
          attempts: 0,
          createdAt: 1,
          nextAttemptAt: 1,
        },
      ],
    }),
  );
}

describe("wipeLocalData", () => {
  let store: FakeLocalStorage;

  beforeEach(() => {
    store = new FakeLocalStorage();
    installGlobal(store);
  });

  afterEach(() => {
    restoreGlobal();
  });

  it("removes every key the shipped app writes, leaving no swingby: key behind", () => {
    seedEverything(store);
    const before = keysOf(store);
    expect(before).toContain("swingby:settings");
    expect(before).toContain("swingby:bests");
    expect(before).toContain("swingby:custom_levels");
    expect(before).toContain(QUEUE_STORAGE_KEY);

    const removed = wipeLocalData([store]);

    expect(removed.sort()).toEqual(before);
    // Enumerated, not spot-checked: a key this test never named would fail here too.
    expect(keysOf(store)).toEqual([]);
    expect(collectLocalDataKeys(store)).toEqual([]);
  });

  it("wipes a swingby: key it has never heard of (another task's future key)", () => {
    store.forceSet("swingby:some_new_thing", '{"a":1}');
    store.forceSet("swingby:another", "2");

    expect(wipeLocalData([store]).sort()).toEqual([
      "swingby:another",
      "swingby:some_new_thing",
    ]);
    expect(keysOf(store)).toEqual([]);
  });

  it("leaves keys outside the swingby: namespace untouched", () => {
    seedEverything(store);
    store.forceSet("theme", "dark");
    store.forceSet("other-app:token", "secret");

    wipeLocalData([store]);

    expect(keysOf(store)).toEqual(["other-app:token", "theme"]);
    expect(store.getItem("theme")).toBe("dark");
  });

  it("leaves a fresh reader looking at a brand-new user", () => {
    seedEverything(store);
    wipeLocalData([store]);

    // A new document's worth of readers: fresh Storage, fresh queue, same backing store.
    const storage = createStorage();
    expect(storage.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(storage.getSettings().username).toBe(DEFAULT_SETTINGS.username);
    expect(storage.getBest("level-1")).toBeNull();
    expect(storage.listCustomLevels()).toEqual([]);
    expect(createSubmissionQueue({ baseUrl: "", store }).size()).toBe(0);
  });

  it("sweeps every store it is given, not just the first", () => {
    const session = new FakeLocalStorage();
    store.forceSet("swingby:settings", "{}");
    session.forceSet("swingby:draft", "{}");

    wipeLocalData([store, session]);

    expect(keysOf(store)).toEqual([]);
    expect(keysOf(session)).toEqual([]);
  });

  it("never throws when there is no localStorage at all", () => {
    restoreGlobal();
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => wipeLocalData()).not.toThrow();
    expect(wipeLocalData()).toEqual([]);
  });

  it("never throws when the store cannot be enumerated or removed from", () => {
    const hostile: EnumerableStore = {
      get length(): number {
        throw new Error("enumeration blocked");
      },
      key(): string | null {
        throw new Error("enumeration blocked");
      },
      removeItem(): void {
        throw new Error("removal blocked");
      },
    };
    expect(wipeLocalData([hostile])).toEqual([]);

    let removeCalls = 0;
    const readOnly: EnumerableStore = {
      length: 1,
      key: (i) => (i === 0 ? "swingby:settings" : null),
      removeItem: () => {
        removeCalls++;
        throw new Error("removal blocked");
      },
    };
    // Reports what it managed to remove (nothing) rather than failing the caller mid-wipe.
    expect(wipeLocalData([readOnly])).toEqual([]);
    expect(removeCalls).toBe(1);
  });
});

describe("requestDeleteAllLocalData", () => {
  let store: FakeLocalStorage;

  beforeEach(() => {
    store = new FakeLocalStorage();
    installGlobal(store);
  });

  afterEach(() => {
    restoreGlobal();
  });

  it("cancelling deletes nothing and navigates nowhere", async () => {
    seedEverything(store);
    const before = keysOf(store).map(
      (k) => [k, store.getItem(k)] as [string, string | null],
    );
    const navigations: string[] = [];
    let wipeCalls = 0;

    const outcome = await requestDeleteAllLocalData({
      confirm: async () => false,
      wipe: () => {
        wipeCalls++;
        return [];
      },
      navigate: (href) => navigations.push(href),
    });

    expect(outcome).toEqual({ deleted: false, removedKeys: [] });
    expect(wipeCalls).toBe(0);
    expect(navigations).toEqual([]);
    // Byte-identical, not merely "still has the keys".
    expect(
      keysOf(store).map((k) => [k, store.getItem(k)] as [string, string | null]),
    ).toEqual(before);
  });

  it("confirming wipes and lands on the main menu, exactly once", async () => {
    seedEverything(store);
    const navigations: string[] = [];

    const outcome = await requestDeleteAllLocalData({
      confirm: async () => true,
      wipe: () => wipeLocalData([store]),
      navigate: (href) => navigations.push(href),
    });

    expect(outcome.deleted).toBe(true);
    expect(outcome.removedKeys).toContain("swingby:settings");
    expect(keysOf(store)).toEqual([]);
    expect(navigations).toEqual([HOME_HREF]);
    expect(HOME_HREF).toBe("/");
  });

  it("does not touch storage before the confirmation resolves", async () => {
    seedEverything(store);
    let resolveConfirm: ((v: boolean) => void) | null = null;
    const pending = requestDeleteAllLocalData({
      confirm: () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
      wipe: () => wipeLocalData([store]),
      navigate: () => undefined,
    });

    // Dialog still open: nothing removed yet.
    expect(keysOf(store)).toContain("swingby:settings");
    (resolveConfirm as unknown as (v: boolean) => void)(false);
    await pending;
    expect(keysOf(store)).toContain("swingby:settings");
  });
});

describe("the CSS the feature reuses", () => {
  // The feature adds no CSS: the button and the dialog are built entirely from classes T-08 already
  // ships. Asserting on rule text (the ui-toggle-css.test.ts technique - there is no jsdom, so the
  // real cascade is Playwright's job) is what catches a future cleanup deleting a class this
  // feature silently depends on for its destructive styling and its modal layout.
  const css = readFileSync(
    fileURLToPath(new URL("../src/styles/components.css", import.meta.url)),
    "utf8",
  );

  it("still defines the destructive button and the dialog shell", () => {
    for (const selector of [
      ".btn-danger",
      ".overlay",
      ".dialog",
      ".dialog .dialog-sub",
      ".dialog-actions",
    ]) {
      expect(css).toContain(`${selector} {`);
    }
  });
});

describe("the swingby: namespace convention", () => {
  // Guard, not documentation: a future key written outside the namespace would silently survive a
  // wipe, and nothing else in the suite would notice. Same source-reading technique as
  // src/game/__tests__/input.test.ts's "never touches localStorage" assertion.
  const files = ["../src/storage/index.ts", "../src/net/queue.ts"];

  it("every storage-key literal in the persisting modules is swingby:-prefixed", () => {
    const found: string[] = [];
    for (const rel of files) {
      const path = fileURLToPath(new URL(rel, import.meta.url));
      const text = readFileSync(path, "utf8");
      // String literals that look like a namespaced key: `word:word`, no slashes or spaces (which
      // would make it a URL, a mime type or prose).
      for (const m of text.matchAll(/"([A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+)"/g)) {
        found.push(m[1] as string);
      }
    }
    expect(found.length).toBeGreaterThan(0);
    for (const key of found) {
      expect(key.startsWith(LOCAL_DATA_KEY_PREFIX)).toBe(true);
    }
  });
});
