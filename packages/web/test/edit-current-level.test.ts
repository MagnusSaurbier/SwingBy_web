/**
 * feat/edit-current-level — the feature's own suite.
 *
 * Scope of THIS file: the persisted hotkey key's durability. The route/decision logic is covered in
 * `src/ui/__tests__/router.test.ts` and `src/ui/__tests__/view-models.test.ts`; the DOM behaviour
 * (mounting a seeded editor, the not-found panel) is covered in the real-browser pass, because
 * there is no jsdom here and `mountEditor` builds a canvas and a renderer.
 *
 * Why this file exists at all: the hotkey binding is persisted as a TOP-LEVEL settings key that is
 * deliberately absent from the frozen `Settings` type (`packages/core/src/constants.ts` is a FROZEN
 * contract — see `EDIT_LEVEL_HOTKEY_KEY`'s doc comment for the two structural reasons). That makes
 * it an *unknown* key as far as every layer of `storage/index.ts` is concerned, and it survives
 * only because `mergeSettings`, `setSettings` and `import()` each preserve unknown fields on
 * purpose. That is three independent places where a future "tidy up: only keep known settings
 * keys" would silently eat a user's binding with no type error anywhere to catch it.
 *
 * So these tests exercise the full backup path — `export()` -> a *different* Storage instance's
 * `import()` -> read back — rather than just `setSettings`/`getSettings`. Reasoning that unknown
 * keys round-trip is not the same as proving it.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@swingby/core";
import { ROUTES } from "../src/ui/app.js";
import { matchRoute } from "../src/ui/router.js";
import { createStorage } from "../src/storage/index.js";
import { FakeLocalStorage } from "../src/storage/__tests__/fake-local-storage.js";
import {
  EDIT_LEVEL_HOTKEY_KEY,
  editLevelHotkeyPatch,
  readEditLevelHotkey,
} from "../src/ui/view-models.js";

// Same globalThis.localStorage save/restore discipline as storage.test.ts — Node has no such
// global, so "restore" is almost always "delete it again".
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

function useStore(store: unknown): void {
  Object.defineProperty(globalThis, "localStorage", {
    value: store,
    configurable: true,
    writable: true,
  });
}

/** A placeholder binding string. The real default's FORMAT (bare key vs modifier chord) is still an
 *  open question with the repo owner, so nothing here asserts on grammar — only that whatever
 *  string is stored comes back byte-identical. */
const BINDING = "test-binding-value";

describe("edit-level hotkey — persistence", () => {
  it("is absent by default, and readEditLevelHotkey reports that as null", () => {
    useStore(new FakeLocalStorage());
    const storage = createStorage();
    expect(readEditLevelHotkey(storage.getSettings())).toBeNull();
    // And it is genuinely not in the frozen defaults — if someone ever adds it to
    // core/constants.ts, this fails and the whole workaround should be revisited.
    expect(EDIT_LEVEL_HOTKEY_KEY in DEFAULT_SETTINGS).toBe(false);
  });

  it("survives a write and a full reload from the same backing store", () => {
    const store = new FakeLocalStorage();
    useStore(store);
    createStorage().setSettings(editLevelHotkeyPatch(BINDING));

    // A brand-new Storage instance re-reads and re-merges from scratch — this is the `mergeSettings`
    // preserve-unknown path, not the in-memory cache.
    expect(readEditLevelHotkey(createStorage().getSettings())).toBe(BINDING);
  });

  it("survives export() from one browser and import() into another", () => {
    const storeA = new FakeLocalStorage();
    useStore(storeA);
    const a = createStorage();
    a.setSettings(editLevelHotkeyPatch(BINDING));
    a.setSettings({ username: "Magnus" });
    const backup = a.export();

    // The key must actually be in the serialized payload, not merely recoverable by luck.
    expect(JSON.parse(backup).settings[EDIT_LEVEL_HOTKEY_KEY]).toBe(BINDING);

    const storeB = new FakeLocalStorage();
    useStore(storeB);
    const b = createStorage();
    expect(readEditLevelHotkey(b.getSettings())).toBeNull();
    b.import(backup);

    expect(readEditLevelHotkey(b.getSettings())).toBe(BINDING);
    expect(b.getSettings().username).toBe("Magnus");
    // ...and it is still there after B itself is reloaded, i.e. import() persisted it rather than
    // only updating the live cache.
    expect(readEditLevelHotkey(createStorage().getSettings())).toBe(BINDING);
  });

  it("import() of a backup without the key leaves an existing binding alone", () => {
    // import() merges rather than replacing (storage/index.ts says so explicitly). Restoring an old
    // backup made before this feature existed must not clear a binding the user has since set.
    const store = new FakeLocalStorage();
    useStore(store);
    const storage = createStorage();
    storage.setSettings(editLevelHotkeyPatch(BINDING));

    storage.import(
      JSON.stringify({ settings: { username: "Someone", trail: true } }),
    );

    expect(readEditLevelHotkey(storage.getSettings())).toBe(BINDING);
    expect(storage.getSettings().username).toBe("Someone");
  });

  it("REFUSES a non-string persisted value rather than handing it on", () => {
    // Nothing in the app writes these, but a hand-edited or corrupted backup can. `import()` is
    // documented as never throwing on garbage, so the guard has to be on the read side.
    const store = new FakeLocalStorage();
    useStore(store);
    const storage = createStorage();

    for (const bad of [42, null, { code: "KeyD" }, ["KeyD"], true, ""]) {
      storage.import(
        JSON.stringify({ settings: { [EDIT_LEVEL_HOTKEY_KEY]: bad } }),
      );
      expect(readEditLevelHotkey(storage.getSettings())).toBeNull();
    }
  });

  it("does not disturb the controls record it deliberately sits outside of", () => {
    const store = new FakeLocalStorage();
    useStore(store);
    const storage = createStorage();
    storage.setSettings(editLevelHotkeyPatch(BINDING));

    const controls = createStorage().getSettings().controls;
    expect(controls).toEqual(DEFAULT_SETTINGS.controls);
    expect(EDIT_LEVEL_HOTKEY_KEY in controls).toBe(false);
  });
});

describe("edit-level route — the app's real routing table", () => {
  // `src/ui/__tests__/router.test.ts` covers matchRoute/buildPath as functions, against its own
  // local fixture. That fixture is a copy, so those tests pass whether or not `app.ts` ever gained
  // the route — they document the shape without covering the wiring. These assert on the table the
  // app actually mounts.

  it("routes /editor/:levelId to the editor screen", () => {
    expect(matchRoute("/editor/builtin-07", ROUTES)).toEqual({
      name: "editor",
      params: { levelId: "builtin-07" },
    });
  });

  it("still routes the bare /editor to the same screen, with no params", () => {
    expect(matchRoute("/editor", ROUTES)).toEqual({
      name: "editor",
      params: {},
    });
  });

  it("REFUSES a deeper editor path — it must fall through to notFound", () => {
    expect(matchRoute("/editor/builtin-07/extra", ROUTES)).toBeNull();
  });

  it("did not disturb the routes that were already there", () => {
    expect(matchRoute("/", ROUTES)?.name).toBe("menu");
    expect(matchRoute("/levels", ROUTES)?.name).toBe("levels");
    expect(matchRoute("/settings", ROUTES)?.name).toBe("settings");
    expect(matchRoute("/play/builtin-07", ROUTES)).toEqual({
      name: "play",
      params: { levelId: "builtin-07" },
    });
    expect(matchRoute("/l/abc123", ROUTES)).toEqual({
      name: "shared",
      params: { shareId: "abc123" },
    });
  });

  it("keeps /editor/:levelId from shadowing /play/:levelId or /l/:shareId", () => {
    // All three are two-segment patterns; first-match-wins means order matters. If the editor
    // pattern ever moved above them with a literal that could collide, this catches it.
    expect(matchRoute("/play/anything", ROUTES)?.name).toBe("play");
    expect(matchRoute("/l/anything", ROUTES)?.name).toBe("shared");
  });
});
