/**
 * T-11 DRAFT — follow-up regression coverage for wiring `shareLevel` (T-13 PODIUM's `Api`).
 * Tests the headless, DOM-free `shareLevelFlow` orchestration directly (see editor.ts's own doc
 * comment on why it's factored out this way) — no browser/DOM required for any of this file.
 *
 * The three properties the coordinator's follow-up explicitly named, each proven as its own test:
 *   1. Never blocks on the network — a `shareLevel` that never resolves still results in an error
 *      outcome within `timeoutMs`, and the level is saved locally regardless.
 *   2. The level is saved locally (T-10) BEFORE any network call happens — proven by call order,
 *      not just by both calls eventually happening.
 *   3. The response is treated as hostile remote data — every malformed/hostile shape is rejected,
 *      never used to build a link.
 */
import { describe, expect, it, vi } from "vitest";
import type { Level } from "@swingby/core";
import { validate } from "@swingby/core";
import {
  describeError,
  sanitizeShareResult,
  shareLevelFlow,
  withTimeout,
  type ShareDeps,
} from "../src/editor/editor.js";

const VALID_LEVEL: Level = {
  name: "Shareable",
  author: "Tester",
  goal: { index: 1, range: 80 },
  objects: [
    { type: "player", x: 0, y: 0, x_vel: 1, y_vel: 0, gravity: 0 },
    { type: "sun", x: 400, y: 0, gravity: 2000, visible: true, size: 20 },
  ],
};

const INVALID_LEVEL: Level = {
  name: "Broken",
  author: "Tester",
  goal: { index: 0, range: 50 },
  objects: [{ type: "sun", x: 0, y: 0, gravity: 0, visible: true, size: 10 }], // no player, no gravity>0
};

function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {
    /* never settles, on purpose */
  });
}

function baseDeps(overrides: Partial<ShareDeps> = {}): ShareDeps {
  return {
    validateLevel: validate,
    saveLocally: () => {},
    shareLevel: async () => ({ id: "abc123", url: "https://swingby.example/l/abc123" }),
    ...overrides,
  };
}

describe("shareLevelFlow — validation gate", () => {
  it("refuses an invalid level and never calls saveLocally or shareLevel", async () => {
    const saveLocally = vi.fn();
    const shareLevel = vi.fn();
    const outcome = await shareLevelFlow(INVALID_LEVEL, baseDeps({ saveLocally, shareLevel }));
    expect(outcome.kind).toBe("invalid");
    if (outcome.kind === "invalid") {
      expect(outcome.errors.length).toBeGreaterThan(0);
    }
    expect(saveLocally).not.toHaveBeenCalled();
    expect(shareLevel).not.toHaveBeenCalled();
  });

  it("accepts a valid level and proceeds", async () => {
    const outcome = await shareLevelFlow(VALID_LEVEL, baseDeps());
    expect(outcome.kind).toBe("shared");
  });
});

describe("shareLevelFlow — save-before-network ordering (the safety property)", () => {
  it("calls saveLocally, and onSavedLocally fires, strictly BEFORE shareLevel is invoked", async () => {
    const order: string[] = [];
    const outcome = await shareLevelFlow(
      VALID_LEVEL,
      baseDeps({
        saveLocally: () => order.push("saveLocally"),
        onSavedLocally: () => order.push("onSavedLocally"),
        shareLevel: async (level) => {
          order.push("shareLevel");
          expect(level).toEqual(VALID_LEVEL); // the saved level and the shared level are the same object
          return { id: "x", url: "https://swingby.example/l/x" };
        },
      }),
    );
    expect(order).toEqual(["saveLocally", "onSavedLocally", "shareLevel"]);
    expect(outcome.kind).toBe("shared");
  });

  it("the level is saved locally even when the subsequent network call fails", async () => {
    const saveLocally = vi.fn();
    const outcome = await shareLevelFlow(
      VALID_LEVEL,
      baseDeps({
        saveLocally,
        shareLevel: async () => {
          throw new Error("network refused");
        },
      }),
    );
    expect(saveLocally).toHaveBeenCalledTimes(1); // saved, regardless of the share outcome
    expect(outcome.kind).toBe("share-failed");
  });

  it("the level is saved locally even when the network call hangs forever", async () => {
    const saveLocally = vi.fn();
    const outcome = await shareLevelFlow(
      VALID_LEVEL,
      baseDeps({ saveLocally, shareLevel: () => neverResolves(), timeoutMs: 30 }),
    );
    expect(saveLocally).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe("share-failed");
  });

  it("a local save failure (e.g. quota) is reported and shareLevel is NEVER called", async () => {
    const shareLevel = vi.fn();
    const outcome = await shareLevelFlow(
      VALID_LEVEL,
      baseDeps({
        saveLocally: () => {
          throw new Error("QuotaExceededError");
        },
        shareLevel,
      }),
    );
    expect(outcome.kind).toBe("save-failed");
    if (outcome.kind === "save-failed") {
      expect(outcome.message).toContain("QuotaExceededError");
    }
    expect(shareLevel).not.toHaveBeenCalled(); // never attempt to share something that failed to save
  });
});

describe("shareLevelFlow — never blocks on the network", () => {
  it("a shareLevel that never resolves still produces an outcome within timeoutMs, measured", async () => {
    const start = Date.now();
    const outcome = await shareLevelFlow(
      VALID_LEVEL,
      baseDeps({ shareLevel: () => neverResolves(), timeoutMs: 50 }),
    );
    const elapsed = Date.now() - start;
    expect(outcome.kind).toBe("share-failed");
    if (outcome.kind === "share-failed") {
      expect(outcome.message.toLowerCase()).toContain("timed out");
    }
    // Bounded by the configured timeout, not left hanging — generous upper bound for CI jitter,
    // still far below "the editor appears frozen."
    expect(elapsed).toBeLessThan(1000);
  });

  it("withTimeout rejects a never-resolving promise at the configured delay, not later", async () => {
    const start = Date.now();
    await expect(withTimeout(neverResolves(), 40, "test")).rejects.toThrow(/timed out/);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("withTimeout resolves immediately for an already-fast promise (no artificial delay added)", async () => {
    const start = Date.now();
    const value = await withTimeout(Promise.resolve(42), 5000, "test");
    expect(value).toBe(42);
    expect(Date.now() - start).toBeLessThan(100);
  });
});

describe("sanitizeShareResult — hostile remote data", () => {
  const cases: Array<[string, unknown]> = [
    ["null", null],
    ["a bare string", "https://evil.example/l/x"],
    ["missing url", { id: "abc" }],
    ["missing id", { url: "https://swingby.example/l/abc" }],
    ["non-string id", { id: 123, url: "https://swingby.example/l/x" }],
    ["non-string url", { id: "abc", url: 123 }],
    ["empty id", { id: "", url: "https://swingby.example/l/x" }],
    ["empty url", { id: "abc", url: "" }],
    ["javascript: scheme", { id: "abc", url: "javascript:alert(1)" }],
    ["data: scheme", { id: "abc", url: "data:text/html,<script>alert(1)</script>" }],
    ["not a URL at all", { id: "abc", url: "not a url" }],
    ["absurdly long id", { id: "x".repeat(10000), url: "https://swingby.example/l/x" }],
    ["array instead of object", ["abc", "https://swingby.example/l/x"]],
  ];

  for (const [label, value] of cases) {
    it(`rejects: ${label}`, () => {
      expect(sanitizeShareResult(value)).toBeNull();
    });
  }

  it("accepts a well-formed https response", () => {
    expect(sanitizeShareResult({ id: "abc-123", url: "https://swingby.example/l/abc-123" })).toEqual({
      id: "abc-123",
      url: "https://swingby.example/l/abc-123",
    });
  });

  it("accepts a well-formed http response (local dev)", () => {
    expect(sanitizeShareResult({ id: "abc", url: "http://localhost:5173/l/abc" })).toEqual({
      id: "abc",
      url: "http://localhost:5173/l/abc",
    });
  });

  it("end-to-end: shareLevelFlow refuses a hostile response and never produces a 'shared' outcome", async () => {
    const outcome = await shareLevelFlow(
      VALID_LEVEL,
      baseDeps({ shareLevel: async () => ({ id: "abc", url: "javascript:alert(document.cookie)" }) }),
    );
    expect(outcome.kind).toBe("share-failed");
  });
});

describe("describeError", () => {
  it("uses a real Error's message", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });
  it("falls back to a generic message for a non-Error throw (hostile catch value)", () => {
    expect(describeError("just a string")).not.toBe("just a string");
    expect(describeError(undefined)).toMatch(/wrong/i);
    expect(describeError({ weird: true })).toMatch(/wrong/i);
  });
});
